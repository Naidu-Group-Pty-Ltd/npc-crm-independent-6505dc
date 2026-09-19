/**
 * Scenario Delta Engine — Phase B (Engine Unification)
 *
 * SINGLE SOURCE OF TRUTH for what-if scenario math.
 *
 * The same engine is used by:
 *   1. Edge function (`calculate-borrowing-capacity` server-side replay)
 *   2. Strategy Scenario Builder (`StrategyScenarioModeling` UI)
 *   3. AI Strategy Advisor (Apply Scenario flow)
 *   4. PDF report generators (scenario comparison pages)
 *
 * For Deno parity, `supabase/functions/_shared/scenarioDeltaEngine.ts` mirrors
 * this file structurally. Both are covered by parity tests.
 *
 * Engine contract:
 *   1. Take base BorrowingCapacityInput + an array of ScenarioDelta objects
 *   2. Resolve every entity-bound delta against the ScenarioContext (warns on
 *      unknown property/liability IDs to catch AI hallucinations)
 *   3. Aggregate net adjustments (income / expense / commitments / rate / debt
 *      balance / loan term / DTI cap)
 *   4. Replay calculateBorrowingCapacity with the adjusted inputs
 *   5. Return ScenarioCapacityResult with capacity-change comparison + warnings
 */

import {
  calculateBorrowingCapacity,
  type BorrowingCapacityInput,
  type BorrowingCapacityResult,
} from './borrowingCapacityCalculations';
import {
  type ScenarioDelta,
  type ScenarioCapacityResult,
  type AcquisitionCapacity,
  type CapitalLedger,
  type CapitalSourceType,
  buildScenarioChange,
} from './borrowingCapacityTypes';
import {
  buildCapitalLedger,
  type LedgerContext,
} from './capitalAllocationLedger';
import { estimateLMI, type LmiMode } from './lmiCalculations';
import {
  calculateStampDuty,
  estimateOtherAcquisitionCosts,
  type AustralianState,
  type PurchaseIntent,
  type PropertyCategory,
} from './stampDutyCalculator';
import {
  resolveLenderProfile,
  reshadeIncome,
  BANK_STANDARD_PROFILE,
  type ScenarioIncomeComponent,
} from './lenderShadingProfiles';
import {
  computeNegativeGearingAddBack,
  marginalTaxRateFor,
} from './negativeGearingAddBack';
import {
  resolveLvrCap,
  inferPropertyKind,
  inferPropertyIntent,
} from './lenderLvrCaps';
import {
  computeDtiDenominator,
  computeDti,
} from './dtiDenominator';

// ============================================
// CONTEXT TYPES
// ============================================

export interface AcquisitionContext {
  state?: AustralianState;
  intent?: PurchaseIntent;
  category?: PropertyCategory;
  isFirstHomeBuyer?: boolean;
  isForeignBuyer?: boolean;
  lmiMode?: LmiMode;
  /** Cash on hand brought to settlement (in addition to released equity) */
  cashOnHand?: number;
  /** Phase F2 — target purchase price the strategy is trying to hit.
   *  When set, AcquisitionCapacity reports `meetsTarget` + `shortfallToTarget`
   *  and exposes `loanRequiredForPurchase` / `netCashAfterSettlement` so the
   *  Strategy Builder can show "achievable" / "short by $X" feedback. */
  targetPurchasePrice?: number;
}

export interface ScenarioContext {
  baseInputs: BorrowingCapacityInput;
  baseResult: BorrowingCapacityResult;
  properties?: ScenarioProperty[];
  liabilities?: ScenarioLiability[];
  acquisition?: AcquisitionContext;
  /** Phase I1 — typed income components for lender-aware re-shading. */
  incomeComponents?: ScenarioIncomeComponent[];
  /** Phase I1 — current lender profile id (defaults to bank_standard). */
  currentLenderProfileId?: string;
  /** Phase I2 — monthly HEM benchmark; engine floors expenses here. */
  hemBenchmark?: number;
}

export interface ScenarioProperty {
  id: string;
  address: string;
  propertyType: string;
  currentValue: number;
  loanRemaining: number;
  /** Servicing repayment used in commitments (P&I or IO) */
  monthlyRepayment: number;
  loanRepaymentAmount?: number;
  /** Net monthly cash flow (rent − expenses), positive or negative */
  netMonthlyCashflow?: number;
  monthlyRentalIncome?: number;
  /** Phase F1 — contracted annual interest rate on this property's loan (%).
   *  Used by `equity_release`, `property_refinance`, and `property_rate_change`
   *  deltas instead of the global `baseInputs.interestRate`. */
  interestRate?: number;
}

export interface ScenarioLiability {
  id: string;
  type: string;
  label: string;
  balance: number;
  limit?: number;
  monthlyServicing: number;
}

// ============================================
// EFFECT AGGREGATOR
// ============================================

export interface DeltaEffect {
  incomeAdjustment: number;
  shadedIncomeAdjustment: number;
  expenseAdjustment: number;
  commitmentAdjustment: number;
  rateAdjustment: number;
  loanTermAdjustment: number;
  debtBalanceAdjustment: number;
  dtiCapEnabled?: boolean;
  dtiCapLimit?: number;
  /** Phase I1 — lender profile id to apply during aggregation. */
  lenderProfileOverride?: string;
  /** Phase C: cash freed from equity-release deltas (post-LMI on the release loan) */
  releasedCapital: number;
  /** Phase C: notes from equity-release / acquisition levers (audit trail) */
  acquisitionNotes: string[];
  description: string;
}

function emptyEffect(description = ''): DeltaEffect {
  return {
    incomeAdjustment: 0,
    shadedIncomeAdjustment: 0,
    expenseAdjustment: 0,
    commitmentAdjustment: 0,
    rateAdjustment: 0,
    loanTermAdjustment: 0,
    debtBalanceAdjustment: 0,
    releasedCapital: 0,
    acquisitionNotes: [],
    description,
  };
}

/** Blended shading ratio derived from the client's actual income profile.
 *  Used as the fallback for absolute income deltas where the AI/operator
 *  hasn't specified a shading category — keeps scenarios aligned with the
 *  base assessment instead of defaulting to a magic 0.8.
 */
function blendedShadingRatio(ctx: ScenarioContext): number {
  const gross = ctx.baseInputs.grossAnnualIncome;
  const shaded = ctx.baseInputs.shadedAnnualIncome;
  if (gross <= 0) return 0.8;
  return Math.max(0, Math.min(1, shaded / gross));
}

// ── Phase E (M3 fix): HEM tier-aware expense recompute ─────────────────
// Mirrors `policyEngine.DEFAULT_HEM_CONFIG.incomeScaling`. When an
// income-growth or portfolio-sell delta moves the client into a new HEM
// tier, the assumed monthly living-expense floor must scale with it —
// otherwise high-income scenarios under-estimate expenses and overstate
// borrowing capacity.
const HEM_TIER_MULTIPLIERS: Array<{ maxIncome: number; multiplier: number }> = [
  { maxIncome: 80000,  multiplier: 1.00 },
  { maxIncome: 120000, multiplier: 1.15 },
  { maxIncome: 180000, multiplier: 1.30 },
  { maxIncome: 250000, multiplier: 1.50 },
  { maxIncome: Infinity, multiplier: 1.75 },
];

function hemMultiplierFor(grossAnnualIncome: number): number {
  for (const tier of HEM_TIER_MULTIPLIERS) {
    if (grossAnnualIncome <= tier.maxIncome) return tier.multiplier;
  }
  return HEM_TIER_MULTIPLIERS[HEM_TIER_MULTIPLIERS.length - 1].multiplier;
}

function computeHemTierDelta(
  baseGrossAnnualIncome: number,
  newGrossAnnualIncome: number,
  baseMonthlyExpenses: number,
): number {
  if (baseMonthlyExpenses <= 0) return 0;
  const baseMult = hemMultiplierFor(Math.max(0, baseGrossAnnualIncome));
  const newMult = hemMultiplierFor(Math.max(0, newGrossAnnualIncome));
  if (baseMult === newMult) return 0;
  const rescaled = baseMonthlyExpenses * (newMult / baseMult);
  const delta = rescaled - baseMonthlyExpenses;
  const cap = baseMonthlyExpenses * 0.30;
  return Math.max(-cap, Math.min(cap, delta));
}

// ============================================
// VALIDATION (Phase B safety net)
// ============================================

export interface DeltaValidationIssue {
  deltaId: string;
  deltaType: string;
  severity: 'warning' | 'error';
  message: string;
}

/** Validate deltas against the available context. Surfaces unknown
 *  property/liability IDs (AI hallucination guard) and obviously broken
 *  numeric inputs. Callers should block save/apply/export when any issue
 *  has severity "error"; preview math still runs on safe deltas only. */
export function validateDeltas(
  deltas: ScenarioDelta[],
  context: ScenarioContext,
): DeltaValidationIssue[] {
  const issues: DeltaValidationIssue[] = [];
  const propertyIds = new Set((context.properties || []).map(p => p.id));
  const liabilityIds = new Set((context.liabilities || []).map(l => l.id));

  for (const d of deltas) {
    if (!Number.isFinite(d.value)) {
      issues.push({ deltaId: d.id, deltaType: d.type, severity: 'error', message: 'Non-finite value' });
      continue;
    }
    switch (d.type) {
      case 'property_sell':
      case 'property_refinance':
      case 'equity_release':
      case 'property_rate_change':
      case 'property_value_change':
        if (!propertyIds.has(d.id)) {
          issues.push({
            deltaId: d.id,
            deltaType: d.type,
            severity: 'error',
            message: `Property "${d.id}" not found in client portfolio — delta ignored`,
          });
        }
        if (d.type === 'property_rate_change' && (d.value < 0.5 || d.value > 25)) {
          issues.push({
            deltaId: d.id,
            deltaType: d.type,
            severity: 'warning',
            message: `Property rate ${d.value}% outside plausible 0.5–25% band`,
          });
        }
        if (d.type === 'property_value_change') {
          if (d.unit === 'percent' && Math.abs(d.value) > 100) {
            issues.push({
              deltaId: d.id,
              deltaType: d.type,
              severity: 'warning',
              message: `Valuation uplift ${d.value}% exceeds ±100% — likely a data entry error`,
            });
          }
          if (d.unit === 'absolute' && d.value <= 0) {
            issues.push({
              deltaId: d.id,
              deltaType: d.type,
              severity: 'error',
              message: `Absolute valuation must be positive (got ${d.value})`,
            });
          }
          // basis is required so finance can audit the assumption
          const basis = d.meta?.basis as string | undefined;
          if (!basis) {
            issues.push({
              deltaId: d.id,
              deltaType: d.type,
              severity: 'warning',
              message: 'Valuation override missing `meta.basis` — PDF will watermark as unverified',
            });
          }
        }
        break;
      case 'portfolio_lvr_release': {
        const ids = (d.meta?.propertyIds as string[] | undefined) || [];
        if (!Array.isArray(ids) || ids.length === 0) {
          issues.push({
            deltaId: d.id,
            deltaType: d.type,
            severity: 'error',
            message: 'Pool release missing `meta.propertyIds` — at least one property required',
          });
        } else {
          for (const pid of ids) {
            if (!propertyIds.has(pid)) {
              issues.push({
                deltaId: d.id,
                deltaType: d.type,
                severity: 'error',
                message: `Pool member "${pid}" not in portfolio — excluded from blended LVR`,
              });
            }
          }
        }
        const target = d.unit === 'percent' ? d.value / 100 : d.value;
        if (!Number.isFinite(target) || target <= 0 || target > 0.97) {
          issues.push({
            deltaId: d.id,
            deltaType: d.type,
            severity: 'warning',
            message: `Blended target LVR ${(target * 100).toFixed(1)}% outside 0–97% sane band`,
          });
        }
        break;
      }
      case 'liability_payoff':
        if (!liabilityIds.has(d.id)) {
          issues.push({
            deltaId: d.id,
            deltaType: d.type,
            severity: 'error',
            message: `Liability "${d.id}" not found — delta ignored`,
          });
        }
        break;
      case 'rate_change':
        if (Math.abs(d.value) > 10) {
          issues.push({ deltaId: d.id, deltaType: d.type, severity: 'warning', message: 'Rate change exceeds ±10pp — likely unrealistic' });
        }
        break;
      case 'loan_term_change':
        if (Math.abs(d.value) > 30) {
          issues.push({ deltaId: d.id, deltaType: d.type, severity: 'warning', message: 'Loan term change exceeds ±30 years' });
        }
        break;
    }
  }
  return issues;
}

