/**
 * The comparison as HTML, through the design system.
 *
 * ## What the two generators this sits beside actually produce
 *
 * `exportComparisonPDF` rasterises three on-screen charts with `html2canvas`,
 * prints an eight-row metrics table, and appends whatever the model wrote.
 * `exportAiAnalysisPDF` prints the model and nothing else — and returns without
 * drawing anything at all when there is no analysis
 * (`CashFlowAnalysisModal.tsx:1947`). So the ten years of arithmetic the adviser
 * just spent the session editing have never reached a client's document in any
 * form.
 *
 * Here they are the document. The matrices open landscape pages because that is
 * what a wide numeric table needs, the model's prose sits after the figures it
 * describes rather than instead of them, and a comparison with no analysis is a
 * complete report rather than an empty one.
 *
 * ## Every model-authored string is escaped, and never as HTML
 *
 * `renderCallout`, `renderDecisionBox` and `renderSidenote` all take **raw
 * HTML** for their bodies. Model text reaches them only through `p()`, `subhead()` or
 * `renderList()` below, each of which escapes. Passing a model string straight
 * into a `bodyHtml` parameter is the one mistake in this file that would not
 * show up on a page until it did.
 *
 * ## Nothing here attributes model prose to a property
 *
 * The producer points at properties with a bare `propertyNumber` indexing an
 * ordering that existed only inside one edge-function call — see the long note
 * in `payload.pure.ts`. So the notes print as prose, exactly as the on-screen
 * panel does, and only `finalRankings` is attributed, on the address the
 * producer instructs the model to echo back.
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
  type KpiCell,
  type TableColumn,
  type TableRow,
} from '../../reportDesign/primitives.pure.ts';
import { buildReportCss } from '../../reportDesign/css.pure.ts';
import type { ResolvedReportPalette } from '../../reportDesign/roles.pure.ts';
import type { ReportDesignOptions } from '../../reportDesign/options.pure.ts';
import type { CompanyBlock, CompanyDisclaimer } from '../../reportDesign/companyBlock.pure.ts';
import { contentsEntriesFor, REPORT_ARCHETYPES } from '../../reportDesign/structure.pure.ts';
import type { ReportBrandSnapshot } from '../../reportDesign/snapshot.pure.ts';
import { resolveSnapshotBrand } from '../../reportDesign/documentBrand.pure.ts';
import type { Measure } from '../../reportDesign/measure.pure.ts';
import { formatAmount, formatMeasure } from '../../reportDesign/measure.pure.ts';

import type {
  AnalysisNote,
  CashFlowComparison,
  ComparedProperty,
} from './payload.pure.ts';
import { comparisonSections, comparisonSpine, validateComparisonSpine } from './sections.pure.ts';
import {
  categoryWinsChart,
  cumulativeCashFlowChart,
  rankedReturnChart,
} from './charts.pure.ts';
import { formatReportDate as formatPreparedOn } from '../reportDate.pure.ts';

const ARCHETYPE = REPORT_ARCHETYPES['cash-flow-comparison'];

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

// ── Escaping helpers ────────────────────────────────────────────────────────

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
  const kept = items.filter(Boolean);
  if (!kept.length) return '';
  return `<ul>${kept.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

/** One model note as a paragraph, with any figure it carried appended. */
function note(heading: string, n: AnalysisNote | null): string {
  if (!n) return '';
  const body = n.detail && n.reason
    ? `${n.reason} (${n.detail})`
    : n.reason || n.detail;
  return body ? `<p><strong>${escapeHtml(heading)}:</strong> ${escapeHtml(body)}</p>` : '';
}

/** An em dash for a measure that does not exist, so a column never goes blank. */
const show = (m: Measure | null): string => (m ? formatMeasure(m) : '—');
const showAmount = (m: Measure | null): string => (m ? formatAmount(m) : '—');
const showYear = (y: number | null): string => (y === null ? 'Not within the term' : `Year ${y}`);

// ── Tables keyed by property ────────────────────────────────────────────────

/**
 * A table whose columns are the properties.
 *
 * The orientation every side-by-side table in this document uses: measures down
 * the side, properties across the top. It is the orientation the modal's own
 * on-screen comparison uses (`CashFlowAnalysisModal.tsx:4886-4899`) and the one
 * an adviser reads out, and with at most five properties it fits the portrait
 * measure — which is why these are chapters and not landscape pages.
 *
 * The primary is marked and not moved. The document's posture is equal peers, so
 * the property the adviser happened to open is a column like the others with a
 * note on it, rather than the first column with the rest hanging off it.
 */
