/**
 * Net Operating Income (NOI) Calculator for Commercial Property
 *
 * NOI = Effective Gross Income - Operating Expenses (non-recoverable)
 * EGI = Potential Gross Income - Vacancy & Credit Loss + Other Income
 */

export interface OutgoingsBreakdown {
  council?: number;
  water?: number;
  land_tax?: number;
  insurance?: number;
  management?: number;
  repairs_maintenance?: number;
  utilities?: number;
  cleaning?: number;
  security?: number;
  other?: number;
}

export interface NoiInputs {
  /** Sum of all base rents PA across tenancies */
  grossRentalIncome: number;
  /** Recovered outgoings from tenants PA */
  recoveredOutgoings?: number;
  /** Other income (signage, parking, antennas) */
  otherIncome?: number;
  /** Vacancy + credit loss allowance as % (0-100) */
  vacancyAllowancePct?: number;
  /** Total operating expenses (gross outgoings) */
  outgoings: OutgoingsBreakdown;
  /** Portion of outgoings that are NOT recoverable (owner's cost). 0-100. */
  nonRecoverablePct?: number;
}

export interface NoiResult {
  potentialGrossIncome: number;
  vacancyLoss: number;
  effectiveGrossIncome: number;
  totalOutgoings: number;
  recoveredOutgoings: number;
  netOutgoings: number;
  noi: number;
}

export function sumOutgoings(o: OutgoingsBreakdown): number {
  return Object.values(o).reduce((a, b) => a + (Number(b) || 0), 0);
}

export function calculateNoi(inputs: NoiInputs): NoiResult {
  const pgi = (inputs.grossRentalIncome || 0) + (inputs.otherIncome || 0);
  const vacancyPct = Math.max(0, Math.min(100, inputs.vacancyAllowancePct ?? 0));
  const vacancyLoss = pgi * (vacancyPct / 100);
  const totalOutgoings = sumOutgoings(inputs.outgoings);
  const recovered = inputs.recoveredOutgoings ?? 0;
  const nonRecoverableOutgoings = inputs.nonRecoverablePct != null
    ? totalOutgoings * (Math.max(0, Math.min(100, inputs.nonRecoverablePct)) / 100)
    : Math.max(0, totalOutgoings - recovered);
  const egi = pgi - vacancyLoss + recovered;
  const noi = egi - totalOutgoings;

  return {
    potentialGrossIncome: pgi,
    vacancyLoss,
    effectiveGrossIncome: egi,
    totalOutgoings,
    recoveredOutgoings: recovered,
    netOutgoings: nonRecoverableOutgoings,
    noi,
  };
}
