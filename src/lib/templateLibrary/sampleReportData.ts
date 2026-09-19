/**
 * Sample report data for Template Library previews.
 *
 * ## Why this exists
 *
 * A template catalogue that shows abstract grey rectangles is asking the reader
 * to imagine the product. This dataset lets the browse and preview surfaces run
 * each template through the **real** production renderer, so what a user sees is
 * the actual document they would produce — same pipeline, same typography, same
 * palette as the PDF — with the fields filled in.
 *
 * ## It is sample data, and it says so
 *
 * Nothing here is real and nothing here is a customer's. Every surface that
 * renders it labels it as sample, because a preview that looks like live data
 * is worse than no preview: someone will screenshot it. The one rule this file
 * follows without exception is that it is used for **preview only** and is never
 * written into a report, a template, or the database.
 *
 * ## Conventions that matter
 *
 * - The `percent` filter formats the number it is given and does **not**
 *   multiply by 100. A 3.84% yield is `3.84`, not `0.0384`. Getting this wrong
 *   renders "0.04%".
 * - `currency` takes a raw number, not a preformatted string.
 * - Indexed bindings (`risks.0.action`) resolve through ordinary arrays.
 *
 * ## One scenario, told consistently
 *
 * Every namespace describes the same fictional engagement — the Nguyen family
 * buying in Leichhardt through Meridian Property Advisory — so a user flicking
 * between templates sees one coherent story rather than forty unrelated
 * fragments. That consistency is most of what makes a preview feel considered.
 */

import { projectCashFlow } from '../../../supabase/functions/_shared/cashFlowProjection.pure';
import { projectClientDetails } from '../../../supabase/functions/_shared/clientDetailsProjection.pure';
import { projectCashFlowComparison } from '../../../supabase/functions/_shared/cashFlowComparisonProjection.pure';
import { projectCommercialCapacity } from '../../../supabase/functions/_shared/commercialCapacityProjection.pure';
import { projectMarketIntelligence } from '../../../supabase/functions/_shared/marketIntelligenceProjection.pure';
import { projectReportQa } from '../../../supabase/functions/_shared/reportQaProjection.pure';
import { buildReportQaDocument } from '../../../supabase/functions/_shared/reports/reportQa/normalise.pure';
import { buildMarketIntelligenceReport } from '../../../supabase/functions/_shared/reports/marketIntelligence/normalise.pure';
import { taxEffectOf } from '@/lib/cashFlow/projectionEngine.pure';

const ADDRESS = '14 Marlborough Street, Leichhardt NSW 2040';
const CLIENT = 'Jordan & Sarah Nguyen';

/** Owner/timing triples reused by the action-list blocks across templates. */
function action(a: string, owner: string, timing: string) {
  return { action: a, owner, timing };
}
function risk(r: string, why: string, a: string) {
  return { risk: r, why, action: a };
}

/**
 * Attach named fields to a list.
 *
 * A few templates address the same namespace both ways — `fees.0.amount` for the
 * rows and `fees.exclusions` for the note underneath. The binding resolver walks
 * plain property access, so an array carrying extra keys satisfies both without
 * the template having to change.
 */
function withFields<T extends unknown[], P extends object>(list: T, fields: P): T & P {
  return Object.assign(list, fields);
}

const RISKS = [
  risk(
    'Interest rate sensitivity',
    'A 100bp rise adds roughly $214/week to the holding cost at the modelled loan amount.',
    'Fix 60% of the facility for three years and retain the offset on the balance.',
  ),
  risk(
    'Single-tenant vacancy',
    'One dwelling means income is binary — a four-week vacancy costs $3,800.',
    'Hold a six-month expense reserve and instruct a letting agent before settlement.',
  ),
  risk(
    'Heritage overlay constraints',
    'The street is a conservation area, so external changes need council consent.',
    'Confirm the granny-flat footprint with a town planner during the cooling-off period.',
  ),
];

const NEXT_STEPS = [
  action('Issue contract to conveyancer for review', 'Buyer', 'Within 2 days'),
  action('Book building, pest and strata inspections', 'Adviser', 'Within 5 days'),
  action('Confirm formal loan approval and valuation', 'Broker', 'Within 10 days'),
  action('Exchange with a 10% deposit and 42-day settlement', 'Conveyancer', 'Within 14 days'),
];

/**
 * The same four holdings the voice templates print, in the vocabulary
 * `portfolioProjection.pure.ts` publishes for a Portfolio Performance Review.
 *
 * ## Derived, not transcribed
 *
 * `portfolio.holdings` below already states each property's value, debt, yield
 * and **annual** net position, and the Compass masters need the same portfolio
 * expressed **monthly**, per-property and totalled. Writing that out twice is
 * how two pages of one preview come to disagree, so everything monthly here is
 * computed from the annual figures rather than typed beside them.
 *
 * The annuals are the anchors because they are anchored elsewhere: the
 * Leichhardt holding's −$21,476 is −$413 a week × 52, which `cashflow` states
 * and several templates print. A 52-week year does not divide into twelfths, so
 * the monthly figures carry cents; every template sets them with `| currency`,
 * which rounds to whole dollars, and the rounded rows total the rounded total.
 *
 * `monthlyExpenses` is the residual — rent less the net position — and so
 * includes debt servicing. At $2.088m of debt that is about $10.4k a month of
 * interest plus roughly $2.4k of holding costs, which is the shape a real
 * portfolio of this gearing has.
 */
const PORTFOLIO_HOLDINGS = [
  {
    address: '9/44 Regent Street, Newtown', propertyType: 'Apartment',
    value: 1125000, loan: 612000, grossYield: 3.9, annualCashflow: 2100,
    lenderName: 'Westpac', interestRate: 5.89, isOwnerOccupied: true,
  },
  {
    address: ADDRESS, propertyType: 'House',
    value: 1285000, loan: 1028000, grossYield: 3.84, annualCashflow: -21476,
    lenderName: 'Meridian Mutual', interestRate: 6.14, isOwnerOccupied: false,
  },
  {
    address: '7 Wardell Road, Dulwich Hill', propertyType: 'House',
    value: 640000, loan: 288000, grossYield: 4.6, annualCashflow: 3400,
    lenderName: 'CommBank', interestRate: 6.02, isOwnerOccupied: false,
  },
  {
    address: '12/3 Denison Road, Lewisham', propertyType: 'Apartment',
    value: 360000, loan: 160000, grossYield: 4.9, annualCashflow: 1776,
    lenderName: 'CommBank', interestRate: 6.02, isOwnerOccupied: false,
  },
].map((h) => {
  const monthlyRentalIncome = (h.value * h.grossYield) / 100 / 12;
  const netMonthlyCashflow = h.annualCashflow / 12;
  return {
    ...h,
    equity: h.value - h.loan,
    lvr: (h.loan / h.value) * 100,
    monthlyRentalIncome,
    netMonthlyCashflow,
    monthlyExpenses: monthlyRentalIncome - netMonthlyCashflow,
    cashOnCashReturn: (h.annualCashflow / (h.value - h.loan)) * 100,
    ownershipPercentage: 100,
    portfolioContribution: 0, // replaced below, once the total is known
  };
});

/** Portfolio totals, summed from the holdings so they cannot drift from them. */
const PORTFOLIO_TOTALS = (() => {
  const sum = (pick: (h: typeof PORTFOLIO_HOLDINGS[number]) => number) =>
    PORTFOLIO_HOLDINGS.reduce((t, h) => t + pick(h), 0);
  const mean = (pick: (h: typeof PORTFOLIO_HOLDINGS[number]) => number) =>
    sum(pick) / PORTFOLIO_HOLDINGS.length;
  const value = sum((h) => h.value);
  for (const h of PORTFOLIO_HOLDINGS) h.portfolioContribution = (h.equity / sum((x) => x.equity)) * 100;
  return {
    value,
    debt: sum((h) => h.loan),
    equity: sum((h) => h.equity),
    monthlyRentalIncome: sum((h) => h.monthlyRentalIncome),
    monthlyExpenses: sum((h) => h.monthlyExpenses),
    monthlyCashflow: sum((h) => h.netMonthlyCashflow),
    annualCashflow: sum((h) => h.annualCashflow),
    // The mean of the per-property figures, which is what
    // `portfolio_analysis_reports.average_lvr` / `average_yield` store — NOT
    // the portfolio-weighted ratios `portfolio.lvr` and `portfolio.grossYield`
    // carry for the voice templates. Both are correct and they are not equal
    // (55.96% against 61.2%), so they keep separate names.
    averageLvr: mean((h) => h.lvr),
    averageYield: mean((h) => h.grossYield),
  };
})();

/**
 * The 10 Year Cash Flow sample, built the way production builds it.
 *
 * ## Run through the projection rather than written out
 *
 * Every other namespace in this file is typed by hand, and for most of them
 * that is right. This one is not: the Compass masters bind
 * `cashflow.outcome.equityGrowthLessShortfall`,
 * `cashflow.outcome.valueGrowthPercent` and eight fields across ten years in
 * three scenarios — 240 numbers plus a dozen derivations. Typing them means the
 * preview can disagree with what the adapter would produce, and the disagreement
 * would be invisible: every figure would still look like a figure.
 *
 * So this states a **`financial_calculations` blob shaped exactly as
 * `investment_reports` stores one** and runs `projectCashFlow` over it, which is
 * the same call `cashFlowAdapter` makes. The preview is then the adapter's
 * output by construction, and a change to the projection moves the preview with
 * it rather than leaving it stale.
 *
 * ## The figures are the same engagement, at production's magnitudes
 *
 * The Leichhardt holding the rest of this file describes: $1.285m, an $1.028m
 * loan at 6.14%. Growth rates differ per scenario and nothing else does, which
 * is what the stored projections do — the loan amortises identically in all
 * three. The resulting series sit inside every range measured across the 162
 * stored projections: cash flow negative in every year, cumulative cash flow
 * reaching −$333k by year ten, and return running from 9% to 24%.
 */
const CASH_FLOW_FINANCIALS = (() => {
  const VALUE = 1285000;
  const LOAN = 1028000;
  const RATE = 6.14;
  const MONTHLY_PAYMENT = 6280;
  /** Year-one costs, grown at CPI. Their sum is deliberately never published. */
  const COSTS = {
    councilRates: 2184, waterRates: 780, landlordInsurance: 1612,
    maintenance: 2496, propertyManagement: 3224, strataFees: 0, landTax: 0,
    lettingFees: 920,
  };
  const COSTS_YEAR_ONE = Object.values(COSTS).reduce((t, v) => t + v, 0);
  const UPFRONT = 257000 + 56890 + 1500 + 500;
  const RENT_YEAR_ONE = 920 * 52;
  const CPI = 1.028;
  /**
   * The rates the stored projections are actually built at.
   *
   * Not a choice: `(value10/value1)^(1/9)` is 2.000, 4.000 and 6.000 on all 162
   * stored reports and `(rent10/rent1)^(1/9)` is 2.000, 3.000 and 4.000, to
   * three decimal places, without exception. The recorded
   * `assumptions.capitalGrowth` says something else on 66 of the 69 reports
   * that carry one, which is why neither the projection nor these masters
   * publish it — see `cashFlowProjection.pure.ts`.
   */
  const GROWTH: Record<string, { value: number; rent: number }> = {
    conservative: { value: 1.02, rent: 1.02 },
    moderate: { value: 1.04, rent: 1.03 },
    optimistic: { value: 1.06, rent: 1.04 },
  };

  /** Monthly amortisation, so the balance falls the way the stored series does. */
  const balanceAfterYears = (years: number): number => {
    const r = RATE / 100 / 12;
    let b = LOAN;
    for (let m = 0; m < years * 12; m += 1) b = b * (1 + r) - MONTHLY_PAYMENT;
    return Math.round(b);
  };

  const seriesFor = (scenario: string) => {
    const g = GROWTH[scenario];
    let cumulative = 0;
    return Array.from({ length: 10 }, (_, i) => {
      const year = i + 1;
      const propertyValue = Math.round(VALUE * g.value ** year);
      const previousValue = Math.round(VALUE * g.value ** (year - 1));
      const loanBalance = balanceAfterYears(year);
      const annualRent = Math.round(RENT_YEAR_ONE * g.rent ** i);
      const annualCosts = Math.round(COSTS_YEAR_ONE * CPI ** i);
      const cashFlow = Math.round(annualRent - annualCosts - MONTHLY_PAYMENT * 12);
      cumulative += cashFlow;
      return {
        year,
        propertyValue,
        loanBalance,
        equity: propertyValue - loanBalance,
        annualRent,
        cashFlow,
        cumulativeCashFlow: cumulative,
        // The year's own return: the value it gained plus the cash it took,
        // over what was put in. Whole-number percent, as the table stores it.
        roi: Number(
          (((propertyValue - previousValue + cashFlow) / UPFRONT) * 100).toFixed(2),
        ),
      };
    });
  };

  return {
    projections: {
      conservative: seriesFor('conservative'),
      moderate: seriesFor('moderate'),
      optimistic: seriesFor('optimistic'),
    },
    initialCosts: {
      propertyValue: VALUE, deposit: 257000, stampDuty: 56890,
      legalFees: 1500, inspectionFees: 500, lmi: 0,
      loanAmount: LOAN,
      // Present, production-shaped, and never published — the stored totals do
      // not equal the components beside them. See `cashFlowProjection.pure.ts`.
      totalUpfront: UPFRONT,
    },
    loanDetails: {
      interestRate: RATE,
      monthlyPayment: MONTHLY_PAYMENT,
      weeklyPayment: Number(((MONTHLY_PAYMENT * 12) / 52).toFixed(2)),
      totalInterest: 1230480,
      loanType: 'interest_only',
      rateSource: 'User specified',
      interestOnlyPeriod: 2,
      lvr: 80,
    },
    annualCosts: { ...COSTS, totalAnnual: COSTS_YEAR_ONE },
    // Recorded, production-shaped, and deliberately never published: 5.2% is
    // not the 4% the moderate series above is built at, which is exactly the
    // disagreement measured on 66 of the 69 stored reports that record one.
    assumptions: { capitalGrowth: 5.2, cpiGrowth: 2.8, occupancyWeeks: 52 },
    keyMetrics: { lvr: 80, annualNet: -21476, weeklyNet: -413 },
  };
})();

/** Exactly what `cashFlowAdapter` would hand the renderer for that report. */
const CASH_FLOW_SAMPLE = projectCashFlow({
  id: 'sample-cash-flow',
  property_address: ADDRESS,
  financial_calculations: CASH_FLOW_FINANCIALS,
  updated_at: '2026-08-02T00:00:00.000Z',
}).cashflow;

/**
 * The Client Details Form's own vocabulary, built the way production builds it.
 *
 * Run through `projectClientDetails` over a `ClientDetails` payload rather than
 * typed out, for the same reason the cash-flow sample is: the masters bind
 * grouped expense categories, capped collections and a derived position, and a
 * hand-written version can disagree with what the adapter produces without
 * anything looking wrong.
 *
 * The figures are the same Nguyen household the rest of this file describes,
 * shaped at the record's own magnitudes — and it is deliberately a client who
 * **has** something recorded, because the 742 clients who have nothing are
 * exercised by `clientDetailsCatalogue.spec.ts` instead. A preview showing the
 * empty case would be a preview of a five-page document.
 */
const CLIENT_DETAILS_SAMPLE = (() => {
  const aud = (value: number) => ({ value, unit: 'aud' as const });
  const perMonth = (value: number) => ({ value, unit: 'aud/month' as const });
  const perYear = (value: number) => ({ value, unit: 'aud/year' as const });
  const pct = (value: number) => ({ value, unit: 'percent' as const });

  const expense = (category: string, name: string, monthly: number, isEssential = true) =>
    ({ category, name, monthly: perMonth(monthly), isEssential });

  const property = (
    kind: 'investment' | 'smsf', kindLabel: string, address: string, shortAddr: string,
    value: number, loan: number, rent: number, outgoings: number, lender: string,
  ) => ({
    kind, kindLabel, address, shortAddress: shortAddr,
    value: aud(value), loanRemaining: aud(loan), equity: aud(value - loan),
    lvr: pct((loan / value) * 100), interestRate: pct(6.02),
    // Precision 0, as the normaliser builds it — `percent(x, 0)` — so the
    // strapline reads "100% ownership" rather than "100.00% ownership".
    ownershipPercentage: { value: 100, unit: 'percent' as const, precision: 0 },
    lender, repaymentType: 'Principal and interest',
    rentMonthly: perMonth(rent), rentWeekly: { value: (rent * 12) / 52, unit: 'aud/week' as const },
    expensesMonthly: perMonth(outgoings), netMonthly: perMonth(rent - outgoings),
    smsf: null,
  });

  const details = {
    meta: {
      clientId: 'sample-client',
      clientName: CLIENT,
      preparedOn: '2026-08-02T00:00:00.000Z',
      propertyCount: 2,
      hasSecondaryContact: true,
    },
    narrative:
      'The record describes a two-person household with two investment holdings, three '
      + 'employment rows and forty-one recorded expense lines. Every figure below is summed '
      + 'from the rows this document also prints.',
    household: {
      contacts: [
        { role: 'primary' as const, name: 'Jordan Nguyen', email: 'jordan@example.test', mobile: '0400 000 000', gender: 'Male', dateOfBirth: '1986-04-12' },
        { role: 'secondary' as const, name: 'Sarah Nguyen', email: 'sarah@example.test', mobile: '0400 000 001', gender: 'Female', dateOfBirth: '1988-09-30' },
      ],
      residences: [{
        contact: 'primary' as const,
        residence: {
          address: '9/44 Regent Street', suburb: 'Newtown', state: 'NSW', postcode: '2042',
          country: 'Australia', livingSituation: 'Owner occupied',
          residentialStatus: 'Australian citizen',
        },
        sharedWithPrimary: false,
      }, {
        // The commoner of the two secondary shapes — the projection turns this
        // into the legacy sentence, and the preview exercises the
        // second-contact residence row with it.
        contact: 'secondary' as const,
        residence: {
          address: '9/44 Regent Street', suburb: 'Newtown', state: 'NSW', postcode: '2042',
          country: 'Australia', livingSituation: 'Owner occupied',
          residentialStatus: 'Australian citizen',
        },
        sharedWithPrimary: true,
      }],
      maritalStatus: 'Married',
      dependents: { value: 2, unit: 'rate' as const },
      history: [
        { contact: 'primary' as const, address: '12/3 Denison Road, Lewisham', isCurrent: false, startDate: '2019-02-01', endDate: '2023-06-30', months: 53, livingSituation: 'Renting' },
        { contact: 'primary' as const, address: '9/44 Regent Street, Newtown', isCurrent: true, startDate: '2023-07-01', endDate: '', months: 37, livingSituation: 'Owner occupied' },
      ],
    },
    ownerOccupied: {
      ...property('investment', 'Owner occupied', '9/44 Regent Street, Newtown NSW 2042', 'Regent Street, Newtown', 1125000, 612000, 0, 1840, 'Westpac'),
      kind: 'owner-occupied' as const,
    },
    employment: [
      { contact: 'primary' as const, employer: 'Meridian Systems Australia', employmentType: 'Full time', role: 'Engineering manager', startDate: '2021-03-01', isCurrent: true, workplace: 'Sydney NSW', workArrangement: 'Hybrid', grossAnnual: perYear(198000), extrasAnnual: perYear(24000) },
      { contact: 'secondary' as const, employer: 'Inner West Health District', employmentType: 'Part time', role: 'Clinical nurse', startDate: '2018-08-13', isCurrent: true, workplace: 'Camperdown NSW', workArrangement: 'On site', grossAnnual: perYear(86000), extrasAnnual: perYear(9200) },
    ],
    income: {
      primaryEmploymentMonthly: perMonth(18500), secondaryEmploymentMonthly: perMonth(7933),
      totalEmploymentMonthly: perMonth(26433),
      otherIncome: [{ label: 'Managed fund distributions', monthly: perMonth(410), contact: 'primary' as const }],
      totalOtherMonthly: perMonth(410), rentalMonthly: perMonth(4290),
      totalMonthly: perMonth(31133), totalGrossAnnual: perYear(373596),
    },
    assets: [
      { type: 'Savings', description: 'Offset account', value: aud(84000) },
      { type: 'Superfund', description: 'Australian Retirement Trust', value: aud(412000) },
      { type: 'Superfund', description: 'Aware Super', value: aud(196000) },
      { type: 'Vehicle', description: '2022 Subaru Outback', value: aud(38000) },
      { type: 'Alternative', description: 'Listed shares', value: aud(61000) },
      { type: 'Other', description: 'Term deposit', value: aud(25000) },
    ],
    liabilities: [
      { type: 'Credit card', provider: 'CommBank', balance: aud(4200), creditLimit: aud(15000), interestRate: pct(20.99), captured: perMonth(300), monthlyServicing: perMonth(300), isEstimated: false, basis: 'As recorded' },
      { type: 'Vehicle loan', provider: 'Pepper Money', balance: aud(28400), creditLimit: null, interestRate: pct(8.4), captured: perMonth(612), monthlyServicing: perMonth(612), isEstimated: false, basis: 'As recorded' },
      { type: 'Student loan', provider: 'ATO', balance: aud(19800), creditLimit: null, interestRate: null, captured: perMonth(430), monthlyServicing: perMonth(430), isEstimated: false, basis: 'As recorded' },
    ],
    liabilitiesIncludeEstimates: false,
    expenses: [
      expense('Groceries', 'Supermarket', 1650),
      expense('Groceries', 'Butcher and greengrocer', 340),
      expense('Housing', 'Council rates', 210),
      expense('Housing', 'Water', 85),
      expense('Transport', 'Fuel', 380),
      expense('Transport', 'Tolls and parking', 120),
      expense('Insurance', 'Health cover', 460),
      expense('Insurance', 'Car and contents', 180),
      expense('Childcare & Support', 'Before and after school care', 720),
      expense('Utilities', 'Electricity and gas', 290),
      expense('Communications', 'Internet and mobile', 165),
      expense('Recreation', 'Dining and entertainment', 540, false),
      expense('Personal Care', 'Health and grooming', 210, false),
      expense('Education', 'School fees', 1250),
      expense('Medical', 'Out of pocket', 140),
    ],
    properties: [
      property('investment', 'Investment', '7 Wardell Road, Dulwich Hill NSW 2203', 'Wardell Road, Dulwich Hill', 640000, 288000, 2450, 1180, 'CommBank'),
      property('smsf', 'SMSF', '12/3 Denison Road, Lewisham NSW 2049', 'Denison Road, Lewisham', 360000, 160000, 1840, 900, 'Macquarie'),
    ],
    position: {
      propertyValue: aud(2125000), propertyDebt: aud(1060000), propertyEquity: aud(1065000),
      otherAssets: aud(816000), otherLiabilities: aud(52400),
      netWorth: aud(1828600),
      incomeMonthly: perMonth(31133), commitmentsMonthly: perMonth(14962),
      surplusMonthly: perMonth(16171), commitmentRatio: pct(48.05),
    },
  };

  return projectClientDetails(details as never).clientDetails;
})();

