/**
 * The Commercial & Industrial Capacity Report as HTML, through the design system.
 *
 * Nothing here positions anything and nothing here names a colour. Both rules
 * are inherited from `borrowingCapacity/render.pure.ts`, and both were learned
 * the same way: drawing at hard-coded offsets is what put `BalanceMonthly
 * Repayment` in a client's document, and choosing colours per format is what
 * put three golds and two ambers in five generators of one report
 * (`BORROWING_CAPACITY.md` F3, F5, F7). Tests assert both.
 *
 * Two things this format does that the Snapshot does not:
 *
 * **A constraint is stated in words before it is drawn.** The binding test is
 * the answer this document exists to give, so the table says "binds" in a
 * column, the chart draws it in the caution role, and the narrative names it in
 * a sentence. A reader printing in monochrome, or reading colour differently,
 * gets the same answer three times.
 *
 * **Model-authored prose is labelled as such, on the page.** The analysis
 * section carries the model that wrote it and the date it was written, because
 * a client is entitled to know which parts of a finance document a machine
 * composed and which parts an engine computed. Everything outside that one
 * section is computed.
 */

import type { BrandLockupProps } from '../../reportDesign/primitives.pure.ts';
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

import { formatAmount, formatDelta, formatMeasure, periodLabel } from '../../reportDesign/measure.pure.ts';
import type {
  CommercialCapacitySnapshot,
  ComplianceFlagRow,
  ConstraintRow,
  Direction,
  LedgerRow,
  Outcome,
  PortfolioSideRow,
} from './payload.pure.ts';
import type { AnalysisFinding, AnalysisScenario } from './analysis.pure.ts';
import { capacitySections, capacitySpine, validateCapacitySpine } from './sections.pure.ts';
import { constraintChart, incomeMixChart, utilisationChart } from './charts.pure.ts';
import { formatReportDate } from '../reportDate.pure.ts';

const ARCHETYPE = REPORT_ARCHETYPES['commercial-capacity'];

/** What the product calls this format, on the cover and in the running head. */
export const DOCUMENT_NAME = 'Commercial & Industrial Capacity Report';

// ── Judgements, rendered ────────────────────────────────────────────────────

/**
 * How each outcome reads.
 *
 * Note what is *not* here: none of the five maps to `positive`. The strongest
 * outcome this engine produces is "indicatively supported", and dressing that
 * in the same green a passed test gets would be the document quietly upgrading
 * an indication into an approval. The disclaimer says this is not a lender
 * decision; the colour has to agree with it.
 */
const OUTCOME_TONE: Record<Outcome, { tone: ValueTone; callout: CalloutTone }> = {
  indicatively_supported: { tone: 'neutral', callout: 'positive' },
  supported_subject_to_verification: { tone: 'neutral', callout: 'informative' },
  outside_current_assumptions: { tone: 'negative', callout: 'negative' },
  requires_specialist_review: { tone: 'neutral', callout: 'caution' },
  insufficient_information: { tone: 'neutral', callout: 'neutral' },
};

/**
 * A direction, in words.
 *
 * The same decision `borrowingCapacity` records: colour alone gets this wrong,
 * survives neither a monochrome printer nor a reader who cannot separate red
 * from green, and on a document about someone's borrowing that is not a small
 * consideration.
 */
export const EFFECT_LABEL: Record<Direction, string> = {
  favourable: 'Improves',
  adverse: 'Reduces',
  neutral: '—',
};

/** How a finding reads in the significance column. */
export const SIGNIFICANCE_LABEL: Record<AnalysisFinding['significance'], string> = {
  strength: 'Strength',
  risk: 'Risk',
  observation: 'Observation',
};

export const RISK_LABEL: Record<AnalysisScenario['executionRisk'], string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const SEVERITY_TONE: Record<ComplianceFlagRow['severity'], CalloutTone> = {
  block: 'negative',
  review: 'caution',
  info: 'informative',
};

/**
 * What the analysis section is, said before it is read.
 *
 * Printed above the model's prose, every time, without a condition. A reader
 * who skips it has still been told; a reader who does not skip it knows what
 * they are reading.
 */
