/**
 * The 2026-09 narrative calibration: measured charges, calibrated budgets,
 * keep-with-next, table splitting, loose lists, footnotes, skeleton headings,
 * and the baked-cover strip. Each assertion pins a defect that was measured on
 * a real client document (see `docs/reports/REPORTING_ENGINE_AUDIT_2026_09.md`
 * findings F4, F18–F21) — none of these is a style preference.
 */
import { describe, expect, it } from 'vitest';

import {
  renderMarkdown,
  splitTableBlock,
  type MarkdownBlock,
} from '../../../../supabase/functions/_shared/reports/markdown.pure';
import {
  CALIBRATED_CONT_LINES,
  CALIBRATED_FIRST_LINES,
  DEFAULT_LINES_PER_PAGE,
  packMarkdownPages,
  packNarrativePages,
  resolveNarrativeProfile,
} from '../../../../supabase/functions/_shared/reports/markdownPaging.pure';
import { stripBakedCover } from '../../../../supabase/functions/_shared/reports/investment/narrativeClean.pure';

const para = (text: string): MarkdownBlock => ({ kind: 'paragraph', html: `<p>${text}</p>`, lines: 2 });
const heading = (text: string): MarkdownBlock => ({ kind: 'heading', html: `<h3>${text}</h3>`, lines: 2 });

describe('resolveNarrativeProfile', () => {
  it('maps every investment spelling to the calibrated profile, and nothing else', () => {
    for (const t of ['investment', 'investment_compass', 'compass']) {
      const p = resolveNarrativeProfile(t);
      expect(p, t).not.toBeNull();
      expect(p!.linesPerPage).toBe(CALIBRATED_CONT_LINES);
      expect(p!.firstPageLines).toBe(CALIBRATED_FIRST_LINES);
      expect(p!.charging).toBe('measured');
    }
    expect(resolveNarrativeProfile('qa')).toBeNull();
    expect(resolveNarrativeProfile('market_intelligence')).toBeNull();
    expect(resolveNarrativeProfile(undefined)).toBeNull();
  });

  it('treats the deployed sentinel (34) as "use the calibrated budgets" and honours a hand-tuned value', () => {
    const profile = resolveNarrativeProfile('investment')!;
    const blocks = Array.from({ length: 60 }, (_, i) => para(`p${i}`));
    const viaSentinel = packNarrativePages(blocks, profile, DEFAULT_LINES_PER_PAGE);
    const viaDefault = packNarrativePages(blocks, profile);
    expect(viaSentinel.length).toBe(viaDefault.length);

    const handTuned = packNarrativePages(blocks, profile, 10);
    // 60 blocks × 2 lines at 10 per page is 12 pages; the calibrated 50 gives 3.
    expect(handTuned.length).toBeGreaterThan(viaSentinel.length);
  });
});

describe('packMarkdownPages options', () => {
  it('default call keeps the legacy behaviour byte for byte', () => {
    const blocks = Array.from({ length: 40 }, (_, i) => para(`p${i}`));
    const pages = packMarkdownPages(blocks);
    // 34-line budget over 2-line blocks: 17 per page — the pre-calibration
    // packing, which every master not on a profile still expects.
    expect(pages[0].length).toBe(17);
  });

  it('keep-with-next never ends a page on a heading or a lead-in line', () => {
    const blocks: MarkdownBlock[] = [];
    for (let i = 0; i < 8; i++) blocks.push(para(`filler ${i}`));
    blocks.push(heading('Promised content'));
    blocks.push(para('the content itself'));
    const pages = packMarkdownPages(blocks, 18, { keepWithNext: true });
    for (const page of pages.slice(0, -1)) {
      const last = page[page.length - 1];
      expect(last.kind).not.toBe('heading');
      expect(/[:：]\s*<\/p>\s*$/.test(last.html)).toBe(false);
    }
    // The heading landed with its content, on one page.
    const withHeading = pages.find((p) => p.some((b) => b.kind === 'heading'))!;
    expect(withHeading[withHeading.length - 1].html).toContain('the content itself');
  });

  it('a lead-in paragraph ending in a colon travels with its list', () => {
    const blocks: MarkdownBlock[] = [
      ...Array.from({ length: 8 }, (_, i) => para(`filler ${i}`)),
      { kind: 'paragraph', html: '<p>The key strengths are:</p>', lines: 1 },
      { kind: 'list', html: '<ul><li>one</li></ul>', lines: 3 },
    ];
    const pages = packMarkdownPages(blocks, 17, { keepWithNext: true });
    const leadPage = pages.findIndex((p) => p.some((b) => b.html.includes('strengths are:')));
    const listPage = pages.findIndex((p) => p.some((b) => b.kind === 'list'));
    expect(leadPage).toBe(listPage);
  });
});

