/**
 * What a Commercial & Industrial Capacity template may bind.
 *
 * ## This restates the snapshot, it does not recompute anything
 *
 * `_shared/reports/commercialCapacity/` already builds a
 * `CommercialCapacitySnapshot` for `render-commercial-capacity-pdf`, from the
 * stored calculation run. This restates that, exactly as the Comparison, Client
 * Details and Report Q&A projections restate their normalisers.
 *
 * The format's first rule is that **every figure comes from the stored run and
 * never from a recomputation**, and a projection is the easiest place in this
 * programme to break it — a derived total here would be a second engine, and a
 * document whose arithmetic disagrees with the calculator a broker was looking
 * at is worse than one with a gap in it. Nothing below computes; it unwraps,
 * labels and caps.
 *
 * ## Measures are unwrapped to their values
 *
 * The snapshot wraps every number in a `Measure` so the renderer can format it.
 * A template binds `{{capacity.headline.maximumCapacity | currency}}` instead,
 * so this publishes `.value` and lets the filter do the formatting — the same
 * choice `clientDetailsProjection.pure.ts` made, and for the same reason: a
 * template cannot reach into an object it has no syntax for.
 *
 * ## The analysis carries its provenance or it is not published
 *
 * The contract's fourth rule is that the page says what it is. The provenance
 * note is published **beside** the analysis rather than left to each of fifty
 * masters to remember, so a master that draws the model's prose cannot draw it
 * without the sentence that says a model wrote it. `analysis` and
 * `analysisProvenance` are published together or not at all.
 *
 * ## What production actually holds
 *
 * Sixteen assessments; **thirteen have no calculation run** (seven `draft`, four
 * `archived`, two `data_entry`) and so have no figures for a document to carry.
 * Of the three that do, **all three are `outside_current_assumptions`, all bound
 * by the debt service coverage ratio**. A decline is not the edge case here — it
 * is the whole corpus — so `outcome`, `outcomeReason` and `bindingConstraint`
 * are the fields the masters are built around rather than a footnote.
 */
import type {
  CommercialCapacitySnapshot,
  ConstraintRow,
  CostLine,
} from './reports/commercialCapacity/payload.pure.ts';
import type { CapacityAnalysis } from './reports/commercialCapacity/analysis.pure.ts';
import {
  ANALYSIS_PROVENANCE_NOTE,
  EFFECT_LABEL,
  formatReportDate,
} from './reports/commercialCapacity/render.pure.ts';
import {
  formatAmount,
  formatDelta,
  formatMeasure,
  type Measure,
} from './reportDesign/measure.pure.ts';

/**
 * Collections a page may draw.
 *
 * The page model cannot paginate, so an unbounded collection runs off the end of
 * a fixed sequence. Where a cap bites, the record's own count is printed beside
 * it — a table silently showing eight of nineteen costs is a misleading
 * document, and the count is what makes it an honest one.
 */
export const CAPS = {
  constraints: 8,
  transactionLines: 10,
  incomeLines: 10,
  tenancies: 6,
  findings: 6,
  scenarios: 3,
  questions: 6,
  warnings: 5,
  outstanding: 6,
  nextActions: 5,
  /** Five of the stored run's twenty steps fit beside the version table. */
  method: 5,
  /** The serviceability ledger — seven rows on the stored run, eight at the cap:
   * the reserved height is the deepest variant's, and ten ran three variants'
   * declared arithmetic past the footer. */
  serviceabilityRows: 8,
  /** Business income periods — the engine weights at most a handful. */
  periods: 4,
  /** Portfolio before/after rows — the normaliser builds a fixed measure set. */
  portfolioRows: 8,
  /** Compliance flags drawn as callouts; the count is printed beside them. */
  flags: 2,
} as const;

function put(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') target[key] = value;
}

function str(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return s === '' ? undefined : s;
}

/** A `Measure` to the bare number a filter can format. Null stays absent. */
function num(m: Measure | null | undefined): number | undefined {
  if (!m || typeof m.value !== 'number' || !Number.isFinite(m.value)) return undefined;
  return m.value;
}

function costLine(line: CostLine): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'label', str(line.label));
  put(out, 'amount', num(line.amount as Measure));
  put(out, 'note', str((line as unknown as Record<string, unknown>).note));
  return out;
}

