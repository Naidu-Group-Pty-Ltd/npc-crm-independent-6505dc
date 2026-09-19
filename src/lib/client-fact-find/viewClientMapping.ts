import type { AdvancedClientCreationPayload, FactFindAsset } from './types';
import { normalizeEmploymentType } from './schema';

export { normalizeEmploymentType } from './schema';

export type SecureInvoke = (name: string, body: Record<string, unknown>) => Promise<{ data?: any; error?: any }>;
export interface AdvancedSaveFailure { key: string; label: string; reason: string }
export interface AdvancedSaveResult { failures: AdvancedSaveFailure[]; completed: Set<string> }

const n = (value: unknown) => Number(value) || 0;
const present = (row: object) => Object.entries(row).some(([key, value]) =>
  !['displayOrder', 'applicantNumber', 'relationship', 'expenseKey', 'category', 'itemLabel', 'addressType'].includes(key)
  && value !== '' && value !== null && value !== 0,
);
const propertyPattern = /\b(property|real estate|owner occupied|principal place of residence|investment property|rental property|smsf property)\b/i;

export const isPropertyAsset = (asset: FactFindAsset) => propertyPattern.test(`${asset.assetType} ${asset.descriptionOrAddress}`);

export function normalizePropertyType(asset: FactFindAsset): 'owner_occupied' | 'investment' | 'smsf' | null {
  const value = `${asset.assetType} ${asset.descriptionOrAddress}`;
  if (!isPropertyAsset(asset)) return null;
  if (/smsf/i.test(value)) return 'smsf';
  if (/owner[ -]?occupied|principal place of residence|\bppr\b/i.test(value)) return 'owner_occupied';
  if (/investment|rental property|real estate|property/i.test(value)) return 'investment';
  return null;
}

const assetType = (value: string) => /vehicle|car|boat|motor/i.test(value) ? 'vehicle' : /saving|deposit|cash/i.test(value) ? 'savings' : /super/i.test(value) ? 'superfund' : /crypto|share|stock|fund|collect/i.test(value) ? 'alternative' : 'other';
const liabilityType = (value: string) => /mortgage|home loan/i.test(value) ? 'mortgage' : /credit card/i.test(value) ? 'credit_card' : /vehicle|car/i.test(value) ? 'vehicle_loan' : /student|hecs|help/i.test(value) ? 'student_loan' : /personal/i.test(value) ? 'personal_loan' : 'other';

export function mapAdvancedToViewClient(payload: AdvancedClientCreationPayload) {
  const primary = payload.applicants[0], secondary = payload.applicants[1];
  const current = (applicantNumber: 1 | 2) => payload.addresses.find(a => a.applicantNumber === applicantNumber && a.addressType === 'current');
  const personal = { primary_first_name: primary.firstName.trim(), primary_middle_name: primary.middleName || null, primary_surname: primary.surname.trim(), primary_mobile: primary.mobile || null, primary_email: primary.email || null, primary_gender: primary.gender || null, primary_dob: primary.dateOfBirth || null, current_address: current(1)?.address || null, living_situation: current(1)?.livingSituation || null, residential_status: primary.residencyStatus || null, marital_status: primary.maritalStatus || null, dependents_count: primary.numberOfDependants ?? null,
    secondary_first_name: secondary?.firstName || null, secondary_middle_name: secondary?.middleName || null, secondary_surname: secondary?.surname || null, secondary_mobile: secondary?.mobile || null, secondary_email: secondary?.email || null, secondary_gender: secondary?.gender || null, secondary_dob: secondary?.dateOfBirth || null, secondary_current_address: current(2)?.address || null, secondary_living_situation: current(2)?.livingSituation || null, secondary_residential_status: secondary?.residencyStatus || null };
  const addresses = payload.addresses.filter(present).map(a => ({ contact_type: a.applicantNumber === 1 ? 'primary' : 'secondary', additional_contact_id: null, address: a.address, current_suburb: null, current_state: null, current_postcode: null, country: 'Australia', living_situation: a.livingSituation || null, residential_status: null, start_date: a.movedInDate || null, end_date: null, is_current: a.addressType === 'current', notes: null }));
  const employment = payload.employment.flatMap(e => {
    if (!e || !present(e)) return [];
    const employmentType = normalizeEmploymentType(e.employmentType);
    if (!employmentType || !e.employerOrBusiness.trim()) return [];
    return [{ contact_type: e.applicantNumber === 1 ? 'primary' : 'secondary', additional_contact_id: null, is_current: true, employment_type: employmentType, occupation_role: e.roleOrPosition || null, employer_name: e.employerOrBusiness.trim(), start_date: e.startDate || null, salary_amount: n(e.baseSalary), salary_frequency: 'annual', gross_annual_salary: n(e.baseSalary), bonus: n(e.bonus), commission: n(e.commission), overtime_essential: n(e.overtime), overtime_non_essential: 0, allowance: 0, other_taxable_income: n(e.otherTaxableIncome), workplace_address_line_1: e.employerAddress.trim() || null, workplace_suburb: null, workplace_state: null, workplace_postcode: null, workplace_country: null }];
  });
  const properties = payload.assets.flatMap(a => {
    if (!present(a)) return [];
    const type = normalizePropertyType(a);
    if (!type || !a.descriptionOrAddress.trim()) return [];
    const rentalIncome = n(a.rentalOrOtherIncome), repayment = n(a.monthlyRepayment);
    return [{ property_type: type, address: a.descriptionOrAddress.trim(), value: n(a.currentValue), loan_remaining: n(a.loanBalance), interest_rate: n(a.interestRate), ownership_percentage: 100, monthly_interest_repayment: repayment, repayment_type: 'principal_and_interest', monthly_body_corporate: 0, monthly_council_rates: 0, monthly_water_rates: 0, monthly_repairs_maintenance: 0, monthly_property_management: 0, monthly_landlord_insurance: 0, monthly_building_insurance: 0, monthly_rental_income: rentalIncome, weekly_rental_income: rentalIncome * 12 / 52, total_monthly_expenditure: repayment, net_monthly_cashflow: rentalIncome - repayment, sourced_by: 'unknown' }];
  });
  const assets = payload.assets.filter(a => present(a) && !isPropertyAsset(a)).map(a => ({ asset_type: assetType(a.assetType), description: a.descriptionOrAddress || a.assetType || null, value: n(a.currentValue), institution_name: a.financialInstitution || null, vehicle_type: /vehicle|car|boat|motor/i.test(a.assetType) ? 'other' : null, make_model: null }));
  const liabilities = payload.liabilities.filter(present).map(l => ({ liability_type: liabilityType(l.liabilityType), provider_name: l.lender || l.accountOrDescription || null, current_balance: n(l.currentBalance), credit_limit: n(l.limitOrOriginalAmount) || null, interest_rate: n(l.interestRate), monthly_repayment: n(l.monthlyRepayment), repayment_type: 'principal_interest' }));
  const expenses = payload.expenses.filter(e => n(e.monthlyAmount) > 0 || Boolean(e.notes.trim())).map(e => ({ expense_category: e.category, expense_name: e.itemLabel, monthly_amount: n(e.monthlyAmount), frequency: 'monthly', notes: e.notes || null, is_essential: true }));
  return { personal, addresses, employment, properties, assets, liabilities, expenses };
}

