/**
 * The review as HTML, through the design system.
 *
 * The generator this replaces draws the document at hard-coded offsets in
 * pdf-lib, and the consequences are the findings in `PORTFOLIO.md`: a contents
 * page whose numbers are a hand-incremented guess, an inventory table that
 * resumes at a fixed row index and silently prints nothing for the properties
 * in between, a four-box health panel that truncates a sentence to twelve
 * characters and then colours the box by the part it cut off, and a cover that
 * is a raster of *our* letterhead on every white-label tenant's report.
 *
 * None of those are bugs to fix one at a time. They are what happens when a
 * document is drawn instead of laid out. Here nothing is positioned, nothing is
 * counted by hand, and no colour is named — the palette is resolved from the
 * tenant's brand snapshot and contrast-checked as a whole.
 *
 * The legacy generator stays exactly where it is. This is a second path.
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
  renderContentsPage,
  renderCover,
  renderDataTable,
  renderDocument,
  renderKpiStrip,
  renderLede,
  renderSidenote,
  type CalloutTone,
  type KpiCell,
  type TableColumn,
  type TableRow,
  type ValueTone,
} from '../../reportDesign/primitives.pure.ts';
import { buildReportCss } from '../../reportDesign/css.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import type { ReportDesignOptions } from '../../reportDesign/options.pure.ts';
import type { CompanyBlock, CompanyDisclaimer } from '../../reportDesign/companyBlock.pure.ts';
import { contentsEntriesFor, REPORT_ARCHETYPES } from '../../reportDesign/structure.pure.ts';
import type { ReportBrandSnapshot } from '../../reportDesign/snapshot.pure.ts';
import { resolveSnapshotBrand } from '../../reportDesign/documentBrand.pure.ts';
import { formatAmount, formatMeasure, periodLabel } from '../../reportDesign/measure.pure.ts';

import type {
  ActionRow,
  HealthBand,
  HoldingRow,
  HoldingVerdict,
  NarrativeBlock,
  PortfolioReview,
} from './payload.pure.ts';
import { DETAIL_CAP, portfolioSections, portfolioSpine, validatePortfolioSpine } from './sections.pure.ts';
import { capacityHeadroomChart, compositionChart, yieldAgainstLeverageChart } from './charts.pure.ts';
import { formatReportDate } from '../reportDate.pure.ts';

const ARCHETYPE = REPORT_ARCHETYPES['portfolio-performance'];

/** What the product calls this format, on the cover and in the filename. */
export const DOCUMENT_NAME = ARCHETYPE.documentName;

/**
 * A figure the record does not hold — the same mark `formatMeasure` emits.
 *
 * Named because two places compare against it: the cells that print it, and the
 * holdings matrix, which drops a line whose every cell would be this.
 */
const EMPTY = '—';

/**
 * How each health band reads, and how much confidence its colour may carry.
 *
 * The band is derived from free text and the *words* on the page are the
 * source's own. Colour is a second channel, never the only one — a document
 * that says "fair" only by being amber says nothing to a monochrome printer.
 */
const BAND: Record<HealthBand, { tone: ValueTone; callout: CalloutTone }> = {
  strong: { tone: 'positive', callout: 'positive' },
  moderate: { tone: 'neutral', callout: 'caution' },
  watch: { tone: 'negative', callout: 'negative' },
  unrated: { tone: 'neutral', callout: 'neutral' },
};

// ── Dates ───────────────────────────────────────────────────────────────────


/**
 * `2026-03-16T…` → `16 March 2026`.
 *
 * Parsed rather than handed to `Date`: this module is pure, and
 * `toLocaleDateString` depends on the runtime's ICU build, so the same payload
 * would date itself differently in Deno and in Node.
 */
export { formatReportDate };

// ── Small helpers ───────────────────────────────────────────────────────────

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