// ============================================
// DELTA APPLICATION
// ============================================

export function applyDelta(delta: ScenarioDelta, context: ScenarioContext): DeltaEffect {
  const effect = emptyEffect(delta.label || delta.type);
  const shadingRatio = blendedShadingRatio(context);

  switch (delta.type) {
    case 'income_change': {
      if (delta.unit === 'percent') {
        const factor = delta.value / 100;
        effect.incomeAdjustment = context.baseInputs.grossAnnualIncome * factor;
        effect.shadedIncomeAdjustment = context.baseInputs.shadedAnnualIncome * factor;
      } else {
        effect.incomeAdjustment = delta.value;
        effect.shadedIncomeAdjustment = delta.value * shadingRatio;
      }
      break;
    }

    case 'expense_change': {
      if (delta.unit === 'percent') {
        effect.expenseAdjustment = context.baseInputs.monthlyLivingExpenses * (delta.value / 100);
      } else {
        effect.expenseAdjustment = delta.value;
      }
      break;
    }

    case 'debt_change': {
      if (delta.unit === 'percent') {
        const factor = delta.value / 100;
        effect.commitmentAdjustment = context.baseInputs.monthlyCommitments * factor;
        effect.debtBalanceAdjustment = (context.baseInputs.totalDebtBalances || 0) * factor;
      } else {
        effect.commitmentAdjustment = delta.value;
        // Approximate balance change from monthly servicing using a 25-year P&I duration factor
        effect.debtBalanceAdjustment = delta.value * 200;
      }
      break;
    }

    case 'rate_change':
      effect.rateAdjustment = delta.value;
      break;

    case 'loan_term_change':
      // value is years (positive = extend, negative = shorten)
      effect.loanTermAdjustment = delta.value;
      break;

    case 'dti_cap_change': {
      // meta.enabled drives toggle, value is the cap multiple (e.g. 6.0)
      const enabled = (delta.meta?.enabled as boolean | undefined) ?? true;
      effect.dtiCapEnabled = enabled;
      if (enabled) effect.dtiCapLimit = delta.value;
      // Phase I1 — accept lender profile flip via meta.lenderProfile so the
      // engine can re-shade rental / bonus / commission per that lender.
      const lp = delta.meta?.lenderProfile as string | undefined;
      if (lp) effect.lenderProfileOverride = lp;
      break;
    }

    case 'property_sell': {
      const property = context.properties?.find(p => p.id === delta.id);
      if (property) {
        const loanServicing = property.loanRepaymentAmount || property.monthlyRepayment || 0;
        if (loanServicing > 0) effect.commitmentAdjustment = -loanServicing;
        if (property.loanRemaining > 0) effect.debtBalanceAdjustment = -property.loanRemaining;
        const cf = property.netMonthlyCashflow || 0;
        if (cf > 0) {
          effect.incomeAdjustment = -(cf * 12);
          effect.shadedIncomeAdjustment = -(cf * 12 * shadingRatio);
        } else if (cf < 0) {
          // Removing a negative-cash-flow property reduces expenses → expenseAdjustment is negative
          effect.expenseAdjustment = cf;
        }
        effect.description = `Sell ${property.address?.slice(0, 30) || 'property'}`;
      }
      break;
    }

    case 'property_refinance': {
      const property = context.properties?.find(p => p.id === delta.id);
      if (property && property.loanRemaining > 0) {
        const currentRepayment = property.loanRepaymentAmount || property.monthlyRepayment || 0;
        // Phase F1 — use the property's own contracted rate (fallback to global)
        const propertyRatePct = property.interestRate ?? context.baseInputs.interestRate;
        const ioMonthlyRate = propertyRatePct / 100 / 12;
        const autoIoRepayment = property.loanRemaining * ioMonthlyRate;
        // Phase 3 — granular controls:
        //   meta.manualRepayment: explicit $/mo override on the refinanced loan
        //   meta.ioPeriodYears: informational (3/5/10) — surfaced in the audit note
        const manualRepayment = delta.meta?.manualRepayment as number | undefined;
        const ioPeriodYears = delta.meta?.ioPeriodYears as number | undefined;
        const newRepayment = Number.isFinite(manualRepayment as number) && (manualRepayment as number) >= 0
          ? (manualRepayment as number)
          : autoIoRepayment;
        const saving = Math.max(0, currentRepayment - newRepayment);
        if (saving > 0) effect.commitmentAdjustment = -saving;
        const repayLabel = Number.isFinite(manualRepayment as number)
          ? `manual $${Math.round(manualRepayment as number).toLocaleString('en-AU')}/mo`
          : `IO @ ${propertyRatePct.toFixed(2)}%`;
        const periodLabel = Number.isFinite(ioPeriodYears as number) && (ioPeriodYears as number) > 0
          ? ` (${ioPeriodYears}yr IO period)`
          : '';
        effect.acquisitionNotes.push(
          `Refinance ${property.address?.slice(0, 30) || 'property'} → ${repayLabel}${periodLabel}: monthly servicing −$${Math.round(saving).toLocaleString('en-AU')}`
        );
        effect.description = `Refinance ${property.address?.slice(0, 30) || 'property'} to IO${periodLabel}`;
      }
      break;
    }

    case 'property_rate_change': {
      // Phase F1 — repricing a single property (e.g. negotiated refinance to a
      // lower rate). Recomputes that property's monthly servicing using the
      // NEW rate, keeping the existing repayment structure (P&I vs IO) intact.
      const property = context.properties?.find(p => p.id === delta.id);
      if (property && property.loanRemaining > 0 && Number.isFinite(delta.value) && delta.value > 0) {
        const currentRepayment = property.loanRepaymentAmount || property.monthlyRepayment || 0;
        const oldRatePct = property.interestRate ?? context.baseInputs.interestRate;
        const newRatePct = delta.value;

        // Infer current structure from the relationship between repayment & loan.
        // If repayment looks like IO at the current rate, keep IO at the new rate.
        // Otherwise treat as P&I over the policy-default term.
        const monthlyOldIO = property.loanRemaining * (oldRatePct / 100 / 12);
        const isIo = currentRepayment > 0 && Math.abs(currentRepayment - monthlyOldIO) / Math.max(1, monthlyOldIO) < 0.05;

        let newRepayment: number;
        if (isIo) {
          newRepayment = property.loanRemaining * (newRatePct / 100 / 12);
        } else {
          const termYears = context.baseInputs.loanTermYears || 30;
          const periods = termYears * 12;
          const monthlyRate = newRatePct / 100 / 12;
          newRepayment = monthlyRate > 0
            ? property.loanRemaining * (monthlyRate * Math.pow(1 + monthlyRate, periods)) / (Math.pow(1 + monthlyRate, periods) - 1)
            : property.loanRemaining / periods;
        }

        const delta$ = newRepayment - currentRepayment;
        effect.commitmentAdjustment = delta$;
        effect.acquisitionNotes.push(
          `Reprice ${property.address?.slice(0, 30) || 'property'}: ${oldRatePct.toFixed(2)}% → ${newRatePct.toFixed(2)}% ${isIo ? '(IO)' : '(P&I)'}, monthly servicing ${delta$ >= 0 ? '+' : '−'}$${Math.round(Math.abs(delta$)).toLocaleString('en-AU')}`
        );
        effect.description = `Reprice ${property.address?.slice(0, 30) || 'property'} to ${newRatePct.toFixed(2)}%`;
      }
      break;
    }

    case 'property_add': {
      // Adding a new property — value = estimated monthly net contribution
      if (delta.unit === 'absolute') {
        if (delta.value > 0) {
          effect.incomeAdjustment = delta.value * 12;
          effect.shadedIncomeAdjustment = delta.value * 12 * shadingRatio;
        } else {
          effect.expenseAdjustment = Math.abs(delta.value);
        }
      }
      break;
    }

    case 'liability_payoff': {
      const liability = context.liabilities?.find(l => l.id === delta.id);
      if (liability) {
        effect.commitmentAdjustment = -liability.monthlyServicing;
        effect.debtBalanceAdjustment = -(liability.balance || 0);
        effect.description = `Pay off ${liability.label || liability.type}`;
      }
      break;
    }

    case 'equity_release': {
      // Phase C + F2 + Phase 2 (granular controls): Equity-release lever
      // closes the loop between cash freed, the new shadow debt, and the
      // source property's actual contracted rate.
      //
      // Inputs interpreted from the delta:
      //   value: target LVR as a ratio (0.80) OR % (80) OR absolute release amount
      //   meta.targetLVR: optional explicit target LVR (0–1 ratio)
      //   meta.releaseRate: optional override rate for the release loan (% p.a.)
      //   meta.lenderMaxLVR: optional lender ceiling per security (default 0.95)
      //   meta.deploymentPercent: 0–1 ratio of the gross release the broker
      //     actually intends to deploy (default 1.0 = full release). Lower
      //     values reduce both the new debt slice AND the servicing cost
      //     proportionally — broker can flex the tradeoff between capital
      //     unlocked and serviceability hit.
      //   meta.repaymentType: 'interest_only' (default) | 'principal_and_interest'
      //     — drives whether the new slice is serviced as IO @ assessment rate
      //     or amortised P&I over the policy term.
      //   meta.manualRepayment: optional explicit $/mo override on the new
      //     slice. When provided, bypasses both auto-IO and auto-P&I math.
      //   unit: 'ratio' = LVR ratio, 'percent' = LVR %, 'absolute' = direct $ amount
      //
      // Output:
      //   - releasedCapital ≈ deployed equity loan − LMI on that loan (cash to settlement)
      //   - commitmentAdjustment += monthly repayment on the NEW deployed slice only
      //   - debtBalanceAdjustment += deployed equity loan principal (DTI honest)
      const property = context.properties?.find(p => p.id === delta.id);
      if (!property || property.currentValue <= 0) break;

      const fhb = !!context.acquisition?.isFirstHomeBuyer;
      // Phase F1/F2 — release loan rate priority:
      //   1. explicit override on the delta (`meta.releaseRate`)
      //   2. property's contracted rate (`property.interestRate`)
      //   3. global assessment rate
      const overrideRate = delta.meta?.releaseRate as number | undefined;
      const ratePct = (Number.isFinite(overrideRate) && (overrideRate as number) > 0)
        ? (overrideRate as number)
        : (property.interestRate ?? context.baseInputs.interestRate ?? 6.5);
      const monthlyRate = (ratePct / 100) / 12;

      // Phase I7 — per-security LVR cap: lender × intent × kind, with FHB/foreign adjustments.
      const intentForCap = inferPropertyIntent(property.propertyType, 'investment');
      const kindForCap = inferPropertyKind(property.propertyType);
      const lenderCapInput = (delta.meta?.lenderMaxLVR as number | undefined);
      const lvrResult = resolveLvrCap({
        lenderId: context.currentLenderProfileId,
        intent: intentForCap,
        kind: kindForCap,
        isFirstHomeBuyer: !!context.acquisition?.isFirstHomeBuyer,
        isForeignBuyer: !!context.acquisition?.isForeignBuyer,
        explicitCap: lenderCapInput,
      });
      const safeLenderCap = lvrResult.cap;

      // Resolve the new max loan size on this property
      let newLoan = 0;
      if (delta.unit === 'absolute' && delta.value > 0) {
        newLoan = property.loanRemaining + delta.value;
      } else {
        const targetLVR = delta.unit === 'percent'
          ? delta.value / 100
          : (delta.meta?.targetLVR as number | undefined) ?? delta.value;
        const safeTarget = Math.max(0, Math.min(safeLenderCap, targetLVR || 0.8));
        newLoan = property.currentValue * safeTarget;
      }
      // Phase I7 — never exceed lender × intent × kind cap regardless of input
      newLoan = Math.min(newLoan, property.currentValue * safeLenderCap);
      const grossRelease = Math.max(0, newLoan - property.loanRemaining);
      if (grossRelease <= 0) {
        // Phase G3 — no longer silent. Surface the reason so the rationale PDF
        // can prompt finance to consider G1 valuation uplift or G2 pool mode.
        const currentLvr = (property.loanRemaining / property.currentValue) * 100;
        effect.acquisitionNotes.push(
          `⚠ Equity release on ${property.address?.slice(0, 30) || 'property'} skipped — already at ${currentLvr.toFixed(1)}% LVR (target would shrink loan). Consider valuation uplift (G1) or cross-collateralised pool mode (G2).`
        );
        break;
      }

      // LMI on the equity-release loan if LVR > 80%
      const newLvr = (newLoan / property.currentValue) * 100;
      let lmiOnRelease = 0;
      if (newLvr > 80) {
        const est = estimateLMI({
          propertyValue: property.currentValue,
          depositAmount: property.currentValue - newLoan,
          loanAmount: newLoan,
          isFirstHomeBuyer: fhb,
        });
        lmiOnRelease = est.lmiAmount;
      }

      // Phase 2 (granular controls): apply deployment % BEFORE servicing &
      // released-capital calcs. A 50% deployment halves both the cash freed
      // AND the new debt slice (and therefore the servicing hit).
      const rawDeployPct = delta.meta?.deploymentPercent;
      const deploymentPercent = Number.isFinite(rawDeployPct as number)
        ? Math.max(0, Math.min(1, rawDeployPct as number))
        : 1;
      const deployedGross = grossRelease * deploymentPercent;
      const deployedLmi = lmiOnRelease * deploymentPercent;
      const netRelease = Math.max(0, deployedGross - deployedLmi);

      // Phase 2: repayment type & manual override on the new slice.
      const repaymentType = (delta.meta?.repaymentType as string | undefined) === 'principal_and_interest'
        ? 'principal_and_interest'
        : 'interest_only';
      const manualRepayment = delta.meta?.manualRepayment as number | undefined;

      // F2 fix — servicing impact is the cost on the deployed NEW slice only.
      // Phase I3 — APRA requires servicing be assessed at the BUFFERED rate
      // (contracted + buffer, typically +3.00%). Borrowers will be tested at
      // the assessment rate by the lender, so the engine mirrors that.
      const assessmentRatePct = ratePct + (context.baseInputs.bufferRate ?? 3);
      const assessmentMonthlyRate = (assessmentRatePct / 100) / 12;
      const termYears = context.baseInputs.loanTermYears || 30;
      const periods = termYears * 12;

      let newSliceRepayment: number;
      if (Number.isFinite(manualRepayment as number) && (manualRepayment as number) >= 0) {
        newSliceRepayment = manualRepayment as number;
      } else if (repaymentType === 'principal_and_interest' && assessmentMonthlyRate > 0) {
        newSliceRepayment = deployedGross * (assessmentMonthlyRate * Math.pow(1 + assessmentMonthlyRate, periods)) /
          (Math.pow(1 + assessmentMonthlyRate, periods) - 1);
      } else {
        // IO at the buffered assessment rate
        newSliceRepayment = deployedGross * assessmentMonthlyRate;
      }
      effect.commitmentAdjustment = Math.max(0, newSliceRepayment);
      // Phase I4 — debt balance includes the deployed equity slice so DTI sees it.
      effect.debtBalanceAdjustment = deployedGross;

      effect.releasedCapital = netRelease;
      const repayLabel = Number.isFinite(manualRepayment as number)
        ? `manual $${Math.round(manualRepayment as number).toLocaleString('en-AU')}/mo`
        : repaymentType === 'principal_and_interest'
          ? `P&I @ ${assessmentRatePct.toFixed(2)}% over ${termYears}y`
          : `IO @ ${assessmentRatePct.toFixed(2)}% (buffered)`;
      effect.acquisitionNotes.push(
        `Equity release on ${property.address?.slice(0, 30) || 'property'} @ ${ratePct.toFixed(2)}%: gross $${Math.round(grossRelease).toLocaleString('en-AU')} × deploy ${(deploymentPercent * 100).toFixed(0)}% = $${Math.round(deployedGross).toLocaleString('en-AU')} − LMI $${Math.round(deployedLmi).toLocaleString('en-AU')} = $${Math.round(netRelease).toLocaleString('en-AU')} usable. New LVR ${newLvr.toFixed(1)}% (cap: ${lvrResult.reason}). Servicing +$${Math.round(newSliceRepayment).toLocaleString('en-AU')}/mo (${repayLabel}).`
      );
      effect.description = `Release equity from ${property.address?.slice(0, 30) || 'property'}`;
      break;
    }

    case 'property_value_change': {
      // Phase G1 — Pure input override. Mutates the resolved property record
      // in place so any downstream property-bound delta in the same run sees
      // the new valuation. The order-aware sort in `runScenario` guarantees
      // value changes are applied first.
      const property = context.properties?.find(p => p.id === delta.id);
      if (!property || property.currentValue <= 0) break;
      const oldValue = property.currentValue;
      let newValue = oldValue;
      if (delta.unit === 'percent') {
        newValue = oldValue * (1 + delta.value / 100);
      } else if (delta.unit === 'absolute' && delta.value > 0) {
        newValue = delta.value;
      }
      newValue = Math.max(0, newValue);
      if (Math.abs(newValue - oldValue) < 1) break;
      property.currentValue = newValue; // mutate in place — order-aware engine
      const basis = (delta.meta?.basis as string | undefined) || 'manual';
      const source = (delta.meta?.source as string | undefined) || '—';
      const pct = oldValue > 0 ? ((newValue - oldValue) / oldValue) * 100 : 0;
      effect.acquisitionNotes.push(
        `Revalue ${property.address?.slice(0, 30) || 'property'}: $${Math.round(oldValue).toLocaleString('en-AU')} → $${Math.round(newValue).toLocaleString('en-AU')} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%, basis: ${basis}, source: ${source})`
      );
      effect.description = `Revalue ${property.address?.slice(0, 30) || 'property'}`;
      break;
    }

    case 'portfolio_lvr_release': {
      // Phase G2 — Cross-collateralised / blended-LVR release across a pool.
      // Closes the gap where standalone mode floors at $0 even when an
      // equity-rich property could subsidise over-leveraged ones.
      //
      // Math:
      //   pool members = meta.propertyIds (filtered to actual portfolio)
      //   totalValue   = Σ currentValue (post G1 overrides)
      //   totalDebt    = Σ loanRemaining
      //   target debt  = totalValue × blendedTargetLVR
      //   gross pool   = max(0, target debt − totalDebt)
      //   allocation   = highest_equity_first OR pro_rata
      //   per-property newLoan ≤ currentValue × lenderMaxLVR
      //   LMI         = computed PER SECURITY on slices crossing 80% LVR
      const pool = (delta.meta?.propertyIds as string[] | undefined) || [];
      const members = (context.properties || []).filter(p => pool.includes(p.id) && p.currentValue > 0);
      if (members.length === 0) {
        effect.acquisitionNotes.push(`⚠ Pool release: no valid pool members found in portfolio.`);
        break;
      }

      const blendedTarget = delta.unit === 'percent' ? delta.value / 100 : delta.value;
      const safeBlended = Math.max(0, Math.min(0.97, blendedTarget || 0.8));

      // Phase I7 — per-security caps now resolved per-property using lender × intent × kind.
      // Single override (delta.meta.lenderMaxLVR) is honoured as a tightening clamp only.
      const explicitOverride = (delta.meta?.lenderMaxLVR as number | undefined);

      const allocationStrategy = (delta.meta?.allocationStrategy as string | undefined) === 'pro_rata'
        ? 'pro_rata'
        : 'highest_equity_first';

      const totalValue = members.reduce((s, p) => s + p.currentValue, 0);
      const totalDebt = members.reduce((s, p) => s + p.loanRemaining, 0);
      const targetTotalDebt = totalValue * safeBlended;
      const grossPool = Math.max(0, targetTotalDebt - totalDebt);

      if (grossPool <= 0) {
        const currentBlended = totalValue > 0 ? (totalDebt / totalValue) * 100 : 0;
        effect.acquisitionNotes.push(
          `⚠ Pool release skipped — current blended LVR ${currentBlended.toFixed(1)}% already at/above target ${(safeBlended * 100).toFixed(1)}%.`
        );
        break;
      }

      // Per-property headroom uses I7 cap matrix (each security may differ)
      const headroom = members.map(p => {
        const cap = resolveLvrCap({
          lenderId: context.currentLenderProfileId,
          intent: inferPropertyIntent(p.propertyType, 'investment'),
          kind: inferPropertyKind(p.propertyType),
          isFirstHomeBuyer: !!context.acquisition?.isFirstHomeBuyer,
          isForeignBuyer: !!context.acquisition?.isForeignBuyer,
          explicitCap: explicitOverride,
        });
        return {
          property: p,
          headroom: Math.max(0, p.currentValue * cap.cap - p.loanRemaining),
          equity: Math.max(0, p.currentValue - p.loanRemaining),
          capPct: cap.cap,
          capReason: cap.reason,
        };
      });
      const totalHeadroom = headroom.reduce((s, h) => s + h.headroom, 0);
      // Cap pool draw at total headroom (lender will not exceed any single security's cap)
      const cappedPool = Math.min(grossPool, totalHeadroom);

      // Allocate cappedPool across members
      let allocations: Array<{ property: typeof members[number]; allocation: number }> = [];
      if (allocationStrategy === 'pro_rata' && totalHeadroom > 0) {
        allocations = headroom.map(h => ({
          property: h.property,
          allocation: cappedPool * (h.headroom / totalHeadroom),
        }));
      } else {
        // highest_equity_first — fill cleanest-security headroom first
        const sorted = [...headroom].sort((a, b) => b.equity - a.equity);
        let remaining = cappedPool;
        allocations = sorted.map(h => {
          const take = Math.min(h.headroom, remaining);
          remaining = Math.max(0, remaining - take);
          return { property: h.property, allocation: take };
        }).filter(a => a.allocation > 0);
      }

      // Compute LMI per-security and aggregate the pool
      const fhb = !!context.acquisition?.isFirstHomeBuyer;
      let totalGross = 0;
      let totalLmi = 0;
      let totalIo = 0;
      const overrideRate = delta.meta?.releaseRate as number | undefined;
      const blendedRatePct = (Number.isFinite(overrideRate) && (overrideRate as number) > 0)
        ? (overrideRate as number)
        : context.baseInputs.interestRate ?? 6.5;

      const securityNotes: string[] = [];
      for (const a of allocations) {
        if (a.allocation <= 0) continue;
        totalGross += a.allocation;
        const newLoan = a.property.loanRemaining + a.allocation;
        const newLvr = (newLoan / a.property.currentValue) * 100;
        // LMI per-security on the new slice if individual LVR crosses 80%
        let lmiSlice = 0;
        if (newLvr > 80) {
          const est = estimateLMI({
            propertyValue: a.property.currentValue,
            depositAmount: a.property.currentValue - newLoan,
            loanAmount: newLoan,
            isFirstHomeBuyer: fhb,
          });
          lmiSlice = est.lmiAmount;
        }
        totalLmi += lmiSlice;
        // Servicing on the new slice — Phase I3: assessed @ buffered rate.
        const ratePct = a.property.interestRate ?? blendedRatePct;
        const assessRatePct = ratePct + (context.baseInputs.bufferRate ?? 3);
        totalIo += a.allocation * (assessRatePct / 100 / 12);
        const matchedHeadroom = headroom.find(h => h.property.id === a.property.id);
        const capPctNote = matchedHeadroom ? ` cap ${(matchedHeadroom.capPct * 100).toFixed(0)}%` : '';
        securityNotes.push(
          `${a.property.address?.slice(0, 25) || 'property'}: +$${Math.round(a.allocation).toLocaleString('en-AU')} (LVR → ${newLvr.toFixed(1)}%${lmiSlice > 0 ? `, LMI $${Math.round(lmiSlice).toLocaleString('en-AU')}` : ''}${capPctNote})`
        );
      }

      const netPool = Math.max(0, totalGross - totalLmi);

      effect.commitmentAdjustment = Math.max(0, totalIo);
      effect.debtBalanceAdjustment = totalGross;
      effect.releasedCapital = netPool;

      const blendedNow = totalValue > 0 ? (totalDebt / totalValue) * 100 : 0;
      const blendedAfter = totalValue > 0 ? ((totalDebt + totalGross) / totalValue) * 100 : 0;
      effect.acquisitionNotes.push(
        `Cross-collat pool (${members.length} properties, ${allocationStrategy}): blended LVR ${blendedNow.toFixed(1)}% → ${blendedAfter.toFixed(1)}% (target ${(safeBlended * 100).toFixed(1)}%). Gross $${Math.round(totalGross).toLocaleString('en-AU')} − LMI $${Math.round(totalLmi).toLocaleString('en-AU')} = $${Math.round(netPool).toLocaleString('en-AU')} usable. Servicing +$${Math.round(totalIo).toLocaleString('en-AU')}/mo IO.`
      );
      for (const n of securityNotes) effect.acquisitionNotes.push(`  · ${n}`);
      if (cappedPool < grossPool) {
        const minCap = headroom.length ? Math.min(...headroom.map(h => h.capPct)) : 0.95;
        effect.acquisitionNotes.push(
          `  · ⚠ Pool capped at $${Math.round(cappedPool).toLocaleString('en-AU')} (target wanted $${Math.round(grossPool).toLocaleString('en-AU')}, lender per-security caps min ${(minCap * 100).toFixed(0)}% — see I7 cap matrix).`
        );
      }
      effect.description = `Cross-collat release pool @ ${(safeBlended * 100).toFixed(0)}% blended LVR`;
      break;
    }
  }
  return effect;
}