function byProperty(
  cf: CashFlowComparison,
  rowLabel: string,
  rows: Array<{ label: string; of: (x: ComparedProperty) => string; total?: boolean }>,
  caption: string,
): string {
  const columns: TableColumn[] = [
    { key: 'label', label: rowLabel, align: 'left' },
    ...cf.properties.map((x) => ({
      key: `c${x.number}`,
      label: x.isPrimary ? `${x.shortAddress} ·` : x.shortAddress,
      align: 'right' as const,
    })),
  ];

  const tableRows: TableRow[] = rows.map((row) => {
    const out: TableRow = { label: row.label };
    for (const x of cf.properties) out[`c${x.number}`] = row.of(x);
    if (row.total) out.__total = true;
    return out;
  });

  return renderDataTable(columns, tableRows, {
    caption,
    signedKeys: cf.properties.map((x) => `c${x.number}`),
  });
}

// ── Section renderers ───────────────────────────────────────────────────────

/**
 * The verdict, first.
 *
 * The producer writes its recommendation last and both legacy generators print
 * it near the end. Someone who put five properties side by side does not need
 * walking to the answer.
 *
 * The KPI strip leads with the *gap* rather than the winner's figure, because
 * the gap is the thing the ranked table cannot say: a 2% lead and a 40% lead
 * produce the same ordered list and mean entirely different things.
 */
function verdictSection(cf: CashFlowComparison, palette: ResolvedReportPalette): string {
  const byNumber = new Map(cf.properties.map((x) => [x.number, x]));
  const ranked = cf.scoreboard.order
    .map((n) => byNumber.get(n))
    .filter((x): x is ComparedProperty => Boolean(x));
  const leader = ranked[0];

  const kpis: KpiCell[] = [
    {
      label: 'Strongest total return',
      value: leader ? leader.shortAddress : '—',
      foot: leader ? formatMeasure(leader.outcome.totalReturn) : '',
    },
    {
      label: 'Lead over second',
      value: cf.scoreboard.leadMargin ? formatMeasure(cf.scoreboard.leadMargin) : 'Level',
      foot: 'On total return',
    },
    {
      label: 'Properties compared',
      value: String(cf.properties.length),
      foot: `Over ${cf.meta.termYears} years`,
    },
  ];

  const rankTable = renderDataTable(
    [
      { key: 'rank', label: '#', align: 'left' },
      { key: 'property', label: 'Property', align: 'left' },
      { key: 'total', label: 'Total return', align: 'right' },
      { key: 'growth', label: 'Capital growth', align: 'right' },
      { key: 'cash', label: 'Cash flow', align: 'right' },
      { key: 'payback', label: 'Repays by', align: 'right' },
    ],
    ranked.map((x, i) => ({
      rank: String(i + 1),
      property: x.isPrimary ? `${x.shortAddress} (opened)` : x.shortAddress,
      total: formatMeasure(x.outcome.totalReturn),
      growth: formatMeasure(x.outcome.capitalGain),
      cash: formatMeasure(x.outcome.cumulativeAfterTax),
      payback: showYear(x.outcome.paybackYear),
      __total: i === 0,
    })),
    {
      caption: `Ranked on total return over ${cf.meta.termYears} years`,
      signedKeys: ['total', 'growth', 'cash'],
    },
  );

  // Only decided categories. A tie prints as a row saying so rather than
  // handing the win to whichever property was added first.
  const winsTable = renderDataTable(
    [
      { key: 'measure', label: 'Measure', align: 'left' },
      { key: 'leader', label: 'Leads', align: 'left' },
      { key: 'value', label: 'Figure', align: 'right' },
      { key: 'margin', label: 'Ahead by', align: 'right' },
    ],
    cf.scoreboard.winners.map((w) => {
      const winner = w.property === null ? null : byNumber.get(w.property);
      return {
        measure: w.label,
        leader: winner ? winner.shortAddress : 'No clear leader',
        value: show(w.value),
        margin: show(w.margin),
      };
    }),
    { caption: 'Who leads on each measure, and by how much' },
  );

  const summary = cf.analysis?.summary
    ? subhead('What the analysis said') + p(cf.analysis.summary)
    : '';

  return renderLede(cf.narrative)
    + renderKpiStrip(kpis)
    + rankTable
    + rankedReturnChart(cf, palette)
    + subhead('Who leads on what')
    + winsTable
    + categoryWinsChart(cf, palette)
    + summary
    + renderSidenote(
      'Two properties can both be right',
      p('A ranking on total return combines what a property grew with what it cost '
        + 'to hold, and those two are often in tension. The property that ranks first '
        + 'here may not be the one that suits a particular investor — the measures '
        + 'that follow are what separate them.'),
    );
}

