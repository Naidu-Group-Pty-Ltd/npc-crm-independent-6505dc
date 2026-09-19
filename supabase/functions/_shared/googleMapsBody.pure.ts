/**
 * What Google Maps counts as a served request — one implementation.
 *
 * Google answers HTTP 200 for everything, so `response.ok` bills a refusal as
 * spend: measured 2026-09-12, 24 of 24 refused geocodes were logged
 * `status: 'success'`, forwarded to Mission Control with `quantity: 1` and
 * charged to the tenant for calls that returned nothing (RF-7.2B.1B0-F3).
 * `meteredFetch` therefore takes a `judgeBody`, and this is the judge every
 * Google Maps call site passes — written once, because the second call site
 * (`estimate-capital-growth`, 16 Sep 2026) shipped without it and logged its
 * first refused geocode as a billable success within an hour of deploying.
 *
 * `OK` and `ZERO_RESULTS` are both requests Google served and charges for —
 * a genuine no-match is a real answer about the ADDRESS. Every other status
 * (`REQUEST_DENIED`, `OVER_QUERY_LIMIT`, `OVER_DAILY_LIMIT`,
 * `INVALID_REQUEST`, `UNKNOWN_ERROR`) is a statement about our request or
 * their service: it returned nothing and must not be metered as spend. An
 * unrecognised status counts as ours, because attributing our outage to the
 * customer's address is the error that costs.
 */

/** The only Google geocoder status that is a statement about the ADDRESS. */
export const ADDRESS_IS_THE_ANSWER = 'ZERO_RESULTS';

export function judgeGoogleMapsBody(body: unknown): 'success' | 'error' | null {
  const status = (body as { status?: unknown } | null)?.status;
  if (typeof status !== 'string') return null;
  return status === 'OK' || status === ADDRESS_IS_THE_ANSWER ? 'success' : 'error';
}
