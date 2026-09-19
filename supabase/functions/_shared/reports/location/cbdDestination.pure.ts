/**
 * ME-5 items 14–15 — where a "CBD commute" is measured to.
 *
 * This existed as a lookup inside `location-intelligence-service` whose last
 * line was `|| cbdLocations['NSW']`. A request that carried no state therefore
 * measured a transit journey to SYDNEY and stored it as the property's CBD
 * commute.
 *
 * Measured over the 1,114 stored objects: of 519 non-NSW reports that also
 * carry the Sydney transport template, **494 hold a commute consistent with a
 * journey to Sydney and NONE with one to their own capital**, while no other
 * template label ever points at Sydney — one absent input, two symptoms.
 * Bentley WA, 8 km from Perth, stored 3,283.6 km and 82.1 hours; straight-line
 * Bentley→Sydney is 3,284 km.
 *
 * It is not merely a wrong number. The Location score bands the commute in
 * MINUTES, so all 494 land in "Limited CBD access (>60 min)" for 3 points of
 * 30 — and 74 of them are within 10 km of their own CBD, the closest 0.4 km.
 *
 * **An unknown destination yields no commute rather than somebody else's.**
 * That is the whole rule, and returning null is what enforces it.
 *
 * A second question this deliberately does NOT answer: whether the state
 * capital is the right destination for a given property at all. For a
 * Moranbah or a Gympie it plainly is not, and choosing an appropriate centre
 * is its own piece of work. This module only stops the destination being
 * guessed.
 */

export interface CbdDestination {
  lat: number;
  lng: number;
  /** The city, so a stored commute can say what it was measured to. */
  capital: string;
  state: string;
}

/** The eight capitals, and nothing else. There is no default. */
export const STATE_CAPITALS: Readonly<Record<string, CbdDestination>> = {
  NSW: { lat: -33.8688, lng: 151.2093, capital: 'Sydney', state: 'NSW' },
  VIC: { lat: -37.8136, lng: 144.9631, capital: 'Melbourne', state: 'VIC' },
  QLD: { lat: -27.4698, lng: 153.0251, capital: 'Brisbane', state: 'QLD' },
  WA: { lat: -31.9505, lng: 115.8605, capital: 'Perth', state: 'WA' },
  SA: { lat: -34.9285, lng: 138.6007, capital: 'Adelaide', state: 'SA' },
  TAS: { lat: -42.8821, lng: 147.3272, capital: 'Hobart', state: 'TAS' },
  NT: { lat: -12.4634, lng: 130.8456, capital: 'Darwin', state: 'NT' },
  ACT: { lat: -35.2809, lng: 149.1300, capital: 'Canberra', state: 'ACT' },
};

/**
 * The capital for a state, or null when the state is absent or unrecognised.
 *
 * Never falls back. A commute measured to a destination nobody asked for is
 * indistinguishable, downstream, from one that was measured correctly.
 */
export function resolveCbdDestination(state: string | null | undefined): CbdDestination | null {
  if (typeof state !== 'string') return null;
  const key = state.trim().toUpperCase();
  if (!key) return null;
  return STATE_CAPITALS[key] ?? null;
}

/** Why no commute was measured, in a form a reader can render. */
export interface CommuteNotMeasured {
  measured: false;
  reason: 'destination_unknown' | 'no_route_returned' | 'daily_cap_reached';
  detail: string;
}

export const COMMUTE_DESTINATION_UNKNOWN: CommuteNotMeasured = {
  measured: false,
  reason: 'destination_unknown',
  detail: 'No state was supplied with this request, so the CBD a commute would be measured '
    + 'to is unknown. Nothing is assumed.',
};

/**
 * The lookup was not made, because the day's paid allowance was spent.
 *
 * Distinct from `no_route_returned` on purpose. "No route" is a MEASUREMENT —
 * we asked and transit does not connect these two points — and a reader is
 * entitled to treat it as a fact about the location. This is the opposite:
 * nobody asked. Collapsing the two would turn a spending ceiling into a
 * finding about somebody's property, which is exactly the fabrication the
 * ceiling exists to avoid.
 */
export const COMMUTE_CAP_REACHED: CommuteNotMeasured = {
  measured: false,
  reason: 'daily_cap_reached',
  detail: 'The daily allowance for transit routing lookups was already spent when this '
    + 'report was produced, so no commute time was measured. This is a limit this '
    + 'deployment sets on its own spending, not a finding about the location.',
};

export const COMMUTE_NO_ROUTE: CommuteNotMeasured = {
  measured: false,
  reason: 'no_route_returned',
  detail: 'The transit routing call did not return a route between the property and the CBD, '
    + 'so no commute time was measured. This is a limit of the lookup, not a finding about '
    + 'the location.',
};
