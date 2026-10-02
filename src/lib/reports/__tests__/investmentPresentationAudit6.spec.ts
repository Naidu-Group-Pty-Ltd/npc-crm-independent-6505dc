/**
 * Audit 6 — the five Investment documents, drawn through every master.
 *
 * Each test names something read off the measured renders (the 18 Annabelle
 * Crescent and 262 Pallas Street rows, all five tiers, all fifty masters,
 * through WeasyPrint 69.0 on the production options) and drives the REAL
 * module that drew it: the Markdown renderer, the packer, the narrative
 * geometry, the chart primitives, the directive router, the strengths block
 * and the binding projection. Nothing here is a copy of the code it checks.
 *
 * PRESERVATION tests (named so) show what did NOT move.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';

import {
  renderMarkdown,
  type MarkdownBlock,
} from '../../../../supabase/functions/_shared/reports/markdown.pure';
import { packMarkdownPages } from '../../../../supabase/functions/_shared/reports/markdownPaging.pure';
import { narrativeGeometry } from '../../../../supabase/functions/_shared/reports/narrativeGeometry.pure';
import {
  renderInlineSpark,
  renderMarginSpark,
  renderTimelineRibbon,
} from '../../../../supabase/functions/_shared/reportDesign/charts.pure';
import { chartContext } from '@/lib/reportDesign/charts.pure';
import { resolveReportPalette } from '@/lib/reportDesign/brandResolve.pure';
import {
  donutReading,
  inlineSparkRenderer,
} from '../../../../supabase/functions/_shared/reports/vizFigures.pure';
import { parseVizDirective } from '../../../../supabase/functions/_shared/reports/vizDirectives.pure';
import { renderStrengthsWatchHtml } from '@/lib/reportTemplate/blocks/strengthsWatch.html';
import { drawStrengthsWatchBlock } from '@/lib/reportTemplate/blocks/strengthsWatch';
import type { BlockRenderContext } from '@/lib/reportTemplate/blocks';
import { projectInvestmentReport } from '../../../../supabase/functions/_shared/reportBindingProjection.pure';
import {
  presentableName,
  presentableTerm,
} from '../../../../supabase/functions/_shared/reports/presentableName.pure';
import { stripBakedCover } from '../../../../supabase/functions/_shared/reports/investment/narrativeClean.pure';
import { composeScoreDimensionsSection } from '../../../../supabase/functions/_shared/reports/investment/scoreSections.pure';

const ctx = () => chartContext(resolveReportPalette());

/** A sentence of a given length, with no sentence boundary inside it. */
const prose = (chars: number, word = 'evidence') =>
  Array.from({ length: Math.ceil(chars / (word.length + 1)) }, () => word).join(' ').slice(0, chars);

// ── The risk register is a set of records, not a table ───────────────────────

// Every column labelled, two of them sentences: a mean of at least
// `RECORD_PROSE_MEAN_CHARS` a cell, an empty cell counting as none.
const REGISTER = [
  '| Risk | Level | Why it matters | Required check |',
  '| --- | --- | --- | --- |',
  `| Crime exposure | Moderate | ${prose(140)} | ${prose(200, 'confirm')} |`,
  `| Supply pipeline | Moderate | ${prose(150)} | ${prose(200, 'confirm')} |`,
  `| Flood mapping | Low | ${prose(130)} |  |`,
].join('\n');

