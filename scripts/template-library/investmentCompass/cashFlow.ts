/**
 * The 10 Year Cash Flow Analysis, drawn in the ten Investment Compass families.
 *
 * The fifth report format on the family system. It shares `master.ts` with the
 * other four and contributes only its own page sequence — see
 * `docs/template-library/07-investment-compass-families.md`.
 *
 * ## The only prose here is built, never written
 *
 * Investment Compass, the Portfolio Review and the Comparison all bind
 * paragraphs a model wrote, and every height on their pages is a
 * `textHeight(chars)` measured against production, because a paragraph that
 * sets taller than its declared height prints over the block beneath it.
 *
 * The one paragraph in this format is the opening narrative, and the
 * projection composes it from the series' own ends in the legacy document's
 * sentence shapes — so it is bounded by construction and cannot disagree with
 * the tables behind it. Every other figure on every page is a number the
 * report stored, and the risk moves to the other end: **ten-row tables**,
 * five of them, on a page model that cannot paginate. A table is `24 + rows *
 * rowHeight`, and the spacing scales run from 13pt a row to 22 — so the same
 * ten rows are 154pt on Swiss Minimal and 244pt on Private Banking. That is why
 * each series table gets a page rather than sharing one, and why the QA
 * harness's collision measure is what proves it.
 *
 * ## What this format refuses to print
 *
 * `cashFlowProjection.pure.ts` records it in full, and it is the reason this
 * format looks thinner than the record it is drawn from. Four stored figures
 * contradict the series they sit beside:
 *
 *  - `keyMetrics.annualNet` / `weeklyNet` — year-one cash flow, differing from
 *    the series' own year one by a median of $24,793 and agreeing on none of
 *    the 162.
 *  - `initialCosts.totalUpfront` — not the sum of the costs beside it on 132
 *    of 161, off by up to $93,000.
 *  - `annualCosts.totalAnnual` — not the sum of its components on 141 of 162.
 *  - `initialCosts.propertyValue` — $3 on one report whose own series says
 *    $780,000.
 *
 * None is published, so none can be bound. The cost pages therefore carry **no
 * total row**, which looks like an omission and is the opposite: a total that
 * disagrees with the figures above it by $93,000 tells a client the document
 * cannot add up, and gives them no way to tell which line is wrong.
 *
 * ## The chart plots equity, and that is a renderer constraint as well as a choice
 *
 * `chart_style` resolves per family to a line, an area, a bar or a sparkline,
 * so a chart in this catalogue has to be drawable by all four. Equity is
 * positive on all 4,860 stored elements and rises; the cash-flow series is
 * negative on 4,856 of them. Bar charts could not draw a negative bar at all
 * until this change (`charts.html.ts`), and the shortfall is carried by the
 * table and the KPI band instead — where a negative number is a number rather
 * than a bar drawn downward off the plot.
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
  oneOf,
  page,
  prose,
  rule,
  scenarioChart,
  sectionHeading,
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

/**
 * Not `{{client.name}}`.
 *
 * `investment_reports` has no client-name column, and `client_property_id` is
 * set on 2 of the 162 reports that carry a projection — so this format is
 * addressed to a property. The address is present on all 162 and runs to 67
 * characters at its longest.
 */
const FOOTER = '{{cashflow.property.address}} · Ten year cash flow';
const DOCUMENT_LABEL = 'Ten Year Cash Flow Analysis';

/**
 * What the adviser-reviewed path does not publish, and this master must not
 * print a label for.
 *
 * Two producers feed these masters. `projectCashFlow` over a stored row
 * publishes everything. `applyLiveCashFlowProjection` over the series an
 * adviser reviewed on screen publishes a strict subset, and each omission is
 * deliberate and recorded in `liveProjectionRow.ts`:
 *
 *  - `scenarios` / `scenarioBasis` are deleted, because only the series on
 *    screen was reviewed and the stored three are not a comparison against it;
 *  - `roi` is absent from every year, because the wire has no such field and
 *    "the stored derivation this repo has no second implementation of"
 *    (`cashFlowAdapter.ts`) — so a figure invented here would be a number in a
 *    client's financial document that no other surface agrees with.
 *
 * Withholding is right. Printing the labels anyway is not, and that is what the
 * 15 Aug 2026 export of 28 Bligh Street did: a blank three-row scenarios table,
 * a "Return" column empty in all ten rows, a "Return at year ten" KPI reading
 * "—", and three assumption lines reading "Conservative capital growth ·
 * rental growth, a year" with no rates in them.
 */