/**
 * What it costs to get in.
 *
 * `Capital in` is the denominator of every return figure in this document, and
 * it is stated here rather than left implied — the modal's own metrics compute
 * it two different ways for the primary and the peers, which is why the server
 * derives it once from the acquisition block every property sends.
 */
function entrySection(cf: CashFlowComparison): string {
  const table = byProperty(
    cf,
    'At purchase',
    [
      { label: 'Purchase price', of: (x) => formatMeasure(x.projection.acquisition.purchasePrice) },
      { label: 'Market value now', of: (x) => formatMeasure(x.projection.acquisition.marketValue) },
      { label: 'Deposit', of: (x) => formatMeasure(x.projection.acquisition.deposit) },
      { label: 'Loan amount', of: (x) => formatMeasure(x.projection.acquisition.loanAmount) },
      { label: 'Loan to value', of: (x) => formatMeasure(x.projection.acquisition.lvr) },
      { label: 'Loan type', of: (x) => x.projection.acquisition.loanType },
      { label: 'Interest rate', of: (x) => formatMeasure(x.projection.acquisition.interestRate) },
      { label: 'Weekly rent', of: (x) => formatMeasure(x.projection.acquisition.weeklyRent) },
      {
        label: 'Acquisition costs',
        of: (x) => formatAmount({
          value: x.projection.acquisition.costs.reduce((s, c) => s + c.amount.value, 0),
          unit: 'aud',
        }),
      },
      { label: 'Capital in', of: (x) => formatMeasure(x.outcome.initialInvestment), total: true },
    ],
    'What each property costs to acquire',
  );

  // Only costs somebody actually incurred. A `$0` row for a fee nobody paid
  // reads as though they paid nothing for something rather than nothing at all
  // — the rule `cashFlow/normalise.pure.ts` applies when it drops zero costs.
  const labels = [...new Set(
    cf.properties.flatMap((x) => x.projection.acquisition.costs.map((c) => c.label)),
  )];
  const costBreakdown = labels.length
    ? byProperty(
      cf,
      'Cost',
      labels.map((label) => ({
        label,
        of: (x: ComparedProperty) => {
          const cost = x.projection.acquisition.costs.find((c) => c.label === label);
          return cost ? formatMeasure(cost.amount) : '—';
        },
      })),
      'Itemised, where the report recorded them',
    )
    : '';

  return table + costBreakdown + renderSidenote(
    'Why capital in matters more than price',
    p('Return on capital divides what a property makes by what the investor '
      + 'actually put in — deposit plus the costs of buying. Two properties at the '
      + 'same price can need very different amounts of cash to acquire, and the '
      + 'cheaper one to enter is not always the cheaper one to own.'),
  );
}

/** The year columns, shared by both matrices. Alignment is guaranteed upstream. */
function periodsOf(cf: CashFlowComparison): string[] {
  return cf.properties[0].projection.years.map(
    (y) => (y.calendarYear ? `Y${y.year} · ${y.calendarYear}` : `Year ${y.year}`),
  );
}

/**
 * One matrix per measure — never one matrix with two measures interleaved.
 *
 * The first render did interleave them: for each property an "after tax" row
 * followed by a "cumulative" row, which is 2N rows with two-line labels. At five
 * properties that is ten rows, one more than the landscape page held, and it put
 * the fifth property's two rows alone on a page of their own — the same defect
 * `CASH_FLOW.md` records for its own fourteen-line table.
 *
 * Splitting fits, and reads better than the fix required: comparing five
 * properties on one measure is a scan down one block, where the interleaved
 * version made the reader skip every second row to do the same thing. The row
 * label is then just the address, so it stops wrapping too.
 *
 * Split at every property count rather than only when it overflows. A format
 * whose central table changes shape with the row count hands a reader two
 * different-looking documents for the same report — the Property Comparison's
 * reasoning about landscape, applied to layout.
 */
