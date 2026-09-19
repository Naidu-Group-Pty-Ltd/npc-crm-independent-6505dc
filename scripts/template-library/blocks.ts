/**
 * Composable page/block helpers for the seeded catalogue.
 *
 * Four rules hold everything together:
 *
 *  1. **Geometry is computed, never guessed.** `flow()` stacks blocks down a
 *     page from a single margin constant, so a template author changes content
 *     without recalculating a column of `y` values — and a block cannot
 *     silently overlap the one above it.
 *  2. **Percentages are supplied in percentage units.** The `percent` filter
 *     formats the number it is given (`3.84` → `"3.84%"`); it does not multiply
 *     by 100. A binding fed a fraction renders `0.04%` in a customer's report.
 *  3. **No literal colours.** Every colour is a `token:*` reference, so the
 *     white-label pipeline can re-skin a template completely and
 *     `isBrandSafe()` reports true. The block renderers already default to
 *     `token:primary` / `token:bg` / `token:muted`, so the safest thing an
 *     author can do is omit a colour entirely.
 *  4. **Type and rhythm come from the voice, not the call site.** A template
 *     declares its voice once via `beginTemplate()`; every helper below then
 *     sizes itself from `scripts/template-library/designSystem.ts`. This is
 *     what makes the catalogue's `style` axis mean something — see the module
 *     comment there for why it previously did not.
 */
import { randomUUID } from 'node:crypto';
import {
  runningHeadFor,
  VOICES,
  type AccentName,
  type Voice,
  type VoiceId,
} from './designSystem';

export const PAGE = { width: 595, height: 842 } as const;
export const MARGIN = 42;
export const CONTENT_WIDTH = PAGE.width - MARGIN * 2; // 511pt
/** Height of the standing footer, reserved at the foot of every content page. */
export const FOOTER_HEIGHT = 26;
/**
 * The lowest point a flowed block may reach before it collides with the
 * footer. Enforced by `flow()`; see `takeOverflows()`.
 */
export const CONTENT_BOTTOM = PAGE.height - MARGIN - FOOTER_HEIGHT; // 774pt

export interface BlockDef {
  id: string;
  type: string;
  props: Record<string, unknown>;
  overlays: never[];
  name?: string;
}

export interface PageDef {
  id: string;
  name: string;
  size: { width: number; height: number };
  background: { color: string };
  blocks: BlockDef[];
}

/** A block plus the vertical space it should occupy in a flow. */
export interface FlowItem {
  block: (y: number) => BlockDef;
  height: number;
  /** Extra space after this block. */
  gap?: number;
}

// ── Active voice ─────────────────────────────────────────────────────────────

/**
 * The voice the helpers below size themselves from.
 *
 * Module-level state rather than a parameter threaded through every helper:
 * a template is built by one `build*()` function from top to bottom, and the
 * alternative is adding a `voice` argument to some five hundred call sites for
 * no gain in expressiveness. `beginTemplate()` sets it, and every template
 * function must call that before building pages.
 */
let activeVoice: Voice = VOICES.corporate;
let activeAccent: AccentName = 'gold';
let activeRunningHead = '';

let counter = 0;
/** Deterministic ids: a seed migration re-run must produce identical SQL. */
function id(type: string): string {
  counter += 1;
  return `seed-${type}-${counter.toString(36)}`;
}

export function resetIds(): void {
  counter = 0;
}

/**
 * Open a template. Resets the id counter and selects the voice, accent and
 * running head that every helper below will use until the next call.
 *
 * `category` drives the running head — the eyebrow that names the *document*
 * above each section heading. See `RUNNING_HEAD` for why it is the document
 * rather than the section.
 */
export function beginTemplate(style: VoiceId, accent: AccentName, category: string): void {
  resetIds();
  activeVoice = VOICES[style];
  activeAccent = accent;
  activeRunningHead = runningHeadFor(category);
}

export function currentVoice(): Voice {
  return activeVoice;
}

export function currentAccent(): AccentName {
  return activeAccent;
}

