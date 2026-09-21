/**
 * Reading the ABS's Significant Urban Areas into a register of centres.
 *
 * Pure: this module parses and refuses. The fetching, the writing and the
 * scheduling are `urban-centre-register-ingest`'s.
 *
 * ## What it reads
 *
 * The same service, release and layer `resolveOneReportGeography.ts` has
 * queried in production since ME-5 —
 * `geo.abs.gov.au/arcgis/rest/services/ASGS2021/SUA/MapServer/0/query` —
 * asked for every feature rather than one point, with the polygon's centre
 * rather than its outline.
 *
 * ## Every rule the two register loaders already learned
 *
 * `load-sanctions-lists.mjs` and `load-pep-officeholders.mjs` between them pay
 * for all of these, and each is here because it cost something:
 *
 * **Refuse a zero-entry parse.** A service that answers 200 with nothing is a
 * failure, not an empty Australia.
 *
 * **Treat a SHRINK as a truncated download.** The ABS publishes about a
 * hundred SUAs and that number does not halve; a load that returns far fewer
 * than the one before it read a cut-off response, and the endpoint that lies
 * by truncating at its own limit is exactly what `pepOfficeholderIndex` found.
 *
 * **An error body under HTTP 200 is a failure.** ArcGIS reports failures that
 * way and `queryLayer` already says so.
 *
 * **A coordinate is checked against the continent.** `assessAuPoint`'s rule in
 * miniature: a centre outside Australia's bounding box is a parse error, not a
 * centre, and `components=country:AU` restricting the ANSWER rather than the
 * SEARCH is how a cluster of properties ended up in the desert.
 *
 * **Nothing is invented.** A feature with no usable centre is DROPPED and
 * counted, never placed at a guess — the register names what it holds, and a
 * property whose centre is missing keeps today's behaviour rather than getting
 * a made-up one.
 */

/** Australia's bounding box, the same one `assessAuPoint` judges against. */
export const AU_BOUNDS = { minLat: -44.0, maxLat: -9.0, minLng: 112.0, maxLng: 154.0 } as const;

/** A load returning fewer than this many centres read a truncated response. */
export const MIN_PLAUSIBLE_CENTRES = 60;

/** …and one that has shrunk by more than this against the last good load. */
export const MAX_PLAUSIBLE_SHRINK = 0.2;

export interface ParsedCentre {
  readonly code: string;
  readonly name: string;
  readonly state: string;
  readonly lat: number;
  readonly lng: number;
}

export interface CentreParse {
  readonly centres: readonly ParsedCentre[];
  /** Features the response carried that could not become a centre, by reason. */
  readonly dropped: Readonly<Record<string, number>>;
}

/**
 * The state an SUA code names.
 *
 * ASGS codes open with the state's own digit, which is the ABS's structure and
 * not an inference: 1 NSW, 2 VIC, 3 QLD, 4 SA, 5 WA, 6 TAS, 7 NT, 8 ACT. A
 * code opening with anything else — 9 is the ABS's "outside Australia" and 0
 * its "no usual address" — is not a state and answers null rather than a
 * guess.
 */
export const ASGS_STATE_DIGIT: Readonly<Record<string, string>> = {
  '1': 'NSW', '2': 'VIC', '3': 'QLD', '4': 'SA', '5': 'WA', '6': 'TAS', '7': 'NT', '8': 'ACT',
};

export function stateOfSuaCode(code: string): string | null {
  return ASGS_STATE_DIGIT[String(code ?? '').trim().charAt(0)] ?? null;
}

/**
 * Is this row the ABS's "everywhere else" bucket rather than an urban centre?
 *
 * Measured against the live layer on 20 Sep 2026: the SUA layer's FIRST
 * feature is `1000` / `"Not in any Significant Urban Area (NSW)"`. The
 * classification is exhaustive — it partitions the whole country — so one
 * pseudo-area per state carries every square kilometre that is not in a
 * significant urban centre, and the layer publishes those beside the real
 * ones. Of 112 features, eight or nine are this.
 *
 * Writing them would be the worst failure available to this register, because
 * nothing downstream would look wrong. `resolveOneReportGeography` records the
 * SUA a coordinate falls in, so a genuinely rural property resolves to exactly
 * this pseudo-area; `findUrbanCentre` would match it, `resolveCommuteDestination`
 * would report `ownCentre: 'yes'`, and `scoreLocation` would then SCORE a
 * commute measured to the centre of "everywhere in New South Wales that is not
 * a town" — a point that stands for no place, presented as the property's own
 * city. The capital, which is what that property gets today, is wrong in a way
 * a reader can see; this would be wrong in a way nobody could.
 *
 * Two independent tests, because either alone is a single point of failure: a
 * code whose last three digits are zero is the state's bucket by the ABS's own
 * numbering, and the published name says what it is. A row is refused if
 * EITHER says so.
 */