export const ANALYSIS_PROVENANCE_NOTE =
  'This section is written by a language model from the figures in this report. '
  + 'It interprets them; it does not calculate them, and no figure in this report '
  + 'comes from it. It is not a lender decision, a credit assessment or personal advice.';

// ── Dates ───────────────────────────────────────────────────────────────────


/**
 * `2026-08-01T00:00:00.000Z` → `01 August 2026`.
 *
 * Parsed rather than handed to `Date`, for the two reasons the Snapshot's
 * equivalent records: this module must stay pure, and `toLocaleDateString`
 * depends on the runtime's ICU build, so the same document would date itself
 * differently in Deno and in Node.
 */
export { formatReportDate };

// ── Input ───────────────────────────────────────────────────────────────────

export interface RenderCapacityInput {
  payload: CommercialCapacitySnapshot;
  palette: ResolvedReportPalette;
  company: CompanyBlock;
  /** The running foot on every body page. The tenant's, never ours. */
  masthead: string;
  options?: Partial<ReportDesignOptions> | null;
  heroDataUri?: string | null;
  lockup?: BrandLockupProps | null;
  /** `VOL. 2026 · ED. 08`. Supplied, never computed — this module has no clock. */
  edition?: string | null;
  reference?: string | null;
  confidentiality?: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const p = (t: string) => (t ? `<p>${escapeHtml(t)}</p>` : '');
const h3 = (t: string) => `<h3>${escapeHtml(t)}</h3>`;

function renderList(items: readonly string[]): string {
  if (!items.length) return '';
  return `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

// ── Sections ────────────────────────────────────────────────────────────────

function capacitySection(s: CommercialCapacitySnapshot, palette: ResolvedReportPalette): string {
  const shortfall = s.headline.difference.value < 0;

  const kpis: KpiCell[] = [
    {
      label: 'Indicative capacity',
      value: formatMeasure(s.headline.maximumCapacity),
      foot: s.headline.bindingConstraint ? `Set by ${s.headline.bindingConstraint.toLowerCase()}` : undefined,
    },
    { label: 'Requested', value: formatMeasure(s.headline.requestedLoan) },
    {
      // Named for what the number is, rather than one label covering both. A
      // "Difference" of −$240,000 makes a reader work out which way it points;
      // "Shortfall $240,000" does not.
      label: shortfall ? 'Shortfall' : 'Headroom',
      value: formatAmount(s.headline.difference),
      tone: shortfall ? 'negative' : 'neutral',
    },
  ];

  const outcome = renderCallout(
    OUTCOME_TONE[s.headline.outcome].callout,
    s.headline.outcomeLabel,
    p(s.headline.outcomeReason),
  );

  const ratios: TableRow[] = [
    { test: 'Loan to value', actual: formatMeasure(s.ratios.lvr), bound: `Ceiling ${formatMeasure(s.ratios.lvrCeiling)}` },
    { test: 'Loan to cost', actual: formatMeasure(s.ratios.ltc), bound: `Ceiling ${formatMeasure(s.ratios.ltcCeiling)}` },
    { test: 'Debt service cover', actual: formatMeasure(s.ratios.dscr), bound: `Minimum ${formatMeasure(s.ratios.dscrFloor)}` },
    { test: 'Interest cover', actual: formatMeasure(s.ratios.icr), bound: `Minimum ${formatMeasure(s.ratios.icrFloor)}` },
    { test: 'Debt yield', actual: formatMeasure(s.ratios.debtYield), bound: `Minimum ${formatMeasure(s.ratios.debtYieldFloor)}` },
  ];
  if (s.ratios.debtToEbitda) {
    ratios.push({ test: 'Debt to EBITDA', actual: formatMeasure(s.ratios.debtToEbitda), bound: '' });
  }

  const terms: TableRow[] = [
    { item: 'Assessment rate', value: formatMeasure(s.headline.assessmentRate) },
    { item: 'Rate basis', value: s.serviceability.assessmentRateBasis },
    { item: 'Loan term', value: formatMeasure(s.headline.loanTerm) },
    // Printed only when it differs from the term, and immediately under it: a
    // five-year facility amortised over twenty has a repayment sized for
    // twenty, and a terms table showing only the term invites the wrong
    // arithmetic from a reader who does this for a living.
    ...(s.headline.amortisation
      ? [{ item: 'Amortisation', value: formatMeasure(s.headline.amortisation) }]
      : []),
    { item: 'Monthly debt service', value: formatMeasure(s.headline.monthlyDebtService) },
    { item: 'Lender policy profile', value: s.meta.lenderProfile },
    { item: 'Transaction type', value: s.meta.assessmentTypeLabel },
    { item: 'Asset class', value: s.property.assetClass },
    { item: 'GST treatment', value: s.property.gstTreatment },
  ];
  if (s.property.address) terms.unshift({ item: 'Property', value: s.property.address });

  const surplus = renderSidenote(
    'Surplus after debt service',
    p(`${formatMeasure(s.headline.surplus)}, falling to `
      + `${formatMeasure(s.headline.sensitisedSurplus)} under the engine's rate sensitivity. `
      + 'A facility that services today and not under sensitivity is a facility a credit '
      + 'assessor will ask about.'),
  );

  return renderLede(s.narrative)
    + outcome
    + renderKpiStrip(kpis)
    + utilisationChart(s, palette)
    + renderDataTable(
      [
        { key: 'test', label: 'Measure', align: 'left' },
        { key: 'actual', label: 'This deal', align: 'right' },
        { key: 'bound', label: 'Policy', align: 'right' },
      ],
      ratios,
      { caption: 'Where the transaction sits against policy' },
    )
    + surplus
    + renderDataTable(
      [{ key: 'item', label: 'Term', align: 'left' }, { key: 'value', label: 'Value', align: 'right' }],
      terms,
      { caption: 'Assessment terms' },
    );
}