// ── Layout overflow guard ────────────────────────────────────────────────────

export interface Overflow {
  page: string;
  bottom: number;
  overBy: number;
}

const overflows: Overflow[] = [];
/** Marker for an overflow whose page has not been named yet. */
const UNNAMED = '(unnamed)';

/**
 * Log a flow that ran into the footer.
 *
 * The page name is not known here: templates are written as
 * `page('Financials', flow([...]))`, and JavaScript evaluates the argument
 * before the call, so `flow()` always runs first. Entries are therefore
 * recorded unnamed and back-filled by `page()`.
 */
function recordOverflow(bottom: number): void {
  const limit = contentBottom();
  if (bottom > limit) {
    overflows.push({ page: UNNAMED, bottom, overBy: Math.round(bottom - limit) });
  }
}

/**
 * Drain the overflow log.
 *
 * `buildSeedCatalogue.ts` calls this and refuses to write a migration if
 * anything is in it. Without the check, a change to the shared type scale
 * pushes content under the footer on some subset of forty templates and the
 * only symptom is a customer's report with a truncated table.
 */
export function takeOverflows(): Overflow[] {
  return overflows.splice(0, overflows.length);
}

function block(type: string, props: Record<string, unknown>, name?: string): BlockDef {
  return { id: id(type), type, props, overlays: [], ...(name ? { name } : {}) };
}

/**
 * Stack items from `startY`, honouring each item's height, gap, and the active
 * voice's rhythm. Records an overflow if the stack runs into the footer.
 */
export function flow(items: FlowItem[], startY = MARGIN): BlockDef[] {
  let y = startY;
  const out: BlockDef[] = [];
  for (const item of items) {
    out.push(item.block(y));
    y += item.height + (item.gap ?? 16 + activeVoice.rhythm);
  }
  // The last gap is trailing whitespace, not occupied space.
  const last = items[items.length - 1];
  recordOverflow(last ? y - (last.gap ?? 16 + activeVoice.rhythm) : y);
  return out;
}

/**
 * Landscape A4.
 *
 * `deriveEntryFacts()` reads orientation straight off the page size
 * (`width > height`), so a template built with these dimensions files itself
 * under the library's Landscape filter with nothing further to declare.
 *
 * Set with `useLandscape()` before building pages, and clear it after. It
 * earns its place on one shape of document: a ten-year projection is twelve
 * columns wide, which is 42pt per column in portrait and 63pt in landscape —
 * the difference between a figure that fits and one that wraps.
 */
export const LANDSCAPE = { width: 842, height: 595 } as const;

let activePageSize: { width: number; height: number } = PAGE;

export function useLandscape(on: boolean): void {
  activePageSize = on ? LANDSCAPE : PAGE;
}

/** Content width for the active page size. */
export function contentWidth(): number {
  return activePageSize.width - MARGIN * 2;
}

/** Lowest usable point on the active page, before the footer. */
function contentBottom(): number {
  return activePageSize.height - MARGIN - FOOTER_HEIGHT;
}

export function page(name: string, blocks: BlockDef[], background = 'token:surface'): PageDef {
  // Back-fill the flow(s) whose blocks this page is being built from.
  for (let i = overflows.length - 1; i >= 0; i -= 1) {
    if (overflows[i].page !== UNNAMED) break;
    overflows[i].page = name;
  }
  return {
    id: id('page'),
    name,
    size: { ...activePageSize },
    background: { color: background },
    blocks,
  };
}

// ── Cover ────────────────────────────────────────────────────────────────────

export function cover(opts: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  footnote?: string;
  titleSize?: number;
}): PageDef {
  return page('Cover', [
    block('cover', {
      eyebrow: opts.eyebrow,
      title: opts.title,
      subtitle: opts.subtitle ?? '',
      footnote: opts.footnote ?? '',
      titleSize: opts.titleSize ?? activeVoice.coverSize,
      // One of the two surfaces `REPORT_RULES.md` §5 allows a mark on. The
      // voice cover is an obsidian ground, so it takes the mono lockup; the
      // mark is a gold gradient and is never auto-inverted. Drawn only when it
      // resolves, so a tenant with no mark gets none rather than ours.
      mark: '{{org.markMono}}',
      bg: 'token:bg',
      accent: 'token:primary',
      color: 'token:text',
    }),
  ], 'token:bg');
}

