/**
 * A build added to a land-only purchase — costed as the new build it becomes.
 *
 * A land-only report used to have no route to a construction schedule at all:
 * the build price was offered only to a report recorded as a new build, and the
 * cash flow staged a contract only where `buildType === 'new_build'`. An
 * adviser who bought a lot and meant to build on it had to re-enter the case
 * as a different kind of property to see the drawdown, the interest carried
 * during construction or a projection of the finished home.
 *
 * This module is the one statement of what "a land-only purchase with a
 * planned build" means for the ten-year cash flow. It does not add a second
 * construction method: it re-reads the case as the new build it will be and
 * hands that to the same `readBaseFinancials`, `buildConstructionSchedule`,
 * `acquisitionExpenditure` and projection every new build already uses — so the
 * schedule, the upfront costs and the ten-year table are the legacy new-build
 * process, figure for figure.
 *
 * ## What the case becomes
 *
 *  - **Land** is the land price the record states, else the price paid for
 *    the lot — on a land-only report those are the same purchase.
 *  - **Total project** is land plus the stated build contract, and it is the
 *    figure the projection starts from, exactly as a house-and-land package
 *    does (`Lot 1639 Corridale Estate`: $319,900 + $387,000 = $706,900).
 *  - **Value today** is the land's current value, where one is recorded, plus
 *    the build: a lot that has risen since it was bought keeps that rise.
 *  - **The loan is re-sized to the whole project at the case's LVR.** The
 *    loan a land-only report records is a loan against the lot; carried over,
 *    it would leave the build contract financed by nobody. The deposit is what
 *    is left.
 *  - **Stamp duty stays the land's**: duty on a house-and-land purchase falls
 *    on the land contract (`dutiableValueBasis.ts`).
 *
 * ## What it refuses
 *
 * It changes nothing unless the report is recorded as land only, the adviser
 * has said a build is planned (the toggle in the cash flow analysis), AND a
 * build contract is stated. No build price,
 * no build: a planned build with no figure would stage a schedule over a
 * number nobody recorded (QA-13), so the case stays the land it is. Every
 * other report is returned unchanged — the same object, so a caller that
 * memoises on it recomputes nothing.
 *
 * The investment report itself is not re-read: it describes the land that was
 * bought. The planned build is a question the cash flow answers.
 *
 * Pure: no clock, no I/O.
 */

/** The two jsonb columns this reads — the same shape `readBaseFinancials` takes. */
export interface PlannedBuildReport {
  // deno-lint-ignore no-explicit-any
  financial_calculations?: any;
  // deno-lint-ignore no-explicit-any
  manual_overrides?: any;
}

/** Which construction case a report is: a new build, land with a build planned, or neither. */
export type ConstructionCase = 'new_build' | 'land_with_build' | 'none';

/** The manual-override key that records a build planned on a land-only purchase. */
export const PLANNED_BUILD_OVERRIDE = 'landOnlyPlannedBuild';

/**
 * The planned build's own figures. They are kept under their OWN keys rather
 * than `buildPrice` / `constructionDurationMonths`, because the investment
 * report prints a stored `buildPrice` into its prompt whatever the build type:
 * a build contract written there would re-describe the land the report is
 * about. The cash flow reads these; nothing else does.
 */
export const PLANNED_BUILD_KEYS = Object.freeze({
  price: 'plannedBuildPrice',
  durationMonths: 'plannedBuildDurationMonths',
  weeklyRent: 'plannedBuildWeeklyRent',
} as const);

const num = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/[$,%\s]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

/** First candidate that is a positive number. */
const firstPositive = (...candidates: unknown[]): number | undefined => {
  for (const c of candidates) {
    const n = num(c);
    if (n !== undefined && n > 0) return n;
  }
  return undefined;
};

/**
 * Whether the adviser has said a build is planned. A stored override may have
 * been written by a select (`'true'`, `'yes'`) as well as a toggle.
 */
export function plannedBuildRequested(overrides: unknown): boolean {
  const raw = (overrides as Record<string, unknown> | null | undefined)?.[PLANNED_BUILD_OVERRIDE];
  if (raw === true) return true;
  if (typeof raw === 'string') return ['true', 'yes', '1'].includes(raw.trim().toLowerCase());
  return false;
}

