/**
 * Which coordinate may ask a planning register about THIS property.
 *
 * ## The two faults this closes
 *
 * The planning fetch and the published-project register are both gated on
 * `enhancedData.locationIntelligence?.coordinates` — an in-memory working
 * object belonging to the run that is executing. Measured over the 105 stored
 * reports in the verification corpus:
 *
 * ```
 * rows                                              105
 * rows carrying a coordinate on location_intelligence  5
 * rows carrying a planning key in data_sources         0
 * ```
 *
 * **Fault one** is the 100 rows with no coordinate at all: the enrichment
 * produced nothing, the guard was false, and the register was never asked.
 * Recording that as a skip — which the acquisition ledger now does — is an
 * honest account of a report that still has no planning content in it.
 *
 * **Fault two** is the five rows that DO carry a coordinate and still have no
 * planning key. `23 MACKAY Street, Moranbah QLD 4744` was generated on
 * 2026-09-08, two days after `planning-data-service` went live. Its
 * `location_intelligence` column holds `{lat: -22.006014, lng: 148.0590271}`.
 * Its `enhanced_data` is `{}`. The coordinate the report already owns sat one
 * column away from a guard that read `undefined`.
 *
 * That is the `rawPropertyType` defect again, on the coordinate: every Compass
 * is finished by the resume worker, which calls back with `{reportId,
 * propertyAddress, continueFrom}`; `enhancedData` starts empty on that run,
 * and `assessEnrichmentReuse` correctly refuses to reuse a stored enrichment
 * that cannot prove it describes this subject. So when the live enrichment
 * then fails — Google refused every geocode from 12 Sep 2026 — the run that
 * writes the document has no coordinate, and four producers go quiet at once.
 *
 * ## The rule
 *
 * **A coordinate may select property-specific planning controls only where the
 * provider placed it at the address or on the property's own street — and a
 * street point says so.** The registers answer at a point: a zone is a polygon
 * over many lots and an overlay can follow a creek through one of them, so a
 * suburb centroid is a different property altogether. `locality` is
 * acceptable to `assessGeocodeGranularity` because a suburb centroid is
 * imprecise rather than wrong for a MAP PIN. For a planning control it is
 * wrong: the control is an attribute of the parcel. This is `crimePostcode-
 * Authority`'s rule in another register — where nothing is trusted the answer
 * is withheld rather than risked, and no coarser area is substituted.
 *
 * A street point is the one judgement call, and the platform owner made it on
 * 24 Sep 2026. OpenStreetMap holds address points for a fraction of Australian
 * houses, so most answers the free providers give are the street; refusing
 * them would withhold the zone on most reports until an address register
 * (G-NAF) is loaded. So a street point reads the registers and the page says
 * where it was read — "on the property's street, not its lot" — because a zone
 * boundary running along the street can put the lot on the other side of it,
 * and the planning certificate is what settles it (`precision` travels on the
 * coordinate and on the planning answer for exactly that sentence).
 *
 * ## The fault this was extended for
 *
 * Until 24 Sep 2026 the enrichment's own coordinate was stamped `address`
 * whatever the geocoder had actually matched — so when the public Nominatim
 * refused the production egress and the chain placed `1408/5 SECOND AVE,
 * Blacktown` at the centre of the suburb, that centroid was read as a parcel
 * and the report stated "R2 — Low Density Residential" for a fourteenth-floor
 * apartment. The enrichment now records the precision it was placed at
 * (`enrichmentPoint.pure.ts`), and it is judged by the same rule as a
 * recovery. An enrichment that records none proves nothing and is not used;
 * recovery then geocodes the address and proves it.
 *
 * So both routes resolve a coordinate and then QUALIFY it. A coarse one is a
 * named refusal, never a stand-in.
 *
 * ## What the refusals have to keep apart
 *
 * Four different sentences, which the ledger must not collapse:
 *
 * | refusal | what it says | whose |
 * |---|---|---|
 * | `no_address` | the run was given nothing to geocode | ours |
 * | `no_match` | no geocoder matched this address | the address's |
 * | `too_coarse` | matched, but only to a suburb or postal area, not the property or its street | the address's |
 * | `provider_unavailable` / `provider_refused` / `budget` | this deployment could not ask | ours |
 *
 * And none of them is the fifth thing: a register that WAS asked at the parcel
 * and holds nothing there. That is a successful no-match, it is
 * `unavailable_in_coverage` on the ledger, and it is the only one of the five
 * that is a fact about the property.
 *
 * The module is pure: it never geocodes. The caller performs the lookup and
 * hands the outcome in, which is what lets every branch be tested without a
 * network.
 */

