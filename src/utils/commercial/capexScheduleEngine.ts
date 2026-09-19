import type { TenYearCashFlowInputs } from './tenYearCashFlowTypes';
export function buildCapexWarnings(inputs: TenYearCashFlowInputs): string[] {
  const warnings: string[] = [];
  if (inputs.annualCapexReserve <= 0 && (inputs.environmentalReserve <= 0 || inputs.asbestosReserve <= 0)) warnings.push('Capex estimates are zero or incomplete; cashflow may be overstated.');
  if (inputs.assetDomain === 'industrial' && inputs.specialistReserve <= 0) warnings.push('Industrial roof/slab/hardstand/fire/power reserves are not verified.');
  if (inputs.assetDomain === 'commercial' && inputs.incentiveMonths <= 0 && inputs.downtimeMonths <= 0) warnings.push('Commercial leasing downtime and incentive allowances are not verified.');
  return warnings;
}
