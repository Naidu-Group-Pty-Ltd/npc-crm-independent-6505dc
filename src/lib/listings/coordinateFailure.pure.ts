/**
 * Why the map could not place some listings, and what that asks of anybody.
 *
 * ## The defect this exists for
 *
 * `resolve-listing-coordinates` answered **three** different conditions with
 * one 503 and one body, and the map rendered all three as "The location service
 * is unavailable · Address resolution is paused while the upstream provider
 * recovers":
 *
 *  1. the provider's circuit breaker is open — it really is failing, and
 *     waiting really is the answer;
 *  2. `GEOCODING_KILL_SWITCH` is on — no provider is involved at all, and no
 *     amount of waiting changes anything;
 *  3. the read of our own circuit state failed — ours, not theirs.
 *
 * The 19 Sep 2026 clone audit reported the popup. Only (1) is what it said.
 *
 * This is the rule `GEOCODING_WITHOUT_GOOGLE.md` already states for the server
 * side — "a failure says which kind it was … rather than blaming the
 * customer's address for this deployment's provider" — applied to the surface
 * in front of it.
 *
 * ## The rules
 *
 * **A reason this build has never heard of falls back to the general reading,
 * never to a specific one.** A future server reason must degrade to "some
 * addresses could not be resolved", which is true of all of them.
 *
 * **Only a condition a retry can change schedules a retry.** The hook backs off
 * exponentially and retries forever; against a kill switch that is an infinite
 * loop of requests that can only ever be refused.
 *
 * Pure + deterministic: no DOM, no network, no clocks.
 */

export type CoordinateFailure =
  | 'rate_limited'
  | 'unavailable'
  | 'disabled'
  | 'unauthorized'
  | 'failed';

export interface CoordinateFailureCopy {
  title: string;
  detail: string;
}

/**
 * What the server said, turned into which kind of failure this is.
 *
 * `status` is the HTTP status; `reason` is the body's own word, which older
 * deployments do not send.
 */
export function readCoordinateFailure(
  status: number | undefined,
  reason: unknown,
): CoordinateFailure {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 503) {
    // A word this build does not recognise is a 503 all the same, so it reads
    // as the general unavailability rather than as a specific claim.
    return reason === 'geocoding_disabled' ? 'disabled' : 'unavailable';
  }
  return 'failed';
}

/**
 * Whether backing off and trying again can change this.
 *
 * `disabled` and `unauthorized` cannot: one needs a setting changed, the other
 * a permission granted. Retrying them is a request that can only be refused.
 */
export function coordinateFailureIsRetryable(failure: CoordinateFailure): boolean {
  return failure === 'rate_limited' || failure === 'unavailable' || failure === 'failed';
}

export const COORDINATE_FAILURE_COPY: Record<CoordinateFailure, CoordinateFailureCopy> = {
  rate_limited: {
    title: 'Address lookups are rate limited',
    detail:
      'The location service is throttling this session. Listings already placed stay on the map — try again in a minute for the rest.',
  },
  unavailable: {
    title: 'The location service is unavailable',
    detail:
      'Address resolution is paused while the upstream provider recovers. Listings with saved coordinates are still shown.',
  },
  disabled: {
    title: 'Address lookups are switched off for this deployment',
    detail:
      'Listings with saved coordinates are still shown, and no new addresses will be resolved until an administrator turns address lookups back on. Waiting will not change it.',
  },
  unauthorized: {
    title: 'Not permitted to resolve addresses',
    detail:
      'Your session cannot use the location service. Sign out and back in, or ask an administrator to grant Listings access.',
  },
  failed: {
    title: 'Some addresses could not be resolved',
    detail:
      'The location service returned an error for part of this result set. Listings it did place are shown below.',
  },
};
