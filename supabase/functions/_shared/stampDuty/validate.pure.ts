/**
 * Invariants over duty schedules.
 *
 * Two jobs. The tests use `validateSchedule` to prove the built-in tables are
 * internally coherent — that is what catches a mistyped base amount, which is
 * otherwise invisible because a wrong number calculates just as happily as a
 * right one. The refresh job uses `assessStaleness` and `compareSchedules` to
 * decide whether a scraped table may be trusted, and specifically to refuse to
 * overwrite a client-facing tax figure with something that merely parsed.
 */

import type { AustralianState, DutyBand, DutySchedule } from './types.pure.ts';
import { DUTY_SCHEDULES } from './schedules.pure.ts';
import { evaluateScale } from './engine.pure.ts';

export interface ValidationIssue {
  state: AustralianState;
  scale: string;
  message: string;
}

/** Boundary continuity is checked to the nearest dollar; published tables round. */
const CONTINUITY_TOLERANCE = 1;

/**
 * A scale is coherent when it starts at zero, ascends, and — wherever two
 * ordinary marginal bands meet — the upper band's fixed amount equals what the
 * lower band would have charged at that boundary.
 *
 * Flat and formula bands are exempt from the continuity check because they are
 * genuinely discontinuous: the ACT's flat 4.54% is calibrated to its investor
 * scale and steps up for an owner-occupier, and that is the published position.
 * They still have to satisfy monotonicity, which is checked separately.
 */
export function validateScale(
  state: AustralianState,
  scale: string,
  bands: readonly DutyBand[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const at = (message: string) => issues.push({ state, scale, message });

  if (!bands.length) {
    at('scale has no bands');
    return issues;
  }
  if (bands[0].from !== 0) at(`first band starts at ${bands[0].from}, expected 0`);

  for (let i = 1; i < bands.length; i++) {
    const prev = bands[i - 1];
    const band = bands[i];

    if (band.from <= prev.from) {
      at(`band ${i} floor ${band.from} does not exceed the previous floor ${prev.from}`);
      continue;
    }

    const prevMode = prev.mode ?? 'marginal';
    const mode = band.mode ?? 'marginal';
    if (prevMode !== 'marginal' || mode !== 'marginal') continue;

    const carried = evaluateScale([prev], band.from);
    const declared = band.base ?? 0;
    if (Math.abs(carried - declared) > CONTINUITY_TOLERANCE) {
      at(
        `discontinuity at $${band.from.toLocaleString('en-AU')}: previous band reaches $${carried.toFixed(2)} but this band declares a base of $${declared.toLocaleString('en-AU')}`,
      );
    }
  }

  return issues;
}

/**
 * How far duty may dip as value rises before it counts as an error.
 *
 * It cannot be zero, because two published tables genuinely dip. Revenue NSW
 * rounds its band bases to whole dollars, so the $103,000 boundary declares
 * $1,662 where the band beneath reaches $1,662.50 — a 48 cent fall. The ACT's
 * flat 4.54% above $1,455,000 is calibrated to its investor scale and lands
 * about $13 under the marginal band it replaces. Both are the published
 * position and both are pinned by name in the tests.
 *
 * A tenth of that tolerance would still catch every error worth catching: a
 * mistyped base or rate moves duty by hundreds or thousands, not by tens.
 */
const MONOTONIC_TOLERANCE_PCT = 0.05;
const MONOTONIC_TOLERANCE_FLOOR = 1;

const monotonicTolerance = (previousDuty: number) =>
  Math.max(MONOTONIC_TOLERANCE_FLOOR, previousDuty * (MONOTONIC_TOLERANCE_PCT / 100));

/**
 * Duty must never meaningfully fall as value rises. This is the invariant that
 * actually catches transcription errors — a wrong rate or base usually leaves
 * the bands "joined up" arithmetically while making the curve dip somewhere.
 */
export function validateMonotonic(
  state: AustralianState,
  scale: string,
  bands: readonly DutyBand[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const probes = new Set<number>([1_000, 250_000, 900_000, 2_500_000, 6_000_000]);
  for (const band of bands) {
    for (const offset of [-1, 0, 1, 1_000]) {
      const probe = band.from + offset;
      if (probe > 0) probes.add(probe);
    }
  }

  const ordered = [...probes].sort((a, b) => a - b);
  let previousDuty = 0;
  let previousValue = 0;
  for (const value of ordered) {
    const duty = evaluateScale(bands, value);
    if (duty < previousDuty - monotonicTolerance(previousDuty)) {
      issues.push({
        state,
        scale,
        message: `duty falls from $${previousDuty.toFixed(2)} at $${previousValue.toLocaleString('en-AU')} to $${duty.toFixed(2)} at $${value.toLocaleString('en-AU')}`,
      });
    }
    previousDuty = duty;
    previousValue = value;
  }
  return issues;
}

/** Every scale a schedule carries, including concession scales. */
function scalesOf(schedule: DutySchedule): Array<{ name: string; bands: readonly DutyBand[] }> {
  const scales: Array<{ name: string; bands: readonly DutyBand[] }> = [
    { name: 'general', bands: schedule.general },
  ];
  if (schedule.ownerOccupier) scales.push({ name: 'ownerOccupier', bands: schedule.ownerOccupier });
  if (schedule.premium) scales.push({ name: 'premium', bands: schedule.premium.bands });
  for (const [category, concession] of Object.entries(schedule.firstHome)) {
    if (concession.kind === 'scale') scales.push({ name: `firstHome.${category}`, bands: concession.bands });
  }
  return scales;
}

export function validateSchedule(schedule: DutySchedule): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const { name, bands } of scalesOf(schedule)) {
    // A premium scale legitimately starts at its threshold rather than zero, and
    // a concession scale is only ever consulted below its ceiling.
    if (name !== 'premium') issues.push(...validateScale(schedule.state, name, bands));
    issues.push(...validateMonotonic(schedule.state, name, bands));
  }

  if (schedule.foreignSurchargePct < 0 || schedule.foreignSurchargePct > 20) {
    issues.push({
      state: schedule.state,
      scale: 'foreignSurcharge',
      message: `implausible foreign surcharge of ${schedule.foreignSurchargePct}%`,
    });
  }

  if (!/^\d{4}-\d{2}$/.test(schedule.year)) {
    issues.push({ state: schedule.state, scale: 'meta', message: `malformed financial year "${schedule.year}"` });
  }
  if (Number.isNaN(Date.parse(schedule.effectiveFrom))) {
    issues.push({ state: schedule.state, scale: 'meta', message: `malformed effectiveFrom "${schedule.effectiveFrom}"` });
  }
  if (!schedule.sourceUrl) {
    issues.push({ state: schedule.state, scale: 'meta', message: 'schedule has no source URL' });
  }

  return issues;
}

