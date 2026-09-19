import { invokeAmlFunction } from "./invokeAmlFunction";

export type AmlReportKind = "smr" | "ttr" | "ifti" | "compliance" | "annual";
export type AmlReportStatus =
  | "draft" | "in_review" | "awaiting_mlro" | "approved"
  | "submitted" | "acknowledged" | "rejected" | "withdrawn";
export type AmlSubmissionChannel = "austrac_online" | "manual_upload" | "api" | "email" | "other";
export type AmlSubmissionStatus = "pending" | "submitted" | "acknowledged" | "rejected" | "failed";
export type AmlReceiptStatus = "acknowledged" | "queried" | "rejected" | "withdrawn" | "other";

export interface AmlReport {
  id: string; kind: AmlReportKind; case_id: string | null; reference_code: string | null;
  title: string; status: AmlReportStatus; narrative: string | null;
  payload: Record<string, any>;
  reporting_period_start: string | null; reporting_period_end: string | null;
  drafted_by: string | null;
  mlro_signed_by: string | null; mlro_signed_at: string | null;
  submitted_at: string | null; submitted_by: string | null; acknowledged_at: string | null;
  metadata: Record<string, any>; created_at: string; updated_at: string;
  /** Set once the report has been put away. Archiving never deletes. */
  archived_at?: string | null;
  archived_by?: string | null;
}
export interface AmlReportVersion {
  id: string; report_id: string; version: number; snapshot: Record<string, any>;
  narrative: string | null; author_id: string | null; author_label: string | null;
  change_note: string | null; content_hash: string | null; prev_hash: string | null; created_at: string;
}
export interface AmlReportReceipt {
  id: string; submission_id: string; receipt_reference: string; received_at: string;
  status: AmlReceiptStatus; receipt_payload: Record<string, any>;
  captured_by: string | null; notes: string | null; created_at: string;
}
export interface AmlReportSubmission {
  id: string; report_id: string; version: number; channel: AmlSubmissionChannel;
  status: AmlSubmissionStatus; external_reference: string | null;
  submitted_by: string | null; submitted_at: string;
  response_payload: Record<string, any>; export_bundle_path: string | null;
  content_hash: string | null; notes: string | null;
  receipts?: AmlReportReceipt[];
  created_at: string; updated_at: string;
}
export interface AmlReportingSummary {
  draft: number; awaiting_mlro: number; approved: number;
  submitted: number; acknowledged: number; rejected: number;
  /** Retained but off the working register. */
  archived?: number;
}

async function invoke<T>(op: string, args: Record<string, any> = {}): Promise<T> {
  return invokeAmlFunction<T>("aml-reporting", { op, ...args });
}

export const amlReportingApi = {
  summary: () => invoke<AmlReportingSummary>("summary"),
  listReports: (args?: {
    status?: string; kind?: string; case_id?: string; limit?: number;
    /** "live" (default) hides archived rows; "archived" shows only them. */
    archived?: "live" | "archived" | "all";
  }) =>
    invoke<{ reports: AmlReport[] }>("list_reports", args ?? {}).then((r) => r.reports),
  getReport: (id: string) =>
    invoke<{ report: AmlReport | null; versions: AmlReportVersion[]; submissions: AmlReportSubmission[] }>("get_report", { id }),
  upsertReport: (report: Partial<AmlReport>, change_note?: string) =>
    invoke<{ report: AmlReport }>("upsert_report", { report, change_note }).then((r) => r.report),
  deleteReport: (id: string) => invoke<{ ok: true }>("delete_report", { id }),
  createVersion: (report_id: string, snapshot: Record<string, any>, narrative?: string | null, change_note?: string) =>
    invoke<{ version: AmlReportVersion }>("create_version", { report_id, snapshot, narrative, change_note }).then((r) => r.version),
  /** Put a finished report away. It is retained in full and reversible. */
  archiveReport: (id: string) =>
    invoke<{ report: AmlReport }>("archive_report", { id }).then((r) => r.report),
  restoreReport: (id: string) =>
    invoke<{ report: AmlReport }>("restore_report", { id }).then((r) => r.report),
  mlroSignoff: (id: string, note?: string) => invoke<{ report: AmlReport }>("mlro_signoff", { id, note }).then((r) => r.report),
  mlroReject: (id: string, reason: string) => invoke<{ report: AmlReport }>("mlro_reject", { id, reason }).then((r) => r.report),
  withdrawReport: (id: string, reason?: string) => invoke<{ report: AmlReport }>("withdraw_report", { id, reason }).then((r) => r.report),
  submitRecord: (args: {
    report_id: string; channel?: AmlSubmissionChannel; status?: AmlSubmissionStatus;
    external_reference?: string; export_bundle_path?: string; notes?: string;
    response_payload?: Record<string, any>; attest_no_tipping_off?: boolean;
  }) => invoke<{ submission: AmlReportSubmission }>("submit_record", args).then((r) => r.submission),
  recordReceipt: (args: {
    submission_id: string; receipt_reference: string; status?: AmlReceiptStatus;
    received_at?: string; notes?: string; receipt_payload?: Record<string, any>;
  }) => invoke<{ receipt: AmlReportReceipt }>("record_receipt", args).then((r) => r.receipt),
  exportBundle: (id: string) => invoke<{ bundle: any; content_hash: string }>("export_bundle", { id }),
};
