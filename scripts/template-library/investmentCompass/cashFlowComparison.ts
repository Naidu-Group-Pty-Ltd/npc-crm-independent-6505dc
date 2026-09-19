/**
 * The Cash Flow Comparison Analysis, drawn in the ten Investment Compass families.
 *
 * The seventh report format on the family system, and the first that is
 * **preview-only**. It shares `master.ts` with the other six and contributes
 * only its own page sequence — see
 * `docs/template-library/07-investment-compass-families.md`.
 *
 * ## Why there is no adapter, stated once
 *
 * `cashFlowComparisonProjection.pure.ts` carries it in full. The short version:
 * the projections are the browser's and are never persisted; the analysis is
 * never persisted and structurally cannot be (`cash_flow_analyses` holds 0 rows
 * and its INSERT policy refuses this application's own sign-in); and the render
 * ledger — filling now, one succeeded render as of August 2026 — stores
 * neither payload, and is superadmin-only. The stored
 * `financial_calculations.projections` cannot substitute, because every
 * headline measure in this document is built on `afterTaxAnnual` and that
 * series models no tax at all.
 *
 * So these fifty are browsable, previewable and copyable, and they become
 * activatable the day a comparison is persisted somewhere a template can reach
 * — no change to this file, only an adapter calling the projection.
 *
 * ## The document's shape changes with the property count, and that is drawn
 *
 * A comparison holds **2 to 5 properties**, and this format's central tables put
 * one column per property. A five-column table on a two-property comparison
 * prints three empty columns, which reads as a document that failed to finish;
 * a two-column one silently loses three properties.
 *
 * So every property-wide table is drawn **four times, once per count, each under
 * a conditional, all at the same `y`** — the pattern the Property Comparison
 * introduced for its ranking, generalised here into `byPropertyCount()` because
 * this format needs it on five tables rather than one. Exactly one renders.
 *
 * ## What the contract forbids, and these pages honour
 *
 *  - **Model prose names no property.** `propertyNumber` indexes an ordering
 *    that existed inside one function call and was never recorded, so every
 *    model sentence prints unattributed. Rankings are the exception, matched on
 *    an address the model was told to echo — and one that matched nothing says
 *    so on the row.
 *  - **`avoid` is on the risk page, never the ranking page.** Naming a property
 *    to avoid beside the ranking, in a document an adviser may hand to a client
 *    considering that property, is a different act from ranking it last.
 *  - **`highestRisk` stays prose**, never a scoreboard row: an award for being
 *    the worst is not a category anyone wins.
 *  - **The verdict leads with the gap**, not the winner's figure. A 40% lead is
 *    a decision and a 2% lead is a coin toss, and a ranked list says neither.
 *  - **Both break-evens are printed, named apart**, with a note saying which is
 *    which: the modal's is the year cumulative cash flow turns non-negative and
 *    the 10 Year Cash Flow's is the year annual does. They are rarely the same
 *    year and neither screen could see the other.
 *
 * ## The analysis pages are independently conditional
 *
 * `compare-cash-flow-reports` asks for eight sections with `maxTokens: 4000`,
 * and a response that closed its braces early still parses — so a partial
 * analysis is a normal arrival rather than a fault. Each analysis page is gated
 * on its own block; gating them together would drop three present sections
 * because a fourth ran out of budget. A comparison with no analysis at all is a
 * complete, sendable document, and the closing page says so rather than leaving
 * the absence to be noticed.
 */
import {
  DESIGN_FAMILIES,
  resolveManifest,
  type DesignFamily,
  type VariantDefinition,
} from './family';
import {
  beginCompassTemplate,
  callout,
  contents,
  contentTop,
  cover,
  definitions,
  disclaimerPage,
  flow,
  furniture,
  ifItFits,
  kpiCapacity,
  kpis,
  page,
  prose,
  sectionHeading,
  strengthsWatch,
  table,
  textHeight,
  withFurniture,
  type BlockDef,
  type FlowItem,
  type KpiItem,
  type PageDef,
  renderTimePart,
  RENDER_TIME_NUMERAL,
} from './blocks';
import { hasContents } from './resolvers';
import { assembleMaster, type CompassSeedTemplate, type ReportFormat } from './master';
import { STANDARD_DISCLAIMER } from '../designSystem';

