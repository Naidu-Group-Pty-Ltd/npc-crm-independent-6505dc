/**
 * RF-7.2B.1 §C3 — the FIRST-GENERATION cohort.
 *
 * The earlier forward cohort exercised the gate from an already-assembled
 * payload. It could not see the defect this file exists for, because that
 * defect is about ORDER rather than about rules:
 *
 *   first generation     → no `report_geography` row → demographics withheld
 *   regenerated/backfilled → row exists              → demographics admitted
 *
 * Same property, two documents, decided by whether a batch job had been past.
 *
 * So each scenario here runs the real chain, in production's order, with the
 * real modules:
 *
 *   COORDINATE → GEOGRAPHY → POA → ABS → GATE → SNAPSHOT → PROMPT
 *
 * `resolveOneReportGeography` takes an injected `lookupPoint` — that seam
 * exists so the boundary service is never called from a test, not so a second
 * algorithm can be substituted: `resolveGeography`, the gate, the snapshot and
 * the prompt blocks below are all the production implementations.
 *
 * The ABS step is modelled the way the generator performs it: a lookup keyed
 * on a postcode, answering a payload that NAMES the postal area it describes.
 * That naming is the whole cross-check — a real ABS retrieval for the wrong
 * POA is a genuine source describing somebody else's suburb.
 */
import { describe, expect, it } from 'vitest';

import { resolveOneReportGeography } from '../../../../supabase/functions/_shared/geography/resolveOneReportGeography';
import { resolveGeography } from '../../../../supabase/functions/_shared/geography/asgsGeography.pure';
import type { AsgsLookup } from '../../../../supabase/functions/_shared/geography/asgsGeography.pure';
import { AUSTRALIA_CENTROID } from '../../../../supabase/functions/_shared/geocodeGranularity.pure';
import {
  activateSafeGenerationInputs,
  subjectPostcodeOf,
  SNAPSHOT_ABS_METRICS,
} from '../contract/safeGenerationInputs.pure';
import { demographicsStatBlocks } from '../../../../supabase/functions/_shared/reports/censusPromptBlocks.pure';
import { macroEconomicBlock } from '../../../../supabase/functions/_shared/reports/macroPromptBlocks.pure';

// ---------------------------------------------------------------------------
// The world these scenarios run in
// ---------------------------------------------------------------------------

const area = (code: string, name: string) => ({ code, name });

/** A complete boundary answer for a point that IS in a locality. */
function placed(poa: string, suburb: string, sa2 = '213021455'): AsgsLookup {
  return {
    sal: area(`SAL2${poa}`, suburb),
    poa: area(`POA${poa}`, poa),
    sa2: area(sa2, `${suburb} - District`),
    ra: area('1RNSW', 'Major Cities of Australia'),
    ucl: area('1001', `${suburb} Urban Centre`),
    sua: area('1001', `${suburb} Significant Urban Area`),
    salNeighbours: [area(`SAL2${poa}`, suburb)],
    serviceFailed: false,
  };
}

/** The boundary service could not be reached. */
const SERVICE_DOWN: AsgsLookup = {
  sal: null, poa: null, sa2: null, ra: null, ucl: null, sua: null,
  salNeighbours: [], serviceFailed: true,
};

/** Inside the box, in no locality — a point at sea or on unnamed ground. */
const NO_POLYGON: AsgsLookup = {
  sal: null, poa: null, sa2: null, ra: null, ucl: null, sua: null,
  salNeighbours: [], serviceFailed: false,
};

const HIERARCHY: Record<string, Record<string, unknown>> = {
  '213021455': {
    sa2_code: '213021455', sa2_name: 'Cobblebank - District', sa3_name: 'Melton',
    sa4_name: 'Melbourne - West', gccsa_name: 'Greater Melbourne', state_name: 'Victoria',
  },
  '316071583': {
    sa2_code: '316071583', sa2_name: 'Traralgon', sa3_name: 'Latrobe Valley',
    sa4_name: 'Latrobe - Gippsland', gccsa_name: 'Rest of Vic.', state_name: 'Victoria',
  },
  '702021054': {
    sa2_code: '702021054', sa2_name: 'Petermann - Simpson Desert', sa3_name: 'Alice Springs',
    sa4_name: 'Northern Territory - Outback', gccsa_name: 'Rest of NT', state_name: 'Northern Territory',
  },
};

