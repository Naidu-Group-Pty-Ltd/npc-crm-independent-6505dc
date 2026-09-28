/**
 * The construction progress payment schedule of a new build — one
 * implementation, read by the on-screen analysis, the legacy jsPDF export and
 * the typeset document.
 *
 * It used to live inside `CashFlowAnalysisModal`'s `useMemo`, which meant the
 * typeset document (`render-cash-flow-pdf`) could not print it at all: a new
 * build's cash flow came out as though it were an established house, with no
 * land/build split, no staged drawdown and no construction interest in the
 * totals. Moving it here is a MOVE, not a rewrite — every figure is the one the
 * legacy export printed, and `constructionSchedule.spec.ts` pins the legacy
 * arithmetic against a hand-worked case.
 *
 * ## The method, as the legacy export states it
 *
 *  - Month 1 is the **land interest charge**: the land is settled and financed
 *    in full, so `land × rate ÷ 12` is paid every month of the build.
 *  - The build contract is drawn in six stages (deposit, slab, frame, lock-up,
 *    fixing, practical completion) at the months a preset or the adviser
 *    chooses. The **deposit is paid from the buyer's funds**, so it attracts no
 *    interest; every later stage adds its drawdown to the balance the lender
 *    charges on: `(drawn − deposit) × rate ÷ 12`.
 *  - A month with no stage still carries interest on what has been drawn.
 *  - Totals are the sums of the ROUNDED rows, so a reader adding the printed
 *    column gets the printed total.
 *
 * Pure: no clock, no I/O.
 */

/** One row of the schedule. A month with no stage has an empty `stage`. */
export interface ConstructionScheduleRow {
  stage: string;
  description: string;
  /** Percentage of the build contract drawn at this stage; 0 on an interest-only row. */
  percentage: number;
  /** The drawdown. On the land row, the land price (what the interest is charged on). */
  buildAmount: number;
  cumulativeDrawn: number;
  landInterest: number;
  buildInterest: number;
  totalMonthlyInterest: number;
  month: number;
}

export interface ConstructionSchedule {
  landPrice: number;
  buildPrice: number;
  totalProject: number;
  /** Percent-scaled, as recorded: `6.5` is six and a half percent. */
  interestRate: number;
  durationMonths: number;
  stages: ConstructionScheduleRow[];
  monthlyLandInterest: number;
  totals: {
    landInterest: number;
    buildInterest: number;
    totalInterest: number;
    /** Land plus build interest over the build — the figure the upfront costs carry. */
    totalCombinedRepayment: number;
  };
  upfrontCosts: {
    tenPercentLand: number;
    fivePercentBuild: number;
  };
}

/** The six stages of a build contract, in the order they are drawn. */
export const CONSTRUCTION_STAGES = [
  { key: 'deposit', stage: 'Deposit', description: 'Paid from your funds (not from lender)', defaultPercent: 5 },
  { key: 'slab', stage: 'Slab/Base Stage', description: 'Foundation, slab, ground works', defaultPercent: 15 },
  { key: 'frame', stage: 'Frame Stage', description: 'Wall frames, roof trusses, structural frame', defaultPercent: 20 },
  { key: 'lockup', stage: 'Lock-up Stage', description: 'External walls, windows, doors (can "lock up")', defaultPercent: 25 },
  { key: 'fixing', stage: 'Fixing Stage', description: 'Internal linings, plaster, cabinets, fittings', defaultPercent: 20 },
  { key: 'completion', stage: 'Practical Completion', description: 'Final works, painting, finishes', defaultPercent: 15 },
] as const;

export type ConstructionStageKey = typeof CONSTRUCTION_STAGES[number]['key'];

/** The manual-override field that carries each stage's percentage. */
export const STAGE_PERCENT_OVERRIDE: Readonly<Record<ConstructionStageKey, string>> = Object.freeze({
  deposit: 'stageDepositPercent',
  slab: 'stageSlabPercent',
  frame: 'stageFramePercent',
  lockup: 'stageLockupPercent',
  fixing: 'stageFixingPercent',
  completion: 'stageCompletionPercent',
});

export type SchedulePreset = 'rapid' | 'even' | 'custom';

/** The longest build this schedule will stage. */
export const MAX_CONSTRUCTION_MONTHS = 24;
/** A build nobody gave a duration to. */
export const DEFAULT_CONSTRUCTION_MONTHS = 7;

const round2 = (n: number) => Math.round(n * 100) / 100;
const finite = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The build duration the schedule runs over: recorded, else seven months, never past two years. */
export function scheduleDuration(recorded: unknown): number {
  const n = finite(recorded);
  const months = n && n > 0 ? Math.round(n) : DEFAULT_CONSTRUCTION_MONTHS;
  return Math.max(2, Math.min(months, MAX_CONSTRUCTION_MONTHS));
}

/**
 * The six stage percentages, from the report's manual overrides where it
 * states them, else the defaults. A value that is not a number is the default.
 */
export function stagePercentsFrom(overrides: Record<string, unknown> | null | undefined): number[] {
  return CONSTRUCTION_STAGES.map((s) => {
    const n = finite(overrides?.[STAGE_PERCENT_OVERRIDE[s.key]]);
    return n === null ? s.defaultPercent : n;
  });
}

/**
 * The month each of the six stages is drawn in.
 *
 *  - `rapid`: months 2 to 7, fixed — the legacy default.
 *  - `even`: the six stages spread over months 2 to the last month.
 *  - `custom`: the adviser's months, a stage with none falling back to its
 *    `rapid` month.
 *
 * Every month is clamped to the build, so a custom month past the last one is
 * the last one rather than a stage that is never drawn.
 */
