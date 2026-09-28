/**
 * The construction progress payment schedule is the legacy export's, moved —
 * not rewritten.
 *
 * `LEGACY_REFERENCE` below is the arithmetic `CashFlowAnalysisModal` carried
 * inline until 28 Sep 2026, copied verbatim (only the React state became
 * parameters). Every generated case with valid months must produce the SAME
 * rows and totals from the shared module, to the cent. Two deliberate
 * differences are pinned separately: a stage month past the end of the build
 * is clamped into it (the inline version silently never drew that stage), and
 * a build of zero is no schedule at all.
 */
import { describe, expect, it } from 'vitest';

import {
  buildConstructionSchedule,
  CONSTRUCTION_STAGES,
  scheduleDuration,
  stageMonthsFor,
  stagePercentsFrom,
} from '../constructionSchedule.pure';

type Preset = 'rapid' | 'even' | 'custom';

/** The modal's inline algorithm, verbatim. */
function LEGACY_REFERENCE(args: {
  landPrice: number; buildPrice: number; interestRatePct: number; duration: number;
  percents: { deposit: number; slab: number; frame: number; lockup: number; fixing: number; completion: number };
  preset: Preset; custom: Record<number, number>;
}) {
  const { landPrice, buildPrice } = args;
  const interestRate = args.interestRatePct / 100;
  const durationMonths = Math.min(args.duration || 7, 24);
  const monthlyLandInterest = landPrice * interestRate / 12;
  const stagePercentages = args.percents;
  const baseStages = [
    { stage: 'Deposit', percentage: stagePercentages.deposit },
    { stage: 'Slab/Base Stage', percentage: stagePercentages.slab },
    { stage: 'Frame Stage', percentage: stagePercentages.frame },
    { stage: 'Lock-up Stage', percentage: stagePercentages.lockup },
    { stage: 'Fixing Stage', percentage: stagePercentages.fixing },
    { stage: 'Practical Completion', percentage: stagePercentages.completion },
  ];
  const getStageMonths = (): number[] => {
    if (args.preset === 'rapid') return [2, 3, 4, 5, 6, 7];
    if (args.preset === 'even') {
      const availableMonths = durationMonths - 1;
      const numStages = baseStages.length;
      const months: number[] = [];
      for (let i = 0; i < numStages; i++) {
        const month = Math.round(2 + (i * (availableMonths - 1)) / Math.max(1, numStages - 1));
        months.push(Math.min(month, durationMonths));
      }
      return months;
    }
    return baseStages.map((_, index) => args.custom[index] || (index + 2));
  };
  const stageMonths = getStageMonths();
  const monthToStages: { [month: number]: Array<{ stage: typeof baseStages[0]; index: number }> } = {};
  stageMonths.forEach((month, index) => {
    if (!monthToStages[month]) monthToStages[month] = [];
    monthToStages[month].push({ stage: baseStages[index], index });
  });
  let cumulativeDrawn = 0;
  const rows = [{
    stage: 'Land Interest Charge', percentage: 0, buildAmount: landPrice, cumulativeDrawn: 0,
    landInterest: Math.round(monthlyLandInterest * 100) / 100, buildInterest: 0,
    totalMonthlyInterest: Math.round(monthlyLandInterest * 100) / 100, month: 1,
  }];
  for (let month = 2; month <= durationMonths; month++) {
    const stagesThisMonth = monthToStages[month] || [];
    if (stagesThisMonth.length > 0) {
      stagesThisMonth.forEach((stageData) => {
        const s = stageData.stage;
        const buildAmount = (buildPrice * s.percentage) / 100;
        const isDeposit = s.stage === 'Deposit';
        cumulativeDrawn += buildAmount;
        const depositAmount = (buildPrice * stagePercentages.deposit) / 100;
        const cumulativeForInterest = isDeposit ? 0 : (cumulativeDrawn - depositAmount);
        const buildInterest = isDeposit ? 0 : (cumulativeForInterest * interestRate / 12);
        const combinedRepayment = monthlyLandInterest + buildInterest;
        rows.push({
          stage: s.stage, percentage: s.percentage,
          buildAmount: Math.round(buildAmount * 100) / 100,
          cumulativeDrawn: Math.round(cumulativeDrawn * 100) / 100,
          landInterest: Math.round(monthlyLandInterest * 100) / 100,
          buildInterest: Math.round(buildInterest * 100) / 100,
          totalMonthlyInterest: Math.round(combinedRepayment * 100) / 100,
          month,
        });
      });
    } else {
      const depositAmount = (buildPrice * stagePercentages.deposit) / 100;
      const cumulativeForInterest = Math.max(0, cumulativeDrawn - depositAmount);
      const buildInterest = cumulativeForInterest * interestRate / 12;
      const combinedRepayment = monthlyLandInterest + buildInterest;
      rows.push({
        stage: '', percentage: 0, buildAmount: 0,
        cumulativeDrawn: Math.round(cumulativeDrawn * 100) / 100,
        landInterest: Math.round(monthlyLandInterest * 100) / 100,
        buildInterest: Math.round(buildInterest * 100) / 100,
        totalMonthlyInterest: Math.round(combinedRepayment * 100) / 100,
        month,
      });
    }
  }
  const totalCombinedRepaymentRounded = rows.reduce((sum, r) => sum + (r.totalMonthlyInterest || 0), 0);
  return {
    rows,
    totalCombinedRepayment: Math.round(totalCombinedRepaymentRounded * 100) / 100,
    tenPercentLand: landPrice * 0.10,
    fivePercentBuild: buildPrice * 0.05,
  };
}