/** A narrative block — prose, then its facts as a table, then its bullets. */
/**
 * Longest a labelled value may be and still belong in a table cell.
 *
 * Above this it is a paragraph with a heading, not a row: a 500-character
 * assessment in a narrow second column wraps to six lines, and a table of
 * three such rows is prose that has been made harder to read by being put in
 * a grid. Set from the real fields — the shortest of these values runs about
 * 250 characters and the longest about 600, so the line sits below all of
 * them and above the genuinely short ones (`"Medium"`, `"Moderate — QLD"`).
 */
const FACT_CELL_LIMIT = 150;

function renderNarrative(b: NarrativeBlock | null): string {
  if (!b) return '';
  const prose = b.paragraphs.map(p).join('');

  const short = b.facts.filter((f) => f.value.length <= FACT_CELL_LIMIT);
  const long = b.facts.filter((f) => f.value.length > FACT_CELL_LIMIT);

  const table = short.length
    ? renderDataTable(
      [{ key: 'item', label: b.title, align: 'left' }, { key: 'value', label: 'Assessment', align: 'left' }],
      short.map((f) => ({ item: f.label, value: f.value })),
    )
    : '';
  const expanded = long.map((f) => subhead(f.label) + p(f.value)).join('');

  // Each group under its own heading. Concatenated, a risk section prints its
  // risks and the answers to them as one undifferentiated list, and a growth
  // section runs four different questions together.
  const bullets = b.bullets.map((g) => subhead(g.label) + renderList(g.items)).join('');

  return prose + table + expanded + bullets;
}

// ── Sections ────────────────────────────────────────────────────────────────

function standingSection(cf: PortfolioReview): string {
  const t = cf.totals;
  const band = BAND[cf.headline.band];

  const kpis: KpiCell[] = [
    {
      label: 'Portfolio value',
      value: formatMeasure(t.value),
      foot: `${formatMeasure(t.equity)} equity`,
    },
    {
      label: 'Net cash flow',
      value: formatMeasure(t.netMonthlyCashflow),
      tone: t.netMonthlyCashflow.value >= 0 ? 'positive' : 'negative',
      foot: `${formatMeasure(t.averageYield)} average yield`,
    },
    {
      label: 'Overall health',
      value: cf.headline.bandLabel,
      tone: band.tone,
      foot: cf.headline.healthScore.unit === 'none'
        ? `${formatMeasure(t.averageLvr)} average LVR`
        : `${formatMeasure(cf.headline.healthScore)} / 100`,
    },
  ];

  const position: TableRow[] = [
    { item: 'Properties held', value: formatMeasure(t.propertyCount) },
    { item: 'Investment properties', value: formatMeasure(t.investmentCount) },
    { item: 'Owner-occupied', value: formatMeasure(t.ownerOccupiedCount) },
    { item: 'Total value', value: formatMeasure(t.value) },
    { item: 'Total debt', value: formatMeasure(t.debt) },
    { item: 'Total equity', value: formatMeasure(t.equity), __total: true },
    { item: 'Average LVR', value: formatMeasure(t.averageLvr) },
    { item: 'Rental income', value: formatMeasure(t.monthlyRentalIncome) },
    { item: 'Property expenses', value: formatMeasure(t.monthlyExpenses) },
    { item: 'Net cash flow', value: formatMeasure(t.netMonthlyCashflow), __total: true },
  ];

  const strengths = cf.headline.strengths.length
    ? renderCallout('positive', 'What is working', renderList(cf.headline.strengths))
    : '';
  const concerns = cf.headline.concerns.length
    ? renderCallout('caution', 'What needs attention', renderList(cf.headline.concerns))
    : '';
  const recommendation = cf.headline.primaryRecommendation
    ? renderCallout(band.callout, 'Where to start', p(cf.headline.primaryRecommendation))
    : '';

  return renderLede(cf.narrative)
    + renderKpiStrip(kpis)
    + renderDataTable(
      [{ key: 'item', label: 'The portfolio', align: 'left' }, { key: 'value', label: 'Position', align: 'right' }],
      position,
      { caption: 'Where the portfolio stands today', signedKeys: ['value'] },
    )
    + recommendation
    + strengths
    + concerns;
}

