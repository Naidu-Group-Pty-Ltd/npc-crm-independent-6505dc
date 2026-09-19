import type { TenYearCashFlowInputs } from './tenYearCashFlowTypes';
export function buildLeasingWarnings(inputs: TenYearCashFlowInputs): string[] {
  const warnings: string[] = [];
  if (inputs.passingRent <= 0 && inputs.mode !== 'ownerOccupier') warnings.push('Rent or NOI must be provided for investor/related-party cashflow.');
  if (inputs.downtimeMonths <= 0 && inputs.vacancyAllowancePct > 0) warnings.push('Lease downtime is not separately modelled; vacancy allowance is carrying downtime risk.');
  if (inputs.relatedPartyRent <= 0 && inputs.mode === 'relatedPartyLease') warnings.push('Related-party rent must be provided.');
  if (inputs.mode === 'relatedPartyLease' && !inputs.marketRentSupportAvailable) warnings.push('Market rent support is required for related-party lease assumptions.');
  return warnings;
}