const HAS_SCENARIOS = 'cashflow && cashflow.scenarios';
const HAS_SCENARIO_BASIS = 'cashflow && cashflow.scenarioBasis';
const HAS_ROI = 'cashflow && cashflow.outcome && cashflow.outcome.roi != null';
const NO_ROI = 'cashflow && (!cashflow.outcome || cashflow.outcome.roi == null)';

/** Every stored series is exactly this long, in all three scenarios, on all 162. */
const YEARS = 10;

/** The three scenarios, in the order they are stored and ranked. */
const SCENARIOS = [
  { key: 'conservative', label: 'Conservative' },
  { key: 'moderate', label: 'Moderate' },
  { key: 'optimistic', label: 'Optimistic' },
] as const;

const CASH_FLOW_FORMAT: ReportFormat = {
  key: 'cash-flow-ten-year',
  reportType: 'cashflow',
  category: 'cash_flow',
  tier: 'compass',
  label: '10 Year Cash Flow Analysis',
  extraTags: ['cash-flow', 'projection', 'ten-year', 'scenarios'],
};

/**
 * The figures across the top of the position page.
 *
 * Every one is from the series or is arithmetic on it. Nothing here is
 * `keyMetrics`, for the reason in the header.
 */
const POSITION_KPIS: KpiItem[] = [
  { label: 'Value at year ten', value: '{{cashflow.outcome.propertyValue | currency}}', note: 'From {{cashflow.firstYear.propertyValue | currency}} at year one' },
  { label: 'Equity at year ten', value: '{{cashflow.outcome.equity | currency}}', note: 'Value less loan balance' },
  { label: 'Cash flow, year one', value: '{{cashflow.firstYear.cashFlow | currency}}', note: '{{cashflow.firstYear.cashFlowWeekly | currency}} a week, rent less costs and repayments' },
  { label: 'Cumulative to year ten', value: '{{cashflow.outcome.cumulativeCashFlow | currency}}', note: 'Total contributed over the term' },
  { label: 'Return at year ten', value: '{{cashflow.outcome.roi | percent}}', note: 'On the {{cashflow.scenario}} scenario' },
  { label: 'Value growth', value: '{{cashflow.outcome.valueGrowth | currency}}', note: '{{cashflow.outcome.valueGrowthPercent | percent}} over ten years' },
];

/** One row of the balance-sheet series, bound by index. */
function balanceRow(i: number): string[] {
  return [
    `{{cashflow.years.${i}.year}}`,
    `{{cashflow.years.${i}.propertyValue | currency}}`,
    `{{cashflow.years.${i}.loanBalance | currency}}`,
    `{{cashflow.years.${i}.equity | currency}}`,
  ];
}

/** One row of the cash series, bound by index. */
function cashRow(i: number): string[] {
  return [
    `{{cashflow.years.${i}.year}}`,
    `{{cashflow.years.${i}.annualRent | currency}}`,
    `{{cashflow.years.${i}.cashFlow | currency}}`,
    `{{cashflow.years.${i}.cumulativeCashFlow | currency}}`,
    `{{cashflow.years.${i}.roi | percent}}`,
  ];
}

/** One scenario's year-ten outcome, bound by name. */
function scenarioRow(key: string, label: string): string[] {
  const last = YEARS - 1;
  return [
    label,
    `{{cashflow.scenarios.${key}.${last}.propertyValue | currency}}`,
    `{{cashflow.scenarios.${key}.${last}.equity | currency}}`,
    `{{cashflow.scenarios.${key}.${last}.cumulativeCashFlow | currency}}`,
    `{{cashflow.scenarios.${key}.${last}.roi | percent}}`,
  ];
}