function compositionSection(cf: PortfolioReview, palette: ResolvedReportPalette): string {
  return compositionChart(cf, palette) + renderNarrative(cf.composition);
}

/**
 * The inventory — the artefact this document has to get right.
 *
 * Rows are lines and columns are properties, on the landscape page, because the
 * alternative is what the legacy does: twenty figures per property in portrait
 * measure, split across a table and a second set of cards four hundred lines
 * apart, with the table dropping every row past a hardcoded index.
 *
 * `renderBandedMatrix` opens the landscape page and the shared stylesheet
 * repeats table heads across breaks, so a portfolio larger than one page spans
 * pages rather than losing rows off the bottom of one.
 */
function holdingsSection(cf: PortfolioReview): string {
  const columns = cf.holdings.map((h) => `${h.number}`);

  /**
   * A row the record has no figure for anywhere is dropped, not printed as a
   * row of em dashes.
   *
   * Both are honest; only one is useful. `interestRate` and `lenderName` are
   * present on 9 of the 66 stored property records, so on most portfolios these
   * lines would be a solid rank of dashes running the width of a landscape
   * page — which reads as a rendering fault rather than as absent data. A dash
   * still means "not held" wherever *some* property has the figure and this one
   * does not, which is the case the caption explains.
   */
  const line = (label: string, pick: (h: HoldingRow) => string, total = false) => {
    const values = cf.holdings.map(pick);
    return values.every((v) => v === EMPTY) ? null : { label, values, total };
  };

  const anyLender = cf.holdings.some((h) => h.lender);
  const key = renderDataTable(
    [
      { key: 'n', label: '#', align: 'left' },
      { key: 'address', label: 'Property', align: 'left' },
      { key: 'type', label: 'Type', align: 'left' },
      ...(anyLender ? [{ key: 'lender', label: 'Lender', align: 'left' as const }] : []),
    ],
    cf.holdings.map((h) => ({
      n: String(h.number),
      address: h.address,
      type: h.isOwnerOccupied ? 'Owner-occupied' : (h.propertyType || 'Investment'),
      ...(anyLender ? { lender: h.lender || EMPTY } : {}),
    })),
    { caption: 'The holdings, numbered as they appear overleaf' },
  );

  const matrix = renderBandedMatrix(
    'Line',
    columns,
    [
      line('Value', (h) => formatMeasure(h.value)),
      line('Loan', (h) => formatMeasure(h.loan)),
      line('Equity', (h) => formatMeasure(h.equity), true),
      line('LVR', (h) => formatMeasure(h.lvr)),
      line('Ownership', (h) => formatMeasure(h.ownershipShare)),
      line('Interest rate', (h) => formatMeasure(h.interestRate)),
      line('Rental income', (h) => formatAmount(h.monthlyRentalIncome)),
      line('Expenses', (h) => formatAmount(h.monthlyExpenses)),
      line('Net cash flow', (h) => formatAmount(h.netMonthlyCashflow), true),
      line('Annual cash flow', (h) => formatAmount(h.annualCashflow)),
      line('Gross yield', (h) => formatMeasure(h.grossYield)),
      line('Cash on cash', (h) => formatMeasure(h.cashOnCashReturn)),
      line('Share of portfolio', (h) => formatMeasure(h.portfolioContribution)),
    ].filter((r): r is { label: string; values: string[]; total: boolean } => r !== null),
    {
      caption: `Every property, every figure the record holds — ${periodLabel('aud/month')} `
        + 'unless the row says otherwise. An em dash is a figure the record does not hold, '
        + 'which is not the same as nil.',
    },
  );

  return key + matrix;
}

