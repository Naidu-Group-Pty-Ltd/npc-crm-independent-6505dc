/**
 * Audit item 35: with five properties selected, the comparison tray cut the
 * fourth through its address, hid the fifth entirely, and offered no scrollbar.
 *
 * The cause is a sizing rule, not a missing overflow. `ScrollArea`'s viewport is
 * `h-full`, so a root carrying only `max-h-*` gives it no height to resolve
 * against: the viewport grows to its content, the root's own `overflow-hidden`
 * slices it, and Radix never has reason to show a scrollbar. The region has to
 * be given a DEFINITE height — `min-h-0 flex-1` inside a flex column.
 *
 * jsdom has no layout, so nothing here can observe the clipping; a render test
 * passes either way, because all five rows were always in the DOM. This pins the
 * rule that decides it instead.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(__dirname, 'ComparisonBasket.tsx'),
  'utf8',
);

/** The `<ScrollArea …>` opening tags in the file. */
const scrollAreaTags = source.match(/<ScrollArea[^>]*>/g) ?? [];

describe('ComparisonBasket scroll region', () => {
  it('has a scroll region to check', () => {
    expect(scrollAreaTags.length).toBeGreaterThan(0);
  });

  it('never sizes the scroll region with max-height', () => {
    for (const tag of scrollAreaTags) {
      expect(tag).not.toMatch(/\bmax-h-/);
    }
  });

  it('gives the scroll region a definite height to resolve against', () => {
    for (const tag of scrollAreaTags) {
      expect(tag).toMatch(/\bflex-1\b/);
      expect(tag).toMatch(/\bmin-h-0\b/);
    }
  });

  it('lays the tray out as a flex column on both surfaces', () => {
    // Desktop card and mobile sheet both have to be columns, or the region
    // above has no height to take its share of.
    expect(source).toMatch(/<Card className="flex[^"]*\bflex-col\b/);
    expect(source).toMatch(/<SheetContent[^>]*className="flex[^"]*\bflex-col\b/);
  });
});
