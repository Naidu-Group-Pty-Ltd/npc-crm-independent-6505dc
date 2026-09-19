/**
 * The macro-economic reading served to reports, composed from stored RBA
 * statistical-table observations (`rba_observations` / `rba_series_meta`,
 * loaded by rba-tables-ingest) — replacing a path that asked a search model
 * for "exact current values" and coerced whatever came back with `|| 0`.
 *
 * Rules:
 *  - **Every figure carries its own reference period**, read from the
 *    observation's date — "4.35% (monthly average, August 2026)" — because
 *    freshness of a load is not currency of the data.
 *  - **The cash-rate month is a monthly average, never a decision date.**
 *    F1.1's own Description row says "Cash Rate Target; monthly average";
 *    the old path invented `lastDecisionDate` (defaulting to *today*). The
 *    honest derivable fact is the month the monthly average last moved,
 *    which is arithmetic on the series and is labelled as exactly that.
 *  - **Absent is absent**: a series with no stored observation contributes
 *    no figure, and nothing here fills a gap with a plausible number. GDP,
 *    unemployment and participation are not in these tables and are
 *    deliberately not in this reading.
 *  - **A projection is an assumption and says so.** The 10-year CPI path
 *    the financial engine indexes against converges from the measured
 *    year-ended CPI toward the RBA target midpoint; every year's `source`
 *    names it an assumption. The old labels claimed "RBA SMP forecast" for
 *    numbers no one had read from any forecast.
 */

export interface RbaMetaRow {
  series_id: string;
  table_code: string;
  title: string | null;
  description: string | null;
  units: string | null;
  publication_date: string | null;
}

export interface RbaObsRow {
  series_id: string;
  /** ISO date (YYYY-MM-DD). */
  obs_date: string;
  value: number;
}

/** A measured figure with its own reference period. */
export interface MacroFigure {
  value: number;
  /** '2026-08' for monthly series, '2026-06' (quarter-end month) for quarterly. */
  period: string;
  /** 'August 2026' / 'June quarter 2026' — for prose and table cells. */
  periodLabel: string;
}

/**
 * The cash rate target in force, and the day it took effect.
 *
 * This is a DIFFERENT FACT from `cashRate` below, and the difference is the
 * whole reason this exists. `cashRate` is F1.1's `FIRMMCRT` — "Cash Rate
 * Target; monthly average" — so in a month containing a Board change it is
 * an average of two targets and equals neither (4.31, 3.96, 3.83 and 3.70 all
 * appear in the series, and no Board ever set them). Presenting it as "the
 * current cash rate" states a number the RBA never announced.
 *
 * `cashRateTarget` is F1's `FIRMMCRTD` — the target ON A DATE — paired with
 * `FIRMMCCRT`, the RBA's own "as announced" change column. The effective date
 * is therefore read from the publisher, never inferred by differencing values.
 */
export interface CashRateTarget {
  /** Per cent, as announced. */
  percent: number;

  /**
   * The date the CURRENT target took effect — the most recent Board decision,
   * whether or not it moved the rate.
   *
   * This is the RBA's own published "effective date" and it comes from the
   * decision history, never from F1. F1's `FIRMMCCRT` records only non-zero
   * changes, so deriving this from F1 answers `lastChangedDate` instead: on
   * 11 Sep 2026 that would have said 6 May 2026 where the RBA publishes
   * 12 August 2026, because the Board met twice more and held.
   */
  effectiveDate: string;
  /** '12 August 2026' — for prose. */
  effectiveLabel: string;

  /** The date the target last MOVED. A different fact; often much older. */
  lastChangedDate: string;
  lastChangedLabel: string;
  /** Percentage points of that move. Never 0 — a 0 is a hold, not a change. */
  lastChangePoints: number;

  /**
   * How many decisions have held the rate since it last moved. 0 means the
   * current effective date IS the change date.
   */
  decisionsSinceChange: number;

  /** The latest date a loaded source carries the target for, where one exists. */
  asAtDate: string | null;
  asAtLabel: string | null;

