/**
 * What a report may state about amenities and public transport.
 *
 * ## The finding
 *
 * Page 21 of the Investment Compass delivered for 9 Hollow Street, Golden
 * Square on 21 Sep 2026 cites **Landchecker** and **Ray White Bendigo and
 * Domain** as its evidence for the property's access and surrounds. Neither
 * is a register this platform asks. The reason is not that the transport and
 * amenity readings were missing — they were measured, stored, and stamped with
 * their own provenance — but that the two prompt blocks in front of them read
 * almost none of it, and named no publisher at all. A model handed counts with
 * no source, and asked to evidence them, supplied a source.
 *
 * Measured against the record `location-intelligence-service` actually writes:
 *
 * | prompt block read | published as | what fired |
 * | --- | --- | --- |
 * | `transport.stationDistance` | `transport.distanceToStation` | never |
 * | `transport.transportTypes` | *nothing publishes it* | never |
 * | `transport.commuteToCbd` | `commute.durationMinutes` (+ destination) | never |
 * | `lifestyle.supermarkets` | *no supermarket category is measured* | never |
 * | `lifestyle.nearestSupermarket` | *the same* | never |
 * | `lifestyle.nearestShoppingCenter` | `lifestyle.nearestShopping` | rendered `—` |
 *
 * `commuteToCbd` had exactly one occurrence in the repository: the line that
 * reads it. So the commute — measured, with a named destination and the
 * `ownCentre` flag that §20 of `A_PREMIUM_DOCUMENT.md` exists for — never
 * reached the prose on any report.
 *
 * ## The one that is worse than a silent field
 *
 * `projectTransportForLocationIntelligence` returns `nearestStation: 'N/A'`
 * where no stop was found, and the block guarded on `if (t.nearestStation)`.
 * **`'N/A'` is truthy.** So a property outside every loaded GTFS network — every
 * Victorian, Western Australian, South Australian, Tasmanian and ACT property,
 * which is the case this deployment hits most — did not merely lose the
 * reading. It printed `Nearest public transport stop on record: **N/A**`, and
 * because `parts.length` was then 1, the block's own fallback SUPPRESSED the
 * prohibition that says "do NOT name a station, state a distance or a commute
 * time, and do NOT call the area well served or car-dependent".
 *
 * The prohibition was skipped in exactly the case it was written for. That is
 * `placesAvailability.pure.ts`'s own lesson — *"`'N/A'` is TRUTHY, so it
 * survived every `||` fallback in the prompt and arrived as a value"* — paid a
 * second time, in a module that fixed the sibling branch and left this one.
 *
 * ## The rules
 *
 * 1. **A count names the register that produced it.** `stages.amenitySources`
 *    records `register` or `google` per category and has since the amenity
 *    register shipped; a figure whose publisher is not stated is one a model
 *    will attribute.
 * 2. **A publisher common to every row is stated once**, below the table, not
 *    as a column repeating one value — `A_PREMIUM_DOCUMENT.md`'s rule that a
 *    column whose every cell is identical is a footnote.
 * 3. **No stop found is a fact about the FEEDS** — `transportReading.pure.ts`'s
 *    own rule, carried into the prose rather than left in the data. The verdict
 *    is stated in the register's terms and the loaded networks are named.
 * 4. **A commute names where it was measured to**, and says so plainly when
 *    that is not this property's own centre. Golden Square's 114 minutes is to
 *    Melbourne; its own centre is Bendigo, twelve minutes away. A commute whose
 *    destination is not named is a number no reader can check.
 * 5. **Absent is never zero, and never `N/A`.** A category with no numeric
 *    count is omitted and named as unmeasured; the literal `'N/A'` is read as
 *    absence wherever it appears.
 * 6. Both blocks carry `webSearchIsNotARetrieval`, which is what the five
 *    register blocks already carry and these two never had.
 * 7. **A reading measured from an area's centre says so, first.** On 24 Sep
 *    2026 the geocoder could place two properties no finer than their
 *    suburbs, and every count and distance here was the suburb centre's,
 *    presented as the property's. `areaCentreDisclosure` leads both blocks
 *    whenever the stamp records a `locality` or `postcode` point.
 *
 * Nothing here measures anything or changes a stored value. It decides only
 * what the prompt is entitled to put in front of the model.
 */

import { webSearchIsNotARetrieval } from '../registerAuthority.pure.ts';
import { areaCentreDisclosure, enrichmentPointOf } from './enrichmentPoint.pure.ts';
import type { TransportVerdict } from '../../transportReading.pure.ts';
import { formatIsoDate } from '../reportDate.pure.ts';
import { elsewhereOnly, inHomeSection } from '../adviserVoice.pure.ts';
import { unratedRiskRow } from '../investment/riskRegister.pure.ts';