export function validateAllSchedules(): ValidationIssue[] {
  return Object.values(DUTY_SCHEDULES).flatMap(validateSchedule);
}

/** Australian financial year label for a date — `2026-27` from 1 July 2026. */
export function financialYearOf(date: Date): string {
  const year = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= 6 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export interface StalenessReport {
  state: AustralianState;
  scheduleYear: string;
  currentYear: string;
  /** True only for jurisdictions that re-index annually and have rolled over. */
  stale: boolean;
  message: string;
}

/**
 * Whether a schedule has been overtaken by an indexation date.
 *
 * Only meaningful for `indexedAnnually` jurisdictions. A Victorian schedule
 * dated 2021 is not stale — Victoria has not changed its general rates since —
 * whereas an NSW schedule one financial year behind is wrong on every band.
 */
export function assessStaleness(schedule: DutySchedule, now: Date): StalenessReport {
  const currentYear = financialYearOf(now);
  const stale = schedule.indexedAnnually && schedule.year !== currentYear;
  return {
    state: schedule.state,
    scheduleYear: schedule.year,
    currentYear,
    stale,
    message: stale
      ? `${schedule.state} re-indexes every 1 July and this schedule is for ${schedule.year}, not ${currentYear} — re-check ${schedule.sourceUrl}`
      : `${schedule.state} schedule ${schedule.year} is current`,
  };
}

export function assessAllStaleness(now: Date): StalenessReport[] {
  return Object.values(DUTY_SCHEDULES).map((schedule) => assessStaleness(schedule, now));
}

export interface ScheduleDrift {
  state: AustralianState;
  /** Largest absolute dollar difference across the probe values. */
  maxDollarDelta: number;
  /** Largest relative difference, as a percentage of the built-in figure. */
  maxPercentDelta: number;
  /** The probe value at which the largest relative difference occurred. */
  atValue: number;
  samples: Array<{ value: number; builtIn: number; candidate: number }>;
}

/** Prices spanning the bands anyone in this business actually transacts at. */
const DRIFT_PROBES = [
  350_000, 500_000, 650_000, 750_000, 850_000, 1_000_000,
  1_250_000, 1_500_000, 2_000_000, 3_000_000, 4_500_000,
];

/**
 * How far a candidate schedule departs from the built-in one, measured in duty
 * rather than in table structure — two tables can look different and assess
 * identically, and a single mistyped digit can look identical and assess wildly.
 *
 * The refresh job uses this to decide whether a scrape is a plausible
 * indexation (small, uniform movement) or a parse failure (wild or erratic).
 */
export function compareSchedules(builtIn: DutySchedule, candidate: DutySchedule): ScheduleDrift {
  let maxDollarDelta = 0;
  let maxPercentDelta = 0;
  let atValue = 0;
  const samples: ScheduleDrift['samples'] = [];

  for (const value of DRIFT_PROBES) {
    const a = evaluateScale(builtIn.general, value);
    const b = evaluateScale(candidate.general, value);
    samples.push({ value, builtIn: Math.round(a), candidate: Math.round(b) });

    const dollarDelta = Math.abs(a - b);
    const percentDelta = a > 0 ? (dollarDelta / a) * 100 : dollarDelta > 0 ? Infinity : 0;
    if (dollarDelta > maxDollarDelta) maxDollarDelta = dollarDelta;
    if (percentDelta > maxPercentDelta) {
      maxPercentDelta = percentDelta;
      atValue = value;
    }
  }

  return {
    state: builtIn.state,
    maxDollarDelta: Math.round(maxDollarDelta),
    maxPercentDelta: Math.round(maxPercentDelta * 100) / 100,
    atValue,
    samples,
  };
}

/**
 * Drift beyond this is treated as a parse failure rather than a rate change.
 * Annual indexation moves duty by well under a percent; NSW's 2025-26 → 2026-27
 * re-index moved it by about 1%. A scrape that disagrees by more than this has
 * almost certainly misread the page, and the built-in table stands.
 */
export const DRIFT_REVIEW_THRESHOLD_PCT = 5;
