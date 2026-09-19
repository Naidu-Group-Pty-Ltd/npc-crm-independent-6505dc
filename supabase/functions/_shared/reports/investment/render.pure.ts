/**
 * The investment report, as a document.
 *
 * ## What changes, beyond the typesetting
 *
 * The generator being replaced prints 36 sections of prose and charts whatever
 * table it can coerce into two numeric columns. Six jsonb columns of genuinely
 * structured measurement — the five-way score breakdown, the walk score and
 * coordinates, the household profile, the macro indicators, the cost lines, the
 * three-scenario ten-year projection — reach the page only as whatever the model
 * happened to restate in prose, if at all.
 *
 * This document draws them. Fourteen named infographics attach to prose sections
 * by the generator's own numbering, so section 24 always carries the sensitivity
 * tornado and section 30 always carries the score wheel, and a chart whose data
 * is missing is simply not drawn.
 *
 * ## The KPI strip is the honest headline
 *
 * The cover and the opening strip carry the score, the grade, the yield and the
 * net position — but only the ones the row actually has. **Only 15% of reports
 * carry a financial model**, so on most documents the strip is three cells wide
 * rather than six, and the opening callout says why rather than leaving a
 * reader to wonder where the yield went.
 */
import {
  closeChapter,
  escapeHtml,
  openChapter,
  renderCallout,
  renderChapterHeader,
  renderCompanyPage,
  renderContentsPage,
  renderCover,
  renderDataTable,
  renderDocument,
  renderKpiStrip,
  renderLede,
  type BrandLockupProps,
  type KpiCell,
  type TableRow,
} from '../../reportDesign/primitives.pure.ts';
import type { CompanyBlock, CompanyDisclaimer } from '../../reportDesign/companyBlock.pure.ts';
import {
  buildSpine,
  contentsEntriesFor,
  REPORT_ARCHETYPES,
  type SpineEntry,
  spinePageBudget,
  validateSpine,
} from '../../reportDesign/structure.pure.ts';
import { buildReportCss } from '../../reportDesign/css.pure.ts';
import { count, formatMeasure } from '../../reportDesign/measure.pure.ts';
import { PRINT_STACK } from '../../reportDesign/typography.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import type { ReportDesignOptions } from '../../reportDesign/options.pure.ts';
import type { ReportBrandSnapshot } from '../../reportDesign/snapshot.pure.ts';
import { resolveSnapshotBrand } from '../../reportDesign/documentBrand.pure.ts';
import { contentLosses, renderMarkdown } from '../markdown.pure.ts';
import { vizDirectiveRenderer } from '../vizFigures.pure.ts';
import { chartHasData, investmentChartContext, renderNamedChart } from './charts.pure.ts';
import type { InvestmentReport, SectionChart } from './payload.pure.ts';
import { scenarioSeries } from './normalise.pure.ts';
import {
  chaptersFor,
  contentsPagesFor,
  planChapters,
  type PlannedChapter,
} from './sections.pure.ts';
import { formatReportDate } from '../reportDate.pure.ts';

const ARCHETYPE = REPORT_ARCHETYPES['investment-compass'];
export const DOCUMENT_NAME = ARCHETYPE.documentName;


/** `2026-04-22T…` → `22 April 2026`. */
export { formatReportDate };

const pct = (v: number, d = 1): string => `${v.toFixed(d)}%`;

function money(v: number): string {
  const abs = Math.abs(v);
  const body = abs >= 1_000_000
    ? `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}m`
    : abs >= 1_000
      ? `${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`
      : abs.toFixed(0);
  return `${v < 0 ? '−' : ''}$${body}`;
}

/**
 * The headline figures, and only the ones that exist.
 *
 * Built from what the row has rather than from a fixed list with em-dashes in
 * the gaps: a strip of six cells where four read "—" tells a reader the document
 * is broken, when in fact this kind of report simply does not carry a financial
 * model.
 */
