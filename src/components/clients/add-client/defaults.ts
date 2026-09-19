import type { AdvancedClientCreationPayload, ApplicantNumber, FactFindApplicant, FactFindAsset, FactFindEmployment, FactFindLiability } from '@/lib/client-fact-find/types';
import { LIVING_EXPENSE_ITEMS } from '@/lib/client-fact-find/fieldDefinitions';

const applicant = (applicantNumber: ApplicantNumber): FactFindApplicant => ({
  applicantNumber, title: '', firstName: '', middleName: '', surname: '', dateOfBirth: null,
  gender: '', maritalStatus: '', residencyStatus: '', numberOfDependants: null, mobile: '', email: '',
  relationship: applicantNumber === 1 ? 'primary_client' : 'secondary_contact',
});
const employment = (applicantNumber: ApplicantNumber): FactFindEmployment => ({
  applicantNumber, employmentType: '', employerOrBusiness: '', roleOrPosition: '', employerAddress: '',
  startDate: null, baseSalary: 0, bonus: 0, commission: 0, overtime: 0, otherTaxableIncome: 0,
});
export const createEmptyAsset = (displayOrder: number): FactFindAsset => ({
  displayOrder, assetType: '', descriptionOrAddress: '', owner: '', currentValue: 0,
  rentalOrOtherIncome: 0, financialInstitution: '', loanBalance: 0, monthlyRepayment: 0,
  interestRate: 0, maturityDate: null,
});
export const createEmptyLiability = (displayOrder: number): FactFindLiability => ({
  displayOrder, liabilityType: '', lender: '', accountOrDescription: '', owner: '',
  limitOrOriginalAmount: 0, currentBalance: 0, monthlyRepayment: 0, interestRate: 0,
  remainingTerm: '', notes: '',
});
export function createAdvancedDefaults(): AdvancedClientCreationPayload {
  return {
    templateVersion: '1.0',
    branding: { organisationName: '', tradingName: '', tagline: '', primaryColour: '#' + '12345B', accentColour: '#' + 'C9A227', website: '', email: '', phone: '', businessAddress: '', documentTitle: 'Client Financial Position & Fact Find', confidentialityLabel: 'CONFIDENTIAL', preparedBy: '', logoReference: '', version: '1.0' },
    applicants: [applicant(1), applicant(2)],
    addresses: [
      { applicantNumber: 1, addressType: 'current', address: '', livingSituation: '', movedInDate: null, displayOrder: 0 },
      { applicantNumber: 1, addressType: 'previous', address: '', livingSituation: '', movedInDate: null, displayOrder: 1 },
      { applicantNumber: 2, addressType: 'current', address: '', livingSituation: '', movedInDate: null, displayOrder: 0 },
      { applicantNumber: 2, addressType: 'previous', address: '', livingSituation: '', movedInDate: null, displayOrder: 1 },
    ],
    employment: [employment(1), employment(2)],
    assets: [createEmptyAsset(0)],
    liabilities: [createEmptyLiability(0)],
    expenses: LIVING_EXPENSE_ITEMS.map(({ key, category, itemLabel, displayOrder }) => ({ expenseKey: key, category, itemLabel, displayOrder, monthlyAmount: 0, notes: '' })),
  };
}
