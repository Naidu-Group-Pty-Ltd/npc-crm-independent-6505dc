/**
 * A build planned on a land-only purchase is costed as the new build it
 * becomes — and a new build is costed as the legacy process costs it.
 *
 * Two things are pinned here. First, the reference: the legacy export's
 * 10-Year Cash Flow for Lot 1639 Corridale Estate, Lara VIC 3212 (generated
 * 9 Jul 2026), whose construction progress payment schedule, upfront costs and
 * overall expenditure the shared modules must reproduce to the dollar. Second,
 * the land-only switch: the SAME lot bought as land, with the same build
 * planned on it, must produce the SAME schedule and tables — the switch adds a
 * build, it does not add a second method.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildConstructionSchedule, scheduleDuration, stageMonthsFor, stagePercentsFrom } from '../constructionSchedule.pure';
import { acquisitionExpenditure } from '../expenditure.pure';
import { buildProjection } from '../normalise.pure';
import { inputSummaryLines } from '../inputSummary.pure';
import { cashFlowSections } from '../sections.pure';
import {
  constructionCaseOf,
  PLANNED_BUILD_KEYS,
  plannedBuildFigures,
  plannedBuildRequested,
  withPlannedBuild,
} from '../plannedBuild.pure';
import { landBuildSplit, readBaseFinancials } from '../readBaseFinancials';
import { toWireInputs } from '../toWireProjection';

const REPO = resolve(__dirname, '../../../../..');

// ── Lot 1639 Corridale Estate, from the legacy PDF ───────────────────────────
// Land $319,900 · build $387,000 · 6.5% · eight months · stages drawn in
// months 2, 3, 4, 6, 7 and 8 (month 5 carries interest and no stage).
const LOT_1639 = {
  landPrice: 319_900,
  buildPrice: 387_000,
  interestRate: 6.5,
  durationMonths: 8,
  stageMonths: [2, 3, 4, 6, 7, 8],
  stampDuty: 14_264,
  solicitorFees: 1_800,
};

function lot1639Schedule() {
  return buildConstructionSchedule({
    landPrice: LOT_1639.landPrice,
    buildPrice: LOT_1639.buildPrice,
    interestRate: LOT_1639.interestRate,
    durationMonths: LOT_1639.durationMonths,
    stagePercents: stagePercentsFrom(null),
    stageMonths: LOT_1639.stageMonths,
  })!;
}

describe('Lot 1639 Corridale Estate — the legacy new-build process, to the dollar', () => {
  it('stages the contract month by month as the legacy schedule printed it', () => {
    const s = lot1639Schedule();
    const printed = s.stages.map((r) => [r.month, r.stage, Math.round(r.buildInterest), Math.round(r.totalMonthlyInterest)]);
    expect(printed).toEqual([
      [1, 'Land Interest Charge', 0, 1733],
      [2, 'Deposit', 0, 1733],
      [3, 'Slab/Base Stage', 314, 2047],
      [4, 'Frame Stage', 734, 2466],
      [5, '', 734, 2466],
      [6, 'Lock-up Stage', 1258, 2991],
      [7, 'Fixing Stage', 1677, 3410],
      [8, 'Practical Completion', 1991, 3724],
    ]);
    expect(Math.round(s.totals.totalCombinedRepayment)).toBe(20_570);
    expect(s.totalProject).toBe(706_900);
  });

  it('reproduces the upfront costs ($87,974) and the overall expenditure ($743,534)', () => {
    const e = acquisitionExpenditure({
      purchasePrice: 706_900, deposit: 0, stampDuty: LOT_1639.stampDuty, solicitorFees: LOT_1639.solicitorFees,
      inspectionFees: 0, agentFee: 0, lmiAmount: 0, schedule: lot1639Schedule(),
    });
    expect(e.basis).toBe('new_build');
    expect(e.upfront.rows.map((r) => [r.label, Math.round(r.amount)])).toEqual([
      ['10% Land Deposit', 31_990],
      ['5% Build Contract Deposit', 19_350],
      ['Stamp Duty', 14_264],
      ['Solicitor / Conveyancer Cost', 1_800],
      ['Construction Progress Payment Interest (8 months)', 20_570],
    ]);
    expect(Math.round(e.upfront.total)).toBe(87_974);
    expect(Math.round(e.overall.total)).toBe(743_534);
  });
});

// ── The land-only switch ────────────────────────────────────────────────────

/** The same lot, recorded as a land-only purchase. */
function landOnlyReport(extra: Record<string, unknown> = {}) {
  return {
    financial_calculations: {
      initialCosts: { propertyValue: 319_900, stampDuty: 14_264, legalFees: 1_800, loanAmount: 255_920 },
      loanDetails: { lvr: 90, interestRate: 6.5 },
    },
    manual_overrides: {
      buildType: 'land_only',
      purchasePrice: 319_900,
      loanToValueRatio: 90,
      loanAmount: 287_910,
      interestRate: 6.5,
      ...extra,
    },
  };
}

