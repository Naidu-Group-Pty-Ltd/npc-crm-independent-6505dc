/**
 * Transaction calculations: what the deal costs, what the borrower must put
 * in, and what the proposed facility costs to service.
 *
 * Everything here works in cents and returns cents, so callers can keep
 * chaining without re-rounding. See `money.ts`.
 */

import {
  annualDebtServiceCents,
  annualInterestCents,
  annualPrincipalAndInterestCents,
  centsOf,
  multiplyCents,
  ratio,
  sumCents,
  type Cents,
} from './money';
import type { AssessmentPayload } from './types';
import { assessmentTypeDefinition } from './types';

export interface TransactionResult {
  /** Price plus every acquisition cost. Excludes works and fit-out. */
  totalAcquisitionCostCents: Cents;
  /** Acquisition cost plus fit-out, plant, repairs, capex and contingency. */
  totalProjectCostCents: Cents;
  acquisitionCostLines: Array<{ label: string; amountCents: Cents }>;
  projectCostLines: Array<{ label: string; amountCents: Cents }>;

  purchasePriceCents: Cents;
  valuationUsedCents: Cents;
  valuationBasis: string;

  requestedLoanCents: Cents;
  borrowerContributionCents: Cents;
  /** Positive = shortfall the borrower has not funded. */
  fundingGapCents: Cents;
  fundingSurplusCents: Cents;

  proposedLvr: number;
  proposedLtc: number;
  equityContributionCents: Cents;

  refinanceProceedsCents: Cents;
  cashOutCents: Cents;

  annualDebtServiceCents: Cents;
  monthlyDebtServiceCents: Cents;
  interestOnlyAnnualCents: Cents;
  principalAndInterestAnnualCents: Cents;
  balloonExposureCents: Cents;

  /** Ongoing facility fees that a lender adds to the servicing test. */
  annualFacilityFeesCents: Cents;
}

/**
 * Which value the LVR is struck against. Lenders take the lower of price and
 * valuation on a purchase — paying above valuation does not create security.
 */
export function resolveValuation(payload: AssessmentPayload): { valuationCents: Cents; basis: string } {
  const price = centsOf(payload.property.purchasePrice);
  const valuation = centsOf(payload.property.currentValuation);
  const definition = assessmentTypeDefinition(payload.assessmentType);

  if (definition.isRefinance) {
    if (valuation > 0) return { valuationCents: valuation, basis: 'Current valuation (refinance — no purchase price).' };
    return { valuationCents: price, basis: 'Purchase price used; no current valuation supplied.' };
  }
  if (price > 0 && valuation > 0) {
    return price <= valuation
      ? { valuationCents: price, basis: 'Lower of purchase price and valuation (price).' }
      : { valuationCents: valuation, basis: 'Lower of purchase price and valuation (valuation).' };
  }
  if (valuation > 0) return { valuationCents: valuation, basis: 'Valuation used; no purchase price supplied.' };
  return { valuationCents: price, basis: 'Purchase price used; no valuation supplied.' };
}

