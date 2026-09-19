import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PLACES_CATEGORIES,
  measuredCount,
  measuredDistance,
  measuredName,
  measuredWalkScore,
  placesAreComplete,
  unavailableCategories,
  type PlacesLookup,
  type PlacesLookups,
} from '../../../../supabase/functions/_shared/reports/location/placesAvailability.pure.ts';
import {
  assessEnrichmentReuse,
  stampAcquisition,
  subjectKeyFor,
} from '../../../../supabase/functions/_shared/reports/location/locationEnrichmentReuse.pure.ts';

/**
 * RF-7.2B.1B2 — a Places lookup that FAILED must never become a factual zero.
 *
 * The measured defect, before this change: `fetchNearbyPlaces` swallows a
 * failed call into `{ ok: false, count: 0, results: [] }`, and the persisted
 * object took `.count` and `.results[0]?.name || 'N/A'` directly — so a
 * category whose provider never answered stored exactly what a category with
 * genuinely nothing nearby stores. `regenerate-report-qualitative` then
 * composed the model's location context with
 *
 *     if (typeof healthcare === 'number')
 *       lines.push(`- Healthcare facilities within 5km: ${healthcare}`);
 *
 * and `typeof 0 === 'number'`, so a Places outage was handed to the model as a
 * measured fact. These tests are the §4 matrix A–E.
 */

const REPO = resolve(__dirname, '../../../..');
const locationService = readFileSync(
  resolve(REPO, 'supabase/functions/location-intelligence-service/index.ts'),
  'utf8',
);

const answered = (count: number, names: string[] = []): PlacesLookup => ({
  ok: true,
  count,
  results: names.map((name, i) => ({ name, distance: 0.4 + i, rating: 4 })),
});
const failed = (): PlacesLookup => ({ ok: false, count: 0, results: [] });

const allAnswered = (): PlacesLookups => ({
  transit: answered(3, ['Cowra Station']),
  schools: answered(4, ['Cowra Public School']),
  healthcare: answered(2, ['Cowra Health Service']),
  shopping: answered(1, ['Cowra Marketplace']),
  recreation: answered(5, ['Bellevue Hill Reserve']),
  restaurants: answered(9, ['Cafe on Kendal']),
});

/** The projection the edge function performs, exercised through the module. */
const project = (l: PlacesLookups) => ({
  schools: {
    nearestSchool: measuredName(l.schools),
    distanceToSchool: measuredDistance(l.schools),
    schoolsWithin3km: measuredCount(l.schools),
  },
  healthcare: {
    nearestHospital: measuredName(l.healthcare),
    distanceToHospital: measuredDistance(l.healthcare),
    facilitiesWithin5km: measuredCount(l.healthcare),
  },
  lifestyle: {
    shoppingCenters: measuredCount(l.shopping),
    parks: measuredCount(l.recreation),
    restaurants: measuredCount(l.restaurants),
    nearestShopping: measuredName(l.shopping),
    nearestPark: measuredName(l.recreation),
  },
  transport: {
    nearestStation: measuredName(l.transit),
    distanceToStation: measuredDistance(l.transit),
    stationsWithin2km: measuredCount(l.transit),
  },
});

/**
 * The exact guard `regenerate-report-qualitative` applies when it composes the
 * model's location context. Copied as a predicate so the test measures the
 * CONSUMER's behaviour rather than only the producer's output.
 */
const contextLines = (loc: ReturnType<typeof project>): string[] => {
  const lines: string[] = [];
  const healthcare = loc.healthcare?.facilitiesWithin5km;
  if (typeof healthcare === 'number') lines.push(`- Healthcare facilities within 5km: ${healthcare}`);
  const shops = loc.lifestyle?.shoppingCenters;
  if (typeof shops === 'number') lines.push(`- Shopping centres nearby: ${shops}`);
  const nearestSchool = loc.schools?.nearestSchool;
  if (typeof nearestSchool === 'string' && nearestSchool.trim() !== '' && nearestSchool !== 'N/A') {
    lines.push(`- Nearest school: ${nearestSchool}`);
  }
  return lines;
};

