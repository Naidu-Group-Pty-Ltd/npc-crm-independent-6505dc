/**
 * What the Market News Feed tells an operator when something is wrong.
 *
 * ## The defect this exists for
 *
 * The clone's feed was empty under a red banner reading
 * `Stage: Ingestion · Function: market-updates-ingest · HTTP 422` over the
 * sentence "Market News Feed could not complete this operation." — which names
 * nothing and asks for nothing.
 *
 * `market-updates-ingest` had already worked out the answer and written it
 * down. Its 422 carries one of two sentences, chosen by counting the registry:
 * "The Market Updates source registry has not been seeded in this
 * environment." or "No enabled market sources are configured in the connected
 * database." `invokeSecureFunction` carries the body's `error` through as
 * `error.message`. And `operationalError` then **discarded it**: its classifier
 * knows 401, 403, 404 and 5xx, so a 422 fell to `unknown`, and `unknown`
 * replaces the server's sentence with a generic one.
 *
 * Three of the error codes the union declares — `registry_empty`,
 * `sources_disabled`, `ingestion_empty` — had never been produced by anything.
 *
 * ## The rules
 *
 * **A sentence the server wrote about its own state outranks one the client
 * guessed from a status code.** Only the server knows whether the registry is
 * unseeded or merely disabled; the client knows only that the number was 422.
 *
 * **Except where the client genuinely knows better.** A 404 body is the
 * gateway's, a 401's is terse, a network failure has no body at all, and a
 * database message is database vocabulary — for those the client's own advice
 * is the better sentence, which is why this is an explicit list rather than
 * "always prefer the server".
 *
 * **Database vocabulary never reaches the operator.** `looksLikeOperatorSentence`
 * is what makes the preference safe: a SQLSTATE, a column name, a PostgREST
 * code or a bare `HTTP 500` is refused and the generic sentence stands.
 *
 * Pure + deterministic: no DOM, no network, no clocks.
 */
import type { MarketUpdatesErrorCode } from '@/types/marketUpdates';

export interface MarketFailureSignal {
  status?: number;
  message?: string | null;
  /** A code the server named itself, which always wins. */
  code?: string | null;
  network?: boolean;
}

/**
 * Codes where the CLIENT's sentence is the better one.
 *
 * Everything else prefers whatever the server said about itself.
 */
const CLIENT_KNOWS_BEST: ReadonlySet<string> = new Set<MarketUpdatesErrorCode>([
  'network_error',
  'function_missing',
  'migration_missing',
  'unauthorised',
  'session_expired',
  'missing_session',
  'rls_denied',
  'forbidden',
]);

/** Shapes that mean a message came from the database rather than from a person. */
const DATABASE_VOCABULARY = [
  /\b[0-9A-Z]{5}\b.*\bdoes not exist\b/i,
  /\bPGRST\d+/i,
  /\bcolumn\b.*\bdoes not exist\b/i,
  /\brelation\b.*\bdoes not exist\b/i,
  /violates .*constraint/i,
  /null value in column/i,
  /duplicate key value/i,
  /syntax error at/i,
  /schema cache/i,
  /row-level security/i,
  /\b[a-z]+(?:_[a-z0-9]+){2,}\b/,
];

/**
 * Is this a sentence an operator can act on, rather than a code or a fragment?
 */
export function looksLikeOperatorSentence(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  const text = message.trim();
  if (text.length < 16) return false;
  if (!text.includes(' ')) return false;
  // `HTTP 422`, `500`, `Error` — the shapes `invokeSecureFunction` falls back
  // to when the body carried no message at all.
  if (/^(HTTP\s+)?\d{3}$/i.test(text)) return false;
  if (/^(error|failed|unknown error)\.?$/i.test(text)) return false;
  return !DATABASE_VOCABULARY.some((pattern) => pattern.test(text));
}

/**
 * Every code the surface has a sentence and a remedy for.
 *
 * A code the server names that is NOT in here is a code this client cannot
 * render — `internalError` sends `internal_error` on every 500, which resolved
 * to no message and no remediation and fell back to the "could not complete
 * this operation" pair, losing the better `server_error` wording. Recognised
 * or classified, never taken on trust.
 */
export const MARKET_ERROR_CODES: ReadonlySet<string> = new Set<MarketUpdatesErrorCode>([
  'missing_session', 'session_expired', 'migration_missing', 'rls_denied', 'function_missing',
  'unauthorised', 'forbidden', 'server_error', 'network_error', 'registry_empty',
  'sources_disabled', 'ingestion_empty', 'source_failed', 'source_fetch_failed',
  'source_parse_failed', 'source_validation_failed', 'database_insert_failed',
  'provider_not_configured', 'provider_unauthorised', 'provider_payment_required',
  'provider_rate_limited', 'provider_timeout', 'digest_failed', 'cron_missing', 'cron_stale',
  'ai_unavailable', 'unknown',
]);

/**
 * Which condition this failure is.
 *
 * A code the server named itself wins — it is the server describing its own
 * state, which is the whole rule above — but only where this surface can
 * actually render it.
 */
export function classifyMarketFailure(signal: MarketFailureSignal): MarketUpdatesErrorCode {
  if (typeof signal.code === 'string' && MARKET_ERROR_CODES.has(signal.code)) {
    return signal.code as MarketUpdatesErrorCode;
  }
  const status = Number(signal.status) || undefined;
  const raw = String(signal.message ?? '').toLowerCase();

  if (signal.network) return 'network_error';
  if (status === 401) return 'unauthorised';
  if (status === 403 || raw.includes('permission denied') || raw.includes('row-level security')) {
    return 'rls_denied';
  }
  if (status === 404) return 'function_missing';
  // 422 is the ingest function saying it has nothing to ingest FROM, and it
  // distinguishes the two cases itself by counting the registry.
  if (status === 422) {
    if (raw.includes('not been seeded') || raw.includes('registry has not')) return 'registry_empty';
    if (raw.includes('no enabled')) return 'sources_disabled';
    return 'ingestion_empty';
  }
  if (
    raw.includes('does not exist')
    || raw.includes('schema cache')
    || raw.includes('pgrst205')
    || raw.includes('42p01')
  ) {
    return 'migration_missing';
  }
  if (status && status >= 500) return 'server_error';
  return 'unknown';
}

/**
 * Conditions a retry cannot change.
 *
 * The banner draws "Retryable" or "Administrator action required" from this,
 * and an unseeded registry was reading as Retryable — a Retry button that
 * fails identically every time is a dead control, which is worse than no
 * control. Seeding the registry or enabling a source is an act somebody has to
 * perform; pressing Ingest again is not it.
 */
export function marketFailureIsRetryable(code: MarketUpdatesErrorCode): boolean {
  return ![
    'rls_denied',
    'provider_unauthorised',
    'provider_payment_required',
    'registry_empty',
    'sources_disabled',
    'migration_missing',
    'function_missing',
  ].includes(code);
}

/**
 * The sentence to show: the server's own, where it is one and the client does
 * not know better.
 */
export function resolveIssueMessage(
  code: MarketUpdatesErrorCode,
  serverMessage: string | null | undefined,
  generic: string,
): string {
  if (CLIENT_KNOWS_BEST.has(code)) return generic;
  return looksLikeOperatorSentence(serverMessage) ? String(serverMessage).trim() : generic;
}