  seriesId: string | null;
  tableCode: string | null;
  /** The series' own Description, verbatim, where F1 is loaded. */
  basis: string;
  publicationDate: string | null;
  source: string;
  /** Named separately because the effective date's authority is not F1's. */
  effectiveDateSource: string;
}

export interface MacroReading {
  /** In-force target with its effective date, or null when F1 is not loaded. */
  cashRateTarget: CashRateTarget | null;
  cashRate: {
    current: MacroFigure;
    /** The series' own Description ("Cash Rate Target; monthly average"). */
    basis: string;
    /** The month the monthly average last moved — arithmetic, not a board date. */
    lastMove: { periodLabel: string; from: number; to: number } | null;
    publicationDate: string | null;
    source: string;
  } | null;
  inflation: {
    yearEnded: MacroFigure | null;
    trimmedMeanYearEnded: MacroFigure | null;
    quarterly: MacroFigure | null;
    index: (MacroFigure & { base: string }) | null;
    /** The RBA's published medium-term target — a fact about the target, not a reading. */
    targetBand: string;
    publicationDate: string | null;
    source: string;
  } | null;
  lendingRates: {
    ownerOccupier: {
      standardVariable: MacroFigure | null;
      discountedVariable: MacroFigure | null;
      threeYearFixed: MacroFigure | null;
    };
    investor: {
      standardVariable: MacroFigure | null;
      discountedVariable: MacroFigure | null;
      threeYearFixed: MacroFigure | null;
    };
    basis: string;
    publicationDate: string | null;
    source: string;
  } | null;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** 'August 2026' from a monthly observation's date. */
export function monthLabel(isoDate: string): string {
  const [y, m] = isoDate.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/** 'June quarter 2026' from a quarter-end observation's date (ABS wording). */
export function quarterLabel(isoDate: string): string {
  return `${monthLabel(isoDate).replace(' ', ' quarter ')}`;
}

const period = (isoDate: string): string => isoDate.slice(0, 7);

function latestOf(obs: RbaObsRow[], seriesId: string): RbaObsRow | null {
  let best: RbaObsRow | null = null;
  for (const o of obs) {
    if (o.series_id !== seriesId) continue;
    if (!Number.isFinite(o.value)) continue;
    if (!best || o.obs_date > best.obs_date) best = o;
  }
  return best;
}

const monthly = (obs: RbaObsRow[], id: string): MacroFigure | null => {
  const o = latestOf(obs, id);
  return o ? { value: o.value, period: period(o.obs_date), periodLabel: monthLabel(o.obs_date) } : null;
};

const quarterly = (obs: RbaObsRow[], id: string): MacroFigure | null => {
  const o = latestOf(obs, id);
  return o ? { value: o.value, period: period(o.obs_date), periodLabel: quarterLabel(o.obs_date) } : null;
};

/**
 * The month the series' value last differed from the month before it —
 * found by walking the ordered series, never asserted from anywhere else.
 * Null when the series never moves in the window supplied.
 */
export function lastMoveOf(obs: RbaObsRow[], seriesId: string): { periodLabel: string; from: number; to: number } | null {
  const series = obs
    .filter((o) => o.series_id === seriesId && Number.isFinite(o.value))
    .sort((a, b) => (a.obs_date < b.obs_date ? -1 : 1));
  for (let i = series.length - 1; i >= 1; i--) {
    if (series[i].value !== series[i - 1].value) {
      return { periodLabel: monthLabel(series[i].obs_date), from: series[i - 1].value, to: series[i].value };
    }
  }
  return null;
}

/** A row of `public.rba_cash_rate_decisions`, as the service reads it. */
export interface CashRateDecisionRow {
  effective_date: string;
  change_points: number | null;
  target_percent: number | null;
}

const metaOf = (meta: RbaMetaRow[], id: string): RbaMetaRow | null =>
  meta.find((m) => m.series_id === id) ?? null;

/** '6 May 2026' from an ISO date — the effective date said the way a person says it. */
export function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  const month = MONTHS[Number(m) - 1];
  if (!month) return isoDate;
  return `${Number(d)} ${month} ${y}`;
}

/**
 * The cash rate target in force, read from F1 rather than inferred.
 *
 * Fails CLOSED — returns null — rather than answering approximately, because
 * the caller's alternative is F1.1's monthly average and presenting that as
 * the current target is precisely the defect this exists to close. Null on
 * any of: F1 not loaded, no target observations, no announced change in the
 * window, or the target on the effective date disagreeing with the target on
 * the latest date. That last one is the important one: it means the change
 * column and the level column no longer describe the same step, and a
 * disagreement between two columns of one file is never something to average.
 */
export function cashRateTargetOf(
  meta: RbaMetaRow[],
  obs: RbaObsRow[],
  decisions: readonly CashRateDecisionRow[] = [],
): CashRateTarget | null {
  // The decision history is the authority. Without it there is no effective
  // date to state, and F1's last-change date is NOT a substitute for one — so
  // this returns null rather than reporting a different fact under this name.
  const ordered = decisions
    .filter((d) => typeof d.effective_date === 'string' && d.effective_date !== ''
      && typeof d.target_percent === 'number' && Number.isFinite(d.target_percent))
    .sort((a, b) => (a.effective_date < b.effective_date ? -1 : 1));
  if (ordered.length === 0) return null;

  const current = ordered[ordered.length - 1];
  const percent = current.target_percent as number;

  // Walk back to the most recent decision that actually moved the rate.
  let lastChanged: CashRateDecisionRow | null = null;
  let held = 0;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const change = ordered[i].change_points;
    if (typeof change === 'number' && Number.isFinite(change) && change !== 0) {
      lastChanged = ordered[i];
      break;
    }
    held++;
  }
  // A history whose every decision is a hold cannot say when the rate last
  // moved, and inventing one is the defect this whole module exists to close.
  if (!lastChanged) return null;
  // `held` counted the current decision too when the current one is itself a
  // hold; the change decision is not a hold, so subtract nothing else.
  const decisionsSinceChange = Math.max(0, held - (current.change_points === 0 ? 0 : 1));

