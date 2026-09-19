/**
 * Industrial NOI — most industrial leases are net (tenant pays outgoings),
 * so non-recoverable opex is typically a thin sliver (sinking fund, structural,
 * uninsured risk). Includes an explicit capex reserve.
 */
export interface IndustrialOutgoings {
  council?: number;
  water?: number;
  land_tax?: number;
  insurance?: number;
  management?: number;
  repairs_maintenance?: number;
  sinking_fund?: number;
  compliance?: number;
  other?: number;
}

export interface IndustrialNoiInputs {
  /** Sum of all base rents PA (net of incentives) */
  grossRentalIncome: number;
  /** Other income — signage, antenna, hardstand leases */
  otherIncome?: number;
  /** Vacancy + credit loss allowance (0-100) */
  vacancyAllowancePct?: number;
  /** Recovered outgoings from tenants PA */
  recoveredOutgoings?: number;
  /** Itemised outgoings (PA) */
  outgoings: IndustrialOutgoings;
  /** Annual capex reserve (PA) — sinking fund for roof, hardstand, racking */
  capexReservePa?: number;
}

export interface IndustrialNoiResult {
  potentialGrossIncome: number;
  vacancyLoss: number;
  effectiveGrossIncome: number;
  totalOutgoings: number;
  recoveredOutgoings: number;
  netOutgoings: number;
  capexReserve: number;
  noi: number;
}

export function sumIndustrialOutgoings(o: IndustrialOutgoings): number {
  return Object.values(o).reduce((a, b) => a + (Number(b) || 0), 0);
}

export function calculateIndustrialNoi(inputs: IndustrialNoiInputs): IndustrialNoiResult {
  const pgi = (inputs.grossRentalIncome || 0) + (inputs.otherIncome || 0);
  const vPct = Math.max(0, Math.min(100, inputs.vacancyAllowancePct ?? 0));
  const vacancyLoss = pgi * (vPct / 100);
  const totalOutgoings = sumIndustrialOutgoings(inputs.outgoings);
  const recovered = inputs.recoveredOutgoings ?? 0;
  const netOutgoings = Math.max(0, totalOutgoings - recovered);
  const capexReserve = Math.max(0, inputs.capexReservePa ?? 0);
  const egi = pgi - vacancyLoss + recovered;
  const noi = egi - totalOutgoings - capexReserve;
  return {
    potentialGrossIncome: Number(pgi.toFixed(2)),
    vacancyLoss: Number(vacancyLoss.toFixed(2)),
    effectiveGrossIncome: Number(egi.toFixed(2)),
    totalOutgoings: Number(totalOutgoings.toFixed(2)),
    recoveredOutgoings: Number(recovered.toFixed(2)),
    netOutgoings: Number(netOutgoings.toFixed(2)),
    capexReserve: Number(capexReserve.toFixed(2)),
    noi: Number(noi.toFixed(2)),
  };
}