function transactionSection(s: CommercialCapacitySnapshot): string {
  const costRows: TableRow[] = s.transaction.lines.map((line) => ({
    line: line.label,
    amount: formatMeasure(line.amount),
    __total: line.emphasis === 'total',
  }));

  /**
   * The funding facts as a strip, not as a second table.
   *
   * They were a four-row table, and the first render showed why that was
   * wrong: the section came to just over one page, so the table broke and left
   * two rows alone on a sheet that was otherwise blank — the next section opens
   * on a fresh page, so there was nothing to fill it. Three figures in a strip
   * fit on the line the cost table ends on.
   */
  const funding = renderKpiStrip([
    { label: 'Total project cost', value: formatMeasure(s.transaction.totalProjectCost) },
    { label: 'Requested facility', value: formatMeasure(s.headline.requestedLoan) },
    { label: 'Contribution', value: formatMeasure(s.transaction.borrowerContribution) },
  ]);

  const gap = s.transaction.fundingGap
    ? renderCallout(
        'caution',
        'Funding shortfall',
        p(`${formatMeasure(s.transaction.fundingGap)} of the total project cost is not covered by the `
          + 'requested facility and the recorded contribution. That gap has to be funded before '
          + 'settlement, from equity, a second facility or a reduced scope.'),
      )
    : '';

  const cashOut = s.transaction.cashOut
    ? p(`The structure releases ${formatMeasure(s.transaction.cashOut)} of cash to the borrower.`)
    : '';

  const valuation = s.property.valuation
    ? renderSidenote(
        'Valuation and contribution',
        p(`${formatMeasure(s.property.valuation)} on a ${s.property.valuationBasis.toLowerCase()} basis`
          + `${s.property.purchasePrice ? `, against a purchase price of ${formatMeasure(s.property.purchasePrice)}` : ''}.`
          + ' Lending is assessed on the lower of price and valuation.')
        + p(`At the assessed capacity the borrower would need to contribute `
          + `${formatMeasure(s.headline.requiredContribution)}.`)
        + cashOut,
      )
    : '';

  return funding
    + (costRows.length
      ? renderDataTable(
          [{ key: 'line', label: 'Cost', align: 'left' }, { key: 'amount', label: 'Amount', align: 'right' }],
          costRows,
          { caption: 'Acquisition and project costs' },
        )
      : '')
    + valuation
    + gap;
}

