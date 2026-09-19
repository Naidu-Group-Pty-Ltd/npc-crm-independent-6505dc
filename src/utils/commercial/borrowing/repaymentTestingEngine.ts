import { annualInterest, annualPI } from '../icrDscrCalculator';
import type { BorrowingInputs, RepaymentTestingResult } from './calculatorTypes';

export function calculateRepaymentTesting(inputs: BorrowingInputs, loan: number, noi: number, assessmentRatePct: number): RepaymentTestingResult {
  const term = inputs.lendingAssumptions.amortisationYears || inputs.lendingAssumptions.loanTermYears;
  const facilityTerm = inputs.lendingAssumptions.facilityTermYears ?? inputs.lendingAssumptions.loanTermYears;
  const ioAnnualInterest = annualInterest(loan, assessmentRatePct);
  const piAnnualDebtService = annualPI(loan, assessmentRatePct, term);
  const residual = Math.max(0, inputs.lendingAssumptions.balloonResidualBalance ?? 0);
  const residualTermAnnualDebtService = annualPI(Math.max(0, loan - residual), assessmentRatePct, Math.max(1, facilityTerm));
  const ioIcr = ioAnnualInterest > 0 ? noi / ioAnnualInterest : 0;
  const piDscr = piAnnualDebtService > 0 ? noi / piAnnualDebtService : 0;
  const residualTermDscr = residualTermAnnualDebtService > 0 ? noi / residualTermAnnualDebtService : 0;
  const warnings: string[] = [];
  const refinanceRiskFlag = facilityTerm < term ? 'Facility term is shorter than amortisation term; balloon/refinance risk exists.' : 'No material residual-term mismatch identified.';
  if (facilityTerm < term) warnings.push('If Facility Term is shorter than Amortisation Term, balloon/refinance risk must be verified.');
  const maturityRiskFlag = inputs.lendingAssumptions.exitStrategy === 'unknown' || !inputs.lendingAssumptions.exitStrategy ? 'Commercial facility maturity or refinance exit has not been confirmed.' : 'Exit strategy recorded.';
  if (maturityRiskFlag.includes('not been confirmed')) warnings.push(maturityRiskFlag);
  return { ioAnnualInterest, piAnnualDebtService, residualTermAnnualDebtService, ioIcr, piDscr, residualTermDscr, refinanceRiskFlag, maturityRiskFlag, warnings };
}
