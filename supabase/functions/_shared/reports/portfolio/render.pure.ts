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
  SECTION_SUBHEAD_CLASS,
  type CalloutTone,
  type DataTableOptions,
  type KpiCell,
  type TableColumn,
  type TableRow,
  type ValueTone,
} from '../../reportDesign/primitives.pure.ts';
import { buildReportCss } from '../../reportDesign/css.pure.ts';
import { keptTable } from '../../reportDesign/tableKeeping.pure.ts';
import { portraitMatrixCss, renderPortraitMatrix } from '../../reportDesign/portraitMatrix.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import type { ReportDesignOptions } from '../../reportDesign/options.pure.ts';
import type { CompanyBlock, CompanyDisclaimer } from '../../reportDesign/companyBlock.pure.ts';
import { contentsEntriesFor, REPORT_ARCHETYPES } from '../../reportDesign/structure.pure.ts';
import type { ReportBrandSnapshot } from '../../reportDesign/snapshot.pure.ts';
import { resolveSnapshotBrand } from '../../reportDesign/documentBrand.pure.ts';
import {
  withDesignOptions,
  type ReportTemplateDesign,
} from '../../reportDesign/templateDesign.pure.ts';
import { audPerMonth, formatAmount, formatMeasure, type Measure } from '../../reportDesign/measure.pure.ts';

import type {
  ActionRow,
  HealthBand,
  HoldingRow,
  HoldingVerdict,
  LabelledText,
  NarrativeBlock,
  PortfolioNote,
  PortfolioReview,
  RateSensitivityClass,
  RateSensitivityGap,
} from './payload.pure.ts';
import {
  DETAIL_CAP,
  PORTRAIT_MATRIX_MAX,
  portfolioSections,
  portfolioSpine,
  validatePortfolioSpine,
} from './sections.pure.ts';
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
 * Prose that may run to several paragraphs, split where its writer left a
 * blank line.
 *
 * The analysis is asked for the market cycle and the rate outlook as "2-3
 * paragraph" analyses, and they arrive as one string with blank lines in it —
 * which HTML folds into a single space, so three paragraphs printed as one
 * block of 2,000 characters. A single line break inside a paragraph is a
 * wrap, not a break, and is read as a space.
 */
