/**
 * The owner-occupier's view: what the stored record says about LIVING in the
 * home, for a document whose reader will.
 *
 * The owner, 23 Sep 2026: advisers, brokers and buyer's agents serve an
 * investor "or alternatively a owner-occupied client", and the reports must be
 * "reflective of that specifically". Every section this platform writes asks
 * an investor's questions — what it rents for, what it yields, what it costs
 * to hold. A buyer who will live in the home asks different ones: which
 * schools are near, where the shops and the doctor are, how to get about, who
 * the neighbours are, what a home loan costs them, and what they may build on
 * the land. The record already answers most of those; nothing put them in one
 * place for that reader. This does, from the same record, and adds nothing to
 * it.
 *
 * ## Rules
 *
 * **Every row is a reading this platform took, or it is not drawn.** The
 * schools, shops, park and health care are the amenity lookups
 * (`location-intelligence-service`); the stop is the GTFS register; the
 * households are the ABS Census projection and ONLY that — a demographic block
 * the Client-Safe Gate cannot recognise as the Census (`isCensusProjectionSource`)
 * is a generated one, 0 exact matches on 616 comparable reports, and is not
 * read; the lending rates are RBA table F5; the land use sentence is
 * `landUseStanding`, the one the Due Diligence document's strategic read
 * prints. A row with nothing behind it is omitted, never worded — the owner's
 * rule that neither "N/A" nor "unavailable" reaches a client document — and
 * a section of fewer than two rows is not drawn at all.
 *
 * **Absent is never zero, and a count that saturates is not stated.** The
 * amenity counts stop at their provider's page size (ten on the reference
 * report, in every category), so this names the nearest place and never how
 * many there are. The one count it states is the stop register's, which is a
 * real count of boarding places and carries its own radius
 * (`transportCountReading`).
 *
 * **A distance says what it measures.** Every amenity and stop distance is a
 * haversine from the verified coordinate — a straight line, not a walk — and
 * the cell says so. A commute is a ROUTE and is printed only where the record
 * names its destination and that destination is this property's own centre
 * (`destinationOwnCentre !== 'no'`): Golden Square's 114 minutes is to
 * Melbourne, and a home buyer in Bendigo does not commute there.
 *
 * **Nothing is rated.** No row says a school is good, a suburb is safe or a
 * rate is attractive. The checks under the table are about the ACT of buying
 * a home — the catchment, the journey, the duty — and are true of every
 * property, which is why they can be written in advance.
 *
 * Deno-compatible: `_shared` only, explicit `.ts` extensions.
 */
import { isCensusProjectionSource } from '../../absCensusProjection.pure.ts';
import { transportCountReading } from '../../transportReading.pure.ts';
import { landUseStanding } from '../investment/strategyPositions.pure.ts';
import type { AudienceSection } from '../investment/audienceContent.pure.ts';
import { stagesOf, text } from './amenityFactBlocks.pure.ts';
import { strategySiteFrom } from './strategySite.pure.ts';

export const OWNER_OCCUPIER_SECTION_HEADING = "Living Here: An Owner-Occupier's View";

export interface OwnerOccupierLensInput {
  /** `investment_reports.location_intelligence`. */
  locationIntelligence?: unknown;
  /** `investment_reports.demographics_data`. */
  demographicsData?: unknown;
  /** `investment_reports.economic_data`. */
  economicData?: unknown;
  /**
   * Whether the document already prints the land use table with its
   * qualifications — the Compass and the Due Diligence report
   * (`TierContentPolicy.locationDepth`). Where it does not, the planning
   * module's qualifications travel with the sentence, verbatim.
   */
  carriesPlanningRegister?: boolean;
  /**
   * Whether the document prints the financial model — where it does, one
   * check says which of its figures a home does not carry.
   */
  carriesFinancialModelling?: boolean;
}

const rec = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** A table cell cannot carry a pipe. */
const cell = (s: string): string => s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

/** A distance held in km, as a reader would say it: `90 m`, `1.4 km`, `12 km`. */
export function distanceText(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round(km * 100) * 10)} m`;
  const r = Math.round(km * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)} km`;
}

// ─── The rows ───────────────────────────────────────────────────────────────