// ── Flow-item factories ──────────────────────────────────────────────────────

/**
 * Vertical space the eyebrow adds above a heading.
 *
 * The eyebrow is the design system's signature — the brand's wide uppercase
 * label, previously used on covers only. Carrying it onto section headings is
 * what tells a reader eleven pages into a dossier which section they are in.
 * It costs this much room, which `heading()` adds on the caller's behalf so no
 * template has to restate its heights.
 */
const EYEBROW_SPACE = 15;

/**
 * A section heading, under the running head.
 *
 * The eyebrow defaults to the template's running head — the document's name,
 * not the section's. Defaulting it to the heading text instead, which is the
 * obvious thing to do, produces "EXECUTIVE SUMMARY / Executive summary": the
 * same words twice, which reads as a mistake rather than a signature.
 *
 * `height` describes the heading and its body copy, as it always has; the
 * eyebrow's space is added on top. Pass `null` to suppress it on a page where
 * a label would be noise.
 */
export function heading(
  text: string,
  body?: string,
  height = 58,
  eyebrow?: string | null,
): FlowItem {
  const label = eyebrow === undefined ? activeRunningHead : eyebrow;
  // Never repeat the heading back at the reader.
  const showEyebrow = typeof label === 'string'
    && label.length > 0
    && label.trim().toLowerCase() !== text.trim().toLowerCase();
  return {
    height: height + (showEyebrow ? EYEBROW_SPACE : 0),
    block: (y) => block('text-block', {
      ...(showEyebrow
        ? {
          eyebrow: label,
          eyebrowSize: activeVoice.eyebrowSize,
          eyebrowColor: 'token:accentInk',
        }
        : {}),
      heading: text,
      body: body ?? '',
      headingSize: activeVoice.headingSize,
      headingColor: 'token:ink',
      bodySize: activeVoice.bodySize,
      color: 'token:ink',
      x: MARGIN, y, width: contentWidth(),
    }),
  };
}

export function prose(body: string, height = 52): FlowItem {
  return {
    height,
    block: (y) => block('text-block', {
      body,
      bodySize: activeVoice.bodySize,
      color: 'token:ink',
      x: MARGIN, y, width: contentWidth(),
    }),
  };
}

/**
 * The section rule.
 *
 * Every voice draws this differently, and that difference is most of what makes
 * the five look like five: Chancery divides with a full accent rule, Broadsheet
 * whispers with a beige hairline, Slip states its case with a short bold stub.
 */
/**
 * The brand mark, at the head of a document that has no cover page.
 *
 * Fifteen of the voice templates are deliberately cover-less — "One page, no
 * cover", as the Property Snapshot's own description puts it — so their first
 * page is the face of the document and the only place a mark belongs. The rest
 * carry it on the `cover` block instead.
 *
 * `REPORT_RULES.md` §5 sizes it at ~14mm; 40pt is 14.1mm. These pages are
 * `token:surface`, which is the ivory of the two grounds §5 permits, so this
 * takes the paper lockup rather than the mono one — the mark is a gold gradient
 * and is never auto-inverted.
 *
 * A flow item rather than an absolute block, so the heading beneath it moves
 * down instead of being printed over. It costs its height whether or not the
 * mark resolves, which is a slightly deeper top margin on a document whose
 * tenant has uploaded none — the safe direction.
 */
export function brandMark(): FlowItem {
  return {
    height: 40,
    gap: 16,
    block: (y) => block('image', {
      src: '{{org.mark}}',
      fit: 'contain',
      // Never a grey "No image" rectangle on a client's report.
      placeholder: false,
      x: MARGIN, y, width: 50, height: 40,
    }, 'Brand mark'),
  };
}