function performanceSection(cf: PortfolioReview, palette: ResolvedReportPalette): string {
  // The analysis rates and the review scores, and the two do not always agree —
  // a real row has the analysis calling a property "Good" while the review
  // classes the same property an "Underperformer". Both columns are shown, with
  // headings that name their source, so a disagreement is visible rather than
  // resolved by whichever happened to be read last.
  const anyReview = cf.verdicts.some((v) => v.review?.classification);
  const cols: TableColumn[] = [
    { key: 'rank', label: '#', align: 'left' },
    { key: 'address', label: 'Property', align: 'left' },
    { key: 'rating', label: 'Analysis', align: 'left' },
    ...(anyReview ? [{ key: 'classification', label: 'Review', align: 'left' as const }] : []),
    { key: 'score', label: 'Score', align: 'right' },
  ];
  const rows: TableRow[] = cf.verdicts.map((v: HoldingVerdict) => ({
    rank: v.rank === null ? EMPTY : String(v.rank),
    address: v.address,
    rating: v.rating || EMPTY,
    ...(anyReview ? { classification: v.review?.classification || EMPTY } : {}),
    score: v.score.unit === 'none' ? EMPTY : `${formatMeasure(v.score)} / 100`,
  }));

  const reviewedOn = cf.review ? formatReportDate(cf.review.reviewedOn) : '';
  const reviewLabel = reviewedOn ? `Review, ${reviewedOn}` : 'Review';

  // Detail as prose, not as a fifth and sixth column: "Very high LVR (95.2%)
  // limiting equity access" is a sentence, and a sentence in a table cell wraps
  // to four lines and pushes every row out of alignment.
  //
  // Capped, and the cap is stated on the page when it bites. The legacy's
  // equivalent stops at a hardcoded index and says nothing, which is finding F4;
  // a cap a reader can see is a different thing from a cap they cannot.
  const detailed = cf.verdicts.slice(0, DETAIL_CAP);
  const omitted = cf.verdicts.length - detailed.length;
  const detail = detailed
    .filter((v) => v.strengths.length || v.concerns.length || v.recommendation
      || v.strategicRole || v.review)
    .map((v) => subhead(v.address)
      + (v.strategicRole ? p(v.strategicRole) : '')
      + (v.strengths.length ? renderSidenote('Working', renderList(v.strengths)) : '')
      + (v.concerns.length ? renderSidenote('Watch', renderList(v.concerns)) : '')
      + (v.recommendation ? p(v.recommendation) : '')
      + (v.outlook ? p(v.outlook) : '')
      + reviewVerdict(v, reviewLabel))
    .join('');

  const capNote = omitted
    ? renderCallout(
      'neutral',
      'Commentary is abridged',
      `<p>${DETAIL_CAP} of ${cf.verdicts.length} properties carry written commentary below, `
      + 'in ranked order. Every property is in the table above and in the holdings '
      + 'matrix — none has been left out of the figures.</p>',
    )
    : '';

  return yieldAgainstLeverageChart(cf, palette)
    + renderDataTable(cols, rows, { caption: 'How each property ranks' })
    + capNote
    + detail;
}

/**
 * The review's own verdict on one property, attributed and dated.
 *
 * Its bullets are rubric fragments — "High leverage", "Negative cash flow" —
 * written by a different pass over different inputs from the analysis's
 * sentences above them. Printed under one heading they contradict; printed
 * under this one they are a second opinion with a date on it.
 */
function reviewVerdict(v: HoldingVerdict, label: string): string {
  const r = v.review;
  if (!r) return '';
  const parts = [
    r.classification ? `Classed <strong>${escapeHtml(r.classification)}</strong>` : '',
    r.strengths.length ? `Working: ${r.strengths.map(escapeHtml).join('; ')}` : '',
    r.concerns.length ? `Watch: ${r.concerns.map(escapeHtml).join('; ')}` : '',
  ].filter(Boolean);
  if (!parts.length) return '';
  return renderSidenote(label, `<p>${parts.join('. ')}.</p>`);
}

function healthSection(cf: PortfolioReview): string {
  return renderNarrative(cf.financialHealth) + renderNarrative(cf.risk);
}

