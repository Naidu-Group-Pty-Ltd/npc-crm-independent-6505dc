/**
 * Commercial & Industrial Capacity on the Investment Compass families.
 *
 * ## Built around a decline, because that is the whole corpus
 *
 * Sixteen assessments exist. Thirteen have no calculation run at all — seven
 * `draft`, four `archived`, two `data_entry` — and the adapter declines those,
 * so no master ever draws them. Of the three that carry figures, **all three are
 * `outside_current_assumptions` and all three are bound by the debt service
 * coverage ratio**.
 *
 * A decline is therefore not an edge case to be handled after the happy path; it
 * is the document. The answer page leads with the outcome, the reason and the
 * binding test, and the shortfall is named as a shortfall rather than printed as
 * a negative number under a heading that says "headroom" — `differenceLabel` and
 * `differenceAbsolute` exist in the projection for exactly that.
 *
 * ## Every figure comes from the stored run
 *
 * The format's first rule. Nothing here derives a number: each bound path
 * resolves to a value the engine wrote, and the two version fields are on the
 * page so a figure can be checked against the pair that produced it.
 *
 * ## The analysis page says a model wrote it
 *
 * The contract's fourth rule is that the page says what it is. The provenance
 * note is bound from `capacity.analysisProvenance`, which the projection
 * publishes with the analysis or not at all — so a master cannot draw the
 * model's prose without the sentence that identifies it. It is placed above the
 * prose, not in a footnote.
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
  cols,
  contentTop,
  cover,
  definitions,
  disclaimerPage,
  flow,
  ifItFits,
  kpis,
  oneOf,
  page,
  prose,
  sectionHeading,
  table,
  textHeight,
  withFurniture,
  type KpiItem,
  type PageDef,
} from './blocks';
import { assembleMaster, type CompassSeedTemplate, type ReportFormat } from './master';
import { STANDARD_DISCLAIMER } from '../designSystem';

const FOOTER = '{{capacity.meta.reference}} · Commercial & Industrial Capacity';
const DOCUMENT_LABEL = 'Commercial & Industrial Capacity';

/** Rows a table draws. Mirrors the projection's caps; the record's count is printed. */
const ROWS = {
  constraints: 8,
  transaction: 10,
  income: 10,
  outstanding: 6,
  nextActions: 5,
  findings: 6,
  scenarios: 3,
  questions: 6,
  method: 5,
  serviceability: 8,
  tenancies: 6,
  periods: 4,
  portfolio: 8,
  warnings: 4,
} as const;

/** Measured against production lengths, not guessed. */
const LENGTHS = {
  narrative: 620,
  outcomeReason: 260,
  interpretation: 900,
  findingDetail: 420,
  scenarioReasoning: 300,
  /*
   * Two table cells that hold a sentence rather than a figure.
   *
   * Measured on the stored run: the three scenarios' `estimatedImpact` runs
   * 124-177 characters into a 140pt column, and the six questions run 86-164
   * across the full measure. A table row is one line tall unless a cell wraps,
   * so both need `wraps` or the declared height is a fiction — that is what ran
   * the page 26pt past the footer on `le-03`.
   */
  scenarioImpact: 180,
  question: 170,
  /** Reasoning plus expected effect, composed in the projection: 345-489 stored. */
  scenarioDetail: 520,
  /** The binding-test explanation with its formula: ~330 on the stored run. */
  bindingExplanation: 360,
  /** The provenance note plus the model attribution line. */
  provenance: 300,
  /** The surplus-under-sensitivity sentence: ~200 on the stored run. */
  surplusNote: 220,
  /** The lease-profile sidenote: ~230 on the stored run. */
  leaseNote: 260,
  /** The portfolio before/after framing sentence. */
  portfolioOverview: 280,
  /** Valuation, price, contribution and cash-out folded into one statement. */
  valuationNote: 340,
  fundingGapNote: 260,
  decliningNote: 280,
  crossCollateralisation: 280,
  /** The longest stored risk indicator runs 104 characters. */
  warningMessage: 120,
  /** `assessmentRateBasis` — "Contract rate 6.80% plus 1.00% buffer." */
  rateBasis: 60,
  /**
   * The engine's formula strings run to 64 characters once the "Capacity caps"
   * stage is filtered out — its 88-character formulas print in the constraints
   * section instead. Sized at 100 this charged every method row an extra line
   * and ran the page 12-20pt past the footer on two variants.
   */
  formula: 72,
} as const;

