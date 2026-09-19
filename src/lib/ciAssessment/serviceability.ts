/**
 * Serviceability and maximum indicative borrowing capacity.
 *
 * The maximum is not produced by one formula. Every policy test is evaluated
 * independently as a *cap* on the facility, and the smallest cap wins. That
 * cap is the binding constraint, and the whole point of the design: a user who
 * is told "your maximum is $4.2m" learns nothing, whereas "your maximum is
 * $4.2m, bound by the 1.25x DSCR hurdle" tells them exactly which lever moves it.
 */

import {
  annualDebtServiceCents,
  annualInterestCents,
  centsOf,
  multiplyCents,
  principalForAnnualPayment,
  ratio,
  roundRatio,
  sumCents,
  type Cents,
} from './money';
import { assessmentRate, type ResolvedPolicy } from './policy';
import type { BusinessIncomeResult } from './businessIncome';
import { fixedChargeCoverage, shadeRent } from './businessIncome';
import type { PortfolioResult } from './portfolio';
import type { PropertyIncomeResult } from './propertyIncome';
import type { TransactionResult } from './transaction';
import type { AssessmentPayload } from './types';
import { assessmentTypeDefinition } from './types';

export type ConstraintKey =
  | 'lvr' | 'ltc' | 'dscr' | 'icr' | 'debt_yield' | 'borrower_contribution'
  | 'policy_maximum' | 'repayment_capacity' | 'global_servicing' | 'none';

export const CONSTRAINT_LABELS: Record<ConstraintKey, string> = {
  lvr: 'Loan-to-value ratio',
  ltc: 'Loan-to-cost ratio',
  dscr: 'Debt service coverage ratio',
  icr: 'Interest cover ratio',
  debt_yield: 'Debt yield',
  borrower_contribution: 'Available borrower contribution',
  policy_maximum: 'Policy maximum',
  repayment_capacity: 'Repayment capacity',
  global_servicing: 'Global servicing surplus',
  none: 'No binding constraint',
};

export interface ConstraintCap {
  key: ConstraintKey;
  label: string;
  capCents: Cents;
  /** How the cap was derived, rendered verbatim in the explain panel. */
  formula: string;
  binding: boolean;
  /** False when the test does not apply (e.g. debt yield disabled by policy). */
  applied: boolean;
}

export interface ServiceabilityResult {
  assessmentRatePct: number;
  assessmentRateBasis: string;

  /** Income available to service debt, after all policy shading. */
  assessableBusinessIncomeCents: Cents;
  shadedProposedRentCents: Cents;
  shadedPortfolioRentCents: Cents;
  totalAssessableIncomeCents: Cents;

  existingDebtCommitmentsCents: Cents;
  proposedDebtCommitmentCents: Cents;
  globalAnnualDebtServiceCents: Cents;
  surplusAfterDebtServiceCents: Cents;

  proposedDscr: number;
  proposedIcr: number;
  globalDscr: number;
  globalIcr: number;
  fixedChargeCoverage: number | null;
  netSurplusRatio: number;
  globalServicingRatio: number;

  sensitisedSurplusCents: Cents;
  sensitisedDscr: number;

  caps: ConstraintCap[];
  maximumIndicativeLoanCents: Cents;
  bindingConstraint: ConstraintKey;
  bindingConstraintLabel: string;

  requestedLoanCents: Cents;
  headroomCents: Cents;
  requiredContributionCents: Cents;

  warnings: string[];
}

/**
 * Annual debt service on a *hypothetical* facility of `principal`, at the
 * assessment rate and on the assessed repayment shape. This is what every cap
 * inverts against.
 */
function assessedDebtService(
  principalCents: Cents,
  assessmentRatePct: number,
  payload: AssessmentPayload,
): Cents {
  const amortisation = payload.loan.amortisationYears > 0
    ? payload.loan.amortisationYears
    : payload.loan.loanTermYears;
  // Interest-only facilities are still assessed on an amortising basis where
  // the policy has an amortisation term, because the borrower must eventually
  // repay. Where no term is configured, the interest cost is the test.
  return annualDebtServiceCents({
    principalCents,
    ratePct: assessmentRatePct,
    repaymentType: amortisation > 0 ? 'principalAndInterest' : 'interestOnly',
    amortisationYears: amortisation,
  });
}

