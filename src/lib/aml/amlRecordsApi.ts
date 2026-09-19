import { invokeAmlFunction } from "./invokeAmlFunction";

export type AmlRetentionScheduleEntity =
  | "case" | "verification" | "screening" | "transaction" | "report" | "alert" | "edd" | string;
export type AmlDisposalMethod = "soft_delete" | "redact" | "hard_delete";
export type AmlPrivacyKind = "access" | "correction" | "deletion" | "portability" | "objection";
export type AmlPrivacyStatus =
  | "received" | "in_progress" | "awaiting_verification"
  | "fulfilled" | "partially_fulfilled" | "rejected" | "withdrawn";
export type AmlTippingSurface = "client_portal" | "email" | "notification" | "sms" | "agent_response" | string;
export type AmlSuppressionMode = "block" | "redact" | "warn";
export type AmlScanStatus =
  | "dry_run" | "awaiting_approval" | "approved" | "executing" | "completed" | "cancelled" | "failed";
export type AmlScanDisposition =
  | "pending" | "held" | "approved" | "disposed" | "skipped" | "failed";

export interface AmlRetentionSchedule {
  id: string; entity_type: AmlRetentionScheduleEntity; retention_years: number;
  legal_basis: string; disposal_method: AmlDisposalMethod; notes: string | null; active: boolean;
  created_at: string; updated_at: string;
}
export interface AmlLegalHold {
  id: string; entity_type: string; entity_id: string | null; case_id: string | null;
  reason: string; imposed_by: string; imposed_by_label: string | null; imposed_at: string;
  released_by: string | null; released_at: string | null; release_note: string | null; active: boolean;
}
export interface AmlPrivacyRequest {
  id: string; kind: AmlPrivacyKind; subject_client_id: string | null;
  subject_email: string | null; subject_full_name: string | null; status: AmlPrivacyStatus;
  received_at: string; due_at: string | null; fulfilled_at: string | null;
  received_via: string | null; request_details: string | null; response_summary: string | null;
  response_bundle_path: string | null; rejection_reason: string | null;
  handled_by_label: string | null; created_at: string; updated_at: string;
}
export interface AmlTippingOffRule {
  id: string; surface: AmlTippingSurface; pattern: string; is_regex: boolean;
  suppression_mode: AmlSuppressionMode; replacement_copy: string | null; note: string | null; active: boolean;
  created_at: string; updated_at: string;
}
export interface AmlRetentionScan {
  id: string; scope: string; status: AmlScanStatus;
  requested_by_label: string | null; approved_by_label: string | null;
  approved_at: string | null; executed_at: string | null;
  candidates_count: number; held_count: number; disposed_count: number; skipped_count: number;
  summary: Record<string, any>; error: string | null;
  created_at: string; updated_at: string;
}
export interface AmlRetentionScanItem {
  id: string; scan_id: string; entity_type: string; entity_id: string;
  reference_label: string | null; eligible_since: string | null;
  disposition: AmlScanDisposition; hold_id: string | null; disposal_method: string | null;
  note: string | null; processed_at: string | null;
}
export interface AmlRecordsAuditEvent {
  id: string; category: string; summary: string; payload: Record<string, any>;
  actor_id: string | null; actor_label: string | null; prev_hash: string | null; row_hash: string; created_at: string;
}
export interface AmlRecordsSummary {
  schedules_active: number; holds_active: number;
  privacy: Record<string, number>; scans_awaiting_approval: number;
  last_completed_scan: AmlRetentionScan | null;
}

async function invoke<T>(op: string, args: Record<string, any> = {}): Promise<T> {
  return invokeAmlFunction<T>("aml-records", { op, ...args });
}


/** Phase 11 — §18 retention trigger events (the retention clock starts here). */
export type AmlRetentionTriggerKind =
  | "relationship_end" | "occasional_transaction_complete" | "transaction_date"
  | "program_version_obsolete" | "investigation_complete" | "report_complete"
  | "legal_hold_release";

/** Phase 11 — §18 display contract for a retained record. */
export interface AmlRetentionRecord {
  trigger_id: string;
  entity_type: string;
  entity_id: string;
  case_id: string | null;
  record_category: string;
  legal_basis: string;
  trigger_kind: AmlRetentionTriggerKind;
  trigger_label: string;
  trigger_date: string;
  retention_years: number;
  minimum_retention_date: string;
  retention_elapsed: boolean;
  legal_hold: boolean;
  hold_id: string | null;
  privacy_restricted: boolean;
  privacy_restriction_note: string | null;
  disposal_method: string;
  recorded_by_label: string | null;
  recorded_at: string;
}

/** Phase 11 — §19 independent-review evidence. */
export interface AmlAuditChainVerification {
  chain: string;
  case_id: string | null;
  event_count: number;
  verified_count: number;
  intact: boolean;
  breaks: Array<{ id: string; created_at?: string; problem: string }>;
  verified_at: string;
}

