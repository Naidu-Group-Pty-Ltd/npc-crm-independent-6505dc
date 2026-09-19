export type CommercialGstTreatment = 'plusGst' | 'gstInclusive' | 'goingConcern' | 'marginScheme' | 'unknown';
export type GstPriceBasis = 'inclusive' | 'exclusive' | 'unknown';
type GstTriState = 'yes' | 'no' | 'unknown';
export interface CommercialGstEngineInputs { purchasePrice: number; treatment: CommercialGstTreatment; priceBasis?: GstPriceBasis; vendorGstRegistered?: GstTriState; purchaserGstRegistered?: GstTriState; goingConcernAgreedInWriting?: GstTriState; enterpriseCarriedOnUntilSettlement?: GstTriState; supplierProvidesAllThingsNecessary?: GstTriState; propertyLeasedOrOperatingEnterprise?: GstTriState; gstPayableAtSettlement?: GstTriState; gstClaimableAsInputTaxCredit?: GstTriState; estimatedRefundTiming?: 'atSettlement' | 'oneToThreeMonths' | 'threePlusMonths' | 'unknown'; manualSettlementCashflowOverride?: number; otherAcquisitionCosts?: number; }
export interface CommercialGstEngineResult { gstAmount: number; gstEconomicCost: number; gstSettlementCashflowRequirement: number; gstClaimableAmount: number; netAcquisitionCost: number; gstTimingRisk: 'low' | 'medium' | 'high' | 'unknown'; gstVerificationStatus: 'Verified' | 'Unknown' | 'Specialist Review Required'; warnings: string[]; }
const allYes = (xs: GstTriState[]) => xs.every(x => x === 'yes');
export function calculateCommercialGstEngine(i: CommercialGstEngineInputs): CommercialGstEngineResult {
  const warnings: string[] = [];
  let gstAmount = 0, cashflow = 0, claimable = 0, economicCost = 0;
  let status: CommercialGstEngineResult['gstVerificationStatus'] = 'Unknown';
  const claimableYes = i.gstClaimableAsInputTaxCredit === undefined
    ? i.purchaserGstRegistered === 'yes'
    : i.gstClaimableAsInputTaxCredit === 'yes';
  if (i.treatment === 'plusGst') {
    gstAmount = i.purchasePrice * 0.1;
    cashflow = i.manualSettlementCashflowOverride ?? gstAmount;
    claimable = claimableYes ? gstAmount : 0;
    economicCost = claimableYes ? 0 : gstAmount;
    status = i.vendorGstRegistered === 'yes' && i.purchaserGstRegistered !== 'unknown' ? 'Verified' : 'Specialist Review Required';
  } else if (i.treatment === 'gstInclusive') {
    gstAmount = i.purchasePrice / 11;
    cashflow = i.manualSettlementCashflowOverride ?? 0;
    claimable = claimableYes ? gstAmount : 0;
    economicCost = claimableYes ? 0 : gstAmount;
    status = i.vendorGstRegistered === 'yes' && i.purchaserGstRegistered !== 'unknown' ? 'Verified' : 'Specialist Review Required';
  } else if (i.treatment === 'goingConcern') {
    const conditions = [i.goingConcernAgreedInWriting ?? 'unknown', i.enterpriseCarriedOnUntilSettlement ?? 'unknown', i.supplierProvidesAllThingsNecessary ?? 'unknown', i.propertyLeasedOrOperatingEnterprise ?? 'unknown', i.vendorGstRegistered ?? 'unknown', i.purchaserGstRegistered ?? 'unknown'];
    if (allYes(conditions)) { cashflow = 0; gstAmount = 0; status = 'Verified'; }
    else { status = 'Specialist Review Required'; warnings.push('Going concern treatment is not verified.'); }
  } else if (i.treatment === 'marginScheme') {
    gstAmount = i.purchasePrice / 11;
    cashflow = i.manualSettlementCashflowOverride ?? 0;
    claimable = 0;
    economicCost = gstAmount;
    status = 'Specialist Review Required';
    warnings.push('Margin scheme requires specialist tax/legal review; input tax credits are generally unavailable.');
  } else {
    status = 'Specialist Review Required';
    warnings.push('Unknown GST must not produce Green purchase ability.');
  }
  if (status !== 'Verified') warnings.push('Solicitor/accountant confirmation required before relying on GST output.');
  const timingRisk = i.treatment === 'unknown' ? 'unknown' : cashflow > 0 && claimable > 0 && i.estimatedRefundTiming !== 'atSettlement' ? 'medium' : status === 'Specialist Review Required' ? 'high' : 'low';
  return { gstAmount, gstEconomicCost: economicCost, gstSettlementCashflowRequirement: cashflow, gstClaimableAmount: claimable, netAcquisitionCost: i.purchasePrice + (i.otherAcquisitionCosts ?? 0) + cashflow + economicCost - claimable, gstTimingRisk: timingRisk, gstVerificationStatus: status, warnings };
}
