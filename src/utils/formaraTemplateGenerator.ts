import * as XLSX from 'xlsx';

interface ClientData {
  id: string;
  primary_first_name: string;
  primary_middle_name?: string | null;
  primary_surname: string;
  primary_mobile?: string | null;
  primary_email?: string | null;
  primary_gender?: string | null;
  primary_dob?: string | null;
  secondary_first_name?: string | null;
  secondary_middle_name?: string | null;
  secondary_surname?: string | null;
  secondary_mobile?: string | null;
  secondary_email?: string | null;
  secondary_gender?: string | null;
  secondary_dob?: string | null;
  current_address?: string | null;
  country?: string | null;
  living_situation?: string | null;
  residential_status?: string | null;
  marital_status?: string | null;
  dependents_count?: number | null;
  total_portfolio_value?: number | null;
  total_debt?: number | null;
  total_monthly_expenditure?: number | null;
  total_monthly_income?: number | null;
  total_monthly_rental_income?: number | null;
  net_monthly_cash_flow?: number | null;
}

interface PropertyData {
  property_type: string;
  address: string;
  value?: number | null;
  loan_remaining?: number | null;
  interest_rate?: number | null;
  ownership_percentage?: number | null;
  monthly_interest_repayment?: number | null;
  monthly_body_corporate?: number | null;
  monthly_council_rates?: number | null;
  monthly_water_rates?: number | null;
  monthly_repairs_maintenance?: number | null;
  monthly_property_management?: number | null;
  monthly_landlord_insurance?: number | null;
  monthly_building_insurance?: number | null;
  monthly_rental_income?: number | null;
  weekly_rental_income?: number | null;
  total_monthly_expenditure?: number | null;
  net_monthly_cashflow?: number | null;
}

interface EmploymentData {
  contact_type: string;
  employer_name?: string | null;
  employment_type?: string | null;
  occupation_role?: string | null;
  start_date?: string | null;
}

interface IncomeData {
  contact_type: string;
  gross_salary?: number | null;
  salary_frequency?: string | null;
  bonus?: number | null;
  allowance?: number | null;
  commission?: number | null;
  overtime_essential?: number | null;
  overtime_non_essential?: number | null;
  other_taxable_income?: number | null;
}

interface AssetData {
  asset_type: string;
  vehicle_type?: string | null;
  make_model?: string | null;
  institution_name?: string | null;
  description?: string | null;
  value?: number | null;
}

interface LiabilityData {
  liability_type: string;
  provider_name?: string | null;
  current_balance?: number | null;
  credit_limit?: number | null;
  interest_rate?: number | null;
  monthly_repayment?: number | null;
  repayment_type?: string | null;
}

export interface FormaraExportData {
  client: ClientData;
  properties: PropertyData[];
  employment?: EmploymentData[];
  income?: IncomeData[];
  assets?: AssetData[];
  liabilities?: LiabilityData[];
}

/**
 * Generate a Formara-formatted Excel file from client data
 */
