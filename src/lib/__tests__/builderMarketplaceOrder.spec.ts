/**
 * The page-shape rules, pinned.
 *
 * The ORDER is the Builders Network's and is tested there. What is tested here
 * is the half this deployment owns: that the cap is a sort rather than a
 * filter, that a pin lands on its absolute position across pages, that a
 * disclosure cannot be quietly dropped, and — the one that actually bites —
 * that the cap written in TypeScript and the cap written in the ordering view's
 * SQL are the same number.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_CONSECUTIVE_PER_BUILDER,
  MAX_PROMOTED_SLOTS,
  isPlaced,
  placementLabel,
  promotedOrganisations,
  splicePinsIntoPage,
  type RankedRow,
} from '../../../supabase/functions/_shared/builderStock/marketplaceOrder.pure';
import { stockPlacementLabel, type BuilderStockRank } from '../builderStock';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const MIGRATIONS = join(REPO_ROOT, 'supabase', 'migrations');

/*
 * Found by SUFFIX rather than by full name. A migration's version prefix is not
 * stable — this one was renumbered once already, because the version it first
 * carried was taken by a migration that had been on `main` for five days, and
 * one version records one ledger row, so the loser can never be told apart
 * from applied. A test pinned to the whole filename breaks on that rename and
 * says nothing about the rule it is actually guarding.
 *
 * Exactly one match is asserted, so a file that vanishes or is duplicated
 * fails here rather than quietly reading the wrong one.
 */
const migrationNamed = (suffix: string): string => {
  const matches = readdirSync(MIGRATIONS).filter((f) => f.endsWith(suffix));
  expect(matches, `expected exactly one migration ending ${suffix}`).toHaveLength(1);
  return join(MIGRATIONS, matches[0]);
};

const MIGRATION = migrationNamed('_builder_marketplace_ranking.sql');

const row = (id: string, org: string, patch: Partial<RankedRow> = {}): RankedRow => ({
  id, organisation_id: org, rank_placement_kind: 'organic', rank_disclose: false, ...patch,
});

describe('the cap is one number, written twice', () => {
  it('the ordering view divides by exactly MAX_CONSECUTIVE_PER_BUILDER', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    // The window function's divisor IS the cap. Written in two places because
    // one of them has to be SQL; asserted here because two numbers that must
    // agree and drift silently is how a page gets laid out two ways.
    const divisor = sql.match(/\)\s*-\s*1\)\s*\/\s*(\d+)\s*AS interleave_bucket/);
    expect(divisor, 'the view must divide by a literal to form the bucket').not.toBeNull();
    expect(Number(divisor?.[1])).toBe(MAX_CONSECUTIVE_PER_BUILDER);
  });

  it('the view drops suppressed rows and nothing else', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const where = sql.slice(sql.indexOf('CREATE OR REPLACE VIEW'));
    const predicate = where.slice(where.indexOf('WHERE'), where.indexOf(';', where.indexOf('WHERE')));
    expect(predicate).toContain('suppressed');
    // A lifecycle or availability filter here would make the ranking a filter
    // rather than a sort, and would hide stock the marketplace must still show.
    expect(predicate).not.toMatch(/lifecycle_status|availability_status/);
  });
});

describe('a pin means an absolute marketplace position', () => {
  const pin = (id: string, position: number) =>
    row(id, 'pinned-org', {
      rank_placement_kind: 'pinned', rank_placement_position: position, rank_disclose: true,
    });

  it('lands at its position on the page that contains it', () => {
    const page = [row('a', 'x'), row('b', 'x'), row('c', 'x')];
    const spliced = splicePinsIntoPage(page, [pin('p', 2)], 0, 3);
    expect(spliced.map((entry) => entry.id)).toEqual(['a', 'p', 'b']);
  });

  it('is absent from a page it does not fall on, and present on the one it does', () => {
    const page = Array.from({ length: 10 }, (_, i) => row(`r${i}`, 'x'));
    const first = splicePinsIntoPage(page, [pin('p', 27)], 0, 10);
    expect(first.some((entry) => entry.id === 'p')).toBe(false);

    const third = splicePinsIntoPage(page, [pin('p', 27)], 20, 10);
    expect(third.map((entry) => entry.id).indexOf('p')).toBe(6);
  });

  it('never grows the page, so later offsets stay true', () => {
    const page = Array.from({ length: 10 }, (_, i) => row(`r${i}`, 'x'));
    expect(splicePinsIntoPage(page, [pin('p', 1), pin('q', 2)], 0, 10)).toHaveLength(10);
  });

  it('two pins land in the order they name rather than displacing each other', () => {
    const page = [row('a', 'x'), row('b', 'x')];
    const spliced = splicePinsIntoPage(page, [pin('second', 2), pin('first', 1)], 0, 4);
    expect(spliced.map((entry) => entry.id)).toEqual(['first', 'second', 'a', 'b']);
  });

  it('a position past the end appends rather than losing the property', () => {
    const page = [row('a', 'x')];
    expect(splicePinsIntoPage(page, [pin('p', 2)], 0, 10)).toHaveLength(2);
  });
});

