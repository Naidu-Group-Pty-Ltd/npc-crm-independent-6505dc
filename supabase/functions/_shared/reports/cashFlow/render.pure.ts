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
import {
  withDesignOptions,
  type ReportTemplateDesign,
} from '../../reportDesign/templateDesign.pure.ts';
import { audPerYear, formatAmount, formatMeasure, periodLabel } from '../../reportDesign/measure.pure.ts';
import { toSettlement } from './normalise.pure.ts';

import type { CashFlowProjection, ProjectionYear, SettlementBlock } from './payload.pure.ts';
import type { ExpenditureTable } from './expenditure.pure.ts';
import { formatCents, formatDollars } from './inputSummary.pure.ts';
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

  const costs = !cf.expenditure && a.costs.length
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

  // The Input Summary supersedes the purchase table where the caller sent it:
  // it carries every line the purchase table does and the twenty the purchase
  // table never printed. An older caller still gets the purchase table.
  const purchaseOrInputs = cf.inputs?.length
    ? inputSummaryTable(cf)
    : renderDataTable(
      [{ key: 'item', label: 'Term', align: 'left' }, { key: 'value', label: 'Value', align: 'right' }],
      purchase,
      { caption: 'The purchase' },
    );

  return renderLede(cf.narrative)
    + renderKpiStrip(kpis)
    + purchaseOrInputs
    + '<div class="cf-compact">'
    + costs
    + expenditureTables(cf)
    + subhead('Year one, line by line')
    + renderDataTable(
      [{ key: 'item', label: 'Line', align: 'left' }, { key: 'value', label: `Amount ${perYear}`, align: 'right' }],
      yearOne,
      { caption: 'Year one cash flow', signedKeys: ['value'] },
    )
    + '</div>'
    + renderSidenote(
      'Weekly, after tax',
      p(`${formatMeasure(y1.afterTaxWeekly)} is the year-one figure divided by 52. `
        + 'It is the number most investors budget against, and it moves every year — '
        + 'the projection overleaf shows how.'),
    );
}

/**
 * The Input Summary, two pairs to a line, as the legacy export lays it out.
 * Four columns with no header row: the caption names the table and every
 * label names its value.
 */
function inputSummaryTable(cf: CashFlowProjection): string {
  const rows: TableRow[] = (cf.inputs ?? []).map((line) => ({
    l1: line.left?.label ?? '',
    v1: line.left?.value ?? '',
    l2: line.right?.label ?? '',
    v2: line.right?.value ?? '',
  }));
  return `<div class="cf-inputs">${renderDataTable(
    [
      { key: 'l1', label: '', align: 'left' },
      { key: 'v1', label: '', align: 'right' },
      { key: 'l2', label: '', align: 'left' },
      { key: 'v2', label: '', align: 'right' },
    ],
    rows,
    { caption: 'Input summary' },
  )}</div>`;
}

function expenditureTable(caption: string, t: ExpenditureTable, totalLabel: string): string {
  if (!t.rows.length) return '';
  const rows: TableRow[] = [
    ...t.rows.map((r) => ({ item: r.label, value: formatDollars(r.amount) })),
    { item: totalLabel, value: formatDollars(t.total), __total: true },
  ];
  return renderDataTable(
    [{ key: 'item', label: 'Item', align: 'left' }, { key: 'value', label: 'Amount', align: 'right' }],
    rows,
    { caption },
  );
}

/**
 * "Total Upfront Costs" and "Total Overall Expenditure to Completion", as the
 * legacy export prints them — for a new build, the land and build deposits,
 * the build contract and the interest carried during construction.
 */
function expenditureTables(cf: CashFlowProjection): string {
  const e = cf.expenditure;
  if (!e) return '';
  return expenditureTable('Total upfront costs', e.upfront, 'Total upfront costs')
    + expenditureTable(
      'Total overall expenditure to completion',
      e.overall,
      'Total overall expenditure to completion',
    );
}

/**
 * The construction progress payment schedule of a new build.
 *
 * Every figure is `constructionSchedule.pure.ts`'s, computed on the server from
 * the inputs — the same module the on-screen analysis draws. Interest is shown
 * to the cent because the footer is the sum of the printed rows, and rounding
 * each row to a dollar would print a footer that does not add up.
 */
/** Past this many rows (the total included) the schedule is set compact. */
export const LONG_SCHEDULE_ROWS = 15;