export function rule(height = 2): FlowItem {
  const v = activeVoice;
  return {
    height,
    gap: 14,
    block: (y) => block('divider', {
      color: v.ruleColor === 'accent' ? 'token:primary' : 'token:line',
      style: v.ruleStyle,
      thickness: v.ruleWeight,
      x: MARGIN, y, width: Math.round(contentWidth() * v.ruleSpan),
    }),
  };
}

export function kpis(items: Array<{ label: string; value: string }>, height = 92): FlowItem {
  return {
    height,
    block: (y) => block('kpi-grid', {
      items,
      columns: Math.min(items.length, 4),
      gap: 12,
      tileBg: 'token:panel',
      accent: 'token:primary',
      labelColor: 'token:mutedInk',
      radius: activeVoice.radii.md,
      // A four-up tile is ~87pt wide; a formatted currency value overruns the
      // renderer's 20pt default and gets clipped mid-figure.
      valueSize: items.length >= 4 ? 15 : items.length === 3 ? 17 : 19,
      x: MARGIN, y, width: contentWidth(), height,
    }),
  };
}

/**
 * A data table.
 *
 * `numeric` marks the columns that hold figures. Under the technical voice they
 * are set in IBM Plex Mono and right-aligned, which is the only reason a
 * ten-year projection is readable down the column; under the other voices they
 * still get tabular figures so the digits align.
 */
export function table(
  headers: string[],
  rows: string[][],
  columnWidths?: number[],
  rowHeight = 22,
  numeric?: number[],
): FlowItem {
  // Convention across this catalogue: column 0 labels the row, the rest carry
  // figures. Templates that differ pass `numeric` explicitly.
  const numericColumns = numeric ?? headers.map((_, i) => i).slice(1);
  return {
    height: 30 + rows.length * rowHeight,
    block: (y) => block('data-table', {
      headers,
      rows: rows.map((cells) => ({ cells })),
      ...(columnWidths ? { columnWidths } : {}),
      headerBg: 'token:primary',
      headerFg: 'token:onPrimary',
      stripeBg: 'token:panel',
      cellFg: 'token:ink',
      borderColor: 'token:line',
      numericColumns,
      ...(activeVoice.mono ? { numericFont: 'token:mono' } : {}),
      x: MARGIN, y, width: contentWidth(),
    }),
  };
}

/**
 * The projection matrix — the centre of a cash-flow report.
 *
 * Rows are grouped into named bands (STATISTICS, CASH DEDUCTIONS, …), which is
 * how the legacy renderer organised twenty-three rows of figures and the only
 * reason the block is readable at all. The band rows are emitted as ordinary
 * rows and their indices handed to the renderer as `sectionRows`, so the table
 * stays a single `data-table` rather than a stack of separate ones that would
 * drift out of column alignment.
 *
 * `fontSize` is deliberately exposed: twelve columns on a portrait page do not
 * fit at 9pt, and silently letting them wrap is worse than setting 7pt.
 */
export function matrixTable(opts: {
  headers: string[];
  groups: Array<{ band?: string; rows: string[][] }>;
  columnWidths?: number[];
  rowHeight?: number;
  fontSize?: number;
}): FlowItem {
  const rows: string[][] = [];
  const sectionRows: number[] = [];
  for (const group of opts.groups) {
    if (group.band) {
      sectionRows.push(rows.length);
      rows.push([group.band, ...opts.headers.slice(1).map(() => '')]);
    }
    rows.push(...group.rows);
  }
  const rowHeight = opts.rowHeight ?? 16;
  const fontSize = opts.fontSize ?? 7;
  return {
    height: 26 + rows.length * rowHeight,
    block: (y) => block('data-table', {
      headers: opts.headers,
      rows: rows.map((cells) => ({ cells })),
      ...(opts.columnWidths ? { columnWidths: opts.columnWidths } : {}),
      headerBg: 'token:bg',
      headerFg: 'token:text',
      stripeBg: 'token:panel',
      cellFg: 'token:ink',
      borderColor: 'token:line',
      sectionBg: 'token:panel',
      sectionFg: 'token:accentInk',
      negativeColor: 'token:negative',
      numericColumns: opts.headers.map((_, i) => i).slice(1),
      ...(activeVoice.mono ? { numericFont: 'token:mono' } : {}),
      sectionRows,
      fontSize,
      cellPadding: 3,
      x: MARGIN, y, width: contentWidth(),
    }),
  };
}

