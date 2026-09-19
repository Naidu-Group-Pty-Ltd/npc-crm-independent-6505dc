/**
 * The Financial tier's chapters, composed from the recorded calculation.
 *
 * The "Client Investment Feasibility & Financial Performance Report" is a
 * deterministic fork of the Compass — and the Compass tier deliberately
 * carries no financial prose, so the fork's substring routing produced a
 * financial report whose entire narrative held ONE dollar sign while its own
 * row carried a complete `financial_calculations` block: seven key metrics,
 * eleven annual-cost lines, ten loan details, three projection scenarios and
 * a sensitivity grid (measured on row c21ed1fa, 2026-09-04; audit
 * REPORTING_ENGINE_AUDIT_2026_09.md).
 *
 * This module writes those chapters from the record itself. The rules it
 * lives by are the framework's laws (docs/reports/TIER_FRAMEWORK.md):
 *
 *  - every figure is typed from the record — the input is reconciled through
 *    `reconcileStoredFinancials`, the same heal `reportBindingProjection`
 *    applies before the KPI tiles bind, so a chapter here and a tile on the
 *    verdict page cannot disagree about a number;
 *  - a labelled row is a promise that a figure follows it — an absent value
 *    loses its row, a table that loses every row is not drawn, and a chapter
 *    with nothing to say is not emitted. Nothing in this module can write
 *    "N/A";
 *  - chapter headings and ordinals are the split registry's FIN section
 *    titles, so the composed chapters and the routed prose read as one
 *    declared document.
 *
 * Key names below are measured from production rows, not guessed: scenario
 * keys `conservative`/`moderate`/`optimistic`; series rows carry
 * `year`/`propertyValue`/`annualRent`/`cashFlow`/`cumulativeCashFlow`/
 * `equity`/`loanBalance`/`roi`; sensitivity carries `rentChanges`
 * (`minus10Percent`/`plus10Percent`/`plus20Percent`) and
 * `interestRateChanges` (`minus1Percent`/`plus1Percent`/`plus2Percent`).
 */

import { money, num, pct, str } from './figures.pure.ts';
import {
  operatingExpensesFrom,
  reconcileStoredFinancials,
} from './financialEngine.pure.ts';
import { readAnnualRent } from './rentBasis.pure.ts';
import { rentIsEstablished } from './rentalEvidence.pure.ts';
import {
  composeScoreBreakdownSection,
  composeSwotSection,
} from './scoreSections.pure.ts';

export interface ComposedChapter {
  /** 1-based ordinal in the FIN report layout (reportSplitRegistry). */
  ordinal: number;
  /** The FIN section heading, verbatim from the split registry's order. */
  heading: string;
  /** Markdown body including its own `## heading` line. */
  markdown: string;
}

export interface FinancialChapterSource {
  financialCalculations?: unknown;
  investmentScore?: unknown;
}

export interface FinancialChapterOptions {
  /** 'all' renders every stored projection scenario; 'primary' just the base case. */
  scenarios?: 'all' | 'primary';
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const obj = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});

/** Two-column table from labelled values; rows with no value are omitted. */
function twoCol(
  headers: [string, string],
  rows: Array<[string, string | undefined]>,
): string[] {
  const present = rows.filter((r): r is [string, string] => r[1] !== undefined);
  if (!present.length) return [];
  return [
    `| ${headers[0]} | ${headers[1]} |`,
    '| --- | --- |',
    ...present.map(([label, value]) => `| ${label} | ${value} |`),
  ];
}

/**
 * A chapter exists only when at least one of its TABLES could be drawn — the
 * lead sentence is furniture, and a heading over a sentence promising tables
 * that never come is the empty-section defect in a new coat.
 */
const chapter = (
  ordinal: number,
  heading: string,
  lead: string,
  tables: string[][],
): ComposedChapter | null => {
  const drawn = tables.filter((b) => b.length > 0);
  if (!drawn.length) return null;
  const markdown = [`## ${heading}`, lead, ...drawn.map((b) => b.join('\n'))].join('\n\n') + '\n';
  return { ordinal, heading, markdown };
};