function constructionSection(cf: CashFlowProjection): string {
  const s = cf.construction;
  if (!s) return '';
  const kpis: KpiCell[] = [
    { label: 'Land cost', value: formatDollars(s.landPrice) },
    { label: 'Build contract', value: formatDollars(s.buildPrice) },
    { label: 'Total project', value: formatDollars(s.totalProject) },
    {
      label: 'Interest during construction',
      value: formatDollars(s.totals.totalCombinedRepayment),
      foot: `${s.durationMonths} months at ${s.interestRate}% p.a.`,
    },
  ];
  const stagedPercent = s.stages.reduce((sum, r) => sum + r.percentage, 0);
  const rows: TableRow[] = [
    ...s.stages.map((r) => ({
      month: String(r.month),
      stage: r.stage,
      description: r.description,
      pct: r.percentage > 0 ? `${r.percentage}%` : '',
      pricing: r.buildAmount > 0 ? formatDollars(r.buildAmount) : '',
      land: formatCents(r.landInterest),
      build: r.buildInterest > 0 ? formatCents(r.buildInterest) : '',
      combined: formatCents(r.totalMonthlyInterest),
    })),
    {
      month: '',
      stage: 'Total',
      description: '',
      pct: `${Math.round(stagedPercent * 100) / 100}%`,
      pricing: formatDollars(s.totalProject),
      land: formatCents(s.totals.landInterest),
      build: formatCents(s.totals.buildInterest),
      combined: formatCents(s.totals.totalCombinedRepayment),
      __total: true,
    },
  ];
  // A long build — up to 24 months, and a row a month — does not fit under the
  // KPI strip on one landscape page, so the four figures become the legacy
  // export's one summary line and the rows tighten. Measured: at 25 rows the
  // strip pushed the table to a page of its own under every catalogue design.
  const long = rows.length > LONG_SCHEDULE_ROWS;
  const summary = long
    ? `<p class="cf-schedule-summary">${kpis.map((k) =>
      `<span><span class="cf-k">${escapeHtml(k.label)}</span> ${escapeHtml(String(k.value))}</span>`).join(' · ')}</p>`
    : renderKpiStrip(kpis);
  return summary
    + `<div class="cf-schedule${long ? ' cf-schedule-long' : ''}">${renderDataTable(
      [
        { key: 'month', label: 'Month', align: 'left' },
        { key: 'stage', label: 'Stage', align: 'left' },
        { key: 'description', label: 'Description', align: 'left' },
        { key: 'pct', label: '%', align: 'right' },
        { key: 'pricing', label: 'Stage pricing', align: 'right' },
        { key: 'land', label: 'Land interest', align: 'right' },
        { key: 'build', label: 'Build interest', align: 'right' },
        { key: 'combined', label: 'Monthly interest', align: 'right' },
      ],
      rows,
      { caption: `Construction progress payment schedule — ${s.durationMonths}-month build` },
    )}<p class="cf-footnote">${escapeHtml(
      `Interest is calculated at ${s.interestRate}% p.a. The land is financed in full from month 1, so its `
      + 'interest is constant; build interest grows as each stage is drawn. The deposit stage is paid from your '
      + 'own funds and attracts no interest. The land and build deposits and this interest are counted in the '
      + 'upfront costs.',
    )}</p></div>`;
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
/** The Today column: the settlement position, or the acquisition's where none was built. */
function settlementOf(cf: CashFlowProjection): SettlementBlock {
  return cf.settlement ?? toSettlement(null, cf.acquisition);
}

function projectionSection(cf: CashFlowProjection): string {
  const periods = cf.years.map((y) => `Yr ${y.year}`);
  const st = settlementOf(cf);
  const blank = cf.years.map(() => '');
  // The two summary lines, derived by the engine's definition wherever the
  // projection predates them.
  const deductions = (y: ProjectionYear) => y.totalDeductions
    ?? audPerYear(y.expenses.value + y.interest.value + y.depreciation.value + y.landTax.value);
  const profit = (y: ProjectionYear) => y.netProfitLoss
    ?? audPerYear(y.rentalIncome.value - deductions(y).value);
  type Line = { label: string; today: string; values: string[]; signed?: boolean; total?: boolean };
  type Band = { band: string };
  const line = (
    label: string,
    today: string,
    pick: (y: ProjectionYear) => string,
    opts: { signed?: boolean; total?: boolean } = {},
  ): Line => ({ label, today, values: cf.years.map(pick), ...opts });

  // The legacy table's rows, in its order and under its four headings, with a
  // Today column for the position at settlement. Units live in the cells
  // rather than in the labels, as everywhere else in this document.
  const rows: Array<Line | Band> = [
    line('Capital growth', '', (y) => formatMeasure(y.capitalGrowth)),
    line('CPI growth', '', (y) => formatMeasure(y.cpiGrowth)),
    line('Property value', formatMeasure(st.propertyValue), (y) => formatMeasure(y.propertyValue)),
    { label: 'Purchase price', today: formatMeasure(st.purchasePrice), values: blank },
    line('Loan amount', formatMeasure(st.loanBalance), (y) => formatMeasure(y.loanBalance)),
    { band: 'Statistics' },
    line('Equity', formatMeasure(st.equity), (y) => formatMeasure(y.equity), { total: true }),
    line('LVR', formatMeasure(st.lvr), (y) => formatMeasure(y.lvr)),
    line('Rental income', formatMeasure(st.weeklyRent), (y) => formatAmount(y.rentalIncome)),
    line('Gross yield', '', (y) => formatMeasure(y.grossYield)),
    line('Net yield', '', (y) => formatMeasure(y.netYield)),
    { band: 'Cash deductions' },
    line('Property expenses', '', (y) => formatAmount(y.expenses)),
    line('Land tax', '', (y) => formatAmount(y.landTax)),
    line('Interest rate', '', (y) => formatMeasure(y.interestRate)),
    line('Interest payments', '', (y) => formatAmount(y.interest)),
    line('Principal payments', '', (y) => formatAmount(y.principal)),
    line('Pre-tax cash flow p/a', '', (y) => formatAmount(y.preTaxAnnual), { signed: true }),
    line('Pre-tax cash flow p/w', '', (y) => formatAmount(y.preTaxWeekly), { signed: true }),
    { band: 'Non-cash deductions' },
    line('Depreciation', '', (y) => formatAmount(y.depreciation)),
    { band: 'Summary' },
    line('Total deductions', '', (y) => formatAmount(deductions(y))),
    line('Net profit / (loss)', '', (y) => formatAmount(profit(y)), { signed: true }),
    line('Tax refund / (payable)', '', (y) => formatAmount(y.taxEffect), { signed: true }),
    line('After-tax cash flow p/a', '', (y) => formatAmount(y.afterTaxAnnual), { signed: true, total: true }),
    line('After-tax cash flow p/w', '', (y) => formatAmount(y.afterTaxWeekly), { signed: true, total: true }),
  ];

  const span = periods.length + 2;
  const cell = (value: string, signed?: boolean) => {
    const neg = signed && /^-/.test(value) ? ' neg' : '';
    return `<td class="num${neg}">${escapeHtml(value)}</td>`;
  };
  // Two lines a heading — "Yr 1" over its calendar year — so eleven columns of
  // figures keep their width: on one line, "Y10 · 2036" in the tracked
  // heading face ran into its neighbours and off the page edge.
  const head = `<tr><th scope="col"><span class="sr-only">Line</span></th>`
    + `<th scope="col" class="num">Today</th>`
    + cf.years.map((y) => `<th scope="col" class="num">Yr ${y.year}`
      + (y.calendarYear ? `<span class="cf-cal">${y.calendarYear}</span>` : '') + '</th>').join('')
    + '</tr>';
  const body = rows.map((r) => {
    if ('band' in r) {
      return `<tr class="band"><th scope="colgroup" colspan="${span}">${escapeHtml(r.band)}</th></tr>`;
    }
    return `<tr${r.total ? ' class="total"' : ''}><th scope="row">${escapeHtml(r.label)}</th>`
      + cell(r.today)
      + r.values.map((v) => cell(v, r.signed)).join('')
      + '</tr>';
  }).join('');

  return '<div class="table-block cf-matrix-block"><table class="data cf-matrix">'
    + `<caption>${escapeHtml(
      `Years 1 to ${cf.meta.termYears} — dollars per year unless the line says per week; `
      + 'the weekly figures are the annual ones divided by 52',
    )}</caption>`
    + `<thead>${head}</thead><tbody>${body}</tbody></table></div>`;
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
  construction: constructionSection,
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
    // A wide section OPENS on its landscape page, header and table together.
    // Opened on the portrait page it used to print its header alone on a page
    // of its own, with the table overleaf — a blank sheet in front of the one
    // page this document exists to deliver.
    if (section.wide) {
      return openChapter(DOCUMENT_NAME, number, section.title, 'landscape-table')
          .replace('class="chapter page-landscape-table"', 'class="chapter page-landscape-table cf-wide"')
        + renderChapterHeader({ number, title: section.title, label: ARCHETYPE.chapterLabel })
        + `<div class="chapter-body">${body}</div>`
        + closeChapter();
    }
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
    }) + cashFlowCss(input.palette),
    bodyHtml: renderCashFlowBody(input),
  });
}