// ============================================
// ACQUISITION CAPACITY HELPER (Phase C)
// ============================================

/** Iteratively solve for the maximum purchase price given:
 *   - serviceable loan capacity (post-deltas)
 *   - cash available (released equity + cash on hand)
 *   - LMI mode (none / display_deduction / debt_capitalised)
 *   - state stamp duty + acquisition costs
 *
 *  In `display_deduction` mode the loan stays at `borrowingCapacity` and LMI
 *  is netted from the cash side. In `debt_capitalised` mode the loan absorbs
 *  the LMI premium, so available principal for the property = capacity − LMI.
 */
export function computeAcquisitionCapacity(
  borrowingCapacity: number,
  context: ScenarioContext,
  effect: DeltaEffect,
): AcquisitionCapacity {
  const acq = context.acquisition || {};
  const lmiMode = acq.lmiMode ?? 'display_deduction';
  const state = acq.state ?? 'NSW';
  const intent = acq.intent ?? 'investor';
  const category = acq.category ?? 'established';
  const isFhb = !!acq.isFirstHomeBuyer;
  const isForeign = !!acq.isForeignBuyer;
  const cashOnHand = Math.max(0, acq.cashOnHand ?? 0);

  const cashAvailable = cashOnHand + Math.max(0, effect.releasedCapital);
  const notes = [...effect.acquisitionNotes];

  // ── Phase I9 — Wire I7 LVR cap matrix into the acquisition ceiling.
  // The acquisition loan must respect the lender's per-security cap for
  // intent (OO vs INV) and property kind (established / OTP / land /
  // construction etc.). Previously implicit via the LMI estimator; now
  // binds explicitly so investors aren't approved for OO-only LVRs.
  const acqIntent = intent === 'owner_occupier' ? 'owner_occupier' : 'investment';
  const acqKind = category === 'vacant_land' ? 'vacant_land'
    : category === 'new' ? 'new_build'
    : 'established';
  const lvrCapResult = resolveLvrCap({
    lenderId: context.currentLenderProfileId,
    intent: acqIntent,
    kind: acqKind,
    isFirstHomeBuyer: isFhb,
    isForeignBuyer: isForeign,
  });
  const acquisitionLvrCap = lvrCapResult.cap;

  if (borrowingCapacity <= 0 && cashAvailable <= 0) {
    return {
      releasedCapital: effect.releasedCapital,
      lmi: 0, lmiMode, stampDuty: 0, otherAcquisitionCosts: 0,
      maxPurchasePrice: 0, loanAvailableForPurchase: 0, cashAvailable, notes,
      acquisitionLvrCap, loanCappedByLvr: false,
    };
  }

  // Phase I15 — Aitken Δ² accelerated fix-point convergence.
  // The map P → newPrice(P) couples stamp duty (piecewise-linear in P), LMI
  // (piecewise in LVR × loan), and other costs. The prior fixed 6-iteration
  // loop oscillated by ±$1–3k near LVR/SD breakpoints in `debt_capitalised`
  // mode (because LMI feeds back into loan, which feeds back into LMI).
  // Aitken acceleration extrapolates from three successive iterates
  // (P0, P1, P2) to the fix-point limit, collapsing oscillations in 2–3
  // outer steps. We fall back to plain iteration when the denominator is
  // near zero (already converged) or when the accelerator overshoots.
  let purchasePrice = borrowingCapacity + cashAvailable;
  let lmi = 0;
  let stampDuty = 0;
  let otherCosts = 0;
  let loanAvail = borrowingCapacity;
  let loanCappedByLvr = false;

  const stepFn = (P: number): number => {
    const sdResult = calculateStampDuty({
      propertyValue: P,
      state, intent, category,
      isFirstHomeBuyer: isFhb,
      isForeignBuyer: isForeign,
    });
    stampDuty = sdResult.totalDuty;
    otherCosts = estimateOtherAcquisitionCosts(P).total;
    // The deposit is what survives the settlement costs — duty and legals are
    // paid from the same cash, and counting them as deposit understates the
    // LVR and so the premium. Measured against a bisection of the (now
    // correct) target path on this module's fixture, `cashAvailable` here put
    // the ceiling $21,943 high at $60,000 cash and $6,676 high at $30,000;
    // netting the costs closes both. Where no LMI is charged the loop was
    // already exact ($26 on a $429,540 ceiling), which is what identifies
    // this argument as the term at fault.
    const depositAtP = Math.max(0, cashAvailable - stampDuty - otherCosts);
    const requiredLoan = Math.max(0, P + stampDuty + otherCosts - cashAvailable);
    const lvrCapDollar = Math.max(0, P * acquisitionLvrCap);
    const cappedLoan = Math.min(borrowingCapacity, requiredLoan, lvrCapDollar);
    if (lvrCapDollar < Math.min(borrowingCapacity, requiredLoan)) {
      loanCappedByLvr = true;
    }
    if (lmiMode !== 'none') {
      const est = estimateLMI({
        propertyValue: P,
        depositAmount: depositAtP,
        loanAmount: cappedLoan,
        isFirstHomeBuyer: isFhb,
      });
      lmi = est.lmiAmount;
    } else {
      lmi = 0;
    }
    loanAvail = lmiMode === 'debt_capitalised'
      ? Math.max(0, Math.min(borrowingCapacity, lvrCapDollar) - lmi)
      : Math.min(borrowingCapacity, lvrCapDollar);
    const lmiCashDeduction = lmiMode === 'display_deduction' ? lmi : 0;
    return Math.max(0, loanAvail + cashAvailable - lmiCashDeduction - stampDuty - otherCosts);
  };

  for (let i = 0; i < 5; i++) {
    const P0 = purchasePrice;
    const P1 = stepFn(P0);
    if (Math.abs(P1 - P0) < 250) { purchasePrice = P1; break; }
    const P2 = stepFn(P1);
    if (Math.abs(P2 - P1) < 250) { purchasePrice = P2; break; }
    const denom = P2 - 2 * P1 + P0;
    const Pstar = Math.abs(denom) > 1
      ? P0 - ((P1 - P0) * (P1 - P0)) / denom
      : P2;
    // Damp pathological accelerator outputs back to the last iterate.
    purchasePrice = (Pstar > 0 && Pstar < P2 * 2) ? Pstar : P2;
    if (Math.abs(purchasePrice - P2) < 250) break;
  }
  // Final settle-pass refreshes stampDuty/lmi/loanAvail at the converged price.
  purchasePrice = stepFn(purchasePrice);

  if (lmi > 0) notes.push(`LMI ${lmiMode === 'debt_capitalised' ? 'capitalised onto loan' : 'deducted from settlement cash'}: $${Math.round(lmi).toLocaleString('en-AU')}`);
  if (stampDuty > 0) notes.push(`${state} stamp duty: $${Math.round(stampDuty).toLocaleString('en-AU')} (${intent}${isFhb ? ', FHB' : ''})`);
  if (otherCosts > 0) notes.push(`Acquisition costs (legals, inspections, registrations): $${Math.round(otherCosts).toLocaleString('en-AU')}`);
  // Phase I9 — surface the binding LVR cap so the PDF + UI can show
  // "max LVR for this security: 90%" alongside the dollar release.
  notes.push(`Acquisition LVR cap (${lvrCapResult.matrix.lenderId}, ${acqIntent}, ${acqKind}): ${(acquisitionLvrCap * 100).toFixed(0)}% — ${lvrCapResult.reason}`);
  if (loanCappedByLvr) {
    notes.push(`⚠ Acquisition loan clamped by LVR cap — serviceable capacity exceeded the ${(acquisitionLvrCap * 100).toFixed(0)}% per-security ceiling.`);
  }

  // ── Phase F2 — Target solving + actual loan-required + net cash ──
  // The Strategy Builder needs a clear "achievable / short by $X" answer
  // when finance has a target purchase price (e.g. $700k).
  const target = acq.targetPurchasePrice && acq.targetPurchasePrice > 0
    ? acq.targetPurchasePrice
    : undefined;

  // Loan REQUIRED for the *target* price (or for the max if no target set):
  // = price − cashAvailable + LMI(display) + stampDuty + otherCosts
  // For the target case we recompute LMI/SD against the target price for honesty.
  let loanRequiredForPurchase: number | undefined;
  let netCashAfterSettlement: number | undefined;
  let meetsTarget: boolean | undefined;
  let shortfallToTarget: number | undefined;

  if (target !== undefined) {
    const sdTarget = calculateStampDuty({
      propertyValue: target,
      state, intent, category,
      isFirstHomeBuyer: isFhb,
      isForeignBuyer: isForeign,
    }).totalDuty;
    const otherTarget = estimateOtherAcquisitionCosts(target).total;

    // The loan funds whatever the buyer's cash cannot — the price AND the
    // costs of settling it.
    //
    // This read `target - cashAvailable`, which spends the whole deposit on
    // the price and leaves duty, legals and any cash LMI unfunded. That is
    // not a conservative reading, it is an arithmetic one: it makes
    // `netCashAfterSettlement` equal to −(duty + costs) for EVERY leveraged
    // target, so `meetsTarget` could only ever be true for a purchase the
    // buyer could make outright. Swept against this module's own fixture
    // (capacity $458,414, cash $150,000, max price $584,399) it answered
    // "NOT met" from $150,000 upwards — including $400,000, $184,000 BELOW
    // the ceiling it reports in the same object — and printed the tell in
    // its own note: "short by $0 (loan gap $0, cash gap $15,717)". A target
    // that is short by nothing was met.
    //
    // `maxPurchasePrice` above never had the fault: `stepFn` returns
    // `loanAvail + cashAvailable − lmiCash − stampDuty − otherCosts`, which
    // is this same funds-to-complete identity. The two halves of one
    // function disagreed about what a deposit has to cover, and only the
    // half with a target to check was wrong.
    //
    // LMI depends on the loan and the loan now depends on LMI, so settle it:
    // three passes, the same fix-point the ceiling loop above runs, and the
    // premium is piecewise-flat in LVR so it converges immediately in
    // practice.
    const lvrCapDollarTarget = Math.max(0, target * acquisitionLvrCap);
    let lmiAtTarget = 0;
    let lmiCashAtTarget = 0;
    let requiredLoanRaw = Math.max(0, target + sdTarget + otherTarget - cashAvailable);
    let cappedRequiredLoan = Math.min(requiredLoanRaw, lvrCapDollarTarget);
    for (let i = 0; i < 3 && lmiMode !== 'none'; i++) {
      lmiAtTarget = estimateLMI({
        propertyValue: target,
        depositAmount: Math.max(0, cashAvailable - sdTarget - otherTarget),
        loanAmount: cappedRequiredLoan,
        isFirstHomeBuyer: isFhb,
      }).lmiAmount;
      lmiCashAtTarget = lmiMode === 'display_deduction' ? lmiAtTarget : 0;
      // A capitalised premium is drawn against the same security, so it
      // consumes the LVR ceiling rather than sitting on top of it — which is
      // what the maxPurchasePrice loop above has always assumed
      // (`min(capacity, lvrCapDollar) − lmi`). Leaving the target path to
      // capitalise above the cap made the two halves disagree by $41,880 on
      // the $60,000-cash fixture: the target said a price was reachable that
      // the ceiling in the same object placed out of reach. Bounded
      // capitalisation above a base cap is real lender practice, but nothing
      // in this module carries an "LVR inclusive of LMI" limit to bound it
      // with, and an unbounded one is the permissive reading of a figure the
      // rest of this engine assesses conservatively.
      const lvrHeadroom = lmiMode === 'debt_capitalised'
        ? Math.max(0, lvrCapDollarTarget - lmiAtTarget)
        : lvrCapDollarTarget;
      const nextRaw = Math.max(0, target + sdTarget + otherTarget + lmiCashAtTarget - cashAvailable);
      const nextCapped = Math.min(nextRaw, lvrHeadroom);
      const settled = Math.abs(nextCapped - cappedRequiredLoan) < 1;
      requiredLoanRaw = nextRaw;
      cappedRequiredLoan = nextCapped;
      if (settled) break;
    }
    // Everything settlement has to fund, from cash and loan together.
    const fundsToComplete = target + sdTarget + otherTarget + lmiCashAtTarget;
    loanRequiredForPurchase = lmiMode === 'debt_capitalised'
      ? cappedRequiredLoan + lmiAtTarget
      : cappedRequiredLoan;

    // Capitalised LMI is drawn onto the loan but funds none of the purchase,
    // so the cash test uses the purchase portion alone.
    netCashAfterSettlement = cashAvailable + cappedRequiredLoan - fundsToComplete;
    meetsTarget = (loanRequiredForPurchase ?? 0) <= borrowingCapacity
      && cappedRequiredLoan >= requiredLoanRaw  // LVR cap doesn't bind
      && netCashAfterSettlement >= 0;
    shortfallToTarget = Math.max(0, target - Math.max(0, purchasePrice));

    if (cappedRequiredLoan < requiredLoanRaw) {
      loanCappedByLvr = true;
      notes.push(`⚠ Target $${Math.round(target).toLocaleString('en-AU')} requires loan > LVR cap (${(acquisitionLvrCap * 100).toFixed(0)}% × $${Math.round(target).toLocaleString('en-AU')} = $${Math.round(lvrCapDollarTarget).toLocaleString('en-AU')}). Increase deposit by $${Math.round(requiredLoanRaw - cappedRequiredLoan).toLocaleString('en-AU')} to settle.`);
    }
    if (meetsTarget) {
      notes.push(
        `✅ Target $${Math.round(target).toLocaleString('en-AU')} achievable: needs loan $${Math.round(loanRequiredForPurchase).toLocaleString('en-AU')} (capacity $${Math.round(borrowingCapacity).toLocaleString('en-AU')}); net cash post-settlement $${Math.round(netCashAfterSettlement).toLocaleString('en-AU')}.`
      );
    } else {
      const loanShort = Math.max(0, (loanRequiredForPurchase ?? 0) - borrowingCapacity);
      const cashShort = Math.max(0, -netCashAfterSettlement);
      const lvrShort = Math.max(0, requiredLoanRaw - cappedRequiredLoan);
      // Name the constraint that actually binds. The price gap alone said
      // "short by $0" whenever a non-price constraint was the blocker, which
      // reads as a contradiction of the ❌ in front of it.
      const binding = [
        loanShort > 0 ? `serviceable capacity short $${Math.round(loanShort).toLocaleString('en-AU')}` : null,
        lvrShort > 0 ? `LVR cap short $${Math.round(lvrShort).toLocaleString('en-AU')}` : null,
        cashShort > 0 ? `settlement cash short $${Math.round(cashShort).toLocaleString('en-AU')}` : null,
      ].filter(Boolean);
      notes.push(
        `❌ Target $${Math.round(target).toLocaleString('en-AU')} NOT met: ` +
        (binding.length > 0 ? binding.join('; ') : 'blocked by an acquisition constraint') +
        (shortfallToTarget > 0
          ? `. Ceiling is $${Math.round(Math.max(0, purchasePrice)).toLocaleString('en-AU')} — $${Math.round(shortfallToTarget).toLocaleString('en-AU')} below target.`
          : `. Total funds still reach $${Math.round(Math.max(0, purchasePrice)).toLocaleString('en-AU')}.`)
      );
    }
  } else {
    // No target — still report the loan that would actually be drawn for the
    // computed maxPurchasePrice, so the UI can headline "Loan required" cleanly.
    loanRequiredForPurchase = Math.max(0, Math.max(0, purchasePrice) - cashAvailable);
    netCashAfterSettlement = 0; // by construction at the ceiling
  }

  return {
    releasedCapital: Math.round(effect.releasedCapital),
    lmi: Math.round(lmi),
    lmiMode,
    stampDuty: Math.round(stampDuty),
    otherAcquisitionCosts: Math.round(otherCosts),
    maxPurchasePrice: Math.round(Math.max(0, purchasePrice)),
    loanAvailableForPurchase: Math.round(loanAvail),
    loanRequiredForPurchase: loanRequiredForPurchase !== undefined ? Math.round(loanRequiredForPurchase) : undefined,
    netCashAfterSettlement: netCashAfterSettlement !== undefined ? Math.round(netCashAfterSettlement) : undefined,
    cashAvailable: Math.round(cashAvailable),
    targetPurchasePrice: target !== undefined ? Math.round(target) : undefined,
    meetsTarget,
    shortfallToTarget: shortfallToTarget !== undefined ? Math.round(shortfallToTarget) : undefined,
    acquisitionLvrCap,
    loanCappedByLvr,
    notes,
  };
}