describe('table splitting', () => {
  const bigTable = () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      `| Risk ${i} | ${'A long explanatory cell that wraps across several lines of the measure '.repeat(2)} |`).join('\n');
    const src = `| Hazard | Why it matters |\n| --- | --- |\n${rows}`;
    return renderMarkdown(src, { charging: 'measured' }).blocks.find((b) => b.kind === 'table')!;
  };

  it('a taller-than-a-page table splits by rows with the head repeated and no row lost', () => {
    const table = bigTable();
    expect(table.table).toBeDefined();
    expect(table.lines).toBeGreaterThan(CALIBRATED_CONT_LINES);

    const chunks = splitTableBlock(table, CALIBRATED_CONT_LINES, CALIBRATED_CONT_LINES);
    expect(chunks.length).toBeGreaterThan(1);
    const totalRows = chunks.reduce((n, c) => n + (c.table?.rows.length ?? 0), 0);
    expect(totalRows).toBe(table.table!.rows.length);
    for (const c of chunks) {
      expect(c.lines).toBeLessThanOrEqual(CALIBRATED_CONT_LINES + 1);
      expect(c.html).toContain('<thead');
      expect(c.table!.rows.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('the pager applies the split, so no bucket exceeds a page', () => {
    const table = bigTable();
    const pages = packMarkdownPages([para('intro'), table], CALIBRATED_CONT_LINES, { splitTables: true });
    for (const page of pages) {
      const used = page.reduce((n, b) => n + b.lines, 0);
      expect(used).toBeLessThanOrEqual(CALIBRATED_CONT_LINES + 1);
    }
  });

  it('a table that fits a page whole is not split', () => {
    const src = '| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |';
    const table = renderMarkdown(src, { charging: 'measured' }).blocks.find((b) => b.kind === 'table')!;
    const pages = packMarkdownPages([table], CALIBRATED_CONT_LINES, { splitTables: true });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(1);
  });
});

describe('loose lists and footnotes', () => {
  it('items separated by blank lines are ONE list — fifteen "1." was a real page', () => {
    const src = Array.from({ length: 15 }, (_, i) => `1. Check item ${i + 1}`).join('\n\n');
    const { blocks, notices } = renderMarkdown(src);
    const lists = blocks.filter((b) => b.kind === 'list');
    expect(lists).toHaveLength(1);
    expect((lists[0].html.match(/<li>/g) ?? []).length).toBe(15);
    expect(notices.listRunsMerged).toBe(14);
  });

  it('an ordered run opening past 1 keeps its numbering', () => {
    const { blocks } = renderMarkdown('4. four\n5. five');
    // The attribute for readers that honour it, the CSS counter for the pinned
    // engine, which does not (WeasyPrint 69.0 sets `<ol start="4">` as "1.").
    expect(blocks[0].html).toContain('<ol start="4" style="counter-reset:list-item 3">');
  });

  it('a blank line before an UNordered item does not merge into an ordered run', () => {
    const { blocks } = renderMarkdown('1. one\n\n- bullet');
    expect(blocks.filter((b) => b.kind === 'list')).toHaveLength(2);
  });

  it('footnote refs become superscripts, defs a Notes list; an undefined ref is dropped', () => {
    const src = 'Crime is falling.[^bocsar] Prices rose.[^ghost]\n\n[^bocsar]: BOCSAR recorded crime statistics, 2025.';
    const { html, notices } = renderMarkdown(src);
    expect(html).toContain('<sup class="fn-ref">1</sup>');
    expect(html).toContain('BOCSAR recorded crime statistics');
    expect(html).not.toContain('[^bocsar]');
    expect(html).not.toContain('[^ghost]');
    expect(notices.footnotesRendered).toBe(1);
    expect(notices.footnoteRefsDropped).toBe(1);
  });

  it('with no definitions in the document, bracket-caret text is left alone', () => {
    const { html } = renderMarkdown('An array slice a[^2] in prose.');
    expect(html).toContain('a[^2]');
  });
});

describe('skeleton headings', () => {
  it('a run of headings with no content under them is dropped', () => {
    const src = '## Real section\n\nProse.\n\n## Empty one\n\n## Empty two\n\n### Empty three';
    const { blocks, notices } = renderMarkdown(src);
    expect(blocks.filter((b) => b.kind === 'heading')).toHaveLength(1);
    expect(notices.headingsDroppedEmpty).toBe(3);
  });

  it('a heading whose content is a table or a deeper heading with prose is kept', () => {
    const src = '## Over a table\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n## Parent\n\n### Child\n\nProse.';
    const { blocks } = renderMarkdown(src);
    expect(blocks.filter((b) => b.kind === 'heading')).toHaveLength(3);
  });

  it('can be kept for callers that want skeletons', () => {
    const { blocks } = renderMarkdown('## Alone', { dropEmptyHeadings: false });
    expect(blocks.filter((b) => b.kind === 'heading')).toHaveLength(1);
  });
});

describe('stripBakedCover', () => {
  const baked = [
    '# NAIDU PROPERTY CONSULTING SERVICES',
    '',
    'YOUR DEDICATED PROPERTY PARTNER',
    '',
    '# Investment Report: 48 Budgeree Street',
    '',
    '---',
    '',
    '**Cover Page**',
    'Investment Location & Property Fit Report',
    'Prepared for: Premium client of Naidu Property Consulting Services',
    '',
    '## Executive Verdict',
    '',
    'Tea Gardens offers a calm, amenity-rich lifestyle.',
  ].join('\n');

  it('removes the masthead and the Cover Page section from a real-shaped narrative', () => {
    const r = stripBakedCover(baked);
    expect(r.strippedHeader).toBe(true);
    expect(r.strippedCoverSection).toBe(true);
    expect(r.text.trimStart().startsWith('## Executive Verdict')).toBe(true);
    expect(r.text).not.toContain('Cover Page');
    expect(r.text).not.toContain('DEDICATED PROPERTY PARTNER');
    expect(r.text).toContain('Tea Gardens offers a calm');
  });

  it('handles the heading form of the cover section', () => {
    const r = stripBakedCover('## Cover Page\n\nPrepared for: someone\n\n## Verdict\n\nProse.');
    expect(r.strippedCoverSection).toBe(true);
    expect(r.text.trimStart().startsWith('## Verdict')).toBe(true);
  });

  it('leaves a narrative that opens with real prose untouched', () => {
    const src = '## Executive Verdict\n\nThe suburb performs well.';
    const r = stripBakedCover(src);
    expect(r.strippedHeader).toBe(false);
    expect(r.strippedCoverSection).toBe(false);
    expect(r.text).toBe(src);
  });

  it('does not treat a mid-document "Cover strategy" heading as a cover page', () => {
    const src = '## Verdict\n\nProse.\n\n## Cover strategy\n\nInsurance cover details.';
    const r = stripBakedCover(src);
    expect(r.strippedCoverSection).toBe(false);
    expect(r.text).toContain('Cover strategy');
  });

  it('keeps a lone opening H1 that carries neither signature', () => {
    const src = '# Market outlook\n\nProse follows.';
    const r = stripBakedCover(src);
    expect(r.strippedHeader).toBe(false);
    expect(r.text).toContain('# Market outlook');
  });
});