describe('RF-7.2B.1B2 §4 — partial Places failure must not become factual absence', () => {
  // -- A -------------------------------------------------------------------
  it('A — a SUCCESSFUL Schools request with zero results is a valid measured zero', () => {
    const lookups: PlacesLookups = { ...allAnswered(), schools: answered(0) };

    expect(measuredCount(lookups.schools)).toBe(0);
    expect(placesAreComplete(lookups)).toBe(true);
    expect(unavailableCategories(lookups)).toEqual([]);

    // A reached-and-empty category keeps its zero: a rural address with no
    // school within 3 km is a fact worth printing.
    const loc = project(lookups);
    expect(loc.schools.schoolsWithin3km).toBe(0);
    // And the walk score stays measurable, because every category answered.
    expect(measuredWalkScore(41, lookups)).toBe(41);
  });

  // -- B -------------------------------------------------------------------
  it('B — a FAILED Schools request is unavailable, never a factual zero', () => {
    const lookups: PlacesLookups = { ...allAnswered(), schools: failed() };

    expect(measuredCount(lookups.schools)).toBeNull();
    expect(measuredCount(lookups.schools)).not.toBe(0);
    expect(measuredName(lookups.schools)).toBeNull();
    expect(measuredDistance(lookups.schools)).toBeNull();

    expect(placesAreComplete(lookups)).toBe(false);
    expect(unavailableCategories(lookups)).toEqual(['schools']);

    const loc = project(lookups);
    expect(loc.schools.schoolsWithin3km).toBeNull();
    expect(loc.schools.nearestSchool).toBeNull();
    // Never the truthy sentinel: 'N/A' survives every `||` fallback in the
    // generator's prompt and reaches the model as though it were a value.
    expect(loc.schools.nearestSchool).not.toBe('N/A');

    // A composite over an incomplete basis is absent, not depressed.
    expect(measuredWalkScore(41, lookups)).toBeNull();
  });

  it('B2 — the same holds for every one of the six categories', () => {
    for (const category of PLACES_CATEGORIES) {
      const lookups: PlacesLookups = { ...allAnswered(), [category]: failed() } as PlacesLookups;
      expect(measuredCount(lookups[category])).toBeNull();
      expect(measuredName(lookups[category])).toBeNull();
      expect(measuredDistance(lookups[category])).toBeNull();
      expect(unavailableCategories(lookups)).toEqual([category]);
      expect(measuredWalkScore(60, lookups)).toBeNull();
    }
  });

  // -- C -------------------------------------------------------------------
  it('C — retries exhausted: the acquisition is REUSED but the failed category stays unavailable', () => {
    const subject = { address: '48 Redfern Street, Cowra', postcode: '2794', state: 'NSW' };
    const lookups: PlacesLookups = { ...allAnswered(), healthcare: failed() };

    const stored = stampAcquisition(
      { coordinates: { lat: -33.8329, lng: 148.6934 }, ...project(lookups) } as Record<string, unknown>,
      {
        subjectKey: subjectKeyFor(subject),
        acquiredAt: '2026-09-12T11:00:00.000Z',
        stages: {
          geocode: 'fetched',
          places: placesAreComplete(lookups) ? 'complete' : 'partial',
          placesUnavailable: unavailableCategories(lookups),
          commute: 'measured',
        },
        matchedAddress: '48 Redfern St, Cowra NSW 2794, Australia',
        attempt: 3,
      },
    );

    // The bounded retry is spent, so the enrichment is reused rather than
    // re-bought — that is RF-7.2B.1B1 and is unchanged.
    const decision = assessEnrichmentReuse(stored, subject);
    expect(decision.reuse).toBe(true);
    expect(decision.verdict).toBe('partial_retry_exhausted');

    // Reuse is NOT a promotion to complete. The record still says partial,
    // still names which category, and the figure is still absent.
    const stamp = (stored as Record<string, any>).__acquisition;
    expect(stamp.stages.places).toBe('partial');
    expect(stamp.stages.placesUnavailable).toEqual(['healthcare']);
    expect((stored as any).healthcare.facilitiesWithin5km).toBeNull();
    expect((stored as any).healthcare.nearestHospital).toBeNull();
  });

  // -- D -------------------------------------------------------------------
  it('D — the categories that DID answer in a partial acquisition stay usable', () => {
    const lookups: PlacesLookups = { ...allAnswered(), healthcare: failed() };
    const loc = project(lookups);

    expect(loc.schools.schoolsWithin3km).toBe(4);
    expect(loc.schools.nearestSchool).toBe('Cowra Public School');
    expect(loc.lifestyle.shoppingCenters).toBe(1);
    expect(loc.lifestyle.parks).toBe(5);
    expect(loc.lifestyle.restaurants).toBe(9);
    expect(loc.transport.stationsWithin2km).toBe(3);
    expect(loc.transport.nearestStation).toBe('Cowra Station');

    // Only the failed one is withheld.
    expect(loc.healthcare.facilitiesWithin5km).toBeNull();
  });

  // -- E -------------------------------------------------------------------
  it('E — the model is never handed a zero for a category whose provider failed', () => {
    const healthy = contextLines(project(allAnswered()));
    expect(healthy).toContain('- Healthcare facilities within 5km: 2');
    expect(healthy).toContain('- Shopping centres nearby: 1');

    const outage = contextLines(project({
      ...allAnswered(),
      healthcare: failed(),
      shopping: failed(),
    }));
    // The lines are OMITTED — §3's "omit the unsupported category" — rather
    // than asserting an absence nobody measured.
    expect(outage.some((l) => l.startsWith('- Healthcare facilities'))).toBe(false);
    expect(outage.some((l) => l.startsWith('- Shopping centres'))).toBe(false);
    expect(outage.join('\n')).not.toMatch(/:\s*0\b/);
    // The category that answered is untouched.
    expect(outage).toContain('- Nearest school: Cowra Public School');
  });

  it('E2 — a genuine measured zero still reaches the model, because it is a fact', () => {
    const lines = contextLines(project({ ...allAnswered(), healthcare: answered(0) }));
    expect(lines).toContain('- Healthcare facilities within 5km: 0');
  });

  // -- the producer cannot reintroduce the sentinel ------------------------
  it('the location service no longer writes a truthy sentinel for an unmeasured place', () => {
    for (const sentinel of [
      "nearestSchool: schoolsData.results[0]?.name || 'N/A'",
      "nearestHospital: healthcareData.results[0]?.name || 'N/A'",
      "nearestShopping: shoppingData.results[0]?.name || 'N/A'",
      "nearestPark: recreationData.results[0]?.name || 'N/A'",
      "nearestStation: transitData.results[0]?.name || 'N/A'",
    ]) {
      expect(locationService).not.toContain(sentinel);
    }
    // and the counts are projected rather than taken raw
    for (const projected of [
      'schoolsWithin3km: measuredCount(schoolsData)',
      'facilitiesWithin5km: measuredCount(healthcareData)',
      'shoppingCenters: measuredCount(shoppingData)',
      'parks: measuredCount(recreationData)',
      'restaurants: measuredCount(restaurantsData)',
      'stationsWithin2km: measuredCount(transitData)',
    ]) {
      expect(locationService).toContain(projected);
    }
  });

  it('one implementation decides complete-vs-partial, shared with the stamp', () => {
    expect(locationService).toContain('placesAreComplete(placesLookups)');
    expect(locationService).not.toContain('].every((r) => r.ok)');
  });
});