// ── Chapter 4 · Purchase Costs & Annual Holding Cost Breakdown ──────────────

function purchaseAndHolding(fin: Record<string, unknown>): ComposedChapter | null {
  const initial = obj(fin.initialCosts);
  const costs = obj(fin.annualCosts);

  const acquisition = twoCol(['Acquisition item', 'Amount'], [
    ['Purchase price', money(initial.propertyValue)],
    ['Deposit', money(initial.deposit)],
    ['Stamp duty', money(initial.stampDuty)],
    ['Lenders mortgage insurance', money(initial.lmi)],
    ['Conveyancing & legal', money(initial.legalFees)],
    ['Building & pest inspections', money(initial.inspectionFees)],
    ['**Total upfront**', money(initial.totalUpfront) && `**${money(initial.totalUpfront)}**`],
  ]);

  const managementPct = num(costs.propertyManagementPercent);
  const lineTotal = operatingExpensesFrom(costs);
  const holding = twoCol(['Annual cost', 'Amount'], [
    ['Council rates', money(costs.councilRates)],
    ['Water rates', money(costs.waterRates)],
    ['Strata fees', money(costs.strataFees)],
    ['Landlord insurance', money(costs.landlordInsurance)],
    [
      managementPct !== undefined
        ? `Property management (${pct(managementPct)} of rent)`
        : 'Property management',
      money(costs.propertyManagement),
    ],
    ['Letting fees', money(costs.lettingFees)],
    ['Repairs & maintenance', money(costs.maintenance)],
    ['Land tax', money(costs.landTax)],
    ['**Total annual holding costs**', lineTotal > 0 ? `**${money(lineTotal)}**` : undefined],
  ]);

  return chapter(4, 'Purchase Costs & Annual Holding Cost Breakdown',
    'Acquisition and annual holding costs as recorded for this property.',
    [acquisition, holding]);
}

// ── Chapter 5 · Rental Assessment, Gross Yield & Net Yield ──────────────────

function rentalAndYield(fin: Record<string, unknown>): ComposedChapter | null {
  const income = obj(fin.income);
  const metrics = obj(fin.keyMetrics);
  const assumptions = obj(fin.assumptions);

  const weeklyRent = num(income.weeklyRent);
  // Both annual rents, from the one module the binding projection also asks —
  // so this table and the verdict page's tiles state the same figures under
  // the same names. They used to share a derivation instead of a module, and
  // it was the occupancy-adjusted one published bare as "Annual rent": on
  // `1/27D Mitchell Street` this table read $30,000 two rows above a 5.67%
  // yield that rests on $31,200.
  const rent = readAnnualRent(income, assumptions);

  // A yield is the rent divided by the price. Where the record establishes no
  // rent, the rent rows above suppress themselves and these two must follow —
  // otherwise the section reads "Recorded rental income and the yields it
  // produces" over a table containing yields and no income, which is a return
  // asserted on an income the record does not hold. One rule, asked here and
  // in the two other renderers that print a yield.
  const founded = rentIsEstablished(income);

  const table = twoCol(['Metric', 'Value'], [
    ['Weekly rent', money(weeklyRent)],
    // The contractual rent, which is what the yields two rows below rest on.
    ['Annual rent', money(rent.contractual)],
    // The occupancy assumption, as its own row rather than as a quieter
    // definition of the row above it. `twoCol` drops a row with no value, so a
    // report assuming a full year adds nothing here.
    [rent.occupancyLabel ?? 'Annual rent at assumed occupancy', money(rent.atOccupancy)],
    ['Gross rental yield', founded ? pct(metrics.grossRentalYield) : undefined],
    ['Net rental yield', founded ? pct(metrics.netRentalYield) : undefined],
  ]);

  return chapter(5, 'Rental Assessment, Gross Yield & Net Yield',
    'Recorded rental income and the yields it produces against the purchase price.',
    [table]);
}

// ── Chapter 6 · Loan Structure, Repayments & Cashflow Impact ────────────────

const LOAN_TYPE_LABELS: Readonly<Record<string, string>> = {
  interest_only: 'Interest only',
  principal_and_interest: 'Principal & interest',
  pi: 'Principal & interest',
  io: 'Interest only',
};

