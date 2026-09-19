import type { BorrowingInputs, GroupDebtResult } from './calculatorTypes';

export function calculateGroupDebt(inputs: BorrowingInputs, proposedDebt: number, proposedAnnualDebtService: number, businessDebtServiceAvailable: number): GroupDebtResult {
  const g = inputs.groupDebt ?? {};
  const totalExistingDebt = (g.existingCommercialDebt ?? 0) + (g.existingResidentialDebt ?? 0) + (g.existingBusinessDebt ?? 0) + (g.equipmentFinance ?? 0) + (g.vehicleFinance ?? 0) + (g.overdrafts ?? 0) + (g.creditCards ?? 0) + (g.directorGuarantees ?? 0) + (g.intercompanyLoans ?? 0) + (g.relatedPartyDebts ?? 0) + (g.atoPaymentPlans ?? 0) + (g.otherLiabilities ?? 0);
  const totalExistingAnnualDebtService = g.existingAnnualDebtService ?? inputs.purchaserStructure.existingBusinessDebts ?? 0;
  const totalGroupDebtAfterAcquisition = totalExistingDebt + proposedDebt;
  const netDebtAfterCashReserves = Math.max(0, totalGroupDebtAfterAcquisition - (g.cashReserves ?? inputs.businessServicing?.businessCashReserves ?? 0));
  const ebitda = inputs.businessServicing?.ebitda ?? inputs.purchaserStructure.existingBusinessEbitda ?? 0;
  const debtToEbitda = ebitda > 0 ? netDebtAfterCashReserves / ebitda : null;
  const interestCover = (g.annualInterestExpense ?? 0) > 0 ? ebitda / (g.annualInterestExpense ?? 1) : 0;
  const businessDscr = proposedAnnualDebtService > 0 ? businessDebtServiceAvailable / proposedAnnualDebtService : 0;
  const groupDscr = totalExistingAnnualDebtService + proposedAnnualDebtService > 0 ? (businessDebtServiceAvailable + inputs.income.grossPassingRent) / (totalExistingAnnualDebtService + proposedAnnualDebtService) : 0;
  const liquidityCoverageRatio = totalExistingAnnualDebtService + proposedAnnualDebtService > 0 ? (g.cashReserves ?? inputs.businessServicing?.businessCashReserves ?? 0) / ((totalExistingAnnualDebtService + proposedAnnualDebtService) / 12) : 0;
  const warnings: string[] = [];
  if (debtToEbitda != null && debtToEbitda > 4) warnings.push('High debt-to-EBITDA after acquisition.');
  if (debtToEbitda == null) warnings.push('N/A — EBITDA not provided.');
  if (interestCover > 0 && interestCover < 2) warnings.push('Weak group interest cover.');
  if (groupDscr > 0 && groupDscr < 1.15) warnings.push('Weak group DSCR.');
  if ((g.equipmentFinance ?? 0) + (g.vehicleFinance ?? 0) > totalExistingDebt * 0.25) warnings.push('High equipment or vehicle finance exposure.');
  if ((g.overdrafts ?? 0) > 0) warnings.push('Overdraft exposure requires review.');
  if ((g.atoPaymentPlans ?? 0) > 0) warnings.push('ATO/payment plan debt requires lender review.');
  if (g.directorGuaranteesKnown === 'unknown') warnings.push('Director guarantees are unknown.');
  return { totalExistingDebt, totalExistingAnnualDebtService, totalProposedDebt: proposedDebt, totalGroupDebtAfterAcquisition, netDebtAfterCashReserves, debtToEbitda, interestCover, businessDscr, groupDscr, liquidityCoverageRatio, warnings };
}
