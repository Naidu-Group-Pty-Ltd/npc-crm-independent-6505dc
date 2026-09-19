/**
 * The assessment row and its calculation run, turned into a payload.
 *
 * ## Where the numbers come from, and why not from the engine
 *
 * The C&I engine is `src/lib/ciAssessment/` — TypeScript that runs in the
 * browser, imports through the `@/` alias, and cannot be loaded by an Edge
 * Function. That could have been solved by porting it, and the report would
 * then recompute the figures at render time.
 *
 * It deliberately is not. `commercial_industrial_calculation_runs` stores the
 * complete `AssessmentResult` of every run, immutably, with the engine and
 * policy versions it was produced under, and the assessment points at the one
 * that is current. **A report must explain the numbers it is showing, not
 * different ones** — the same decision `BORROWING_CAPACITY.md` §9 records for
 * that format's audit trail, arrived at the same way. A recomputation would run
 * against today's policy, and a report re-issued after a policy change would
 * silently disagree with the figures the client was given last month.
 *
 * So this module reads the stored outputs. It computes nothing except the two
 * things the outputs do not carry: cents-to-dollars, and prose.
 *
 * ## Cents
 *
 * The engine works in integer cents and publishes `summary` in whole dollars.
 * Both are in the row. Every `Cents` field read here goes through `dollars()`
 * and every `summary` field does not — mixing them by a factor of a hundred is
 * the single easiest mistake to make against this shape, so the two readers are
 * named differently and nothing takes a bare number.
 */

import {
  aud,
  audPerMonth,
  audPerYear,
  count,
  percent,
  rate,
  ratio,
  years,
  type Measure,
} from '../../reportDesign/measure.pure.ts';
import type {
  CommercialCapacitySnapshot,
  ComplianceFlagRow,
  ConstraintRow,
  CostLine,
  Direction,
  IncomePeriodRow,
  LedgerRow,
  MethodStep,
  Outcome,
  PortfolioSideRow,
  TenancyRow,
  WarningRow,
} from './payload.pure.ts';
import type { CapacityAnalysis } from './analysis.pure.ts';

// ── Reading an untyped row ──────────────────────────────────────────────────

type Bag = Record<string, unknown>;

const bag = (value: unknown): Bag =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Bag) : {};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

/** A finite number, or 0. `??` throughout — a legitimate zero must survive. */
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** A finite number, or `null`. For fields where absent and zero differ. */
const maybeNum = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Integer cents to dollars.
 *
 * Named for what it converts so a call site reading `dollars(t.purchasePriceCents)`
 * cannot be confused with one reading `summary.requestedLoan`, which is already
 * in dollars.
 */
const dollars = (cents: unknown): number => num(cents) / 100;

// ── Labels ──────────────────────────────────────────────────────────────────
//
// Mirrors of the constants in `src/lib/ciAssessment/types.ts`. Copied rather
// than imported because that module is browser-side and unreachable from Deno;
// `commercialCapacityLabels.spec.ts` asserts every key here still matches the
// engine's, so the copy cannot go stale in silence.

export const ASSESSMENT_TYPE_LABELS: Record<string, string> = {
  commercial_investment: 'Commercial investment',
  industrial_investment: 'Industrial investment',
  owner_occupied_commercial: 'Owner-occupied commercial',
  owner_occupied_industrial: 'Owner-occupied industrial',
  mixed_use: 'Mixed use',
  development_construction: 'Development or construction',
  refinance: 'Refinance',
  equity_release: 'Equity release',
  purchase_plus_fitout: 'Purchase plus fit-out',
  lease_doc: 'Lease-doc / low-doc',
};

export const ASSET_CLASS_LABELS: Record<string, string> = {
  office: 'Office',
  retail: 'Retail',
  warehouse: 'Warehouse',
  logistics: 'Logistics',
  manufacturing: 'Manufacturing',
  cold_storage: 'Cold storage',
  medical: 'Medical',
  childcare: 'Childcare',
  hospitality: 'Hospitality',
  showroom: 'Showroom',
  transport_yard: 'Transport yard',
  data_centre: 'Data centre',
  mixed_use: 'Mixed use',
  other: 'Other',
};