// ============================================
// CORE ENGINE
// ============================================

/** Phase G1 — Order-aware delta sort. `property_value_change` deltas must
 *  resolve BEFORE any other property-bound delta in the same run, since they
 *  mutate the resolved property record (currentValue) that downstream
 *  equity_release / portfolio_lvr_release / property_refinance / property_sell
 *  deltas read from. Stable for everything else. */
function orderDeltas(deltas: ScenarioDelta[]): ScenarioDelta[] {
  const valueChanges: ScenarioDelta[] = [];
  const others: ScenarioDelta[] = [];
  for (const d of deltas) {
    if (d.type === 'property_value_change') valueChanges.push(d);
    else others.push(d);
  }
  return [...valueChanges, ...others];
}

/** Phase G1 — Deep-clone the property records so in-place mutations from
 *  `property_value_change` are scenario-scoped and never leak back into the
 *  caller's portfolio. Liabilities & acquisition pass through untouched. */
function cloneContextForRun(context: ScenarioContext): ScenarioContext {
  return {
    ...context,
    properties: (context.properties || []).map(p => ({ ...p })),
  };
}

/** Phase I10 — Split scenario debt-balance moves into:
 *    - releasedCapitalDebt: NEW debt added by equity-release / pool-release
 *    - debtRemovedByScenario: EXISTING debt removed by sells / liability payoffs
 *  Used to power `computeDtiNumerator` so the engine reports an honest DTI
 *  ratio that includes new shadow-debt and credits sells/payoffs (rather
 *  than netting them inside `debtBalanceAdjustment` and losing the audit
 *  trail). Does NOT alter `debtBalanceAdjustment` math itself. */