describe('the switch is off until it is on, and a build needs a price', () => {
  it('a land-only report with no build planned is returned unchanged — the same object', () => {
    const report = landOnlyReport();
    expect(constructionCaseOf(report.manual_overrides)).toBe('none');
    expect(withPlannedBuild(report)).toBe(report);
  });

  it('switched on with no build price, the land stays land', () => {
    const report = landOnlyReport({ landOnlyPlannedBuild: true });
    expect(constructionCaseOf(report.manual_overrides)).toBe('none');
    expect(withPlannedBuild(report)).toBe(report);
  });

  it('a build price with the switch OFF plans nothing', () => {
    const report = landOnlyReport({ [PLANNED_BUILD_KEYS.price]: 387_000, landOnlyPlannedBuild: false });
    expect(withPlannedBuild(report)).toBe(report);
  });

  it('an established property or a new build is never re-read', () => {
    for (const buildType of ['existing_property', 'new_build']) {
      const report = { manual_overrides: { buildType, landOnlyPlannedBuild: true, [PLANNED_BUILD_KEYS.price]: 400_000 } };
      expect(withPlannedBuild(report)).toBe(report);
    }
    expect(constructionCaseOf({ buildType: 'new_build' })).toBe('new_build');
  });

  it('reads a switch a select may have written', () => {
    expect(plannedBuildRequested({ landOnlyPlannedBuild: 'true' })).toBe(true);
    expect(plannedBuildRequested({ landOnlyPlannedBuild: 'yes' })).toBe(true);
    expect(plannedBuildRequested({ landOnlyPlannedBuild: 'no' })).toBe(false);
    expect(plannedBuildRequested({})).toBe(false);
  });
});