function incomeSection(s: CommercialCapacitySnapshot, palette: ResolvedReportPalette): string {
  const perYear = periodLabel('aud/year');
  let html = '';

  if (s.propertyIncome) {
    const pi = s.propertyIncome;
    html += h3('Property income');
    html += renderKpiStrip([
      { label: 'Net operating income', value: formatMeasure(pi.netOperatingIncome) },
      { label: 'Cap rate', value: formatMeasure(pi.capitalisationRate) },
      { label: 'Break-even occupancy', value: formatMeasure(pi.breakEvenOccupancy) },
    ]);
    html += renderDataTable(
      [{ key: 'line', label: 'Line', align: 'left' }, { key: 'amount', label: `Amount ${perYear}`, align: 'right' }],
      pi.lines.map((line) => ({
        line: line.label,
        amount: formatAmount(line.amount),
        __total: line.emphasis === 'total',
      })),
      { caption: 'From passing rent to net operating income', signedKeys: ['amount'] },
    );

    if (pi.tenancies.length) {
      html += renderDataTable(
        [
          { key: 'tenant', label: 'Tenant', align: 'left' },
          { key: 'area', label: 'Area', align: 'right' },
          { key: 'rent', label: `Passing rent ${perYear}`, align: 'right' },
          { key: 'share', label: 'Share of rent', align: 'right' },
          { key: 'expiry', label: 'Expiry', align: 'left' },
        ],
        pi.tenancies.map((t) => ({
          tenant: t.tenant,
          area: t.area ? `${formatMeasure(t.area)} m²` : '—',
          rent: formatAmount(t.passingRent),
          share: formatMeasure(t.share),
          expiry: t.expiry || '—',
        })),
        { caption: 'Tenancy schedule' },
      );

      // `formatMeasure` already appends "years" for the `years` unit; adding
    // another produced "3.5 years years" on the first render.
    const walePart = pi.wale ? `A WALE of ${formatMeasure(pi.wale)}` : 'The lease profile';
      const concentration = pi.tenantConcentration
        ? ` The largest tenancy carries ${formatMeasure(pi.tenantConcentration)} of the passing rent.`
        : '';
      html += renderSidenote(
        'On the lease profile',
        p(`${walePart} across ${formatMeasure(pi.tenantCount)} `
          + `${pi.tenantCount.value === 1 ? 'tenancy' : 'tenancies'}.${concentration}`
          + ' Income a lender can rely on is income with term left on it, so expiry '
          + 'profile bears directly on what the property can support.'),
      );
    }
  }

  if (s.businessIncome) {
    const bi = s.businessIncome;
    html += h3('Business income');
    html += renderKpiStrip([
      { label: 'Adjusted EBITDA', value: formatMeasure(bi.adjustedEbitda) },
      { label: 'Assessable income', value: formatMeasure(bi.assessableIncome) },
      { label: 'Verification', value: bi.verificationStatus },
    ]);

    if (bi.periods.length) {
      html += renderDataTable(
        [
          { key: 'period', label: 'Period', align: 'left' },
          { key: 'reported', label: `Reported EBITDA ${perYear}`, align: 'right' },
          { key: 'confirmed', label: 'Confirmed add-backs', align: 'right' },
          { key: 'unconfirmed', label: 'Unconfirmed', align: 'right' },
          { key: 'adjusted', label: 'Adjusted EBITDA', align: 'right' },
          { key: 'verification', label: 'Evidence', align: 'left' },
        ],
        bi.periods.map((period) => ({
          period: period.label,
          reported: formatAmount(period.reportedEbitda),
          confirmed: formatAmount(period.confirmedAddbacks),
          unconfirmed: formatAmount(period.unconfirmedAddbacks),
          adjusted: formatAmount(period.adjustedEbitda),
          verification: period.verification,
        })),
        { caption: `Financial periods — assessed on a ${bi.selectionBasis.toLowerCase()} basis` },
      );
    }

    if (bi.decliningIncome) {
      html += renderCallout(
        'caution',
        'Earnings are declining',
        p('Adjusted earnings fall across the periods assessed'
          + `${bi.trend ? `, by ${formatMeasure(bi.trend)}` : ''}. A lender assessing a declining `
          + 'trend will generally take the most recent period rather than an average, and will '
          + 'ask what changed.'),
      );
    }
  }

  html += h3('Serviceability');
  html += incomeMixChart(s, palette);
  html += renderDataTable(
    [
      { key: 'line', label: 'Line', align: 'left' },
      { key: 'amount', label: `Amount ${perYear}`, align: 'right' },
      { key: 'effect', label: 'Effect', align: 'left' },
    ],
    s.serviceability.rows.map((row: LedgerRow) => ({
      line: row.label,
      amount: formatAmount(row.amount),
      effect: EFFECT_LABEL[row.direction],
      __total: row.emphasis === 'total',
    })),
    { signedKeys: ['amount'] },
  );

  return html;
}