  // F1, where loaded, is a cross-check on the VALUE only — never on the date.
  const targets = obs
    .filter((o) => o.series_id === 'FIRMMCRTD' && Number.isFinite(o.value))
    .sort((a, b) => (a.obs_date < b.obs_date ? -1 : 1));
  const latestF1 = targets.length > 0 ? targets[targets.length - 1] : null;
  if (latestF1 && latestF1.value !== percent) {
    // Two official RBA sources disagreeing about the rate in force is not
    // something to average or to pick a winner from.
    return null;
  }

  const targetMeta = metaOf(meta, 'FIRMMCRTD');
  return {
    percent,
    effectiveDate: current.effective_date,
    effectiveLabel: dayLabel(current.effective_date),
    lastChangedDate: lastChanged.effective_date,
    lastChangedLabel: dayLabel(lastChanged.effective_date),
    lastChangePoints: lastChanged.change_points as number,
    decisionsSinceChange,
    asAtDate: latestF1 ? latestF1.obs_date : null,
    asAtLabel: latestF1 ? dayLabel(latestF1.obs_date) : null,
    seriesId: latestF1 ? 'FIRMMCRTD' : null,
    tableCode: latestF1 ? 'f1' : null,
    basis: targetMeta?.description ?? 'Cash Rate Target on date',
    publicationDate: targetMeta?.publication_date ?? null,
    source: latestF1
      ? 'RBA Cash Rate Target decision history, cross-checked against statistical table F1'
      : 'RBA Cash Rate Target decision history',
    effectiveDateSource: 'RBA Cash Rate Target decision history',
  };
}

/**
 * Compose the reading. Null only when nothing at all is loaded; otherwise
 * each component is present exactly where its series holds observations.
 */