/**
 * The running foot.
 *
 * `{{client.name}}` resolves only when **exactly one** client resolves across
 * every property — a comparison spanning two clients' shortlists is a real
 * thing an adviser does, and naming one of them would be wrong. So the foot
 * names the document and the reference instead, both of which always resolve.
 */
const FOOTER = 'Cash flow comparison · {{cashFlowComparison.reference}}';
/*
 * Not "Cash Flow Comparison Analysis". At 29 characters it was the longest
 * running-head label in the catalogue, and on Statement Compact — the family
 * with the narrowest head — it wrapped past the two lines `runningHeadBottom`
 * reserves, spilling 6-7pt of head text into the section heading on the two
 * pages whose own names are longest. The first full QA render found it;
 * nothing shorter is lost, since the cover and every page name still carry
 * the full format name.
 */
const DOCUMENT_LABEL = 'Cash Flow Comparison';

/** `MIN_COMPARED_PROPERTIES` / `MAX_COMPARED_PROPERTIES`, matching the payload. */
const MIN_PROPERTIES = 2;
const MAX_PROPERTIES = 5;

/** Ten, unless the caller says otherwise — and identical across every property. */
const YEARS = 10;

/**
 * The longest each bound field runs.
 *
 * Sized from the payload's own caps rather than from production, because
 * **production has none**: the ledger holds 0 rows and no comparison has ever
 * been persisted. `AnalysisNote.reason` is capped by the normaliser, and these
 * are those caps — which is the safe direction, since a cap is the longest a
 * field can ever be rather than the longest one yet seen.
 */
const LENGTHS = {
  /** `narrative` — two or three sentences the normaliser builds from the figures. */
  narrative: 400,
  /** A model sentence plus whatever figure it attached. */
  note: 300,
  /** `AnalysisRanking.verdict`. */
  verdict: 240,
  /** A strength or weakness bullet. */
  bullet: 140,
  /** An alternative scenario, printed as the model wrote it. */
  scenario: 300,
} as const;

const CASH_FLOW_COMPARISON_FORMAT: ReportFormat = {
  key: 'cash-flow-comparison',
  reportType: 'cash_flow_comparison',
  category: 'comparison',
  tier: 'compass',
  label: 'Cash Flow Comparison Analysis',
  extraTags: ['cash-flow', 'comparison', 'ranking', 'scenarios'],
};

/**
 * Draw a property-wide block once per possible property count.
 *
 * All four variants sit at the same `y` under mutually exclusive conditionals,
 * so exactly one renders and no comparison prints a blank column or loses a
 * property. The item's height is the tallest variant's, so whatever follows
 * clears all of them.
 *
 * The lowest count tests `<=` and the highest `>=`, so a payload outside the
 * 2-5 range the normaliser enforces still draws something rather than nothing.
 */
function byPropertyCount(build: (n: number) => FlowItem): FlowItem {
  const built = [];
  for (let n = MIN_PROPERTIES; n <= MAX_PROPERTIES; n += 1) {
    const when = n === MIN_PROPERTIES
      ? `cashFlowComparison && cashFlowComparison.propertyCount <= ${n}`
      : n === MAX_PROPERTIES
        ? `cashFlowComparison && cashFlowComparison.propertyCount >= ${n}`
        : `cashFlowComparison && cashFlowComparison.propertyCount === ${n}`;
    built.push({ when, item: build(n) });
  }
  const height = Math.max(...built.map((b) => b.item.height));
  return {
    height,
    block: (y): BlockDef[] => built.map((b) => {
      const emitted = b.item.block(y);
      const one = Array.isArray(emitted) ? emitted[0] : emitted;
      return { ...one, conditional: b.when };
    }),
  };
}

/** Column headings for `n` properties: the short address, and which was opened. */
function propertyHeaders(n: number, first = 'Measure'): string[] {
  return [
    first,
    ...Array.from({ length: n }, (_, i) => `{{cashFlowComparison.properties.${i}.shortAddress}}`),
  ];
}