function splitDebtMoves(
  safeDeltas: ScenarioDelta[],
  context: ScenarioContext,
): { releasedCapitalDebt: number; debtRemovedByScenario: number } {
  let released = 0;
  let removed = 0;
  for (const d of safeDeltas) {
    if (d.type === 'equity_release') {
      const property = context.properties?.find(p => p.id === d.id);
      if (!property || property.currentValue <= 0) continue;
      const intentForCap = inferPropertyIntent(property.propertyType, 'investment');
      const kindForCap = inferPropertyKind(property.propertyType);
      const lvr = resolveLvrCap({
        lenderId: context.currentLenderProfileId,
        intent: intentForCap,
        kind: kindForCap,
        isFirstHomeBuyer: !!context.acquisition?.isFirstHomeBuyer,
        isForeignBuyer: !!context.acquisition?.isForeignBuyer,
        explicitCap: d.meta?.lenderMaxLVR as number | undefined,
      });
      // Phase I14 — clamp the requested target by the resolved cap BEFORE
      // multiplying by currentValue. Previously we clamped after — when the
      // requested LVR exceeded the policy cap (e.g. 95% INV → resolved 90%),
      // splitDebtMoves attributed extra "new debt" to DTI that applyDelta
      // never actually released, opening a parity gap with the cap path.
      let targetLvr: number;
      if (d.unit === 'absolute') {
        targetLvr = (property.loanRemaining + Math.max(0, d.value)) / property.currentValue;
      } else if (d.unit === 'percent') {
        targetLvr = d.value / 100;
      } else {
        targetLvr = d.value;
      }
      const clamped = Math.max(0, Math.min(lvr.cap, targetLvr));
      const grossRelease = Math.max(0, (clamped * property.currentValue) - property.loanRemaining);
      released += grossRelease;
    } else if (d.type === 'portfolio_lvr_release') {
      const target = d.unit === 'percent' ? d.value / 100 : d.value;
      const ids = (d.meta?.propertyIds as string[] | undefined) || [];
      const members = (context.properties || []).filter(p => ids.includes(p.id));
      const totalValue = members.reduce((s, p) => s + (p.currentValue || 0), 0);
      const totalDebt = members.reduce((s, p) => s + (p.loanRemaining || 0), 0);
      // Phase I14 — bound pool target by per-security headroom to mirror
      // applyDelta's cappedPool. Otherwise DTI numerator can include debt
      // that the per-security caps actually denied.
      const headroomTotal = members.reduce((s, p) => {
        const cap = resolveLvrCap({
          lenderId: context.currentLenderProfileId,
          intent: inferPropertyIntent(p.propertyType, 'investment'),
          kind: inferPropertyKind(p.propertyType),
          isFirstHomeBuyer: !!context.acquisition?.isFirstHomeBuyer,
          isForeignBuyer: !!context.acquisition?.isForeignBuyer,
          explicitCap: d.meta?.lenderMaxLVR as number | undefined,
        });
        return s + Math.max(0, p.currentValue * cap.cap - p.loanRemaining);
      }, 0);
      const grossPool = Math.min(
        Math.max(0, target * totalValue - totalDebt),
        headroomTotal,
      );
      released += grossPool;
    } else if (d.type === 'property_sell') {
      const p = context.properties?.find(x => x.id === d.id);
      if (p && p.loanRemaining > 0) removed += p.loanRemaining;
    } else if (d.type === 'liability_payoff') {
      const l = context.liabilities?.find(x => x.id === d.id);
      if (l) removed += Math.max(0, l.balance || 0);
    }
  }
  return { releasedCapitalDebt: released, debtRemovedByScenario: removed };
}

// ── Phase K1: Capital Allocation Ledger integration ────────────────────
function sourceTypeForDelta(d: ScenarioDelta): CapitalSourceType | null {
  switch (d.type) {
    case 'equity_release': return 'equity_release';
    case 'portfolio_lvr_release': return 'portfolio_lvr_release';
    case 'property_sell': return 'property_sell';
    default: return null;
  }
}

/** Apply the K1 capital ledger to the running totals.
 *  - Re-runs source deltas in isolation on a sandboxed clone to attribute
 *    per-delta `releasedCapital` (sells don't emit one — derive from equity)
 *  - Builds the ledger via buildCapitalLedger
 *  - Folds sink effects into commitmentAdjustment + debtBalanceAdjustment
 *  - Subtracts non-deposit allocations from releasedCapital so the residual
 *    reflects only what's left for the next-purchase deposit pool. */
