/**
 * Reading one area's approved supply out of the register.
 *
 * ## What the double is, and what it deliberately cannot do
 *
 * `fakeSupabase` emulates exactly four things: `from`, `select` (with and
 * without the `{ count, head }` form), `eq` and `limit`. It emulates no
 * filter grammar at all — no `or`, no `filter`, no `in` — because
 * `SCREENING_EXECUTION.md` records what happens when a double emulates one:
 * "the test double emulated `.or()` with a regex, so code and test agreed
 * while only the server disagreed", and the claim had never once succeeded in
 * production while every test passed.
 *
 * So the guarantee here is in two halves that have to be read together: the
 * behaviour below is measured against a double that understands only equality
 * filters, and `the read composes no filter grammar` asserts at source that
 * equality filters are all the module uses. Either half alone would be the
 * defect.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  APPROVALS_READ_LADDER,
  readApprovalsRegister,
} from '../../../../supabase/functions/_shared/reports/market/approvalsRegisterRead.ts';

const MODULE = readFileSync(
  join(process.cwd(), 'supabase/functions/_shared/reports/market/approvalsRegisterRead.ts'),
  'utf8',
);
const GENERATOR = readFileSync(
  join(process.cwd(), 'supabase/functions/generate-investment-report/index.ts'),
  'utf8',
);

interface Row {
  area: string; area_kind: string; area_code: string; area_token: string;
  state: string | null; period: string; building_type: string;
  dwelling_units: number | null; value_aud: number | null;
  source: string; source_url: string; licence: string; loaded_at: string;
}

const row = (over: Partial<Row> = {}): Row => ({
  area: 'Moreton Bay (C)', area_kind: 'lga', area_code: '35010', area_token: 'BAY MORETON',
  state: 'QLD', period: '2026-07', building_type: 'total_residential',
  dwelling_units: 210, value_aud: 84_000_000,
  source: 'ABS Building Approvals', source_url: 'https://x', licence: 'CC BY 4.0',
  loaded_at: '2026-09-20T00:00:00Z',
  ...over,
});

/** Only `eq` and `limit`. Anything else is deliberately not understood. */
function fakeSupabase(rows: Row[], opts: { throwOn?: string } = {}) {
  return {
    from(table: string) {
      if (opts.throwOn === table) throw new Error('boom');
      const build = (filters: Array<[string, unknown]>, head: boolean) => ({
        eq(col: string, value: unknown) { return build([...filters, [col, value]], head); },
        // Returns the thenable, as supabase-js does — a `limit` that resolved
        // immediately would let a filter applied after it silently vanish,
        // which is a defect a double must be able to show rather than hide.
        limit(_n: number) { return build(filters, head); },
        then(resolve?: (r: unknown) => unknown) {
          const matched = rows.filter((r) =>
            filters.every(([col, value]) => (r as unknown as Record<string, unknown>)[col] === value));
          const answer = opts.throwOn === 'read'
            ? { data: null, count: null, error: { message: 'read failed' } }
            : head ? { data: null, count: matched.length, error: null }
              : { data: matched, count: null, error: null };
          return Promise.resolve(resolve ? resolve(answer) : answer);
        },
      });
      return {
        select(_cols: string, options?: { count?: string; head?: boolean }) {
          return build([], options?.head === true);
        },
      };
    },
  };
}

const QUERY = { state: 'QLD' as const, trustedSuburb: 'Redcliffe', cadastreLga: 'Moreton Bay (C)' };

describe('the ladder is the register’s own, finest first', () => {
  it('never reaches for a national figure to describe one property', () => {
    expect(APPROVALS_READ_LADDER).toEqual(['sa2', 'lga', 'state']);
    expect(APPROVALS_READ_LADDER).not.toContain('national');
  });

  it('takes the SA2 reading where one answers, and says it is an SA2', async () => {
    const sa2 = row({ area_kind: 'sa2', area_code: '305021107', area: 'Redcliffe', area_token: 'REDCLIFFE' });
    const read = await readApprovalsRegister(fakeSupabase([sa2, row()]), QUERY);
    expect(read.kind).toBe('series');
    if (read.kind !== 'series') return;
    expect(read.askedAt).toBe('sa2');
    // The grain travels: the page must not call an SA2 a suburb.
    expect(read.series.areaKind).toBe('sa2');
    expect(read.series.area).toBe('Redcliffe');
  });

  it('falls to the council where no SA2 answers, and prices nothing itself', async () => {
    const read = await readApprovalsRegister(fakeSupabase([row()]), QUERY);
    expect(read.kind).toBe('series');
    if (read.kind !== 'series') return;
    expect(read.askedAt).toBe('lga');
    expect(read.series.areaKind).toBe('lga');
  });

  it('carries the publisher’s own source, licence and load stamp', async () => {
    const read = await readApprovalsRegister(fakeSupabase([
      row({ loaded_at: '2026-09-01T00:00:00Z' }),
      row({ period: '2026-06', loaded_at: '2026-09-20T00:00:00Z' }),
    ]), QUERY);
    if (read.kind !== 'series') throw new Error('expected a series');
    expect(read.series.licence).toBe('CC BY 4.0');
    // The newest stamp on the rows, not the first row's.
    expect(read.series.loadedAt).toBe('2026-09-20T00:00:00Z');
  });
});