function measureMatrix(
  cf: CashFlowComparison,
  rowLabel: string,
  of: (x: ComparedProperty) => string[],
  caption: string,
): string {
  // The primary is *not* marked here. `total` sets the summary-row treatment,
  // and a bolded row in a financial matrix reads as a sum — which in a document
  // whose posture is equal peers would also read as "this is the answer". The
  // marker belongs on the column headers of the side-by-side tables, where it
  // cannot be mistaken for arithmetic.
  return renderBandedMatrix(
    rowLabel,
    periodsOf(cf),
    cf.properties.map((x) => ({ label: x.shortAddress, values: of(x) })),
    { caption },
  );
}

/** The cash-flow matrices: what each property costs or returns, year by year. */
function cashFlowMatrixSection(cf: CashFlowComparison): string {
  const cumulative = (x: ComparedProperty) => {
    let running = 0;
    return x.projection.years.map((y) => {
      running += y.afterTaxAnnual.value;
      return formatAmount({ value: running, unit: 'aud' });
    });
  };

  return measureMatrix(
    cf,
    'After-tax cash flow',
    (x) => x.projection.years.map((y) => formatAmount(y.afterTaxAnnual)),
    'What each property costs or returns in each year, after tax. Dollars per year.',
  ) + measureMatrix(
    cf,
    'Cumulative',
    cumulative,
    'The same figures added to the ones before them. The year a row turns positive '
    + 'is the year that property has repaid what it cost to hold.',
  );
}

/** The position matrices: what each property is worth and what is owned of it. */
function positionMatrixSection(cf: CashFlowComparison): string {
  // Loan balance is deliberately absent: it is value less equity, and a third
  // landscape page to restate arithmetic the reader can do across two of them is
  // not worth the paper.
  return measureMatrix(
    cf,
    'Property value',
    (x) => x.projection.years.map((y) => formatMeasure(y.propertyValue)),
    'What each property is projected to be worth at the end of each year.',
  ) + measureMatrix(
    cf,
    'Equity',
    (x) => x.projection.years.map((y) => formatMeasure(y.equity)),
    'Value less the loan balance. The difference between this and the row above is what is still owed.',
  );
}

/** Every derived measure, side by side, plus the chart the tables answer slowly. */
function measuresSection(cf: CashFlowComparison, palette: ResolvedReportPalette): string {
  const returns = byProperty(
    cf,
    'Over the term',
    [
      { label: 'Total return', of: (x) => formatMeasure(x.outcome.totalReturn), total: true },
      { label: 'Capital growth', of: (x) => formatMeasure(x.outcome.capitalGain) },
      { label: 'Cumulative cash flow, after tax', of: (x) => formatMeasure(x.outcome.cumulativeAfterTax) },
      { label: 'Return on capital', of: (x) => show(x.outcome.roi) },
      { label: 'Annualised', of: (x) => show(x.outcome.annualisedRoi) },
      { label: 'Cash on cash, year 1', of: (x) => show(x.outcome.cashOnCash) },
      { label: 'Equity multiple', of: (x) => show(x.outcome.equityMultiple) },
    ],
    'Return, however it is measured',
  );

  const position = byProperty(
    cf,
    `At year ${cf.meta.termYears}`,
    [
      { label: 'Property value', of: (x) => formatMeasure(x.outcome.endingValue) },
      { label: 'Equity', of: (x) => formatMeasure(x.outcome.endingEquity), total: true },
      { label: 'Gross yield, year 1', of: (x) => formatMeasure(x.outcome.grossYield) },
      { label: 'Net yield, year 1', of: (x) => formatMeasure(x.outcome.netYield) },
      { label: 'Capital growth assumed', of: (x) => formatMeasure(x.outcome.capitalGrowthRate) },
    ],
    'Where each property ends up',
  );

  const timing = byProperty(
    cf,
    'Timing',
    [
      { label: 'First year in the black', of: (x) => showYear(x.outcome.firstPositiveYear) },
      { label: 'Repays its holding costs', of: (x) => showYear(x.outcome.paybackYear), total: true },
    ],
    'Two different questions, two different years',
  );

  return returns
    + position
    + subhead('When each property stops costing money')
    + timing
    + renderCallout(
      'neutral',
      'These are not the same year',
      p('“First year in the black” is the first year a property\'s own cash flow is '
        + 'positive. “Repays its holding costs” is the year the money it has made '
        + 'catches up with everything it cost before then, which is usually later '
        + 'and is the year an investor stops being out of pocket. Both are printed '
        + 'because they answer different questions and are routinely confused.'),
    )
    + cumulativeCashFlowChart(cf, palette);
}