const COMMERCIAL_CAPACITY_FORMAT: ReportFormat = {
  key: 'commercial-capacity',
  reportType: 'commercial_capacity',
  category: 'finance',
  tier: 'compass',
  label: 'Commercial & Industrial Capacity',
  extraTags: ['commercial', 'industrial', 'capacity', 'serviceability', 'dscr'],
};

const HAS_CAPACITY = 'capacity';
const HAS_ANALYSIS = 'capacity && capacity.analysis';

const ANSWER_KPIS: KpiItem[] = [
  {
    label: 'Maximum capacity',
    value: '{{capacity.headline.maximumCapacity | currency}}',
    note: 'On current assumptions',
  },
  {
    label: 'Requested',
    value: '{{capacity.headline.requestedLoan | currency}}',
    note: 'What was asked for',
  },
  {
    // Named by the projection, because `difference` is signed and a template
    // cannot branch on a sign.
    label: '{{capacity.headline.differenceLabel}}',
    value: '{{capacity.headline.differenceAbsolute | currency}}',
    note: 'Against the request',
  },
  {
    label: 'Contribution required',
    value: '{{capacity.headline.requiredContribution | currency}}',
    note: 'To reach the request',
  },
];

const SERVICE_KPIS: KpiItem[] = [
  { label: 'Assessment rate', value: '{{capacity.headline.assessmentRate | percent}}', note: 'Sensitised' },
  { label: 'Monthly debt service', value: '{{capacity.headline.monthlyDebtService | currency}}', note: 'On the maximum' },
  { label: 'Surplus', value: '{{capacity.headline.surplus | currency}}', note: 'Before sensitisation' },
  { label: 'Sensitised surplus', value: '{{capacity.headline.sensitisedSurplus | currency}}', note: 'After' },
];

/**
 * The legacy table's own five columns, all composed in the projection.
 *
 * The two middle columns used to bind `actual | fixed:2` and `limit | fixed:2`
 * — and `limit` (with `status`) is a field `ConstraintRow` has never had, so
 * both printed empty on every row of the table this format exists for. The
 * labels are composed because the columns mix units: `cap` is dollars while
 * threshold and actual are a rate on the LVR row and a ratio on the DSCR row,
 * and three of the eight stored tests carry neither.
 */
function constraintRow(i: number): string[] {
  return [
    `{{capacity.constraints.${i}.label}}`,
    `{{capacity.constraints.${i}.capLabel}}`,
    `{{capacity.constraints.${i}.thresholdLabel}}`,
    `{{capacity.constraints.${i}.actualLabel}}`,
    `{{capacity.constraints.${i}.statusLabel}}`,
  ];
}

function costRow(collection: string, i: number): string[] {
  return [
    `{{capacity.${collection}.lines.${i}.label}}`,
    `{{capacity.${collection}.lines.${i}.amount | currency}}`,
  ];
}