/** The planned build contract: its own key, else a build price the record already states. */
function plannedBuildPrice(mo: Record<string, unknown>): number | undefined {
  return firstPositive(mo[PLANNED_BUILD_KEYS.price], mo.buildPrice);
}

export function constructionCaseOf(overrides: unknown): ConstructionCase {
  const mo = (overrides ?? {}) as Record<string, unknown>;
  if (mo.buildType === 'new_build') return 'new_build';
  if (mo.buildType === 'land_only' && plannedBuildRequested(mo) && plannedBuildPrice(mo) !== undefined) {
    return 'land_with_build';
  }
  return 'none';
}

/** The figures the re-read case rests on — for a surface that wants to say them. */
export interface PlannedBuildFigures {
  landPrice: number;
  buildPrice: number;
  totalProject: number;
  valueToday: number;
  /** Months to build, where the adviser stated them; else the case's own duration applies. */
  durationMonths: number | null;
  /** The rent expected once the home is built, where stated. */
  weeklyRent: number | null;
  loanToValueRatio: number;
  loanAmount: number;
  deposit: number;
}

export function plannedBuildFigures(report: PlannedBuildReport): PlannedBuildFigures | null {
  const mo = report.manual_overrides ?? {};
  if (constructionCaseOf(mo) !== 'land_with_build') return null;
  const fc = report.financial_calculations ?? {};
  const initialCosts = fc.initialCosts ?? {};
  const loanDetails = fc.loanDetails ?? {};
  const cashFlow = fc.cashFlow ?? {};

  // The same cascades `readBaseFinancials` resolves the purchase price, the
  // land and the LVR by, so the lot is the lot every other surface prints.
  const landPrice = firstPositive(
    mo.landPrice, initialCosts.landPrice, fc.landPrice,
    mo.purchasePrice, initialCosts.propertyValue, fc.purchasePrice, fc.propertyValue,
  );
  const buildPrice = plannedBuildPrice(mo);
  if (landPrice === undefined || buildPrice === undefined) return null;

  const landValueToday = firstPositive(mo.marketValueNow, cashFlow.marketValueNow) ?? landPrice;
  const lvrRaw = num(mo.loanToValueRatio) ?? num(loanDetails.lvr) ?? num(fc.loanToValueRatio) ?? 80;
  const loanToValueRatio = Math.min(Math.max(lvrRaw, 0), 100);
  const totalProject = landPrice + buildPrice;
  const loanAmount = Math.round(totalProject * (loanToValueRatio / 100));
  return {
    landPrice,
    buildPrice,
    totalProject,
    valueToday: landValueToday + buildPrice,
    durationMonths: firstPositive(mo[PLANNED_BUILD_KEYS.durationMonths]) ?? null,
    weeklyRent: firstPositive(mo[PLANNED_BUILD_KEYS.weeklyRent]) ?? null,
    loanToValueRatio,
    loanAmount,
    deposit: totalProject - loanAmount,
  };
}

/**
 * The report as the cash flow reads it. A land-only purchase with a planned
 * build becomes the new build it will be; anything else is returned as is.
 */
export function withPlannedBuild<R extends PlannedBuildReport>(report: R): R {
  const figures = plannedBuildFigures(report);
  if (!figures) return report;
  return {
    ...report,
    manual_overrides: {
      ...(report.manual_overrides ?? {}),
      buildType: 'new_build',
      // Kept so a reader can still say where the case came from.
      [PLANNED_BUILD_OVERRIDE]: true,
      landPrice: figures.landPrice,
      buildPrice: figures.buildPrice,
      purchasePrice: figures.totalProject,
      marketValueNow: figures.valueToday,
      loanToValueRatio: figures.loanToValueRatio,
      loanAmount: figures.loanAmount,
      depositValue: figures.deposit,
      ...(figures.durationMonths !== null ? { constructionDurationMonths: figures.durationMonths } : {}),
      // A lot earns no rent; the finished home does. Only a stated rent
      // replaces the record's — an unstated one leaves the projection to say
      // the rent is missing rather than run it as nothing.
      ...(figures.weeklyRent !== null ? { weeklyRent: figures.weeklyRent } : {}),
    },
  };
}
