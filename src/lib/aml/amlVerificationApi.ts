import { invokeAmlFunction } from "./invokeAmlFunction";

export type IdvStatus = "pending" | "in_progress" | "verified" | "failed" | "expired" | "manual_review" | "cancelled";
export type ScreeningStatus = "pending" | "in_progress" | "clear" | "matched" | "review" | "failed" | "cancelled";
export type MatchStatus = "open" | "confirmed" | "dismissed" | "escalated";
export type MatchType = "pep" | "sanctions" | "adverse_media" | "watchlist" | "other";
export type ScreeningScope = "pep" | "sanctions" | "adverse_media" | "watchlist";

export interface IdentityCheck {
  id: string; case_id: string; subject_label: string; provider: string;
  provider_reference: string | null; method: string; status: IdvStatus;
  overall_score: number | null; result_payload: any; requested_at: string;
  completed_at: string | null; mc_job_id: string | null; mc_tokens_committed: number | null;
  /** Present once the execution-mode migration is applied. */
  execution_mode?: "live" | "simulation";
  authoritative?: boolean;
  environment?: string | null;
}

export type ProviderReadinessState =
  | "ready_live" | "simulator_non_production" | "not_configured"
  | "misconfigured" | "unavailable" | "unknown";

export interface CapabilityReadiness {
  /**
   * Which IDV experience the client will actually get, as the server resolves
   * it. Absent for screening. `hosted_session` means the provider runs the
   * capture on its own UI and the client completes it in the portal — which is
   * different advice from "upload a document".
   */
  idv_flow?: 'capture' | 'hosted_session' | null;
  capability: string;
  configured_provider: string | null;
  mode: "simulator" | "live";
  adapter_wired: boolean;
  secrets_present: Record<string, boolean>;
  last_health: { at: string | null; status: string | null; message: string | null } | null;
  state: ProviderReadinessState;
}

export interface ProviderReadiness {
  environment: string;
  simulator_blocked: boolean;
  note: string;
  idv: CapabilityReadiness;
  screening: CapabilityReadiness;
}

export interface ScreeningCheck {
  id: string; case_id: string; subject_label: string; subject_type: string;
  provider: string; provider_reference: string | null; scope: string[];
  status: ScreeningStatus; result_summary: any; requested_at: string;
  completed_at: string | null; mc_job_id: string | null; mc_tokens_committed: number | null;
}

export interface ScreeningMatch {
  id: string; screening_check_id: string; case_id: string; match_type: MatchType;
  list_name: string | null; matched_name: string; score: number | null;
  jurisdiction: string | null; details: any; status: MatchStatus;
  created_at: string; updated_at: string;
}

async function invoke<T = any>(payload: Record<string, unknown>): Promise<T> {
  return invokeAmlFunction<T>("aml-verification", payload);
}

export const amlVerificationApi = {
  providerReadiness: () => invoke<ProviderReadiness>({ op: "provider_readiness" }),
  initiateIdv: (case_id: string, method?: string, metadata?: Record<string, any>) =>
    invoke<{ identity_check: IdentityCheck; result: any }>({ op: "initiate_idv", case_id, method, metadata }),
  getIdv: (id: string) => invoke<{ identity_check: IdentityCheck; documents: any[] }>({ op: "get_idv", id }),
  listIdv: (case_id?: string, status?: IdvStatus) =>
    invoke<{ identity_checks: IdentityCheck[] }>({ op: "list_idv", case_id, status }),
  cancelIdv: (id: string) => invoke<{ identity_check: IdentityCheck }>({ op: "cancel_idv", id }),

  runScreening: (case_id: string, scope?: ScreeningScope[], metadata?: Record<string, any>) =>
    invoke<{ screening_check: ScreeningCheck; result: any }>({ op: "run_screening", case_id, scope, metadata }),
  listScreening: (case_id?: string, status?: ScreeningStatus) =>
    invoke<{ screening_checks: ScreeningCheck[] }>({ op: "list_screening", case_id, status }),
  getScreening: (id: string) => invoke<{ screening_check: ScreeningCheck; matches: ScreeningMatch[] }>({ op: "get_screening", id }),

  listMatches: (params: { case_id?: string; status?: MatchStatus } = {}) =>
    invoke<{ matches: ScreeningMatch[] }>({ op: "list_matches", ...params }),
  resolveMatch: (match_id: string, disposition: "confirmed" | "dismissed" | "escalated", rationale: string) =>
    invoke<{ resolution: any; match: ScreeningMatch }>({ op: "resolve_match", match_id, disposition, rationale }),

  /* ── self-hosted verification (zero-cost stack) ────────────────────────── */

  listVerificationChecks: (case_id: string) =>
    invoke<{ checks: AmlVerificationCheck[]; max_attempts: number }>(
      { op: "list_verification_checks", case_id }),

  /** Adjudicate a pending portal submission through the self-hosted service. */
  runVerification: (check_id: string) =>
    invoke<{ check: AmlVerificationCheck }>({ op: "run_verification", check_id }),

  /**
   * Re-run the provider for a check whose processing failed for a technical
   * reason. Consumes no further customer attempt — the server refuses anything
   * that is not `technical_failure` or `dead_lettered` with
   * `retry_not_eligible`, so this can never overwrite an identity outcome.
   */
  retryVerificationProcessing: (check_id: string) =>
    invoke<{ check: AmlVerificationCheck }>({ op: "retry_verification_processing", check_id }),

  recordDocumentSighting: (params: {
    case_id: string; party_id?: string | null; party_label: string;
    document_type: string; sighting_kind: "original" | "certified_copy";
    certifier_name?: string; certifier_capacity?: string; notes: string;
  }) => invoke<{ check: AmlVerificationCheck }>({ op: "record_document_sighting", ...params }),

  /** Returns a 120-second URL and writes an entry to the biometric access log. */
  getBiometricUrl: (check_id: string, reason: string) =>
    invoke<{ url: string; expires_in_seconds: number }>(
      { op: "get_biometric_url", check_id, reason }),

  listBiometricAccess: (case_id: string) =>
    invoke<{ access_log: AmlBiometricAccessEntry[] }>({ op: "list_biometric_access", case_id }),

  sanctionsListStatus: () =>
    invoke<{ syncs: AmlSanctionsSync[]; entry_count: number }>({ op: "sanctions_list_status" }),
  /**
   * Load the DFAT Consolidated List from a spreadsheet a person downloaded.
   *
   * The browser sends RAW CELLS and nothing else. Mapping and name
   * normalisation happen on the server, with the same function the screening
   * query uses — a browser that normalised differently would write entries no
   * query could ever match, and a list that matches nobody looks exactly like
   * one that works.
   */
  ingestSanctionsList: (rows: unknown[][], source_label: string, force = false) =>
    invoke<{
      list_code: string; entries: number; pruned: number;
      pruned_skipped: boolean; reason: string; sync_id: string;
      /**
       * What loading the list did to the platform's ability to screen.
       *
       * Loading DFAT was necessary and never sufficient: production refuses to
       * run the provider while it sits in simulator mode, so the list alone
       * could not have completed a single check. The server promotes it on a
       * real load and says so here, because an operator who has just loaded
       * the register needs to know whether screening actually runs now.
       */
      screening?: { mode: string; changed: boolean; reason: string };
      /**
       * How current the DATA is, as opposed to how recent the upload was.
       * Every other freshness signal in the product measures the sync, so a
       * four-year-old file loaded today reads as perfectly fresh everywhere
       * else. This is the newest listing the file itself contains.
       */
      newest_listing?: string | null;
      list_age_days?: number | null;
      recency_unknown?: boolean;
    }>({ op: "ingest_sanctions_list", list_code: "dfat", rows, source_label, force }),
};