export const GST_TREATMENT_LABELS: Record<string, string> = {
  going_concern: 'Going concern (GST-free)',
  margin_scheme: 'Margin scheme',
  plus_gst: 'Plus GST',
  gst_inclusive: 'GST inclusive',
  input_taxed: 'Input taxed',
  unknown: 'Not yet determined',
};

export const OUTCOME_LABELS: Record<Outcome, string> = {
  indicatively_supported: 'Indicatively Supported',
  supported_subject_to_verification: 'Supported Subject to Verification',
  outside_current_assumptions: 'Outside Current Assumptions',
  requires_specialist_review: 'Requires Specialist Review',
  insufficient_information: 'Insufficient Information',
};

const OUTCOMES = new Set(Object.keys(OUTCOME_LABELS));

export const VERIFICATION_LABELS: Record<string, string> = {
  unverified: 'Unverified',
  documents_held: 'Documents held',
  verified: 'Verified',
};

/** Title-case a snake_case or camelCase key without mangling an acronym. */
export function humanise(value: string): string {
  const spaced = value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (!spaced) return '';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

// ── Prose ───────────────────────────────────────────────────────────────────

const MONEY = (value: number): string =>
  `$${Math.round(Math.abs(value)).toLocaleString('en-AU')}`;

/**
 * The executive summary.
 *
 * Assembled from figures rather than written by the model, and it stays that
 * way. This paragraph is the first thing on the first page and it states the
 * result; a sentence that has to be true is not a sentence to delegate. The
 * model's reading has its own section, clearly labelled as one.
 */
export function buildNarrative(input: {
  subject: string;
  outcomeLabel: string;
  capacity: number;
  requested: number;
  difference: number;
  bindingConstraint: string;
  assessmentRatePct: number;
  termYears: number;
  contribution: number;
}): string {
  const shortfall = input.difference < 0;
  const parts: string[] = [];

  parts.push(
    `This assessment of ${input.subject} concludes ${input.outcomeLabel.toLowerCase()}`
    + `, with a maximum indicative facility of ${MONEY(input.capacity)}`
    + ` against a request of ${MONEY(input.requested)}.`,
  );

  parts.push(
    shortfall
      ? `The request exceeds the assessed capacity by ${MONEY(input.difference)}.`
      : input.difference > 0
        ? `That leaves ${MONEY(input.difference)} of headroom above the request.`
        : 'The request sits exactly at the assessed capacity.',
  );

  if (input.bindingConstraint) {
    parts.push(`Capacity is set by the ${input.bindingConstraint.toLowerCase()}.`);
  }

  parts.push(
    `Servicing is tested at ${input.assessmentRatePct.toFixed(2)}%`
    + ` over a ${Math.round(input.termYears)}-year term`
    + `, and the transaction requires a borrower contribution of ${MONEY(input.contribution)}.`,
  );

  return parts.join(' ');
}

// ── Constraint thresholds ───────────────────────────────────────────────────

/**
 * What each capacity test was measured against, and where the deal sits.
 *
 * Keyed by the engine's `ConstraintKey`. A test whose key is not here still
 * renders — with its cap and its formula — but without a threshold column,
 * which is the honest rendering of "this module has not been told what that
 * test compares against" and is far better than guessing at one.
 */
function constraintBounds(
  key: string,
  policy: Bag,
  summary: Bag,
): { threshold: Measure | null; actual: Measure | null } {
  switch (key) {
    case 'lvr':
      return { threshold: rate(num(policy.maxLvr)), actual: rate(num(summary.proposedLvr)) };
    case 'ltc':
      return { threshold: rate(num(policy.maxLtc)), actual: rate(num(summary.proposedLtc)) };
    case 'dscr':
      return { threshold: ratio(num(policy.minDscr), 2), actual: ratio(num(summary.proposedDscr), 2) };
    case 'icr':
      return { threshold: ratio(num(policy.minIcr), 2), actual: ratio(num(summary.proposedIcr), 2) };
    case 'debt_yield':
    case 'debtYield':
      return { threshold: rate(num(policy.minDebtYield), 2), actual: rate(num(summary.debtYield), 2) };
    default:
      return { threshold: null, actual: null };
  }
}

// ── The normaliser ──────────────────────────────────────────────────────────

export interface BuildSnapshotInput {
  /** The `commercial_industrial_assessments` row. */
  assessment: Bag;
  /** The `outputs` jsonb of the run the assessment points at — an `AssessmentResult`. */
  outputs: unknown;
  /** The run's `inputs_snapshot`, so the document describes what was calculated. */
  inputs: unknown;
  /** The linked client's display name, when the assessment has one. */
  clientName?: string | null;
  /** Persisted analysis, when one has been generated. */
  analysis?: CapacityAnalysis | null;
}

export function buildCapacitySnapshot(input: BuildSnapshotInput): CommercialCapacitySnapshot {
  const row = bag(input.assessment);
  const out = bag(input.outputs);
  const payload = bag(input.inputs);

  const summary = bag(out.summary);
  const policy = bag(out.policy);
  const transaction = bag(out.transaction);
  const propertyIncome = bag(out.propertyIncome);
  const businessIncome = bag(out.businessIncome);
  const portfolioImpact = bag(out.portfolioImpact);
  const portfolio = bag(out.portfolio);
  const serviceability = bag(out.serviceability);
  const compliance = bag(out.compliance);

  const property = bag(payload.property);
  const loan = bag(payload.loan);
  const lease = bag(payload.lease);

  // ── meta ──────────────────────────────────────────────────────────────────

  const assessmentType = text(row.assessment_type, text(payload.assessmentType, 'commercial_investment'));
  const title = text(row.title, 'Commercial finance assessment');
  const segment = text(row.segment) === 'industrial' ? 'industrial' : 'commercial';

  // The client's name where the assessment is linked, the assessment's own
  // title where it is not. A standalone assessment is a supported state in this
  // workflow, and inventing a borrower for it would be worse than saying so.
  const subject = text(input.clientName, title);

  const outcomeKey = text(out.outcome, 'insufficient_information');
  const outcome = (OUTCOMES.has(outcomeKey) ? outcomeKey : 'insufficient_information') as Outcome;

  // ── headline ──────────────────────────────────────────────────────────────

  const capacity = num(summary.maximumIndicativeLoan);
  const requested = num(summary.requestedLoan);
  const difference = num(summary.difference);
  const contribution = num(summary.requiredContribution);
  const assessmentRatePct = num(serviceability.assessmentRatePct);
  const termYears = num(loan.loanTermYears) || num(loan.amortisationYears);
  const amortisationYears = num(loan.amortisationYears);
  const bindingConstraint = text(summary.bindingConstraint, text(serviceability.bindingConstraintLabel));

  // ── transaction ───────────────────────────────────────────────────────────

  const costLines: CostLine[] = list(transaction.acquisitionCostLines).map((entry): CostLine => {
    const line = bag(entry);
    return { label: text(line.label, 'Cost'), amount: aud(dollars(line.amountCents)), emphasis: 'normal' };
  });
  const totalProjectCost = dollars(transaction.totalProjectCostCents);
  if (costLines.length) {
    costLines.push({ label: 'Total project cost', amount: aud(totalProjectCost), emphasis: 'total' });
  }

  const fundingGap = dollars(transaction.fundingGapCents);
  const cashOut = dollars(transaction.cashOutCents);

  // ── property income ───────────────────────────────────────────────────────

  const tenancies = list(lease.tenancies);
  // `list()` returns unknown[], so the accumulator infers `unknown` and every
  // later use of the total is an error. Pin it to number.
  const passingRentTotal = tenancies.reduce<number>((total, entry) => total + num(bag(entry).annualRent), 0);

  const hasPropertyIncome = num(propertyIncome.netOperatingIncomeCents) !== 0
    || num(propertyIncome.grossPropertyIncomeCents) !== 0
    || tenancies.length > 0;

  const propertyIncomeSection = hasPropertyIncome
    ? {
        lines: [
          { label: 'Gross passing rent', amount: audPerYear(dollars(propertyIncome.grossPropertyIncomeCents)), emphasis: 'normal' as const },
          { label: 'Recoverable outgoings', amount: audPerYear(dollars(propertyIncome.recoverableOutgoingsCents)), emphasis: 'normal' as const },
          { label: 'Potential gross income', amount: audPerYear(dollars(propertyIncome.potentialGrossIncomeCents)), emphasis: 'normal' as const },
          { label: 'Less vacancy allowance', amount: audPerYear(-dollars(propertyIncome.vacancyAllowanceCents)), emphasis: 'normal' as const },
          { label: 'Less incentives', amount: audPerYear(-dollars(propertyIncome.incentiveAllowanceCents)), emphasis: 'normal' as const },
          { label: 'Effective gross income', amount: audPerYear(dollars(propertyIncome.effectiveGrossIncomeCents)), emphasis: 'normal' as const },
          { label: 'Less operating expenses', amount: audPerYear(-dollars(propertyIncome.totalOperatingExpensesCents)), emphasis: 'normal' as const },
          { label: 'Net operating income', amount: audPerYear(dollars(propertyIncome.netOperatingIncomeCents)), emphasis: 'total' as const },
        ],
        netOperatingIncome: audPerYear(dollars(propertyIncome.netOperatingIncomeCents)),
        capitalisationRate: rate(num(propertyIncome.capitalisationRate), 2),
        breakEvenOccupancy: rate(num(propertyIncome.breakEvenOccupancy)),
        wale: num(propertyIncome.wale) > 0
          ? ({ value: num(propertyIncome.wale), unit: 'years', precision: 1 } as Measure)
          : null,
        tenantCount: count(num(propertyIncome.tenantCount) || tenancies.length),
        tenantConcentration: maybeNum(propertyIncome.tenantConcentration) != null
          ? rate(num(propertyIncome.tenantConcentration))
          : null,
        tenancies: tenancies.map((entry): TenancyRow => {
          const tenancy = bag(entry);
          const annualRent = num(tenancy.annualRent);
          const expiry = text(tenancy.leaseExpiry);
          return {
            tenant: text(tenancy.tenantName, 'Unnamed tenancy'),
            area: num(tenancy.areaSqm) > 0 ? count(num(tenancy.areaSqm)) : null,
            passingRent: audPerYear(annualRent),
            expiry: expiry || null,
            remainingTerm: null,
            share: rate(passingRentTotal > 0 ? annualRent / passingRentTotal : 0),
          };
        }),
      }
    : null;

  // ── business income ───────────────────────────────────────────────────────

  const periods = list(businessIncome.periods);
  const businessIncomeSection = periods.length || num(businessIncome.adjustedEbitdaCents) !== 0
    ? {
        periods: periods.map((entry): IncomePeriodRow => {
          const period = bag(entry);
          return {
            label: text(period.label, 'Period'),
            periodEnd: text(period.periodEnd),
            basis: humanise(text(period.basis, 'unknown')),
            verification: VERIFICATION_LABELS[text(period.verification)] ?? humanise(text(period.verification, 'unverified')),
            reportedEbitda: audPerYear(dollars(period.reportedEbitdaCents)),
            confirmedAddbacks: audPerYear(dollars(period.confirmedAddbacksCents)),
            unconfirmedAddbacks: audPerYear(dollars(period.unconfirmedAddbacksCents)),
            adjustedEbitda: audPerYear(dollars(period.adjustedEbitdaCents)),
            assessable: audPerYear(dollars(period.totalAssessableCents)),
          };
        }),
        selectionBasis: text(businessIncome.selectionBasis, 'Not stated'),
        adjustedEbitda: audPerYear(dollars(businessIncome.adjustedEbitdaCents)),
        assessableIncome: audPerYear(dollars(businessIncome.totalAssessableIncomeCents)),
        verificationStatus: VERIFICATION_LABELS[text(businessIncome.verificationStatus)]
          ?? humanise(text(businessIncome.verificationStatus, 'unverified')),
        // A trend needs two periods to be a trend. One period reports 0, and a
        // "0.0% year on year" beside a single set of accounts states a fact
        // nobody measured.
        trend: periods.length > 1 ? rate(num(businessIncome.earningsTrend), 1) : null,
        decliningIncome: businessIncome.decliningIncome === true,
      }
    : null;

  // ── serviceability ────────────────────────────────────────────────────────

  const ledger: LedgerRow[] = [
    {
      label: 'Assessable business and personal income',
      amount: audPerYear(dollars(serviceability.assessableBusinessIncomeCents)),
      emphasis: 'normal',
      direction: 'favourable',
    },
    {
      label: 'Proposed asset rent, after shading',
      amount: audPerYear(dollars(serviceability.shadedProposedRentCents)),
      emphasis: 'normal',
      direction: 'favourable',
    },
    {
      label: 'Portfolio rent, after shading',
      amount: audPerYear(dollars(serviceability.shadedPortfolioRentCents)),
      emphasis: 'normal',
      direction: 'favourable',
    },
    {
      label: 'Total assessable income',
      amount: audPerYear(dollars(serviceability.totalAssessableIncomeCents)),
      emphasis: 'total',
      direction: 'neutral',
    },
    {
      label: 'Less existing debt commitments',
      amount: audPerYear(-dollars(serviceability.existingDebtCommitmentsCents)),
      emphasis: 'normal',
      direction: 'adverse',
    },
    {
      label: 'Less proposed facility at the assessment rate',
      amount: audPerYear(-dollars(serviceability.proposedDebtCommitmentCents)),
      emphasis: 'normal',
      direction: 'adverse',
    },
    {
      label: 'Surplus after debt service',
      amount: audPerYear(dollars(serviceability.surplusAfterDebtServiceCents)),
      emphasis: 'total',
      direction: dollars(serviceability.surplusAfterDebtServiceCents) >= 0 ? 'favourable' : 'adverse',
    },
  ];

  // ── constraints ───────────────────────────────────────────────────────────

  const constraints: ConstraintRow[] = list(serviceability.caps).map((entry): ConstraintRow => {
    const cap = bag(entry);
    const key = text(cap.key, 'unknown');
    const bounds = constraintBounds(key, policy, summary);
    return {
      key,
      label: text(cap.label, humanise(key)),
      cap: aud(dollars(cap.capCents)),
      formula: text(cap.formula),
      binding: cap.binding === true,
      applied: cap.applied !== false,
      threshold: bounds.threshold,
      actual: bounds.actual,
    };
  });

  // ── portfolio ─────────────────────────────────────────────────────────────

  const current = bag(portfolioImpact.current);
  const proposed = bag(portfolioImpact.proposed);
  const hasPortfolio = list(portfolio.assets).length > 0
    || num(current.totalValueCents) !== 0
    || num(current.totalDebtCents) !== 0;

  const side = (
    label: string,
    currentValue: number,
    proposedValue: number,
    make: (value: number) => Measure,
    /** Which way is good for the borrower. LVR down is good; equity up is good. */
    higherIsBetter: boolean,
  ): PortfolioSideRow => {
    const change = proposedValue - currentValue;
    return {
      label,
      current: make(currentValue),
      proposed: make(proposedValue),
      change: make(change),
      direction: change === 0
        ? 'neutral'
        : (change > 0) === higherIsBetter ? 'favourable' : 'adverse',
    };
  };

  const portfolioSection = hasPortfolio
    ? {
        rows: [
          side('Portfolio value', dollars(current.totalValueCents), dollars(proposed.totalValueCents), aud, true),
          side('Total debt', dollars(current.totalDebtCents), dollars(proposed.totalDebtCents), aud, false),
          side('Net equity', dollars(current.netEquityCents), dollars(proposed.netEquityCents), aud, true),
          // One decimal, unlike the policy comparison on the capacity page.
          // A before/after table computes a change from the two sides, and at
          // whole percent 56.5 → 64.1 prints "57% → 64%, +8%", which does not
          // add up on the page.
          side('Portfolio LVR', num(current.lvr), num(proposed.lvr), (v) => rate(v, 1), false),
          side('Portfolio DSCR', num(current.dscr), num(proposed.dscr), (v) => ratio(v, 2), true),
          side(
            'Annual debt service',
            dollars(current.annualDebtServiceCents),
            dollars(proposed.annualDebtServiceCents),
            audPerYear,
            false,
          ),
          side(
            'Net cash flow',
            dollars(current.netCashFlowCents),
            dollars(proposed.netCashFlowCents),
            audPerYear,
            true,
          ),
        ],
        direction: (['improves', 'weakens', 'mixed', 'unchanged'] as const)
          .find((d) => d === text(portfolioImpact.direction)) ?? 'unchanged',
        assetCount: count(list(portfolio.assets).length),
        crossCollateralisedShare: maybeNum(portfolio.crossCollateralisedShare) != null
          ? rate(num(portfolio.crossCollateralisedShare))
          : null,
      }
    : null;

  // ── the rest ──────────────────────────────────────────────────────────────

  const warnings: WarningRow[] = list(out.warnings).map((entry): WarningRow => {
    const warning = bag(entry);
    const severity = text(warning.severity, 'info');
    return {
      severity: severity === 'critical' || severity === 'warning' ? severity : 'info',
      category: humanise(text(warning.category, 'data')),
      message: text(warning.message),
    };
  }).filter((w) => w.message);

  const method: MethodStep[] = list(out.explain).map((entry): MethodStep => {
    const step = bag(entry);
    return {
      group: text(step.group, 'Calculation'),
      label: text(step.label),
      inputs: list(step.inputs).map((i) => text(i)).filter(Boolean),
      formula: text(step.formula),
      value: text(step.value),
      note: text(step.note) || null,
    };
  }).filter((s) => s.label);

  const debtToEbitda = maybeNum(out.debtToEbitda);

  return {
    meta: {
      subject,
      reference: text(row.reference, ''),
      title,
      assessedOn: text(out.calculatedAt, text(row.updated_at, text(row.created_at, ''))),
      assessmentId: text(row.id, ''),
      segment,
      assessmentTypeLabel: ASSESSMENT_TYPE_LABELS[assessmentType] ?? humanise(assessmentType),
      engineVersion: text(out.engineVersion, 'unknown'),
      policyVersion: text(out.policyVersion, 'unknown'),
      lenderProfile: text(policy.profileLabel, humanise(text(loan.lenderPolicyProfile, 'unknown'))),
    },

    property: {
      address: [text(property.address), text(property.suburb), text(property.state), text(property.postcode)]
        .filter(Boolean).join(', '),
      assetClass: ASSET_CLASS_LABELS[text(property.assetClass)] ?? humanise(text(property.assetClass, 'other')),
      gstTreatment: GST_TREATMENT_LABELS[text(property.gstTreatment)] ?? humanise(text(property.gstTreatment, 'unknown')),
      lettableArea: num(property.lettableAreaSqm) > 0 ? count(num(property.lettableAreaSqm)) : null,
      purchasePrice: num(property.purchasePrice) > 0 ? aud(num(property.purchasePrice)) : null,
      valuation: dollars(transaction.valuationUsedCents) > 0 ? aud(dollars(transaction.valuationUsedCents)) : null,
      valuationBasis: text(transaction.valuationBasis, 'Not stated'),
    },

    headline: {
      outcome,
      outcomeLabel: text(out.outcomeLabel, OUTCOME_LABELS[outcome]),
      outcomeReason: text(out.outcomeReason),
      maximumCapacity: aud(capacity),
      requestedLoan: aud(requested),
      difference: aud(difference),
      requiredContribution: aud(contribution),
      bindingConstraint,
      assessmentRate: percent(assessmentRatePct),
      loanTerm: years(termYears),
      // Only when it says something the term does not.
      amortisation: amortisationYears > 0 && amortisationYears !== termYears
        ? years(amortisationYears)
        : null,
      monthlyDebtService: audPerMonth(num(summary.monthlyDebtService)),
      surplus: audPerYear(num(summary.surplusAfterDebtService)),
      sensitisedSurplus: audPerYear(dollars(serviceability.sensitisedSurplusCents)),
    },

    narrative: buildNarrative({
      subject,
      outcomeLabel: text(out.outcomeLabel, OUTCOME_LABELS[outcome]),
      capacity,
      requested,
      difference,
      bindingConstraint,
      assessmentRatePct,
      termYears,
      contribution,
    }),

    ratios: {
      lvr: rate(num(summary.proposedLvr)),
      lvrCeiling: rate(num(policy.maxLvr)),
      dscr: ratio(num(summary.proposedDscr), 2),
      dscrFloor: ratio(num(policy.minDscr), 2),
      icr: ratio(num(summary.proposedIcr), 2),
      icrFloor: ratio(num(policy.minIcr), 2),
      debtYield: rate(num(summary.debtYield), 2),
      debtYieldFloor: rate(num(policy.minDebtYield), 2),
      ltc: rate(num(summary.proposedLtc)),
      ltcCeiling: rate(num(policy.maxLtc)),
      debtToEbitda: debtToEbitda != null ? ratio(debtToEbitda, 2) : null,
    },

    transaction: {
      lines: costLines,
      totalProjectCost: aud(totalProjectCost),
      borrowerContribution: aud(dollars(transaction.borrowerContributionCents)),
      fundingGap: fundingGap > 0 ? aud(fundingGap) : null,
      cashOut: cashOut > 0 ? aud(cashOut) : null,
    },

    propertyIncome: propertyIncomeSection,
    businessIncome: businessIncomeSection,

    serviceability: {
      rows: ledger,
      assessmentRateBasis: text(serviceability.assessmentRateBasis, 'Policy buffer and floor'),
    },

    constraints,
    portfolio: portfolioSection,

    compliance: {
      classificationLabel: text(compliance.classificationLabel, 'Not classified'),
      requiresComplianceReview: compliance.requiresComplianceReview === true,
      requiresSpecialistReview: compliance.requiresSpecialistReview === true,
      flags: list(compliance.flags).map((entry): ComplianceFlagRow => {
        const flag = bag(entry);
        const severity = text(flag.severity, 'info');
        return {
          code: text(flag.code),
          severity: severity === 'block' || severity === 'review' ? severity : 'info',
          message: text(flag.message),
          action: text(flag.action),
        };
      }).filter((f) => f.message),
    },

    warnings,

    outstanding: list(out.missing).map((entry) => {
      const item = bag(entry);
      return { label: text(item.label, text(item.field)), blocking: item.blocksCalculation === true };
    }).filter((item) => item.label),

    nextActions: list(out.nextActions).map((a) => text(a)).filter(Boolean),

    method: method.length ? method : null,
    analysis: input.analysis ?? null,

    disclaimer: text(out.disclaimer),
  };
}

/** Re-exported so the edge function does not need `payload.pure.ts` for a type. */
export type { CommercialCapacitySnapshot, Direction };
