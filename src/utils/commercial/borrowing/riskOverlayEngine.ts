import type { BorrowingInputs, RiskLevel, RiskOverlayResult } from './calculatorTypes';

function levelFromScore(score: number, critical: boolean): RiskLevel {
  if (critical) return 'critical';
  if (score >= 8) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

export function assessRiskOverlay(inputs: BorrowingInputs): RiskOverlayResult {
  const r = inputs.riskInputs;
  const warnings: string[] = [];
  let score = 0;
  let critical = false;

  if (inputs.dealProfile.assetCategory === 'commercial') {
    if (inputs.income.wale >= 2 && inputs.income.wale <= 5) score += 1;
    if (inputs.income.wale > 0 && inputs.income.wale < 2) { score += 3; warnings.push('Commercial lease WALE is under 2 years.'); }
    if (inputs.dealProfile.leaseStatus === 'vacant') { score += 4; warnings.push('Commercial asset is vacant or has no verified passing income.'); }
    if (inputs.dealProfile.leaseStatus === 'partiallyLeased') score += 2;
    if (r.vacancyLevel === 'major') score += 3;
    if (r.rentComparedToMarket === 'materiallyOver' || inputs.income.rentOverMarket === 'yes') { score += 2; warnings.push('Rent may be above market and has been haircut in lender-adjusted NOI.'); }
    if (r.incentivesSideAgreements === 'yes') score += 2;
    if (r.arrears === 'yes') { score += 3; warnings.push('Tenant arrears require rent ledger verification.'); }
    if (r.buildingCondition === 'poor') score += 3;
    if (r.zoningCertainty === 'uncertain') score += 2;
    if (r.zoningCertainty === 'notPermitted') { critical = true; warnings.push('Permitted use / zoning issue requires specialist review.'); }
    if (r.leaseDocumentationComplete === 'no' || r.leaseDocumentationComplete === 'unknown') { score += 4; warnings.push('Lease documentation is incomplete.'); }
  } else {
    if (inputs.propertyValuation.truckAccessQuality === 'poor') { score += 3; warnings.push('Industrial truck access is poor and may affect lender appetite.'); }
    if ((inputs.propertyValuation.clearanceHeight ?? 0) > 0 && (inputs.propertyValuation.clearanceHeight ?? 0) < 6) score += 2;
    if (inputs.propertyValuation.powerCapacity === 'unknown') score += 1;
    if (inputs.propertyValuation.slabCondition === 'poor' || inputs.propertyValuation.roofCondition === 'poor') { score += 3; warnings.push('Poor slab or roof condition may require structural due diligence.'); }
    if (r.environmentalRisk === 'unknown') { score += 3; warnings.push('Industrial environmental status is unknown; lender may require environmental review.'); }
    if (r.asbestosRisk === 'unknown') { score += 2; warnings.push('Industrial asbestos status is unknown; lender may require an asbestos review.'); }
    if (r.environmentalRisk === 'present' || r.asbestosRisk === 'likely') score += 4;
    if (r.environmentalRisk === 'present') warnings.push('Environmental risk is present and requires lender due diligence.');
    if (r.capexRequired === 'heavy') { score += 4; warnings.push('Heavy industrial capex requirement may reduce financeability.'); }
    if (r.specialisedImprovements === 'yes' || r.tenantOperatorSpecialisation === 'yes') score += 2;
    if (r.environmentalRisk === 'knownContamination' || r.asbestosRisk === 'confirmed' || r.zoningCertainty === 'notPermitted' || r.dangerousGoodsUse === 'yes' || r.tradeWasteRequirements === 'yes') {
      critical = true;
      warnings.push('Critical industrial technical risk means the borrowing output is indicative only.');
    }
  }

  if (inputs.purchaserStructure.purchaserType === 'smsf' || inputs.lendingAssumptions.profile === 'smsfCommercial' || inputs.purchaserStructure.smsfSpecialistReviewRequired) {
    critical = true;
    warnings.push('SMSF commercial lending requires specialist LRBA and legal review.');
  }
  if (inputs.dealProfile.acquisitionPurpose === 'development') { score += 3; warnings.push('Development / repositioning requires specialist construction or transition funding assessment.'); }

  const level = levelFromScore(score, critical);
  const settings = {
    low: { noiHaircutPct: 0, lvrAdjustmentPct: 0, icrAdjustment: 0, dscrAdjustment: 0, additionalCapexReserve: 0, debtYieldAdjustment: 0 },
    medium: { noiHaircutPct: 0.05, lvrAdjustmentPct: -0.025, icrAdjustment: 0.05, dscrAdjustment: 0.05, additionalCapexReserve: inputs.dealProfile.assetCategory === 'industrial' ? 25000 : 0, debtYieldAdjustment: 0.005 },
    high: { noiHaircutPct: 0.12, lvrAdjustmentPct: -0.075, icrAdjustment: 0.15, dscrAdjustment: 0.1, additionalCapexReserve: inputs.dealProfile.assetCategory === 'industrial' ? 75000 : 0, debtYieldAdjustment: 0.01 },
    critical: { noiHaircutPct: 0.2, lvrAdjustmentPct: -0.15, icrAdjustment: 0.25, dscrAdjustment: 0.2, additionalCapexReserve: inputs.dealProfile.assetCategory === 'industrial' ? 125000 : 50000, debtYieldAdjustment: 0.015 },
  }[level];

  if (level === 'medium') warnings.push(`${inputs.dealProfile.assetCategory === 'industrial' ? 'Industrial due diligence' : 'Commercial lease'} risk overlay applied.`);
  if (level === 'high') warnings.push('High risk overlay reduces LVR and increases serviceability hurdles.');


  const commercialRisk = inputs.dealProfile.assetCategory === 'commercial' ? {
    leaseQualityScore: Math.max(0, 100 - score * 8 - (inputs.income.wale < 2 ? 15 : 0)),
    tenantCovenantScore: inputs.income.tenantCovenant === 'government' || inputs.income.tenantCovenant === 'nationalTenant' ? 90 : inputs.income.tenantCovenant === 'weakUnknown' ? 35 : 65,
    marketRentRisk: inputs.income.rentOverMarket === 'yes' ? 'Passing rent appears above market; over-rent haircut applied.' : 'No material over-rent identified.',
    leaseExpiryRisk: inputs.income.wale < 2 ? 'High lease expiry risk due to WALE below 2 years.' : 'Lease expiry risk acceptable subject to verification.',
    lenderAdjustedNoiBridge: ['Actual NOI', 'Stabilised NOI', 'Lender-adjusted NOI after vacancy, tenant and over-rent haircuts'],
    warnings: warnings.filter(w => w.toLowerCase().includes('lease') || w.toLowerCase().includes('rent') || w.toLowerCase().includes('tenant')),
  } : undefined;
  const industrialRisk = inputs.dealProfile.assetCategory === 'industrial' ? {
    industrialUsabilityScore: Math.max(0, 100 - score * 7 - (inputs.propertyValuation.truckAccessQuality === 'poor' ? 15 : 0)),
    environmentalRiskStatus: r.environmentalRisk ?? 'unknown',
    asbestosRiskStatus: r.asbestosRisk ?? 'unknown',
    technicalAssetRisk: level === 'critical' ? 'Specialist technical review required' : level === 'high' ? 'High technical risk' : level === 'medium' ? 'Moderate technical risk' : 'Low technical risk',
    industrialCapexReserve: settings.additionalCapexReserve,
    industrialValuationConfidence: inputs.propertyValuation.valuationConfidence,
    warnings: warnings.filter(w => w.toLowerCase().includes('industrial') || w.toLowerCase().includes('environmental') || w.toLowerCase().includes('asbestos') || w.toLowerCase().includes('roof') || w.toLowerCase().includes('slab')),
  } : undefined;
  return { level, score, specialistReview: level === 'critical', warnings, riskAdjustedAssetCap: undefined, commercialRisk, industrialRisk, ...settings };
}
