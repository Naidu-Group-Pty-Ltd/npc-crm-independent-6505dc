/**
 * AI Scenario → Engine Preview
 *
 * Converts the AI tool-call payload (`AIScenario.adjustments`) into the same
 * `ScenarioDelta[]` shape that the Strategy Builder produces, runs them
 * through the unified scenario engine, and returns an `engineValidation`
 * block per scenario. This way the cards in the chat show ENGINE TRUTH
 * (capacity, meetsTarget, shortfall, loanRequired, netCash) BEFORE the
 * broker clicks Apply — eliminating the gap where the AI estimated impact
 * differed from what the engine actually computed post-Apply.
 */

import {
  aggregateDeltas,
  computeAcquisitionCapacity,
  type ScenarioDelta,
  type ScenarioContext,
  type ScenarioProperty,
  type ScenarioLiability,
  type AcquisitionContext,
} from '../_shared/scenarioDeltaEngine.ts';

// ── Local BC kernel (mirrors calculate-borrowing-capacity formula) ────
// Directional replay for the chat preview — the post-Apply engine produces
// the canonical number. This kernel matches the same APRA surplus → P&I
// amortisation formula used everywhere else in the app.

import { getTaxBreakdown } from './tax.ts';

interface BcParams {
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
  /** APS 220-adjusted DTI denominator emitted by aggregateDeltas. */
  dtiAdjustedAnnualIncome?: number;
}

interface BcResult {
  borrowingCapacity: number;
  monthlySurplus: number;
  serviceabilityBand: 'green' | 'amber' | 'red';
  dtiRatio: number;
}

function calculateBorrowingCapacity(p: BcParams): BcResult {
  const assessableIncome = p.shadedAnnualIncome > 0 ? p.shadedAnnualIncome : p.grossAnnualIncome;
  const tax = getTaxBreakdown(assessableIncome);
  const monthlyAfterTax = tax.afterTaxIncome / 12;
  const isConservative = p.calculationMode === 'conservative';
  let monthlySurplus = monthlyAfterTax - p.monthlyLivingExpenses - p.monthlyCommitments;

  // Mirror the browser calculator's conservative-mode floor so the AI card
  // preview never overstates capacity relative to the post-Apply summary.
  if (isConservative) {
    monthlySurplus *= 0.85;
    if (monthlySurplus < 1000) monthlySurplus = 0;
    const residualIncome = monthlyAfterTax - p.monthlyCommitments;
    if (residualIncome < 1500) {
      monthlySurplus = Math.max(0, monthlySurplus - (1500 - residualIncome));
    }
  }

  const assessmentRate = p.interestRate + p.bufferRate;
  const monthlyRate = (assessmentRate / 100) / 12;
  const periods = p.loanTermYears * 12;
  const maxRepayment = Math.max(0, monthlySurplus);
  let capacity = 0;
  if (monthlyRate > 0 && maxRepayment > 0) {
    const factor = (1 - Math.pow(1 + monthlyRate, -periods)) / monthlyRate;
    capacity = Math.round(maxRepayment * factor);
  }

  const dtiDenominator = p.dtiAdjustedAnnualIncome && p.dtiAdjustedAnnualIncome > 0
    ? p.dtiAdjustedAnnualIncome
    : p.grossAnnualIncome;
  let dtiRatio = dtiDenominator > 0
    ? Math.round(((p.totalDebtBalances + capacity) / dtiDenominator) * 100) / 100
    : 0;

  const dtiCap = isConservative ? 6 : (p.dtiCapLimit ?? 6);
  const shouldApplyDtiCap = !!p.dtiCapEnabled || isConservative;
  if (shouldApplyDtiCap && dtiRatio > dtiCap && dtiDenominator > 0) {
    const maxTotalDebt = dtiDenominator * dtiCap;
    capacity = Math.max(0, Math.round(maxTotalDebt - p.totalDebtBalances));
    dtiRatio = Math.round(((p.totalDebtBalances + capacity) / dtiDenominator) * 100) / 100;
  }

  let band: 'green' | 'amber' | 'red';
  if (monthlySurplus > 1000 && dtiRatio < 5) band = 'green';
  else if (monthlySurplus > 0 && dtiRatio < 7) band = 'amber';
  else band = 'red';

  return { borrowingCapacity: capacity, monthlySurplus: Math.round(monthlySurplus), serviceabilityBand: band, dtiRatio };
}

// ── Types mirroring the AI tool schema ────────────────────────────────

