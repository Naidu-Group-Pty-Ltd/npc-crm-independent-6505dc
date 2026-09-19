import { invokeAmlFunction } from "./invokeAmlFunction";

export type AmlAlertStatus = "open" | "investigating" | "escalated" | "closed" | "false_positive";
export type AmlAlertSeverity = "info" | "low" | "medium" | "high" | "critical";
export type AmlEddStatus = "open" | "in_progress" | "awaiting_client" | "awaiting_mlro" | "completed" | "abandoned";
export type AmlReviewStatus = "queued" | "in_progress" | "remediation_required" | "complete" | "exited";

export interface AmlMonitoringRule {
  id: string; name: string; description: string | null; trigger_kind: string;
  criteria: Record<string, any>; severity: AmlAlertSeverity; is_enabled: boolean; cooldown_minutes: number;
  created_at: string; updated_at: string;
}
export interface AmlAlert {
  id: string; case_id: string | null; rule_id: string | null; event_id: string | null;
  severity: AmlAlertSeverity; status: AmlAlertStatus; title: string; summary: string | null;
  assigned_to: string | null; resolved_at: string | null; resolved_by: string | null;
  resolution_note: string | null; metadata: Record<string, any>;
  created_at: string; updated_at: string;
}
export interface AmlEddCase {
  id: string; case_id: string; reason: string; status: AmlEddStatus; narrative: string | null;
  assigned_to: string | null; opened_by: string | null; opened_at: string; completed_at: string | null;
  mlro_decision: string | null; mlro_decision_by: string | null; mlro_decision_at: string | null;
  metadata: Record<string, any>; created_at: string; updated_at: string;
}
export interface AmlSofItem {
  id: string; edd_case_id: string | null; case_id: string; source_type: string; description: string | null;
  amount: number | null; currency: string; evidence_path: string | null; evidence_provider: string | null;
  verified: boolean; verified_by: string | null; verified_at: string | null; notes: string | null;
  metadata: Record<string, any>; created_at: string; updated_at: string;
}
export interface AmlSowItem {
  id: string; edd_case_id: string | null; case_id: string; wealth_type: string; description: string | null;
  estimated_value: number | null; currency: string; evidence_path: string | null;
  verified: boolean; verified_by: string | null; verified_at: string | null; notes: string | null;
  metadata: Record<string, any>; created_at: string; updated_at: string;
}
export interface AmlReview {
  id: string; case_id: string | null; client_id: string | null; classification: string;
  status: AmlReviewStatus; priority: string; due_at: string | null; assigned_to: string | null;
  reviewer_notes: string | null; outcome: string | null; outcome_at: string | null; outcome_by: string | null;
  metadata: Record<string, any>; created_at: string; updated_at: string;
  // Phase 10 — trigger provenance + deadline history
  trigger_kind?: string | null;
  trigger_event_id?: string | null;
  original_due_at?: string | null;
  extension_count?: number;
  extension_reason?: string | null;
}

/** Phase 10 — trigger events that raise an out-of-cycle review (§12.9). */
export type AmlReviewTriggerKind =
  | "risk_increase" | "screening_match" | "adverse_media" | "ownership_change"
  | "transaction_change" | "counterparty_uncooperative" | "client_circumstances" | "other";

export type AmlMonitoringStatus = "active" | "paused" | "ended";

/** Phase 10 — per-case ongoing-CDD rollup. */
export interface AmlCaseMonitoring {
  monitoring_status: AmlMonitoringStatus;
  monitoring_status_reason: string | null;
  relationship_ended_at: string | null;
  relationship_end_reason: string | null;
  risk_rating: string | null;
  review_interval_months: number;
  next_periodic_review_at: string | null;
  last_periodic_review_at: string | null;
  last_screened_at: string | null;
  rescreen_due_at: string | null;
  rescreen_overdue: boolean;
  open_reviews: AmlReview[];
  overdue_review_count: number;
  recent_reviews: AmlReview[];
  open_alerts: Array<{ id: string; title: string; severity: string; status: string; created_at: string; assigned_to: string | null }>;
  open_edd: Array<{ id: string; reason: string; status: string; opened_at: string; assigned_to: string | null }>;
}
export interface AmlMonitoringSummary {
  open_alerts: number; critical_alerts: number; unprocessed_events: number;
  open_edd: number; pending_reviews: number; overdue_reviews: number;
}

async function invoke<T = any>(payload: Record<string, any>): Promise<T> {
  return invokeAmlFunction<T>("aml-monitoring", payload);
}