function capacitySection(cf: PortfolioReview, palette: ResolvedReportPalette): string {
  const c = cf.capacity;
  if (!c) return '';

  const kpis: KpiCell[] = [
    { label: 'Assessed capacity', value: formatMeasure(c.estimatedCapacity) },
    { label: 'Debt deployed', value: formatMeasure(c.totalDebtDeployed) },
    {
      label: 'Available',
      value: formatMeasure(c.availableCapacity),
      tone: c.availableCapacity.value > 0 ? 'positive' : 'negative',
      foot: c.utilisation.unit === 'none' ? undefined : `${formatMeasure(c.utilisation)} utilised`,
    },
  ];

  // Deliberately not the full assessment. The Borrowing Capacity Snapshot has
  // its own archetype, its own route and its own tests; reproducing five of its
  // pages here would ship one subject twice at two standards of care.
  const pointer = renderCallout(
    'informative',
    'The working behind these figures',
    p('This section states the portfolio\'s position against the assessed capacity. '
      + 'The assessment itself — income, shading, liabilities and the policy applied — '
      + 'is the Borrowing Capacity Snapshot, which is produced separately.'),
  );

  return renderKpiStrip(kpis)
    + capacityHeadroomChart(cf, palette)
    + (c.commentary ? p(c.commentary) : '')
    + pointer;
}

function outlookSection(cf: PortfolioReview): string {
  const market = renderNarrative(cf.market);
  const pr = cf.projection;
  if (!pr) return market;

  const rows: TableRow[] = [
    { item: 'Portfolio value', value: formatMeasure(pr.projectedValue) },
    { item: 'Equity', value: formatMeasure(pr.projectedEquity), __total: true },
    { item: 'Net cash flow', value: formatMeasure(pr.projectedMonthlyCashflow) },
  ];

  return market
    + subhead(`If the assumptions hold — ${formatMeasure(pr.years)}`)
    + (pr.summary ? p(pr.summary) : '')
    + renderDataTable(
      [{ key: 'item', label: 'Projected', align: 'left' }, { key: 'value', label: 'Amount', align: 'right' }],
      rows,
      { caption: `Projected position at ${formatMeasure(pr.years)}`, signedKeys: ['value'] },
    )
    + (pr.assumptions.length
      ? renderCallout('caution', 'What this assumes', renderList(pr.assumptions))
      : '')
    + renderCallout(
      'caution',
      'These are projections',
      p('Every figure above is the result of applying assumed growth to today\'s position. '
        + 'Actual values, rents and rates will differ. This is not financial advice.'),
    );
}

function planSection(cf: PortfolioReview): string {
  const growth = renderNarrative(cf.growth);
  if (!cf.actions.length) return growth;

  // The source column appears only when both assessments contributed. On a
  // report with no review every row would say "Analysis", which is a column of
  // one repeated word.
  const mixed = cf.actions.some((a) => a.source === 'review')
    && cf.actions.some((a) => a.source === 'analysis');
  const cols: TableColumn[] = [
    { key: 'priority', label: 'When', align: 'left' },
    { key: 'action', label: 'Action', align: 'left' },
    ...(mixed ? [{ key: 'source', label: 'From', align: 'left' as const }] : []),
  ];
  const rows: TableRow[] = cf.actions.map((a: ActionRow) => ({
    priority: a.priorityLabel,
    action: a.title,
    ...(mixed ? { source: a.source === 'review' ? 'Review' : 'Analysis' } : {}),
  }));

  // Actions that carry more than a line get it, beneath the table rather than
  // inside it.
  const detail = cf.actions
    .filter((a) => a.detail || a.steps.length)
    .map((a) => subhead(a.title) + p(a.detail) + renderList(a.steps))
    .join('');

  return growth
    + renderDataTable(cols, rows, { caption: 'What to do, in order' })
    + detail;
}