interface AIAdjustments {
  consolidatedLiabilityIds?: string[];
  refinancedToIOPropertyIds?: string[];
  rateAdjustment?: number;
  incomeGrowthPercent?: number;
  expenseReductionPercent?: number;
  loanTermAdjustment?: number;
  portfolioSellPropertyIds?: string[];
  equityRelease?: { propertyId: string; targetLVR: number } | null;
  dtiCapOverride?: { enabled: boolean; value: number; lenderProfile?: string } | null;
  /** Phase I1 — explicit lender profile flip (independent of dtiCapOverride). */
  lenderProfile?: 'bank_standard' | 'anz' | 'macquarie' | 'westpac' | 'non_bank' | null;
  propertyRateChanges?: Array<{ propertyId: string; newRate: number }>;
  valuationOverrides?: Array<{
    propertyId: string;
    newValue: number;
    basis: 'manual' | 'desktop' | 'avm' | 'comparable_sales';
    source?: string;
  }>;
  crossCollatPool?: {
    enabled: boolean;
    propertyIds: string[];
    blendedTargetLVR: number;
    lenderMaxLVR?: number;
    allocationStrategy?: 'highest_equity_first' | 'pro_rata';
  } | null;
  acquisition?: AcquisitionContext | null;
  /** Phase K3 — explicit capital allocations routed via the K1 ledger.
   *  Each entry consumes from the default capital pool (equity release +
   *  cash-on-hand) and routes into a typed sink. */
  capitalAllocations?: Array<{
    amount: number;
    sinkType:
      | 'liability_payoff'
      | 'offset_deposit'
      | 'rate_buydown'
      | 'debt_recycle'
      | 'acquisition_deposit'
      | 'holding_reserve'
      | 'repayment_reduction';
    sinkTargetId?: string;
    offsetRatePoints?: number;
    rateBuydownPoints?: number;
    repaymentReductionMonthly?: number;
  }>;
}

export interface AIScenario {
  name: string;
  reasoning: string;
  adjustments: AIAdjustments;
  estimatedImpact: string;
  /** Phase J1 — levers the model considered but discarded, with reasons. */
  rejectedLevers?: Array<{ lever: string; reason: string }>;
  /** Phase J1 — execution risk profile so brokers can triage at a glance. */
  executionRisk?: 'low' | 'medium' | 'high';
  /** Phase J2 — concrete evidence the broker must collect to defend the scenario
   *  to the finance team (e.g. "2 most recent payslips", "Tenancy ledger 12mo",
   *  "Discharge confirmation from Latitude"). 1–5 items, ordered by criticality. */
  evidenceRequired?: string[];
  engineValidation?: EngineValidation;
}

export interface EngineValidation {
  borrowingCapacity: number;
  capacityChange: number;
  monthlySurplus: number;
  serviceabilityBand: 'green' | 'amber' | 'red';
  dtiRatio: number;
  meetsTarget?: boolean;
  shortfallToTarget?: number;
  maxPurchasePrice?: number;
  loanRequiredForPurchase?: number;
  netCashAfterSettlement?: number;
  releasedCapital?: number;
  targetPurchasePrice?: number;
  validationIssues: Array<{ deltaId: string; deltaType: string; severity: string; message: string }>;
}

// ── AI → ScenarioDelta[] converter ─────────────────────────────────────

/**
 * Mirrors the converter in `StrategyScenarioModeling.tsx` so the chat
 * preview produces an identical delta list to what the user sees after
 * clicking Apply. Both client and server engines are parity-tested, so
 * the numbers will match exactly.
 */