export const amlMonitoringApi = {
  summary: () => invoke<AmlMonitoringSummary>({ op: "summary" }),
  listRules: () => invoke<{ rules: AmlMonitoringRule[] }>({ op: "list_rules" }),
  upsertRule: (rule: Partial<AmlMonitoringRule>) => invoke<{ rule: AmlMonitoringRule }>({ op: "upsert_rule", rule }),
  deleteRule: (id: string) => invoke<{ ok: true }>({ op: "delete_rule", id }),
  toggleRule: (id: string, enabled: boolean) => invoke<{ rule: AmlMonitoringRule }>({ op: "toggle_rule", id, enabled }),

  listEvents: (p: { case_id?: string; unprocessed?: boolean; limit?: number } = {}) =>
    invoke<{ events: any[] }>({ op: "list_events", ...p }),
  ingestEvent: (event: { case_id?: string; source: string; event_kind: string; payload?: Record<string, any>; observed_at?: string }) =>
    invoke<{ event: any; alerts_created: number }>({ op: "ingest_event", event }),

  listAlerts: (p: { status?: AmlAlertStatus; case_id?: string; severity?: AmlAlertSeverity; limit?: number } = {}) =>
    invoke<{ alerts: AmlAlert[] }>({ op: "list_alerts", ...p }),
  upsertAlert: (alert: Partial<AmlAlert>) => invoke<{ alert: AmlAlert }>({ op: "upsert_alert", alert }),
  resolveAlert: (id: string, status: AmlAlertStatus, resolution_note?: string) =>
    invoke<{ alert: AmlAlert }>({ op: "resolve_alert", id, status, resolution_note }),
  assignAlert: (id: string, opts: { assigned_to?: string; status?: AmlAlertStatus } = {}) =>
    invoke<{ alert: AmlAlert }>({ op: "assign_alert", id, ...opts }),
  runScansAdmin: () =>
    invoke<{ alerts_created: number; reviews_escalated: number }>({ op: "run_scans_admin" }),

  listEdd: (p: { case_id?: string; status?: AmlEddStatus; limit?: number } = {}) =>
    invoke<{ edd_cases: AmlEddCase[] }>({ op: "list_edd", ...p }),
  getEdd: (id: string) => invoke<{ edd: AmlEddCase | null; sof: AmlSofItem[]; sow: AmlSowItem[] }>({ op: "get_edd", id }),
  upsertEdd: (edd: Partial<AmlEddCase>) => invoke<{ edd: AmlEddCase }>({ op: "upsert_edd", edd }),
  mlroDecisionEdd: (id: string, decision: "approved" | "reject" | "exit") =>
    invoke<{ edd: AmlEddCase }>({ op: "mlro_decision_edd", id, decision }),

  listSof: (p: { case_id?: string; edd_case_id?: string }) => invoke<{ items: AmlSofItem[] }>({ op: "list_sof", ...p }),
  upsertSof: (item: Partial<AmlSofItem>) => invoke<{ item: AmlSofItem }>({ op: "upsert_sof", item }),
  deleteSof: (id: string) => invoke<{ ok: true }>({ op: "delete_sof", id }),
  listSow: (p: { case_id?: string; edd_case_id?: string }) => invoke<{ items: AmlSowItem[] }>({ op: "list_sow", ...p }),
  upsertSow: (item: Partial<AmlSowItem>) => invoke<{ item: AmlSowItem }>({ op: "upsert_sow", item }),
  deleteSow: (id: string) => invoke<{ ok: true }>({ op: "delete_sow", id }),

  listReviews: (p: { status?: AmlReviewStatus; classification?: string; limit?: number } = {}) =>
    invoke<{ reviews: AmlReview[] }>({ op: "list_reviews", ...p }),
  upsertReview: (review: Partial<AmlReview>) => invoke<{ review: AmlReview }>({ op: "upsert_review", review }),
  completeReview: (id: string, outcome?: string, status?: AmlReviewStatus, reviewer_notes?: string) =>
    invoke<{ review: AmlReview }>({ op: "complete_review", id, outcome, status, reviewer_notes }),
  seedPreCommencement: () => invoke<{ inserted: number }>({ op: "seed_pre_commencement" }),

  // Phase 10 — ongoing CDD: risk-based cycle, trigger reviews, deadlines,
  // relationship lifecycle (§12.9, §18)
  caseMonitoringSummary: (case_id: string) =>
    invoke<{ monitoring: AmlCaseMonitoring }>({ op: "case_monitoring_summary", case_id }),
  schedulePeriodicReview: (p: { case_id: string; due_at?: string; assigned_to?: string }) =>
    invoke<{ review: AmlReview; interval_months?: number; already_scheduled?: boolean }>({ op: "schedule_periodic_review", ...p }),
  recordTriggerReview: (p: { case_id: string; trigger_kind: AmlReviewTriggerKind; detail: string; assigned_to?: string; trigger_event_id?: string }) =>
    invoke<{ review: AmlReview }>({ op: "record_trigger_review", ...p }),
  assignReview: (p: { id: string; assigned_to?: string; status?: AmlReviewStatus }) =>
    invoke<{ review: AmlReview }>({ op: "assign_review", ...p }),
  extendReviewDeadline: (p: { id: string; due_at: string; reason: string }) =>
    invoke<{ review: AmlReview }>({ op: "extend_review_deadline", ...p }),
  endRelationship: (p: { case_id: string; reason: string; ended_at?: string }) =>
    invoke<{ case: { id: string; monitoring_status: string; relationship_ended_at: string | null }; reviews_cancelled: number }>({ op: "end_relationship", ...p }),
  setMonitoringStatus: (p: { case_id: string; status: "active" | "paused"; reason: string }) =>
    invoke<{ case: { id: string; monitoring_status: string } }>({ op: "set_monitoring_status", ...p }),
};