export type AmlVerificationStatusValue =
  | "pending" | "in_progress" | "passed" | "failed" | "referred" | "exhausted" | "abandoned";

export interface AmlVerificationCheck {
  id: string;
  case_id: string;
  party_id: string | null;
  party_label: string;
  check_type: "electronic_idv" | "document_sighting" | "dvs" | "screening";
  attempt_number: number;
  status: AmlVerificationStatusValue;
  provider: string | null;
  provider_reference: string | null;
  outcome_detail: Record<string, any>;
  failure_reason: string | null;
  biometric_kind: string | null;
  /** The storage path itself is never sent to the browser. */
  has_biometric?: boolean;
  verified_by: string | null;
  verified_by_type: string | null;
  requested_at: string;
  completed_at: string | null;
  // ── Canonical verification model ──
  // `status` is the identity outcome; `processing_status` is how far the
  // provider run got. They are deliberately separate: a provider outage or an
  // unusable capture must never read as a customer failure, and neither
  // consumes an attempt. `list_verification_checks` returns the whole row, so
  // these were already on the wire before the staff UI surfaced them.
  execution_mode?: "live" | "simulation" | "manual" | null;
  authoritative?: boolean | null;
  environment?: string | null;
  processing_status?: AmlProcessingStatus | null;
  attempt_consumed?: boolean | null;
  processing_attempts?: number | null;
  capture_sequence?: number | null;
  provider_error_category?: string | null;
  superseded_at?: string | null;
  next_retry_at?: string | null;
}

/** `aml.verification_checks.processing_status` CHECK values. */
export type AmlProcessingStatus =
  | "submitted" | "queued" | "processing" | "completed"
  | "capture_unusable" | "technical_failure" | "retry_scheduled"
  | "dead_lettered" | "cancelled";

/**
 * Only a technical failure or a dead-lettered job may be retried: those are
 * ours, not the customer's, so a retry runs the provider again without
 * consuming a further attempt. Anything else is either still in flight or is
 * an adjudicated identity outcome, which a retry must never overwrite — the
 * server enforces the same rule and answers `retry_not_eligible`.
 */
export const RETRYABLE_PROCESSING_STATUSES: readonly AmlProcessingStatus[] = [
  "technical_failure",
  "dead_lettered",
];

export function isRetryableProcessingStatus(value: string | null | undefined): boolean {
  return RETRYABLE_PROCESSING_STATUSES.includes(String(value ?? "") as AmlProcessingStatus);
}

export interface AmlBiometricAccessEntry {
  id: string;
  verification_check_id: string;
  actor_label: string | null;
  action: string;
  reason: string | null;
  created_at: string;
}

export interface AmlSanctionsSync {
  id: string;
  list_code: string;
  source_url: string;
  entry_count: number;
  status: string;
  error_detail: string | null;
  started_at: string;
  completed_at: string | null;
}