export const AMENITY_WEB_SEARCH_RULE = webSearchIsNotARetrieval(
  'amenity',
  'the amenity table above',
);
export const TRANSPORT_WEB_SEARCH_RULE = webSearchIsNotARetrieval(
  'public-transport',
  'the stop data above',
);

/**
 * What may be said about a bus route or a timetable this report did not read.
 *
 * The Compass for 60 Lawley Street, Spalding (25 Sep 2026) described route 852
 * as running "five daily services, two weekday school-bus runs and three
 * Saturday-morning services", from the City's locality profile. The
 * operator's own current timetable (the PTA's GTFS, valid 22 Sep to 21 Dec
 * 2026) runs it roughly hourly on weekdays. A profile is not a timetable, and
 * this report reads neither, so the permitted form is the one a reader can
 * act on: who publishes the timetable, and that it should be checked.
 */
export const TRANSPORT_TIMETABLE_RULE = 'A bus route, a stop or a timetable a live search finds is not a '
  + 'source for this report either. You may say that the operator publishes routes or a timetable for the area and name '
  + 'the operator, attributing it as the operator\'s published information. Do NOT state a frequency, a '
  + 'number of services, a first or last service time or a walking time from any of it, and never take '
  + 'service information from a council, community or locality profile — a profile is not a timetable and '
  + 'goes out of date. Write instead that the current service pattern should be checked on the operator\'s '
  + 'own timetable.';

/** A reader's name for where a station count came from, and the radius that source searched. */
const STATION_COUNT_SOURCE: Readonly<Record<string, { label: string; radiusKm: number; counts: string }>> = {
  osm_amenity_register: {
    label: 'OpenStreetMap',
    radiusKm: 2,
    counts: 'rail stations, halts, tram stops and transport interchanges — bus stops are not in it',
  },
  google_places: {
    label: 'Google Places',
    radiusKm: 5,
    counts: 'places Google types as transit stations, which does not reliably include bus stops',
  },
};

/** What a provider key means in a reader's words. */
export const AMENITY_PROVIDER_LABEL: Readonly<Record<string, string>> = {
  register: 'OpenStreetMap',
  google: 'Google Places',
};

/**
 * The literal a failed or empty lookup used to store. Read as absence
 * everywhere, because it is truthy and a truthy absence defeats every guard.
 */
export const ABSENT_LITERALS: readonly string[] = ['N/A', 'n/a', 'NA', '—', '-', 'unknown'];

const rec = (v: unknown): Record<string, unknown> | null =>
  (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : null;

/** A string, or null — with the `N/A` family read as absent. */
export function text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return ABSENT_LITERALS.some((a) => a.toLowerCase() === s.toLowerCase()) ? null : s;
}

const num = (v: unknown): number | null =>
  (typeof v === 'number' && Number.isFinite(v)) ? v : null;

/**
 * `2026-09-18T…` → `18 Sep 2026`, or null.
 *
 * Delegates. The first draft of this carried its own month table and its own
 * ISO regex, and `oneDateFormatter.spec.ts` failed it on both — correctly:
 * a second date formatter is the defect `AU_LOCALE` and `auDate.pure.ts` were
 * each written to close, committed here a third time. `formatIsoDate` already
 * answers null for a month index out of range, which is the whole guard this
 * needed.
 */
export function stampDate(v: unknown): string | null {
  const s = text(v);
  return s ? formatIsoDate(s, 'short') : null;
}

const list = (parts: (string | null)[]): string[] =>
  parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '');

/** Read `__acquisition.stages` off a stored enrichment, or an empty record. */
export function stagesOf(li: unknown): Record<string, unknown> {
  const stamp = rec(rec(li)?.['__acquisition']);
  return rec(stamp?.['stages']) ?? {};
}

/**
 * Rule 2 — one sentence naming who answered, grouped by provider.
 *
 * With one provider across every drawn row this is a single clause. With two
 * it names each and the categories it answered, because then the distinction
 * carries information.
 */