export function buildMacroReading(
  meta: RbaMetaRow[],
  obs: RbaObsRow[],
  decisions: readonly CashRateDecisionRow[] = [],
): MacroReading | null {
  const cash = monthly(obs, 'FIRMMCRT');
  const cashMeta = metaOf(meta, 'FIRMMCRT');

  const yearEnded = quarterly(obs, 'GCPIAGYP');
  const trimmed = quarterly(obs, 'GCPIOCPMTMYP');
  const qtr = quarterly(obs, 'GCPIAGSAQP');
  const indexFig = quarterly(obs, 'GCPIAG');
  const indexMeta = metaOf(meta, 'GCPIAG');
  const g1Meta = metaOf(meta, 'GCPIAGYP') ?? indexMeta;

  const ooStd = monthly(obs, 'FILRHLBVS');
  const ooDisc = monthly(obs, 'FILRHLBVD');
  const ooFixed = monthly(obs, 'FILRHL3YF');
  const invStd = monthly(obs, 'FILRHLBVSI');
  const invDisc = monthly(obs, 'FILRHLBVDI');
  const invFixed = monthly(obs, 'FILRHL3YFI');
  const f5Meta = metaOf(meta, 'FILRHLBVS');

  const cashRateTarget = cashRateTargetOf(meta, obs, decisions);

  const cashRate = cash
    ? {
      current: cash,
      basis: cashMeta?.description ?? 'Cash Rate Target; monthly average',
      lastMove: lastMoveOf(obs, 'FIRMMCRT'),
      publicationDate: cashMeta?.publication_date ?? null,
      source: 'RBA statistical table F1.1',
    }
    : null;

  const inflation = (yearEnded || trimmed || qtr || indexFig)
    ? {
      yearEnded,
      trimmedMeanYearEnded: trimmed,
      quarterly: qtr,
      index: indexFig && indexMeta?.units ? { ...indexFig, base: indexMeta.units } : null,
      targetBand: '2–3 per cent',
      publicationDate: g1Meta?.publication_date ?? null,
      source: 'RBA statistical table G1 (ABS Consumer Price Index)',
    }
    : null;

  const anyLending = ooStd || ooDisc || ooFixed || invStd || invDisc || invFixed;
  const lendingRates = anyLending
    ? {
      ownerOccupier: { standardVariable: ooStd, discountedVariable: ooDisc, threeYearFixed: ooFixed },
      investor: { standardVariable: invStd, discountedVariable: invDisc, threeYearFixed: invFixed },
      basis: 'Banks’ indicator housing lending rates',
      publicationDate: f5Meta?.publication_date ?? null,
      source: 'RBA statistical table F5',
    }
    : null;

  if (!cashRateTarget && !cashRate && !inflation && !lendingRates) return null;
  return { cashRateTarget, cashRate, inflation, lendingRates };
}

// ---------------------------------------------------------------------------
// The 10-year CPI path the financial engine indexes against
// ---------------------------------------------------------------------------

export interface CpiProjectionYear {
  year: number;
  cpiPercent: number;
  source: string;
}

export const RBA_TARGET_MIDPOINT = 2.5;

/**
 * A named assumption, not a forecast: converge from the measured year-ended
 * CPI toward the RBA target midpoint (the same arithmetic the old path used
 * as its silent fallback — kept because it is a reasonable indexation
 * assumption, and now labelled as one on every year). With no measured CPI
 * the path is flat at the target midpoint and says that too.
 */
export function cpiProjectionsFromMeasured(measured: MacroFigure | null): CpiProjectionYear[] {
  const years = Array.from({ length: 10 }, (_, i) => i + 1);
  if (!measured) {
    return years.map((year) => ({
      year,
      cpiPercent: RBA_TARGET_MIDPOINT,
      source: 'Assumption — RBA inflation target midpoint of 2.5% (no measured CPI reading was available)',
    }));
  }
  const label =
    `Assumption — convergence from measured year-ended CPI (${measured.value}%, ${measured.periodLabel}) toward the RBA inflation target midpoint of 2.5%`;
  return years.map((year) => {
    const convergence = 1 - Math.pow(0.8, year);
    const projected = measured.value + (RBA_TARGET_MIDPOINT - measured.value) * convergence;
    return { year, cpiPercent: Math.round(projected * 10) / 10, source: label };
  });
}
