/**
 * Borrower and business income analysis.
 *
 * Two things this module refuses to do, both deliberate:
 *  - it will not count an add-back that has not been confirmed by a human with
 *    an amount, a category, a reason and a source; and
 *  - it will not treat non-recurring income as servicing income unless policy
 *    explicitly shades it below 100%.
 */

import {
  centsOf,
  percentOfCents,
  ratio,
  roundRatio,
  safePercent,
  sumCents,
  type Cents,
} from './money';
import type { ResolvedPolicy } from './policy';
import type { Addback, AssessmentPayload, IncomePeriod } from './types';

export interface PeriodAnalysis {
  periodId: string;
  label: string;
  periodEnd: string;
  basis: IncomePeriod['basis'];
  verification: IncomePeriod['verification'];
  reportedEbitdaCents: Cents;
  confirmedAddbacksCents: Cents;
  unconfirmedAddbacksCents: Cents;
  adjustedEbitdaCents: Cents;
  personalIncomeCents: Cents;
  otherIncomeCents: Cents;
  nonRecurringIncomeCents: Cents;
  totalAssessableCents: Cents;
}

export interface BusinessIncomeResult {
  periods: PeriodAnalysis[];
  /** The period-blending rule that produced the assessable figure. */
  selectionBasis: string;
  assessableBusinessIncomeCents: Cents;
  assessablePersonalIncomeCents: Cents;
  assessableOtherIncomeCents: Cents;
  totalAssessableIncomeCents: Cents;

  adjustedEbitdaCents: Cents;
  normalisedEarningsCents: Cents;
  confirmedAddbacksCents: Cents;
  proposedAddbacksCents: Cents;

  /** Positive means the most recent period improved on the prior one. */
  earningsTrend: number;
  decliningIncome: boolean;
  varianceWarnings: string[];
  verificationStatus: 'unverified' | 'documents_held' | 'verified';
  notes: string[];
}

/**
 * An add-back is only assessable when every field a reviewer would need is
 * present *and* somebody has confirmed it. Anything short of that is reported
 * as "proposed" and excluded from income.
 */
export function isAddbackAssessable(addback: Addback): boolean {
  return (
    addback.confirmed === true
    && Number.isFinite(addback.amount)
    && addback.amount > 0
    && !!addback.category
    && addback.reason.trim().length > 0
    && addback.source.trim().length > 0
  );
}

function analysePeriod(period: IncomePeriod, addbacks: Addback[], policy: ResolvedPolicy): PeriodAnalysis {
  const periodAddbacks = addbacks.filter((addback) => addback.periodId === period.id);
  const confirmedAddbacksCents = sumCents(
    ...periodAddbacks.filter(isAddbackAssessable).map((addback) => centsOf(addback.amount)),
  );
  const unconfirmedAddbacksCents = sumCents(
    ...periodAddbacks.filter((addback) => !isAddbackAssessable(addback)).map((addback) => centsOf(addback.amount)),
  );

  // Where EBITDA has not been supplied directly, rebuild it from NPAT the way
  // an analyst would: profit plus tax-deductible interest and depreciation.
  const reportedEbitdaCents = period.ebitda !== 0
    ? centsOf(period.ebitda)
    : sumCents(centsOf(period.npat), centsOf(period.interestExpense), centsOf(period.depreciation));

  const adjustedEbitdaCents = sumCents(reportedEbitdaCents, confirmedAddbacksCents);

  const personalIncomeCents = sumCents(centsOf(period.salaryWages), centsOf(period.directorRemuneration));
  const otherIncomeRawCents = sumCents(
    centsOf(period.distributions),
    centsOf(period.dividends),
    centsOf(period.otherRecurringIncome),
  );
  const otherIncomeCents = otherIncomeRawCents
    - percentOfCents(otherIncomeRawCents, policy.otherIncomeShadingPct);

  const nonRecurringRawCents = centsOf(period.nonRecurringIncome);
  const nonRecurringIncomeCents = nonRecurringRawCents
    - percentOfCents(nonRecurringRawCents, policy.nonRecurringIncomeShadingPct);

  return {
    periodId: period.id,
    label: period.label,
    periodEnd: period.periodEnd,
    basis: period.basis,
    verification: period.verification,
    reportedEbitdaCents,
    confirmedAddbacksCents,
    unconfirmedAddbacksCents,
    adjustedEbitdaCents,
    personalIncomeCents,
    otherIncomeCents,
    nonRecurringIncomeCents,
    totalAssessableCents: sumCents(
      adjustedEbitdaCents, personalIncomeCents, otherIncomeCents, nonRecurringIncomeCents,
    ),
  };
}

/**
 * Blend the periods into one assessable figure. A weighted blend leans on the
 * most recent period (3:2:1 across up to three years), which is the shape most
 * commercial credit policies use.
 */
