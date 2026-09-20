/**
 * An empty Builder Stock tab has to say WHICH absence it is.
 *
 * The 19 Sep 2026 clone audit reported a clone showing no properties under "No
 * builder stock has been uploaded yet · Properties appear here when a builder
 * uploads a stock list in their portal" — a statement about BUILDERS made out
 * of a fact about the LINK, on a page that mirrors another deployment's stock
 * and into which nothing is ever uploaded.
 */
import { describe, expect, it } from 'vitest';

import {
  isMissingRankingRelation,
  readStockEmptyState,
  type MirrorSource,
} from '../../../supabase/functions/_shared/builderStock/mirrorAvailability.pure';

const source = (over: Partial<MirrorSource> = {}): MirrorSource => ({
  connection: 'active',
  lastSyncedAt: '2026-09-18T00:00:00.000Z',
  ...over,
});

describe('readStockEmptyState', () => {
  it('names an unlinked workspace, and says no builder has to do anything', () => {
    const reading = readStockEmptyState({
      filtersApplied: false,
      source: source({ connection: 'none', lastSyncedAt: null }),
    });
    expect(reading.reason).toBe('no_connection');
    expect(reading.actionable).toBe(true);
    expect(reading.detail).toMatch(/no builder needs to do anything/i);
    expect(reading.title).not.toMatch(/uploaded/i);
  });

  it('separates a link that never delivered from a network with no stock', () => {
    expect(readStockEmptyState({
      filtersApplied: false,
      source: source({ lastSyncedAt: null }),
    }).reason).toBe('never_synced');

    expect(readStockEmptyState({ filtersApplied: false, source: source() }).reason).toBe('empty');
  });

  it('names a revoked link', () => {
    const reading = readStockEmptyState({
      filtersApplied: false,
      source: source({ connection: 'revoked', lastSyncedAt: null }),
    });
    expect(reading.reason).toBe('revoked_connection');
    expect(reading.actionable).toBe(true);
  });

  it('lets the filters outrank everything, because clearing them is the act in front of the reader', () => {
    for (const connection of ['active', 'none', 'revoked', 'unknown'] as const) {
      expect(readStockEmptyState({
        filtersApplied: true,
        source: source({ connection }),
      }).reason).toBe('filtered');
    }
  });

  it('never blames the builders on a link state it could not read', () => {
    // "We could not tell" and "there is no link" send an administrator to
    // opposite places; "the network has no stock" is a claim neither supports.
    for (const s of [undefined, null, source({ connection: 'unknown' })]) {
      const reading = readStockEmptyState({ filtersApplied: false, source: s });
      expect(reading.reason).toBe('unknown');
      expect(reading.detail).not.toMatch(/no available properties|builder uploads/i);
    }
  });

  it('never tells a Command Centre reader to go and upload a stock list', () => {
    // The mirror is fed by events. There is no upload on this side, and the
    // portal the old sentence pointed at is a deployment they cannot reach.
    for (const connection of ['active', 'none', 'revoked', 'unknown'] as const) {
      for (const lastSyncedAt of [null, '2026-09-18T00:00:00.000Z']) {
        const reading = readStockEmptyState({
          filtersApplied: false,
          source: source({ connection, lastSyncedAt }),
        });
        expect(`${reading.title} ${reading.detail}`).not.toMatch(/upload/i);
      }
    }
  });

  it('gives every reading a title and a detail', () => {
    const readings = [
      readStockEmptyState({ filtersApplied: true }),
      readStockEmptyState({ filtersApplied: false, source: source({ connection: 'none' }) }),
      readStockEmptyState({ filtersApplied: false, source: source({ connection: 'revoked' }) }),
      readStockEmptyState({ filtersApplied: false, source: source({ lastSyncedAt: null }) }),
      readStockEmptyState({ filtersApplied: false, source: source() }),
      readStockEmptyState({ filtersApplied: false, source: null }),
    ];
    expect(new Set(readings.map((r) => r.reason)).size).toBe(6);
    for (const reading of readings) {
      expect(reading.title.length).toBeGreaterThan(0);
      expect(reading.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('isMissingRankingRelation', () => {
  /*
   * THE SHAPE PRODUCTION ACTUALLY SENDS, MEASURED RATHER THAN IMAGINED.
   *
   * The two cases below it were written first and both invent their error.
   * PostgREST resolves a relation against its schema cache and refuses before
   * the statement is planned, so a supabase-js caller never sees 42P01 here —
   * it sees PGRST205. Probed against the live project on 19 Sep 2026:
   *
   *   GET /rest/v1/builder_network_stock_ranked?select=id&limit=1
   *   HTTP 404
   *   {"code":"PGRST205","message":"Could not find the table
   *    'public.builder_network_stock_ranked' in the schema cache"}
   *
   * The detector accepted neither PostgREST code, so the fallback never ran
   * and the Builder Stock tab answered "Builder stock could not be loaded."
   * over 46 correctly mirrored properties. This test is the regression, and it
   * is quoted from the wire because the reason the defect survived is that the
   * two tests below agreed with the code while only the server disagreed.
   */
  it('recognises the ranking view being absent — the real PostgREST answer', () => {
    expect(isMissingRankingRelation({
      code: 'PGRST205',
      message: "Could not find the table 'public.builder_network_stock_ranked' in the schema cache",
      details: null,
      hint: null,
    })).toBe(true);
  });

  it('recognises a rank column being absent — the real PostgREST answer', () => {
    expect(isMissingRankingRelation({
      code: 'PGRST204',
      message:
        "Could not find the 'rank_item_score' column of 'builder_network_stock_ranked' "
        + 'in the schema cache',
    })).toBe(true);
  });

  it('still recognises the ranking view being absent over a planner path', () => {
    // Kept rather than replaced: a direct SQL path or a different PostgREST
    // major can still raise the Postgres code, and a fallback that survives
    // one deployment's error vocabulary and not another's is the defect.
    expect(isMissingRankingRelation({
      code: '42P01',
      message: 'relation "public.builder_network_stock_ranked" does not exist',
    })).toBe(true);
  });

  it('recognises a rank column being absent over a planner path', () => {
    expect(isMissingRankingRelation({
      code: '42703',
      message: 'column "rank_placement_kind" does not exist',
    })).toBe(true);
  });

  it('never swallows a real failure', () => {
    // This decides whether to run a DIFFERENT query, so anything that is not
    // "the ranking has not reached this deployment" must still be reported.
    for (const error of [
      { code: '42501', message: 'permission denied for view builder_network_stock_ranked' },
      { code: '57014', message: 'canceling statement due to statement timeout' },
      { code: 'PGRST116', message: 'no rows' },
      { code: '42P01', message: 'relation "public.some_other_table" does not exist' },
      { code: '42703', message: 'column "typo_column" does not exist' },
      // The widened codes must narrow on the message exactly as the old two
      // did — a missing table that is not the ranking is somebody else's bug.
      {
        code: 'PGRST205',
        message: "Could not find the table 'public.some_other_table' in the schema cache",
      },
      {
        code: 'PGRST204',
        message: "Could not find the 'typo_column' column of 'listings_cache' in the schema cache",
      },
      { message: 'network error' },
      null,
      undefined,
      'a string',
    ]) {
      expect(isMissingRankingRelation(error), JSON.stringify(error)).toBe(false);
    }
  });
});