/** The directory rows a cohort scenario's suburb is listed under. */
const DIRECTORY: Readonly<Record<string, Array<Record<string, string>>>> = {
  cobblebank: [{ suburb: 'Cobblebank', state: 'VIC', postcode: '3338' }],
  traralgon: [{ suburb: 'Traralgon', state: 'VIC', postcode: '3844' }],
  'wyndham vale': [{ suburb: 'Wyndham Vale', state: 'VIC', postcode: '3024' }],
  petermann: [{ suburb: 'Petermann', state: 'NT', postcode: '0872' }],
};

interface FakeOptions {
  /** Override the directory answer for every suburb. */
  readonly suburb_directory?: Array<Record<string, string>>;
  /** Make the directory read fail, which must read as NOT CHECKED. */
  readonly directoryError?: string;
  readonly onRead?: (table: string, value: string) => void;
}

/**
 * A service-role client, reduced to the three calls the resolver makes. Every
 * write is captured rather than discarded, because "the row was written" is
 * itself one of the facts this cohort checks — and so is "the directory was
 * actually read", which is the distinction this round corrects.
 */
function fakeSupabase(opts: FakeOptions = {}) {
  const writes: Array<Record<string, unknown>> = [];
  return {
    writes,
    from(table: string) {
      if (table === 'abs_sa2_meta') {
        return {
          select: () => ({
            eq: (_c: string, code: string) => ({
              maybeSingle: async () => ({ data: HIERARCHY[code] ?? null, error: null }),
            }),
          }),
        };
      }
      if (table === 'suburb_directory') {
        return {
          select: () => ({
            ilike: (_col: string, value: string) => ({
              limit: async () => {
                opts.onRead?.(table, value);
                if (opts.directoryError) {
                  return { data: null, error: { message: opts.directoryError } };
                }
                if (opts.suburb_directory) return { data: opts.suburb_directory, error: null };
                return { data: DIRECTORY[value.toLowerCase()] ?? [], error: null };
              },
            }),
          }),
        };
      }
      if (table === 'report_geography') {
        return {
          upsert: async (row: Record<string, unknown>) => {
            writes.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`the resolver must not read ${table}`);
    },
  };
}

/**
 * The ABS step, as the generator performs it: the payload is retrieved FOR a
 * postcode and stamps the postal area it describes. `null` means the table
 * holds nothing for that area — an honest absence, never an estimate.
 */
function absForPostcode(postcode: string | null): Record<string, unknown> | undefined {
  if (postcode === null) return undefined;
  // The shape `censusDemographicsResponse` actually returns: `source`,
  // `dataQuality` and `referencePeriod` are stamped on EVERY sub-block as well
  // as at the top, and the prompt's own vintage label reads the nested one.
  // A fixture that only carried the top-level copy printed "ABS Census (POA)"
  // with no year — which is what a production-shaped cohort is for.
  const source = `ABS Census 2021 (POA ${postcode})`;
  const stamp = { dataQuality: 'census', referencePeriod: '2021', source };
  return {
    dataSource: source,
    dataQuality: 'census',
    referencePeriod: '2021',
    population: { total: 18234, ...stamp },
    income: {
      medianAge: 32,
      medianHouseholdIncome: 96_512,
      medianWeeklyIncome: 1856,
      medianHouseholdIncomeWeekly: 1856,
      unemploymentRate: 4.1,
      ...stamp,
    },
    employment: {
      laborForce: 9120,
      laborForceParticipation: 64.2,
      employmentRate: 95.9,
      ...stamp,
    },
  };
}

const SEIFA = { irsad: 1012, irsd: 998, ier: 1003, ieo: 985 };

const TARGET = {
  percent: 4.35,
  effectiveDate: '2026-08-12',
  effectiveLabel: '12 August 2026',
  lastChangedDate: '2026-05-06',
  lastChangedLabel: '6 May 2026',
  lastChangePoints: 0.25,
  decisionsSinceChange: 2,
  asAtLabel: '10 September 2026',
  seriesId: 'FIRMMCRTD',
  tableCode: 'f1',
  publicationDate: '11-Sep-2026',
  effectiveDateSource: 'RBA Cash Rate Target decision history',
};

/** Everything the model would otherwise be handed about location. */
const LEGACY_LOCATION = {
  walkScore: 71,
  commute: { durationMinutes: 44, distanceKm: 33 },
  transport: { qualityScore: 66, nearestStation: 'Cobblebank', stopsWithinRadius: 5 },
  schools: { nearestSchool: 'Cobblebank PS', distanceToSchool: 1.1, schoolsWithin3km: 18 },
  healthcare: { facilitiesWithin5km: 3 },
};

// ---------------------------------------------------------------------------
// The chain, run exactly once per scenario
// ---------------------------------------------------------------------------

interface Scenario {
  readonly name: string;
  /** The coordinate the location step produced, or null where it produced none. */
  readonly coordinate: { lat: number | null; lng: number | null };
  readonly lookup: AsgsLookup | null;
  /** The postcode the free-text address produced — never trusted, only compared. */
  readonly addressPostcode: string | null;
  /** A geography row a sweep wrote earlier, for the two non-first-generation cases. */
  readonly storedRow?: Record<string, unknown> | null;
  /** Force the ABS payload rather than deriving it, for the wrong/stale POA case. */
  readonly absOverride?: Record<string, unknown>;
}

interface Trace {
  coordinate: string;
  geography: string;
  poa: string | null;
  abs: string;
  gate: 'admitted' | 'withheld';
  snapshotGeography: string | null;
  snapshotPresentFacts: number;
  prompt: string;
  ruling: string;
  rowWritten: boolean;
  directoryChecked: boolean;
}

async function runChain(s: Scenario): Promise<Trace> {
  // --- COORDINATE ----------------------------------------------------------
  const supabase = fakeSupabase();

  // --- GEOGRAPHY -----------------------------------------------------------
  let geography: Record<string, unknown> | null;
  let provenance: { source: string; status: string; absRequeried: boolean };
  let rowWritten = false;
  let directoryChecked = false;

  if (s.storedRow !== undefined) {
    // The sweep, or the one-off backfill, has already placed this report.
    geography = s.storedRow;
    provenance = {
      source: 'stored_row',
      status: String(s.storedRow?.status ?? 'unresolved'),
      absRequeried: false,
    };
  } else {
    const outcome = await resolveOneReportGeography({
      supabase,
      reportId: '11111111-2222-3333-4444-555555555555',
      latitude: s.coordinate.lat,
      longitude: s.coordinate.lng,
      lookupPoint: async () => s.lookup ?? SERVICE_DOWN,
    });
    rowWritten = supabase.writes.length === 1;
    directoryChecked = outcome.directoryChecked;
    geography = outcome.row === null ? null : {
      postcode: outcome.row.postcode,
      status: outcome.row.status,
      suburb: outcome.row.suburb,
      state: outcome.row.state,
    };
    provenance = { source: 'pre_generation', status: outcome.status, absRequeried: false };
  }

  // --- POA -----------------------------------------------------------------
  const trustedPostcode = subjectPostcodeOf(geography);

  // --- ABS -----------------------------------------------------------------
  // Keyed on the address postcode first, exactly as phase 1 does, then
  // re-queried on the trusted one where the two disagree.
  let demographics = s.absOverride ?? absForPostcode(s.addressPostcode);
  if (trustedPostcode && trustedPostcode !== s.addressPostcode && s.absOverride === undefined) {
    demographics = absForPostcode(trustedPostcode);
    provenance = { ...provenance, absRequeried: true };
  }

  // --- GATE ----------------------------------------------------------------
  const result = activateSafeGenerationInputs({
    enhancedData: {
      locationIntelligence: {
        coordinates: { lat: s.coordinate.lat, lng: s.coordinate.lng },
        ...LEGACY_LOCATION,
      },
      demographics,
      seifaData: demographics ? SEIFA : undefined,
      economics: { cashRateTarget: TARGET },
    },
    geography,
    geographyProvenance: provenance,
    cashRateTarget: TARGET as never,
    cashRateMonthlyAverage: null,
    capturedAt: '2026-09-11T08:00:00.000Z',
  });

  // --- SNAPSHOT ------------------------------------------------------------
  const snapshot = result.snapshot;

  // --- PROMPT --------------------------------------------------------------
  const prompt = [
    demographicsStatBlocks(result.enhancedData as never),
    macroEconomicBlock(result.enhancedData as never),
  ].join('\n\n');

  return {
    coordinate: s.coordinate.lat === null ? 'absent' : `${s.coordinate.lat},${s.coordinate.lng}`,
    geography: String(geography?.status ?? 'none'),
    poa: trustedPostcode,
    abs: demographics ? String(demographics.dataSource) : 'none',
    gate: result.demographicsKept ? 'admitted' : 'withheld',
    snapshotGeography: snapshot.geography.postcode,
    snapshotPresentFacts: snapshot.facts.filter((f) => f.status === 'present').length,
    prompt,
    ruling: result.demographicsRuling,
    rowWritten,
    directoryChecked,
  };
}

// ---------------------------------------------------------------------------
// The eight scenarios
// ---------------------------------------------------------------------------

const TRUSTED_METRO: Scenario = {
  name: 'trusted coordinate + matching ABS POA',
  coordinate: { lat: -37.6924, lng: 144.5402 },
  lookup: placed('3338', 'Cobblebank', '213021455'),
  addressPostcode: '3338',
};

const TRUSTED_REGIONAL: Scenario = {
  name: 'trusted coordinate, regional',
  coordinate: { lat: -38.1954, lng: 146.5403 },
  lookup: placed('3844', 'Traralgon', '316071583'),
  addressPostcode: '3844',
};

const SENTINEL: Scenario = {
  name: 'sentinel coordinate (the geocoder\'s country fallback)',
  coordinate: { lat: AUSTRALIA_CENTROID.lat, lng: AUSTRALIA_CENTROID.lng },
  // The boundary service WOULD place it — the desert is inside a real locality
  // with a real postcode. That is exactly the danger.
  lookup: placed('0872', 'Petermann', '702021054'),
  addressPostcode: '2000',
};

const NO_COORDINATE: Scenario = {
  name: 'missing coordinate',
  coordinate: { lat: null, lng: null },
  lookup: null,
  addressPostcode: '3338',
};

const CANNOT_RESOLVE: Scenario = {
  name: 'coordinate that cannot resolve (boundary service down)',
  coordinate: { lat: -37.6924, lng: 144.5402 },
  lookup: SERVICE_DOWN,
  addressPostcode: '3338',
};

const WRONG_POA: Scenario = {
  name: 'wrong/stale ABS POA',
  coordinate: { lat: -37.7529, lng: 144.5820 },
  lookup: placed('3024', 'Wyndham Vale', '213021455'),
  addressPostcode: '3338',
  // The payload the pipeline is holding is a real ABS retrieval — for the
  // NEIGHBOURING postal area. Nothing about it is malformed.
  absOverride: absForPostcode('3338'),
};

const REGENERATED: Scenario = {
  name: 'regenerated report with an existing geography row',
  coordinate: { lat: -37.6924, lng: 144.5402 },
  lookup: null,
  addressPostcode: '3338',
  storedRow: { status: 'resolved', postcode: '3338', suburb: 'Cobblebank', state: 'VIC' },
};

const BACKFILLED: Scenario = {
  name: 'historical/backfilled row',
  coordinate: { lat: -37.6924, lng: 144.5402 },
  lookup: null,
  addressPostcode: '3338',
  // A row whose suburb the directory does not carry — a real state, and the
  // warned status must admit area statistics exactly as the clean one does.
  // That is what makes `subjectPostcodeOf` accept both.
  storedRow: {
    status: 'resolved_with_warning', postcode: '3338', suburb: 'Cobblebank', state: 'VIC',
  },
};

const COHORT: readonly Scenario[] = [
  TRUSTED_METRO, TRUSTED_REGIONAL, SENTINEL, NO_COORDINATE,
  CANNOT_RESOLVE, WRONG_POA, REGENERATED, BACKFILLED,
];

// ---------------------------------------------------------------------------

describe('C3 — the first-generation cohort, traced end to end', () => {
  it('has all eight named scenarios', () => {
    expect(COHORT).toHaveLength(8);
    expect(new Set(COHORT.map((s) => s.name)).size).toBe(8);
  });

  it('a valid first generation receives valid ABS facts', async () => {
    for (const s of [TRUSTED_METRO, TRUSTED_REGIONAL]) {
      const t = await runChain(s);
      // A clean `resolved`. It used to read `resolved_with_warning` on every
      // resolution, because both this path and the sweep passed
      // `directoryMatches: []` WITHOUT opening the directory, and the resolver
      // reads `[]` as "checked and absent". The check is performed now, and a
      // check that was not performed is a distinct third state — so a good
      // geography no longer carries a warning about a lookup nobody made.
      expect(t.geography, s.name).toBe('resolved');
      expect(t.directoryChecked, s.name).toBe(true);
      expect(t.poa, s.name).toBe(s.addressPostcode);
      expect(t.gate, s.name).toBe('admitted');
      // The row is written during the run — which is the whole point: no sweep
      // has been past a report that was created seconds ago.
      expect(t.rowWritten, s.name).toBe(true);
      // The narrative gets real figures with their own source line.
      expect(t.prompt, s.name).toContain('18,234');
      expect(t.prompt, s.name).toContain('ABS Census 2021 (POA)');
      // And the snapshot records which postal area they describe.
      expect(t.snapshotGeography, s.name).toBe(s.addressPostcode);
      expect(t.snapshotPresentFacts, s.name).toBeGreaterThanOrEqual(8);
    }
  });

  it('an unresolved first generation fails closed', async () => {
    for (const s of [NO_COORDINATE, CANNOT_RESOLVE]) {
      const t = await runChain(s);
      expect(t.geography, s.name).toBe('unresolved');
      expect(t.poa, s.name).toBeNull();
      expect(t.gate, s.name).toBe('withheld');
      expect(t.ruling, s.name).toMatch(/no trusted resolved postcode/i);
      expect(t.ruling, s.name).toMatch(/not estimated, synthesised or borrowed/i);
      // Nothing about the area reaches the page.
      expect(t.prompt, s.name).not.toContain('18,234');
      expect(t.snapshotGeography, s.name).toBeNull();
    }
  });

  it('a wrong POA fails closed even though the ABS payload is genuine', async () => {
    const t = await runChain(WRONG_POA);
    expect(t.geography).toBe('resolved');
    expect(t.poa).toBe('3024');
    expect(t.abs).toBe('ABS Census 2021 (POA 3338)');
    expect(t.gate).toBe('withheld');
    expect(t.ruling).toContain('3338');
    expect(t.ruling).toContain('3024');
    expect(t.prompt).not.toContain('18,234');
  });

  it('the sentinel coordinate is refused rather than placed in the desert', async () => {
    const t = await runChain(SENTINEL);
    // The boundary service WOULD answer with a real remote locality — a real
    // suburb, in a real postcode, which the directory would confirm. The chain
    // refuses anyway, because the point is the geocoder's "no match", and it
    // does not spend the boundary or directory query to find that out.
    expect(t.geography).toBe('unresolved');
    expect(t.directoryChecked).toBe(false);
    expect(t.poa).toBeNull();
    expect(t.gate).toBe('withheld');
    expect(t.prompt).not.toContain('0872');
    expect(t.prompt).not.toContain('18,234');
  });

  it('a regenerated report and a backfilled row behave as the first generation now does', async () => {
    const first = await runChain(TRUSTED_METRO);
    for (const s of [REGENERATED, BACKFILLED]) {
      const t = await runChain(s);
      expect(t.gate, s.name).toBe('admitted');
      expect(t.poa, s.name).toBe(first.poa);
      expect(t.snapshotGeography, s.name).toBe(first.snapshotGeography);
      expect(t.snapshotPresentFacts, s.name).toBe(first.snapshotPresentFacts);
    }
  });

  it('the inconsistency this closes: first generation == regeneration', async () => {
    const first = await runChain(TRUSTED_METRO);
    const again = await runChain(REGENERATED);
    // Same property, same coordinate, same conclusion — which was NOT true
    // before the resolution moved ahead of the gate.
    expect(first.gate).toBe(again.gate);
    expect(first.prompt).toBe(again.prompt);
  });

  it('every scenario admits the four disowned Location facts to nothing', async () => {
    for (const s of COHORT) {
      const t = await runChain(s);
      for (const marker of ['Walk Score', 'walkScore', 'qualityScore', 'schoolsWithin3km', '71', '66']) {
        expect(t.prompt, `${s.name} / ${marker}`).not.toContain(marker);
      }
    }
  });

  it('no scenario leaks a technical null, an undefined or an XX placeholder', async () => {
    for (const s of COHORT) {
      const t = await runChain(s);
      for (const token of ['undefined', 'NaN', 'null', '| XX ', '[object Object]']) {
        expect(t.prompt, `${s.name} / ${token}`).not.toContain(token);
      }
    }
  });

  it('the cash rate is the in-force target on every scenario, geography or not', async () => {
    for (const s of COHORT) {
      const t = await runChain(s);
      expect(t.prompt, s.name).toContain('4.35%');
      expect(t.prompt, s.name).toContain('12 August 2026');
      expect(t.prompt, s.name).toContain('6 May 2026');
    }
  });

  it('an admitted metric always reaches the snapshot with its own value', async () => {
    const t = await runChain(TRUSTED_METRO);
    // Nothing is narrated that the snapshot could not account for.
    expect(t.snapshotPresentFacts).toBeGreaterThanOrEqual(SNAPSHOT_ABS_METRICS.length);
  });

  it('the boundary service is never asked about an impossible point', async () => {
    let asked = 0;
    const supabase = fakeSupabase();
    await resolveOneReportGeography({
      supabase,
      reportId: '11111111-2222-3333-4444-555555555555',
      latitude: 51.5072,       // London
      longitude: -0.1276,
      lookupPoint: async () => { asked += 1; return NO_POLYGON; },
    });
    expect(asked).toBe(0);
    expect(supabase.writes[0]?.status).toBe('unresolved');
    expect(supabase.writes[0]?.flags).toContain('outside_australia');
  });

  it('the row it writes names the method the CHECK constraint admits', async () => {
    const supabase = fakeSupabase();
    await resolveOneReportGeography({
      supabase,
      reportId: '11111111-2222-3333-4444-555555555555',
      latitude: -37.6924,
      longitude: 144.5402,
      lookupPoint: async () => placed('3338', 'Cobblebank', '213021455'),
    });
    // `point_in_polygon` is what the batch used to write, and the constraint
    // rejected every one of them silently.
    expect(supabase.writes[0]?.method).toBe('asgs_point_in_polygon');
  });
});

// ---------------------------------------------------------------------------
// C-dir — "not checked" is not "not found"
// ---------------------------------------------------------------------------

/**
 * `resolveGeography` reads `directoryMatches: []` as *the directory was checked
 * and this suburb is not in it*. Every caller passed `[]` without opening the
 * directory, so every resolution this module produced carried
 * `suburb_not_in_directory` and read `resolved_with_warning` — a warning about
 * a check nobody ran — and the two disagreements the validation exists to catch
 * were unreachable, because the code reached them only through the populated
 * branch.
 *
 * The field now has three states and they are three different facts. These
 * tests pin all three, and the two disagreements that are now reachable.
 */
describe('C-dir — the suburb directory: checked, absent, and not checked', () => {
  const MELTON = { latitude: -37.6924, longitude: 144.5402 };
  const SAL = placed('3338', 'Cobblebank', '213021455');
  const HIER = {
    sa2Code: '213021455', sa2Name: 'Cobblebank - District', sa3Name: 'Melton',
    sa4Name: 'Melbourne - West', gccsaName: 'Greater Melbourne', stateName: 'Victoria',
  };
  const resolve = (directoryMatches: unknown) => resolveGeography({
    coordinate: MELTON, lookup: SAL, hierarchy: HIER,
    directoryMatches: directoryMatches as never,
  });

  it('a directory MATCH resolves clean — no warning on a good geography', () => {
    const g = resolve([{ suburb: 'Cobblebank', state: 'VIC', postcode: '3338' }]);
    expect(g.status).toBe('resolved');
    expect(g.flags).toEqual([]);
  });

  it('an actual MISS is a warning — that is evidence about the suburb', () => {
    const g = resolve([]);
    expect(g.status).toBe('resolved_with_warning');
    expect(g.flags).toContain('suburb_not_in_directory');
  });

  it('NOT CHECKED never pretends the suburb was absent', () => {
    for (const notChecked of [null, undefined]) {
      const g = resolve(notChecked);
      expect(g.status, String(notChecked)).toBe('resolved');
      expect(g.flags, String(notChecked)).not.toContain('suburb_not_in_directory');
      expect(g.flags, String(notChecked)).toEqual([]);
      // Honest about itself: the absence of the check is recorded.
      expect(g.notes.join(' '), String(notChecked)).toMatch(/cross-check was not performed/i);
    }
  });

  it('a postcode disagreement is a warning — and is now reachable at all', () => {
    const g = resolve([{ suburb: 'Cobblebank', state: 'VIC', postcode: '3337' }]);
    expect(g.flags).toContain('suburb_postcode_mismatch');
    expect(g.status).toBe('resolved_with_warning');
    // The boundary still decides. The directory questioned; it did not win.
    expect(g.postcode).toBe('3338');
  });

  it('a state disagreement forces review — the one that attaches the wrong market', () => {
    const g = resolve([{ suburb: 'Cobblebank', state: 'NSW', postcode: '3338' }]);
    expect(g.flags).toContain('state_mismatch');
    expect(g.status).toBe('requires_review');
    expect(g.state).toBe('VIC');
  });

  it('the directory never decides the geography, in any of the three states', () => {
    for (const d of [
      null,
      [],
      [{ suburb: 'Cobblebank', state: 'NSW', postcode: '3337' }],
    ]) {
      const g = resolve(d);
      expect(g.suburb, JSON.stringify(d)).toBe('Cobblebank');
      expect(g.postcode, JSON.stringify(d)).toBe('3338');
      expect(g.state, JSON.stringify(d)).toBe('VIC');
      expect(g.localityCode, JSON.stringify(d)).toBe('SAL23338');
    }
  });

  it('the resolver PERFORMS the check rather than declaring it', async () => {
    const reads: Array<{ table: string; value: string }> = [];
    const supabase = fakeSupabase({
      suburb_directory: [{ suburb: 'Cobblebank', state: 'VIC', postcode: '3338' }],
      onRead: (table, value) => reads.push({ table, value }),
    });
    const outcome = await resolveOneReportGeography({
      supabase,
      reportId: '11111111-2222-3333-4444-555555555555',
      latitude: MELTON.latitude,
      longitude: MELTON.longitude,
      lookupPoint: async () => SAL,
    });
    expect(reads.some((r) => r.table === 'suburb_directory')).toBe(true);
    expect(outcome.directoryChecked).toBe(true);
    // A real match, so a clean resolution — this is the false warning gone.
    expect(outcome.status).toBe('resolved');
    expect(outcome.row?.flags).toEqual([]);
  });

  it('a directory read that FAILS is not checked, not a missing suburb', async () => {
    const supabase = fakeSupabase({ directoryError: 'connection reset' });
    const outcome = await resolveOneReportGeography({
      supabase,
      reportId: '11111111-2222-3333-4444-555555555555',
      latitude: MELTON.latitude,
      longitude: MELTON.longitude,
      lookupPoint: async () => SAL,
    });
    expect(outcome.directoryChecked).toBe(false);
    expect(outcome.status).toBe('resolved');
    expect(outcome.row?.flags).not.toContain('suburb_not_in_directory');
    // Our outage never becomes a finding about somebody's suburb.
    expect(outcome.row?.notes).toMatch(/cross-check was not performed/i);
  });

  it('a genuinely unlisted suburb still warns, through the real read', async () => {
    const supabase = fakeSupabase({ suburb_directory: [] });
    const outcome = await resolveOneReportGeography({
      supabase,
      reportId: '11111111-2222-3333-4444-555555555555',
      latitude: MELTON.latitude,
      longitude: MELTON.longitude,
      lookupPoint: async () => SAL,
    });
    expect(outcome.directoryChecked).toBe(true);
    expect(outcome.status).toBe('resolved_with_warning');
    expect(outcome.row?.flags).toContain('suburb_not_in_directory');
  });

  it('an ABS qualifier is not a missing suburb', async () => {
    // ABS publishes `Springfield (Qld)`; no directory carries the bracket.
    const qualified = placed('4300', 'Springfield (Qld)', '213021455');
    const supabase = fakeSupabase({
      suburb_directory: [{ suburb: 'Springfield', state: 'QLD', postcode: '4300' }],
    });
    const outcome = await resolveOneReportGeography({
      supabase,
      reportId: '11111111-2222-3333-4444-555555555555',
      latitude: -27.6667, longitude: 152.9167,
      lookupPoint: async () => qualified,
    });
    expect(outcome.directoryChecked).toBe(true);
    expect(outcome.row?.flags).not.toContain('suburb_not_in_directory');
  });
});
