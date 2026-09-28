/**
 * A flowing page is laid out from what draws, and the report's body opens
 * on it only where there is room worth opening in.
 *
 * The 23 Sep 2026 Compass for 97 Poole Road and 9 Hollow Street printed pages
 * 3 to 6 at 54%, 68%, 66% and 74% empty: every summary element a page of its
 * own, each laid out for the worst case the master declared. See
 * `flowLayout.ts` for the rule and `tierPageSequence.pure.ts`
 * (`frontMatterFlagsFor`) for which tiers flow.
 */
import { describe, expect, it } from 'vitest';
import { flowedHeight, layoutFlowColumn, placeFlowColumn, type FlowFacts } from '../flowLayout';
import type { Block } from '../templateSchema';
import { frontMatterFlagsFor } from '../../../../supabase/functions/_shared/reports/investment/tierPageSequence.pure';
import {
  MIN_SHARED_FIRST_LINES, narrativeGeometry, pitchPt,
} from '../../../../supabase/functions/_shared/reports/narrativeGeometry.pure';
import { packMarkdownPages } from '../../../../supabase/functions/_shared/reports/markdownPaging.pure';
import type { MarkdownBlock } from '../../../../supabase/functions/_shared/reports/markdown.pure';

const block = (id: string, y: number, flowSlot: Record<string, unknown> | null, extra: Record<string, unknown> = {}): Block => ({
  id,
  type: 'text-block',
  props: { x: 45, y, width: 505, ...(flowSlot ? { flowSlot } : {}), ...extra },
} as unknown as Block);

const facts = (dropped: string[] = [], rows: Record<string, number> = {}): FlowFacts => ({
  isDropped: (b) => dropped.includes(b.id),
  drawnRows: (b) => (b.id in rows ? rows[b.id] : null),
});

describe('the column is stacked from what draws', () => {
  const page = [
    block('head', 20, null),
    block('verdict', 100, { height: 120, gap: 12 }),
    block('kpis', 232, { height: 228, gap: 12, rows: { count: 6, height: 38 } }, { height: 228 }),
    block('property', 472, { height: 150, gap: 12, rows: { count: 8, height: 18, spare: 1 } }),
    block('body', 634, { height: 0, gap: 0, fill: true }, { height: 150 }),
    block('footer', 800, null),
  ];

  it('gives back the rows a table or a ledger does not draw, keeping its spare', () => {
    // Two of six KPI rows draw: four rows come back. Five of eight table rows
    // draw, with one kept for a wrapped address: two rows come back.
    expect(flowedHeight({ height: 228, gap: 12, rows: { count: 6, height: 38 } }, 2)).toBe(228 - 4 * 38);
    expect(flowedHeight({ height: 150, gap: 12, rows: { count: 8, height: 18, spare: 1 } }, 5)).toBe(150 - 2 * 18);
    // Never grows past what was declared.
    expect(flowedHeight({ height: 150, gap: 12, rows: { count: 8, height: 18 } }, 20)).toBe(150);
  });

  it('closes up the column, moves the fill up and grows it by what came back', () => {
    const laid = layoutFlowColumn(page, facts([], { kpis: 2, property: 5 }));
    const y = (id: string) => Number((laid.find((b) => b.id === id)!.props as Record<string, unknown>).y);
    const h = (id: string) => Number((laid.find((b) => b.id === id)!.props as Record<string, unknown>).height);
    expect(y('verdict')).toBe(100);
    expect(y('kpis')).toBe(100 + 120 + 12);
    expect(h('kpis')).toBe(228 - 4 * 38);
    expect(y('property')).toBe(y('kpis') + (228 - 4 * 38) + 12);
    expect(y('body')).toBe(y('property') + (150 - 2 * 18) + 12);
    // The fill keeps its declared bottom.
    expect(y('body') + h('body')).toBe(634 + 150);
  });

  it('never moves furniture', () => {
    const laid = layoutFlowColumn(page, facts(['property'], { kpis: 2 }));
    expect((laid.find((b) => b.id === 'head')!.props as Record<string, unknown>).y).toBe(20);
    expect((laid.find((b) => b.id === 'footer')!.props as Record<string, unknown>).y).toBe(800);
  });

  it('costs nothing for a dropped block', () => {
    const placed = placeFlowColumn(page, facts(['property'], { kpis: 2 }));
    expect(placed.y.get('body')).toBe(100 + 120 + 12 + (228 - 4 * 38) + 12);
  });

  it('returns a page with no stamp as it came', () => {
    const plain = [block('a', 10, null), block('b', 50, null)];
    expect(layoutFlowColumn(plain, facts())).toEqual(plain);
  });
});

describe('which tiers flow, decided once', () => {
  it('flows the Compass and the four tiers condensed from it, and not the stored composite', () => {
    for (const tier of ['compass', 'financial', 'strategic', 'briefing', 'snapshot']) {
      expect(frontMatterFlagsFor(tier).continuousFrontMatter, tier).toBe(true);
    }
    expect(frontMatterFlagsFor('composite').continuousFrontMatter).toBe(false);
  });

  it('draws the grade\'s dimensions on the Compass alone', () => {
    expect(frontMatterFlagsFor('compass').frontScorecard).toBe(true);
    for (const tier of ['financial', 'strategic', 'briefing', 'snapshot']) {
      expect(frontMatterFlagsFor(tier).frontScorecard, tier).toBe(false);
    }
  });
});

describe('the body opens on a shared page only where there is room worth opening in', () => {
  const A4 = { width: 595, height: 842 };
  const box = (y: number) => ({ x: 45, y, width: 505, bodyPt: 8.25, lineHeight: 1.55, face: 'Noto Serif, serif' });

  it('refuses a sliver under the summary, and never refuses a page of its own', () => {
    const sliver = narrativeGeometry(box(767 - pitchPt(box(0)) * (MIN_SHARED_FIRST_LINES - 1)), box(82), A4);
    expect(sliver.firstPageLines).toBe(0);
    const room = narrativeGeometry(box(400), box(82), A4);
    expect(room.firstPageLines).toBeGreaterThanOrEqual(MIN_SHARED_FIRST_LINES);
    const own = narrativeGeometry(box(82), null, A4);
    expect(own.firstPageLines).toBeGreaterThan(0);
  });

  it('packs an empty opening when the first box is refused, and starts the body on the next page', () => {
    const para = (n: number): MarkdownBlock => ({ kind: 'paragraph', html: `<p>Paragraph ${n}.</p>`, lines: 4 });
    const pages = packMarkdownPages([para(1), para(2), para(3)], 40, { firstPageLines: 0, keepWithNext: true });
    expect(pages[0]).toEqual([]);
    expect(pages[1].length).toBe(3);
  });
});
