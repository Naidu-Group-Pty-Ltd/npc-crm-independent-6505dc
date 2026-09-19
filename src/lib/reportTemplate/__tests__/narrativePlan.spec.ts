/**
 * The narrative pre-pass: one geometry per run, one true page count, and both
 * renderers on it.
 *
 * A master carries the same source on a run of conditional pages, each
 * gated on `narrative.pages > n` and each drawing one bucket. The projection
 * publishes that count without a template in hand; the renderer knows the
 * template, computes the geometry every instance must pack with, and writes
 * the count that is actually true over the estimate before the first
 * conditional is read.
 */
import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '../htmlRenderer';
import { applyNarrativePlan, planNarrative, rewriteNoteCounts } from '../narrativePlan';
import { parseTemplate } from '../templateSchema';
import {
  NARRATIVE_GEOMETRY_KEY, NARRATIVE_NOTES_KEY, forgetNarrativeBuckets, narrativeBuckets, narrativeChartContext, resolveMarkdownBlockContent,
} from '../blocks/markdownBlockContent';
import type { NarrativeGeometry } from '../../../../supabase/functions/_shared/reports/narrativeGeometry.pure';
import { stripBakedCover } from '../../../../supabase/functions/_shared/reports/investment/narrativeClean.pure';
import { renderMarkdownBlockHtml } from '../blocks/markdownBlock.html';

const PARA = 'The property sits within an established residential pocket rather than in the immediate town centre, '
  + 'giving it a balanced blend of convenience and traditional house-and-yard living, with mature streetscapes. ';
/** About twenty pages of prose at a 9.5pt Noto Serif measure. */
const LONG = Array.from({ length: 70 }, (_, i) => `## Section ${i + 1}\n\n${PARA.repeat(6)}\n\n- One point\n- Another point\n`).join('\n');

const RUN = 12;
const markdown = (pageIndex: number, y: number) => ({
  id: `md-${pageIndex}`,
  type: 'markdown-block',
  props: {
    source: '{{narrative.source}}', pageIndex, linesPerPage: 34,
    bodySize: 9.5, bodyFont: 'token:body', headingFont: 'token:heading', lineHeight: 1.55,
    x: 68, y, width: 459,
  },
});
const page = (id: string, blocks: unknown[], conditional?: string) => ({
  id, name: id, size: { width: 595, height: 842 }, ...(conditional ? { conditional } : {}), blocks,
});

const template = () => ({
  version: 1,
  name: 'Narrative probe',
  tokens: {
    colors: { ink: '#111', surface: '#fff', primary: '#2F4858', text: '#111', muted: '#666', border: '#ddd', line: '#ccc', bg: '#eee', panel: '#f4f4f4' },
    fonts: { body: 'Noto Serif, serif', heading: 'Noto Serif, serif' },
    spacing: {},
  },
  slots: {},
  pages: [
    page('cover', [{ id: 'c', type: 'text-block', props: { x: 40, y: 200, width: 500, body: 'Cover' } }]),
    page('report-1', [markdown(0, 199)], 'narrative && narrative.source'),
    ...Array.from({ length: RUN - 1 }, (_, i) => page(`report-${i + 2}`, [markdown(i + 1, 114)], `narrative && narrative.pages > ${i + 1}`)),
    page('cut', [{ id: 'n', type: 'text-block', props: { x: 68, y: 114, width: 459, body: 'Not the whole report' } }], `narrative && narrative.pages > ${RUN}`),
  ],
});

const data = (source: string, estimate: number) => ({
  report: { type: 'investment' },
  narrative: { source, pages: estimate },
});

const pagesOf = (html: string) => html.match(/class="tpl-page tpl-page-\d+"/g) ?? [];

