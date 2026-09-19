import type { CommercialIndustrialDealProfile } from './commercialDealState';
export type GlobalWarningGroup = 'Financial' | 'Data' | 'Asset' | 'Structure' | 'Lender' | 'Goods and Services Tax / Duty' | 'Discounted Cash Flow / Return' | 'Specialist Review';
export interface GlobalWarning { group: GlobalWarningGroup; message: string; fieldKey?: string; severity: 'info' | 'amber' | 'red'; }
export function generateGlobalWarnings(profile: CommercialIndustrialDealProfile): Record<GlobalWarningGroup, GlobalWarning[]> {
  const warnings: GlobalWarning[] = [];
  const price = profile.propertyValuation.purchasePrice ?? 0;
  if (price <= 0) warnings.push({ group: 'Financial', message: 'Purchase price must be greater than zero.', fieldKey: 'propertyValuation.purchasePrice', severity: 'red' });
  if ((profile.propertyValuation.estimatedMarketValue ?? 0) <= 0) warnings.push({ group: 'Financial', message: 'Property value must be greater than zero.', fieldKey: 'propertyValuation.estimatedMarketValue', severity: 'red' });
  if (profile.leaseIncome.leaseType === 'unknown') warnings.push({ group: 'Data', message: 'Lease type is unknown; NOI cannot be Verified.', fieldKey: 'leaseIncome.leaseType', severity: 'amber' });
  if (profile.gstInputs.treatment === 'unknown') warnings.push({ group: 'Goods and Services Tax / Duty', message: 'Unknown GST cannot produce Green purchase ability.', fieldKey: 'gstInputs.treatment', severity: 'red' });
  if (profile.dealProfile.assetCategory === 'industrial' && profile.riskInputs.environmentalRisk == null) warnings.push({ group: 'Asset', message: 'Industrial environmental risk is unknown; overall status cannot be Green.', fieldKey: 'riskInputs.environmentalRisk', severity: 'red' });
  if (profile.purchaserStructure.purchaserType === 'smsf') warnings.push({ group: 'Specialist Review', message: 'SMSF selected; specialist review required unless SMSF module is complete.', fieldKey: 'purchaserStructure.purchaserType', severity: 'red' });
  if ((profile.dcfInputs.capexSchedule?.length ?? 0) === 0 && !(profile.dcfInputs as any).annualCapex) warnings.push({ group: 'Discounted Cash Flow / Return', message: 'DCF capex is zero or missing; returns may be overstated.', fieldKey: 'dcfInputs.capexSchedule', severity: 'amber' });
  if (Object.values(profile.aiEstimateMetadata).some(e => e.confidenceTag === 'AI Estimate' && e.verificationRequired)) warnings.push({ group: 'Data', message: 'AI estimates are used for feasibility and must be verified before final reliance.', severity: 'amber' });
  const grouped = { Financial: [], Data: [], Asset: [], Structure: [], Lender: [], 'Goods and Services Tax / Duty': [], 'Discounted Cash Flow / Return': [], 'Specialist Review': [] } as Record<GlobalWarningGroup, GlobalWarning[]>;
  warnings.forEach(w => grouped[w.group].push(w));
  return grouped;
}