/**
 * One capacity test, in the legacy table's own columns.
 *
 * This used to read `limit`, `headroom` and `status` — three fields
 * `ConstraintRow` has never had (it has `cap`, `threshold`, `actual`,
 * `applied`), which the `as Record<string, unknown>` cast hid from the type
 * checker. Every master's tests table therefore printed its Limit and Status
 * columns **empty on every row** — on the table the format exists for.
 *
 * The columns are composed here because they mix units — `cap` is dollars,
 * `threshold` and `actual` are a rate on the LVR row and a ratio on the DSCR
 * row, and three of the eight stored tests carry neither — so one template
 * filter cannot format the column. `formatMeasure` is the legacy table's own
 * formatter, and the em dash is its own absent-cell treatment.
 */
function constraint(row: ConstraintRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'label', str(row.label));
  put(out, 'capLabel', row.applied && row.cap ? formatMeasure(row.cap) : '—');
  put(out, 'thresholdLabel', row.threshold ? formatMeasure(row.threshold) : '—');
  put(out, 'actualLabel', row.actual ? formatMeasure(row.actual) : '—');
  // Three states, not two — "Not applicable" and "Does not bind" are different
  // facts about a facility, and collapsing them tells a reader a test passed
  // when it was never run. The legacy table's own words.
  out.statusLabel = !row.applied ? 'Not applicable' : row.binding ? 'Binds' : 'Does not bind';
  put(out, 'formula', str(row.formula));
  put(out, 'cap', num(row.cap));
  // Which test decided the answer. The whole document turns on this one row and
  // all three assessments in production are bound by the same test, so it is
  // published as a flag a master can draw a marker from.
  if (row.binding === true) out.binding = true;
  return out;
}

export interface ProjectedCommercialCapacity {
  capacity: Record<string, unknown>;
}

