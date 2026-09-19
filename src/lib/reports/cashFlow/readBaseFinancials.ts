/**
 * Reading a report's financial position out of the two places it is stored.
 *
 * ## Why this is a module rather than a `useMemo`
 *
 * It was one. `CashFlowAnalysisModal` built this object inline for the report
 * the adviser had open, and nothing built it for the properties they compared
 * that report against — so the comparison's metrics were computed from a
 * *different, shorter* reading (`compBaseData`), and the two disagreed in two
 * ways that a client would never have been able to see:
 *
 *  - **LMI.** The inline reading has `lmiAmount`; `compBaseData` has no such key.
 *    `totalInitialInvestment` is deposit + stamp duty + legal + LMI, and it is
 *    the denominator of return on capital, cash-on-cash and the equity multiple.
 *    So the property the adviser opened had its returns divided by a larger cost
 *    base than every property it was ranked against.
 *  - **Purchase price.** `compBaseData` reads
 *    `mo.purchasePrice || fc.purchasePrice || fc.propertyValue`, missing
 *    `initialCosts.propertyValue` — which the peer's own *projection* does read.
 *    Where the two differ, capital gain was measured from a base the projection
 *    never used. The `||` also turns a legitimate `0` into a fallback, which
 *    `??` does not.
 *
 * One implementation, called once per property, makes every column of a
 * comparison comparable by construction rather than by care. The modal's
 * `baseFinancialData` is this function; nothing about the report it has open
 * changed.
 *
 * ## The record is read where the calculator writes it
 *
 * `financial-calculator-service` persists the case NESTED — `income.weeklyRent`,
 * `annualCosts.councilRates`, `initialCosts.stampDuty`, `loanDetails.interestRate`
 * — and this reading looked for every one of them FLAT (`fc.weeklyRent`,
 * `fc.stampDuty`, …), keys the calculator has never written. Every one fell
 * through to `0` or to a hard-coded default, so the standalone 10-year cash
 * flow of 291 Stone Mason Drive (QA-291SM, 15 Sep 2026) ran with no rent, no
 * operating costs, no duty and no legal fees, at 5.5% instead of the record's
 * 6.5%, 7% fees instead of 7.5%, 52 weeks instead of 50 and $6,000 depreciation
 * instead of $10,000 — a zero-income financing model presented as the same
 * investment the sibling reports described (QA-01, QA-02, QA-03). The sibling
 * resolver in `financialSummary.ts` read the nested paths correctly the whole
 * time, which is how the card showed $900 a week beside a projection showing
 * a dash.
 *
 * The order is: the adviser's override, then the calculator's nested record,
 * then the flat legacy key a hand-saved row may carry, then a default. Every
 * field records which of those it came from (`provenance`), so a surface can
 * say "assumed" beside a figure nobody recorded, and a projection whose rent
 * or cost base is ABSENT is reported as incomplete rather than run as zero
 * (`missingInputs`). Absent is never zero; a default is never silent.
 *
 * ## The cascades are not tidy, and are not this module's to tidy
 *
 * `purchasePrice` has four sources and `capitalGrowth` has three because the
 * same figure has been saved under different shapes over the life of the
 * product. The order is load-bearing — it is the order the projection engine
 * itself resolves them in — so it is reproduced exactly rather than
 * rationalised. Changing it here changes every projection in the product.
 */
import { ASSUMED_INTEREST_ONLY_YEARS } from '@/lib/reports/investment/loanLedger.pure';
import type { LoanType, RepaymentFrequency } from '@/utils/mortgageCalculations';
import { caseInputsFingerprint } from './caseFingerprint.pure';

/** The two jsonb columns this reads, and nothing else. */
export interface ReadableReport {
  // deno-lint-ignore no-explicit-any
  financial_calculations?: any;
  // deno-lint-ignore no-explicit-any
  manual_overrides?: any;
}

/** Where a figure came from. `default` and `absent` are the two a reader must be told about. */
export type InputProvenance = 'override' | 'record' | 'legacy' | 'default' | 'absent';

/**
 * The interest-only period assumed when a loan is STATED to be interest only
 * and no period is recorded. Five years is the ordinary Australian IO term; it
 * is disclosed as an assumption wherever the loan structure is printed, and it
 * is what stops "interest only" from silently running a P&I schedule (QA-04).
 *
 * It is DECLARED in `loanLedger.pure.ts` and re-exported here. It was declared
 * in both, and the two answered differently: on 262 Pallas Street the cash flow
 * ran five interest-only years while the investment report ran a 30-year P&I
 * schedule over the same loan, $4,990 a year apart, from one set of overrides.
 */
