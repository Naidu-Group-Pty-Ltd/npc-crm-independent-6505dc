import type { AcquisitionCosts, FundsToCompleteResult, GstTreatment } from './calculatorTypes';
import { calculateGstAssessment } from './gstEngine';

const sum = (values: number[]) => values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

export function calculateGstCashflow(purchasePrice: number, treatment: GstTreatment, gstCashflowRequired: string): number {
  if (treatment === 'plusGst' && gstCashflowRequired === 'yes') return Math.max(0, purchasePrice * 0.1);
  return 0;
}

export function calculateFundsToComplete(purchasePrice: number, costs: AcquisitionCosts, finalLoan: number, availableEquity: number, additionalCapexReserve = 0, annualDebtService = 0, ownerBorneOutgoings = 0): FundsToCompleteResult {
  const warnings: string[] = [];
  const acquisitionCostLineItems = { stampDuty: costs.stampDuty, transferRegistrationFee: costs.transferRegistrationFee, mortgageRegistrationFee: costs.mortgageRegistrationFee, pexaSettlementFee: costs.pexaSettlementFee, legalConveyancingFee: costs.legalConveyancingFee, bankLegalFee: costs.bankLegalFee, valuationFee: costs.valuationFee, loanApplicationFee: costs.loanApplicationFee, buyersAgentFee: costs.buyersAgentFee, buildingInspection: costs.buildingInspection, pestInspection: costs.pestInspection, structuralInspection: costs.structuralInspection, fireComplianceInspection: costs.fireComplianceInspection, planningZoningReview: costs.planningZoningReview, environmentalReport: costs.environmentalReport, asbestosReport: costs.asbestosReport, dueDiligence: costs.dueDiligence, otherAcquisitionCosts: costs.otherAcquisitionCosts };
  const totalAcquisitionCosts = sum(Object.values(acquisitionCostLineItems));
  const gst = calculateGstAssessment(purchasePrice, costs);
  warnings.push(...gst.warnings);
  const capexReserve = Math.max(0, costs.capexReserve + additionalCapexReserve);
  const totalCostBase = Math.max(0, purchasePrice + totalAcquisitionCosts + gst.settlementCashflowRequirement + gst.economicCost + capexReserve + costs.workingCapitalReserve);
  const requiredEquity = Math.max(0, totalCostBase - Math.max(0, finalLoan));
  const equitySurplusShortfall = availableEquity - requiredEquity;
  if (equitySurplusShortfall < 0) warnings.push('Available equity is below required funds to complete.');
  const postSettlementLiquidity = equitySurplusShortfall;
  const monthlyDebtService = annualDebtService / 12;
  const monthlyOwnerBorneOutgoings = ownerBorneOutgoings / 12;
  const monthsDebtServiceCovered = postSettlementLiquidity < 0 ? null : (monthlyDebtService > 0 ? postSettlementLiquidity / monthlyDebtService : 0);
  const monthsOutgoingsCovered = postSettlementLiquidity < 0 ? null : (monthlyOwnerBorneOutgoings > 0 ? postSettlementLiquidity / monthlyOwnerBorneOutgoings : 0);
  const minimumLiquidityRequirement = Math.max(costs.minimumPostSettlementLiquidityReserve ?? 0, monthlyDebtService * (costs.requiredDebtServiceReserveMonths ?? 3), monthlyOwnerBorneOutgoings * (costs.requiredOutgoingsReserveMonths ?? 3));
  const liquiditySurplusShortfall = postSettlementLiquidity - minimumLiquidityRequirement;
  const liquidityStatus = postSettlementLiquidity < 0 ? 'insufficient' : liquiditySurplusShortfall >= minimumLiquidityRequirement ? 'strong' : liquiditySurplusShortfall >= 0 ? 'acceptable' : postSettlementLiquidity > 0 ? 'tight' : 'insufficient';
  if (liquidityStatus === 'tight') warnings.push('Post-settlement liquidity is tight.');
  if (liquidityStatus === 'insufficient') warnings.push('Post-settlement liquidity is insufficient.');
  return { totalAcquisitionCosts, acquisitionCostLineItems, gstCashflowRequirement: gst.settlementCashflowRequirement, totalCostBase, requiredEquity, equitySurplusShortfall, capexReserve, postSettlementLiquidity, monthlyDebtService, monthlyOwnerBorneOutgoings, monthsDebtServiceCovered, monthsOutgoingsCovered, minimumLiquidityRequirement, liquiditySurplusShortfall, liquidityStatus, gst, warnings };
}