function paras(t: string): string {
  if (!t) return '';
  return t.split(/\n\s*\n/)
    .map((x) => x.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((x) => `<p>${escapeHtml(x)}</p>`)
    .join('');
}

/**
 * A paragraph that opens on its label — "Recommendation: Hold. …".
 *
 * A property's commentary was four unlabelled paragraphs in a row — its role,
 * the recommendation, the outlook — so nothing said which sentence was the
 * advice. A run-in label says it without a heading per paragraph.
 */
function runIn(label: string, t: string): string {
  if (!t) return '';
  const [first, ...rest] = t.split(/\n\s*\n/).map((x) => x.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  if (!first) return '';
  return `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(first)}</p>`
    + rest.map((x) => `<p>${escapeHtml(x)}</p>`).join('');
}

/**
 * A subhead inside a section.
 *
 * `h2`, not `h3`. Six of these formats grew their own `const h3` helper for
 * "a subhead" while the design system's actual subhead went unused in every
 * one of them. A section title is an `h1`, so an `h3` under it skips a level,
 * and PDF/UA 7.4.2 fails on exactly that: "heading level 2 is skipped in a
 * descending sequence". Seven of the ten documents failed that rule and no
 * other.
 *
 * Set one modular step below the section title (`SECTION_SUBHEAD_CLASS`): the
 * sections are memo sections now (see `renderPortfolioBody`), whose titles sit
 * one step above h3, and an h2 at the subhead size read as a rival title —
 * nine property addresses and "What could go wrong" set within a point of the
 * section they belong to.
 */
const subhead = (text: string) => `<h2 class="${SECTION_SUBHEAD_CLASS}">${escapeHtml(text)}</h2>`;

function renderList(items: readonly string[]): string {
  if (!items.length) return '';
  return `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

/**
 * A data table, kept whole when it is short and never left with one row
 * stranded when it is not (`tableKeeping.pure.ts` — the Intelligence Hub's
 * rule, one implementation). The review's four-line table split two and two
 * across a page on every design, and a one-row table sat alone at the head of
 * one.
 */
function table(cols: TableColumn[], rows: TableRow[], opts?: DataTableOptions): string {
  return keptTable(renderDataTable(cols, rows, opts), { cols, rows }, TABLE_KEEP);
}

/**
 * This document's tables are sized by their content — a two-character rank
 * beside a forty-character address — so their height is estimated that way,
 * and a long one leaves at least three rows under its head at the foot of a
 * page rather than two (`tableKeeping.pure.ts`).
 */
const TABLE_KEEP = { widths: 'content', leadRows: 2 } as const;

/** The notes whose subject is this section, as one callout. */
function notesFor(cf: PortfolioReview, section: PortfolioNote['section']): string {
  const here = cf.notes.filter((n) => n.section === section).map((n) => n.text);
  return here.length ? renderCallout('neutral', 'Worth knowing', renderList(here)) : '';
}

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

/** A narrative block in its four parts, for a section that sets them in its own order. */
interface NarrativeParts {
  prose: string;
  short: LabelledText[];
  long: string;
  bullets: string;
}

function narrativeParts(b: NarrativeBlock | null): NarrativeParts {
  if (!b) return { prose: '', short: [], long: '', bullets: '' };
  return {
    prose: b.paragraphs.map(paras).join(''),
    short: b.facts.filter((f) => f.value.length <= FACT_CELL_LIMIT),
    long: b.facts.filter((f) => f.value.length > FACT_CELL_LIMIT)
      .map((f) => subhead(f.label) + paras(f.value)).join(''),
    // Each group under its own heading. Concatenated, a risk section prints its
    // risks and the answers to them as one undifferentiated list, and a growth
    // section runs four different questions together.
    bullets: b.bullets.map((g) => subhead(g.label) + renderList(g.items)).join(''),
  };
}

/** Labelled values short enough to be rows, as a two-column table. */
function factsTable(label: string, facts: readonly LabelledText[]): string {
  if (!facts.length) return '';
  return table(
    [{ key: 'item', label, align: 'left' }, { key: 'value', label: 'Assessment', align: 'left' }],
    facts.map((f) => ({ item: f.label, value: f.value })),
  );
}

/** A narrative block — prose, then its facts as a table, then its bullets. */
function renderNarrative(b: NarrativeBlock | null): string {
  if (!b) return '';
  const parts = narrativeParts(b);
  return parts.prose + factsTable(b.title, parts.short) + parts.long + parts.bullets;
}

// ── Sections ────────────────────────────────────────────────────────────────

/**
 * The analysis's own opening words longer than this are set at the head of
 * the first section rather than under the contents, where the half-page a
 * nine-entry list leaves holds about this much in the tallest design.
 */
const OPENING_ON_CONTENTS_MAX = 1_100;

function openingNote(cf: PortfolioReview): string {
  return cf.opening ? `<div class="eyebrow">About this review</div>${paras(cf.opening)}` : '';
}

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

  // The cash lines name their scope where a home is in the portfolio, because
  // the rent and the net are the investments' alone; and the expenses line is
  // printed only where it is the investments' too and the three foot
  // (`PortfolioTotals.cashflowFoots`). The home's outgoings are their own line,
  // after the net, saying they are not in it.
  const home = t.ownerOccupiedCount.unit !== 'none' && t.ownerOccupiedCount.value > 0;
  const scope = home ? ' (investments)' : '';
  const position: TableRow[] = [
    { item: 'Properties held', value: formatMeasure(t.propertyCount) },
    { item: 'Investment properties', value: formatMeasure(t.investmentCount) },
    ...(home ? [{ item: 'Owner-occupied', value: formatMeasure(t.ownerOccupiedCount) }] : []),
    { item: 'Total value', value: formatMeasure(t.value) },
    { item: 'Total debt', value: formatMeasure(t.debt) },
    { item: 'Total equity', value: formatMeasure(t.equity), __total: true },
    { item: 'Average LVR', value: formatMeasure(t.averageLvr) },
    { item: `Rental income${scope}`, value: formatMeasure(t.monthlyRentalIncome) },
    ...(t.cashflowFoots ? [{ item: `Expenses${scope}`, value: formatMeasure(t.investmentExpenses) }] : []),
    { item: `Net cash flow${scope}`, value: formatMeasure(t.netMonthlyCashflow), __total: true },
    ...(home && t.ownerOccupiedOutgoings.unit !== 'none'
      ? [{ item: 'Owner-occupied outgoings, not in the net', value: formatMeasure(t.ownerOccupiedOutgoings) }]
      : []),
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

  // The opening words go under the contents when they fit there; a longer
  // opening leads this section instead, still before the figures.
  const opening = cf.opening.length > OPENING_ON_CONTENTS_MAX
    ? subhead('About this review') + paras(cf.opening)
    : '';

  return opening
    + renderLede(cf.narrative)
    + renderKpiStrip(kpis)
    + table(
      [{ key: 'item', label: 'The portfolio', align: 'left' }, { key: 'value', label: 'Position', align: 'right' }],
      position,
      { caption: 'Where the portfolio stands today', signedKeys: ['value'] },
    )
    + notesFor(cf, 'standing')
    + recommendation
    + strengths
    + concerns;
}

/**
 * The mix in words, then the chart of it, then what to do about it.
 *
 * The chart led the section and a figure cannot split, so wherever it did not
 * fit under the section's heading the heading went with it and left the rest
 * of the page before it blank — 45% of a page in the standard design. Set
 * after the first words, the section starts where the last one ended and the
 * figure falls where it fits.
 */
function compositionSection(cf: PortfolioReview, palette: ResolvedReportPalette): string {
  const parts = narrativeParts(cf.composition);
  return parts.prose
    + compositionChart(cf, palette)
    + factsTable(cf.composition?.title ?? 'Composition', parts.short)
    + parts.long
    + parts.bullets;
}

/**
 * The inventory — the artefact this document has to get right.
 *
 * Rows are lines and columns are properties, because the alternative is what
 * the legacy does: twenty figures per property in portrait measure, split
 * across a table and a second set of cards four hundred lines apart, with the
 * table dropping every row past a hardcoded index.
 *
 * Up to `PORTRAIT_MATRIX_MAX` properties the matrix is portrait, on the page the
 * section is already on, headed by the street of each column: every portfolio
 * in the record has four properties or fewer, and a landscape sheet of its own
 * held one table and a band of white, headed "1 2 3 4" so a reader turned back
 * a page to learn which property was which. Past that the columns need the
 * long edge, and the landscape page — which spans pages rather than dropping
 * rows — takes them, keyed by number.
 */
function holdingsSection(cf: PortfolioReview): string {
  const portrait = cf.holdings.length <= PORTRAIT_MATRIX_MAX;

  /**
   * A line the record has no figure for anywhere is dropped, not printed as a
   * row of em dashes.
   *
   * Both are honest; only one is useful. `interestRate` and `lenderName` are
   * present on 9 of the 66 stored property records, so on most portfolios these
   * lines would be a solid rank of dashes running the width of the page — which
   * reads as a rendering fault rather than as absent data. A dash still means
   * "not on file" wherever *some* property has the figure and this one does not,
   * which is what the caption says.
   */
  const line = (label: string, pick: (h: HoldingRow) => string, total = false) => {
    const values = cf.holdings.map(pick);
    return values.every((v) => v === EMPTY) ? null : { label, values, total };
  };

  /**
   * The ownership line says something only where a share is not 100%.
   *
   * `generate-portfolio-analysis` writes `ownership_percentage || 100`, so a
   * share nobody recorded arrives as 100 — and a line of 100% under every
   * property states an ownership the record may never have held.
   */
  const shares = cf.holdings.map((h) => h.ownershipShare);
  const recordedShare = shares.some((m) => m.unit !== 'none' && Math.round(m.value) !== 100);

  const anyLender = cf.holdings.some((h) => h.lender);
  const key = table(
    [
      { key: 'n', label: '#', align: 'left' },
      { key: 'address', label: 'Property', align: 'left' },
      { key: 'type', label: 'Type', align: 'left' },
      ...(anyLender ? [{ key: 'lender', label: 'Lender', align: 'left' as const }] : []),
    ],
    cf.holdings.map((h) => ({
      n: String(h.number),
      address: h.address,
      type: h.typeLabel,
      ...(anyLender ? { lender: h.lender || EMPTY } : {}),
    })),
    { caption: portrait ? 'The holdings' : 'The holdings, numbered as they appear overleaf' },
  );

  const lines = [
    line('Value', (h) => formatMeasure(h.value)),
    line('Loan', (h) => formatMeasure(h.loan)),
    line('Equity', (h) => formatMeasure(h.equity), true),
    line('LVR', (h) => formatMeasure(h.lvr)),
    recordedShare ? line('Ownership', (h) => formatMeasure(h.ownershipShare)) : null,
    line('Interest rate', (h) => formatMeasure(h.interestRate)),
    line('Rental income', (h) => formatAmount(h.monthlyRentalIncome)),
    line('Expenses', (h) => formatAmount(h.monthlyExpenses)),
    line('Net cash flow', (h) => formatAmount(h.netMonthlyCashflow), true),
    line('Annual cash flow', (h) => formatAmount(h.annualCashflow)),
    line('Gross yield', (h) => formatMeasure(h.grossYield)),
    line('Cash on cash', (h) => formatMeasure(h.cashOnCashReturn)),
    line('Share of portfolio', (h) => formatMeasure(h.portfolioContribution)),
  ].filter((r): r is { label: string; values: string[]; total: boolean } => r !== null);

  const anyHome = cf.holdings.some((h) => h.isOwnerOccupied);
  const caption = 'Monthly figures unless the line says otherwise. A dash is a figure not on file'
    + (anyHome ? ', or one that does not apply: an owner-occupied home earns no rent.' : '.');

  const matrix = portrait
    ? portraitMatrix(cf.holdings, lines, caption)
    : renderBandedMatrix('Line', cf.holdings.map((h) => `${h.number}`), lines, { caption })
      .replace('<table class="data">', `<table class="data ${HOLDINGS_MATRIX_CLASS}">`);

  return key + notesFor(cf, 'holdings') + matrix;
}

/**
 * The holdings matrix on the page the section is already on — the Property
 * Comparison's portrait matrix, for the same reason (COMPARISON.md §13): the
 * property columns share the width equally, headed by the street each one is.
 */
function portraitMatrix(
  holdings: readonly HoldingRow[],
  lines: ReadonlyArray<{ label: string; values: string[]; total: boolean }>,
  caption: string,
): string {
  return renderPortraitMatrix({
    lineLabel: 'Line',
    headings: holdings.map((h) => `${h.number}. ${h.address.split(',')[0].trim() || `Property ${h.number}`}`),
    lines,
    caption,
    className: HOLDINGS_MATRIX_CLASS,
    labelWidthPct: 26,
    keep: TABLE_KEEP,
  });
}

/**
 * The portrait holdings matrix. Its column heads are streets, not figures, so
 * they wrap: a numeric column's head is set on one line (`th.num`), and four
 * addresses in tracked capitals ran into one another and squeezed the line
 * names into two lines each.
 */
const HOLDINGS_MATRIX_CLASS = 'holdings-matrix';

/**
 * The action table. Its first column is a horizon of at most three words, and
 * set in an automatic layout beside a column of sentences it was squeezed to
 * "Next 12 / months" over two lines on every row that carried it.
 */
const ACTION_TABLE_CLASS = 'action-plan';

/**
 * What this document adds to the design system's stylesheet.
 *
 * The holdings matrix is a table of figures, set at the leading and cell
 * padding of a table of sentences: fourteen rows stood two-fifths of a page
 * tall, split across pages 8 and 4 in the standard design, and in a review
 * with no analysis its last two rows took a page of their own before the
 * closing page. Set as the figures it holds, it is a third shorter and moves
 * whole far more often.
 */
const PORTFOLIO_CSS = portraitMatrixCss(HOLDINGS_MATRIX_CLASS) + `
  table.data.${ACTION_TABLE_CLASS} th[scope="row"] { white-space: nowrap; }`;

function performanceSection(cf: PortfolioReview, palette: ResolvedReportPalette): string {
  // The analysis rates and the review scores, and the two do not always agree —
  // a real row has the analysis calling a property "Good" while the review
  // classes the same property an "Underperformer". Both columns are shown, with
  // headings that name their source, so a disagreement is visible rather than
  // resolved by whichever happened to be read last.
  //
  // The order is the analysis's and the score is the review's, so a property
  // the analysis ranks second can carry a lower score than the one it ranks
  // third. The caption says whose order it is and the column whose score, so
  // that reads as two opinions rather than as a table out of order; a review
  // that scored nothing leaves no column of dashes behind it.
  const anyReview = cf.verdicts.some((v) => v.review?.classification);
  const anyScore = cf.verdicts.some((v) => v.score.unit !== 'none');
  const cols: TableColumn[] = [
    { key: 'rank', label: '#', align: 'left' },
    { key: 'address', label: 'Property', align: 'left' },
    { key: 'rating', label: 'Analysis', align: 'left' },
    ...(anyReview ? [{ key: 'classification', label: 'Review', align: 'left' as const }] : []),
    ...(anyScore ? [{ key: 'score', label: 'Review score', align: 'right' as const }] : []),
  ];
  const rows: TableRow[] = cf.verdicts.map((v: HoldingVerdict) => ({
    rank: v.rank === null ? EMPTY : String(v.rank),
    address: v.address,
    rating: v.rating || EMPTY,
    ...(anyReview ? { classification: v.review?.classification || EMPTY } : {}),
    ...(anyScore ? { score: v.score.unit === 'none' ? EMPTY : `${formatMeasure(v.score)} / 100` } : {}),
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
      + runIn('Role', v.strategicRole)
      + (v.strengths.length ? renderSidenote('Working', renderList(v.strengths)) : '')
      + (v.concerns.length ? renderSidenote('Watch', renderList(v.concerns)) : '')
      + runIn('Recommendation', v.recommendation)
      + runIn('Outlook', v.outlook)
      + runIn('Growth', v.growth)
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

  // The chart, then the ranking it explains. A figure cannot split, so where
  // this section's heading and its chart do not fit together both move to a
  // fresh page; the chart is drawn shorter for that reason (`QUADRANT_HEIGHT`).
  // Three orders were measured over the 50 designs and the standard layout
  // (PORTFOLIO.md §10): chart first and ranking first left the same number of
  // pages short to within four, and the chart after the commentary left a
  // third more — so the order is the one that reads: the picture, then the
  // ranking, then each property.
  return yieldAgainstLeverageChart(cf, palette)
    + table(cols, rows, { caption: 'How the analysis ranks each property' })
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

/**
 * Financial health and risk, as one assessment.
 *
 * The two blocks each opened on a table of their one-word verdicts — four
 * rows for health, one row, "Overall risk: Medium", for risk — so the section
 * printed a one-row table under a four-row one. Their verdicts are one table
 * now; the paragraphs follow, then what a rate rise would do, then the lists.
 */
function healthSection(cf: PortfolioReview): string {
  const health = narrativeParts(cf.financialHealth);
  const risk = narrativeParts(cf.risk);
  return health.prose
    + factsTable('The position', [...health.short, ...risk.short])
    + health.long
    + risk.long
    + rateRiseSection(cf)
    + health.bullets
    + risk.bullets;
}

const RATE_GAP_WORDS: Record<RateSensitivityGap, string> = {
  missing_interest_rate: 'no interest rate is on file for at least one of them',
  missing_repayment_structure:
    'whether at least one of them is interest-only or principal and interest is not on file',
  amortising_loan_without_term:
    'at least one is a principal-and-interest loan with no remaining term on file, and its repayment cannot be calculated without one',
  unknown: 'the figures could not be calculated from what is on file',
};

/**
 * What a rise in rates would do to the monthly cash position, as the analysis
 * calculated it (`RateSensitivityClass`).
 *
 * The typeset review carried the analysis's paragraph about rate risk and none
 * of the figures behind it, though `generate-portfolio-analysis` has calculated
 * them from each loan's balance and rate since 7 September — the one figure the
 * legacy PDF showed and this document did not. A class that could not be
 * calculated says why, in words, rather than printing a dash.
 */
function rateRiseSection(cf: PortfolioReview): string {
  const s = cf.rateSensitivity;
  if (!s) return '';

  // The column head says "Each month", so the figures are plain amounts: the
  // first cut said "a month" three times in one row — in the head, in the row's
  // label and as a "/mo" on every figure.
  const cash = (m: Measure) => (m.unit === 'none' ? EMPTY : formatAmount(m));
  const after = (current: Measure, change: Measure) =>
    current.unit === 'none' || change.unit === 'none' ? EMPTY : formatAmount(audPerMonth(current.value + change.value));

  const rows: TableRow[] = [];
  const inv = s.investment;
  if (inv?.available) {
    rows.push({ item: 'Change on the investment loans', one: cash(inv.plusOne), two: cash(inv.plusTwo) });
    if (inv.current.unit !== 'none') {
      // Named as the standing section names it, so the figure it moves from is
      // one the reader has already seen.
      rows.push({
        item: 'Net cash flow (investments) after the rise',
        one: after(inv.current, inv.plusOne),
        two: after(inv.current, inv.plusTwo),
        __total: true,
      });
    }
  }
  const home = s.ownerOccupied;
  if (home?.available) {
    rows.push({ item: 'Change on the owner-occupied loans', one: cash(home.plusOne), two: cash(home.plusTwo) });
  }

  const covered = [inv, home]
    .filter((c): c is RateSensitivityClass => Boolean(c?.available))
    .map((c) => c.loansCovered.value)
    .reduce((n, v) => n + (Number.isFinite(v) ? v : 0), 0);

  const gaps = ([['the investment loans', inv], ['the owner-occupied loans', home]] as const)
    .filter(([, c]) => c && !c.available)
    .map(([who, c]) => `A rate-rise figure is not shown for ${who}: ${RATE_GAP_WORDS[c!.gap ?? 'unknown']}.`);

  if (!rows.length && !gaps.length) return '';

  return subhead('If interest rates rise')
    + paras(s.commentary)
    + (rows.length
      ? table(
        [
          { key: 'item', label: 'Each month', align: 'left' },
          { key: 'one', label: 'Rates up 1%', align: 'right' },
          { key: 'two', label: 'Rates up 2%', align: 'right' },
        ],
        rows,
        {
          caption: `Calculated from the balance and rate of each loan${covered ? ` (${covered} ${covered === 1 ? 'loan' : 'loans'})` : ''}`,
          signedKeys: ['one', 'two'],
        },
      )
      : '')
    + gaps.map(p).join('');
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
    + paras(c.commentary)
    + pointer;
}

function outlookSection(cf: PortfolioReview): string {
  // The cycle, the rate outlook and the lending environment, then what they
  // mean for this portfolio — the conclusion after what it concludes from.
  const market = renderNarrative(cf.market)
    + (cf.marketPositioning ? subhead('What it means for this portfolio') + paras(cf.marketPositioning) : '');
  const pr = cf.projection;
  if (!pr) return market;

  // Value, less the debt it carries, is the equity: three lines that foot.
  // A figure the projection does not make — it projects no cash flow, and says
  // so in its assumptions — is left off rather than printed as a dash.
  //
  // Beside it, today's figures where the projection provably starts from them
  // (`ProjectionBlock.today`): "three times the equity you hold today" is the
  // prose's claim, and the column is what lets a reader see it rather than
  // take it. The heads name the two moments; "Projected" and "Amount" named
  // nothing the caption had not.
  const today = pr.today;
  const horizon = pr.years.unit === 'none' ? '' : formatMeasure(pr.years);
  const inYears = horizon ? `In ${horizon}` : 'Projected';
  const rows: TableRow[] = [
    { item: 'Portfolio value', now: today ? formatMeasure(today.value) : '', value: formatMeasure(pr.projectedValue) },
    ...(pr.projectedDebt.unit !== 'none'
      ? [{
        item: 'Debt, held at today\'s balance',
        now: today ? formatMeasure(today.debt) : '',
        value: formatMeasure(pr.projectedDebt),
      }]
      : []),
    {
      item: 'Equity',
      now: today ? formatMeasure(today.equity) : '',
      value: formatMeasure(pr.projectedEquity),
      __total: true,
    },
    ...(pr.projectedMonthlyCashflow.unit !== 'none'
      ? [{ item: 'Net cash flow', now: EMPTY, value: formatMeasure(pr.projectedMonthlyCashflow) }]
      : []),
  ];
  const cols: TableColumn[] = [
    { key: 'item', label: '', align: 'left' },
    ...(today ? [{ key: 'now', label: 'Today', align: 'right' as const }] : []),
    { key: 'value', label: inYears, align: 'right' },
  ];

  return market
    + subhead(horizon ? `If the assumptions hold — ${horizon}` : 'If the assumptions hold')
    + paras(pr.summary)
    + table(cols, rows, {
      caption: today
        ? 'Value, debt and equity, today and projected'
        : horizon ? `Projected position at ${horizon}` : 'Projected position',
      signedKeys: ['now', 'value'],
    })
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

/** Who asked for an action, in the words the ranking table's columns use. */
const ACTION_SOURCE: Record<ActionRow['source'], string> = {
  analysis: 'Analysis',
  review: 'Review',
  both: 'Both',
};

function planSection(cf: PortfolioReview): string {
  const growth = renderNarrative(cf.growth);
  const optimisations = cf.optimisations.length
    ? subhead('What acting on this would change') + renderList(cf.optimisations)
    : '';
  if (!cf.actions.length) return growth + optimisations;

  // The source column appears only when it says more than one thing. On a
  // report with no review every row would say "Analysis", which is a column of
  // one repeated word.
  const mixed = new Set(cf.actions.map((a) => a.source)).size > 1;
  const cols: TableColumn[] = [
    { key: 'priority', label: 'When', align: 'left' },
    { key: 'action', label: 'Action', align: 'left' },
    ...(mixed ? [{ key: 'source', label: 'From', align: 'left' as const }] : []),
  ];
  const rows: TableRow[] = cf.actions.map((a: ActionRow) => ({
    priority: a.priorityLabel,
    action: a.title,
    ...(mixed ? { source: ACTION_SOURCE[a.source] } : {}),
  }));

  // Actions that carry more than a line get it, beneath the table rather than
  // inside it.
  const detail = cf.actions
    .filter((a) => a.detail || a.steps.length)
    .map((a) => subhead(a.title) + paras(a.detail) + renderList(a.steps))
    .join('');

  return growth
    + table(cols, rows, { caption: 'What to do, in order' })
      .replace('<table class="data">', `<table class="data ${ACTION_TABLE_CLASS}">`)
    + detail
    + optimisations;
}

function reviewSection(cf: PortfolioReview): string {
  const r = cf.review;
  if (!r) return '';

  // Every score the review recorded. The strip used to take the first four,
  // so "Data completeness" — how much of the client record the review had to
  // work with — was scored and never printed.
  const kpis: KpiCell[] = r.scores.map((s) => ({
    label: s.label,
    value: `${formatMeasure(s.score)} / 100`,
  }));

  const meta: TableRow[] = [
    { item: 'Reviewed', value: formatReportDate(r.reviewedOn) || EMPTY },
    { item: 'Status', value: r.status || EMPTY },
    { item: 'Risk level', value: r.riskLevel || EMPTY },
    { item: 'Next review due', value: r.nextReviewDue ? formatReportDate(r.nextReviewDue) : EMPTY },
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
    + notesFor(cf, 'review')
    + paras(r.summary)
    + (r.findings.length ? renderCallout('neutral', 'What the review found', renderList(r.findings)) : '')
    + table(
      [{ key: 'item', label: 'This review', align: 'left' }, { key: 'value', label: '', align: 'right' }],
      meta,
    )
    + (cf.scenarios.length
      ? table(
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
    undefined,
    // The analysis's opening words to the client, where the contents leave
    // room for them (`OPENING_ON_CONTENTS_MAX`); a longer opening leads the
    // first section instead.
    cf.opening.length <= OPENING_ON_CONTENTS_MAX ? openingNote(cf) : null,
  );

  // Nine sections, each of which opened a page. A four-property review
  // printed 24 sheets in every one of the 50 designs and the standard layout,
  // and over those 51 renders 274 body pages ended more than a quarter empty —
  // the worst 92% blank, a page holding three bullets (PORTFOLIO.md §10). The
  // sections run on now, as a memo's do
  // (`RUN_ON_CHAPTER_CLASS`, `MEMO_CHAPTER_CLASS`): each keeps its number, its
  // contents entry and its running head, its title is set one step above its
  // subheads rather than at the chapter-opener size, and a short table moves
  // whole. The first still opens its page, after the contents; a landscape
  // matrix still takes its own.
  const body = sections.map((section, index) => {
    const inner = SECTION_BODY[section.id]?.(cf, input.palette) ?? '';
    const number = String(index + 1).padStart(2, '0');
    return openChapter(DOCUMENT_NAME, number, section.title, 'body', { runOn: index > 0, memo: true })
      + renderChapterHeader({
        number,
        title: section.title,
        dek: section.note,
        label: ARCHETYPE.chapterLabel,
      })
      + `<div class="chapter-body">${inner}</div>`
      + closeChapter();
  }).join('');

  const closing = renderCompanyPage({
    block: input.company,
    lockup: input.lockup ?? null,
  });

  return cover + contents + body + closing;
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
    }) + PORTFOLIO_CSS,
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
  /**
   * A chosen template's design (`templateDesign.pure.ts`). Its palette, faces
   * and page treatment replace the brand's palette; every word on every page is
   * still this composer's. Absent, and the document is the standard one byte
   * for byte.
   */
  design?: ReportTemplateDesign | null;
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
      palette: input.design?.palette ?? brand.palette,
      company: brand.company,
      masthead: brand.masthead,
      lockup: brand.lockup,
      heroDataUri: brand.heroDataUri,
      confidentiality: brand.confidentiality,
      options: withDesignOptions(input.options, input.design),
      edition: input.edition ?? null,
    }),
    gaps: brand.gaps,
  };
}