/**
 * The model's written comparison.
 *
 * Attributed to the model in the first line, deliberately. Every figure
 * elsewhere in this document is arithmetic the reader can check against the
 * table it sits beside; these paragraphs are not, and a reader is entitled to
 * know which is which. Four of these blocks have reached no surface in the
 * product — not the screen, not either legacy PDF — so this is also the first
 * time anyone has read them.
 */
function analysisSection(cf: CashFlowComparison): string {
  const a = cf.analysis;
  if (!a) return '';

  const trajectory = a.trajectory
    ? subhead('Cash flow')
      + note('Reaches positive cash flow first', a.trajectory.fastestPositive)
      + note('Strongest growth in cash flow', a.trajectory.strongestGrowth)
      + (a.trajectory.concerns.length
        ? renderCallout(
          'caution',
          'Concerns raised',
          renderList(a.trajectory.concerns.map((c) => c.reason || c.detail)),
        )
        : '')
    : '';

  const growth = a.capitalGrowth
    ? subhead('Capital growth')
      + note('Strongest equity position', a.capitalGrowth.strongestEquity)
      + note('Best wealth builder', a.capitalGrowth.wealthBuilder)
      + (a.capitalGrowth.endingValues.length
        ? renderDataTable(
          [
            { key: 'value', label: 'Value at the end of the term', align: 'left' },
            { key: 'equity', label: 'Equity', align: 'right' },
          ],
          a.capitalGrowth.endingValues.map((v) => ({ value: v.value, equity: v.equity })),
          {
            // Unattributed on purpose — the producer names these by a property
            // number that indexes nothing recorded. The derived figures are in
            // the measures table, where they carry a property name.
            caption: 'As the analysis stated them. The derived figures are in section '
              + 'five, where each is named against its property.',
          },
        )
        : '')
    : '';

  const yields = a.yields
    ? subhead('Yield and return')
      + note('Best gross yield', a.yields.bestGross)
      + note('Best net yield', a.yields.bestNet)
      + note('Best return over the term', a.yields.bestRoi)
    : '';

  const attribution = renderCallout(
    'neutral',
    'Written, not calculated',
    p('This section is a written comparison produced from the same projections as '
      + 'the tables above. Where it names a figure, the table is the record.'),
  );

  return attribution + trajectory + growth + yields;
}

/**
 * Each property in turn, as the analysis ranked them.
 *
 * The one block that can be attributed, and only because the producer instructs
 * the model to echo the address back. A ranking whose address matched nothing
 * prints the address the model wrote, so the reader sees the claim rather than a
 * heading silently pointing at the wrong property.
 */
function eachPropertySection(cf: CashFlowComparison): string {
  const rankings = cf.analysis?.rankings ?? [];
  if (!rankings.length) return '';
  const byNumber = new Map(cf.properties.map((x) => [x.number, x]));

  return rankings.map((r) => {
    const matched = r.property === null ? null : byNumber.get(r.property);
    const heading = matched
      ? `${r.rank}. ${matched.shortAddress}`
      : `${r.rank}. ${r.statedAddress || 'Unnamed property'}`;

    // No denominator: the producer's schema states no scale, and both legacy
    // generators print `/100` on one it never named.
    const score = r.score === null ? '' : p(`Score given: ${r.score}`);
    const unmatched = matched
      ? ''
      : renderCallout(
        'caution',
        'Not matched to a property',
        p('The analysis named an address that does not match any of the properties '
          + 'compared here, so this ranking is printed as written rather than '
          + 'attached to a column in the tables above.'),
      );

    return subhead(heading)
      + unmatched
      + score
      + p(r.verdict)
      + (r.strengths.length ? `<p><strong>In favour</strong></p>${renderList(r.strengths)}` : '')
      + (r.weaknesses.length ? `<p><strong>Against</strong></p>${renderList(r.weaknesses)}` : '');
  }).join('');
}

