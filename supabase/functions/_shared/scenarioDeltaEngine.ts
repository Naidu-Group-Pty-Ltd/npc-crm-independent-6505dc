/**
 * Scenario Delta Engine — Deno mirror for edge functions.
 *
 * STRUCTURAL TWIN of `src/utils/scenarioDeltaEngine.ts`. Both files implement
 * identical semantics so the client preview and the server replay produce the
 * same numbers. Parity is enforced by tests in
 * `supabase/functions/calculate-borrowing-capacity/scenario_parity_test.ts`.
 *
 * If you change one, change the other and update the parity test.
 */

import { estimateLmi, type LmiMode } from './lmiCalculations.ts';
import {
  calculateStampDuty,
  estimateOtherAcquisitionCosts,
  type AustralianState,
  type PurchaseIntent,
  type PropertyCategory,
} from './stampDutyCalculator.ts';
import {
  resolveLenderProfile,
  reshadeIncome,
  BANK_STANDARD_PROFILE,
  type ScenarioIncomeComponent,
  type LenderShadingProfile,
} from './lenderShadingProfiles.ts';
import {
  computeNegativeGearingAddBack,
  marginalTaxRateFor,
} from './negativeGearingAddBack.ts';
import {
  resolveLvrCap,
  inferPropertyKind,
  inferPropertyIntent,
} from './lenderLvrCaps.ts';
import {
  computeDtiDenominator,
  computeDti,
} from './dtiDenominator.ts';
import {
  buildCapitalLedger,
  type CapitalLedger,
  type CapitalSourceType,
  type LedgerContext,
} from './capitalAllocationLedger.ts';

// ============================================
// TYPES (mirrored from src/utils/borrowingCapacityTypes.ts)
// ============================================

export type ScenarioDeltaType =
  | 'income_change'
  | 'expense_change'
  | 'debt_change'
  | 'rate_change'
  | 'property_sell'
  | 'property_refinance'
  | 'property_add'
  | 'liability_payoff'
  | 'loan_term_change'
  | 'dti_cap_change'
  | 'equity_release'
  | 'property_rate_change'
  /** Phase G1 — Valuation override (manual/AVM/desktop/comp sales). */
  | 'property_value_change'
  /** Phase G2 — Cross-collateralised pool release across multiple securities. */
  | 'portfolio_lvr_release'
  /** Phase K1 — Capital allocation sink (routes pool $ to debt/offset/etc.). */
  | 'capital_allocation';

export type ScenarioDeltaUnit = 'percent' | 'absolute' | 'rate_points' | 'years' | 'ratio';

export interface ScenarioDelta {
  id: string;
  label: string;
  type: ScenarioDeltaType;
  value: number;
  unit: ScenarioDeltaUnit;
  meta?: Record<string, number | string | boolean | string[] | null>;
}

export interface ScenarioBaseInputs {
  grossAnnualIncome: number;
  shadedAnnualIncome: number;
  monthlyLivingExpenses: number;
  monthlyCommitments: number;
  interestRate: number;
  bufferRate: number;
  loanTermYears: number;
  totalDebtBalances: number;
  calculationMode?: 'bank' | 'conservative';
  dtiCapEnabled?: boolean;
  dtiCapLimit?: number;
  /** Phase I1 — typed income components for lender-aware re-shading.
   *  When omitted the engine falls back to the legacy blended ratio. */
  incomeComponents?: ScenarioIncomeComponent[];
  /** Phase I1 — id of the lender profile applied when computing
   *  `shadedAnnualIncome`. Used to decide whether re-shading is needed
   *  when a `dti_cap_change` delta flips lenders. */
  currentLenderProfileId?: string;
  /** Phase I2 — monthly HEM benchmark for this household. The engine
   *  floors `monthlyLivingExpenses` here after `expense_change` deltas. */
  hemBenchmark?: number;
}

export interface ScenarioBaseResult {
  borrowingCapacity: number;
  monthlySurplus: number;
  serviceabilityBand: 'green' | 'amber' | 'red';
  dtiRatio: number;
}

export interface ScenarioProperty {
  id: string;
  address: string;
  propertyType: string;
  currentValue: number;
  loanRemaining: number;
  monthlyRepayment: number;
  loanRepaymentAmount?: number;
  netMonthlyCashflow?: number;
  monthlyRentalIncome?: number;
  /** Phase F1 — contracted annual rate per property (%) */
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

export interface AcquisitionContext {
  state?: 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'NT' | 'ACT';
  intent?: 'owner_occupier' | 'investor';
  category?: 'established' | 'new' | 'vacant_land';
  isFirstHomeBuyer?: boolean;
  isForeignBuyer?: boolean;
  lmiMode?: 'none' | 'display_deduction' | 'debt_capitalised';
  cashOnHand?: number;
  /** Phase F2 — target purchase price the strategy is solving for */
  targetPurchasePrice?: number;
}

export interface ScenarioContext {
  baseInputs: ScenarioBaseInputs;
  baseResult: ScenarioBaseResult;
  properties: ScenarioProperty[];
  liabilities: ScenarioLiability[];
  acquisition?: AcquisitionContext;
}

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
  /** Phase I1 — when set, the lender profile id to apply during
   *  aggregation. Triggers a full re-shade of `incomeComponents`. */
  lenderProfileOverride?: string;
  releasedCapital: number;
  acquisitionNotes: string[];
  description: string;
}

export interface DeltaValidationIssue {
  deltaId: string;
  deltaType: string;
  severity: 'warning' | 'error';
  message: string;
}

// ============================================
// HELPERS
// ============================================

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

function blendedShadingRatio(ctx: ScenarioContext): number {
  const gross = ctx.baseInputs.grossAnnualIncome;
  const shaded = ctx.baseInputs.shadedAnnualIncome;
  if (gross <= 0) return 0.8;
  return Math.max(0, Math.min(1, shaded / gross));
}

// ── Phase E (M3 fix): HEM tier-aware expense recompute ─────────────────
// Deno mirror of `src/utils/scenarioDeltaEngine.ts` HEM helpers. Keep
// multiplier table in sync with `policyEngine.DEFAULT_HEM_CONFIG.incomeScaling`.
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
// VALIDATION
// ============================================