export function isNotAnUrbanCentre(code: string, name: string): boolean {
  if (/^\d000$/.test(String(code ?? '').trim())) return true;
  return /^\s*not\s+in\s+any\b/i.test(String(name ?? ''));
}

/**
 * A coordinate, or null.
 *
 * The empty check is not decoration. `Number('')` is **0**, which is finite —
 * so a feature carrying no point read as `0, 0`, and only the continent bounds
 * below stopped it being written as a centre in the Atlantic. A parser must
 * not depend on a later rule to catch its own coercion.
 */
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/**
 * A point for an urban area, from the ABS's own boundary.
 *
 * Measured against the live layer on 20 Sep 2026 and this is the whole reason
 * the register is built this way: the SUA layer **ignores `returnCentroid`**
 * (features come back carrying `attributes` and nothing else), its
 * `advancedQueryCapabilities` does not advertise
 * `supportsReturningGeometryCentroid`, and its published fields are
 * `objectid, shape, sua_code_2021, sua_name_2021, aus_code_2021,
 * aus_name_2021, area_albers_sqkm, asgs_loci_uri_2021` — **no latitude, no
 * longitude, no point of any kind**. The service will not do this arithmetic,
 * and no attribute carries the answer, so the only honest options were to
 * derive a point from the boundary or to abandon the register.
 *
 * It is therefore OUR arithmetic over the ABS's own geometry, and the stored
 * `point_basis` says exactly that rather than borrowing the word "centroid"
 * from a service that declined to supply one.
 *
 * The largest ring, by absolute shoelace area, so an urban area published with
 * an island or an excluded enclave is represented by its main body rather than
 * by the average of its parts. The shoelace centroid of that ring is the
 * standard area-weighted centre; a degenerate ring (zero area — a slither, or
 * a duplicated vertex list) falls back to the mean of its vertices, because a
 * division by zero here would produce `NaN` and `NaN` passes no bound.
 */
export function pointFromRings(geometry: unknown): { lat: number; lng: number } | null {
  const rings = (geometry as { rings?: unknown } | null)?.rings;
  if (!Array.isArray(rings) || rings.length === 0) return null;

  let best: Array<[number, number]> | null = null;
  let bestArea = -1;
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 3) continue;
    const pts: Array<[number, number]> = [];
    for (const pt of ring) {
      if (!Array.isArray(pt) || pt.length < 2) continue;
      const x = num(pt[0]);
      const y = num(pt[1]);
      if (x === null || y === null) continue;
      pts.push([x, y]);
    }
    if (pts.length < 3) continue;
    let twice = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      twice += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    }
    const area = Math.abs(twice / 2);
    if (area > bestArea) { bestArea = area; best = pts; }
  }
  if (!best) return null;

  let twice = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const cross = best[j][0] * best[i][1] - best[j][1] * best[i][0];
    twice += cross;
    cx += (best[j][0] + best[i][0]) * cross;
    cy += (best[j][1] + best[i][1]) * cross;
  }
  const signed = twice / 2;
  if (!Number.isFinite(signed) || signed === 0) {
    // Degenerate ring: the mean of its vertices, which is always defined.
    const mx = best.reduce((a, pt) => a + pt[0], 0) / best.length;
    const my = best.reduce((a, pt) => a + pt[1], 0) / best.length;
    return Number.isFinite(mx) && Number.isFinite(my) ? { lat: my, lng: mx } : null;
  }
  const lng = cx / (6 * signed);
  const lat = cy / (6 * signed);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** Inside the continent, by the same bounds every other reading is judged on. */
export function isAustralianPoint(lat: number, lng: number): boolean {
  return lat >= AU_BOUNDS.minLat && lat <= AU_BOUNDS.maxLat
    && lng >= AU_BOUNDS.minLng && lng <= AU_BOUNDS.maxLng;
}