export function generateFormaraTemplate(data: FormaraExportData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  
  // Create main data array matching Formara form structure
  const formData: (string | number | null)[][] = [];

  // Header with date
  const today = new Date().toLocaleDateString('en-AU');
  formData.push([`Personal Details (All Applicants) - ${today}`, '', '', '', '', '', '', '', '', '', '']);
  formData.push(['', '', '', '', '', '', '', '', '', '', '']);
  formData.push(['', '', '', '', 'Property (Owner Occupied)', '', '', '', '', '', '']);
  
  // Primary Contact section
  formData.push(['Primary Contact', '', '', '', '', '', '', '', '', '', '']);
  formData.push(['First name', data.client.primary_first_name || '', '', '', 'Address', getOwnerOccupiedProperty(data.properties)?.address || '', '', '', '', '', '']);
  formData.push(['Middle name', data.client.primary_middle_name || '', '', '', 'Value', getOwnerOccupiedProperty(data.properties)?.value || '', '', '', '', '', '']);
  formData.push(['Surname', data.client.primary_surname || '', '', '', 'Loan Remaining ($)', getOwnerOccupiedProperty(data.properties)?.loan_remaining || '', '', '', '', '', '']);
  formData.push(['Mobile', data.client.primary_mobile || '', '', '', 'Interest Rate (%)', formatPercent(getOwnerOccupiedProperty(data.properties)?.interest_rate), '', '', '', '', '']);
  formData.push(['Email', data.client.primary_email || '', '', '', 'Ownership (%)', formatPercent(getOwnerOccupiedProperty(data.properties)?.ownership_percentage), '', '', '', '', '']);
  formData.push(['Gender', data.client.primary_gender || '', '', '', 'Lender / Bank', (getOwnerOccupiedProperty(data.properties) as any)?.lender_name || '', '', '', '', '', '']);
  formData.push(['Date of Birth', data.client.primary_dob || '', '', '', 'Loan Repayment ($)', (getOwnerOccupiedProperty(data.properties) as any)?.loan_repayment_amount || '', (getOwnerOccupiedProperty(data.properties) as any)?.loan_repayment_frequency || '', '', '', '', '']);
  formData.push(['', '', '', '', 'Monthly Interest Repayment ($)', getOwnerOccupiedProperty(data.properties)?.monthly_interest_repayment || '', '', '', '', '', '']);
  formData.push(['', '', '', '', 'Net Monthly Cashflow ($)', getOwnerOccupiedProperty(data.properties)?.net_monthly_cashflow || '', '', '', '', '', '']);

  // Secondary Contact section
  formData.push(['Secondary Contact', '', '', '', '', '', '', '', '', '', '']);
  formData.push(['First name', data.client.secondary_first_name || '', '', '', '', '', '', '', '', '', '']);
  formData.push(['Middle name', data.client.secondary_middle_name || '', '', '', '', '', '', '', '', '', '']);
  formData.push(['Surname', data.client.secondary_surname || '', '', '', '', '', '', '', '', '', '']);
  formData.push(['Mobile', data.client.secondary_mobile || '', '', '', '', '', '', '', '', '', '']);
  formData.push(['Email', data.client.secondary_email || '', '', '', '', '', '', '', '', '', '']);
  formData.push(['Gender', data.client.secondary_gender || '', '', '', '', '', '', '', '', '', '']);
  formData.push(['Date of Birth', data.client.secondary_dob || '', '', '', '', '', '', '', '', '', '']);

  // Address section
  formData.push(['Address', '', '', '', '', '', '', '', '', '', '']);
  formData.push(['Current address', data.client.current_address || '', '', '', '', '', '', '', '', '', '']);
  formData.push(['Country', data.client.country || 'Australia', '', '', '', '', '', '', '', '', '']);
  formData.push(['Living Situation', data.client.living_situation || '', '', '', '', '', '', '', '', '', '']);

  // ID section
  formData.push(['ID', '', '', '', '', '', '', '', '', '', '']);
  formData.push(['Residential status', data.client.residential_status || '', '', '', '', '', '', '', '', '', '']);

  // Family Relations
  formData.push(['Family Relations', '', '', '', '', '', '', '', '', '', '']);
  formData.push(['Marital status', data.client.marital_status || '', '', '', '', '', '', '', '', '', '']);
  formData.push(['Number of dependents', data.client.dependents_count || 0, '', '', '', '', '', '', '', '', '']);

  // Investment Properties
  const investmentProps = data.properties.filter(p => p.property_type === 'investment');
  investmentProps.forEach((prop, index) => {
    formData.push(['', '', '', '', '', '', '', '', '', '', '']);
    formData.push(['', '', '', '', `Investment Property ${index + 1}`, '', '', '', '', '', '']);
    formData.push(['', '', '', '', 'Address', prop.address || '', '', '', '', '', '']);
    formData.push(['', '', '', '', 'Value', prop.value || '', '', '', '', '', '']);
    formData.push(['', '', '', '', 'Loan Remaining ($)', prop.loan_remaining || '', '', '', '', '', '']);
    formData.push(['', '', '', '', 'Interest Rate (%)', formatPercent(prop.interest_rate), '', '', '', '', '']);
    formData.push(['', '', '', '', 'Ownership (%)', formatPercent(prop.ownership_percentage), '', '', '', '', '']);
    formData.push(['', '', '', '', 'Lender / Bank', (prop as any).lender_name || '', '', '', '', '', '']);
    formData.push(['', '', '', '', 'Loan Repayment ($)', (prop as any).loan_repayment_amount || '', (prop as any).loan_repayment_frequency || 'monthly', '', '', '', '']);
    formData.push(['', '', '', '', 'Monthly Interest Repayment ($)', prop.monthly_interest_repayment || '', '', '', '', '', '']);
    formData.push(['', '', '', '', 'Monthly Body Corporate/Strata Fees', prop.monthly_body_corporate || '', '', '', '', '', '']);
    formData.push(['', '', '', '', 'Monthly Council Rate Charges', prop.monthly_council_rates || '', '', '', '', '', '']);
    formData.push(['', '', '', '', 'Monthly Water Rate Charges', prop.monthly_water_rates || '', '', '', '', '', '']);
    formData.push(['', '', '', '', 'Monthly Repairs & Maintenance', prop.monthly_repairs_maintenance || '', '', '', '', '', '']);
    formData.push(['', '', '', '', 'Monthly Property Management Fees', prop.monthly_property_management || '', '', '', '', '', '']);
    formData.push(['', '', '', '', 'Monthly Landlord Insurance', prop.monthly_landlord_insurance || '', '', '', '', '', '']);
    formData.push(['', '', '', '', 'Monthly Building Insurance', prop.monthly_building_insurance || '', '', '', '', '', '']);
    formData.push(['', '', '', '', 'Total Expenditure', prop.total_monthly_expenditure || '', '', '', '', '', '']);
    formData.push(['', '', '', '', 'Monthly Rental Income', prop.monthly_rental_income || '', prop.weekly_rental_income || '', 'Per Week', '', '', '']);
    formData.push(['', '', '', '', 'Net Monthly Cashflow ($)', prop.net_monthly_cashflow || '', '', '', '', '', '']);
  });

  // Personal Expenses (Rental Properties - where client pays rent)
  const rentalProps = data.properties.filter(p => p.property_type === 'rental');
  if (rentalProps.length > 0) {
    formData.push(['', '', '', '', '', '', '', '', '', '', '']);
    formData.push(['', '', '', '', 'Personal Expenses', '', '', '', '', '', '']);
    
    let totalWeeklyRent = 0;
    let totalMonthlyRent = 0;
    
    rentalProps.forEach((prop, index) => {
      // For rental properties, monthly_rental_income stores the rent they PAY
      const monthlyRent = prop.monthly_rental_income || 0;
      const weeklyRent = prop.weekly_rental_income || (monthlyRent ? Math.round(monthlyRent * (12 / 52)) : 0);
      totalWeeklyRent += weeklyRent;
      totalMonthlyRent += monthlyRent;
      
      formData.push(['', '', '', '', `Rental Property ${index + 1}`, '', '', '', '', '', '']);
      formData.push(['', '', '', '', 'Address', prop.address || '', '', '', '', '', '']);
      formData.push(['', '', '', '', 'Weekly Rent Paid ($)', weeklyRent, '', '', '', '', '']);
      formData.push(['', '', '', '', 'Monthly Rent Paid ($)', monthlyRent, '', '', '', '', '']);
    });
    
    formData.push(['', '', '', '', '', '', '', '', '', '', '']);
    formData.push(['', '', '', '', 'Total Weekly Rent Expense', totalWeeklyRent, '', '', '', '', '']);
    formData.push(['', '', '', '', 'Total Monthly Rent Expense', totalMonthlyRent, '', '', '', '', '']);
  }

  // Portfolio Cashflow Analysis
  formData.push(['', '', '', '', '', '', '', '', '', '', '']);
  formData.push(['', '', '', '', 'Portfolio Cashflow Analysis', '', '', '', '', '', '']);
  formData.push(['', '', '', '', 'Total Portfolio Value', data.client.total_portfolio_value || '', '', '', '', '', '']);
  formData.push(['', '', '', '', 'Total Debt', data.client.total_debt || '', '', '', '', '', '']);
  formData.push(['', '', '', '', 'Total Monthly Expenditure', data.client.total_monthly_expenditure || '', '', '', '', '', '']);
  formData.push(['', '', '', '', 'Total Monthly Income', data.client.total_monthly_income || '', '', '', '', '', '']);
  formData.push(['', '', '', '', 'Total Monthly Rental Income', data.client.total_monthly_rental_income || '', '', '', '', '', '']);
  formData.push(['', '', '', '', 'Total Net Monthly Cash Flow', data.client.net_monthly_cash_flow || '', '', '', '', '', '']);

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet(formData);

  // Set column widths
  ws['!cols'] = [
    { wch: 30 }, // A
    { wch: 25 }, // B
    { wch: 10 }, // C
    { wch: 10 }, // D
    { wch: 35 }, // E
    { wch: 20 }, // F
    { wch: 15 }, // G
    { wch: 15 }, // H
    { wch: 10 }, // I
    { wch: 10 }, // J
    { wch: 10 }, // K
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Client Portfolio');

  return wb;
}

function getOwnerOccupiedProperty(properties: PropertyData[]): PropertyData | undefined {
  return properties.find(p => p.property_type === 'owner_occupied');
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return `${value}%`;
}

/**
 * Download the workbook as an Excel file
 */
export function downloadFormaraTemplate(data: FormaraExportData, filename?: string): void {
  const wb = generateFormaraTemplate(data);
  const clientName = `${data.client.primary_first_name}_${data.client.primary_surname}`.replace(/\s+/g, '_');
  const defaultFilename = `Formara_Form_${clientName}_${new Date().toISOString().split('T')[0]}.xlsx`;
  
  XLSX.writeFile(wb, filename || defaultFilename);
}

/**
 * Generate a blank Formara template
 */
export function downloadBlankFormaraTemplate(): void {
  const blankData: FormaraExportData = {
    client: {
      id: '',
      primary_first_name: '',
      primary_surname: '',
    },
    properties: [],
  };
  
  const wb = generateFormaraTemplate(blankData);
  XLSX.writeFile(wb, `Formara_Form_Template_Blank.xlsx`);
}