export function validateDeltas(deltas: ScenarioDelta[], context: ScenarioContext): DeltaValidationIssue[] {
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
          issues.push({ deltaId: d.id, deltaType: d.type, severity: 'error', message: `Property "${d.id}" not found in client portfolio — delta ignored` });
        }
        if (d.type === 'property_value_change') {
          if (d.unit === 'percent' && Math.abs(d.value) > 100) {
            issues.push({ deltaId: d.id, deltaType: d.type, severity: 'warning', message: `Valuation uplift ${d.value}% exceeds ±100% — likely a data entry error` });
          }
          if (d.unit === 'absolute' && d.value <= 0) {
            issues.push({ deltaId: d.id, deltaType: d.type, severity: 'error', message: `Absolute valuation must be positive (got ${d.value})` });
          }
          const basis = d.meta?.basis as string | undefined;
          if (!basis) {
            issues.push({ deltaId: d.id, deltaType: d.type, severity: 'warning', message: 'Valuation override missing `meta.basis` — PDF will watermark as unverified' });
          }
        }
        break;
      case 'portfolio_lvr_release': {
        const ids = (d.meta?.propertyIds as string[] | undefined) || [];
        if (!Array.isArray(ids) || ids.length === 0) {
          issues.push({ deltaId: d.id, deltaType: d.type, severity: 'error', message: 'Pool release missing `meta.propertyIds` — at least one property required' });
        } else {
          for (const pid of ids) {
            if (!propertyIds.has(pid)) {
              issues.push({ deltaId: d.id, deltaType: d.type, severity: 'error', message: `Pool member "${pid}" not in portfolio — excluded from blended LVR` });
            }
          }
        }
        const target = d.unit === 'percent' ? d.value / 100 : d.value;
        if (!Number.isFinite(target) || target <= 0 || target > 0.97) {
          issues.push({ deltaId: d.id, deltaType: d.type, severity: 'warning', message: `Blended target LVR ${(target * 100).toFixed(1)}% outside 0–97% sane band` });
        }
        break;
      }
      case 'liability_payoff':
        if (!liabilityIds.has(d.id)) {
          issues.push({ deltaId: d.id, deltaType: d.type, severity: 'error', message: `Liability "${d.id}" not found — delta ignored` });
        }
        break;
      case 'rate_change':
        if (Math.abs(d.value) > 10) {
          issues.push({ deltaId: d.id, deltaType: d.type, severity: 'warning', message: 'Rate change exceeds ±10pp' });
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
// DELTA APPLICATION (1:1 with client engine)
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
        effect.debtBalanceAdjustment = delta.value * 200;
      }
      break;
    }
    case 'rate_change':
      effect.rateAdjustment = delta.value;
      break;
    case 'loan_term_change':
      effect.loanTermAdjustment = delta.value;
      break;
    case 'dti_cap_change': {
      const enabled = (delta.meta?.enabled as boolean | undefined) ?? true;
      effect.dtiCapEnabled = enabled;
      if (enabled) effect.dtiCapLimit = delta.value;
      // Phase I1 — when the broker flips the DTI cap to model a different
      // lender, accept an explicit `meta.lenderProfile` so the engine can
      // re-shade rental / bonus / commission per that lender's policy.
      const lp = delta.meta?.lenderProfile as string | undefined;
      if (lp) effect.lenderProfileOverride = lp;
      break;
    }
    case 'property_sell': {
      const property = context.properties.find(p => p.id === delta.id);
      if (property) {
        const svc = property.loanRepaymentAmount || property.monthlyRepayment || 0;
        if (svc > 0) effect.commitmentAdjustment = -svc;
        if (property.loanRemaining > 0) effect.debtBalanceAdjustment = -property.loanRemaining;
        const cf = property.netMonthlyCashflow || 0;
        if (cf > 0) {
          effect.incomeAdjustment = -(cf * 12);
          effect.shadedIncomeAdjustment = -(cf * 12 * shadingRatio);
        } else if (cf < 0) {
          effect.expenseAdjustment = cf;
        }
        effect.description = `Sell ${property.address?.slice(0, 30) || 'property'}`;
      }
      break;
    }
    case 'property_refinance': {
      const property = context.properties.find(p => p.id === delta.id);
      if (property && property.loanRemaining > 0) {
        const cur = property.loanRepaymentAmount || property.monthlyRepayment || 0;
        const propRate = property.interestRate ?? context.baseInputs.interestRate;
        const ioRate = propRate / 100 / 12;
        const autoIo = property.loanRemaining * ioRate;
        // Phase 3 — granular refinance controls
        const manualRepayment = (delta.meta as any)?.manualRepayment as number | undefined;
        const ioPeriodYears = (delta.meta as any)?.ioPeriodYears as number | undefined;
        const newRep = Number.isFinite(manualRepayment as number) && (manualRepayment as number) >= 0
          ? (manualRepayment as number)
          : autoIo;
        const saving = Math.max(0, cur - newRep);
        if (saving > 0) effect.commitmentAdjustment = -saving;
        const repayLabel = Number.isFinite(manualRepayment as number)
          ? `manual $${Math.round(manualRepayment as number).toLocaleString()}/mo`
          : `IO @ ${propRate.toFixed(2)}%`;
        const periodLabel = Number.isFinite(ioPeriodYears as number) && (ioPeriodYears as number) > 0
          ? ` (${ioPeriodYears}yr IO period)`
          : '';
        effect.acquisitionNotes.push(`Refinance ${property.address?.slice(0, 30) || 'property'} → ${repayLabel}${periodLabel}: −$${Math.round(saving).toLocaleString()}/mo`);
        effect.description = `Refinance ${property.address?.slice(0, 30) || 'property'} to IO${periodLabel}`;
      }
      break;
    }
    case 'property_rate_change': {
      // Phase F1 — reprice a single property to a new contracted rate.
      const property = context.properties.find(p => p.id === delta.id);
      if (property && property.loanRemaining > 0 && Number.isFinite(delta.value) && delta.value > 0) {
        const cur = property.loanRepaymentAmount || property.monthlyRepayment || 0;
        const oldRate = property.interestRate ?? context.baseInputs.interestRate;
        const newRate = delta.value;
        const monthlyOldIO = property.loanRemaining * (oldRate / 100 / 12);
        const isIo = cur > 0 && Math.abs(cur - monthlyOldIO) / Math.max(1, monthlyOldIO) < 0.05;
        let newRep: number;
        if (isIo) {
          newRep = property.loanRemaining * (newRate / 100 / 12);
        } else {
          const periods = (context.baseInputs.loanTermYears || 30) * 12;
          const mr = newRate / 100 / 12;
          newRep = mr > 0
            ? property.loanRemaining * (mr * Math.pow(1 + mr, periods)) / (Math.pow(1 + mr, periods) - 1)
            : property.loanRemaining / periods;
        }
        const d$ = newRep - cur;
        effect.commitmentAdjustment = d$;
        effect.acquisitionNotes.push(`Reprice ${property.address?.slice(0, 30) || 'property'}: ${oldRate.toFixed(2)}% → ${newRate.toFixed(2)}% ${isIo ? '(IO)' : '(P&I)'}, ${d$ >= 0 ? '+' : '−'}$${Math.round(Math.abs(d$)).toLocaleString()}/mo`);
        effect.description = `Reprice ${property.address?.slice(0, 30) || 'property'} to ${newRate.toFixed(2)}%`;
      }
      break;
    }
    case 'property_add': {
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
      const liability = context.liabilities.find(l => l.id === delta.id);
      if (liability) {
        effect.commitmentAdjustment = -liability.monthlyServicing;
        effect.debtBalanceAdjustment = -(liability.balance || 0);
        effect.description = `Pay off ${liability.label || liability.type}`;
      }
      break;
    }
    case 'equity_release': {
      // Phase C + F1/F2 + G3: cash freed + shadow IO using per-property rate.
      const property = context.properties.find(p => p.id === delta.id);
      if (!property || property.currentValue <= 0) break;
      const fhb = !!context.acquisition?.isFirstHomeBuyer;
      const overrideRate = delta.meta?.releaseRate as number | undefined;
      const ratePct = (Number.isFinite(overrideRate) && (overrideRate as number) > 0)
        ? (overrideRate as number)
        : (property.interestRate ?? context.baseInputs.interestRate ?? 6.5);
      const monthlyRate = (ratePct / 100) / 12;
      // G3 — externalised lender cap
      // Phase I7 — per-security cap (lender × intent × kind, FHB/foreign adj.)
      const explicitCap = (delta.meta?.lenderMaxLVR as number | undefined);
      const lvrResult = resolveLvrCap({
        lenderId: context.baseInputs.currentLenderProfileId,
        intent: inferPropertyIntent(property.propertyType, 'investment'),
        kind: inferPropertyKind(property.propertyType),
        isFirstHomeBuyer: !!context.acquisition?.isFirstHomeBuyer,
        isForeignBuyer: !!context.acquisition?.isForeignBuyer,
        explicitCap,
      });
      const safeLenderCap = lvrResult.cap;
      let newLoan = 0;
      if (delta.unit === 'absolute' && delta.value > 0) {
        newLoan = property.loanRemaining + delta.value;
      } else {
        const targetLVR = delta.unit === 'percent' ? delta.value / 100
          : (delta.meta?.targetLVR as number | undefined) ?? delta.value;
        newLoan = property.currentValue * Math.max(0, Math.min(safeLenderCap, targetLVR || 0.8));
      }
      newLoan = Math.min(newLoan, property.currentValue * safeLenderCap);
      const grossRelease = Math.max(0, newLoan - property.loanRemaining);
      if (grossRelease <= 0) {
        // G3 — no longer silent. Surface why so finance can consider G1/G2 levers.
        const currentLvr = (property.loanRemaining / property.currentValue) * 100;
        effect.acquisitionNotes.push(
          `⚠ Equity release on ${property.address?.slice(0, 30) || 'property'} skipped — already at ${currentLvr.toFixed(1)}% LVR. Consider valuation uplift (G1) or cross-collateralised pool (G2).`
        );
        break;
      }
      const newLvr = (newLoan / property.currentValue) * 100;
      let lmiOnRelease = 0;
      if (newLvr > 80) {
        const est = estimateLmi({ propertyValue: property.currentValue, loanAmount: newLoan, isFirstHomeBuyer: fhb });
        lmiOnRelease = est.lmiAmount;
      }
      // Phase 2 (granular controls): deployment %, repayment type, manual override
      const rawDeployPct = delta.meta?.deploymentPercent;
      const deploymentPercent = Number.isFinite(rawDeployPct as number)
        ? Math.max(0, Math.min(1, rawDeployPct as number))
        : 1;
      const deployedGross = grossRelease * deploymentPercent;
      const deployedLmi = lmiOnRelease * deploymentPercent;
      const netRelease = Math.max(0, deployedGross - deployedLmi);
      const repaymentType = (delta.meta?.repaymentType as string | undefined) === 'principal_and_interest'
        ? 'principal_and_interest'
        : 'interest_only';
      const manualRepayment = delta.meta?.manualRepayment as number | undefined;
      // Phase I3 — APRA: assess servicing at buffered rate.
      const assessRatePct = ratePct + (context.baseInputs.bufferRate ?? 3);
      const assessMonthlyRate = (assessRatePct / 100) / 12;
      const termYears = context.baseInputs.loanTermYears || 30;
      const periods = termYears * 12;
      let newSliceRepayment: number;
      if (Number.isFinite(manualRepayment as number) && (manualRepayment as number) >= 0) {
        newSliceRepayment = manualRepayment as number;
      } else if (repaymentType === 'principal_and_interest' && assessMonthlyRate > 0) {
        newSliceRepayment = deployedGross * (assessMonthlyRate * Math.pow(1 + assessMonthlyRate, periods)) /
          (Math.pow(1 + assessMonthlyRate, periods) - 1);
      } else {
        newSliceRepayment = deployedGross * assessMonthlyRate;
      }
      effect.commitmentAdjustment = Math.max(0, newSliceRepayment);
      effect.debtBalanceAdjustment = deployedGross;
      effect.releasedCapital = netRelease;
      effect.acquisitionNotes.push(`Equity release on ${property.address?.slice(0, 30) || 'property'} @ ${ratePct.toFixed(2)}%: gross $${Math.round(grossRelease).toLocaleString()} × deploy ${(deploymentPercent * 100).toFixed(0)}% = $${Math.round(deployedGross).toLocaleString()} − LMI $${Math.round(deployedLmi).toLocaleString()} = $${Math.round(netRelease).toLocaleString()} usable (LVR ${newLvr.toFixed(1)}%, cap: ${lvrResult.reason}), +$${Math.round(newSliceRepayment).toLocaleString()}/mo ${repaymentType === 'principal_and_interest' ? 'P&I' : 'IO'} @ ${assessRatePct.toFixed(2)}% buffered`);
      effect.description = `Release equity from ${property.address?.slice(0, 30) || 'property'}`;
      break;
    }

    case 'property_value_change': {
      // Phase G1 — Pure input override. Mutates the resolved property record
      // so any downstream property-bound delta sees the new valuation.
      const property = context.properties.find(p => p.id === delta.id);
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
      property.currentValue = newValue;
      const basis = (delta.meta?.basis as string | undefined) || 'manual';
      const source = (delta.meta?.source as string | undefined) || '—';
      const pct = oldValue > 0 ? ((newValue - oldValue) / oldValue) * 100 : 0;
      effect.acquisitionNotes.push(
        `Revalue ${property.address?.slice(0, 30) || 'property'}: $${Math.round(oldValue).toLocaleString()} → $${Math.round(newValue).toLocaleString()} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%, basis: ${basis}, source: ${source})`
      );
      effect.description = `Revalue ${property.address?.slice(0, 30) || 'property'}`;
      break;
    }

    case 'portfolio_lvr_release': {
      // Phase G2 — Cross-collateralised / blended-LVR release.
      const pool = (delta.meta?.propertyIds as string[] | undefined) || [];
      const members = (context.properties || []).filter(p => pool.includes(p.id) && p.currentValue > 0);
      if (members.length === 0) {
        effect.acquisitionNotes.push(`⚠ Pool release: no valid pool members found in portfolio.`);
        break;
      }
      const blendedTarget = delta.unit === 'percent' ? delta.value / 100 : delta.value;
      const safeBlended = Math.max(0, Math.min(0.97, blendedTarget || 0.8));
      // Phase I7 — per-security caps now resolved per-property (lender × intent × kind)
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

      const headroom = members.map(p => {
        const cap = resolveLvrCap({
          lenderId: context.baseInputs.currentLenderProfileId,
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
        };
      });
      const totalHeadroom = headroom.reduce((s, h) => s + h.headroom, 0);
      const cappedPool = Math.min(grossPool, totalHeadroom);

      let allocations: Array<{ property: typeof members[number]; allocation: number }> = [];
      if (allocationStrategy === 'pro_rata' && totalHeadroom > 0) {
        allocations = headroom.map(h => ({ property: h.property, allocation: cappedPool * (h.headroom / totalHeadroom) }));
      } else {
        const sorted = [...headroom].sort((a, b) => b.equity - a.equity);
        let remaining = cappedPool;
        allocations = sorted.map(h => {
          const take = Math.min(h.headroom, remaining);
          remaining = Math.max(0, remaining - take);
          return { property: h.property, allocation: take };
        }).filter(a => a.allocation > 0);
      }

      const fhb = !!context.acquisition?.isFirstHomeBuyer;
      let totalGross = 0, totalLmi = 0, totalIo = 0;
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
        let lmiSlice = 0;
        if (newLvr > 80) {
          const est = estimateLmi({ propertyValue: a.property.currentValue, loanAmount: newLoan, isFirstHomeBuyer: fhb });
          lmiSlice = est.lmiAmount;
        }
        totalLmi += lmiSlice;
        const ratePct = a.property.interestRate ?? blendedRatePct;
        // Phase I3 — assess servicing at buffered rate
        const assessRatePct = ratePct + (context.baseInputs.bufferRate ?? 3);
        totalIo += a.allocation * (assessRatePct / 100 / 12);
        securityNotes.push(
          `${a.property.address?.slice(0, 25) || 'property'}: +$${Math.round(a.allocation).toLocaleString()} (LVR → ${newLvr.toFixed(1)}%${lmiSlice > 0 ? `, LMI $${Math.round(lmiSlice).toLocaleString()}` : ''})`
        );
      }
      const netPool = Math.max(0, totalGross - totalLmi);

      effect.commitmentAdjustment = Math.max(0, totalIo);
      effect.debtBalanceAdjustment = totalGross;
      effect.releasedCapital = netPool;

      const blendedNow = totalValue > 0 ? (totalDebt / totalValue) * 100 : 0;
      const blendedAfter = totalValue > 0 ? ((totalDebt + totalGross) / totalValue) * 100 : 0;
      effect.acquisitionNotes.push(
        `Cross-collat pool (${members.length} properties, ${allocationStrategy}): blended LVR ${blendedNow.toFixed(1)}% → ${blendedAfter.toFixed(1)}% (target ${(safeBlended * 100).toFixed(1)}%). Gross $${Math.round(totalGross).toLocaleString()} − LMI $${Math.round(totalLmi).toLocaleString()} = $${Math.round(netPool).toLocaleString()} usable. Servicing +$${Math.round(totalIo).toLocaleString()}/mo IO.`
      );
      for (const n of securityNotes) effect.acquisitionNotes.push(`  · ${n}`);
      if (cappedPool < grossPool) {
        const minCap = headroom.length ? Math.min(...headroom.map(h => h.capPct)) : 0.95;
        effect.acquisitionNotes.push(
          `  · ⚠ Pool capped at $${Math.round(cappedPool).toLocaleString()} (target wanted $${Math.round(grossPool).toLocaleString()}, lender per-security caps min ${(minCap * 100).toFixed(0)}% — see I7 cap matrix).`
        );
      }
      effect.description = `Cross-collat release pool @ ${(safeBlended * 100).toFixed(0)}% blended LVR`;
      break;
    }
  }
  return effect;
}