export function adjustmentsToDeltas(adj: AIAdjustments): ScenarioDelta[] {
  // Phase J1: Hard clamps + soft-cap warnings (mutated onto the scenario by
  // the caller after aggregation; collected here for downstream surfacing).
  const SOFT_CAPS = {
    incomeGrowthPercent: 25,
    expenseReductionPercent: 30,
    equityReleaseLVR: 0.90,
  };

  // Defensive clamp helper — never mutate the caller's object directly.
  const clampedAdj: AIAdjustments = JSON.parse(JSON.stringify(adj || {}));

  if (typeof clampedAdj.incomeGrowthPercent === 'number' && clampedAdj.incomeGrowthPercent > SOFT_CAPS.incomeGrowthPercent) {
    console.warn(`[adjustmentsToDeltas] Clamped incomeGrowthPercent ${clampedAdj.incomeGrowthPercent} → ${SOFT_CAPS.incomeGrowthPercent}`);
    clampedAdj.incomeGrowthPercent = SOFT_CAPS.incomeGrowthPercent;
  }
  if (typeof clampedAdj.expenseReductionPercent === 'number' && clampedAdj.expenseReductionPercent > SOFT_CAPS.expenseReductionPercent) {
    console.warn(`[adjustmentsToDeltas] Clamped expenseReductionPercent ${clampedAdj.expenseReductionPercent} → ${SOFT_CAPS.expenseReductionPercent}`);
    clampedAdj.expenseReductionPercent = SOFT_CAPS.expenseReductionPercent;
  }
  if (clampedAdj.equityRelease && typeof clampedAdj.equityRelease.targetLVR === 'number' && clampedAdj.equityRelease.targetLVR > SOFT_CAPS.equityReleaseLVR) {
    console.warn(`[adjustmentsToDeltas] Clamped equityRelease.targetLVR ${clampedAdj.equityRelease.targetLVR} → ${SOFT_CAPS.equityReleaseLVR}`);
    clampedAdj.equityRelease = { ...clampedAdj.equityRelease, targetLVR: SOFT_CAPS.equityReleaseLVR };
  }
  if (clampedAdj.crossCollatPool && typeof clampedAdj.crossCollatPool.blendedTargetLVR === 'number' && clampedAdj.crossCollatPool.blendedTargetLVR > SOFT_CAPS.equityReleaseLVR) {
    console.warn(`[adjustmentsToDeltas] Clamped crossCollatPool.blendedTargetLVR ${clampedAdj.crossCollatPool.blendedTargetLVR} → ${SOFT_CAPS.equityReleaseLVR}`);
    clampedAdj.crossCollatPool = { ...clampedAdj.crossCollatPool, blendedTargetLVR: SOFT_CAPS.equityReleaseLVR };
  }

  const adjUsed = clampedAdj;
  const deltas: ScenarioDelta[] = [];

  // 1. Liability payoffs
  for (const id of adjUsed.consolidatedLiabilityIds || []) {
    deltas.push({
      id,
      label: `Pay off liability ${id}`,
      type: 'liability_payoff',
      value: 0,
      unit: 'absolute',
    });
  }

  // 2. Property → IO refinance
  for (const id of adjUsed.refinancedToIOPropertyIds || []) {
    deltas.push({
      id,
      label: `Refinance ${id} to IO`,
      type: 'property_refinance',
      value: 0,
      unit: 'absolute',
    });
  }

  // 3. Portfolio sell
  for (const id of adjUsed.portfolioSellPropertyIds || []) {
    deltas.push({
      id,
      label: `Sell ${id}`,
      type: 'property_sell',
      value: 0,
      unit: 'absolute',
    });
  }

  // 4. Income change
  if (adjUsed.incomeGrowthPercent && Math.abs(adjUsed.incomeGrowthPercent) > 0.001) {
    deltas.push({
      id: `income-${adjUsed.incomeGrowthPercent}`,
      label: `Income ${adjUsed.incomeGrowthPercent > 0 ? '+' : ''}${adjUsed.incomeGrowthPercent}%`,
      type: 'income_change',
      value: adjUsed.incomeGrowthPercent,
      unit: 'percent',
    });
  }

  // 5. Expense reduction
  if (adjUsed.expenseReductionPercent && adjUsed.expenseReductionPercent > 0.001) {
    deltas.push({
      id: `expense-${adjUsed.expenseReductionPercent}`,
      label: `Reduce expenses ${adjUsed.expenseReductionPercent}%`,
      type: 'expense_change',
      value: -adjUsed.expenseReductionPercent,
      unit: 'percent',
    });
  }

  // 6. Loan term
  if (adjUsed.loanTermAdjustment && Math.abs(adjUsed.loanTermAdjustment) > 0) {
    deltas.push({
      id: `loan-term-${adjUsed.loanTermAdjustment}`,
      label: `Loan term ${adjUsed.loanTermAdjustment > 0 ? '+' : ''}${adjUsed.loanTermAdjustment}yr`,
      type: 'loan_term_change',
      value: adjUsed.loanTermAdjustment,
      unit: 'years',
    });
  }

  // 7. Global rate adjustment
  if (adjUsed.rateAdjustment && Math.abs(adjUsed.rateAdjustment) > 0.001) {
    deltas.push({
      id: `rate-${adjUsed.rateAdjustment}`,
      label: `Rates ${adjUsed.rateAdjustment >= 0 ? '+' : ''}${adjUsed.rateAdjustment}%`,
      type: 'rate_change',
      value: adjUsed.rateAdjustment,
      unit: 'rate_points',
    });
  }

  // 8. Per-property rate changes (Phase F1)
  for (const change of adjUsed.propertyRateChanges || []) {
    if (Number.isFinite(change.newRate) && change.newRate > 0) {
      deltas.push({
        id: change.propertyId,
        label: `Reprice ${change.propertyId} → ${change.newRate}%`,
        type: 'property_rate_change',
        value: change.newRate,
        unit: 'rate_points',
      });
    }
  }

  // 9. Valuation overrides (Phase G1) — must resolve before equity release
  for (const vo of adjUsed.valuationOverrides || []) {
    if (Number.isFinite(vo.newValue) && vo.newValue > 0) {
      deltas.push({
        id: vo.propertyId,
        label: `Revalue ${vo.propertyId} → ${vo.newValue}`,
        type: 'property_value_change',
        value: vo.newValue,
        unit: 'absolute',
        meta: { basis: vo.basis, source: vo.source ?? '' },
      });
    }
  }

  // 10. Single-property equity release
  if (adjUsed.equityRelease && adjUsed.equityRelease.propertyId && Number.isFinite(adjUsed.equityRelease.targetLVR)) {
    deltas.push({
      id: adjUsed.equityRelease.propertyId,
      label: `Equity release ${adjUsed.equityRelease.propertyId} → ${(adjUsed.equityRelease.targetLVR * 100).toFixed(0)}% LVR`,
      type: 'equity_release',
      value: adjUsed.equityRelease.targetLVR,
      unit: 'percent',
      meta: { targetLVR: adjUsed.equityRelease.targetLVR },
    });
  }

  // 11. Cross-collat pool (Phase G2)
  if (adjUsed.crossCollatPool && adjUsed.crossCollatPool.enabled && adjUsed.crossCollatPool.propertyIds?.length > 0) {
    deltas.push({
      id: 'pool-default',
      label: `Cross-collat pool → ${(adjUsed.crossCollatPool.blendedTargetLVR * 100).toFixed(0)}% blended LVR`,
      type: 'portfolio_lvr_release',
      value: adjUsed.crossCollatPool.blendedTargetLVR,
      unit: 'ratio',
      meta: {
        propertyIds: adjUsed.crossCollatPool.propertyIds,
        lenderMaxLVR: adjUsed.crossCollatPool.lenderMaxLVR ?? null,
        allocationStrategy: adjUsed.crossCollatPool.allocationStrategy ?? 'highest_equity_first',
      },
    });
  }

  // 12. DTI cap override + lender profile flip (Phase I1)
  const lenderProfile = adjUsed.lenderProfile ?? adjUsed.dtiCapOverride?.lenderProfile;
  if (adjUsed.dtiCapOverride && adjUsed.dtiCapOverride.enabled && Number.isFinite(adjUsed.dtiCapOverride.value)) {
    deltas.push({
      id: 'dti-cap',
      label: `DTI cap ${adjUsed.dtiCapOverride.value}x${lenderProfile ? ` (${lenderProfile})` : ''}`,
      type: 'dti_cap_change',
      value: adjUsed.dtiCapOverride.value,
      unit: 'ratio',
      meta: lenderProfile
        ? { enabled: true, lenderProfile }
        : { enabled: true },
    });
  } else if (lenderProfile) {
    // Lender flip without DTI cap change — still emit a dti_cap_change so the
    // engine triggers re-shading. Keep cap large enough to be non-binding.
    deltas.push({
      id: 'dti-cap',
      label: `Lender flip → ${lenderProfile}`,
      type: 'dti_cap_change',
      value: 99,
      unit: 'ratio',
      meta: { enabled: false, lenderProfile },
    });
  }

  // 13. Phase K3 — Capital allocations (route pool $ into typed sinks)
  for (let i = 0; i < (adjUsed.capitalAllocations || []).length; i++) {
    const alloc = adjUsed.capitalAllocations![i];
    if (!alloc || !Number.isFinite(alloc.amount) || alloc.amount <= 0 || !alloc.sinkType) continue;
    deltas.push({
      id: `cap-alloc-${i}-${alloc.sinkType}`,
      label: `Allocate $${Math.round(alloc.amount).toLocaleString()} → ${alloc.sinkType.replace(/_/g, ' ')}`,
      type: 'capital_allocation',
      value: alloc.amount,
      unit: 'absolute',
      meta: {
        sinkType: alloc.sinkType,
        sinkTargetId: alloc.sinkTargetId,
        sourcePool: 'pool-default',
        offsetRatePoints: alloc.offsetRatePoints,
        rateBuydownPoints: alloc.rateBuydownPoints,
        repaymentReductionMonthly: alloc.repaymentReductionMonthly,
      },
    });
  }

  return deltas;
}

