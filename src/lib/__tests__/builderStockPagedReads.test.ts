/**
 * Builder stock — nothing in this surface may believe a `.limit()`.
 *
 * PostgREST does not honour the row count a caller asks for. It caps every
 * response at `db-max-rows`, which `supabase/config.toml` sets to 1,000 and
 * which was measured against production on 1 September 2026: a request for
 * 200,000 rows of an 18,519-row table answered `content-range: 0-999/18519`
 * with HTTP 200 and no error anywhere in the response body.
 *
 * The cost of learning that was the marketplace. `enforceStrictPrimaryImages`
 * read 1,000 of an organisation's 1,926 images and cleared the primary-image
 * pointer of every property whose photograph was in the other 926, because an
 * image that is not in the answer is indistinguishable from an image that does
 * not exist. Eleven properties holding an eligible builder photograph — every
 * one of them at physical position 1,125-1,781 — showed an empty card.
 *
 * So the rule is not "page the read that broke". It is that a `.limit()` above
 * the cap is a statement the API will ignore, and there is no way to tell from
 * the response that it did: the scan below fails on any of them.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MAX_ROWS, PAGE_SIZE, readAllRows,
} from '../../../supabase/functions/_shared/builderStock/pagedRead';

/** The API's own ceiling. A `.limit()` above it is not a request, it is a hope. */
const SERVER_ROW_CAP = 1000;

/* The settler, the link callback and the portal's own stock function left
   with the portal (network extraction Phase 7); the marketplace and the
   shared modules it still imports are the surviving read surface. */
const ROOTS = [
  'supabase/functions/_shared/builderStock',
  'supabase/functions/builder-stock-marketplace',
];

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts')) found.push(path);
    }
  };
  walk(root);
  return found;
}

/** Comments explain the defect and quote the old numbers; only code is judged. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('no builder stock read may ask for more rows than the API will return', () => {
  for (const root of ROOTS) {
    it(`${root} pages instead of over-asking`, () => {
      const offenders: string[] = [];
      for (const file of sourceFiles(root)) {
        const code = withoutComments(readFileSync(file, 'utf8'));
        for (const match of code.matchAll(/\.limit\(\s*([0-9_]+)\s*\)/g)) {
          const asked = Number(match[1].replace(/_/g, ''));
          if (asked > SERVER_ROW_CAP) offenders.push(`${file}: .limit(${asked})`);
        }
      }
      expect(offenders, 'use readAllRows from pagedRead.ts — the API caps at '
        + `${SERVER_ROW_CAP} rows and reports the truncation in a header nothing reads`)
        .toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------

/** A double that caps like the server does, whatever the caller asked for. */
function cappedSource(rows: number[], cap: number) {
  const calls: Array<[number, number]> = [];
  return {
    calls,
    query: () => ({
      range: (from: number, to: number) => {
        calls.push([from, to]);
        const width = Math.min(to - from + 1, cap);
        return Promise.resolve({ data: rows.slice(from, from + width), error: null });
      },
    }),
  };
}

describe('readAllRows', () => {
  it('returns every row when the server caps below the page size', async () => {
    // THE RULE THAT MATTERS. A reader that stops on a page shorter than it
    // asked for is correct only while it knows the server's cap; this one
    // advances by what it received, so a cap of 3 against a page size of 1,000
    // still reads all seven rows.
    const source = cappedSource([1, 2, 3, 4, 5, 6, 7], 3);

    const result = await readAllRows<number>(source.query);

    expect(result.rows).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(result.failed).toBe(false);
    expect(source.calls.map(([from]) => from)).toEqual([0, 3, 6, 7]);
  });

  it('stops on an empty page and nothing else', async () => {
    const source = cappedSource([1, 2], 1000);
    const result = await readAllRows<number>(source.query, { pageSize: 2 });
    expect(result.rows).toEqual([1, 2]);
    expect(source.calls).toHaveLength(2);
  });

  it('reads an empty table in one request', async () => {
    const source = cappedSource([], 1000);
    const result = await readAllRows<number>(source.query);
    expect(result).toEqual({ rows: [], failed: false, error: null });
  });

  it('answers a failed page as failed, with NO rows', async () => {
    // A partial answer is the defect. A caller that writes deletions from this
    // must be handed nothing rather than a subset it cannot recognise as one.
    const error = { message: 'connection reset' };
    const result = await readAllRows<number>(() => ({
      range: () => Promise.resolve({ data: null, error }),
    }));
    expect(result.rows).toEqual([]);
    expect(result.failed).toBe(true);
    expect(result.error).toBe(error);
  });

  it('fails rather than silently truncating at its own ceiling', async () => {
    const source = cappedSource(Array.from({ length: 12 }, (_, n) => n), 1000);
    const result = await readAllRows<number>(source.query, { pageSize: 4, maxRows: 8 });
    expect(result.failed).toBe(true);
    expect(result.rows).toEqual([]);
  });

  it('asks for the deployment cap by default', () => {
    expect(PAGE_SIZE).toBe(SERVER_ROW_CAP);
    expect(MAX_ROWS).toBeGreaterThan(SERVER_ROW_CAP);
  });
});