describe('planNarrative', () => {
  it('derives one geometry per run from the first and continuation boxes, and the true page count', () => {
    forgetNarrativeBuckets();
    const tpl = parseTemplate(template());
    const ctx = { data: data(LONG, 1), tokens: tpl.tokens };
    const plan = planNarrative(tpl, ctx);
    expect(plan).not.toBeNull();
    const g = plan!.geometry['{{narrative.source}}'];
    expect(g.bodyPt).toBe(9.5);
    expect(g.widthPt).toBe(459);
    expect(g.firstPageLines).toBeLessThan(g.contLines);
    // The projection said one page; the geometry knows better.
    expect(plan!.pages['narrative.pages']).toBeGreaterThan(5);
  });

  it('does nothing for a format that is not geometry-aware', () => {
    const tpl = parseTemplate(template());
    expect(planNarrative(tpl, { data: { report: { type: 'cashflow' }, narrative: { source: LONG } }, tokens: tpl.tokens })).toBeNull();
  });

  it('answers for Market Intelligence and Report Q&A, which are geometry-aware by measurement (RS-5c.6)', () => {
    const tpl = parseTemplate(template());
    for (const type of ['market_intelligence', 'qa']) {
      const plan = planNarrative(tpl, { data: { report: { type }, narrative: { source: LONG, pages: 1 } }, tokens: tpl.tokens });
      expect(plan, type).not.toBeNull();
      expect(plan!.pages['narrative.pages'], type).toBeGreaterThan(5);
    }
  });

  it('writes the count over the estimate without touching the caller\'s data', () => {
    const tpl = parseTemplate(template());
    const input = data(LONG, 1);
    const ctx = { data: input, tokens: tpl.tokens };
    const out = applyNarrativePlan(ctx, planNarrative(tpl, ctx));
    expect((out.data as { narrative: { pages: number } }).narrative.pages).toBeGreaterThan(5);
    expect(input.narrative.pages).toBe(1);
    expect((out as unknown as Record<string, unknown>)[NARRATIVE_GEOMETRY_KEY]).toBeDefined();
  });
});

describe('the render draws what the geometry counts', () => {
  it('draws exactly the pages the buckets fill, whatever the projection estimated', () => {
    forgetNarrativeBuckets();
    const tpl = template();
    const low = renderTemplateToHtml(tpl, { data: data(LONG, 1) });
    const high = renderTemplateToHtml(tpl, { data: data(LONG, 40) });
    expect(pagesOf(low.html)).toHaveLength(pagesOf(high.html).length);
    // The cover plus exactly the pages the geometry counted.
    const parsed = parseTemplate(tpl);
    const seed = { data: data(LONG, 1), tokens: parsed.tokens };
    const counted = planNarrative(parsed, seed)!.pages['narrative.pages'];
    expect(counted).toBeGreaterThan(RUN);
    // The template reserves RUN pages for the run; past that the cut notice is drawn.
    expect(pagesOf(low.html)).toHaveLength(1 + RUN + 1);
    expect(low.html).toContain('Not the whole report');
  });

  it('every instance packs the SAME buckets — no line is drawn twice or lost between pages', () => {
    forgetNarrativeBuckets();
    const tpl = parseTemplate(template());
    const seed = { data: data(LONG, 1), tokens: tpl.tokens };
    const ctx = applyNarrativePlan(seed, planNarrative(tpl, seed));
    const instances = tpl.pages.flatMap((p) => p.blocks).filter((b) => b.type === 'markdown-block');
    const contents = instances.map((b) => resolveMarkdownBlockContent(b, ctx)!);
    const counts = new Set(contents.map((c) => c.pageCount));
    expect(counts.size).toBe(1);
    // Concatenating every bucket gives the memoised run's blocks once, in order.
    const drawn = contents.flatMap((c) => c.page.map((b) => b.html));
    const g = (ctx as unknown as Record<string, unknown>)[NARRATIVE_GEOMETRY_KEY] as Record<string, NarrativeGeometry>;
    const run = narrativeBuckets(stripBakedCover(LONG).text, g['{{narrative.source}}'], narrativeChartContext(ctx, g['{{narrative.source}}']));
    expect(run.length).toBe(counts.values().next().value);
    // The instances cover the first RUN buckets of the run, in order, exactly once.
    expect(drawn).toEqual(run.slice(0, instances.length).flat().map((b) => b.html));
  });

  it('the cut notice fires only on the true count', () => {
    forgetNarrativeBuckets();
    const tpl = template();
    // A source short enough for one page: the estimate says 41, the geometry says 1.
    const { html } = renderTemplateToHtml(tpl, { data: data(PARA.repeat(3), 41) });
    expect(html).not.toContain('Not the whole report');
    expect(pagesOf(html)).toHaveLength(2);
  });

  it('the block draws the compact figure at the compact width with the block\'s own margins', () => {
    forgetNarrativeBuckets();
    const tpl = parseTemplate(template());
    const source = `${PARA}\n\n{{gauge: value=72 max=100 label="Location & Property Fit" caption="A home in a stable regional township"}}\n\n${PARA}`;
    const seed = { data: data(source, 1), tokens: tpl.tokens };
    const ctx = applyNarrativePlan(seed, planNarrative(tpl, seed));
    const block = tpl.pages[1].blocks[0];
    const html = renderMarkdownBlockHtml(block, { ...ctx, page: { width: 595, height: 842 }, pageIndex: 0, pages: [], slots: {} } as never);
    expect(html).toContain('<figure class="chart-figure chart-compact" style="margin:6pt 0 8pt;width:60.5%;">');
    expect(html).toContain('<img class="chart-img"');
    expect(html).toContain('style="display:block;width:100%;height:auto;"');
  });
});