/** The four investor profiles. */
function suitsSection(cf: CashFlowComparison): string {
  const matches = cf.analysis?.investorMatches ?? [];
  if (!matches.length) return '';

  return p(`This comparison was run for a ${cf.meta.investorProfileLabel.toLowerCase()}. `
    + 'The analysis was asked what it would recommend to each of the four profiles, '
    + 'and its answers are below.')
    + matches.map((m) => subhead(m.label) + p(m.note.reason || m.note.detail)).join('')
    + renderSidenote(
      'Why all four are printed',
      p('The profile a comparison is run under changes what the analysis recommends, '
        + 'not what the properties do. Printing all four lets a reader see how much '
        + 'of the recommendation is the property and how much is the profile.'),
    );
}

/** Risk, and what the analysis would avoid. */
function riskSection(cf: CashFlowComparison): string {
  const risk = cf.analysis?.risk;
  const rec = cf.analysis?.recommendation;

  const stability = risk
    ? note('Most stable', risk.mostStable)
      // Printed as prose beside the word "highest" and never as a scoreboard
      // entry: an award for being the riskiest is not a category anyone wins.
      + note('Highest risk', risk.highestRisk)
      + (risk.risks.length
        ? renderCallout('caution', 'Risks named', renderList(risk.risks))
        : '')
      + (risk.breakEven.length
        ? renderDataTable(
          [
            { key: 'year', label: 'Break-even, as stated', align: 'left' },
            { key: 'margin', label: 'Safety margin', align: 'right' },
          ],
          risk.breakEven.map((b) => ({ year: b.year, margin: b.safetyMargin })),
          { caption: 'As the analysis stated them. The derived years are in section five.' },
        )
        : '')
    : '';

  const recommendation = rec
    ? subhead('The recommendation')
      + note('Best overall', rec.best)
      + (rec.avoid.length
        ? renderCallout('caution', 'Would avoid', renderList(rec.avoid.map((x) => x.reason || x.detail)))
        : '')
      + (rec.scenarios.length
        ? `<p><strong>Under other circumstances</strong></p>${renderList(rec.scenarios)}`
        : '')
    : '';

  return stability + recommendation;
}

/** The assumptions behind every figure above. */
function basisSection(cf: CashFlowComparison): string {
  const perProperty = cf.properties.map((x) => {
    const rows = x.projection.assumptions.map((a) => ({ item: a.label, value: a.value }));
    if (!rows.length) return '';
    return subhead(x.address)
      + renderDataTable(
        [
          { key: 'item', label: 'Assumption', align: 'left' },
          { key: 'value', label: 'Basis', align: 'right' },
        ],
        rows,
        { caption: `What ${x.shortAddress}'s projection assumes` },
      )
      + (x.projection.notes.length ? renderList(x.projection.notes) : '');
  }).join('');

  const profile = renderDataTable(
    [
      { key: 'item', label: 'The comparison', align: 'left' },
      { key: 'value', label: '', align: 'right' },
    ],
    [
      { item: 'Investor profile', value: cf.meta.investorProfileLabel },
      { item: 'Term', value: `${cf.meta.termYears} years` },
      { item: 'Properties compared', value: String(cf.properties.length) },
      { item: 'Prepared on', value: formatPreparedOn(cf.meta.preparedOn) },
      {
        item: 'Written analysis',
        value: cf.analysis ? 'Included' : 'Not generated',
      },
    ],
    { caption: 'How this comparison was run' },
  );

  // Stated rather than left to be noticed. A reader who has seen the format
  // before and finds no analysis in this copy should learn that nobody asked
  // for one, not wonder whether something failed.
  const noAnalysis = cf.analysis
    ? ''
    : renderCallout(
      'neutral',
      'No written analysis was generated',
      p('The figures in this comparison are calculated from each property\'s '
        + 'projection. A written analysis is produced separately and was not '
        + 'requested for this comparison, so nothing here is model-written.'),
    );

  const partial = cf.analysis?.missing.length
    ? renderCallout(
      'neutral',
      'The written analysis is partial',
      p(`The analysis did not supply ${cf.analysis.missing.length} of its `
        + 'sections. Every figure above is unaffected — they are calculated from '
        + 'the projections, not written.'),
    )
    : '';

  return profile + noAnalysis + partial + perProperty + renderCallout(
    'caution',
    'These are projections',
    p('Every figure past year one is the result of applying assumed growth, '
      + 'inflation and interest rates to the year before it. Actual rents, values, '
      + 'rates and tax outcomes will differ, and they will differ by different '
      + 'amounts for different properties — which is a limit on how much weight a '
      + 'comparison of them can carry. This is not financial advice.'),
  );
}