/**
 * §4 — the distinction must survive PERSISTENCE and RESUME, not merely hold in
 * memory. This pipeline is resume-driven: `location_intelligence` is a jsonb
 * column, the enrichment is written once and read back by every later
 * invocation, and the report's own context is composed from the RELOADED
 * object rather than from the one the producer built.
 *
 * `persist()` is the real boundary: `JSON.stringify` then `JSON.parse`, which
 * is exactly what a jsonb write and read do to this object. It is what makes
 * `null` load-bearing rather than cosmetic — `undefined` would be DROPPED by
 * the serialiser, and a dropped key is a key a later reader cannot tell from
 * one that was never part of the schema.
 */
const persist = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** What the generator stores, and what a resume reads back. */
const storedFor = (l: PlacesLookups, attempt = 1) => stampAcquisition(
  {
    coordinates: { lat: -33.8329, lng: 148.6934 },
    walkScore: measuredWalkScore(41, l),
    ...project(l),
  } as Record<string, unknown>,
  {
    subjectKey: subjectKeyFor(SUBJECT),
    acquiredAt: '2026-09-12T11:00:00.000Z',
    stages: {
      geocode: 'fetched',
      places: placesAreComplete(l) ? 'complete' : 'partial',
      placesUnavailable: unavailableCategories(l),
      commute: 'measured',
    },
    matchedAddress: '48 Redfern St, Cowra NSW 2794, Australia',
    attempt,
  },
);

