export type ApplicantNumber = 1 | 2;
export type MoneyInput = number | string | null | undefined;
export type FactFindStatus = 'draft' | 'finalized' | 'archived';

export interface FactFindBrandingSnapshot {
  organisationName: string; tradingName: string; tagline: string; primaryColour: string;
  accentColour: string; website: string; email: string; phone: string; businessAddress: string;
  documentTitle: string; confidentialityLabel: string; preparedBy: string; logoReference: string;
  version: string; sourceWhiteLabelSettingId?: string | null;
}
export interface FactFindApplicant {
  applicantNumber: ApplicantNumber; title: string; firstName: string; middleName: string; surname: string;
  dateOfBirth: string | null; gender: string; maritalStatus: string; residencyStatus: string;
  numberOfDependants: number | null; mobile: string; email: string;
  relationship: 'primary_client' | 'secondary_contact';
}
export interface FactFindAddress {
  applicantNumber: ApplicantNumber; addressType: 'current' | 'previous'; address: string;
  livingSituation: string; movedInDate: string | null; displayOrder: 0 | 1;
}
export interface FactFindEmployment {
  applicantNumber: ApplicantNumber; employmentType: string; employerOrBusiness: string; roleOrPosition: string;
  employerAddress: string; startDate: string | null; baseSalary: MoneyInput; bonus: MoneyInput;
  commission: MoneyInput; overtime: MoneyInput; otherTaxableIncome: MoneyInput;
}
export interface FactFindAsset {
  displayOrder: number; assetType: string; descriptionOrAddress: string; owner: string;
  currentValue: MoneyInput; rentalOrOtherIncome: MoneyInput; financialInstitution: string;
  loanBalance: MoneyInput; monthlyRepayment: MoneyInput; interestRate: number | string | null; maturityDate: string | null;
}
export interface FactFindLiability {
  displayOrder: number; liabilityType: string; lender: string; accountOrDescription: string; owner: string;
  limitOrOriginalAmount: MoneyInput; currentBalance: MoneyInput; monthlyRepayment: MoneyInput;
  interestRate: number | string | null; remainingTerm: string; notes: string;
}
export interface FactFindLivingExpense {
  expenseKey: string; category: string; itemLabel: string; displayOrder: number;
  monthlyAmount: MoneyInput; notes: string;
}
export interface FactFindCalculatedTotals {
  totalAssetsCents: number; totalAssetLinkedDebtCents: number; totalOtherLiabilitiesCents: number;
  totalDebtCents: number; netPositionCents: number; applicant1AnnualIncomeCents: number;
  applicant2AnnualIncomeCents: number; totalMonthlyLivingExpensesCents: number;
  clientFormOutputLivingExpensesCents: number;
}
export interface AdvancedClientCreationPayload {
  templateVersion: string; branding: FactFindBrandingSnapshot;
  applicants: [FactFindApplicant, FactFindApplicant?]; addresses: FactFindAddress[];
  employment: [FactFindEmployment, FactFindEmployment?]; assets: FactFindAsset[];
  liabilities: FactFindLiability[]; expenses: FactFindLivingExpense[];
  calculatedTotals?: FactFindCalculatedTotals;
}
export interface ClientFactFind extends FactFindCalculatedTotals {
  id: string; clientId: string; status: FactFindStatus; templateVersion: string; revision: number;
  createdBy: string; updatedBy: string; createdAt: string; updatedAt: string;
}
export interface ClientFormOutputViewModel {
  templateVersion: string; branding: FactFindBrandingSnapshot; applicants: AdvancedClientCreationPayload['applicants'];
  employment: AdvancedClientCreationPayload['employment']; assets: FactFindAsset[]; liabilities: FactFindLiability[];
  expenses: FactFindLivingExpense[]; totals: FactFindCalculatedTotals;
}