function constraintsSection(s: CommercialCapacitySnapshot, palette: ResolvedReportPalette): string {
  const binding = s.constraints.find((c) => c.binding);

  const cols: TableColumn[] = [
    { key: 'test', label: 'Test', align: 'left' },
    { key: 'cap', label: 'Permits', align: 'right' },
    { key: 'threshold', label: 'Policy', align: 'right' },
    { key: 'actual', label: 'This deal', align: 'right' },
    { key: 'state', label: 'Status', align: 'left' },
  ];

  const rows: TableRow[] = s.constraints.map((c: ConstraintRow) => ({
    test: c.label,
    cap: c.applied ? formatMeasure(c.cap) : '—',
    threshold: c.threshold ? formatMeasure(c.threshold) : '—',
    actual: c.actual ? formatMeasure(c.actual) : '—',
    // Three states, not two. "Not applied" and "did not bind" are different
    // facts about a facility, and collapsing them tells a reader a test passed
    // when it was never run.
    state: !c.applied ? 'Not applicable' : c.binding ? 'Binds' : 'Does not bind',
  }));

  const explanation = binding
    ? renderCallout(
        'informative',
        `The ${binding.label.toLowerCase()} is what sets this capacity`,
        p(`Of the tests applied, the ${binding.label.toLowerCase()} permits the smallest facility — `
          + `${formatMeasure(binding.cap)}. Every other test would allow more, so lifting them `
          + 'changes nothing until this one moves.')
        + (binding.formula ? p(`It is calculated as ${binding.formula}.`) : ''),
      )
    : renderCallout(
        'neutral',
        'No single binding test',
        p('The assessment did not resolve to one binding constraint. That normally means '
          + 'information the tests depend on is still outstanding — see the compliance section.'),
      );

  const formulas = s.constraints.filter((c) => c.formula).length
    ? renderDataTable(
        [{ key: 'test', label: 'Test', align: 'left' }, { key: 'formula', label: 'Calculated as', align: 'left' }],
        s.constraints.filter((c) => c.formula).map((c) => ({ test: c.label, formula: c.formula })),
        { caption: 'How each cap is derived' },
      )
    : '';

  // The chart carries the caption for this pair; the table under it does not
  // repeat one. Two uppercase mono captions six lines apart read as a heading
  // that was printed twice.
  return explanation
    + constraintChart(s, palette)
    + renderDataTable(cols, rows)
    + formulas;
}

