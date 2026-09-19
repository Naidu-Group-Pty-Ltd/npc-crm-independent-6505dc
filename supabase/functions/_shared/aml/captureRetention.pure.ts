/**
 * When an identity capture may be destroyed.
 *
 * The raw photographs — a customer's identity document and their face — are
 * the most sensitive objects this product holds. They live in private buckets
 * (`aml-documents`, `aml-biometrics`) and nothing has ever deleted them. This
 * module decides, for one verification attempt, whether that may now happen.
 *
 * Pure and dependency-free: every input is passed in, so the rule is testable
 * without a database, a clock or a storage client.
 *
 * ## The rule NPC already has, and why it governs this
 *
 * `20260726140000_aml_retention_triggers.sql` records the AML/CTF programme's
 * §18 position, and it is explicit:
 *
 *   > "Retention must not be implemented as automatic deletion seven years
 *   > after upload." The clock starts at a recorded TRIGGER EVENT — relationship
 *   > end, occasional transaction completion, transaction date, investigation
 *   > completion, report completion, legal-hold release — and the minimum
 *   > retention date is derived from that trigger plus the schedule's retention
 *   > period. **A record with no recorded trigger has not started its clock and
 *   > is never disposal-eligible.**
 *
 * So a plain "delete N days after capture" counter is not a smaller version of
 * NPC's policy — it is the thing that policy was written to forbid. It would
 * also contradict what NPC has already promised these specific customers: the
 * biometric consent document (catalogue 2026.2) tells them their facial image
 * is "kept for the record-keeping period required by anti-money laundering
 * law, **measured from the end of our business relationship with you**, and
 * are then destroyed".
 *
 * This module therefore requires BOTH clocks to have run out:
 *
 *   1. **§18** — the case has a live `aml.retention_triggers` row whose
 *      `minimum_retention_date` has passed. No trigger means the AML clock has
 *      not started, which means NOT ELIGIBLE. That is §18 verbatim.
 *   2. **`AML_IDV_CAPTURE_RETENTION_DAYS`** — a configured minimum age for the
 *      raw capture itself, measured from settlement. It can only ever make the
 *      rule *stricter*, never looser, and there is deliberately no default: a
 *      duration is a compliance decision and this code is not entitled to make
 *      one.
 *
 * ## It fails closed, everywhere
 *
 * Every unknown is a retain. No configuration, no trigger, no settlement
 * timestamp, an unrecognised state, an active legal hold, a check still under
 * human review — all of them keep the evidence. The only path to deletion is
 * one where every question has an affirmative answer.
 */

/* ─────────────────────────── configuration ─────────────────────────────── */

/**
 * The minimum age of the capture itself, in days.
 *
 * Deliberately has NO default. An absent value means "NPC has not decided
 * yet", which this module reports as `not_configured` and which deletes
 * nothing — it does not mean thirty days, or ninety, or seven years. Inventing
 * one here would be writing a retention policy in application code, which is
 * exactly what §18 exists to prevent.
 */
export const CAPTURE_RETENTION_ENV = 'AML_IDV_CAPTURE_RETENTION_DAYS';

/**
 * Parse the configured retention window.
 *
 * Returns null for absent, non-numeric, non-integer, zero or negative input.
 * Zero is refused as firmly as a negative: "delete immediately on settlement"
 * is a policy nobody would express by leaving a variable at 0, so reading it
 * that way would turn a typo into the destruction of evidence.
 */