// ── Build a ScenarioContext from the chat client snapshot ──────────────

interface ChatClientContext {
  baseInputs: any;
  baseResult: any;
  liabilities: Array<{ id: string; type: string; label: string; balance: number; limit?: number; monthlyServicing: number }>;
  properties: Array<{
    id: string;
    address: string;
    property_type: string;
    current_value: number;
    loan_remaining: number;
    monthly_interest_repayment?: number;
    loan_repayment_amount?: number;
    net_monthly_cashflow?: number;
    interest_rate?: number;
  }>;
  /** Phase I1 — typed income components for lender-aware re-shading. */
  incomeComponents?: Array<{ id: string; label: string; type: string; grossAnnual: number; currentShadingRate: number }>;
  /** Phase I1 — current lender profile id (defaults to bank_standard). */
  currentLenderProfileId?: string;
  /** Phase I2 — monthly HEM benchmark; engine floors expenses here. */
  hemBenchmark?: number;
}

export function buildScenarioContext(
  client: ChatClientContext,
  acquisition?: AcquisitionContext | null,
): ScenarioContext {
  const properties: ScenarioProperty[] = (client.properties || []).map(p => ({
    id: p.id,
    address: p.address,
    propertyType: p.property_type,
    currentValue: p.current_value || 0,
    loanRemaining: p.loan_remaining || 0,
    monthlyRepayment: p.monthly_interest_repayment || 0,
    loanRepaymentAmount: p.loan_repayment_amount ?? p.monthly_interest_repayment ?? 0,
    netMonthlyCashflow: p.net_monthly_cashflow ?? 0,
    interestRate: p.interest_rate,
  }));

  const liabilities: ScenarioLiability[] = (client.liabilities || []).map(l => ({
    id: l.id,
    type: l.type,
    label: l.label,
    balance: Number(l.balance) || 0,
    limit: l.limit,
    monthlyServicing: Number(l.monthlyServicing) || 0,
  }));

  return {
    baseInputs: {
      grossAnnualIncome: Number(client.baseInputs?.grossAnnualIncome || 0),
      shadedAnnualIncome: Number(client.baseInputs?.shadedAnnualIncome || 0),
      monthlyLivingExpenses: Number(client.baseInputs?.monthlyLivingExpenses || 0),
      monthlyCommitments: Number(client.baseInputs?.monthlyCommitments || 0),
      interestRate: Number(client.baseInputs?.interestRate || 0),
      bufferRate: Number(client.baseInputs?.bufferRate || 3),
      loanTermYears: Number(client.baseInputs?.loanTermYears || 30),
      totalDebtBalances: Number(client.baseInputs?.totalDebtBalances || 0),
      calculationMode: client.baseInputs?.calculationMode,
      dtiCapEnabled: !!client.baseInputs?.dtiCapEnabled,
      dtiCapLimit: Number(client.baseInputs?.dtiCapLimit || 6),
      // Phase I1/I2 — propagate so re-shading + HEM clamp behave identically
      // to the client engine. ScenarioBaseInputs already declares these fields.
      incomeComponents: Array.isArray(client.incomeComponents)
        ? client.incomeComponents as any
        : undefined,
      currentLenderProfileId: client.currentLenderProfileId,
      hemBenchmark: Number(client.hemBenchmark) > 0 ? Number(client.hemBenchmark) : undefined,
    },
    baseResult: {
      borrowingCapacity: Number(client.baseResult?.borrowingCapacity || 0),
      monthlySurplus: Number(client.baseResult?.monthlySurplus || 0),
      serviceabilityBand: (client.baseResult?.serviceabilityBand || 'red') as 'green' | 'amber' | 'red',
      dtiRatio: Number(client.baseResult?.dtiRatio || 0),
    },
    properties,
    liabilities,
    acquisition: acquisition ?? undefined,
  };
}