function applyCapitalLedger(
  total: DeltaEffect,
  safeDeltas: ScenarioDelta[],
  ctx: ScenarioContext,
): { ledger: CapitalLedger; sinkDepositContribution: number; issues: ReturnType<typeof buildCapitalLedger>['issues'] } {
  const sourceContribs: LedgerContext['sourceContributions'] = [];
  for (const d of safeDeltas) {
    const st = sourceTypeForDelta(d);
    if (!st) continue;
    if (st === 'property_sell') {
      const p = ctx.properties?.find(x => x.id === d.id);
      const equity = p ? Math.max(0, (p.currentValue || 0) - (p.loanRemaining || 0)) : 0;
      if (equity > 0) {
        sourceContribs.push({
          deltaId: d.id, sourceType: 'property_sell',
          label: `Sell ${p?.address?.slice(0, 28) || 'property'}`,
          amount: equity,
        });
      }
      continue;
    }
    const sandbox = cloneContextForRun(ctx);
    const eff = applyDelta(d, sandbox);
    const amount = Math.max(0, eff.releasedCapital);
    if (amount > 0) {
      sourceContribs.push({
        deltaId: d.id, sourceType: st,
        label: d.label || (st === 'equity_release' ? 'Equity release' : 'Pool release'),
        amount,
      });
    }
  }

  const ledgerCtx: LedgerContext = {
    properties: (ctx.properties || []).map(p => ({
      id: p.id,
      address: p.address,
      propertyType: p.propertyType,
      currentValue: p.currentValue,
      loanRemaining: p.loanRemaining,
      monthlyRepayment: p.monthlyRepayment,
      loanRepaymentAmount: p.loanRepaymentAmount,
      interestRate: p.interestRate,
    })),
    liabilities: (ctx.liabilities || []).map(l => ({
      id: l.id, label: l.label, type: l.type,
      balance: l.balance, monthlyServicing: l.monthlyServicing,
    })),
    cashOnHand: ctx.acquisition?.cashOnHand ?? 0,
    sourceContributions: sourceContribs,
  };
  const { ledger, sinkAggregate, issues } = buildCapitalLedger(safeDeltas, ledgerCtx);

  // Fold sink aggregates into running totals
  total.commitmentAdjustment += sinkAggregate.monthlyServicingDelta;
  total.debtBalanceAdjustment += sinkAggregate.debtBalanceDelta;
  if (sinkAggregate.notes.length) total.acquisitionNotes.push(...sinkAggregate.notes);

  // Subtract non-deposit allocations from the residual deposit pool
  let totalAllocated = 0;
  for (const poolId of Object.keys(ledger.pools)) {
    totalAllocated += ledger.pools[poolId].totalOut;
  }
  const consumedByNonDeposit = Math.max(0, totalAllocated - sinkAggregate.depositContribution);
  total.releasedCapital = Math.max(0, total.releasedCapital - consumedByNonDeposit);

  return { ledger, sinkDepositContribution: sinkAggregate.depositContribution, issues };
}

/** Investment properties, by the predicate both scenario paths share. */
function investmentPropertiesOf(ctx: ScenarioContext): ScenarioProperty[] {
  return (ctx.properties || []).filter(p => {
    const t = (p.propertyType || '').toLowerCase();
    return t.includes('invest') || t.includes('rental') || t === 'investment';
  });
}

/** The Phase I6/I12 add-back for this position assessed at a given income. */
function negativeGearingAddBackAt(ctx: ScenarioContext, grossAnnualIncome: number) {
  return computeNegativeGearingAddBack({
    investmentProperties: investmentPropertiesOf(ctx),
    marginalTaxRate: marginalTaxRateFor(grossAnnualIncome),
    addBackShading: 1.0,
    bufferRatePct: ctx.baseInputs.bufferRate ?? 3,
  });
}

/**
 * How much of the negative-gearing add-back the SCENARIO is responsible for.
 *
 * The add-back is a property of the position, not of the deltas — the base
 * position is negatively geared whether or not anybody models a change, and a
 * lender assessing it today would add the tax saving back today. But
 * `ctx.baseResult` is supplied by the caller from `ctx.baseInputs` alone and
 * cannot include an add-back the engine computes internally, and every
 * consumer subtracts the two figures directly: the headline
 * (`StrategyScenarioModeling.tsx:1213`), the per-lever attribution
 * (`:985`, `isolated.result.borrowingCapacity - baseResult.borrowingCapacity`)
 * and `capacityChange` here.
 *
 * Applying the gross add-back therefore reported it as a scenario gain. A
 * scenario with NO deltas measured +$1,481 of capacity on the fixture in
 * `scenarioDeltaEngine.test.ts`, and every isolated lever's attributed impact
 * carried the same phantom uplift on top of what the lever actually did. The
 * UI had already met the headline case and papered over it with a baseline
 * guard that force-collapses to `baseResult` when `deltas.length === 0`
 * (`:861-869` — "a phantom Scenario Borrowing Capacity = base + base"); that
 * guard cannot see the per-lever column, which is where the error survived.
 *
 * Netting against the base keeps the part of the add-back the deltas really
 * buy. `marginalTaxRateFor` is the only term a delta moves — the properties
 * are read from `ctx` unchanged on both paths — so an income change that
 * crosses a bracket still shows up, as the EXTRA add-back it earns rather than
 * as the whole of it. The note is raised on the same condition, because an
 * add-back that nets to nothing has not moved the figure it would claim to
 * explain.
 */
function negativeGearingChange(
  ctx: ScenarioContext,
  scenarioGrossAnnualIncome: number,
): { net: number; notes: string[] } {
  const scenario = negativeGearingAddBackAt(ctx, scenarioGrossAnnualIncome);
  const base = negativeGearingAddBackAt(ctx, ctx.baseInputs.grossAnnualIncome);
  const net = scenario.annualAddBack - base.annualAddBack;
  if (net === 0) return { net: 0, notes: [] };
  return {
    net,
    notes: [
      `Negative-gearing add-back moves $${Math.abs(net).toLocaleString('en-AU')}/yr ` +
      `${net > 0 ? 'up' : 'down'} under this scenario ` +
      `($${base.annualAddBack.toLocaleString('en-AU')} → $${scenario.annualAddBack.toLocaleString('en-AU')}/yr) — ` +
      `the assessed marginal rate changed from ` +
      `${(marginalTaxRateFor(ctx.baseInputs.grossAnnualIncome) * 100).toFixed(1)}% to ` +
      `${(marginalTaxRateFor(scenarioGrossAnnualIncome) * 100).toFixed(1)}%. ` +
      `Only the change is applied; the base position already carries ` +
      `$${base.annualAddBack.toLocaleString('en-AU')}/yr.`,
      ...scenario.notes,
    ],
  };
}

export function runScenario(
  scenarioName: string,
  deltas: ScenarioDelta[],
  context: ScenarioContext,
): ScenarioCapacityResult {
  const total = emptyEffect(scenarioName);
  const ctx = cloneContextForRun(context);
  // Phase K1 — separate capital_allocation sinks from the main applyDelta loop;
  // they are folded in via applyCapitalLedger after sources are summed.
  const nonAlloc = deltas.filter(d => d.type !== 'capital_allocation');
  const allocDeltas = deltas.filter(d => d.type === 'capital_allocation');
  const ordered = orderDeltas(nonAlloc);

  for (const d of ordered) {
    const e = applyDelta(d, ctx);
    total.incomeAdjustment += e.incomeAdjustment;
    total.shadedIncomeAdjustment += e.shadedIncomeAdjustment;
    total.expenseAdjustment += e.expenseAdjustment;
    total.commitmentAdjustment += e.commitmentAdjustment;
    total.rateAdjustment += e.rateAdjustment;
    total.loanTermAdjustment += e.loanTermAdjustment;
    total.debtBalanceAdjustment += e.debtBalanceAdjustment;
    total.releasedCapital += e.releasedCapital;
    if (e.acquisitionNotes.length) total.acquisitionNotes.push(...e.acquisitionNotes);
    if (e.dtiCapEnabled !== undefined) total.dtiCapEnabled = e.dtiCapEnabled;
    if (e.dtiCapLimit !== undefined) total.dtiCapLimit = e.dtiCapLimit;
  }

  // Phase K1 — Build & apply capital allocation ledger (sinks consume sources)
  const k1 = applyCapitalLedger(total, [...nonAlloc, ...allocDeltas], ctx);
  const capitalLedger = k1.ledger;
  const ledgerIssues = k1.issues;

  // Phase E (M3): rescale HEM-derived expenses for the new income tier
  const newGross = Math.max(0, ctx.baseInputs.grossAnnualIncome + total.incomeAdjustment);
  const hemDelta = computeHemTierDelta(
    ctx.baseInputs.grossAnnualIncome,
    newGross,
    ctx.baseInputs.monthlyLivingExpenses,
  );

  // Phase I1 — lender-aware re-shading
  const baseProfileId = ctx.currentLenderProfileId ?? BANK_STANDARD_PROFILE.id;
  const targetProfileId = total.lenderProfileOverride ?? baseProfileId;
  let computedShadedAnnual: number;
  if (
    total.lenderProfileOverride &&
    targetProfileId !== baseProfileId &&
    Array.isArray(ctx.incomeComponents) &&
    ctx.incomeComponents.length > 0
  ) {
    const targetProfile = resolveLenderProfile(targetProfileId);
    const grossScale = ctx.baseInputs.grossAnnualIncome > 0
      ? newGross / ctx.baseInputs.grossAnnualIncome : 1;
    const scaled: ScenarioIncomeComponent[] = ctx.incomeComponents.map(c => ({
      ...c,
      grossAnnual: Math.max(0, c.grossAnnual * grossScale),
    }));
    computedShadedAnnual = reshadeIncome(scaled, targetProfile).shadedAnnual;
  } else {
    computedShadedAnnual = Math.max(0, ctx.baseInputs.shadedAnnualIncome + total.shadedIncomeAdjustment);
  }

  // Phase I6/I12 — Negative-gearing add-back. After deltas, identify investment
  // properties that are negatively geared and add back the tax saving at the
  // post-delta marginal rate. Skips PPRs and properties with non-negative
  // cashflow. Phase I12: cash loss is recomputed using the BUFFERED assessment
  // rate (contracted + APRA buffer) so the add-back tracks the loss the lender
  // assesses, not the cheaper contracted-rate cash position. Conservative —
  // uses cash-basis (no depreciation).
  //
  // Only the CHANGE against the base position is applied — see
  // `negativeGearingChange`.
  const ngChange = negativeGearingChange(ctx, newGross);
  if (ngChange.net !== 0) {
    computedShadedAnnual = Math.max(0, computedShadedAnnual + ngChange.net);
    total.acquisitionNotes.push(...ngChange.notes);
  }

  // Phase I8/I11 — DTI denominator refinement: when typed components are present,
  // compute an APRA-aligned DTI-adjusted income (rental at 75%, FTB at 50%, etc.).
  // Phase I11 binds this into `calculateBorrowingCapacity` so the cap PATH itself
  // uses the conservative denominator, not just the broker-facing warning.
  let dtiAdjustedIncome: number | undefined;
  if (Array.isArray(ctx.incomeComponents) && ctx.incomeComponents.length > 0) {
    const grossScale = ctx.baseInputs.grossAnnualIncome > 0
      ? newGross / ctx.baseInputs.grossAnnualIncome : 1;
    const scaledForDti = ctx.incomeComponents.map(c => ({ ...c, grossAnnual: Math.max(0, c.grossAnnual * grossScale) }));
    const dtiDen = computeDtiDenominator({ incomeComponents: scaledForDti, fallbackGrossAnnual: newGross });
    dtiAdjustedIncome = dtiDen.dtiAdjustedAnnualIncome;
    if (dtiDen.dtiAdjustedAnnualIncome < newGross * 0.95 && dtiDen.dtiAdjustedAnnualIncome > 0) {
      total.acquisitionNotes.push(
        `DTI denominator (APS 220-aligned): $${Math.round(dtiDen.dtiAdjustedAnnualIncome).toLocaleString('en-AU')}/yr (${((dtiDen.dtiAdjustedAnnualIncome / newGross) * 100).toFixed(0)}% of gross). Bound into DTI cap path — capacity may be tighter than headline gross suggests.`
      );
    }
  }

  // Phase I2 — HEM hard floor
  const requestedExpenses = ctx.baseInputs.monthlyLivingExpenses + total.expenseAdjustment + hemDelta;
  const targetProfile = resolveLenderProfile(targetProfileId);
  const hemBenchmark = ctx.hemBenchmark ?? 0;
  const finalExpenses = (hemBenchmark > 0 && targetProfile.enforcesHemFloor)
    ? Math.max(hemBenchmark, Math.max(0, requestedExpenses))
    : Math.max(0, requestedExpenses);

  const scenarioInputs: BorrowingCapacityInput = {
    ...ctx.baseInputs,
    grossAnnualIncome: newGross,
    shadedAnnualIncome: computedShadedAnnual,
    monthlyLivingExpenses: finalExpenses,
    monthlyCommitments: Math.max(0, ctx.baseInputs.monthlyCommitments + total.commitmentAdjustment),
    interestRate: Math.max(0.5, ctx.baseInputs.interestRate + total.rateAdjustment),
    loanTermYears: Math.max(5, ctx.baseInputs.loanTermYears + total.loanTermAdjustment),
    totalDebtBalances: Math.max(0, (ctx.baseInputs.totalDebtBalances || 0) + total.debtBalanceAdjustment),
    dtiCapEnabled: total.dtiCapEnabled ?? ctx.baseInputs.dtiCapEnabled,
    dtiCapLimit: total.dtiCapLimit ?? ctx.baseInputs.dtiCapLimit,
    // Phase I11 — APS 220-aligned DTI denominator binding
    dtiAdjustedAnnualIncome: dtiAdjustedIncome,
  };

  const scenarioResult = calculateBorrowingCapacity(scenarioInputs);
  const capacityChange = buildScenarioChange(ctx.baseResult.borrowingCapacity, scenarioResult.borrowingCapacity);

  const acquisitionCapacity = ctx.acquisition
    ? computeAcquisitionCapacity(scenarioResult.borrowingCapacity, ctx, total)
    : null;

  // Phase I10 — Honest DTI: split scenario debt moves into NEW debt
  // (equity-release / pool-release) and REMOVED debt (sells / payoffs),
  // then call computeDti with the post-delta gross income for clarity.
  // The legacy `scenarioResult.dtiRatio` continues to drive any DTI cap
  // logic in `calculateBorrowingCapacity`; this is the broker-facing
  // honest number with explicit accounting.
  const debtMoves = splitDebtMoves(deltas, ctx);
  // Add the proposed acquisition loan to the numerator so the DTI
  // reflects the FULL post-strategy commitment (including the new
  // purchase). When no acquisition context exists we pass 0.
  const proposedAcqLoan = acquisitionCapacity?.loanRequiredForPurchase ?? 0;
  const refinedDti = computeDti(
    {
      existingDebtBalances: Math.max(0, ctx.baseInputs.totalDebtBalances || 0),
      proposedLoanAmount: proposedAcqLoan,
      releasedCapitalDebt: debtMoves.releasedCapitalDebt,
      debtRemovedByScenario: debtMoves.debtRemovedByScenario,
    },
    {
      incomeComponents: Array.isArray(ctx.incomeComponents) && ctx.incomeComponents.length > 0
        ? ctx.incomeComponents.map(c => ({
            ...c,
            grossAnnual: Math.max(0, c.grossAnnual * (ctx.baseInputs.grossAnnualIncome > 0 ? newGross / ctx.baseInputs.grossAnnualIncome : 1)),
          }))
        : undefined,
      fallbackGrossAnnual: newGross,
    },
    ctx.baseInputs.dtiCapLimit,
  );
  if (refinedDti.exceedsApraTrigger || refinedDti.exceedsLenderCap) {
    total.acquisitionNotes.push(
      `⚠ Honest DTI ${refinedDti.dtiRatio.toFixed(2)}× (${refinedDti.exceedsApraTrigger ? 'exceeds APRA 6× review trigger' : ''}${refinedDti.exceedsApraTrigger && refinedDti.exceedsLenderCap ? '; ' : ''}${refinedDti.exceedsLenderCap ? `exceeds lender cap ${ctx.baseInputs.dtiCapLimit}×` : ''}). Numerator $${Math.round(refinedDti.numerator).toLocaleString('en-AU')} = existing $${Math.round(ctx.baseInputs.totalDebtBalances || 0).toLocaleString('en-AU')} + proposed $${Math.round(proposedAcqLoan).toLocaleString('en-AU')} + released $${Math.round(debtMoves.releasedCapitalDebt).toLocaleString('en-AU')} − removed $${Math.round(debtMoves.debtRemovedByScenario).toLocaleString('en-AU')}. Denominator $${Math.round(refinedDti.denominator).toLocaleString('en-AU')}.`
    );
  } else if (debtMoves.debtRemovedByScenario > 0 || debtMoves.releasedCapitalDebt > 0) {
    total.acquisitionNotes.push(
      `Honest DTI ${refinedDti.dtiRatio.toFixed(2)}× — numerator $${Math.round(refinedDti.numerator).toLocaleString('en-AU')} (released $${Math.round(debtMoves.releasedCapitalDebt).toLocaleString('en-AU')}, removed $${Math.round(debtMoves.debtRemovedByScenario).toLocaleString('en-AU')}).`
    );
  }

  return {
    scenarioName,
    deltas,
    borrowingCapacity: scenarioResult.borrowingCapacity,
    monthlySurplus: scenarioResult.monthlySurplus,
    serviceabilityBand: scenarioResult.serviceabilityBand,
    dtiRatio: scenarioResult.dtiRatio,
    assessmentRate: scenarioResult.assessmentRate,
    afterTaxAnnualIncome: scenarioResult.afterTaxAnnualIncome,
    monthlyAfterTaxIncome: scenarioResult.monthlyAfterTaxIncome,
    capacityChange,
    acquisitionCapacity,
    capitalLedger,
    validationIssues: ledgerIssues.length > 0 ? ledgerIssues : undefined,
  };
}

