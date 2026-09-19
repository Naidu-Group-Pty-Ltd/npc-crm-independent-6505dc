/**
 * No invented figures in the report pipeline — the contracts, pinned.
 *
 * Measured in production on 2026-09-06, before the removal these tests guard:
 *
 *  - `abs-data-service` never called the ABS (its four live-API functions had
 *    no caller) and served one of THREE invented profiles with Math.random()
 *    jitter, labelled `ABS Census 2021 estimates`. **849 of 1,199 stored
 *    reports, across 500 distinct properties, carried the identical profile**
 *    (growth 2.5, unemployment 3.5, owner-occupiers 69.8, participation
 *    68.4), and `10 Chester Street` held 20 reports with 20 different
 *    populations — 16,245 to 38,773.
 *  - `public-transport-service` told every NSW property it was 450m from
 *    Central Station, whatever its coordinate.
 *  - `abs-employment-service` returned `15000 * (0.5 + Math.random() * 0.5)`
 *    as a labour-force size under `dataset: '6202.0 - Labour Force,
 *    Australia'`.
 *  - Four cache tables (abs 123, climate 1,237, crime 140, transport 639)
 *    held **2,139 rows, 100% `estimated`, zero live** — the fabrications
 *    were cached for 30–365 days and served back as cache hits.
 *
 * The gate `scripts/security/check-fabricated-data.mjs` enforces the ratchet
 * in the security job; these tests pin the *shape* of the honest answers and
 * the consumer guards in the verify job, so the two cannot drift apart
 * unnoticed.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isSourceUnavailable,
  sourceUnavailable,
} from '../../../../supabase/functions/_shared/sourceUnavailable.pure';

const REPO = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf8');
const service = (name: string) => read(`supabase/functions/${name}/index.ts`);

/** Comments carry the history of what was removed; judge only the code. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

// ---------------------------------------------------------------------------
// The envelope
// ---------------------------------------------------------------------------

describe('sourceUnavailable — the one honest answer', () => {
  it('carries no field a figure could hide in', () => {
    const body = sourceUnavailable('abs-demographics', 'source_not_integrated', 'ABS Census data is not yet integrated.');
    expect(body).toEqual({
      success: false,
      data: null,
      unavailable: true,
      service: 'abs-demographics',
      reason: 'source_not_integrated',
      message: 'ABS Census data is not yet integrated.',
    });
    // Every consumer attaches only on `success && data`, so this shape is
    // structurally unable to reach a report.
    expect(body.success && body.data).toBeFalsy();
  });

  it('isSourceUnavailable distinguishes an envelope from a payload', () => {
    expect(isSourceUnavailable(sourceUnavailable('x', 'provider_error', 'm'))).toBe(true);
    // The public-transport shape historically had NO success wrapper — a bare
    // payload. It must not read as an envelope, and vice versa.
    expect(isSourceUnavailable({ nearestStop: 'Central Station', qualityScore: 85 })).toBe(false);
    expect(isSourceUnavailable(null)).toBe(false);
    expect(isSourceUnavailable({ success: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The services answer honestly
// ---------------------------------------------------------------------------

describe('every de-fabricated service refuses instead of inventing', () => {
  it.each([
    ['abs-data-service', 'getMockABSData'],
    ['abs-data-service', 'generateEnhancedABSData'],
    ['abs-employment-service', 'generateEmploymentEstimate'],
    ['abs-seifa-service', 'generateSEIFAEstimate'],
    ['climate-data-service', 'generateClimateEstimate'],
    ['crime-statistics-service', 'generateEnhancedCrimeData'],
    ['location-intelligence-service', 'generateMockLocationData'],
    ['public-transport-service', 'generateFallbackData'],
    ['rba-data-service', 'getFallbackData'],
    ['school-data-service', 'generateSchoolEstimates'],
    ['risk-assessment-service', 'generateBushfireEstimate'],
    ['risk-assessment-service', 'generateFloodEstimate'],
  ])('%s no longer contains %s', (name, ghost) => {
    expect(stripComments(service(name))).not.toMatch(new RegExp(`\\b${ghost}\\s*\\(`));
  });

  it.each([
    'abs-data-service', 'abs-employment-service', 'abs-seifa-service',
    'climate-data-service', 'crime-statistics-service',
    'location-intelligence-service', 'public-transport-service',
    'rba-data-service', 'school-data-service',
  ])('%s answers through the shared envelope', (name) => {
    expect(service(name)).toContain('sourceUnavailable(');
  });

  it('no service stamps a statistical agency on an estimate any more', () => {
    // The exact source strings the fabricators wore. Real integrations will
    // cite the ABS with a dataset and a reference period — never these.
    for (const name of ['abs-data-service', 'abs-employment-service', 'abs-seifa-service']) {
      const src = stripComments(service(name));
      expect(src, name).not.toContain('ABS Census 2021 estimates');
      expect(src, name).not.toContain('Estimated based on');
      expect(src, name).not.toContain("lastUpdated: 'Latest available data'");
    }
  });

  it('the invented amenities are gone from location intelligence', () => {
    const src = stripComments(service('location-intelligence-service'));
    for (const invention of ['Primary School A', 'High School B', 'Private College C', 'usingMockData: true']) {
      expect(src).not.toContain(invention);
    }
  });

  it('the hard-coded landmark stops are gone from public transport', () => {
    const src = stripComments(service('public-transport-service'));
    for (const landmark of ['Central Station', 'Flinders Street Station', 'Swanston Street']) {
      expect(src).not.toContain(landmark);
    }
  });

  it('risk fallbacks read Unknown, and an outage is never cached', () => {
    const src = service('risk-assessment-service');
    expect(src).toContain('floodRiskUnavailable');
    expect(src).toContain('bushfireRiskUnavailable');
    // The suburb-name folklore is gone: "hills" is not a bushfire rating.
    const code = stripComments(src);
    expect(code).not.toContain("'blue mountains'");
    expect(code).not.toContain('veryHighRiskAreas');
    expect(code).not.toContain('highRiskSuburbs');
    // Only real readings are cached.
    expect(src).toMatch(/if \(!floodUnavailable && !bushfireUnavailable\) \{\s*\n\s*await cacheRiskData/);
  });

  it('rba serves the loaded statistical tables and refuses when they are empty', () => {
    // The M-stream removed the whole failure mode this test used to pin:
    // there is no live retrieval and no 24h cache to poison any more. The
    // service reads rba_observations (loaded by rba-tables-ingest) and an
    // empty store answers sourceUnavailable — never a remembered figure.
    const src = service('rba-data-service');
    const code = stripComments(src);
    expect(code.toLowerCase()).not.toContain('perplexity');
    expect(code).not.toContain('economic_data_cache');
    expect(code).toContain("from('rba_observations')");
    expect(code).toContain('if (!reading) {');
    expect(code).toContain("sourceUnavailable(");
  });
});

// ---------------------------------------------------------------------------
// The consumers cannot mistake a refusal for data
// ---------------------------------------------------------------------------

describe('consumer guards', () => {
  it('the generator attaches phase-1 data only on success && data', () => {
    const src = read('supabase/functions/generate-investment-report/index.ts');
    expect(src).toContain('if (fulfilled && fulfilled.success && fulfilled.data) {');
    // And no call site hands fetchServiceWithFallback a fabricated default.
    expect(src).not.toMatch(/fetchServiceWithFallback\([^)]*,\s*\{[^}]*\}\s*\)/);
  });

  it('regeneration attaches only on success && data', () => {
    const src = read('supabase/functions/regenerate-report-qualitative/index.ts');
    // The per-call-site guards, for the services fetched by locality.
    for (const guard of [
      'absData?.success && absData?.data',
      'employmentData?.success && employmentData?.data',
    ]) {
      expect(src).toContain(guard);
    }
    // The coordinate-keyed services (climate, planning, regional trends and
    // the QLD crime retry) share ONE fetch helper, so the same rule is
    // enforced once rather than copied per call site — the helper yields
    // the payload only on success && data, and null otherwise, which is
    // what makes `if (data) enhancedData.X = data` safe. Asserting the
    // helper is stricter than asserting three duplicate expressions: a new
    // coordinate-keyed service inherits the guard instead of needing its
    // own copy, and cannot be added without one.
    expect(src).toContain('return parsed?.success && parsed?.data ? parsed.data : null;');
    for (const [field, service] of [
      ['climateData', 'climate-data-service'],
      ['planningData', 'planning-data-service'],
      ['regionalTrends', 'abs-regional-service'],
      ['crimeStatistics', 'crime-statistics-service'],
    ] as const) {
      // Assigned from the helper's return value, never from a raw body.
      expect(src, `${field} must be attached from the guarded helper`)
        .toMatch(new RegExp(`const data = await ask\\([^;]*${service}[\\s\\S]{0,200}?enhancedData\\.${field} = data;`));
    }
  });

  it('location intelligence rejects a transport envelope rather than reading it as stops', () => {
    // The transport service historically returned a BARE payload — no success
    // field — so an envelope would otherwise be truthy, and `transportInfo`
    // would prefer a refusal over Google's real, coordinate-measured transit.
    const src = read('supabase/functions/location-intelligence-service/index.ts');
    expect(src).toContain('isSourceUnavailable(transportBody)');
  });
});

// ---------------------------------------------------------------------------
// The purge is real and keeps what a real integration writes
// ---------------------------------------------------------------------------

describe('the cache purge', () => {
  const migration = read('supabase/migrations/20261112020000_purge_fabricated_source_caches.sql');

  it('purges exactly the four fabricated caches', () => {
    for (const table of ['abs_census_cache', 'climate_data_cache', 'crime_statistics_cache', 'transport_data_cache']) {
      expect(migration).toContain(`delete from public.${table}`);
    }
    // risk_assessment_cache is real (AFRIP) and must never be purged by this.
    expect(migration).not.toContain('risk_assessment_cache');
  });

  it("deletes only 'estimated' rows, so a real integration's rows survive", () => {
    const deletes = migration.split('\n').filter((l) => l.trim().startsWith('delete from'));
    expect(deletes).toHaveLength(4);
    for (const line of deletes) {
      expect(line).toContain("where data_quality = 'estimated'");
    }
  });

  it('the abs services read the loaded Census reference tables', () => {
    // The interregnum's live-only cache read was replaced by the real thing:
    // abs_census_poa / abs_seifa_poa, loaded from the ABS's published files
    // by abs-poa-ingest and projected through one shared module.
    expect(service('abs-data-service')).toContain("from('abs_census_poa')");
    expect(service('abs-employment-service')).toContain("from('abs_census_poa')");
    expect(service('abs-seifa-service')).toContain("from('abs_seifa_poa')");
    expect(service('abs-data-service')).toContain('censusDemographicsResponse');
    expect(service('abs-employment-service')).toContain('censusEmploymentResponse');
  });
});
