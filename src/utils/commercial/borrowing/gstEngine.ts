import type { AcquisitionCosts, GstResult } from './calculatorTypes';

export function calculateGstAssessment(purchasePrice: number, costs: AcquisitionCosts): GstResult {
  const warnings: string[] = [];
  const gst = costs.gstAmount > 0 ? costs.gstAmount : Math.max(0, purchasePrice * 0.1);
  let economicCost = 0;
  let settlementCashflowRequirement = 0;
  let claimableAmount = 0;
  if (costs.gstTreatment === 'plusGst') {
    settlementCashflowRequirement = costs.gstCashflowRequired === 'no' ? 0 : gst;
    claimableAmount = costs.gstClaimable === 'yes' ? gst : 0;
    economicCost = costs.gstClaimable === 'yes' ? 0 : gst;
  } else if (costs.gstTreatment === 'gstInclusive') {
    claimableAmount = costs.gstClaimable === 'yes' ? gst / 11 : 0;
    economicCost = costs.gstClaimable === 'yes' ? 0 : gst / 11;
  } else if (costs.gstTreatment === 'marginScheme') {
    economicCost = Math.max(0, gst * 0.4);
    settlementCashflowRequirement = costs.gstCashflowRequired === 'yes' ? economicCost : 0;
  } else if (costs.gstTreatment === 'unknown') {
    warnings.push('GST treatment is unknown. Funds-to-complete may be materially understated.');
    settlementCashflowRequirement = costs.gstCashflowRequired === 'yes' ? gst : 0;
  }
  if (costs.goingConcernConfirmed === 'unknown' || (costs.gstTreatment === 'gstFreeGoingConcern' && costs.goingConcernConfirmed !== 'yes')) warnings.push('Going concern GST treatment has not been fully verified. Confirm with solicitor/accountant before relying on funds-to-complete.');
  if (costs.landholderAcquisition === 'yes') warnings.push('Landholder acquisition selected. Specialist duty/legal review is required.');
  warnings.push('Transfer duty and state charges are estimates only and require solicitor/state revenue confirmation.');
  if (costs.vicCommercialIndustrialPropertyTax === 'yes') warnings.push('VIC commercial / industrial property tax treatment should be confirmed for this transaction.');
  if (costs.saQualifyingNonResidentialLand === 'yes') warnings.push('SA qualifying non-residential land duty treatment should be confirmed.');
  const timingRisk = costs.gstTreatment === 'unknown' ? 'unknown' : settlementCashflowRequirement > 0 && claimableAmount > 0 && costs.estimatedGstRefundTiming !== 'atSettlement' ? 'medium' : 'low';
  const status = warnings.some(w => w.includes('Landholder')) ? 'specialistReview' : costs.gstTreatment === 'unknown' ? 'red' : warnings.length ? 'amber' : 'green';
  return { economicCost, settlementCashflowRequirement, claimableAmount, timingRisk, status, warnings };
}