/**
 * A two-up grid of input parameters.
 *
 * The legacy report set its twenty-odd inputs in two columns to keep them on
 * one page; a single-column definition list of the same content runs to two.
 * Emitted as a four-column table so the values stay aligned down the page.
 */
export function inputGrid(pairs: Array<[string, string]>): FlowItem {
  const rows: string[][] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const [lt, lv] = pairs[i];
    const right = pairs[i + 1];
    rows.push([lt, lv, right?.[0] ?? '', right?.[1] ?? '']);
  }
  return {
    height: 26 + rows.length * 17,
    block: (y) => block('data-table', {
      headers: ['Input', 'Value', 'Input', 'Value'],
      rows: rows.map((cells) => ({ cells })),
      columnWidths: [0.3, 0.2, 0.3, 0.2],
      headerBg: 'token:primary',
      headerFg: 'token:onPrimary',
      stripeBg: 'token:panel',
      cellFg: 'token:ink',
      borderColor: 'token:line',
      numericColumns: [1, 3],
      fontSize: 8,
      cellPadding: 4,
      x: MARGIN, y, width: contentWidth(),
    }),
  };
}

/**
 * The dark summary cards that close the legacy report.
 *
 * Same block as `kpis()`, inverted: the field colour becomes the tile and the
 * figures print on it. Used once per report, at the point the reader has been
 * through the detail and wants the four numbers that matter.
 */
export function summaryCards(
  items: Array<{ label: string; value: string }>,
  height = 92,
): FlowItem {
  return {
    height,
    block: (y) => block('kpi-grid', {
      items,
      columns: Math.min(items.length, 4),
      gap: 12,
      tileBg: 'token:bg',
      accent: 'token:text',
      labelColor: 'token:mutedOnField',
      radius: activeVoice.radii.md,
      valueSize: items.length >= 4 ? 15 : 18,
      x: MARGIN, y, width: contentWidth(), height,
    }),
  };
}

export function callout(title: string, body: string, variant = 'info', height = 66): FlowItem {
  return {
    height,
    block: (y) => block('callout', {
      title, body, variant,
      accent: 'token:primary',
      bg: 'token:panel',
      color: 'token:ink',
      radius: activeVoice.radii.md,
      x: MARGIN, y, width: contentWidth(),
    }),
  };
}

export function twoColumn(
  left: { heading: string; body: string },
  right: { heading: string; body: string },
  height = 130,
): FlowItem {
  return {
    height,
    block: (y) => block('two-column', {
      leftHeading: left.heading, leftBody: left.body,
      rightHeading: right.heading, rightBody: right.body,
      ratio: 0.5, gap: 22,
      headingSize: 12, headingColor: 'token:accentInk',
      bodySize: activeVoice.bodySize, bodyColor: 'token:ink',
      x: MARGIN, y, width: contentWidth(),
    }),
  };
}

export function barChart(opts: {
  title: string;
  caption?: string;
  /** Binding path to the live series, e.g. `market.priceSeries`. */
  dataPath?: string;
  /** Placeholder series drawn when no data is bound (editor + preview). */
  data: Array<{ label: string; value: number }>;
  height?: number;
}): FlowItem {
  const height = opts.height ?? 190;
  return {
    height,
    block: (y) => block('chart-bar', {
      title: opts.title,
      caption: opts.caption ?? '',
      ...(opts.dataPath ? { dataPath: opts.dataPath } : {}),
      data: opts.data,
      labelKey: 'label',
      valueKey: 'value',
      accent: 'token:primary',
      x: MARGIN, y, width: contentWidth(), height,
    }),
  };
}