export function runMultipleScenarios(
  scenarios: { name: string; deltas: ScenarioDelta[] }[],
  context: ScenarioContext,
): ScenarioCapacityResult[] {
  return scenarios.map(s => runScenario(s.name, s.deltas, context));
}

/** Run a scenario AND return the merged inputs used. Useful when the caller
 *  needs to replay or persist exactly what the engine evaluated (e.g. the
 *  Strategy Builder's "Apply Scenario" handoff to the calculator). */
export function runScenarioWithInputs(
  scenarioName: string,
  deltas: ScenarioDelta[],
  context: ScenarioContext,
): { result: ScenarioCapacityResult; inputs: BorrowingCapacityInput; effect: DeltaEffect; issues: DeltaValidationIssue[] } {
  const issues = validateDeltas(deltas, context);
  // Drop deltas whose target IDs are missing — keeps the math honest
  const propertyIds = new Set((context.properties || []).map(p => p.id));
  const liabilityIds = new Set((context.liabilities || []).map(l => l.id));
  const safeDeltas = deltas.filter(d => {
    if (
      d.type === 'property_sell' ||
      d.type === 'property_refinance' ||
      d.type === 'equity_release' ||
      d.type === 'property_rate_change' ||
      d.type === 'property_value_change'
    ) return propertyIds.has(d.id);
    if (d.type === 'liability_payoff') return liabilityIds.has(d.id);
    // portfolio_lvr_release filters its own pool inside applyDelta — let it through
    return true;
  });

  // Phase G1 — clone context + sort property_value_change FIRST so downstream
  // property-bound deltas see the new valuations
  const ctx = cloneContextForRun(context);
  // Phase K1 — split capital_allocation sinks from main loop
  const safeNonAlloc = safeDeltas.filter(d => d.type !== 'capital_allocation');
  const safeAllocs = safeDeltas.filter(d => d.type === 'capital_allocation');
  const orderedSafe = orderDeltas(safeNonAlloc);

  const total = emptyEffect(scenarioName);
  for (const d of orderedSafe) {
    const e = applyDelta(d, ctx);
    total.incomeAdjustment += e.incomeAdjustment;
    total.shadedIncomeAdjustment += e.shadedIncomeAdjustment;
    total.expenseAdjustment += e.expenseAdjustment;
    total.commitmentAdjustment += e.commitmentAdjustment;
    total.rateAdjustment += e.rateAdjustment;
    total.loanTermAdjustment += e.loanTermAdjustment;
    total.debtBalanceAdjustment += e.debtBalanceAdjustment;
    total.releasedCapital += e.releasedCapital;
    if (e.acquisitionNotes.length) total.acquisitionNotes.push(...e.acquisitionNotes);
    if (e.dtiCapEnabled !== undefined) total.dtiCapEnabled = e.dtiCapEnabled;
    if (e.dtiCapLimit !== undefined) total.dtiCapLimit = e.dtiCapLimit;
  }

  // Phase K1 — apply capital allocation ledger
  const k1WI = applyCapitalLedger(total, [...safeNonAlloc, ...safeAllocs], ctx);
  const capitalLedgerWI = k1WI.ledger;
  for (const i of k1WI.issues) issues.push(i);

  // Phase E (M3): rescale HEM-derived expenses for the new income tier
  const newGross2 = Math.max(0, ctx.baseInputs.grossAnnualIncome + total.incomeAdjustment);
  const hemDelta2 = computeHemTierDelta(
    ctx.baseInputs.grossAnnualIncome,
    newGross2,
    ctx.baseInputs.monthlyLivingExpenses,
  );

  // Phase I1 — lender-aware re-shading parity with `runScenario`
  const baseProfileId2 = ctx.currentLenderProfileId ?? BANK_STANDARD_PROFILE.id;
  const targetProfileId2 = total.lenderProfileOverride ?? baseProfileId2;
  let computedShadedAnnual2: number;
  if (
    total.lenderProfileOverride &&
    targetProfileId2 !== baseProfileId2 &&
    Array.isArray(ctx.incomeComponents) &&
    ctx.incomeComponents.length > 0
  ) {
    const targetProfile2 = resolveLenderProfile(targetProfileId2);
    const grossScale = ctx.baseInputs.grossAnnualIncome > 0
      ? newGross2 / ctx.baseInputs.grossAnnualIncome : 1;
    const scaled: ScenarioIncomeComponent[] = ctx.incomeComponents.map(c => ({
      ...c,
      grossAnnual: Math.max(0, c.grossAnnual * grossScale),
    }));
    computedShadedAnnual2 = reshadeIncome(scaled, targetProfile2).shadedAnnual;
    issues.push({
      deltaId: 'dti-cap',
      deltaType: 'dti_cap_change',
      severity: 'warning',
      message: `Lender flipped to "${targetProfile2.displayName}" — income re-shaded to $${Math.round(computedShadedAnnual2).toLocaleString('en-AU')}/yr (was $${Math.round(ctx.baseInputs.shadedAnnualIncome).toLocaleString('en-AU')}). Confirm 2yr history before submission.`,
    });
  } else {
    computedShadedAnnual2 = Math.max(0, ctx.baseInputs.shadedAnnualIncome + total.shadedIncomeAdjustment);
  }

  // Phase I6/I12 — Negative-gearing add-back (parity with runScenario, buffered).
  // Net of the base position's own add-back — see `negativeGearingChange`.
  const ng2 = negativeGearingChange(ctx, newGross2);
  if (ng2.net !== 0) {
    computedShadedAnnual2 = Math.max(0, computedShadedAnnual2 + ng2.net);
    total.acquisitionNotes.push(...ng2.notes);
    issues.push({
      deltaId: 'negative-gearing',
      deltaType: 'income_change',
      severity: 'warning',
      message: ng2.notes[0] ?? 'Negative-gearing add-back changed',
    });
  }

  // Phase I2 — HEM hard floor parity
  const requestedExp2 = ctx.baseInputs.monthlyLivingExpenses + total.expenseAdjustment + hemDelta2;
  const targetProfile2b = resolveLenderProfile(targetProfileId2);
  const hemBenchmark2 = ctx.hemBenchmark ?? 0;
  let finalExpenses2 = Math.max(0, requestedExp2);
  if (hemBenchmark2 > 0 && targetProfile2b.enforcesHemFloor && finalExpenses2 < hemBenchmark2) {
    const expChange = orderedSafe.find(d => d.type === 'expense_change');
    issues.push({
      deltaId: expChange?.id ?? 'expense_change',
      deltaType: 'expense_change',
      severity: 'warning',
      message: `Expense reduction floored at HEM benchmark $${Math.round(hemBenchmark2).toLocaleString('en-AU')}/mo (requested $${Math.round(requestedExp2).toLocaleString('en-AU')}). Banks use MAX(declared, HEM).`,
    });
    finalExpenses2 = hemBenchmark2;
  }

  // Phase I8/I11 — DTI denominator refinement (binds into cap path)
  let dtiAdjustedIncome2: number | undefined;
  if (Array.isArray(ctx.incomeComponents) && ctx.incomeComponents.length > 0) {
    const grossScale = ctx.baseInputs.grossAnnualIncome > 0 ? newGross2 / ctx.baseInputs.grossAnnualIncome : 1;
    const scaledForDti = ctx.incomeComponents.map(c => ({ ...c, grossAnnual: Math.max(0, c.grossAnnual * grossScale) }));
    const dtiDen = computeDtiDenominator({ incomeComponents: scaledForDti, fallbackGrossAnnual: newGross2 });
    dtiAdjustedIncome2 = dtiDen.dtiAdjustedAnnualIncome;
    if (dtiDen.dtiAdjustedAnnualIncome < newGross2 * 0.95 && dtiDen.dtiAdjustedAnnualIncome > 0) {
      issues.push({
        deltaId: 'dti-denominator',
        deltaType: 'income_change',
        severity: 'warning',
        message: `DTI denominator (APS 220): $${Math.round(dtiDen.dtiAdjustedAnnualIncome).toLocaleString('en-AU')}/yr (${((dtiDen.dtiAdjustedAnnualIncome / newGross2) * 100).toFixed(0)}% of gross). Bound into cap path — capacity may be tighter than headline gross suggests.`,
      });
    }
  }

  const inputs: BorrowingCapacityInput = {
    ...ctx.baseInputs,
    grossAnnualIncome: newGross2,
    shadedAnnualIncome: computedShadedAnnual2,
    monthlyLivingExpenses: finalExpenses2,
    monthlyCommitments: Math.max(0, ctx.baseInputs.monthlyCommitments + total.commitmentAdjustment),
    interestRate: Math.max(0.5, ctx.baseInputs.interestRate + total.rateAdjustment),
    loanTermYears: Math.max(5, ctx.baseInputs.loanTermYears + total.loanTermAdjustment),
    totalDebtBalances: Math.max(0, (ctx.baseInputs.totalDebtBalances || 0) + total.debtBalanceAdjustment),
    dtiCapEnabled: total.dtiCapEnabled ?? ctx.baseInputs.dtiCapEnabled,
    dtiCapLimit: total.dtiCapLimit ?? ctx.baseInputs.dtiCapLimit,
    // Phase I11 — APS 220-aligned DTI denominator binding
    dtiAdjustedAnnualIncome: dtiAdjustedIncome2,
  };

  const calc = calculateBorrowingCapacity(inputs);
  const capacityChange = buildScenarioChange(ctx.baseResult.borrowingCapacity, calc.borrowingCapacity);
  const acquisitionCapacity = ctx.acquisition
    ? computeAcquisitionCapacity(calc.borrowingCapacity, ctx, total)
    : null;

  // Phase I10 — Honest DTI parity with runScenario
  const debtMoves2 = splitDebtMoves(safeDeltas, ctx);
  const proposedAcqLoan2 = acquisitionCapacity?.loanRequiredForPurchase ?? 0;
  const refinedDti2 = computeDti(
    {
      existingDebtBalances: Math.max(0, ctx.baseInputs.totalDebtBalances || 0),
      proposedLoanAmount: proposedAcqLoan2,
      releasedCapitalDebt: debtMoves2.releasedCapitalDebt,
      debtRemovedByScenario: debtMoves2.debtRemovedByScenario,
    },
    {
      incomeComponents: Array.isArray(ctx.incomeComponents) && ctx.incomeComponents.length > 0
        ? ctx.incomeComponents.map(c => ({
            ...c,
            grossAnnual: Math.max(0, c.grossAnnual * (ctx.baseInputs.grossAnnualIncome > 0 ? newGross2 / ctx.baseInputs.grossAnnualIncome : 1)),
          }))
        : undefined,
      fallbackGrossAnnual: newGross2,
    },
    ctx.baseInputs.dtiCapLimit,
  );
  if (refinedDti2.exceedsApraTrigger || refinedDti2.exceedsLenderCap) {
    issues.push({
      deltaId: 'dti-honest',
      deltaType: 'dti_cap_change',
      severity: 'warning',
      message: `Honest DTI ${refinedDti2.dtiRatio.toFixed(2)}× ${refinedDti2.exceedsApraTrigger ? '(>6× APRA trigger)' : ''}${refinedDti2.exceedsLenderCap ? ` (>lender cap ${ctx.baseInputs.dtiCapLimit}×)` : ''}. Numerator $${Math.round(refinedDti2.numerator).toLocaleString('en-AU')} (existing+proposed+released−removed).`,
    });
  }

  return {
    result: {
      scenarioName,
      deltas: safeDeltas,
      borrowingCapacity: calc.borrowingCapacity,
      monthlySurplus: calc.monthlySurplus,
      serviceabilityBand: calc.serviceabilityBand,
      dtiRatio: calc.dtiRatio,
      assessmentRate: calc.assessmentRate,
      stressTestedCapacity: calc.stressTestedCapacity,
      recommendations: calc.recommendations,
      warnings: calc.warnings,
      afterTaxAnnualIncome: calc.afterTaxAnnualIncome,
      monthlyAfterTaxIncome: calc.monthlyAfterTaxIncome,
      capacityChange,
      acquisitionCapacity,
      capitalLedger: capitalLedgerWI,
      validationIssues: issues.map(i => ({ deltaId: i.deltaId, deltaType: i.deltaType, severity: i.severity, message: i.message })),
    },
    inputs,
    effect: total,
    issues,
  };
}

