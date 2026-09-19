/**
 * The HTML a report is built from.
 *
 * Ported from `render-investment-report-pdf/report.html.ts`. Every primitive
 * that existed there survives with the same job; what changed:
 *
 *  - **Nothing is hardcoded to us.** `report.html.ts:47` printed
 *    `"NPC · Investment Intelligence"` on the cover of every white-label
 *    tenant's report, and `:74` printed **"Rendered via WeasyPrint"** on a
 *    client-facing premium cover — the renderer's name, on the artefact the
 *    client pays for. Both now come from the caller.
 *  - **No `new Date()`.** The cover's volume line was computed at render time,
 *    which made the output non-reproducible and un-snapshottable. It is an
 *    input.
 *  - **Added**: the brand lockup (the first time a logo appears in a generated
 *    report at all), the contents page, the callout and decision box, the wide
 *    matrix, and the closing company page that replaces both halves of
 *    `src/utils/pdfDisclaimerPage.ts`.
 *
 * No styling lives here — every visual decision is a class the stylesheet in
 * `css.pure.ts` knows. That separation is what lets the same markup print in
 * four presets.
 */
import type { CompanyBlock } from './companyBlock.pure.ts';
import type { NamedPage } from './page.pure.ts';
import { coverTitleFit } from './typography.pure.ts';

/**
 * Escape for HTML text and double-quoted attributes.
 *
 * Everything below routes user- and AI-supplied strings through this. The one
 * exception is a parameter explicitly named `…Html`, which the caller is
 * declaring it has already sanitised.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape for a `url(...)` inside a `style` attribute.
 *
 * Cover art is a `data:` URI, which contains `+` and `/` freely and may contain
 * a quote after base64 padding in a malformed input. Left unescaped it closes
 * the attribute and the remainder becomes markup.
 */