describe('a register whose cells are sentences is set as records', () => {
  it('draws one record per row: the name on a rule with its short cells, then each sentence under its label', () => {
    const { html, blocks } = renderMarkdown(REGISTER, { recordTables: true });
    expect(html).not.toContain('<table');
    const titles = blocks.filter((b) => b.html.startsWith('<p class="record-title">'));
    expect(titles).toHaveLength(3);
    expect(titles[0].html).toContain('<strong>Crime exposure</strong>');
    expect(titles[0].html).toContain('<strong class="record-label">Level</strong> Moderate');
    expect(html).toContain('<strong class="record-label">Why it matters</strong>');
    expect(html).toContain('<strong class="record-label">Required check</strong>');
  });

  it('prints every cell it holds and no label over an empty one', () => {
    const { blocks } = renderMarkdown(REGISTER, { recordTables: true });
    const flood = blocks.findIndex((b) => b.html.includes('Flood mapping'));
    const after = blocks.slice(flood + 1).map((b) => b.html).join('');
    expect(after).toContain('Why it matters');
    expect(after).not.toContain('Required check');
  });

  it('leads into its first field, so a page never ends on a record\'s name', () => {
    const { blocks } = renderMarkdown(REGISTER, { recordTables: true });
    const lead: MarkdownBlock = { kind: 'paragraph', html: '<p>Opening.</p>', lines: 8 };
    const pages = packMarkdownPages([lead, ...blocks], 10, { keepWithNext: true });
    for (const page of pages) {
      expect(page[page.length - 1].html.startsWith('<p class="record-title">')).toBe(false);
    }
  });

  it('PRESERVATION — a table of short cells stays a table, and no other format asks for records', () => {
    const short = '| Item | Value |\n| --- | --- |\n| Land | 765 m² |\n| Zone | R2 |';
    expect(renderMarkdown(short, { recordTables: true }).html).toContain('<table');
    expect(renderMarkdown(REGISTER).html).toContain('<table');
  });
});

// ── A spark is a word ─────────────────────────────────────────────────────────

describe('an inline spark', () => {
  const opts = { renderInlineSpark: inlineSparkRenderer(ctx()) };

  it('on a line of its own joins the sentence before it rather than standing alone as a stroke', () => {
    const md = 'A flat population for a decade.\n\n~~[176,176,176,175,175]~~\n\nNext paragraph.';
    const { blocks } = renderMarkdown(md, opts);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].html).toMatch(/^<p>A flat population for a decade\. <svg class="spark-inline"[\s\S]*<\/svg><\/p>$/);
  });

  it('PRESERVATION — under a heading, with no sentence before it, it stays where it is', () => {
    const { blocks } = renderMarkdown('## Head\n\n~~[1,2,3]~~', opts);
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph']);
  });

  /** The vertical extent a spark's line uses, as a share of the drawing's. */
  const extent = (svg: string, h: number, pad: number) => {
    const ys = (/points="([^"]+)"/.exec(svg)?.[1] ?? '').split(' ').map((p) => Number(p.split(',')[1]));
    return (Math.max(...ys) - Math.min(...ys)) / (h - pad);
  };

  it('draws a fall of one part in 176 nearly level, never as a plunge', () => {
    expect(extent(renderInlineSpark(ctx(), [176, 176, 176, 175, 175]), 16, 4)).toBeLessThan(0.1);
  });

  it('PRESERVATION — a real movement still uses the full height', () => {
    expect(extent(renderInlineSpark(ctx(), [9.6, 7, 5, 3.5]), 16, 4)).toBeCloseTo(1, 5);
    expect(extent(renderInlineSpark(ctx(), [820, 860, 910, 980, 1050, 1180]), 16, 4)).toBeCloseTo(1, 5);
  });

  it('a labelled margin spark prints its two end values and fills no area under a scale that is not zero-based', () => {
    const svg = renderMarginSpark(ctx(), [9.6, 7, 5, 3.5], { ends: true });
    expect(svg).toContain('>9.6</text>');
    expect(svg).toContain('>3.5</text>');
    expect(svg).not.toContain('<polygon');
  });
});

// ── A timeline draws only the horizons its items reach ───────────────────────