describe('land with a planned build is the new build it becomes', () => {
  const planned = landOnlyReport({
    landOnlyPlannedBuild: true,
    [PLANNED_BUILD_KEYS.price]: 387_000,
    [PLANNED_BUILD_KEYS.durationMonths]: 8,
    [PLANNED_BUILD_KEYS.weeklyRent]: 550,
  });

  it('costs the whole project, re-sizes the loan to it and keeps the duty on the land', () => {
    const f = plannedBuildFigures(planned)!;
    expect(f).toMatchObject({
      landPrice: 319_900, buildPrice: 387_000, totalProject: 706_900, valueToday: 706_900,
      loanToValueRatio: 90, loanAmount: 636_210, deposit: 70_690, durationMonths: 8, weeklyRent: 550,
    });
    const base = readBaseFinancials(withPlannedBuild(planned), 2026);
    expect(base.purchasePrice).toBe(706_900);
    expect(base.loanAmount).toBe(636_210);
    expect(base.weeklyRent).toBe(550);
    expect(base.stampDuty).toBe(14_264);
    expect(base.constructionDurationMonths).toBe(8);
    expect(landBuildSplit(base)).toEqual({ landPrice: 319_900, buildPrice: 387_000, derived: false });
  });

  it('a lot that has risen since it was bought keeps that rise in the value today', () => {
    const f = plannedBuildFigures(landOnlyReport({
      landOnlyPlannedBuild: true, [PLANNED_BUILD_KEYS.price]: 387_000, marketValueNow: 340_000,
    }))!;
    expect(f.valueToday).toBe(727_000);
    expect(f.totalProject).toBe(706_900);
  });

  it('stages the SAME schedule as the lot bought as a house-and-land package', () => {
    const base = readBaseFinancials(withPlannedBuild(planned), 2026);
    const split = landBuildSplit(base);
    const duration = scheduleDuration(base.constructionDurationMonths);
    const s = buildConstructionSchedule({
      landPrice: split.landPrice!, buildPrice: split.buildPrice!, interestRate: base.interestRate,
      durationMonths: duration, stagePercents: stagePercentsFrom(null), stageMonths: LOT_1639.stageMonths,
    })!;
    expect(s.stages).toEqual(lot1639Schedule().stages);
  });

  it('reaches the typeset document as a new build, named as planned', () => {
    const base = readBaseFinancials(withPlannedBuild(planned), 2026);
    const inputs = toWireInputs(base, {
      isNewBuild: true, plannedBuild: true, overrides: planned.manual_overrides,
      schedulePreset: 'custom', customStageMonths: { 0: 2, 1: 3, 2: 4, 3: 6, 4: 7, 5: 8 },
      showConstructionSchedule: true,
    });
    expect(inputs.plannedBuild).toBe(true);
    expect(inputs.construction?.stageMonths).toEqual(LOT_1639.stageMonths);

    // Year 1 of the legacy Lot 1639 table.
    const year1 = {
      year: 1, calendarYear: 2027, propertyValue: 742_952, loanBalance: 636_210, rentalIncome: 28_462,
      grossYield: 3.83, netYield: 2.79, expenses: 7_763, interestRate: 6.5, interest: 41_354, principal: 0,
      preTaxAnnual: -22_064, afterTaxAnnual: -10_345, depreciation: 17_000, taxRefund: 11_719, taxEffect: 11_719,
      landTax: 1_410, capitalGrowth: 5.1, cpiGrowth: 3.5,
    };
    const cf = buildProjection({
      source: {
        acquisition: {
          purchasePrice: 706_900, marketValue: 706_900, deposit: 70_690, loanAmount: 636_210, loanTermYears: 30,
          interestRate: 6.5, loanType: 'interest_only', weeklyRent: 550, costs: [],
        },
        years: [year1], assumptions: [], notes: [], inputs,
        settlement: { propertyValue: 706_900, loanBalance: 636_210 },
      },
      propertyAddress: 'Lot 1639 Corridale Estate, Lara VIC 3212',
      clientName: '',
      now: '2026-09-28T00:00:00.000Z',
    });
    expect(cf.plannedBuild).toBe(true);
    expect(Math.round(cf.construction!.totals.totalCombinedRepayment)).toBe(20_570);
    expect(Math.round(cf.expenditure!.upfront.total)).toBe(87_974);
    const flat = (cf.inputs ?? []).flatMap((l) => [l.left, l.right]).filter(Boolean);
    expect(flat).toContainEqual({ label: 'Build price', value: '$387,000 (planned)' });
    expect(flat).toContainEqual({ label: 'Total project (land + build)', value: '$706,900' });
    expect(cashFlowSections(cf).find((s) => s.id === 'construction')?.title).toBe('The build planned on this land');
  });

  it('a planned-build flag from a caller that is not a new build is refused', () => {
    const lines = inputSummaryLines({
      isNewBuild: false, plannedBuild: false, purchasePrice: 319_900, weeklyRent: 0, landPrice: 319_900, buildPrice: null,
      buildDerived: false, deposit: 31_990, loanAmount: 287_910, interestRate: 6.5, capitalGrowth: 5, cpiGrowth: 3,
      taxRate: 30, depreciation: 0, councilRates: 0, waterRates: 0, managementFeePercent: 0, landlordInsurance: 0,
      lettingFees: 0, repairsMaintenance: 0, bodyCorporate: 0, stampDuty: 14_264, solicitorFees: 1_800,
      inspectionFees: 0, agentFee: 0, lmiAmount: 0, occupancyWeeks: 52, loanType: 'principal_interest',
      interestOnlyYears: 0, loanTermYears: 30, assumed: [], caseFingerprint: null, construction: null,
    });
    expect(lines[0].left).toEqual({ label: 'Purchase price', value: '$319,900' });
  });
});

describe('the planned build never re-describes the land the investment report is about', () => {
  it('keeps its figures under its own keys, never `buildPrice`', () => {
    const src = readFileSync(resolve(REPO, 'src/components/reports/CashFlowAnalysisModal.tsx'), 'utf8');
    expect(src).toContain('PLANNED_BUILD_KEYS.price');
    // The save path writes the planned keys; it never writes a build price.
    const save = src.slice(src.indexOf('const handleSaveOverrides'), src.indexOf('// Reset all overrides'));
    expect(save).not.toMatch(/\bbuildPrice\s*:/);
  });

  it('the switch lives in the cash flow analysis, on a land-only report', () => {
    const src = readFileSync(resolve(REPO, 'src/components/reports/CashFlowAnalysisModal.tsx'), 'utf8');
    expect(src).toMatch(/\{isLandOnly && \(\s*<CashFlowPlannedBuildPanel/);
  });
});