import { enrichmentPointOf } from './enrichmentPoint.pure.ts';

/** Where a usable coordinate came from. */
export type SubjectCoordinateSource = 'enrichment' | 'geocode_recovery';

/** Why no coordinate may ask the register. */
export type SubjectCoordinateRefusal =
  | 'no_address'
  | 'no_match'
  | 'too_coarse'
  | 'provider_unavailable'
  | 'provider_refused'
  | 'budget';

/**
 * The precision that places a point ON the parcel.
 *
 * Named rather than inlined so the rule is greppable and so a test can assert
 * that `locality` and `postcode` are not in it.
 */
export const PARCEL_GRADE_PRECISION = 'address' as const;

/**
 * Every precision that may ask a planning register: the parcel, or a point on
 * the property's own street — the second always said on the page. A suburb or
 * postal-area centre is never in it.
 */
export const PLANNING_POINT_PRECISIONS = ['address', 'street'] as const;
export type PlanningPointPrecision = typeof PLANNING_POINT_PRECISIONS[number];

const isPlanningPoint = (v: unknown): v is PlanningPointPrecision =>
  (PLANNING_POINT_PRECISIONS as readonly unknown[]).includes(v);

export interface SubjectCoordinate {
  lat: number;
  lng: number;
  source: SubjectCoordinateSource;
  /** `address` (the parcel) or `street` (a point on its street); a coarser match never becomes a coordinate. */
  precision: PlanningPointPrecision;
  /** The geocoder that answered, for a recovered coordinate. */
  provider: string | null;
  /** The licence line the coordinate travels under. */
  attribution: string | null;
  /** What the provider MATCHED — evidence of property matching, never an input. */
  matchedAddress: string | null;
  /** When THIS run resolved it. */
  retrievedAt: string;
}

export type SubjectCoordinateOutcome =
  | { usable: true; coordinate: SubjectCoordinate }
  | {
      usable: false;
      refusal: SubjectCoordinateRefusal;
      /** One sentence, written for the operator reading the ledger. */
      detail: string;
      /** The geocode providers this run actually asked. */
      tried: string[];
    };

/** The shape `geocodeAddress` answers with. Structural, so the module imports nothing. */
export interface GeocodeOutcomeLike {
  ok: boolean;
  result?: {
    lat?: unknown;
    lng?: unknown;
    precision?: unknown;
    provider?: unknown;
    attribution?: unknown;
    matchedAddress?: unknown;
  } | null;
  reason?: string;
  providerRefused?: boolean;
  capReason?: string;
  detail?: string;
  tried?: unknown;
}

const finite = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

const strOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

const triedOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * The coordinate this run's own enrichment produced, if it produced one AND
 * it was placed at the property or on its street.
 *
 * Proven by construction: `location-intelligence-service` was asked for THIS
 * address in THIS run, so no subject check is needed. A stored enrichment from
 * an earlier run is deliberately NOT read here — `assessEnrichmentReuse` is the
 * one place that decides whether a persisted object may be trusted to describe
 * this subject, and borrowing its coordinate around that decision would be the
 * same unproven reuse by another route.
 *
 * What the point IS is read off the enrichment's own acquisition stamp
 * (`enrichmentPointOf`). A suburb or postal-area centre, and an enrichment
 * that records no precision at all, yield nothing here — recovery then
 * geocodes the address and judges what it finds, which proves the match
 * rather than assuming it.
 */
export function enrichmentCoordinate(
  locationIntelligence: unknown,
  now: string,
): SubjectCoordinate | null {
  if (typeof locationIntelligence !== 'object' || locationIntelligence === null) return null;
  const coords = (locationIntelligence as Record<string, unknown>).coordinates;
  if (typeof coords !== 'object' || coords === null) return null;
  const lat = finite((coords as Record<string, unknown>).lat);
  const lng = finite((coords as Record<string, unknown>).lng);
  if (lat === null || lng === null) return null;
  const point = enrichmentPointOf(locationIntelligence);
  if (!isPlanningPoint(point.precision)) return null;
  const stamp = (locationIntelligence as Record<string, unknown>)['__acquisition'];
  const matched = stamp && typeof stamp === 'object' ? strOrNull((stamp as Record<string, unknown>).matchedAddress) : null;
  return {
    lat,
    lng,
    source: 'enrichment',
    precision: point.precision,
    provider: point.provider,
    attribution: null,
    matchedAddress: matched,
    retrievedAt: now,
  };
}

