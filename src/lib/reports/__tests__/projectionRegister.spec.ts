/**
 * A population projection read from the register, and the one block a report
 * may print from it. Five rules, each one a failure already paid for once.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  planningCouncilName,
  OWN_AREA_KINDS,
  PROJECTION_AREA_KINDS,
  PROJECTION_AREA_LABEL,
  availabilityOfRead,
  forwardDemandStatement,
  projectionColumns,
  projectionDescribesTheArea,
  projectionTableBlock,
  readingFromRows,
  type ProjectionRegisterRead,
  type ProjectionRow,
} from '../../../../supabase/functions/_shared/reports/market/openData/projectionRegister.pure';
import { A_PROJECTION_IS_NOT_A_MEASUREMENT } from '../../../../supabase/functions/_shared/reports/market/openData/absPopulationProjections.pure';
import { FORWARD_DEMAND_PUBLISHERS } from '../../../../supabase/functions/_shared/reports/market/openData/forwardDemand.pure';
import { forwardDemandBlocks, regionalTrendBlocks } from '../../../../supabase/functions/_shared/reports/regionalPromptBlocks.pure';

const row = (over: Partial<ProjectionRow>): ProjectionRow => ({
  state: 'QLD',
  release: 'Queensland Government population projections, 2023 edition',
  series: 'Medium series',
  measure: 'persons',
  area_kind: 'sa2',
  area_code: '310011274',
  area: 'Kelvin Grove - Herston',
  area_token: 'KELVIN GROVE HERSTON',
  year: 2021,
  year_kind: 'projected',
  value: 1000,
  publisher: 'Queensland Government Statistician’s Office',
  source_url: 'https://www.qgso.qld.gov.au/',
  licence: 'CC BY 4.0',
  loaded_at: '2026-09-24T03:00:00.000Z',
  ...over,
});

const series = (name: string, values: Array<[number, number, boolean?]>) =>
  values.map(([year, value, base]) => row({ series: name, year, value, year_kind: base ? 'base' : 'projected' }));

describe('a reading is built from the register, never assumed', () => {
  it('groups one area’s rows into every series the publisher released', () => {
    const r = readingFromRows([
      ...series('Medium series', [[2021, 10_000, true], [2026, 10_800], [2031, 11_500]]),
      ...series('Low series', [[2021, 10_000, true], [2026, 10_400], [2031, 10_700]]),
      ...series('High series', [[2021, 10_000, true], [2026, 11_100], [2031, 12_300]]),
    ]);
    expect(r?.series.map((s) => s.series)).toEqual(['High series', 'Low series', 'Medium series']);
    expect(r?.series[0].points[0]).toEqual({ year: 2021, value: 10_000, base: true });
  });

  it('reads persons only, and one edition — the one that reaches furthest', () => {
    const r = readingFromRows([
      ...series('Medium series', [[2021, 10_000, true], [2046, 14_000]]),
      row({ measure: 'households', year: 2046, value: 6_000 }),
      row({ release: '2018 edition', year: 2041, value: 12_000 }),
    ]);
    expect(r?.release).toBe('Queensland Government population projections, 2023 edition');
    expect(r?.series).toHaveLength(1);
    expect(r?.series[0].points.map((p) => p.year)).toEqual([2021, 2046]);
  });

  it('drops a series that is only a base, and reads nothing from nothing', () => {
    expect(readingFromRows(series('Medium series', [[2021, 10_000, true]]))).toBeNull();
    expect(readingFromRows([])).toBeNull();
  });

  it('carries the newest load as the day the register took it', () => {
    const r = readingFromRows([
      row({ year: 2026, loaded_at: '2026-09-24T03:00:00.000Z' }),
      row({ year: 2031, loaded_at: '2026-09-25T03:00:00.000Z' }),
    ]);
    expect(r?.loadedAt).toBe('2026-09-25T03:00:00.000Z');
  });
});

describe('a region is not an area', () => {
  it('lets only SA2, SA3 and the publisher’s suburb describe the property’s own area', () => {
    expect([...OWN_AREA_KINDS].sort()).toEqual(['sa2', 'sa3', 'suburb']);
    for (const k of PROJECTION_AREA_KINDS) {
      expect(projectionDescribesTheArea(k), k).toBe(OWN_AREA_KINDS.includes(k));
      expect(PROJECTION_AREA_LABEL[k].length, k).toBeGreaterThan(5);
    }
  });

  it('prints a coarser projection under the sentence that says so', () => {
    const r = readingFromRows(series('Band C', [[2021, 90_000, true], [2031, 99_000]])
      .map((x) => ({ ...x, area_kind: 'lga' as const, area: 'City of Stirling' })));
    const block = projectionTableBlock(r!);
    expect(block).toMatch(/a region this property sits in rather than its own area/);
    const own = projectionTableBlock(readingFromRows(series('Band C', [[2021, 9_000, true], [2031, 9_900]]))!);
    expect(own).not.toMatch(/region this property sits in/);
  });
});

describe('the block a report may print', () => {
  const reading = readingFromRows([
    ...series('Medium series', [[2021, 10_000, true], [2026, 10_800], [2031, 11_500], [2036, 12_100], [2041, 12_600], [2046, 13_000]]),
    ...series('Low series', [[2021, 10_000, true], [2026, 10_400], [2031, 10_700], [2036, 10_900], [2041, 11_000], [2046, 11_100]]),
  ])!;

  it('labels the base as the estimate it is, and ends on the publisher’s own horizon', () => {
    const cols = projectionColumns(reading);
    expect(cols).toEqual([2021, 2026, 2031, 2036, 2041, 2046]);
    const block = projectionTableBlock(reading);
    expect(block).toContain('2021 (estimated base)');
    expect(block).toMatch(/do not describe the estimated base as a projection/);
  });

  it('prints every series and prefers none', () => {
    const block = projectionTableBlock(reading);
    expect(block).toContain('| Low series |');
    expect(block).toContain('| Medium series |');
    expect(block).toMatch(/None is preferred here/);
  });

  it('carries provenance with every figure, and the statement that it is not a measurement', () => {
    const block = projectionTableBlock(reading);
    expect(block).toContain('Source: Queensland Government Statistician’s Office, Queensland Government population projections, 2023 edition, CC BY 4.0.');
    // The date a reader sees is the reader's format (`auDate`), never an ISO
    // prefix — this assertion pinned `2026-09-24` until the prose-date rule
    // reached the register.
    expect(block).toContain('Taken into this platform\'s register on 24 Sep 2026.');
    expect(block).not.toMatch(/\b\d{4}-\d{2}-\d{2}\b/);
    expect(block).toContain(A_PROJECTION_IS_NOT_A_MEASUREMENT);
    expect(block).toMatch(/State no other projected population, growth rate or horizon/);
  });

  it('writes a gap as a dash, never as a zero', () => {
    const gappy = readingFromRows([
      ...series('A', [[2021, 5_000, true], [2031, 5_500]]),
      ...series('B', [[2021, 5_000, true], [2026, 5_200], [2031, 5_600]]),
    ])!;
    const block = projectionTableBlock(gappy);
    expect(block).toMatch(/\| A \| 5,000 \| — \| 5,500 \|/);
    expect(block).not.toMatch(/\| 0 \|/);
  });

  it('opens no table row with the word the regional block forbids', () => {
    // `absRegionalRealData.spec.ts` refuses a row starting "Project…" in the
    // backward-looking table; this block must not collide with that rule.
    expect(projectionTableBlock(reading)).not.toMatch(/\|\s*[Pp]roject/);
  });
});

describe('the columns a reader can compare with the publisher’s own table', () => {
  it('steps back from the horizon in fives when an annual series allows it', () => {
    const annual = readingFromRows(series('Medium series', [
      [2021, 100, true],
      ...Array.from({ length: 25 }, (_, i) => [2022 + i, 101 + i] as [number, number]),
    ]))!;
    expect(projectionColumns(annual)).toEqual([2021, 2026, 2031, 2036, 2041, 2046]);
  });

  it('keeps the horizon when the years are too many for the columns', () => {
    const long = readingFromRows(series('Band C', [
      [2021, 100, true],
      ...Array.from({ length: 9 }, (_, i) => [2026 + i * 5, 110 + i] as [number, number]),
    ]))!;
    const cols = projectionColumns(long);
    expect(cols.length).toBeLessThanOrEqual(6);
    expect(cols[0]).toBe(2021);
    expect(cols[cols.length - 1]).toBe(2066);
  });

  it('falls back to the years it has when none are five apart', () => {
    const sparse = readingFromRows(series('X', [[2021, 100, true], [2023, 101], [2029, 102]]))!;
    expect(projectionColumns(sparse)).toEqual([2021, 2023, 2029]);
  });
});

describe('nothing here can reach the scorer', () => {
  it('constructs no EvidencePoint and imports none', () => {
    const src = readFileSync('supabase/functions/_shared/reports/market/openData/projectionRegister.pure.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/EvidencePoint/);
    expect(src).not.toMatch(/marketEvidence\.pure/);
  });
});


describe('one composer for the section and the pin', () => {
  const reading = readingFromRows(series('Medium series', [[2021, 10_000, true], [2026, 10_800], [2031, 11_500]]))!;
  const held: ProjectionRegisterRead = { kind: 'reading', reading, askedAt: 'sa2' };
  const absent = (absence: 'no_area_resolved' | 'none_for_area' | 'not_loaded' | 'unavailable'): ProjectionRegisterRead =>
    ({ kind: 'absent', absence, askedAt: 'sa2' });

  it('prints the publisher’s table for a reading, and nothing about absence', () => {
    const out = forwardDemandStatement(held, 'QLD');
    expect(out).toBe(projectionTableBlock(reading));
    expect(availabilityOfRead(held)).toBeNull();
  });

  it('keeps four absences as four sentences, none of them a figure', () => {
    const notes = (['no_area_resolved', 'none_for_area', 'not_loaded', 'unavailable'] as const)
      .map((a) => forwardDemandStatement(absent(a), 'QLD'));
    expect(new Set(notes).size).toBe(4);
    for (const n of notes) {
      expect(n).toMatch(/no projected figure/);
      expect(n).not.toMatch(/\|/);
      expect(n).not.toMatch(/\b(19|20)\d{2}\b/);
    }
    expect(availabilityOfRead(absent('none_for_area'))).toEqual({ kind: 'area_not_named' });
  });

  /*
   * A caller that never read the register is not a deployment with nothing
   * loaded. The regeneration path is one, and once a jurisdiction loads,
   * "No population projection has been loaded" would be false there.
   */
  it('says a caller that did not read did not read', () => {
    expect(forwardDemandStatement(null, 'QLD')).toMatch(/This report does not read a population projection/);
    expect(forwardDemandStatement(undefined, null)).toMatch(/limit of this report rather than a finding about the area/);
  });

  it('puts the table in the demographics block and lifts the flat prohibition only where a table is held', () => {
    const withTable = regionalTrendBlocks({
      state: 'QLD',
      forwardDemandProjection: held,
      regionalTrends: {
        sa2: { name: 'Kelvin Grove - Herston' },
        population: { latest: { year: 2024, erp: 10234 }, source: 'ABS Regional population' },
      },
    });
    expect(withTable).toContain(projectionTableBlock(reading));
    expect(withTable).toMatch(/a projected figure other than those in the forward-demand table below/);
    expect(withTable).not.toMatch(/Do NOT state an unemployment rate, a population projection,/);
    const without = regionalTrendBlocks({
      state: 'QLD',
      forwardDemandProjection: absent('not_loaded'),
      regionalTrends: {
        sa2: { name: 'Kelvin Grove - Herston' },
        population: { latest: { year: 2024, erp: 10234 }, source: 'ABS Regional population' },
      },
    });
    expect(without).toMatch(/Do NOT state an unemployment rate, a population projection,/);
    expect(without).toMatch(/No population projection for this jurisdiction has been loaded/);
  });

  it('pins exactly what the section says', () => {
    const input = { state: 'QLD', forwardDemandProjection: held };
    expect(regionalTrendBlocks(input)).toContain(forwardDemandBlocks(input));
    const absentInput = { state: 'QLD', forwardDemandProjection: absent('none_for_area') };
    expect(regionalTrendBlocks(absentInput)).toContain(forwardDemandBlocks(absentInput));
    expect(forwardDemandBlocks(absentInput)).toContain(FORWARD_DEMAND_PUBLISHERS.QLD.publisher);
  });
});