function loanStructure(fin: Record<string, unknown>): ComposedChapter | null {
  const loan = obj(fin.loanDetails);
  const monthly = num(loan.monthlyPayment);
  const loanTypeRaw = str(loan.loanType);
  const loanType = loanTypeRaw
    ? (LOAN_TYPE_LABELS[loanTypeRaw.toLowerCase()] ?? loanTypeRaw.replace(/_/g, ' '))
    : undefined;
  const lvr = num(loan.lvr);
  const rateSource = str(loan.rateSource);

  // The structure the arithmetic RAN, from the ledger's own description,
  // beside the label the record carries: an interest-only label over P&I
  // figures was the audit's QA-04, and the period is what makes the label a
  // schedule rather than a word.
  const structure = str(loan.structure);
  const ioYears = num(loan.interestOnlyPeriod);
  const table = twoCol(['Item', 'Value'], [
    ['Loan amount', money(loan.loanAmount)],
    ['Loan-to-value ratio', lvr !== undefined ? pct(lvr) : undefined],
    ['Loan type', loanType],
    ['Loan structure', structure],
    [
      'Interest-only period',
      ioYears !== undefined && ioYears > 0 ? `${ioYears} year${ioYears === 1 ? '' : 's'}, then principal and interest` : undefined,
    ],
    ['Loan term', num(loan.loanTerm) !== undefined ? `${num(loan.loanTerm)} years` : undefined],
    [
      rateSource ? `Interest rate (${rateSource})` : 'Interest rate',
      pct(loan.interestRate),
    ],
    ['Monthly repayment (first year)', money(monthly)],
    ['Weekly repayment', money(loan.weeklyPayment)],
    ['Annual repayments (first year)', num(loan.annualPayment) !== undefined ? money(loan.annualPayment) : (monthly !== undefined ? money(monthly * 12) : undefined)],
    ['Total interest over the term', money(loan.totalInterest)],
  ]);

  return chapter(6, 'Loan Structure, Repayments & Cashflow Impact',
    'The recorded lending structure behind the cashflow position.',
    [table]);
}

// ── Chapter 8 · Sensitivity & Scenario Testing ──────────────────────────────

const RATE_LABELS: Readonly<Record<string, string>> = {
  minus2Percent: 'Interest rate −2%',
  minus1Percent: 'Interest rate −1%',
  plus1Percent: 'Interest rate +1%',
  plus2Percent: 'Interest rate +2%',
  plus3Percent: 'Interest rate +3%',
};

const RENT_LABELS: Readonly<Record<string, string>> = {
  minus20Percent: 'Rent −20%',
  minus10Percent: 'Rent −10%',
  plus10Percent: 'Rent +10%',
  plus20Percent: 'Rent +20%',
};

/**
 * The weekly cash position, with the basis it rests on.
 *
 * `reconcileStoredFinancials` re-bases `annualNet` from the contractual rent
 * onto `weeklyRent x occupancyWeeks`, which is `calculateKeyMetrics`' own
 * definition — measured on 48 Redfern Street, Cowra: -23,383 becomes -24,273
 * and -450 a week becomes -467, the two unlet weeks being 890 a year or 17.12
 * a week. Both quantities are defensible; printing either under the bare label
 * "Weekly net position" is what left a reader unable to tell a second basis
 * from a second answer.
 *
 * So the row says which. At 52 weeks, or where the record states no occupancy,
 * there is no second basis and the label is unchanged.
 */
function weeklyNetLabel(metrics: Record<string, unknown>, assumptions: Record<string, unknown>): string {
  const weeks = num(metrics.occupancyWeeks) ?? num(assumptions.occupancyWeeks);
  return weeks !== undefined && weeks < 52
    ? `Weekly net position (${weeks} of 52 weeks let)`
    : 'Weekly net position';
}

