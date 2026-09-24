/**
 * The model's chart vocabulary, drawn.
 *
 * `vizDirectives.pure.ts` parses `{{bars: …}}` into typed data and deliberately
 * stops there. This is the other half: one function that takes a parsed
 * directive and a `ChartContext` and returns design-system HTML, so that
 * `markdown.pure.ts` can stay ignorant of palettes and column widths.
 *
 * ## Eleven of twelve were already built
 *
 * `reportDesign/charts.pure.ts` has carried `renderBars`, `renderDonut`,
 * `renderGauge`, `renderHeatmap`, `renderMarginSpark`, `renderPictograph`,
 * `renderQuadrant`, `renderTiles`, `renderTimelineRibbon`, `renderWaterfall`
 * and `renderScoreBars` since the design system was built, each tested. The
 * generator's prompt asks the model for exactly those eleven shapes. Nobody had
 * ever joined the two, so 2,601 directives set as body copy while eleven
 * finished chart primitives sat unused. This module is that join, and it is
 * almost entirely argument mapping — which is the point.
 *
 * `glance` is the twelfth and the exception: it is a strip of symbol-prefixed
 * assertions (`✓ Strong regional rental demand | ⚠ Resources-linked economy`),
 * not a plot. It was drawn as a neutral callout carrying a list, on the
 * grounds that *"a new `.glance-strip` rule would be a new thing to style,
 * test and keep in print contrast for no gain over a callout"* — a reasonable
 * call about implementation cost and a wrong one about the page. Twelve washed,
 * left-ruled boxes of raw dingbats reached one Compass, three of them on one
 * page. It is a ruled key now; `glanceStrip.pure.ts` carries what was wrong
 * with the box and what replaced it.
 *
 * ## Height is measured, not guessed
 *
 * Every chart is emitted `width="100%"` with a `viewBox`, so its printed height
 * is `H / W × columnWidth` and nothing else. `figureLines` reads the viewBox off
 * the SVG the primitive actually produced rather than carrying a per-kind table
 * that goes stale the first time a chart's padding changes. A caption adds one
 * line; a chart that refused to draw costs nothing.
 */
import { glanceRows, renderGlanceStrip } from './glanceStrip.pure.ts';
import {
  chartFigure,
  renderBars,
  renderInlineSpark,
  renderDonut,
  renderGauge,
  renderHeatmap,
  renderMarginSpark,
  renderPictograph,
  renderQuadrant,
  renderScoreBars,
  renderTiles,
  renderTimelineRibbon,
  renderWaterfall,
  CHART_TARGET_WIDTH_MM,
  COMPACT_FIGURE_FRACTION,
  type ChartContext,
} from '../reportDesign/charts.pure.ts';
import {
  escapeHtml, renderDataTable, renderSidenote,
} from '../reportDesign/primitives.pure.ts';
import { isPlaceholderValue, splitRefusedItem, type VizDirective } from './vizDirectives.pure.ts';
import {
  calloutCharge, figureCharge, sidenoteCharge, tableCharge, type NarrativeGeometry,
} from './narrativeGeometry.pure.ts';

/**
 * One body line, in millimetres.
 *
 * `LINES_PER_PAGE` is 38 across a 253mm text block (`markdown.pure.ts:166`,
 * `page.pure.ts:41`), so a line is 6.66mm. Restated here rather than imported
 * because this module is about geometry and that module is about Markdown;
 * the number is pinned by the same render either way.
 */
export const MM_PER_LINE = 253 / 38;

/** A figure the caller can place: the HTML, and what it costs the page. */
export interface VizFigure {
  html: string;
  lines: number;
}

const VIEW_BOX = /viewBox="0 0 ([\d.]+) ([\d.]+)"/;

/**
 * What this figure will occupy, in body lines.
 *
 * Read off the emitted `viewBox`, so a chart that changes its own padding
 * changes its page cost with it. Anything without one — a callout, a sidenote —
 * falls back to counting its text.
 */
export function figureLines(html: string, widthMm: number, captioned = false): number {
  const m = VIEW_BOX.exec(html);
  if (!m) {
    const words = html.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).length;
    return Math.max(2, Math.ceil(words / 11) + 1);
  }
  const w = Number(m[1]) || 1;
  const h = Number(m[2]) || 1;
  const heightMm = (h / w) * widthMm;
  return Math.max(2, Math.ceil(heightMm / MM_PER_LINE) + (captioned ? 1 : 0));
}

/** Height over width of the emitted `viewBox`, or null when there is none. */
export function viewBoxRatio(svg: string): number | null {
  const m = VIEW_BOX.exec(svg);
  if (!m) return null;
  const w = Number(m[1]) || 0;
  const h = Number(m[2]) || 0;
  return w > 0 && h > 0 ? h / w : null;
}

