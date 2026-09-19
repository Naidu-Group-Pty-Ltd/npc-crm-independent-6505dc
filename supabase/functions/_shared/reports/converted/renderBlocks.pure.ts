/**
 * Enriched blocks, rendered through the design system's own primitives.
 *
 * One adapter per block kind and nothing else. Every one is a translation from
 * the closed vocabulary in `enrich.pure.ts` to a function that already exists
 * in `reportDesign/`, and none of them builds HTML of its own. That is the
 * point: a model chose `kpi`, and what a KPI strip looks like under a given
 * brand design system remains entirely the design system's business.
 *
 * `row` is the one adapter that recurses, and the only one that makes a layout
 * decision — it maps two or three blocks onto `renderGrid12`. The spans are
 * chosen here rather than by the model, and a chart inside a column is given a
 * context at the *column's* width, because a chart drawn for the full measure
 * and then scaled into a third of it prints an axis label four points tall.
 *
 * ## Escaping
 *
 * Every string here reaches the page through a primitive that escapes it —
 * `renderKpiStrip`, `renderDataTable` and the chart builders all escape their
 * own inputs. The two that do **not** are `renderCallout` and `renderSidenote`,
 * whose bodies are raw HTML by design, so both adapters escape before calling
 * them and turn blank lines into paragraphs by hand. That asymmetry is the one
 * thing in this file worth checking twice; a spec pins it.
 *
 * ## Charts need a context, and it is already here
 *
 * `chartContext(palette)` is all the plumbing a chart takes, and
 * `renderConvertedBody` already holds the resolved palette. `chartFigure` wraps
 * the SVG with its caption, and `assertSafeRenderResources` already permits
 * inline SVG — so no part of getting charts into a converted document needed
 * new machinery. It needed something to decide a chart belonged there.
 */
import {
  escapeHtml,
  renderCallout,
  renderDataTable,
  renderDecisionBox,
  renderGrid12,
  renderKpiStrip,
  renderLede,
  renderPullQuote,
  renderSidenote,
  type GridCol,
  type GridSpan,
  type TableColumn,
  type TableRow,
} from '../../reportDesign/primitives.pure.ts';
import {
  chartFigure,
  renderBars,
  renderBullet,
  renderDonut,
  renderGauge,
  renderWaterfall,
  type ChartContext,
} from '../../reportDesign/charts.pure.ts';
import { spanWidthMm } from '../../reportDesign/page.pure.ts';
import { renderMarkdown } from '../markdown.pure.ts';
import { blockLines, type EnrichedBlock } from './enrich.pure.ts';

/** Plain text to escaped paragraphs, so a callout body keeps its breaks. */
function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

export interface RenderBlocksResult {
  html: string;
  /** Estimated printed lines, from `blockLines`, for the page budget. */
  lines: number;
  /** Blocks a primitive refused at render time, by kind. */
  dropped: string[];
}

/**
 * Render one chapter's blocks.
 *
 * A block whose primitive returns `''` is dropped and recorded rather than
 * leaving a hole in the page budget. The charts return `''` on input the reader
 * already rejects, so in practice this only fires on something new — which is
 * exactly when a silent hole would be hardest to explain.
 */
export function renderEnrichedBlocks(
  blocks: readonly EnrichedBlock[],
  ctx: ChartContext,
  idPrefix: string,
): RenderBlocksResult {
  const parts: string[] = [];
  const dropped: string[] = [];
  let lines = 0;

  blocks.forEach((b, i) => {
    const html = renderBlock(b, ctx, `${idPrefix}b${i}`);
    if (!html) { dropped.push(b.kind); return; }
    parts.push(html);
    lines += blockLines(b);
  });

  return { html: parts.join(''), lines, dropped };
}

function renderBlock(b: EnrichedBlock, ctx: ChartContext, idPrefix: string): string {
  switch (b.kind) {
    case 'lede':
      return renderLede(b.text);

    case 'kpi':
      return renderKpiStrip(b.cells.map((c) => ({
        label: c.label,
        value: c.value,
        foot: c.foot,
        tone: c.tone,
      })));

    case 'table': {
      // Positional cells become keyed ones here — see the note on the schema in
      // `enrich.pure.ts` for why the model was never asked to keep keys.
      const cols: TableColumn[] = b.columns.map((c, i) => ({
        key: `c${i}`,
        label: c.label,
        align: c.align,
      }));
      const signed = new Set(b.signedColumns ?? []);
      const rows: TableRow[] = b.rows.map((r) => {
        const row: TableRow = {};
        cols.forEach((c, i) => { row[c.key] = r.cells[i] ?? ''; });
        if (r.total) row.__total = true;
        return row;
      });
      return renderDataTable(cols, rows, {
        caption: b.caption,
        signedKeys: cols.filter((_, i) => signed.has(i)).map((c) => c.key),
      });
    }

    case 'callout':
      // Raw-HTML body: escaped here, because the primitive will not.
      return renderCallout(b.tone, b.label, paragraphs(b.text));

    case 'sidenote':
      return renderSidenote(b.label, paragraphs(b.text));

    case 'bars':
      return chartFigure(
        renderBars(ctx, b.items, { title: b.title, unit: b.unit }),
        b.caption ?? '',
      );

    case 'donut':
      return chartFigure(
        renderDonut(ctx, b.segments, {
          title: b.title,
          centerLabel: b.centerLabel,
          centerSub: b.centerSub,
        }),
        b.caption ?? '',
      );

    case 'bullet':
      return chartFigure(
        renderBullet(ctx, {
          value: b.value,
          target: b.target,
          max: b.max,
          label: b.label,
          sub: b.sub,
        }),
        b.caption ?? '',
      );

    case 'waterfall':
      return chartFigure(
        renderWaterfall(ctx, b.items.map((i) => ({
          label: i.label, value: i.value, total: i.total,
        }))),
        b.caption ?? '',
      );

    case 'gauge':
      return chartFigure(
        renderGauge(ctx, b.value, { max: b.max, label: b.label }),
        b.caption ?? '',
      );

    case 'decision':
      // Raw-HTML body, like the callout — escaped here.
      return renderDecisionBox(b.label, paragraphs(b.text));

    case 'quote':
      return renderPullQuote(b.text, b.attribution);

    case 'row': {
      // The 12-column grid takes spans of 4, 5, 7 or 8, so two across is 6+6 —
      // which it cannot express — and three across is 4+4+4, which it can. Two
      // becomes 8+4 with the taller block leading, which reads better than a
      // dead-even split anyway: a KPI beside a note, not two half-pages.
      const spans: GridSpan[] = b.blocks.length >= 3 ? [4, 4, 4] : [8, 4];
      // A chart in a column is drawn at the column's width, not the measure's.
      // Rendering it full-width and letting CSS scale it is how an axis label
      // ends up four points tall.
      const cols: GridCol[] = b.blocks.slice(0, spans.length).map((inner, i) => ({
        span: spans[i],
        html: renderBlock(inner, { ...ctx, widthMm: spanWidthMm(spans[i]) }, `${idPrefix}c${i}`),
      })).filter((c) => c.html);
      return cols.length >= 2 ? renderGrid12(cols) : (cols[0]?.html ?? '');
    }

    case 'prose':
      return renderMarkdown(b.markdown, { idPrefix }).html;
  }
}
