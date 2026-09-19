import { invokeAmlFunction } from "./invokeAmlFunction";

export type AmlTransactionKind = "purchase" | "sale" | "refinance" | "off_the_plan" | "auction" | "private_treaty" | "other";
export type AmlTransactionStatus = "draft" | "under_contract" | "unconditional" | "settled" | "terminated";
export type AmlPartyType = "buyer" | "seller" | "guarantor" | "agent" | "solicitor" | "mortgagee" | "beneficiary" | "other";
export type AmlCounterpartyCaseStatus = "open" | "in_progress" | "awaiting_info" | "cleared" | "escalated" | "closed";
export type AmlCpRequestStatus = "pending" | "sent" | "awaiting_response" | "resolved" | "waived" | "escalated";

export interface AmlTransaction {
  id: string;
  case_id: string;
  purchase_file_id: string | null;
  kind: AmlTransactionKind;
  status: AmlTransactionStatus;
  reference: string | null;
  property_address: string | null;
  contract_date: string | null;
  settlement_date: string | null;
  original_settlement_date: string | null;
  purchase_price: number | null;
  deposit_amount: number | null;
  currency: string;
  source: string;
  notes: string | null;
  metadata: Record<string, any>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AmlTransactionParty {
  id: string;
  transaction_id: string;
  case_id: string;
  party_type: AmlPartyType;
  capacity: string | null;
  display_name: string;
  entity_id: string | null;
  external_reference: string | null;
  contact: Record<string, any>;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface AmlTransactionEvent {
  id: string;
  transaction_id: string;
  case_id: string;
  category: string;
  summary: string;
  payload: Record<string, any>;
  actor_id: string | null;
  actor_label: string | null;
  prev_hash: string | null;
  row_hash: string | null;
  created_at: string;
}

export interface AmlCounterpartyCase {
  id: string;
  case_id: string;
  transaction_id: string | null;
  party_id: string | null;
  subject_display_name: string;
  subject_type: string;
  status: AmlCounterpartyCaseStatus;
  risk_rating: string | null;
  assigned_analyst_id: string | null;
  notes: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  // Phase 9 (§12.5) — set only via the dedicated audited ops
  delayed_cdd_deadline?: string | null;
  delayed_cdd_justification?: string | null;
  uncooperative?: boolean;
  uncooperative_marked_at?: string | null;
  uncooperative_reason?: string | null;
}

export interface AmlCounterpartyRequest {
  id: string;
  counterparty_case_id: string;
  case_id: string;
  request_type: string;
  channel: string;
  status: AmlCpRequestStatus;
  due_date: string | null;
  summary: string;
  detail: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface AmlCounterpartyAttempt {
  id: string;
  request_id: string;
  counterparty_case_id: string;
  attempted_at: string;
  channel: string;
  outcome: string;
  notes: string | null;
  actor_id: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export interface AmlSettlementGateStatus {
  gate_enabled: boolean;
  blocked: boolean;
  reasons: string[];
  aml_case_id: string | null;
  case_status?: string;
  risk_rating?: string | null;
}

export type AmlObligationKind = "ttr" | "ifti" | "smr_candidate" | "structuring_suspected";
export type AmlObligationStatus = "pending" | "acknowledged" | "report_created" | "waived";

export interface AmlTransactionObligation {
  id: string;
  case_id: string;
  transaction_id: string;
  kind: AmlObligationKind;
  status: AmlObligationStatus;
  trigger_reason: string;
  observed_amount: number | null;
  threshold_amount: number | null;
  detail: Record<string, any>;
  linked_report_id: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  waived_by: string | null;
  waived_at: string | null;
  waive_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface AmlCounterpartyCddSummary {
  counterparty_cases_total: number;
  counterparty_cases_open: number;
  requests_open: number;
  requests_overdue: number;
  all_cleared: boolean;
}

async function invoke<T = any>(payload: Record<string, any>): Promise<T> {
  return invokeAmlFunction<T>("aml-transactions", payload);
}

export const amlTransactionsApi = {
  listTransactions: (case_id: string) =>
    invoke<{ transactions: AmlTransaction[] }>({ op: "list_transactions", case_id }),
  upsertTransaction: (transaction: Partial<AmlTransaction> & { case_id: string }) =>
    invoke<{ transaction: AmlTransaction; obligations_created?: number }>({ op: "upsert_transaction", transaction }),
  deleteTransaction: (id: string) => invoke<{ ok: true }>({ op: "delete_transaction", id }),
  listEvents: (transaction_id: string) =>
    invoke<{ events: AmlTransactionEvent[] }>({ op: "list_events", transaction_id }),
  appendEvent: (transaction_id: string, category: string, summary: string, payload: Record<string, any> = {}) =>
    invoke<{ ok: true }>({ op: "append_event", transaction_id, category, summary, payload }),

  listParties: (transaction_id: string) =>
    invoke<{ parties: AmlTransactionParty[] }>({ op: "list_parties", transaction_id }),
  upsertParty: (party: Partial<AmlTransactionParty> & { transaction_id: string; case_id: string; display_name: string; party_type: AmlPartyType }) =>
    invoke<{ party: AmlTransactionParty }>({ op: "upsert_party", party }),
  deleteParty: (id: string) => invoke<{ ok: true }>({ op: "delete_party", id }),

  listCpCases: (case_id: string) =>
    invoke<{ counterparty_cases: AmlCounterpartyCase[] }>({ op: "list_cp_cases", case_id }),
  upsertCpCase: (counterparty_case: Partial<AmlCounterpartyCase> & { case_id: string; subject_display_name: string }) =>
    invoke<{ counterparty_case: AmlCounterpartyCase }>({ op: "upsert_cp_case", counterparty_case }),
  deleteCpCase: (id: string) => invoke<{ ok: true }>({ op: "delete_cp_case", id }),

  listCpRequests: (params: { counterparty_case_id?: string; case_id?: string }) =>
    invoke<{ requests: AmlCounterpartyRequest[] }>({ op: "list_cp_requests", ...params }),
  upsertCpRequest: (request: Partial<AmlCounterpartyRequest> & { counterparty_case_id: string; case_id: string; request_type: string; summary: string }) =>
    invoke<{ request: AmlCounterpartyRequest }>({ op: "upsert_cp_request", request }),
  resolveCpRequest: (id: string, status: AmlCpRequestStatus, metadata?: Record<string, any>) =>
    invoke<{ request: AmlCounterpartyRequest }>({ op: "resolve_cp_request", id, status, metadata }),

  listCpAttempts: (request_id: string) =>
    invoke<{ attempts: AmlCounterpartyAttempt[] }>({ op: "list_cp_attempts", request_id }),
  addCpAttempt: (attempt: Partial<AmlCounterpartyAttempt> & { request_id: string; counterparty_case_id: string; channel: string }) =>
    invoke<{ attempt: AmlCounterpartyAttempt }>({ op: "add_cp_attempt", attempt }),

  settlementGateStatus: (purchase_file_id: string) =>
    invoke<AmlSettlementGateStatus>({ op: "settlement_gate_status", purchase_file_id }),

  // Phase 9 — obligations register
  listObligations: (params: { case_id?: string; transaction_id?: string }) =>
    invoke<{ obligations: AmlTransactionObligation[] }>({ op: "list_obligations", ...params }),
  evaluateObligations: (transaction_id: string) =>
    invoke<{ created: number; obligation_ids: string[] }>({ op: "evaluate_obligations", transaction_id }),
  acknowledgeObligation: (id: string) =>
    invoke<{ obligation: AmlTransactionObligation }>({ op: "acknowledge_obligation", id }),
  waiveObligation: (id: string, reason: string) =>
    invoke<{ obligation: AmlTransactionObligation }>({ op: "waive_obligation", id, reason }),
  linkObligationReport: (id: string, report_id: string | null) =>
    invoke<{ obligation: AmlTransactionObligation }>({ op: "link_obligation_report", id, report_id }),
  counterpartyCddSummary: (case_id: string) =>
    invoke<{ summary: AmlCounterpartyCddSummary }>({ op: "counterparty_cdd_summary", case_id }),

  // Phase 9 — delayed CDD + uncooperative-counterparty record (§12.5)
  setDelayedCdd: (p: { id: string; deadline: string; justification: string }) =>
    invoke<{ counterparty_case: AmlCounterpartyCase }>({ op: "set_delayed_cdd", ...p }),
  markUncooperative: (p: { id: string; reason: string }) =>
    invoke<{ counterparty_case: AmlCounterpartyCase }>({ op: "mark_uncooperative", ...p }),
};