// ── This document's own rules ───────────────────────────────────────────────

/**
 * The one-page projection and the schedule, set at a compact row height.
 *
 * Twenty-eight lines — a header, twenty-three figures and four headings — go
 * on ONE landscape page. At the standard row height that is two pages, which
 * is why the table used to be split; the owner's rule is that the projection
 * is read on one page, so the matrix, not the page, gives way. The selectors
 * carry the `cf-` class as well as `table.data`, so a chosen template's design
 * (which rules and pads `table.data`) restyles the colours and the rules and
 * never the row height this page depends on. `pageFitsOnOne.py`-style
 * measurement is in `docs/reports/CASH_FLOW.md` §9.
 */
export function cashFlowCss(palette: ResolvedReportPalette): string {
  return `
  /* The deep top padding a chapter opener carries is for a portrait page read
     from the top; on the one landscape page it is the room the table needs. */
  .chapter.cf-wide { padding-top: 0; }
  .cf-wide .chapter-header { margin: 0 0 3mm; break-inside: avoid; break-after: avoid; }
  .cf-wide .chapter-header h1 { font-size: 16pt; line-height: 1.1; margin: 1mm 0 0; }
  .cf-wide .chapter-header .chapter-no { margin: 0; }
  table.data.cf-matrix { width: 100%; table-layout: fixed; font-size: 7.4pt; line-height: 1.12; }
  table.data.cf-matrix caption { font-size: 6.9pt; padding-bottom: 1.5mm; }
  table.data.cf-matrix thead th,
  table.data.cf-matrix tbody td,
  table.data.cf-matrix tbody th[scope="row"] {
    padding-top: 2.2pt; padding-bottom: 2.2pt; padding-left: 3pt; padding-right: 3pt;
    white-space: nowrap;
  }
  table.data.cf-matrix thead th {
    letter-spacing: 0.04em; font-size: 6.4pt; vertical-align: bottom; line-height: 1.15;
  }
  table.data.cf-matrix thead th .cf-cal { display: block; letter-spacing: 0.02em; font-size: 6pt; }
  table.data.cf-matrix thead th:first-child,
  table.data.cf-matrix tbody th[scope="row"] { width: 17%; text-align: left; }
  table.data.cf-matrix tbody tr.band th {
    padding-top: 2.6pt; padding-bottom: 1.4pt; padding-left: 3pt;
    font-size: 6.2pt; letter-spacing: 0.08em; text-transform: uppercase;
    color: ${palette.accentOnPaper}; background: ${palette.paperAlt}; text-align: left;
  }
  table.data.cf-matrix td.neg { color: ${palette.negative}; }
  .cf-matrix-block, table.data.cf-matrix { break-inside: avoid; }
  .cf-schedule table.data { font-size: 7.2pt; line-height: 1.15; }
  .cf-schedule table.data thead th,
  .cf-schedule table.data tbody td,
  .cf-schedule table.data tbody th[scope="row"] {
    padding-top: 2pt; padding-bottom: 2pt; padding-left: 3pt; padding-right: 3pt;
  }
  .cf-schedule, .cf-schedule table.data { break-inside: avoid; }
  .cf-footnote { font-size: 7.5pt; color: ${palette.mutedInk}; margin-top: 2mm; }
  .cf-schedule-long table.data { font-size: 6.6pt; line-height: 1.1; }
  .cf-schedule-long table.data thead th,
  .cf-schedule-long table.data tbody td,
  .cf-schedule-long table.data tbody th[scope="row"] { padding-top: 1.3pt; padding-bottom: 1.3pt; }
  .cf-schedule-summary { font-size: 8.5pt; margin: 0 0 3mm; }
  .cf-schedule-summary .cf-k { color: ${palette.mutedInk}; }
  .cf-inputs, .cf-inputs table.data { break-inside: avoid; }
  .cf-inputs table.data { font-size: 7.8pt; line-height: 1.15; }
  .cf-compact table.data { font-size: 8.4pt; }
  .cf-compact table.data thead th,
  .cf-compact table.data tbody td,
  .cf-compact table.data tbody th[scope="row"] { padding-top: 2.4pt; padding-bottom: 2.4pt; }
  .cf-compact .table-block { margin-bottom: 3.5mm; break-inside: avoid; }
  .cf-inputs table.data tbody td,
  .cf-inputs table.data tbody th[scope="row"] { padding-top: 1.6pt; padding-bottom: 1.6pt; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`;
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
  /**
   * A chosen template's design (`templateDesign.pure.ts`). Its palette, faces
   * and page treatment replace the brand's palette; every word on every page is
   * still this composer's. Absent, and the document is the standard one byte
   * for byte.
   */
  design?: ReportTemplateDesign | null;
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
      palette: input.design?.palette ?? brand.palette,
      company: brand.company,
      masthead: brand.masthead,
      lockup: brand.lockup,
      heroDataUri: brand.heroDataUri,
      confidentiality: brand.confidentiality,
      options: withDesignOptions(input.options, input.design),
      edition: input.edition ?? null,
      reference: input.reference ?? null,
    }),
    gaps: brand.gaps,
  };
}
