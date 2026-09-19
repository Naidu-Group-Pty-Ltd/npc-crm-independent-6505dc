/**
 * The one honest answer a data service may give when it has nothing.
 *
 * This module exists because seven of the nine external-data services behind
 * the report pipeline answered "I don't know" by inventing, and the
 * inventions were measured in production before this was written:
 *
 *  - `abs-data-service` never called the ABS at all — its four live-API
 *    functions had no caller — and served one of three invented profiles
 *    with `Math.random()` noise, labelled `ABS Census 2021 estimates`.
 *    **849 stored reports across 500 properties carry the identical
 *    profile** (unemployment 3.5%, owner-occupiers 69.8%), and one property
 *    (`10 Chester Street`) holds **20 reports with 20 different
 *    populations**, 16,245 to 38,773.
 *  - `public-transport-service` told every NSW property it was 450m from
 *    Central Station, whatever its coordinate; every VIC property, 250m
 *    from a Swanston Street tram.
 *  - `abs-employment-service` returned a random labour-force size and a
 *    canned "Positive" outlook under `dataset: '6202.0 — Labour Force,
 *    Australia'`.
 *  - `crime-statistics-service` invented counts of break-and-enters and a
 *    "22% higher than state average" comparison from a postcode band.
 *  - `location-intelligence-service` shipped invented school names
 *    ("Primary School A") and a `Math.random()` walk score.
 *  - `climate-data-service` gave every property in a state the same
 *    rainfall; `abs-seifa-service` assigned socio-economic deciles from
 *    postcode folklore; `rba-data-service` stamped today's date on a cash
 *    rate hard-coded years ago.
 *
 * And the caches laundered it: fabricated rows were written with 30–365 day
 * expiries and served back as cache hits — 2,139 rows across four cache
 * tables, **not one of them live**.
 *
 * The rule, stated once: **a source that cannot answer says so.** A missing
 * figure in a report is a visible absence the reader can weigh; an invented
 * figure is a defect nobody can see, because every number downstream is
 * computed from it correctly. This is the same asymmetry the AML programme
 * records as "refusal is visible, a confident clear against nothing is not".
 *
 * Every consumer of these services already attaches data only on
 * `success && data` (verified across `generate-investment-report`,
 * `regenerate-report-qualitative` and the agent tool registry), so this
 * envelope lands them in the exact path they take when a service is
 * unreachable: the section is absent and the coverage flags record it.
 *
 * HTTP status is the caller's concern, not this module's — but note these
 * envelopes are sent with **200**: "the world holds no data for you" is a
 * successful, truthful answer to the question asked, and the repo's
 * error-disclosure gate rightly treats 5xx as transport failure.
 *
 * `dataQuality` never appears here. "Estimated" was the word the fabricators
 * hid behind; an estimate this platform did not compute from real inputs is
 * not an estimate, it is fiction, and no field on this envelope can carry a
 * figure at all.
 */

/** Why the source has nothing — each names a different remedy. */
export type SourceUnavailableReason =
  /** A credential or config the deployment lacks; an operator can fix it. */
  | 'not_configured'
  /** The upstream provider errored or answered unusably; retrying may work. */
  | 'provider_error'
  /**
   * No real integration exists for this source yet — the honest state of a
   * service whose only implementation was the fabricator. Building the
   * integration is the remedy; nothing else will change this answer.
   */
  | 'source_not_integrated'
  /** The source is real and was asked, and holds nothing for this place. */
  | 'no_data_for_location';

export interface SourceUnavailableBody {
  success: false;
  data: null;
  unavailable: true;
  service: string;
  reason: SourceUnavailableReason;
  message: string;
}

export function sourceUnavailable(
  service: string,
  reason: SourceUnavailableReason,
  message: string,
): SourceUnavailableBody {
  return { success: false, data: null, unavailable: true, service, reason, message };
}

/**
 * True when a parsed service response is this envelope. For consumers whose
 * upstream historically returned bare data with no `success` field (the
 * public-transport shape), this is the check that keeps an envelope from
 * being mistaken for a payload.
 */
export function isSourceUnavailable(value: unknown): value is SourceUnavailableBody {
  return !!value && typeof value === 'object' &&
    (value as Record<string, unknown>).unavailable === true &&
    (value as Record<string, unknown>).success === false;
}
