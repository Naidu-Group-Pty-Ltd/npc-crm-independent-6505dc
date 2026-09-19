import type { BorrowingInputs, BorrowingResult, CommentarySections } from './calculatorTypes';

const money = (n: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(n || 0);
const constraintLabel: Record<string, string> = { lvr: 'LVR ceiling', icr: 'minimum ICR requirement', dscr: 'minimum DSCR requirement', debtYield: 'minimum debt yield requirement', liquidity: 'sponsor liquidity test', valuation: 'valuation', fundsToComplete: 'funds-to-complete position', riskOverlay: 'risk overlay', specialistReview: 'specialist review trigger', none: 'no supportable loan' };

export function buildCommentarySections(inputs: BorrowingInputs, result: Omit<BorrowingResult, 'commentary'>): CommentarySections {
  const constraint = constraintLabel[result.bindingConstraint] ?? result.bindingConstraint;
  const incomeConstrained = ['icr', 'dscr', 'debtYield'].includes(result.bindingConstraint);
  const equityText = result.fundsToComplete.equitySurplusShortfall >= 0 ? `The client appears to have sufficient equity, with an estimated surplus of ${money(result.fundsToComplete.equitySurplusShortfall)} before minimum liquidity reserves.` : `The client has an estimated equity shortfall of ${money(Math.abs(result.fundsToComplete.equitySurplusShortfall))}.`;
  const missing = [...result.warningGroups.data, ...result.warningGroups.gstDuty, ...result.warningGroups.structure].slice(0, 5).join(' ') || 'No critical missing information has been flagged, but lender verification is still required.';
  return {
    borrowingOutcome: `The maximum risk-adjusted loan is ${money(result.finalRiskAdjustedLoan)}. The proposed loan tested is ${money(result.proposedLoan)} and ${result.proposedLoanSupportabilityMessage.toLowerCase()}`,
    creditAssessment: `${result.creditAssessmentStatusLabel}. The transaction is assessed at ${(result.assessmentRate * 100).toFixed(2)}% with ICR ${result.icr.toFixed(2)}x, DSCR ${result.dscr.toFixed(2)}x and debt yield ${(result.debtYield * 100).toFixed(1)}%.`,
    purchaseAbility: `${result.purchaseAbilityStatusLabel}. ${equityText} Post-settlement liquidity is ${money(result.fundsToComplete.postSettlementLiquidity)} and the liquidity status is ${result.fundsToComplete.liquidityStatus}.`,
    bindingConstraintExplanation: `The binding constraint is ${constraint}. ${incomeConstrained ? 'This means property value can support more debt than the income/serviceability test allows under the selected lender criteria.' : 'This means the current valuation, LVR, liquidity, risk overlay or specialist-review setting caps the loan before income tests do.'}`,
    assetSpecificRisk: inputs.dealProfile.assetCategory === 'industrial' ? 'Industrial reliance remains subject to zoning, permitted use, environmental, asbestos, roof, slab, fire, power, truck access, site plan and hardstand due diligence.' : 'Commercial reliance remains subject to lease quality, tenant covenant, WALE, market-rent, outgoings recovery, incentives, make-good and zoning verification.',
    borrowerStructureRisk: result.businessServicing.required ? `Business support is required. Business servicing status is ${result.businessServicing.status}; sponsor uplift is ${result.businessServicing.sponsorUpliftEligible ? 'eligible based on verified inputs' : 'not applied unless verified financials are sufficient'}.` : 'No mandatory business servicing uplift has been relied on under the selected scenario.',
    gstAndAcquisitionCostRisk: `GST economic cost is ${money(result.fundsToComplete.gst.economicCost)} and GST settlement cashflow requirement is ${money(result.fundsToComplete.gst.settlementCashflowRequirement)}. Duty and state charges remain estimates until confirmed by solicitor/state revenue.`,
    missingInformation: missing,
    recommendedNextAction: result.requiredNextAction,
    fixTheDealSummary: result.riskRating === 'green' ? undefined : `To improve the deal, consider adding at least ${money(result.reverseCalculators.requiredAdditionalSponsorLiquidity)}, reducing price by ${money(result.reverseCalculators.requiredPriceReduction)}, increasing verified NOI by ${money(result.reverseCalculators.requiredRentIncrease)}, confirming GST/duty treatment, or changing lender/structure assumptions.`,
  };
}

export function generateCommentary(inputs: BorrowingInputs, result: Omit<BorrowingResult, 'commentary'>): string {
  const sections = buildCommentarySections(inputs, result);
  Object.assign(result.commentarySections, sections);
  return Object.values(sections).filter(Boolean).join(' ');
}