/**
 * RS-5c.6 — the shape the Market Intelligence and Report Q&A masters give a
 * run: pages gated on `ns.layers[0].pages > n` (or `qa.answerPages > n`), an
 * allowance of a few pages, and the omission written on a page of its own.
 */
const NOTE = 'This section continues for 9 further pages, which are not shown in this edition.';
const layerMarkdown = (pageIndex: number, y: number) => ({
  id: `l-${pageIndex}`,
  type: 'markdown-block',
  props: {
    source: '{{mi.layers.0.content}}', pageIndex, linesPerPage: 34,
    bodySize: 9.5, bodyFont: 'token:body', headingFont: 'token:heading', lineHeight: 1.55,
    x: 57, y, width: 481,
  },
});
const HAS = 'mi && mi.layers && mi.layers[0]';
const layerTemplate = () => ({
  ...template(),
  pages: [
    page('layer', [layerMarkdown(0, 185)], HAS),
    page('layer-2', [layerMarkdown(1, 103)], `${HAS} && mi.layers[0].pages > 1`),
    page('layer-3', [layerMarkdown(2, 103)], `${HAS} && mi.layers[0].pages > 2`),
    page('layer-continues', [{
      id: 'note', type: 'callout',
      props: { title: 'This section continues', body: '{{mi.layers.0.omissionNote}}', x: 57, y: 103, width: 481 },
    }], `${HAS} && mi.layers[0].omissionNote`),
  ],
});
const layerData = (content: string) => ({
  report: { type: 'market_intelligence' },
  mi: { layers: [{ content, pages: 12, omissionNote: NOTE }] },
});