function reviewSection(cf: PortfolioReview): string {
  const r = cf.review;
  if (!r) return '';

  const kpis: KpiCell[] = r.scores.slice(0, 4).map((s) => ({
    label: s.label,
    value: `${formatMeasure(s.score)} / 100`,
  }));

  const meta: TableRow[] = [
    { item: 'Reviewed', value: formatReportDate(r.reviewedOn) || '—' },
    { item: 'Status', value: r.status || '—' },
    { item: 'Risk level', value: r.riskLevel || '—' },
    { item: 'Next review due', value: r.nextReviewDue ? formatReportDate(r.nextReviewDue) : '—' },
  ];

  // Why this section's figures do not match the rest of the document.
  //
  // The review is a separate pass over the client's properties on its own date,
  // and it reads the live client record rather than this report's stored
  // `portfolioMetrics`. On a real pair three days apart the review says the
  // portfolio is worth $1,505,000 and returns $1,821 a month while everything
  // earlier in the document says $1,400,000 and $7,569. Both are what was
  // recorded; printed together with nothing between them the document appears
  // to contradict itself on its headline number, which is worse than either
  // figure being wrong, because a reader cannot tell which to trust.
  const reviewed = formatReportDate(r.reviewedOn);
  const analysed = formatReportDate(cf.meta.analysedOn);
  const provenance = reviewed && analysed && reviewed !== analysed
    ? renderCallout(
      'neutral',
      'Two dates, two sets of figures',
      `<p>The scores and findings in this section are the review’s own, taken on `
      + `${escapeHtml(reviewed)}. Every figure earlier in this document comes from the `
      + `portfolio analysis of ${escapeHtml(analysed)}. Where the two differ, neither is `
      + 'wrong — they were taken at different times, from the client record as it stood '
      + 'on each date.</p>',
    )
    : '';

  return (kpis.length ? renderKpiStrip(kpis) : '')
    + provenance
    + (r.summary ? p(r.summary) : '')
    + (r.findings.length ? renderCallout('neutral', 'What the review found', renderList(r.findings)) : '')
    + renderDataTable(
      [{ key: 'item', label: 'This review', align: 'left' }, { key: 'value', label: '', align: 'right' }],
      meta,
    )
    + (cf.scenarios.length
      ? renderDataTable(
        [
          { key: 'name', label: 'Scenario', align: 'left' },
          { key: 'change', label: 'Change', align: 'right' },
          { key: 'after', label: 'Net after', align: 'right' },
        ],
        cf.scenarios.map((s) => ({
          name: s.name,
          change: formatMeasure(s.cashFlowChange),
          after: formatMeasure(s.newNetCashflow),
        })),
        { caption: 'Scenarios modelled during the review', signedKeys: ['change', 'after'] },
      )
      : '');
}

const SECTION_BODY: Record<
  string,
  (cf: PortfolioReview, palette: ResolvedReportPalette) => string
> = {
  standing: standingSection,
  composition: compositionSection,
  holdings: holdingsSection,
  performance: performanceSection,
  health: healthSection,
  capacity: capacitySection,
  outlook: outlookSection,
  plan: planSection,
  review: reviewSection,
};

// ── The document ────────────────────────────────────────────────────────────

export interface RenderPortfolioInput {
  review: PortfolioReview;
  palette: ResolvedReportPalette;
  company: CompanyBlock;
  /** The running foot on every body page. The tenant's, never ours. */
  masthead: string;
  options?: Partial<ReportDesignOptions> | null;
  heroDataUri?: string | null;
  lockup?: BrandLockupProps | null;
  edition?: string | null;
  confidentiality?: string | null;
}

