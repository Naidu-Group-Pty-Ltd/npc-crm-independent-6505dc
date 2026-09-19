import type { BorrowingInputs, BusinessServicingResult } from './calculatorTypes';

const requiresBusiness = (inputs: BorrowingInputs) => ['ownerOccupied', 'relatedPartyLease', 'mixedUse', 'vacant', 'partiallyVacant', 'development'].includes(inputs.dealProfile.acquisitionPurpose) || ['company', 'discretionaryTrust', 'unitTrust', 'holdingCompany', 'spv', 'operatingBusiness'].includes(inputs.purchaserStructure.purchaserType) || inputs.purchaserStructure.relatedPartyTenant;

export function calculateBusinessServicing(inputs: BorrowingInputs, lenderAdjustedNoi: number, proposedAnnualDebtService: number): BusinessServicingResult {
  const b = inputs.businessServicing ?? {};
  const required = requiresBusiness(inputs);
  const verified = b.financialStatementsAvailable === 'yes' && b.taxReturnsAvailable === 'yes' && b.basAvailable === 'yes';
  const normalisedBusinessCashflow = Math.max(0, (b.ebitda ?? inputs.purchaserStructure.existingBusinessEbitda ?? 0) + (b.addbacks ?? 0) - (b.directorWagesDrawings ?? 0) - (b.taxProvision ?? 0) - (b.workingCapitalRequirement ?? 0));
  const rentReplacementBenefit = (b.existingRentPaid ?? inputs.purchaserStructure.existingRentPaid ?? 0) - (b.proposedRentPayable ?? inputs.purchaserStructure.proposedRentPayable ?? 0);
  const totalExistingBusinessDebtService = (b.existingBusinessDebtRepayments ?? inputs.purchaserStructure.existingBusinessDebts ?? 0) + (b.equipmentFinanceRepayments ?? 0) + (b.vehicleFinanceRepayments ?? 0);
  const businessDebtServiceAvailable = normalisedBusinessCashflow + rentReplacementBenefit - totalExistingBusinessDebtService;
  const businessDscr = proposedAnnualDebtService > 0 ? businessDebtServiceAvailable / proposedAnnualDebtService : 0;
  const combinedPropertyBusinessDscr = proposedAnnualDebtService > 0 ? (lenderAdjustedNoi + businessDebtServiceAvailable) / proposedAnnualDebtService : 0;
  const warnings: string[] = [];
  if (required && !verified) warnings.push('Business servicing may support the acquisition, but financials are not yet verified. Sponsor uplift has not been applied.');
  if ((b.taxDebtAtoPaymentPlans ?? 0) > 0) warnings.push('ATO/tax debt or payment plans require lender review.');
  if ((b.overdraftLimit ?? 0) > 0 && (b.overdraftUsed ?? 0) / Math.max(b.overdraftLimit ?? 1, 1) > 0.8) warnings.push('Overdraft utilisation is high.');
  const status = required && !verified ? 'documentsRequired' : businessDscr >= 1.5 ? 'strong' : businessDscr >= 1.25 ? 'acceptable' : businessDscr >= 1 ? 'tight' : 'notSupportable';
  return { required, normalisedBusinessCashflow, rentReplacementBenefit, totalExistingBusinessDebtService, businessDebtServiceAvailable, businessDscr, combinedPropertyBusinessDscr, status, verified, sponsorUpliftEligible: required && verified && businessDebtServiceAvailable > 0, warnings };
}
