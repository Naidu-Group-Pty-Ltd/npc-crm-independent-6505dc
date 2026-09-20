/**
 * `1. Cover / 2. Contents` — two of twenty-two rows pointing nowhere.
 *
 * Page 2 of the Investment Compass issued for 97 Poole Road, Kellyville on
 * 20 Sep 2026 opened its contents with the sheet before it and the sheet the
 * reader was holding:
 *
 * ```
 * 1. Cover                                              1
 * 2. Contents                                           2
 * 3. Executive dashboard                                3
 * ```
 *
 * `renderTocHtml`'s filter kept both by construction — a page with no
 * narrative section is listed unless it declares `tocContinues`, and page 0
 * was FORCED in by an `i === 0` clause that bypassed even that test.
 *
 * Both are identified structurally rather than by name: a master may call its
 * cover anything, and matching on the word "Contents" would drop a report
 * section that happens to be called that.
 */
import { describe, expect, it } from 'vitest';
import { scopeContentsEntries } from '@/lib/reportTemplate/contentsScope.pure';

/** The Compass's own arrangement: cover at 0, contents at 1, content after. */
const COMPASS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const none = () => false;

describe('the twenty-two rows the Compass printed', () => {
  const out = scopeContentsEntries({
    candidates: COMPASS, selfIndex: 1, opensSection: none,
  });

  it('drops the cover and the contents page, and nothing else', () => {
    expect(out.listed).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('names which was which', () => {
    expect(out.dropped).toEqual([
      { pageIndex: 0, reason: 'cover' },
      { pageIndex: 1, reason: 'self' },
    ]);
  });
});

describe('the two bounds', () => {
  it('lists a page that opens a section, whatever sheet it is', () => {
    // If a master ever draws narrative on its cover, that page is content.
    const out = scopeContentsEntries({
      candidates: COMPASS, selfIndex: 1, opensSection: (i) => i === 0,
    });
    expect(out.listed).toContain(0);
    expect(out.dropped).toEqual([{ pageIndex: 1, reason: 'self' }]);
  });

  it('never empties the list — a blank contents page reads as a broken render', () => {
    const out = scopeContentsEntries({ candidates: [0], selfIndex: 0, opensSection: none });
    expect(out.listed).toEqual([0]);
    expect(out.dropped).toEqual([]);
  });

  it('drops no cover where the list is itself on page 0', () => {
    const out = scopeContentsEntries({ candidates: [0, 1, 2], selfIndex: 0, opensSection: none });
    expect(out.listed).toEqual([1, 2]);
    expect(out.dropped).toEqual([{ pageIndex: 0, reason: 'self' }]);
  });

  it('handles a list drawn on a page that is not a candidate at all', () => {
    const out = scopeContentsEntries({ candidates: [0, 2, 3], selfIndex: 1, opensSection: none });
    expect(out.listed).toEqual([2, 3]);
    expect(out.dropped).toEqual([{ pageIndex: 0, reason: 'cover' }]);
  });

  it('is a no-op on an empty candidate set', () => {
    expect(scopeContentsEntries({ candidates: [], selfIndex: 0, opensSection: none }))
      .toEqual({ listed: [], dropped: [] });
  });

  it('keeps document order', () => {
    const out = scopeContentsEntries({
      candidates: [0, 1, 4, 9, 12], selfIndex: 1, opensSection: none,
    });
    expect(out.listed).toEqual([4, 9, 12]);
  });
});

describe('the renderer reads it', () => {
  it('names the rule where the filter is applied', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/lib/reportTemplate/blocks/toc.html.ts', 'utf8');
    expect(src).toContain('scopeContentsEntries');
    // The clause that forced the cover in is gone from the entry list.
    expect(src).toMatch(/const entries = candidates\.filter/);
  });
});