export { ASSUMED_INTEREST_ONLY_YEARS };

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const num = (v: unknown): number | undefined => {
  if (isNum(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/[$,%\s]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

/**
 * A report's financial position.
 *
 * `currentYear` is passed in rather than read from the clock so the result is a
 * function of its inputs — the projections built from it are compared against
 * each other, and a value that changes at midnight is not something two
 * properties should be able to disagree about.
 */
export function readBaseFinancials(report: ReadableReport, currentYear: number) {
  const fc = report.financial_calculations || {};
  const mo = report.manual_overrides || {};
  const cashFlow = fc.cashFlow || {};
  const assumptions = fc.assumptions || {};
  const initialCosts = fc.initialCosts || {};
  const income = fc.income || {};
  const annualCosts = fc.annualCosts || {};
  const loanDetails = fc.loanDetails || {};
  const taxBenefits = fc.taxBenefits || {};

  const provenance: Record<string, InputProvenance> = {};

  /** First present value wins; its origin is recorded. `fallback` may be undefined for a field that has no default. */
  const pick = <T,>(
    field: string,
    candidates: Array<[InputProvenance, unknown]>,
    fallback: T,
    coerce: (v: unknown) => T | undefined = (v) => (v === undefined || v === null ? undefined : (v as T)),
  ): T => {
    for (const [origin, raw] of candidates) {
      const v = coerce(raw);
      if (v !== undefined) { provenance[field] = origin; return v; }
    }
    provenance[field] = fallback === undefined || fallback === null ? 'absent' : 'default';
    return fallback;
  };
  const pickNum = (field: string, candidates: Array<[InputProvenance, unknown]>, fallback: number, absentMeansZero = false): number => {
    const v = pick<number | undefined>(field, candidates, undefined, num);
    if (v !== undefined) return v;
    provenance[field] = absentMeansZero ? 'absent' : 'default';
    return fallback;
  };

  // Check if depreciation should be included in cash flow analysis
  const includeDepreciation = mo.includeDepreciationInCashFlow !== false;

  // CRITICAL: capitalGrowth may be stored in multiple locations:
  // 1. manual_overrides.capitalGrowth (flat override - highest priority)
  // 2. financial_calculations.assumptions.capitalGrowth (nested from save mapping)
  // 3. financial_calculations.capitalGrowth (root - legacy)
  const capitalGrowthValue = pickNum('capitalGrowth', [
    ['override', mo.capitalGrowth], ['record', assumptions.capitalGrowth], ['legacy', fc.capitalGrowth],
  ], 5);

  // CRITICAL: marketValueNow/propertyValue may be stored in multiple locations:
  // 1. manual_overrides.marketValueNow (flat override - highest priority for current value)
  // 2. cashFlow.marketValueNow (nested)
  // 3. manual_overrides.purchasePrice (purchase time value)
  // 4. initialCosts.propertyValue (nested from save mapping)
  // 5. financial_calculations.purchasePrice (root - legacy)
  const purchasePrice = pickNum('purchasePrice', [
    ['override', mo.purchasePrice], ['record', initialCosts.propertyValue], ['legacy', fc.purchasePrice], ['legacy', fc.propertyValue],
  ], 0, true);
  const marketValueNow = pickNum('marketValueNow', [
    ['override', mo.marketValueNow], ['record', cashFlow.marketValueNow],
  ], purchasePrice);

  // Land and build are recorded separately or not at all. The build price is
  // NEVER defaulted to the purchase price: an acquisition price is not
  // evidence of construction expenditure, and the standalone cash flow of an
  // existing strata townhouse carried its whole $1,299,000 as "Build Price"
  // with a blank land line (QA-13). `landBuildSplit` derives a build figure
  // only where a land price is recorded.
  const landPrice = pickNum('landPrice', [
    ['override', mo.landPrice], ['record', initialCosts.landPrice], ['legacy', fc.landPrice],
  ], 0, true);
  const buildPrice = pickNum('buildPrice', [
    ['override', mo.buildPrice], ['record', initialCosts.buildPrice], ['legacy', fc.buildPrice],
  ], 0, true);

  const loanToValueRatio = pickNum('loanToValueRatio', [
    ['override', mo.loanToValueRatio], ['record', loanDetails.lvr], ['legacy', fc.loanToValueRatio],
  ], 80);
  const depositValue = pickNum('depositValue', [
    ['override', mo.depositValue], ['record', initialCosts.deposit], ['legacy', fc.depositValue],
  ], 0, true);
  // Loan amount: use override, or the recorded loan, or dynamically calculate from purchase price × LVR
  const loanAmount = pickNum('loanAmount', [
    ['override', mo.loanAmount], ['record', initialCosts.loanAmount], ['legacy', cashFlow.loanAmount],
  ], purchasePrice * (loanToValueRatio / 100));

  // The loan product is what the case SAYS it is. The calculator's own
  // schedule is principal and interest, so with nothing recorded the cash flow
  // runs the same product the sibling report ran — never a silent "interest
  // only" label over P&I arithmetic (QA-02, QA-04).
  const loanType = pick<LoanType>('loanType', [
    ['override', mo.loanType], ['record', loanDetails.loanType], ['legacy', cashFlow.loanType],
  ], 'principal_interest', (v) => (v === 'interest_only' || v === 'principal_interest' ? v : undefined));
  const interestOnlyPeriodYears = pickNum('interestOnlyPeriodYears', [
    ['override', mo.interestOnlyPeriodYears], ['record', loanDetails.interestOnlyPeriod],
  ], loanType === 'interest_only' ? ASSUMED_INTEREST_ONLY_YEARS : 0);
  if (loanType !== 'interest_only') provenance.interestOnlyPeriodYears = provenance.loanType;

  const weeklyRent = pickNum('weeklyRent', [
    ['override', mo.weeklyRent], ['record', income.weeklyRent], ['legacy', fc.weeklyRent],
  ], 0, true);
  const annualRentRecorded = num(income.annualRent);

  const propertyManagementFees = pickNum('propertyManagementFees', [
    ['override', mo.propertyManagementFees],
    ['record', assumptions.propertyManagementRate],
    // The record stores the fee in dollars; as a share of the recorded rent it
    // is the rate the document declares (7.5% on 291 Stone Mason Drive).
    ['record', isNum(num(annualCosts.propertyManagement)) && isNum(annualRentRecorded) && annualRentRecorded > 0
      ? Math.round((num(annualCosts.propertyManagement)! / annualRentRecorded) * 10000) / 100
      : undefined],
    ['legacy', fc.propertyManagementFees],
  ], 7);

  const base = {
    // Purchase & Loan
    purchasePrice,
    landPrice,
    buildPrice,
    marketValueNow,
    depositValue,
    loanAmount,
    loanToValueRatio,
    loanType,
    loanTermYears: pickNum('loanTermYears', [
      ['override', mo.loanTermYears], ['record', loanDetails.loanTerm], ['legacy', cashFlow.loanTermYears],
    ], 30),
    interestRate: pickNum('interestRate', [
      ['override', mo.interestRate], ['record', loanDetails.interestRate], ['legacy', fc.interestRate],
    ], 5.5),
    capitalGrowth: capitalGrowthValue,

    // New mortgage calculator fields
    interestOnlyPeriodYears,
    repaymentFrequency: pick<RepaymentFrequency>('repaymentFrequency', [['override', mo.repaymentFrequency]], 'monthly'),
    extraRepaymentPerMonth: pickNum('extraRepaymentPerMonth', [['override', mo.extraRepaymentPerMonth]], 0),
    offsetBalance: pickNum('offsetBalance', [['override', mo.offsetBalance]], 0),

    // Rental Income
    weeklyRent,
    occupancyRate: pickNum('occupancyRate', [
      ['override', mo.occupancyRate], ['record', assumptions.occupancyWeeks], ['legacy', cashFlow.occupancyRate],
    ], 52),

    // Acquisition costs — the same settlement-cost object the sibling report
    // states (QA-03): duty from the canonical engine's assessment as recorded,
    // legal and inspection fees as recorded.
    stampDuty: pickNum('stampDuty', [
      ['override', mo.stampDuty], ['record', initialCosts.stampDuty], ['legacy', fc.stampDuty],
    ], 0, true),
    solicitorFees: pickNum('solicitorFees', [
      ['override', mo.solicitorFees], ['record', initialCosts.legalFees], ['legacy', fc.solicitorFees],
    ], 0, true),
    inspectionFees: pickNum('inspectionFees', [
      ['override', mo.inspectionFees], ['record', initialCosts.inspectionFees], ['legacy', fc.inspectionFees],
    ], 0, true),

    // Expenses
    bodyCorporateFees: pickNum('bodyCorporateFees', [
      ['override', mo.bodyCorporateFees], ['record', annualCosts.strataFees], ['legacy', fc.bodyCorporateFees],
    ], 0, true),
    landTax: pickNum('landTax', [
      ['override', mo.landTax], ['record', annualCosts.landTax], ['legacy', fc.landTax],
    ], 0, true),
    councilRates: pickNum('councilRates', [
      ['override', mo.councilRates], ['record', annualCosts.councilRates], ['legacy', fc.councilRates],
    ], 0, true),
    waterRates: pickNum('waterRates', [
      ['override', mo.waterRates], ['record', annualCosts.waterRates], ['legacy', fc.waterRates],
    ], 0, true),
    buildingLandlordInsurance: pickNum('buildingLandlordInsurance', [
      ['override', mo.buildingLandlordInsurance], ['record', annualCosts.landlordInsurance], ['legacy', fc.buildingLandlordInsurance],
    ], 0, true),
    propertyManagementFees,
    repairsMaintenance: pickNum('repairsMaintenance', [
      ['override', mo.repairsMaintenance], ['record', annualCosts.maintenance], ['legacy', fc.repairsMaintenance],
    ], 0, true),
    lettingFees: pickNum('lettingFees', [
      ['override', mo.lettingFees], ['record', annualCosts.lettingFees], ['legacy', fc.lettingFees],
    ], 0, true),
    agentFee: pickNum('agentFee', [['override', mo.agentFee], ['legacy', fc.agentFee]], 0, true),

    // Tax & Growth
    // CPI Growth: independent macro indicator — fallback to 2.5% (RBA target midpoint)
    cpiGrowthRate: pickNum('cpiGrowthRate', [
      ['override', mo.cpiGrowthRate], ['record', assumptions.cpiGrowth], ['legacy', cashFlow.cpiGrowthRate],
    ], 2.5),
    depreciation: includeDepreciation
      ? pickNum('depreciation', [
        ['override', mo.depreciation], ['record', taxBenefits.depreciation], ['legacy', cashFlow.depreciation],
      ], 6000)
      : 0,
    taxRate: pickNum('taxRate', [
      ['override', mo.taxRate], ['record', taxBenefits.marginalTaxRate], ['legacy', cashFlow.taxRate],
    ], 30),
    constructionYear: pickNum('constructionYear', [
      ['override', mo.constructionYear], ['legacy', cashFlow.constructionYear],
    ], currentYear),

    // 10-Year Depreciation Schedule (from calculator)
    depreciationSchedule: mo.depreciationSchedule as Record<number, number> | undefined,
    depreciationMethod: mo.depreciationMethod as 'dv' | 'pc' | undefined,

    // Construction Settings
    constructionDurationMonths: pickNum('constructionDurationMonths', [['override', mo.constructionDurationMonths]], 7),

    // LMI (one-off Year 1 acquisition cost)
    lmiAmount: pickNum('lmiAmount', [['override', mo.lmiAmount], ['record', initialCosts.lmi]], 0, true),

    // Toggle state
    includeDepreciationInCashFlow: includeDepreciation,
  };
  if (!includeDepreciation) provenance.depreciation = 'override';

  const missingInputs = missingInputsOf(base, provenance);
  const assumedInputs = Object.entries(provenance)
    .filter(([, origin]) => origin === 'default')
    .map(([field]) => field);

  return {
    ...base,
    /** Which of override / record / legacy / default / absent each figure came from. */
    provenance,
    /** Inputs a projection cannot honestly run without, and which are not recorded. */
    missingInputs,
    /** Inputs that were defaulted because nothing recorded them — to be printed as assumed. */
    assumedInputs,
    /** Eight hex digits over the resolved inputs — printed so two documents can say whether they share a case. */
    caseFingerprint: caseInputsFingerprint({
      purchasePrice, loanAmount, loanType, interestOnlyPeriodYears,
      loanTermYears: base.loanTermYears, interestRate: base.interestRate, capitalGrowth: capitalGrowthValue,
      weeklyRent, occupancyRate: base.occupancyRate, propertyManagementFees,
      stampDuty: base.stampDuty, solicitorFees: base.solicitorFees, inspectionFees: base.inspectionFees, lmiAmount: base.lmiAmount,
      bodyCorporateFees: base.bodyCorporateFees, landTax: base.landTax, councilRates: base.councilRates, waterRates: base.waterRates,
      buildingLandlordInsurance: base.buildingLandlordInsurance, repairsMaintenance: base.repairsMaintenance, lettingFees: base.lettingFees,
      cpiGrowthRate: base.cpiGrowthRate, depreciation: base.depreciation, taxRate: base.taxRate,
    }),
  };
}

export type BaseFinancials = ReturnType<typeof readBaseFinancials>;

/** The six recurring holding-cost inputs; a projection with none of them recorded has no cost base. */
const COST_BASE_FIELDS = ['councilRates', 'waterRates', 'bodyCorporateFees', 'buildingLandlordInsurance', 'repairsMaintenance', 'lettingFees'] as const;

/**
 * What a projection cannot honestly run without. A rent that nobody recorded
 * is not a rent of zero, and a cost base with nothing in it is not a property
 * with no costs — the outputs of that model are a financing exercise wearing
 * an investment analysis's headings (QA-01).
 */
export function missingInputsOf(
  base: { purchasePrice: number; weeklyRent: number },
  provenance: Record<string, InputProvenance>,
): string[] {
  const missing: string[] = [];
  if (!(base.purchasePrice > 0) || provenance.purchasePrice === 'absent') missing.push('purchasePrice');
  if (!(base.weeklyRent > 0) || provenance.weeklyRent === 'absent') missing.push('weeklyRent');
  if (COST_BASE_FIELDS.every((f) => provenance[f] === 'absent')) missing.push('holdingCosts');
  return missing;
}

/**
 * The land / build split as the record states it. A build figure is derived
 * from the purchase price only where a land price is recorded; otherwise it is
 * null and a surface prints "not stated" rather than the purchase price.
 */
export function landBuildSplit(base: { purchasePrice: number; landPrice: number; buildPrice: number }): {
  landPrice: number | null;
  buildPrice: number | null;
  derived: boolean;
} {
  const land = base.landPrice > 0 ? base.landPrice : null;
  if (base.buildPrice > 0) return { landPrice: land, buildPrice: base.buildPrice, derived: false };
  if (land !== null && base.purchasePrice > land) return { landPrice: land, buildPrice: base.purchasePrice - land, derived: true };
  return { landPrice: land, buildPrice: null, derived: false };
}

/**
 * Refuse to produce a document from an incomplete projection. Unknown inputs
 * must make an incomplete result, not a zero-income analysis that looks
 * finished (QA-01) — the message names what is missing and where it is set.
 */
export function assertProjectionComplete(base: Pick<BaseFinancials, 'missingInputs'>): void {
  if (!base.missingInputs.length) return;
  const named = base.missingInputs.map((f) => INPUT_FIELD_LABELS[f] ?? f).join(', ');
  throw new Error(
    `This projection is incomplete: ${named} not recorded for this report. Record them in the report's financial inputs before generating the cash flow.`,
  );
}

/** Human labels for the fields a document may print as assumed or missing. */
export const INPUT_FIELD_LABELS: Record<string, string> = {
  purchasePrice: 'purchase price',
  weeklyRent: 'weekly rent',
  holdingCosts: 'holding costs (rates, water, strata, insurance, maintenance, letting)',
  interestRate: 'interest rate',
  loanTermYears: 'loan term',
  loanType: 'loan structure',
  interestOnlyPeriodYears: 'interest-only period',
  loanToValueRatio: 'loan-to-value ratio',
  loanAmount: 'loan amount',
  capitalGrowth: 'capital growth',
  occupancyRate: 'occupied weeks',
  propertyManagementFees: 'management fee',
  cpiGrowthRate: 'CPI growth',
  depreciation: 'depreciation allowance',
  taxRate: 'marginal tax rate',
  constructionYear: 'construction year',
  constructionDurationMonths: 'construction duration',
  marketValueNow: 'current market value',
  repaymentFrequency: 'repayment frequency',
  extraRepaymentPerMonth: 'extra repayments',
  offsetBalance: 'offset balance',
};

/** "interest rate 5.5%, management fee 7%" — the assumed inputs a document must disclose. */
export function describeAssumedInputs(base: BaseFinancials): string[] {
  const value = (field: string): string => {
    const v = (base as unknown as Record<string, unknown>)[field];
    switch (field) {
      case 'interestRate': case 'capitalGrowth': case 'propertyManagementFees': case 'cpiGrowthRate': case 'taxRate': case 'loanToValueRatio':
        return `${v}%`;
      case 'occupancyRate': return `${v} weeks`;
      case 'loanTermYears': case 'interestOnlyPeriodYears': return `${v} years`;
      case 'depreciation': case 'loanAmount': case 'marketValueNow':
        return `$${Number(v).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`;
      case 'loanType': return v === 'interest_only' ? 'interest only' : 'principal and interest';
      default: return String(v);
    }
  };
  return base.assumedInputs
    .filter((f) => INPUT_FIELD_LABELS[f] && !['repaymentFrequency', 'extraRepaymentPerMonth', 'offsetBalance', 'constructionYear', 'constructionDurationMonths', 'marketValueNow', 'loanAmount', 'loanToValueRatio'].includes(f))
    .map((f) => `${INPUT_FIELD_LABELS[f]} ${value(f)}`);
}

/**
 * What the projection's tax, land-tax and operating-cost lines REST ON —
 * the three evidence gaps the audit of 291 Stone Mason Drive recorded
 * (QA-12, QA-14, QA-15) and the document must now say out loud.
 *
 * A tax refund line assumes the investor can utilise the deductions at the
 * stated marginal rate in the year they arise; the record holds no
 * assessable income, no entity structure and no accountant's confirmation,
 * so eligibility and utilisation are ASSUMED, never evidenced. A land-tax
 * line is a figure for THIS property alone: land tax is assessed on the
 * owner's aggregate taxable landholdings in the state, which the record
 * does not hold, so a zero is "none recorded", not "none payable". And the
 * operating-cost base is whatever the record carries — an operator's entry
 * or a default — never a bill; the sentence says which, from `provenance`.
 *
 * Each note is written once, here, for the on-screen page, the jsPDF
 * document and the server-rendered PDF alike.
 */
export function evidenceBasisNotes(base: BaseFinancials): string[] {
  const notes: string[] = [];
  const taxSource = base.provenance.taxRate;
  if (base.taxRate > 0) {
    notes.push(
      `Tax effects assume deductions are utilised at a ${base.taxRate}% marginal rate in the year they arise `
      + `(rate ${taxSource === 'override' ? 'entered by the adviser' : taxSource === 'default' ? 'assumed by default' : 'from the report record'}); `
      + 'the investor\'s taxable income, ownership structure and eligibility are not held and must be confirmed with an accountant.',
    );
  }
  const landTaxSource = base.provenance.landTax;
  if (base.landTax > 0) {
    notes.push(
      `Land tax of $${Math.round(base.landTax).toLocaleString('en-AU')} a year is for this property alone; `
      + 'the assessment depends on the owner\'s aggregate taxable landholdings in the state, which are not held.',
    );
  } else {
    notes.push(
      landTaxSource === 'absent' || landTaxSource === 'default'
        ? 'No land tax is recorded for this property. That is not a finding that none is payable: land tax depends on the owner\'s aggregate taxable landholdings in the state, which are not held.'
        : 'Land tax is recorded as nil for this property; the assessment depends on the owner\'s aggregate taxable landholdings in the state, which are not held.',
    );
  }
  const costSources = new Set(
    (['councilRates', 'waterRates', 'bodyCorporateFees', 'buildingLandlordInsurance', 'repairsMaintenance', 'lettingFees'] as const)
      .map((f) => base.provenance[f])
      .filter((v): v is InputProvenance => v !== undefined && v !== 'absent'),
  );
  if (costSources.size) {
    const from = costSources.has('default') && costSources.size === 1
      ? 'default allowances, not quotes or bills'
      : costSources.has('default')
        ? 'a mix of recorded entries and default allowances, not quotes or bills'
        : 'the report record as entered, not quotes or bills';
    notes.push(`Operating costs are ${from}; confirm rates notices, strata levies, insurance quotes and management terms before relying on them.`);
  }
  return notes;
}