export function provenanceSentence(
  sources: Record<string, unknown>,
  drawn: readonly string[],
  loadedAt: Record<string, unknown>,
): string | null {
  const byProvider = new Map<string, string[]>();
  for (const cat of drawn) {
    const p = text(sources[cat]);
    if (!p || p === 'unmeasured') continue;
    const label = AMENITY_PROVIDER_LABEL[p];
    if (!label) continue;
    const bucket = byProvider.get(label) ?? [];
    bucket.push(cat);
    byProvider.set(label, bucket);
  }
  if (byProvider.size === 0) return null;

  /*
   * The register's own currency, where the register answered. One date: the
   * OLDEST slice drawn, because that is the claim the whole table can carry.
   *
   * Sorted as ISO, then formatted. The first version formatted first and
   * sorted the results, and `'1 Oct 2026' < '18 Sep 2026'` lexically — so with
   * slices loaded on different days it reported the NEWEST as the oldest,
   * which is the one direction that overstates the reading's currency. The
   * code contradicted the comment directly above it, and the spec's fixture
   * carried a single date, so nothing could see it.
   */
  const registerDates = drawn
    .map((c) => text(loadedAt[c]))
    .filter((d): d is string => d !== null)
    .sort();
  const oldest = registerDates.length ? stampDate(registerDates[0]) : null;
  const currency = oldest
    ? ` Current at ${oldest}.`
    : '';

  if (byProvider.size === 1) {
    const [label] = [...byProvider.keys()];
    return `Source: ${label}.${currency}`;
  }
  const clauses = [...byProvider.entries()]
    .map(([label, cats]) => `${label} for ${cats.join(', ')}`);
  return `Sources: ${clauses.join('; ')}.${currency}`;
}

export interface AmenityRow {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly nearest: string | null;
}

/**
 * The four published amenity categories, in the order a reader meets them.
 *
 * `supermarkets` is deliberately absent: `PLACES_CATEGORIES` holds six —
 * transit, schools, healthcare, shopping, recreation, restaurants — and no
 * supermarket lookup is taken anywhere. The old block asked for one, which is
 * a labelled row promising a figure the platform cannot produce.
 */
export const AMENITY_FIELDS: ReadonlyArray<{
  key: string; label: string; countPath: [string, string]; nearestPath: [string, string] | null;
}> = [
  { key: 'healthcare', label: 'Healthcare facilities', countPath: ['healthcare', 'facilitiesWithin5km'], nearestPath: ['healthcare', 'nearestHospital'] },
  { key: 'shopping', label: 'Shopping centres', countPath: ['lifestyle', 'shoppingCenters'], nearestPath: ['lifestyle', 'nearestShopping'] },
  { key: 'recreation', label: 'Parks and recreation', countPath: ['lifestyle', 'parks'], nearestPath: ['lifestyle', 'nearestPark'] },
  { key: 'restaurants', label: 'Restaurants and cafés', countPath: ['lifestyle', 'restaurants'], nearestPath: null },
];

/** The rows a stored enrichment can actually fill. */
export function amenityRows(li: unknown): AmenityRow[] {
  const o = rec(li) ?? {};
  const rows: AmenityRow[] = [];
  for (const f of AMENITY_FIELDS) {
    const block = rec(o[f.countPath[0]]);
    const count = num(block?.[f.countPath[1]]);
    // `absent is never zero` — a failed category stores null, a reached and
    // empty one stores 0, and only a number is a measurement.
    if (count === null) continue;
    const nearest = f.nearestPath
      ? text(rec(o[f.nearestPath[0]])?.[f.nearestPath[1]])
      : null;
    rows.push({ key: f.key, label: f.label, count, nearest });
  }
  return rows;
}

/** The block. Absent everywhere means one honest paragraph and a prohibition. */
export function amenityFactBlocks(li: unknown): string {
  const rows = amenityRows(li);
  const stages = stagesOf(li);
  const sources = rec(stages['amenitySources']) ?? {};
  const loadedAt = rec(stages['amenityRegisterLoadedAt']) ?? {};

  if (rows.length === 0) {
    return list([
      'Nearby amenities were not assessed for this report. '
      + `${inHomeSection('amenity')} say so once and suggest the client checks the schools, shops and health `
      + `services that matter to them. ${elsewhereOnly('amenity')} In every section: do NOT state a count, a `
      + 'distance or a named facility, and do NOT describe the area as well or poorly served.',
      AMENITY_WEB_SEARCH_RULE,
    ]).join(' ');
  }

  const table = [
    '| Category | Count within 5 km | Nearest |',
    '|---|---|---|',
    ...rows.map((r) => `| ${r.label} | ${r.count} | ${r.nearest ?? 'not named'} |`),
  ].join('\n');

  const unmeasured = AMENITY_FIELDS
    .filter((f) => !rows.some((r) => r.key === f.key))
    .map((f) => f.label.toLowerCase());

  return list([
    areaCentreDisclosure(enrichmentPointOf(li).precision),
    table,
    provenanceSentence(sources, rows.map((r) => r.key), loadedAt),
    'A count of zero here is a measurement and may be reported as one — a rural address with no '
    + 'hospital within five kilometres is a fact worth printing.',
    unmeasured.length
      ? `Not assessed for this property: ${unmeasured.join(', ')}. A category absent from the table must `
        + 'not be described either way — not as absent, not as adequate.'
      : null,
    'Name the publisher wherever you use one of these counts. Do not convert them into a walkability '
    + 'score, a rating, a ranking or an "excellent / limited" reading: the count is the measurement.',
    AMENITY_WEB_SEARCH_RULE,
  ]).join('\n\n');
}

