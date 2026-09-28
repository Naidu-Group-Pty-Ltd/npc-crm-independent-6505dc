/**
 * The typeset 10 Year Cash Flow carries what the legacy export carried — the
 * owner's rule of 28 Sep 2026: "identical to the same process", with the ten
 * years "all in one page for easy read".
 *
 * Measured against the legacy PDF for 37 Bolin Street (Tallawong), Schofields
 * NSW 2762, generated 28 Sep 2026: its Input Summary, its $268,637 of upfront
 * costs, its $1,156,137 overall, its $1,177,745 capital gain, and its one
 * projection table under four headings with a Today column. And, for a new
 * build, the construction progress payment schedule the typeset document never
 * printed at all.
 *
 * The one-page property itself is a fact about a render, so it was measured in
 * WeasyPrint 69.0 (the pinned engine) over the standard document and all 50
 * catalogue designs, established and new build, and over a 24-month build —
 * `docs/reports/CASH_FLOW.md` §9. What this file pins is the markup that
 * measurement depends on.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { acquisitionExpenditure } from '../expenditure.pure';
import { inputSummaryLines, formatDollars, formatCents, type CashFlowInputs } from '../inputSummary.pure';
import { buildConstructionSchedule } from '../constructionSchedule.pure';
import { buildProjection, CashFlowPayloadError, toInputs } from '../normalise.pure';
import { cashFlowSections, validateCashFlowSpine } from '../sections.pure';
import { renderCashFlowBody, LONG_SCHEDULE_ROWS } from '../render.pure';
import { toWireInputs, toWireProjection } from '../toWireProjection';

const REPO = resolve(__dirname, '../../../../..');

// ── 37 Bolin Street, from the legacy PDF ─────────────────────────────────────

const VALUE = [1193250, 1282744, 1378950, 1482371, 1593549, 1713065, 1841545, 1979660, 2128135, 2287745];
const LOAN = [888000, 888000, 888000, 888000, 888000, 873338, 857695, 841003, 823194, 804192];
const RENT = [42640, 43706, 44799, 45919, 47067, 48243, 49449, 50686, 51953, 53252];
const EXP = [11468, 11754, 12048, 12349, 12658, 12975, 13299, 13631, 13972, 14322];
const INT = [57720, 57720, 57720, 57720, 57720, 57288, 56306, 55259, 54141, 52948];
const PRI = [0, 0, 0, 0, 0, 14662, 15644, 16691, 17809, 19002];
const PRE = [-26548, -25768, -24970, -24151, -23312, -36681, -35800, -34896, -33970, -33020];
const TAX = [11564, 11331, 11091, 10845, 10593, 10206, 9647, 9061, 8448, 7805];
const AFT = [-14983, -14438, -13879, -13306, -12718, -26476, -26153, -25835, -25522, -25215];

const YEARS = VALUE.map((v, i) => ({
  year: i + 1, calendarYear: 2027 + i, propertyValue: v, loanBalance: LOAN[i], rentalIncome: RENT[i],
  grossYield: 3.5, netYield: 2.5, expenses: EXP[i], interestRate: 6.5, interest: INT[i], principal: PRI[i],
  preTaxAnnual: PRE[i], afterTaxAnnual: AFT[i], depreciation: 12000, taxRefund: TAX[i], taxEffect: TAX[i],
  landTax: 0, capitalGrowth: 7.5, cpiGrowth: 2.5,
}));

const BOLIN: CashFlowInputs = {
  isNewBuild: false, purchasePrice: 1_110_000, weeklyRent: 800, landPrice: null, buildPrice: null,
  buildDerived: false, deposit: 222_000, loanAmount: 888_000, interestRate: 6.5, capitalGrowth: 7.5,
  cpiGrowth: 2.5, taxRate: 30, depreciation: 12_000, councilRates: 1_800, waterRates: 1_000,
  managementFeePercent: 5.5, landlordInsurance: 2_800, lettingFees: 800, repairsMaintenance: 2_500,
  bodyCorporate: 0, stampDuty: 44_137, solicitorFees: 2_000, inspectionFees: 500, agentFee: 0, lmiAmount: 0,
  occupancyWeeks: 52, loanType: 'interest_only', interestOnlyYears: 5, loanTermYears: 30,
  assumed: ['cpiGrowthRate', 'taxRate'], caseFingerprint: '88ba80f6', construction: null,
};

const NEW_BUILD: CashFlowInputs = {
  ...BOLIN, isNewBuild: true, landPrice: 520_000, buildPrice: 590_000,
  construction: { durationMonths: 12, preset: 'even', stagePercents: [5, 15, 20, 25, 20, 15], stageMonths: [2, 4, 6, 8, 10, 12] },
};

function project(inputs: CashFlowInputs | null, extra: Record<string, unknown> = {}) {
  return buildProjection({
    source: {
      acquisition: {
        purchasePrice: 1_110_000, marketValue: 1_110_000, deposit: 222_000, loanAmount: 888_000, loanTermYears: 30,
        interestRate: 6.5, loanType: 'interest_only', weeklyRent: 800, costs: [{ label: 'Stamp duty', amount: 44_137 }],
      },
      years: YEARS,
      assumptions: [{ label: 'Capital growth', value: '7.5% per year' }],
      notes: [],
      ...(inputs ? { inputs: { ...inputs, ...extra } } : {}),
      settlement: { propertyValue: 1_110_000, loanBalance: 888_000 },
    },
    propertyAddress: '37 Bolin Street (Tallawong), Schofields NSW 2762',
    clientName: '',
    now: '2026-09-28T00:00:00.000Z',
  });
}

const PALETTE = {
  paper: '#faf7f0', paperAlt: '#f3ece0', paperBright: '#fffdf8', field: '#1c1b19', rule: '#d8cfbf',
  bodyInk: '#2a2723', mutedInk: '#6b6356', onFieldInk: '#f5f0e6', accentFill: '#c9a55a',
  accentOnPaper: '#7a5d1f', accentOnField: '#d9b870', positive: '#2f6b3a', caution: '#8a5a00',
  negative: '#a3261b', informative: '#1f4f7a',
};

function body(cf: ReturnType<typeof project>) {
  return renderCashFlowBody({
    projection: cf,
    palette: PALETTE as never,
    company: { name: { lead: 'Kestrel', tail: 'Advisory' }, rows: [], disclaimer: { paragraphs: [], fontPt: 8 } } as never,
    masthead: 'Kestrel Advisory',
  });
}

// ── The two tables ───────────────────────────────────────────────────────────

describe('upfront costs and the overall expenditure, as the legacy export states them', () => {
  it('an established property reproduces the Bolin legacy totals to the dollar', () => {
    const e = acquisitionExpenditure({
      purchasePrice: 1_110_000, deposit: 222_000, stampDuty: 44_137, solicitorFees: 2_000,
      inspectionFees: 500, agentFee: 0, lmiAmount: 0, schedule: null,
    });
    expect(e.basis).toBe('established');
    expect(e.upfront.total).toBe(268_637);
    expect(e.overall.total).toBe(1_156_137);
    expect(e.upfront.rows.map((r) => r.label)).toEqual([
      'Deposit (20% — from your funds)', 'Stamp Duty', 'Solicitor / Conveyancer Cost', 'Building & Pest Inspections',
    ]);
  });

  it('a new build carries the land and build deposits, the contract and the construction interest', () => {
    const schedule = buildConstructionSchedule({
      landPrice: 520_000, buildPrice: 590_000, interestRate: 6.5, durationMonths: 12,
      stagePercents: [5, 15, 20, 25, 20, 15], stageMonths: [2, 4, 6, 8, 10, 12],
    });
    const e = acquisitionExpenditure({
      purchasePrice: 1_110_000, deposit: 222_000, stampDuty: 44_137, solicitorFees: 2_000,
      inspectionFees: 500, agentFee: 0, lmiAmount: 0, schedule,
    });
    expect(e.basis).toBe('new_build');
    expect(e.upfront.rows.map((r) => r.label)).toEqual([
      '10% Land Deposit', '5% Build Contract Deposit', 'Stamp Duty', 'Solicitor / Conveyancer Cost',
      'Construction Progress Payment Interest (12 months)',
    ]);
    expect(e.overall.rows.map((r) => r.label)).toEqual([
      'Purchase Price (Land)', 'Stamp Duty', 'Solicitor / Conveyancer Cost', 'Build Price',
      'Construction Progress Payment Interest (12 months)',
    ]);
    expect(e.overall.total).toBeCloseTo(520_000 + 44_137 + 2_000 + 590_000 + 48_980.22, 2);
  });

  it('every total is the sum of its own rows, and a zero is left out rather than printed', () => {
    const e = acquisitionExpenditure({
      purchasePrice: 700_000, deposit: 70_000, stampDuty: 0, solicitorFees: 1_800,
      inspectionFees: 0, agentFee: 0, lmiAmount: 12_400, schedule: null,
    });
    for (const t of [e.upfront, e.overall]) {
      expect(t.total).toBe(t.rows.reduce((s, r) => s + r.amount, 0));
      expect(t.rows.every((r) => r.amount !== 0)).toBe(true);
    }
  });
});

// ── The Input Summary ────────────────────────────────────────────────────────

describe('the Input Summary is the legacy one', () => {
  const flat = (lines: ReturnType<typeof inputSummaryLines>) =>
    Object.fromEntries(lines.flatMap((l) => [l.left, l.right]).filter(Boolean).map((c) => [c!.label, c!.value]));

  it('states every input the Bolin legacy summary stated, in its words', () => {
    const v = flat(inputSummaryLines(BOLIN));
    expect(v['Purchase price']).toBe('$1,110,000');
    expect(v['Land price']).toBe('Not stated');
    expect(v['Build price']).toBe('Not stated');
    expect(v['Gross rental yield (on purchase)']).toBe('3.75%');
    expect(v['Council rates (p.a.)']).toBe('$1,800');
    expect(v['Water rates (p.a.)']).toBe('$1,000');
    expect(v['Property management']).toBe('5.5%');
    expect(v['Interest rate']).toBe('6.50%');
    expect(v['CPI growth rate']).toBe('2.5% (assumed)');
    expect(v['Tax rate (MTR)']).toBe('30% (assumed)');
    expect(v['Loan structure']).toBe('Interest only 5 yrs, then P&I (30 yr term)');
    expect(v['Rent basis']).toBe('52 weeks p.a.');
    expect(v['Body corporate']).toBe('Nil');
    expect(v['Case inputs']).toBe('fingerprint 88ba80f6');
  });

  it('names a derived build price as derived, and the build period of a new build', () => {
    const v = flat(inputSummaryLines({ ...NEW_BUILD, buildDerived: true }));
    expect(v['Build price']).toBe('$590,000 (price less land)');
    expect(v['Construction period']).toBe('12 months');
  });

  it('formats without the runtime locale', () => {
    expect(formatDollars(1_234_567.4)).toBe('$1,234,567');
    expect(formatDollars(-4_200)).toBe('-$4,200');
    expect(formatCents(2816.666)).toBe('$2,816.67');
  });
});

// ── The server derives; it never accepts a table ─────────────────────────────

describe('the server computes the schedule and the tables from the inputs', () => {
  it('a new build carries a schedule, its tables and a construction section before the projection', () => {
    const cf = project(NEW_BUILD);
    expect(cf.construction?.totals.totalCombinedRepayment).toBe(48980.22);
    expect(cf.expenditure?.basis).toBe('new_build');
    expect(cashFlowSections(cf).map((s) => s.id)).toEqual(['position', 'construction', 'projection', 'growth', 'assumptions']);
    expect(validateCashFlowSpine(cf)).toEqual([]);
  });

  it('an established property carries no construction section, whatever the flag says', () => {
    const cf = project({ ...BOLIN, isNewBuild: false, construction: NEW_BUILD.construction });
    expect(cf.construction).toBeNull();
    expect(cashFlowSections(cf).map((s) => s.id)).not.toContain('construction');
  });

  it("the adviser's switch hides the schedule table and keeps its interest in the costs", () => {
    const cf = project(NEW_BUILD, { showConstructionSchedule: false });
    expect(cashFlowSections(cf).map((s) => s.id)).not.toContain('construction');
    expect(cf.expenditure?.basis).toBe('new_build');
  });

  it('refuses inputs it cannot print, naming the field', () => {
    expect(() => toInputs({ ...BOLIN, purchasePrice: 'lots' })).toThrow(/purchasePrice/);
    expect(() => toInputs({ ...NEW_BUILD, construction: { ...NEW_BUILD.construction, stagePercents: [5, 15] } }))
      .toThrow(CashFlowPayloadError);
    expect(() => toInputs({ ...NEW_BUILD, construction: { ...NEW_BUILD.construction, stagePercents: [5, 15, 20, 25, 20, 150] } }))
      .toThrow(/between 0 and 100/);
  });

  it('an older caller that sends no inputs still renders the purchase table, unchanged', () => {
    const cf = project(null);
    expect(cf.inputs).toEqual([]);
    expect(cf.expenditure).toBeNull();
    expect(body(cf)).toContain('The purchase');
  });

  it('capital growth over the term is measured from TODAY, as the legacy export did', () => {
    // $2,287,745 − $1,110,000. Measured from the end of year one it was
    // $1,094,495 — a whole year of growth missing.
    expect(project(BOLIN).outcome.capitalGain.value).toBe(1_177_745);
  });

  it("total deductions and the rental profit or loss are derived by the engine's definition", () => {
    const y1 = project(BOLIN).years[0];
    expect(y1.totalDeductions?.value).toBe(81_188);
    expect(y1.netProfitLoss?.value).toBe(-38_548);
  });
});

// ── One page ─────────────────────────────────────────────────────────────────

describe('the projection is one table, on one landscape page, with the legacy rows', () => {
  const html = body(project(NEW_BUILD));
  const matrix = html.slice(html.indexOf('<table class="data cf-matrix">'), html.indexOf('</table>', html.indexOf('cf-matrix')));

  it('is ONE table, opened on the landscape page with its own header', () => {
    expect(html.match(/<table class="data cf-matrix">/g)).toHaveLength(1);
    const wide = html.match(/class="chapter page-landscape-table cf-wide"/g) ?? [];
    expect(wide).toHaveLength(2); // the schedule and the projection
  });

  it('has a Today column and every year', () => {
    expect(matrix).toContain('>Today<');
    for (let y = 1; y <= 10; y++) expect(matrix).toContain(`>Yr ${y}<`);
  });

  it('carries the legacy lines under the legacy headings, in order', () => {
    const order = [
      'Capital growth', 'CPI growth', 'Property value', 'Purchase price', 'Loan amount',
      'Statistics', 'Equity', 'LVR', 'Rental income', 'Gross yield', 'Net yield',
      'Cash deductions', 'Property expenses', 'Land tax', 'Interest rate', 'Interest payments',
      'Principal payments', 'Pre-tax cash flow p/a', 'Pre-tax cash flow p/w',
      'Non-cash deductions', 'Depreciation',
      'Summary', 'Total deductions', 'Net profit / (loss)', 'Tax refund / (payable)',
      'After-tax cash flow p/a', 'After-tax cash flow p/w',
    ];
    let at = 0;
    for (const label of order) {
      const next = matrix.indexOf(`>${label}<`, at);
      expect(next, label).toBeGreaterThan(-1);
      at = next;
    }
  });

  it('prints the Bolin settlement position in the Today column', () => {
    expect(matrix).toContain('$1,110,000');
    expect(matrix).toContain('$222,000');
    expect(matrix).toContain('$800/wk');
  });

  it('sets a long build compact rather than letting the table leave its header', () => {
    const long = body(project({
      ...NEW_BUILD,
      construction: { durationMonths: 24, preset: 'even', stagePercents: [5, 15, 20, 25, 20, 15], stageMonths: [2, 6, 11, 15, 20, 24] },
    }));
    expect(long).toContain('cf-schedule-long');
    expect(html).not.toContain('cf-schedule-long');
    expect(LONG_SCHEDULE_ROWS).toBe(15);
  });
});

// ── The browser sends the case, not a table ──────────────────────────────────

describe('the modal sends the inputs and the settlement', () => {
  it('maps base financials to the wire, with the legacy deposit fallback', () => {
    const inputs = toWireInputs({
      purchasePrice: 600_000, marketValueNow: 600_000, depositValue: 0, loanAmount: 480_000, loanTermYears: 30,
      interestRate: 6, loanType: 'principal_interest', weeklyRent: 550, stampDuty: 22_000, solicitorFees: 1_800,
      inspectionFees: 450, lmiAmount: 0, capitalGrowth: 5, cpiGrowthRate: 2.5, taxRate: 30, occupancyRate: 50,
      depreciation: 8_000, includeDepreciationInCashFlow: true, landPrice: 300_000, buildPrice: 0,
      councilRates: 1_600, waterRates: 900, propertyManagementFees: 6, buildingLandlordInsurance: 1_500,
      lettingFees: 550, repairsMaintenance: 1_200, bodyCorporateFees: 0, agentFee: 0, interestOnlyPeriodYears: 0,
      constructionDurationMonths: 9, loanToValueRatio: 80, assumedInputs: ['taxRate'], caseFingerprint: 'abcd1234',
    }, {
      isNewBuild: true, overrides: { stageFramePercent: 22 }, schedulePreset: 'even',
      customStageMonths: {}, showConstructionSchedule: true,
    });
    expect(inputs.deposit).toBeCloseTo(120_000, 2);
    expect(inputs.buildPrice).toBe(300_000);
    expect(inputs.buildDerived).toBe(true);
    expect(inputs.construction?.stagePercents).toEqual([5, 15, 22, 25, 20, 15]);
    expect(inputs.construction?.stageMonths).toHaveLength(6);
  });

  it('carries year 0 as the settlement, never as a projected year', () => {
    const wire = toWireProjection({
      projections: [
        { year: 0, capitalGrowthRate: 0, cpiGrowthRate: 0, propertyMarketValue: 700_000, loanAmount: 560_000, rentalIncome: 0,
          grossYield: 0, netYield: 0, propertyExpenses: 0, interestRate: 6, interestPayments: 0, principalPayments: 0,
          preTaxCashFlowPA: 0, depreciation: 0, taxRefund: 0, landTax: 0, afterTaxCashFlowPA: 0 },
        { year: 1, capitalGrowthRate: 5, cpiGrowthRate: 2.5, propertyMarketValue: 735_000, loanAmount: 560_000, rentalIncome: 30_000,
          grossYield: 4.1, netYield: 3, propertyExpenses: 8_000, interestRate: 6, interestPayments: 33_600, principalPayments: 0,
          preTaxCashFlowPA: -11_600, depreciation: 5_000, taxRefund: 5_000, landTax: 0, afterTaxCashFlowPA: -6_600,
          totalDeductions: 46_600, netProfitLoss: -16_600 },
      ],
      base: {
        purchasePrice: 700_000, marketValueNow: 700_000, depositValue: 140_000, loanAmount: 560_000, loanTermYears: 30,
        interestRate: 6, loanType: 'interest_only', weeklyRent: 600, stampDuty: 27_000, solicitorFees: 2_000, lmiAmount: 0,
        capitalGrowth: 5, cpiGrowthRate: 2.5, taxRate: 30, occupancyRate: 52, depreciation: 5_000, includeDepreciationInCashFlow: true,
      },
    });
    expect(wire.years).toHaveLength(1);
    expect(wire.settlement).toEqual({ propertyValue: 700_000, loanBalance: 560_000 });
    expect(wire.years[0].totalDeductions).toBe(46_600);
  });
});

// ── One implementation ───────────────────────────────────────────────────────

describe('the modal draws from the shared modules and keeps no copy of its own', () => {
  const modal = readFileSync(resolve(REPO, 'src/components/reports/CashFlowAnalysisModal.tsx'), 'utf8');

  it('computes the schedule with constructionSchedule.pure, never inline', () => {
    expect(modal).toContain('buildConstructionSchedule(');
    expect(modal).not.toMatch(/const monthlyLandInterest\s*=/);
    expect(modal).not.toContain("stage: 'Land Interest Charge'");
  });

  it('composes both expenditure tables with expenditure.pure, everywhere it draws them', () => {
    expect((modal.match(/acquisitionExpenditure\(/g) ?? []).length).toBe(3);
    expect(modal).not.toContain("{ label: '10% Land Deposit', value:");
  });

  it('sends the inputs on the typeset request', () => {
    expect(modal).toMatch(/inputs: toWireInputs\(baseFinancialData,/);
  });
});