/** A short, bounded description for the `alt` a tagged PDF needs. */
function describe(d: VizDirective): string {
  const cap = (s: string) => (s.length > 180 ? `${s.slice(0, 179)}…` : s);
  switch (d.kind) {
    case 'bars':
      return cap(`Bar chart${d.title ? `: ${d.title}` : ''}. `
        + d.items.map((i) => `${i.label} ${i.display ?? i.value}`).join('; '));
    case 'donut':
      return cap(`Proportional chart${d.title ? `: ${d.title}` : ''}. `
        + d.segments.map((s) => `${s.label} ${s.display ?? s.value}`).join('; '));
    case 'gauge':
      return cap(`${d.label ?? 'Score'}: ${d.value} out of ${d.max}.`
        + (d.caption ? ` ${d.caption}` : ''));
    case 'heatmap':
      return cap(`Matrix${d.title ? `: ${d.title}` : ''}, `
        + `${d.grid.length} rows by ${d.grid[0]?.length ?? 0} columns.`);
    case 'pictograph':
      return cap(`${d.label ?? 'Proportion'}: ${d.filled} in ${d.total}.`
        + (d.sub ? ` ${d.sub}` : ''));
    case 'quadrant':
      return cap(`Positioning chart${d.title ? `: ${d.title}` : ''}. `
        + d.points.map((p) => `${p.label} at ${p.x}, ${p.y}`).join('; '));
    case 'tiles':
      return cap(`Comparison tiles${d.title ? `: ${d.title}` : ''}. `
        + d.tiles.map((t) => `${t.label}${t.value ? ` ${t.value}` : ''}`).join('; '));
    case 'timeline':
      return cap(`Timeline${d.title ? `: ${d.title}` : ''}. `
        + d.items.map((i) => `${i.phase}, ${i.label}`).join('; '));
    case 'waterfall':
      return cap(`Waterfall${d.title ? `: ${d.title}` : ''}. `
        + d.items.map((i) => `${i.label} ${i.value}`).join('; '));
    case 'wheel':
      return cap(`Score wheel${d.title ? `: ${d.title}` : ''}. `
        + d.scores.map((s, i) => `${d.labels[i] ?? `Dimension ${i + 1}`} ${s}`).join('; '));
    default:
      return '';
  }
}

/**
 * Draw one directive, or return null.
 *
 * Null covers both "this kind has no plot" and "the primitive refused" — every
 * chart in `charts.pure.ts` returns `''` rather than drawing something absurd
 * when its own caps are exceeded, and that refusal is passed straight through.
 * The caller drops and counts; nothing is printed as source.
 */
