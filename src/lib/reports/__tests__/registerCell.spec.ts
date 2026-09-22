/**
 * A register cell that is not a number never becomes one.
 *
 * ## What this pins, and why it is one module
 *
 * Measured 22 Sep 2026 by rendering the Supply section's evidence block
 * against the register's real depth — four of twelve months — rather than by
 * reading the source: the money column printed **`$NaN`**.
 *
 * The guard was `m.value !== null`. `undefined !== null` is TRUE, so
 * `0 + undefined` became NaN; and `NaN === null` is false, so it then walked
 * past every downstream absence check and reached the formatter. PostgREST
 * answers for a column absent from a projection exactly as it answers for one
 * that is empty — the key is simply missing — which is the class
 * `check-edge-column-names.mjs` exists for and which has already cost this
 * repository four columns, every one of them reporting as normal, empty
 * operation.
 *
 * The sweep that followed is the part worth keeping: **this rule is written
 * four times in the repository and two of the copies were wrong.**
 *
 *  - `overrides.pure.ts` → `toFiniteNumber` — correct (returns `undefined`)
 *  - `borrowingCapacityProjection.pure.ts` → `num` — correct (same)
 *  - `salesRegisterRead.ts` → `=== null ? null : Number(…)` — **wrong**, on
 *    the register that grades Growth, prints medians in a client's document
 *    and backs the Financials tab's Estimate CGR
 *  - `rba-data-service` → the same, on `target_percent`, which IS the cash
 *    rate this product prints
 *
 * So the register readers share one statement of it, and this file drives the
 * REAL read path rather than asserting a property of the helper alone.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { finiteOrNull }
  from '../../../../supabase/functions/_shared/reports/market/registerCell.pure';
import { toFiniteNumber }
  from '../../../../supabase/functions/_shared/reports/investment/overrides.pure';
import { readSalesRegister }
  from '../../../../supabase/functions/_shared/reports/market/salesRegisterRead';

describe('finiteOrNull', () => {
  it('passes a finite number through, including zero', () => {
    expect(finiteOrNull(0)).toBe(0);
    expect(finiteOrNull(863_850)).toBe(863_850);
    expect(finiteOrNull(-3.5)).toBe(-3.5);
  });

  it('reads the STRING a numeric column arrives as', () => {
    // supabase-js hands `numeric` back as a string, so a reader that only
    // accepts `typeof v === 'number'` discards every real figure.
    expect(finiteOrNull('863850.00')).toBe(863_850);
    expect(finiteOrNull(' 4.35 ')).toBe(4.35);
  });

  it('answers null for every shape of absence, undefined first', () => {
    // The one that caused this. `=== null` does not see it.
    expect(finiteOrNull(undefined)).toBeNull();
    expect(finiteOrNull(null)).toBeNull();
    // `Number('')` is 0 — the trap the urban-centre register already paid for,
    // where a feature with no point parsed as (0, 0).
    expect(finiteOrNull('')).toBeNull();
    expect(finiteOrNull('   ')).toBeNull();
    expect(finiteOrNull('n/a')).toBeNull();
    expect(finiteOrNull({})).toBeNull();
    expect(finiteOrNull([])).toBeNull();
  });

  it('answers null for a number that is not a figure', () => {
    // NaN is neither a figure nor an absence, which is what made it worse
    // than either: it survives a `=== null` check and a `!== null` check.
    expect(finiteOrNull(Number.NaN)).toBeNull();
    expect(finiteOrNull(Number.POSITIVE_INFINITY)).toBeNull();
    expect(finiteOrNull('Infinity')).toBeNull();
  });

  it('is not a weaker rule than the two correct private copies', () => {
    /*
     * `toFiniteNumber` returns `undefined` because an override that was not
     * supplied is an absent KEY; this returns `null` because a register row's
     * absent measure is what the column holds. Two returns for two questions
     * is deliberate — but they must not disagree about WHICH inputs are
     * figures, or the shared one would be the weaker rule wearing a new name.
     */
    for (const input of [0, 1, -2.5, '0', '1234.5', ' 7 ', '', '   ', 'abc',
      null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}, []]) {
      const shared = finiteOrNull(input);
      const override = toFiniteNumber(input);
      expect(shared === null, `disagree on ${JSON.stringify(input)}`)
        .toBe(override === undefined);
      if (shared !== null) expect(shared).toBe(override);
    }
  });
});