export function kpiCells(report: InvestmentReport): KpiCell[] {
  const cells: KpiCell[] = [];
  const s = report.score;
  const f = report.financial;

  if (s?.total !== null && s?.total !== undefined) {
    cells.push({ label: 'Investment score', value: String(Math.round(s.total)), foot: 'out of 100' });
  }
  if (s?.grade) cells.push({ label: 'Grade', value: s.grade, foot: 'composite' });
  if (report.specs.propertyType) {
    // The one cell in this strip whose value is words rather than a figure, and
    // the corpus writes it long — "Residential Property" on 1,054 rows. In a
    // six-cell `table-layout: fixed` strip that is about 28mm a cell, so it
    // wraps; `.kpi-value` now leads for that, and the redundant noun is dropped
    // so it usually does not have to. The zoning stays in the foot.
    const type = report.specs.propertyType.replace(/\s+Property$/i, '').trim();
    cells.push({
      label: 'Property',
      value: type || report.specs.propertyType,
      foot: report.specs.zoning || undefined,
    });
  }
  if (f?.grossYield !== null && f?.grossYield !== undefined) {
    cells.push({ label: 'Gross yield', value: pct(f.grossYield, 2), foot: 'of purchase price' });
  }
  if (f?.netYield !== null && f?.netYield !== undefined) {
    cells.push({ label: 'Net yield', value: pct(f.netYield, 2), foot: 'after costs' });
  }
  if (f?.annualNet !== null && f?.annualNet !== undefined) {
    cells.push({
      label: 'Annual position',
      value: money(f.annualNet),
      foot: f.annualNet < 0 ? 'negatively geared' : 'positively geared',
      tone: f.annualNet < 0 ? 'negative' : 'positive',
    });
  }
  return cells.slice(0, 6);
}

/**
 * The property specification, as a table — carrying only what the tiles above
 * it do not.
 *
 * `propertyTiles` draws bedrooms, bathrooms, parking, land, building, year
 * built, zoning and type. This table used to draw all eight again, directly
 * underneath, so the opening chapter said the same facts twice in two
 * treatments across two consecutive pages. Read off a render: eight tiles on
 * page 4, the same eight as table rows on page 5.
 *
 * The address and the council are the two the tiles have no room for, so they
 * are what the table is for. When the tiles did not draw — fewer than three
 * facts — the table carries everything, because then nothing else has.
 */
function specTable(report: InvestmentReport, tiled: boolean): string {
  const s = report.specs;
  const rows: TableRow[] = [];
  const add = (k: string, v: string) => { if (v) rows.push({ item: k, detail: v }); };
  add('Address', report.meta.propertyAddress);
  if (!tiled) {
    add('Type', s.propertyType);
    add('Bedrooms', s.bedrooms === null ? '' : String(s.bedrooms));
    add('Bathrooms', s.bathrooms === null ? '' : String(s.bathrooms));
    add('Parking', s.parking === null ? '' : String(s.parking));
    add('Land', s.landSqm === null ? '' : `${Math.round(s.landSqm)} m²`);
    add('Building', s.buildingSqm === null ? '' : `${Math.round(s.buildingSqm)} m²`);
    add('Year built', s.yearBuilt === null ? '' : String(s.yearBuilt));
    add('Zoning', s.zoning);
  }
  add('Council', s.councilArea);
  if (!rows.length) return '';
  return renderDataTable(
    [
      { key: 'item', label: 'Attribute', align: 'left' },
      { key: 'detail', label: 'Detail', align: 'left' },
    ],
    rows,
    { caption: 'As recorded when the report was generated' },
  );
}

/** The sources, numbered. */
function sourcesTable(sources: readonly string[]): string {
  if (!sources.length) return '';
  return renderDataTable(
    [
      { key: 'n', label: '#', align: 'left' },
      { key: 'source', label: 'Source', align: 'left' },
    ],
    sources.map((s, i) => ({ n: String(i + 1), source: s })),
    { caption: 'What this report was drawn from' },
  );
}

export interface RenderInvestmentInput {
  report: InvestmentReport;
  palette: ResolvedReportPalette;
  company: CompanyBlock;
  masthead: string;
  lockup?: BrandLockupProps | null;
  heroDataUri?: string | null;
  confidentiality?: string | null;
  options?: ReportDesignOptions | null;
  edition?: string | null;
  reference?: string | null;
  /** The raw `projections` payload, for the scenario fan. */
  projectionsRaw?: unknown;
}

export interface InvestmentRenderPlan {
  spine: SpineEntry[];
  bodyHtml: string;
  chapters: string[];
  pageBudget: number;
  dropped: string[];
  charsOmitted: number;
  /** Charts a chapter earned but had no data behind. */
  chartsSkipped: number;
  /** Charts actually drawn. The ledger records both. */
  chartsDrawn: number;
  degraded: boolean;
  problems: string[];
}

