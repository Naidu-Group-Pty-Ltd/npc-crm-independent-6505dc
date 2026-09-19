/**
 * Binding Constraint Analyzer
 *
 * Borrowing capacity is `min(surplusBased, dtiCapped, absoluteMax)`. Whichever
 * candidate produced that minimum is the *binding constraint* — the wall the
 * client is currently pressed against. This module reverse-engineers which one
 * won, so the UI can explain why a what-if lever moved (or didn't move) the
 * needle.
 *
 * Pure function — no side effects. Safe to call from any component or worker.
 */

import {
  DEFAULT_LOAN_PARAMS,
  DEFAULT_CONSERVATIVE_CONFIG,
} from './policyEngine';
import type {
  BorrowingCapacityInput,
  BorrowingCapacityResult,
} from './borrowingCapacityCalculations';

export type BindingConstraintKind =
  | 'surplus'
  | 'dti_cap'
  | 'absolute_max'
  | 'none';

export interface BindingConstraintCandidate {
  kind: BindingConstraintKind;
  /** Capacity this constraint alone would allow (undefined when not modelled). */
  capacity: number | null;
  /** Short, user-facing label e.g. "Monthly surplus", "DTI cap @ 7.0×". */
  label: string;
  /** Why this constraint is or isn't binding, in plain English. */
  detail: string;
}

export interface BindingConstraintAnalysis {
  /** The constraint that produced the headline borrowingCapacity. */
  binding: BindingConstraintKind;
  /** Headline label e.g. "DTI cap @ 7.0×". */
  bindingLabel: string;
  /** All candidate ceilings (sorted lowest → highest). */
  candidates: BindingConstraintCandidate[];
  /** Plain-English explanation suitable for a tooltip or banner. */
  explanation: string;
}

const ABSOLUTE_MAX = 5_000_000; // soft display ceiling (no real cap in engine)

/**
 * Compute which constraint is currently binding the borrowing capacity.
 *
 * NOTE: this does NOT change any math. It re-derives the same three candidate
 * ceilings the engine already considered and tells the UI which one won.
 */
export function computeBindingConstraint(
  inputs: BorrowingCapacityInput,
  result: BorrowingCapacityResult,
): BindingConstraintAnalysis {
  const {
    grossAnnualIncome,
    totalDebtBalances = 0,
    calculationMode = 'bank',
    dtiCapEnabled = false,
    dtiCapLimit = DEFAULT_LOAN_PARAMS.dtiCap,
  } = inputs;

  const isConservative = calculationMode === 'conservative';
  const shouldApplyDtiCap = dtiCapEnabled || isConservative;
  const effectiveDtiCap = isConservative
    ? DEFAULT_CONSERVATIVE_CONFIG.dtiHardCap
    : dtiCapLimit;

  // ── Candidate 1: surplus-based ceiling ─────────────────────────
  // The actual borrowingCapacity from the engine IS the post-cap result, so
  // the surplus-based candidate is "what capacity would be without the DTI
  // cap" — which is what the engine computed before applying the cap. We
  // approximate it as the headline capacity when no cap is binding, otherwise
  // as the value implied by surplus alone (which we can't recover exactly
  // without re-running the engine, so we mark it as "≥ headline").
  const headline = result.borrowingCapacity;

  // ── Candidate 2: DTI-capped ceiling ────────────────────────────
  let dtiCappedCapacity: number | null = null;
  if (shouldApplyDtiCap && grossAnnualIncome > 0) {
    const maxTotalDebt = grossAnnualIncome * effectiveDtiCap;
    dtiCappedCapacity = Math.max(0, Math.round(maxTotalDebt - totalDebtBalances));
  }

  // ── Candidate 3: absolute display max ──────────────────────────
  const absoluteCapacity = ABSOLUTE_MAX;

  // ── Determine binding ──────────────────────────────────────────
  // The DTI cap is binding if (a) it applies AND (b) the headline equals the
  // DTI-capped value within rounding tolerance.
  const TOLERANCE = 1000; // $1k rounding tolerance
  let binding: BindingConstraintKind = 'surplus';
  let bindingLabel = 'Monthly surplus';

  if (
    dtiCappedCapacity !== null &&
    Math.abs(headline - dtiCappedCapacity) < TOLERANCE &&
    headline < absoluteCapacity
  ) {
    binding = 'dti_cap';
    bindingLabel = `DTI cap @ ${effectiveDtiCap.toFixed(1)}×`;
  } else if (headline >= absoluteCapacity - TOLERANCE) {
    binding = 'absolute_max';
    bindingLabel = 'Absolute max';
  } else if (headline === 0) {
    binding = 'none';
    bindingLabel = 'No serviceable surplus';
  }

  // ── Build candidate list ───────────────────────────────────────
  const candidates: BindingConstraintCandidate[] = [
    {
      kind: 'surplus',
      capacity: binding === 'surplus' ? headline : null,
      label: 'Monthly surplus',
      detail:
        binding === 'surplus'
          ? `Your serviceable surplus is the wall. Capacity = ${formatMoney(headline)}.`
          : `Surplus could support more than the headline figure — but a higher cap is binding.`,
    },
  ];

  if (dtiCappedCapacity !== null) {
    candidates.push({
      kind: 'dti_cap',
      capacity: dtiCappedCapacity,
      label: `DTI cap @ ${effectiveDtiCap.toFixed(1)}×`,
      detail:
        binding === 'dti_cap'
          ? `Total debt is capped at ${effectiveDtiCap.toFixed(1)}× gross income (${formatMoney(grossAnnualIncome * effectiveDtiCap)}). Existing debt of ${formatMoney(totalDebtBalances)} leaves room for ${formatMoney(dtiCappedCapacity)} of new lending.`
          : `DTI cap would allow up to ${formatMoney(dtiCappedCapacity)} — surplus is the tighter constraint.`,
    });
  }

  candidates.push({
    kind: 'absolute_max',
    capacity: absoluteCapacity,
    label: 'Absolute max',
    detail: `Display ceiling for very high earners (${formatMoney(absoluteCapacity)}).`,
  });

  // Sort by capacity ascending so the lowest (binding) is first.
  candidates.sort((a, b) => {
    const av = a.capacity ?? Number.POSITIVE_INFINITY;
    const bv = b.capacity ?? Number.POSITIVE_INFINITY;
    return av - bv;
  });

  // ── Plain-English explanation ──────────────────────────────────
  let explanation = '';
  switch (binding) {
    case 'dti_cap':
      explanation = `The DTI cap of ${effectiveDtiCap.toFixed(1)}× is currently the wall. Income-side levers (income growth, expense reduction, rate cuts) will have minimal effect until total debt drops or gross income rises. Levers that move the wall: pay off debt, sell a property, or increase gross income.`;
      break;
    case 'surplus':
      explanation = `Your monthly serviceable surplus is the wall. Levers that improve surplus (lower expenses, lower rate, higher income, fewer commitments) will translate directly into more capacity.`;
      break;
    case 'absolute_max':
      explanation = `You are at the display ceiling. Lender appetite, not policy, will be the practical limit at this level.`;
      break;
    case 'none':
      explanation = `There is no serviceable surplus. Capacity is zero until income exceeds expenses + commitments.`;
      break;
  }

  return {
    binding,
    bindingLabel,
    candidates,
    explanation,
  };
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}