/** A deterministic generator, so a failure names a reproducible case. */
function lcg(seed: number) {
  let x = seed >>> 0;
  return () => { x = (1664525 * x + 1013904223) >>> 0; return x / 2 ** 32; };
}

describe('the schedule is the legacy arithmetic, moved', () => {
  it('matches the inline algorithm row for row, to the cent, across 3,000 generated cases', () => {
    const rnd = lcg(20260928);
    let compared = 0;
    for (let n = 0; n < 3000; n++) {
      const preset: Preset = (['rapid', 'even', 'custom'] as const)[n % 3];
      // Rapid draws months 2-7, so its builds run at least seven months — the
      // range in which the inline version drew every stage.
      const duration = preset === 'rapid' ? 7 + Math.floor(rnd() * 18) : 2 + Math.floor(rnd() * 23);
      const custom: Record<number, number> = {};
      for (let i = 0; i < 6; i++) custom[i] = 2 + Math.floor(rnd() * (duration - 1));
      const raw = [5, 15, 20, 25, 20, 15].map((p) => Math.max(0, p + Math.round((rnd() - 0.5) * 10)));
      const percents = { deposit: raw[0], slab: raw[1], frame: raw[2], lockup: raw[3], fixing: raw[4], completion: raw[5] };
      const landPrice = Math.round(rnd() * 900_000);
      const buildPrice = 150_000 + Math.round(rnd() * 900_000);
      const rate = 3 + Math.round(rnd() * 600) / 100;

      const ref = LEGACY_REFERENCE({ landPrice, buildPrice, interestRatePct: rate, duration, percents, preset, custom });
      const got = buildConstructionSchedule({
        landPrice, buildPrice, interestRate: rate, durationMonths: duration,
        stagePercents: raw, stageMonths: stageMonthsFor(preset, scheduleDuration(duration), custom),
      })!;
      expect(got.stages.map((r) => [r.stage, r.percentage, r.buildAmount, r.cumulativeDrawn, r.landInterest, r.buildInterest, r.totalMonthlyInterest, r.month]))
        .toEqual(ref.rows.map((r) => [r.stage, r.percentage, r.buildAmount, r.cumulativeDrawn, r.landInterest, r.buildInterest, r.totalMonthlyInterest, r.month]));
      expect(got.totals.totalCombinedRepayment).toBe(ref.totalCombinedRepayment);
      expect(got.upfrontCosts.tenPercentLand).toBe(ref.tenPercentLand);
      expect(got.upfrontCosts.fivePercentBuild).toBe(ref.fivePercentBuild);
      compared++;
    }
    expect(compared).toBe(3000);
  });

  it('a hand-worked case: land $520,000, build $590,000, 6.5%, twelve months evenly', () => {
    const s = buildConstructionSchedule({
      landPrice: 520_000, buildPrice: 590_000, interestRate: 6.5, durationMonths: 12,
      stagePercents: [5, 15, 20, 25, 20, 15], stageMonths: [2, 4, 6, 8, 10, 12],
    })!;
    // Land: 520,000 × 6.5% ÷ 12 = 2,816.67 every month.
    expect(s.monthlyLandInterest).toBe(2816.67);
    // Slab (month 4): drawn 5% + 15% = $118,000, less the $29,500 deposit =
    // $88,500 charged: 88,500 × 6.5% ÷ 12 = 479.38.
    expect(s.stages.find((r) => r.month === 4)!.buildInterest).toBe(479.38);
    // Practical completion (month 12): everything but the deposit, $560,500.
    expect(s.stages.find((r) => r.month === 12)!.buildInterest).toBe(3036.04);
    expect(s.totals.totalCombinedRepayment).toBe(48980.22);
    expect(s.totalProject).toBe(1_110_000);
  });

  it('the footer is the sum of the printed rows', () => {
    const s = buildConstructionSchedule({
      landPrice: 431_250, buildPrice: 377_777, interestRate: 6.37, durationMonths: 9,
      stagePercents: [5, 15, 20, 25, 20, 15], stageMonths: [2, 3, 5, 6, 8, 9],
    })!;
    const sum = s.stages.reduce((t, r) => t + r.totalMonthlyInterest, 0);
    expect(s.totals.totalCombinedRepayment).toBe(Math.round(sum * 100) / 100);
  });
});

