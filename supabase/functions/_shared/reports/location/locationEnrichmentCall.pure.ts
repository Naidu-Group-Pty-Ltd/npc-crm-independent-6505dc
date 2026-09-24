/**
 * What one call to `location-intelligence-service` concluded, and whether it
 * is worth making again inside the same invocation.
 *
 * ## Why the location call is different from every other acquisition
 *
 * Every geography-keyed register this report reads is keyed on the coordinate
 * this call returns: the ABS boundary resolution, and through it the trusted
 * postal area, the SA2, the demographics the Client-Safe Gate admits, the
 * planning parcel query, the crime area, the market evidence and the Location
 * dimension of the grade. Miss it and the invocation goes on to write sections
 * about a property it cannot place.
 *
 * That is what happened to 60 Lawley Street, Spalding WA on 24 Sep 2026. The
 * generator gave the call the `vendor` class's 12 s; the service needed 12.6 s
 * of its own work plus 2.3 s of cold routing, so the answer arrived three
 * seconds after the generator had given up on it — with 95 s of the run's
 * budget unspent. The service finished anyway and billed its Places lookups;
 * the report was written without it.
 *
 * ## The rules
 *
 * **A reading is one of eight things, and only two describe the address.**
 * `answered` and `no_match` are statements about the property (placed, or no
 * provider has a match). Everything else — a timeout, a reset connection, a
 * 5xx, the service's own provider-error envelope, a geocoder that refused or
 * was not attempted, a call never made for want of a window — is a statement
 * about this invocation, and is recorded as a FAILURE so the dependency stays
 * outstanding. The service's `success: false` used to be recorded as "answered
 * and returned nothing" whatever the reason, which filed a geocoder refusal as
 * a fact about the address.
 *
 * **One retry, only for what a retry can cure, only with room to finish.** A
 * cold start, a reset, a boot failure and a provider blip are exactly what a
 * second call a few seconds later clears — the same service answered in 6 s
 * warm. A geocoder that refused, an address with no match and a call with no
 * window are not, and re-asking would spend the geocoder's allowance or the
 * section loop's reserve to learn the same thing.
 */

/** `acquisitionFetch`'s synthetic status for a call it did not make. */
export const NO_WINDOW_STATUS = 598;

export type LocationCallReading =
  /** Placed, with an enrichment. */
  | { readonly kind: 'answered' }
  /** The service placed nothing because no provider matches this address. About the address. */
  | { readonly kind: 'no_match'; readonly reason: string }
  /** The service placed nothing for a reason that is ours (geocoder refused or not attempted). */
  | { readonly kind: 'refused'; readonly reason: string }
  /** The service's own provider-error envelope. */
  | { readonly kind: 'unavailable'; readonly detail: string }
  /** The service answered with an HTTP error. */
  | { readonly kind: 'http_error'; readonly status: number }
  /** Not made: no window left in this invocation, or the circuit is open. */
  | { readonly kind: 'not_attempted'; readonly detail: string }
  /** Our deadline fired. */
  | { readonly kind: 'timeout'; readonly message: string }
  /** The request never completed. */
  | { readonly kind: 'transport_error'; readonly message: string };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * The unresolved reasons that are a statement about the INPUT.
 *
 * `address_not_resolved` is the provider saying it has no match;
 * `supplied_coordinates_rejected` is the caller's own point refused by the
 * country gate. The other two the service names — `geocoder_unavailable` and
 * `geocoder_not_attempted` — are this deployment's, and its own message says
 * so ("the address supplied was never rejected as invalid").
 */
const ABOUT_THE_ADDRESS: ReadonlySet<string> = new Set([
  'address_not_resolved',
  'supplied_coordinates_rejected',
]);