export function projectCommercialCapacity(
  snapshot: CommercialCapacitySnapshot,
): ProjectedCommercialCapacity {
  const capacity: Record<string, unknown> = {};
  const s = snapshot as unknown as Record<string, any>;

  // ── who and what ─────────────────────────────────────────────────────────
  const meta: Record<string, unknown> = {};
  put(meta, 'subject', str(s.meta?.subject));
  put(meta, 'reference', str(s.meta?.reference));
  put(meta, 'title', str(s.meta?.title));
  put(meta, 'assessedOn', str(s.meta?.assessedOn));
  put(meta, 'segment', str(s.meta?.segment));
  /*
   * Derived only when there is something to derive from.
   *
   * A ternary here always yields a string, which made `meta` truthy — and so
   * `capacity` truthy — for a snapshot with nothing in it. A page conditional on
   * `capacity` would then have drawn blank. Absent has to mean absent all the
   * way up, not merely per-key; the Report Q&A projection had the same defect in
   * `subject` and a test found it there too.
   */
  const segment = str(s.meta?.segment);
  if (segment) put(meta, 'segmentLabel', segment === 'industrial' ? 'Industrial' : 'Commercial');
  put(meta, 'assessmentType', str(s.meta?.assessmentTypeLabel));
  put(meta, 'lenderProfile', str(s.meta?.lenderProfile));
  // Both versions, because a figure is only reproducible against the pair that
  // produced it, and a re-issued report must be checkable against the first.
  put(meta, 'engineVersion', str(s.meta?.engineVersion));
  put(meta, 'policyVersion', str(s.meta?.policyVersion));
  if (Object.keys(meta).length) capacity.meta = meta;

  const property: Record<string, unknown> = {};
  put(property, 'address', str(s.property?.address));
  put(property, 'assetClass', str(s.property?.assetClass));
  put(property, 'gstTreatment', str(s.property?.gstTreatment));
  put(property, 'lettableArea', num(s.property?.lettableArea));
  put(property, 'purchasePrice', num(s.property?.purchasePrice));
  put(property, 'valuation', num(s.property?.valuation));
  put(property, 'valuationBasis', str(s.property?.valuationBasis));
  if (Object.keys(property).length) capacity.property = property;

  // ── the answer ───────────────────────────────────────────────────────────
  const h = s.headline ?? {};
  const headline: Record<string, unknown> = {};
  put(headline, 'outcome', str(h.outcome));
  put(headline, 'outcomeLabel', str(h.outcomeLabel));
  put(headline, 'outcomeReason', str(h.outcomeReason));
  put(headline, 'bindingConstraint', str(h.bindingConstraint));
  put(headline, 'maximumCapacity', num(h.maximumCapacity));
  put(headline, 'requestedLoan', num(h.requestedLoan));
  put(headline, 'difference', num(h.difference));
  put(headline, 'requiredContribution', num(h.requiredContribution));
  put(headline, 'assessmentRate', num(h.assessmentRate));
  put(headline, 'loanTerm', num(h.loanTerm));
  put(headline, 'amortisation', num(h.amortisation));
  put(headline, 'monthlyDebtService', num(h.monthlyDebtService));
  put(headline, 'surplus', num(h.surplus));
  put(headline, 'sensitisedSurplus', num(h.sensitisedSurplus));

  /*
   * Headroom or shortfall, as a word.
   *
   * `difference` is signed and a template cannot branch on a sign. Every
   * assessment in production is a shortfall, so a master that only reads
   * `difference` prints a negative number under a heading that says "headroom".
   */
  const difference = num(h.difference);
  if (difference !== undefined) {
    put(headline, 'differenceLabel', difference < 0 ? 'Shortfall' : 'Headroom');
    put(headline, 'differenceAbsolute', Math.abs(difference));
    put(headline, 'isShortfall', difference < 0 ? true : undefined);
  }
  if (Object.keys(headline).length) capacity.headline = headline;

  put(capacity, 'narrative', str(s.narrative));

  // ── the tests ────────────────────────────────────────────────────────────
  const r = s.ratios ?? {};
  const ratios: Record<string, unknown> = {};
  for (const key of [
    'lvr', 'lvrCeiling', 'dscr', 'dscrFloor', 'icr', 'icrFloor',
    'debtYield', 'debtYieldFloor', 'ltc', 'ltcCeiling', 'debtToEbitda',
  ]) put(ratios, key, num(r[key]));
  if (Object.keys(ratios).length) capacity.ratios = ratios;

  const constraints = Array.isArray(s.constraints) ? s.constraints : [];
  if (constraints.length) {
    capacity.constraints = constraints.slice(0, CAPS.constraints).map(constraint);
    put(capacity, 'constraintCount', constraints.length);
    if (constraints.length > CAPS.constraints) {
      put(capacity, 'constraintsOmitted',
        `${constraints.length - CAPS.constraints} further tests are not shown.`);
    }

    /*
     * The explanation the legacy sets over its constraints table, in its exact
     * sentences — one shape when a test bound, another when none did, and the
     * title composed beside the body because the two shapes take different
     * titles. What was here before bound only the binding test's *name*.
     */
    const binding = constraints.find((c: ConstraintRow) => c.binding);
    if (binding) {
      put(capacity, 'bindingTitle',
        `The ${binding.label.toLowerCase()} is what sets this capacity`);
      put(capacity, 'bindingExplanation',
        `Of the tests applied, the ${binding.label.toLowerCase()} permits the smallest facility — `
        + `${formatMeasure(binding.cap)}. Every other test would allow more, so lifting them `
        + 'changes nothing until this one moves.'
        + (binding.formula ? ` It is calculated as ${binding.formula}.` : ''));
    } else {
      put(capacity, 'bindingTitle', 'No single binding test');
      put(capacity, 'bindingExplanation',
        'The assessment did not resolve to one binding constraint. That normally means '
        + 'information the tests depend on is still outstanding — see the compliance section.');
    }
  }

  /*
   * Where the transaction sits against policy — the answer page's ratio table,
   * row for row. Composed because the two columns mix units (a rate on the LVR
   * row, a ratio on the DSCR row) and because the policy cell is a labelled
   * bound ("Ceiling 65%", "Minimum 1.25x") rather than a bare figure.
   */
  if (Object.keys(ratios).length) {
    const ratioRows: Array<Record<string, unknown>> = [];
    const ratioRow = (label: string, actual: Measure | null, bound: string | undefined) => {
      if (!actual) return;
      const row: Record<string, unknown> = { label, actualLabel: formatMeasure(actual) };
      put(row, 'policyLabel', bound);
      ratioRows.push(row);
    };
    ratioRow('Loan to value', r.lvr, r.lvrCeiling ? `Ceiling ${formatMeasure(r.lvrCeiling)}` : undefined);
    ratioRow('Loan to cost', r.ltc, r.ltcCeiling ? `Ceiling ${formatMeasure(r.ltcCeiling)}` : undefined);
    ratioRow('Debt service cover', r.dscr, r.dscrFloor ? `Minimum ${formatMeasure(r.dscrFloor)}` : undefined);
    ratioRow('Interest cover', r.icr, r.icrFloor ? `Minimum ${formatMeasure(r.icrFloor)}` : undefined);
    ratioRow('Debt yield', r.debtYield, r.debtYieldFloor ? `Minimum ${formatMeasure(r.debtYieldFloor)}` : undefined);
    ratioRow('Debt to EBITDA', r.debtToEbitda, undefined);
    if (ratioRows.length) capacity.ratioRows = ratioRows;
  }

  /*
   * The assessment terms the legacy table prints and the masters never drew —
   * the term composed with its amortisation, because "a five-year facility
   * amortised over twenty has a repayment sized for twenty, and a terms table
   * showing only the term invites the wrong arithmetic from a reader who does
   * this for a living" (the payload's own words). One row, so an assessment
   * with no separate amortisation shows no empty band.
   */
  if (h.loanTerm) {
    put(headline, 'termLabel', h.amortisation
      ? `${formatMeasure(h.loanTerm)}, amortised over ${formatMeasure(h.amortisation)}`
      : formatMeasure(h.loanTerm));
  }

  // ── the serviceability ledger ────────────────────────────────────────────
  //
  // Income in, commitments out, the surplus at the foot — the legacy's own
  // ledger, which this projection dropped entirely. `amountLabel` is signed by
  // `formatAmount` because the commitments rows are negative and the sign is
  // the row's meaning; `effect` is the direction in words, because colour
  // alone gets it wrong and gets it wrong invisibly.
  const svc = s.serviceability ?? {};
  const svcRows = Array.isArray(svc.rows) ? svc.rows : [];
  const serviceability: Record<string, unknown> = {};
  if (svcRows.length) {
    serviceability.rows = svcRows.slice(0, CAPS.serviceabilityRows).map((row: any) => {
      const out: Record<string, unknown> = {};
      put(out, 'label', str(row?.label));
      if (row?.amount) put(out, 'amountLabel', formatAmount(row.amount));
      const effect = EFFECT_LABEL[row?.direction as keyof typeof EFFECT_LABEL];
      out.effect = effect ?? '—';
      if (row?.emphasis === 'total') out.total = true;
      return out;
    });
    put(serviceability, 'rowCount', svcRows.length);
  }
  put(serviceability, 'rateBasis', str(svc.assessmentRateBasis));
  if (h.surplus && h.sensitisedSurplus) {
    put(serviceability, 'surplusNote',
      `${formatMeasure(h.surplus)}, falling to ${formatMeasure(h.sensitisedSurplus)} under the `
      + "engine's rate sensitivity. A facility that services today and not under sensitivity "
      + 'is a facility a credit assessor will ask about.');
  }
  if (Object.keys(serviceability).length) capacity.serviceability = serviceability;

  // ── the money ────────────────────────────────────────────────────────────
  const t = s.transaction ?? {};
  const transaction: Record<string, unknown> = {};
  const tLines = Array.isArray(t.lines) ? t.lines : [];
  if (tLines.length) {
    transaction.lines = tLines.slice(0, CAPS.transactionLines).map(costLine);
    put(transaction, 'lineCount', tLines.length);
  }
  put(transaction, 'totalProjectCost', num(t.totalProjectCost));
  put(transaction, 'borrowerContribution', num(t.borrowerContribution));
  put(transaction, 'fundingGap', num(t.fundingGap));
  put(transaction, 'cashOut', num(t.cashOut));
  /*
   * The three notes the legacy transaction section prints, in its sentences.
   * Each is a whole statement or absent — the valuation sidenote folds the
   * purchase price and the cash-out release in only when the record holds
   * them, so no master is left holding half a sentence.
   */
  if (t.fundingGap) {
    put(transaction, 'fundingGapNote',
      `${formatMeasure(t.fundingGap)} of the total project cost is not covered by the requested `
      + 'facility and the recorded contribution. That gap has to be funded before settlement, '
      + 'from equity, a second facility or a reduced scope.');
  }
  if (s.property?.valuation) {
    const price = s.property.purchasePrice
      ? `, against a purchase price of ${formatMeasure(s.property.purchasePrice)}`
      : '';
    const cashOut = t.cashOut
      ? ` The structure releases ${formatMeasure(t.cashOut)} of cash to the borrower.`
      : '';
    const basis = str(s.property.valuationBasis);
    put(transaction, 'valuationNote',
      `${formatMeasure(s.property.valuation)}${basis ? ` on a ${basis.toLowerCase().replace(/\.$/, '')} basis` : ''}`
      + `${price}. Lending is assessed on the lower of price and valuation.`
      + (h.requiredContribution
        ? ` At the assessed capacity the borrower would need to contribute ${formatMeasure(h.requiredContribution)}.`
        : '')
      + cashOut);
  }
  if (Object.keys(transaction).length) capacity.transaction = transaction;

  const pi = s.propertyIncome ?? {};
  const propertyIncome: Record<string, unknown> = {};
  const piLines = Array.isArray(pi.lines) ? pi.lines : [];
  if (piLines.length) {
    propertyIncome.lines = piLines.slice(0, CAPS.incomeLines).map(costLine);
    put(propertyIncome, 'lineCount', piLines.length);
  }
  put(propertyIncome, 'netOperatingIncome', num(pi.netOperatingIncome));
  put(propertyIncome, 'capitalisationRate', num(pi.capitalisationRate));
  put(propertyIncome, 'breakEvenOccupancy', num(pi.breakEvenOccupancy));
  put(propertyIncome, 'wale', num(pi.wale));
  put(propertyIncome, 'tenantCount', num(pi.tenantCount));
  put(propertyIncome, 'tenantConcentration', num(pi.tenantConcentration));

  /*
   * The tenancy schedule — declared in the caps from the start, and never
   * published. Income a lender can rely on is income with term left on it, so
   * the legacy prints who pays what until when; the labels are composed here
   * because area, rent and share are three different units in one row and the
   * em dash is the legacy cell's own absent treatment.
   */
  const tenancies = Array.isArray(pi.tenancies) ? pi.tenancies : [];
  if (tenancies.length) {
    propertyIncome.tenancies = tenancies.slice(0, CAPS.tenancies).map((tn: any) => {
      const row: Record<string, unknown> = {};
      put(row, 'tenant', str(tn?.tenant));
      row.areaLabel = tn?.area ? `${formatMeasure(tn.area)} m²` : '—';
      if (tn?.passingRent) put(row, 'rentLabel', formatAmount(tn.passingRent));
      if (tn?.share) put(row, 'shareLabel', formatMeasure(tn.share));
      row.expiry = str(tn?.expiry) ?? '—';
      return row;
    });
    put(propertyIncome, 'tenancyCount', tenancies.length);
    // The lease-profile sidenote, in the legacy's sentences — including the
    // rule its first render taught: `formatMeasure` already appends "years",
    // and appending another printed "3.5 years years".
    const walePart = pi.wale ? `A WALE of ${formatMeasure(pi.wale)}` : 'The lease profile';
    const concentration = pi.tenantConcentration
      ? ` The largest tenancy carries ${formatMeasure(pi.tenantConcentration)} of the passing rent.`
      : '';
    if (pi.tenantCount) {
      put(propertyIncome, 'leaseNote',
        `${walePart} across ${formatMeasure(pi.tenantCount)} `
        + `${pi.tenantCount.value === 1 ? 'tenancy' : 'tenancies'}.${concentration}`
        + ' Income a lender can rely on is income with term left on it, so expiry '
        + 'profile bears directly on what the property can support.');
    }
  }
  if (Object.keys(propertyIncome).length) capacity.propertyIncome = propertyIncome;

  const bi = s.businessIncome ?? {};
  const businessIncome: Record<string, unknown> = {};
  put(businessIncome, 'adjustedEbitda', num(bi.adjustedEbitda));
  put(businessIncome, 'assessableIncome', num(bi.assessableIncome));
  put(businessIncome, 'trend', num(bi.trend));
  put(businessIncome, 'verificationStatus', str(bi.verificationStatus));

  /*
   * The financial periods — reported EBITDA through add-backs to what the
   * assessment counts, with the evidence each period rests on. The legacy's
   * caption carries the selection basis ("assessed on a weighted 3:2:1…
   * basis"), so it is composed here as one sentence a standfirst can bind.
   */
  const periods = Array.isArray(bi.periods) ? bi.periods : [];
  if (periods.length) {
    businessIncome.periods = periods.slice(0, CAPS.periods).map((period: any) => {
      const row: Record<string, unknown> = {};
      put(row, 'label', str(period?.label));
      if (period?.reportedEbitda) put(row, 'reportedLabel', formatAmount(period.reportedEbitda));
      if (period?.confirmedAddbacks) put(row, 'confirmedLabel', formatAmount(period.confirmedAddbacks));
      if (period?.unconfirmedAddbacks) put(row, 'unconfirmedLabel', formatAmount(period.unconfirmedAddbacks));
      if (period?.adjustedEbitda) put(row, 'adjustedLabel', formatAmount(period.adjustedEbitda));
      put(row, 'verification', str(period?.verification));
      return row;
    });
    put(businessIncome, 'periodCount', periods.length);
    const basis = str(bi.selectionBasis);
    if (basis) {
      put(businessIncome, 'periodsCaption',
        `Financial periods — assessed on a ${basis.toLowerCase().replace(/\.$/, '')} basis.`);
    }
  }
  // The declining-earnings caution, only when the engine flagged one — the
  // legacy's sentences, trend folded in when it was computed.
  if (bi.decliningIncome) {
    put(businessIncome, 'decliningNote',
      'Adjusted earnings fall across the periods assessed'
      + `${bi.trend ? `, by ${formatMeasure(bi.trend)}` : ''}. A lender assessing a declining `
      + 'trend will generally take the most recent period rather than an average, and will '
      + 'ask what changed.');
  }
  if (Object.keys(businessIncome).length) capacity.businessIncome = businessIncome;

  /*
   * Portfolio impact — the whole section was dropped, and it is the one whose
   * first render found the `formatDelta` bug that had been silently wrong in
   * the Borrowing Capacity Snapshot's audit table too. `changeLabel` is signed
   * by that same fixed `formatDelta`; `effect` is the direction in words,
   * because "the effect column says which way each line moves for the
   * borrower, which is not always the direction the number moves".
   */
  const pf = s.portfolio;
  if (pf) {
    const portfolio: Record<string, unknown> = {};
    const pfRows = Array.isArray(pf.rows) ? pf.rows : [];
    if (pfRows.length) {
      portfolio.rows = pfRows.slice(0, CAPS.portfolioRows).map((row: any) => {
        const out: Record<string, unknown> = {};
        put(out, 'label', str(row?.label));
        if (row?.current) put(out, 'currentLabel', formatMeasure(row.current));
        if (row?.proposed) put(out, 'proposedLabel', formatMeasure(row.proposed));
        out.changeLabel = row?.change ? formatDelta(row.change) : '—';
        const effect = EFFECT_LABEL[row?.direction as keyof typeof EFFECT_LABEL];
        out.effect = effect ?? '—';
        return out;
      });
      put(portfolio, 'rowCount', pfRows.length);
    }
    put(portfolio, 'assetCount', num(pf.assetCount));
    const DIRECTION: Record<string, string> = {
      improves: 'improves',
      weakens: 'weakens',
      mixed: 'has a mixed effect on',
      unchanged: 'leaves unchanged',
    };
    if (pf.assetCount && DIRECTION[pf.direction]) {
      put(portfolio, 'overview',
        `Across ${formatMeasure(pf.assetCount)} existing `
        + `${pf.assetCount.value === 1 ? 'asset' : 'assets'}, this transaction `
        + `${DIRECTION[pf.direction]} the borrower's position. `
        + 'The effect column says which way each line moves for the borrower, which is not '
        + 'always the direction the number moves.');
    }
    if (pf.crossCollateralisedShare && pf.crossCollateralisedShare.value > 0) {
      put(portfolio, 'crossCollateralisationNote',
        `${formatMeasure(pf.crossCollateralisedShare)} of the portfolio is cross-collateralised. `
        + 'Security held across assets narrows the options on any one of them — a sale, a '
        + 'refinance or an equity release has to be negotiated against the whole structure.');
    }
    if (Object.keys(portfolio).length) capacity.portfolio = portfolio;
  }

  /*
   * Compliance — the legacy's always-on closing section, dropped entirely.
   * The classification table's three rows, and the flags as message/action
   * pairs a callout can draw. Zero flags exist in production; the slots light
   * up as they land.
   */
  const comp = s.compliance;
  if (comp) {
    const compliance: Record<string, unknown> = {};
    put(compliance, 'classification', str(comp.classificationLabel));
    compliance.complianceReview = comp.requiresComplianceReview ? 'Yes' : 'No';
    compliance.specialistReview = comp.requiresSpecialistReview ? 'Yes' : 'No';
    const flags = Array.isArray(comp.flags) ? comp.flags : [];
    if (flags.length) {
      compliance.flags = flags.slice(0, CAPS.flags).map((flag: any) => {
        const row: Record<string, unknown> = {};
        put(row, 'message', str(flag?.message));
        put(row, 'action', str(flag?.action));
        return row;
      });
      put(compliance, 'flagCount', flags.length);
      if (flags.length > CAPS.flags) {
        put(compliance, 'flagsOmitted',
          `${flags.length - CAPS.flags} further compliance flags are not shown here.`);
      }
    }
    if (Object.keys(compliance).length) capacity.compliance = compliance;
  }

  // ── what is missing, and what to do ──────────────────────────────────────
  const outstanding = Array.isArray(s.outstanding) ? s.outstanding : [];
  if (outstanding.length) {
    capacity.outstanding = outstanding.slice(0, CAPS.outstanding).map((o: any) => {
      const row: Record<string, unknown> = {};
      put(row, 'label', str(o?.label));
      // Blocking items are the reason an assessment cannot progress. Published
      // as a word rather than a boolean so a table cell can print it.
      put(row, 'blocking', o?.blocking ? 'Blocking' : 'Outstanding');
      return row;
    });
    put(capacity, 'outstandingCount', outstanding.length);
    put(capacity, 'blockingCount',
      outstanding.filter((o: any) => o?.blocking).length || undefined);
  }

  const nextActions = (Array.isArray(s.nextActions) ? s.nextActions : [])
    .map(str).filter(Boolean) as string[];
  if (nextActions.length) {
    capacity.nextActions = nextActions.slice(0, CAPS.nextActions).map((label) => ({ label }));
  }

  /*
   * Risk indicators, critical first — the order and the words are the legacy
   * table's own ("Critical" / "Warning" / "For information"). `label` keeps
   * the message for anything already bound to it.
   */
  const warnings = Array.isArray(s.warnings) ? s.warnings : [];
  if (warnings.length) {
    const bySeverity = [
      ...warnings.filter((w: any) => w?.severity === 'critical'),
      ...warnings.filter((w: any) => w?.severity !== 'critical'),
    ];
    capacity.warnings = bySeverity.slice(0, CAPS.warnings).map((w: any) => {
      const row: Record<string, unknown> = {};
      put(row, 'label', str(w?.label ?? w?.message ?? w?.title));
      put(row, 'detail', str(w?.detail ?? w?.description));
      row.severityLabel = w?.severity === 'critical'
        ? 'Critical'
        : w?.severity === 'warning' ? 'Warning' : 'For information';
      put(row, 'category', str(w?.category));
      return row;
    });
    put(capacity, 'warningCount', warnings.length);
    // The compliance page draws four; the stored run carries five, and the
    // fifth ran the most generous variant 47pt past the footer. Critical rows
    // sort first, so what a four-row table drops is always the mildest.
    if (warnings.length > 4) {
      put(capacity, 'warningsOmitted',
        `${warnings.length - 4} further risk ${warnings.length - 4 === 1 ? 'indicator is' : 'indicators are'} not shown here.`);
    }
  }

  /*
   * The explain trail, in the legacy appendix's own columns — stage, step,
   * formula, result. This used to publish only a `detail` read from `note`,
   * which is null on most steps, so the masters' method table drew an empty
   * second column beside every step; and it kept the "Capacity caps" stage the
   * legacy deliberately drops, because those rows repeat the constraints table
   * label for label, formula for formula, five pages later.
   */
  const method = (Array.isArray(s.method) ? s.method : [])
    .filter((step: any) => str(step?.group) !== 'Capacity caps');
  if (method.length) {
    capacity.method = method.slice(0, CAPS.method).map((step: any) => {
      const row: Record<string, unknown> = {};
      put(row, 'group', str(step?.group));
      put(row, 'label', str(step?.label ?? step?.step));
      put(row, 'formula', str(step?.formula));
      put(row, 'value', str(step?.value));
      put(row, 'detail', str(step?.detail ?? step?.note));
      return row;
    });
    put(capacity, 'methodCount', method.length);
    // The stored run's trail is twenty steps against a page that draws five.
    if (method.length > CAPS.method) {
      put(capacity, 'methodOmitted',
        `${method.length - CAPS.method} further steps are not shown here; `
        + 'the flowing report carries the complete trail.');
    }
  }

  put(capacity, 'disclaimer', str(s.disclaimer));

  // ── the model's reading ──────────────────────────────────────────────────
  applyAnalysis(capacity, s.analysis ?? null);

  return { capacity };
}

