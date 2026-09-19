/**
 * Property income analysis for the proposed asset: gross income through to
 * net operating income, and the yield / coverage measures a commercial lender
 * strikes against it.
 *
 * The chain is deliberately explicit rather than one expression, because the
 * "How this was calculated" panel renders each step and a user has to be able
 * to see where their number went.
 */

import {
  centsOf,
  multiplyCents,
  percentOfCents,
  ratio,
  roundRatio,
  safePercent,
  sumCents,
  type Cents,
} from './money';
import type { AssessmentPayload, LeaseTenancy } from './types';

export interface PropertyIncomeResult {
  grossPropertyIncomeCents: Cents;
  recoverableOutgoingsCents: Cents;
  potentialGrossIncomeCents: Cents;
  vacancyAllowanceCents: Cents;
  incentiveAllowanceCents: Cents;
  effectiveGrossIncomeCents: Cents;

  nonRecoverableOutgoingsCents: Cents;
  managementAllowanceCents: Cents;
  totalOperatingExpensesCents: Cents;

  netOperatingIncomeCents: Cents;

  grossYield: number;
  netYield: number;
  capitalisationRate: number;
  debtYield: number;
  expenseRatio: number;
  breakEvenOccupancy: number;

  wale: number;
  tenantCount: number;
  /** Share of income from the largest tenant. 1 = single-tenant. */
  tenantConcentration: number;
  leaseExpiryWithin12Months: number;
  marketRentVariance: number;

  notes: string[];
}

/** Annualise a rent figure quoted at a non-annual frequency. */
export function annualiseRent(amount: number, frequency: 'annual' | 'monthly' | 'quarterly' | 'weekly'): number {
  if (!Number.isFinite(amount)) return 0;
  switch (frequency) {
    case 'monthly': return amount * 12;
    case 'quarterly': return amount * 4;
    case 'weekly': return amount * 52;
    default: return amount;
  }
}

/**
 * Weighted average lease expiry, weighted by income (the convention lenders
 * use — an area weighting flatters a portfolio with a large cheap tenancy).
 */