export function calculateServiceability(input: {
  payload: AssessmentPayload;
  policy: ResolvedPolicy;
  transaction: TransactionResult;
  propertyIncome: PropertyIncomeResult;
  businessIncome: BusinessIncomeResult;
  portfolio: PortfolioResult;
}): ServiceabilityResult {
  const { payload, policy, transaction, propertyIncome, businessIncome, portfolio } = input;
  const warnings: string[] = [];
  const definition = assessmentTypeDefinition(payload.assessmentType);

  const { assessmentRatePct, basis } = assessmentRate({
    contractRatePct: payload.loan.actualRatePercent,
    policy,
    bufferOverridePct: payload.loan.interestRateBufferPercent,
    rateOverridePct: payload.loan.assessmentRateOverridePercent,
  });

  // ---- Income available to service debt -----------------------------------
  const shadedProposedRentCents = shadeRent(propertyIncome.netOperatingIncomeCents, policy);
  const shadedPortfolioRentCents = portfolio.shadedRentalIncomeCents;
  const assessableBusinessIncomeCents = businessIncome.totalAssessableIncomeCents;

  const livingExpenseCents = centsOf(policy.livingExpenseFloorAnnual);
  const totalAssessableIncomeCents = Math.max(
    0,
    sumCents(assessableBusinessIncomeCents, shadedProposedRentCents, shadedPortfolioRentCents)
      - livingExpenseCents,
  );

  // ---- Commitments ---------------------------------------------------------
  const existingDebtCommitmentsCents = portfolio.existingCommitmentsCents;
  const proposedDebtCommitmentCents = sumCents(
    assessedDebtService(transaction.requestedLoanCents, assessmentRatePct, payload),
    transaction.annualFacilityFeesCents,
  );
  const globalAnnualDebtServiceCents = sumCents(existingDebtCommitmentsCents, proposedDebtCommitmentCents);
  const surplusAfterDebtServiceCents = totalAssessableIncomeCents - globalAnnualDebtServiceCents;

  // ---- Coverage ratios -----------------------------------------------------
  const proposedInterestCents = annualInterestCents(transaction.requestedLoanCents, assessmentRatePct);
  const proposedDscr = ratio(propertyIncome.netOperatingIncomeCents, proposedDebtCommitmentCents);
  const proposedIcr = ratio(propertyIncome.netOperatingIncomeCents, proposedInterestCents);

  const globalDscr = ratio(totalAssessableIncomeCents, globalAnnualDebtServiceCents);
  const globalInterestCents = sumCents(
    proposedInterestCents,
    // Interest component of existing commitments, approximated at the
    // portfolio's weighted average rate against its drawn balance.
    multiplyCents(portfolio.current.totalDebtCents, Math.max(0, portfolio.current.weightedAverageRatePct) / 100),
  );
  const globalIcr = ratio(totalAssessableIncomeCents, globalInterestCents);

  const rentPaidCents = definition.isOwnerOccupied ? 0 : 0;
  const fcc = fixedChargeCoverage(
    businessIncome.adjustedEbitdaCents, rentPaidCents, globalAnnualDebtServiceCents,
  );

  const netSurplusRatio = ratio(surplusAfterDebtServiceCents, totalAssessableIncomeCents);
  const globalServicingRatio = ratio(totalAssessableIncomeCents, globalAnnualDebtServiceCents);

  // ---- Sensitised position (a further 2% on the assessment rate) -----------
  const sensitisedRatePct = assessmentRatePct + 2;
  const sensitisedProposedCents = assessedDebtService(
    transaction.requestedLoanCents, sensitisedRatePct, payload,
  );
  const sensitisedGlobalCents = sumCents(existingDebtCommitmentsCents, sensitisedProposedCents);
  const sensitisedSurplusCents = totalAssessableIncomeCents - sensitisedGlobalCents;
  const sensitisedDscr = ratio(totalAssessableIncomeCents, sensitisedGlobalCents);

  // ---- Caps ----------------------------------------------------------------
  const caps: ConstraintCap[] = [];

  const lvrCapCents = multiplyCents(transaction.valuationUsedCents, policy.maxLvr);
  caps.push({
    key: 'lvr',
    label: CONSTRAINT_LABELS.lvr,
    capCents: lvrCapCents,
    formula: `Valuation used ${transaction.valuationUsedCents / 100} × max LVR ${(policy.maxLvr * 100).toFixed(1)}%`,
    binding: false,
    applied: transaction.valuationUsedCents > 0,
  });

  const ltcCapCents = multiplyCents(transaction.totalProjectCostCents, policy.maxLtc);
  caps.push({
    key: 'ltc',
    label: CONSTRAINT_LABELS.ltc,
    capCents: ltcCapCents,
    formula: `Total project cost × max LTC ${(policy.maxLtc * 100).toFixed(1)}%`,
    binding: false,
    applied: transaction.totalProjectCostCents > 0 && !definition.isRefinance,
  });

  // DSCR cap — the property's NOI must cover assessed debt service at the hurdle.
  const dscrCapacityCents = policy.minDscr > 0
    ? Math.round(propertyIncome.netOperatingIncomeCents / policy.minDscr)
    : 0;
  const amortisation = payload.loan.amortisationYears > 0 ? payload.loan.amortisationYears : payload.loan.loanTermYears;
  const dscrCapCents = principalForAnnualPayment(dscrCapacityCents, assessmentRatePct, amortisation);
  caps.push({
    key: 'dscr',
    label: CONSTRAINT_LABELS.dscr,
    capCents: dscrCapCents,
    formula: `NOI ÷ min DSCR ${policy.minDscr.toFixed(2)}x, capitalised at ${assessmentRatePct.toFixed(2)}% over ${amortisation} years`,
    binding: false,
    applied: propertyIncome.netOperatingIncomeCents > 0,
  });

  // ICR cap — interest-only test.
  const icrCapCents = policy.minIcr > 0 && assessmentRatePct > 0
    ? Math.round((propertyIncome.netOperatingIncomeCents / policy.minIcr) / (assessmentRatePct / 100))
    : 0;
  caps.push({
    key: 'icr',
    label: CONSTRAINT_LABELS.icr,
    capCents: icrCapCents,
    formula: `(NOI ÷ min ICR ${policy.minIcr.toFixed(2)}x) ÷ assessment rate ${assessmentRatePct.toFixed(2)}%`,
    binding: false,
    applied: propertyIncome.netOperatingIncomeCents > 0,
  });

  const debtYieldCapCents = policy.minDebtYield > 0
    ? Math.round(propertyIncome.netOperatingIncomeCents / policy.minDebtYield)
    : 0;
  caps.push({
    key: 'debt_yield',
    label: CONSTRAINT_LABELS.debt_yield,
    capCents: debtYieldCapCents,
    formula: `NOI ÷ min debt yield ${(policy.minDebtYield * 100).toFixed(2)}%`,
    binding: false,
    applied: policy.debtYieldEnabled && propertyIncome.netOperatingIncomeCents > 0,
  });

  // Borrower contribution cap — how much facility the deal leaves room for
  // once the borrower's own cash is applied to the total project cost.
  const contributionCapCents = Math.max(
    0, transaction.totalProjectCostCents - transaction.borrowerContributionCents,
  );
  caps.push({
    key: 'borrower_contribution',
    label: CONSTRAINT_LABELS.borrower_contribution,
    capCents: contributionCapCents,
    formula: 'Total project cost − borrower contribution',
    binding: false,
    applied: !definition.isRefinance && transaction.totalProjectCostCents > 0,
  });

  // Global servicing cap — the surplus left after existing commitments, at the
  // assessment rate, converted back into a facility size.
  const globalCapacityCents = Math.max(
    0,
    sumCents(assessableBusinessIncomeCents, shadedProposedRentCents, shadedPortfolioRentCents)
      - livingExpenseCents - existingDebtCommitmentsCents - transaction.annualFacilityFeesCents,
  );
  const globalCapCents = principalForAnnualPayment(
    policy.minDscr > 0 ? Math.round(globalCapacityCents / policy.minDscr) : globalCapacityCents,
    assessmentRatePct,
    amortisation,
  );
  caps.push({
    key: 'global_servicing',
    label: CONSTRAINT_LABELS.global_servicing,
    capCents: globalCapCents,
    formula: `(Assessable income − existing commitments − fees) ÷ min DSCR ${policy.minDscr.toFixed(2)}x, capitalised at ${assessmentRatePct.toFixed(2)}%`,
    binding: false,
    applied: totalAssessableIncomeCents > 0,
  });

  const hardCapCents = multiplyCents(transaction.valuationUsedCents, policy.hardMaxLvr);
  caps.push({
    key: 'policy_maximum',
    label: CONSTRAINT_LABELS.policy_maximum,
    capCents: hardCapCents,
    formula: `Valuation × hard LVR ceiling ${(policy.hardMaxLvr * 100).toFixed(1)}%`,
    binding: false,
    applied: transaction.valuationUsedCents > 0,
  });

  const appliedCaps = caps.filter((cap) => cap.applied);
  const maximumIndicativeLoanCents = appliedCaps.length
    ? Math.max(0, Math.min(...appliedCaps.map((cap) => cap.capCents)))
    : 0;

  const bindingCap = appliedCaps.find((cap) => cap.capCents === maximumIndicativeLoanCents);
  if (bindingCap) bindingCap.binding = true;
  const bindingConstraint: ConstraintKey = bindingCap?.key ?? 'none';

  const headroomCents = maximumIndicativeLoanCents - transaction.requestedLoanCents;
  const requiredContributionCents = Math.max(
    0, transaction.totalProjectCostCents - maximumIndicativeLoanCents,
  );

  // ---- Warnings ------------------------------------------------------------
  if (!appliedCaps.length) {
    warnings.push('No policy test could be applied — enter a valuation, an income figure or a project cost.');
  }
  if (transaction.requestedLoanCents > maximumIndicativeLoanCents && transaction.requestedLoanCents > 0) {
    warnings.push('The requested facility exceeds the maximum indicative capacity under the selected assumptions.');
  }
  if (proposedDscr > 0 && proposedDscr < policy.minDscr) {
    warnings.push(`Proposed DSCR of ${proposedDscr.toFixed(2)}x is below the ${policy.minDscr.toFixed(2)}x policy minimum.`);
  }
  if (proposedIcr > 0 && proposedIcr < policy.minIcr) {
    warnings.push(`Proposed ICR of ${proposedIcr.toFixed(2)}x is below the ${policy.minIcr.toFixed(2)}x policy minimum.`);
  }
  if (surplusAfterDebtServiceCents < 0) {
    warnings.push('Global servicing is negative: assessable income does not cover total debt service.');
  }
  if (sensitisedSurplusCents < 0 && surplusAfterDebtServiceCents >= 0) {
    warnings.push('Servicing surplus disappears under a further 2% rate rise.');
  }
  if (transaction.fundingGapCents > 0) {
    warnings.push('The transaction has an unfunded gap between total cost and the loan plus contribution.');
  }
  if (netSurplusRatio < policy.minNetSurplusRatio) {
    warnings.push('Net surplus ratio is below the configured policy minimum.');
  }

  return {
    assessmentRatePct,
    assessmentRateBasis: basis,
    assessableBusinessIncomeCents,
    shadedProposedRentCents,
    shadedPortfolioRentCents,
    totalAssessableIncomeCents,
    existingDebtCommitmentsCents,
    proposedDebtCommitmentCents,
    globalAnnualDebtServiceCents,
    surplusAfterDebtServiceCents,
    proposedDscr,
    proposedIcr,
    globalDscr,
    globalIcr,
    fixedChargeCoverage: fcc,
    netSurplusRatio,
    globalServicingRatio,
    sensitisedSurplusCents,
    sensitisedDscr,
    caps,
    maximumIndicativeLoanCents,
    bindingConstraint,
    bindingConstraintLabel: CONSTRAINT_LABELS[bindingConstraint],
    requestedLoanCents: transaction.requestedLoanCents,
    headroomCents,
    requiredContributionCents,
    warnings,
  };
}

/** Round a coverage ratio for display without losing the engine's precision. */
export function displayRatio(value: number): number {
  return roundRatio(value);
}