const SUBJECT = { address: '48 Redfern Street, Cowra', postcode: '2794', state: 'NSW' };

/**
 * The scorer's input builder, as `investment-scoring-service` writes it.
 * Copied so the test measures that consumer rather than only the producer.
 */
const scorerInput = (loc: any) => ({
  walkScore: loc.walkScore ?? undefined,
  schoolsNearby: loc.schools?.schoolsWithin3km ?? undefined,
});
const hasNum = (v: unknown) => typeof v === 'number' && !Number.isNaN(v);

describe('RF-7.2B.1B2 §4 — the distinction survives persistence and resume', () => {
  // -- A -------------------------------------------------------------------
  it('A — a successful zero reloads as a measured zero', () => {
    const lookups: PlacesLookups = { ...allAnswered(), schools: answered(0) };
    const reloaded = persist(storedFor(lookups)) as any;

    expect(reloaded.schools.schoolsWithin3km).toBe(0);
    expect(reloaded.schools.schoolsWithin3km).not.toBeNull();
    expect(reloaded.__acquisition.stages.places).toBe('complete');
    expect(reloaded.__acquisition.stages.placesUnavailable).toEqual([]);
    // Every category answered, so the composite is still measurable.
    expect(reloaded.walkScore).toBe(41);

    // A complete acquisition is reused on resume rather than re-bought.
    const decision = assessEnrichmentReuse(reloaded, SUBJECT);
    expect(decision.reuse).toBe(true);
    expect(decision.verdict).toBe('reusable');

    // and the reloaded zero is still a fact the report may state.
    expect(scorerInput(reloaded).schoolsNearby).toBe(0);
    expect(hasNum(scorerInput(reloaded).schoolsNearby)).toBe(true);
  });

  // -- B -------------------------------------------------------------------
  it('B — a failed lookup reloads as unavailable, never as 0, N/A or []', () => {
    const lookups: PlacesLookups = { ...allAnswered(), schools: failed() };
    const reloaded = persist(storedFor(lookups)) as any;

    expect(reloaded.schools.schoolsWithin3km).toBeNull();
    expect(reloaded.schools.nearestSchool).toBeNull();
    expect(reloaded.schools.distanceToSchool).toBeNull();

    // Explicitly none of the shapes that could be mistaken for measured absence.
    for (const mistakable of [0, 'N/A', '', 'n/a']) {
      expect(reloaded.schools.schoolsWithin3km).not.toBe(mistakable);
      expect(reloaded.schools.nearestSchool).not.toBe(mistakable);
    }
    // The key SURVIVES the round-trip as an explicit null rather than being
    // dropped — `undefined` would vanish here and read as "never collected".
    expect(Object.prototype.hasOwnProperty.call(reloaded.schools, 'schoolsWithin3km')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(reloaded.schools, 'nearestSchool')).toBe(true);

    // The stamp reloads naming the category.
    expect(reloaded.__acquisition.stages.places).toBe('partial');
    expect(reloaded.__acquisition.stages.placesUnavailable).toEqual(['schools']);

    // And the scorer sees absence, not a zero it would count as evidence.
    expect(scorerInput(reloaded).schoolsNearby).toBeUndefined();
    expect(hasNum(scorerInput(reloaded).schoolsNearby)).toBe(false);
  });

  // -- C -------------------------------------------------------------------
  it('C — a partial acquisition reloads with the good categories intact', () => {
    const lookups: PlacesLookups = { ...allAnswered(), healthcare: failed() };
    const reloaded = persist(storedFor(lookups, 3)) as any;

    // successful categories survive
    expect(reloaded.schools.schoolsWithin3km).toBe(4);
    expect(reloaded.schools.nearestSchool).toBe('Cowra Public School');
    expect(reloaded.lifestyle.shoppingCenters).toBe(1);
    expect(reloaded.lifestyle.parks).toBe(5);
    expect(reloaded.lifestyle.restaurants).toBe(9);
    expect(reloaded.transport.stationsWithin2km).toBe(3);

    // the failed one stays unavailable
    expect(reloaded.healthcare.facilitiesWithin5km).toBeNull();
    expect(reloaded.healthcare.nearestHospital).toBeNull();

    // the stamp identifies it, and reuse is the bounded-retry answer
    expect(reloaded.__acquisition.stages.placesUnavailable).toEqual(['healthcare']);
    const decision = assessEnrichmentReuse(reloaded, SUBJECT);
    expect(decision.reuse).toBe(true);
    expect(decision.verdict).toBe('partial_retry_exhausted');
    // reuse is not promotion: the record still says partial after reloading
    expect(reloaded.__acquisition.stages.places).toBe('partial');

    // the composite stays unavailable rather than depressed
    expect(reloaded.walkScore).toBeNull();
    expect(scorerInput(reloaded).walkScore).toBeUndefined();
    expect(hasNum(scorerInput(reloaded).walkScore)).toBe(false);
  });

  // -- D -------------------------------------------------------------------
  it('D — after resume the model context still omits the failed category', () => {
    const outage = persist(storedFor({
      ...allAnswered(), healthcare: failed(), shopping: failed(),
    })) as any;

    const lines = contextLines(outage);
    expect(lines.some((l) => l.startsWith('- Healthcare facilities'))).toBe(false);
    expect(lines.some((l) => l.startsWith('- Shopping centres'))).toBe(false);
    expect(lines.join('\n')).not.toMatch(/:\s*0\b/);
    expect(lines).toContain('- Nearest school: Cowra Public School');

    // and a genuine zero still reaches it after the same round-trip
    const measured = persist(storedFor({ ...allAnswered(), healthcare: answered(0) })) as any;
    expect(contextLines(measured)).toContain('- Healthcare facilities within 5km: 0');
  });

  it('the resume path hands the stored object straight through, uncoerced', () => {
    const generator = readFileSync(
      resolve(REPO, 'supabase/functions/generate-investment-report/index.ts'), 'utf8',
    );
    // RF-7.2B.1B1's reuse branch assigns the persisted object itself — there is
    // no re-projection on resume that could reintroduce a zero.
    expect(generator).toContain('locationIntelligence: existingEnhancedFields.locationIntelligence');
    // and the scorer no longer floors an absent figure at zero
    const scorer = readFileSync(
      resolve(REPO, 'supabase/functions/investment-scoring-service/index.ts'), 'utf8',
    );
    expect(scorer).not.toContain('schoolsNearby: schools.schoolsWithin3km || 0');
    expect(scorer).not.toContain('const walkScore = locationIntelligence.walkScore || 0;');
    expect(scorer).toContain('schoolsNearby: schools.schoolsWithin3km ?? undefined');
    expect(scorer).toContain('const walkScore = locationIntelligence.walkScore ?? undefined;');
  });

  it('no scoring input builder floors an unavailable Places figure at zero', () => {
    // The targeted sentinel scan found the same `|| 0` in three builders, not
    // one. All three are pinned here by the RULE rather than by one file, so a
    // fourth builder copied from any of them fails this test rather than
    // shipping a livability score depressed by a provider outage.
    for (const builder of [
      'supabase/functions/investment-scoring-service/index.ts',
      'supabase/functions/_shared/investmentScoreEngine.ts',
      'supabase/functions/backfill-investment-scores/index.ts',
    ]) {
      const src = readFileSync(resolve(REPO, builder), 'utf8');
      expect(src, builder).not.toMatch(/walkScore:\s*locationIntelligence\.walkScore\s*\|\|\s*0/);
      expect(src, builder).not.toMatch(/schoolsNearby:\s*schools\.schoolsWithin3km\s*\|\|\s*0/);
      expect(src, builder).toMatch(/schoolsNearby:\s*schools\.schoolsWithin3km\s*\?\?\s*undefined/);
    }
  });

  it('`?? undefined` keeps a measured zero and drops an unavailable one', () => {
    // The whole semantic difference, stated as arithmetic. `||` cannot tell
    // these apart; `??` can.
    const measuredZero = 0 as number | null;
    const unavailable = null as number | null;
    expect(measuredZero ?? undefined).toBe(0);
    expect(unavailable ?? undefined).toBeUndefined();
    // what the old operator did instead
    expect(measuredZero || 0).toBe(0);
    expect(unavailable || 0).toBe(0);   // <- the defect, in one line
  });
});