// ── Run the AI scenarios through the engine ────────────────────────────

export function validateAIScenarios(
  scenarios: AIScenario[],
  client: ChatClientContext,
  inferredTargetPrice?: number,
): AIScenario[] {
  return scenarios.map(scenario => {
    try {
      // Resolve the acquisition context — patch missing targetPurchasePrice
      // when we detected one in the user message.
      let acq: AcquisitionContext | null = null;
      if (scenario.adjustments.acquisition) {
        acq = { ...scenario.adjustments.acquisition };
        if ((!acq.targetPurchasePrice || acq.targetPurchasePrice <= 0) && inferredTargetPrice) {
          acq.targetPurchasePrice = inferredTargetPrice;
        }
      } else if (inferredTargetPrice) {
        // AI omitted acquisition entirely — synthesise a sane default.
        acq = {
          state: 'NSW',
          intent: 'investor',
          category: 'established',
          isFirstHomeBuyer: (client.properties?.length || 0) === 0,
          lmiMode: 'display_deduction',
          cashOnHand: 0,
          targetPurchasePrice: inferredTargetPrice,
        };
      }

      const ctx = buildScenarioContext(client, acq);
      const deltas = adjustmentsToDeltas(scenario.adjustments);
      const { inputs, effect, issues } = aggregateDeltas(scenario.name, deltas, ctx);

      // Phase J1: detect soft-cap clamps and surface as validation notes so
      // the broker sees inline that the model overshot a guardrail.
      const clampIssues: typeof issues = [];
      const a = scenario.adjustments || ({} as AIAdjustments);
      if (typeof a.incomeGrowthPercent === 'number' && a.incomeGrowthPercent > 25) {
        clampIssues.push({ deltaId: 'income_change', deltaType: 'income_change', severity: 'warn', message: `Income growth clamped to 25% (model proposed ${a.incomeGrowthPercent}%) — needs payslip evidence to defend higher.` });
      }
      if (typeof a.expenseReductionPercent === 'number' && a.expenseReductionPercent > 30) {
        clampIssues.push({ deltaId: 'expense_change', deltaType: 'expense_change', severity: 'warn', message: `Expense reduction clamped to 30% (model proposed ${a.expenseReductionPercent}%) — HEM floor will likely bite anyway.` });
      }
      if (a.equityRelease && typeof a.equityRelease.targetLVR === 'number' && a.equityRelease.targetLVR > 0.90) {
        clampIssues.push({ deltaId: 'equity_release', deltaType: 'equity_release', severity: 'warn', message: `Equity release LVR clamped to 90% (model proposed ${(a.equityRelease.targetLVR * 100).toFixed(0)}%) — most lenders cap below this without LMI.` });
      }
      if (a.crossCollatPool && typeof a.crossCollatPool.blendedTargetLVR === 'number' && a.crossCollatPool.blendedTargetLVR > 0.90) {
        clampIssues.push({ deltaId: 'portfolio_lvr_release', deltaType: 'portfolio_lvr_release', severity: 'warn', message: `Cross-collat blended LVR clamped to 90% (model proposed ${(a.crossCollatPool.blendedTargetLVR * 100).toFixed(0)}%).` });
      }

      // Phase K4 — guardrails on capital allocations
      if (Array.isArray(a.capitalAllocations) && a.capitalAllocations.length > 0) {
        const totalAlloc = a.capitalAllocations.reduce((s, x) => s + Math.max(0, Number(x?.amount) || 0), 0);
        // Estimate the source pool: equity release + cross-collat release + cash on hand
        let estPool = 0;
        if (a.equityRelease && a.equityRelease.propertyId) {
          const prop = client.properties?.find(p => p.id === a.equityRelease!.propertyId);
          if (prop) estPool += Math.max(0, (prop.current_value || 0) * a.equityRelease.targetLVR - (prop.loan_remaining || 0));
        }
        if (a.crossCollatPool?.enabled && a.crossCollatPool.propertyIds?.length) {
          const memberValue = a.crossCollatPool.propertyIds.reduce((s, pid) => {
            const p = client.properties?.find(pp => pp.id === pid);
            return s + (p?.current_value || 0);
          }, 0);
          const memberLoan = a.crossCollatPool.propertyIds.reduce((s, pid) => {
            const p = client.properties?.find(pp => pp.id === pid);
            return s + (p?.loan_remaining || 0);
          }, 0);
          estPool += Math.max(0, memberValue * a.crossCollatPool.blendedTargetLVR - memberLoan);
        }
        if (a.acquisition?.cashOnHand) estPool += Math.max(0, a.acquisition.cashOnHand);
        if (estPool > 0 && totalAlloc > estPool * 1.01) {
          clampIssues.push({
            deltaId: 'capital_allocation',
            deltaType: 'capital_allocation',
            severity: 'error',
            message: `Capital allocations $${Math.round(totalAlloc).toLocaleString()} exceed estimated pool $${Math.round(estPool).toLocaleString()}. Engine will clamp each sink at its share of remainder.`,
          });
        }
        // Validate sink targets exist
        for (const alloc of a.capitalAllocations) {
          if (!alloc?.sinkType) continue;
          const needsLiab = alloc.sinkType === 'liability_payoff';
          const needsProp = ['offset_deposit', 'rate_buydown', 'debt_recycle', 'repayment_reduction'].includes(alloc.sinkType);
          if (needsLiab && (!alloc.sinkTargetId || !client.liabilities?.some(l => l.id === alloc.sinkTargetId))) {
            clampIssues.push({ deltaId: 'capital_allocation', deltaType: 'capital_allocation', severity: 'warn', message: `liability_payoff allocation missing or invalid sinkTargetId — engine will skip the servicing reduction.` });
          }
          if (needsProp && (!alloc.sinkTargetId || !client.properties?.some(p => p.id === alloc.sinkTargetId))) {
            clampIssues.push({ deltaId: 'capital_allocation', deltaType: 'capital_allocation', severity: 'warn', message: `${alloc.sinkType} allocation missing or invalid sinkTargetId — engine will skip the effect.` });
          }
        }
      }

      const result = calculateBorrowingCapacity({
        grossAnnualIncome: inputs.grossAnnualIncome,
        shadedAnnualIncome: inputs.shadedAnnualIncome,
        monthlyLivingExpenses: inputs.monthlyLivingExpenses,
        monthlyCommitments: inputs.monthlyCommitments,
        interestRate: inputs.interestRate,
        bufferRate: inputs.bufferRate,
        loanTermYears: inputs.loanTermYears,
        totalDebtBalances: inputs.totalDebtBalances,
        calculationMode: inputs.calculationMode,
        dtiCapEnabled: inputs.dtiCapEnabled,
        dtiCapLimit: inputs.dtiCapLimit,
        dtiAdjustedAnnualIncome: inputs.dtiAdjustedAnnualIncome,
      });

      const acquisitionCapacity = ctx.acquisition
        ? computeAcquisitionCapacity(result.borrowingCapacity, ctx, effect)
        : null;

      // Mutate the scenario in place — also persist the patched acquisition
      // so the front-end Apply flow uses the same target.
      if (acq) {
        scenario.adjustments.acquisition = acq;
      }

      // Phase J1: Persist clamped values back so the front-end Apply flow
      // pushes the SAME numbers into the strategy levers (no drift between
      // preview and post-Apply state).
      if (typeof a.incomeGrowthPercent === 'number' && a.incomeGrowthPercent > 25) {
        scenario.adjustments.incomeGrowthPercent = 25;
      }
      if (typeof a.expenseReductionPercent === 'number' && a.expenseReductionPercent > 30) {
        scenario.adjustments.expenseReductionPercent = 30;
      }
      if (a.equityRelease && typeof a.equityRelease.targetLVR === 'number' && a.equityRelease.targetLVR > 0.90) {
        scenario.adjustments.equityRelease = { ...a.equityRelease, targetLVR: 0.90 };
      }
      if (a.crossCollatPool && typeof a.crossCollatPool.blendedTargetLVR === 'number' && a.crossCollatPool.blendedTargetLVR > 0.90) {
        scenario.adjustments.crossCollatPool = { ...a.crossCollatPool, blendedTargetLVR: 0.90 };
      }

      const validation: EngineValidation = {
        borrowingCapacity: Math.round(result.borrowingCapacity),
        capacityChange: Math.round(result.borrowingCapacity - ctx.baseResult.borrowingCapacity),
        monthlySurplus: Math.round(result.monthlySurplus),
        serviceabilityBand: result.serviceabilityBand,
        dtiRatio: Number(result.dtiRatio?.toFixed(2) ?? 0),
        meetsTarget: acquisitionCapacity?.meetsTarget,
        shortfallToTarget: acquisitionCapacity?.shortfallToTarget,
        maxPurchasePrice: acquisitionCapacity?.maxPurchasePrice,
        loanRequiredForPurchase: acquisitionCapacity?.loanRequiredForPurchase,
        netCashAfterSettlement: acquisitionCapacity?.netCashAfterSettlement,
        releasedCapital: acquisitionCapacity?.releasedCapital,
        targetPurchasePrice: acquisitionCapacity?.targetPurchasePrice,
        validationIssues: [...issues, ...clampIssues],
      };

      scenario.engineValidation = validation;
      return scenario;
    } catch (err) {
      console.error('[aiScenarioPreview] Failed to validate scenario:', scenario.name, err);
      return scenario;
    }
  });
}