function buildTemplate(family: DesignFamily, variant: VariantDefinition): CompassSeedTemplate {
  const manifest = resolveManifest(family, variant);
  const c = beginCompassTemplate(family, variant, manifest);

  const nextPart = renderTimePart;
  const nextNumeral = (): string => RENDER_TIME_NUMERAL;

  const pages: PageDef[] = [];

  // ── 01 Cover ─────────────────────────────────────────────────────────────
  pages.push(cover({
    wordmarkTop: '{{org.name}}',
    wordmarkBottom: 'Cash Flow',
    tagline: 'Your dedicated property partner',
    marker: 'Cash Flow',
    eyebrow: 'Ten year cash flow analysis',
    title: '{{cashflow.property.address}}',
    standfirst: 'What the property is projected to be worth, what it owes, and what it costs to hold — year by year.',
    locations: 'Prepared {{report.generatedDate | date}}',
    facts: [
      { label: 'Value at year ten', value: '{{cashflow.outcome.propertyValue | currency}}' },
      { label: 'Equity at year ten', value: '{{cashflow.outcome.equity | currency}}' },
      { label: 'Cumulative cash flow', value: '{{cashflow.outcome.cumulativeCashFlow | currency}}' },
      { label: 'Scenario', value: '{{cashflow.scenarioLabel}}' },
    ],
  }));

  // ── Contents, where the family declares one ──────────────────────────────
  if (hasContents(manifest.toc_style)) {
    pages.push(withFurniture(page('Contents', [
      ...furniture(DOCUMENT_LABEL, nextPart('Contents'), 'Contents'),
      ...flow([
        sectionHeading({ eyebrow: 'In this analysis', heading: 'Contents', numeral: nextNumeral() }),
        contents([
          'Where it lands',
          'Equity over ten years',
          'Value, debt and equity',
          'Rent, cash flow and return',
          'The three scenarios',
          'What it costs to hold',
          'The purchase and the loan',
          'What this rests on',
          'Important information',
        ]),
      ], contentTop()),
    ]), FOOTER));
  }

  // ── 02 Where it lands ────────────────────────────────────────────────────
  pages.push(withFurniture(page('Where it lands', [
    ...furniture(DOCUMENT_LABEL, nextPart('Position'), 'Where it lands'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'Ten years from settlement',
        heading: 'Where this lands',
        numeral: nextNumeral(),
        standfirst: 'Figures are the {{cashflow.scenario}} scenario. The other two are set '
          + 'side by side later in the document.',
        // The sentence is literal apart from the scenario name, which is one
        // word ("base", "optimistic", "pessimistic") — shorter than the binding
        // it replaces, so the source length is the safe measure.
        standfirstChars: 108,
      }),
      /*
       * The legacy document's opening narrative, in its own sentence shapes —
       * the weekly cost of holding, the growth and equity at the end of the
       * term, and whether the projection ever turns cash-flow positive
       * (production's answer: not once, in any moderate scenario stored).
       * Built by the projection from the series' own ends, so it cannot
       * disagree with the table pages behind it. Bounded at ~330 characters
       * by composition — a 67-character address plus fixed sentences.
       */
      {
        ...prose('{{cashflow.overview}}', textHeight(340)),
        conditional: 'cashflow && cashflow.overview',
      },
      // Same two shapes as the cash table. "Return at year ten" is dropped
      // rather than printed as an em dash when `roi` is not published — the
      // remaining figures then take the full row.
      oneOf(
        {
          when: HAS_ROI,
          item: kpis(POSITION_KPIS.slice(0, kpiCapacity())),
        },
        {
          when: NO_ROI,
          item: kpis(POSITION_KPIS.filter((k) => k.label !== 'Return at year ten')
            .slice(0, kpiCapacity())),
        },
      ),
    ], [
      // The one figure in the record that sets the paper gain against what it
      // cost. Optional because it is a summary of the two KPIs above it rather
      // than a figure of its own, so a tight variant loses nothing by dropping
      // it. Labelled precisely: the deposit and the purchase costs are not in
      // it, and neither is any tax treatment.
      callout(
        'Equity gained, less the cash it took to hold',
        '{{cashflow.outcome.equityGrowthLessShortfall | currency}} — equity grew '
          + '{{cashflow.outcome.equityGrowth | currency}} between year one and year ten, and '
          + 'holding the property took {{cashflow.outcome.cumulativeCashFlow | abs | currency}} '
          + 'of cash over the same years. The deposit and the purchase costs are not in this '
          + 'figure, and no tax position is assumed.',
        textHeight(320, { size: c.scale.cell, extra: 34 }),
      ),
    ], contentTop()), contentTop()),
  ]), FOOTER));

  // ── 03 The equity curve ──────────────────────────────────────────────────
  //
  // Equity rather than cash flow: it is positive on all 4,860 stored elements
  // and every chart primitive in the catalogue can draw it. See the header.
  pages.push(withFurniture(page('Equity over ten years', [
    ...furniture(DOCUMENT_LABEL, nextPart('Equity'), 'Equity over ten years'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'Value less debt',
        heading: 'Equity over ten years',
        numeral: nextNumeral(),
      }),
      scenarioChart({
        title: 'Projected equity position',
        caption: 'Property value less loan balance, at the end of each year',
        // Dollars, from the same stored series the table on the facing page
        // reads. The axis is what lets the two be checked against each other.
        axis: 'money',
        yAxisLabel: 'Equity',
        dataPath: 'cashflow.years',
        labelKey: 'year',
        valueKey: 'equity',
        data: Array.from({ length: YEARS }, (_, i) => ({ label: `${i + 1}`, value: 0 })),
      }),
    ], [
      definitions('The ends of the curve', [
        { term: 'Year one', definition: '{{cashflow.firstYear.equity | currency}} on a {{cashflow.firstYear.propertyValue | currency}} property' },
        { term: 'Year ten', definition: '{{cashflow.outcome.equity | currency}} on a {{cashflow.outcome.propertyValue | currency}} property' },
        { term: 'Growth', definition: '{{cashflow.outcome.equityGrowth | currency}} over the term' },
      ], 74),
    ], contentTop()), contentTop()),
  ]), FOOTER));

  // ── 04 Value, debt and equity ────────────────────────────────────────────
  pages.push(withFurniture(page('Value, debt and equity', [
    ...furniture(DOCUMENT_LABEL, nextPart('Balance'), 'Value, debt and equity'),
    ...flow([
      sectionHeading({
        eyebrow: 'Year by year',
        heading: 'Value, debt and equity',
        numeral: nextNumeral(),
      }),
      table({
        headers: ['Year', 'Property value', 'Loan balance', 'Equity'],
        rows: Array.from({ length: YEARS }, (_, i) => balanceRow(i)),
        columnWidths: [0.13, 0.29, 0.29, 0.29],
      }),
    ], contentTop()),
  ]), FOOTER));

  // ── 05 Rent, cash flow and return ────────────────────────────────────────
  //
  // Its own page, not a continuation of the table above: ten rows is 154pt on
  // the tightest spacing scale and 244 on the loosest, so two ten-row tables
  // and a heading exceed the content measure on the roomier half of the
  // catalogue. One table a page fits all fifty.
  pages.push(withFurniture(page('Rent, cash flow and return', [
    ...furniture(DOCUMENT_LABEL, nextPart('Cash flow'), 'Rent, cash flow and return'),
    ...flow([
      sectionHeading({
        eyebrow: 'Year by year',
        heading: 'Rent, cash flow and return',
        numeral: nextNumeral(),
        standfirst: 'Cash flow is rent less holding costs and loan repayments. It is negative '
          + 'in every year of every scenario on almost every projection this product has '
          + 'stored, and the cumulative column is what that adds up to.',
      }),
      // Two mutually exclusive shapes of the same table, because the Return
      // column exists only when `roi` does. Drawn with it, the adviser-reviewed
      // path printed a labelled fifth column with ten empty cells; drawn
      // without, the four columns it does have take the full measure.
      oneOf(
        {
          when: HAS_ROI,
          item: table({
            headers: ['Year', 'Rent', 'Cash flow', 'Cumulative', 'Return'],
            rows: Array.from({ length: YEARS }, (_, i) => cashRow(i)),
            columnWidths: [0.11, 0.22, 0.22, 0.26, 0.19],
          }),
        },
        {
          when: NO_ROI,
          item: table({
            headers: ['Year', 'Rent', 'Cash flow', 'Cumulative'],
            rows: Array.from({ length: YEARS }, (_, i) => cashRow(i).slice(0, 4)),
            columnWidths: [0.13, 0.29, 0.29, 0.29],
          }),
        },
      ),
    ], contentTop()),
  ]), FOOTER));

  // ── 06 The three scenarios ───────────────────────────────────────────────
  //
  // Conditional on the comparison existing, because it does not always.
  //
  // `applyLiveCashFlowProjection` deletes `scenarios` and `scenarioBasis` on
  // the adviser-reviewed path, for a good reason: only the series on screen was
  // reviewed, and a stored three-way comparison against it would be comparing
  // two different things. But the page was drawn regardless, so an
  // adviser-reviewed export printed this table with its three scenario names
  // and every figure cell empty — a labelled, ruled, entirely blank table in a
  // client's financial document, followed by a "How to read this" panel
  // explaining how to read it. Observed on the 15 Aug 2026 export of
  // 28 Bligh Street.
  //
  // `visiblePages` drops a conditional page before anything is laid out, so the
  // contents list and the page numbering both follow it down.
  const scenariosPage = withFurniture(page('The three scenarios', [
    ...furniture(DOCUMENT_LABEL, nextPart('Scenarios'), 'The three scenarios'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'At year ten',
        heading: 'What changes if growth does',
        numeral: nextNumeral(),
        standfirst: 'The three differ in the growth assumed and in nothing else — the loan '
          + 'amortises identically in all three, so the debt column would be the same figure '
          + 'three times and is not repeated here.',
      }),
      table({
        headers: ['Scenario', 'Value', 'Equity', 'Cumulative', 'Return'],
        rows: SCENARIOS.map((s) => scenarioRow(s.key, s.label)),
        columnWidths: [0.2, 0.21, 0.21, 0.23, 0.15],
      }),
    ], [
      rule(),
      definitions('How to read this', [
        { term: 'Value and equity', definition: 'Grow with the scenario. The gap between conservative and optimistic is the whole of the uncertainty in the forecast.' },
        { term: 'Cash contributed', definition: 'Barely moves. Holding costs and repayments do not fall because the market rises.' },
      ], 150),
    ], contentTop()), contentTop()),
  ]), FOOTER);
  scenariosPage.conditional = HAS_SCENARIOS;
  pages.push(scenariosPage);

  // ── 07 What it costs to hold ─────────────────────────────────────────────
  //
  // No total row. `annualCosts.totalAnnual` disagrees with these seven figures
  // on 141 of the 162 stored reports, by as much as $25,020 — see the header
  // and `cashFlowProjection.pure.ts`.
  pages.push(withFurniture(page('What it costs to hold', [
    ...furniture(DOCUMENT_LABEL, nextPart('Holding costs'), 'What it costs to hold'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'Annual, at year one',
        heading: 'What it costs to hold',
        numeral: nextNumeral(),
        standfirst: 'The recorded costs, each as stored. They are not totalled here: the '
          + 'record carries a total that does not equal them.',
      }),
      table({
        headers: ['Holding cost', 'Annual'],
        rows: [
          ['Council rates', '{{cashflow.costs.councilRates | currency}}'],
          ['Water rates', '{{cashflow.costs.waterRates | currency}}'],
          ['Landlord insurance', '{{cashflow.costs.landlordInsurance | currency}}'],
          ['Repairs and maintenance', '{{cashflow.costs.maintenance | currency}}'],
          ['Property management', '{{cashflow.costs.propertyManagement | currency}}'],
          ['Strata levies', '{{cashflow.costs.strataFees | currency}}'],
          ['Land tax', '{{cashflow.costs.landTax | currency}}'],
        ],
        columnWidths: [0.62, 0.38],
      }),
    ], [
      // Letting fees are stored on 123 of the 162, so the row is conditional
      // rather than printed as a blank line under six figures that are not.
      {
        ...table({
          headers: ['Also recorded', 'Annual'],
          rows: [['Letting fees', '{{cashflow.costs.lettingFees | currency}}']],
          columnWidths: [0.62, 0.38],
        }),
        conditional: 'cashflow && cashflow.costs && cashflow.costs.lettingFees',
      },
    ], contentTop()), contentTop()),
  ]), FOOTER));

  // ── 08 The purchase and the loan ─────────────────────────────────────────
  //
  // Also no total row, for the same reason: `initialCosts.totalUpfront` is not
  // the sum of these on 132 of 161 reports, off by up to $93,000.
  pages.push(withFurniture(page('The purchase and the loan', [
    ...furniture(DOCUMENT_LABEL, nextPart('Purchase'), 'The purchase and the loan'),
    ...flow(ifItFits([
      sectionHeading({
        eyebrow: 'At settlement',
        heading: 'The purchase and the loan',
        numeral: nextNumeral(),
        standfirst: 'The costs recorded against the purchase, and the loan the projection '
          + 'amortises. As above, these are not totalled here.',
      }),
      table({
        headers: ['At settlement', 'Amount'],
        rows: [
          ['Deposit', '{{cashflow.purchase.deposit | currency}}'],
          ['Stamp duty', '{{cashflow.purchase.stampDuty | currency}}'],
          ['Legal fees', '{{cashflow.purchase.legalFees | currency}}'],
          ['Inspection fees', '{{cashflow.purchase.inspectionFees | currency}}'],
          ['Lenders mortgage insurance', '{{cashflow.purchase.lmi | currency}}'],
          ['Loan amount', '{{cashflow.purchase.loanAmount | currency}}'],
        ],
        columnWidths: [0.62, 0.38],
      }),
    ], [
      definitions('The loan', [
        { term: 'Interest rate', definition: '{{cashflow.loan.interestRate | percent}}, {{cashflow.loan.rateSource}}' },
        { term: 'Repayment', definition: '{{cashflow.loan.monthlyPayment | currency}} a month · {{cashflow.loan.weeklyPayment | currency}} a week' },
        { term: 'Loan to value', definition: '{{cashflow.loan.lvr | percent:0}}' },
        { term: 'Type', definition: '{{cashflow.loan.loanType}}' },
      ], 76),
    ], contentTop()), contentTop()),
  ]), FOOTER));

  // ── 09 What this rests on ────────────────────────────────────────────────
  //
  // The rates the series was actually built at, derived from the series itself
  // — NOT `financial_calculations.assumptions`, which records a growth rate the
  // projection did not use (it matches on 3 reports of 69). See
  // `cashFlowProjection.pure.ts`. A page headed "what this rests on" is a
  // checkable claim about the document's own arithmetic, so it has to be read
  // off the arithmetic.
  pages.push(withFurniture(page('What this rests on', [
    ...furniture(DOCUMENT_LABEL, nextPart('Basis'), 'What this rests on'),
    ...flow([
      sectionHeading({
        eyebrow: 'Assumptions and scope',
        heading: 'What this rests on',
        numeral: nextNumeral(),
      }),
      // Conditional for the same reason the scenarios page is: on the
      // adviser-reviewed path `scenarioBasis` is deleted, and these three lines
      // printed as "Conservative capital growth · rental growth, a year" —
      // a sentence with its numbers missing. `basis` (the rates read off the
      // series actually shown) survives on both paths and is stated below under
      // "Scenario shown", so the page still says what it was drawn at.
      {
        ...definitions('What each scenario assumes', [
          { term: 'Conservative', definition: '{{cashflow.scenarioBasis.conservative.capitalGrowth | percent}} capital growth · {{cashflow.scenarioBasis.conservative.rentalGrowth | percent}} rental growth, a year' },
          { term: 'Moderate', definition: '{{cashflow.scenarioBasis.moderate.capitalGrowth | percent}} capital growth · {{cashflow.scenarioBasis.moderate.rentalGrowth | percent}} rental growth, a year' },
          { term: 'Optimistic', definition: '{{cashflow.scenarioBasis.optimistic.capitalGrowth | percent}} capital growth · {{cashflow.scenarioBasis.optimistic.rentalGrowth | percent}} rental growth, a year' },
        ], 76),
        conditional: HAS_SCENARIO_BASIS,
      },
      callout(
        'What this projection does not include',
        'No tax position is modelled: there is no depreciation, no negative-gearing benefit '
          + 'and no marginal rate in any figure here. Nor is the projection re-based on any '
          + 'valuation after settlement, and the loan amortises on the same schedule whichever '
          + 'scenario is read.',
        textHeight(300, { size: c.scale.cell, extra: 34 }),
      ),
      definitions('Scope', [
        { term: 'Term', definition: '{{cashflow.termYears}} years' },
        { term: 'Scenario shown', definition: '{{cashflow.scenarioLabel}}, at {{cashflow.basis.capitalGrowth | percent}} capital growth' },
        { term: 'Prepared', definition: '{{report.generatedDate | date}}' },
      ], 60),
    ], contentTop()),
  ]), FOOTER));

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  return assembleMaster({ family, variant, manifest, c, pages, format: CASH_FLOW_FORMAT });
}

/** Every 10 Year Cash Flow master, by family, in catalogue order. */
export const CASH_FLOW_COMPASS_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);
