/**
 * The invariant that makes the default safe.
 *
 * `ScrollArea` renders a vertical `<ScrollBar />` and no horizontal one, so
 * content wider than its viewport is content nobody can reach — which is how
 * the Aurixa hub's Remove button came to be laid out 65px past the clip
 * (Audit 4 item 3). The Viewport therefore confines its content by default.
 *
 * That default is only correct while every caller that genuinely scrolls
 * sideways opts out. This test asserts both halves, from the source, because
 * jsdom does no layout and the measurement that found the defect was taken in
 * Chromium against the compiled stylesheet.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SCROLL_AREA = 'src/components/ui/scroll-area.tsx';

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (/\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

describe('ScrollArea confines its content', () => {
  const src = readFileSync(SCROLL_AREA, 'utf8');

  it('makes the Radix content wrapper block-level unless asked not to', () => {
    // Radix styles that wrapper `display: table`, and under automatic table
    // layout `width: 100%` is a MINIMUM — so `[&>div]:!w-full`, which is also
    // present, does not stop it growing past the viewport.
    expect(src).toMatch(/!horizontal\s*&&\s*"\[&>div\]:!flow-root"/);
  });

  it('keeps the width cap alongside it rather than instead of it', () => {
    expect(src).toContain('[&>div]:!min-w-0');
    expect(src).toContain('[&>div]:!w-full');
  });

  it('uses flow-root, which still prevents margin collapse', () => {
    // `display: block` fixes the width and loses the one property Radix chose
    // `table` for. `flow-root` establishes a block formatting context.
    expect(src).not.toMatch(/!horizontal\s*&&\s*"\[&>div\]:!block"/);
  });

  it('offers the opt-out', () => {
    expect(src).toMatch(/horizontal\?:\s*boolean/);
  });
});

describe('every sideways-scrolling caller opts out', () => {
  it('passes `horizontal` wherever a horizontal ScrollBar is rendered', () => {
    // A `<ScrollBar orientation="horizontal" />` inside a `<ScrollArea>` says
    // that content is MEANT to exceed the box. Confining it there would take
    // away a rail an operator uses — the kanban board, the pinned-answer strip
    // and the finance pipeline.
    const offenders: string[] = [];
    for (const file of tsxFiles('src')) {
      if (file.endsWith('scroll-area.tsx')) continue;
      const src = readFileSync(file, 'utf8');
      if (!/ScrollBar\s+orientation="horizontal"/.test(src)) continue;
      const horizontalAreas = (src.match(/<ScrollArea\s+horizontal\b/g) ?? []).length;
      const horizontalBars = (src.match(/ScrollBar\s+orientation="horizontal"/g) ?? []).length;
      if (horizontalAreas < horizontalBars) {
        offenders.push(`${file}: ${horizontalBars} horizontal ScrollBar(s) but ${horizontalAreas} <ScrollArea horizontal>`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
