/**
 * The Portfolio Performance Review, drawn in the ten Investment Compass families.
 *
 * The third report format on the family system, after Investment Compass and
 * the Borrowing Capacity Snapshot. It shares `master.ts` with both and
 * contributes only its own page sequence — see
 * `docs/template-library/07-investment-compass-families.md`.
 *
 * ## The inventory is bounded on purpose
 *
 * `docs/reports/PORTFOLIO.md` opens on four findings against the shipping
 * generator, and two of them are about this page model failing to hold a
 * portfolio: **F1**, a contents page whose numbers go out of true the moment a
 * table spills; and **F4**, an inventory that silently drops rows because the
 * continuation index is computed at a row height of 20 while the table was
 * drawn at 22, "and the rows in between are never printed… a portfolio needing
 * a third page loses everything past the second, with nothing on the page
 * saying so".
 *
 * This template model cannot paginate at all — blocks are absolutely positioned
 * and nothing reflows — so it must not pretend to. The inventory is drawn at
 * **three depths under mutually exclusive conditionals** up to the observed
 * maximum of four rows (`total_properties` runs 1–4 across all 21 stored
 * reports), and the page says what it is showing when a portfolio exceeds the
 * deepest. Silently truncating a fifth property would reproduce F4 in a new
 * generator, which is the one outcome this migration exists to prevent.
 *
 * ## The legacy document's sections, as conditional pages
 *
 * Everything `buildPortfolioReview` composes now has a page, in the legacy
 * spine's own order, each conditional on the projection having published its
 * namespace: composition, the per-property verdicts (the ranking beside the
 * review's own scoring), capacity utilisation, market conditions, the
 * ten-year projection and its assumptions, the four growth avenues, the
 * review wizard's scenarios and the review record itself. Presence across
 * the 21 stored reports runs from 9 (market, capacity) to 21 (composition,
 * growth, verdicts, projection), so the common render is most of the
 * document rather than a stub. Sections the fixed-page model cannot hold in
 * full are excerpted with the omission said on the page — two options per
 * growth avenue, the first outlook — and the merged action plan is published
 * (`portfolio.actionPlan`) but deliberately unbound: twenty-one rows of
 * 345-character titles measured out at over two pages, and an excerpt of a
 * priority-ordered list would silently drop the review's own entries.
 *
 * ## Prose is bound only where the leaf is a string
 *
 * `analysis.executiveSummary` and `strategicRecommendations` are **objects**,
 * not paragraphs. The projection only publishes leaves that are genuinely
 * strings, so nothing here can reach a page as `[object Object]`.
 *
 * ## Conditionals are JavaScript, not binding paths
 *
 * `{{portfolio.growth.groups.0.items.0}}` is a binding; a page conditional is
 * an expression, and `groups.0.items` is a **syntax error** there — the eval
 * fails, the guard logs and answers false, and the page is silently dark on
 * every render. Every numeric segment in a conditional below is bracketed
 * (`groups[0].items.length`), and the catalogue spec evaluates each one.
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
  ifItFits,
  cover,
  definitions,
  disclaimerPage,
  flow,
  furniture,
  kpiCapacity,
  kpis,
  oneOf,
  page,
  prose,
  recommendation,
  remainingAfter,
  rule,
  sectionHeading,
  strengthsWatch,
  table,
  textHeight,
  withFurniture,
  type KpiItem,
  type PageDef,
  renderTimePart,
  RENDER_TIME_NUMERAL,
} from './blocks';
import { hasContents } from './resolvers';
import { assembleMaster, type CompassSeedTemplate, type ReportFormat } from './master';
import { STANDARD_DISCLAIMER } from '../designSystem';

const FOOTER = '{{client.name}} · Portfolio performance review';
const DOCUMENT_LABEL = 'Portfolio Performance Review';

/** The observed maximum across all 21 stored reports. See the header. */
const INVENTORY_ROWS = 4;

/**
 * The longest each bound field runs across the 21 stored reports.
 *
 * These are measurements, not estimates, and they are what every height on
 * these pages is built from — see `textHeight` in `blocks.ts` for why a height
 * that is too small does not overflow the page but lays one block over the
 * next, invisibly to the arithmetic guard.
 *
 * The numbers are also the argument against reading a field's shape from its
 * name: `financialHealth.lvrRisk` is 3-6 characters ("Low") while
 * `financialHealth.analysis`, two keys away in the same object, is 458-1620.
 * The first draft of this format reserved one line for each of them.
 */
const LENGTHS = {
  primaryRecommendation: 459,
  strength: 143,
  concern: 196,
  /** The long one. 458 at its shortest. */
  healthAnalysis: 1620,
  /** "Positive", "Comfortable", "Strong", "Low" — one word each. */
  healthStatus: 11,
  exposure: 456,
  marketRisk: 164,
  mitigation: 188,
  priorityAction: 187,
  horizonAction: 345,
  /*
   * The legacy document's sections, measured by running all 21 stored reports
   * (each paired with its client's newest completed review — the join
   * `render-portfolio-review-pdf` itself performs) through the legacy
   * `buildPortfolioReview`. Every one is the maximum the engine produced.
   */
  /** `describePortfolio` — built from the totals, so bounded by construction. */
  overview: 170,
  compositionParagraph: 599,
  compositionRecommendation: 246,
  /** The two market paragraphs and two labelled facts are the format's longest prose. */
  marketParagraph: 1217,
  marketFact: 1088,
  verdictRecommendation: 462,
  verdictOutlook: 437,
  projectionSummary: 568,
  projectionAssumption: 233,
  capacityCommentary: 731,
  growthItem: 358,
  reviewSummary: 176,
  reviewFinding: 51,
  scenarioDescription: 50,
} as const;

const PORTFOLIO_FORMAT: ReportFormat = {
  key: 'portfolio-review',
  reportType: 'portfolio',
  category: 'portfolio',
  tier: 'compass',
  label: 'Portfolio Performance Review',
  extraTags: ['portfolio', 'performance-review', 'holdings'],
};

