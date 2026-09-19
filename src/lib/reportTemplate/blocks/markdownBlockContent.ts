/**
 * What a `markdown-block` draws — resolved once, for both renderers.
 *
 * The HTML renderer and the browser PDF renderer must draw the SAME bucket of
 * the SAME parse for the same block: a master declares a fixed run of pages
 * each carrying one source at a different `pageIndex`, and each conditional on
 * that bucket existing. If the two sides resolved the profile, the charge
 * model or the directive context differently, one of them would lose the end
 * of a section while the other's page count said it was there — the exact
 * drift `markdownBlock.html.ts`'s header exists to prevent, now prevented by
 * there being one resolution rather than two agreeing ones.
 *
 * What each renderer still owns is how the result is PAINTED: HTML sets it as
 * flowing markup, jsPDF draws it as runs.
 */
import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor, type ResolveContext } from '../bindingResolver';
import {
  renderMarkdown, type MarkdownBlock,
} from '../../../../supabase/functions/_shared/reports/markdown.pure';
import {
  packMarkdownPages, packNarrativeGeometry, packNarrativePages, resolveNarrativeProfile, geometryAwareFormat,
  DEFAULT_LINES_PER_PAGE, type PageReserve,
} from '../../../../supabase/functions/_shared/reports/markdownPaging.pure';
import { calloutCharge, type NarrativeGeometry } from '../../../../supabase/functions/_shared/reports/narrativeGeometry.pure';
import { escapeHtml, renderCallout } from '../../../../supabase/functions/_shared/reportDesign/primitives.pure';
import { stripBakedCover } from '../../../../supabase/functions/_shared/reports/investment/narrativeClean.pure';
import { inlineSparkRenderer, vizDirectiveRenderer } from '../../../../supabase/functions/_shared/reports/vizFigures.pure';
import { CHART_TARGET_WIDTH_MM, type ChartContext } from '../../../../supabase/functions/_shared/reportDesign/charts.pure';

export { DEFAULT_LINES_PER_PAGE };

/**
 * The template's palette, as a chart context.
 *
 * CSS keywords as fallbacks, the `planningChartContext` convention: every
 * family master defines these tokens, so a keyword only paints where a
 * template is missing its palette — and a keyword is visibly not a palette
 * decision, which also keeps the hex-literal ratchet honest.
 *
 * `widthMm` defaults to the renderer's own width rather than the block's box
 * because the profile path charges the SAME directives the projection charges
 * through `planningChartContext()`, whose width is that default — so both
 * sides charge identical line counts whatever palette each draws with. The
 * geometry path passes the block's real measure instead (`narrativeChartContext`),
 * and its count is computed by the renderer's own pre-pass at that same
 * measure, so the two arithmetics never meet.
 */
export function templateChartContext(ctx: ResolveContext, widthMm: number = CHART_TARGET_WIDTH_MM): ChartContext {
  const tok = (name: string, fallback: string) => resolveBindableColor(`token:${name}`, ctx, fallback);
  const accent = tok('primary', 'darkgoldenrod');
  const ink = tok('ink', 'black');
  const muted = tok('muted', 'grey');
  const positive = tok('positive', 'seagreen');
  const caution = tok('caution', 'darkgoldenrod');
  const negative = tok('negative', 'firebrick');
  return {
    widthMm,
    palette: {
      ground: tok('surface', 'white'),
      groundAlt: tok('panel', 'gainsboro'),
      rule: tok('line', 'silver'),
      ink,
      inkMuted: muted,
      accent,
      accentDeep: tok('accentInk', accent),
      positive,
      caution,
      negative,
      informative: tok('info', accent),
      series: [accent, tok('accentInk', accent), muted, positive, caution, negative],
    },
  };
}

/**
 * ## Why a markdown block pages itself
 *
 * A family master declares every block's height when the template is built.
 * This content has no shape until it is read: across the 565 stored answers the
 * body runs 2,193 characters at the median and 33,377 at the longest, which is
 * about one page and about thirteen.
 *
 * The block therefore renders the whole source, packs the resulting blocks into
 * buckets of `linesPerPage`, and emits bucket `pageIndex`. A master declares a
 * fixed run of pages, each carrying the same source at a different `pageIndex`,
 * and each conditional on that bucket existing — and a conditional page that
 * does not render costs nothing, because `visiblePages` filters before layout.
 * A median answer therefore produces a short document and the longest produces
 * a long one, from one set of masters. This is the Client Details Form pattern.
 *
 * Packing never splits a Markdown block across pages. A table that is taller
 * than one page therefore overflows its bucket rather than being cut in half,
 * which is the lesser of the two wrongs: a split table loses its header and
 * reads as two different tables.
 */
export interface MarkdownBlockContent {
  /** The blocks belonging to this block's `pageIndex`; empty draws nothing. */
  page: readonly MarkdownBlock[];
  /** How many buckets the whole source produced. */
  pageCount: number;
  pageIndex: number;
  linesPerPage: number;
}