export function stageMonthsFor(
  preset: SchedulePreset | string | null | undefined,
  durationMonths: number,
  custom?: Record<number | string, unknown> | null,
): number[] {
  const n = CONSTRUCTION_STAGES.length;
  let months: number[];
  if (preset === 'even') {
    const available = durationMonths - 1;
    months = Array.from({ length: n }, (_, i) =>
      Math.min(Math.round(2 + (i * (available - 1)) / Math.max(1, n - 1)), durationMonths));
  } else if (preset === 'custom') {
    months = Array.from({ length: n }, (_, i) => {
      const m = finite(custom?.[i]);
      return m && m > 0 ? Math.round(m) : i + 2;
    });
  } else {
    months = [2, 3, 4, 5, 6, 7];
  }
  return months.map((m) => Math.max(2, Math.min(m, durationMonths)));
}

export interface ConstructionScheduleInput {
  landPrice: number;
  buildPrice: number;
  /** Percent-scaled. */
  interestRate: number;
  durationMonths: number;
  /** Six percentages, in `CONSTRUCTION_STAGES` order. */
  stagePercents: readonly number[];
  /** Six months, in `CONSTRUCTION_STAGES` order. */
  stageMonths: readonly number[];
}

/**
 * The schedule, or null where there is no build to stage.
 *
 * A build price of zero or less is not a build contract, and a schedule over it
 * would print a table of zeroes under a heading promising a drawdown.
 */
export function buildConstructionSchedule(input: ConstructionScheduleInput): ConstructionSchedule | null {
  const buildPrice = finite(input.buildPrice) ?? 0;
  if (!(buildPrice > 0)) return null;
  const landPrice = Math.max(0, finite(input.landPrice) ?? 0);
  const ratePct = finite(input.interestRate) ?? 0;
  const rate = ratePct / 100;
  const durationMonths = scheduleDuration(input.durationMonths);
  const percents = CONSTRUCTION_STAGES.map((s, i) => finite(input.stagePercents[i]) ?? s.defaultPercent);
  const months = CONSTRUCTION_STAGES.map((_, i) => {
    const m = finite(input.stageMonths[i]);
    return Math.max(2, Math.min(m && m > 0 ? Math.round(m) : i + 2, durationMonths));
  });

  const monthlyLandInterest = (landPrice * rate) / 12;
  const depositAmount = (buildPrice * percents[0]) / 100;

  const byMonth = new Map<number, number[]>();
  months.forEach((m, i) => byMonth.set(m, [...(byMonth.get(m) ?? []), i]));

  const rows: ConstructionScheduleRow[] = [{
    stage: 'Land Interest Charge',
    description: '',
    percentage: 0,
    buildAmount: landPrice,
    cumulativeDrawn: 0,
    landInterest: round2(monthlyLandInterest),
    buildInterest: 0,
    totalMonthlyInterest: round2(monthlyLandInterest),
    month: 1,
  }];

  let cumulativeDrawn = 0;
  for (let month = 2; month <= durationMonths; month++) {
    const stagesThisMonth = byMonth.get(month) ?? [];
    if (stagesThisMonth.length) {
      for (const index of stagesThisMonth) {
        const s = CONSTRUCTION_STAGES[index];
        const buildAmount = (buildPrice * percents[index]) / 100;
        const isDeposit = index === 0;
        cumulativeDrawn += buildAmount;
        const forInterest = isDeposit ? 0 : cumulativeDrawn - depositAmount;
        const buildInterest = isDeposit ? 0 : (forInterest * rate) / 12;
        rows.push({
          stage: s.stage,
          description: s.description,
          percentage: percents[index],
          buildAmount: round2(buildAmount),
          cumulativeDrawn: round2(cumulativeDrawn),
          landInterest: round2(monthlyLandInterest),
          buildInterest: round2(buildInterest),
          totalMonthlyInterest: round2(monthlyLandInterest + buildInterest),
          month,
        });
      }
    } else {
      const forInterest = Math.max(0, cumulativeDrawn - depositAmount);
      const buildInterest = (forInterest * rate) / 12;
      rows.push({
        stage: '',
        description: '',
        percentage: 0,
        buildAmount: 0,
        cumulativeDrawn: round2(cumulativeDrawn),
        landInterest: round2(monthlyLandInterest),
        buildInterest: round2(buildInterest),
        totalMonthlyInterest: round2(monthlyLandInterest + buildInterest),
        month,
      });
    }
  }

  // Sums of the ROUNDED rows, so the footer equals the visible column.
  const landTotal = rows.reduce((s, r) => s + r.landInterest, 0);
  const buildTotal = rows.reduce((s, r) => s + r.buildInterest, 0);
  const combinedTotal = rows.reduce((s, r) => s + r.totalMonthlyInterest, 0);

  return {
    landPrice,
    buildPrice,
    totalProject: landPrice + buildPrice,
    interestRate: ratePct,
    durationMonths,
    stages: rows,
    monthlyLandInterest: round2(monthlyLandInterest),
    totals: {
      landInterest: round2(landTotal),
      buildInterest: round2(buildTotal),
      totalInterest: round2(landTotal + buildTotal),
      totalCombinedRepayment: round2(combinedTotal),
    },
    upfrontCosts: {
      tenPercentLand: landPrice * 0.10,
      fivePercentBuild: buildPrice * 0.05,
    },
  };
}