describe('a placement is disclosed, and disclosure is not a style choice', () => {
  it('an ordinary listing draws no chip at all', () => {
    expect(placementLabel(row('a', 'x'))).toBeNull();
    expect(stockPlacementLabel({ rank_placement_kind: 'organic', rank_disclose: false })).toBeNull();
  });

  it('a paid or pinned position always draws one', () => {
    expect(placementLabel(row('a', 'x', {
      rank_placement_kind: 'promoted', rank_placement_tier: 'premium', rank_disclose: true,
    }))).toBeTruthy();
    expect(placementLabel(row('a', 'x', {
      rank_placement_kind: 'pinned', rank_placement_position: 1, rank_disclose: true,
    }))).toBeTruthy();
  });

  it('the wording is an operator\'s, never a column value', () => {
    for (const tier of ['partner', 'premium', 'featured']) {
      const label = placementLabel(row('a', 'x', {
        rank_placement_kind: 'promoted', rank_placement_tier: tier, rank_disclose: true,
      }));
      expect(label).not.toMatch(/_/);
      expect(label).not.toBe('promoted');
    }
  });

  it('the card and the edge function agree on the words', () => {
    // Two implementations of one label is how a card says something a server
    // never decided. They are separate modules only because one runs in Deno.
    const cases: RankedRow[] = [
      row('a', 'x', { rank_placement_kind: 'promoted', rank_placement_tier: 'partner', rank_disclose: true }),
      row('b', 'x', { rank_placement_kind: 'promoted', rank_placement_tier: 'premium', rank_disclose: true }),
      row('c', 'x', { rank_placement_kind: 'promoted', rank_placement_tier: 'featured', rank_disclose: true }),
      row('d', 'x', { rank_placement_kind: 'pinned', rank_placement_position: 1, rank_disclose: true }),
      row('e', 'x'),
    ];
    for (const entry of cases) {
      // RankedRow carries the wire vocabulary as `string`; the frontend type
      // narrows it to the placement union. The cast is the test's, not the
      // module's — production rows arrive already narrowed by the view.
      expect(stockPlacementLabel(entry as BuilderStockRank)).toBe(placementLabel(entry));
    }
  });

  it('isPlaced marks exactly the positions merit did not decide', () => {
    expect(isPlaced(row('a', 'x'))).toBe(false);
    expect(isPlaced(row('a', 'x', { rank_placement_kind: 'promoted' }))).toBe(true);
    expect(isPlaced(row('a', 'x', { rank_placement_kind: 'pinned' }))).toBe(true);
  });
});

describe('promoted slots are capped, and the cap is not a revocation', () => {
  it('only the best MAX_PROMOTED_SLOTS builders hold a slot', () => {
    const rows = [
      row('a', 'p1', { rank_placement_kind: 'promoted', rank_item_score: 90, rank_disclose: true }),
      row('b', 'p2', { rank_placement_kind: 'promoted', rank_item_score: 80, rank_disclose: true }),
      row('c', 'p3', { rank_placement_kind: 'promoted', rank_item_score: 70, rank_disclose: true }),
    ];
    const held = promotedOrganisations(rows);
    expect(held).toHaveLength(MAX_PROMOTED_SLOTS);
    expect(held).toEqual(['p1', 'p2']);
  });

  it('is decided over the whole set, so it does not change as pages turn', () => {
    const rows = [
      row('a', 'p1', { rank_placement_kind: 'promoted', rank_item_score: 50, rank_disclose: true }),
      row('b', 'p2', { rank_placement_kind: 'promoted', rank_item_score: 60, rank_disclose: true }),
    ];
    expect(promotedOrganisations(rows)).toEqual(promotedOrganisations([...rows].reverse()));
  });
});

describe('the ranked select is a literal, and it carries the whole base select', () => {
  const projection = readFileSync(
    join(process.cwd(), 'supabase/functions/_shared/builderStock/projection.pure.ts'),
    'utf8',
  );

  const literal = (name: string): string => {
    const m = projection.match(new RegExp(`export const ${name} = \`\\n([\\s\\S]*?)\\n\`;`));
    if (!m) throw new Error(`${name} is not a plain template literal in projection.pure.ts`);
    return m[1];
  };

  const columns = (body: string): string[] => body
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  /*
   * supabase-js parses the select at the TYPE level to derive a row type, and
   * it can only do that while the string has a literal type. One non-literal
   * substitution — `${STOCK_ITEM_SELECT.trim()}` was the one that shipped —
   * widens the template to `string`, the row type degrades to
   * `GenericStringError`, and every typed read of this view stops compiling.
   * So the select may hold no substitution at all.
   */
  it('RANKED_ITEM_SELECT interpolates nothing', () => {
    expect(literal('RANKED_ITEM_SELECT')).not.toMatch(/\$\{/);
  });

  // The price of that literal is a duplicated column list. This is the guard.
  it('carries every column STOCK_ITEM_SELECT names', () => {
    const base = columns(literal('STOCK_ITEM_SELECT'));
    const ranked = columns(literal('RANKED_ITEM_SELECT'));
    expect(base.length).toBeGreaterThan(0);
    for (const column of base) expect(ranked).toContain(column);
  });

  it('adds the rank columns the view publishes and nothing is left behind', () => {
    const ranked = columns(literal('RANKED_ITEM_SELECT'));
    for (const column of [
      'rank_item_score', 'rank_item_confidence', 'rank_builder_score',
      'rank_builder_confidence', 'rank_builder_band', 'rank_placement_kind',
      'rank_placement_position', 'rank_placement_tier', 'rank_disclose',
      'rank_version', 'rank_computed_at', 'ranked_band', 'ranked_item_score',
      'ranked_placement_kind', 'ranked_placement_order', 'interleave_bucket',
    ]) expect(ranked).toContain(column);
  });
});