const SECTION_BODY: Record<
  string,
  (cf: CashFlowComparison, palette: ResolvedReportPalette) => string
> = {
  verdict: verdictSection,
  entry: entrySection,
  'cash-flow-matrix': cashFlowMatrixSection,
  'position-matrix': positionMatrixSection,
  measures: measuresSection,
  analysis: analysisSection,
  'each-property': eachPropertySection,
  suits: suitsSection,
  risk: riskSection,
  basis: basisSection,
};

// ── The document ────────────────────────────────────────────────────────────

export interface RenderComparisonInput {
  comparison: CashFlowComparison;
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

/** The cover title: a count and the places, since there is no single subject. */
export function comparisonTitle(cf: CashFlowComparison): string {
  return `${cf.properties.length} properties, ${cf.meta.termYears} years`;
}

/** The body — cover, contents, sections, closing — without the stylesheet. */
export function renderComparisonBody(input: RenderComparisonInput): string {
  const cf = input.comparison;

  const cover = renderCover({
    eyebrow: DOCUMENT_NAME,
    title: comparisonTitle(cf),
    masthead: input.company.name.lead + (input.company.name.tail ? ` ${input.company.name.tail}` : ''),
    edition: input.edition ?? null,
    meta: [
      { label: 'Properties', value: cf.properties.map((x) => x.shortAddress).join(' · ') },
      { label: 'Investor profile', value: cf.meta.investorProfileLabel },
      { label: 'Prepared on', value: formatPreparedOn(cf.meta.preparedOn) },
      ...(cf.meta.clientName ? [{ label: 'Prepared for', value: cf.meta.clientName }] : []),
    ].filter((m) => m.value),
    lockup: input.lockup ?? null,
    heroDataUri: input.heroDataUri ?? null,
    footerLeft: input.confidentiality ?? 'Private and confidential',
    footerRight: input.reference ?? '',
  });

  // Derived from the spine, not counted by hand — so the contents cannot list a
  // section that was not built, or order them differently from how they print.
  const contents = renderContentsPage(
    'Contents',
    contentsEntriesFor(comparisonSpine(cf)).map((e) => ({
      number: e.number,
      title: e.title,
      note: e.note,
    })),
  );

  const body = comparisonSections(cf).map((section, index) => {
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
export function renderComparisonDocument(input: RenderComparisonInput): string {
  const problems = validateComparisonSpine(input.comparison);
  if (problems.length) {
    throw new Error(`${DOCUMENT_NAME} has an invalid structure:\n  ${problems.join('\n  ')}`);
  }

  return renderDocument({
    title: `${DOCUMENT_NAME} — ${comparisonTitle(input.comparison)}`,
    author: input.company.name.lead + (input.company.name.tail ? ` ${input.company.name.tail}` : ''),
    subject: DOCUMENT_NAME,
    css: buildReportCss({
      palette: input.palette,
      options: input.options ?? null,
      masthead: input.masthead,
    }),
    bodyHtml: renderComparisonBody(input),
  });
}

// ── Driven from a brand snapshot ────────────────────────────────────────────

export interface RenderComparisonFromBrandInput {
  comparison: CashFlowComparison;
  /** The brand as it was at generation time — see `documentBrand.pure.ts`. */
  snapshot: ReportBrandSnapshot;
  disclaimer?: CompanyDisclaimer | null;
  /** The **tenant's** cover art, inlined. Never the house art. */
  coverArtDataUri?: string | null;
  options?: Partial<ReportDesignOptions> | null;
  edition?: string | null;
  reference?: string | null;
}

export interface ComparisonRenderResult {
  html: string;
  /** What the brand snapshot was missing. Reported, never thrown. */
  gaps: string[];
}

export function renderComparisonFromBrand(
  input: RenderComparisonFromBrandInput,
): ComparisonRenderResult {
  const brand = resolveSnapshotBrand({
    snapshot: input.snapshot,
    disclaimer: input.disclaimer ?? null,
    coverArtDataUri: input.coverArtDataUri ?? null,
  });

  return {
    html: renderComparisonDocument({
      comparison: input.comparison,
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