function portfolioSection(s: CommercialCapacitySnapshot): string {
  const pf = s.portfolio;
  if (!pf) return '';

  const DIRECTION: Record<typeof pf.direction, string> = {
    improves: 'improves',
    weakens: 'weakens',
    mixed: 'has a mixed effect on',
    unchanged: 'leaves unchanged',
  };

  const rows: TableRow[] = pf.rows.map((row: PortfolioSideRow) => ({
    measure: row.label,
    current: formatMeasure(row.current),
    proposed: formatMeasure(row.proposed),
    change: row.change ? formatDelta(row.change) : '—',
    effect: EFFECT_LABEL[row.direction],
  }));

  const concentration = pf.crossCollateralisedShare && pf.crossCollateralisedShare.value > 0
    ? renderSidenote(
        'Cross-collateralisation',
        p(`${formatMeasure(pf.crossCollateralisedShare)} of the portfolio is cross-collateralised. `
          + 'Security held across assets narrows the options on any one of them — a sale, a '
          + 'refinance or an equity release has to be negotiated against the whole structure.'),
      )
    : '';

  return renderCallout(
    'neutral',
    'Before and after',
    p(`Across ${formatMeasure(pf.assetCount)} existing `
      + `${pf.assetCount.value === 1 ? 'asset' : 'assets'}, this transaction `
      + `${DIRECTION[pf.direction]} the borrower's position. `
      + 'The effect column says which way each line moves for the borrower, which is not '
      + 'always the direction the number moves.'),
  )
    + renderDataTable(
      [
        { key: 'measure', label: 'Measure', align: 'left' },
        { key: 'current', label: 'Current', align: 'right' },
        { key: 'proposed', label: 'After', align: 'right' },
        { key: 'change', label: 'Change', align: 'right' },
        { key: 'effect', label: 'Effect', align: 'left' },
      ],
      rows,
      { caption: 'Portfolio position before and after the proposed transaction', signedKeys: ['change'] },
    )
    + concentration;
}

function analysisSection(s: CommercialCapacitySnapshot): string {
  const a = s.analysis;
  if (!a) return '';

  const provenance = renderCallout(
    'neutral',
    'How this section was produced',
    p(ANALYSIS_PROVENANCE_NOTE)
      + p(`Written by ${a.model}${a.generatedAt ? ` on ${formatReportDate(a.generatedAt)}` : ''}.`),
  );

  const findings = renderDataTable(
    [
      { key: 'finding', label: 'Finding', align: 'left' },
      { key: 'significance', label: 'Bearing', align: 'left' },
      { key: 'detail', label: 'Why it matters', align: 'left' },
    ],
    a.findings.map((f) => ({
      finding: f.title,
      significance: SIGNIFICANCE_LABEL[f.significance],
      detail: f.detail,
    })),
    { caption: 'What the figures show' },
  );

  const scenarios = a.scenarios.map((scenario) =>
    h3(scenario.name)
    + p(scenario.reasoning)
    + renderDataTable(
      [{ key: 'item', label: 'Item', align: 'left' }, { key: 'value', label: 'Detail', align: 'left' }],
      [
        ...(scenario.estimatedImpact ? [{ item: 'Expected effect', value: scenario.estimatedImpact }] : []),
        { item: 'Execution risk', value: RISK_LABEL[scenario.executionRisk] },
      ],
    )
    + (scenario.evidenceRequired.length
      ? p('Evidence required:') + renderList(scenario.evidenceRequired)
      : '')).join('');

  const questions = a.questionsForCredit.length
    ? renderCallout(
        'informative',
        'What a credit assessor will ask',
        renderList(a.questionsForCredit),
      )
    : '';

  return provenance
    + renderLede(a.interpretation)
    + findings
    + (scenarios ? h3('What would move the result') + scenarios : '')
    + questions;
}

