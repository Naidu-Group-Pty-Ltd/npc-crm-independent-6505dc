import { invokeAmlFunction } from "./invokeAmlFunction";

export type AmlFinanceSource = "finance_portal" | "client_portal" | "manual_entry" | "ingested_doc";
export type AmlDiscrepancySeverity = "info" | "low" | "medium" | "high" | "critical";
export type AmlDiscrepancyStatus = "open" | "under_review" | "resolved" | "waived" | "escalated";

export interface AmlFinanceComparison {
  id: string;
  case_id: string;
  purchase_file_id: string | null;
  source: AmlFinanceSource;
  captured_at: string;
  captured_by: string | null;
  purchase_price: number | null;
  loan_amount: number | null;
  lender: string | null;
  lvr: number | null;
  borrower_contribution: number | null;
  refi_equity: number | null;
  gift_amount: number | null;
  gift_source: string | null;
  smsf_lrba: boolean;
  smsf_details: Record<string, any>;
  loan_purpose: string | null;
  funding_notes: string | null;
  raw_payload: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface AmlFinanceDiscrepancy {
  id: string;
  case_id: string;
  comparison_id: string | null;
  kind: string;
  severity: AmlDiscrepancySeverity;
  status: AmlDiscrepancyStatus;
  detected_by: string;
  expected_value: any;
  observed_value: any;
  summary: string;
  detail: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface AmlEvidenceReference {
  id: string;
  case_id: string;
  comparison_id: string | null;
  reference_type: string;
  reference_id: string | null;
  external_url: string | null;
  label: string;
  detail: string | null;
  metadata: Record<string, any>;
  added_by: string | null;
  created_at: string;
}

export type AmlFinanceRequestKind = "funding_information" | "financial_evidence" | "clarification";
export type AmlFinanceRequestStatus = "open" | "submitted" | "clarification_required" | "resolved" | "cancelled";

/** Phase 7 — staff view of a Command Center → Finance Portal request. */
export interface AmlFinanceRequest {
  id: string;
  case_id: string;
  client_id: string | null;
  purchase_file_id: string | null;
  kind: AmlFinanceRequestKind;
  subject: string;
  message: string;
  discrepancy_id: string | null;
  status: AmlFinanceRequestStatus;
  response_payload: Record<string, any>;
  responded_at: string | null;
  responded_by_label: string | null;
  comparison_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
}

/**
 * Phase 1 finance-safe contract (directive Appendix C.2). The server no
 * longer returns raw case status or risk_rating on this op — only the
 * finance-portal dimension and gate-derived readiness.
 */
export interface AmlLimitedStatus {
  finance_status: string;
  service_readiness: "service_ready" | "service_not_ready";
  updated_at: string | null;
  open_finance_discrepancies?: number;
}

async function invoke<T = any>(payload: Record<string, any>): Promise<T> {
  return invokeAmlFunction<T>("aml-finance", payload);
}

export const amlFinanceApi = {
  listComparisons: (case_id: string) =>
    invoke<{ comparisons: AmlFinanceComparison[] }>({ op: "list_comparisons", case_id }),
  upsertComparison: (comparison: Partial<AmlFinanceComparison> & { case_id: string }) =>
    invoke<{ comparison: AmlFinanceComparison; discrepancies_created: number }>({ op: "upsert_comparison", comparison }),
  deleteComparison: (id: string) => invoke<{ ok: true }>({ op: "delete_comparison", id }),
  importFromPurchaseFile: (case_id: string, purchase_file_id: string) =>
    invoke<{ comparison: AmlFinanceComparison; discrepancies_created: number }>({
      op: "import_from_purchase_file", case_id, purchase_file_id,
    }),

  listDiscrepancies: (params: { case_id?: string; status?: AmlDiscrepancyStatus; severity?: AmlDiscrepancySeverity } = {}) =>
    invoke<{ discrepancies: AmlFinanceDiscrepancy[] }>({ op: "list_discrepancies", ...params }),
  upsertDiscrepancy: (discrepancy: Partial<AmlFinanceDiscrepancy> & { case_id: string; kind: string; summary: string }) =>
    invoke<{ discrepancy: AmlFinanceDiscrepancy }>({ op: "upsert_discrepancy", discrepancy }),
  resolveDiscrepancy: (id: string, status: AmlDiscrepancyStatus, resolution_note?: string) =>
    invoke<{ discrepancy: AmlFinanceDiscrepancy }>({ op: "resolve_discrepancy", id, status, resolution_note }),
  deleteDiscrepancy: (id: string) => invoke<{ ok: true }>({ op: "delete_discrepancy", id }),
  recomputeDiscrepancies: (comparison_id: string) =>
    invoke<{ discrepancies_created: number }>({ op: "recompute_discrepancies", comparison_id }),

  listEvidence: (case_id: string) =>
    invoke<{ evidence: AmlEvidenceReference[] }>({ op: "list_evidence", case_id }),
  addEvidence: (evidence: Partial<AmlEvidenceReference> & { case_id: string; reference_type: string; label: string }) =>
    invoke<{ evidence: AmlEvidenceReference }>({ op: "add_evidence", evidence }),
  deleteEvidence: (id: string) => invoke<{ ok: true }>({ op: "delete_evidence", id }),

  limitedStatus: (params: { purchase_file_id?: string; client_id?: string }) =>
    invoke<AmlLimitedStatus>({ op: "limited_status", ...params }),

  // Phase 7 — Command Center ↔ Finance Portal request loop (§15.4)
  listFinanceRequests: (case_id: string) =>
    invoke<{ requests: AmlFinanceRequest[] }>({ op: "list_finance_requests", case_id }),
  createFinanceRequest: (request: {
    case_id: string; kind: AmlFinanceRequestKind; subject: string; message: string;
    purchase_file_id?: string; discrepancy_id?: string;
  }) => invoke<{ request: AmlFinanceRequest }>({ op: "create_finance_request", request }),
  reviewFinanceRequest: (request_id: string) =>
    invoke<{ ok: true }>({ op: "review_finance_request", request_id }),
  resolveFinanceRequest: (params: {
    request_id: string; outcome?: "resolved" | "cancelled"; resolution_note?: string;
    finance_status_after?: "under_review" | "accepted" | "no_further_action";
  }) => invoke<{ request: AmlFinanceRequest }>({ op: "resolve_finance_request", ...params }),

  // Phase 8 — cross-portal handoff + duplicate doc-ref scanning
  duplicateDocumentRefs: (case_id?: string) =>
    invoke<{ duplicates: Array<{ reference_id: string; reference_type: string; label: string; case_count: number; client_count: number; case_ids: string[] }>; discrepancies_created: number }>({ op: "duplicate_document_refs", case_id }),

  redeemCaseHandoff: (token: string) =>
    invoke<{ snapshot: AmlHandoffSnapshot }>({ op: "redeem_case_handoff", token }),
};

export interface AmlHandoffSnapshot {
  status: string;
  risk_rating: string | null;
  updated_at: string | null;
  created_at: string | null;
  open_discrepancies: Array<{ kind: string; severity: string; status: string }>;
  evidence_summary: Array<{ label: string; reference_type: string }>;
  finance_comparison: null | {
    captured_at: string;
    source: string;
    purchase_price: number | null;
    loan_amount: number | null;
    lender: string | null;
    lvr: number | null;
  };
  readonly: true;
  tipping_off_notice: string;
}
