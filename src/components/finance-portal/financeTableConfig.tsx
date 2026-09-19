import { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { FREQUENCY_OPTIONS, SOURCE_CATEGORIES, SOURCE_TYPES } from '@/components/clients/income/incomeSourceTypes';

export type FinanceTableKey =
  | 'properties' | 'income' | 'expenses' | 'assets'
  | 'liabilities' | 'employment' | 'notes' | 'contacts'
  | 'address_history';

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'currency' | 'percent' | 'select' | 'textarea' | 'date' | 'boolean';
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  helpText?: string;
}

export interface TableConfig {
  key: FinanceTableKey;
  table: string; // db table name
  label: string;
  singular: string;
  description: string;
  primaryColumn: string; // shown in list rows
  secondaryColumn?: string;
  fields: FieldDef[];
  renderSummary?: (record: any) => ReactNode;
}

const fmtCurrency = (n: any) =>
  n == null || n === '' ? '—' : new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(Number(n));

export const FINANCE_TABLE_CONFIGS: Record<FinanceTableKey, TableConfig> = {
  properties: {
    key: 'properties',
    table: 'client_properties',
    label: 'Properties',
    singular: 'Property',
    description: 'Owner-occupied, investment, SMSF and rental properties.',
    primaryColumn: 'address',
    secondaryColumn: 'property_type',
    fields: [
      { key: 'address', label: 'Address', type: 'text', required: true },
      { key: 'property_type', label: 'Type', type: 'select', required: true, options: [
        { value: 'owner_occupied', label: 'Owner Occupied' },
        { value: 'investment', label: 'Investment' },
        { value: 'rental', label: 'Rental (not owned)' },
        { value: 'smsf', label: 'SMSF' },
      ]},
      { key: 'value', label: 'Estimated Value', type: 'currency' },
      { key: 'loan_remaining', label: 'Loan Remaining', type: 'currency' },
      { key: 'interest_rate', label: 'Interest Rate (%)', type: 'percent' },
      { key: 'monthly_interest_repayment', label: 'Monthly Interest Repayment', type: 'currency' },
      { key: 'monthly_rental_income', label: 'Monthly Rental Income', type: 'currency' },
      { key: 'ownership_percentage', label: 'Ownership %', type: 'percent' },
    ],
    renderSummary: (r) => (
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{r.property_type?.replace('_', ' ') || 'unspecified'}</Badge>
        {r.value && <span>Value {fmtCurrency(r.value)}</span>}
        {r.loan_remaining && <span>· Loan {fmtCurrency(r.loan_remaining)}</span>}
        {r.monthly_rental_income && <span>· Rent {fmtCurrency(r.monthly_rental_income)}/mo</span>}
      </div>
    ),
  },

  income: {
    key: 'income',
    // Unified with the Command Center: both apps now read/write client_income_sources.
    table: 'client_income_sources',
    label: 'Income',
    singular: 'Income Source',
    description: 'Salary, bonuses, commissions, allowances and other taxable income.',
    primaryColumn: 'source_name',
    secondaryColumn: 'contact_type',
    fields: [
      { key: 'contact_type', label: 'Applicant', type: 'select', required: true, options: [
        { value: 'primary', label: 'Primary Applicant' },
        { value: 'secondary', label: 'Secondary Applicant' },
      ]},
      { key: 'source_category', label: 'Category', type: 'select', options: [...SOURCE_CATEGORIES] },
      { key: 'source_type', label: 'Type', type: 'select', options: Object.values(SOURCE_TYPES).flat().map(({ value, label }) => ({ value, label })) },
      { key: 'source_name', label: 'Source Name', type: 'text', helpText: 'e.g. employer or investment name' },
      { key: 'gross_annual_amount', label: 'Gross Annual Amount', type: 'currency' },
      { key: 'input_frequency', label: 'Frequency', type: 'select', options: [...FREQUENCY_OPTIONS] },
      { key: 'bonus', label: 'Annual Bonus', type: 'currency' },
      { key: 'commission', label: 'Annual Commission', type: 'currency' },
      { key: 'allowance', label: 'Allowances', type: 'currency' },
      { key: 'overtime_essential', label: 'Overtime (Essential)', type: 'currency' },
      { key: 'overtime_non_essential', label: 'Overtime (Non-essential)', type: 'currency' },
      { key: 'other_taxable_income', label: 'Other Taxable Income', type: 'currency' },
    ],
    renderSummary: (r) => (
      <div className="text-xs text-muted-foreground">
        {fmtCurrency(r.gross_annual_amount)} p.a.{r.source_name ? ` · ${r.source_name}` : ''}
      </div>
    ),
  },

  expenses: {
    key: 'expenses',
    table: 'client_expenses',
    label: 'Expenses',
    singular: 'Expense',
    description: 'Living and discretionary expenses, monthly basis.',
    primaryColumn: 'expense_name',
    secondaryColumn: 'expense_category',
    fields: [
      { key: 'expense_category', label: 'Category', type: 'select', required: true, options: [
        { value: 'housing', label: 'Housing' },
        { value: 'utilities', label: 'Utilities' },
        { value: 'food_groceries', label: 'Food & Groceries' },
        { value: 'transport', label: 'Transport' },
        { value: 'insurance', label: 'Insurance' },
        { value: 'medical', label: 'Medical' },
        { value: 'education', label: 'Education' },
        { value: 'entertainment', label: 'Entertainment' },
        { value: 'subscriptions', label: 'Subscriptions' },
        { value: 'other', label: 'Other' },
      ]},
      { key: 'expense_name', label: 'Description', type: 'text' },
      { key: 'monthly_amount', label: 'Monthly Amount', type: 'currency', required: true },
      { key: 'frequency', label: 'Original Frequency', type: 'select', options: [
        { value: 'monthly', label: 'Monthly' },
        { value: 'fortnightly', label: 'Fortnightly' },
        { value: 'weekly', label: 'Weekly' },
        { value: 'annually', label: 'Annual' },
      ]},
      { key: 'is_essential', label: 'Essential expense', type: 'boolean' },
      { key: 'notes', label: 'Notes', type: 'textarea' },
    ],
    renderSummary: (r) => (
      <div className="text-xs text-muted-foreground">
        {fmtCurrency(r.monthly_amount)} / month {r.is_essential ? '· essential' : ''}
      </div>
    ),
  },

  assets: {
    key: 'assets',
    table: 'client_assets',
    label: 'Assets',
    singular: 'Asset',
    description: 'Savings, vehicles, super, shares and other assets.',
    primaryColumn: 'asset_type',
    fields: [
      { key: 'asset_type', label: 'Type', type: 'select', required: true, options: [
        { value: 'savings', label: 'Savings' },
        { value: 'superannuation', label: 'Superannuation' },
        { value: 'shares', label: 'Shares / ETFs' },
        { value: 'vehicle', label: 'Vehicle' },
        { value: 'other', label: 'Other' },
      ]},
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'institution_name', label: 'Institution', type: 'text' },
      { key: 'value', label: 'Value', type: 'currency' },
      { key: 'vehicle_type', label: 'Vehicle Type', type: 'text' },
      { key: 'make_model', label: 'Make / Model', type: 'text' },
    ],
    renderSummary: (r) => (
      <div className="text-xs text-muted-foreground">
        {fmtCurrency(r.value)} {r.institution_name ? `· ${r.institution_name}` : ''}
      </div>
    ),
  },

  liabilities: {
    key: 'liabilities',
    table: 'client_liabilities',
    label: 'Liabilities',
    singular: 'Liability',
    description: 'Credit cards, personal loans, HECS, BNPL and other debts.',
    primaryColumn: 'liability_type',
    secondaryColumn: 'provider_name',
    fields: [
      { key: 'liability_type', label: 'Type', type: 'select', required: true, options: [
        { value: 'credit_card', label: 'Credit Card' },
        { value: 'personal_loan', label: 'Personal Loan' },
        { value: 'car_loan', label: 'Car Loan' },
        { value: 'student_loan', label: 'HECS / Student Loan' },
        { value: 'bnpl', label: 'Buy Now Pay Later' },
        { value: 'tax_debt', label: 'ATO / Tax Debt' },
        { value: 'other', label: 'Other' },
      ]},
      { key: 'provider_name', label: 'Provider', type: 'text' },
      { key: 'current_balance', label: 'Current Balance', type: 'currency' },
      { key: 'credit_limit', label: 'Credit Limit', type: 'currency' },
      { key: 'monthly_repayment', label: 'Monthly Repayment', type: 'currency' },
      { key: 'interest_rate', label: 'Interest Rate (%)', type: 'percent' },
      { key: 'repayment_type', label: 'Repayment Type', type: 'select', options: [
        { value: 'principal_and_interest', label: 'P&I' },
        { value: 'interest_only', label: 'Interest Only' },
        { value: 'minimum', label: 'Minimum Only' },
      ]},
    ],
    renderSummary: (r) => (
      <div className="text-xs text-muted-foreground">
        Bal {fmtCurrency(r.current_balance)} {r.monthly_repayment ? `· ${fmtCurrency(r.monthly_repayment)}/mo` : ''}
      </div>
    ),
  },

  employment: {
    key: 'employment',
    table: 'client_employment',
    label: 'Employment',
    singular: 'Employment Record',
    description: 'Current and previous employment with income breakdown.',
    primaryColumn: 'employer_name',
    secondaryColumn: 'occupation_role',
    fields: [
      { key: 'contact_type', label: 'Applicant', type: 'select', required: true, options: [
        { value: 'primary', label: 'Primary Applicant' },
        { value: 'secondary', label: 'Secondary Applicant' },
      ]},
      { key: 'employer_name', label: 'Employer', type: 'text', required: true },
      { key: 'occupation_role', label: 'Occupation / Role', type: 'text' },
      { key: 'employment_type', label: 'Employment Type', type: 'select', options: [
        { value: 'full_time', label: 'Full Time' },
        { value: 'part_time', label: 'Part Time' },
        { value: 'casual', label: 'Casual' },
        { value: 'self_employed', label: 'Self Employed' },
        { value: 'contractor', label: 'Contractor' },
      ]},
      { key: 'start_date', label: 'Start Date', type: 'date' },
      { key: 'is_current', label: 'Currently employed here', type: 'boolean' },
    ],
    renderSummary: (r) => (
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">{r.employment_type?.replace('_', ' ') || 'role'}</Badge>
        {r.start_date && <span>Since {r.start_date}</span>}
        {r.is_current && <Badge variant="secondary" className="text-xs">current</Badge>}
      </div>
    ),
  },

  notes: {
    key: 'notes',
    table: 'client_notes',
    label: 'Notes',
    singular: 'Note',
    description: 'File notes left by internal staff and finance partners.',
    primaryColumn: 'note_type',
    fields: [
      { key: 'note_type', label: 'Type', type: 'select', required: true, options: [
        { value: 'general', label: 'General' },
        { value: 'finance', label: 'Finance' },
        { value: 'meeting', label: 'Meeting' },
        { value: 'document', label: 'Document Request' },
      ]},
      { key: 'content', label: 'Note', type: 'textarea', required: true },
      { key: 'visibility', label: 'Visibility', type: 'select', required: true, options: [
        { value: 'finance_only', label: 'Finance Portal + Command Center' },
        { value: 'shared', label: 'Share with Client Portal too' },
        { value: 'internal_npc', label: 'Command Center only' },
      ], helpText: 'Defaults to finance/internal only; choose shared only when the client should see it.' },
    ],
    renderSummary: (r) => (
      <div className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-line">
        {r.content || ''}
      </div>
    ),
  },

  contacts: {
    key: 'contacts',
    table: 'client_additional_contacts',
    label: 'Contacts',
    singular: 'Contact',
    description: 'Additional applicants, guarantors and authorised contacts.',
    primaryColumn: 'first_name',
    secondaryColumn: 'relationship',
    fields: [
      { key: 'first_name', label: 'First Name', type: 'text', required: true },
      { key: 'surname', label: 'Last Name', type: 'text', required: true },
      { key: 'relationship', label: 'Role', type: 'select', required: true, options: [
        { value: 'co_applicant', label: 'Co-applicant' },
        { value: 'guarantor', label: 'Guarantor' },
        { value: 'spouse', label: 'Spouse / Partner' },
        { value: 'accountant', label: 'Accountant' },
        { value: 'solicitor', label: 'Solicitor' },
        { value: 'other', label: 'Other' },
      ]},
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'mobile', label: 'Phone', type: 'text' },
      { key: 'dob', label: 'Date of Birth', type: 'date' },
    ],
  },

  address_history: {
    key: 'address_history',
    table: 'client_address_history',
    label: 'Address History',
    singular: 'Address',
    description: 'Current and previous residential addresses — 3 years of history required.',
    primaryColumn: 'address',
    secondaryColumn: 'living_situation',
    fields: [
      { key: 'address', label: 'Street / Address Line', type: 'text', required: true },
      { key: 'current_suburb', label: 'Suburb / City', type: 'text' },
      { key: 'current_state', label: 'State', type: 'text', helpText: 'Use 2–3 letter state/territory code, e.g. NSW' },
      { key: 'current_postcode', label: 'Postcode', type: 'text', helpText: '4 digits' },
      { key: 'country', label: 'Country', type: 'text' },
      { key: 'start_date', label: 'Start Date', type: 'date', required: true },
      { key: 'end_date', label: 'End Date', type: 'date', helpText: 'Leave blank if current address' },
      { key: 'is_current', label: 'Current address', type: 'boolean' },
      { key: 'living_situation', label: 'Living Situation', type: 'select', options: [
        { value: 'own_home', label: 'Own Home' },
        { value: 'renting', label: 'Renting' },
        { value: 'boarding', label: 'Boarding' },
        { value: 'living_with_family', label: 'Living with Family' },
        { value: 'company_housing', label: 'Company Housing' },
        { value: 'other', label: 'Other' },
      ]},
      { key: 'residential_status', label: 'Residential Status', type: 'select', options: [
        { value: 'australian_citizen', label: 'Australian Citizen' },
        { value: 'permanent_resident', label: 'Permanent Resident' },
        { value: 'temporary_visa', label: 'Temporary Visa' },
        { value: 'other', label: 'Other' },
      ]},
      { key: 'contact_type', label: 'Applicant', type: 'select', options: [
        { value: 'primary', label: 'Primary Applicant' },
        { value: 'secondary', label: 'Secondary Applicant' },
      ]},
    ],
    renderSummary: (r) => (
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {r.living_situation && <Badge variant="outline">{r.living_situation.replace(/_/g, ' ')}</Badge>}
        {(r.current_suburb || r.current_state || r.current_postcode) && <span>{[r.current_suburb, r.current_state, r.current_postcode].filter(Boolean).join(' ')}</span>}
        {r.start_date && <span>From {r.start_date}</span>}
        {r.end_date && <span>to {r.end_date}</span>}
        {r.is_current && <Badge variant="secondary" className="text-xs">current</Badge>}
      </div>
    ),
  },
};

export const FINANCE_TABLE_KEYS: FinanceTableKey[] = [
  'properties', 'income', 'expenses', 'assets', 'liabilities', 'employment', 'address_history', 'notes', 'contacts',
];