// ============================================
// AGGREGATION
// ============================================

export interface AggregatedScenarioInputs {
  grossAnnualIncome: number;
  shadedAnnualIncome: number;
  monthlyLivingExpenses: number;
  monthlyCommitments: number;
  interestRate: number;
  bufferRate: number;
  loanTermYears: number;
  totalDebtBalances: number;
  calculationMode?: 'bank' | 'conservative';
  dtiCapEnabled?: boolean;
  dtiCapLimit?: number;
}

export interface AcquisitionCapacityResult {
  releasedCapital: number;
  lmi: number;
  lmiMode: LmiMode;
  stampDuty: number;
  otherAcquisitionCosts: number;
  maxPurchasePrice: number;
  loanAvailableForPurchase: number;
  cashAvailable: number;
  /** Phase F2 — actual loan required to settle the target purchase price. */
  loanRequiredForPurchase?: number;
  /** Phase F2 — net cash position after settlement (negative = shortfall). */
  netCashAfterSettlement?: number;
  /** Phase F2 — target the strategy is solving for (echoed for the UI). */
  targetPurchasePrice?: number;
  /** Phase F2 — true when maxPurchasePrice ≥ targetPurchasePrice and cash is sufficient. */
  meetsTarget?: boolean;
  /** Phase F2 — shortfall to target = max(0, target − maxPurchasePrice). */
  shortfallToTarget?: number;
  /** Phase I9 — per-security LVR cap applied to the acquisition loan. */
  acquisitionLvrCap?: number;
  /** Phase I9 — true when the acquisition loan was clamped by the LVR cap. */
  loanCappedByLvr?: boolean;
  notes: string[];
}