/**
 * The figures across the top of the summary.
 *
 * `summary.healthScore` is a score **out of 100** (25–90 across the sample), not
 * a percentage — so it is set with `| fixed:0` and labelled, never `| percent`.
 */
const SUMMARY_KPIS: KpiItem[] = [
  { label: 'Portfolio value', value: '{{portfolio.value | currency}}', note: '{{portfolio.propertyCount}} properties' },
  { label: 'Total equity', value: '{{portfolio.equity | currency}}', note: 'Value less debt' },
  { label: 'Health score', value: '{{summary.healthScore | fixed:0}}', note: 'out of 100 · {{summary.overallHealth}}' },
  { label: 'Monthly cash flow', value: '{{portfolio.monthlyCashflow | currency}}', note: '{{portfolio.annualCashflow | currency}} p.a.' },
  { label: 'Average LVR', value: '{{portfolio.averageLvr | percent}}', note: 'Across the portfolio' },
  { label: 'Average yield', value: '{{portfolio.averageYield | percent}}', note: 'Gross, on value' },
];

/** One inventory row, bound by index. */
function propertyRow(i: number): string[] {
  return [
    `{{properties.${i}.address}}`,
    `{{properties.${i}.value | currency}}`,
    `{{properties.${i}.loan | currency}}`,
    `{{properties.${i}.lvr | percent:0}}`,
    `{{properties.${i}.grossYield | percent}}`,
    `{{properties.${i}.netMonthlyCashflow | currency}}`,
  ];
}

