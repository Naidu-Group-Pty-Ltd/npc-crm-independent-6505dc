// Pure metering-outcome decision logic (no Deno / network / DB imports so it is
// unit-testable from vitest as well as `deno test`).
//
// The single question this module answers is: given what the wrapped report
// handler returned, should the Mission Control reservation be COMMITTED
// (billable work landed), HELD (a chunk of a multi-call generation succeeded,
// but the report is not finished yet) or RELEASED (the generation failed — the
// caller must not be charged)?
//
// The `hold` outcome is the important one. Chunked generation (`singleSection`)
// calls the same edge function once per section, and every intermediate call
// returns HTTP 200 with `isComplete: false`. Committing on those intermediate
// responses closed the Mission Control job after the FIRST section, which meant
// a failure in any later section could no longer be canceled — the report ended
// up `failed` while the tokens stayed spent. Holding keeps the reservation open
// until the run genuinely finishes, so a later failure still releases in full.

export type MeteringAction = "commit" | "hold" | "release";

export interface MeteringOutcomeInput {
  /** `response.ok` — 2xx. */
  ok: boolean;
  /** HTTP status of the handler response. */
  status: number;
  /** Parsed JSON response body, or undefined for non-JSON responses. */
  body?: unknown;
  /** `x-mc-tokens-used` header value, already numeric (NaN/0 when absent). */
  headerUsedTokens?: number | null;
  /** Tokens reserved for this job. */
  estimatedTokens: number;
}

export interface MeteringOutcome {
  action: MeteringAction;
  /** Tokens to charge. Always 0 for `hold` and `release`. */
  actualTokens: number;
  /** Short machine-readable reason, stamped onto the audit trail. */
  reason: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * A 2xx response that still reports failure in its payload. Report handlers in
 * this repo return `{ success: false, error }` on their error paths; most also
 * set a 4xx/5xx status, but a body-level failure must never be billed even when
 * the status says otherwise.
 */
export function isFailureBody(body: unknown): boolean {
  const record = asRecord(body);
  if (!record) return false;
  if (record.success === false) return true;
  if (record.ok === false) return true;
  // A non-empty top-level `error` string alongside no explicit success flag.
  // `errors` / `generationErrors` arrays are per-section warnings on otherwise
  // successful reports and deliberately do NOT count.
  if (record.success !== true && typeof record.error === "string" && record.error.trim() !== "") {
    return true;
  }
  return false;
}

/**
 * A successful response for one chunk of a multi-call generation. Only an
 * explicit `isComplete: false` counts — a finished report simply omits the
 * field, and treating "absent" as "incomplete" would leave every single-shot
 * report unbilled.
 */
export function isPartialSuccessBody(body: unknown): boolean {
  const record = asRecord(body);
  if (!record) return false;
  if (record.isComplete === false) return true;
  // Defensive: some handlers report chunk progress without `isComplete`.
  const completed = Number(record.sectionCompleted ?? NaN);
  const total = Number(record.totalSections ?? NaN);
  if (
    record.isComplete === undefined &&
    Number.isFinite(completed) &&
    Number.isFinite(total) &&
    total > 0 &&
    completed < total
  ) {
    return true;
  }
  return false;
}

/** Heuristic for actual usage when the handler returns no usage header. */
export function fallbackActualTokens(estimated: number, success: boolean): number {
  // Assume ~80% of estimate on success, 0 on failure (the release path handles that).
  return success ? Math.ceil(estimated * 0.8) : 0;
}

export function decideMeteringOutcome(input: MeteringOutcomeInput): MeteringOutcome {
  const { ok, status, body, estimatedTokens } = input;

  if (!ok) {
    return { action: "release", actualTokens: 0, reason: `handler_status_${status}` };
  }
  if (isFailureBody(body)) {
    return { action: "release", actualTokens: 0, reason: "handler_reported_failure" };
  }
  if (isPartialSuccessBody(body)) {
    return { action: "hold", actualTokens: 0, reason: "generation_incomplete" };
  }

  const headerUsed = Number(input.headerUsedTokens ?? 0);
  const actualTokens = Number.isFinite(headerUsed) && headerUsed > 0
    ? Math.ceil(headerUsed)
    : fallbackActualTokens(estimatedTokens, true);

  return { action: "commit", actualTokens, reason: "generation_complete" };
}

/**
 * Reservations must outlive the whole chunked run, not a single edge
 * invocation: a 17-section Compass-40 report can take the better part of an
 * hour end to end. Mission Control caps `ttl_seconds` at 86_400.
 */
export const DEFAULT_RESERVATION_TTL_SECONDS = 7_200;
export const MIN_RESERVATION_TTL_SECONDS = 30;
export const MAX_RESERVATION_TTL_SECONDS = 86_400;

export function resolveReservationTtlSeconds(raw: string | null | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RESERVATION_TTL_SECONDS;
  return Math.min(
    MAX_RESERVATION_TTL_SECONDS,
    Math.max(MIN_RESERVATION_TTL_SECONDS, Math.floor(parsed)),
  );
}

/**
 * Prefix of the Mission Control idempotency keys that belong to ONE generation
 * run of an investment report. Keys are built as
 * `inv-report:<reportId>|<version>|<input-fingerprint>` and lower-cased by
 * `buildIdempotencyKey`, so this prefix selects every reservation taken for the
 * report's current version — including the case where a run is started by one
 * driver and resumed by another (different payload ⇒ different fingerprint) —
 * while never matching a previously completed version's paid job.
 */
export function investmentReportRunKeyPrefix(
  reportId: string,
  currentVersion: number | string,
): string {
  const parts = [String(reportId ?? "").trim().toLowerCase(), String(currentVersion ?? "").trim().toLowerCase()];
  return `inv-report:${parts.join("|")}|`;
}