// ============================================
// PRESET FACTORIES (unchanged surface)
// ============================================

export function createPayOffAllDebtScenario(
  liabilities: ScenarioLiability[],
): { name: string; deltas: ScenarioDelta[] } {
  const unsecured = liabilities.filter(l =>
    !l.type.includes('home_loan') &&
    !l.type.includes('investment_loan') &&
    !l.type.includes('rent_expense'),
  );

  return {
    name: 'Pay Off All Unsecured Debt',
    deltas: unsecured.map(l => ({
      id: l.id,
      label: `Pay off ${l.label}`,
      type: 'liability_payoff' as const,
      value: l.balance,
      unit: 'absolute' as const,
    })),
  };
}

export function createSellPropertyScenario(
  property: ScenarioProperty,
): { name: string; deltas: ScenarioDelta[] } {
  return {
    name: `Sell ${property.address?.slice(0, 30) || 'Property'}`,
    deltas: [{
      id: property.id,
      label: `Sell ${property.address?.slice(0, 30) || 'property'}`,
      type: 'property_sell' as const,
      value: property.currentValue,
      unit: 'absolute' as const,
    }],
  };
}

export function createRefinanceToIOScenario(
  properties: ScenarioProperty[],
): { name: string; deltas: ScenarioDelta[] } {
  const withLoans = properties.filter(p =>
    p.loanRemaining > 0 &&
    p.propertyType !== 'rental' &&
    p.propertyType !== 'owner_occupied'
  );

  return {
    name: 'Refinance All Investment Loans to IO',
    deltas: withLoans.map(p => ({
      id: p.id,
      label: `Refinance ${p.address?.slice(0, 25) || 'property'} to IO`,
      type: 'property_refinance' as const,
      value: 0,
      unit: 'absolute' as const,
    })),
  };
}

export function createRateChangeScenario(rateChange: number): { name: string; deltas: ScenarioDelta[] } {
  const direction = rateChange > 0 ? 'increase' : 'decrease';
  return {
    name: `Rates ${rateChange >= 0 ? '+' : ''}${rateChange}%`,
    deltas: [{
      id: `rate-${rateChange}`,
      label: `Interest rate ${direction} ${Math.abs(rateChange)}%`,
      type: 'rate_change' as const,
      value: rateChange,
      unit: 'rate_points' as const,
    }],
  };
}

export function createIncomeChangeScenario(percentChange: number): { name: string; deltas: ScenarioDelta[] } {
  return {
    name: `Income ${percentChange >= 0 ? '+' : ''}${percentChange}%`,
    deltas: [{
      id: `income-${percentChange}`,
      label: `Income ${percentChange >= 0 ? 'increase' : 'decrease'} ${Math.abs(percentChange)}%`,
      type: 'income_change' as const,
      value: percentChange,
      unit: 'percent' as const,
    }],
  };
}

export function createMaximumStrategyScenario(
  liabilities: ScenarioLiability[],
  properties: ScenarioProperty[],
): { name: string; deltas: ScenarioDelta[] } {
  const debtDeltas = createPayOffAllDebtScenario(liabilities).deltas;
  const refiDeltas = createRefinanceToIOScenario(properties).deltas;

  return {
    name: 'Maximum Strategy',
    deltas: [
      ...debtDeltas,
      ...refiDeltas,
      {
        id: 'expense-15',
        label: 'Reduce expenses 15%',
        type: 'expense_change' as const,
        value: -15,
        unit: 'percent' as const,
      },
    ],
  };
}

// ============================================
// SOLUTION RECOMMENDATIONS (Audit-fix #1)
// ============================================
//
// Surfaces 3 ranked "one-click" solution cards above the manual lever stack so
// brokers don't have to hand-build every scenario. Each recommendation:
//   • runs the engine in isolation to project the capacity uplift,
//   • ranks by Δ capacity (positive only, capped to 3),
//   • carries an `apply` payload the UI dispatches into existing strategy state
//     (no new state shape is introduced).
//
// Apply payload kinds map 1:1 to the existing setters in StrategyScenarioModeling:
//   - 'expense'  → handleAdditionalChange({ expenseReductionPercent: payload.percent })
//   - 'term'     → handleAdditionalChange({ loanTermAdjustment: payload.years })
//   - 'equity'   → setStrategy(prev => enable equityRelease + add propertyId @ targetLVR)

export type SolutionApply =
  | { kind: 'expense'; percent: number }
  | { kind: 'term'; years: number }
  | { kind: 'equity'; propertyId: string; targetLVR: number };

export interface SolutionRecommendation {
  id: string;
  title: string;
  description: string;
  projectedCapacity: number;
  capacityDelta: number;
  deltas: ScenarioDelta[];
  apply: SolutionApply;
}

export function recommendSolutions(
  context: ScenarioContext,
): SolutionRecommendation[] {
  const baseCapacity = context.baseResult.borrowingCapacity;
  const candidates: SolutionRecommendation[] = [];

  // — Reduce expenses 15% —
  {
    const deltas: ScenarioDelta[] = [{
      id: 'rec-expense-15',
      label: 'Reduce expenses 15%',
      type: 'expense_change',
      value: -15,
      unit: 'percent',
    }];
    try {
      const r = runScenario('Recommendation: Reduce Expenses', deltas, context);
      candidates.push({
        id: 'reduce-expenses',
        title: 'Reduce Expenses',
        description: 'Trim discretionary spend by 15% to lift serviceability surplus.',
        projectedCapacity: r.borrowingCapacity,
        capacityDelta: r.borrowingCapacity - baseCapacity,
        deltas,
        apply: { kind: 'expense', percent: 15 },
      });
    } catch { /* skip */ }
  }

  // — Extend loan term +5y (only if base term ≤ 25) —
  if ((context.baseInputs.loanTermYears ?? 30) <= 25) {
    const deltas: ScenarioDelta[] = [{
      id: 'rec-term-5',
      label: 'Extend loan term +5 years',
      type: 'loan_term_change',
      value: 5,
      unit: 'absolute',
    }];
    try {
      const r = runScenario('Recommendation: Extend Term', deltas, context);
      candidates.push({
        id: 'extend-term',
        title: 'Extend Loan Term',
        description: 'Stretch the assessed loan term by 5 years to lower assessed repayments.',
        projectedCapacity: r.borrowingCapacity,
        capacityDelta: r.borrowingCapacity - baseCapacity,
        deltas,
        apply: { kind: 'term', years: 5 },
      });
    } catch { /* skip */ }
  }

  // — Release equity (highest-equity property to 80% LVR) —
  const eligible = (context.properties || [])
    .filter(p => p.currentValue > 0)
    .map(p => ({
      p,
      equity: Math.max(0, p.currentValue * 0.80 - (p.loanRemaining || 0)),
    }))
    .filter(x => x.equity > 25_000)
    .sort((a, b) => b.equity - a.equity);

  if (eligible.length > 0) {
    const top = eligible[0];
    const deltas: ScenarioDelta[] = [{
      id: top.p.id,
      label: `Release equity from ${top.p.address?.slice(0, 30) || 'top property'} @ 80% LVR`,
      type: 'equity_release',
      value: 0.80,
      unit: 'ratio',
    }];
    try {
      const r = runScenario('Recommendation: Equity Release', deltas, context);
      candidates.push({
        id: 'release-equity',
        title: 'Release Equity',
        description: `Unlock ~$${Math.round(top.equity).toLocaleString('en-AU')} from ${top.p.address?.slice(0, 28) || 'top property'} to seed the next deposit.`,
        projectedCapacity: r.borrowingCapacity,
        capacityDelta: r.borrowingCapacity - baseCapacity,
        deltas,
        apply: { kind: 'equity', propertyId: top.p.id, targetLVR: 0.80 },
      });
    } catch { /* skip */ }
  }

  // Rank by capacity uplift desc, keep top 3, hide non-positive results.
  return candidates
    .filter(c => c.capacityDelta > 0)
    .sort((a, b) => b.capacityDelta - a.capacityDelta)
    .slice(0, 3);
}