/**
 * Judge a recovery geocode.
 *
 * `address` alone is usable. Everything else is a refusal that names which
 * kind it is, because "we could not ask" and "the address does not resolve to
 * a parcel" send an operator to opposite remedies.
 */
export function recoveredCoordinate(
  outcome: GeocodeOutcomeLike,
  now: string,
): SubjectCoordinateOutcome {
  const tried = triedOf(outcome?.tried);
  if (outcome?.ok && outcome.result) {
    const lat = finite(outcome.result.lat);
    const lng = finite(outcome.result.lng);
    const precision = strOrNull(outcome.result.precision);
    if (lat === null || lng === null) {
      return {
        usable: false,
        refusal: 'provider_unavailable',
        detail: 'The geocoder reported a match and returned no usable coordinate',
        tried,
      };
    }
    if (!isPlanningPoint(precision)) {
      return {
        usable: false,
        refusal: 'too_coarse',
        detail:
          `The address resolved only to ${precision ?? 'an unstated precision'}, and a planning `
          + 'control is an attribute of the parcel — a suburb or postal-area centre is a different '
          + 'property altogether, so the register was not asked',
        tried,
      };
    }
    return {
      usable: true,
      coordinate: {
        lat,
        lng,
        source: 'geocode_recovery',
        precision,
        provider: strOrNull(outcome.result.provider),
        attribution: strOrNull(outcome.result.attribution),
        matchedAddress: strOrNull(outcome.result.matchedAddress),
        retrievedAt: now,
      },
    };
  }

  const detail = strOrNull(outcome?.detail);
  switch (outcome?.reason) {
    case 'no_match':
      return {
        usable: false,
        refusal: 'no_match',
        detail: detail
          ? `No geocoder matched this address: ${detail}`
          : 'No geocoder matched this address',
        tried,
      };
    case 'budget':
      return {
        usable: false,
        refusal: 'budget',
        detail:
          `This deployment's geocoding allowance refused the request`
          + (outcome.capReason ? ` (${outcome.capReason})` : '')
          + ' — a limit of ours, not an answer about the address',
        tried,
      };
    case 'refused':
      return {
        usable: false,
        refusal: 'provider_refused',
        detail: detail
          ? `The geocoding provider refused the request: ${detail}`
          : 'The geocoding provider refused the request',
        tried,
      };
    default:
      return {
        usable: false,
        refusal: 'provider_unavailable',
        detail: detail
          ? `No geocoding provider was reachable: ${detail}`
          : 'No geocoding provider was reachable',
        tried,
      };
  }
}

/** The ledger outcome a refusal is recorded under. */
export type LedgerOutcome = 'never_requested' | 'requested_failed';

/**
 * Whose fault a refusal is, in the ledger's own vocabulary.
 *
 * `no_address`, `no_match` and `too_coarse` are statements about what we were
 * given — no request to the register was made, so the register is not at
 * fault and neither are we. The three provider refusals are ours to repair.
 */
export function ledgerOutcomeFor(refusal: SubjectCoordinateRefusal): LedgerOutcome {
  return refusal === 'provider_unavailable'
    || refusal === 'provider_refused'
    || refusal === 'budget'
    ? 'requested_failed'
    : 'never_requested';
}

/**
 * The provenance line a resolved coordinate carries into the record.
 *
 * `null` for an enrichment coordinate at the parcel, which has its own
 * acquisition stamp; a street point says so whichever route found it, and a
 * recovered one has to say who answered, what they matched and when, because
 * nothing else in the record will.
 */
export function coordinateProvenance(coordinate: SubjectCoordinate): string | null {
  if (coordinate.source !== 'geocode_recovery') {
    if (coordinate.precision !== 'street') return null;
    return 'The location enrichment placed this address on its street, not at the property itself'
      + (coordinate.provider ? `; provider ${coordinate.provider}` : '')
      + ' — a register asked there reads the street, and a boundary along it can put the lot on the other side';
  }
  const parts = [`Coordinate recovered by geocoding the report's own address`];
  if (coordinate.provider) parts.push(`provider ${coordinate.provider}`);
  if (coordinate.matchedAddress) parts.push(`matched "${coordinate.matchedAddress}"`);
  parts.push(`at ${coordinate.precision} precision`);
  parts.push(`retrieved ${coordinate.retrievedAt}`);
  if (coordinate.attribution) parts.push(coordinate.attribution);
  return parts.join('; ');
}