/** Read an answered response. `body` is the parsed JSON, or undefined when it did not parse. */
export function readLocationAnswer(status: number, body: unknown): LocationCallReading {
  if (status === NO_WINDOW_STATUS) {
    return { kind: 'not_attempted', detail: 'no window left in this invocation' };
  }
  if (status < 200 || status >= 300) return { kind: 'http_error', status };

  const record = asRecord(body);
  if (!record) return { kind: 'unavailable', detail: 'the service answered with no readable body' };

  if (record.success === true && asRecord(record.data)) return { kind: 'answered' };

  if (record.unavailable === true && record.success === false) {
    const reason = typeof record.reason === 'string' ? record.reason : 'unavailable';
    const message = typeof record.message === 'string' ? record.message : '';
    return { kind: 'unavailable', detail: message ? `${reason}: ${message}` : reason };
  }

  if (record.resolved === false) {
    const reason = typeof record.reason === 'string' && record.reason ? record.reason : 'unknown';
    return ABOUT_THE_ADDRESS.has(reason)
      ? { kind: 'no_match', reason }
      : { kind: 'refused', reason };
  }

  return { kind: 'unavailable', detail: 'the service answered with a body this caller does not recognise' };
}

/** Read a call that threw. */
export function readLocationThrow(error: unknown): LocationCallReading {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string' ? error : 'the request threw and reported no message';
  if (/circuit breaker open/i.test(message)) return { kind: 'not_attempted', detail: message };
  if (/timed out|timeout|aborted/i.test(message)) return { kind: 'timeout', message };
  return { kind: 'transport_error', message };
}

/** Whether this reading is a statement about the property rather than about this invocation. */
export function describesAddress(reading: LocationCallReading): boolean {
  return reading.kind === 'answered' || reading.kind === 'no_match';
}

/** Whether a second call a few seconds later could plausibly answer. */
export function isTransientFailure(reading: LocationCallReading): boolean {
  switch (reading.kind) {
    case 'timeout':
    case 'transport_error':
    case 'unavailable':
      return true;
    case 'http_error':
      return reading.status >= 500 && reading.status !== NO_WINDOW_STATUS;
    default:
      return false;
  }
}

/** At most this many calls per invocation: the first and one retry. */
export const LOCATION_CALL_MAX_ATTEMPTS = 2;

/**
 * Below this much window a retry is not started. The service answers in about
 * six seconds warm; a retry with less room than this would most likely time
 * out again, spend the section loop's time and bill the lookups twice.
 */
export const LOCATION_RETRY_MIN_WINDOW_MS = 10_000;

export interface RetryQuestion {
  readonly reading: LocationCallReading;
  /** Calls already made in this invocation, the one just read included. */
  readonly attempt: number;
  /** The window a retry would get now, or null where the run has none. */
  readonly windowMs: number | null;
}

/** Whether to call again now. */
export function mayRetryLocationNow(q: RetryQuestion): boolean {
  return isTransientFailure(q.reading)
    && q.attempt < LOCATION_CALL_MAX_ATTEMPTS
    && q.windowMs !== null
    && q.windowMs >= LOCATION_RETRY_MIN_WINDOW_MS;
}

/** How the acquisition ledger records the reading. */
export function ledgerOutcomeOf(reading: LocationCallReading): 'answered' | 'empty' | 'failed' {
  if (reading.kind === 'answered') return 'answered';
  if (reading.kind === 'no_match') return 'empty';
  return 'failed';
}

/** One line for the log and the ledger. */
export function describeLocationReading(reading: LocationCallReading): string {
  switch (reading.kind) {
    case 'answered': return 'answered with an enrichment';
    case 'no_match': return `placed nothing: no provider matches this address (${reading.reason})`;
    case 'refused': return `placed nothing for a reason that is ours, not the address's (${reading.reason})`;
    case 'unavailable': return `answered with its provider-error envelope (${reading.detail})`;
    case 'http_error': return `answered HTTP ${reading.status}`;
    case 'not_attempted': return `was not called (${reading.detail})`;
    case 'timeout': return `did not answer in time (${reading.message})`;
    case 'transport_error': return `could not be reached (${reading.message})`;
  }
}
