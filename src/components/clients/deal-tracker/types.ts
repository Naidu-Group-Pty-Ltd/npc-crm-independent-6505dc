// Deal Lifecycle Tracker Types

export type DealType = 'existing_property' | 'house_and_land' | 'refinance';
export type RiskStatus = 'on_track' | 'needs_follow_up' | 'urgent';
export type StageStatus = 'pending' | 'in_progress' | 'complete' | 'skipped';

export interface Deal {
  id: string;
  client_id: string;
  property_id: string | null;
  property_address: string | null;
  deal_type: DealType;
  current_stage: string;
  current_stage_number: number;
  risk_status: RiskStatus;
  responsible_person: string | null;

  // Financial (shared)
  total_contract_price: number | null;
  land_price: number | null;
  build_price: number | null;
  loan_amount: number | null;
  valuation_completed: boolean;
  shortfall_required: number | null;
  client_contribution_confirmed: boolean;
  lmi_applied: boolean;
  construction_loan_type: string | null;

  // Refinance-specific financial
  existing_loan_amount: number | null;
  new_loan_amount: number | null;
  equity_released: number | null;
  cash_out_purpose: string | null;
  cash_out_verified: boolean;
  commission_estimate: number | null;
  trail_commission: number | null;
  clawback_period_months: number | null;
  clawback_expiry_date: string | null;
  clawback_risk_active: boolean;

  /**
   * Receipt of the single agent fee. A house-and-land deal is paid stage by
   * stage and records receipt on each `BuildProgressPayment`; an
   * existing-property purchase or a refinance is paid once and records it
   * here. Optional because every deal written before the column existed
   * reads as undefined until it is next saved.
   */
  commission_received?: boolean | null;
  commission_received_date?: string | null;

  // Dates (shared)
  finance_clause_expiry: string | null;
  settlement_date: string | null;
  land_settlement_date: string | null;
  expected_build_start: string | null;
  estimated_completion: string | null;

  // Refinance-specific dates
  discharge_authority_date: string | null;
  lodgement_date: string | null;
  valuation_date: string | null;
  conditional_approval_date: string | null;
  formal_approval_date: string | null;
  loan_docs_signed_date: string | null;

  /**
   * Completion stamps for the critical dates above, keyed by column name
   * ({ settlement_date: '2026-09-02' }). A passed date with a stamp is a
   * finished obligation, not an overdue one.
   */
  critical_date_completions?: Record<string, string> | null;

  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;

  // Phase 6 — Finance Portal link
  purchase_file_id?: string | null;


  // Nested data from get-client-data
  stages?: DealStage[];
  buildPayments?: BuildProgressPayment[];
  invoices?: BuilderInvoice[];
}

export interface DealStage {
  id: string;
  deal_id: string;
  stage_number: number;
  stage_name: string;
  stage_category: string | null;
  status: StageStatus;
  client_action: string | null;
  internal_action: string | null;
  responsible: string | null;
  key_date: string | null;
  completed_at: string | null;
  percentage_or_amount: string | null;
  invoice_received: boolean;
  invoice_received_date: string | null;
  notes: string | null;
  display_order: number;
  created_at: string;
}