export interface AggregateResult {
  inputs: AggregatedScenarioInputs;
  effect: DeltaEffect;
  safeDeltas: ScenarioDelta[];
  issues: DeltaValidationIssue[];
}

/** Phase G1 — clone properties so in-place valuation mutations are scenario-scoped. */
function cloneContextForRun(context: ScenarioContext): ScenarioContext {
  return {
    ...context,
    properties: (context.properties || []).map(p => ({ ...p })),
  };
}

/** Phase I10 — Mirror of `splitDebtMoves` in client engine. */
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
      const lvr = resolveLvrCap({
        lenderId: context.baseInputs.currentLenderProfileId,
        intent: inferPropertyIntent(property.propertyType, 'investment'),
        kind: inferPropertyKind(property.propertyType),
        isFirstHomeBuyer: !!context.acquisition?.isFirstHomeBuyer,
        isForeignBuyer: !!context.acquisition?.isForeignBuyer,
        explicitCap: d.meta?.lenderMaxLVR as number | undefined,
      });
      const targetLvr = d.unit === 'absolute'
        ? Math.min(lvr.cap, (property.loanRemaining + Math.max(0, d.value)) / property.currentValue)
        : (d.unit === 'percent' ? d.value / 100 : d.value);
      released += Math.max(0, (Math.min(targetLvr, lvr.cap) * property.currentValue) - property.loanRemaining);
    } else if (d.type === 'portfolio_lvr_release') {
      const target = d.unit === 'percent' ? d.value / 100 : d.value;
      const ids = (d.meta?.propertyIds as string[] | undefined) || [];
      const members = (context.properties || []).filter(p => ids.includes(p.id));
      const totalValue = members.reduce((s, p) => s + (p.currentValue || 0), 0);
      const totalDebt = members.reduce((s, p) => s + (p.loanRemaining || 0), 0);
      released += Math.max(0, target * totalValue - totalDebt);
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

/** Phase G1 — `property_value_change` deltas resolve BEFORE other property-bound deltas
 *  so downstream equity/refinance/pool math sees the new currentValue. */
function orderDeltas(deltas: ScenarioDelta[]): ScenarioDelta[] {
  const valueChanges: ScenarioDelta[] = [];
  const others: ScenarioDelta[] = [];
  for (const d of deltas) {
    if (d.type === 'property_value_change') valueChanges.push(d);
    else others.push(d);
  }
  return [...valueChanges, ...others];
}

export function aggregateDeltas(
  scenarioName: string,
  deltas: ScenarioDelta[],
  context: ScenarioContext,
): AggregateResult {
  const issues = validateDeltas(deltas, context);
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
    // portfolio_lvr_release filters its own pool inside applyDelta
    return true;
  });

  // G1 — clone context + sort value-changes first
  const ctx = cloneContextForRun(context);
  // Phase K1 — split capital_allocation sinks from main loop
  const safeNonAlloc = safeDeltas.filter(d => d.type !== 'capital_allocation');
  const safeAllocs = safeDeltas.filter(d => d.type === 'capital_allocation');
  const ordered = orderDeltas(safeNonAlloc);

  const total = emptyEffect(scenarioName);
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
    // Phase I1 hardening — propagate lender-profile override to the totals
    // bag so the downstream re-shading branch actually fires.
    if (e.lenderProfileOverride) total.lenderProfileOverride = e.lenderProfileOverride;
  }

  // Phase K1 — Capital Allocation Ledger (server mirror).
  // Re-run source-emitting deltas in isolation to attribute per-delta
  // releasedCapital, then build the ledger and fold sink effects into totals.
  function srcType(d: ScenarioDelta): CapitalSourceType | null {
    if (d.type === 'equity_release') return 'equity_release';
    if (d.type === 'portfolio_lvr_release') return 'portfolio_lvr_release';
    if (d.type === 'property_sell') return 'property_sell';
    return null;
  }
  const sourceContribs: LedgerContext['sourceContributions'] = [];
  for (const d of safeNonAlloc) {
    const st = srcType(d);
    if (!st) continue;
    if (st === 'property_sell') {
      const p = ctx.properties?.find(x => x.id === d.id);
      const equity = p ? Math.max(0, (p.currentValue || 0) - (p.loanRemaining || 0)) : 0;
      if (equity > 0) sourceContribs.push({ deltaId: d.id, sourceType: 'property_sell', label: `Sell ${p?.address?.slice(0, 28) || 'property'}`, amount: equity });
      continue;
    }
    const sandbox = cloneContextForRun(ctx);
    const eff = applyDelta(d, sandbox);
    if (eff.releasedCapital > 0) {
      sourceContribs.push({
        deltaId: d.id, sourceType: st,
        label: d.label || (st === 'equity_release' ? 'Equity release' : 'Pool release'),
        amount: eff.releasedCapital,
      });
    }
  }
  const ledgerCtx: LedgerContext = {
    properties: (ctx.properties || []).map(p => ({
      id: p.id, address: p.address, propertyType: p.propertyType,
      currentValue: p.currentValue, loanRemaining: p.loanRemaining,
      monthlyRepayment: p.monthlyRepayment, loanRepaymentAmount: p.loanRepaymentAmount,
      interestRate: p.interestRate,
    })),
    liabilities: (ctx.liabilities || []).map(l => ({
      id: l.id, label: l.label, type: l.type,
      balance: l.balance, monthlyServicing: l.monthlyServicing,
    })),
    cashOnHand: ctx.acquisition?.cashOnHand ?? 0,
    sourceContributions: sourceContribs,
  };
  const k1 = buildCapitalLedger([...safeNonAlloc, ...safeAllocs], ledgerCtx);
  total.commitmentAdjustment += k1.sinkAggregate.monthlyServicingDelta;
  total.debtBalanceAdjustment += k1.sinkAggregate.debtBalanceDelta;
  if (k1.sinkAggregate.notes.length) total.acquisitionNotes.push(...k1.sinkAggregate.notes);
  let totalAllocated = 0;
  for (const poolId of Object.keys(k1.ledger.pools)) totalAllocated += k1.ledger.pools[poolId].totalOut;
  const consumedByNonDeposit = Math.max(0, totalAllocated - k1.sinkAggregate.depositContribution);
  total.releasedCapital = Math.max(0, total.releasedCapital - consumedByNonDeposit);
  for (const i of k1.issues) issues.push({ deltaId: i.deltaId, deltaType: i.deltaType, severity: i.severity, message: i.message });
  // Surface ledger on the totals bag via a side-channel field for callers
  (total as DeltaEffect & { capitalLedger?: CapitalLedger }).capitalLedger = k1.ledger;

  const newGross = Math.max(0, ctx.baseInputs.grossAnnualIncome + total.incomeAdjustment);
  const hemDelta = computeHemTierDelta(
    ctx.baseInputs.grossAnnualIncome,
    newGross,
    ctx.baseInputs.monthlyLivingExpenses,
  );

  // Phase I1 — lender-aware shading. If a `dti_cap_change` delta carried a
  // `meta.lenderProfile`, fully re-shade the typed income components per
  // that lender's policy. The result REPLACES the additive shaded delta
  // (rather than stacking on top) so the math is unambiguous.
  const baseProfileId = ctx.baseInputs.currentLenderProfileId ?? BANK_STANDARD_PROFILE.id;
  const targetProfileId = total.lenderProfileOverride ?? baseProfileId;
  let computedShadedAnnual: number;
  if (
    total.lenderProfileOverride &&
    targetProfileId !== baseProfileId &&
    Array.isArray(ctx.baseInputs.incomeComponents) &&
    ctx.baseInputs.incomeComponents.length > 0
  ) {
    const targetProfile = resolveLenderProfile(targetProfileId);
    // Apply income_change adjustments proportionally across components so
    // the re-shade reflects the post-delta gross.
    const grossScale = ctx.baseInputs.grossAnnualIncome > 0
      ? newGross / ctx.baseInputs.grossAnnualIncome
      : 1;
    const scaledComponents: ScenarioIncomeComponent[] = ctx.baseInputs.incomeComponents.map(c => ({
      ...c,
      grossAnnual: Math.max(0, c.grossAnnual * grossScale),
    }));
    const reshaded = reshadeIncome(scaledComponents, targetProfile);
    computedShadedAnnual = reshaded.shadedAnnual;
    issues.push({
      deltaId: 'dti-cap',
      deltaType: 'dti_cap_change',
      severity: 'warning',
      message: `Lender flipped to "${targetProfile.displayName}" — income re-shaded to $${Math.round(computedShadedAnnual).toLocaleString()}/yr (was $${Math.round(ctx.baseInputs.shadedAnnualIncome).toLocaleString()}). Confirm 2yr history evidence before submission.`,
    });
  } else {
    computedShadedAnnual = Math.max(0, ctx.baseInputs.shadedAnnualIncome + total.shadedIncomeAdjustment);
  }

  // Phase I6 — Negative-gearing add-back. Mirrors `src/utils/scenarioDeltaEngine.ts`.
  const investmentProps = (ctx.properties || []).filter(p => {
    const t = (p.propertyType || '').toLowerCase();
    return t.includes('invest') || t.includes('rental') || t === 'investment';
  });
  // Phase I12 — pass APRA buffer so loss is recomputed at IO + buffer (assessment),
  // not the cheaper contracted rate. Mirrors `src/utils/scenarioDeltaEngine.ts`.
  const ngResult = computeNegativeGearingAddBack({
    investmentProperties: investmentProps,
    marginalTaxRate: marginalTaxRateFor(newGross),
    addBackShading: 1.0,
    bufferRatePct: ctx.baseInputs.bufferRate ?? 3,
  });
  if (ngResult.annualAddBack > 0) {
    computedShadedAnnual += ngResult.annualAddBack;
    total.acquisitionNotes.push(...ngResult.notes);
    issues.push({
      deltaId: 'negative-gearing',
      deltaType: 'income_change',
      severity: 'warning',
      message: ngResult.notes[0] ?? 'Negative-gearing add-back applied',
    });
  }

  // Phase I11 — DTI denominator refinement (APS 220-aligned). Compute the
  // adjusted denominator AND bind it into the DTI cap PATH on the server twin
  // so replay matches the UI (rental @ 75%, etc.).
  let dtiAdjustedIncome: number | undefined;
  if (Array.isArray(ctx.baseInputs.incomeComponents) && ctx.baseInputs.incomeComponents.length > 0) {
    const grossScale = ctx.baseInputs.grossAnnualIncome > 0 ? newGross / ctx.baseInputs.grossAnnualIncome : 1;
    const scaledForDti = ctx.baseInputs.incomeComponents.map(c => ({ ...c, grossAnnual: Math.max(0, c.grossAnnual * grossScale) }));
    const dtiDen = computeDtiDenominator({ incomeComponents: scaledForDti, fallbackGrossAnnual: newGross });
    dtiAdjustedIncome = dtiDen.dtiAdjustedAnnualIncome;
    if (dtiDen.dtiAdjustedAnnualIncome < newGross * 0.95 && dtiDen.dtiAdjustedAnnualIncome > 0) {
      issues.push({
        deltaId: 'dti-denominator',
        deltaType: 'income_change',
        severity: 'warning',
        message: `DTI denominator (APS 220): $${Math.round(dtiDen.dtiAdjustedAnnualIncome).toLocaleString()}/yr (${((dtiDen.dtiAdjustedAnnualIncome / newGross) * 100).toFixed(0)}% of gross). Bound into DTI cap path — capacity may be tighter than headline gross suggests.`,
      });
    }
  }

  // Phase I2 — HEM floor enforcement (mirror of client-side logic).
  const requestedExpenses = ctx.baseInputs.monthlyLivingExpenses + total.expenseAdjustment + hemDelta;
  const hemBenchmark = ctx.baseInputs.hemBenchmark ?? 0;
  const targetProfile = resolveLenderProfile(targetProfileId);
  let finalExpenses = Math.max(0, requestedExpenses);
  if (hemBenchmark > 0 && targetProfile.enforcesHemFloor && finalExpenses < hemBenchmark) {
    const expenseChangeDelta = ordered.find(d => d.type === 'expense_change');
    issues.push({
      deltaId: expenseChangeDelta?.id ?? 'expense_change',
      deltaType: 'expense_change',
      severity: 'warning',
      message: `Expense reduction floored at HEM benchmark $${Math.round(hemBenchmark).toLocaleString()}/mo (requested $${Math.round(requestedExpenses).toLocaleString()}). Banks use MAX(declared, HEM) — additional cuts below HEM do not improve capacity.`,
    });
    finalExpenses = hemBenchmark;
  }

  const inputs: AggregatedScenarioInputs = {
    grossAnnualIncome: newGross,
    shadedAnnualIncome: computedShadedAnnual,
    monthlyLivingExpenses: finalExpenses,
    monthlyCommitments: Math.max(0, ctx.baseInputs.monthlyCommitments + total.commitmentAdjustment),
    interestRate: Math.max(0.5, ctx.baseInputs.interestRate + total.rateAdjustment),
    bufferRate: ctx.baseInputs.bufferRate,
    loanTermYears: Math.max(5, ctx.baseInputs.loanTermYears + total.loanTermAdjustment),
    totalDebtBalances: Math.max(0, (ctx.baseInputs.totalDebtBalances || 0) + total.debtBalanceAdjustment),
    calculationMode: ctx.baseInputs.calculationMode,
    dtiCapEnabled: total.dtiCapEnabled ?? ctx.baseInputs.dtiCapEnabled,
    dtiCapLimit: total.dtiCapLimit ?? ctx.baseInputs.dtiCapLimit,
    // Phase I11 — surfaced for downstream consumers (server-side
    // calculateBorrowingCapacity reads this off-band where available).
    dtiAdjustedAnnualIncome: dtiAdjustedIncome,
  } as AggregatedScenarioInputs;

  // Phase I10 — Honest DTI: split debt moves into NEW (released) vs REMOVED
  // (sells/payoffs) and report explicitly. Surfaces APRA 6× / lender-cap
  // breaches as warnings on the issue stream so server replays match the UI.
  const debtMoves = splitDebtMoves(safeDeltas, ctx);
  const refinedDti = computeDti(
    {
      existingDebtBalances: Math.max(0, ctx.baseInputs.totalDebtBalances || 0),
      proposedLoanAmount: 0,
      releasedCapitalDebt: debtMoves.releasedCapitalDebt,
      debtRemovedByScenario: debtMoves.debtRemovedByScenario,
    },
    {
      incomeComponents: Array.isArray(ctx.baseInputs.incomeComponents) && ctx.baseInputs.incomeComponents.length > 0
        ? ctx.baseInputs.incomeComponents.map(c => ({ ...c, grossAnnual: Math.max(0, c.grossAnnual * (ctx.baseInputs.grossAnnualIncome > 0 ? newGross / ctx.baseInputs.grossAnnualIncome : 1)) }))
        : undefined,
      fallbackGrossAnnual: newGross,
    },
    ctx.baseInputs.dtiCapLimit,
  );
  if (refinedDti.exceedsApraTrigger || refinedDti.exceedsLenderCap) {
    issues.push({
      deltaId: 'dti-honest',
      deltaType: 'dti_cap_change',
      severity: 'warning',
      message: `Honest DTI ${refinedDti.dtiRatio.toFixed(2)}× ${refinedDti.exceedsApraTrigger ? '(>6× APRA trigger)' : ''}${refinedDti.exceedsLenderCap ? ` (>lender cap ${ctx.baseInputs.dtiCapLimit}×)` : ''}. Numerator $${Math.round(refinedDti.numerator).toLocaleString()} (existing+released−removed); denom $${Math.round(refinedDti.denominator).toLocaleString()}.`,
    });
  }

  return { inputs, effect: total, safeDeltas, issues };
}