function cssUrl(value: string): string {
  return escapeHtml(String(value ?? '').replace(/[()'"\\]/g, ''));
}

const attr = (name: string, value: string | undefined | null): string =>
  value ? ` ${name}="${escapeHtml(value)}"` : '';

// ── Document shell ──────────────────────────────────────────────────────────

export interface ReportDocumentProps {
  /** `<title>`; WeasyPrint writes it into the PDF's Title metadata. */
  title: string;
  /** PDF Author metadata — the issuing company, not the renderer. */
  author: string;
  /** PDF Subject metadata. */
  subject?: string;
  /** BCP-47. Tagged PDF needs a language or the structure tree is untagged. */
  lang?: string;
  /** From `buildReportCss()`. */
  css: string;
  /** The page contents, already assembled. */
  bodyHtml: string;
}

export function renderDocument(p: ReportDocumentProps): string {
  return `<!DOCTYPE html>
<html lang="${escapeHtml(p.lang ?? 'en-AU')}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(p.title)}</title>
<meta name="author" content="${escapeHtml(p.author)}">
${p.subject ? `<meta name="description" content="${escapeHtml(p.subject)}">\n` : ''}<style>
${p.css}
</style>
</head>
<body>
${p.bodyHtml}
</body>
</html>`;
}

/** Wrap content so it prints on a named page. */
export function renderPage(page: NamedPage, contentHtml: string): string {
  return `<section class="page-${page}">${contentHtml}</section>`;
}

/**
 * One composed sheet — a page somebody decided the contents of.
 *
 * The rest of this system *flows*: content goes into one column and the engine
 * breaks it wherever it lands, which is why a chapter with two bullets in it
 * prints as a page with two bullets on it. A sheet is the other model. Its
 * contents were chosen, by the thing that wrote them, to fill a page.
 *
 * ## It is a page because it ends, not because it is tall
 *
 * The obvious implementation gives the sheet a `min-height` of the content box
 * so it *occupies* a page. Rendered, that is wrong twice over. A chapter header
 * sits above the first sheet, so a full-height box no longer fits beside it and
 * the engine pushes the contents to the next page — leaving a sheet's worth of
 * blank paper under the header. And a run of sheets each forcing its own height
 * turned a two-chapter document into ten pages, six of them empty.
 *
 * So a sheet is `break-after: page` and nothing else. Whether it *fills* the
 * page is a question about the composition, not about the box, and it is
 * answered where it can actually be answered — `judgeDocument` measures the ink
 * on the rendered page and reports a sparse one. A CSS rule cannot know whether
 * a page looks finished; a measurement of the render can.
 *
 * No named page either. A sheet lives inside a chapter that has already claimed
 * one, and nesting a second `page-body` inside it triggers the adjacency rule
 * that exists to separate *sibling* named pages — a page break before every
 * sheet, on top of the one after it.
 */
export function renderSheet(contentHtml: string): string {
  return `<section class="sheet">${contentHtml}</section>`;
}

// ── Brand lockup ────────────────────────────────────────────────────────────

export interface BrandLockupProps {
  /**
   * The mark, as a `data:` URI. A URL would make the render depend on the
   * network and on a bucket's ACL at render time; `weasyprint-service/app.py`
   * exempts `data:` from its SSRF guard precisely so this can be inlined.
   *
   * Omit for a wordmark-only lockup.
   */
  markDataUri?: string | null;
  /** Alternative text. Required when a mark is present — tagged PDF needs it. */
  markAlt?: string;
  /** Wordmark beside the mark. Omit for the mark alone. */
  wordmark?: string | null;
  /** On the dark field, the lockup switches to its on-field accent. */
  onField?: boolean;
  /** Cover-sized mark. */
  large?: boolean;
}

export function renderBrandLockup(p: BrandLockupProps): string {
  if (!p.markDataUri && !p.wordmark) return '';
  const classes = ['brand-lockup'];
  if (p.onField) classes.push('on-field');
  if (p.large) classes.push('mark-lg');
  const mark = p.markDataUri
    ? `<span class="lockup-mark"><img src="${escapeHtml(p.markDataUri)}" alt="${escapeHtml(p.markAlt ?? p.wordmark ?? '')}"></span>`
    : '';
  const text = p.wordmark ? `<span class="lockup-text">${escapeHtml(p.wordmark)}</span>` : '';
  return `<div class="${classes.join(' ')}">${mark}${text}</div>`;
}

// ── Cover ───────────────────────────────────────────────────────────────────

export interface CoverMetaItem {
  label: string;
  value: string;
}

export interface CoverProps {
  /** Street address or document subject; set as the cover title. */
  title: string;
  /**
   * Second line of the title, set in the accent italic. For a property report
   * this is the locality; pass `null` to set the title as one block.
   */
  subtitle?: string | null;
  /** The eyebrow above the title — the document's type. */
  eyebrow: string;
  /** Top-left mark line. The issuing company, from the brand snapshot. */
  masthead: string;
  /** Top-right volume line, e.g. `VOL. 2026 · ED. 08`. Supplied, never computed. */
  edition?: string | null;
  /** Prepared for / prepared by / issued. */
  meta?: CoverMetaItem[];
  /** Optional logo lockup above the eyebrow. */
  lockup?: BrandLockupProps | null;
  /** Full-bleed cover art as a `data:` URI. */
  heroDataUri?: string | null;
  /** Foot of the cover — classification on the left, reference on the right. */
  footerLeft?: string;
  footerRight?: string;
}

/**
 * The most meta entries that fit across the cover on one row.
 *
 * Four broke three of the four values, including `04 August 2026` set as
 * `04 August` over `2026`. Three is what the measure holds at this size.
 */
export const COVER_META_PER_ROW = 3;

/**
 * The cover's meta block, in balanced rows.
 *
 * Balanced rather than filled: four entries set 2 + 2 rather than 3 + 1,
 * because a table row with one cell in a three-column table occupies one
 * column and reads as a stray. Nothing is dropped — a cover that silently
 * loses its fourth fact is a worse answer than one that runs to a second row.
 */
export function renderCoverMeta(meta: readonly CoverMetaItem[]): string {
  if (!meta.length) return '';
  const rows = Math.ceil(meta.length / COVER_META_PER_ROW);
  const perRow = Math.ceil(meta.length / rows);
  const chunks = Array.from({ length: rows }, (_, i) => meta.slice(i * perRow, (i + 1) * perRow));
  return `<div class="cover-meta">${chunks.map((chunk) => `
        <div class="meta-row">${chunk.map((m) => `
          <div class="meta-item">
            <span class="lbl">${escapeHtml(m.label)}</span>
            <span class="val">${escapeHtml(m.value)}</span>
          </div>`).join('')}
        </div>`).join('')}
      </div>`;
}

export function renderCover(p: CoverProps): string {
  const hero = p.heroDataUri
    ? `<div class="cover-hero" style="background-image:url('${cssUrl(p.heroDataUri)}')"></div>`
      + '<div class="cover-scrim"></div>'
    : '';

  const title = p.subtitle
    ? `${escapeHtml(p.title)}<br><em>${escapeHtml(p.subtitle)}</em>`
    : escapeHtml(p.title);

  const meta = renderCoverMeta(p.meta ?? []);

  const lockup = p.lockup
    ? `<div class="cover-lockup">${renderBrandLockup({ ...p.lockup, onField: true, large: true })}</div>`
    : '';

  const footer = (p.footerLeft || p.footerRight)
    ? `
      <div class="cover-footer">
        <span class="left">${escapeHtml(p.footerLeft ?? '')}</span>
        <span class="right">${escapeHtml(p.footerRight ?? '')}</span>
      </div>`
    : '';

  return `
    <section class="report-cover page-cover">
      ${hero}
      <div class="cover-masthead">
        <span class="mark">${escapeHtml(p.masthead)}</span>
        <span class="vol">${escapeHtml(p.edition ?? '')}</span>
      </div>
      <div class="cover-rule"></div>

      <div class="cover-body">
        ${lockup}
        <div class="cover-eyebrow">— ${escapeHtml(p.eyebrow)}</div>
        <h1 class="cover-title fit-${coverTitleFit(p.title, p.subtitle)}">${title}</h1>
        ${meta}
      </div>
      ${footer}
    </section>`;
}

// ── Contents ────────────────────────────────────────────────────────────────

export interface ContentsEntry {
  /** Ordinal as printed, e.g. `01`. Omit to leave the column blank. */
  number?: string;
  title: string;
  /** One line on what the section covers. */
  note?: string;
  /** Printed page number. Omit when the page is not yet known. */
  page?: string | number;
}

export function renderContentsPage(
  title: string,
  entries: ContentsEntry[],
  /**
   * Entries per sheet, when the list is long enough to need more than one.
   *
   * Split here rather than left to the page breaker, because the breaker fills
   * the first sheet and gives the remainder whatever is left: a fourteen-entry
   * Market Intelligence contents put thirteen rows on one page and the
   * fourteenth alone on the next, at 0.2% ink, on a named page that carries no
   * running head — so page three of a twenty-two page report was one line
   * floating under nothing. CSS cannot fix it: `break-after: avoid` is not
   * honoured on table rows, which is where the first attempt went.
   *
   * Splitting evenly is also the only way the page count is *decided* rather
   * than discovered, which is what lets a spine claim it.
   */
  perPage?: number,
): string {
  const cap = Math.max(1, Math.trunc(perPage ?? entries.length) || entries.length);
  const sheets = Math.max(1, Math.ceil(entries.length / cap));
  // Evenly, so two sheets are 7 and 7 rather than 13 and 1.
  const size = Math.ceil(entries.length / sheets);

  const sheet = (slice: ContentsEntry[]): string => {
    const rows = slice.map((e) => `
      <div class="toc-row">
        <span class="toc-no">${escapeHtml(e.number ?? '')}</span>
        <span class="toc-title">${escapeHtml(e.title)}</span>
        <span class="toc-note">${escapeHtml(e.note ?? '')}</span>
        <span class="toc-page">${escapeHtml(e.page ?? '')}</span>
      </div>`).join('');
    return `
    <section class="page-contents">
      <div class="eyebrow">Contents</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="contents">${rows}
      </div>
    </section>`;
  };

  const out: string[] = [];
  for (let i = 0; i < entries.length; i += size) out.push(sheet(entries.slice(i, i + size)));
  return out.join('') || sheet([]);
}

// ── Chapters ────────────────────────────────────────────────────────────────

/**
 * Open a chapter.
 *
 * The `data-*` attributes are read by `string-set` in the stylesheet and become
 * the running head, so a chapter physically cannot be opened without naming
 * itself in the header — which is how a 40-page document stays navigable.
 *
 * The page defaults to `body`, not `chapter-opener`. `page: <name>` applies to
 * every page an element spans, so opening a nine-page chapter on the
 * `chapter-opener` page would suppress the running head and hold the deep top
 * margin for all nine. The magazine-style low title comes from padding on
 * `.chapter` instead; pass `chapter-opener` explicitly only for a standalone
 * opener that is its own page.
 */
export function openChapter(
  eyebrow: string,
  chapterNo: string,
  chapterTitle: string,
  page: NamedPage = 'body',
): string {
  return `<section class="chapter page-${page}"`
    + ` data-eyebrow="${escapeHtml(eyebrow)}"`
    + ` data-chapter-no="${escapeHtml(chapterNo)}"`
    + ` data-chapter-title="${escapeHtml(chapterTitle)}">`;
}

export function closeChapter(): string {
  return '</section>';
}

export interface ChapterHeaderProps {
  /** `01`. Hidden when `showSectionNumbers` is off — the CSS decides. */
  number: string;
  title: string;
  /** Standfirst. */
  dek?: string;
  /** Word printed before the number. Defaults to `Chapter`. */
  label?: string;
}

export function renderChapterHeader(p: ChapterHeaderProps): string {
  return `
      <header class="chapter-header">
        <div class="chapter-no">${escapeHtml((p.label ?? 'Chapter').toUpperCase())} ${escapeHtml(p.number)}</div>
        <h1>${escapeHtml(p.title)}</h1>
        ${p.dek ? `<div class="chapter-dek">${escapeHtml(p.dek)}</div>` : ''}
      </header>`;
}

export function renderEyebrow(label: string, onField = false): string {
  return `<div class="eyebrow${onField ? ' on-field' : ''}">${escapeHtml(label)}</div>`;
}

export function renderLede(text: string): string {
  return `<p class="lede">${escapeHtml(text)}</p>`;
}

// ── KPI strip ───────────────────────────────────────────────────────────────

export type ValueTone = 'neutral' | 'positive' | 'negative';

export interface KpiCell {
  label: string;
  /** Pre-formatted. Formatting is the caller's locale decision, not the kit's. */
  value: string;
  foot?: string;
  tone?: ValueTone;
}

const TONE_CLASS: Record<ValueTone, string> = {
  neutral: '',
  positive: ' pos',
  negative: ' neg',
};

/**
 * Above this many cells, the strip sets its figures a step smaller.
 *
 * `table-layout: fixed` divides the strip evenly, so a six-cell strip across
 * the 174mm measure gives each value about 28mm. At `h2 + 2` — 22pt — that is
 * not enough for "3.74%" or "House", and a render showed both broken across
 * two lines: "3.74 / %" and "Hous / e". Five is where the arithmetic turns:
 * 34mm holds a five-character figure at 22pt, 28mm does not.
 */
export const KPI_DENSE_FROM = 5;

export function renderKpiStrip(cells: KpiCell[]): string {
  if (!cells.length) return '';
  const dense = cells.length >= KPI_DENSE_FROM ? ' dense' : '';
  return `
      <div class="kpi-strip${dense}">
        ${cells.map((c) => `
        <div class="kpi">
          <div class="kpi-label">${escapeHtml(c.label)}</div>
          <div class="kpi-value${TONE_CLASS[c.tone ?? 'neutral']}">${escapeHtml(c.value)}</div>
          ${c.foot ? `<div class="kpi-foot">${escapeHtml(c.foot)}</div>` : ''}
        </div>`).join('')}
      </div>`;
}

// ── Editorial primitives ────────────────────────────────────────────────────

export function renderPullQuote(text: string, attribution?: string): string {
  return `
      <blockquote class="pull-quote">${escapeHtml(text)}${
        attribution ? `<cite>${escapeHtml(attribution)}</cite>` : ''
      }</blockquote>`;
}

/**
 * A stat card — the generator's `::: stat` and `::: divider` blocks.
 *
 * A label, one figure at display size with its unit, a caption; a divider
 * states its figure over a headline. The card states nothing on its own: the
 * caller decides whether there is a value to state (`statCardHasValue`) and
 * does not draw one without.
 */
export interface StatCardParts {
  value: string;
  label?: string;
  unit?: string;
  sub?: string;
  /** Already-rendered inline HTML for a divider's headline; escaped by its renderer. */
  headlineHtml?: string;
  divider?: boolean;
}

export function renderStatCard(parts: StatCardParts): string {
  const label = (parts.label ?? '').trim();
  const unit = (parts.unit ?? '').trim();
  const sub = (parts.sub ?? '').trim();
  return `
      <div class="stat-card${parts.divider ? ' stat-divider' : ''}">
        ${label ? `<span class="stat-label">${escapeHtml(label)}</span>` : ''}
        <div class="stat-value">${escapeHtml(parts.value.replace(/\s+/g, ' ').trim())}${unit ? `<span class="stat-unit">${escapeHtml(unit)}</span>` : ''}</div>
        ${sub ? `<span class="stat-sub">${escapeHtml(sub)}</span>` : ''}
        ${parts.headlineHtml ? `<p class="stat-headline">${parts.headlineHtml}</p>` : ''}
      </div>`;
}

export function renderSidenote(label: string, bodyHtml: string): string {
  return `
      <aside class="sidenote">
        <span class="sidenote-label">${escapeHtml(label)}</span>
        ${bodyHtml}
      </aside>`;
}

export type CalloutTone = 'neutral' | 'positive' | 'caution' | 'negative' | 'informative';

/**
 * A toned callout.
 *
 * The tone is a Category B colour, never the brand — so "risk" reads the same
 * in a tenant's report as in ours. See `roles.pure.ts`.
 */
export function renderCallout(tone: CalloutTone, label: string, bodyHtml: string): string {
  return `
      <div class="callout tone-${tone}">
        <span class="callout-label">${escapeHtml(label)}</span>
        ${bodyHtml}
      </div>`;
}

/** "What this means" — at most one per section, per the compass section rules. */
export function renderDecisionBox(label: string, bodyHtml: string): string {
  return `
      <div class="decision-box">
        <span class="decision-label">${escapeHtml(label)}</span>
        ${bodyHtml}
      </div>`;
}

export function renderTwoCol(bodyHtml: string): string {
  return `<div class="two-col">${bodyHtml}</div>`;
}

export type GridSpan = 4 | 5 | 7 | 8;
export interface GridCol {
  span: GridSpan;
  html: string;
}

export function renderGrid12(cols: GridCol[]): string {
  if (!cols.length) return '';
  return `<div class="grid-12">${
    cols.map((c) => `<div class="col col-${c.span}">${c.html}</div>`).join('')
  }</div>`;
}

// ── Tables ──────────────────────────────────────────────────────────────────

export interface TableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
}

export interface TableRow {
  [key: string]: string | boolean | undefined;
  /** Renders with the total rule and weight. */
  __total?: boolean;
}

export interface DataTableOptions {
  caption?: string;
  /**
   * Keys whose values should take the positive/negative colour based on a
   * leading minus sign. Financial tables are the reason Category B exists.
   */
  signedKeys?: readonly string[];
}

/** `-1,234` / `($1,234)` → negative. Both conventions appear in the product. */
function signTone(value: string): ValueTone {
  const v = value.trim();
  if (!v) return 'neutral';
  if (/^\(.*\)$/.test(v)) return 'negative';
  if (/^-\s*[\d$]/.test(v)) return 'negative';
  return 'neutral';
}

export function renderDataTable(
  cols: TableColumn[],
  rows: TableRow[],
  opts: DataTableOptions = {},
): string {
  if (!cols.length || !rows.length) return '';
  const signed = new Set(opts.signedKeys ?? []);

  const head = cols
    .map((c) => `<th scope="col" class="${c.align === 'right' ? 'num' : ''}">${escapeHtml(c.label)}</th>`)
    .join('');

  const body = rows.map((r) => {
    const cells = cols.map((c, idx) => {
      const raw = typeof r[c.key] === 'string' ? r[c.key] as string : '';
      const classes: string[] = [];
      if (c.align === 'right') classes.push('num');
      if (signed.has(c.key) && signTone(raw) === 'negative') classes.push('neg');
      const cls = classes.length ? ` class="${classes.join(' ')}"` : '';
      // The first column is the row's label, so it is a header cell — that is
      // what makes the table navigable in a tagged PDF.
      return idx === 0
        ? `<th scope="row"${cls}>${escapeHtml(raw)}</th>`
        : `<td${cls}>${escapeHtml(raw)}</td>`;
    }).join('');
    return `<tr${r.__total ? ' class="total"' : ''}>${cells}</tr>`;
  }).join('');

  // A header row of empty labels is not a header row.
  //
  // A GFM table whose header cells are blank — which is what a two-column
  // key/value table transcribed out of a PDF usually is — produced a `thead` of
  // empty `th`s. Invisible while the header carried no styling of its own, and
  // an empty tinted band across the top of the table the moment one did. There
  // is nothing for a screen reader or a tagged PDF to announce either, so the
  // row is dropped rather than styled around.
  const hasHead = cols.some((c) => String(c.label ?? '').trim());

  // The wrapper is what keeps the caption with its table across a page break —
  // a `<caption>` is a separate box and WeasyPrint will strand it otherwise.
  return '<div class="table-block"><table class="data">'
    + (opts.caption ? `<caption>${escapeHtml(opts.caption)}</caption>` : '')
    + (hasHead ? `<thead><tr>${head}</tr></thead>` : '')
    + `<tbody>${body}</tbody></table></div>`;
}

/**
 * A wide numeric matrix — the ten-year projection and its kin.
 *
 * Twelve columns is 42pt each in the portrait measure and 63pt across the long
 * edge, which is the difference between a wrapped cell and a readable one, so
 * this opens the `landscape-table` page rather than trying to fit.
 */
export function renderBandedMatrix(
  rowLabel: string,
  periods: string[],
  rows: Array<{ label: string; values: string[]; total?: boolean }>,
  opts: { caption?: string } = {},
): string {
  const cols: TableColumn[] = [
    { key: 'label', label: rowLabel, align: 'left' },
    ...periods.map((p, i) => ({ key: `p${i}`, label: p, align: 'right' as const })),
  ];
  const tableRows: TableRow[] = rows.map((r) => {
    const row: TableRow = { label: r.label };
    r.values.forEach((v, i) => { row[`p${i}`] = v; });
    if (r.total) row.__total = true;
    return row;
  });
  return renderPage(
    'landscape-table',
    renderDataTable(cols, tableRows, {
      caption: opts.caption,
      signedKeys: periods.map((_, i) => `p${i}`),
    }),
  );
}

// ── Closing company page ────────────────────────────────────────────────────

export interface CompanyPageProps {
  block: CompanyBlock;
  /** Heading above the contact rows. */
  contactHeading?: string;
  /** Optional mono lockup at the head of the page. */
  lockup?: BrandLockupProps | null;
}

/**
 * The dark closing page: company, contact details, professional disclaimer.
 *
 * Replaces both `drawJsPDFDisclaimerPage` and `drawPdfLibDisclaimerPage`. The
 * disclaimer's point size is honoured here, which the jsPDF implementation
 * ignored — it hardcoded 8.5pt whatever the setting said.
 */
export function renderCompanyPage(p: CompanyPageProps): string {
  const { block } = p;
  const rows = block.rows.map((r) => `
        <div class="contact-row">
          <span class="contact-label">${escapeHtml(r.label)}</span>
          <span class="contact-value">${escapeHtml(r.value)}</span>
        </div>`).join('');

  const disclaimer = block.disclaimer.paragraphs.length
    ? `<div class="disclaimer" style="font-size:${block.disclaimer.fontPt}pt">${
        block.disclaimer.paragraphs.map((t) => `<p>${escapeHtml(t)}</p>`).join('')
      }</div>`
    : '';

  // A wordmark-only lockup above the wordmark is the firm's name printed twice,
  // 20mm apart, at two sizes. Read off a closing page: `TENANT ADVISORY` in
  // small letterspaced caps, then `TENANT` over `ADVISORY` as the display
  // lockup underneath it. When the lockup carries a mark the repetition earns
  // its place — the image is the point and the text labels it — and when it
  // does not, it is noise on the one page that is nothing but the brand.
  const sameWords = (a: string, b: string) =>
    a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '');
  const wordmark = `${block.name.lead} ${block.name.tail ?? ''}`;
  const lockupEchoes = Boolean(
    p.lockup && !p.lockup.markDataUri && p.lockup.wordmark && sameWords(p.lockup.wordmark, wordmark),
  );
  const lockup = p.lockup && !lockupEchoes
    ? renderBrandLockup({ ...p.lockup, onField: true })
    : '';

  return `
    <section class="company-page page-disclaimer">
      ${lockup}
      <h1 class="company-name">${escapeHtml(block.name.lead)}${
        block.name.tail ? `<span class="tail">${escapeHtml(block.name.tail)}</span>` : ''
      }</h1>
      ${block.rows.length
        ? `<div class="eyebrow on-field">${escapeHtml(p.contactHeading ?? 'Contact us')}</div>
      <div class="contact">${rows}
      </div>`
        : ''}
      ${disclaimer}
    </section>`;
}