const safeReason = (result: { data?: any; error?: any }) => {
  const generic=/^Failed to (?:create|update) record\.?$/i;
  const candidates=[result.error?.message,result.data?.details,result.data?.message,result.data?.error];
  const raw=candidates.find(value=>typeof value==='string'&&value.trim()&&!generic.test(value.trim()))||candidates.find(value=>typeof value==='string'&&value.trim());
  if (typeof raw !== 'string' || !raw.trim()) return 'the saved information was not accepted';
  const clean = raw.replace(/\b(?:Bearer|token|authorization|apikey|password|secret)\b[^,;]*/gi, '[redacted]').replace(/\s+/g, ' ').trim();
  return clean.length > 180 ? `${clean.slice(0, 177)}…` : clean;
};

export async function saveAdvancedViewClientData(clientId: string, payload: AdvancedClientCreationPayload, invoke: SecureInvoke, alreadyCompleted: ReadonlySet<string> = new Set()): Promise<AdvancedSaveResult> {
  const mapped = mapAdvancedToViewClient(payload), completed = new Set(alreadyCompleted), failures: AdvancedSaveFailure[] = [];
  const groups: Array<[string, string, Array<Record<string, unknown>>]> = [
    ['Personal information', 'clients', [mapped.personal]], ['Address History', 'client_address_history', mapped.addresses],
    ['Employment and Income', 'client_employment', mapped.employment], ['Properties', 'client_properties', mapped.properties],
    ['Financial assets', 'client_assets', mapped.assets], ['Liabilities', 'client_liabilities', mapped.liabilities],
    ['Living Expenses', 'client_expenses', mapped.expenses],
  ];
  for (const [label, table, records] of groups) for (const [index, data] of records.entries()) {
    const key = `${table}:${index}`;
    if (completed.has(key)) continue;
    try {
      // manage-client-data owns client scoping. In particular, the working manual
      // Employment contract passes clientId beside data and does not submit it as a column.
      const submittedData=table==='client_employment'||table==='clients'?data:{...data,client_id:clientId};
      const result = await invoke('manage-client-data', { operation: table === 'clients' ? 'update' : 'create', table, clientId, data: submittedData });
      if (result.error || !result.data?.success) failures.push({ key, label, reason: safeReason(result) });
      else completed.add(key);
    } catch (error) {
      failures.push({ key, label, reason: safeReason({ error }) });
    }
  }
  return { failures, completed };
}