export function calculateWale(tenancies: LeaseTenancy[], asAt = new Date()): number {
  const dated = tenancies.filter((tenancy) => tenancy.leaseExpiry && tenancy.annualRent > 0);
  if (!dated.length) return 0;
  const totalRent = dated.reduce((sum, tenancy) => sum + tenancy.annualRent, 0);
  if (totalRent <= 0) return 0;
  const weightedYears = dated.reduce((sum, tenancy) => {
    const expiry = new Date(tenancy.leaseExpiry);
    if (Number.isNaN(expiry.getTime())) return sum;
    const years = Math.max(0, (expiry.getTime() - asAt.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    return sum + years * tenancy.annualRent;
  }, 0);
  return roundRatio(weightedYears / totalRent);
}

export function calculatePropertyIncome(
  payload: AssessmentPayload,
  valuationCents: Cents,
  proposedLoanCents: Cents,
  asAt = new Date(),
): PropertyIncomeResult {
  const lease = payload.lease;
  const notes: string[] = [];

  const tenancyRentAnnual = lease.tenancies.reduce(
    (sum, tenancy) => sum + annualiseRent(tenancy.annualRent, lease.rentFrequency),
    0,
  );
  const grossPropertyIncomeCents = centsOf(tenancyRentAnnual);

  // A net lease already has outgoings paid by the tenant on top of rent; a
  // gross lease does not, so recoverable outgoings only add to income where
  // the lease actually recovers them.
  const recoverableOutgoingsCents = lease.leaseBasis === 'gross'
    ? 0
    : centsOf(lease.recoverableOutgoings);
  if (lease.leaseBasis === 'gross' && lease.recoverableOutgoings > 0) {
    notes.push('Recoverable outgoings excluded from income: the lease is written on a gross basis.');
  }

  const potentialGrossIncomeCents = sumCents(grossPropertyIncomeCents, recoverableOutgoingsCents);

  const vacancyAllowanceCents = percentOfCents(
    potentialGrossIncomeCents,
    safePercent(lease.vacancyAllowancePercent),
  );

  // Rent-free periods are amortised across the first year alongside any
  // explicit incentive, because that is the income the asset actually earns.
  const rentFreeCents = lease.rentFreeMonths > 0
    ? multiplyCents(grossPropertyIncomeCents, Math.min(12, lease.rentFreeMonths) / 12)
    : 0;
  const incentiveAllowanceCents = sumCents(centsOf(lease.incentiveAllowance), rentFreeCents);
  if (rentFreeCents > 0) {
    notes.push(`${lease.rentFreeMonths} month(s) rent free amortised across year one.`);
  }

  const effectiveGrossIncomeCents = Math.max(
    0,
    potentialGrossIncomeCents - vacancyAllowanceCents - incentiveAllowanceCents,
  );

  const nonRecoverableOutgoingsCents = centsOf(lease.nonRecoverableOutgoings);
  const managementAllowanceCents = percentOfCents(
    effectiveGrossIncomeCents,
    safePercent(lease.managementAllowancePercent),
  );
  const totalOperatingExpensesCents = sumCents(
    nonRecoverableOutgoingsCents,
    managementAllowanceCents,
    // On a net lease the recoverable outgoings were added to income above, so
    // they must also appear as an expense — the landlord pays and recovers.
    lease.leaseBasis === 'gross' ? centsOf(lease.recoverableOutgoings) : recoverableOutgoingsCents,
  );

  const netOperatingIncomeCents = effectiveGrossIncomeCents - totalOperatingExpensesCents;

  const grossYield = ratio(potentialGrossIncomeCents, valuationCents);
  const netYield = ratio(netOperatingIncomeCents, valuationCents);
  const capitalisationRate = netYield;
  const debtYield = ratio(netOperatingIncomeCents, proposedLoanCents);
  const expenseRatio = ratio(totalOperatingExpensesCents, effectiveGrossIncomeCents);

  // Break-even occupancy: the share of potential gross income needed to cover
  // operating expenses. Debt service is tested separately by DSCR.
  const breakEvenOccupancy = potentialGrossIncomeCents > 0
    ? roundRatio(totalOperatingExpensesCents / potentialGrossIncomeCents)
    : 0;

  const wale = calculateWale(lease.tenancies, asAt);
  const tenantCount = lease.tenancies.filter((tenancy) => tenancy.tenantName.trim() !== '').length;

  const rents = lease.tenancies.map((tenancy) => annualiseRent(tenancy.annualRent, lease.rentFrequency));
  const largestRent = rents.length ? Math.max(...rents) : 0;
  const tenantConcentration = tenancyRentAnnual > 0 ? roundRatio(largestRent / tenancyRentAnnual) : 0;

  const horizon = new Date(asAt.getTime() + 365.25 * 24 * 60 * 60 * 1000);
  const expiringRent = lease.tenancies.reduce((sum, tenancy) => {
    if (!tenancy.leaseExpiry) return sum;
    const expiry = new Date(tenancy.leaseExpiry);
    if (Number.isNaN(expiry.getTime())) return sum;
    return expiry <= horizon ? sum + annualiseRent(tenancy.annualRent, lease.rentFrequency) : sum;
  }, 0);
  const leaseExpiryWithin12Months = tenancyRentAnnual > 0
    ? roundRatio(expiringRent / tenancyRentAnnual)
    : 0;

  const marketRentCents = centsOf(lease.marketRentAnnual);
  const marketRentVariance = marketRentCents > 0
    ? roundRatio((grossPropertyIncomeCents - marketRentCents) / marketRentCents)
    : 0;

  if (marketRentVariance > 0.1) {
    notes.push('Passing rent is more than 10% above the stated market rent — reversion risk on expiry.');
  }
  if (tenantCount === 1 && tenancyRentAnnual > 0) {
    notes.push('Single-tenant asset: income falls to zero on vacancy.');
  }
  if (netOperatingIncomeCents < 0) {
    notes.push('Operating expenses exceed effective gross income — net operating income is negative.');
  }

  return {
    grossPropertyIncomeCents,
    recoverableOutgoingsCents,
    potentialGrossIncomeCents,
    vacancyAllowanceCents,
    incentiveAllowanceCents,
    effectiveGrossIncomeCents,
    nonRecoverableOutgoingsCents,
    managementAllowanceCents,
    totalOperatingExpensesCents,
    netOperatingIncomeCents,
    grossYield,
    netYield,
    capitalisationRate,
    debtYield,
    expenseRatio,
    breakEvenOccupancy,
    wale,
    tenantCount,
    tenantConcentration,
    leaseExpiryWithin12Months,
    marketRentVariance,
    notes,
  };
}