function sensitivity(fin: Record<string, unknown>): ComposedChapter | null {
  const metrics = obj(fin.keyMetrics);
  const sens = obj(fin.sensitivityAnalysis);
  const rates = obj(sens.interestRateChanges);
  const rents = obj(sens.rentChanges);

  const position = twoCol(['Year-1 position', 'Value'], [
    ['Annual net cashflow (pre-tax)', money(metrics.annualNet)],
    [weeklyNetLabel(metrics, obj(fin.assumptions)), money(metrics.weeklyNet)],
    ['Total cash invested', money(metrics.totalInvestment)],
    ['Cash-on-cash return', pct(metrics.cashOnCashReturn)],
  ]);

  // A row is labelled with the parameter it tested. Where the engine
  // published its scenarios the absolute rate is printed ("Interest rate
  // 7.5% (+1.0 pt)"); the keyed deltas alone are labelled by their change.
  const published = Array.isArray(sens.scenarios) ? sens.scenarios.map(obj) : [];
  const publishedLabel = (key: string): string | undefined => {
    const hit = published.find((s) => s.id === key);
    return hit ? str(hit.label) : undefined;
  };
  const scenarioRows = (
    source: Record<string, unknown>,
    labels: Readonly<Record<string, string>>,
  ): Array<[string, string | undefined]> =>
    Object.entries(labels)
      .filter(([key]) => key in source)
      .map(([key, label]) => [publishedLabel(key) ?? label, money(source[key])]);

  const rateTable = twoCol(['Scenario', 'Annual cashflow'], scenarioRows(rates, RATE_LABELS));
  const rentTable = twoCol(['Scenario', 'Annual cashflow'], scenarioRows(rents, RENT_LABELS));

  return chapter(8, 'Sensitivity & Scenario Testing',
    'How the recorded year-1 position moves as the interest rate and the rent move.',
    [position, rateTable, rentTable]);
}

// ── Chapter 9 · 10-Year Cashflow, Equity & Growth Projection ────────────────

const SCENARIO_LABELS: Readonly<Record<string, string>> = {
  conservative: 'Conservative',
  moderate: 'Base case',
  optimistic: 'Optimistic',
};

const PROJECTION_YEARS = new Set([1, 3, 5, 7, 10]);

function projectionTable(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  const selected = rows.filter((r) => {
    const year = num(obj(r).year);
    return year !== undefined && PROJECTION_YEARS.has(year);
  });
  if (!selected.length) return [];

  // A column is drawn only when every selected row can fill it — a table
  // must stay rectangular and no cell may hold a placeholder.
  const colDefs: Array<{ header: string; value: (r: Record<string, unknown>) => string | undefined }> = [
    { header: 'Year', value: (r) => { const y = num(r.year); return y !== undefined ? String(y) : undefined; } },
    { header: 'Property value', value: (r) => money(r.propertyValue) },
    { header: 'Annual rent', value: (r) => money(r.annualRent) },
    { header: 'Cashflow', value: (r) => money(r.cashFlow) },
    { header: 'Cumulative', value: (r) => money(r.cumulativeCashFlow) },
    { header: 'Equity', value: (r) => money(r.equity) },
    {
      header: 'LVR',
      value: (r) => {
        const balance = num(r.loanBalance);
        const value = num(r.propertyValue);
        if (balance === undefined || value === undefined || value <= 0) return undefined;
        return pct(Math.round((balance / value) * 1000) / 10);
      },
    },
  ];
  const cols = colDefs.filter((c) => selected.every((r) => c.value(obj(r)) !== undefined));
  if (cols.length < 2) return [];

  return [
    `| ${cols.map((c) => c.header).join(' | ')} |`,
    `| ${cols.map(() => '---').join(' | ')} |`,
    ...selected.map((r) => `| ${cols.map((c) => c.value(obj(r))!).join(' | ')} |`),
  ];
}