describe('what the schedule refuses, and the two deliberate differences', () => {
  it('stages nothing where there is no build contract', () => {
    for (const buildPrice of [0, -1, Number.NaN]) {
      expect(buildConstructionSchedule({
        landPrice: 500_000, buildPrice, interestRate: 6, durationMonths: 7,
        stagePercents: [5, 15, 20, 25, 20, 15], stageMonths: [2, 3, 4, 5, 6, 7],
      })).toBeNull();
    }
  });

  it('clamps a stage month past the build into it, so every stage is drawn', () => {
    // The inline version drew a custom month past the end NOWHERE, so the
    // build contract was under-drawn and its interest understated.
    const s = buildConstructionSchedule({
      landPrice: 400_000, buildPrice: 400_000, interestRate: 6, durationMonths: 5,
      stagePercents: [5, 15, 20, 25, 20, 15], stageMonths: [2, 3, 4, 5, 6, 7],
    })!;
    expect(s.stages.reduce((t, r) => t + r.percentage, 0)).toBe(100);
    expect(Math.max(...s.stages.map((r) => r.month))).toBe(5);
  });

  it('reads the stage percentages from the report overrides, else the defaults', () => {
    expect(stagePercentsFrom(null)).toEqual(CONSTRUCTION_STAGES.map((s) => s.defaultPercent));
    expect(stagePercentsFrom({ stageFramePercent: 30, stageSlabPercent: 'x' }))
      .toEqual([5, 15, 30, 25, 20, 15]);
  });

  it('bounds the build between two and twenty-four months, seven when unrecorded', () => {
    expect(scheduleDuration(undefined)).toBe(7);
    expect(scheduleDuration(0)).toBe(7);
    expect(scheduleDuration(40)).toBe(24);
    expect(scheduleDuration(1)).toBe(2);
  });
});