export function renderVizDirective(
  ctx: ChartContext,
  d: VizDirective,
  geometry: NarrativeGeometry | null = null,
): VizFigure | null {
  // Four kinds are drawn at `CHART_WIDTH.compact` and print at that width.
  // Stretching a gauge across the measure spends 136mm of a 253mm text block on
  // one number, and the corpus averages fifteen gauges a report.
  const compact = d.kind === 'gauge' || d.kind === 'donut'
    || d.kind === 'wheel' || d.kind === 'pictograph';
  const drawCtx = compact
    ? { ...ctx, widthMm: ctx.widthMm * COMPACT_FIGURE_FRACTION }
    : ctx;

  // With a geometry the charge is the figure's printed height on THAT page —
  // its aspect ratio at the block's measure (or the compact fraction of it),
  // plus the block's own figure margins and caption — rather than the
  // `MM_PER_LINE` constant, which is one family's leading and charged a gauge
  // on a 14.7pt pitch at 62% of what it drew.
  const wrap = (svg: string, caption = ''): VizFigure | null => {
    if (!svg) return null;
    const html = chartFigure(svg, caption, describe(d), compact ? 'compact' : 'full');
    if (!html) return null;
    const lines = geometry
      ? figureCharge(geometry, viewBoxRatio(svg) ?? 0.5, compact, Boolean(caption))
      : figureLines(svg, drawCtx.widthMm, Boolean(caption));
    return { html, lines };
  };

  /*
   * A chart that cannot plot everything it was handed is not a chart.
   *
   * `labelledValues` refuses a range (`~0.5–1.6 km`) and an item with no
   * figure at all, and both refusals are correct — the low end of a range is
   * not the figure and the midpoint is not in the source. What was wrong is
   * that the survivors were then drawn as though they were the whole series.
   * The Cowra Compass printed ONE bar under "Indicative reach from 48 Redfern
   * Street" where the model had named five amenities, and a second directive
   * disappeared outright because none of its three items carried a number.
   * Nine of fifteen items and one whole chart left that document with nothing
   * on the page to show for it.
   *
   * So the figure declines and the same data is set as a table: every label
   * the reader was promised, every value verbatim, nothing computed and
   * nothing invented. It is `vizDirectiveTables`' own rule — a promise of a
   * figure is a figure — applied on the path that draws rather than the path
   * that tabulates, which is what makes it reach all five formats.
   */
  const asTable = (
    all: { label: string; value: string }[],
    valueHeading: string,
  ): VizFigure | null => {
    /*
     * An item whose value is `n/a` promised no figure — it stated an absence,
     * and a placeholder never reaches a client document. Page 20 of the
     * 9 Hollow Street Compass (20 Sep 2026) printed `Victoria dwellings
     * benchmark | (blank)` beside a subject price and a suburb median.
     * `stripPlaceholderRows` could not see it: this table is built at render
     * time and never exists as markdown. The rule is `isPlaceholderValue`,
     * imported rather than restated, and where nothing survives the figure
     * declines entirely.
     */
    const rows = all.filter((r) => !isPlaceholderValue(r.value));
    if (!rows.length) return null;
    const caption = d.kind === 'bars' || d.kind === 'donut' ? d.title : undefined;
    const html = renderDataTable(
      [{ key: 'label', label: 'Item' }, { key: 'value', label: valueHeading, align: 'right' }],
      rows.map((r) => ({ label: r.label, value: r.value })),
      { caption },
    );
    if (!html) return null;
    // With a geometry it is charged as the table it is — rows, head, caption
    // and margin at the page's own measure. The constant below charged a
    // five-row table with a caption seven lines where the engine drew ten
    // (18 Annabelle Crescent, Board Pack Brief, 23 Sep 2026), which is text
    // set through the foot of a page packed to its budget.
    const lines = geometry
      ? tableCharge(geometry, rows.map((r) => [r.label, r.value]), 2, ['Item', valueHeading], caption ?? '').total
      : rows.length + (('title' in d && d.title) ? 2 : 1);
    return { html, lines };
  };

  switch (d.kind) {
    case 'bars':
      if (d.refused?.length) {
        return asTable(
          d.sources?.length
            ? d.sources.map(splitRefusedItem)
            : d.items.map((i) => ({ label: i.label, value: i.display ?? String(i.value) })),
          d.unit ? `Value (${d.unit})` : 'Value',
        );
      }
      return wrap(renderBars(
        ctx,
        d.items.map((i) => ({ label: i.label, value: i.value, display: i.display })),
        { title: d.title, max: d.max, unit: d.unit },
      ));

    case 'donut':
      if (d.refused?.length) {
        return asTable((d.sources ?? []).map(splitRefusedItem), 'Share');
      }
      return wrap(renderDonut(
        drawCtx,
        d.segments.map((s) => ({ label: s.label, value: s.value })),
        { title: d.title, centerLabel: d.center, centerSub: d.centerSub },
      ));

    case 'gauge':
      // The gauge draws its own label and caption; a `title` option does not
      // exist for this kind in the corpus, so there is nothing left to caption.
      return wrap(renderGauge(drawCtx, d.value, { max: d.max, label: d.label, caption: d.caption }));

    case 'glance': {
      // Not a plot — a section's findings, set as a ruled key. The glyph is an
      // INPUT vocabulary: `glanceTone` reads its meaning and the page prints
      // the word, so a model writing `▲` and one writing `⚠` produce the same
      // key and neither reaches the paper. See `glanceStrip.pure.ts` for what
      // the washed, dingbat-stacked callout this replaces got wrong.
      const rows = glanceRows(d.items);
      if (!rows.length) return null;
      const html = renderGlanceStrip(d.items, escapeHtml);
      if (!html) return null;
      // Charged on what it will DRAW, not on what was parsed: a repeated or
      // empty finding is dropped, so the rows are the rows.
      return {
        html,
        lines: geometry
          ? calloutCharge(geometry, rows.map((r) => `${r.tag}  ${r.text}`.length))
          : rows.length + 2,
      };
    }

    case 'heatmap':
      return wrap(renderHeatmap(ctx, d.grid, {
        rowLabels: d.rowLabels, colLabels: d.colLabels, title: d.title,
      }));

    case 'margin': {
      // A sidenote, not a chart: the directive's whole purpose is to push
      // secondary context out of the main column. The spark rides inside it.
      //
      const spark = d.spark.length >= 2 ? renderMarginSpark(ctx, d.spark) : '';
      const body = (d.heading ? `<p><strong>${escapeHtml(d.heading)}</strong></p>` : '')
        + (d.note ? `<p>${escapeHtml(d.note)}</p>` : '')
        + spark;
      if (!body) return null;
      const html = renderSidenote(d.label ?? 'Context', body);
      const lines = geometry
        ? sidenoteCharge(geometry, [d.heading ?? '', d.note ?? ''].filter(Boolean).map((t) => t.length))
          + (spark ? figureCharge(geometry, viewBoxRatio(spark) ?? 0.25, false, false) : 0)
        : figureLines(html, ctx.widthMm);
      return { html, lines };
    }

    case 'pictograph':
      return wrap(renderPictograph(drawCtx, d.filled, d.total, {
        icon: d.icon, label: d.label, sub: d.sub, cols: d.cols,
      }));

    case 'quadrant':
      return wrap(renderQuadrant(ctx, d.points, {
        xLabel: d.xLabel, yLabel: d.yLabel, xMax: d.xMax, yMax: d.yMax,
        title: d.title, q1: d.q1, q2: d.q2, q3: d.q3, q4: d.q4,
      }));

    case 'tiles':
      return wrap(renderTiles(
        ctx,
        d.tiles.map((t) => ({ label: t.label, value: t.value, sub: t.sub, intensity: t.intensity })),
        { title: d.title, cols: d.cols },
      ));

    case 'timeline':
      /*
       * The ribbon has four fixed stops, so it can only draw a phase it
       * recognises and at most two items per stop. It refuses otherwise, and
       * a refusal must not delete the milestones — placing an unreadable
       * phase at the far end of the axis is inventing a horizon, which is
       * what §3 forbids, and the Cowra Compass printed the model's NEXT TWO
       * YEARS under "5Y+" for exactly that reason.
       *
       * Tabulated, the reader gets the model's own phase words verbatim.
       */
      return wrap(renderTimelineRibbon(ctx, d.items, { title: d.title }))
        ?? asTable(d.items.map((i) => ({ label: i.phase, value: i.label })), 'Milestone');

    case 'waterfall':
      return wrap(renderWaterfall(ctx, d.items, { mode: 'money' }));

    case 'wheel':
      // The directive keeps its name — ~35 stored reports emit `{{scorewheel:}}`
      // and their figures must still draw — but what it draws is a scorecard on
      // a common baseline. `renderScoreBars` takes no title of its own, so the
      // directive's becomes the figure's caption rather than being dropped.
      return wrap(
        renderScoreBars(drawCtx, d.scores, { labels: d.labels, max: d.max }),
        d.title ?? '',
      );
  }
}

