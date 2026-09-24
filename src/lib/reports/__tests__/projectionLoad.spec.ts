/**
 * The one gate every state's projection loader passes through on the way to
 * `population_projections`. Each rule is a way a plausible row once hid a
 * wrong register.
 */
import { describe, expect, it } from 'vitest';
import {
  PROJECTION_CEILING,
  PROJECTION_CONFLICT_KEY,
  guardProjectionRows,
  projectionBatches,
  type ProjectionLoadRow,
} from '../../../../supabase/functions/_shared/reports/market/openData/projectionLoad.pure';

const row = (over: Partial<ProjectionLoadRow>): ProjectionLoadRow => ({
  state: 'SA',
  release: 'Population Projections for South Australia, 2021–2051',
  series: 'Medium',
  measure: 'persons',
  area_kind: 'sa2',
  area_code: '401011001',
  area: 'Adelaide',
  area_token: 'ADELAIDE',
  year: 2026,
  year_kind: 'projected',
  value: 20_000,
  publisher: 'Department for Housing and Urban Development',
  source_url: 'https://data.sa.gov.au/',
  licence: 'CC BY 4.0',
  ...over,
});

describe('a load is refused, never emptied', () => {
  it('refuses a parse that found nothing', () => {
    const g = guardProjectionRows([]);
    expect(g.ok).toBe(false);
    if (g.ok === false) expect(g.reason).toMatch(/publisher that published nothing/);
  });

  it('accepts a base and its projected years, and reports what it holds', () => {
    const g = guardProjectionRows([
      row({ year: 2021, year_kind: 'base', value: 18_000 }),
      row({ year: 2026 }),
      row({ year: 2031, value: 21_000 }),
      row({ series: 'High', year: 2021, year_kind: 'base', value: 18_000 }),
      row({ series: 'High', year: 2031, value: 23_000 }),
    ]);
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    expect(g.series).toEqual(['High', 'Medium']);
    expect(g.firstYear).toBe(2021);
    expect(g.lastYear).toBe(2031);
    expect(g.areaKinds).toEqual(['sa2']);
  });
});

describe('a misread column is caught by magnitude, per grain', () => {
  it('refuses a year read as a population and a code read as one', () => {
    const g = guardProjectionRows([row({ value: 401011001 })]);
    expect(g.ok).toBe(false);
    if (g.ok === false) expect(g.reason).toMatch(/unit or column drift/);
  });

  it('lets a state hold what an SA2 cannot', () => {
    expect(guardProjectionRows([row({ area_kind: 'state', area_code: 'SA', area: 'South Australia', area_token: 'SOUTH AUSTRALIA', value: 2_100_000 })]).ok).toBe(true);
    expect(guardProjectionRows([row({ value: 2_100_000 })]).ok).toBe(false);
    expect(PROJECTION_CEILING.state).toBeGreaterThan(PROJECTION_CEILING.lga);
  });

  it('refuses a negative or non-finite population, and a year out of range', () => {
    expect(guardProjectionRows([row({ value: -1 })]).ok).toBe(false);
    expect(guardProjectionRows([row({ value: Number.NaN })]).ok).toBe(false);
    expect(guardProjectionRows([row({ year: 20_261 })]).ok).toBe(false);
  });
});

describe('an estimate is not a projection', () => {
  it('refuses a series that holds only its base', () => {
    const g = guardProjectionRows([row({ year: 2021, year_kind: 'base' })]);
    expect(g.ok).toBe(false);
    if (g.ok === false) expect(g.reason).toMatch(/an estimate is not a projection/);
  });

  it('refuses two bases, and a projected year at or before the base', () => {
    expect(guardProjectionRows([
      row({ year: 2021, year_kind: 'base' }), row({ year: 2022, year_kind: 'base' }), row({ year: 2026 }),
    ]).ok).toBe(false);
    expect(guardProjectionRows([row({ year: 2021, year_kind: 'base' }), row({ year: 2021 })]).ok).toBe(false);
  });
});

describe('one figure, one row', () => {
  it('refuses a key read twice', () => {
    const g = guardProjectionRows([row({}), row({ value: 20_500 })]);
    expect(g.ok).toBe(false);
    if (g.ok === false) expect(g.reason).toMatch(/read twice/);
  });

  it('upserts on the table’s own key, in bounded batches', () => {
    expect(PROJECTION_CONFLICT_KEY).toBe('state,release,series,measure,area_kind,area_code,year');
    expect(projectionBatches(Array.from({ length: 1_201 }, (_, i) => i), 500).map((b) => b.length)).toEqual([500, 500, 201]);
  });

  it('refuses a row with no provenance', () => {
    expect(guardProjectionRows([row({ publisher: ' ' })]).ok).toBe(false);
    expect(guardProjectionRows([row({ source_url: '' })]).ok).toBe(false);
  });
});

describe('a row is written with the token it will be asked by', () => {
  it('writes a council by its words and anything else by its name', async () => {
    const { projectionAreaToken } = await import('../../../../supabase/functions/_shared/reports/market/openData/projectionLoad.pure');
    expect(projectionAreaToken('lga', 'City of Onkaparinga')).toBe(projectionAreaToken('lga', 'ONKAPARINGA CITY COUNCIL'));
    expect(projectionAreaToken('suburb', 'North Adelaide')).toBe('NORTH ADELAIDE');
    expect(projectionAreaToken('district', 'Belconnen')).toBe('BELCONNEN');
  });

  it('is the rule the register is read by', async () => {
    const { readFileSync } = await import('node:fs');
    const reader = readFileSync('supabase/functions/_shared/reports/market/projectionRegisterRead.ts', 'utf8');
    expect(reader).toMatch(/projectionAreaToken\('suburb', suburb\)/);
    expect(reader).toMatch(/projectionAreaToken\('lga', lga\)/);
    expect(reader).not.toMatch(/salesAreaToken/);
  });
});