// ── Detect numeric budgets in user messages ────────────────────────────

const BUDGET_PATTERNS: RegExp[] = [
  // $700k, $1.2m, $700K
  /\$\s*([0-9]+(?:\.[0-9]+)?)\s*([kKmM])\b/g,
  // 700k, 1.2m  (no $)
  /\b([0-9]+(?:\.[0-9]+)?)\s*([kKmM])\b/g,
  // $700,000 or $700000
  /\$\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,})/g,
];

/**
 * Returns the LARGEST numeric budget mentioned across the conversation
 * (so a follow-up "actually I want $700k" overrides the original "$650k").
 * Recency wins on ties.
 */
export function detectTargetPrice(messages: Array<{ role: string; content: string }>): number | undefined {
  let best: { value: number; index: number } | undefined;
  messages.forEach((msg, idx) => {
    if (msg.role !== 'user' || !msg.content) return;
    const text = msg.content;
    for (const re of BUDGET_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        let value = parseFloat(m[1].replace(/,/g, ''));
        if (!Number.isFinite(value) || value <= 0) continue;
        const suffix = (m[2] || '').toLowerCase();
        if (suffix === 'k') value *= 1_000;
        else if (suffix === 'm') value *= 1_000_000;
        // Require sensible AU property range to avoid catching e.g. "$1,100" repayments.
        if (value < 50_000 || value > 50_000_000) continue;
        if (!best || value > best.value || (value === best.value && idx >= best.index)) {
          best = { value, index: idx };
        }
      }
    }
  });
  return best?.value;
}

