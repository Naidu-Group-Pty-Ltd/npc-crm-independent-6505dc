/**
 * The projection as HTML, through the design system.
 *
 * The generator this replaces draws the document: `pdf.addImage` for a cover
 * raster, hard-coded millimetre offsets for every value, `#c9a55a` written into
 * the source four times, and a ten-year table squeezed into portrait measure
 * where twelve columns get 42pt each. None of those are choices anyone made
 * about this document — they are what happens when a PDF is drawn instead of
 * laid out.
 *
 * Here the matrix opens the landscape page because `renderBandedMatrix` says a
 * wide numeric table does, every colour comes from the resolved palette, and
 * the cover carries the tenant's mark because the brand snapshot decided it.
 *
 * The legacy generators stay exactly where they are. This is a second path, not
 * a replacement: `CashFlowAnalysisModal` still exports the comparison PDF, the
 * AI analysis PDF and the Excel workbook from the browser, and still has its own
 * single-report generator to fall back to.
 */

import type { BrandLockupProps } from '../../reportDesign/primitives.pure.ts';
import {
  closeChapter,
  escapeHtml,
  openChapter,
  renderBandedMatrix,
  renderCallout,
  renderChapterHeader,
  renderCompanyPage,
  renderCover,
  renderDataTable,
  renderDocument,
  renderKpiStrip,
  renderLede,
  renderSidenote,
  type KpiCell,
  type TableColumn,
  type TableRow,
} from '../../reportDesign/primitives.pure.ts';
import { buildReportCss } from '../../reportDesign/css.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import type { ReportDesignOptions } from '../../reportDesign/options.pure.ts';
import type { CompanyBlock, CompanyDisclaimer } from '../../reportDesign/companyBlock.pure.ts';
import { REPORT_ARCHETYPES } from '../../reportDesign/structure.pure.ts';
import type { ReportBrandSnapshot } from '../../reportDesign/snapshot.pure.ts';
import { resolveSnapshotBrand } from '../../reportDesign/documentBrand.pure.ts';
import { formatAmount, formatMeasure, periodLabel } from '../../reportDesign/measure.pure.ts';

import type { CashFlowProjection, ProjectionYear } from './payload.pure.ts';
import { cashFlowSections, validateCashFlowSpine } from './sections.pure.ts';
import { cashPositionChart, equityBuildChart } from './charts.pure.ts';
import { formatReportDate as formatPreparedOn } from '../reportDate.pure.ts';

const ARCHETYPE = REPORT_ARCHETYPES['cash-flow-projection'];

/** What the product calls this format, on the cover and in the filename. */
export const DOCUMENT_NAME = ARCHETYPE.documentName;

// ── Dates ───────────────────────────────────────────────────────────────────


/**
 * `2026-08-02T…` → `02 August 2026`.
 *
 * Parsed rather than handed to `Date`: this module is pure, and
 * `toLocaleDateString` depends on the runtime's ICU build, so the same payload
 * would date itself differently in Deno and in Node.
 */
export { formatPreparedOn };

// ── Section renderers ───────────────────────────────────────────────────────

const p = (t: string) => (t ? `<p>${escapeHtml(t)}</p>` : '');
/**
 * A subhead inside a chapter.
 *
 * `h2`, not `h3`. Six of these formats grew their own `const h3` helper for
 * "a subhead" while the design system's actual subhead — `h2` at 17pt, whose
 * rule in `css.pure.ts` carries a paragraph explaining that it is a different
 * object from a chapter title — went unused in every one of them. A chapter
 * title is an `h1`, so an `h3` under it skips a level, and PDF/UA 7.4.2 fails
 * on exactly that: "heading level 2 is skipped in a descending sequence".
 *
 * Seven of the ten documents failed the same rule and no other. Named
 * `subhead` rather than `h2` so the next person reaches for the level the
 * design system defines instead of inventing one.
 */
const subhead = (text: string) => `<h2>${escapeHtml(text)}</h2>`;