function projections(
  fin: Record<string, unknown>,
  opts: FinancialChapterOptions,
): ComposedChapter | null {
  const stored = obj(fin.projections);
  const assumptions = obj(fin.assumptions);
  const tax = obj(fin.taxBenefits);

  const order = opts.scenarios === 'primary'
    ? ['moderate']
    : ['conservative', 'moderate', 'optimistic'];
  const blocks: string[][] = [];
  for (const key of order) {
    const table = projectionTable(stored[key]);
    if (!table.length) continue;
    blocks.push([`### ${SCENARIO_LABELS[key] ?? key}`, '', ...table]);
  }
  if (!blocks.length) return null;

  // Every scenario's own growth is stated beside the tables it produced, and
  // the conventions the series rest on — occupancy, the fee basis, the growth
  // timing — are said rather than left for a reader to reverse-engineer from
  // a year-1 rent that does not equal the headline (QA-10, QA-11).
  const scenarioGrowth = obj(assumptions.scenarioGrowth);
  const growthRow = (key: string, label: string): [string, string | undefined] => {
    const g = obj(scenarioGrowth[key]);
    const capital = num(g.capitalGrowth);
    const rent = num(g.rentGrowth);
    return [label, capital !== undefined && rent !== undefined ? `${pct(capital)} value, ${pct(rent)} rent` : undefined];
  };
  const assumptionTable = twoCol(['Modelling assumption', 'Value'], [
    ['Capital growth', pct(assumptions.capitalGrowth)],
    growthRow('conservative', 'Conservative scenario growth'),
    growthRow('moderate', 'Base case scenario growth'),
    growthRow('optimistic', 'Optimistic scenario growth'),
    ['CPI growth', pct(assumptions.cpiGrowth)],
    [
      'Occupancy',
      num(assumptions.occupancyWeeks) !== undefined
        ? `${num(assumptions.occupancyWeeks)} weeks a year`
        : undefined,
    ],
    ['Percentage fees charged on', assumptions.feeBasis === 'collected_rent' ? 'rent collected' : undefined],
    ['Growth timing', str(assumptions.growthTiming)],
    ['Cash-flow basis', 'pre-tax; each year is rent less operating costs less loan repayments'],
    ['Depreciation allowance', money(tax.depreciation)],
  ]);

  // An equity headline is bridged to the cash that bought it (QA-16): the
  // audited reports led with "$1.2m equity by year 10" and nowhere set that
  // beside the settlement cash and ten years of shortfalls that produced it.
  // The bridge is stated before selling costs and tax, and says so — an exit
  // figure net of those is a calculation this record does not hold.
  const moderate = Array.isArray(stored.moderate) ? stored.moderate.map(obj) : [];
  const last = moderate.length ? moderate[moderate.length - 1] : {};
  const horizon = num(last.year);
  const equity = num(last.equity);
  const cumulative = num(last.cumulativeCashFlow);
  const upfront = num(obj(fin.initialCosts).totalUpfront);
  const committed = upfront !== undefined && cumulative !== undefined
    ? upfront + Math.max(0, -cumulative)
    : undefined;
  const net = equity !== undefined && committed !== undefined ? equity - committed : undefined;
  const yearLabel = horizon !== undefined ? `year ${horizon}` : 'the final year';
  const bridge = equity === undefined ? [] : twoCol(['Equity bridge (base case, before selling costs and tax)', 'Value'], [
    [`Equity at ${yearLabel}`, money(equity)],
    ['Cash required to settle', money(upfront)],
    [`Cumulative cash shortfall funded to ${yearLabel}`, cumulative !== undefined && cumulative < 0 ? money(Math.abs(cumulative)) : undefined],
    ['Total cash committed', money(committed)],
    [`Net position at ${yearLabel}, before selling costs and tax`, money(net)],
  ]);

  return chapter(9, '10-Year Cashflow, Equity & Growth Projection',
    'The recorded ten-year modelling, shown at years 1, 3, 5, 7 and 10.',
    [...blocks, assumptionTable, bridge]);
}

// ── Chapter 11 · Financial Risk Dashboard ───────────────────────────────────

/**
 * The financial risks the record itself states, as a dashboard.
 *
 * The audit of 291 Stone Mason Drive (QA-31) found the Financial report's
 * "Financial Risk Dashboard" opening with "this register summarises the main
 * NON-financial risks" and listing crime, bushfire and planning checks — the
 * composite's register routed verbatim — while the row's own calculation
 * held the cash deficit, the debt structure, the rate shocks and the funding
 * need the heading promised. This chapter is those, typed from the record:
 * every figure is a stored key, nothing is recomputed, and a row with no
 * figure is not drawn. The Due Diligence report keeps the property and
 * locality register; this one cross-references it rather than restating it.
 */