describe('the council a projection is asked by', () => {
  /*
   * Victoria in Future and Tasmania's Treasury project by council, and only
   * Queensland's cadastre answers a parcel cell — so a rung that read the
   * parcel alone would never have found either state's projection.
   */
  it('takes the cadastre\'s council first, then the zone layer\'s', () => {
    expect(planningCouncilName({ parcel: { status: 'ok', lga: 'Isaac Regional' }, zoning: { status: 'ok', lga: 'X', jurisdiction: 'QLD' } })).toBe('Isaac Regional');
    expect(planningCouncilName({ parcel: { status: 'not_integrated' }, zoning: { status: 'ok', lga: 'WYNDHAM', jurisdiction: 'VIC' } })).toBe('WYNDHAM');
    expect(planningCouncilName({ zoning: { status: 'ok', lga: 'HOBART', jurisdiction: 'TAS' } })).toBe('HOBART');
  });

  it('never asks by the ACT\'s division, which is a suburb and not a council', () => {
    expect(planningCouncilName({ zoning: { status: 'ok', lga: 'PHILLIP', jurisdiction: 'ACT' } })).toBeNull();
  });

  it('asks by nothing where no layer answered', () => {
    expect(planningCouncilName(null)).toBeNull();
    expect(planningCouncilName({ zoning: { status: 'unavailable', note: 'x' } })).toBeNull();
    expect(planningCouncilName({ zoning: { status: 'ok', lga: '  ', jurisdiction: 'NSW' } })).toBeNull();
  });
});