/** Even columns after the label, which takes a third. */
function propertyWidths(n: number, label = 0.3): number[] {
  return [label, ...Array.from({ length: n }, () => (1 - label) / n)];
}

/** One measure across every property. */
function measureRow(n: number, label: string, key: string, filter = '| currency'): string[] {
  return [
    label,
    ...Array.from({ length: n }, (_, i) => `{{cashFlowComparison.properties.${i}.${key} ${filter}}}`),
  ];
}

/** One year of one measure, across every property. */
function yearRow(n: number, year: number, key: string): string[] {
  return [
    `${year + 1}`,
    ...Array.from(
      { length: n },
      (_, i) => `{{cashFlowComparison.properties.${i}.years.${year}.${key} | currency}}`,
    ),
  ];
}

/** One ranked row. Rank, address, and the two figures the ranking is on. */
function rankedRow(i: number): string[] {
  return [
    `{{cashFlowComparison.ranked.${i}.rank}}`,
    `{{cashFlowComparison.ranked.${i}.shortAddress}}`,
    `{{cashFlowComparison.ranked.${i}.totalReturn | currency}}`,
    `{{cashFlowComparison.ranked.${i}.roi | percent}}`,
    `{{cashFlowComparison.ranked.${i}.marker}}`,
  ];
}

/** A page drawn only where its own analysis block arrived. */
function analysisPage(p: PageDef, block: string): PageDef {
  return { ...p, conditional: `cashFlowComparison && cashFlowComparison.analysis && cashFlowComparison.analysis.${block}` };
}