function financialRiskDashboard(fin: Record<string, unknown>): ComposedChapter | null {
  const metrics = obj(fin.keyMetrics);
  const loan = obj(fin.loanDetails);
  const initial = obj(fin.initialCosts);
  const income = obj(fin.income);
  const assumptions = obj(fin.assumptions);
  const sens = obj(fin.sensitivityAnalysis);
  const rates = obj(sens.interestRateChanges);
  const rents = obj(sens.rentChanges);
  const projections = obj(fin.projections);
  const moderate = Array.isArray(projections.moderate) ? projections.moderate.map(obj) : [];
  const finalYear = moderate.length ? moderate[moderate.length - 1] : {};
  const horizon = num(finalYear.year);

  const annualNet = num(metrics.annualNet);
  const cumulative = num(finalYear.cumulativeCashFlow);
  const upfront = num(initial.totalUpfront);
  const funding = cumulative !== undefined && cumulative < 0 && upfront !== undefined
    ? upfront + Math.abs(cumulative)
    : undefined;

  const deficit = twoCol(['Cash position', 'Recorded value'], [
    ['Year-1 annual cash position (pre-tax)', money(annualNet)],
    [weeklyNetLabel(metrics, assumptions), money(metrics.weeklyNet)],
    [
      horizon !== undefined ? `Cumulative cash position to year ${horizon} (base case)` : 'Cumulative cash position (base case)',
      money(cumulative),
    ],
    ['Cash required to settle', money(upfront)],
    [
      horizon !== undefined ? `Total cash committed to year ${horizon} (settlement plus shortfalls)` : 'Total cash committed (settlement plus shortfalls)',
      money(funding),
    ],
  ]);

  const published = Array.isArray(sens.scenarios) ? sens.scenarios.map(obj) : [];
  const labelFor = (key: string, fallback: string): string => {
    const hit = published.find((x) => x.id === key);
    return (hit && str(hit.label)) ?? fallback;
  };
  const shockRow = (source: Record<string, unknown>, key: string, fallback: string): [string, string | undefined] => {
    const value = num(source[key]);
    if (value === undefined || annualNet === undefined) return [labelFor(key, fallback), money(value)];
    const delta = value - annualNet;
    return [labelFor(key, fallback), `${money(value)} (${delta < 0 ? '−' : '+'}${money(Math.abs(delta))} a year)`];
  };
  const shocks = twoCol(['Shock', 'Annual cash position'], [
    shockRow(rates, 'plus1Percent', RATE_LABELS.plus1Percent),
    shockRow(rates, 'plus2Percent', RATE_LABELS.plus2Percent),
    shockRow(rents, 'minus10Percent', RENT_LABELS.minus10Percent),
  ]);

  const ioYears = num(loan.interestOnlyPeriod);
  const ioPayment = num(loan.interestOnlyPayment);
  const piPayment = num(loan.amortisingMonthlyPayment);
  const stepUp = ioYears !== undefined && ioYears > 0 && ioPayment !== undefined && piPayment !== undefined
    ? `${money(piPayment)} a month from year ${ioYears + 1}, up from ${money(ioPayment)} interest-only`
    : undefined;
  const lvr = num(loan.lvr);
  const occupancyWeeks = num(assumptions.occupancyWeeks) ?? num(income.occupancyWeeks);
  const structure = twoCol(['Debt and funding', 'Recorded value'], [
    ['Loan-to-value ratio at settlement', lvr !== undefined ? pct(lvr) : undefined],
    ['Interest rate assumed for modelling', pct(loan.interestRate)],
    ['Loan structure', str(loan.structure)],
    ['Repayment step-up when the interest-only period ends', stepUp],
    [
      'Occupancy assumed',
      occupancyWeeks !== undefined ? `${occupancyWeeks} of 52 weeks let` : undefined,
    ],
  ]);

  const chapterOut = chapter(11, 'Financial Risk Dashboard',
    'The financial exposures the recorded calculation states: the cash the investor must fund, how it moves under a rate or rent shock, and the debt structure behind it. Property and locality risks (crime, environmental, planning, condition) are assessed in the Property & Location Due Diligence Report and are not restated here.',
    [deficit, shocks, structure]);
  return chapterOut;
}