/**
 * How the stop register's verdict reads to a reader, in its own terms.
 *
 * Typed `Record<TransportVerdict, string>` rather than `Record<string, …>` so
 * that it is TOTAL: a fourth verdict added to the register fails the build
 * here rather than silently drawing no sentence. The first draft of this map
 * carried a `sourceUnavailable` key — a value the service answers but the
 * projection never produces — and had no sentence for `stops_nearby`, which
 * is the ordinary case. An entry that can never fire and a case that has none
 * are the same mistake read from two ends.
 */
export const TRANSPORT_VERDICT_SENTENCE: Readonly<Record<TransportVerdict, string>> = {
  stops_nearby:
    'Public transport stops were found within the search radius, from the operator\'s published stop '
    + 'data for this area. The count and the named stop describe what is here — they are not a '
    + 'measure of service: routes, timetables and frequency were not assessed.',
  none_within_radius:
    'The property is within the area the operator\'s published stop data covers, and no stop was '
    + 'found within the search radius. That is a finding about this address and may be reported as one.',
  outside_loaded_networks:
    'Public transport stops near the property were not assessed: the published stop data used for '
    + 'this report does not cover this area. That is not a finding that there is no public transport '
    + 'here, and the area must not be called poorly served, car-dependent or isolated on this basis.',
};

/**
 * The transport block, composed from the fields the record actually publishes.
 *
 * Rule 4 lives here: the commute is read from `commute`, which is where it is
 * stored, and it is never presented without the destination it was measured to.
 */
export function transportFactBlocks(li: unknown): string {
  const o = rec(li) ?? {};
  const t = rec(o['transport']) ?? {};
  const parts: (string | null)[] = [];

  const verdict = text(t['verdict']);
  const nearest = text(t['nearestStation']);
  const nearestKm = num(t['distanceToStation']);
  const within = num(t['stopsWithinRadius']) ?? num(t['stopsWithin1km']);
  const radius = num(t['radiusMetres']);
  const feeds = Array.isArray(t['feeds'])
    ? (t['feeds'] as unknown[]).map((f) => text(f)).filter((f): f is string => f !== null)
    : [];
  const sources = Array.isArray(t['sources'])
    ? (t['sources'] as unknown[]).map((s) => text(s)).filter((s): s is string => s !== null)
    : [];
  const loaded = stampDate(t['feedLoadedAt']);

  if (nearest !== null) {
    parts.push(
      `Nearest stop: **${nearest}**`
      + (nearestKm !== null ? `, ${nearestKm} km straight-line` : '')
      + '.',
    );
  }
  if (within !== null && radius !== null) {
    parts.push(`Stops within ${Math.round(radius / 100) / 10} km: **${within}**.`);
  }
  const verdictSentence = verdict
    ? TRANSPORT_VERDICT_SENTENCE[verdict as TransportVerdict]
    : undefined;
  if (verdictSentence) parts.push(verdictSentence);
  if (verdict === 'outside_loaded_networks') {
    parts.push(unratedRiskRow('transport reliance', 'Not checked',
      'the published stop data used for this report does not cover this area.'));
  }

  /*
   * No operator feed covers the property, and the enrichment fell back to a
   * station COUNT (`stationsWithin2km`, whatever radius its source searched).
   * This block never read that field, so it told the model "no public-transport
   * reading was retrieved" while the Location score used a count of zero — and
   * the model went to a live search, found a bus route, and the report then
   * said both that there was a bus stop on the street and that there was "no
   * public transport within the searched radius". The count is stated here as
   * what it is, with what it cannot see.
   */
  const stationCount = verdict ? null : num(t['stationsWithin2km']);
  const stationSource = STATION_COUNT_SOURCE[text(t['source']) ?? ''];
  if (stationCount !== null) {
    parts.push(
      `Transit stations within ${stationSource ? `${stationSource.radiusKm} km` : 'the search radius'}`
      + `${stationSource ? ` (${stationSource.label})` : ''}: **${stationCount}**. `
      + `This counts ${stationSource ? stationSource.counts : 'stations only, not bus stops'}, and it says nothing `
      + 'about how often any service runs.',
      'Bus stops, routes and timetables were not assessed for this property. A count of stations is not a '
      + 'finding that the area has no public transport; the operator\'s published timetable shows the '
      + `services that run near the property. ${inHomeSection('transport')} say this once, in those words or `
      + `your own. ${elsewhereOnly('transport')}`,
      unratedRiskRow('transport reliance', 'Unverified',
        'a station count does not include bus stops, so it cannot say how the property is served.'),
    );
  }

  const commute = commuteSentence(o['commute'], stagesOf(li));
  if (commute) parts.push(commute);

  if (parts.length === 0) {
    return list([
      'Public transport near this property was not assessed for this report. '
      + `${inHomeSection('transport')} say so once and name where the client can check services (the `
      + `operator\'s published timetable). ${elsewhereOnly('transport')} In every section: do NOT name a `
      + 'station, state a distance or a commute time, and do NOT call the area well served or car-dependent. '
      + 'Car dependence is a finding that needs a measurement like any other.',
      unratedRiskRow('transport reliance', 'Not checked', 'no public transport reading is held for this property.'),
      TRANSPORT_WEB_SEARCH_RULE,
      TRANSPORT_TIMETABLE_RULE,
    ]).join(' ');
  }

  const provenance = sources.length || feeds.length
    ? `Source: ${(sources.length ? sources : feeds).join(', ')} — the operator\'s published stop data (GTFS)`
      + (loaded ? `, current at ${loaded}.` : '.')
    : null;

  return list([
    areaCentreDisclosure(enrichmentPointOf(li).precision),
    ...parts,
    provenance,
    'Routes, modes and service frequency are not assessed: stop data carries none of them, so no line, '
    + 'route, timetable or "trains every N minutes" may be stated. Nothing above is a score.',
    TRANSPORT_WEB_SEARCH_RULE,
    TRANSPORT_TIMETABLE_RULE,
  ]).join('\n\n');
}

