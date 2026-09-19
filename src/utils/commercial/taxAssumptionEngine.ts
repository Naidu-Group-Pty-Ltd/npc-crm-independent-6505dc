import type { TenYearCashFlowInputs } from './tenYearCashFlowTypes';
export function buildTaxWarnings(inputs: TenYearCashFlowInputs): string[] {
  const warnings: string[] = [];
  if (inputs.taxRatePct < 0 || inputs.taxRatePct > 100) warnings.push('Tax rate must be between 0% and 100%.');
  if (inputs.accountantReviewRequired || ['company','discretionaryTrust','unitTrust','smsf','spv'].includes(String(inputs.ownershipStructure))) warnings.push('Tax assumptions require accountant review unless independently verified.');
  if ((inputs.depreciationPa + inputs.capitalWorksDeductionPa + inputs.plantEquipmentDepreciationPa) > 0 && inputs.accountantReviewRequired) warnings.push('Depreciation and capital works deductions are indicative until verified by an accountant/depreciation schedule.');
  return warnings;
}