// ── Public entrypoint ───────────────────────────────────────────────────────

/**
 * Compose every FIN chapter the record can support, in FIN ordinal order.
 * Chapters the record cannot fill are absent from the result — the caller
 * renders what comes back and adds nothing.
 */
export function composeFinancialChapters(
  source: FinancialChapterSource,
  opts: FinancialChapterOptions = {},
): ComposedChapter[] {
  const fin = obj(reconcileStoredFinancials(source.financialCalculations).fin);

  const chapters: Array<ComposedChapter | null> = [
    purchaseAndHolding(fin),
    rentalAndYield(fin),
    loanStructure(fin),
    sensitivity(fin),
    projections(fin, opts),
    financialRiskDashboard(fin),
  ];

  const scorecard = composeScoreBreakdownSection(
    source.investmentScore,
    'Financial Investment Scorecard',
  );
  if (scorecard) chapters.push({ ordinal: 12, heading: 'Financial Investment Scorecard', markdown: scorecard });

  const swot = composeSwotSection(
    source.investmentScore,
    'Financial SWOT: Returns, Risk & Holding Capacity',
  );
  if (swot) chapters.push({ ordinal: 14, heading: 'Financial SWOT: Returns, Risk & Holding Capacity', markdown: swot });

  return chapters
    .filter((c): c is ComposedChapter => c !== null)
    .sort((a, b) => a.ordinal - b.ordinal);
}

/**
 * The Snapshot's `Financial Snapshot` — one short table from the same healed
 * record the chapters above are built from.
 *
 * The Snapshot was the only member of the Compass family composing NOTHING:
 * briefing 7 sections from the record, financial 8, snapshot 0 — while four of
 * its nine model-authored sections were numeric. Its guide named six metrics to
 * "choose from" and the recorded-facts block carried five of them; the sixth,
 * `10-Year Projected Value`, had no authority in the block at all, so a model
 * asked for it had to compute one.
 *
 * This is deliberately NOT the briefing's five financial chapters. A Snapshot
 * is five pages and its financial section is one table; composing the long form
 * into it would blow the tier's budget, which is a different defect rather than
 * a fix. The rules are the chapters': every figure typed from the record, a
 * labelled row is a promise, and a yield is withheld where no rent is
 * established.
 */
export function composeFinancialSnapshotSection(
  financialCalculations: unknown,
  heading: string,
): string | null {
  const fin = obj(reconcileStoredFinancials(financialCalculations).fin);
  const income = obj(fin.income);
  const metrics = obj(fin.keyMetrics);
  const initial = obj(fin.initialCosts);
  const projectionRows = obj(fin.projections);

  const rent = readAnnualRent(income, obj(fin.assumptions));
  const founded = rentIsEstablished(income);

  // The tenth year of the base-case series, which the record holds and the
  // facts block never carried — so this is the one figure the guide asked for
  // that a model could only have produced by projecting it itself.
  const moderate = Array.isArray(projectionRows.moderate) ? projectionRows.moderate : [];
  const finalYear = moderate.length ? obj(moderate[moderate.length - 1]) : {};
  const horizonYear = num(finalYear.year);

  const table = twoCol(['Metric', 'Value'], [
    ['Purchase price', money(initial.propertyValue)],
    ['Weekly rent', money(income.weeklyRent)],
    ['Annual rent', money(rent.contractual)],
    ['Gross yield', founded ? pct(metrics.grossRentalYield) : undefined],
    ['Net yield', founded ? pct(metrics.netRentalYield) : undefined],
    ['Annual cash position (pre-tax)', money(metrics.annualNet)],
    [
      horizonYear !== undefined ? `Projected value, year ${horizonYear}` : 'Projected value',
      money(finalYear.propertyValue),
    ],
  ]);

  return table.length ? [`## ${heading}`, '', ...table].join('\n') + '\n' : null;
}