/**
 * ## Packing by the template's own geometry
 *
 * The profile's calibrated budgets are one family's arithmetic. When the
 * renderer has the template in hand it derives, once per narrative run, the
 * geometry every instance of that run must pack with — measure, body size,
 * leading, face, and the line capacity of the first and the continuation
 * boxes against the master's own content bottom (`narrativeGeometry.pure.ts`)
 * — and publishes it on the context under `NARRATIVE_GEOMETRY_KEY`, keyed by
 * the block's source binding. An instance that finds its geometry there packs
 * with it; one that does not (a block rendered on its own, a format whose
 * profile is not geometry-aware) packs exactly as before.
 *
 * The buckets are memoised on (source, geometry, palette): a master carries
 * forty instances of the same run and each used to render the whole source
 * again, and the renderer's own pre-pass needs the count before the first
 * page is drawn. One render serves them all.
 */
export const NARRATIVE_GEOMETRY_KEY = '_narrativeGeometry';

export type NarrativeGeometryByBinding = Readonly<Record<string, NarrativeGeometry>>;

/** The binding a markdown block draws, as written — the key its geometry is filed under. */
export function narrativeBindingKey(props: Record<string, unknown>): string {
  return String(props.source ?? props.body ?? '').trim();
}

export function geometryForBlock(block: Block, ctx: ResolveContext): NarrativeGeometry | null {
  const map = (ctx as unknown as Record<string, unknown>)[NARRATIVE_GEOMETRY_KEY] as NarrativeGeometryByBinding | undefined;
  const key = narrativeBindingKey(block.props as Record<string, unknown>);
  return (map && key && map[key]) || null;
}

/**
 * ## The note a master gave a page of its own
 *
 * Where a run exceeds the pages a master allows it, the Market Intelligence
 * and Report Q&A masters draw the omission on a page of its own — one
 * callout on an otherwise empty sheet ("This section continues for 9 further
 * pages…", "Not the whole answer"). Measured on the Chancery Market
 * Intelligence render (14 Sep 2026): 4 of 41 pages carried nothing else.
 *
 * The renderer's pre-pass (`narrativePlan.ts`) recognises that page, clears
 * its key from the data so it never draws, and files the note here by the
 * run's binding. The block drawing the LAST allowed page packs with that
 * much room held back (`PageReserve`) and sets the note as a callout at its
 * foot — the same words, on the page the reader is already looking at. The
 * count in the note is the renderer's true count, never the projection's
 * estimate.
 */
export const NARRATIVE_NOTES_KEY = '_narrativeNotes';

export interface ContinuationNote {
  /** Pages the master allows this run; the note sits on the last of them. */
  allowance: number;
  /** The callout's label, as the master's own page wrote it. */
  label: string;
  /** The sentence, with the renderer's true counts in it. */
  text: string;
}

export function notesForBlock(block: Block, ctx: ResolveContext): ContinuationNote | null {
  const map = (ctx as unknown as Record<string, unknown>)[NARRATIVE_NOTES_KEY] as Record<string, ContinuationNote> | undefined;
  const key = narrativeBindingKey(block.props as Record<string, unknown>);
  return (map && key && map[key]) || null;
}

/** The folded note as a markdown block: a neutral callout, charged as one. */
export function continuationNotice(geometry: NarrativeGeometry, label: string, text: string): MarkdownBlock {
  const html = renderCallout('neutral', label, `<p>${escapeHtml(text)}</p>`);
  return { kind: 'notice', html, lines: Math.ceil(calloutCharge(geometry, [text.length]) * 10) / 10 };
}

/**
 * The buckets a run draws, with the continuation note folded onto the last
 * allowed page where the run overruns it. `tail` is the note block, to be
 * drawn after that page's own blocks — only by the instance that holds it.
 */
export function foldedNarrativeBuckets(
  cleanSource: string,
  geometry: NarrativeGeometry,
  chart: ChartContext,
  note: ContinuationNote | null,
): { pages: MarkdownBlock[][]; tail: MarkdownBlock | null } {
  const pages = narrativeBuckets(cleanSource, geometry, chart);
  if (!note || pages.length <= note.allowance) return { pages, tail: null };
  const notice = continuationNotice(geometry, note.label, note.text);
  const reserved = narrativeBuckets(cleanSource, geometry, chart, { pageIndex: note.allowance - 1, lines: notice.lines });
  // Holding room back cannot shorten a document, so the overrun still stands
  // and the note is drawn where the room was held.
  return { pages: reserved, tail: reserved.length > note.allowance ? notice : null };
}

const MM_PER_PT = 25.4 / 72;
const BUCKET_MEMO = new Map<string, MarkdownBlock[][]>();
const BUCKET_MEMO_LIMIT = 8;