function complianceSection(s: CommercialCapacitySnapshot): string {
  let html = renderDataTable(
    [{ key: 'item', label: 'Item', align: 'left' }, { key: 'value', label: 'Position', align: 'left' }],
    [
      { item: 'Classification', value: s.compliance.classificationLabel },
      { item: 'Compliance review required', value: s.compliance.requiresComplianceReview ? 'Yes' : 'No' },
      { item: 'Specialist review required', value: s.compliance.requiresSpecialistReview ? 'Yes' : 'No' },
    ],
    { caption: 'Compliance classification' },
  );

  for (const flag of s.compliance.flags) {
    html += renderCallout(SEVERITY_TONE[flag.severity], flag.message, p(flag.action));
  }

  const critical = s.warnings.filter((w) => w.severity === 'critical');
  const other = s.warnings.filter((w) => w.severity !== 'critical');

  if (critical.length || other.length) {
    html += renderDataTable(
      [
        { key: 'severity', label: 'Severity', align: 'left' },
        { key: 'category', label: 'Category', align: 'left' },
        { key: 'message', label: 'Indicator', align: 'left' },
      ],
      [...critical, ...other].map((w) => ({
        severity: w.severity === 'critical' ? 'Critical' : w.severity === 'warning' ? 'Warning' : 'For information',
        category: w.category,
        message: w.message,
      })),
      { caption: `Risk indicators (${s.warnings.length})` },
    );
  }

  if (s.outstanding.length) {
    const blocking = s.outstanding.filter((item) => item.blocking);
    html += renderCallout(
      blocking.length ? 'caution' : 'neutral',
      'Information still outstanding',
      renderList(s.outstanding.map((item) => (item.blocking ? `${item.label} (required)` : item.label))),
    );
  }

  if (s.nextActions.length) {
    html += renderCallout('positive', 'Recommended next actions', renderList(s.nextActions));
  }

  return html;
}

/**
 * The stage whose rows this appendix does not repeat.
 *
 * The engine's explain trail ends with one row per capacity cap — the same
 * label, the same formula and the same figure the constraints section prints
 * five pages earlier, in a table whose whole purpose is those rows. Repeating
 * them cost a page and told the reader nothing, and the second page it cost
 * carried two rows and nothing else.
 */
const METHOD_STAGE_PRINTED_ELSEWHERE = 'Capacity caps';

function methodSection(s: CommercialCapacitySnapshot): string {
  const steps = (s.method ?? []).filter(
    (step) => step.group !== METHOD_STAGE_PRINTED_ELSEWHERE,
  );
  if (!steps.length) return '';

  return renderCallout(
    'neutral',
    'Reading this table',
    p('Every line the engine computed, in the order it computed them, with the '
      + 'formula it applied. It is here so the figures in this report can be checked '
      + 'rather than taken on trust. The capacity tests are not repeated here — they '
      + 'have their own section, with their formulas.'),
  )
    + renderDataTable(
      [
        { key: 'group', label: 'Stage', align: 'left' },
        { key: 'label', label: 'Step', align: 'left' },
        { key: 'formula', label: 'Formula', align: 'left' },
        { key: 'value', label: 'Result', align: 'right' },
      ],
      steps.map((step) => ({
        group: step.group,
        label: step.label,
        formula: step.formula,
        value: step.value,
      })),
      { caption: 'The calculation, step by step' },
    );
}

const SECTION_BODY: Record<
  string,
  (s: CommercialCapacitySnapshot, palette: ResolvedReportPalette) => string
> = {
  capacity: capacitySection,
  transaction: transactionSection,
  income: incomeSection,
  constraints: constraintsSection,
  portfolio: portfolioSection,
  analysis: analysisSection,
  compliance: complianceSection,
  method: methodSection,
};

// ── The document ────────────────────────────────────────────────────────────

/**
 * The body — cover, contents, sections, closing — without the shell.
 *
 * Separate from `renderCommercialCapacityDocument` so a test can assert on the
 * markup without carrying 30KB of stylesheet through every assertion.
 */
