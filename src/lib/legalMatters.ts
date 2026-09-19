/**
 * Legal matter domain constants shared by the Solicitor Portal and the
 * Command Centre admin surfaces. Mirrors `_shared/legalMatters.ts` on the
 * edge side — keep the two in step.
 */

export type LegalMatterStatus =
  | 'instructed' | 'contract_review' | 'exchanged' | 'cooling_off' | 'conditions'
  | 'unconditional' | 'pre_settlement' | 'settled' | 'post_settlement'
  | 'terminated' | 'on_hold';

export type LegalMatterType =
  | 'purchase' | 'sale' | 'transfer' | 'off_the_plan' | 'house_and_land'
  | 'refinance' | 'commercial' | 'other';

export type LegalPartyRole =
  | 'buyer' | 'seller' | 'buyer_solicitor' | 'seller_solicitor' | 'agent'
  | 'lender' | 'broker' | 'builder' | 'guarantor' | 'trustee' | 'accountant' | 'other';

export interface LegalMatter {
  id: string;
  matter_reference: string | null;
  title: string;
  matter_type: LegalMatterType;
  status: LegalMatterStatus;
  client_id: string | null;
  firm_id: string | null;
  assigned_solicitor_user_id: string | null;
  purchase_file_id: string | null;
  client_deal_id: string | null;
  build_job_id: string | null;
  property_address: string | null;
  property_suburb: string | null;
  property_state: string | null;
  property_postcode: string | null;
  title_reference: string | null;
  lot_plan: string | null;
  purchase_price: number | null;
  deposit_amount: number | null;
  deposit_percent: number | null;
  contract_date: string | null;
  exchange_date: string | null;
  cooling_off_expiry: string | null;
  finance_clause_date: string | null;
  building_pest_date: string | null;
  sunset_date: string | null;
  settlement_date: string | null;
  actual_settlement_date: string | null;
  pexa_workspace_id: string | null;
  other_side_firm: string | null;
  risk_flag: boolean;
  risk_notes: string | null;
  internal_notes: string | null;
  shared_summary: string | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  row_version: number;
  client_name?: string | null;
  firm_name?: string | null;
  solicitor_name?: string | null;
  purchase_file?: { id: string; title: string | null; finance_status: string | null } | null;
}

export interface LegalMatterParty {
  id: string;
  legal_matter_id: string;
  role: LegalPartyRole;
  name: string;
  organisation: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  reference: string | null;
  is_primary_contact: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface LegalMatterStatusEvent {
  id: string;
  from_status: LegalMatterStatus | null;
  to_status: LegalMatterStatus;
  changed_by_type: string;
  reason: string | null;
  created_at: string;
}

export const MATTER_STATUS_ORDER: LegalMatterStatus[] = [
  'instructed', 'contract_review', 'exchanged', 'cooling_off', 'conditions',
  'unconditional', 'pre_settlement', 'settled', 'post_settlement',
  'on_hold', 'terminated',
];

export const MATTER_STATUS_LABELS: Record<LegalMatterStatus, string> = {
  instructed: 'Instructed',
  contract_review: 'Contract review',
  exchanged: 'Exchanged',
  cooling_off: 'Cooling off',
  conditions: 'Conditions',
  unconditional: 'Unconditional',
  pre_settlement: 'Pre-settlement',
  settled: 'Settled',
  post_settlement: 'Post-settlement',
  terminated: 'Terminated',
  on_hold: 'On hold',
};

/** Semantic token classes only — never raw palette utilities. */
export const MATTER_STATUS_CLASSES: Record<LegalMatterStatus, string> = {
  instructed: 'border-border bg-muted text-muted-foreground',
  contract_review: 'border-primary/30 bg-primary/10 text-primary',
  exchanged: 'border-primary/40 bg-primary/15 text-primary',
  cooling_off: 'border-warning/40 bg-warning/10 text-warning',
  conditions: 'border-warning/40 bg-warning/10 text-warning',
  unconditional: 'border-success/40 bg-success/10 text-success',
  pre_settlement: 'border-success/40 bg-success/10 text-success',
  settled: 'border-success/50 bg-success/20 text-success',
  post_settlement: 'border-border bg-muted text-muted-foreground',
  terminated: 'border-destructive/40 bg-destructive/10 text-destructive',
  on_hold: 'border-border bg-muted text-muted-foreground',
};

export const MATTER_TYPE_LABELS: Record<LegalMatterType, string> = {
  purchase: 'Purchase',
  sale: 'Sale',
  transfer: 'Transfer',
  off_the_plan: 'Off the plan',
  house_and_land: 'House & land',
  refinance: 'Refinance',
  commercial: 'Commercial',
  other: 'Other',
};

export const PARTY_ROLE_LABELS: Record<LegalPartyRole, string> = {
  buyer: 'Buyer',
  seller: 'Seller',
  buyer_solicitor: "Buyer's solicitor",
  seller_solicitor: "Seller's solicitor",
  agent: 'Selling agent',
  lender: 'Lender',
  broker: 'Finance broker',
  builder: 'Builder',
  guarantor: 'Guarantor',
  trustee: 'Trustee',
  accountant: 'Accountant',
  other: 'Other',
};

export const AU_STATE_OPTIONS = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

export function formatMatterDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency', currency: 'AUD', maximumFractionDigits: 0,
  }).format(value);
}

/** Days until a date — negative when overdue, null when unset. */
export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function countdownLabel(value: string | null | undefined): string | null {
  const d = daysUntil(value);
  if (d === null) return null;
  if (d === 0) return 'Today';
  if (d < 0) return `${Math.abs(d)}d overdue`;
  return `in ${d}d`;
}

export function formatPropertyAddress(matter: Pick<LegalMatter,
  'property_address' | 'property_suburb' | 'property_state' | 'property_postcode'>): string {
  const line = [matter.property_address, matter.property_suburb].filter(Boolean).join(', ');
  const tail = [matter.property_state, matter.property_postcode].filter(Boolean).join(' ');
  return [line, tail].filter(Boolean).join(', ') || '—';
}