/** The nearest schools, up to three, nearest first. */
function schoolsRow(li: Record<string, unknown>): string | null {
  const schools = rec(li.schools);
  const seen = new Set<string>();
  const listed = (Array.isArray(schools.topSchools) ? schools.topSchools : [])
    .map((s) => ({ name: text(rec(s).name), km: num(rec(s).distance) }))
    .filter((s): s is { name: string; km: number } => s.name !== null && s.km !== null && s.km >= 0)
    .sort((a, b) => a.km - b.km)
    .filter((s) => {
      const key = s.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
  if (!listed.length) {
    const name = text(schools.nearestSchool);
    const km = num(schools.distanceToSchool);
    if (!name || km === null) return null;
    listed.push({ name, km });
  }
  return `${listed.map((s) => `${s.name}, ${distanceText(s.km)}`).join('; ')} — `
    + `the nearest by straight-line distance.`;
}

/** The nearest shopping, park and health care the lookups named. */
function everydayRow(li: Record<string, unknown>): string | null {
  const lifestyle = rec(li.lifestyle);
  const health = rec(li.healthcare);
  const shop = text(lifestyle.nearestShopping);
  const park = text(lifestyle.nearestPark);
  const care = text(health.nearestHospital);
  const careKm = num(health.distanceToHospital);
  const parts = [
    shop ? `Nearest shopping: ${shop}.` : null,
    park ? `Nearest park: ${park}.` : null,
    // The healthcare category answers the nearest place that provides care —
    // on the reference report a chiropractor — so it is never called a
    // hospital, whatever the stored key is named.
    care ? `Nearest health care: ${care}${careKm !== null ? `, ${distanceText(careKm)} in a straight line` : ''}.` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? parts.join(' ') : null;
}

/** The nearest stop, the stop count within its radius, and a commute to this property's own centre. */
function gettingAroundRow(li: Record<string, unknown>): string | null {
  const t = rec(li.transport);
  const verdict = text(t.verdict);
  const parts: string[] = [];
  // Outside every loaded network is a fact about the feeds, not the area, so
  // it says nothing here rather than something wrong.
  if (verdict !== 'outside_loaded_networks') {
    const stop = text(t.nearestStation);
    const km = num(t.distanceToStation);
    if (stop && km !== null) {
      const count = verdict === 'stops_nearby' ? transportCountReading(t).label : null;
      parts.push(`Nearest public transport stop: ${stop}, ${distanceText(km)} in a straight line`
        + `${count ? `; ${count}` : ''}.`);
    }
  }

  const c = rec(li.commute);
  const stages = stagesOf(li);
  const minutes = num(c.durationMinutes);
  const distanceKm = num(c.distanceKm);
  const destination = text(c.destination) ?? text(stages.commuteDestination);
  const own = c.destinationOwnCentre ?? stages.commuteDestinationOwnCentre;
  const mode = text(c.mode);
  // A measured route to a NAMED destination that is this property's own
  // centre. `estimated` is the retired straight-line guess (438 stored rows,
  // averaging 10,125 minutes) and is never a journey.
  if (destination && minutes !== null && minutes > 0 && minutes < 600 && own !== 'no' && own !== false) {
    const km = distanceKm !== null ? ` (${distanceText(distanceKm)} by road)` : '';
    if (mode === 'driving') {
      parts.push(`A drive to ${destination} was measured at ${Math.round(minutes)} minutes${km}, without traffic.`);
    } else if (mode === 'public_transit') {
      parts.push(`A public transport journey to ${destination} was measured at ${Math.round(minutes)} minutes.`);
    }
  }
  return parts.length ? parts.join(' ') : null;
}

/** Who lives here — the ABS Census projection, and only it. */
function neighbourhoodRow(demographics: Record<string, unknown>): string | null {
  const housing = rec(demographics.housing);
  const income = rec(demographics.income);
  if (!isCensusProjectionSource(housing.source)) return null;
  const source = String(housing.source);
  const year = /Census (\d{4})/.exec(source)?.[1] ?? null;
  const postcode = /POA (\d{4})/.exec(source)?.[1] ?? null;
  if (!year || !postcode) return null;
  const owned = num(housing.ownerOccupierRate);
  const rented = num(housing.renterRate);
  const household = num(housing.averageHouseholdSize);
  const age = isCensusProjectionSource(income.source) ? num(income.medianAge) : null;

  const tenure = owned !== null
    ? `${owned}% of occupied homes in postcode ${postcode} were owner-occupied${rented !== null ? ` and ${rented}% rented` : ''}`
    : rented !== null ? `${rented}% of occupied homes in postcode ${postcode} were rented` : null;
  const people = [
    household !== null ? `the average household was ${household} people` : null,
    age !== null ? `the median age was ${age}` : null,
  ].filter((p): p is string => p !== null);
  if (!tenure && !people.length) return null;
  const said = [tenure, people.length ? people.join(' and ') : null].filter(Boolean).join('; ');
  return `At the ${year} Census (ABS), ${tenure ? said : `in postcode ${postcode} ${said}`}.`;
}

/** What a home loan costs an owner-occupier beside an investor — RBA table F5. */
function lendingRow(economic: Record<string, unknown>): string | null {
  const lending = rec(economic.lendingRates);
  if (!/^RBA statistical table F5\b/.test(String(lending.source ?? ''))) return null;
  const figure = (v: unknown) => {
    const f = rec(v);
    const value = num(f.value);
    const period = text(f.periodLabel);
    return value !== null && period ? { value, period } : null;
  };
  const owner = figure(rec(lending.ownerOccupier).discountedVariable);
  const investor = figure(rec(lending.investor).discountedVariable);
  if (!owner) return null;
  const pct = (n: number) => `${n.toFixed(2)}%`;
  if (investor && investor.period === owner.period) {
    return `Banks' discounted variable home loan rate was ${pct(owner.value)} for an owner-occupier and `
      + `${pct(investor.value)} for an investor in ${owner.period} (RBA statistical table F5).`;
  }
  return `Banks' discounted variable home loan rate for an owner-occupier was ${pct(owner.value)} in `
    + `${owner.period} (RBA statistical table F5).`;
}

/** The planning term a home buyer knows by another name. */
const PLAIN_NAME: Readonly<Record<string, string>> = {
  'secondary dwellings': 'secondary dwellings (granny flats)',
};

/** What the land use table says may be built — `landUseStanding`'s sentence. */
function landRow(li: unknown): { row: string; qualification: string } | null {
  const table = strategySiteFrom(li)?.landUse ?? null;
  if (!table) return null;
  const standing = landUseStanding(table);
  if (!standing.sentence) return null;
  let row = standing.sentence;
  for (const [term, plain] of Object.entries(PLAIN_NAME)) row = row.replace(term, plain);
  return {
    row,
    qualification: `${standing.dwellingStated ? `${table.caveat} ` : ''}${table.limit}`,
  };
}

/**
 * Who answered a place lookup, as a client document credits it. OpenStreetMap
 * data is published under the ODbL, whose attribution is "© OpenStreetMap
 * contributors" — `AMENITY_PROVIDER_LABEL` is the prompt's wording, written to
 * tell a model the register is this platform's own, and is not a credit line.
 */
const PLACE_SOURCE_CREDIT: Readonly<Record<string, string>> = {
  register: '© OpenStreetMap contributors',
  google: 'Google Places',
};

/** Who answered the places and the stop, named once below the table. */
function sourcesLine(li: Record<string, unknown>, drawn: { places: boolean; stop: boolean }): string | null {
  const parts: string[] = [];
  if (drawn.places) {
    const sources = rec(stagesOf(li).amenitySources);
    const labels = [...new Set(['schools', 'shopping', 'recreation', 'healthcare']
      .map((k) => PLACE_SOURCE_CREDIT[String(text(sources[k]) ?? '')])
      .filter((l): l is string => !!l))];
    if (labels.length) parts.push(`Places: ${labels.join(' and ')}.`);
  }
  if (drawn.stop) {
    const t = rec(li.transport);
    const attributions = (Array.isArray(t.sources) ? t.sources : [])
      .map((s) => text(s))
      .filter((s): s is string => s !== null);
    if (attributions.length) parts.push(`Stops: ${attributions.join(', ')}.`);
  }
  return parts.length ? parts.join(' ') : null;
}

/**
 * The owner-occupier's section, or null where the record supports fewer than
 * two of its rows.
 */
export function composeOwnerOccupierLens(input: OwnerOccupierLensInput): AudienceSection | null {
  const li = rec(input.locationIntelligence);
  const schools = schoolsRow(li);
  const everyday = everydayRow(li);
  const around = gettingAroundRow(li);
  const neighbourhood = neighbourhoodRow(rec(input.demographicsData));
  const lending = lendingRow(rec(input.economicData));
  const land = landRow(input.locationIntelligence);

  // Labels short enough to set on one line in the table's first column —
  // rendered, "Everyday needs" and "Who lives here" each broke over two.
  const rows: Array<[string, string | null]> = [
    ['Schools', schools],
    ['Daily needs', everyday],
    ['Transport', around],
    ['Neighbourhood', neighbourhood],
    ['Home loans', lending],
    ['The land', land?.row ?? null],
  ];
  const drawn = rows.filter((r): r is [string, string] => r[1] !== null);
  if (drawn.length < 2) return null;

  const checks = [
    schools
      ? 'Confirm the school catchment for this address with the state education department; the nearest '
        + 'school is not always the one a child may enrol in.'
      : null,
    around ? 'Make the trip to work or study at the time of day you would make it.' : null,
    'Ask your conveyancer which transfer duty applies to a home you will live in, and whether a first home '
      + 'buyer concession or grant applies; in some states the duty on a home differs from an investor\'s.',
    input.carriesFinancialModelling
      ? 'A home you live in is generally exempt from land tax, and the deductions an investor claims against '
        + 'rent do not apply to it.'
      : null,
  ].filter((c): c is string => c !== null);

  const sources = sourcesLine(li, { places: !!(schools || everyday), stop: !!around });
  const body = [
    '| Living here | What the evidence shows |',
    '| --- | --- |',
    ...drawn.map(([label, value]) => `| ${label} | ${cell(value)} |`),
    '',
    ...(land && !input.carriesPlanningRegister ? [`*${land.qualification}*`, ''] : []),
    ...(sources ? [`*${sources}*`, ''] : []),
    '**Before you commit to living here.**',
    '',
    ...checks.map((c) => `- ${c}`),
  ].join('\n');

  return { heading: OWNER_OCCUPIER_SECTION_HEADING, body };
}