describe('the four absences are four different answers', () => {
  it('says no area was resolved rather than guessing a neighbour', async () => {
    const read = await readApprovalsRegister(fakeSupabase([row()]), {
      state: null, trustedSuburb: null, cadastreLga: null,
    });
    expect(read).toEqual({ kind: 'absent', absence: 'no_area_resolved', askedAt: null });
  });

  it('distinguishes a register nobody has loaded from an area it does not hold', async () => {
    // Rows at the grain, none for this area: a statement about the area.
    const held = await readApprovalsRegister(
      fakeSupabase([row({ area_token: 'SOMEWHERE ELSE', area_code: '39999' })]),
      { ...QUERY, trustedSuburb: null },
    );
    expect(held).toMatchObject({ kind: 'absent', absence: 'none_for_area' });

    // Nothing at the grain at all: a statement about this deployment.
    const empty = await readApprovalsRegister(fakeSupabase([]), { ...QUERY, trustedSuburb: null });
    expect(empty).toMatchObject({ kind: 'absent', absence: 'not_loaded' });
  });

  it('reports a FAILED read as ours, never as an area with no approvals', async () => {
    const read = await readApprovalsRegister(fakeSupabase([row()], { throwOn: 'read' }), QUERY);
    expect(read).toMatchObject({ kind: 'absent', absence: 'unavailable' });
  });

  it('never throws, because a supply register is not worth failing a report over', async () => {
    const read = await readApprovalsRegister(
      fakeSupabase([row()], { throwOn: 'market_building_approvals' }),
      QUERY,
    );
    expect(read).toMatchObject({ kind: 'absent', absence: 'unavailable' });
  });
});

describe('only a trusted geography may select a reading', () => {
  it('asks the state rung with the state and the council rung with the cadastre', async () => {
    // A token that exists under another state must not answer.
    const elsewhere = row({ state: 'NSW' });
    const read = await readApprovalsRegister(fakeSupabase([elsewhere]), { ...QUERY, trustedSuburb: null });
    expect(read).toMatchObject({ kind: 'absent' });
  });

  it('names its inputs for the authority behind them, never “suburb”', () => {
    expect(MODULE).toContain('trustedSuburb');
    expect(MODULE).toContain('cadastreLga');
    expect(MODULE).not.toMatch(/\bsuburb\??:\s*string/);
  });
});

describe('the read composes no filter grammar', () => {
  it('uses equality filters alone — never an interpolated one', () => {
    // SCREENING_EXECUTION.md: never compose a filter as a string. The double
    // above understands only `eq`, and this is what makes that a guarantee
    // about the module rather than about the double.
    expect(MODULE).not.toMatch(/\.or\(/);
    expect(MODULE).not.toMatch(/\.filter\(\s*['"`]/);
    expect(MODULE).not.toMatch(/\.eq\(\s*[`'"][^`'"]*\$\{/);
  });

  it('names only columns market_building_approvals has', () => {
    const ddl = readFileSync(
      join(process.cwd(), 'supabase/migrations/20261213000000_market_building_approvals.sql'),
      'utf8',
    );
    for (const column of ['area_kind', 'area_token', 'area_code', 'building_type', 'dwelling_units', 'value_aud', 'loaded_at']) {
      expect(MODULE).toContain(column);
      expect(ddl).toContain(column);
    }
  });
});

describe('the generator reads it, and stops guessing the absence', () => {
  it('imports the one read helper', () => {
    expect(GENERATOR).toContain(
      "import { readApprovalsRegister } from '../_shared/reports/market/approvalsRegisterRead.ts';",
    );
  });

  it('writes what it read onto the record', () => {
    expect(GENERATOR).toContain('buildingApprovals: approvals,');
  });

  it('no longer derives the absence from whether planning named a council', () => {
    // The stand-in this replaces would have told a reader the register was
    // unloaded on a deployment where it was loaded and simply held nothing.
    expect(GENERATOR).not.toContain("planningFacts.council ? 'not_loaded' : 'no_area_resolved'");
    expect(GENERATOR).toContain('enhancedData.buildingApprovals?.kind === \'absent\'');
  });
});