describe('the infrastructure ribbon', () => {
  const stops = (svg: string) => (svg.match(/<circle/g) ?? []).length;

  it('draws two stops for milestones at Existing and 0-2y, and no empty horizon beyond them', () => {
    const svg = renderTimelineRibbon(ctx(), [
      { phase: 'Existing', label: 'Bus stop: Windsor Rd Before President Rd' },
      { phase: '0-2y', label: 'Local bus-reliant commuting remains dominant' },
    ]);
    expect(stops(svg)).toBe(2);
    expect(svg).not.toContain('>3-5Y<');
    expect(svg).not.toContain('>5Y+<');
  });

  it('keeps an empty stop BETWEEN two that hold items — it is the distance between them', () => {
    const svg = renderTimelineRibbon(ctx(), [
      { phase: 'Existing', label: 'Rail' }, { phase: '5y+', label: 'Metro' },
    ]);
    expect(stops(svg)).toBe(4);
  });

  it('declines a single horizon, so the caller tabulates the milestones', () => {
    expect(renderTimelineRibbon(ctx(), [{ phase: 'Existing', label: 'Rail within 900m' }])).toBe('');
  });

  it('PRESERVATION — a ribbon using all four stops draws the path it always drew', () => {
    const svg = renderTimelineRibbon(ctx(), [
      { phase: 'Existing', label: 'a' }, { phase: '0-2y', label: 'b' },
      { phase: '3-5y', label: 'c' }, { phase: '5y+', label: 'd' },
    ]);
    expect(svg).toContain('d="M 98 86 C 192 68, 192 104, 286 86 S 380 104, 474 86 S 568 68, 662 86"');
  });
});

// ── A shared opening box is left empty rather than overfilled ────────────────

describe('the body\'s first box on the dashboard page', () => {
  const page = { width: 595, height: 842 };
  // Midnight Folio 03's dashboard: the body opens at 677.5pt, a continuation at 92pt.
  const first = { x: 51, y: 677.5, width: 493, bodyPt: 8.75, lineHeight: 1.55 };
  const cont = { ...first, y: 92 };

  it('is recognised as shared with the summary above it', () => {
    const g = narrativeGeometry(first, cont, page);
    expect(g.openingShared).toBe(true);
    expect(g.firstPageLines).toBe(6);
    expect(narrativeGeometry(cont, cont, page).openingShared).toBeUndefined();
  });

  const opening: MarkdownBlock[] = [
    { kind: 'heading', html: '<h2>Executive Verdict</h2>', lines: 1.9 },
    { kind: 'heading', html: '<h3>Overall Investment Verdict</h3>', lines: 1.3 },
    { kind: 'paragraph', html: `<p>${prose(900)}</p>`, lines: 8 },
    { kind: 'paragraph', html: '<p>Then the body continues.</p>', lines: 2 },
  ];
  const charge = (chars: number) => Math.max(1, Math.ceil(chars / 117));

  it('stands empty when its headings fit and nothing under them can — the body opens overleaf', () => {
    const pages = packMarkdownPages(opening, 48, {
      firstPageLines: 6, keepWithNext: true, splitParagraphs: charge, openingShared: true,
    });
    expect(pages[0]).toEqual([]);
    expect(pages[1].slice(0, 3)).toEqual(opening.slice(0, 3));
  });

  it('stands empty when the first thing it is offered does not fit and cannot be cut', () => {
    const tall: MarkdownBlock = { kind: 'figure', html: '<figure></figure>', lines: 12 };
    const pages = packMarkdownPages([tall, opening[3]], 48, { firstPageLines: 6, openingShared: true });
    expect(pages[0]).toEqual([]);
    expect(pages[1][0]).toBe(tall);
  });

  it('PRESERVATION — a first box on a page of its own is never emptied: that would be a blank page', () => {
    const pages = packMarkdownPages(opening, 48, { firstPageLines: 6, keepWithNext: true, splitParagraphs: charge });
    expect(pages[0].length).toBeGreaterThan(0);
  });
});

// ── Strengths and considerations ─────────────────────────────────────────────