/** The body of one planned chapter, prose and charts together. */
function chapterBody(
  chapter: PlannedChapter,
  report: InvestmentReport,
  ctx: ReturnType<typeof investmentChartContext>,
  projectionsRaw: unknown,
  counters: { drawn: number; skipped: number; losses: string[] },
): string {
  const scenarios = (field: 'propertyValue' | 'cumulativeCashFlow' | 'annualRent') =>
    scenarioSeries(projectionsRaw, field);

  const drawDirective = vizDirectiveRenderer(ctx);

  const drawCharts = (names: readonly SectionChart[]): string => names.map((name) => {
    // `chartHasData` is what the page planner charged for. Asking it first means
    // a chart that produces nothing anyway is counted the same way in both
    // modules; a chart that passes the check and *still* returns nothing is the
    // interesting case, and it lands in `chartsSkipped` where the ledger sees it.
    if (!chartHasData(name, report)) { counters.skipped += 1; return ''; }
    const html = renderNamedChart(name, report, ctx, scenarios);
    if (html) counters.drawn += 1; else counters.skipped += 1;
    return html;
  }).join('');

  if (chapter.kind === 'sources') return sourcesTable(report.sources);
  if (chapter.kind === 'property') {
    const tiles = drawCharts(chapter.charts);
    return tiles + specTable(report, Boolean(tiles));
  }

  // A prose chapter is its numbered sections, each under its own subhead, each
  // followed by its own charts. Interleaved rather than prose-then-charts,
  // because `SECTION_CHARTS` attaches an infographic to a section by number:
  // rendering a chapter's prose and then all of its charts would put the
  // sensitivity tornado four subheads below the sensitivity analysis.
  // A chapter that *is* one section already carries that section's name in its
  // 34pt header, so a subhead repeating it would set the same words twice, four
  // lines apart — the defect `MarkdownOptions.chapterTitle` exists to stop, one
  // level up. Only the grouped chapters need subheads to tell their parts apart.
  const subheads = chapter.parts.length > 1;

  return chapter.parts.map((part, i) => {
    const idPrefix = `${chapter.id.replace(/[^a-z0-9]/gi, '')}p${i}`;
    const heading = subheads ? `<h2>${escapeHtml(part.title)}</h2>` : '';
    let prose = '';
    if (part.markdown) {
      const md = renderMarkdown(part.markdown, {
        idPrefix,
        // See `MarkdownOptions.chapterTitle` — model prose heads itself, and
        // the subhead above is now that title, so an echo must still be dropped.
        chapterTitle: part.title,
        // The model's own `{{bars: …}}` / `{{gauge: …}}` lines. Around 124 a
        // report, and until this callback existed every one of them set as body
        // copy. They count into the same ledger columns as the fourteen named
        // infographics, because on the page they are the same thing.
        renderDirective: drawDirective,
      });
      prose = md.html;
      counters.drawn += md.notices.figuresDrawn;
      counters.skipped += md.notices.figuresDropped;
      // Two of the twenty-four notices were read here and the rest discarded —
      // including every one that means a client's content did not reach the
      // page. `contentLosses` draws that line once; the losses join the same
      // `problems` list the spine validation uses, prefixed with the part they
      // happened in so a reader can find them.
      for (const loss of contentLosses(md.notices)) {
        counters.losses.push(`${part.title || chapter.id}: ${loss}`);
      }
    }
    // Charts after the prose that introduces them, not before it. The section's
    // own first sentence says what the reader is about to look at.
    return heading + prose + drawCharts(part.charts);
  }).join('');
}