function buildTemplate(family: DesignFamily, variant: VariantDefinition): CompassSeedTemplate {
  const manifest = resolveManifest(family, variant);
  const c = beginCompassTemplate(family, variant, manifest);

  const nextPart = renderTimePart;
  const nextNumeral = (): string => RENDER_TIME_NUMERAL;

  const pages: PageDef[] = [];

  /** The figures across the top of the verdict. The gap leads. */
  /*
   * Every note fits one line in the narrowest KPI cell — about 21 characters
   * at six-up. The band's height model reserves exactly one note line, so a
   * note that wraps renders the band taller than it declared, and on this
   * page the block beneath is the optional narrative: the first full QA
   * render found the band printed 4-21pt over it on nine of the ten
   * families. A short note is the fix that keeps the height model honest.
   */
  const VERDICT_KPIS: KpiItem[] = [
    { label: 'Lead over second', value: '{{cashFlowComparison.scoreboard.leadMargin | percent}}', note: 'Of the top return' },
    // `shortAddress` is prose, not a figure, and it sets at the band's figure
    // size — 30.75pt on Objective. It is `address.split(',')[0]`
    // (`propertyComparison/normalise.pure.ts:166`), so "93 Bimbadeen Avenue"
    // (19) is typical and a unit line is the long end.
    { label: 'Ranked first', value: '{{cashFlowComparison.ranked.0.shortAddress}}', note: 'Ten-year return', valueChars: 30 },
    { label: 'Its total return', value: '{{cashFlowComparison.ranked.0.totalReturn | currency}}', note: 'Gain plus cash flow' },
    { label: 'Properties', value: '{{cashFlowComparison.propertyCount | fixed:0}}', note: 'Over {{cashFlowComparison.termYears}} years' },
    { label: 'Its return on capital', value: '{{cashFlowComparison.ranked.0.roi | percent}}', note: 'On cash invested' },
    { label: 'Profile', value: '{{cashFlowComparison.investorProfile}}', note: 'Ranking made for', valueChars: 24 },
  ];

  // ── 01 Cover ─────────────────────────────────────────────────────────────
  pages.push(cover({
    wordmarkTop: '{{org.name}}',
    wordmarkBottom: 'Cash Flow Comparison',
    tagline: 'Your dedicated property partner',
    marker: 'Comparison',
    eyebrow: 'Cash flow comparison analysis',
    title: '{{cashFlowComparison.propertyCount}} properties, side by side',
    standfirst: 'What each one costs to get into, what it returns over the term, and which comes out ahead.',
    locations: 'Prepared {{report.generatedDate | date}} · {{cashFlowComparison.reference}}',
    facts: [
      { label: 'Ranked first', value: '{{cashFlowComparison.ranked.0.shortAddress}}' },
      { label: 'Lead over second', value: '{{cashFlowComparison.scoreboard.leadMargin | percent}}' },
      { label: 'Term', value: '{{cashFlowComparison.termYears}} years' },
      { label: 'Profile', value: '{{cashFlowComparison.investorProfile}}' },
    ],
  }));

  // ── Contents, where the family declares one ──────────────────────────────
  if (hasContents(manifest.toc_style)) {
    pages.push(withFurniture(page('Contents', [
      ...furniture(DOCUMENT_LABEL, nextPart('Contents'), 'Contents'),
      ...flow([
        sectionHeading({ eyebrow: 'In this comparison', heading: 'Contents', numeral: nextNumeral() }),
        contents([
          'Which comes out ahead',
          'What each costs to get into',
          'The measures side by side',
          'Who leads on what',
          'Cash flow, year by year',
          'Value and equity, year by year',
          'What the analysis found',
          'Each property in turn',
          'Who each property suits',
          'Risk, and what to avoid',
          'On what basis',
          'Important information',
        ]),
      ], contentTop()),
    ]), FOOTER));
  }

  // ── 02 Which comes out ahead ─────────────────────────────────────────────
  //
  // The verdict first, inverting the producer's order, and the KPI band leads
  // with the GAP rather than the winner's figure.
  pages.push(withFurniture(page('Which comes out ahead', [
    ...furniture(DOCUMENT_LABEL, nextPart('Verdict'), 'Which comes out ahead'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'On ten-year total return',
        heading: 'Which comes out ahead',
        numeral: nextNumeral(),
        standfirst: 'Ranked on capital gain plus cumulative cash flow. The lead is stated as a '
          + 'share of the leader’s own return, because a 2% gap and a 40% gap produce the same '
          + 'ordered list and mean entirely different things.',
      }),
      byPropertyCount((n) => table({
        headers: ['Rank', 'Property', 'Total return', 'Return on capital', ''],
        rows: Array.from({ length: n }, (_, i) => rankedRow(i)),
        columnWidths: [0.1, 0.38, 0.2, 0.2, 0.12],
        numeric: [0, 2, 3],
      })),
      kpis(VERDICT_KPIS.slice(0, kpiCapacity())),
    ], [
      // A sentence this format builds from the figures rather than one a model
      // wrote — how many properties, over what term, and what separates them.
      prose('{{cashFlowComparison.narrative}}', textHeight(LENGTHS.narrative, { lineHeight: 1.62 })),
    ], contentTop()), contentTop()),
  ]), FOOTER));

  // ── 03 What each costs to get into ───────────────────────────────────────
  pages.push(withFurniture(page('What each costs to get into', [
    ...furniture(DOCUMENT_LABEL, nextPart('Acquisition'), 'What each costs to get into'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'At settlement',
        heading: 'What each costs to get into',
        numeral: nextNumeral(),
        standfirst: 'Initial investment is the deposit plus every itemised acquisition cost, and '
          + 'it is the denominator of every return below it. A cash purchase with no itemised '
          + 'costs has no denominator, and those ratios are left blank rather than shown as '
          + 'infinite.',
      }),
      byPropertyCount((n) => table({
        headers: propertyHeaders(n, 'Cash in'),
        rows: [
          measureRow(n, 'Initial investment', 'initialInvestment'),
          measureRow(n, 'Return on capital', 'roi', '| percent'),
          measureRow(n, 'Annualised', 'annualisedRoi', '| percent'),
          measureRow(n, 'Cash on cash, year one', 'cashOnCash', '| percent'),
          measureRow(n, 'Equity multiple', 'equityMultiple', '| fixed:2'),
        ],
        columnWidths: propertyWidths(n, 0.32),
      })),
    ], [
      callout(
        'Two break-evens, and they are different questions',
        'The first positive year is when a property stops costing money in that year. The '
          + 'payback year is when everything it has cost has been recovered. They are rarely '
          + 'the same year, and both are printed on the next page.',
        textHeight(280, { size: c.scale.cell, extra: 34 }),
      ),
    ], contentTop()), contentTop()),
  ]), FOOTER));

  // ── 04 The measures side by side ─────────────────────────────────────────
  pages.push(withFurniture(page('The measures side by side', [
    ...furniture(DOCUMENT_LABEL, nextPart('Measures'), 'The measures side by side'),
    ...flow([
      sectionHeading({
        eyebrow: 'At the end of the term',
        heading: 'The measures side by side',
        numeral: nextNumeral(),
      }),
      byPropertyCount((n) => table({
        headers: propertyHeaders(n),
        rows: [
          measureRow(n, 'Ending value', 'endingValue'),
          measureRow(n, 'Ending equity', 'endingEquity'),
          measureRow(n, 'Capital gain', 'capitalGain'),
          measureRow(n, 'Cumulative cash flow', 'cumulativeAfterTax'),
          measureRow(n, 'Total return', 'totalReturn'),
          measureRow(n, 'Gross yield, year one', 'grossYield', '| percent'),
          measureRow(n, 'Net yield, year one', 'netYield', '| percent'),
          measureRow(n, 'Growth assumed', 'capitalGrowthRate', '| percent'),
          measureRow(n, 'First positive year', 'firstPositiveYear', ''),
          measureRow(n, 'Payback year', 'paybackYear', ''),
        ],
        columnWidths: propertyWidths(n, 0.32),
      })),
    ], contentTop()),
  ]), FOOTER));

  // ── 04b Who leads on what ────────────────────────────────────────────────
  //
  // The legacy scoreboard's wins table, which the projection published from
  // the start and no master drew: eight fixed categories — all positive
  // superlatives, no award for being the worst — with the leader resolved to
  // its street line, the figure and the clear air to second place. The labels
  // arrive composed (`valueLabel`, `marginLabel`) because the eight rows mix
  // dollars, percent and years in one column and a template cannot pick one
  // filter for the table. Ties print as the legacy's own "No clear leader"
  // rather than awarding array order.
  pages.push(withFurniture(page('Who leads on what', [
    ...furniture(DOCUMENT_LABEL, nextPart('Leaders'), 'Who leads on what'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'Category by category',
        heading: 'Who leads on what',
        numeral: nextNumeral(),
        standfirst: 'Every measure has a leader, and the margin says whether the lead is worth '
          + 'acting on — a win by $400 over ten years is not a difference to buy on.',
      }),
      table({
        headers: ['Measure', 'Leads', 'Figure', 'Ahead by'],
        rows: Array.from({ length: 8 }, (_, i) => [
          `{{cashFlowComparison.scoreboard.winners.${i}.label}}`,
          `{{cashFlowComparison.scoreboard.winners.${i}.winner}}`,
          `{{cashFlowComparison.scoreboard.winners.${i}.valueLabel}}`,
          `{{cashFlowComparison.scoreboard.winners.${i}.marginLabel}}`,
        ]),
        columnWidths: [0.34, 0.3, 0.19, 0.17],
        // The longest category label, "Fastest to repay its holding costs",
        // wraps in its column.
        wraps: { chars: 34, columnWidth: c.contentWidth * 0.34 },
      }),
    ], [
      // The legacy page closes on this, and it is the right caution to carry:
      // the ranking and the category wins can disagree without either being
      // wrong.
      callout(
        'Two properties can both be right',
        'A ranking on total return combines what a property grew with what it cost to '
        + 'hold, and those two are often in tension. A property that leads several '
        + 'categories here can still rank behind one that leads fewer, bigger ones.',
        textHeight(240, { size: c.scale.cell, extra: 34 }),
      ),
    ], contentTop()), contentTop()),
  ]), FOOTER));

  // ── 05 Cash flow, year by year ───────────────────────────────────────────
  //
  // One measure a page rather than two interleaved. The route's own contract
  // records why: interleaving is 2N rows with two-line labels, which at five
  // properties overflowed the page and stranded the fifth property's rows.
  // Split at every count rather than only when it overflows, so the format
  // does not hand a reader two different-looking documents for one report type.
  pages.push(withFurniture(page('Cash flow, year by year', [
    ...furniture(DOCUMENT_LABEL, nextPart('Cash flow'), 'Cash flow, year by year'),
    ...flow([
      sectionHeading({
        eyebrow: 'After tax, cumulative',
        heading: 'Cash flow, year by year',
        numeral: nextNumeral(),
        standfirst: 'Everything each property has cost or returned, added up to that year. The '
          + 'question this comparison exists for is when each one stops costing money, and '
          + 'whether the curves cross.',
      }),
      byPropertyCount((n) => table({
        headers: propertyHeaders(n, 'Year'),
        rows: Array.from({ length: YEARS }, (_, y) => yearRow(n, y, 'afterTaxCumulative')),
        columnWidths: propertyWidths(n, 0.14),
      })),
    ], contentTop()),
  ]), FOOTER));

  // ── 06 Value and equity, year by year ────────────────────────────────────
  pages.push(withFurniture(page('Value and equity, year by year', [
    ...furniture(DOCUMENT_LABEL, nextPart('Equity'), 'Value and equity, year by year'),
    ...flow([
      sectionHeading({
        eyebrow: 'Equity, by year',
        heading: 'Value and equity, year by year',
        numeral: nextNumeral(),
        standfirst: 'Property value less what is owed on it, at the end of each year.',
      }),
      byPropertyCount((n) => table({
        headers: propertyHeaders(n, 'Year'),
        rows: Array.from({ length: YEARS }, (_, y) => yearRow(n, y, 'equity')),
        columnWidths: propertyWidths(n, 0.14),
      })),
    ], contentTop()),
  ]), FOOTER));

  // ── 07 What the analysis found ───────────────────────────────────────────
  //
  // Model prose, said to be model prose, and naming no property.
  pages.push(analysisPage(withFurniture(page('What the analysis found', [
    ...furniture(DOCUMENT_LABEL, nextPart('Analysis'), 'What the analysis found'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'Written, not calculated',
        heading: 'What the analysis found',
        numeral: nextNumeral(),
        standfirst: 'These findings were written by a model rather than computed. Where one '
          + 'names a figure, the tables above are the record. None of them names a property: '
          + 'the analysis points at properties by a number that was never written down.',
      }),
      prose('{{cashFlowComparison.analysis.summary}}', textHeight(LENGTHS.note * 2, { lineHeight: 1.62 })),
    ], [
      {
        ...definitions('On the trajectory', [
          { term: 'Fastest to positive', definition: '{{cashFlowComparison.analysis.trajectory.fastestPositive.reason}}' },
          { term: 'Strongest growth', definition: '{{cashFlowComparison.analysis.trajectory.strongestGrowth.reason}}' },
        ], LENGTHS.note),
        conditional: 'cashFlowComparison && cashFlowComparison.analysis && cashFlowComparison.analysis.trajectory',
      },
    ], contentTop()), contentTop()),
  ]), FOOTER), 'summary'));

  // ── 08 Growth and yield ──────────────────────────────────────────────────
  pages.push(analysisPage(withFurniture(page('Growth and yield', [
    ...furniture(DOCUMENT_LABEL, nextPart('Growth'), 'Growth and yield'),
    // Capital growth is required; yield is placed only where the variant has
    // room for it. Both blocks at `LENGTHS.note` ran past the footer on eight
    // masters — 5pt on Private Banking's fourth variant and 97pt on Luxury
    // Editorial's third, which is a whole block's worth. The `-03` variants are
    // the spacious ones: they set the same material larger, so they are the
    // first to run out of page, and the seed builder refused to write while any
    // of them did.
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'In the analysis’s words',
        heading: 'Growth and yield',
        numeral: nextNumeral(),
      }),
      {
        ...definitions('Capital growth', [
          { term: 'Strongest equity', definition: '{{cashFlowComparison.analysis.capitalGrowth.strongestEquity.reason}}' },
          { term: 'Wealth builder', definition: '{{cashFlowComparison.analysis.capitalGrowth.wealthBuilder.reason}}' },
        ], LENGTHS.note),
        conditional: 'cashFlowComparison && cashFlowComparison.analysis && cashFlowComparison.analysis.capitalGrowth',
      },
    ], [
      {
        ...definitions('Yield', [
          { term: 'Best gross', definition: '{{cashFlowComparison.analysis.yields.bestGross.reason}}' },
          { term: 'Best net', definition: '{{cashFlowComparison.analysis.yields.bestNet.reason}}' },
          { term: 'Best return', definition: '{{cashFlowComparison.analysis.yields.bestRoi.reason}}' },
        ], LENGTHS.note),
        conditional: 'cashFlowComparison && cashFlowComparison.analysis && cashFlowComparison.analysis.yields',
      },
    ], contentTop()), contentTop()),
  ]), FOOTER), 'capitalGrowth'));

  // ── 09 Each property in turn ─────────────────────────────────────────────
  //
  // The one analysis block that IS attributed, and only because the producer
  // instructs the model to echo the address back. A ranking that matched no
  // property keeps its own text and says so on the row.
  pages.push(analysisPage(withFurniture(page('Each property in turn', [
    ...furniture(DOCUMENT_LABEL, nextPart('Rankings'), 'Each property in turn'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'As the analysis ranked them',
        heading: 'Each property in turn',
        numeral: nextNumeral(),
        standfirst: 'Scores are printed on whatever scale the analysis chose. It named no '
          + 'denominator, so none is shown.',
      }),
      ...Array.from({ length: 3 }, (_, i) => ({
        ...callout(
          `{{cashFlowComparison.analysis.rankings.${i}.address}}`,
          // `matched` is a whole sentence and is absent when the ranking
          // matched a property, so this reads as one paragraph either way —
          // never as a title with a dangling separator on the end of it.
          `{{cashFlowComparison.analysis.rankings.${i}.verdict}} `
            + `{{cashFlowComparison.analysis.rankings.${i}.matched}}`,
          textHeight(LENGTHS.verdict + 90, { size: c.scale.cell, extra: 30 }),
        ),
        conditional: `cashFlowComparison && cashFlowComparison.analysis && cashFlowComparison.analysis.rankings && cashFlowComparison.analysis.rankings[${i}]`,
      })),
    ], [
      // The marks are context rather than argument — the verdicts above carry
      // the page — so they are kept only on the variants with room for them.
      // Three verdicts sized at their cap plus a four-row marks block ran the
      // tightest two variants past the footer, by 1pt and 14pt.
      {
        ...strengthsWatch(
          ['{{cashFlowComparison.analysis.rankings.0.strengths.0}}', '{{cashFlowComparison.analysis.rankings.0.strengths.1}}'],
          ['{{cashFlowComparison.analysis.rankings.0.weaknesses.0}}', '{{cashFlowComparison.analysis.rankings.0.weaknesses.1}}'],
          { strengths: 'Ranked first · strengths', watch: 'Ranked first · weaknesses' },
          LENGTHS.bullet,
        ),
        conditional: 'cashFlowComparison && cashFlowComparison.analysis && cashFlowComparison.analysis.rankings && cashFlowComparison.analysis.rankings[0] && cashFlowComparison.analysis.rankings[0].strengths',
      },
    ], contentTop()), contentTop()),
  ]), FOOTER), 'rankings'));

  // ── 10 Who each property suits ───────────────────────────────────────────
  pages.push(analysisPage(withFurniture(page('Who each property suits', [
    ...furniture(DOCUMENT_LABEL, nextPart('Investor fit'), 'Who each property suits'),
    ...flow([
      sectionHeading({
        eyebrow: 'By investor profile',
        heading: 'Who each property suits',
        numeral: nextNumeral(),
        standfirst: 'Four profiles, as the analysis wrote them. No property is named, for the '
          + 'reason given on the analysis page.',
      }),
      ...Array.from({ length: 4 }, (_, i) => ({
        ...callout(
          `{{cashFlowComparison.analysis.investorMatches.${i}.label}}`,
          `{{cashFlowComparison.analysis.investorMatches.${i}.reason}}`,
          textHeight(LENGTHS.note, { size: c.scale.cell, extra: 30 }),
        ),
        conditional: `cashFlowComparison && cashFlowComparison.analysis && cashFlowComparison.analysis.investorMatches && cashFlowComparison.analysis.investorMatches[${i}]`,
      })),
    ], contentTop()),
  ]), FOOTER), 'investorMatches'));

  // ── 11 Risk, and what to avoid ───────────────────────────────────────────
  //
  // `avoid` is here and deliberately not on the ranking page. `highestRisk`
  // stays prose and never becomes a scoreboard row.
  pages.push(analysisPage(withFurniture(page('Risk, and what to avoid', [
    ...furniture(DOCUMENT_LABEL, nextPart('Risk'), 'Risk, and what to avoid'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'In the analysis’s words',
        heading: 'Risk, and what to avoid',
        numeral: nextNumeral(),
      }),
      {
        ...definitions('Risk', [
          { term: 'Most stable', definition: '{{cashFlowComparison.analysis.risk.mostStable.reason}}' },
          { term: 'Highest risk', definition: '{{cashFlowComparison.analysis.risk.highestRisk.reason}}' },
        ], LENGTHS.note),
        conditional: 'cashFlowComparison && cashFlowComparison.analysis && cashFlowComparison.analysis.risk',
      },
      {
        ...definitions('Not recommended', [
          { term: 'The analysis would avoid', definition: '{{cashFlowComparison.analysis.recommendation.avoid.0.reason}}' },
        ], LENGTHS.note),
        conditional: 'cashFlowComparison && cashFlowComparison.analysis && cashFlowComparison.analysis.recommendation && cashFlowComparison.analysis.recommendation.avoid',
      },
    ], [
      {
        ...definitions('If the brief changed', [
          { term: 'Alternative', definition: '{{cashFlowComparison.analysis.recommendation.scenarios.0}}' },
        ], LENGTHS.scenario),
        conditional: 'cashFlowComparison && cashFlowComparison.analysis && cashFlowComparison.analysis.recommendation && cashFlowComparison.analysis.recommendation.scenarios',
      },
    ], contentTop()), contentTop()),
  ]), FOOTER), 'risk'));

  // ── 12 On what basis ─────────────────────────────────────────────────────
  //
  // Unconditional, and the page that makes a comparison with no analysis a
  // complete document rather than one that appears to be missing pages.
  pages.push(withFurniture(page('On what basis', [
    ...furniture(DOCUMENT_LABEL, nextPart('Basis'), 'On what basis'),
    ...flow([
      sectionHeading({
        eyebrow: 'What this rests on',
        heading: 'On what basis',
        numeral: nextNumeral(),
      }),
      definitions('The comparison', [
        { term: 'Properties compared', definition: '{{cashFlowComparison.propertyCount}}' },
        { term: 'Term', definition: '{{cashFlowComparison.termYears}} years, identical for every property' },
        { term: 'Ranked for', definition: '{{cashFlowComparison.investorProfile}}' },
        { term: 'Reference', definition: '{{cashFlowComparison.reference}}' },
        { term: 'Prepared', definition: '{{report.generatedDate | date}}' },
      ], 90),
      callout(
        'How to read the figures',
        'Every measure here is derived from the same projections the tables print, so no figure '
          + 'in a summary can disagree with the table it summarises. Ratios built on the initial '
          + 'investment are blank where a purchase had no itemised costs.',
        textHeight(300, { size: c.scale.cell, extra: 34 }),
      ),
      // Said out loud rather than left to be noticed: a comparison without an
      // analysis is finished, not truncated.
      {
        ...callout(
          'This comparison carries no written analysis',
          'The figures above are the whole of it, and they are complete. A written analysis is '
            + 'generated separately and was not on this comparison.',
          textHeight(220, { size: c.scale.cell, extra: 34 }),
        ),
        conditional: '!(cashFlowComparison && cashFlowComparison.hasAnalysis)',
      },
    ], contentTop()),
  ]), FOOTER));

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  return assembleMaster({ family, variant, manifest, c, pages, format: CASH_FLOW_COMPARISON_FORMAT });
}

/** Every Cash Flow Comparison master, by family, in catalogue order. */
export const CASH_FLOW_COMPARISON_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);