describe('a lone strengths or considerations column', () => {
  const props = {
    x: 40, y: 100, width: 500,
    strengthsTitle: 'Strengths', watchTitle: 'Considerations',
    strengths: ['{{scores.strengths.0}}'], watch: ['{{scores.weaknesses.0}}'],
  };
  const block = { id: 'b', type: 'strengths-watch', props } as never;
  const data = { scores: { strengths: [], weaknesses: ['Below average rental yield'] } };

  it('opens the grid at the left margin in the typeset document', () => {
    const html = renderStrengthsWatchHtml(block, { data, tokens: {}, page: { width: 595, height: 842 }, pageIndex: 0 } as never);
    const grid = html.slice(html.indexOf('grid-template-columns'));
    expect(grid.indexOf('Considerations')).toBeGreaterThan(-1);
    expect(grid).not.toContain('<div></div>');
  });

  it('and in the browser\'s stand-in', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const render = { doc, page: { id: 'p', name: 'P', width: 595, height: 842, blocks: [] }, data, tokens: {} } as unknown as BlockRenderContext;
    drawStrengthsWatchBlock(block, render);
    const ops = ((doc as any).internal.pages[1] as string[]).join('\n');
    // jsPDF writes the column's title bar as `x y w h re`; the lone column's
    // starts at the block's own x.
    expect(ops).toMatch(/(^|\n)40\.?0* [\d.]+ [\d.]+ -?[\d.]+ re/);
  });
});

// ── The record's words, set as a reader reads them ────────────────────────────

describe('a register\'s capitals and a vocabulary word', () => {
  it('sets a council name as a name, and leaves a name somebody already typeset alone', () => {
    expect(presentableName('THE HILLS SHIRE')).toBe('The Hills Shire');
    expect(presentableName('CITY OF SYDNEY')).toBe('City of Sydney');
    expect(presentableName("HUNTER'S HILL")).toBe("Hunter's Hill");
    expect(presentableName('KU-RING-GAI')).toBe('Ku-ring-gai');
    expect(presentableName('Fraser Coast Regional')).toBe('Fraser Coast Regional');
    // A state's abbreviation keeps its capitals, bracketed or not.
    expect(presentableName('BAYSIDE (NSW)')).toBe('Bayside (NSW)');
    expect(presentableName('UNINCORPORATED ACT')).toBe('Unincorporated ACT');
  });

  it('sets a vocabulary word as a value', () => {
    expect(presentableTerm('house')).toBe('House');
    expect(presentableTerm('house_and_land')).toBe('House and land');
    expect(presentableTerm('Townhouse')).toBe('Townhouse');
  });

  it('reaches the page: the projection binds them so', () => {
    const p = projectInvestmentReport({
      property_address: '18 Annabelle Crescent, Kellyville NSW 2155',
      property_specs: { property_type: 'house', council_area: 'THE HILLS SHIRE' },
    } as never);
    expect((p.property as Record<string, unknown>).type).toBe('House');
    expect((p.property as Record<string, unknown>).council).toBe('The Hills Shire');
  });
});

// ── A stat card's figure, as the document writes it ──────────────────────────

describe('a stat card', () => {
  const card = (value: string, prose: string) => {
    const html = renderMarkdown(`${prose}\n\n::: stat label="Recorded crime rate" unit="per 100,000 residents"\n${value}\n:::\n`).html;
    return /stat-value[^>]*>([^<]*)/.exec(html)?.[1];
  };

  it('groups a four-digit figure the document writes grouped', () => {
    expect(card('2742', 'A rate of 2,742 incidents per 100,000 residents.')).toBe('2,742');
  });

  it('groups five digits and more, and never a year or a postcode', () => {
    expect(card('75699', 'Usual residents.')).toBe('75,699');
    expect(card('1941', 'Built in 1941.')).toBe('1941');
    expect(card('2155', 'Postcode 2155, beside 12,155 people.')).toBe('2155');
  });
});

// ── A donut's legend prints what the source wrote ────────────────────────────

