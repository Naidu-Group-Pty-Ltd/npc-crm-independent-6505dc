/**
 * Strategy Rationale Engine — Phase F5
 * ────────────────────────────────────
 * Deterministic narrative builder that converts an applied scenario into a
 * finance-ready brief explaining:
 *   • WHAT changed (the levers pulled, in plain English)
 *   • WHY this combination was chosen (target gap, binding constraints, headroom)
 *   • HOW the math reconciles (per-lever attribution, compounding interaction)
 *   • SEQUENCE — the recommended order of operations the finance team should
 *     execute to realise the modelled outcome
 *
 * This file is intentionally pure (no React, no I/O) so it can also be reused
 * by the edge function and the upcoming F6 Finance Hand-off Brief.
 */
 
import type {
  ScenarioDelta,
  AcquisitionCapacity,
  CapitalLedger,
  CapitalSinkType,
} from './borrowingCapacityTypes';
import type { LeverAttribution } from '@/components/borrowing-capacity/scenarios/PurchasePowerHeadline';

// ─── Types ────────────────────────────────────────────────────────────────

export type RationaleSeverity = 'info' | 'positive' | 'caution' | 'critical';

export interface RationaleBullet {
  /** Stable id (delta id, lever key) */
  id: string;
  /** Plain-English action statement (e.g. "Pay off ANZ credit card $4,500") */
  what: string;
  /** Why this lever earns its place (e.g. "Removes $135/mo committed servicing") */
  why: string;
  /** Capacity contribution in $ when applied in isolation */
  capacityImpact: number;
  /** Optional cash-flow note from the scenario engine */
  cashflowNote?: string;
  /** Bucket so the panel can group / colour-code */
  severity: RationaleSeverity;
}

export interface RationaleSequenceStep {
  step: number;
  /** One-line action for finance ("Order valuation on 12 Smith St for equity release") */
  action: string;
  /** Optional supporting detail (rate, target LVR, balance, etc.) */
  detail?: string;
  /** Logical owner — finance, broker, client */
  owner: 'broker' | 'finance' | 'client';
}

/** Phase K5 — explainable capital routing block (sources → sinks). */
export interface RationaleCapitalFlowEntry {
  /** Source bucket (e.g. "Equity release · 28 King St", "Cash on hand"). */
  sourceLabel: string;
  /** Sink bucket (e.g. "Pay down ANZ Visa", "Offset deposit · 12 Smith St"). */
  sinkLabel: string;
  /** Sink type for badge / colour. */
  sinkType: CapitalSinkType | 'unallocated';
  /** Dollars routed through this leg. */
  amount: number;
  /** Engine-derived monthly servicing delta (negative = saving). */
  monthlyServicingDelta: number;
  /** Engine-derived debt balance delta (negative = paid down). */
  debtBalanceDelta: number;
  /** One-line audit note from the K1 ledger. */
  note?: string;
}

export interface RationaleCapitalFlow {
  /** Total $ routed through the ledger (sum of sinks). */
  totalRouted: number;
  /** Total $ available before allocation (sum of sources). */
  totalAvailable: number;
  /** Net monthly servicing impact across all sinks (negative = saving). */
  monthlyServicingDelta: number;
  /** Net debt balance impact (negative = paid down). */
  debtBalanceDelta: number;
  /** True if any pool is overcommitted. */
  overcommitted: boolean;
  /** Residual (un-routed) pool $ — heads to the acquisition deposit pool. */
  remainder: number;
  /** Per-leg explanations. */
  legs: RationaleCapitalFlowEntry[];
}

export interface RationaleReport {
  /** Headline sentence summarising the scenario outcome */
  headline: string;
  /** Optional sub-headline contextualising target / shortfall */
  subHeadline?: string;
  /** Per-lever bullets (what + why + impact) */
  bullets: RationaleBullet[];
  /** Reconciliation paragraph for the per-lever waterfall */
  reconciliation: string;
  /** Recommended sequence of execution */
  sequence: RationaleSequenceStep[];
  /** Caveats / assumptions the finance team must validate */
  caveats: string[];
  /** Phase K5 — optional capital allocation flow narrative. */
  capitalFlow?: RationaleCapitalFlow;
  /** ISO timestamp */
  generatedAt: string;
}