function buildTemplate(family: DesignFamily, variant: VariantDefinition): CompassSeedTemplate {
  const manifest = resolveManifest(family, variant);
  const c = beginCompassTemplate(family, variant, manifest);
  const pages: PageDef[] = [];

  // ── Cover ────────────────────────────────────────────────────────────────
  pages.push(cover({
    wordmarkTop: '{{org.name}}',
    wordmarkBottom: 'Capacity',
    tagline: 'Your dedicated property partner',
    marker: DOCUMENT_LABEL,
    eyebrow: '{{capacity.meta.segmentLabel}} capacity assessment',
    title: '{{capacity.meta.subject}}',
    standfirst:
      'What this facility can support on current lending assumptions, the test '
      + 'that decides it, and what would have to change.',
    locations: '{{capacity.property.address}}',
    facts: [
      { label: 'Outcome', value: '{{capacity.headline.outcomeLabel}}' },
      { label: 'Binding test', value: '{{capacity.headline.bindingConstraint}}' },
      { label: 'Reference', value: '{{capacity.meta.reference}}' },
      { label: 'Assessed', value: '{{capacity.meta.assessedOn | date}}' },
    ],
  }));

  // ── The answer ───────────────────────────────────────────────────────────
  pages.push({
    ...withFurniture(page('The answer', [
      ...flow([
        sectionHeading({
          eyebrow: 'The answer',
          heading: '{{capacity.headline.outcomeLabel}}',
          // The longest of `OUTCOME_LABELS`, "Supported Subject to
          // Verification" (33) — `commercialCapacity/normalise.pure.ts:133`.
          headingChars: 33,
        }),
        prose('{{capacity.headline.outcomeReason}}', textHeight(LENGTHS.outcomeReason)),
        kpis(ANSWER_KPIS),
        {
          ...callout('The binding test', '{{capacity.headline.bindingConstraint}}'),
          conditional: 'capacity && capacity.headline.bindingConstraint',
        },
        prose('{{capacity.narrative}}', textHeight(LENGTHS.narrative)),
      ], contentTop()),
    ]), FOOTER),
    conditional: HAS_CAPACITY,
  });

  // ── The tests ────────────────────────────────────────────────────────────
  pages.push({
    ...withFurniture(page('The tests', [
      ...flow(ifItFits([
        sectionHeading({ eyebrow: 'How it was measured', heading: 'Every test, and the one that bound' }),
        table({
          headers: ['Test', 'Permits', 'Policy', 'This deal', 'Status'],
          rows: Array.from({ length: ROWS.constraints }, (_, i) => constraintRow(i)),
          columnWidths: cols(c.contentWidth - 330, 90, 70, 70, 100),
          numeric: [1, 2, 3],
        }),
        // The explanation the legacy sets over its table — which test permits
        // the smallest facility, by how much, and its formula. Title and body
        // both composed, because "no single binding test" takes a different
        // title from "the DSCR is what sets this capacity".
        {
          ...callout(
            '{{capacity.bindingTitle}}',
            '{{capacity.bindingExplanation}}',
            textHeight(LENGTHS.bindingExplanation, { size: c.scale.cell, extra: 34 }),
          ),
          conditional: 'capacity && capacity.bindingExplanation',
        },
        {
          ...callout('Not every test is shown', '{{capacity.constraintsOmitted}}'),
          conditional: 'capacity && capacity.constraintsOmitted',
        },
      ], [
        kpis(SERVICE_KPIS),
      ], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.constraints',
  });

  // ── The terms ────────────────────────────────────────────────────────────
  //
  // The legacy answer section's two tables the masters never drew: where the
  // transaction sits against policy, and the terms every debt-service figure
  // rests on. The term row is composed with its amortisation in the
  // projection, so a five-year facility amortised over twenty says so.
  pages.push({
    ...withFurniture(page('The terms', [
      ...flow(ifItFits([
        sectionHeading({ eyebrow: 'Against policy', heading: 'Where the transaction sits' }),
        (() => {
          const ratioTable = (n: number) => table({
            headers: ['Measure', 'This deal', 'Policy'],
            rows: Array.from({ length: n }, (_, i) => [
              `{{capacity.ratioRows.${i}.label}}`,
              `{{capacity.ratioRows.${i}.actualLabel}}`,
              `{{capacity.ratioRows.${i}.policyLabel}}`,
            ]),
            columnWidths: cols(c.contentWidth - 250, 110, 140),
            numeric: [1],
          });
          return oneOf(
            { when: 'capacity && capacity.ratioRows && capacity.ratioRows.length <= 5', item: ratioTable(5) },
            { when: 'capacity && capacity.ratioRows && capacity.ratioRows.length > 5', item: ratioTable(6) },
          );
        })(),
      ], [
        // The eight-term list is placed only where the variant has room. The
        // policy table above it is the page's subject; both together ran 19 to
        // 78pt past the footer on four masters, the spacious `-03` variants
        // worst, and a declared height that overruns prints over the block
        // below rather than clipping.
        definitions('Assessment terms', [
          { term: 'Assessment rate', definition: '{{capacity.headline.assessmentRate | percent}}' },
          { term: 'Rate basis', definition: '{{capacity.serviceability.rateBasis}}' },
          { term: 'Loan term', definition: '{{capacity.headline.termLabel}}' },
          { term: 'Monthly debt service', definition: '{{capacity.headline.monthlyDebtService | currency}}' },
          { term: 'Lender policy profile', definition: '{{capacity.meta.lenderProfile}}' },
          { term: 'Transaction type', definition: '{{capacity.meta.assessmentType}}' },
          { term: 'Asset class', definition: '{{capacity.property.assetClass}}' },
          { term: 'GST treatment', definition: '{{capacity.property.gstTreatment}}' },
        ], LENGTHS.rateBasis),
      ], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.ratioRows',
  });

  // ── Serviceability ───────────────────────────────────────────────────────
  //
  // Income in, commitments out, the surplus at the foot — the ledger the
  // projection used to drop entirely. The effect column is the direction in
  // words, because colour alone gets it wrong and gets it wrong invisibly.
  pages.push({
    ...withFurniture(page('Serviceability', [
      ...flow(ifItFits([
        sectionHeading({ eyebrow: 'Income against commitments', heading: 'The serviceability ledger' }),
        (() => {
          const ledgerTable = (n: number) => table({
            headers: ['Line', 'Amount', 'Effect'],
            rows: Array.from({ length: n }, (_, i) => [
              `{{capacity.serviceability.rows.${i}.label}}`,
              `{{capacity.serviceability.rows.${i}.amountLabel}}`,
              `{{capacity.serviceability.rows.${i}.effect}}`,
            ]),
            columnWidths: cols(c.contentWidth - 200, 110, 90),
            numeric: [1],
            // The longest stored ledger label is 45 characters.
            wraps: { chars: 48, columnWidth: c.contentWidth - 200 },
          });
          return oneOf(
            { when: 'capacity && capacity.serviceability && capacity.serviceability.rows && capacity.serviceability.rows.length <= 7', item: ledgerTable(7) },
            { when: 'capacity && capacity.serviceability && capacity.serviceability.rows && capacity.serviceability.rows.length > 7', item: ledgerTable(ROWS.serviceability) },
          );
        })(),
        {
          ...callout(
            'Surplus after debt service',
            '{{capacity.serviceability.surplusNote}}',
            textHeight(LENGTHS.surplusNote, { size: c.scale.cell, extra: 34 }),
          ),
          conditional: 'capacity && capacity.serviceability && capacity.serviceability.surplusNote',
        },
      ], [
        {
          ...definitions('The rate', [
            { term: 'Assessment basis', definition: '{{capacity.serviceability.rateBasis}}' },
          ], LENGTHS.rateBasis),
          conditional: 'capacity && capacity.serviceability && capacity.serviceability.rateBasis',
        },
      ], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.serviceability && capacity.serviceability.rows',
  });

  // ── The transaction ──────────────────────────────────────────────────────
  pages.push({
    ...withFurniture(page('The transaction', [
      ...flow(ifItFits([
        sectionHeading({ eyebrow: 'What is being funded', heading: 'The transaction' }),
        table({
          headers: ['Item', 'Amount'],
          rows: Array.from({ length: ROWS.transaction }, (_, i) => costRow('transaction', i)),
          columnWidths: cols(c.contentWidth - 120, 120),
        }),
        // The legacy funding strip's three figures. A "Funding gap" row used
        // to sit here and rendered an empty band on every fully-funded deal —
        // the gap is the caution callout below, exactly as the legacy prints
        // it, and only when one exists.
        definitions('Where it lands', [
          { term: 'Total project cost', definition: '{{capacity.transaction.totalProjectCost | currency}}' },
          { term: 'Requested facility', definition: '{{capacity.headline.requestedLoan | currency}}' },
          { term: 'Borrower contribution', definition: '{{capacity.transaction.borrowerContribution | currency}}' },
        ]),
      ], [
        // The legacy transaction section's two notes, whole sentences or
        // absent: the valuation-and-contribution sidenote (price, basis,
        // required contribution and any cash-out folded in by the projection),
        // and the funding-shortfall caution.
        {
          ...callout(
            'Valuation and contribution',
            '{{capacity.transaction.valuationNote}}',
            textHeight(LENGTHS.valuationNote, { size: c.scale.cell, extra: 34 }),
          ),
          conditional: 'capacity && capacity.transaction.valuationNote',
        },
        {
          ...callout(
            'Funding shortfall',
            '{{capacity.transaction.fundingGapNote}}',
            textHeight(LENGTHS.fundingGapNote, { size: c.scale.cell, extra: 34 }),
          ),
          conditional: 'capacity && capacity.transaction.fundingGapNote',
        },
      ], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.transaction',
  });

  // ── Income ───────────────────────────────────────────────────────────────
  pages.push({
    ...withFurniture(page('The income', [
      ...flow([
        sectionHeading({ eyebrow: 'What services the debt', heading: 'Property income' }),
        table({
          headers: ['Line', 'Amount'],
          rows: Array.from({ length: ROWS.income }, (_, i) => costRow('propertyIncome', i)),
          columnWidths: cols(c.contentWidth - 120, 120),
        }),
        definitions('What the income carries', [
          { term: 'Net operating income', definition: '{{capacity.propertyIncome.netOperatingIncome | currency}}' },
          { term: 'Capitalisation rate', definition: '{{capacity.propertyIncome.capitalisationRate | percent}}' },
          { term: 'Break-even occupancy', definition: '{{capacity.propertyIncome.breakEvenOccupancy | percent}}' },
          { term: 'WALE', definition: '{{capacity.propertyIncome.wale | fixed:1}} years' },
        ]),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.propertyIncome',
  });

  // ── The tenancy schedule ─────────────────────────────────────────────────
  //
  // Who pays what until when — declared in the projection's caps from the
  // start and never published or drawn. Income a lender can rely on is income
  // with term left on it, so the expiry column is the one the reader wants.
  pages.push({
    ...withFurniture(page('The tenancies', [
      ...flow(ifItFits([
        sectionHeading({ eyebrow: 'Who pays the rent', heading: 'The tenancy schedule' }),
        (() => {
          const tenancyTable = (n: number) => table({
            headers: ['Tenant', 'Area', 'Passing rent', 'Share', 'Expiry'],
            rows: Array.from({ length: n }, (_, i) => [
              `{{capacity.propertyIncome.tenancies.${i}.tenant}}`,
              `{{capacity.propertyIncome.tenancies.${i}.areaLabel}}`,
              `{{capacity.propertyIncome.tenancies.${i}.rentLabel}}`,
              `{{capacity.propertyIncome.tenancies.${i}.shareLabel}}`,
              `{{capacity.propertyIncome.tenancies.${i}.expiry}}`,
            ]),
            columnWidths: cols(c.contentWidth - 320, 70, 90, 70, 90),
            numeric: [1, 2, 3],
            wraps: { chars: 44, columnWidth: c.contentWidth - 320 },
          });
          return oneOf(
            { when: 'capacity && capacity.propertyIncome && capacity.propertyIncome.tenancyCount <= 1', item: tenancyTable(1) },
            { when: 'capacity && capacity.propertyIncome && capacity.propertyIncome.tenancyCount > 1 && capacity.propertyIncome.tenancyCount <= 3', item: tenancyTable(3) },
            { when: 'capacity && capacity.propertyIncome && capacity.propertyIncome.tenancyCount > 3', item: tenancyTable(ROWS.tenancies) },
          );
        })(),
        {
          ...callout(
            'On the lease profile',
            '{{capacity.propertyIncome.leaseNote}}',
            textHeight(LENGTHS.leaseNote, { size: c.scale.cell, extra: 34 }),
          ),
          conditional: 'capacity && capacity.propertyIncome && capacity.propertyIncome.leaseNote',
        },
      ], [], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.propertyIncome && capacity.propertyIncome.tenancies',
  });

  // ── Business income ──────────────────────────────────────────────────────
  //
  // Reported EBITDA through add-backs to what the assessment counts, with the
  // evidence each period rests on — absent for a lease-doc refinance, which is
  // why the page is conditional rather than the table.
  pages.push({
    ...withFurniture(page('Business income', [
      ...flow(ifItFits([
        sectionHeading({
          eyebrow: 'What the business earns',
          heading: 'Business income',
          standfirst: '{{capacity.businessIncome.periodsCaption}}',
        // "Financial periods — assessed on a <basis> basis." — the sentence is
        // composed in `commercialCapacityProjection.pure.ts:461`; 47 characters
        // of frame plus the stored `selectionBasis`.
        standfirstChars: 90,
        }),
        (() => {
          const periodsTable = (n: number) => table({
            headers: ['Period', 'Reported', 'Confirmed', 'Unconfirmed', 'Adjusted', 'Evidence'],
            rows: Array.from({ length: n }, (_, i) => [
              `{{capacity.businessIncome.periods.${i}.label}}`,
              `{{capacity.businessIncome.periods.${i}.reportedLabel}}`,
              `{{capacity.businessIncome.periods.${i}.confirmedLabel}}`,
              `{{capacity.businessIncome.periods.${i}.unconfirmedLabel}}`,
              `{{capacity.businessIncome.periods.${i}.adjustedLabel}}`,
              `{{capacity.businessIncome.periods.${i}.verification}}`,
            ]),
            columnWidths: cols(64, 82, 82, 82, 82, c.contentWidth - 392),
            numeric: [1, 2, 3, 4],
          });
          return oneOf(
            { when: 'capacity && capacity.businessIncome && capacity.businessIncome.periodCount <= 3', item: periodsTable(3) },
            { when: 'capacity && capacity.businessIncome && capacity.businessIncome.periodCount > 3', item: periodsTable(ROWS.periods) },
          );
        })(),
        definitions('What the assessment counts', [
          { term: 'Adjusted EBITDA', definition: '{{capacity.businessIncome.adjustedEbitda | currency}}' },
          { term: 'Assessable income', definition: '{{capacity.businessIncome.assessableIncome | currency}}' },
          { term: 'Verification', definition: '{{capacity.businessIncome.verificationStatus}}' },
        ]),
      ], [
        {
          ...callout(
            'Earnings are declining',
            '{{capacity.businessIncome.decliningNote}}',
            textHeight(LENGTHS.decliningNote, { size: c.scale.cell, extra: 34 }),
          ),
          conditional: 'capacity && capacity.businessIncome && capacity.businessIncome.decliningNote',
        },
      ], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.businessIncome && capacity.businessIncome.periods',
  });

  // ── Portfolio impact ─────────────────────────────────────────────────────
  //
  // Before and after, with the change signed by the same `formatDelta` whose
  // rate bug this format's first render found — and the effect in words,
  // because which way a line moves for the borrower is not always the
  // direction the number moves.
  pages.push({
    ...withFurniture(page('Portfolio impact', [
      ...flow(ifItFits([
        sectionHeading({ eyebrow: 'The borrower\'s position', heading: 'Portfolio impact' }),
        {
          ...callout(
            'Before and after',
            '{{capacity.portfolio.overview}}',
            textHeight(LENGTHS.portfolioOverview, { size: c.scale.cell, extra: 34 }),
          ),
          conditional: 'capacity && capacity.portfolio && capacity.portfolio.overview',
        },
        (() => {
          const portfolioTable = (n: number) => table({
            headers: ['Measure', 'Current', 'After', 'Change', 'Effect'],
            rows: Array.from({ length: n }, (_, i) => [
              `{{capacity.portfolio.rows.${i}.label}}`,
              `{{capacity.portfolio.rows.${i}.currentLabel}}`,
              `{{capacity.portfolio.rows.${i}.proposedLabel}}`,
              `{{capacity.portfolio.rows.${i}.changeLabel}}`,
              `{{capacity.portfolio.rows.${i}.effect}}`,
            ]),
            columnWidths: cols(c.contentWidth - 330, 85, 85, 75, 85),
            numeric: [1, 2, 3],
          });
          return oneOf(
            { when: 'capacity && capacity.portfolio && capacity.portfolio.rows && capacity.portfolio.rows.length <= 7', item: portfolioTable(7) },
            { when: 'capacity && capacity.portfolio && capacity.portfolio.rows && capacity.portfolio.rows.length > 7', item: portfolioTable(ROWS.portfolio) },
          );
        })(),
      ], [
        {
          ...callout(
            'Cross-collateralisation',
            '{{capacity.portfolio.crossCollateralisationNote}}',
            textHeight(LENGTHS.crossCollateralisation, { size: c.scale.cell, extra: 34 }),
          ),
          conditional: 'capacity && capacity.portfolio && capacity.portfolio.crossCollateralisationNote',
        },
      ], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.portfolio && capacity.portfolio.rows',
  });

  // ── Compliance ───────────────────────────────────────────────────────────
  //
  // The legacy's always-on closing section: the classification, the risk
  // indicators critical-first with severity in words, and the flags as
  // message-and-action callouts. Zero flags exist in production; the slots
  // light up as they land.
  pages.push({
    ...withFurniture(page('Compliance', [
      ...flow(ifItFits([
        sectionHeading({ eyebrow: 'Classification and risk', heading: 'Compliance' }),
        definitions('Compliance classification', [
          { term: 'Classification', definition: '{{capacity.compliance.classification}}' },
          { term: 'Compliance review required', definition: '{{capacity.compliance.complianceReview}}' },
          { term: 'Specialist review required', definition: '{{capacity.compliance.specialistReview}}' },
        ]),
        (() => {
          const warningsTable = (n: number) => table({
            headers: ['Severity', 'Category', 'Indicator'],
            rows: Array.from({ length: n }, (_, i) => [
              `{{capacity.warnings.${i}.severityLabel}}`,
              `{{capacity.warnings.${i}.category}}`,
              `{{capacity.warnings.${i}.label}}`,
            ]),
            columnWidths: cols(90, 100, c.contentWidth - 190),
            numeric: [],
            wraps: { chars: LENGTHS.warningMessage, columnWidth: c.contentWidth - 190 },
          });
          // Four, not five: the stored run's fifth row ran the most generous
          // variant 47pt past the footer, and the projection sorts critical
          // rows first, so what the four-row table drops is always the
          // mildest — and the omission callout below says so.
          return oneOf(
            { when: 'capacity && capacity.warnings && capacity.warningCount <= 2', item: warningsTable(2) },
            { when: 'capacity && capacity.warnings && capacity.warningCount > 2', item: warningsTable(ROWS.warnings) },
          );
        })(),
      ], [
        {
          ...callout('Not every indicator is shown', '{{capacity.warningsOmitted}}'),
          conditional: 'capacity && capacity.warningsOmitted',
        },
        {
          ...callout(
            'Compliance flag',
            '{{capacity.compliance.flags.0.message}} {{capacity.compliance.flags.0.action}}',
            textHeight(200, { size: c.scale.cell, extra: 34 }),
          ),
          conditional: 'capacity && capacity.compliance.flags && capacity.compliance.flags[0]',
        },
        {
          ...callout(
            'Compliance flag',
            '{{capacity.compliance.flags.1.message}} {{capacity.compliance.flags.1.action}}',
            textHeight(200, { size: c.scale.cell, extra: 34 }),
          ),
          conditional: 'capacity && capacity.compliance.flags && capacity.compliance.flags[1]',
        },
        {
          ...callout('Not every flag is shown', '{{capacity.compliance.flagsOmitted}}'),
          conditional: 'capacity && capacity.compliance.flagsOmitted',
        },
      ], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.compliance',
  });

  // ── What is outstanding ──────────────────────────────────────────────────
  pages.push({
    ...withFurniture(page('What is outstanding', [
      ...flow([
        sectionHeading({ eyebrow: 'Before this can progress', heading: 'Outstanding items' }),
        table({
          headers: ['Item', 'Status'],
          rows: Array.from({ length: ROWS.outstanding }, (_, i) => [
            `{{capacity.outstanding.${i}.label}}`,
            `{{capacity.outstanding.${i}.blocking}}`,
          ]),
          columnWidths: cols(c.contentWidth - 110, 110),
          numeric: [],
        }),
        table({
          headers: ['Next action'],
          rows: Array.from({ length: ROWS.nextActions }, (_, i) => [
            `{{capacity.nextActions.${i}.label}}`,
          ]),
          columnWidths: cols(c.contentWidth),
          numeric: [],
        }),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.outstanding',
  });

  // ── The model's reading ──────────────────────────────────────────────────
  //
  // The provenance note is bound above the prose and comes from the projection,
  // which publishes it with the analysis or not at all.
  pages.push({
    ...withFurniture(page('The reading', [
      ...flow([
        sectionHeading({ eyebrow: 'Interpretation', heading: 'How this deal reads' }),
        // The provenance note plus the legacy's attribution line — which model,
        // and the date it wrote. Both from the projection, which publishes them
        // with the analysis or not at all.
        callout(
          'Written by a language model',
          '{{capacity.analysisProvenance}} {{capacity.analysis.attribution}}',
          textHeight(LENGTHS.provenance, { size: c.scale.cell, extra: 34 }),
        ),
        prose('{{capacity.analysis.interpretation}}', textHeight(LENGTHS.interpretation)),
      ], contentTop()),
    ]), FOOTER),
    conditional: HAS_ANALYSIS,
  });

  pages.push({
    ...withFurniture(page('What stands out', [
      ...flow([
        sectionHeading({ eyebrow: 'Interpretation', heading: 'Findings' }),
        table({
          headers: ['Finding', 'Bearing', 'Detail'],
          rows: Array.from({ length: ROWS.findings }, (_, i) => [
            `{{capacity.analysis.findings.${i}.title}}`,
            `{{capacity.analysis.findings.${i}.significance}}`,
            `{{capacity.analysis.findings.${i}.detail}}`,
          ]),
          columnWidths: cols(130, 80, c.contentWidth - 210),
          numeric: [],
        }),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.analysis && capacity.analysis.findings',
  });

  /** A run of `count` scenario rows, starting at `from`. */
  const scenarioList = (from: number, count: number) => definitions(
    'Scenarios',
    Array.from({ length: count }, (_, k) => ({
      term: `{{capacity.analysis.scenarios.${from + k}.name}}`
        + ` · {{capacity.analysis.scenarios.${from + k}.executionRisk}} risk`,
      // `detail` is the reasoning followed by the expected effect, composed in
      // the projection — the page used to draw only the effect, which is a
      // conclusion with its argument cut. 345 to 489 characters across the
      // stored scenarios.
      definition: `{{capacity.analysis.scenarios.${from + k}.detail}}`,
    })),
    LENGTHS.scenarioDetail,
  );

  pages.push({
    ...withFurniture(page('What could change it', [
      ...flow(ifItFits([
        sectionHeading({ eyebrow: 'Interpretation', heading: 'Scenarios' }),
        /*
         * A definition list, not a table.
         *
         * `estimatedImpact` is a sentence a model wrote — 124 to 177 characters
         * across the three stored scenarios — and it was being set into a 140pt
         * column. Measured on `le-03`, that wrapped each row to about 204pt and
         * the three-row table rendered 611pt tall, ending 26pt past the footer.
         *
         * Widening the column is not the fix, because the row is only ever as
         * narrow as its narrowest useful column. A definition list gives the
         * sentence the full measure, which is what prose needs, and sizes its
         * rows from `chars` rather than assuming one line.
         *
         * The list is split across the required and optional halves rather than
         * drawn whole: at 345 to 489 characters a scenario is most of a page on
         * a spacious variant, and all three ran 25pt past the footer on Atelier
         * Press's third. `ifItFits` places the third scenario where there is
         * room for it, so the variants that can carry three do, and the one
         * that cannot carries two rather than printing the third over the foot.
         */
        scenarioList(0, ROWS.scenarios - 1),
      ], [
        scenarioList(ROWS.scenarios - 1, 1),
      ], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.analysis && capacity.analysis.scenarios',
  });

  /*
   * The credit assessor's questions get their own page.
   *
   * They used to sit under the scenarios table. Both are model-authored
   * sentences rather than figures — the six stored questions run 86 to 164
   * characters across the full measure, and the three scenarios wrap to three
   * lines each — so the two together declared nine rows and drew about thirty
   * lines. That ran 26pt past the footer on `le-03`, the most generous variant.
   */
  pages.push({
    ...withFurniture(page('What a lender will ask', [
      ...flow([
        sectionHeading({ eyebrow: 'Interpretation', heading: 'Questions to expect' }),
        table({
          headers: ['What a credit assessor would ask'],
          rows: Array.from({ length: ROWS.questions }, (_, i) => [
            `{{capacity.analysis.questions.${i}.label}}`,
          ]),
          columnWidths: cols(c.contentWidth),
          numeric: [],
          wraps: { chars: LENGTHS.question, columnWidth: c.contentWidth },
        }),
      ], contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.analysis && capacity.analysis.questions',
  });

  // ── How it was calculated ────────────────────────────────────────────────
  //
  // The legacy appendix's own columns — the table used to bind a `detail` the
  // projection read from a mostly-null `note`, drawing an empty column beside
  // every step, while the formula and result the appendix exists for reached
  // no page.
  pages.push({
    ...withFurniture(page('How it was calculated', [
      ...flow(ifItFits([
        sectionHeading({
          eyebrow: 'The method',
          heading: 'How the engine reached this',
          standfirst: 'Every line the engine computed, with the formula it applied.',
        }),
        table({
          headers: ['Stage', 'Step', 'Formula', 'Result'],
          rows: Array.from({ length: ROWS.method }, (_, i) => [
            `{{capacity.method.${i}.group}}`,
            `{{capacity.method.${i}.label}}`,
            `{{capacity.method.${i}.formula}}`,
            `{{capacity.method.${i}.value}}`,
          ]),
          columnWidths: cols(70, 110, c.contentWidth - 270, 90),
          numeric: [3],
          wraps: { chars: LENGTHS.formula, columnWidth: c.contentWidth - 270 },
        }),
        {
          ...callout('Not every step is shown', '{{capacity.methodOmitted}}'),
          conditional: 'capacity && capacity.methodOmitted',
        },
      ], [
        // Provenance, placed where the method table leaves room. The table is
        // the page's subject and its height comes from the record; on Atelier
        // Press's third variant the two together ran 13pt past the footer.
        definitions('What produced these figures', [
          { term: 'Engine version', definition: '{{capacity.meta.engineVersion}}' },
          { term: 'Policy version', definition: '{{capacity.meta.policyVersion}}' },
          { term: 'Lender profile', definition: '{{capacity.meta.lenderProfile}}' },
        ]),
      ], contentTop()), contentTop()),
    ]), FOOTER),
    conditional: 'capacity && capacity.method',
  });

  pages.push(disclaimerPage(STANDARD_DISCLAIMER));

  return assembleMaster({
    family, variant, manifest, c, pages, format: COMMERCIAL_CAPACITY_FORMAT,
  });
}

/** Every Commercial & Industrial Capacity master, by family, in catalogue order. */
export const COMMERCIAL_CAPACITY_TEMPLATES: CompassSeedTemplate[] = DESIGN_FAMILIES.flatMap(
  (family) => family.variants.map((variant) => buildTemplate(family, variant)),
);