export function parseRetentionDays(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = Number(raw.trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}

/* ────────────────────────────── the inputs ─────────────────────────────── */

/**
 * Processing states in which the attempt is finished with.
 *
 * `cancelled` and `dead_lettered` are included because both are terminal and
 * neither is going to be examined again. Everything absent from this list —
 * `draft`, `submitted`, `queued`, `processing`, `retry_scheduled` — is either
 * being captured right now or waiting for a provider, and its images are the
 * thing the next step needs.
 */
export const SETTLED_PROCESSING_STATES: ReadonlySet<string> = new Set([
  'completed', 'capture_unusable', 'technical_failure', 'cancelled', 'dead_lettered',
]);

/**
 * Identity outcomes that mean a person may still be looking at this.
 *
 * `referred` is the one that matters: it is the state a mismatch, an
 * indeterminate provider answer or a document-classification disagreement
 * lands in, and it means an adjudicator has been asked a question. Deleting
 * the photographs out from under that review would destroy the only evidence
 * the reviewer has.
 *
 * `pending` and `in_progress` are here for completeness — a settled row should
 * not carry them, and a row that does is a state this module does not
 * understand, which is a retain.
 */
export const UNDER_REVIEW_STATUSES: ReadonlySet<string> = new Set([
  'referred', 'pending', 'in_progress',
]);

export interface CaptureObjectRef {
  bucket: string;
  path: string;
}

export interface RetentionCandidate {
  checkId: string;
  caseId: string;
  /** Provider key on the row. Only the Standalone captures are NPC's to hold. */
  provider: string | null;
  processingStatus: string | null;
  /** The canonical identity outcome. */
  status: string | null;
  /** When the attempt finished. Null means the clock never started. */
  settledAt: string | null;
  supersededAt: string | null;
  /** Already cleaned; nothing to do. */
  captureDeletedAt: string | null;
  /** The server-generated paths, read off the row. Never from a request. */
  objects: CaptureObjectRef[];
  /**
   * §18: the latest live `minimum_retention_date` for this case, if any.
   * Null means no retention trigger has been recorded — the AML clock has not
   * started, and the record is never disposal-eligible.
   */
  minimumRetentionDate: string | null;
  /** An active `aml.legal_holds` row on this case or this check. */
  legalHoldActive: boolean;
}

export type RetentionDecision =
  | 'delete'
  /** No `AML_IDV_CAPTURE_RETENTION_DAYS`. Nothing is deleted, and we say so. */
  | 'not_configured'
  /** §18: the case has no recorded retention trigger. The clock has not started. */
  | 'awaiting_retention_trigger'
  /** §18: the trigger exists but its minimum retention date has not passed. */
  | 'within_aml_retention'
  /** Settled, but younger than the configured capture window. */
  | 'within_capture_window'
  /** Still being captured, queued, or with the provider. */
  | 'in_flight'
  /** A person may still be looking at this. */
  | 'under_review'
  /** An active legal hold. Nothing about this case may be destroyed. */
  | 'legal_hold'
  /** Already done. */
  | 'already_deleted'
  /** Nothing to delete — no recorded objects. */
  | 'no_captures'
  /** Not a Standalone capture, or a shape this module does not understand. */
  | 'not_eligible';

export interface RetentionVerdict {
  decision: RetentionDecision;
  /** True only for `delete`. Every other decision retains. */
  deletable: boolean;
  /** One machine-readable sentence for the audit record. Never PII. */
  reason: string;
}

const retain = (decision: RetentionDecision, reason: string): RetentionVerdict =>
  ({ decision, deletable: false, reason });

function parsedTime(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !value) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/**
 * May this attempt's photographs be destroyed?
 *
 * The order of the checks is the order of the answers a reviewer would want:
 * configuration, then whether anything is in flight, then holds, then the two
 * clocks. Each returns a distinct decision so the worker's summary — and the
 * audit record it writes — says WHY something was kept, rather than only that
 * it was.
 */
export function retentionVerdict(
  candidate: RetentionCandidate,
  retentionDays: number | null,
  nowMs: number,
  /** Provider keys whose captures NPC holds. Passed in to keep this pure. */
  standaloneProviders: ReadonlySet<string>,
): RetentionVerdict {
  // Configuration first: with no policy there is no question to answer, and a
  // deployment that has not decided must not have its evidence swept because
  // some other condition happened to line up.
  if (retentionDays === null) {
    return retain('not_configured',
      `${CAPTURE_RETENTION_ENV} is not set; no identity capture is deleted`);
  }

  if (candidate.captureDeletedAt) {
    return retain('already_deleted', 'captures were already destroyed');
  }

  // Only the Standalone journey puts a customer's photographs in NPC's
  // buckets. A hosted-session row has none, and a self-hosted row is a
  // different provider's evidence model that this worker has no mandate over.
  if (!candidate.provider || !standaloneProviders.has(candidate.provider)) {
    return retain('not_eligible', 'not an NPC-captured Standalone attempt');
  }

  if (!candidate.objects.length) {
    return retain('no_captures', 'the attempt records no capture objects');
  }

  // A legal hold outranks every clock in the system.
  if (candidate.legalHoldActive) {
    return retain('legal_hold', 'an active legal hold covers this case');
  }

  const processing = candidate.processingStatus ?? '';
  if (!SETTLED_PROCESSING_STATES.has(processing)) {
    return retain('in_flight',
      `processing_status "${processing || 'unknown'}" is not a settled state`);
  }

  if (UNDER_REVIEW_STATUSES.has(candidate.status ?? '')) {
    return retain('under_review',
      `identity status "${candidate.status}" may still be with a reviewer`);
  }

  // §18. No trigger means the AML clock has not started, and a record whose
  // clock has not started is never disposal-eligible. This is the check that
  // makes the whole mechanism agree with the policy NPC already has and with
  // the consent text its customers have already read.
  const minimumRetention = parsedTime(candidate.minimumRetentionDate);
  if (minimumRetention === null) {
    return retain('awaiting_retention_trigger',
      'no AML retention trigger recorded for this case (§18: the clock has not started)');
  }
  if (minimumRetention > nowMs) {
    return retain('within_aml_retention',
      'the case is inside its AML minimum retention period');
  }

  // The capture's own floor. Settlement is the anchor rather than creation,
  // because an attempt that took a week to settle was in use for that week.
  const settledAt = parsedTime(candidate.settledAt);
  if (settledAt === null) {
    return retain('not_eligible',
      'the attempt records no settlement time, so its age cannot be established');
  }
  if (nowMs - settledAt < retentionDays * 86_400_000) {
    return retain('within_capture_window',
      `settled less than ${retentionDays} days ago`);
  }

  return {
    decision: 'delete',
    deletable: true,
    reason: `AML retention satisfied and settled more than ${retentionDays} days ago`,
  };
}

/* ─────────────────────── deleting the right objects ────────────────────── */

/**
 * Buckets this worker may ever delete from.
 *
 * A closed list, checked against every object before a single removal. The
 * paths come off the verification row rather than from a request, so this is
 * belt and braces — but the thing it guards against is a corrupted or
 * hand-edited `outcome_detail` naming, say, `report-templates`, and the cost
 * of the guard is one set lookup.
 */
export const DELETABLE_BUCKETS: ReadonlySet<string> = new Set([
  'aml-documents', 'aml-biometrics',
]);

/**
 * Whether one recorded object may be removed for this case.
 *
 * Two independent conditions, both required:
 *
 *  - the bucket is one of NPC's two private AML buckets;
 *  - the path sits under this case's own prefix.
 *
 * The prefix check is what makes a cross-case deletion impossible even if a
 * row's stored plan were wrong: `prepare_verification_attempt` mints
 * `{caseId}/verification/{attemptId}/…`, so anything not starting `{caseId}/`
 * did not come from this case. Traversal is refused outright rather than
 * normalised — a path containing `..` is not something to repair, it is
 * something to refuse and report.
 */
export function mayDeleteObject(
  object: CaptureObjectRef, caseId: string,
): { allowed: boolean; reason: string } {
  if (!object || typeof object.bucket !== 'string' || typeof object.path !== 'string') {
    return { allowed: false, reason: 'malformed object reference' };
  }
  if (!DELETABLE_BUCKETS.has(object.bucket)) {
    return { allowed: false, reason: `bucket "${object.bucket}" is not an AML capture bucket` };
  }
  if (!object.path || object.path.includes('..') || object.path.startsWith('/')) {
    return { allowed: false, reason: 'path is absolute or contains traversal' };
  }
  if (!caseId || !object.path.startsWith(`${caseId}/`)) {
    return { allowed: false, reason: 'path does not belong to this case' };
  }
  return { allowed: true, reason: 'ok' };
}

/* ───────────────────────── the audit record ────────────────────────────── */

export type CleanupStatus = 'deleted' | 'partial' | 'failed' | 'refused';

export interface ObjectOutcome {
  bucket: string;
  path: string;
  removed: boolean;
  detail?: string;
}

/**
 * Roll per-object results up into one status for the row.
 *
 * `partial` is a real and expected state, not a bug: storage is a network
 * service, and a run that removed the document but not the selfie must say so
 * and be safely re-runnable. The next pass finds the row still eligible, tries
 * only what is left, and an object that is already gone counts as removed —
 * so retrying converges rather than erroring for ever.
 */
export function cleanupStatusFor(outcomes: ObjectOutcome[]): CleanupStatus {
  if (!outcomes.length) return 'failed';
  const removed = outcomes.filter((o) => o.removed).length;
  if (removed === outcomes.length) return 'deleted';
  return removed === 0 ? 'failed' : 'partial';
}

/**
 * The evidence a staff auditor reads.
 *
 * Enough to establish which attempt, when, and under which policy — and
 * deliberately not enough to recover anything. It records the bucket and path
 * that no longer exist, which is a reference rather than content, and it
 * carries no name, no image, no signed URL and no provider payload.
 */
export interface CaptureRetentionRecord {
  policy_env: string;
  retention_days_used: number;
  minimum_retention_date: string | null;
  decided_at: string;
  status: CleanupStatus;
  objects: ObjectOutcome[];
  reason: string;
}

export function buildRetentionRecord(args: {
  retentionDays: number;
  minimumRetentionDate: string | null;
  decidedAt: string;
  outcomes: ObjectOutcome[];
  reason: string;
}): CaptureRetentionRecord {
  return {
    policy_env: CAPTURE_RETENTION_ENV,
    retention_days_used: args.retentionDays,
    minimum_retention_date: args.minimumRetentionDate,
    decided_at: args.decidedAt,
    status: cleanupStatusFor(args.outcomes),
    objects: args.outcomes,
    reason: args.reason,
  };
}