/**
 * Heuristic: detects when the latest user message is a clarification
 * (asking the AI to explain / confirm something) rather than a request
 * to regenerate scenarios. Used to avoid spamming new tool calls.
 */
export function isClarificationMessage(content: string): boolean {
  if (!content) return false;
  const lower = content.toLowerCase().trim();
  if (lower.length < 6) return false;
  // Question mark with no explicit "generate / create / build" keyword
  const hasQuestion = lower.includes('?');
  const wantsAction = /\b(generate|create|build|run|make|propose|recommend|show me|give me)\b/.test(lower);
  if (hasQuestion && !wantsAction) return true;
  const clarificationCues = [
    'clarify', 'confirm', 'will this', 'will it', 'does this', 'does it',
    'is this', 'is it', 'how does', 'how would', 'what does', 'what is',
    'why ', 'explain', 'before applying', 'before i apply',
  ];
  return clarificationCues.some(cue => lower.includes(cue));
}

// ── Phase J2: structured acquisition hint extraction ───────────────────

export interface AcquisitionHints {
  state?: 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'NT' | 'ACT';
  intent?: 'owner_occupier' | 'investor';
  category?: 'established' | 'new' | 'vacant_land';
  isFirstHomeBuyer?: boolean;
  cashOnHand?: number;
}