export function calculateTransaction(payload: AssessmentPayload): TransactionResult {
  const property = payload.property;
  const loan = payload.loan;
  const definition = assessmentTypeDefinition(payload.assessmentType);

  const purchasePriceCents = centsOf(property.purchasePrice);

  const acquisitionCostLines = [
    { label: 'Stamp duty', amountCents: centsOf(property.stampDuty) },
    { label: 'Legal costs', amountCents: centsOf(property.legalCosts) },
    { label: 'Valuation costs', amountCents: centsOf(property.valuationCosts) },
    { label: 'Lender fees', amountCents: centsOf(property.lenderFees) },
    { label: 'Establishment fees', amountCents: centsOf(loan.establishmentFees) },
    { label: 'Risk / LMI fees', amountCents: centsOf(loan.riskFees) },
    { label: 'Other acquisition costs', amountCents: centsOf(property.otherAcquisitionCosts) },
  ].filter((line) => line.amountCents !== 0);

  const acquisitionCostsCents = sumCents(...acquisitionCostLines.map((line) => line.amountCents));
  const totalAcquisitionCostCents = sumCents(purchasePriceCents, acquisitionCostsCents);

  const worksLines = [
    { label: 'Fit-out', amountCents: centsOf(property.fitOut) },
    { label: 'Plant and equipment', amountCents: centsOf(property.plantAndEquipment) },
    { label: 'Repairs', amountCents: centsOf(property.repairs) },
    { label: 'Immediate capital expenditure', amountCents: centsOf(property.immediateCapex) },
    { label: 'Contingency', amountCents: centsOf(property.contingency) },
  ].filter((line) => line.amountCents !== 0);

  const worksCents = sumCents(...worksLines.map((line) => line.amountCents));
  const totalProjectCostCents = sumCents(totalAcquisitionCostCents, worksCents);

  const { valuationCents, basis } = resolveValuation(payload);

  const requestedLoanCents = centsOf(
    loan.requestedLoan > 0 ? loan.requestedLoan : property.requestedLoanAmount,
  );

  const depositCents = centsOf(property.depositOrContribution);
  const refinanceAmountCents = centsOf(property.refinanceAmount);
  const equityReleaseCents = centsOf(property.proposedEquityRelease);

  // On a refinance the borrower is not funding a purchase — their contribution
  // is whatever cash they add on top of the debt being replaced.
  const borrowerContributionCents = depositCents;

  const fundingRequirementCents = definition.isRefinance
    ? sumCents(refinanceAmountCents, worksCents, acquisitionCostsCents)
    : totalProjectCostCents;

  const fundedCents = sumCents(requestedLoanCents, borrowerContributionCents);
  const netPositionCents = fundedCents - fundingRequirementCents;
  const fundingGapCents = netPositionCents < 0 ? -netPositionCents : 0;
  const fundingSurplusCents = netPositionCents > 0 ? netPositionCents : 0;

  // Cash out on a refinance is the excess of the new facility over what it
  // replaces plus the costs of replacing it.
  const refinanceProceedsCents = definition.isRefinance
    ? Math.max(0, requestedLoanCents - refinanceAmountCents)
    : 0;
  const cashOutCents = definition.isRefinance
    ? Math.max(0, refinanceProceedsCents - acquisitionCostsCents - worksCents)
    : equityReleaseCents;

  const proposedLvr = ratio(requestedLoanCents, valuationCents);
  const proposedLtc = ratio(requestedLoanCents, totalProjectCostCents);
  const equityContributionCents = Math.max(0, fundingRequirementCents - requestedLoanCents);

  const ratePct = loan.actualRatePercent;
  const amortisation = loan.amortisationYears > 0 ? loan.amortisationYears : loan.loanTermYears;
  const residualCents = centsOf(loan.residualBalloonAmount);

  const interestOnlyAnnualCents = annualInterestCents(requestedLoanCents, ratePct);
  const principalAndInterestAnnualCents = annualPrincipalAndInterestCents(
    requestedLoanCents, ratePct, amortisation, 0,
  );
  const contractualAnnualCents = annualDebtServiceCents({
    principalCents: requestedLoanCents,
    ratePct,
    repaymentType: loan.repaymentType,
    amortisationYears: amortisation,
    residualCents,
  });

  const lineFeeCents = multiplyCents(requestedLoanCents, Math.max(0, loan.lineFeePercent) / 100);
  const annualFacilityFeesCents = sumCents(centsOf(loan.annualFees), lineFeeCents);

  const balloonExposureCents = loan.repaymentType === 'interestOnly'
    ? requestedLoanCents
    : residualCents;

  return {
    totalAcquisitionCostCents,
    totalProjectCostCents,
    acquisitionCostLines: [
      { label: 'Purchase price', amountCents: purchasePriceCents },
      ...acquisitionCostLines,
    ],
    projectCostLines: [
      { label: 'Total acquisition cost', amountCents: totalAcquisitionCostCents },
      ...worksLines,
    ],
    purchasePriceCents,
    valuationUsedCents: valuationCents,
    valuationBasis: basis,
    requestedLoanCents,
    borrowerContributionCents,
    fundingGapCents,
    fundingSurplusCents,
    proposedLvr,
    proposedLtc,
    equityContributionCents,
    refinanceProceedsCents,
    cashOutCents,
    annualDebtServiceCents: contractualAnnualCents,
    monthlyDebtServiceCents: Math.round(contractualAnnualCents / 12),
    interestOnlyAnnualCents,
    principalAndInterestAnnualCents,
    balloonExposureCents,
    annualFacilityFeesCents,
  };
}