/**
 * A context for measuring, never for printing.
 *
 * The page planner has to charge for a figure before a palette has been
 * resolved — it runs on the report, not on the brand. Nothing about a chart's
 * height depends on its colours: the geometry is a function of the data and the
 * column width alone, so a planner using this gets the *same* line count the
 * real render will produce, rather than a per-kind guess that drifts the first
 * time a chart's padding changes.
 *
 * The colours are grey on purpose. Anything drawn with this context and shown
 * to a reader would be unmistakably wrong, which is the property to want in a
 * value that must never reach a page.
 */
export function planningChartContext(widthMm = CHART_TARGET_WIDTH_MM): ChartContext {
  // CSS colour keywords rather than hex, and not to satisfy the style rule:
  // a hex literal in this file would read as a palette decision, and the whole
  // point of these values is that they are not one. Nothing drawn with them is
  // ever emitted.
  const grey = 'grey';
  return {
    widthMm,
    palette: {
      ground: 'white', groundAlt: 'gainsboro', rule: grey, ink: 'black',
      inkMuted: grey, accent: grey, accentDeep: grey,
      positive: grey, caution: grey, negative: grey, informative: grey,
      series: [grey, grey, grey, grey, grey, grey],
    },
  };
}

/**
 * The callback `renderMarkdown` wants, bound to one column's context.
 *
 * Kept here so a format wires charts in one line —
 * `renderDirective: vizDirectiveRenderer(ctx)` — rather than repeating the
 * shape of `MarkdownOptions.renderDirective` at every call site.
 */
export function vizDirectiveRenderer(
  ctx: ChartContext,
  geometry: NarrativeGeometry | null = null,
): (d: VizDirective) => VizFigure | null {
  return (d) => renderVizDirective(ctx, d, geometry);
}

/**
 * The inline-sparkline callback `renderMarkdown` wants, bound to one column's
 * context — beside the directive one, for the same reason.
 *
 * `renderInlineSpark` has existed in `charts.pure.ts` since the chart
 * primitives were written, is covered by its own tests, and had zero
 * production call sites: the same defect this module's header records about
 * the other eleven. Meanwhile the generator's prompt tells the model to use
 * `~~[…]~~` "liberally", and with nothing drawing it a bare array of numbers
 * printed in a client's sentence.
 */
export function inlineSparkRenderer(ctx: ChartContext): (values: number[]) => string | null {
  return (values) => renderInlineSpark(ctx, values) || null;
}