describe('a donut', () => {
  const donut = (body: string) => parseVizDirective('donut', body) as Extract<ReturnType<typeof parseVizDirective>, { kind: 'donut' }>;

  it('draws five industries\' shares of a workforce against the whole, not against each other', () => {
    const d = donut('Health Care 12.9, Professional 10.9, Retail 9.5, Education 9, Construction 8.4 | title=Local industry mix · share of workforce');
    const r = donutReading(d);
    expect(r.whole).toBe(100);
    expect(d.segments.map((s) => r.display(s))).toEqual(['12.9%', '10.9%', '9.5%', '9%', '8.4%']);
  });

  it('prints counts as counts', () => {
    const d = donut('Very high advantage (decile 10) 4, Other deciles 0 | title=SEIFA profile (all indices)');
    const r = donutReading(d);
    expect(r.whole).toBeNull();
    expect(d.segments.map((s) => r.display(s))).toEqual(['4', '0']);
  });

  it('prints counts as counts under a title that calls them a share, or a centre written as one', () => {
    const d = donut('Owner-occupied 3200, Rented 1800 | title=Share of dwellings | center=64%');
    const r = donutReading(d);
    expect(r.whole).toBeNull();
    expect(d.segments.map((s) => r.display(s))).toEqual(['3200', '1800']);
  });

  it('PRESERVATION — parts that add to a hundred keep their percentages', () => {
    const d = donut('Council rates 40, Insurance 35, Maintenance 25 | title=Annual holding costs');
    const r = donutReading(d);
    expect(r.whole).toBeNull();
    expect(d.segments.map((s) => r.display(s))).toEqual(['40%', '35%', '25%']);
  });
});

// ── The fork's own title block is a second cover ──────────────────────────────

describe('a Financial Analysis or Due Diligence report read through a master', () => {
  const FORK = [
    '# Client Investment Feasibility & Financial Performance Report',
    '',
    '_Cashflow, lending, yield, sensitivity, projections and portfolio suitability assessment._',
    '',
    '**Property:** 18 Annabelle Crescent, Kellyville NSW 2155',
    '',
    '**Generated:** 17 September 2026',
    '',
    '---',
    '',
    '## Client Investment Decision Summary',
    '',
    'Body.',
  ].join('\n');

  it('loses its title block, which the master\'s cover already prints — so its chapters are the running heads', () => {
    const { text, strippedHeader } = stripBakedCover(FORK);
    expect(strippedHeader).toBe(true);
    expect(text.startsWith('## Client Investment Decision Summary')).toBe(true);
  });

  it('PRESERVATION — a narrative that opens with a lone title, or with prose under one fact line, keeps it', () => {
    const lone = '# A title\n\n_an italic line_\n\n---\n\nBody';
    expect(stripBakedCover(lone).text).toBe(lone);
    const prose = '# Title\n\n**Property:** x\n\nProse that is real.\n\n---\n\n## S';
    expect(stripBakedCover(prose).text).toBe(prose);
  });
});

// ── One figure, one name ─────────────────────────────────────────────────────

describe('the dimensions table in the Snapshot and the fork', () => {
  it('heads the renormalised weight as the Compass scorecard does', () => {
    const md = composeScoreDimensionsSection({
      breakdown: {
        yieldScore: { score: 23, weight: 21, hasData: true, excluded: false, details: 'Gross yield 2.97%' },
        demandScore: { score: 13, weight: 21, hasData: true, excluded: false, details: 'Population -0.4%' },
        growthScore: { score: 56, weight: 57, hasData: true, excluded: false, details: '6.2% a year' },
      },
    }, 'Score Breakdown');
    expect(md).toContain('| Dimension | Share of grade | Score |');
    expect(md).not.toContain('| Weight |');
  });
});

// ── The export surface ───────────────────────────────────────────────────────

describe('the report page\'s export controls', () => {
  const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

  it('offer "Choose template" for this format before "Export PDF", as every other report does', () => {
    const header = source('src/components/reports/report-view/InvestmentReportCommandHeader.tsx');
    const choose = header.indexOf('<ChooseTemplateButton');
    expect(choose).toBeGreaterThan(-1);
    // The button chooses the Investment format's template, not another's.
    expect(header.slice(choose, header.indexOf('/>', choose))).toContain('reportType="investment"');
    // And it sits before the act it governs.
    expect(header.indexOf("'Export PDF'")).toBeGreaterThan(choose);
    expect(header).not.toContain("'Download PDF'");
  });

  it('name the act "Export PDF" on the phone bar too', () => {
    const bar = source('src/components/reports/report-view/InvestmentReportMobileActionBar.tsx');
    expect(bar).toContain("'Export PDF'");
    expect(bar).not.toContain("'Download PDF'");
  });
});