function selectAssessable(
  periods: PeriodAnalysis[],
  basis: AssessmentPayload['income']['assessableIncomeBasis'],
  pick: (period: PeriodAnalysis) => Cents,
): { valueCents: Cents; description: string } {
  if (!periods.length) return { valueCents: 0, description: 'No financial periods supplied.' };
  const values = periods.map(pick);

  switch (basis) {
    case 'latest':
      return { valueCents: values[0], description: `Latest period (${periods[0].label}).` };
    case 'lowest':
      return { valueCents: Math.min(...values), description: 'Lowest of the supplied periods.' };
    case 'average':
      return {
        valueCents: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
        description: `Straight average of ${values.length} period(s).`,
      };
    case 'weighted':
    default: {
      const weights = [3, 2, 1].slice(0, values.length);
      const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
      const weighted = values
        .slice(0, weights.length)
        .reduce((sum, value, index) => sum + value * weights[index], 0);
      return {
        valueCents: Math.round(weighted / totalWeight),
        description: `Weighted ${weights.join(':')} across ${weights.length} period(s), most recent weighted highest.`,
      };
    }
  }
}

export function calculateBusinessIncome(
  payload: AssessmentPayload,
  policy: ResolvedPolicy,
): BusinessIncomeResult {
  const notes: string[] = [];
  const varianceWarnings: string[] = [];

  // Most recent period first — every selection rule below assumes that order.
  const ordered = [...payload.income.periods].sort((a, b) => (b.periodEnd || '').localeCompare(a.periodEnd || ''));
  const periods = ordered.map((period) => analysePeriod(period, payload.income.addbacks, policy));

  const business = selectAssessable(periods, payload.income.assessableIncomeBasis, (p) => p.adjustedEbitdaCents);
  const personal = selectAssessable(periods, payload.income.assessableIncomeBasis, (p) => p.personalIncomeCents);
  const other = selectAssessable(periods, payload.income.assessableIncomeBasis, (p) => sumCents(p.otherIncomeCents, p.nonRecurringIncomeCents));

  const confirmedAddbacksCents = sumCents(...periods.map((period) => period.confirmedAddbacksCents));
  const proposedAddbacksCents = sumCents(...periods.map((period) => period.unconfirmedAddbacksCents));
  if (proposedAddbacksCents > 0) {
    notes.push('Proposed add-backs are excluded from assessable income until they are confirmed with a reason and source.');
  }

  // Trend across the two most recent periods.
  let earningsTrend = 0;
  if (periods.length >= 2) {
    const latest = periods[0].adjustedEbitdaCents;
    const prior = periods[1].adjustedEbitdaCents;
    if (prior !== 0) earningsTrend = roundRatio((latest - prior) / Math.abs(prior));
    if (earningsTrend < -0.1) {
      varianceWarnings.push(`Adjusted EBITDA fell ${Math.abs(earningsTrend * 100).toFixed(1)}% against the prior period.`);
    }
    if (Math.abs(earningsTrend) > 0.5) {
      varianceWarnings.push('Period-on-period earnings moved by more than 50% — confirm the figures are on a comparable basis.');
    }
  }
  const decliningIncome = earningsTrend < -0.1;

  const verifications = periods.map((period) => period.verification);
  const verificationStatus: BusinessIncomeResult['verificationStatus'] =
    !verifications.length ? 'unverified'
      : verifications.every((status) => status === 'verified') ? 'verified'
        : verifications.some((status) => status !== 'unverified') ? 'documents_held'
          : 'unverified';

  if (verificationStatus !== 'verified' && periods.length > 0) {
    notes.push('Income has not been fully verified — the result is indicative only until documents are held and checked.');
  }

  const adjustedEbitdaCents = periods.length ? periods[0].adjustedEbitdaCents : 0;

  return {
    periods,
    selectionBasis: business.description,
    assessableBusinessIncomeCents: business.valueCents,
    assessablePersonalIncomeCents: personal.valueCents,
    assessableOtherIncomeCents: other.valueCents,
    totalAssessableIncomeCents: sumCents(business.valueCents, personal.valueCents, other.valueCents),
    adjustedEbitdaCents,
    normalisedEarningsCents: business.valueCents,
    confirmedAddbacksCents,
    proposedAddbacksCents,
    earningsTrend,
    decliningIncome,
    varianceWarnings,
    verificationStatus,
    notes,
  };
}

/** Debt-to-EBITDA leverage measure. Returns null when EBITDA is not positive. */
export function debtToEbitda(totalDebtCents: Cents, adjustedEbitdaCents: Cents): number | null {
  if (adjustedEbitdaCents <= 0) return null;
  return roundRatio(totalDebtCents / adjustedEbitdaCents);
}

/**
 * Fixed-charge coverage: earnings before fixed charges over those charges.
 * Relevant where the borrower pays material rent alongside debt service.
 */
export function fixedChargeCoverage(
  adjustedEbitdaCents: Cents,
  rentPaidCents: Cents,
  debtServiceCents: Cents,
): number | null {
  const charges = sumCents(rentPaidCents, debtServiceCents);
  if (charges <= 0) return null;
  return ratio(sumCents(adjustedEbitdaCents, rentPaidCents), charges);
}

/** Shade rental income by the policy percentage before it services debt. */
export function shadeRent(rentCents: Cents, policy: ResolvedPolicy): Cents {
  return rentCents - percentOfCents(rentCents, safePercent(policy.rentalShadingPct));
}