export function lineChart(opts: {
  title: string;
  caption?: string;
  /** Binding path to the live series, e.g. `market.priceSeries`. */
  dataPath?: string;
  /** Placeholder series drawn when no data is bound (editor + preview). */
  data: Array<{ label: string; value: number }>;
  height?: number;
}): FlowItem {
  const height = opts.height ?? 190;
  return {
    height,
    block: (y) => block('chart-line', {
      title: opts.title,
      caption: opts.caption ?? '',
      ...(opts.dataPath ? { dataPath: opts.dataPath } : {}),
      data: opts.data,
      labelKey: 'label',
      valueKey: 'value',
      accent: 'token:primary',
      x: MARGIN, y, width: contentWidth(), height,
    }),
  };
}

export function donutChart(opts: {
  title: string;
  caption?: string;
  /** Binding path to the live series, e.g. `market.priceSeries`. */
  dataPath?: string;
  /** Placeholder series drawn when no data is bound (editor + preview). */
  data: Array<{ label: string; value: number }>;
  height?: number;
}): FlowItem {
  const height = opts.height ?? 200;
  return {
    height,
    block: (y) => block('chart-donut', {
      title: opts.title,
      caption: opts.caption ?? '',
      ...(opts.dataPath ? { dataPath: opts.dataPath } : {}),
      data: opts.data,
      labelKey: 'label',
      valueKey: 'value',
      accent: 'token:primary',
      x: MARGIN, y, width: contentWidth(), height,
    }),
  };
}

export function scorecard(
  title: string,
  items: Array<{ category: string; rating: string; note?: string }>,
): FlowItem {
  return {
    height: 34 + items.length * 26,
    block: (y) => block('scorecard', {
      title, items, x: MARGIN, y, width: contentWidth(),
    }),
  };
}

export function riskRegister(
  title: string,
  items: Array<{ risk: string; rating: string; confidence: string; why: string; ddAction: string }>,
): FlowItem {
  return {
    height: 40 + items.length * 46,
    block: (y) => block('risk-register', {
      title, items, x: MARGIN, y, width: contentWidth(),
    }),
  };
}

export function checklist(
  title: string,
  items: Array<{ action: string; owner?: string; timing?: string }>,
): FlowItem {
  return {
    height: 34 + items.length * 24,
    block: (y) => block('dd-checklist', {
      title, items, x: MARGIN, y, width: contentWidth(),
    }),
  };
}

/**
 * Two columns of bullets — strengths on the left, watch points on the right.
 *
 * The per-item allowance assumes **two lines**, not one. Every item is a
 * `{{binding}}`, so the real length is unknowable at build time; but each
 * column is only ~227pt wide, and a written strength ("412m² of R2 land, 18%
 * above the suburb average lot size") wraps at that measure almost every time.
 * The previous one-line allowance let the block run into whatever followed it.
 */
export function strengthsWatch(strengths: string[], watch: string[]): FlowItem {
  return {
    height: 40 + Math.max(strengths.length, watch.length) * 34,
    block: (y) => block('strengths-watch', {
      strengthsTitle: 'Strengths',
      strengths,
      watchTitle: 'Watch points',
      watch,
      positiveColor: 'token:positive',
      cautionColor: 'token:caution',
      onFillColor: 'token:surface',
      color: 'token:ink',
      radius: activeVoice.radii.sm,
      x: MARGIN, y, width: contentWidth(),
    }),
  };
}

export function decision(heading: string, body: string, height = 88): FlowItem {
  return {
    height,
    block: (y) => block('decision-box', {
      heading, body, accent: 'token:primary',
      x: MARGIN, y, width: contentWidth(),
    }),
  };
}

export function processSteps(
  title: string,
  items: Array<{ title: string; body: string }>,
): FlowItem {
  return {
    height: 34 + items.length * 52,
    block: (y) => block('process-steps', {
      title, items, accent: 'token:primary',
      x: MARGIN, y, width: contentWidth(),
    }),
  };
}