export const amlRecordsApi = {
  summary: () => invoke<AmlRecordsSummary>("summary"),

  listSchedules: () => invoke<{ schedules: AmlRetentionSchedule[] }>("list_schedules").then((r) => r.schedules),
  upsertSchedule: (schedule: Partial<AmlRetentionSchedule>) =>
    invoke<{ schedule: AmlRetentionSchedule }>("upsert_schedule", { schedule }).then((r) => r.schedule),

  listHolds: () => invoke<{ holds: AmlLegalHold[] }>("list_holds").then((r) => r.holds),
  createHold: (hold: Partial<AmlLegalHold>) =>
    invoke<{ hold: AmlLegalHold }>("create_hold", { hold }).then((r) => r.hold),
  releaseHold: (id: string, release_note?: string) =>
    invoke<{ hold: AmlLegalHold }>("release_hold", { id, release_note }).then((r) => r.hold),

  listPrivacyRequests: () =>
    invoke<{ requests: AmlPrivacyRequest[] }>("list_privacy_requests").then((r) => r.requests),
  createPrivacyRequest: (request: Partial<AmlPrivacyRequest>) =>
    invoke<{ request: AmlPrivacyRequest }>("create_privacy_request", { request }).then((r) => r.request),
  updatePrivacyRequest: (id: string, patch: Partial<AmlPrivacyRequest>) =>
    invoke<{ request: AmlPrivacyRequest }>("update_privacy_request", { id, patch }).then((r) => r.request),
  exportPrivacyBundle: (id: string) =>
    invoke<{ bundle: any; content_hash: string }>("export_privacy_bundle", { id }),

  listTippingOffRules: () =>
    invoke<{ rules: AmlTippingOffRule[] }>("list_tipping_off_rules").then((r) => r.rules),
  upsertTippingOffRule: (rule: Partial<AmlTippingOffRule>) =>
    invoke<{ rule: AmlTippingOffRule }>("upsert_tipping_off_rule", { rule }).then((r) => r.rule),
  deleteTippingOffRule: (id: string) => invoke<{ ok: true }>("delete_tipping_off_rule", { id }),
  evaluateTippingOff: (surface: AmlTippingSurface, text: string) =>
    invoke<{ blocked: boolean; hits: Array<{ rule_id: string; mode: AmlSuppressionMode; pattern: string; replacement_copy: string | null; note: string | null }> }>(
      "evaluate_tipping_off", { surface, text },
    ),

  listScans: () => invoke<{ scans: AmlRetentionScan[] }>("list_scans").then((r) => r.scans),
  getScan: (id: string) => invoke<{ scan: AmlRetentionScan | null; items: AmlRetentionScanItem[] }>("get_scan", { id }),
  dryRunScan: (scope: string = "all") =>
    invoke<{ scan_id: string; candidates: number; held: number; per_entity_type: Record<string, number> }>("dry_run_scan", { scope }),
  requestApproval: (id: string) => invoke<{ scan: AmlRetentionScan }>("request_approval", { id }).then((r) => r.scan),
  approveScan: (id: string) => invoke<{ scan: AmlRetentionScan }>("approve_scan", { id }).then((r) => r.scan),
  cancelScan: (id: string) => invoke<{ scan: AmlRetentionScan }>("cancel_scan", { id }).then((r) => r.scan),
  executeScan: (id: string, dry_execute = false) =>
    invoke<{ scan_id: string; disposed: number; skipped: number; dry_execute: boolean }>("execute_scan", { id, dry_execute }),


  // Phase 11 — trigger-based retention (§18) + audit integrity/export (§19)
  recordRetentionTrigger: (p: {
    entity_type: string; entity_id: string; trigger_kind: AmlRetentionTriggerKind;
    trigger_date?: string; case_id?: string; record_category?: string;
    legal_basis?: string; retention_years?: number; disposal_method?: string;
    privacy_restricted?: boolean; privacy_restriction_note?: string; source_note?: string;
  }) => invoke<{ trigger: any; superseded: number }>("record_retention_trigger", p),
  syncCaseTriggers: (case_id: string) =>
    invoke<{ created_count: number; created: Array<{ entity_type: string; entity_id: string; trigger_kind: string }> }>(
      "sync_case_triggers", { case_id }),
  listRetentionRecords: (p: { case_id?: string; due_only?: boolean; limit?: number } = {}) =>
    invoke<{ records: AmlRetentionRecord[] }>("list_retention_records", p).then((r) => r.records),
  verifyAuditChain: (p: { chain?: "case_events" | "records_audit_events"; case_id?: string } = {}) =>
    invoke<AmlAuditChainVerification>("verify_audit_chain", p),
  exportAuditBundle: (p: { case_id: string; reason: string }) =>
    invoke<{ bundle: Record<string, any> }>("export_audit_bundle", p),

  auditTimeline: (limit = 100) =>
    invoke<{ events: AmlRecordsAuditEvent[] }>("audit_timeline", { limit }).then((r) => r.events),
};