/** Phase C: iteratively solve for the maximum purchase price.
 *  Mirrors `src/utils/scenarioDeltaEngine.ts::computeAcquisitionCapacity`. */
export function computeAcquisitionCapacity(
  borrowingCapacity: number,
  context: ScenarioContext,
  effect: DeltaEffect,
): AcquisitionCapacityResult {
  const acq = context.acquisition || {};
  const lmiMode: LmiMode = acq.lmiMode ?? 'display_deduction';
  const state: AustralianState = (acq.state ?? 'NSW') as AustralianState;
  const intent: PurchaseIntent = (acq.intent ?? 'investor') as PurchaseIntent;
  const category: PropertyCategory = (acq.category ?? 'established') as PropertyCategory;
  const isFhb = !!acq.isFirstHomeBuyer;
  const isForeign = !!acq.isForeignBuyer;
  const cashOnHand = Math.max(0, acq.cashOnHand ?? 0);

  const cashAvailable = cashOnHand + Math.max(0, effect.releasedCapital);
  const notes = [...effect.acquisitionNotes];

  // Phase I9 — wire I7 LVR cap matrix into the acquisition ceiling.
  const acqIntent = intent === 'owner_occupier' ? 'owner_occupier' : 'investment';
  const acqKind = category === 'vacant_land' ? 'vacant_land'
    : category === 'new' ? 'new_build'
    : 'established';
  const lvrCapResult = resolveLvrCap({
    lenderId: context.baseInputs.currentLenderProfileId,
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
  // The map P → newPrice(P) involves SD (piecewise-linear in P), LMI (piecewise
  // in LVR×loan), and other costs. In `debt_capitalised` mode the prior fixed
  // 6-iteration loop oscillated by ±$1–3k near LVR/SD breakpoints. Aitken
  // acceleration uses three successive iterates (P0, P1=f(P0), P2=f(P1)) to
  // estimate the limit:  P* ≈ P0 − (P1−P0)² / (P2 − 2·P1 + P0)
  // — collapsing oscillations in 2–3 outer steps. We fall back to plain
  // iteration if the denominator is ~0 (already converged).
  let purchasePrice = borrowingCapacity + cashAvailable;
  let lmi = 0;
  let stampDuty = 0;
  let otherCosts = 0;
  let loanAvail = borrowingCapacity;
  let loanCappedByLvr = false;

  const stepFn = (P: number): number => {
    const sd = calculateStampDuty({
      propertyValue: P, state, intent, category,
      isFirstHomeBuyer: isFhb, isForeignBuyer: isForeign,
    });
    stampDuty = sd.totalDuty;
    otherCosts = estimateOtherAcquisitionCosts(P).total;
    const requiredLoan = Math.max(0, P - cashAvailable);
    const lvrCapDollar = Math.max(0, P * acquisitionLvrCap);
    const cappedLoan = Math.min(borrowingCapacity, requiredLoan, lvrCapDollar);
    if (lvrCapDollar < Math.min(borrowingCapacity, requiredLoan)) {
      loanCappedByLvr = true;
    }
    if (lmiMode !== 'none') {
      const est = estimateLmi({ propertyValue: P, loanAmount: cappedLoan, isFirstHomeBuyer: isFhb });
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
    // Aitken accelerator (with safety fallback to last plain iterate)
    const Pstar = Math.abs(denom) > 1
      ? P0 - ((P1 - P0) * (P1 - P0)) / denom
      : P2;
    // Damp if accelerator overshoots negative or > 2× last value
    purchasePrice = (Pstar > 0 && Pstar < P2 * 2) ? Pstar : P2;
    if (Math.abs(purchasePrice - P2) < 250) break;
  }
  // One final settle-pass to refresh stampDuty/lmi/loanAvail at the converged P
  purchasePrice = stepFn(purchasePrice);

  if (lmi > 0) notes.push(`LMI ${lmiMode === 'debt_capitalised' ? 'capitalised onto loan' : 'deducted from settlement cash'}: $${Math.round(lmi).toLocaleString()}`);
  if (stampDuty > 0) notes.push(`${state} stamp duty: $${Math.round(stampDuty).toLocaleString()} (${intent}${isFhb ? ', FHB' : ''})`);
  if (otherCosts > 0) notes.push(`Acquisition costs: $${Math.round(otherCosts).toLocaleString()}`);
  // Phase I9 — surface the binding LVR cap
  notes.push(`Acquisition LVR cap (${lvrCapResult.matrix.lenderId}, ${acqIntent}, ${acqKind}): ${(acquisitionLvrCap * 100).toFixed(0)}% — ${lvrCapResult.reason}`);
  if (loanCappedByLvr) {
    notes.push(`⚠ Acquisition loan clamped by LVR cap — serviceable capacity exceeded the ${(acquisitionLvrCap * 100).toFixed(0)}% per-security ceiling.`);
  }

  // Phase F2 — target-solving
  const target = acq.targetPurchasePrice && acq.targetPurchasePrice > 0 ? acq.targetPurchasePrice : undefined;
  let loanRequiredForPurchase: number | undefined;
  let netCashAfterSettlement: number | undefined;
  let meetsTarget: boolean | undefined;
  let shortfallToTarget: number | undefined;

  if (target !== undefined) {
    const sdT = calculateStampDuty({
      propertyValue: target, state, intent, category,
      isFirstHomeBuyer: isFhb, isForeignBuyer: isForeign,
    });
    const otherT = estimateOtherAcquisitionCosts(target).total;
    const requiredLoanRaw = Math.max(0, target - cashAvailable);
    // Phase I9 — clamp by LVR cap on the target price
    const lvrCapDollarTarget = Math.max(0, target * acquisitionLvrCap);
    const cappedRequiredLoan = Math.min(requiredLoanRaw, lvrCapDollarTarget);
    let lmiAtTarget = 0;
    if (lmiMode !== 'none') {
      const estT = estimateLmi({ propertyValue: target, loanAmount: cappedRequiredLoan, isFirstHomeBuyer: isFhb });
      lmiAtTarget = estT.lmiAmount;
    }
    const lmiCashAtTarget = lmiMode === 'display_deduction' ? lmiAtTarget : 0;
    loanRequiredForPurchase = lmiMode === 'debt_capitalised'
      ? cappedRequiredLoan + lmiAtTarget
      : cappedRequiredLoan;
    netCashAfterSettlement = cashAvailable
      - Math.max(0, target - (loanRequiredForPurchase ?? 0))
      - lmiCashAtTarget - sdT.totalDuty - otherT;
    meetsTarget = (loanRequiredForPurchase ?? 0) <= borrowingCapacity
      && cappedRequiredLoan >= requiredLoanRaw
      && netCashAfterSettlement >= 0;
    shortfallToTarget = Math.max(0, target - Math.max(0, purchasePrice));

    if (cappedRequiredLoan < requiredLoanRaw) {
      loanCappedByLvr = true;
      notes.push(`⚠ Target $${Math.round(target).toLocaleString()} requires loan > LVR cap (${(acquisitionLvrCap * 100).toFixed(0)}% × $${Math.round(target).toLocaleString()} = $${Math.round(lvrCapDollarTarget).toLocaleString()}). Increase deposit by $${Math.round(requiredLoanRaw - cappedRequiredLoan).toLocaleString()} to settle.`);
    }
    if (meetsTarget) {
      notes.push(
        `✅ Target $${Math.round(target).toLocaleString()} achievable: needs loan $${Math.round(loanRequiredForPurchase!).toLocaleString()} (capacity $${Math.round(borrowingCapacity).toLocaleString()}); net cash post-settlement $${Math.round(netCashAfterSettlement).toLocaleString()}.`
      );
    } else {
      const loanShort = Math.max(0, (loanRequiredForPurchase ?? 0) - borrowingCapacity);
      const cashShort = Math.max(0, -(netCashAfterSettlement ?? 0));
      notes.push(
        `⚠️ Target $${Math.round(target).toLocaleString()} short: ${loanShort > 0 ? `loan short $${Math.round(loanShort).toLocaleString()}` : ''}${loanShort > 0 && cashShort > 0 ? ', ' : ''}${cashShort > 0 ? `cash short $${Math.round(cashShort).toLocaleString()}` : ''}.`
      );
    }
  } else {
    loanRequiredForPurchase = Math.max(0, Math.max(0, purchasePrice) - cashAvailable);
    netCashAfterSettlement = 0;
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
