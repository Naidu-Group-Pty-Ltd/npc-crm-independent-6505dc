import { annualPI } from './icrDscrCalculator';
export interface IcrDscrEngineInputs { noi: number; loanAmount: number; proposedLoanAmount?: number; contractInterestRatePct: number; assessmentBufferPct?: number; assessmentFloorRatePct?: number; assessmentRateOverridePct?: number; repaymentType?: 'interestOnly' | 'principalAndInterest'; amortisationYears?: number; minimumIcr: number; minimumDscr: number; minimumDebtYield: number; }
export interface IcrDscrEngineResult { assessmentRateUsedPct: number; annualInterest: number; annualDebtService: number; annualDebtServiceFactor: number; icr: number; dscr: number; debtYield: number; maxLoanByIcr: number; maxLoanByDscr: number; maxLoanByDebtYield: number; icrHeadroom: number; dscrHeadroom: number; debtYieldHeadroom: number; proposedLoanSupportability?: 'supportable' | 'notSupportable'; warnings: string[]; }
const r2 = (n: number) => Number(n.toFixed(2));
export function calculateIcrDscrEngine(i: IcrDscrEngineInputs): IcrDscrEngineResult {
  const warnings: string[] = [];
  const assessmentRateUsedPct = i.assessmentRateOverridePct ?? Math.max((i.contractInterestRatePct || 0) + (i.assessmentBufferPct ?? 0), i.assessmentFloorRatePct ?? 0);
  if (assessmentRateUsedPct <= 0) warnings.push('Assessment rate must be greater than zero.');
  if (i.loanAmount <= 0) warnings.push('Loan amount must be greater than zero.');
  if (i.minimumIcr <= 0 || i.minimumDscr <= 0 || i.minimumDebtYield <= 0) warnings.push('Coverage hurdles must be greater than zero.');
  const annualInterest = i.loanAmount * (assessmentRateUsedPct / 100);
  const amortisationYears = i.amortisationYears ?? 0;
  if (i.repaymentType === 'principalAndInterest' && amortisationYears <= 0) warnings.push('DSCR is enabled but amortisation term is missing.');
  const annualDebtService = i.repaymentType === 'interestOnly' ? annualInterest : annualPI(i.loanAmount, assessmentRateUsedPct, amortisationYears);
  const annualDebtServiceFactor = i.loanAmount > 0 ? annualDebtService / i.loanAmount : 0;
  const icr = annualInterest > 0 ? i.noi / annualInterest : 0;
  const dscr = annualDebtService > 0 ? i.noi / annualDebtService : 0;
  const debtYield = i.loanAmount > 0 ? i.noi / i.loanAmount : 0;
  const maxLoanByIcr = assessmentRateUsedPct > 0 && i.minimumIcr > 0 ? i.noi / (assessmentRateUsedPct / 100) / i.minimumIcr : 0;
  const maxLoanByDscr = annualDebtServiceFactor > 0 && i.minimumDscr > 0 ? i.noi / i.minimumDscr / annualDebtServiceFactor : 0;
  const maxLoanByDebtYield = i.minimumDebtYield > 0 ? i.noi / i.minimumDebtYield : 0;
  if ((icr > 0 && icr - i.minimumIcr < 0.15) || (dscr > 0 && dscr - i.minimumDscr < 0.1)) warnings.push('Coverage barely passes; covenant pressure warning.');
  return { assessmentRateUsedPct, annualInterest, annualDebtService, annualDebtServiceFactor, icr: r2(icr), dscr: r2(dscr), debtYield, maxLoanByIcr, maxLoanByDscr, maxLoanByDebtYield, icrHeadroom: r2(icr - i.minimumIcr), dscrHeadroom: r2(dscr - i.minimumDscr), debtYieldHeadroom: debtYield - i.minimumDebtYield, proposedLoanSupportability: i.proposedLoanAmount == null ? undefined : i.proposedLoanAmount <= Math.min(maxLoanByIcr, maxLoanByDscr || Infinity, maxLoanByDebtYield) ? 'supportable' : 'notSupportable', warnings };
}