/**
 * The commute, with the destination it was measured to — and rule 4's caveat
 * where that destination is not this property's own centre.
 */
export function commuteSentence(commute: unknown, stages: Record<string, unknown>): string | null {
  const c = rec(commute);
  if (!c) return null;

  if (c['measured'] === false) {
    const detail = text(c['detail']);
    return detail ? `No commute time was assessed. ${detail}` : null;
  }

  const minutes = num(c['durationMinutes']);
  const km = num(c['distanceKm']);
  const destination = text(c['destination']) ?? text(stages['commuteDestination']);
  if (minutes === null && km === null) return null;
  if (!destination) {
    // A commute whose destination is not named is a number no reader can
    // check, so it is withheld rather than printed without one.
    return null;
  }

  const own = c['destinationOwnCentre'] ?? stages['commuteDestinationOwnCentre'];
  const measure = list([
    minutes !== null ? `${Math.round(minutes)} minutes` : null,
    km !== null ? `${Math.round(km * 10) / 10} km` : null,
  ]).join(' / ');

  /*
   * The mode is the reading's own, and so is what it is NOT. OSRM routes a
   * car over the road network with no traffic at all, so its minutes are a
   * free-flow drive and never a peak-hour commute — the Compass for 60 Lawley
   * Street (25 Sep 2026) was right to print "without traffic" on one page and
   * had nothing to stop it calling the same figure a commute on another. The
   * Distance Matrix fallback answers `public_transit`, which this sentence
   * used to call a drive as well.
   */
  const mode = text(c['mode']);
  const base = mode === 'public_transit'
    ? `Measured public-transport journey to **${destination}**: ${measure}, from a journey planner at the `
      + 'time it was asked — not a peak-hour or guaranteed travel time.'
    : mode === 'driving'
      ? `Measured drive to **${destination}**: ${measure}, routed over the road network with no traffic — a `
        + 'free-flow driving time, not a peak-hour commute.'
      : `Measured journey to **${destination}**: ${measure}.`;
  if (own === 'no' || own === false) {
    return `${base} ${destination} is NOT this property's own urban centre — it is the state `
      + 'capital, and the centre this property actually belongs to is nearer. Report this figure '
      + 'as the distance to the capital and never as the property\'s access to services or work, '
      + 'and do not draw a conclusion about the location from it.';
  }
  if (own === 'unknown' || own === undefined || own === null) {
    return `${base} Whether ${destination} is this property's own urban centre was not established, `
      + 'so present the figure as a measured commute to that named city and nothing more.';
  }
  return base;
}