/** The body — cover, contents, sections, closing — without the stylesheet. */
export function renderPortfolioBody(input: RenderPortfolioInput): string {
  const cf = input.review;

  const cover = renderCover({
    eyebrow: DOCUMENT_NAME,
    // The client is the subject of a portfolio review, so the client is the
    // title. The legacy overlays this on a raster of our own letterhead.
    title: cf.meta.clientName,
    masthead: input.company.name.lead + (input.company.name.tail ? ` ${input.company.name.tail}` : ''),
    edition: input.edition ?? null,
    meta: [
      { label: 'Properties', value: formatMeasure(cf.totals.propertyCount) },
      { label: 'Portfolio value', value: formatMeasure(cf.totals.value) },
      { label: 'Analysed', value: formatReportDate(cf.meta.analysedOn) },
    ].filter((m) => m.value),
    lockup: input.lockup ?? null,
    heroDataUri: input.heroDataUri ?? null,
    footerLeft: input.confidentiality ?? 'Private and confidential',
    footerRight: cf.meta.reference,
  });

  const sections = portfolioSections(cf);

  // Derived from the spine, not counted by hand. This is the whole answer to
  // the legacy's contents page: it cannot list a section that was not built,
  // put them in an order they are not printed in, or claim a page number,
  // because it carries no page numbers at all — the reader follows the running
  // head, and `@page` counters number the pages.
  const contents = renderContentsPage(
    'Contents',
    contentsEntriesFor(portfolioSpine(cf)).map((e) => ({
      number: e.number,
      title: e.title,
      note: e.note,
    })),
  );

  const body = sections.map((section, index) => {
    const inner = SECTION_BODY[section.id]?.(cf, input.palette) ?? '';
    const number = String(index + 1).padStart(2, '0');
    return openChapter(DOCUMENT_NAME, number, section.title)
      + renderChapterHeader({
        number,
        title: section.title,
        dek: section.note,
        label: ARCHETYPE.chapterLabel,
      })
      + `<div class="chapter-body">${inner}</div>`
      + closeChapter();
  }).join('');

  const notes = cf.notes.length
    ? openChapter(DOCUMENT_NAME, '', 'Notes')
      + `<div class="chapter-body">${renderCallout('neutral', 'Worth knowing', renderList(cf.notes))}</div>`
      + closeChapter()
    : '';

  const closing = renderCompanyPage({
    block: input.company,
    lockup: input.lockup ?? null,
  });

  return cover + contents + body + notes + closing;
}

/**
 * The whole document, ready to POST to the render service.
 *
 * Throws on a structurally invalid spine. There is no fallback renderer on this
 * path, so a document that is wrong is better as an error here — where the
 * message names the problem — than as a PDF a client opens.
 */
export function renderPortfolioDocument(input: RenderPortfolioInput): string {
  const problems = validatePortfolioSpine(input.review);
  if (problems.length) {
    throw new Error(`${DOCUMENT_NAME} has an invalid structure:\n  ${problems.join('\n  ')}`);
  }

  return renderDocument({
    title: `${DOCUMENT_NAME} — ${input.review.meta.clientName}`,
    author: input.company.name.lead + (input.company.name.tail ? ` ${input.company.name.tail}` : ''),
    subject: DOCUMENT_NAME,
    css: buildReportCss({
      palette: input.palette,
      options: input.options ?? null,
      masthead: input.masthead,
    }),
    bodyHtml: renderPortfolioBody(input),
  });
}

// ── Driven from a brand snapshot ────────────────────────────────────────────

export interface RenderPortfolioFromBrandInput {
  review: PortfolioReview;
  /** The brand as it was at generation time — see `documentBrand.pure.ts`. */
  snapshot: ReportBrandSnapshot;
  disclaimer?: CompanyDisclaimer | null;
  /** The **tenant's** cover art, inlined. Never the house art. */
  coverArtDataUri?: string | null;
  options?: Partial<ReportDesignOptions> | null;
  edition?: string | null;
}

export interface PortfolioRenderResult {
  html: string;
  /** What the brand snapshot was missing. Reported, never thrown. */
  gaps: string[];
}

export function renderPortfolioFromBrand(
  input: RenderPortfolioFromBrandInput,
): PortfolioRenderResult {
  const brand = resolveSnapshotBrand({
    snapshot: input.snapshot,
    disclaimer: input.disclaimer ?? null,
    coverArtDataUri: input.coverArtDataUri ?? null,
  });

  return {
    html: renderPortfolioDocument({
      review: input.review,
      palette: brand.palette,
      company: brand.company,
      masthead: brand.masthead,
      lockup: brand.lockup,
      heroDataUri: brand.heroDataUri,
      confidentiality: brand.confidentiality,
      options: input.options ?? null,
      edition: input.edition ?? null,
    }),
    gaps: brand.gaps,
  };
}