/**
 * The Cash Flow Comparison's own vocabulary, run through its projection.
 *
 * ## Its magnitudes come from the payload's caps, not from production
 *
 * Every other sample in this file is shaped from measured production rows. This
 * one cannot be: the format's ledger holds **0 rows**, its analysis table holds
 * 0 rows and structurally cannot hold any, and the projections it compares are
 * the browser's and are never persisted. See
 * `cashFlowComparisonProjection.pure.ts` — that is also why the 50 masters are
 * preview-only.
 *
 * So the figures below are the same Leichhardt-area properties the rest of this
 * file describes, at the same magnitudes, with three properties — the middle of
 * the 2-to-5 range the normaliser enforces, so the preview exercises the
 * property-count variants rather than either end of them.
 *
 * The analysis half is present, because a preview of the pages that only exist
 * when a model wrote something is worth more than a preview without them. The
 * catalogue spec exercises the other direction.
 */
const CASH_FLOW_COMPARISON_SAMPLE = (() => {
  const aud = (value: number) => ({ value, unit: 'aud' as const });
  const perYear = (value: number) => ({ value, unit: 'aud/year' as const });
  const pct = (value: number) => ({ value, unit: 'percent' as const });
  const ratio = (value: number) => ({ value, unit: 'rate' as const });

  /** Ten years of one property, compounding from its own inputs. */
  const projectionFor = (
    value: number, loan: number, rent: number, growth: number, afterTaxYearOne: number,
  ) => {
    const years = Array.from({ length: 10 }, (_, i) => {
      const y = i + 1;
      const propertyValue = Math.round(value * growth ** y);
      const loanBalance = Math.round(loan * (1 - 0.0114 * y));
      const afterTaxAnnual = Math.round(afterTaxYearOne + i * 1450);
      return {
        year: y, calendarYear: 2026 + i,
        propertyValue: aud(propertyValue),
        loanBalance: aud(loanBalance),
        equity: aud(propertyValue - loanBalance),
        lvr: pct((loanBalance / propertyValue) * 100),
        rentalIncome: perYear(Math.round(rent * 1.031 ** i)),
        grossYield: pct((rent / value) * 100),
        netYield: pct(((rent * 0.72) / value) * 100),
        expenses: perYear(Math.round(rent * 0.28)),
        interestRate: pct(6.14),
        interest: perYear(Math.round(loanBalance * 0.0614)),
        principal: perYear(Math.round(loan * 0.0114)),
        preTaxAnnual: perYear(afterTaxAnnual - 5200),
        preTaxWeekly: { value: (afterTaxAnnual - 5200) / 52, unit: 'aud/week' as const },
        afterTaxAnnual: perYear(afterTaxAnnual),
        afterTaxWeekly: { value: afterTaxAnnual / 52, unit: 'aud/week' as const },
        depreciation: perYear(8200), taxRefund: perYear(5200), landTax: perYear(0),
        capitalGrowth: pct((growth - 1) * 100), cpiGrowth: pct(2.8),
      };
    });
    return { years };
  };

  const outcomeFor = (
    proj: ReturnType<typeof projectionFor>, initial: number,
  ) => {
    const first = proj.years[0];
    const last = proj.years[9];
    const cumulative = proj.years.reduce((t, y) => t + y.afterTaxAnnual.value, 0);
    const gain = last.propertyValue.value - first.propertyValue.value;
    const total = gain + cumulative;
    const firstPositive = proj.years.find((y) => y.afterTaxAnnual.value >= 0)?.year ?? null;
    let running = 0;
    let payback: number | null = null;
    for (const y of proj.years) {
      running += y.afterTaxAnnual.value;
      if (running >= 0 && payback === null) payback = y.year;
    }
    return {
      cumulativeAfterTax: aud(cumulative),
      capitalGain: aud(gain),
      endingValue: aud(last.propertyValue.value),
      endingEquity: aud(last.equity.value),
      totalReturn: aud(total),
      initialInvestment: aud(initial),
      roi: pct((total / initial) * 100),
      annualisedRoi: pct((((1 + total / initial) ** 0.1) - 1) * 100),
      cashOnCash: pct((first.afterTaxAnnual.value / initial) * 100),
      equityMultiple: ratio((last.equity.value + cumulative) / initial),
      firstPositiveYear: firstPositive,
      paybackYear: payback,
      grossYield: first.grossYield,
      netYield: first.netYield,
      capitalGrowthRate: first.capitalGrowth,
    };
  };

  const spec = [
    { address: ADDRESS, short: 'Marlborough Street, Leichhardt', value: 1285000, loan: 1028000, rent: 47840, growth: 1.052, atax: -31600, initial: 315890, primary: true },
    { address: '7 Wardell Road, Dulwich Hill NSW 2203', short: 'Wardell Road, Dulwich Hill', value: 640000, loan: 288000, rent: 29400, growth: 1.048, atax: -9800, initial: 168400, primary: false },
    { address: '12/3 Denison Road, Lewisham NSW 2049', short: 'Denison Road, Lewisham', value: 360000, loan: 160000, rent: 17640, growth: 1.044, atax: -4200, initial: 96200, primary: false },
  ];

  const properties = spec.map((p, i) => {
    const projection = projectionFor(p.value, p.loan, p.rent, p.growth, p.atax);
    return {
      reportId: `report-${i + 1}`, number: i + 1,
      address: p.address, shortAddress: p.short, isPrimary: p.primary,
      projection, outcome: outcomeFor(projection, p.initial),
    };
  });

  const ranked = [...properties].sort(
    (a, b) => b.outcome.totalReturn.value - a.outcome.totalReturn.value,
  );
  const [first, second] = ranked;
  const lead = ((first.outcome.totalReturn.value - second.outcome.totalReturn.value)
    / Math.abs(first.outcome.totalReturn.value)) * 100;

  const winner = (key: string, label: string, pick: (p: typeof properties[number]) => number, lowerIsBetter = false) => {
    const sorted = [...properties].sort((a, b) => (lowerIsBetter ? pick(a) - pick(b) : pick(b) - pick(a)));
    return {
      key, label, property: sorted[0].number,
      value: aud(pick(sorted[0])), margin: aud(Math.abs(pick(sorted[0]) - pick(sorted[1]))),
      lowerIsBetter,
    };
  };

  const note = (reason: string, detail = '') => ({ reason, detail });

  const comparison = {
    meta: {
      primaryReportId: 'a41f8c92-0000-4000-8000-000000000000',
      clientName: CLIENT,
      preparedOn: '2026-08-02T00:00:00.000Z',
      investorProfile: 'balanced',
      investorProfileLabel: 'Balanced investor',
      termYears: 10,
      propertyCount: properties.length,
    },
    narrative:
      'Three properties compared over ten years for a balanced investor. The ranking is on '
      + 'capital gain plus cumulative cash flow, and the leader is ahead of second place by a '
      + 'margin stated as a share of its own return.',
    properties,
    scoreboard: {
      order: ranked.map((p) => p.number),
      leadMargin: pct(lead),
      winners: [
        winner('totalReturn', 'Best total return', (p) => p.outcome.totalReturn.value),
        winner('capitalGain', 'Most capital growth', (p) => p.outcome.capitalGain.value),
        winner('cumulativeAfterTax', 'Least cash required', (p) => p.outcome.cumulativeAfterTax.value),
        winner('endingEquity', 'Most ending equity', (p) => p.outcome.endingEquity.value),
        winner('initialInvestment', 'Cheapest to enter', (p) => p.outcome.initialInvestment.value, true),
      ],
    },
    analysis: {
      summary:
        'All three properties run negative in the early years and the smallest carries the '
        + 'lowest holding cost in absolute terms. Over the full term the largest holding '
        + 'produces the greatest capital gain, and that gain outweighs the additional cash it '
        + 'requires to hold.',
      rankings: [
        {
          rank: 1, property: 1, statedAddress: ADDRESS, score: 84,
          strengths: ['Largest capital gain over the term', 'Land-led inner-west holding'],
          weaknesses: ['Highest cash requirement in the early years'],
          verdict: 'The strongest total return of the three, driven by capital growth rather than by cash flow.',
        },
        {
          rank: 2, property: 3, statedAddress: '12/3 Denison Road, Lewisham NSW 2049', score: 71,
          strengths: ['Cheapest to enter', 'Smallest annual shortfall'],
          weaknesses: ['Least capital gain in dollar terms'],
          verdict: 'The easiest of the three to hold, and the least it returns.',
        },
        {
          rank: 3, property: null, statedAddress: '7 Wardell Rd, Dulwich Hill', score: 68,
          strengths: ['Balanced between growth and holding cost'],
          weaknesses: ['Leads on nothing'],
          verdict: 'Sits between the other two on every measure.',
        },
      ],
      trajectory: {
        fastestPositive: note('The smallest holding turns positive first, in year seven.'),
        strongestGrowth: note('The largest holding compounds from the highest base.'),
        concerns: [note('None of the three is cash-flow positive before year six.')],
      },
      capitalGrowth: {
        strongestEquity: note('Ending equity is greatest on the largest holding.'),
        wealthBuilder: note('Capital gain accounts for most of the total return in all three cases.'),
        endingValues: [],
      },
      yields: {
        bestGross: note('The smallest holding has the highest gross yield on its purchase price.'),
        bestNet: note('Net yields are within half a point of each other across the three.'),
        bestRoi: note('Return on capital favours the smallest holding, on the smallest base.'),
      },
      risk: {
        mostStable: note('The smallest holding requires the least cash in any single year.'),
        highestRisk: note('The largest holding carries the greatest absolute exposure to a rate move.'),
        risks: ['Rate sensitivity at the modelled LVR', 'Vacancy on a single-dwelling holding'],
        breakEven: [],
      },
      investorMatches: [
        { key: 'growthFocused', label: 'Growth focused', note: note('Favours the largest holding, on capital gain.') },
        { key: 'incomeFocused', label: 'Income focused', note: note('Favours the smallest holding, on the lowest shortfall.') },
        { key: 'balanced', label: 'Balanced', note: note('The middle holding sits between the two on every measure.') },
        { key: 'riskAverse', label: 'Risk averse', note: note('The lowest absolute exposure is the smallest holding.') },
      ],
      recommendation: {
        best: note('The largest holding, on total return over the full term.'),
        avoid: [note('None of the three should be ruled out on these figures alone.')],
        scenarios: ['If the holding period shortened to five years, the ranking would reverse.'],
      },
      missing: [],
    },
  };

  return projectCashFlowComparison(comparison as never).cashFlowComparison;
})();

/**
 * Report Q&A, through the format's own normaliser and projection.
 *
 * Until this existed the `qa` namespace was absent from the sample entirely,
 * so every Report Q&A preview rendered a cover with **no title** and every
 * page past it dark — the exact defect class `CLAUDE.md` records against
 * fixtures written in the catalogue's own vocabulary, except here there was
 * no fixture at all.
 *
 * The conversation is the same fictional engagement as the rest of this file:
 * three exchanges about the Leichhardt purchase, grounded in two reports the
 * other namespaces describe, with citations on the first answer so the
 * citations page previews. The answer carries the constructs the corpus
 * actually holds — 70% of stored answers use inline bold, 48% a heading,
 * 57% a list, 19% a pipe table.
 */
const REPORT_QA_SAMPLE = (() => {
  const answer = [
    '## Yield on the Marlborough Street purchase',
    '',
    'The **gross yield** at the asking price is 3.84%, against an inner-west '
      + 'median of 3.1%. Net of outgoings the figure is **2.79%**.',
    '',
    '| Measure | Figure |',
    '| --- | --- |',
    '| Gross yield | 3.84% |',
    '| Net yield | 2.79% |',
    '| Suburb median | 3.10% |',
    '',
    'Three things support the rent the projection assumes:',
    '',
    '- the vacancy rate in Leichhardt has held under 1.2% for six quarters;',
    '- comparable three-bedroom terraces let within 16 days;',
    '- the projected rent of $895 a week sits at the 60th percentile of '
      + 'current listings, not the top of the market.',
  ].join('\n');

  const citations = [
    {
      document_name: 'Investment Compass — 14 Marlborough Street',
      page_number: 12, paragraph_index: 3, similarity: 0.91,
      snippet: 'Gross rental yield at the recommended purchase price is 3.84 per cent, '
        + 'against a trailing twelve-month suburb median of 3.10 per cent.',
    },
    {
      document_name: 'Suburb Profile — Leichhardt NSW 2040',
      page_number: 4, paragraph_index: 1, similarity: 0.84,
      snippet: 'Vacancy has remained below 1.2 per cent for six consecutive quarters.',
    },
  ];

  const messages = [
    { id: '00000000-0000-4000-8000-000000000001', role: 'user', content: 'What rental yield does the Marlborough Street purchase achieve, and how does it compare with the suburb?', created_at: '2026-08-01T09:00:00.000Z' },
    { id: '00000000-0000-4000-8000-000000000002', role: 'assistant', content: answer, created_at: '2026-08-01T09:00:41.000Z', model_provider: 'openai', model_version: 'gpt-5.2', citations },
    { id: '00000000-0000-4000-8000-000000000003', role: 'user', content: 'How sensitive is the cash flow to a rate rise?', created_at: '2026-08-01T09:03:12.000Z' },
    { id: '00000000-0000-4000-8000-000000000004', role: 'assistant', content: 'At **6.64%** the weekly position moves from -$118 to -$186; the surplus absorbs it.', created_at: '2026-08-01T09:03:44.000Z', model_provider: 'openai', model_version: 'gpt-5.2' },
    { id: '00000000-0000-4000-8000-000000000005', role: 'user', content: 'Which of the shortlisted suburbs had the strongest five-year growth?', created_at: '2026-08-01T09:05:02.000Z' },
    { id: '00000000-0000-4000-8000-000000000006', role: 'assistant', content: 'Leichhardt, at **6.2% a year** compounding over the five years to June 2026.', created_at: '2026-08-01T09:05:30.000Z', model_provider: 'openai', model_version: 'gpt-5.2' },
  ];

  const built = buildReportQaDocument({
    conversation: {
      id: '00000000-0000-4000-8000-00000000000a',
      title: 'Rental yield on the Leichhardt purchase',
      report_names: ['Investment Compass — 14 Marlborough Street.pdf', 'Suburb Profile — Leichhardt NSW 2040.pdf'],
      structured_report: null,
      created_at: '2026-08-01T08:58:00.000Z',
    },
    messages,
    subject: 'transcript',
    messageId: null,
    preparedOn: '2026-08-02T00:00:00.000Z',
  });
  if (!built.ok) throw new Error(`REPORT_QA_SAMPLE refused: ${(built as { error?: string }).error}`);
  return projectReportQa(built.document).qa;
})();

/**
 * Commercial & Industrial Capacity, through the format's own projection.
 *
 * The `capacity` namespace was absent from the sample entirely, so every
 * Commercial Capacity preview rendered a cover with no title and every page
 * past it dark — the same defect the Report Q&A sample closed.
 *
 * The snapshot below is hand-authored **on the payload contract** (every
 * number a `Measure`, absence as `null`) and shaped on the one stored
 * production run: a decline, bound by the debt service coverage ratio, three
 * of the eight tests carrying neither threshold nor actual — because a
 * decline is not this format's edge case, it is the whole corpus. The story
 * is the same fictional engagement as the rest of this file: Nguyen Holdings
 * buying a Wetherill Park warehouse through Meridian.
 */