/**
 * Parse an ArcGIS feature collection into centres.
 *
 * Accepts the centroid wherever the service supplies one and falls back to the
 * centre of the feature's own extent, because both are the service's own
 * arithmetic over its own polygon and neither is this module's guess. Which
 * was used is not recorded per row: both are `sua_centroid`, and the
 * distinction a reader needs is capital-CBD versus polygon-centre.
 */
export function parseSuaFeatures(body: unknown): CentreParse {
  const dropped: Record<string, number> = {};
  const drop = (why: string) => { dropped[why] = (dropped[why] ?? 0) + 1; };
  const root = body as {
    error?: unknown;
    exceededTransferLimit?: unknown;
    features?: Array<{
      attributes?: Record<string, unknown>;
      centroid?: { x?: unknown; y?: unknown };
      geometry?: { x?: unknown; y?: unknown };
    }>;
  } | null;
  // ArcGIS reports failure as 200 plus an error body. That is transport.
  if (!root || root.error) throw new Error('the ABS geoserver returned an error body — refused');
  // And it reports a TRUNCATED answer the same way it reports a whole one: 200,
  // a well-formed feature list, and one extra flag. That matters more here than
  // anywhere else in this platform, because the load PRUNES every code it did
  // not carry — so a silently short page would not merely under-fill the
  // register, it would DELETE the centres that fell off the end of it. The
  // sanctions and office-holder loaders each pay for this lesson in their own
  // words; this is the same rule at the one place where the cost is removal.
  if (root.exceededTransferLimit === true) {
    throw new Error('the ABS geoserver truncated the answer (exceededTransferLimit) — refused');
  }
  const features = Array.isArray(root.features) ? root.features : null;
  if (!features) throw new Error('the ABS geoserver answered no feature list — refused');

  const centres: ParsedCentre[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const code = String(f?.attributes?.sua_code_2021 ?? '').trim();
    const name = String(f?.attributes?.sua_name_2021 ?? '').trim();
    if (!code || !name) { drop('no_code_or_name'); continue; }
    if (isNotAnUrbanCentre(code, name)) { drop('not_an_urban_centre'); continue; }
    const state = stateOfSuaCode(code);
    if (!state) { drop('no_state_in_code'); continue; }
    // Three shapes, in order of how directly the publisher stated the point:
    // a centroid it supplied, a point geometry, or the boundary we reduce
    // ourselves. This layer only ever gives the third, but the first two cost
    // nothing to accept and another ASGS layer may supply them.
    const supplied = f.centroid ?? (f.geometry as { x?: unknown; y?: unknown } | null) ?? null;
    let lng = num(supplied?.x);
    let lat = num(supplied?.y);
    if (lat === null || lng === null) {
      const derived = pointFromRings(f.geometry);
      if (derived) { lat = derived.lat; lng = derived.lng; }
    }
    if (lat === null || lng === null) { drop('no_point'); continue; }
    if (!isAustralianPoint(lat, lng)) { drop('point_outside_australia'); continue; }
    if (seen.has(code)) { drop('duplicate_code'); continue; }
    seen.add(code);
    centres.push({ code, name, state, lat, lng });
  }
  return { centres, dropped };
}

export interface PlausibilityVerdict {
  readonly ok: boolean;
  readonly reason: string | null;
}

/**
 * Is this load worth writing?
 *
 * `previousCount` is the last SUCCEEDED load's count, or null where there has
 * never been one — a first load has nothing to shrink against and is judged on
 * the floor alone.
 */
export function assessLoad(count: number, previousCount: number | null): PlausibilityVerdict {
  if (count === 0) {
    return { ok: false, reason: 'the load parsed no centres at all — that is a failure, not an empty Australia' };
  }
  if (count < MIN_PLAUSIBLE_CENTRES) {
    return {
      ok: false,
      reason: `the load parsed ${count} centres, fewer than the ${MIN_PLAUSIBLE_CENTRES} floor — `
        + 'a truncated response reads exactly like a short one',
    };
  }
  if (previousCount !== null && previousCount > 0 && count < previousCount * (1 - MAX_PLAUSIBLE_SHRINK)) {
    return {
      ok: false,
      reason: `the load parsed ${count} centres against ${previousCount} last time, a shrink past `
        + `${Math.round(MAX_PLAUSIBLE_SHRINK * 100)}% — read as a truncated download rather than a revision`,
    };
  }
  return { ok: true, reason: null };
}