export interface RationaleInput {
  baseCapacity: number;
  scenarioCapacity: number;
  /** Total committed servicing $/mo BEFORE the scenario */
  baseMonthlyCommitments?: number;
  /** Active deltas the user toggled */
  deltas: ScenarioDelta[];
  /** Per-lever attribution from the scenario engine */
  leverAttribution: LeverAttribution[];
  /** Acquisition snapshot — drives target / shortfall narrative */
  acquisitionCapacity: AcquisitionCapacity | null;
  /** Currency formatter — passed in so locale stays consistent with the parent */
  formatCurrency: (n: number) => string;
  /** Phase K5 — capital allocation ledger from the K1 engine. */
  capitalLedger?: CapitalLedger | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const TYPE_TO_VERB: Record<ScenarioDelta['type'], string> = {
  liability_payoff: 'Discharge',
  property_refinance: 'Refinance',
  property_sell: 'Divest',
  property_add: 'Acquire',
  property_rate_change: 'Reprice',
  income_change: 'Adjust income',
  expense_change: 'Adjust expenses',
  debt_change: 'Adjust debt',
  rate_change: 'Reprice portfolio',
  loan_term_change: 'Restructure loan term',
  dti_cap_change: 'Override DTI cap',
  equity_release: 'Release equity',
  /** Phase G1 — valuation override is a methodology assumption, not a transaction */
  property_value_change: 'Revalue property',
  /** Phase G2 — cross-collateralised pool release */
  portfolio_lvr_release: 'Release pooled equity',
  /** Phase K1 — capital allocation routing */
  capital_allocation: 'Allocate capital',
};

function severityForDelta(d: ScenarioDelta, capacityImpact: number): RationaleSeverity {
  if (d.type === 'dti_cap_change') return 'caution';
  if (d.type === 'equity_release') return capacityImpact >= 0 ? 'info' : 'caution';
  if (d.type === 'rate_change' && d.value > 0) return 'caution';
  if (capacityImpact > 0) return 'positive';
  if (capacityImpact < 0) return 'caution';
  return 'info';
}

function whyForDelta(
  d: ScenarioDelta,
  capacityImpact: number,
  cashflowNote: string | undefined,
  fmt: (n: number) => string,
): string {
  switch (d.type) {
    case 'liability_payoff':
      return cashflowNote
        ? `Frees ${cashflowNote} in committed servicing, lifting capacity by ${fmt(Math.max(0, capacityImpact))}.`
        : `Removes a serviced liability of ${fmt(d.value)}, freeing assessable surplus.`;
    case 'property_refinance':
      return cashflowNote
        ? `Switches to interest-only servicing — frees ${cashflowNote} in monthly outflow without changing the loan balance.`
        : `Reduces monthly servicing by switching to interest-only — preserves the asset while improving DSR.`;
    case 'property_sell':
      return `Divests the asset, removing the loan from the schedule and converting equity to cash. Recovers ${fmt(Math.max(0, capacityImpact))} of capacity.`;
    case 'property_rate_change':
      return `Reprices this property in isolation — useful when one lender is materially out of market vs the rest of the portfolio. Capacity impact: ${capacityImpact >= 0 ? '+' : ''}${fmt(capacityImpact)}.`;
    case 'rate_change':
      return d.value < 0
        ? `Models a ${Math.abs(d.value).toFixed(2)} pp rate cut across the assessment — primarily a stress-test sensitivity.`
        : `Models a ${d.value.toFixed(2)} pp rate rise — sensitivity check against further RBA tightening.`;
    case 'equity_release':
      return cashflowNote
        ? `Pulls ${cashflowNote.split('·')[0].trim()} from the existing security at the target LVR. The new IO slice carries ${cashflowNote.split('·')[1]?.trim() ?? 'shadow servicing'} that the engine has already deducted from surplus.`
        : `Releases equity at the configured target LVR — funds become deposit / acquisition cash. Shadow IO servicing on the new slice is included in the scenario.`;
    case 'income_change':
      return d.value >= 0
        ? `Models a ${d.value.toFixed(1)}% income uplift — typically a pay-rise, role change, or new contracted role. Validate with payslips before lender submission.`
        : `Models a ${Math.abs(d.value).toFixed(1)}% income reduction — stress-test against a planned career change or maternity leave.`;
    case 'expense_change':
      return `Models a ${Math.abs(d.value).toFixed(0)}% expense reduction. Lenders will sanity-check against HEM and bank statements — keep declared expenses defensible.`;
    case 'loan_term_change':
      return `Adjusts the assessment loan term by ${d.value > 0 ? '+' : ''}${d.value} years to reshape the assessed P&I repayment.`;
    case 'dti_cap_change':
      return `Overrides the policy DTI cap to ${d.value}x. Treat as an exception — only applicable where the lender has explicit policy support.`;
    case 'property_add':
      return `Pre-loads a future acquisition into the schedule for forward-looking servicing.`;
    case 'debt_change':
      return `Adjusts assessed liabilities — useful when consolidating or correcting bureau data.`;
    case 'property_value_change': {
      const basis = (d.meta?.basis as string) ?? 'manual';
      const source = (d.meta?.source as string) ?? '';
      const basisLabel = basis === 'avm' ? 'AVM' : basis === 'desktop' ? 'desktop val' : basis === 'comparable_sales' ? 'comparable sales' : 'manual override';
      return `Updates the recorded valuation to ${fmt(d.value)} (${basisLabel}${source ? ` — ${source}` : ''}). All downstream LVR, equity, and pool math uses the new figure. Finance must validate the basis before submission.`;
    }
    case 'portfolio_lvr_release': {
      const blended = (d.value * 100).toFixed(0);
      const ids = Array.isArray(d.meta?.propertyIds) ? (d.meta!.propertyIds as string[]) : [];
      const strategy = (d.meta?.allocationStrategy as string) ?? 'highest_equity_first';
      return `Pools ${ids.length} security${ids.length === 1 ? '' : 'ies'} into a cross-collateralised facility at a ${blended}% blended LVR (${strategy.replace(/_/g, ' ')}). Equity-rich properties subsidise equity-poor ones, unlocking cash that standalone per-security releases would floor at $0. Capacity impact: ${capacityImpact >= 0 ? '+' : ''}${fmt(capacityImpact)}.`;
    }
    default:
      return `Capacity impact in isolation: ${capacityImpact >= 0 ? '+' : ''}${fmt(capacityImpact)}.`;
  }
}

function whatForDelta(d: ScenarioDelta): string {
  const verb = TYPE_TO_VERB[d.type] ?? 'Apply';
  // Strip the engine's own verb from the start of label if it duplicates.
  const cleanLabel = d.label.replace(/^(Pay off|Refinance|Sell|Reprice|Equity release|Reduce|Income|Loan term|Rates|DTI cap)\s*/i, '');
  return `${verb}: ${cleanLabel || d.label}`;
}

function ownerForDelta(d: ScenarioDelta): RationaleSequenceStep['owner'] {
  switch (d.type) {
    case 'liability_payoff':
    case 'property_sell':
      return 'client';
    case 'property_refinance':
    case 'property_rate_change':
    case 'equity_release':
    case 'rate_change':
    case 'loan_term_change':
    case 'dti_cap_change':
    case 'portfolio_lvr_release':
      return 'finance';
    case 'property_value_change':
      return 'broker';
    default:
      return 'broker';
  }
}

function priorityForDelta(d: ScenarioDelta): number {
  // Lower = earlier in the sequence. Order chosen to mirror what a broker
  // would actually execute in real life: free up servicing first, then
  // unlock equity, then reprice, then submit.
  switch (d.type) {
    case 'property_value_change':
      return 5; // resolve valuations first
    case 'liability_payoff':
      return 10;
    case 'expense_change':
      return 15;
    case 'income_change':
      return 18;
    case 'property_sell':
      return 20;
    case 'property_refinance':
      return 30;
    case 'property_rate_change':
      return 35;
    case 'rate_change':
      return 38;
    case 'equity_release':
      return 40;
    case 'loan_term_change':
      return 50;
    case 'dti_cap_change':
      return 60;
    case 'property_add':
      return 70;
    default:
      return 90;
  }
}

// ─── Phase K5 — capital flow narrative ────────────────────────────────────

const SINK_TYPE_LABEL: Record<CapitalSinkType, string> = {
  liability_payoff: 'Liability payoff',
  offset_deposit: 'Offset deposit',
  rate_buydown: 'Rate buy-down',
  debt_recycle: 'Debt recycling',
  acquisition_deposit: 'Acquisition deposit',
  holding_reserve: 'Cash buffer',
  repayment_reduction: 'Repayment reduction',
};

function buildCapitalFlow(ledger: CapitalLedger | null | undefined): RationaleCapitalFlow | undefined {
  if (!ledger) return undefined;
  const pools = Object.values(ledger.pools || {});
  if (pools.length === 0) return undefined;

  const legs: RationaleCapitalFlowEntry[] = [];
  let totalAvailable = 0;
  let totalRouted = 0;
  let monthlyServicingDelta = 0;
  let debtBalanceDelta = 0;
  let overcommitted = false;
  let remainder = 0;

  for (const pool of pools) {
    totalAvailable += pool.totalIn || 0;
    totalRouted += pool.totalOut || 0;
    remainder += pool.remainder || 0;
    if (pool.overcommitted) overcommitted = true;

    // Source label is collapsed: the K1 ledger doesn't link sink→source directly,
    // so we build a single source descriptor per pool and pair it to each sink.
    const sourceLabel = pool.sources.length > 0
      ? pool.sources.map(s => s.label).join(' + ')
      : 'Pool';

    for (const sink of pool.sinks) {
      monthlyServicingDelta += sink.monthlyServicingDelta || 0;
      debtBalanceDelta += sink.debtBalanceDelta || 0;
      legs.push({
        sourceLabel,
        sinkLabel: sink.label,
        sinkType: sink.sinkType,
        amount: sink.amount,
        monthlyServicingDelta: sink.monthlyServicingDelta || 0,
        debtBalanceDelta: sink.debtBalanceDelta || 0,
        note: sink.notes && sink.notes.length > 0 ? sink.notes.join(' · ') : undefined,
      });
    }

    if ((pool.remainder || 0) > 1) {
      legs.push({
        sourceLabel,
        sinkLabel: 'Acquisition deposit pool (residual)',
        sinkType: 'unallocated',
        amount: pool.remainder,
        monthlyServicingDelta: 0,
        debtBalanceDelta: 0,
        note: 'Un-routed pool capital — defaults to the next-purchase deposit headroom.',
      });
    }
  }

  if (legs.length === 0 && totalAvailable === 0) return undefined;

  return {
    totalRouted,
    totalAvailable,
    monthlyServicingDelta,
    debtBalanceDelta,
    overcommitted,
    remainder,
    legs,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────

export function buildStrategyRationale(input: RationaleInput): RationaleReport {
  const {
    baseCapacity,
    scenarioCapacity,
    deltas,
    leverAttribution,
    acquisitionCapacity,
    formatCurrency: fmt,
    capitalLedger,
  } = input;

  // Phase K5 — capital flow narrative
  const capitalFlow = buildCapitalFlow(capitalLedger);

  const capacityChange = scenarioCapacity - baseCapacity;
  const noLevers = deltas.length === 0;

  // ── Headline ────────────────────────────────────────────────────────
  let headline: string;
  let subHeadline: string | undefined;

  if (noLevers) {
    headline = `Baseline scenario — no levers applied. Borrowing capacity remains at ${fmt(baseCapacity)}.`;
  } else if (capacityChange > 0) {
    headline = `Applying ${deltas.length} lever${deltas.length === 1 ? '' : 's'} lifts borrowing capacity from ${fmt(baseCapacity)} to ${fmt(scenarioCapacity)} (+${fmt(capacityChange)}).`;
  } else if (capacityChange < 0) {
    headline = `The selected combination reduces borrowing capacity from ${fmt(baseCapacity)} to ${fmt(scenarioCapacity)} (${fmt(capacityChange)}).`;
  } else {
    headline = `The selected combination is capacity-neutral but reshapes the cash-flow / risk profile.`;
  }

  // Acquisition framing — only meaningful when the user has acquisition mode on
  if (acquisitionCapacity) {
    const target = acquisitionCapacity.targetPurchasePrice ?? 0;
    if (target > 0) {
      if (acquisitionCapacity.meetsTarget) {
        subHeadline = `Target of ${fmt(target)} is ACHIEVABLE — effective purchase power resolves to ${fmt(acquisitionCapacity.maxPurchasePrice)}, leaving ${fmt(acquisitionCapacity.maxPurchasePrice - target)} of headroom after LMI, stamp duty and acquisition costs.`;
      } else {
        const shortfall = acquisitionCapacity.shortfallToTarget ?? Math.max(0, target - acquisitionCapacity.maxPurchasePrice);
        subHeadline = `Target of ${fmt(target)} is NOT ACHIEVABLE under this scenario — short by ${fmt(shortfall)}. Effective purchase power tops out at ${fmt(acquisitionCapacity.maxPurchasePrice)}.`;
      }
    } else {
      subHeadline = `Effective purchase power (loan + cash − LMI − stamp duty − acquisition costs) lands at ${fmt(acquisitionCapacity.maxPurchasePrice)}.`;
    }
  }

  // ── Bullets ─────────────────────────────────────────────────────────
  const attributionById = new Map(leverAttribution.map(l => [l.id, l]));

  const bullets: RationaleBullet[] = deltas.map(d => {
    const key = `${d.type}-${d.id}`;
    const attr = attributionById.get(key);
    const capacityImpact = attr?.capacityImpact ?? 0;
    const cashflowNote = attr?.cashflowNote;
    return {
      id: key,
      what: whatForDelta(d),
      why: whyForDelta(d, capacityImpact, cashflowNote, fmt),
      capacityImpact,
      cashflowNote,
      severity: severityForDelta(d, capacityImpact),
    };
  });

  // Sort bullets by absolute capacity impact descending — most material first
  bullets.sort((a, b) => Math.abs(b.capacityImpact) - Math.abs(a.capacityImpact));

  // ── Reconciliation ──────────────────────────────────────────────────
  const sumIsolated = leverAttribution.reduce((s, l) => s + l.capacityImpact, 0);
  const interactionResidual = capacityChange - sumIsolated;
  let reconciliation: string;
  if (noLevers) {
    reconciliation = 'No levers applied — no per-lever attribution to reconcile.';
  } else if (Math.abs(interactionResidual) <= 1000) {
    reconciliation = `Per-lever attribution sums to ${fmt(sumIsolated)} which reconciles cleanly to the compounded scenario delta of ${fmt(capacityChange)} — levers are operating largely independently in this combination.`;
  } else if (interactionResidual > 0) {
    reconciliation = `Per-lever attribution sums to ${fmt(sumIsolated)} but the compounded scenario delta is ${fmt(capacityChange)} — the +${fmt(interactionResidual)} residual is "compounding interaction" (e.g. freed servicing capacity then absorbed by an equity-release IO slice that became affordable). Treat the compounded figure as authoritative; the waterfall isolates the standalone effect of each lever.`;
  } else {
    reconciliation = `Per-lever attribution sums to ${fmt(sumIsolated)} but the compounded scenario delta is only ${fmt(capacityChange)} — the ${fmt(interactionResidual)} negative residual indicates levers cannibalise each other (typically: equity release shadow-servicing eating into the headroom freed by other levers). The compounded figure is authoritative.`;
  }

  // ── Sequence ────────────────────────────────────────────────────────
  const ordered = [...deltas].sort((a, b) => priorityForDelta(a) - priorityForDelta(b));
  const sequence: RationaleSequenceStep[] = ordered.map((d, idx) => {
    const owner = ownerForDelta(d);
    let action = '';
    let detail: string | undefined;

    switch (d.type) {
      case 'liability_payoff':
        action = `Discharge ${d.label.replace(/^Pay off\s*/, '')}.`;
        detail = `Balance: ${fmt(d.value)}. Obtain payout figure and confirm closure on bureau before lender submission.`;
        break;
      case 'property_refinance':
        action = `Refinance the loan on this property to interest-only.`;
        detail = `Submit IO product switch / refinance application; supply rental ledger and confirm IO term aligns with strategy.`;
        break;
      case 'property_rate_change':
        action = `Reprice this property's loan to ${d.value.toFixed(2)}%.`;
        detail = `Compare against current contracted rate, request retention pricing or lodge refinance.`;
        break;
      case 'rate_change':
        action = d.value < 0 ? `Re-run sensitivity at ${Math.abs(d.value).toFixed(2)} pp lower assessment rate.` : `Stress-test at +${d.value.toFixed(2)} pp assessment rate.`;
        detail = `Sensitivity / stress-test only — does not require execution.`;
        break;
      case 'equity_release':
        action = `Order valuation and lodge equity-release application.`;
        detail = `Target LVR: ${(d.value * 100).toFixed(0)}%. Released cash should be quarantined for the next acquisition deposit / costs. Confirm IO repayments are serviceable post-completion.`;
        break;
      case 'property_sell':
        action = `List and divest this property.`;
        detail = `Engage selling agent, confirm settlement timing aligns with the next purchase, factor CGT advice with the client's accountant.`;
        break;
      case 'income_change':
        action = d.value >= 0 ? `Substantiate income uplift before submission.` : `Confirm income reduction with the lender.`;
        detail = `Provide payslips, employment contract or accountant letter to evidence the assessable change.`;
        break;
      case 'expense_change':
        action = `Re-baseline declared expenses.`;
        detail = `Reconcile against last 3 months of bank statements; flag to lender if materially below HEM.`;
        break;
      case 'loan_term_change':
        action = `Negotiate revised loan term with the lender.`;
        detail = `Confirm policy support — extending past 30 years requires lender exception in most cases.`;
        break;
      case 'dti_cap_change':
        action = `Seek DTI exception with target lender (capped at ${d.value}x).`;
        detail = `Requires written policy carve-out or exception sign-off — not all lenders will support.`;
        break;
      case 'property_add':
        action = `Pre-model the proposed new property in the deal pipeline.`;
        break;
      default:
        action = d.label;
    }

    return { step: idx + 1, action, detail, owner };
  });

  // ── Caveats ─────────────────────────────────────────────────────────
  const caveats: string[] = [];
  if (deltas.some(d => d.type === 'equity_release')) {
    caveats.push('Equity release figures assume the lender will value at the current_value held on file. Order a desktop or full valuation before treating released equity as bankable.');
  }
  if (deltas.some(d => d.type === 'dti_cap_change')) {
    caveats.push('A DTI cap override is an exception — escalate to the lender BDM before relying on this in submission.');
  }
  if (deltas.some(d => d.type === 'income_change' && d.value > 0)) {
    caveats.push('Income uplifts must be substantiated with payslips, contract, or accountant letter — speculative pay rises will not pass servicing.');
  }
  if (deltas.some(d => d.type === 'expense_change')) {
    caveats.push('Expense reductions are subject to lender HEM floors — declared expenses cannot drop below the applicable HEM benchmark for the household.');
  }
  if (acquisitionCapacity && acquisitionCapacity.targetPurchasePrice && !acquisitionCapacity.meetsTarget) {
    caveats.push('Target purchase price is currently NOT ACHIEVABLE under this scenario — either revise the target, layer in additional levers, or increase cash on hand.');
  }
  if (capitalFlow?.overcommitted) {
    caveats.push('Capital allocation pool is overcommitted — one or more sinks have been clamped to the available pool. Reduce allocation amounts or release more equity before relying on this scenario.');
  }
  if (caveats.length === 0) {
    caveats.push('Standard lender verification applies — payslips, bureau check, valuations, and contract review must all be completed before unconditional approval.');
  }

  return {
    headline,
    subHeadline,
    bullets,
    reconciliation,
    sequence,
    caveats,
    capitalFlow,
    generatedAt: new Date().toISOString(),
  };
}