/** The buckets of one source at one geometry, drawn in one palette — memoised. */
export function narrativeBuckets(
  cleanSource: string,
  geometry: NarrativeGeometry,
  chart: ChartContext,
  reserve: PageReserve | null = null,
): MarkdownBlock[][] {
  const key = JSON.stringify([geometry, chart, reserve]) + '\u0000' + cleanSource;
  const hit = BUCKET_MEMO.get(key);
  if (hit) return hit;
  const blocks = renderMarkdown(cleanSource, {
    /**
     * A template page has no long edge to turn to.
     *
     * `renderMarkdown` sends a table wider than the portrait measure to
     * `renderPage('landscape-table', …)` and charges it `LANDSCAPE_BREAK_LINES`
     * — 38 lines — for the two page boundaries that page opens. That is right
     * in the FLOWING route, where the boundaries are real. Here a master page
     * is a fixed box, `page-landscape-table` has no rule in the template's
     * stylesheet, and the `<section>` is inert: the table draws portrait,
     * inline, in the space it always had.
     *
     * So the charge was paid for a page break that never happened, and the
     * flag's default — `landscapeWideTables !== false`, i.e. ON unless denied —
     * meant a path that had never named it got the wrong one. Measured on the
     * Executive Briefing's ten-year projection (7 columns, 6 rows): charged
     * 48.8 lines against a 41-line budget, so it fitted in NO bucket. It took a
     * page of its own at 23% full and stranded its own `## 10-Year Cashflow,
     * Equity & Growth Projection` heading and standfirst on the page before it
     * — a heading, the words "The recorded ten-year modelling, shown at years
     * 1, 3, 5, 7 and 10", and 93% white paper. A promise of a table, with the
     * table on the next sheet.
     */
    landscapeWideTables: false,
    geometry,
    renderDirective: vizDirectiveRenderer(chart, geometry),
    renderInlineSpark: inlineSparkRenderer(chart),
  }).blocks;
  const pages = packNarrativeGeometry(blocks, geometry, reserve);
  if (BUCKET_MEMO.size >= BUCKET_MEMO_LIMIT) {
    const oldest = BUCKET_MEMO.keys().next().value;
    if (oldest !== undefined) BUCKET_MEMO.delete(oldest);
  }
  BUCKET_MEMO.set(key, pages);
  return pages;
}

export function forgetNarrativeBuckets(): void {
  BUCKET_MEMO.clear();
}

/** The chart context a block draws its figures in: the template's palette at the block's own measure. */
export function narrativeChartContext(ctx: ResolveContext, geometry: NarrativeGeometry): ChartContext {
  return templateChartContext(ctx, geometry.widthPt * MM_PER_PT);
}

/** Resolve the packed bucket this block instance is responsible for. */
export function resolveMarkdownBlockContent(
  block: Block, ctx: ResolveContext,
): MarkdownBlockContent | null {
  const p = block.props as Record<string, unknown>;
  const source = resolveBindable(p.source ?? p.body, ctx);
  if (!source || !String(source).trim()) return null;

  const pageIndex = Math.max(0, Number(p.pageIndex ?? 0));
  const linesPerPage = Math.max(1, Number(p.linesPerPage ?? DEFAULT_LINES_PER_PAGE));

  // The calibrated narrative profile, resolved EXACTLY as the projection
  // resolves it (`resolveNarrativeProfile` is the single authority). The
  // profile also carries the baked-cover strip: the projection publishes the
  // stripped source, but a master bound straight at raw content must not
  // disagree with one bound at `narrative.source`.
  const reportType = String((ctx.data as Record<string, any> | undefined)?.report?.type ?? '');
  const profile = resolveNarrativeProfile(reportType);
  const cleanSource = profile ? stripBakedCover(String(source)).text : String(source);

  // The template's own geometry, when the renderer published one for this
  // run. It outranks a hand-tuned `linesPerPage`: that tuning existed to
  // correct a constant model, and the geometry is the page it was correcting
  // towards.
  const geometry = (profile?.geometryAware || geometryAwareFormat(reportType)) ? geometryForBlock(block, ctx) : null;
  if (geometry) {
    const note = notesForBlock(block, ctx);
    const { pages, tail } = foldedNarrativeBuckets(cleanSource, geometry, narrativeChartContext(ctx, geometry), note);
    const own = pages[pageIndex] ?? [];
    return {
      page: tail && note && pageIndex === note.allowance - 1 ? [...own, tail] : own,
      pageCount: pages.length,
      pageIndex,
      linesPerPage: geometry.contLines,
    };
  }

  const result = renderMarkdown(cleanSource, {
    // Same rule, the non-geometry path: see the note above.
    landscapeWideTables: false,
    charging: profile?.charging,
    renderDirective: vizDirectiveRenderer(templateChartContext(ctx)),
    renderInlineSpark: inlineSparkRenderer(templateChartContext(ctx)),
  });
  const pages = profile
    ? packNarrativePages(result.blocks, profile, linesPerPage)
    : packMarkdownPages(result.blocks, linesPerPage);

  return {
    page: pages[pageIndex] ?? [],
    pageCount: pages.length,
    pageIndex,
    linesPerPage,
  };
}