export function renderCapacityBody(input: RenderCapacityInput): string {
  const { payload } = input;
  const companyName = input.company.name.lead
    + (input.company.name.tail ? ` ${input.company.name.tail}` : '');

  const cover = renderCover({
    eyebrow: DOCUMENT_NAME,
    title: payload.meta.subject,
    // The tenant's company, resolved from the brand snapshot, and nowhere is
    // there a branch where ours can appear — the defect `BORROWING_CAPACITY.md`
    // F1 records, closed by construction rather than by care.
    masthead: companyName,
    edition: input.edition ?? null,
    meta: [
      { label: 'Assessment date', value: formatReportDate(payload.meta.assessedOn) },
      { label: 'Transaction', value: payload.meta.assessmentTypeLabel },
      { label: 'Asset', value: payload.property.assetClass },
      // Not the reference: it already prints at the foot of this page, and a
      // cover that states one fact twice reads as a mistake.
    ].filter((m) => m.value),
    lockup: input.lockup ?? null,
    heroDataUri: input.heroDataUri ?? null,
    footerLeft: input.confidentiality ?? 'Private and confidential',
    footerRight: input.reference ?? '',
  });

  // Derived from the spine rather than counted by hand, so the contents cannot
  // list a section that was not built — which for a format with five
  // conditional sections is the failure most likely to happen.
  const contents = renderContentsPage(
    'Contents',
    contentsEntriesFor(capacitySpine(payload)).map((e) => ({
      number: e.number,
      title: e.title,
      note: e.note,
    })),
  );

  const sections = capacitySections(payload).map((section, index) => {
    const body = SECTION_BODY[section.id]?.(payload, input.palette) ?? '';
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

  // The engine's own disclaimer, on the disclaimer page.
  //
  // It was carried on the payload and printed nowhere until a render was read.
  // It went at the foot of the compliance section first, which pushed a
  // four-line callout onto a sheet of its own — and it belongs here anyway:
  // "this is an indicative assessment, not a credit approval" is a statement
  // about the whole document, and this is the page that makes those.
  const company: CompanyBlock = payload.disclaimer
    ? {
        ...input.company,
        disclaimer: {
          ...input.company.disclaimer,
          paragraphs: [payload.disclaimer, ...input.company.disclaimer.paragraphs],
        },
      }
    : input.company;

  const closing = renderCompanyPage({
    block: company,
    lockup: input.lockup ?? null,
  });

  return cover + contents + sections + closing;
}

/**
 * The whole document, ready to POST to the render service.
 *
 * Throws on a structurally invalid spine. There is no fallback renderer on this
 * path, so a document that is wrong is better as an error here — where the
 * message names the problem — than as a PDF a client opens.
 */
export function renderCommercialCapacityDocument(input: RenderCapacityInput): string {
  const problems = validateCapacitySpine(input.payload);
  if (problems.length) {
    throw new Error(
      `Commercial & Industrial Capacity Report has an invalid structure:\n  ${problems.join('\n  ')}`,
    );
  }

  const company = input.company.name.lead
    + (input.company.name.tail ? ` ${input.company.name.tail}` : '');

  return renderDocument({
    title: `${DOCUMENT_NAME} — ${input.payload.meta.subject}`,
    author: company,
    subject: DOCUMENT_NAME,
    css: buildReportCss({
      palette: input.palette,
      options: input.options ?? null,
      masthead: input.masthead,
    }),
    bodyHtml: renderCapacityBody(input),
  });
}

// ── Driven from a brand snapshot ────────────────────────────────────────────

export interface RenderCapacityFromBrandInput {
  payload: CommercialCapacitySnapshot;
  /**
   * The brand, as it was at generation time.
   *
   * A snapshot rather than a lookup so a report re-issued a year later
   * reproduces the brand it was issued under rather than today's.
   */
  snapshot: ReportBrandSnapshot;
  disclaimer?: CompanyDisclaimer | null;
  /** The **tenant's** cover art, inlined. Never the house art. */
  coverArtDataUri?: string | null;
  options?: Partial<ReportDesignOptions> | null;
  edition?: string | null;
  reference?: string | null;
}

export interface CapacityRenderResult {
  html: string;
  /**
   * What the brand snapshot was missing.
   *
   * Beside the HTML rather than thrown or swallowed: "no ABN on an Australian
   * advisory document" is worth a line in a log, and is not worth failing a
   * client's report over.
   */
  gaps: string[];
}

export function renderCapacityFromBrand(input: RenderCapacityFromBrandInput): CapacityRenderResult {
  const brand = resolveSnapshotBrand({
    snapshot: input.snapshot,
    disclaimer: input.disclaimer ?? null,
    coverArtDataUri: input.coverArtDataUri ?? null,
  });

  return {
    html: renderCommercialCapacityDocument({
      payload: input.payload,
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