describe('the generator reads the register by trusted geography, stores it and pins it', () => {
  const generator = readFileSync('supabase/functions/generate-investment-report/index.ts', 'utf8');
  const regenerator = readFileSync('supabase/functions/regenerate-report-qualitative/index.ts', 'utf8');

  it('asks with the trusted state, the resolved SA2 code, suburb and cadastre council', () => {
    const at = generator.indexOf('await readProjectionRegister(supabase, {');
    expect(at).toBeGreaterThan(0);
    const call = generator.slice(at, at + 700);
    expect(call).toMatch(/state: \(trustedStateForForwardDemand\(subjectGeography, abbreviateState\)/);
    expect(call).toMatch(/sa2Code: typeof subjectGeography\?\.sa2_code === 'string'/);
    // New South Wales keys its SA2 projections by the ABS SA2 NAME, so the name travels too.
    expect(call).toMatch(/sa2Name: typeof subjectGeography\?\.sa2_name === 'string'/);
    expect(call).toMatch(/trustedSuburb: marketSuburb/);
    // The council comes from the planning answer at the verified point — the
    // cadastre's, or the zone layer's where no cadastre is read.
    expect(call).toMatch(/cadastreLga: planningCouncilName\(enhancedData\.planningData\)/);
    // The SA2 code travels from the resolution and from the stored-row fallback.
    expect(generator).toMatch(/sa2_code: geoOutcome\.row\.sa2_code/);
    expect(generator).toMatch(/sa2_name: geoOutcome\.row\.sa2_name/);
    expect(generator).toMatch(/\.select\('postcode, status, suburb, state, sa2_code, sa2_name'\)/);
  });

  it('stores the whole answer and pins it through the one composer', () => {
    expect(generator).toMatch(/buildingApprovals: approvals,\s*forwardDemandProjection,/);
    expect(generator).toMatch(/forwardDemandBlocks\(\{\s*state: trustedStateForForwardDemand\(subjectGeography, abbreviateState\),\s*forwardDemandProjection: enhancedData\.forwardDemandProjection \?\? null,/);
  });

  /*
   * The recorded asymmetry, restated for the register: the regeneration path
   * reads no register, and so says it did not read one rather than that the
   * deployment holds none.
   */
  it('leaves the regeneration path reading nothing, and saying so', () => {
    expect(regenerator).not.toMatch(/readProjectionRegister/);
    expect(regenerator).toContain('regionalTrendBlocks(enhancedData)');
    expect(regionalTrendBlocks({})).toMatch(/This report does not read a population projection/);
  });
});