export interface BuildProgressPayment {
  id: string;
  deal_id: string;
  stage_number: number;
  stage_name: string;
  percentage: number;
  amount: number | null;
  builder_invoice_received: boolean;
  builder_invoice_date: string | null;
  submitted_to_lender: boolean;
  submitted_to_lender_date: string | null;
  funds_released: boolean;
  funds_released_date: string | null;
  paid_to_builder: boolean;
  paid_to_builder_date: string | null;
  is_commission_trigger: boolean;
  commission_received: boolean;
  commission_received_date: string | null;
  commission_amount: number | null;
  notes: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface BuilderInvoice {
  id: string;
  deal_id: string;
  build_payment_id: string | null;
  client_name: string | null;
  build_stage: string | null;
  invoice_date: string | null;
  invoice_amount: number | null;
  submitted_to_lender: boolean;
  submitted_date: string | null;
  funds_released: boolean;
  funds_released_date: string | null;
  paid_to_builder: boolean;
  paid_to_builder_date: string | null;
  commission_received: boolean;
  commission_amount: number | null;
  notes: string | null;
  created_at: string;
}

// Stage templates for auto-populating when a deal is created

export const MASTER_LIFECYCLE_STAGES = [
  { stage_number: 1, stage_name: 'Exclusive Client Signed', stage_category: 'Onboarding', responsible: 'Admin', internal_action: 'Upload agreement / CRM entry', client_action: 'Sign agreement' },
  { stage_number: 2, stage_name: 'Strategy Confirmed', stage_category: 'Advisory', responsible: 'Director', internal_action: 'Strategy signed off', client_action: 'Approve strategy' },
  { stage_number: 3, stage_name: 'Property Secured', stage_category: 'Acquisition', responsible: "Buyer's Agent", internal_action: 'Record property type', client_action: 'Confirm property' },
  { stage_number: 4, stage_name: 'Finance in Progress', stage_category: 'Finance', responsible: 'Broker', internal_action: 'Track finance clause date', client_action: 'Submit finance documents' },
  { stage_number: 5, stage_name: 'Settlement Confirmed', stage_category: 'Legal', responsible: 'Solicitor', internal_action: 'Confirm settlement date', client_action: 'Await settlement' },
  { stage_number: 6, stage_name: 'Completed / Settled', stage_category: 'Finalised', responsible: 'Team', internal_action: 'Archive file', client_action: 'Settlement complete' },
];

export const EXISTING_PROPERTY_STAGES = [
  { stage_number: 1, stage_name: 'Initial Holding Deposit (0.25%)', stage_category: 'Deposit', responsible: 'Admin', internal_action: 'Record receipt confirmation', client_action: 'Pay holding deposit', percentage_or_amount: '0.25%' },
  { stage_number: 2, stage_name: 'Contract Review', stage_category: 'Legal', responsible: 'Solicitor', internal_action: 'Ensure solicitor engaged', client_action: 'Sign contract' },
  { stage_number: 3, stage_name: 'Final Deposit', stage_category: 'Deposit', responsible: 'Admin', internal_action: 'Confirm cleared funds', client_action: 'Pay 5% or 10%', percentage_or_amount: '5% / 10%' },
  { stage_number: 4, stage_name: 'Subject to Finance Period', stage_category: 'Finance', responsible: 'Broker', internal_action: 'Track finance clause expiry', client_action: 'Await approval' },
  { stage_number: 5, stage_name: 'Unconditional Finance', stage_category: 'Finance', responsible: 'Broker', internal_action: 'Confirm in writing', client_action: 'Finance approved' },
  { stage_number: 6, stage_name: 'Settlement Confirmed', stage_category: 'Legal', responsible: 'Solicitor', internal_action: 'Confirm date with solicitor', client_action: 'Await settlement' },
  { stage_number: 7, stage_name: 'Settlement Complete', stage_category: 'Finalised', responsible: 'Team', internal_action: 'Close commission tracking', client_action: 'Funds settle', percentage_or_amount: '100%' },
];

export const HOUSE_AND_LAND_STAGES = [
  { stage_number: 1, stage_name: 'Lot Secured', stage_category: 'Land', responsible: 'Admin', internal_action: 'Record lot & estate', client_action: 'Pay $1k–$5k holding deposit' },
  { stage_number: 2, stage_name: 'Contract Review', stage_category: 'Legal', responsible: 'Solicitor', internal_action: 'Send to solicitor', client_action: 'Sign land contract' },
  { stage_number: 3, stage_name: 'Final Deposit', stage_category: 'Deposit', responsible: 'Admin', internal_action: 'Confirm cleared funds', client_action: 'Pay 5% / 10%', percentage_or_amount: '5% / 10%' },
  { stage_number: 4, stage_name: 'Subject to Finance', stage_category: 'Finance', responsible: 'Broker', internal_action: 'Track finance expiry date', client_action: 'Await approval' },
  { stage_number: 5, stage_name: 'Unconditional', stage_category: 'Finance', responsible: 'Broker', internal_action: 'Notify agent', client_action: 'Approval confirmed' },
  { stage_number: 6, stage_name: 'Settlement Date Agreed', stage_category: 'Legal', responsible: 'Conveyancer', internal_action: 'Confirm with vendor solicitor', client_action: 'Await settlement' },
  { stage_number: 7, stage_name: 'Land Settlement', stage_category: 'Settlement', responsible: 'Conveyancer', internal_action: 'Trigger Build Tracker', client_action: 'Completed' },
];

export const REFINANCE_STAGES = [
  { stage_number: 1, stage_name: 'Client Engaged (Exclusive)', stage_category: 'Onboarding', responsible: 'Admin', internal_action: 'Signed authority', client_action: 'Sign engagement' },
  { stage_number: 2, stage_name: 'Fact Find Completed', stage_category: 'Advisory', responsible: 'Broker', internal_action: 'Upload servicing calc', client_action: 'Provide financials' },
  { stage_number: 3, stage_name: 'Product Strategy Confirmed', stage_category: 'Advisory', responsible: 'Director/Broker', internal_action: 'Document restructure plan', client_action: 'Approve strategy' },
  { stage_number: 4, stage_name: 'Application Lodged', stage_category: 'Finance', responsible: 'Broker', internal_action: 'CRM update', client_action: 'Await processing' },
  { stage_number: 5, stage_name: 'Valuation Ordered', stage_category: 'Finance', responsible: 'Broker', internal_action: 'Monitor valuation', client_action: 'Provide access' },
  { stage_number: 6, stage_name: 'Conditional Approval', stage_category: 'Finance', responsible: 'Broker', internal_action: 'Review conditions', client_action: 'Await approval' },
  { stage_number: 7, stage_name: 'Unconditional Approval', stage_category: 'Finance', responsible: 'Broker', internal_action: 'Confirm all conditions satisfied', client_action: 'Approval confirmed' },
  { stage_number: 8, stage_name: 'Discharge Authority Submitted', stage_category: 'Legal', responsible: 'Admin', internal_action: 'Track discharge timeframe', client_action: 'Sign discharge' },
  { stage_number: 9, stage_name: 'Formal Approval', stage_category: 'Finance', responsible: 'Broker', internal_action: 'Confirm docs ready', client_action: 'Await formal' },
  { stage_number: 10, stage_name: 'Loan Documents Signed', stage_category: 'Legal', responsible: 'Client/Admin', internal_action: 'Verify execution', client_action: 'Sign loan docs' },
  { stage_number: 11, stage_name: 'Settlement Booked', stage_category: 'Settlement', responsible: 'Lender', internal_action: 'Confirm payout figure', client_action: 'Await settlement' },
  { stage_number: 12, stage_name: 'Refinance Settlement Complete', stage_category: 'Finalised', responsible: 'Team', internal_action: 'Confirm old loan closed', client_action: 'Settlement complete' },
  { stage_number: 13, stage_name: 'Commission Confirmed', stage_category: 'Commission', responsible: 'Accounts', internal_action: 'Track clawback', client_action: 'N/A' },
];

export const BUILD_PAYMENT_STAGES = [
  { stage_number: 1, stage_name: 'Deposit', percentage: 5, is_commission_trigger: false },
  { stage_number: 2, stage_name: 'Slab/Base', percentage: 15, is_commission_trigger: true },
  { stage_number: 3, stage_name: 'Frame', percentage: 20, is_commission_trigger: true },
  { stage_number: 4, stage_name: 'Lock-up', percentage: 25, is_commission_trigger: false },
  { stage_number: 5, stage_name: 'Fixing', percentage: 20, is_commission_trigger: false },
  { stage_number: 6, stage_name: 'Practical Completion', percentage: 15, is_commission_trigger: false },
];

export const RISK_STATUS_CONFIG: Record<RiskStatus, { label: string; color: string; emoji: string }> = {
  on_track: { label: 'On Track', color: 'border-success/30 bg-success/10 text-success', emoji: '🟢' },
  needs_follow_up: { label: 'Needs Follow-Up', color: 'border-warning/35 bg-warning/10 text-warning', emoji: '🟠' },
  urgent: { label: 'Urgent', color: 'border-destructive/35 bg-destructive/10 text-destructive', emoji: '🔴' },
};

export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  existing_property: 'Existing Property',
  house_and_land: 'House & Land',
  refinance: 'Refinance',
};
