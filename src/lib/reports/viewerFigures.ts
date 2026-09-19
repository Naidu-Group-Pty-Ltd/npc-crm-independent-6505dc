/**
 * The report page draws the chart directives the generator writes.
 *
 * ## The defect
 *
 * The generator's prompt asks the model for `{{glance: …}}`, `{{gauge: …}}`,
 * `{{bars: …}}` and nine more kinds, on their own lines; the print renderers
 * draw them (`vizFigures.pure.ts`) or tabulate them
 * (`vizDirectiveTables.pure.ts`) and never print the source. The on-screen
 * report page handed the same Markdown to `react-markdown`, which knows
 * nothing of them — so every directive was set as body copy, and a report
 * whose first line is its at-a-glance strip opened on
 * `{{glance: ✓ Strong yield | ▲ Growth …}}` (reported 15 Sep 2026 with a
 * screenshot).
 *
 * ## The rule, borrowed rather than restated
 *
 * One parser, one renderer, one fallback — the same three modules the PDF
 * routes use, so a figure the page draws is the figure the document prints.
 * A directive that cannot be drawn is tabulated; one that cannot be
 * tabulated is dropped; the source is never shown. A directive embedded
 * mid-sentence is left as prose, exactly as `directiveOnlyBlock` rules for
 * print — replacing it inline would leave a dangling clause.
 *
 * Pure over the Markdown string; the component maps the segments.
 */
import { directiveOnlyBlock, scanVizDirectives, type VizDirective } from '@/lib/reports/vizDirectives.pure';
import { renderVizDirective } from '@/lib/reports/vizFigures.pure';
import { directiveAsMarkdown } from '@/lib/reports/vizDirectiveTables.pure';
import { CHART_TARGET_WIDTH_MM, chartContext, type ChartContext } from '@/lib/reportDesign/charts.pure';
import { resolveReportPalette } from '@/lib/reportDesign/brandResolve.pure';

export type ViewerSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'figure'; html: string; directive: VizDirective['kind'] };

export interface ViewerSplit {
  segments: ViewerSegment[];
  /** Directives drawn as figures. */
  drawn: number;
  /** Directives the renderer refused and the fallback tabulated. */
  tabulated: number;
  /** Directives neither drawn nor tabulated, and unparseable ones — never shown. */
  dropped: number;
}

let screenContext: ChartContext | null = null;

/**
 * The chart context for the screen: the platform's own report palette at the
 * body measure. Resolved once per session — a palette is not per report.
 */
export function screenChartContext(): ChartContext {
  if (!screenContext) screenContext = chartContext(resolveReportPalette({}), CHART_TARGET_WIDTH_MM);
  return screenContext;
}

/**
 * Split a report's Markdown into prose runs and drawn figures.
 *
 * A line that is nothing but directives becomes one figure per directive; a
 * blank line is kept with the prose so paragraph breaks survive the split.
 */
export function splitMarkdownForViewer(content: string, ctx: ChartContext = screenChartContext()): ViewerSplit {
  const segments: ViewerSegment[] = [];
  let drawn = 0;
  let tabulated = 0;
  let dropped = 0;
  let buffer: string[] = [];

  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.join('\n');
    if (text.trim()) segments.push({ kind: 'markdown', text });
    buffer = [];
  };

  for (const line of (content ?? '').split('\n')) {
    if (!directiveOnlyBlock(line)) { buffer.push(line); continue; }
    const { directives, refused } = scanVizDirectives(line);
    dropped += refused;
    for (const d of directives) {
      const figure = renderVizDirective(ctx, d);
      if (figure) {
        flush();
        segments.push({ kind: 'figure', html: figure.html, directive: d.kind });
        drawn += 1;
        continue;
      }
      const table = directiveAsMarkdown(d);
      if (table) { buffer.push('', table, ''); tabulated += 1; continue; }
      dropped += 1;
    }
  }
  flush();
  return { segments, drawn, tabulated, dropped };
}