const STATE_PATTERNS: Array<{ state: AcquisitionHints['state']; re: RegExp }> = [
  { state: 'NSW', re: /\b(nsw|new south wales|sydney|newcastle|wollongong|parramatta|central coast)\b/i },
  { state: 'VIC', re: /\b(vic|victoria|melbourne|geelong|ballarat|bendigo)\b/i },
  { state: 'QLD', re: /\b(qld|queensland|brisbane|gold coast|sunshine coast|cairns|townsville)\b/i },
  { state: 'WA',  re: /\b(wa|western australia|perth|fremantle)\b/i },
  { state: 'SA',  re: /\b(sa|south australia|adelaide)\b/i },
  { state: 'TAS', re: /\b(tas|tasmania|hobart|launceston)\b/i },
  { state: 'NT',  re: /\b(nt|northern territory|darwin)\b/i },
  { state: 'ACT', re: /\b(act|canberra)\b/i },
];

const CASH_PATTERNS: RegExp[] = [
  // "$50k cash", "60k deposit", "$100,000 cash on hand"
  /(?:cash|deposit|savings|on hand|saved up)[^\d$]{0,30}\$?\s*([0-9]+(?:[.,][0-9]+)?)\s*([kKmM])?/g,
  /\$\s*([0-9]+(?:[.,][0-9]+)?)\s*([kKmM])?\s*(?:cash|deposit|savings|on hand|saved)/g,
];

/**
 * Pull structured acquisition hints out of the conversation prose.
 * The model sees these as authoritative defaults so it stops guessing
 * 'NSW investor' for every client. Recency wins on conflicts.
 */
export function extractAcquisitionHints(messages: Array<{ role: string; content: string }>): AcquisitionHints {
  const hints: AcquisitionHints = {};
  const userText = messages.filter(m => m.role === 'user').map(m => m.content || '').join('\n').toLowerCase();
  if (!userText) return hints;

  // State — last mention wins
  for (const { state, re } of STATE_PATTERNS) {
    if (re.test(userText)) hints.state = state;
  }

  // Intent
  if (/\b(invest(ment|or)?|rental property|ip|portfolio expansion)\b/.test(userText)) hints.intent = 'investor';
  if (/\b(owner[-\s]?occup(ier|ied)?|to live in|primary residence|home for (us|me)|ppor)\b/.test(userText)) hints.intent = 'owner_occupier';

  // Category
  if (/\b(off[-\s]?the[-\s]?plan|new build|brand new|h&l|house and land|construction)\b/.test(userText)) hints.category = 'new';
  else if (/\b(vacant land|land only|raw land|block of land)\b/.test(userText)) hints.category = 'vacant_land';
  else if (/\b(established|existing|secondhand)\b/.test(userText)) hints.category = 'established';

  // First home buyer
  if (/\b(first[-\s]?home[-\s]?buyer|fhb|never owned|never bought)\b/.test(userText)) hints.isFirstHomeBuyer = true;

  // Cash on hand — take the LARGEST mentioned value in a sensible range
  let bestCash = 0;
  for (const re of CASH_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(userText)) !== null) {
      let v = parseFloat((m[1] || '').replace(/,/g, ''));
      if (!Number.isFinite(v) || v <= 0) continue;
      const suffix = (m[2] || '').toLowerCase();
      if (suffix === 'k') v *= 1_000;
      else if (suffix === 'm') v *= 1_000_000;
      // Sensible deposit range: $5k – $5m
      if (v >= 5_000 && v <= 5_000_000 && v > bestCash) bestCash = v;
    }
  }
  if (bestCash > 0) hints.cashOnHand = Math.round(bestCash);

  return hints;
}