function renderList(items: readonly string[]): string {
  if (!items.length) return '';
  return `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

function positionSection(cf: CashFlowProjection): string {
  const a = cf.acquisition;
  const y1 = cf.yearOne;

  // The weekly figure first, because it is the one an investor holds in their
  // head. The legacy generator leads with the purchase price, which is the one
  // number the client already knows.
  const kpis: KpiCell[] = [
    {
      label: 'After tax, year 1',
      value: formatMeasure(y1.afterTaxWeekly),
      tone: y1.afterTaxWeekly.value >= 0 ? 'positive' : 'negative',
      foot: `${formatMeasure(y1.afterTaxAnnual)} for the year`,
    },
    {
      label: 'Gross yield',
      value: formatMeasure(y1.grossYield),
      foot: `Net ${formatMeasure(y1.netYield)}`,
    },
    {
      label: 'Loan at settlement',
      value: formatMeasure(a.loanAmount),
      foot: `${formatMeasure(a.lvr)} LVR`,
    },
  ];

  const purchase: TableRow[] = [
    { item: 'Purchase price', value: formatMeasure(a.purchasePrice) },
    { item: 'Market value', value: formatMeasure(a.marketValue) },
    { item: 'Deposit', value: formatMeasure(a.deposit) },
    { item: 'Loan amount', value: formatMeasure(a.loanAmount) },
    { item: 'Loan to value', value: formatMeasure(a.lvr) },
    { item: 'Loan type', value: a.loanType },
    { item: 'Loan term', value: formatMeasure(a.loanTerm) },
    { item: 'Interest rate', value: formatMeasure(a.interestRate) },
    { item: 'Weekly rent', value: formatMeasure(a.weeklyRent) },
  ];

  const costs = a.costs.length
    ? renderDataTable(
      [{ key: 'item', label: 'Acquisition cost', align: 'left' },
        { key: 'value', label: 'Amount', align: 'right' }],
      a.costs.map((c) => ({ item: c.label, value: formatMeasure(c.amount) })),
      { caption: 'Costs at purchase' },
    )
    : '';

  const perYear = periodLabel('aud/year');
  const yearOne: TableRow[] = [
    { item: 'Rental income', value: formatAmount(y1.rentalIncome) },
    { item: 'Property expenses', value: formatAmount(y1.expenses) },
    { item: 'Interest', value: formatAmount(y1.interest) },
    { item: 'Cash flow before tax', value: formatAmount(y1.preTaxAnnual), __total: false },
    { item: 'Tax refund / (payable)', value: formatAmount(y1.taxEffect) },
    { item: 'Cash flow after tax', value: formatAmount(y1.afterTaxAnnual), __total: true },
  ];

  return renderLede(cf.narrative)
    + renderKpiStrip(kpis)
    + renderDataTable(
      [{ key: 'item', label: 'Term', align: 'left' }, { key: 'value', label: 'Value', align: 'right' }],
      purchase,
      { caption: 'The purchase' },
    )
    + costs
    + subhead('Year one, line by line')
    + renderDataTable(
      [{ key: 'item', label: 'Line', align: 'left' }, { key: 'value', label: `Amount ${perYear}`, align: 'right' }],
      yearOne,
      { caption: 'Year one cash flow', signedKeys: ['value'] },
    )
    + renderSidenote(
      'Weekly, after tax',
      p(`${formatMeasure(y1.afterTaxWeekly)} is the year-one figure divided by 52. `
        + 'It is the number most investors budget against, and it moves every year — '
        + 'the projection overleaf shows how.'),
    );
}

/**
 * The matrix — the artefact this document exists to deliver.
 *
 * Rows are lines and columns are years, which is the orientation the product's
 * own on-screen table uses and the one an adviser reads out. The portrait
 * attempt is what made the legacy export unreadable: twelve columns get 42pt
 * each across the short edge and 63pt across the long one, which is the
 * difference between a wrapped cell and a readable figure.
 *
 * **Two tables, not one.** Fourteen lines is one row more than a landscape page
 * holds, and the first render of this document put "After tax, per week" alone
 * on a page of its own. Splitting them by what they are about — the position,
 * then the cash flow — fits, and reads better than the fourteen-row wall did:
 * the two groups answer different questions, and a reader was already scanning
 * for the boundary between them.
 */
function projectionSection(cf: CashFlowProjection): string {
  const periods = cf.years.map((y) => (y.calendarYear ? `Y${y.year} · ${y.calendarYear}` : `Year ${y.year}`));
  const line = (label: string, pick: (y: ProjectionYear) => string, total = false) => ({
    label,
    values: cf.years.map(pick),
    total,
  });

  const position = renderBandedMatrix(
    'Position',
    periods,
    [
      line('Property value', (y) => formatMeasure(y.propertyValue)),
      line('Loan balance', (y) => formatMeasure(y.loanBalance)),
      line('Equity', (y) => formatMeasure(y.equity), true),
      line('LVR', (y) => formatMeasure(y.lvr)),
      line('Capital growth applied', (y) => formatMeasure(y.capitalGrowth)),
    ],
    { caption: `Value, debt and equity at the end of each year — years 1 to ${cf.meta.termYears}` },
  );

  const cashflow = renderBandedMatrix(
    'Cash flow',
    periods,
    [
      line('Rental income', (y) => formatAmount(y.rentalIncome)),
      line('Gross yield', (y) => formatMeasure(y.grossYield)),
      line('Property expenses', (y) => formatAmount(y.expenses)),
      line('Interest', (y) => formatAmount(y.interest)),
      line('Principal', (y) => formatAmount(y.principal)),
      line('Before tax', (y) => formatAmount(y.preTaxAnnual)),
      line('Depreciation', (y) => formatAmount(y.depreciation)),
      line('Tax refund / (payable)', (y) => formatAmount(y.taxEffect)),
      line('After tax', (y) => formatAmount(y.afterTaxAnnual), true),
      line('After tax, per week', (y) => formatAmount(y.afterTaxWeekly), true),
    ],
    { caption: 'Dollars per year unless the row says otherwise; the weekly figure is the annual one divided by 52' },
  );

  return position + cashflow;
}

function growthSection(cf: CashFlowProjection, palette: ResolvedReportPalette): string {
  const o = cf.outcome;

  const kpis: KpiCell[] = [
    { label: 'Value at year ' + cf.meta.termYears, value: formatMeasure(o.endingValue) },
    { label: 'Equity', value: formatMeasure(o.endingEquity), tone: 'positive' },
    {
      label: 'Cumulative cash flow',
      value: formatMeasure(o.cumulativeAfterTax),
      tone: o.cumulativeAfterTax.value >= 0 ? 'positive' : 'negative',
      foot: 'After tax, all years',
    },
  ];

  const breakEven = o.breakEvenYear
    ? renderCallout(
      'positive',
      'When it pays for itself',
      p(o.breakEvenYear === 1
        ? 'After-tax cash flow is positive from year one.'
        : `After-tax cash flow first turns positive in year ${o.breakEvenYear}.`),
    )
    : renderCallout(
      'caution',
      'It does not pay for itself in this term',
      p('After-tax cash flow stays negative across the projected years. That is a '
        + 'holding cost, not a verdict — the case for the property is the capital '
        + 'growth line above it, and both belong in the decision.'),
    );

  return renderKpiStrip(kpis)
    + equityBuildChart(cf, palette)
    + renderDataTable(
      [{ key: 'item', label: 'At the end of the term', align: 'left' },
        { key: 'value', label: 'Amount', align: 'right' }],
      [
        { item: 'Property value', value: formatMeasure(o.endingValue) },
        { item: 'Loan balance', value: formatMeasure(o.endingLoanBalance) },
        { item: 'Equity', value: formatMeasure(o.endingEquity), __total: true },
        { item: 'Capital growth over the term', value: formatMeasure(o.capitalGain) },
        { item: 'Cumulative cash flow after tax', value: formatMeasure(o.cumulativeAfterTax) },
      ],
      { caption: 'Where the projection ends', signedKeys: ['value'] },
    )
    + cashPositionChart(cf, palette)
    + breakEven;
}

function assumptionsSection(cf: CashFlowProjection): string {
  const table = cf.assumptions.length
    ? renderDataTable(
      [{ key: 'item', label: 'Assumption', align: 'left' },
        { key: 'value', label: 'Basis', align: 'right' }],
      cf.assumptions.map((a) => ({ item: a.label, value: a.value })),
      { caption: 'What this projection assumes' },
    )
    : '';

  const notes = cf.notes.length
    ? renderCallout('neutral', 'Worth knowing', renderList(cf.notes))
    : '';

  return table + notes + renderCallout(
    'caution',
    'These are projections',
    p('Every figure past year one is the result of applying assumed growth, '
      + 'inflation and interest rates to the year before it. Actual rents, values, '
      + 'rates and tax outcomes will differ. This is not financial advice.'),
  );
}

const SECTION_BODY: Record<
  string,
  (cf: CashFlowProjection, palette: ResolvedReportPalette) => string
> = {
  position: positionSection,
  projection: projectionSection,
  growth: growthSection,
  assumptions: assumptionsSection,
};

// ── The document ────────────────────────────────────────────────────────────

export interface RenderCashFlowInput {
  projection: CashFlowProjection;
  palette: ResolvedReportPalette;
  company: CompanyBlock;
  /** The running foot on every body page. The tenant's, never ours. */
  masthead: string;
  options?: Partial<ReportDesignOptions> | null;
  heroDataUri?: string | null;
  lockup?: BrandLockupProps | null;
  edition?: string | null;
  reference?: string | null;
  confidentiality?: string | null;
}

/** The body — cover, sections, closing — without the stylesheet. */
export function renderCashFlowBody(input: RenderCashFlowInput): string {
  const cf = input.projection;

  const cover = renderCover({
    eyebrow: DOCUMENT_NAME,
    // The property is the subject of this document, so it is the title. The
    // client's name goes in the meta beneath, where a report can be about a
    // property without being about only one person.
    title: cf.meta.propertyAddress || 'Cash Flow Analysis',
    masthead: input.company.name.lead + (input.company.name.tail ? ` ${input.company.name.tail}` : ''),
    edition: input.edition ?? null,
    meta: [
      { label: 'Prepared for', value: cf.meta.clientName },
      { label: 'Prepared on', value: formatPreparedOn(cf.meta.preparedOn) },
      { label: 'Projection term', value: formatMeasure({ value: cf.meta.termYears, unit: 'years' }) },
    ].filter((m) => m.value),
    lockup: input.lockup ?? null,
    heroDataUri: input.heroDataUri ?? null,
    footerLeft: input.confidentiality ?? 'Private and confidential',
    footerRight: input.reference ?? '',
  });

  const sections = cashFlowSections(cf).map((section, index) => {
    const body = SECTION_BODY[section.id]?.(cf, input.palette) ?? '';
    const number = String(index + 1).padStart(2, '0');
    return openChapter(DOCUMENT_NAME, number, section.title)
      + renderChapterHeader({
        number,
        title: section.title,
        dek: section.note,
        label: ARCHETYPE.chapterLabel,
      })
      + `<div class="chapter-body">${body}</div>`
      + closeChapter();
  }).join('');

  const closing = renderCompanyPage({
    block: input.company,
    lockup: input.lockup ?? null,
  });

  return cover + sections + closing;
}

/**
 * The whole document, ready to POST to the render service.
 *
 * Throws on a structurally invalid spine. There is no fallback renderer on this
 * path, so a document that is wrong is better as an error here — where the
 * message names the problem — than as a PDF a client opens.
 */
export function renderCashFlowDocument(input: RenderCashFlowInput): string {
  const problems = validateCashFlowSpine(input.projection);
  if (problems.length) {
    throw new Error(`${DOCUMENT_NAME} has an invalid structure:\n  ${problems.join('\n  ')}`);
  }

  return renderDocument({
    title: `${DOCUMENT_NAME} — ${input.projection.meta.propertyAddress}`,
    author: input.company.name.lead + (input.company.name.tail ? ` ${input.company.name.tail}` : ''),
    subject: DOCUMENT_NAME,
    css: buildReportCss({
      palette: input.palette,
      options: input.options ?? null,
      masthead: input.masthead,
    }),
    bodyHtml: renderCashFlowBody(input),
  });
}

// ── Driven from a brand snapshot ────────────────────────────────────────────

export interface RenderCashFlowFromBrandInput {
  projection: CashFlowProjection;
  /** The brand as it was at generation time — see `documentBrand.pure.ts`. */
  snapshot: ReportBrandSnapshot;
  disclaimer?: CompanyDisclaimer | null;
  /** The **tenant's** cover art, inlined. Never the house art. */
  coverArtDataUri?: string | null;
  options?: Partial<ReportDesignOptions> | null;
  edition?: string | null;
  reference?: string | null;
}

export interface CashFlowRenderResult {
  html: string;
  /** What the brand snapshot was missing. Reported, never thrown. */
  gaps: string[];
}

export function renderCashFlowFromBrand(input: RenderCashFlowFromBrandInput): CashFlowRenderResult {
  const brand = resolveSnapshotBrand({
    snapshot: input.snapshot,
    disclaimer: input.disclaimer ?? null,
    coverArtDataUri: input.coverArtDataUri ?? null,
  });

  return {
    html: renderCashFlowDocument({
      projection: input.projection,
      palette: brand.palette,
      company: brand.company,
      masthead: brand.masthead,
      lockup: brand.lockup,
      heroDataUri: brand.heroDataUri,
      confidentiality: brand.confidentiality,
      options: input.options ?? null,
      edition: input.edition ?? null,
      reference: input.reference ?? null,
    }),
    gaps: brand.gaps,
  };
}