export function renderInvestmentBody(input: RenderInvestmentInput): InvestmentRenderPlan {
  const report = input.report;
  const { chapters, dropped, charsOmitted } = planChapters(report);
  const ctx = investmentChartContext(input.palette);
  const counters = { drawn: 0, skipped: 0, losses: [] as string[] };

  const spine = buildSpine({
    archetype: 'investment-compass',
    chapters: chaptersFor(chapters),
    contentsPages: contentsPagesFor(chapters),
  });
  const problems = validateSpine('investment-compass', spine);

  const cover = renderCover({
    eyebrow: DOCUMENT_NAME,
    title: report.meta.propertyAddress || 'Investment Report',
    masthead: input.masthead,
    edition: input.edition ?? null,
    meta: [
      { label: 'Prepared on', value: formatReportDate(report.meta.preparedOn) },
      { label: 'Generated', value: formatReportDate(report.meta.generatedAt) },
      ...(report.score?.grade ? [{ label: 'Grade', value: report.score.grade }] : []),
      { label: 'Chapters', value: String(chapters.length) },
    ].filter((m) => m.value),
    lockup: input.lockup ?? null,
    heroDataUri: input.heroDataUri ?? null,
    footerLeft: input.confidentiality ?? 'Private and confidential',
    footerRight: input.reference ?? '',
  });

  const contents = renderContentsPage(
    'Contents',
    contentsEntriesFor(spine).map((e) => ({ number: e.number, title: e.title, note: e.note })),
  );

  // Said on the page. 997 of the corpus's 1,176 reports have no financial model
  // at all, so this is the ordinary case rather than an error — but a reader
  // looking for a yield needs to be told, not left to search 36 chapters.
  const noFinancials = !report.meta.hasFinancials
    ? renderCallout(
      'informative',
      'This report carries no financial model',
      '<p>No purchase price, loan structure or rental figures were supplied when this '
      + 'report was generated, so it contains no yield, cash-flow, sensitivity or '
      + 'projection analysis. The location, demographic and scoring work is unaffected.</p>',
    )
    : '';

  const noScore = !report.meta.hasScore
    ? renderCallout(
      'caution',
      'This report was not scored',
      '<p>The investment scoring engine did not return a result for this property, so '
      + 'there is no grade, no dimension breakdown and no peer comparison.</p>',
    )
    : '';

  const cut = dropped.length
    ? renderCallout(
      'caution',
      'Not every chapter is shown',
      `<p>${escapeHtml(
        `${dropped.map((d) => d.title).join(', ')} ${dropped.length === 1 ? 'was' : 'were'} `
        + 'longer than this document can carry and were not printed. The full text is in '
        + 'the report record.',
      )}</p>`,
    )
    : '';

  // Clipping happens per section, so a chapter's shortfall is its sections'.
  // Summed here rather than stored on the chapter, because the number a reader
  // wants is "how much of this chapter is missing" and there is exactly one
  // place that can answer it.
  const clipNotice = (chapter: PlannedChapter): string => {
    const clipped = (chapter.clippedChars ?? 0)
      + chapter.parts.reduce((n, p) => n + (p.clippedChars ?? 0), 0);
    if (!clipped) return '';
    return renderCallout(
      'caution',
      'This chapter is shortened',
      `<p>${escapeHtml(
        // `formatMeasure(count(…))`, not `toLocaleString`: Deno and Node need
        // not agree on ICU grouping and this string is asserted in a test.
        `A further ${formatMeasure(count(clipped))} characters of this `
        + 'chapter are not printed here. The full text is in the report record.',
      )}</p>`,
    );
  };

  const strip = kpiCells(report);
  const body = chapters.map((chapter, index) => {
    const number = String(index + 1).padStart(2, '0');
    const opening = index === 0
      ? renderLede(report.narrative)
        + (strip.length >= 2 ? renderKpiStrip(strip) : '')
        + noScore + noFinancials + cut
      : '';
    return openChapter(DOCUMENT_NAME, number, chapter.title)
      + renderChapterHeader({
        number,
        title: chapter.title,
        dek: chapter.dek,
        label: ARCHETYPE.chapterLabel,
      })
      + `<div class="chapter-body">${opening}`
      + chapterBody(chapter, report, ctx, input.projectionsRaw, counters)
      + `${clipNotice(chapter)}</div>`
      + closeChapter();
  }).join('');

  const closing = renderCompanyPage({ block: input.company, lockup: input.lockup ?? null });

  return {
    spine,
    bodyHtml: cover + contents + body + closing,
    chapters: chapters.map((c) => c.title),
    pageBudget: spinePageBudget(spine),
    dropped: dropped.map((d) => d.title),
    charsOmitted,
    chartsSkipped: counters.skipped,
    chartsDrawn: counters.drawn,
    // A chapter dropped for budget, prose cut for length, or content the
    // markdown renderer could not carry — all three are the document not
    // saying what the record holds, so all three degrade it.
    degraded: dropped.length > 0 || charsOmitted > 0 || counters.losses.length > 0,
    problems: [...problems, ...counters.losses],
  };
}

