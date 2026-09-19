import type { BorrowingInputs, ReverseCalculatorResult } from './calculatorTypes';

function estimateAcquisitionCostsAtPrice(inputs: BorrowingInputs, price: number): number {
  const c = inputs.acquisitionCosts;
  const currentPrice = Math.max(1, inputs.propertyValuation.purchasePrice);
  const dutyRatio = (c.stampDuty ?? 0) / currentPrice;
  const variableDuty = price * dutyRatio;
  const fixedCosts = (c.transferRegistrationFee ?? 0) + (c.mortgageRegistrationFee ?? 0) + (c.pexaSettlementFee ?? 0) + (c.legalConveyancingFee ?? 0) + (c.bankLegalFee ?? 0) + (c.valuationFee ?? 0) + (c.loanApplicationFee ?? 0) + (c.buyersAgentFee ?? 0) + (c.buildingInspection ?? 0) + (c.pestInspection ?? 0) + (c.structuralInspection ?? 0) + (c.fireComplianceInspection ?? 0) + (c.planningZoningReview ?? 0) + (c.environmentalReport ?? 0) + (c.asbestosReport ?? 0) + (c.dueDiligence ?? 0) + (c.otherAcquisitionCosts ?? 0) + (c.capexReserve ?? 0) + (c.workingCapitalReserve ?? 0);
  const gstCashflow = c.gstTreatment === 'plusGst' && c.gstCashflowRequired !== 'no' ? price * 0.1 : 0;
  return variableDuty + fixedCosts + gstCashflow;
}

export function solvePurchasePriceForAvailableEquity(inputs: BorrowingInputs, assessmentRatePct: number, minIcr: number, maxLvr: number, minDscr?: number, debtServiceFactor?: number, minDebtYield?: number): number {
  const availableEquity = Math.max(0, inputs.purchaserStructure.availableCashEquity);
  const noi = inputs.income.grossPassingRent + inputs.income.otherIncome - inputs.income.nonRecoverableExpenses;
  let lo = 0;
  let hi = Math.max(inputs.propertyValuation.purchasePrice * 1.5, availableEquity * 5, 1);
  const incomeLoanCap = Math.min(
    assessmentRatePct > 0 && minIcr > 0 ? noi / (assessmentRatePct / 100) / minIcr : Infinity,
    minDscr && debtServiceFactor ? noi / minDscr / debtServiceFactor : Infinity,
    minDebtYield ? noi / minDebtYield : Infinity,
  );
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    const lvrLoanCap = mid * maxLvr;
    const loan = Math.max(0, Math.min(lvrLoanCap, Number.isFinite(incomeLoanCap) ? incomeLoanCap : lvrLoanCap));
    const requiredEquity = mid + estimateAcquisitionCostsAtPrice(inputs, mid) - loan;
    if (requiredEquity <= availableEquity) lo = mid; else hi = mid;
  }
  return lo;
}

export function calculateReverseCalculators(inputs: BorrowingInputs, proposedLoan: number, requiredEquity: number, assessmentRatePct: number, minIcr: number, maxLvr: number, minDscr?: number, debtServiceFactor?: number, minDebtYield?: number): ReverseCalculatorResult {
  const requiredNoiForProposedLoan = proposedLoan > 0 ? proposedLoan * (assessmentRatePct / 100) * minIcr : 0;
  const requiredEquityForCurrentPurchasePrice = requiredEquity;
  const currentNoi = inputs.income.grossPassingRent + inputs.income.otherIncome - inputs.income.nonRecoverableExpenses;
  const requiredValuationToMeetLvr = proposedLoan > 0 && maxLvr > 0 ? proposedLoan / maxLvr : 0;
  const requiredRateToPassIcrPct = proposedLoan > 0 && minIcr > 0 ? (currentNoi / minIcr / proposedLoan) * 100 : 0;
  const indicativeGap = Math.max(0, requiredEquity - inputs.purchaserStructure.availableCashEquity);
  const requiredPurchasePriceToFitAvailableEquity = solvePurchasePriceForAvailableEquity(inputs, assessmentRatePct, minIcr, maxLvr, minDscr, debtServiceFactor, minDebtYield);
  const maximumPurchasePriceBasedOnAvailableEquity = requiredPurchasePriceToFitAvailableEquity;
  const requiredRentIncrease = Math.max(0, requiredNoiForProposedLoan - currentNoi);
  const requiredAdditionalSponsorLiquidity = indicativeGap;
  const practicalFixes = ['Add equity or verified sponsor liquidity', 'Reduce purchase price using the full price/equity solver rather than a rough shortfall', 'Improve/verify income and lease documentation', 'Confirm GST/duty cashflow with solicitor/accountant', 'Consider an alternative lender profile if risk appetite supports it'];
  return { requiredNoiForProposedLoan, requiredEquityForCurrentPurchasePrice, maximumPurchasePriceBasedOnAvailableEquity, requiredValuationToMeetLvr, requiredRateToPassIcrPct, requiredPriceReduction: indicativeGap, indicativeEquityGapPriceReductionEquivalent: indicativeGap, requiredPurchasePriceToFitAvailableEquity, requiredRentIncrease, requiredAdditionalSponsorLiquidity, practicalFixes };
}