describe('a run the master allows a few pages, with its omission on a page of its own', () => {
  it('reads the pages path off the continuation conditional and writes the true count there, keeping the array', () => {
    forgetNarrativeBuckets();
    const tpl = parseTemplate(layerTemplate());
    const seed = { data: layerData(LONG), tokens: tpl.tokens };
    const plan = planNarrative(tpl, seed)!;
    expect(plan).not.toBeNull();
    const count = plan.pages['mi.layers.0.pages'];
    expect(count).toBeGreaterThan(3);
    expect(count).not.toBe(12);
    const out = applyNarrativePlan(seed, plan);
    const mi = (out.data as { mi: { layers: Array<Record<string, unknown>> } }).mi;
    expect(Array.isArray(mi.layers)).toBe(true);
    expect(mi.layers[0].pages).toBe(count);
    // The caller's data is untouched.
    expect((seed.data.mi.layers[0] as { pages: number }).pages).toBe(12);
  });

  it('folds the note onto the last allowed page with the true count, and the page of its own never draws', () => {
    forgetNarrativeBuckets();
    const tpl = parseTemplate(layerTemplate());
    const seed = { data: layerData(LONG), tokens: tpl.tokens };
    const plan = planNarrative(tpl, seed)!;
    const note = plan.notes['{{mi.layers.0.content}}'];
    expect(note).toBeDefined();
    expect(note.allowance).toBe(3);
    expect(note.label).toBe('This section continues');
    const count = plan.pages['mi.layers.0.pages'];
    expect(note.text).toBe(`This section continues for ${count - 3} further pages, which are not shown in this edition.`);
    expect(plan.writes['mi.layers.0.omissionNote']).toBeUndefined();
    expect('mi.layers.0.omissionNote' in plan.writes).toBe(true);

    const ctx = applyNarrativePlan(seed, plan);
    expect((ctx.data as { mi: { layers: Array<Record<string, unknown>> } }).mi.layers[0].omissionNote).toBeUndefined();
    expect((ctx as unknown as Record<string, unknown>)[NARRATIVE_NOTES_KEY]).toBeDefined();
    const blocks = tpl.pages.flatMap((p) => p.blocks).filter((b) => b.type === 'markdown-block');
    const last = resolveMarkdownBlockContent(blocks[2], ctx)!;
    const tail = last.page[last.page.length - 1];
    expect(tail.kind).toBe('notice');
    expect(tail.html).toContain('This section continues');
    expect(tail.html).toContain(`${count - 3} further pages`);
    const middle = resolveMarkdownBlockContent(blocks[1], ctx)!;
    expect(middle.page.some((b) => b.kind === 'notice')).toBe(false);

    // Rendered: exactly the three allowed pages — no fourth sheet for the note.
    const { html } = renderTemplateToHtml(layerTemplate(), { data: layerData(LONG) });
    expect(pagesOf(html)).toHaveLength(3);
    expect((html.match(/This section continues for/g) ?? []).length).toBe(1);
  });

  it('a run that fits its allowance draws no note and the note page stays dark', () => {
    forgetNarrativeBuckets();
    const short = PARA.repeat(4);
    const tpl = parseTemplate(layerTemplate());
    const plan = planNarrative(tpl, { data: layerData(short), tokens: tpl.tokens })!;
    expect(plan.pages['mi.layers.0.pages']).toBe(1);
    expect(plan.notes['{{mi.layers.0.content}}']).toBeUndefined();
    expect('mi.layers.0.omissionNote' in plan.writes).toBe(true);
    const { html } = renderTemplateToHtml(layerTemplate(), { data: layerData(short) });
    expect(pagesOf(html)).toHaveLength(1);
    expect(html).not.toContain('This section continues');
  });
});

describe('the note keeps its words and takes the true counts', () => {
  it('swaps the hidden count and the estimate in one pass, and agrees the plural', () => {
    expect(rewriteNoteCounts(NOTE, { estimate: 12, count: 7, allowance: 3 }))
      .toBe('This section continues for 4 further pages, which are not shown in this edition.');
    expect(rewriteNoteCounts(NOTE, { estimate: 12, count: 4, allowance: 3 }))
      .toBe('This section continues for 1 further page, which are not shown in this edition.');
    expect(rewriteNoteCounts(
      'The answer runs to 26 pages and this document sets the first 8. The complete text is in the Markdown export.',
      { estimate: 26, count: 11, allowance: 8 },
    )).toBe('The answer runs to 11 pages and this document sets the first 8. The complete text is in the Markdown export.');
  });

  it('leaves a sentence alone when the estimate was right', () => {
    expect(rewriteNoteCounts(NOTE, { estimate: 12, count: 12, allowance: 3 })).toBe(NOTE);
  });
});