export function renderInvestmentDocument(
  input: RenderInvestmentInput,
): InvestmentRenderPlan & { html: string } {
  const plan = renderInvestmentBody(input);
  return {
    ...plan,
    html: renderDocument({
      title: `${DOCUMENT_NAME} — ${input.report.meta.propertyAddress}`,
      author: input.masthead,
      subject: DOCUMENT_NAME,
      css: buildReportCss({
        palette: input.palette,
        options: input.options ?? null,
        masthead: input.masthead,
      }) + swotCss(input.palette),
      bodyHtml: plan.bodyHtml,
    }),
  };
}

/**
 * The one block of CSS this format adds.
 *
 * The SWOT grid is four labelled cells, and nothing in `css.pure.ts` lays out a
 * 2×2 of lists — the closest is `.kpi-strip`, which is a single row of figures.
 * Kept here rather than pushed into the shared sheet because it is the only
 * format that has a SWOT, and a rule in the shared sheet that one document uses
 * is a rule the next person has to work out the owner of.
 *
 * **A function of the palette, not a constant.** The first version of this was a
 * template literal using `var(--positive)`, `var(--rule)` and friends, on the
 * assumption that the shared sheet exposed custom properties. It does not — it
 * interpolates palette values directly, and there is not one `--` declaration in
 * the file. Every colour in the block therefore resolved to nothing, and the
 * render showed four SWOT cells with identical borders where the whole point of
 * the quadrant is that helpful and harmful read apart at a glance. Found by
 * looking at the page, not by any check that could have run.
 */
function swotCss(palette: ResolvedReportPalette): string {
  return `
  .swot-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 6pt;
    margin: 10pt 0 12pt; break-inside: avoid;
  }
  .swot-cell {
    border: 0.6pt solid ${palette.rule}; border-left-width: 2.6pt;
    padding: 7pt 9pt 8pt; background: ${palette.paperAlt};
  }
  .swot-cell.tone-positive { border-left-color: ${palette.positive}; }
  .swot-cell.tone-negative { border-left-color: ${palette.negative}; }
  .swot-cell.tone-caution { border-left-color: ${palette.caution}; }
  .swot-cell.tone-informative { border-left-color: ${palette.informative}; }
  .swot-label {
    display: block; font-family: ${PRINT_STACK.mono}; font-size: 6.6pt;
    letter-spacing: 0.09em; text-transform: uppercase; color: ${palette.mutedInk};
    margin-bottom: 4pt;
  }
  .swot-cell ul { margin: 0; padding-left: 12pt; }
  .swot-cell li { font-size: 8.6pt; line-height: 1.42; margin-bottom: 2pt; color: ${palette.bodyInk}; }
  .swot-empty { font-size: 8.6pt; color: ${palette.mutedInk}; font-style: italic; margin: 0; }
`;
}

export interface RenderInvestmentFromBrandInput {
  report: InvestmentReport;
  snapshot: ReportBrandSnapshot;
  disclaimer?: CompanyDisclaimer | null;
  coverArtDataUri?: string | null;
  options?: ReportDesignOptions | null;
  edition?: string | null;
  reference?: string | null;
  projectionsRaw?: unknown;
}

export interface InvestmentRenderResult extends InvestmentRenderPlan {
  html: string;
  gaps: string[];
}

export function renderInvestmentFromBrand(
  input: RenderInvestmentFromBrandInput,
): InvestmentRenderResult {
  const brand = resolveSnapshotBrand({
    snapshot: input.snapshot,
    disclaimer: input.disclaimer ?? null,
    coverArtDataUri: input.coverArtDataUri ?? null,
  });

  const rendered = renderInvestmentDocument({
    report: input.report,
    palette: brand.palette,
    company: brand.company,
    masthead: brand.masthead,
    lockup: brand.lockup,
    heroDataUri: brand.heroDataUri,
    confidentiality: brand.confidentiality,
    options: input.options ?? null,
    edition: input.edition ?? null,
    reference: input.reference ?? null,
    projectionsRaw: input.projectionsRaw,
  });

  return { ...rendered, gaps: brand.gaps };
}