function buildTemplate(family: DesignFamily, variant: VariantDefinition): CompassSeedTemplate {
  const manifest = resolveManifest(family, variant);
  const c = beginCompassTemplate(family, variant, manifest);
  const spacious = manifest.density === 'spacious';

  const nextPart = renderTimePart;
  const nextNumeral = (): string => RENDER_TIME_NUMERAL;

  const pages: PageDef[] = [];

  // ── 01 Cover ─────────────────────────────────────────────────────────────
  pages.push(cover({
    wordmarkTop: '{{org.name}}',
    wordmarkBottom: 'Portfolio Review',
    tagline: 'Your dedicated property partner',
    marker: 'Portfolio Review',
    eyebrow: 'Portfolio performance review',
    title: '{{client.name}}',
    standfirst: 'How the holdings are performing, what is carrying them, and what would move them.',
    locations: 'Prepared {{report.generatedDate | date}}',
    facts: [
      { label: 'Portfolio value', value: '{{portfolio.value | currency}}' },
      { label: 'Properties', value: '{{portfolio.propertyCount}}' },
      { label: 'Health', value: '{{summary.overallHealth}}' },
      { label: 'Monthly position', value: '{{portfolio.monthlyCashflow | currency}}' },
    ],
  }));

  // ── Contents, where the family declares one ──────────────────────────────
  if (hasContents(manifest.toc_style)) {
    pages.push(withFurniture(page('Contents', [
      ...furniture(DOCUMENT_LABEL, nextPart('Contents'), 'Contents'),
      ...flow([
        sectionHeading({ eyebrow: 'In this review', heading: 'Contents', numeral: nextNumeral() }),
        // Section names, not page names — the renderer writes the real list
        // from the rendered pages, so this is a size floor. Fourteen entries
        // plus the block's own slack reserves 22 rows, which covers the 21
        // content pages and the contents page of a fully-lit review without
        // the reserve itself running this page past the footer, which is what
        // a fifteen-entry list did on `ap-03`.
        contents([
          'The portfolio at a glance',
          'What the portfolio is made of',
          'Holdings',
          'How each property is performing',
          'Financial health',
          'The analysis',
          'Risk assessment',
          'Managing the risk',
          'Borrowing capacity and headroom',
          'Market conditions',
          'The ten-year outlook',
          'Growth opportunities',
          'Recommended actions',
          'This review',
        ]),
      ], contentTop()),
    ]), FOOTER));
  }

  // ── 02 At a glance ───────────────────────────────────────────────────────
  pages.push(withFurniture(page('Portfolio at a glance', [
    ...furniture(DOCUMENT_LABEL, nextPart('Overview'), 'Portfolio at a glance'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'The position',
        heading: '{{summary.overallHealth}}',
        headingChars: LENGTHS.healthStatus,
        numeral: nextNumeral(),
        // The legacy document's own two-sentence description — built from the
        // totals by `describePortfolio`, so it cannot disagree with the tables
        // it sits above. Bounded by construction at ~170 characters, which is
        // what `standfirstChars` has to say out loud: the binding's own source
        // text is 22 characters, and sizing the band from that is what clipped
        // the eyebrow off the top of this page on six of the ten families.
        standfirst: '{{portfolio.overview}}',
        standfirstChars: LENGTHS.overview,
      }),
      // Things the document says out loud — that owner-occupied holdings are
      // excluded from the figures, or that the review it draws on is a draft.
      // Zero or one note across all 21 stored reports.
      {
        ...callout('Worth knowing', '{{portfolio.notes.0}}'),
        conditional: 'portfolio && portfolio.notes',
      },
      // NOT a `verdict()`. That block sets its heading at display size and
      // reserves about two lines for it, which is right for "Proceed to offer
      // at or below $1.29m" and wrong for this: `primaryRecommendation` runs
      // 147-459 characters across the 21 stored reports. A callout sized from
      // the longest of them prints the whole sentence at body size.
      callout(
        'Primary recommendation',
        '{{summary.primaryRecommendation}}',
        textHeight(LENGTHS.primaryRecommendation, { size: c.scale.cell, extra: 34 }),
      ),
      kpis(SUMMARY_KPIS.slice(0, kpiCapacity())),
    ], [
      // Context rather than argument, so it appears on the variants with room
      // and is dropped on the tight ones rather than pushing them past the
      // footer. Its first rows are whatever the family's KPI arrangement could
      // not hold — `kpi_layout` runs 4-6 across the ten families — so no figure
      // is ever stated twice on one page.
      table({
        headers: ['Composition', 'Amount'],
        rows: [
          ...SUMMARY_KPIS.slice(kpiCapacity()).map((k) => [k.label, k.value]),
          ['Investment properties', '{{portfolio.investmentCount}}'],
          ['Owner-occupied', '{{portfolio.ownerOccupiedCount}}'],
          ['Monthly rental income', '{{portfolio.monthlyRentalIncome | currency}}'],
          ['Monthly expenses', '{{portfolio.monthlyExpenses | currency}}'],
        ],
        columnWidths: [0.62, 0.38],
      }),
    ], contentTop()), contentTop()),
  ]), FOOTER));

  // ── 02b What the portfolio is made of ────────────────────────────────────
  //
  // The legacy document's composition section, present on all 21 stored
  // reports: two model-authored paragraphs (the property mix and the asset
  // allocation, ≤599 characters each) and a two-to-three item "What we
  // recommend" list (≤246 each). The recommendations ride `ifItFits`, so the
  // tight families keep the paragraphs — the section's argument — and the
  // spacious ones carry the list too.
  pages.push({
    ...withFurniture(page('What the portfolio is made of', [
      ...furniture(DOCUMENT_LABEL, nextPart('Composition'), 'What the portfolio is made of'),
      ...flow(ifItFits([
        sectionHeading({
          eyebrow: 'The mix',
          heading: 'What the portfolio is made of',
          numeral: nextNumeral(),
        }),
        prose('{{portfolio.composition.paragraphs.0}}', textHeight(LENGTHS.compositionParagraph)),
        prose('{{portfolio.composition.paragraphs.1}}', textHeight(LENGTHS.compositionParagraph)),
      ], [
        // Two or three recommendations across the record; a fixed three-row
        // list would strand a ruled "Third" beside nothing on the two-item
        // reports.
        oneOf(
          {
            when: 'portfolio && portfolio.composition && portfolio.composition.groups'
              + ' && portfolio.composition.groups[0].items.length <= 2',
            item: definitions('What we recommend', [
              { term: 'First', definition: '{{portfolio.composition.groups.0.items.0}}' },
              { term: 'Second', definition: '{{portfolio.composition.groups.0.items.1}}' },
            ], LENGTHS.compositionRecommendation),
          },
          {
            when: 'portfolio && portfolio.composition && portfolio.composition.groups'
              + ' && portfolio.composition.groups[0].items.length > 2',
            item: definitions('What we recommend', [
              { term: 'First', definition: '{{portfolio.composition.groups.0.items.0}}' },
              { term: 'Second', definition: '{{portfolio.composition.groups.0.items.1}}' },
              { term: 'Third', definition: '{{portfolio.composition.groups.0.items.2}}' },
            ], LENGTHS.compositionRecommendation),
          },
        ),
      ], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'portfolio && portfolio.composition',
  });

  // ── 03 Holdings ──────────────────────────────────────────────────────────
  pages.push(withFurniture(page('Holdings', [
    ...furniture(DOCUMENT_LABEL, nextPart('Holdings'), 'Holdings'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'The inventory',
        heading: 'Every property, and what it contributes',
        numeral: nextNumeral(),
        standfirst: `This page draws up to ${INVENTORY_ROWS} holdings. A blank row is a `
          + 'property the portfolio does not have, not one left out here.',
      }),
      /*
       * Three depths under mutually exclusive conditionals: the 21 stored
       * portfolios hold one property twice, three twelve times and four seven
       * times, so a fixed four-row table ruled off three empty rows beneath a
       * tenth of the record. A two-property portfolio draws the three-row
       * depth with one empty row, which is the cost of not authoring a depth
       * per count.
       */
      oneOf(
        {
          when: 'properties && properties.length <= 1',
          item: table({
            headers: ['Property', 'Value', 'Loan', 'LVR', 'Yield', 'Monthly'],
            rows: [propertyRow(0)],
            columnWidths: [0.31, 0.15, 0.15, 0.11, 0.12, 0.16],
          }),
        },
        {
          when: 'properties && properties.length > 1 && properties.length <= 3',
          item: table({
            headers: ['Property', 'Value', 'Loan', 'LVR', 'Yield', 'Monthly'],
            rows: Array.from({ length: 3 }, (_, i) => propertyRow(i)),
            columnWidths: [0.31, 0.15, 0.15, 0.11, 0.12, 0.16],
          }),
        },
        {
          when: 'properties && properties.length > 3',
          item: table({
            headers: ['Property', 'Value', 'Loan', 'LVR', 'Yield', 'Monthly'],
            rows: Array.from({ length: INVENTORY_ROWS }, (_, i) => propertyRow(i)),
            columnWidths: [0.31, 0.15, 0.15, 0.11, 0.12, 0.16],
          }),
        },
      ),
      // The last row totals the Monthly column of the table above it. Rent and
      // expenses are stated once, on the overview — repeating them here would
      // put the same three figures on two facing pages.
      table({
        headers: ['Portfolio totals', 'Amount'],
        rows: [
          ['Total value', '{{portfolio.value | currency}}'],
          ['Total debt', '{{portfolio.debt | currency}}'],
          ['Total equity', '{{portfolio.equity | currency}}'],
          ['Net monthly position', '{{portfolio.monthlyCashflow | currency}}'],
        ],
        columnWidths: [0.62, 0.38],
        totals: [3],
      }),
      // F4, said out loud. The finding against the shipping generator is not
      // that it truncates — a fixed-position page model has to stop somewhere —
      // it is that it truncates "with nothing on the page saying so". This
      // costs its height whether or not it renders, which is the price of a
      // conditional in a layout that cannot reflow, and it is worth paying.
      {
        ...callout(
          'This page does not show the whole portfolio',
          `The portfolio holds {{portfolio.propertyCount}} properties and the table above draws `
            + `${INVENTORY_ROWS}. The remaining holdings are covered by the totals and by the `
            + 'analysis that follows.',
        ),
        conditional: `portfolio && portfolio.propertyCount > ${INVENTORY_ROWS}`,
      },
    ], [
      // The two standouts, where the variant has room. Addresses, so short.
      callout('Best performer', '{{portfolio.bestPerformer.address}} — '
        + '{{portfolio.bestPerformer.netMonthlyCashflow | currency}} a month on a '
        + '{{portfolio.bestPerformer.value | currency}} holding.'),
      callout('Needs attention', '{{portfolio.worstPerformer.address}} — '
        + '{{portfolio.worstPerformer.netMonthlyCashflow | currency}} a month on a '
        + '{{portfolio.worstPerformer.value | currency}} holding.'),
    ], contentTop()), contentTop()),
  ]), FOOTER));

  // ── 03b How each property is performing ──────────────────────────────────
  //
  // The legacy performance section's ranking: the analysis's rating and the
  // review's score and classification, side by side per property — the two are
  // produced independently and do disagree, and the disagreement is something
  // the reader should see, which is why both columns are attributed. Present
  // on all 21 stored reports; one to four verdicts, clustered at three.
  {
    const verdictRow = (i: number) => [
      `{{portfolio.verdicts.rows.${i}.address}}`,
      `{{portfolio.verdicts.rows.${i}.rating}}`,
      `{{portfolio.verdicts.rows.${i}.scoreLabel}}`,
      `{{portfolio.verdicts.rows.${i}.reviewClassification}}`,
    ];
    const rankingTable = (n: number) => table({
      headers: ['Property', 'Analysis says', 'Score /100', 'Review says'],
      rows: Array.from({ length: n }, (_, i) => verdictRow(i)),
      columnWidths: [0.42, 0.22, 0.14, 0.22],
      // Addresses run to ~40 characters and ratings to 28; both wrap to two
      // lines in their columns on real rows.
      wraps: { chars: 42, columnWidth: c.contentWidth * 0.42 },
    });
    pages.push({
      ...withFurniture(page('How each property is performing', [
        ...furniture(DOCUMENT_LABEL, nextPart('Performance'), 'How each property is performing'),
        ...flow([
          sectionHeading({
            eyebrow: 'The ranking',
            heading: 'How each property is performing',
            numeral: nextNumeral(),
          }),
          oneOf(
            { when: 'portfolio && portfolio.verdicts && portfolio.verdicts.rows && portfolio.verdicts.rows.length <= 1', item: rankingTable(1) },
            { when: 'portfolio && portfolio.verdicts && portfolio.verdicts.rows && portfolio.verdicts.rows.length > 1 && portfolio.verdicts.rows.length <= 3', item: rankingTable(3) },
            { when: 'portfolio && portfolio.verdicts && portfolio.verdicts.rows && portfolio.verdicts.rows.length == 4', item: rankingTable(4) },
            { when: 'portfolio && portfolio.verdicts && portfolio.verdicts.rows && portfolio.verdicts.rows.length > 4', item: rankingTable(6) },
          ),
          // The top-ranked property's outlook, where the analysis wrote one —
          // 30 of the 66 stored verdicts carry it, at up to 437 characters.
          {
            ...callout(
              'The outlook for the lead holding',
              '{{portfolio.verdicts.rows.0.outlook}}',
              textHeight(LENGTHS.verdictOutlook, { size: c.scale.cell, extra: 34 }),
            ),
            conditional: 'portfolio && portfolio.verdicts && portfolio.verdicts.rows && portfolio.verdicts.rows[0] && portfolio.verdicts.rows[0].outlook',
          },
        ], contentTop()),
      ]), FOOTER),
      conditional: 'portfolio && portfolio.verdicts && portfolio.verdicts.rows',
    });
  }

  // ── 03c What each property needs ─────────────────────────────────────────
  //
  // The per-property recommendation, verbatim from the ranking — 99 to 462
  // characters each. Three fit a page at the measured maximum; the fourth
  // verdict moves to a continuation page rather than shrinking the reserve
  // below what the text can set to, which is the overlap class the guard
  // cannot see.
  {
    const needRows = (from: number, to: number) => definitions(
      from === 0 ? 'Property by property' : 'Property by property, continued',
      Array.from({ length: to - from }, (_, i) => ({
        term: `{{portfolio.verdicts.rows.${from + i}.address}}`,
        definition: `{{portfolio.verdicts.rows.${from + i}.recommendation}}`,
      })),
      LENGTHS.verdictRecommendation,
    );
    pages.push({
      ...withFurniture(page('What each property needs', [
        ...furniture(DOCUMENT_LABEL, nextPart('Actions per holding'), 'What each property needs'),
        ...flow([
          sectionHeading({
            eyebrow: 'Property by property',
            heading: 'What each property needs',
            numeral: nextNumeral(),
          }),
          oneOf(
            { when: 'portfolio && portfolio.verdicts && portfolio.verdicts.rows && portfolio.verdicts.rows.length <= 1', item: needRows(0, 1) },
            { when: 'portfolio && portfolio.verdicts && portfolio.verdicts.rows && portfolio.verdicts.rows.length == 2', item: needRows(0, 2) },
            { when: 'portfolio && portfolio.verdicts && portfolio.verdicts.rows && portfolio.verdicts.rows.length > 2', item: needRows(0, 3) },
          ),
        ], contentTop()),
      ]), FOOTER),
      conditional: 'portfolio && portfolio.verdicts && portfolio.verdicts.rows',
    });
    pages.push({
      ...withFurniture(page('What each property needs, continued', [
        ...furniture(DOCUMENT_LABEL, nextPart('Actions per holding'), 'What each property needs'),
        ...flow([
          sectionHeading({
            eyebrow: 'Property by property, continued',
            heading: 'The remaining holdings',
            numeral: nextNumeral(),
          }),
          oneOf(
            { when: 'portfolio && portfolio.verdicts && portfolio.verdicts.rows && portfolio.verdicts.rows.length == 4', item: needRows(3, 4) },
            { when: 'portfolio && portfolio.verdicts && portfolio.verdicts.rows && portfolio.verdicts.rows.length == 5', item: needRows(3, 5) },
            { when: 'portfolio && portfolio.verdicts && portfolio.verdicts.rows && portfolio.verdicts.rows.length > 5', item: needRows(3, 6) },
          ),
        ], contentTop()),
      ]), FOOTER),
      conditional: 'portfolio && portfolio.verdicts && portfolio.verdicts.rows && portfolio.verdicts.rows.length > 3',
    });
  }

  // ── 04 Financial health ──────────────────────────────────────────────────
  //
  // Four one-word statuses and one long paragraph, which is not what the field
  // names suggest and is what the table holds.
  pages.push(withFurniture(page('Financial health', [
    ...furniture(DOCUMENT_LABEL, nextPart('Health'), 'Financial health'),
    ...flow([
      sectionHeading({
        eyebrow: 'Serviceability and equity',
        heading: 'How the portfolio is holding up',
        numeral: nextNumeral(),
      }),
      definitions('Assessment', [
        { term: 'Cash flow', definition: '{{health.cashflowStatus}}' },
        { term: 'Debt serviceability', definition: '{{health.debtServiceability}}' },
        { term: 'Equity position', definition: '{{health.equityPosition}}' },
        { term: 'LVR risk', definition: '{{health.lvrRisk}}' },
      ], LENGTHS.healthStatus),
      // Three and two: the observed minimums across the 21 stored reports are
      // 3 strengths and 2 concerns, so neither column draws a row the analysis
      // did not write.
      strengthsWatch(
        ['{{summary.strengths.0}}', '{{summary.strengths.1}}', '{{summary.strengths.2}}'],
        ['{{summary.concerns.0}}', '{{summary.concerns.1}}'],
        undefined,
        LENGTHS.concern,
      ),
    ], contentTop()),
  ]), FOOTER));

  // ── 05 The analysis ──────────────────────────────────────────────────────
  //
  // Its own page because of its size: `financialHealth.analysis` runs 458-1620
  // characters, which is up to 262pt of set text — more than any other block in
  // the format and more than fits under the assessment above.
  pages.push(withFurniture(page('The analysis', [
    ...furniture(DOCUMENT_LABEL, nextPart('Analysis'), 'The analysis'),
    ...flow([
      sectionHeading({
        eyebrow: 'In full',
        heading: 'What the numbers add up to',
        numeral: nextNumeral(),
      }),
      prose('{{health.analysis}}', textHeight(LENGTHS.healthAnalysis, { lineHeight: 1.62 })),
    ], contentTop()),
  ]), FOOTER));

  // ── 05 Risk ──────────────────────────────────────────────────────────────
  pages.push(withFurniture(page('Risk assessment', [
    ...furniture(DOCUMENT_LABEL, nextPart('Risk'), 'Risk assessment'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'Exposure',
        heading: '{{risk.overallRiskLevel}}',
        // "Low" / "Moderate" / "High", the same one-word scale as the health
        // status this format already measured.
        headingChars: LENGTHS.healthStatus,
        numeral: nextNumeral(),
      }),
      // The stored leaf names, not shortened ones. `{{risk.vacancy}}` already
      // means "reaction to three months vacancy" to the voice templates, and
      // one namespace cannot carry both senses — see the note in
      // `portfolioProjection.pure.ts`.
      //
      // These three are paragraphs of 131-456 characters, not the one-liners a
      // definition list reserves by default. The other two fields of the same
      // object are LISTS, and are drawn on the page that follows.
      definitions('Where the exposure sits', [
        { term: 'Concentration', definition: '{{risk.concentrationRisk}}' },
        { term: 'Vacancy', definition: '{{risk.vacancyRisk}}' },
        { term: 'Interest rate', definition: '{{risk.interestRateSensitivity}}' },
      ], LENGTHS.exposure),
    ], [rule()], contentTop()), contentTop()),
  ]), FOOTER));

  // ── 06 Mitigation ────────────────────────────────────────────────────────
  pages.push(withFurniture(page('Managing the risk', [
    ...furniture(DOCUMENT_LABEL, nextPart('Mitigation'), 'Managing the risk'),
    ...flow([
      sectionHeading({
        eyebrow: 'What is being done about it',
        heading: 'Managing the risk',
        numeral: nextNumeral(),
      }),
      // The exposures against what is being done about them: the same
      // positive/caution reading the summary page uses, relabelled. Counts are
      // the observed minimums — 4 mitigations and 2 market risks — so neither
      // column draws a row the analysis did not write.
      strengthsWatch(
        [
          '{{risk.mitigationStrategies.0}}',
          '{{risk.mitigationStrategies.1}}',
          '{{risk.mitigationStrategies.2}}',
          '{{risk.mitigationStrategies.3}}',
        ],
        ['{{risk.marketRisks.0}}', '{{risk.marketRisks.1}}'],
        { strengths: 'Mitigation', watch: 'Market risks' },
        Math.max(LENGTHS.mitigation, LENGTHS.marketRisk),
      ),
    ], contentTop()),
  ]), FOOTER));

  // ── 07 Borrowing capacity and headroom ───────────────────────────────────
  //
  // The legacy capacity-utilisation section, on 9 of the 21 stored reports:
  // four engine-formatted figures and a model-written commentary of up to 731
  // characters.
  pages.push({
    ...withFurniture(page('Borrowing capacity and headroom', [
      ...furniture(DOCUMENT_LABEL, nextPart('Capacity'), 'Borrowing capacity and headroom'),
      ...flow([
        sectionHeading({
          eyebrow: 'Headroom',
          heading: 'How much capacity is deployed',
          numeral: nextNumeral(),
        }),
        definitions('Utilisation', [
          { term: 'Estimated capacity', definition: '{{portfolio.capacity.estimatedLabel}}' },
          { term: 'Debt deployed', definition: '{{portfolio.capacity.deployedLabel}}' },
          { term: 'Available capacity', definition: '{{portfolio.capacity.availableLabel}}' },
          { term: 'Utilisation', definition: '{{portfolio.capacity.utilisationLabel}}' },
        ]),
        prose('{{portfolio.capacity.commentary}}', textHeight(LENGTHS.capacityCommentary)),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'portfolio && portfolio.capacity',
  });

  // ── 07b Market conditions ────────────────────────────────────────────────
  //
  // The longest prose in the format: two paragraphs (the market cycle and the
  // client's position in it, up to 1,217 characters each) and two labelled
  // facts (the lending environment and the RBA outlook, up to 1,088 each).
  // Present on 9 of 21 reports. One paragraph and one fact a page — two
  // paragraphs together ran the spacious families 30pt past the footer, and
  // two pages of one-and-one carry the same four blocks in balance.
  pages.push({
    ...withFurniture(page('Market conditions', [
      ...furniture(DOCUMENT_LABEL, nextPart('Market'), 'Market conditions'),
      ...flow([
        sectionHeading({
          eyebrow: 'The cycle',
          heading: 'Where the market is',
          numeral: nextNumeral(),
        }),
        prose('{{portfolio.market.paragraphs.0}}', textHeight(LENGTHS.marketParagraph)),
        // The facts carry their own labels, so the callout titles bind rather
        // than restate them — a re-typed label drifts from the data it names.
        {
          ...callout(
            '{{portfolio.market.facts.0.label}}',
            '{{portfolio.market.facts.0.value}}',
            textHeight(LENGTHS.marketFact, { size: c.scale.cell, extra: 34 }),
          ),
          conditional: 'portfolio && portfolio.market && portfolio.market.facts',
        },
      ], contentTop()),
    ]), FOOTER),
    conditional: 'portfolio && portfolio.market && portfolio.market.paragraphs',
  });
  pages.push({
    ...withFurniture(page('Your position in it', [
      ...furniture(DOCUMENT_LABEL, nextPart('Market'), 'Your position in it'),
      ...flow([
        sectionHeading({
          eyebrow: 'The cycle, continued',
          heading: 'Your position in it',
          numeral: nextNumeral(),
        }),
        prose('{{portfolio.market.paragraphs.1}}', textHeight(LENGTHS.marketParagraph)),
        {
          ...callout(
            '{{portfolio.market.facts.1.label}}',
            '{{portfolio.market.facts.1.value}}',
            textHeight(LENGTHS.marketFact, { size: c.scale.cell, extra: 34 }),
          ),
          conditional: 'portfolio && portfolio.market && portfolio.market.facts && portfolio.market.facts[1]',
        },
      ], contentTop()),
    ]), FOOTER),
    conditional: 'portfolio && portfolio.market && portfolio.market.paragraphs && portfolio.market.paragraphs[1]',
  });

  // ── 07c The ten-year outlook ─────────────────────────────────────────────
  //
  // The legacy projection block, on all 21 stored reports. The figures come
  // engine-formatted; the plain-English summary exists on roughly half.
  pages.push({
    ...withFurniture(page('The ten-year outlook', [
      ...furniture(DOCUMENT_LABEL, nextPart('Outlook'), 'The ten-year outlook'),
      ...flow([
        sectionHeading({
          eyebrow: 'If the assumptions hold',
          heading: 'Where the portfolio goes',
          numeral: nextNumeral(),
        }),
        definitions('The projection', [
          { term: 'Horizon', definition: '{{portfolio.projection.yearsLabel}}' },
          { term: 'Projected value', definition: '{{portfolio.projection.valueLabel}}' },
          { term: 'Projected equity', definition: '{{portfolio.projection.equityLabel}}' },
          { term: 'Projected cash flow', definition: '{{portfolio.projection.cashflowLabel}}' },
        ]),
        {
          ...prose('{{portfolio.projection.summary}}', textHeight(LENGTHS.projectionSummary)),
          conditional: 'portfolio && portfolio.projection && portfolio.projection.summary',
        },
      ], contentTop()),
    ]), FOOTER),
    conditional: 'portfolio && portfolio.projection',
  });

  // ── 07d What the projection assumes ──────────────────────────────────────
  //
  // Three to six assumptions of up to 233 characters. Their own page: six
  // wrapped rows beneath the figures did not fit the tight families, and an
  // assumption clipped mid-sentence reads as a rendering fault.
  {
    const assumptionRows = (n: number) => table({
      headers: ['Assumption'],
      rows: Array.from({ length: n }, (_, i) => [`{{portfolio.projection.assumptions.${i}}}`]),
      columnWidths: [1],
      wraps: { chars: LENGTHS.projectionAssumption, columnWidth: c.contentWidth },
    });
    pages.push({
      ...withFurniture(page('What the projection assumes', [
        ...furniture(DOCUMENT_LABEL, nextPart('Outlook'), 'What the projection assumes'),
        ...flow([
          sectionHeading({
            eyebrow: 'The assumptions',
            heading: 'What the projection assumes',
            numeral: nextNumeral(),
          }),
          oneOf(
            { when: 'portfolio && portfolio.projection && portfolio.projection.assumptions && portfolio.projection.assumptions.length <= 3', item: assumptionRows(3) },
            { when: 'portfolio && portfolio.projection && portfolio.projection.assumptions && portfolio.projection.assumptions.length > 3 && portfolio.projection.assumptions.length <= 5', item: assumptionRows(5) },
            { when: 'portfolio && portfolio.projection && portfolio.projection.assumptions && portfolio.projection.assumptions.length > 5', item: assumptionRows(8) },
          ),
        ], contentTop()),
      ]), FOOTER),
      conditional: 'portfolio && portfolio.projection && portfolio.projection.assumptions',
    });
  }

  /** The four avenues every stored report carries, and `ifItFits`'s own margin. */
  const GROWTH_AVENUES = 4;
  const GROWTH_SLACK = 36;

  // ── 07e Growth opportunities ─────────────────────────────────────────────
  //
  // Four avenues on every stored report — the next purchase, releasing equity,
  // refinancing, optimising what you hold — each a list of one to four items
  // of up to 358 characters. Two avenues a page, two items an avenue; the
  // omission note rides `ifItFits` on the second page and names what the
  // two-item excerpt leaves out.
  {
    const avenue = (g: number) => oneOf(
      {
        when: `portfolio && portfolio.growth && portfolio.growth.groups && portfolio.growth.groups[${g}].items.length <= 1`,
        item: definitions(`{{portfolio.growth.groups.${g}.label}}`, [
          { term: 'First', definition: `{{portfolio.growth.groups.${g}.items.0}}` },
        ], LENGTHS.growthItem),
      },
      {
        when: `portfolio && portfolio.growth && portfolio.growth.groups && portfolio.growth.groups[${g}].items.length > 1`,
        item: definitions(`{{portfolio.growth.groups.${g}.label}}`, [
          { term: 'First', definition: `{{portfolio.growth.groups.${g}.items.0}}` },
          { term: 'Second', definition: `{{portfolio.growth.groups.${g}.items.1}}` },
        ], LENGTHS.growthItem),
      },
    );
    const growthPage = (
      name: string, part: string, eyebrow: string, first: number, count: number,
    ) => ({
      ...withFurniture(page(name, [
        ...furniture(DOCUMENT_LABEL, nextPart(part), name),
        ...flow(ifItFits([
          sectionHeading({ eyebrow, heading: name, numeral: nextNumeral() }),
          ...Array.from({ length: count }, (_, k) => avenue(first + k)),
        ], first === 0 ? [] : [
          {
            ...callout(
              'The analysis lists more than these pages show',
              'Where an avenue carries more than two options, the first two are printed. '
              + 'The full list is in the analysis this review was drawn from.',
              textHeight(150, { extra: 34 }),
            ),
            conditional: 'portfolio && portfolio.growth && portfolio.growth.groups && ('
              + 'portfolio.growth.groups[0].items.length > 2'
              + ' || portfolio.growth.groups[1].items.length > 2'
              + ' || portfolio.growth.groups[2].items.length > 2'
              + ' || portfolio.growth.groups[3].items.length > 2)',
          },
        ], contentTop()), contentTop()),
      ]), FOOTER),
      conditional: 'portfolio && portfolio.growth && portfolio.growth.groups',
    });
    /*
     * Two avenues a page where two fit, one where they do not.
     *
     * Both were required, and on the spacious `-03` variants the pair ran 39 to
     * 94pt past the footer — the seed builder refused to write while any master
     * did. Dropping the second avenue was the cheap fix and the wrong one: it
     * loses two of the four avenues on exactly the variants that have the most
     * room to read them.
     *
     * "A spacious template does not shrink its type to fit more on a page, it
     * uses another page" is this catalogue's own rule, so a variant that cannot
     * carry two avenues carries one and spends four pages. The decision is made
     * here from `remainingAfter` — the same arithmetic `flow` and `ifItFits`
     * use — rather than from the density flag, because it is the measured
     * height that decides, and `SLACK` is the margin `ifItFits` requires of any
     * block it places.
     */
    const fitsTwo = remainingAfter([
      sectionHeading({ eyebrow: 'The avenues', heading: 'Growth opportunities' }),
      avenue(0),
      avenue(1),
    ], contentTop()) >= GROWTH_SLACK;
    const perPage = fitsTwo ? 2 : 1;

    for (let start = 0; start < GROWTH_AVENUES; start += perPage) {
      const first = start === 0;
      // The two-avenue layout keeps the names it always had, so a variant that
      // still fits two prints an identical document.
      const contIndex = Math.floor(start / perPage);
      const name = first
        ? 'Growth opportunities'
        : contIndex === 1
          ? 'Growth opportunities, continued'
          : `Growth opportunities, continued (${contIndex})`;
      pages.push({
        ...growthPage(
          name,
          'Growth',
          first ? 'The avenues' : 'The avenues, continued',
          start,
          perPage,
        ),
        // The first page is conditional on there being any avenue; each later
        // one on the group it opens with existing.
        ...(first ? {} : {
          conditional: 'portfolio && portfolio.growth && portfolio.growth.groups'
            + ` && portfolio.growth.groups.length > ${start}`,
        }),
      });
    }
  }

  // ── 08 Priority actions ──────────────────────────────────────────────────
  pages.push(withFurniture(page('Recommended actions', [
    ...furniture(DOCUMENT_LABEL, nextPart('Actions'), 'Recommended actions'),
    ...flow([
      sectionHeading({
        eyebrow: 'What would move this',
        heading: 'Recommended actions',
        numeral: nextNumeral(),
      }),
      definitions('Priority', [
        { term: 'First', definition: '{{actions.priority.0}}' },
        { term: 'Second', definition: '{{actions.priority.1}}' },
        { term: 'Third', definition: '{{actions.priority.2}}' },
      ], LENGTHS.priorityAction),
    ], contentTop()),
  ]), FOOTER));

  // ── 09 By horizon ────────────────────────────────────────────────────────
  //
  // A page of its own because a horizon action runs to 345 characters and there
  // are three of them: 258pt of definition list, which does not fit under the
  // priority list on the spacious variants.
  pages.push(withFurniture(page('By horizon', [
    ...furniture(DOCUMENT_LABEL, nextPart('Horizon'), 'By horizon'),
    ...flow([
      sectionHeading({
        eyebrow: 'Sequencing',
        heading: 'Short, medium and long term',
        numeral: nextNumeral(),
      }),
      // Each horizon is a LIST of 1-4 actions, not the single statement its
      // name suggests. One row each is what every stored report can fill; the
      // notice below covers the reports that carry more.
      definitions('By horizon', [
        { term: 'Short term', definition: '{{actions.shortTerm.0}}' },
        { term: 'Medium term', definition: '{{actions.mediumTerm.0}}' },
        { term: 'Long term', definition: '{{actions.longTerm.0}}' },
      ], LENGTHS.horizonAction),
      {
        ...callout(
          'The analysis lists more than this page shows',
          'Where a horizon carries several actions, the first is printed here. '
            + 'The full list is in the analysis this review was drawn from.',
          textHeight(140, { extra: 34 }),
        ),
        conditional: 'actions && (actions.priority.length > 3'
          + ' || actions.shortTerm.length > 1'
          + ' || actions.mediumTerm.length > 1'
          + ' || actions.longTerm.length > 1)',
      },
      // No closing `recommendation()` block. It would restate the primary
      // recommendation the overview already carries in full, and that block
      // reserves height for a short verdict rather than for the 459-character
      // sentence this format's model writes.
    ], contentTop()),
  ]), FOOTER));

  // ── 10 Scenarios ─────────────────────────────────────────────────────────
  //
  // The review wizard's modelled what-ifs, on 20 of the 21 stored reports —
  // four on every one of them. The impact arrives split as the legacy splits
  // it: a signed monthly change and the resulting position, never one number,
  // because flattening `{ cashFlowChange, newNetCashflow }` to a scalar plots
  // a delta against a level.
  {
    const scenarioRow = (i: number) => [
      `{{portfolio.scenarios.rows.${i}.name}}`,
      `{{portfolio.scenarios.rows.${i}.description}}`,
      `{{portfolio.scenarios.rows.${i}.changeLabel}}`,
      `{{portfolio.scenarios.rows.${i}.resultLabel}}`,
    ];
    const scenarioTable = (n: number) => table({
      headers: ['Scenario', 'What changes', 'Monthly change', 'New position'],
      rows: Array.from({ length: n }, (_, i) => scenarioRow(i)),
      columnWidths: [0.22, 0.42, 0.18, 0.18],
      wraps: { chars: LENGTHS.scenarioDescription, columnWidth: c.contentWidth * 0.42 },
    });
    pages.push({
      ...withFurniture(page('Scenarios', [
        ...furniture(DOCUMENT_LABEL, nextPart('Scenarios'), 'Scenarios'),
        ...flow([
          sectionHeading({
            eyebrow: 'What if',
            heading: 'Scenarios modelled on this portfolio',
            numeral: nextNumeral(),
          }),
          oneOf(
            { when: 'portfolio && portfolio.scenarios && portfolio.scenarios.rows && portfolio.scenarios.rows.length <= 4', item: scenarioTable(4) },
            { when: 'portfolio && portfolio.scenarios && portfolio.scenarios.rows && portfolio.scenarios.rows.length > 4', item: scenarioTable(6) },
          ),
          callout(
            'Reading the table',
            'Each scenario was modelled in the review against the portfolio as it stands. '
            + 'The change is monthly, and the new position is where it leaves the whole portfolio.',
          ),
        ], contentTop()),
      ]), FOOTER),
      conditional: 'portfolio && portfolio.scenarios && portfolio.scenarios.rows',
    });
  }

  // ── 11 This review ───────────────────────────────────────────────────────
  //
  // The human record beside the generated analysis — present for 20 of the 21
  // stored reports, and enrichment rather than requirement, exactly as the
  // legacy treats it. Scores are out of 100 and labelled so; the dates arrive
  // as stored instants and are set with `| date`.
  pages.push({
    ...withFurniture(page('This review', [
      ...furniture(DOCUMENT_LABEL, nextPart('Review'), 'This review'),
      ...flow(ifItFits([
        sectionHeading({
          eyebrow: 'The adviser record',
          heading: 'This review',
          numeral: nextNumeral(),
        }),
        definitions('The record', [
          { term: 'Status', definition: '{{portfolio.review.statusLabel}}' },
          { term: 'Reviewed', definition: '{{portfolio.review.reviewedOn | date}}' },
          { term: 'Next review due', definition: '{{portfolio.review.nextReviewDue | date}}' },
          { term: 'Risk level', definition: '{{portfolio.review.riskLevel}}' },
        ]),
        table({
          headers: ['Measure', 'Score /100'],
          rows: Array.from({ length: 5 }, (_, i) => [
            `{{portfolio.review.scores.${i}.label}}`,
            `{{portfolio.review.scores.${i}.scoreLabel}}`,
          ]),
          columnWidths: [0.68, 0.32],
        }),
        {
          ...callout('In summary', '{{portfolio.review.summary}}',
            textHeight(LENGTHS.reviewSummary, { size: c.scale.cell, extra: 34 })),
          conditional: 'portfolio && portfolio.review && portfolio.review.summary',
        },
      ], [
        // Five one-line findings on every stored review — a table rather than
        // a definition list because the finding is the whole row, and optional
        // because the scores and the record above are the section's argument.
        table({
          headers: ['Key findings'],
          rows: Array.from({ length: 5 }, (_, i) => [`{{portfolio.review.findings.${i}}}`]),
          columnWidths: [1],
        }),
      ], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'portfolio && portfolio.review',
  });

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  return assembleMaster({ family, variant, manifest, c, pages, format: PORTFOLIO_FORMAT });
}

/** Every Portfolio Performance Review master, by family, in catalogue order. */
export const PORTFOLIO_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);