const COMMERCIAL_CAPACITY_SAMPLE = (() => {
  const m = (value: number, unit = 'aud', precision?: number) =>
    (precision === undefined ? { value, unit } : { value, unit, precision });
  const aud = (value: number) => m(value);
  const perYear = (value: number) => m(value, 'aud/year');
  const pct = (value: number, precision = 2) => m(value, 'percent', precision);
  const rate = (value: number, precision = 1) => m(value, 'rate', precision);
  const ratio = (value: number) => m(value, 'ratio', 2);
  const years = (value: number) => m(value, 'years', 0);
  const count = (value: number) => m(value, 'count', 0);

  const snapshot = {
    meta: {
      subject: 'Nguyen Holdings Pty Ltd',
      reference: 'CI-2026-014',
      title: 'Wetherill Park warehouse purchase',
      assessedOn: '2026-08-01T00:00:00.000Z',
      assessmentId: 'sample-assessment',
      segment: 'industrial' as const,
      assessmentTypeLabel: 'Purchase',
      engineVersion: '2.4.1',
      policyVersion: '2026.07',
      lenderProfile: 'Mainstream commercial bank',
    },
    property: {
      address: '2/18 Fabrication Drive, Wetherill Park NSW 2164',
      assetClass: 'Warehouse',
      gstTreatment: 'Going concern (GST-free)',
      lettableArea: count(840),
      purchasePrice: aud(1_600_000),
      valuation: aud(1_600_000),
      valuationBasis: 'Lower of purchase price and valuation (price)',
    },
    headline: {
      outcome: 'outside_current_assumptions' as const,
      outcomeLabel: 'Outside current assumptions',
      outcomeReason:
        'The debt service coverage ratio falls below the policy floor at the requested facility.',
      maximumCapacity: aud(1_040_000),
      requestedLoan: aud(1_120_000),
      difference: aud(-80_000),
      requiredContribution: aud(560_000),
      bindingConstraint: 'Debt service coverage ratio',
      assessmentRate: pct(7.8),
      loanTerm: years(15),
      amortisation: years(25),
      monthlyDebtService: aud(10_674),
      surplus: perYear(52_340),
      sensitisedSurplus: perYear(38_512),
    },
    narrative:
      'On the figures supplied, the facility supports an indicative capacity of $1,040,000 '
      + 'against a request of $1,120,000. Capacity is set by the debt service coverage ratio. '
      + 'The shortfall of $80,000 would need to be met by a larger contribution or a smaller '
      + 'facility before the request fits current assumptions.',
    ratios: {
      lvr: rate(0.70), lvrCeiling: rate(0.65),
      dscr: ratio(1.04), dscrFloor: ratio(1.25),
      icr: ratio(1.31), icrFloor: ratio(1.50),
      debtYield: rate(0.058), debtYieldFloor: rate(0.09),
      ltc: rate(0.632), ltcCeiling: rate(0.70),
      debtToEbitda: ratio(3.1),
    },
    constraints: [
      { key: 'lvr', label: 'Loan-to-value ratio', cap: aud(1_040_000), formula: 'Valuation × max LVR 65%', binding: false, applied: true, threshold: rate(0.65), actual: rate(0.70) },
      { key: 'ltc', label: 'Loan-to-cost ratio', cap: aud(1_240_250), formula: 'Total cost × max LTC 70%', binding: false, applied: true, threshold: rate(0.70), actual: rate(0.632) },
      { key: 'dscr', label: 'Debt service coverage ratio', cap: aud(986_400), formula: 'NOI ÷ min DSCR 1.25x, capitalised at 7.80% over 25 years', binding: true, applied: true, threshold: ratio(1.25), actual: ratio(1.04) },
      { key: 'icr', label: 'Interest cover ratio', cap: aud(1_101_300), formula: 'NOI ÷ (min ICR 1.50x × assessment rate)', binding: false, applied: true, threshold: ratio(1.50), actual: ratio(1.31) },
      { key: 'debt_yield', label: 'Debt yield', cap: aud(1_040_000), formula: 'NOI ÷ minimum debt yield 9%', binding: false, applied: true, threshold: rate(0.09), actual: rate(0.058) },
      { key: 'contribution', label: 'Available borrower contribution', cap: aud(1_120_000), formula: 'Cash and equity available at settlement', binding: false, applied: true, threshold: null, actual: null },
      { key: 'global', label: 'Global servicing surplus', cap: aud(2_680_000), formula: 'Surplus across the group at the sensitised rate', binding: false, applied: true, threshold: null, actual: null },
      { key: 'policy', label: 'Policy maximum', cap: aud(1_120_000), formula: 'Lender profile ceiling for the asset class', binding: false, applied: false, threshold: null, actual: null },
    ],
    transaction: {
      lines: [
        { label: 'Purchase price', amount: aud(1_600_000), emphasis: 'normal' as const },
        { label: 'Stamp duty and government charges', amount: aud(88_400), emphasis: 'normal' as const },
        { label: 'Legal and due diligence', amount: aud(21_600), emphasis: 'normal' as const },
        { label: 'Lender and valuation fees', amount: aud(14_250), emphasis: 'normal' as const },
        { label: 'Total project cost', amount: aud(1_724_250), emphasis: 'total' as const },
      ],
      totalProjectCost: aud(1_724_250),
      borrowerContribution: aud(604_250),
      fundingGap: null,
      cashOut: null,
    },
    propertyIncome: {
      lines: [
        { label: 'Passing rent', amount: perYear(124_800), emphasis: 'normal' as const },
        { label: 'Less outgoings shortfall', amount: perYear(-9_200), emphasis: 'normal' as const },
        { label: 'Less vacancy allowance at 5%', amount: perYear(-6_240), emphasis: 'normal' as const },
        { label: 'Net operating income', amount: perYear(109_360), emphasis: 'total' as const },
      ],
      netOperatingIncome: perYear(109_360),
      capitalisationRate: rate(0.0585, 2),
      breakEvenOccupancy: rate(0.72, 0),
      wale: m(3.4, 'years', 1),
      tenantCount: count(2),
      tenantConcentration: rate(0.62, 0),
      tenancies: [
        { tenant: 'Coastal Fabrication Services Pty Ltd', area: count(520), passingRent: perYear(77_400), expiry: '2029-10-31', remainingTerm: m(3.2, 'years', 1), share: rate(0.62, 0) },
        { tenant: 'Inner West Logistics Group', area: count(320), passingRent: perYear(47_400), expiry: '2028-03-31', remainingTerm: m(1.6, 'years', 1), share: rate(0.38, 0) },
      ],
    },
    businessIncome: {
      periods: [
        { label: 'FY2026', periodEnd: '2026-06-30', basis: 'Accountant-prepared', verification: 'Accountant-prepared', reportedEbitda: perYear(510_000), confirmedAddbacks: perYear(68_500), unconfirmedAddbacks: perYear(0), adjustedEbitda: perYear(578_500), assessable: perYear(520_650) },
        { label: 'FY2025', periodEnd: '2025-06-30', basis: 'Lodged returns', verification: 'Lodged returns', reportedEbitda: perYear(468_200), confirmedAddbacks: perYear(54_100), unconfirmedAddbacks: perYear(12_000), adjustedEbitda: perYear(522_300), assessable: perYear(470_070) },
        { label: 'FY2024', periodEnd: '2024-06-30', basis: 'Lodged returns', verification: 'Lodged returns', reportedEbitda: perYear(431_800), confirmedAddbacks: perYear(49_700), unconfirmedAddbacks: perYear(0), adjustedEbitda: perYear(481_500), assessable: perYear(433_350) },
      ],
      selectionBasis: 'Weighted 3:2:1 across 3 periods, most recent weighted highest',
      adjustedEbitda: perYear(578_500),
      assessableIncome: perYear(520_650),
      verificationStatus: 'Accountant-prepared',
      trend: null,
      decliningIncome: false,
    },
    serviceability: {
      rows: [
        { label: 'Assessable business and personal income', amount: perYear(520_650), emphasis: 'normal' as const, direction: 'favourable' as const },
        { label: 'Proposed asset rent, after shading', amount: perYear(87_552), emphasis: 'normal' as const, direction: 'favourable' as const },
        { label: 'Portfolio rent, after shading', amount: perYear(31_480), emphasis: 'normal' as const, direction: 'favourable' as const },
        { label: 'Total assessable income', amount: perYear(639_682), emphasis: 'total' as const, direction: 'neutral' as const },
        { label: 'Less existing debt commitments', amount: perYear(-121_400), emphasis: 'normal' as const, direction: 'adverse' as const },
        { label: 'Less proposed facility at the assessment rate', amount: perYear(-128_093), emphasis: 'normal' as const, direction: 'adverse' as const },
        { label: 'Surplus after debt service', amount: perYear(390_189), emphasis: 'total' as const, direction: 'favourable' as const },
      ],
      assessmentRateBasis: 'Contract rate 6.80% plus 1.00% buffer.',
    },
    portfolio: {
      rows: [
        { label: 'Portfolio value', current: aud(2_450_000), proposed: aud(4_050_000), change: aud(1_600_000), direction: 'favourable' as const },
        { label: 'Total debt', current: aud(1_431_000), proposed: aud(2_551_000), change: aud(1_120_000), direction: 'adverse' as const },
        { label: 'Net equity', current: aud(1_019_000), proposed: aud(1_499_000), change: aud(480_000), direction: 'favourable' as const },
        { label: 'Portfolio LVR', current: rate(0.584), proposed: rate(0.63), change: rate(0.046), direction: 'adverse' as const },
        { label: 'Portfolio DSCR', current: ratio(1.62), proposed: ratio(1.38), change: ratio(-0.24), direction: 'adverse' as const },
        { label: 'Annual debt service', current: perYear(121_400), proposed: perYear(249_493), change: perYear(128_093), direction: 'adverse' as const },
        { label: 'Net cash flow', current: perYear(64_200), proposed: perYear(45_920), change: perYear(-18_280), direction: 'adverse' as const },
      ],
      direction: 'weakens' as const,
      assetCount: count(2),
      crossCollateralisedShare: rate(0.40, 0),
    },
    compliance: {
      classificationLabel: 'Business purpose (indicative)',
      requiresComplianceReview: false,
      requiresSpecialistReview: false,
      flags: [
        {
          code: 'GST_TREATMENT',
          severity: 'review' as const,
          message: 'The going-concern GST treatment relies on both parties being registered at settlement.',
          action: 'Confirm GST registration of vendor and purchaser before exchange.',
        },
      ],
    },
    warnings: [
      { severity: 'critical' as const, category: 'Financial', message: 'The requested facility exceeds the maximum indicative capacity under the selected assumptions.' },
      { severity: 'warning' as const, category: 'Financial', message: 'Debt service coverage sits below the policy floor at the requested amount.' },
      { severity: 'info' as const, category: 'Verification', message: 'Business income is accountant-prepared and has not been verified against lodged returns.' },
    ],
    outstanding: [
      { label: 'Executed lease for Unit B', blocking: true },
      { label: 'FY2026 accountant declaration', blocking: true },
      { label: 'Confirmation of plant and equipment exclusions', blocking: false },
    ],
    nextActions: [
      'Obtain the executed Unit B lease and updated tenancy schedule.',
      'Model the facility at $1,040,000 with the client before resubmission.',
      'Confirm GST registration of both parties ahead of exchange.',
    ],
    method: [
      { group: 'Income', label: 'Net operating income', inputs: ['Passing rent', 'Outgoings'], formula: 'Rent − outgoings shortfall − vacancy', value: '$109,360 pa', note: null },
      { group: 'Servicing', label: 'Debt service capacity', inputs: ['NOI', 'Assessment rate'], formula: 'NOI ÷ min DSCR 1.25x', value: '$986,400', note: 'Capitalised at 7.80% over 25 years' },
      { group: 'Security', label: 'LVR cap', inputs: ['Valuation'], formula: 'Valuation × 65%', value: '$1,040,000', note: null },
      { group: 'Outcome', label: 'Indicative capacity', inputs: ['All caps'], formula: 'Lowest of the applied caps', value: '$1,040,000', note: 'Bound by the DSCR' },
    ],
    analysis: {
      interpretation:
        'The deal is short on servicing rather than on security. The asset itself covers the '
        + 'request comfortably at valuation, but net operating income of $109,360 cannot carry '
        + 'the requested facility at the sensitised rate, and the group surplus — while strong — '
        + 'is weighted to business income that remains accountant-prepared. The gap is small '
        + 'enough that structure, not price, is the likeliest path: a longer amortisation or a '
        + 'modestly smaller facility both close it on the engine’s own arithmetic.',
      findings: [
        { title: 'Security is not the constraint', detail: 'The LVR cap permits the full request; the shortfall comes entirely from debt service.', significance: 'strength' },
        { title: 'Verification is the soft point', detail: 'The strongest income period is accountant-prepared; a lender will discount it until lodged returns confirm it.', significance: 'risk' },
        { title: 'Concentration is manageable', detail: 'The larger tenancy carries 62% of passing rent but has 3.2 years of term against a 15-year facility.', significance: 'neutral' },
      ],
      scenarios: [
        {
          name: 'Extend the amortisation to 30 years',
          reasoning: 'Debt service is sized on the amortisation period, not the term. Extending it lowers the monthly commitment the DSCR is tested against, and the engine’s own capitalisation moves the DSCR cap above the requested facility.',
          estimatedImpact: 'Indicative capacity rises above the $1,120,000 request; the DSCR ceases to bind.',
          executionRisk: 'medium',
          evidenceRequired: ['Lender term sheet confirming 30-year amortisation on the asset class'],
        },
        {
          name: 'Reduce the facility to the assessed capacity',
          reasoning: 'A facility of $1,040,000 passes every applied test as assessed today, and the additional $80,000 of contribution is within the funds the assessment already records at settlement.',
          estimatedImpact: 'The request fits current assumptions with no change to the deal’s structure.',
          executionRisk: 'low',
          evidenceRequired: ['Updated contribution statement'],
        },
        {
          name: 'Verify FY2026 business income',
          reasoning: 'The weighted income basis discounts the strongest period while it is accountant-prepared. Lodged returns confirming FY2026 lift assessable income and with it the global servicing surplus.',
          estimatedImpact: 'Assessable income rises by roughly the FY2026 discount; the servicing gap narrows.',
          executionRisk: 'low',
          evidenceRequired: ['Lodged FY2026 returns', 'ATO lodgement confirmation'],
        },
      ],
      questionsForCredit: [
        'Is a 30-year amortisation available on industrial assets under this profile?',
        'Will the lender rely on accountant-prepared FY2026 income, and at what discount?',
        'Does the going-concern GST treatment survive if the Unit B lease completes after exchange?',
        'What rate buffer applies on review if the facility is written at the assessed capacity?',
      ],
      model: 'google/gemini-2.5-flash',
      generatedAt: '2026-08-01T00:00:00.000Z',
    },
    disclaimer:
      'This assessment is indicative only, is not a lender decision or an offer of finance, and '
      + 'relies on the accuracy of the information supplied.',
  };

  return projectCommercialCapacity(snapshot as never).capacity;
})();

/**
 * Market Intelligence, through the format's own normaliser and projection.
 *
 * The `marketIntel` namespace was absent from the sample entirely, so every
 * Market Intelligence preview rendered a cover with no title and every page
 * past it dark — the fourth format found with the same defect. Going through
 * `buildMarketIntelligenceReport` matters more here than anywhere: the
 * normaliser's editorial strips are what keep the model's hedging and its
 * duplicated brand tagline off a client's page, and the brand name is an
 * input to them.
 *
 * One layer is deliberately empty so the preview exercises `layersOmitted`;
 * the investor segment previews the edition label and the audience panel; two
 * events sit after `preparedOn` so the upcoming table draws.
 */
const MARKET_INTELLIGENCE_SAMPLE = (() => {
  const layer = (content: string, citations: string[] = []) => ({ content, citations });
  const event = (
    date: string, name: string, category: string, impact: string, description: string,
  ) => ({ date, event: name, category, impact, description, relevance_score: 72 });

  const row = {
    id: '00000000-0000-4000-8000-00000000000b',
    status: 'completed',
    report_period: 'August 2026',
    report_type: 'full',
    audience_segment: 'investor',
    generated_at: '2026-08-01T21:15:00.000Z',
    include_advisory_strategy: true,
    report_data: {
      reportTypeLabel: 'Full Market Intelligence Report',
      audienceSegment: 'investor',
      includedLayers: ['layer1', 'layer2', 'layer3', 'layer4', 'layer6', 'layer7', 'layer8', 'layer5'],
      executiveSummary:
        'The cash rate held at **3.35%** this month, and the market has moved from asking '
        + '*whether* the easing cycle has ended to asking how long the plateau runs. Auction '
        + 'clearance in the inner west held above 71% for a sixth week, listings remain 12% '
        + 'below the five-year average, and the gap between advertised rents and renewed rents '
        + 'has narrowed to $20 a week.\n\nFor buyers this reads as a market with less '
        + 'competition than the clearance rate implies: stock is thin, but so is the crowd.',
      keyInsightsSnapshot:
        'Your 60-second briefing:\n\n'
        + '- The RBA held at **3.35%** and the statement dropped its easing bias.\n'
        + '- Inner-west clearance held above **71%** for a sixth straight week.\n'
        + '- Listings sit **12% below** the five-year average for August.\n'
        + '- Advertised-to-renewed rent gap narrowed to **$20 a week**.\n'
        + '- Construction approvals fell again — the 2028 supply gap is widening.',
      actionableStrategy:
        '## What to do now\n\nBring settlement-ready finance to any listing inside the '
        + 'corridor — vendors are meeting the market within three weeks.\n\n## What to avoid\n\n'
        + 'Paying clearance-rate premiums for stock outside the corridor; the auction heat is '
        + 'not general.\n\n## Timing\n\nThe spring listing lift is four to six weeks away; '
        + 'the thin-stock window closes with it.',
      ctaContent: 'Book a strategy call today to position your portfolio for the spring market.',
      layer1_rba: layer(
        '## Where rates stand\n\nThe Reserve Bank held the cash rate at **3.35%** and removed '
        + 'the explicit easing bias from its statement. Market pricing now implies one further '
        + 'cut by March 2027, down from two.\n\n- Three of the four majors trimmed fixed rates '
        + 'inside a week of the decision.\n- The average new owner-occupier variable rate fell '
        + 'to 5.84%.\n\nFor leveraged buyers the practical read is that serviceability '
        + 'assessments have stopped tightening.',
        ['RBA Statement on Monetary Policy, August 2026'],
      ),
      layer2_housing: layer(
        '## The pulse\n\nNational dwelling values rose **0.4%** in July, the seventh '
        + 'consecutive monthly rise.\n\n| Capital | Monthly change |\n| --- | --- |\n'
        + '| Sydney | +0.5% |\n| Melbourne | +0.3% |\n| Brisbane | +0.6% |\n\nListings '
        + 'remain 12% below the five-year August average.',
        ['CoreLogic Home Value Index, August 2026'],
      ),
      layer3_sentiment: layer(
        '## Sentiment\n\nConsumer sentiment lifted to **97.2** — its highest reading since '
        + 'early 2022 — with the time-to-buy-a-dwelling sub-index up 6.1% on the month. '
        + 'Investor finance commitments rose for the fifth straight month and now account '
        + 'for 38% of new lending, the highest share since 2017.',
        ['Westpac–Melbourne Institute Consumer Sentiment, August 2026'],
      ),
      layer4_regulatory: layer(''),
      layer6_economic: layer(
        '## The dashboard\n\nUnemployment held at **4.2%**, trimmed-mean inflation printed '
        + '2.8% annualised, and wage growth ran at 3.4%. The combination — real wage growth '
        + 'with inflation inside the band — is the backdrop the RBA said it wanted before '
        + 'considering any further move.',
        ['ABS Labour Force, July 2026'],
      ),
      layer7_micro: layer(
        '## The corridor\n\nThe inner-west corridor — Leichhardt, Haberfield, Five Dock — '
        + 'continues to outperform: clearance above 71%, median days on market at 24, and '
        + 'rental vacancy at 1.1%. Infrastructure works on the metro extension remain on '
        + 'schedule for 2028, which is the corridor’s structural story.',
        ['Domain Auction Report, August 2026'],
      ),
      layer8_competitive_edge: layer(
        '## The edge\n\nThe advertised-to-renewed rent gap is the quiet signal this month: '
        + 'at **$20 a week** it is a third of what it was a year ago, which says landlords '
        + 'are holding tenants rather than chasing the market. Combined with sub-1.5% vacancy, '
        + 'the rental floor under corridor valuations is firm — a downside protection most '
        + 'buyers are not pricing.',
      ),
      layer5_outlook: layer(
        '## The next ninety days\n\nExpect the plateau to hold through the October meeting, '
        + 'the spring listing lift to arrive four to six weeks out, and corridor stock to '
        + 'stay thin until it does. The window for negotiating on settlement terms rather '
        + 'than price closes with the spring lift.',
      ),
      marketEvents: [
        event('2026-09-16', 'RBA Board meeting', 'interest_rate', 'neutral',
          'The first meeting under the new statement language; pricing implies no change.'),
        event('2026-08-28', 'CPI monthly indicator', 'economic', 'positive',
          'The July indicator prints; a sub-3% read would cement the plateau narrative.'),
        event('2026-07-29', 'Q2 CPI release', 'economic', 'positive',
          'Trimmed mean printed 2.8% annualised, inside the band for a second quarter.'),
        event('2026-07-15', 'Auction clearance peak', 'housing', 'positive',
          'Inner-west clearance touched 74%, the highest Saturday result of the winter.'),
        event('2026-07-08', 'RBA held at 3.35%', 'interest_rate', 'neutral',
          'The hold was expected; the dropped easing bias was not.'),
        event('2026-06-30', 'Stamp duty concession sunset', 'regulatory', 'negative',
          'The first-home concession stepped down, pulling forward June settlements.'),
      ],
      allCitations: ['SQM Research Vacancy Rates, July 2026'],
    },
  };

  const built = buildMarketIntelligenceReport({
    row: row as never,
    preparedOn: '2026-08-02T00:00:00.000Z',
    brandName: 'Meridian Property Advisory',
    audienceOverride: null,
  } as never);
  if (!(built as { ok: boolean }).ok) {
    throw new Error(`MARKET_INTELLIGENCE_SAMPLE refused: ${(built as { error?: string }).error}`);
  }
  return projectMarketIntelligence((built as unknown as { report: never }).report).marketIntel;
})();