export function definitions(
  title: string,
  items: Array<{ term: string; definition: string }>,
): FlowItem {
  return {
    height: 34 + items.length * 30,
    block: (y) => block('definition-list', {
      title, items, x: MARGIN, y, width: contentWidth(),
    }),
  };
}

export function featureList(
  title: string,
  items: Array<{ icon?: string; title: string; body: string }>,
  columns = 2,
): FlowItem {
  return {
    height: 34 + Math.ceil(items.length / columns) * 54,
    block: (y) => block('feature-list', {
      title, items, columns, accent: 'token:primary',
      x: MARGIN, y, width: contentWidth(),
    }),
  };
}

export function timeline(
  title: string,
  items: Array<{ label: string; date: string; note?: string }>,
): FlowItem {
  return {
    height: 110,
    block: (y) => block('timeline', {
      title, items, accent: 'token:primary',
      x: MARGIN, y, width: contentWidth(),
    }),
  };
}

export function signature(signerName: string, signerRole: string): FlowItem {
  return {
    height: 90,
    block: (y) => block('signature', {
      signerName, signerRole, dateLabel: 'Date',
      color: 'token:ink', lineColor: 'token:line', mutedColor: 'token:mutedInk',
      x: MARGIN, y, width: contentWidth(),
    }),
  };
}

export function contents(entries: string): FlowItem {
  return {
    height: 400,
    block: (y) => block('toc', {
      title: entries,
      titleSize: activeVoice.headingSize + 4,
      titleColor: 'token:ink',
      color: 'token:ink',
      indexColor: 'token:primary',
      size: 10.5,
      lineHeight: 20,
      x: MARGIN, y, width: contentWidth(),
    }),
  };
}

// ── Page furniture ───────────────────────────────────────────────────────────

/**
 * The standing footer.
 *
 * It used to be a full-bleed band in `token:bg` — a 26pt slab of obsidian
 * across the foot of every page of every template, which is a large part of
 * why the catalogue read as heavy and dated. It now sits on the paper under a
 * hairline, which is both quieter and cheaper to print.
 */
export function footer(text: string): BlockDef {
  return block('footer', {
    text,
    align: 'center',
    bg: 'token:surface',
    color: 'token:mutedInk',
    ruleColor: 'token:line',
    height: FOOTER_HEIGHT,
  });
}

export function pageNumber(): BlockDef {
  return block('page-number', {
    color: 'token:mutedInk',
    x: activePageSize.width - MARGIN - 60,
    y: activePageSize.height - 46,
    width: 60,
  });
}

export function disclaimerPage(text: string): PageDef {
  return page('Important information', [
    block('disclaimer', {
      companyName: '{{org.name}}',
      abn: '{{org.abn}}',
      address: '{{org.address}}',
      phone: '{{org.phone}}',
      email: '{{org.email}}',
      website: '{{org.website}}',
      // The other allowed surface: this block paints a full-page obsidian
      // ground, which is the one §5 names for the contact page.
      mark: '{{org.markMono}}',
      markHeight: 37,
      // The deployment's own disclaimer, exactly as the Investment Compass
      // families bind it — see the note in
      // `investmentCompass/blocks.ts:disclaimerPage`. These 43 voice templates
      // were missed by the first pass and kept printing the baked boilerplate
      // while the other 500 had moved to the configured text, which is a worse
      // state than either: two documents from one product, disagreeing about
      // what the firm's disclaimer says.
      disclaimerText: `{{org.disclaimer}}`,
      disclaimerFallback: text,
      fontSize: '{{org.disclaimerFontSize}}',
      fontSizeFallback: 'small',
    }),
  ]);
}

/** Attach standard furniture to a content page. */
export function withFurniture(p: PageDef, footerText: string): PageDef {
  return { ...p, blocks: [...p.blocks, footer(footerText), pageNumber()] };
}

export { randomUUID };