// ---------------------------------------------------------------------------
// Through the real read path
// ---------------------------------------------------------------------------

/** The narrowest stub that satisfies the chain `readSalesRegister` builds. */
const stubClient = (rows: unknown[]) => {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.order = () => builder;
  builder.limit = () => Promise.resolve({ data: rows, error: null });
  return { from: () => builder };
};

describe('the sales register never hands a consumer a NaN', () => {
  /*
   * `market_sales_medians` is the register the Growth dimension is scored
   * from. A NaN median is worse than an absent one: `null` is what every
   * consumer here already branches on ("a suppressed median is null, never
   * zero"), and NaN walks past all of them into a CAGR and onto the page.
   */
  const row = (over: Record<string, unknown>) => ({
    area: 'Braidwood',
    area_kind: 'state',
    dwelling_type: 'house',
    period: '2026-06',
    median_price: '785000.00',
    sales_count: 162,
    loaded_at: '2026-09-22',
    price_measure: 'median',
    period_span: 'quarter',
    captured_at: null,
    ...over,
  });

  it('reads a numeric column that arrives as a string', async () => {
    const read = await readSalesRegister(
      stubClient([row({})]) as never,
      { state: 'NSW', areaKind: 'state', area: 'New South Wales' } as never,
    );
    expect(read.rows[0].medianPrice).toBe(785_000);
    expect(read.rows[0].salesCount).toBe(162);
  });

  it('answers null — never NaN — for a column a narrower select did not return', async () => {
    // `median_price` and `sales_count` absent from the projection entirely,
    // which is exactly what PostgREST hands back for a column not asked for.
    const { median_price: _m, sales_count: _s, ...withoutNumbers } = row({});
    const read = await readSalesRegister(
      stubClient([withoutNumbers]) as never,
      { state: 'NSW', areaKind: 'state', area: 'New South Wales' } as never,
    );
    expect(read.rows[0].medianPrice).toBeNull();
    expect(read.rows[0].salesCount).toBeNull();
    expect(Number.isNaN(read.rows[0].medianPrice as number)).toBe(false);
  });

  it('answers null for a suppressed cell rather than zero', async () => {
    // DCJ prints `-` where thirty or fewer sold, and `Number('')` is 0.
    const read = await readSalesRegister(
      stubClient([row({ median_price: '', sales_count: null })]) as never,
      { state: 'NSW', areaKind: 'state', area: 'New South Wales' } as never,
    );
    expect(read.rows[0].medianPrice).toBeNull();
    expect(read.rows[0].salesCount).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// One statement of the rule
// ---------------------------------------------------------------------------

describe('the rule is stated once on the register read paths', () => {
  it('no register reader rebuilds it with an equality against null', () => {
    const REPO = resolve(__dirname, '../../../..');
    /*
     * A RATCHET on the shape that failed, scoped to the readers that adopted
     * the module — not a repo-wide ban, because the two correct private
     * copies are correct and rewriting them would be a change with no defect
     * behind it.
     */
    const READERS = [
      'supabase/functions/_shared/reports/market/salesRegisterRead.ts',
      'supabase/functions/_shared/reports/market/approvalsRegisterRead.ts',
      'supabase/functions/rba-data-service/index.ts',
    ];
    for (const path of READERS) {
      const src = readFileSync(resolve(REPO, path), 'utf8');
      expect(src, `${path} rebuilds the guard that printed $NaN`)
        .not.toMatch(/===\s*null\s*\?\s*null\s*:\s*Number\(/);
      expect(src, `${path} does not read the shared rule`).toContain('finiteOrNull');
    }
  });
});