export const SAMPLE_REPORT_DATA: Record<string, unknown> = {
  reportType: 'investment',

  /**
   * Report-level metadata. The date is a fixed string, not `new Date()`: the
   * catalogue tests assert the rendered output, and a preview that changes at
   * midnight is a flaky test waiting to happen.
   */
  report: {
    generatedDate: '2 August 2026',
    // The document identity the Investment masters bind. The sample previews
    // the compass tier — the catalogue's own document — and the projection's
    // `DOCUMENT_IDENTITY` translates the other tiers at render time.
    tier: 'compass',
    documentTitle: 'Investment Compass',
    // Both come from `tierContent.pure.ts`, the one module that decides what a
    // tier's document contains. The old standfirst read "what it costs to
    // hold" — a promise of the financial modelling the Compass does not carry,
    // printed on the cover above a page sequence that then drew it.
    standfirst: 'Where the property is, who wants to live there, what is mapped over the land, and what the assessment concluded.',
    drawsFinancialModelling: false,
    companionNote: 'Purchase costs, yield, loan structure, cash flow and the ten-year projection are set out in the Financial Analysis Report for this property.',
    // The lender profile a Borrowing Capacity run was assessed under. Set on
    // 26 of 143 assessments, so the masters keep the block conditional; the
    // sample shows the named-lender path and matches `loan.lender` below.
    lenderName: 'Meridian Mutual',
  },

  /**
   * The letterhead.
   *
   * Fully populated here and, until August 2026, populated **nowhere else**:
   * no adapter published `org`, so every seeded template's disclaimer page
   * printed its labels with nothing beside them and every family cover had a
   * blank wordmark — while this preview showed a complete contact block.
   *
   * That is the trap `reportBindingProjection.pure.ts` was written for, in a
   * second place: a fixture written in the catalogue's vocabulary passes while
   * production is empty. `organisationProjection.pure.ts` is the producer now,
   * reading `whitelabel_settings`; `abn` and `address` below have no column
   * behind them and are sample-only.
   */
  /** The Client Details Form's namespace. See `CLIENT_DETAILS_SAMPLE`. */
  clientDetails: CLIENT_DETAILS_SAMPLE,

  /** The Cash Flow Comparison's namespace. See `CASH_FLOW_COMPARISON_SAMPLE`. */
  cashFlowComparison: CASH_FLOW_COMPARISON_SAMPLE,

  /** Report Q&A's namespace. See `REPORT_QA_SAMPLE`. */
  qa: REPORT_QA_SAMPLE,

  /** Market Intelligence's namespace. See `MARKET_INTELLIGENCE_SAMPLE`. */
  marketIntel: MARKET_INTELLIGENCE_SAMPLE,

  org: {
    name: 'Meridian Property Advisory',
    abn: '42 618 305 774',
    address: 'Level 8, 120 Sussex Street, Sydney NSW 2000',
    phone: '(02) 8005 4120',
    email: 'advice@meridianproperty.example',
    website: 'meridianproperty.example',
    /*
     * The deployment's own disclaimer and the point size it chose.
     *
     * `disclaimerPage()` used to bake `STANDARD_DISCLAIMER` into the schema, so
     * all 543 seeded templates carried the same five lines of boilerplate and
     * the firm's configured `professional_disclaimer` — nine paragraphs,
     * enabled, written for a Buyers Agent — reached the legacy composer and
     * nothing else. The block binds `{{org.disclaimer}}` now, with the standard
     * text as its fallback, so these two leaves need a producer in the sample
     * exactly as the catalogue specs require of every other bound path.
     */
    disclaimer:
      'As a Professional Property Consultant & Buyers Agent, we provide information and '
      + 'advice based on our expertise and experience in the real estate market. Please be '
      + 'aware that the advice and insights offered are for general informational purposes '
      + 'only and should not be considered financial advice.',
    disclaimerFontSize: 'medium',
    /*
     * The brand marks: a drawn "M" monogram for the fictional tenant.
     *
     * Deliberately not the house monogram — this sample belongs to "Meridian
     * Property Advisory", and the whole point of binding a mark rather than
     * baking one is that a tenant gets their own or none at all. A preview that
     * quietly showed NPC's monogram over Meridian's name would be the exact
     * confusion the arrangement exists to prevent.
     *
     * And deliberately not a 1x1 pixel. It briefly was one, which made every
     * library preview render the mark *invisibly* — the binding resolved, the
     * image drew, and a person looking at the page saw no logo anywhere. A
     * placeholder in preview data has to be visible or the preview lies about
     * the template. These are 480x384 PNGs (~3KB), drawn at build time from an
     * SVG "M" with the catalogue's gold.
     *
     * Two of them because the mark is never auto-inverted: `mark` is the ink
     * lockup for ivory paper and `markMono` the gold one for an obsidian
     * ground.
     */
    mark: 'data:image/png;base64,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',
    markMono: 'data:image/png;base64,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',
  },
  author: { name: 'Alexandra Whitfield', title: 'Senior Investment Adviser' },
  /**
   * The five weighted dimensions `investment_score.breakdown` holds.
   *
   * Shaped from the record: `growthScore` is weighted 40 and `demandScore` 15,
   * and both are scored a flat 50 with **no details** on 919 of the 985 scored
   * reports — so the grade is 55% placeholder, and the sample says so rather
   * than inventing prose for them. The three that do carry details are sized
   * from their measured maxima: risk 228 characters, location 94, yield 51.
   */
  assessment: [
    { label: 'Growth', score: 50, weight: 40 },
    {
      label: 'Location', score: 85, weight: 25,
      details: 'Excellent walkability (90+). Excellent CBD access (<15 min). Exceptional school access (8+)',
    },
    {
      label: 'Yield', score: 62, weight: 15,
      details: 'Moderate yield (3-4%) - Negative cash flow likely',
    },
    { label: 'Demand', score: 50, weight: 15 },
    {
      label: 'Risk', score: 53, weight: 5,
      details: 'High LVR (80%) increases leverage risk with LMI required. Moderate negative cash flow '
        + '($100-200/week) requires contribution. Heritage overlay constrains external change',
    },
  ],

  /** Empty on all but 19 of the 985 scored reports; the block is conditional. */
  opportunities: ['Approved secondary-dwelling footprint not yet built out'],

  recommendation: {
    headline: 'Proceed to offer at or below $1.29m',
    rationale:
      'The holding clears our land-value and tenant-demand tests, and the shortfall is '
      + 'serviceable inside the stated surplus. Value is in the land and the approved '
      + 'secondary-dwelling footprint, not in the current improvements.',
  },

  client: {
    name: CLIENT,
    email: 'j.nguyen@example.com',
    phone: '0412 887 340',
    address: '9/44 Regent Street, Newtown NSW 2042',
    dateOfBirth: '14 March 1988',
    employment: 'PAYG — Registered Nurse & Software Engineer',
    income: 268000,
    debts: 41500,
    deposit: 340000,
    preApproval: 'Conditional to $1,340,000 (Westpac, expires 12 weeks)',
    existingProperty: '1 — Newtown apartment, owner-occupied',
  },

  property: {
    address: ADDRESS,
    suburb: 'Leichhardt',
    type: 'Freestanding house',
    configuration: '3 bed · 2 bath · 1 car',
    landArea: '412 m²',
    yearBuilt: '1928',
    zoning: 'R2 Low Density Residential',
    tenancy: 'Vacant possession at settlement',
    condition: 'Original interior, sound structure, roof replaced 2019',
    rationale:
      'Land-rich holding inside the 8km ring with a compliant secondary-dwelling '
      + 'footprint and a level rear yard.',
  /**
   * Sample plates for the two photographic families.
   *
   * Luxury Editorial and Architectural Property declare `image_slots`, and a
   * catalogue preview that showed those plates as absent would make both
   * families look broken — the exact trap `docs/reports/COVERAGE.md` warns
   * about, where a measure passes because the thing it measures is unused.
   *
   * These are deliberately TONAL STUDIES rather than photographs. A sample
   * that looked like a real house would misrepresent what the preview shows,
   * and the reader is told this is sample data. Base64 SVG because
   * `renderResourcePolicy` skips a base64 payload and holds a
   * percent-encoded one under the SSRF scanner.
   *
   * No adapter emits `property.images` today. A real report therefore has
   * none, every plate is conditional, and an unfilled plate prints nothing.
   */
  images: [
    // Frontage
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgMzAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNDOUI4OTYiLz48c3RvcCBvZmZzZXQ9IjAuNTUiIHN0b3AtY29sb3I9IiM2RTYyNTMiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyQTI0MUMiLz48L2xpbmVhckdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0idiIgY3g9IjAuNSIgY3k9IjAuNDIiIHI9IjAuNzUiPjxzdG9wIG9mZnNldD0iMC41NSIgc3RvcC1jb2xvcj0iIzAwMCIgc3RvcC1vcGFjaXR5PSIwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDAwIiBzdG9wLW9wYWNpdHk9IjAuMzgiLz48L3JhZGlhbEdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCNnKSIvPjxlbGxpcHNlIGN4PSIxMjgiIGN5PSIxOTYiIHJ4PSIxOTAiIHJ5PSIxMjAiIGZpbGw9IiMyQTI0MUMiIG9wYWNpdHk9IjAuMjIiLz48cmVjdCB4PSIwIiB5PSIyMzIiIHdpZHRoPSI0MDAiIGhlaWdodD0iNjgiIGZpbGw9IiMyQTI0MUMiIG9wYWNpdHk9IjAuMzAiLz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCN2KSIvPjwvc3ZnPg==',
    // Streetscape
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgMzAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNEOEM5QUMiLz48c3RvcCBvZmZzZXQ9IjAuNTUiIHN0b3AtY29sb3I9IiM3QzcyNjQiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyNDFGMTkiLz48L2xpbmVhckdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0idiIgY3g9IjAuNSIgY3k9IjAuNDIiIHI9IjAuNzUiPjxzdG9wIG9mZnNldD0iMC41NSIgc3RvcC1jb2xvcj0iIzAwMCIgc3RvcC1vcGFjaXR5PSIwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDAwIiBzdG9wLW9wYWNpdHk9IjAuMzgiLz48L3JhZGlhbEdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCNnKSIvPjxlbGxpcHNlIGN4PSIxMjgiIGN5PSIxOTYiIHJ4PSIxOTAiIHJ5PSIxMjAiIGZpbGw9IiMyNDFGMTkiIG9wYWNpdHk9IjAuMjIiLz48cmVjdCB4PSIwIiB5PSIyMzIiIHdpZHRoPSI0MDAiIGhlaWdodD0iNjgiIGZpbGw9IiMyNDFGMTkiIG9wYWNpdHk9IjAuMzAiLz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCN2KSIvPjwvc3ZnPg==',
    // Parkland
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgMzAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNCOUM3QTQiLz48c3RvcCBvZmZzZXQ9IjAuNTUiIHN0b3AtY29sb3I9IiM1RjZBNTUiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMxRTI0MUIiLz48L2xpbmVhckdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0idiIgY3g9IjAuNSIgY3k9IjAuNDIiIHI9IjAuNzUiPjxzdG9wIG9mZnNldD0iMC41NSIgc3RvcC1jb2xvcj0iIzAwMCIgc3RvcC1vcGFjaXR5PSIwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDAwIiBzdG9wLW9wYWNpdHk9IjAuMzgiLz48L3JhZGlhbEdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCNnKSIvPjxlbGxpcHNlIGN4PSIxMjgiIGN5PSIxOTYiIHJ4PSIxOTAiIHJ5PSIxMjAiIGZpbGw9IiMxRTI0MUIiIG9wYWNpdHk9IjAuMjIiLz48cmVjdCB4PSIwIiB5PSIyMzIiIHdpZHRoPSI0MDAiIGhlaWdodD0iNjgiIGZpbGw9IiMxRTI0MUIiIG9wYWNpdHk9IjAuMzAiLz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCN2KSIvPjwvc3ZnPg==',
    // Interior
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgMzAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNFMENGQjAiLz48c3RvcCBvZmZzZXQ9IjAuNTUiIHN0b3AtY29sb3I9IiM4QTdBNjYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyQzI0MTkiLz48L2xpbmVhckdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0idiIgY3g9IjAuNSIgY3k9IjAuNDIiIHI9IjAuNzUiPjxzdG9wIG9mZnNldD0iMC41NSIgc3RvcC1jb2xvcj0iIzAwMCIgc3RvcC1vcGFjaXR5PSIwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDAwIiBzdG9wLW9wYWNpdHk9IjAuMzgiLz48L3JhZGlhbEdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCNnKSIvPjxlbGxpcHNlIGN4PSIxMjgiIGN5PSIxOTYiIHJ4PSIxOTAiIHJ5PSIxMjAiIGZpbGw9IiMyQzI0MTkiIG9wYWNpdHk9IjAuMjIiLz48cmVjdCB4PSIwIiB5PSIyMzIiIHdpZHRoPSI0MDAiIGhlaWdodD0iNjgiIGZpbGw9IiMyQzI0MTkiIG9wYWNpdHk9IjAuMzAiLz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCN2KSIvPjwvc3ZnPg==',
    // Aspect
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgMzAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNCNkJEQzgiLz48c3RvcCBvZmZzZXQ9IjAuNTUiIHN0b3AtY29sb3I9IiM2QjZFNzYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMxRDIwMjYiLz48L2xpbmVhckdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0idiIgY3g9IjAuNSIgY3k9IjAuNDIiIHI9IjAuNzUiPjxzdG9wIG9mZnNldD0iMC41NSIgc3RvcC1jb2xvcj0iIzAwMCIgc3RvcC1vcGFjaXR5PSIwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDAwIiBzdG9wLW9wYWNpdHk9IjAuMzgiLz48L3JhZGlhbEdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCNnKSIvPjxlbGxpcHNlIGN4PSIxMjgiIGN5PSIxOTYiIHJ4PSIxOTAiIHJ5PSIxMjAiIGZpbGw9IiMxRDIwMjYiIG9wYWNpdHk9IjAuMjIiLz48cmVjdCB4PSIwIiB5PSIyMzIiIHdpZHRoPSI0MDAiIGhlaWdodD0iNjgiIGZpbGw9IiMxRDIwMjYiIG9wYWNpdHk9IjAuMzAiLz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCN2KSIvPjwvc3ZnPg==',
    // Detail
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MDAgMzAwIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNDQkI1QTIiLz48c3RvcCBvZmZzZXQ9IjAuNTUiIHN0b3AtY29sb3I9IiM3QTY1NTgiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMyNTFDMTciLz48L2xpbmVhckdyYWRpZW50PjxyYWRpYWxHcmFkaWVudCBpZD0idiIgY3g9IjAuNSIgY3k9IjAuNDIiIHI9IjAuNzUiPjxzdG9wIG9mZnNldD0iMC41NSIgc3RvcC1jb2xvcj0iIzAwMCIgc3RvcC1vcGFjaXR5PSIwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDAwIiBzdG9wLW9wYWNpdHk9IjAuMzgiLz48L3JhZGlhbEdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCNnKSIvPjxlbGxpcHNlIGN4PSIxMjgiIGN5PSIxOTYiIHJ4PSIxOTAiIHJ5PSIxMjAiIGZpbGw9IiMyNTFDMTciIG9wYWNpdHk9IjAuMjIiLz48cmVjdCB4PSIwIiB5PSIyMzIiIHdpZHRoPSI0MDAiIGhlaWdodD0iNjgiIGZpbGw9IiMyNTFDMTciIG9wYWNpdHk9IjAuMzAiLz48cmVjdCB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0idXJsKCN2KSIvPjwvc3ZnPg==',
  ],
  },

  financials: {
    purchasePrice: 1285000, stampDuty: 55832, legalFees: 2200, inspectionFees: 1450,
    loanFees: 1600, loanAmount: 1028000,
    // `deposit` is `initialCosts.deposit`, published all along and bound for the
    // first time now that the acquisition table shows the largest part of the
    // cash instead of leaving its total looking unrelated to the page.
    deposit: 257000,
    // `totalCost` is `initialCosts.totalUpfront` — the cash required at
    // settlement, NOT the sum of the rows above it. It is deliberately not
    // 257,000 + 55,832 + 2,200 + 1,450 + 1,600 here either: across the 167
    // stored runs the two agree on 29, and a sample that made them agree would
    // assert an arithmetic production does not satisfy.
    totalCost: 316_600,
    weeklyRent: 950, annualRent: 49400,
    weeklyRepayment: 1180, annualRepayment: 61360,
    weeklyRates: 42, annualRates: 2184,
    weeklyInsurance: 31, annualInsurance: 1612,
    weeklyMaintenance: 48, annualMaintenance: 2496,
    weeklyManagement: 62, annualManagement: 3224,
    weeklyHolding: 183, annualHolding: 9516,
    weeklyCosts: 1363, weeklyNet: -413, annualNet: -21476,
    grossYield: 3.84, cashOnCash: 2.1, breakEvenRent: 1363,
    fundingNote:
      'Modelled at 80% LVR on a 30-year P&I facility at 6.14%, with the balance funded '
      + 'from the stated deposit and no lenders mortgage insurance.',
    narrative:
      'The holding is negatively geared by $413 a week before tax and roughly $268 after '
      + 'the depreciation and interest deductions modelled overleaf. That shortfall sits '
      + 'inside the household surplus with room to absorb a further 100bp of rate movement.',
  },

  assumptions: {
    capitalGrowth: 5.2, rentalGrowth: 3.1, interestRate: 6.14,
    expenseInflation: 2.8, vacancy: 2.0, taxRate: 39, sellingCosts: 2.5,
    // ── Borrowing Capacity Snapshot ──────────────────────────────────────────
    // The run's recorded assumptions as the legacy normaliser publishes them —
    // eleven rows because that is the production cluster (88 of 143 runs), so
    // the preview exercises the eleven-row table variant the median report
    // draws. Values reconcile with `loan` and `capacity` below.
    rowCount: 11,
    rows: [
      { label: 'Serviceability Basis', value: 'After-Tax Income' },
      { label: 'Lender Profile', value: 'Meridian Mutual' },
      { label: 'Buffer Rate', value: '3%' },
      { label: 'Assessment Rate', value: '9.14%' },
      { label: 'Loan Term', value: '30 years' },
      { label: 'Expense Method', value: 'HEM benchmark' },
      { label: 'HEM Benchmark', value: '$6,420/mo' },
      { label: 'Rental Shading', value: '75% of gross rent' },
      { label: 'Bonus Shading', value: '85% of declared bonus' },
      { label: 'DTI Cap', value: 'Enabled at 6.0x' },
      { label: 'LMI Mode', value: 'None' },
    ],
  },

  market: {
    postcode: '2040', state: 'NSW', suburbCount: 34,
    medianPrice: 1985000, medianPriceLast: 1871000,
    medianRent: 950, medianRentLast: 895,
    grossYield: 2.49, grossYieldLast: 2.35, yieldChange: 0.14,
    growth12m: 6.1, rentGrowth12m: 6.15,
    vacancy: 1.4, vacancyLast: 1.9, vacancyChange: -0.5,
    daysOnMarket: 21, daysOnMarketLast: 28, domChange: -7, daysToLease: 12,
    regionMedianPrice: 1642000, regionMedianRent: 820, regionGrowth12m: 4.8,
    regionVacancy: 1.7, regionGrossYield: 2.6, regionDaysOnMarket: 26,
    stateMedianPrice: 1180000, stateMedianRent: 720, stateGrowth12m: 3.9,
    stateVacancy: 2.1, stateGrossYield: 3.17, stateDaysOnMarket: 32,
    source: 'CoreLogic hedonic index, quarter close',
    censusSource: 'ABS Census, latest release',
    strength: [
      'Days on market fell from 28 to 21 across the year — buyers are competing earlier.',
      'Vacancy at 1.4% is half a point below the regional average.',
      'Rental growth of 6.15% outpaced price growth, lifting yield off its floor.',
    ],
    watch: [
      'Yield remains below 2.5%, so the case rests on land value rather than income.',
      'Two townhouse approvals within 900m add 46 dwellings from late next year.',
    ],
    narrative:
      'Leichhardt has moved from a recovery footing to a genuinely tight market. Stock on '
      + 'market is down, days on market has compressed by a week, and the rental market is '
      + 'clearing faster than the surrounding region. Prices have followed rents rather '
      + 'than led them, which is the healthier of the two sequences.',
    conclusion: {
      headline: 'Tight, land-constrained, and clearing faster than the region',
      body:
        'On every measure we track, the suburb is ahead of both its region and the state. '
        + 'The constraint is entry yield, not demand. Buy for the land and the ability to '
        + 'add a second dwelling, and treat the current rent as a floor rather than a case.',
    },
    drivers: [
      { title: 'Employment access', body: 'Thirty-one minutes to the CBD by light rail, with the Bays Precinct pipeline adding local white-collar roles.' },
      { title: 'Constrained supply', body: 'A conservation overlay across 60% of the suburb caps new detached stock almost entirely.' },
      { title: 'School catchment', body: 'In-catchment for two consistently over-subscribed public primary schools.' },
      { title: 'Amenity depth', body: 'Norton Street retail strip, two supermarkets and 4.2 hectares of parkland within 800m.' },
    ],
    calendar: [
      { date: 'Q1', label: 'Rate decision cycle', note: 'Three meetings; market pricing one cut.' },
      { date: 'Q2', label: 'Land tax assessments', note: 'Issued to investors; typical listing bump.' },
      { date: 'Q3', label: 'Spring listings', note: 'Volume rises 40%; best window to buy.' },
      { date: 'Q4', label: 'Townhouse completions', note: '46 dwellings settle 900m north.' },
    ],
    suburbs: [
      { name: 'Leichhardt', median: 1985000, rent: 950, yield: 2.49, growth: 6.1 },
      { name: 'Annandale', median: 2140000, rent: 990, yield: 2.41, growth: 5.4 },
      { name: 'Lilyfield', median: 1875000, rent: 920, yield: 2.55, growth: 6.8 },
      { name: 'Petersham', median: 1660000, rent: 880, yield: 2.76, growth: 5.9 },
      { name: 'Marrickville', median: 1595000, rent: 860, yield: 2.80, growth: 7.2 },
    ],
    regions: [
      { name: 'Inner West', median: 1642000, rent: 820, vacancy: 1.7, growth: 4.8 },
      { name: 'Eastern Suburbs', median: 2380000, rent: 1150, vacancy: 1.5, growth: 4.1 },
      { name: 'Lower North Shore', median: 2210000, rent: 1050, vacancy: 1.6, growth: 3.8 },
      { name: 'Northern Beaches', median: 1980000, rent: 980, vacancy: 1.4, growth: 4.4 },
      { name: 'Parramatta', median: 1120000, rent: 700, vacancy: 2.3, growth: 5.6 },
      { name: 'Sutherland', median: 1385000, rent: 760, vacancy: 1.8, growth: 4.2 },
    ],
  },

  scorecard: {
    locationNote: 'Inside the 8km ring with rail and light rail access.',
    yieldNote: 'Below the metro median; the case is land, not income.',
    growthNote: 'Ten-year CAGR of 6.4% through two rate cycles.',
    conditionNote: 'Sound structure; kitchen and bathroom at end of life.',
    tenantAppealNote: 'Three bedrooms and a level yard suit the dominant family profile.',
  },

  summary: {
    /*
     * One string, two binders. The voice one-pagers set this in 72-92pt
     * assessment slots, and the Borrowing Capacity masters set it as the
     * legacy engine's executive summary — so it is written in that engine's
     * own sentences (truncated to fit the voice heights) with figures that
     * reconcile against `capacity` below. A property-flavoured string here
     * read as the wrong document on fifty Snapshot previews; a longer one
     * overflows three voice blocks.
     */
    narrative:
      'Based on the financial information provided, Jordan & Sarah Nguyen have an estimated '
      + 'maximum borrowing capacity of $1,180,000, with a monthly surplus of $1,290 and a '
      + 'debt-to-income ratio of 6.0x. The overall serviceability position is assessed as moderate.',
    strength: [
      '412m² of R2 land, 18% above the suburb average lot size',
      'Compliant secondary-dwelling footprint confirmed at concept level',
      'Vacancy at 1.4% with a 12-day average letting time',
    ],
    watch: [
      'Entry yield of 3.84% needs the shortfall serviced from income',
      'Kitchen and bathroom will need $60–80k inside three years',
    ],
    for: 'Land value, catchment, and a second dwelling the numbers already support.',
    against: 'Thin entry yield and near-term capital works.',

    // ── Portfolio Performance Review ───────────────────────────────────────
    //
    // `analysis.executiveSummary` on a stored `portfolio_analysis_reports` row.
    // `healthScore` is a score **out of 100** (25–90 across the 21 stored
    // reports), not a percentage — the masters set it with `| fixed:0` and
    // label it, and setting it with `| percent` would print "68%" of nothing.
    healthScore: 68,
    overallHealth: 'Moderate',
    // 147-459 characters across the stored reports, so a sentence rather than a
    // headline — which is why the overview sets it as a callout at body size
    // instead of a display-scale verdict.
    primaryRecommendation:
      'Diversify the next acquisition outside the inner west and into a higher-yielding price '
      + 'band, funded from the usable equity rather than new savings. That addresses the two '
      + 'weaknesses at once — geographic concentration and a negative monthly position — '
      + 'without increasing the portfolio LVR.',
    // Three and two: the observed minimums across the 21 stored reports (3-6
    // strengths, 2-5 concerns). A sample shorter than the minimum previews a
    // column the real data always fills, which is how the first render of these
    // masters came to show a bullet with nothing beside it.
    strengths: [
      'Weighted growth of 5.4% is ahead of the metro average',
      'Portfolio LVR of 61% leaves headroom for one further purchase',
      'Two of the four holdings are income-positive without depreciation',
    ],
    concerns: [
      'All four assets sit within 6km — concentrated by geography',
      'Net position is negative and funded from surplus income',
    ],
  },

  risk: {
    horizon: '10+ years', horizonNote: 'Long enough to absorb a full rate cycle.',
    income: 268000, incomeStability: 'Both incomes permanent and ongoing',
    surplus: 3850, reserves: 62000, debt: 41500, dependants: '1',
    experience: 'One prior purchase (owner-occupied)',
    growthOrIncome: 'Growth-weighted',
    negativeCashFlow: 'Accepted to $600/week',
    vacancy: 'Can absorb 8 weeks', valueFall: 'Can absorb a 20% paper fall',
    toleranceNote: 'Balanced — accepts volatility for growth but not forced sale risk.',
    capacityAssessment: 'Adequate',
    capacityNote:
      'Surplus covers the modelled shortfall 9x over, and reserves cover eight months '
      + 'of holding costs with the property vacant.',

    // ── Portfolio Performance Review ───────────────────────────────────────
    //
    // `analysis.riskAssessment`, under the stored leaf names. The shortened
    // names would have collided: `risk.vacancy` above already means "reaction
    // to three months vacancy" — a client tolerance, not a portfolio exposure —
    // and one key cannot carry both senses. See `portfolioProjection.pure.ts`.
    // Three sentences and two LISTS, which is what the live table holds — read
    // across all 21 stored reports, not inferred from the names. The two that
    // pluralise are arrays (2-4 market risks, 4-5 mitigations); the three that
    // read like they would are not. A sample that flattened them to prose would
    // preview cleanly and render blank on every real report, because the
    // projection refuses a non-string leaf rather than printing `[object
    // Object]`.
    overallRiskLevel: 'Moderate',
    // 131-456 characters each across the stored reports — paragraphs, not the
    // one-liners the four `financialHealth` statuses are.
    concentrationRisk:
      'Four assets inside a 6km radius of the inner west, sharing one council area and one '
      + 'tenant catchment. A single-market correction moves the whole portfolio together, no '
      + 'other capital city is represented, and three of the four are exposed to the same '
      + 'rental demand drivers.',
    vacancyRisk:
      'Three of the four are single-dwelling and let individually, so income is stepped rather '
      + 'than smooth: one vacancy removes a quarter of the rent rather than a fraction of it. '
      + 'Suburb vacancy of 1.4% and a 12-day average letting time keep the expected exposure '
      + 'short, but the shape of the risk is binary.',
    interestRateSensitivity:
      'A 100bp rise adds roughly $1,740 a month across the four facilities, which is more than '
      + 'the current shortfall again. Two facilities roll off fixed rates inside a year, and '
      + 'both would reprice at the top of the cycle on current forward curves.',
    marketRisks: [
      'Inner-west median prices have run ahead of rents for six years',
      'The portfolio is positioned for growth and is exposed if the market turns income-led',
      'All four assets share one council area and one tenant catchment',
    ],
    mitigationStrategies: [
      'Fix the majority of the debt before the next roll-off',
      'Hold six months of holding costs in offset rather than in equity',
      'Place the next acquisition in a different capital city',
      'Buy the next holding in a higher-yielding price band',
    ],
  },

  risks: RISKS,
  nextSteps: NEXT_STEPS,
  steps: [
    'Confirm the brief and set the search parameters',
    'Shortlist and inspect against the scorecard',
    'Model the shortlist and rank on risk-adjusted return',
    'Negotiate, exchange, and manage to settlement',
    'Review annually against the original thesis',
  ],
  prep: [
    action('Collect two years of tax returns and payslips', 'Client', 'Week 1'),
    action('Obtain a written pre-approval with a valuation buffer', 'Broker', 'Week 2'),
    action('Sign the engagement and set the search brief', 'Adviser', 'Week 2'),
  ],
  watch: [
    { date: 'Mar', label: 'Rate decision', note: 'Second of three meetings this quarter.' },
    { date: 'Jun', label: 'Land tax', note: 'Assessment issued; listing volume rises.' },
    { date: 'Sep', label: 'Spring market', note: 'Peak listing window opens.' },
    { date: 'Dec', label: 'Townhouse completions', note: '46 dwellings settle nearby.' },
  ],

  drivers: withFields([
    {
      title: 'Transport access', body: 'Light rail to Central in 31 minutes, plus two bus corridors.',
      evidence: 'Transport for NSW patronage data, latest release', watch: 'No planned service reduction.',
    },
    {
      title: 'Supply constraint', body: 'Conservation overlay covers 60% of detached stock.',
      evidence: 'Inner West DCP, heritage schedule', watch: 'Overlay under review in the next LEP cycle.',
    },
    {
      title: 'Employment pipeline', body: 'Bays Precinct staging adds 8,000 roles within 5km.',
      evidence: 'Infrastructure NSW staging report', watch: 'Delivery has slipped twice.',
    },
    {
      title: 'Household formation', body: 'Family households up 4.1% since the last census.',
      evidence: 'ABS Census, latest release', watch: 'Growth concentrated in the 30–44 cohort.',
    },
  ], {
    conclusion: {
      headline: 'Supply constraint is the durable driver',
      body: 'Transport and employment help, but the overlay is what keeps detached stock scarce.',
    },
  }),

  supply: [
    { name: 'Norton Street mixed-use', type: 'Apartments', dwellings: 84, status: 'Under construction', completion: 'Q4 next year' },
    { name: 'Marion Street townhouses', type: 'Townhouses', dwellings: 46, status: 'Approved', completion: 'Q2 following year' },
    { name: 'Balmain Road infill', type: 'Apartments', dwellings: 32, status: 'At DA', completion: 'Not before Q4 +2' },
    { name: 'Catherine Street terraces', type: 'Terraces', dwellings: 9, status: 'Approved', completion: 'Q1 next year' },
  ],

  finance: {
    monthlyRepayment: 5113, annualRepayment: 61360,
    monthlyRates: 182, annualRates: 2184,
    monthlyInsurance: 134, annualInsurance: 1612,
    monthlyMaintenance: 208, annualMaintenance: 2496,
    monthlyStrata: 0, annualStrata: 0,
    monthlyWater: 71, annualWater: 852,
    monthlyCost: 5708, annualCost: 68504,
    capacity: 1340000, maxPurchase: 1385000,
    narrative:
      'Serviceability is assessed at a 3% buffer over the offered rate. At that '
      + 'assessment the household clears the modelled commitment with $1,240 a month spare.',
  },

  grants: { fhog: 10000, dutyConcession: 31090, depositScheme: 'Eligible — 5% deposit, no LMI', total: 41090 },

  tax: {
    marginalRate: 39, preTaxWeekly: -413, benefitWeekly: 145, afterTaxWeekly: -268,
    totalDeductions: 71240, depreciationNote: 'Division 43 at 2.5% plus plant and equipment from a quantity surveyor schedule.',
    deductions: [
      { amount: 61360, note: 'Loan interest at the modelled rate' },
      { amount: 2496, note: 'Repairs and maintenance' },
      { amount: 3224, note: 'Property management fees' },
      { amount: 1612, note: 'Landlord insurance' },
      { amount: 2184, note: 'Council rates' },
      { amount: 364, note: 'Water and sewerage' },
      { amount: 0, note: 'Strata levies — not applicable' },
    ],
    narrative:
      'The deductible position converts a $413 weekly pre-tax shortfall into $268 after tax '
      + 'at the stated marginal rate.',
    conclusion: {
      headline: 'Serviceable after tax, but not a tax strategy',
      body: 'The deduction improves the holding cost; it does not make a weak asset strong.',
    },
  },

  cashflow: Array.from({ length: 10 }, (_, i) => {
    const rent = Math.round(49400 * 1.031 ** i);
    const costs = Math.round(68504 * 1.028 ** i);
    return {
      rent, costs, preTax: rent - costs,
      afterTax: Math.round((rent - costs) * 0.61),
      value: Math.round(1285000 * 1.052 ** (i + 1)),
    };
  }).reduce((acc: Record<string, unknown>, row, i) => {
    acc[String(i)] = row;
    return acc;
  }, {
    // ── The 10 Year Cash Flow format's own vocabulary ──────────────────────
    //
    // `years`, `scenarios`, `outcome`, `firstYear`, `purchase`, `loan`,
    // `costs`, `assumptions` and `property`, straight off the projection. The
    // keys above are the voice templates' indexed rows and `breakEvenNote` /
    // `narrative` / `conclusion`; the two sets are disjoint, which is why this
    // format nests here rather than claiming a namespace of its own.
    ...CASH_FLOW_SAMPLE,
    breakEvenNote: 'Pre-tax cash flow turns positive in year seven on the modelled assumptions.',
    narrative:
      'Rent compounds faster than costs from year four, and the position crosses into '
      + 'positive pre-tax territory in year seven without any rate relief assumed.',
    conclusion: {
      headline: 'Positive by year seven without assuming a rate cut',
      body: 'The crossover is driven by rental growth, which is the assumption to stress-test hardest.',
    },
  }),

  drag: {
    yield: 3.84, growth: 5.2, maintenance: 2496, lvr: 80, net: -21476,
    summary: 'Holding costs are the binding constraint in the first six years.',
    recommendation: {
      headline: 'Hold, and revisit at the year-three review',
      body: 'Selling inside five years surrenders the growth that funds the early shortfall.',
    },
  },

  equity: {
    totalValue: 3410000, totalDebt: 2088000, paper: 1322000, usable: 640000, lvrLimit: 80,
    holdings: [
      { address: '9/44 Regent Street, Newtown', value: 1125000, debt: 612000, lvr: 54.4, usable: 288000 },
      { address: ADDRESS, value: 1285000, debt: 1028000, lvr: 80.0, usable: 0 },
      { address: '7 Wardell Road, Dulwich Hill', value: 640000, debt: 288000, lvr: 45.0, usable: 224000 },
      { address: '12/3 Denison Road, Lewisham', value: 360000, debt: 160000, lvr: 44.4, usable: 128000 },
    ],
    scenarios: [
      { deposit: 128000, capacity: 512000, maxPurchase: 640000 },
      { deposit: 224000, capacity: 896000, maxPurchase: 1120000 },
      { deposit: 288000, capacity: 1152000, maxPurchase: 1440000 },
    ],
    constraintNote: 'Serviceability, not equity, is the binding constraint at the third scenario.',
    recommendation: {
      headline: 'Release to the second scenario only',
      body: 'The third clears on equity but leaves no buffer if rates move another 50bp.',
    },
  },

  portfolio: {
    count: 4, value: 3410000, debt: 2088000, equity: 1322000, lvr: 61.2,
    grossYield: 4.12, growth12m: 5.4, netCashFlow: -14200,
    avgYield: 4.12, avgGrowth: 5.4, avgNet: -3550, avgMaintenance: 2180,

    // ── The Portfolio Performance Review's own vocabulary ──────────────────
    //
    // The 50 Compass masters bind what `portfolioProjection.pure.ts` publishes,
    // which describes this same portfolio in monthly terms and mean-of-property
    // averages. Summed from `PORTFOLIO_HOLDINGS` rather than typed, so the
    // holdings table and the totals table on the facing page cannot disagree.
    propertyCount: PORTFOLIO_HOLDINGS.length,
    investmentCount: PORTFOLIO_HOLDINGS.filter((h) => !h.isOwnerOccupied).length,
    ownerOccupiedCount: PORTFOLIO_HOLDINGS.filter((h) => h.isOwnerOccupied).length,
    averageLvr: PORTFOLIO_TOTALS.averageLvr,
    averageYield: PORTFOLIO_TOTALS.averageYield,
    monthlyCashflow: PORTFOLIO_TOTALS.monthlyCashflow,
    annualCashflow: PORTFOLIO_TOTALS.annualCashflow,
    monthlyRentalIncome: PORTFOLIO_TOTALS.monthlyRentalIncome,
    monthlyExpenses: PORTFOLIO_TOTALS.monthlyExpenses,
    // Whole property rows on the stored report, projected down to what the
    // callout prints. Best and worst by monthly position, which is the axis the
    // format's own generator ranks on.
    bestPerformer: {
      address: '7 Wardell Road, Dulwich Hill', propertyType: 'House',
      value: 640000, netMonthlyCashflow: 3400 / 12, lender: 'CommBank',
    },
    worstPerformer: {
      address: ADDRESS, propertyType: 'House',
      value: 1285000, netMonthlyCashflow: -21476 / 12, lender: 'Meridian Mutual',
    },
    holdings: [
      { address: '9/44 Regent Street, Newtown', value: 1125000, debt: 612000, equity: 513000, yield: 3.9, net: 2100 },
      { address: ADDRESS, value: 1285000, debt: 1028000, equity: 257000, yield: 3.84, net: -21476 },
      { address: '7 Wardell Road, Dulwich Hill', value: 640000, debt: 288000, equity: 352000, yield: 4.6, net: 3400 },
      { address: '12/3 Denison Road, Lewisham', value: 360000, debt: 160000, equity: 200000, yield: 4.9, net: 1776 },
      { address: 'Portfolio total', value: 3410000, debt: 2088000, equity: 1322000, yield: 4.12, net: -14200 },
    ],
    scores: {
      growthNote: 'Weighted growth of 5.4% is ahead of the metro average.',
      cashFlowNote: 'Net position is negative but improving year on year.',
      gearingNote: 'Portfolio LVR of 61% leaves headroom for one more acquisition.',
      diversificationNote: 'All four assets sit within 6km — concentrated by geography.',
    },
    strength: ['Weighted growth ahead of the metro average', 'LVR leaves room for one further purchase'],
    watch: ['All four assets within 6km of each other', 'Net cash flow still negative overall'],
    actions: [
      action('Refinance the Newtown facility off its expiring fixed rate', 'Broker', 'Within 60 days'),
      action('Obtain a depreciation schedule for the Leichhardt purchase', 'Adviser', 'Post-settlement'),
      action('Review the Lewisham holding against its original thesis', 'Client', 'Year-end'),
      action('Diversify the next acquisition outside the inner west', 'Adviser', 'Next cycle'),
    ],
    narrative:
      'The portfolio is performing on growth and under-performing on income, which is the '
      + 'expected shape for four inner-ring assets bought inside six years.',
    recommendation: {
      headline: 'Diversify the next purchase by geography',
      body: 'Concentration is now the largest uncompensated risk in the portfolio.',
    },

    // ── The legacy document's sections, as the projection publishes them ───
    //
    // Everything below mirrors what `projectPortfolioDocument` composes from a
    // stored report and its review, so the cascade pages preview with real
    // shapes. The overview is `describePortfolio`'s own sentence built from
    // the totals above; the figures reconcile line by line.
    overview:
      '4 properties worth $3,410,000, carrying $2,088,000 of debt against $1,322,000 of '
      + 'equity, and costs $1,183 a month to hold. Overall health is assessed as moderate.',
    composition: {
      paragraphs: [
        'Two apartments and two houses, weighted to houses by value — a mix that favours land '
        + 'over yield, which is consistent with the growth-led strategy on file.',
        'Four-fifths of the value sits inside one inner-west postcode ring, so the portfolio '
        + 'moves with a single market rather than averaging several.',
      ],
      groups: [{
        label: 'What we recommend',
        items: [
          'Diversify the next purchase by geography',
          'Hold the current house-to-apartment mix otherwise',
        ],
      }],
    },
    market: {
      paragraphs: [
        'The inner-west market is mid-cycle: prices have recovered their 2024 drawdown, '
        + 'stock remains a fifth below the ten-year average, and days on market are falling.',
        'This portfolio entered before the recovery, so its holdings carry the growth rather '
        + 'than chasing it — the positioning question is concentration, not timing.',
      ],
      facts: [
        {
          label: 'Lending environment',
          value: 'Serviceability buffers remain at 3%, and investor credit growth is running '
            + 'ahead of owner-occupier for the first time since 2022.',
        },
        {
          label: 'RBA outlook',
          value: 'Market pricing implies one further cut this cycle; the projection assumes '
            + 'rates flat from here, which is the conservative reading.',
        },
      ],
    },
    growth: {
      groups: [
        { label: 'The next purchase', items: [
          'A yield-led acquisition outside the inner west would lift income and cut concentration in one move.',
          'Borrowing capacity supports one further purchase at the current LVR.',
        ] },
        { label: 'Releasing equity', items: [
          'The Dulwich Hill holding could release around $160,000 at an 80% LVR.',
        ] },
        { label: 'Refinancing', items: [
          'The Newtown facility rolls off its fixed rate in November and should go to market.',
        ] },
        { label: 'Optimising what you hold', items: [
          'A depreciation schedule for the Leichhardt purchase is outstanding.',
          'Rent on the Lewisham unit sits eight per cent under market.',
        ] },
      ],
    },
    verdicts: {
      rowCount: 4,
      rows: [
        {
          address: '7 Wardell Road, Dulwich Hill', rating: 'Strong', scoreLabel: '84',
          reviewClassification: 'Star',
          recommendation: 'Hold. Release equity here first if the next purchase proceeds — the '
            + 'lowest LVR in the portfolio and the strongest cash position.',
        },
        {
          address: '12/3 Denison Road, Lewisham', rating: 'Good', scoreLabel: '76',
          reviewClassification: 'Good',
          recommendation: 'Hold and lift the rent to market at the next review.',
        },
        {
          address: '9/44 Regent Street, Newtown', rating: 'Good', scoreLabel: '71',
          reviewClassification: 'Good',
          recommendation: 'Refinance off the expiring fixed rate before November.',
        },
        {
          address: '14 Marlborough Street, Leichhardt', rating: 'Underperforming', scoreLabel: '58',
          reviewClassification: 'Underperformer',
          recommendation: 'Review against the original thesis at year end; the shortfall is '
            + 'funded from salary and the growth case has two years to show.',
        },
      ],
    },
    projection: {
      yearsLabel: '10 years',
      valueLabel: '$5,560,000',
      equityLabel: '$3,470,000',
      cashflowLabel: '$2,150/mo',
      summary: 'If growth holds at the assumed rates, the debt stays static while the value '
        + 'compounds — the portfolio turns cash-positive in year six as rents catch up.',
      assumptions: [
        '5.2% capital growth, weighted to the house holdings',
        '3.1% rental growth across the portfolio',
        'Interest rates flat from here',
        'No further purchases or sales in the window',
        'Vacancy at the current 2% through the period',
      ],
    },
    capacity: {
      estimatedLabel: '$2,900,000',
      deployedLabel: '$2,088,000',
      availableLabel: '$812,000',
      utilisationLabel: '72.0%',
      commentary: 'Roughly a quarter of assessed capacity remains available — enough for one '
        + 'further acquisition at the current deposit profile without touching existing equity.',
    },
    scenarios: {
      rows: [
        { name: '+1% Interest Rate', description: 'Impact of a 1% rate rise on the portfolio',
          changeLabel: '-$1,189/mo', resultLabel: '-$2,372/mo' },
        { name: 'Vacancy — 3 months', description: 'One holding vacant for a quarter',
          changeLabel: '-$975/mo', resultLabel: '-$2,158/mo' },
        { name: 'Rent to market', description: 'Lewisham and Newtown rents lifted to market',
          changeLabel: '+$310/mo', resultLabel: '-$873/mo' },
        { name: 'Sell the drag', description: 'Leichhardt sold and debt retired',
          changeLabel: '+$1,790/mo', resultLabel: '$607/mo' },
      ],
    },
    review: {
      statusLabel: 'Completed',
      reviewedOn: '2026-08-02T00:00:00.000Z',
      nextReviewDue: '2027-08-02T00:00:00.000Z',
      riskLevel: 'Medium',
      summary: 'Portfolio review completed with an overall score of 62/100 — sound growth '
        + 'position, cash flow the binding constraint.',
      scores: [
        { label: 'Overall', scoreLabel: '62' },
        { label: 'Portfolio health', scoreLabel: '68' },
        { label: 'Cash flow', scoreLabel: '41' },
        { label: 'Growth potential', scoreLabel: '79' },
        { label: 'Data completeness', scoreLabel: '92' },
      ],
      findings: [
        'Portfolio consists of 4 properties worth $3,410,000',
        'Current LVR: 61.2%',
        'Net cash position: -$1,183 a month',
        'Concentration: all holdings inside 6km',
        'One fixed rate expiring inside 90 days',
      ],
    },
  },

  ranking: [
    { address: '7 Wardell Road, Dulwich Hill', growth: 7.1, net: 3400, equity: 352000, contribution: 31 },
    { address: '12/3 Denison Road, Lewisham', growth: 6.2, net: 1776, equity: 200000, contribution: 24 },
    { address: '9/44 Regent Street, Newtown', growth: 5.1, net: 2100, equity: 513000, contribution: 28 },
    { address: ADDRESS, growth: 4.4, net: -21476, equity: 257000, contribution: 12 },
    { address: 'Portfolio weighted average', growth: 5.4, net: -3550, equity: 330500, contribution: 100 },
  ],

  comparison: {
    // ── Property Comparison Analysis ──────────────────────────────────────
    //
    // Everything the 50 Comparison masters bind, nested here rather than at the
    // top level: `risks`, `recommendations` and `properties` already mean three
    // other things to the voice and Portfolio templates, and in this one shared
    // preview object whichever loaded last would win. See
    // `comparisonProjection.pure.ts`.
    //
    // The shapes and magnitudes are the stored table's. A comparison compares
    // 2-5 properties (this one, 3), scores them out of 10 or out of 100 — never
    // a bare figure — and names nobody on about one axis in six.
    title: 'COMPARISON ANALYSIS - 3 PROPERTIES, NSW',
    analysedOn: '2 August 2026',
    propertyCount: 3,
    statesLine: 'NSW',
    states: ['NSW'],
    scaleOutOf: 100,
    scaleConfident: true,
    shape: 'columns',
    // Built by the format, never by the model — see `describeComparison`.
    narrative: '3 properties compared in NSW. 22 Chapel Street, Marrickville ranks first. '
      + 'It scores 88.5 out of 100.',
    summary:
      'Three inner-west properties were compared against a five-to-seven year horizon and a '
      + 'moderate risk tolerance. Marrickville ranks first on the strength of its growth record '
      + 'and the smallest gap between asking price and the suburb median, and it is the only one '
      + 'of the three whose rental demand is supported by two separate employment catchments. '
      + 'Leichhardt is the land play: the largest lot, the clearest secondary-dwelling path, and '
      + 'the thinnest entry yield of the three, which is a position that needs income to service '
      + 'it for the first four years. Dulwich Hill is the cheapest entry and the weakest growth '
      + 'thesis; it would suit a buyer who needs the holding to pay for itself from settlement '
      + 'rather than one building a ten-year position. No property in this comparison is clearly '
      + 'under the market, so none of the three offers a discount to compensate for its own '
      + 'weakness.',
    properties: [
      { number: 1, address: ADDRESS, shortAddress: '14 Marlborough Street', state: 'NSW' },
      { number: 2, address: '22 Chapel Street, Marrickville NSW 2204', shortAddress: '22 Chapel Street', state: 'NSW' },
      { number: 3, address: '7 Wardell Road, Dulwich Hill NSW 2203', shortAddress: '7 Wardell Road', state: 'NSW' },
    ],
    ranked: [
      {
        number: 2, address: '22 Chapel Street, Marrickville NSW 2204', shortAddress: '22 Chapel Street',
        rank: 1, score: 88.5, outOf: 100, scaleConfident: true,
        bestSuitedFor: 'A growth-weighted buyer with a seven-year horizon and income to service a small shortfall.',
        strengths: [
          'Growth of 7.2% a year over the last five years, ahead of both comparisons',
          'Two employment catchments support rental demand independently',
          'Renovated in 2021, so no capital works are due inside three years',
        ],
        concerns: [
          'Smallest land component of the three at 328m²',
          'Entry price is closest to the suburb median, so the discount is thin',
          'Body corporate sinking fund is below the recommended balance',
        ],
        riskLevel: 'Moderate', riskBand: 'moderate',
      },
      {
        number: 1, address: ADDRESS, shortAddress: '14 Marlborough Street',
        rank: 2, score: 74, outOf: 100, scaleConfident: true,
        bestSuitedFor: 'A land-led buyer prepared to hold through four years of shortfall for a second income stream.',
        strengths: [
          '412m² of R2 land, 18% above the suburb average lot size',
          'Compliant secondary-dwelling footprint confirmed at concept level',
          'Vacancy at 1.4% with a 12-day average letting time',
        ],
        concerns: [
          'Entry yield of 3.84% needs the shortfall serviced from income',
          'Kitchen and bathroom will need $60–80k inside three years',
          'Heritage conservation area limits external change without consent',
        ],
        riskLevel: 'Moderate', riskBand: 'moderate',
      },
      {
        number: 3, address: '7 Wardell Road, Dulwich Hill NSW 2203', shortAddress: '7 Wardell Road',
        rank: 3, score: 61.5, outOf: 100, scaleConfident: true,
        bestSuitedFor: 'An income-first buyer who needs the holding to pay for itself from settlement.',
        strengths: [
          'Cheapest entry of the three at $640,000',
          'Only one of the three that is cash-flow positive from year one',
        ],
        concerns: [
          'Weakest growth thesis of the three',
          'Single access road into the pocket',
          'Smallest catchment of the three suburbs compared',
        ],
        riskLevel: 'Low', riskBand: 'low',
      },
    ],
    axes: {
      money: {
        title: 'Money',
        winners: [
          { key: 'bestROI', label: 'Best return on investment', winner: '22 Chapel Street', value: '6.4%', reason: 'Highest modelled return on the entry price once the 2021 renovation is taken into account, and the only one of the three that does not need capital works inside three years to hold its rent.' },
          { key: 'bestYield', label: 'Best gross yield', winner: '7 Wardell Road', value: '4.60%', reason: 'The cheapest entry of the three against a rent that is within $30 a week of the most expensive, which is what puts it ahead on yield despite ranking last overall.' },
          { key: 'bestCashFlow', label: 'Best cash flow', winner: '7 Wardell Road', value: '$283/mo', reason: 'The only property of the three that is positive from year one without assuming rental growth or a rate cut.' },
          // 43 of the 253 stored pointers name nobody. It is an answer.
          { key: 'bestValue', label: 'Best value against the market', winner: 'No clear winner', value: '', reason: 'No property in this comparison sits far enough below its suburb median to be called under the market. The closest is Dulwich Hill at 4% below, which is inside the ordinary spread for the stock type.' },
        ],
      },
      place: {
        title: 'Location and lifestyle',
        winners: [
          { key: 'bestSchools', label: 'Best school catchment', winner: '14 Marlborough Street', value: '', reason: 'Two state schools inside the catchment, one of them selective, and both within a fifteen-minute walk.' },
          { key: 'bestGrowthCorridor', label: 'Best growth corridor', winner: '22 Chapel Street', value: '', reason: 'Sits inside the declared corridor with a funded transport upgrade, which is the difference between a growth thesis and a hope.' },
          { key: 'bestInfrastructure', label: 'Best infrastructure', winner: '22 Chapel Street', value: '', reason: 'Metro upgrade committed and funded, with construction already under way at the nearest station.' },
          { key: 'bestLifestyle', label: 'Best lifestyle', winner: 'No clear winner', value: '', reason: 'All three sit within 6km of the CBD on comparable amenity, and the analysis could not separate them on anything a buyer would notice.' },
        ],
      },
      risk: {
        title: 'Risk',
        winners: [
          { key: 'lowestRisk', label: 'Lowest risk', winner: '7 Wardell Road', value: '', reason: 'Established street, long tenancy history, and the only one of the three whose income covers its own holding costs from settlement.' },
          { key: 'highestRisk', label: 'Highest risk', winner: '14 Marlborough Street', value: '', reason: 'The thinnest entry yield of the three against the largest near-term capital works bill, so the position depends on income outside the property for its first four years.' },
          { key: 'bestRiskReward', label: 'Best risk-adjusted return', winner: '22 Chapel Street', value: '', reason: 'Growth exposure without the capital-works overhang, and the only one of the three where the rental demand does not depend on a single employment catchment.' },
        ],
      },
    },
    risks: [
      { number: 1, shortAddress: '14 Marlborough Street', level: 'Moderate', band: 'moderate', specificRisks: ['Kitchen and bathroom due inside three years', 'Heritage conservation area limits external change'] },
      { number: 2, shortAddress: '22 Chapel Street', level: 'Moderate', band: 'moderate', specificRisks: ['Body corporate sinking fund below the recommended balance', 'Smallest land component of the three'] },
      { number: 3, shortAddress: '7 Wardell Road', level: 'Low', band: 'low', specificRisks: ['Single access road into the pocket', 'Weakest growth thesis of the three'] },
    ],
    redFlags: [
      { winner: '14 Marlborough Street', severity: 'Moderate', band: 'moderate', concerns: ['Capital works are not funded from the current rent'] },
      { winner: '22 Chapel Street', severity: 'Low', band: 'low', concerns: ['Sinking fund would need a special levy to reach the recommended balance'] },
    ],
    matches: [
      { winner: '22 Chapel Street', investorTypes: ['Growth', 'Long hold'], investorTypesLine: 'Growth · Long hold', reasoning: 'Suits a buyer with a seven-year horizon and enough surplus income to carry a small shortfall for the first two years. The growth record and the funded transport upgrade are what this property is bought for; the yield is not.' },
      { winner: '14 Marlborough Street', investorTypes: ['Development', 'Land banking'], investorTypesLine: 'Development · Land banking', reasoning: 'Suits a buyer who wants the land and the second dwelling rather than the current improvements, and who can service the shortfall while the secondary dwelling is approved and built.' },
      { winner: '7 Wardell Road', investorTypes: ['Income'], investorTypesLine: 'Income', reasoning: 'Suits a buyer who needs the holding to pay for itself from settlement and is not relying on it for capital growth.' },
    ],
    recommendations: {
      bestOverall: {
        winner: '22 Chapel Street, Marrickville NSW 2204',
        reason: 'It wins on four of the eleven axes and loses none of them badly. The growth record is the strongest of the three and is supported by a funded transport upgrade rather than by a forecast, the 2021 renovation removes the near-term capital works that weigh on the Leichhardt holding, and the rental demand does not depend on a single employment catchment. The thin land component is the trade, and it is the right one at this horizon.',
      },
      runners: [
        { winner: '14 Marlborough Street, Leichhardt NSW 2040', reason: 'The land play, and the better property on a fifteen-year view. It is second here because the first four years need income from outside the property to service the shortfall and fund the capital works, which is a position not every buyer can hold.' },
      ],
      avoid: [
        { winner: '7 Wardell Road, Dulwich Hill NSW 2203', reason: 'Not a bad property, but the wrong one against this brief: it is bought for income and the brief is growth-weighted over five to seven years. The single access road and the smallest catchment of the three are what keep its growth thesis behind the other two.' },
      ],
      alternativeScenarios: [
        {
          scenario: 'If the horizon shortened to three years',
          reason: 'Dulwich Hill becomes the pick. Over three years the growth advantage at Marrickville does not have time to compound past the transaction costs, and the only one of the three that funds its own holding costs from settlement is the one that survives a short hold intact.',
          winner: '7 Wardell Road',
        },
      ],
    },
    basis: {
      timeHorizon: '5-7 years',
      riskTolerance: 'moderate',
      depth: 'comprehensive',
      investorProfile: 'growth',
      model: 'sonar-pro',
    },

    // ── Market timing and competitive advantages ────────────────────────────
    //
    // In production these two ride only the salvaged rows — the writer that
    // destructures a successful response has no column for them — so an intact
    // record carrying them is a state the table cannot hold. The sample carries
    // them anyway, because a preview's job is to show what the pages draw, and
    // the truncation vocabulary (`truncated`, `truncationNote`) stays absent so
    // the verdict previews the recommendation treatment, not the fallback.
    timing: {
      buyFirstWinner: '22 Chapel Street, Marrickville NSW 2204',
      buyFirstReason: 'Marrickville should be acted on first: its growth phase is already '
        + 'under way, stock is tightening, and the entry price still sits under the suburb '
        + 'median. The other two hold their value cases without the same urgency.',
      holds: [
        { winner: '22 Chapel Street', period: '7-10 years',
          reason: 'The growth case needs a full cycle; selling inside five years gives the '
          + 'transaction costs the compounding instead of the owner.' },
        { winner: ADDRESS.split(',')[0], period: '10+ years',
          reason: 'Land-led theses mature slowly. The second-dwelling path is what pays, and '
          + 'it needs planning, construction and a letting history inside the hold.' },
        { winner: '7 Wardell Road', period: '5+ years, re-assess at five',
          reason: 'Held for income, reviewed against the portfolio rather than the market — '
          + 'if the yield advantage narrows, the capital is better rotated.' },
      ],
    },
    advantages: [
      { winner: '22 Chapel Street, Marrickville NSW 2204',
        items: ['Renovated 2021 — no capital works inside the hold', 'Strongest 12-month growth of the three (7.2%)', 'Under the suburb median at entry'],
        line: 'Renovated 2021 — no capital works inside the hold · Strongest 12-month growth of the three (7.2%) · Under the suburb median at entry' },
      { winner: ADDRESS,
        items: ['412 m² of R2 land, 18% above the suburb average', 'Compliant secondary-dwelling footprint at concept level'],
        line: '412 m² of R2 land, 18% above the suburb average · Compliant secondary-dwelling footprint at concept level' },
      { winner: '7 Wardell Road, Dulwich Hill NSW 2203',
        items: ['The only one of the three cash-positive from settlement', 'Lowest entry price and lowest holding risk'],
        line: 'The only one of the three cash-positive from settlement · Lowest entry price and lowest holding risk' },
    ],

    a: {
      address: ADDRESS, price: 1285000, rent: 950, yield: 3.84, net: -413, land: '412 m²',
      built: '1928', config: '3 bed · 2 bath · 1 car', condition: 'Original', growth: 6.1,
      median: 1985000, vacancy: 1.4,
      summary: 'Land-led, thin yield, clear second-dwelling path.',
      scoreNote: 'Wins on land and catchment; loses on entry yield.',
    },
    b: {
      address: '22 Chapel Street, Marrickville NSW 2204', price: 1180000, rent: 890, yield: 3.92,
      net: -352, land: '328 m²', built: '1946', config: '3 bed · 1 bath · 1 car',
      condition: 'Renovated 2021', growth: 7.2, median: 1595000, vacancy: 1.6,
      summary: 'Cheaper entry, better growth, less land.',
      scoreNote: 'Best growth of the three but the smallest development envelope.',
    },
    c: {
      address: '5 Wentworth Road, Burwood NSW 2134', price: 1420000, rent: 1050, yield: 3.84,
      net: -468, land: '556 m²', built: '1962', config: '4 bed · 2 bath · 2 car',
      condition: 'Part-renovated', growth: 4.9, median: 2050000, vacancy: 2.1,
      scoreNote: 'Most land, weakest growth and the highest holding cost.',
    },
    alternative: 'Marrickville is the closer call; Burwood is ruled out on growth.',
    recommendation: {
      headline: 'Leichhardt on land, Marrickville on growth — take Leichhardt',
      body:
        'Marrickville has the better recent growth number, but Leichhardt has 84m² more land '
        + 'and a development envelope that converts into a second income stream. Over a ten-year '
        + 'horizon the optionality is worth more than 1.1 points of trailing growth.',
    },
  },

  options: {
    a: { capital: 0, costs: 21476, cashFlow: -413, tax: 145, value10: 2128000, equity10: 1100000, reversibility: 'Full' },
    b: { capital: 185000, costs: 34200, cashFlow: 180, tax: 210, value10: 2410000, equity10: 1197000, reversibility: 'Partial' },
    c: { capital: 0, costs: 0, cashFlow: 0, tax: 0, value10: 1285000, equity10: 1285000, reversibility: 'None' },
    risks: RISKS,
    recommendation: {
      headline: 'Hold and add the secondary dwelling in year three',
      body: 'Option B carries the best ten-year equity outcome once the build is funded from released equity rather than cash.',
    },
  },

  reno: {
    budget: 185000, acquisitionCosts: 1346082, holdingCost: 21600, holdingWeeks: 24,
    totalInvested: 1552682, endValue: 1740000, margin: 187318, marginPercent: 12.1,
    items: [
      { scope: 'Kitchen replacement', cost: 42000, basis: 'Builder quote, fixed price' },
      { scope: 'Two bathrooms', cost: 48000, basis: 'Builder quote, fixed price' },
      { scope: 'Flooring and paint throughout', cost: 31000, basis: 'Rate per m²' },
      { scope: 'Electrical and lighting', cost: 18500, basis: 'Provisional sum' },
      { scope: 'Landscaping and fencing', cost: 22000, basis: 'Quote' },
      { scope: 'Contingency at 13%', cost: 23500, basis: 'Percentage of works' },
    ],
    risks: RISKS,
    marginNote: 'Margin is stated before selling costs and assumes no change to the end-value comparables.',
    narrative:
      'The works lift the property from the bottom quartile of the street to the median '
      + 'without touching the heritage-controlled façade.',
  },

  development: {
    siteArea: '412 m²', zoning: 'R2 Low Density Residential', fsr: '0.5:1', heightLimit: '8.5 m',
    setbacks: '6m front, 900mm side, 3m rear', parking: '1 space per dwelling',
    affordable: 'Not applicable below 10 dwellings', dwellings: 2, gfa: '206 m²',
    grossRevenue: 2180000, sellingCosts: 54500, netRevenue: 2125500,
    totalCost: 1806000, residual: 319500, developerMargin: 319500, marginPercent: 17.7,
    products: [
      { type: 'Retained dwelling (renovated)', count: 1, price: 1340000, revenue: 1340000 },
      { type: 'New secondary dwelling', count: 1, price: 840000, revenue: 840000 },
      { type: 'Car space (strata)', count: 0, price: 0, revenue: 0 },
    ],
    costs: [
      { note: 'Land acquisition', rate: 'Contract', amount: 1285000 },
      { note: 'Construction', rate: '$3,100/m²', amount: 338000 },
      { note: 'Professional fees', rate: '8% of build', amount: 27000 },
      { note: 'Authority contributions', rate: 'Section 7.11', amount: 42000 },
      { note: 'Finance costs', rate: '7.2% over 14 months', amount: 74000 },
      { note: 'Contingency', rate: '5% of cost', amount: 40000 },
    ],
    programme: [
      { date: 'Months 1–4', note: 'DA lodgement and determination' },
      { date: 'Months 5–6', note: 'Construction certificate and tender' },
      { date: 'Months 7–16', note: 'Construction' },
      { date: 'Months 17–18', note: 'Occupation certificate and settlement' },
    ],
    risks: RISKS,
  },

  commercial: {
    passingYield: 5.8, capRate: 6.1, occupancy: 92, wale: 3.4,
    netIncome: 268000, marketIncome: 291000, fullyLeasedIncome: 302000, totalOutgoings: 84000,
    valuePassing: 4620000, valueMarket: 4770000, valueFullyLeased: 4950000,
    tenants: [
      { name: 'Harrow & Fitch Legal', area: '310 m²', rent: 108500, expiry: 'Mar +3', review: 'CPI + 1%' },
      { name: 'Lumen Physiotherapy', area: '186 m²', rent: 62000, expiry: 'Sep +2', review: 'Fixed 3.5%' },
      { name: 'Corso Coffee Roasters', area: '95 m²', rent: 47500, expiry: 'Jan +5', review: 'Fixed 4%' },
      { name: 'Vacant — Suite 4', area: '124 m²', rent: 0, expiry: '—', review: '—' },
    ],
    outgoings: [
      { amount: 31000, recoverable: 'Recoverable', net: 0 },
      { amount: 24000, recoverable: 'Recoverable', net: 0 },
      { amount: 12000, recoverable: 'Recoverable', net: 0 },
      { amount: 11000, recoverable: 'Not recoverable', net: 11000 },
      { amount: 6000, recoverable: 'Not recoverable', net: 6000 },
    ],
    concentrationNote: 'The largest tenant contributes 49% of income and expires inside the WALE.',
    recommendation: {
      headline: 'Price on passing income, underwrite the vacancy',
      body: 'The fully-leased number is achievable but should not be paid for at acquisition.',
    },
  },

  smsf: {
    name: 'Nguyen Family Superannuation Fund', trustee: 'Nguyen Custodial Pty Ltd',
    members: 'Jordan Nguyen, Sarah Nguyen', balance: 612000, available: 448000,
    lrba: 'Yes — bare trust established', lvr: 62, rate: 6.85, interest: 54800,
    rentalIncome: 49400, outgoings: 9516, adminCost: 3400, netToFund: -18316,
    contributionsRequired: 21000, liquidityAfter: 164000,
    strategyAllows: 'Yes — direct property permitted under the current investment strategy',
    boundaries: 'No related-party lease; no improvements funded by borrowings',
    structure: [
      'Fund acquires via a bare trust with a corporate custodian',
      'Single acquirable asset — no subdivision while the LRBA is on foot',
      'Repairs permitted; improvements must be funded from fund cash',
      'Lease must be at arm\'s length and on commercial terms',
    ],
    risks: RISKS,
  },

  brief: {
    objective: 'Build a growth-weighted portfolio funding a work-optional position by age 55',
    purpose: 'Investment — long-term hold', budget: 1290000, maxPrice: 1340000, maxStretch: 1385000,
    propertyType: 'Freestanding house or semi', configuration: '3+ bed, 1+ bath, off-street parking',
    minLand: '380 m²', locations: 'Leichhardt, Annandale, Lilyfield, Petersham, Marrickville',
    horizon: '10+ years', timeframe: 'Exchange within 90 days', targetYield: 3.5, targetReturn: 8.5,
    riskTolerance: 'Balanced — growth-weighted', authority: 'Adviser to negotiate; client to exchange',
    reporting: 'Weekly shortlist, full report before any offer',
    compromises: 'Will trade condition for land; will not trade catchment',
    dealBreakers: [
      'Main-road frontage',
      'Strata title',
      'Flood-affected land',
      'No off-street parking',
    ],
  },

  engagement: {
    scope: [
      'Define the brief and confirm borrowing capacity',
      'Search, shortlist and inspect against agreed criteria',
      'Provide a written report before any offer',
      'Negotiate and manage the process to exchange',
      'Coordinate inspections and settlement milestones',
    ],
    reporting: 'Weekly written update, plus a full report before any offer',
    responseTime: 'Within one business day',
  },

  fees: withFields([
    { basis: 'Engagement fee', amount: 4400, when: 'On signing' },
    { basis: 'Success fee — 1.65% of purchase price', amount: 21203, when: 'On exchange' },
    { basis: 'Renovation project management', amount: 0, when: 'Only if separately engaged' },
  ], {
    exclusions:
      'Fees exclude stamp duty, legal and conveyancing costs, building and pest inspections, '
      + 'strata reports, and any lender or broker charges. These are payable directly to the '
      + 'provider and are not collected by us.',
  }),

  onboarding: {
    needs: [
      { action: 'Provide identification for AML verification', timing: 'Before engagement' },
      { action: 'Provide income and liability evidence', timing: 'Week 1' },
      { action: 'Confirm the brief in writing', timing: 'Week 2' },
    ],
  },

  opportunity: {
    reason: 'Deceased estate — executors seeking a pre-market settlement',
    vendorPosition: 'Motivated; prefers certainty over price',
    deadline: 'Expressions of interest close Friday 5pm',
    settlement: '42 days, or longer by negotiation',
    rationale: 'Priced against unrenovated comparables while the land supports two dwellings.',
    recommendation: 'Offer $1,265,000 with a 10% deposit and a short cooling-off waiver.',
    narrative:
      'This has not been listed publicly. The executors want a clean exchange before the '
      + 'end of the quarter, which is where the discount sits.',
    strength: ['Priced below the last three comparable land sales', 'No competing buyers currently engaged'],
    unknown: ['Building and pest not yet completed', 'No survey on file', 'Rental appraisal is verbal only'],
  },

  dd: {
    period: '10 business days from exchange',
    method: {
      inspection: 'Two physical inspections, including one with the building consultant',
      reports: 'Building, pest, and a structural engineer opinion on the rear wall',
      searches: 'Title, planning certificate, sewer diagram, land tax clearance',
      documents: 'Contract, vendor disclosure, prior DA approvals, rates notices',
    },
    findings: [
      { matter: 'Title', finding: 'Torrens title, no easements affecting the buildable area', status: 'Clear' },
      { matter: 'Planning', finding: 'R2 zoning confirmed; conservation area applies to the façade', status: 'Clear' },
      { matter: 'Structure', finding: 'Rear wall shows historic movement; engineer reports it stable', status: 'Noted' },
      { matter: 'Pest', finding: 'Evidence of previous termite activity, treated 2019', status: 'Noted' },
      { matter: 'Services', finding: 'Sewer line crosses the rear yard, offset from the build envelope', status: 'Action' },
      { matter: 'Tenancy', finding: 'Vacant possession confirmed; no residential tenancy agreement on foot', status: 'Clear' },
    ],
    risks: RISKS,
    checklist: [...NEXT_STEPS, action('Confirm the sewer offset with a service locator', 'Adviser', 'Before settlement')],
    conclusion: {
      headline: 'No matter identified that changes the recommendation',
      body: 'Two items require action before settlement; neither affects value materially.',
    },
  },

  inspection: {
    date: '18th, 11:00am', weather: 'Fine, 22°C', present: 'Adviser, client, building consultant',
    areas: [
      { condition: 'Good', defects: 'None observed', cost: 0 },
      { condition: 'Fair', defects: 'Bench and cabinetry at end of life', cost: 42000 },
      { condition: 'Poor', defects: 'Waterproofing failed at shower base', cost: 24000 },
      { condition: 'Fair', defects: 'Original wiring in two rooms', cost: 18500 },
      { condition: 'Good', defects: 'Roof replaced 2019, gutters sound', cost: 0 },
      { condition: 'Fair', defects: 'Rear fence leaning, needs replacement', cost: 6500 },
    ],
    scores: {
      locationNote: 'Quiet street, 400m to light rail',
      conditionNote: 'Sound structure, dated services',
      layoutNote: 'Original layout works; kitchen is isolated from living',
      appealNote: 'Presents poorly, which is where the buying opportunity is',
    },
    recommendation: {
      headline: 'Proceed, with $91,000 allowed for immediate works',
      body: 'Nothing found is structural. The defect list is cosmetic and services-related.',
    },
  },

  rental: {
    householdType: 'Family households, 62% of the suburb',
    tenantAge: '30–44 is the largest cohort',
    rentingShare: 38, tenancyLength: '2.4 years average',
    house: { 1: 620, 2: 780, 3: 950, 4: 1180 },
    unit: { 1: 480, 2: 640, 3: 820, 4: 980 },
    town: { 1: 540, 2: 700, 3: 880, 4: 1050 },
    actions: [
      action('List two weeks before settlement to avoid a vacancy gap', 'Adviser', 'Pre-settlement'),
      action('Present unfurnished; the cohort brings its own', 'Agent', 'At listing'),
      action('Set the asking rent at $950, not $980', 'Agent', 'At listing'),
    ],
    recommendation: {
      headline: 'Ask $950 and let in under two weeks',
      body: 'Pushing to $980 adds an estimated 11 days of vacancy, which costs more than it gains.',
    },
  },

  kyc: {
    customerType: 'Individual — joint applicants', verifier: 'A. Whitfield (Adviser)',
    primary: { type: 'Australian passport', ref: 'PA••••417', sighted: 'Original sighted', verified: 'Verified' },
    secondary: { type: 'NSW driver licence', ref: 'DL••••882', sighted: 'Original sighted', verified: 'Verified' },
    address: { type: 'Utility account', ref: 'UT••••310', sighted: 'Certified copy', verified: 'Verified' },
    pep: 'No match', beneficialOwners: 'Not applicable — individual applicants',
    ownershipEvidence: 'Not applicable',
    sourceOfFunds: 'Employment income and sale proceeds of a prior residence',
    fundsEvidence: 'Six months of bank statements and a settlement statement sighted',
    fundsConsistent: 'Consistent with the stated occupation and income',
    screening: [
      { provider: 'Sanctions and PEP screen', date: 'On engagement', result: 'No match' },
      { provider: 'Adverse media screen', date: 'On engagement', result: 'No match' },
      { provider: 'Politically exposed person re-screen', date: 'Annual review', result: 'No match' },
    ],
    risk: {
      customerNote: 'Low — domestic individuals, verified in person',
      geoNote: 'Low — all parties and funds domestic',
      productNote: 'Low — advisory only, no custody of client funds',
      overallNote: 'Low — standard customer due diligence applied',
    },
  },

  advice: {
    date: 'On engagement', adviser: 'Alexandra Whitfield', reference: 'ADV-2040-118',
    basis: 'Personal advice based on the stated objectives and circumstances',
    objectives:
      'Build a growth-weighted property portfolio capable of funding a work-optional '
      + 'position by age 55, without compromising the household\'s current lifestyle.',
    financialSituation:
      'Combined income of $268,000, one owner-occupied property with $513,000 of equity, '
      + '$41,500 of consumer debt, and $340,000 available for deposit and costs.',
    needs:
      'A single acquisition inside the 8km ring, held long term, with a shortfall no '
      + 'greater than $600 per week.',
    riskProfile: 'Balanced — growth-weighted, accepts volatility but not forced-sale risk.',
    recommendation:
      'Acquire 14 Marlborough Street, Leichhardt at or below $1,290,000, funded at 80% LVR '
      + 'on a 30-year principal-and-interest facility, with 60% of the balance fixed for '
      + 'three years.',
    reasoning:
      'The property meets the land, catchment and tenant-demand criteria in the brief, and '
      + 'the modelled shortfall is serviced nine times over by the stated surplus. The '
      + 'secondary-dwelling envelope provides a second income stream without a further '
      + 'acquisition, which is the most capital-efficient route to the stated objective.',
    scopeLimitation:
      'This advice covers the property acquisition only. It is not tax, credit or legal '
      + 'advice, and does not consider your superannuation, insurance or estate planning.',
    gaps:
      'No quantity surveyor depreciation schedule was available at the time of advice. '
      + 'Depreciation figures are estimates and should be confirmed post-settlement.',
    alternatives: [
      { option: 'Acquire in Marrickville at $1,180,000', reason: 'Stronger trailing growth but 84m² less land and no development envelope.' },
      { option: 'Acquire in Burwood at $1,420,000', reason: 'More land, but weaker growth and a higher weekly shortfall.' },
      { option: 'Defer for twelve months', reason: 'Rejected — holding costs of delay exceed the modelled price risk.' },
    ],
    disclosures: [
      { detail: 'Success fee of 1.65% of the purchase price, payable on exchange', date: 'On engagement', ack: 'Acknowledged' },
      { detail: 'No commission or referral fee is received from any lender', date: 'On engagement', ack: 'Acknowledged' },
      { detail: 'No ownership interest in any property presented', date: 'On engagement', ack: 'Acknowledged' },
      { detail: 'Building and pest providers are independent of this firm', date: 'On engagement', ack: 'Acknowledged' },
    ],
  },

  review: {
    type: 'Annual file review', period: 'Financial year to date', date: 'Quarter close',
    reviewer: 'M. Okafor', adviser: 'A. Whitfield', reference: 'QA-2040-118',
    result: 'Compliant with two observations', checkedCount: 18, failedCount: 2, dueDate: 'Within 30 days',
    items: [
      { item: 'Engagement signed before advice given', result: 'Pass', comment: 'Signed and filed' },
      { item: 'Identification verified and recorded', result: 'Pass', comment: 'Both applicants' },
      { item: 'Fee disclosure provided', result: 'Pass', comment: 'Acknowledged in writing' },
      { item: 'Written report issued before offer', result: 'Pass', comment: 'Issued two days prior' },
      { item: 'Conflicts declared', result: 'Observation', comment: 'Declaration undated' },
      { item: 'File notes contemporaneous', result: 'Observation', comment: 'Two entries added late' },
      { item: 'Advice record complete and dated', result: 'Pass', comment: 'All sections completed' },
      { item: 'Client acknowledgement on file', result: 'Pass', comment: 'Signed and returned' },
    ],
    actions: [
      { action: 'Re-date and re-file the conflicts declaration', owner: 'Adviser', due: 'Within 14 days' },
      { action: 'Refresher on contemporaneous file notes', owner: 'Compliance', due: 'Within 30 days' },
      { action: 'Re-test both observations at the next quarterly review', owner: 'Compliance', due: 'Next quarter' },
    ],
    note: 'Internal quality assurance record. Not for distribution outside the licensee.',
  },

  attestation: {
    period: 'Financial year', officer: 'M. Okafor, Responsible Manager',
    obligationCount: 14, compliantCount: 12, exceptionCount: 2, overdueCount: 0,
    items: [
      { obligation: 'Maintain adequate professional indemnity cover', status: 'Compliant', evidence: 'Certificate of currency on file' },
      { obligation: 'Maintain competence and training records', status: 'Compliant', evidence: 'CPD register, 42 hours' },
      { obligation: 'Complaints handling within prescribed timeframes', status: 'Compliant', evidence: 'Register reviewed' },
      { obligation: 'AML/CTF programme independently reviewed', status: 'Exception', evidence: 'Review overdue by one cycle' },
      { obligation: 'Breach reporting procedures current', status: 'Exception', evidence: 'Procedure not updated for the latest guidance' },
      { obligation: 'Client money handled per licence conditions', status: 'Compliant', evidence: 'No client money held at any time' },
    ],
    exceptions: [
      { item: 'AML/CTF independent review', why: 'Reviewer engagement lapsed', action: 'Engage a reviewer and complete within the quarter' },
      { item: 'Breach reporting procedure', why: 'Guidance updated after the last revision', action: 'Revise and re-issue to all staff' },
    ],
    statement:
      'I have made reasonable enquiry and, other than the exceptions recorded above, the '
      + 'obligations listed have been met for the period stated.',
  },

  complaints: {
    period: 'Financial year', received: 4, resolved: 3, outstanding: 1, avgDays: 11,
    items: [
      { ref: 'C-118', received: 'Q1', category: 'Fee clarity', days: 6, status: 'Resolved' },
      { ref: 'C-119', received: 'Q2', category: 'Communication frequency', days: 9, status: 'Resolved' },
      { ref: 'C-120', received: 'Q3', category: 'Report accuracy', days: 18, status: 'Resolved' },
      { ref: 'C-121', received: 'Q4', category: 'Fee clarity', days: 11, status: 'Open' },
    ],
    systemic: [
      { issue: 'Fee clarity raised twice', why: 'Success fee basis not restated at exchange', action: 'Add a fee restatement to the pre-exchange checklist' },
      { issue: 'One matter exceeded the 14-day target', why: 'Owner on leave with no delegate assigned', action: 'Assign a standing delegate for the complaints register' },
    ],
  },

  /**
   * The ten-year projection matrix.
   *
   * Shaped to match the legacy `CashFlowAnalysisModal` export — the same input
   * set, the same four banded groups (statistics, cash deductions, non-cash
   * deductions, summary), the same milestone columns — so the three
   * legacy-derived catalogue templates preview against realistic figures
   * rather than empty cells.
   *
   * Derived from the sample property above, not copied from any client file.
   */
  tenYear: (() => {
    const price = 1285000;
    const deposit = Math.round(price * 0.2);
    const loan = price - deposit;
    const weeklyRent = 950;
    const growth = 5.2;
    const cpi = 3.1;
    const rate = 6.14;
    const taxRate = 37;

    const money = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;
    const signed = (n: number) =>
      (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-AU');

    const years = Array.from({ length: 10 }, (_, i) => {
      const y = i + 1;
      const value = price * (1 + growth / 100) ** y;
      const balance = loan * (1 - 0.018 * y);
      const rent = weeklyRent * 52 * (1 + cpi / 100) ** i;
      const expenses = 10610 * (1 + cpi / 100) ** i;
      const interest = balance * (rate / 100);
      const principal = loan * 0.018;
      const preTax = rent - expenses - interest - principal;
      const deductions = expenses + interest;
      const netProfit = rent - deductions;
      // The SIGNED tax effect, through the one rule the production engine
      // uses. This sample carried the third copy of "a loss refunds, a profit
      // is free", so a template previewed against it showed the same
      // impossible picture a client's report did.
      const { taxEffect } = taxEffectOf(netProfit, taxRate / 100);
      const afterTax = preTax + taxEffect;
      return {
        y, value, balance, equity: value - balance, lvr: (balance / value) * 100,
        rent, grossYield: (rent / value) * 100,
        netYield: ((rent - expenses) / value) * 100,
        expenses, interest, principal, preTax, deductions, netProfit, taxEffect, afterTax,
      };
    });

    const last = years[years.length - 1];
    const row = (pick: (r: typeof years[0]) => string) => years.map(pick);

    return {
      // Column headings, so a template does not hard-code the horizon.
      years: years.map((r) => `Yr ${r.y}`),
      // ── Inputs ────────────────────────────────────────────────────────────
      inputs: {
        purchasePrice: money(price), landPrice: '—', buildPrice: money(price),
        deposit: money(deposit), loanAmount: money(loan),
        interestRate: `${rate.toFixed(2)}%`, capitalGrowth: `${growth.toFixed(1)}%`,
        cpiGrowth: `${cpi.toFixed(1)}%`, taxRate: `${taxRate}%`, depreciation: '—',
        weeklyRent: money(weeklyRent), grossYield: `${((weeklyRent * 52 / price) * 100).toFixed(2)}%`,
        councilRates: '$2,800', waterRates: '$1,100', propertyManagement: '8%',
        landlordInsurance: '$1,800', lettingFees: money(weeklyRent),
        repairs: '$2,500', bodyCorporate: '—',
        stampDuty: '$54,190', conveyancing: '$1,800',
      },
      upfront: {
        deposit: money(deposit), stampDuty: '$54,190', conveyancing: '$1,800',
        agentFee: '$4,940', total: money(deposit + 54190 + 1800 + 4940),
        overall: money(price + 54190 + 1800 + 4940),
      },
      // ── Matrix rows, pre-formatted per year ───────────────────────────────
      matrix: {
        capitalGrowth: row(() => growth.toFixed(1)),
        cpiGrowth: row(() => cpi.toFixed(1)),
        propertyValue: row((r) => money(r.value)),
        loanAmount: row((r) => money(r.balance)),
        equity: row((r) => money(r.equity)),
        lvr: row((r) => r.lvr.toFixed(1)),
        rentalIncome: row((r) => money(r.rent)),
        grossYield: row((r) => r.grossYield.toFixed(2)),
        netYield: row((r) => r.netYield.toFixed(2)),
        expenses: row((r) => money(r.expenses)),
        landTax: row(() => '—'),
        interestRate: row(() => rate.toFixed(2)),
        interestPayments: row((r) => money(r.interest)),
        principalPayments: row((r) => money(r.principal)),
        preTaxPA: row((r) => signed(r.preTax)),
        preTaxPW: row((r) => signed(r.preTax / 52)),
        depreciation: row(() => '—'),
        totalDeductions: row((r) => money(r.deductions)),
        netProfitLoss: row((r) => signed(r.netProfit)),
        taxRefund: row((r) => money(r.taxEffect)),
        afterTaxPA: row((r) => signed(r.afterTax)),
        afterTaxPW: row((r) => signed(r.afterTax / 52)),
      },
      today: {
        propertyValue: money(price), loanAmount: money(loan),
        equity: money(deposit), lvr: '80.0', rentalIncome: `${money(weeklyRent)}pw`,
      },
      summary: {
        propertyValue: money(last.value), totalEquity: money(last.equity),
        capitalGain: money(last.value - price),
        totalAfterTax: signed(years.reduce((a, r) => a + r.afterTax, 0)),
      },
      insight: {
        value: `The property is projected to appreciate by ${(((last.value - price) / price) * 100).toFixed(1)}% over the ten-year horizon, from ${money(price)} to ${money(last.value)}, on the configured capital growth assumption.`,
        equity: `Equity increases from ${money(deposit)} to ${money(last.equity)}, driven by both capital appreciation and principal repayments reducing the outstanding loan balance.`,
        cashFlow: `After-tax cash flow improves by ${signed(last.afterTax - years[0].afterTax)} across the period. Equity surpasses the remaining loan balance in year ${years.findIndex((r) => r.equity > r.balance) + 1}, the point at which the investor holds majority ownership of the asset.`,
        grossYield: `Gross yield moves from ${years[0].grossYield.toFixed(2)}% in year one to ${last.grossYield.toFixed(2)}% in year ten. The compression occurs because value appreciates faster than rental income — a hallmark of capital-growth-oriented property.`,
        netYield: `Net yield shifts from ${years[0].netYield.toFixed(2)}% to ${last.netYield.toFixed(2)}%, accounting for council rates, insurance, maintenance and management fees.`,
        expenseDrag: `The average spread between gross and net yield is ${(years.reduce((a, r) => a + (r.grossYield - r.netYield), 0) / years.length).toFixed(2)} percentage points — the proportion of rental income consumed by holding costs.`,
      },
      equitySeries: years.map((r) => ({ label: `Yr ${r.y}`, value: Math.round(r.equity) })),
      valueSeries: years.map((r) => ({ label: `Yr ${r.y}`, value: Math.round(r.value) })),
      grossYieldSeries: years.map((r) => ({ label: `Yr ${r.y}`, value: Number(r.grossYield.toFixed(2)) })),
      netYieldSeries: years.map((r) => ({ label: `Yr ${r.y}`, value: Number(r.netYield.toFixed(2)) })),
      afterTaxSeries: years.map((r) => ({ label: `Yr ${r.y}`, value: Math.round(r.afterTax) })),
    };
  })(),

  // ── Borrowing Capacity Snapshot ───────────────────────────────────────────
  //
  // The namespaces `borrowingCapacityProjection.pure.ts` publishes, so the 50
  // Borrowing Capacity masters preview with figures rather than blanks.
  //
  // Shapes and units follow the live `borrowing_capacity_assessments` table
  // rather than what reads nicely: rates are whole-number percent (the
  // `percent` filter does not multiply), `capacity.dti` is a MULTIPLE of income
  // and is set with `| fixed`, and `income.items` / `liabilities.items` are
  // arrays with the element keys the table actually stores. A sample written in
  // a convenient shape is how a catalogue passes preview and renders empty on
  // real data — which is precisely what happened to the Investment Compass
  // masters before the projection landed.
  capacity: {
    /*
     * Two formats share this namespace: the keys below serve the voice
     * templates' residential borrowing vocabulary, and the spread carries the
     * Commercial & Industrial Capacity projection's output — absent entirely
     * until August 2026, so every Commercial Capacity preview rendered a
     * cover with no title and every page past it dark. The key sets do not
     * overlap; `commercialCapacityCatalogue.spec.ts` asserts they stay that
     * way. See `COMMERCIAL_CAPACITY_SAMPLE`.
     */
    ...(COMMERCIAL_CAPACITY_SAMPLE as Record<string, unknown>),
    borrowing: 1180000,
    stressTested: 1042000,
    monthlySurplus: 1290,
    annualSurplus: 15480,
    band: 'amber',
    bandLabel: 'Serviceable with limited headroom',
    // Total debt over assessable income: (612,000 + 4,200 + 18,600 existing
    // + 1,032,000 proposed) / 280,000 = 5.95. A MULTIPLE, not a percentage —
    // the column is `dti_ratio` and reads like a rate, which is why the
    // templates set it with `| fixed` and label it "x assessable income".
    dti: 5.95,
    // The legacy engine's own formatting of the ratio above (5.95 renders as
    // 6.0x at its one-decimal precision), for the definition slot that shows
    // it as prose rather than a bare figure.
    dtiLabel: '6.0x',
    depositAmount: 258000,
    propertyValueEstimate: 1290000,
    // `netPurchase` is deliberately absent: populated on 3 of 143 rows, so the
    // sample shows what the common case looks like.
  },
  // The totals RECONCILE against the components, and that is not decoration:
  // the income page prints the lines and the total on the same table, so a
  // sample whose total does not equal its parts renders a visibly wrong
  // financial document in every preview and every screenshot. The first draft
  // of this had four lines summing to $280,000 under a $245,000 total, which
  // the render showed immediately.
  //   gross  118,000 + 82,000 + 46,800 + 33,200 = 280,000
  //   shaded 118,000 + 82,000 + 35,100 + 28,220 = 263,320
  income: {
    gross: 280000,
    shaded: 263320,
    shadingApplied: 16680,
    // `shadingRate` is a **0–1 fraction of income counted** — production holds
    // 0.8 and 1, never a whole-number percent. An earlier draft wrote 25 here,
    // which the legacy normaliser formats as "2,500%".
    items: [
      { component: 'PAYG salary — applicant 1', grossAmount: 118000, shadedAmount: 118000, shadingRate: 1 },
      { component: 'PAYG salary — applicant 2', grossAmount: 82000, shadedAmount: 82000, shadingRate: 1 },
      { component: 'Rental income', grossAmount: 46800, shadedAmount: 35100, shadingRate: 0.75 },
      { component: 'Annual bonus', grossAmount: 33200, shadedAmount: 28220, shadingRate: 0.85 },
    ],
    // The same lines as the legacy engine's own composition — `shadingLabel`
    // is the retention rate it applied, formatted by it. Four rows exercises
    // the four-row table variant; the totals above reconcile against these.
    rowCount: 4,
    rows: [
      { label: 'PAYG salary — applicant 1', gross: 118000, shaded: 118000, shadingLabel: '100%' },
      { label: 'PAYG salary — applicant 2', gross: 82000, shaded: 82000, shadingLabel: '100%' },
      { label: 'Rental income', gross: 46800, shaded: 35100, shadingLabel: '75%' },
      { label: 'Annual bonus', gross: 33200, shaded: 28220, shadingLabel: '85%' },
    ],
  },
  expenses: {
    monthly: 6420,
    annual: 77040,
    method: 'hem',
    methodLabel: 'HEM benchmark',
    declared: 5900,
    hemBenchmark: 6420,
  },
  liabilities: {
    monthly: 1840,
    annual: 22080,
    items: [
      { type: 'Owner-occupier home loan', balance: 612000, limit: 612000, monthlyServicing: 1540 },
      { type: 'Credit card', balance: 4200, limit: 15000, monthlyServicing: 300 },
      { type: 'Novated lease', balance: 18600, limit: 18600, monthlyServicing: 0 },
    ],
    // The legacy engine's display labels for the same commitments (it
    // title-cases the kind, and appends the provider where one is recorded).
    // Three rows exercises the three-row table variant, the production mode.
    rowCount: 3,
    rows: [
      { label: 'Owner Occupier Home Loan', balance: 612000, limit: 612000, servicing: 1540 },
      { label: 'Credit Card', balance: 4200, limit: 15000, servicing: 300 },
      { label: 'Novated Lease', balance: 18600, limit: 18600, servicing: 0 },
    ],
  },
  loan: {
    proposed: 1032000,
    lvr: 80,
    termYears: 30,
    interestRate: 6.14,
    bufferRate: 3,
    assessmentRate: 9.14,
    lender: 'Meridian Mutual',
  },
  // The assessment ledger, exactly as the legacy engine assembles it — eight
  // lines by construction, `amountLabel` formatted by it with the unit kept:
  // "$280,000 pa" beside "-$6,420/mo" is the point of a ledger, and stripping
  // the period would misstate which figures are annual. Reconciles line by
  // line against `income`, `expenses`, `liabilities` and `capacity`.
  ledger: {
    rows: [
      { label: 'Gross Annual Income', amountLabel: '$280,000 pa', direction: 'favourable', emphasis: 'normal' },
      { label: 'Shaded Annual Income', amountLabel: '$263,320 pa', direction: 'favourable', emphasis: 'normal' },
      { label: 'Living Expenses', amountLabel: '-$6,420/mo', direction: 'adverse', emphasis: 'normal' },
      { label: 'Existing Commitments', amountLabel: '-$1,840/mo', direction: 'adverse', emphasis: 'normal' },
      { label: 'Monthly Surplus', amountLabel: '$1,290/mo', direction: 'favourable', emphasis: 'normal' },
      { label: 'Assessment Rate Applied', amountLabel: '9.14%', direction: 'neutral', emphasis: 'normal' },
      { label: 'Loan Term', amountLabel: '30 years', direction: 'neutral', emphasis: 'normal' },
      { label: 'Maximum Borrowing Capacity', amountLabel: '$1,180,000', direction: 'neutral', emphasis: 'total' },
    ],
  },
  // The proposed loan against the assessed capacity, verdict included — the
  // verdict is a whole sentence from the projection, never composed on the
  // page, so an unresolved half cannot strand a fragment.
  utilisation: {
    proposedLoan: 1032000,
    capacity: 1180000,
    shareLabel: '87%',
    withinCapacity: true,
    verdict: 'The proposed loan sits inside the assessed capacity.',
  },
  // Empty on 140 of 143 assessments, so the LMI block stays conditional and the
  // sample exercises the common path. `explanation`, `audit` and `scenarios`
  // are likewise absent: the first two are columns null on every stored row
  // (they cascade in as the calculator stores them) and scenario presets never
  // reach a column at all — a sample that showed those pages would preview a
  // document no production render can produce today.
  lmi: {},
  // Kept inside the lengths production actually writes: 43-70 characters a
  // recommendation across 270 stored ones, 35-59 a warning across 63. The
  // templates reserve height for those maxima, and a sample longer than
  // production overlaps the block below it in every preview — which is what the
  // first draft of these strings did.
  recommendations: [
    'Cutting the credit card limit to $5,000 adds about $46,000',
    'Closing the novated lease removes $18,600 of liabilities',
    'A 30-year term is already the most favourable modelled',
  ],
  warnings: [
    'Includes a 3.00% buffer over the quoted rate',
    'Rental income shaded at 25% by lender policy',
  ],

  // ── Portfolio Performance Review ──────────────────────────────────────────
  //
  // The remaining namespaces `portfolioProjection.pure.ts` publishes. The rest
  // of the format's figures extend `portfolio`, `summary` and `risk` in place,
  // because those namespaces already exist and a second key of the same name in
  // one object literal silently discards the first.
  //
  // The inventory is exactly four rows, which is what the masters draw and the
  // observed maximum across all 21 stored reports.
  properties: PORTFOLIO_HOLDINGS,

  // `analysis.financialHealth` — five strings, no figures, and their lengths
  // are not what the names suggest. Measured across the 21 stored reports:
  // `cashflowStatus` is 7-8 characters, `debtServiceability` 8-11,
  // `equityPosition` 6-8 and `lvrRisk` 3-6 — single words — while `analysis`,
  // in the same object, is 458-1620.
  //
  // The first draft here wrote a sentence into each of the four, and every page
  // that printed them overlapped the block below: a definition list reserves
  // one line per row, which is right for the data and wrong for the sample. A
  // sample longer than production is the same defect as a sample shorter than
  // it, and it is caught by the same measure.
  health: {
    analysis:
      'The portfolio is performing on growth and under-performing on income, which is the '
      + 'expected shape for four inner-ring assets bought inside six years. The shortfall of '
      + '$1,183 a month is covered comfortably from surplus income rather than from reserves, '
      + 'and it has narrowed in each of the last three years as rents have moved faster than '
      + 'holding costs. Equity of $1.32m against $3.41m of value leaves the portfolio at a '
      + '61% loan-to-value ratio, with roughly $640k usable at an 80% ceiling — enough to fund '
      + 'a further acquisition without new savings. The binding constraint is not equity or '
      + 'serviceability but concentration: all four holdings sit inside one council area and '
      + 'one tenant catchment, so the portfolio moves as a single asset would.',
    cashflowStatus: 'Negative',
    debtServiceability: 'Comfortable',
    equityPosition: 'Strong',
    lvrRisk: 'Low',
  },

  // `analysis.strategicRecommendations` — four LISTS, not a list and three
  // statements. The horizons carry 1-4 actions each across the stored reports.
  actions: {
    priority: [
      'Refinance the Newtown facility before its fixed rate expires in March',
      'Obtain a depreciation schedule for the Leichhardt purchase and amend the prior return',
      'Place the next acquisition outside the inner west, in a higher-yielding price band',
    ],
    // 74-345 characters an item across the stored reports — longer than the
    // priority actions above them, which is why the horizons get their own page.
    shortTerm: [
      'Refinance the two facilities rolling off fixed rates in the next twelve months and rebuild '
      + 'the offset balance to six months of holding costs before adding any further debt.',
      'Order a depreciation schedule for the Leichhardt purchase',
    ],
    mediumTerm: [
      'Add one income-positive holding in a different capital city, funded from the usable equity '
      + 'rather than new savings, to bring the portfolio to a neutral monthly position without '
      + 'lifting the portfolio LVR above 65%.',
    ],
    longTerm: [
      'Hold to the ten-year horizon and review each holding against its original thesis at the '
      + 'annual review. The Lewisham apartment is the smallest contributor and the first '
      + 'candidate to recycle if the concentration is to be reduced by sale rather than purchase.',
    ],
  },
};

/**
 * A short, human line naming what the reader is looking at. Rendered next to
 * every preview so sample content is never mistaken for a real client file.
 */
export const SAMPLE_DATA_NOTICE =
  'Filled with sample data for preview. Your reports use live client and market data.';