/**
 * The analysis, published with the sentence that says a model wrote it.
 *
 * Together or not at all. The contract's rule is that the page says what it is,
 * and leaving fifty masters each to remember a provenance note is a rule that
 * holds until one of them forgets. A master binding `capacity.analysis.*`
 * without `capacity.analysisProvenance` has nothing to print, which is a
 * visible failure rather than a silent one.
 */
function applyAnalysis(
  capacity: Record<string, unknown>,
  analysis: CapacityAnalysis | null,
): void {
  if (!analysis) return;
  const a = analysis as unknown as Record<string, any>;

  const out: Record<string, unknown> = {};
  put(out, 'interpretation', str(a.interpretation));

  const findings = Array.isArray(a.findings) ? a.findings : [];
  if (findings.length) {
    out.findings = findings.slice(0, CAPS.findings).map((f: any) => {
      const row: Record<string, unknown> = {};
      put(row, 'title', str(f?.title));
      put(row, 'detail', str(f?.detail));
      // A judgement, not a colour — the interface says so and a template that
      // mapped it to red/green would be inventing one.
      put(row, 'significance', str(f?.significance));
      return row;
    });
  }

  const scenarios = Array.isArray(a.scenarios) ? a.scenarios : [];
  if (scenarios.length) {
    out.scenarios = scenarios.slice(0, CAPS.scenarios).map((sc: any) => {
      const row: Record<string, unknown> = {};
      put(row, 'name', str(sc?.name));
      put(row, 'reasoning', str(sc?.reasoning));
      put(row, 'estimatedImpact', str(sc?.estimatedImpact));
      put(row, 'executionRisk', str(sc?.executionRisk));
      const evidence = (Array.isArray(sc?.evidenceRequired) ? sc.evidenceRequired : [])
        .map(str).filter(Boolean) as string[];
      if (evidence.length) put(row, 'evidence', evidence.join('; '));
      // The whole scenario in one bindable passage — the legacy prints the
      // reasoning paragraph and then the expected effect, and the masters used
      // to draw only the effect, which is a conclusion with its argument cut.
      const detail = [str(sc?.reasoning), str(sc?.estimatedImpact)].filter(Boolean).join(' ');
      put(row, 'detail', detail || undefined);
      return row;
    });
  }

  const questions = (Array.isArray(a.questionsForCredit) ? a.questionsForCredit : [])
    .map(str).filter(Boolean) as string[];
  if (questions.length) {
    out.questions = questions.slice(0, CAPS.questions).map((label) => ({ label }));
  }

  if (!Object.keys(out).length) return;

  put(out, 'model', str(a.model));
  put(out, 'generatedAt', str(a.generatedAt));
  // "Written by google/gemini-2.5-flash on 05 August 2026." — the legacy's
  // attribution line under its provenance note, with the model's name and the
  // date it wrote. A client is entitled to know which machine composed which
  // part of a finance document, not merely that one did.
  const model = str(a.model);
  if (model) {
    const when = str(a.generatedAt) ? formatReportDate(a.generatedAt) : '';
    put(out, 'attribution', `Written by ${model}${when ? ` on ${when}` : ''}.`);
  }
  capacity.analysis = out;
  capacity.analysisProvenance = ANALYSIS_PROVENANCE_NOTE;
}

export function applyCommercialCapacityProjection(
  target: Record<string, unknown>,
  snapshot: CommercialCapacitySnapshot,
): void {
  const { capacity } = projectCommercialCapacity(snapshot);
  if (Object.keys(capacity).length) target.capacity = capacity;
}
