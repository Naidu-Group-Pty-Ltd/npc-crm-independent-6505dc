export interface IncomeSource {
  id?: string;
  client_id?: string;
  contact_type: 'primary' | 'secondary';
  source_category: string;
  source_type: string;
  source_name: string;
  gross_annual_amount: number;
  input_frequency: string;
  input_amount: number;
  bonus: number;
  commission: number;
  overtime_essential: number;
  overtime_non_essential: number;
  allowance: number;
  other_taxable_income: number;
  default_shading_rate: number;
  custom_shading_rate: number | null;
  display_order: number;
  is_active: boolean;
  notes: string;
}

export const SOURCE_CATEGORIES = [
  { value: 'employment', label: 'Employment' },
  { value: 'passive', label: 'Passive Income' },
  { value: 'government', label: 'Government Benefits' },
  { value: 'investment', label: 'Investment Income' },
  { value: 'other', label: 'Other' },
] as const;

export const SOURCE_TYPES: Record<string, { value: string; label: string; defaultShading: number }[]> = {
  employment: [
    { value: 'payg_fulltime', label: 'PAYG Full-time', defaultShading: 1.0 },
    { value: 'payg_parttime', label: 'PAYG Part-time', defaultShading: 1.0 },
    { value: 'casual', label: 'Casual', defaultShading: 0.8 },
    { value: 'self_employed', label: 'Self-Employed / ABN', defaultShading: 0.8 },
    { value: 'contract', label: 'Contract', defaultShading: 0.8 },
  ],
  passive: [
    { value: 'rental', label: 'Rental Income', defaultShading: 0.8 },
    { value: 'dividends', label: 'Dividends', defaultShading: 0.8 },
    { value: 'interest', label: 'Interest Income', defaultShading: 0.8 },
    { value: 'trust', label: 'Trust Distributions', defaultShading: 0.8 },
  ],
  government: [
    { value: 'centrelink', label: 'Centrelink (Part A/B)', defaultShading: 1.0 },
    { value: 'pension', label: 'Superannuation Pension', defaultShading: 1.0 },
    { value: 'disability', label: 'Disability Support', defaultShading: 1.0 },
    { value: 'carer', label: "Carer's Allowance", defaultShading: 1.0 },
  ],
  investment: [
    { value: 'shares', label: 'Share Portfolio', defaultShading: 0.8 },
    { value: 'managed_fund', label: 'Managed Funds', defaultShading: 0.8 },
    { value: 'crypto', label: 'Cryptocurrency', defaultShading: 0.5 },
  ],
  other: [
    { value: 'other', label: 'Other Income', defaultShading: 0.8 },
  ],
};

export const FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
];

export function convertToAnnual(amount: number, frequency: string): number {
  switch (frequency) {
    case 'weekly': return amount * 52;
    case 'fortnightly': return amount * 26;
    case 'monthly': return amount * 12;
    default: return amount;
  }
}

export function getDefaultShading(sourceCategory: string, sourceType: string): number {
  const types = SOURCE_TYPES[sourceCategory] || [];
  const found = types.find(t => t.value === sourceType);
  return found?.defaultShading ?? 0.8;
}

export function getEffectiveShading(source: IncomeSource): number {
  return source.custom_shading_rate ?? source.default_shading_rate;
}

export function getSourceTotalAnnual(source: IncomeSource): number {
  return source.gross_annual_amount + 
    (source.bonus || 0) + (source.commission || 0) + 
    (source.overtime_essential || 0) + (source.overtime_non_essential || 0) + 
    (source.allowance || 0) + (source.other_taxable_income || 0);
}

export const defaultIncomeSource: Omit<IncomeSource, 'client_id'> = {
  contact_type: 'primary',
  source_category: 'employment',
  source_type: 'payg_fulltime',
  source_name: '',
  gross_annual_amount: 0,
  input_frequency: 'annual',
  input_amount: 0,
  bonus: 0,
  commission: 0,
  overtime_essential: 0,
  overtime_non_essential: 0,
  allowance: 0,
  other_taxable_income: 0,
  default_shading_rate: 1.0,
  custom_shading_rate: null,
  display_order: 0,
  is_active: true,
  notes: '',
};

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
