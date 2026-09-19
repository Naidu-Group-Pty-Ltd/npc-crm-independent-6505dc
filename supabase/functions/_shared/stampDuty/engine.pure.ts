/**
 * The duty calculation itself. Pure, synchronous, no IO.
 *
 * Everything jurisdiction-specific lives in `schedules.pure.ts`; this module
 * only knows how to walk a scale and how the five shapes of first-home relief
 * behave. That split is the point — adding a state or changing a rate should
 * never require touching this file.
 */

import type {
  Concession,
  DutyBand,
  DutySchedule,
  PropertyCategory,
  StampDutyBreakdown,
  StampDutyInput,
} from './types.pure.ts';
import { DUTY_SCHEDULES } from './schedules.pure.ts';

/** NT's coefficient. Published to eight decimal places; do not round it. */
const NT_QUADRATIC_COEFFICIENT = 0.06571441;

/** The band governing `value` — the last one whose floor it reaches. */
function bandFor(bands: readonly DutyBand[], value: number): DutyBand | undefined {
  let match: DutyBand | undefined;
  for (const band of bands) {
    if (value >= band.from) match = band;
    else break;
  }
  return match ?? bands[0];
}

/**
 * Duty payable on `value` under `bands`, unrounded.
 *
 * Returns 0 for a non-positive value before any minimum is considered — a $20
 * NSW minimum on a $0 property would be an artefact, not a rule.
 */
export function evaluateScale(bands: readonly DutyBand[], value: number): number {
  if (!bands.length || value <= 0) return 0;

  const band = bandFor(bands, value);
  if (!band) return 0;

  let duty: number;
  switch (band.mode ?? 'marginal') {
    case 'flat':
      // Rate applies to the entire dutiable value, not the excess.
      duty = value * ((band.rate ?? 0) / 100);
      break;
    case 'nt_quadratic': {
      const v = value / 1000;
      duty = NT_QUADRATIC_COEFFICIENT * v * v + 15 * v;
      break;
    }
    default:
      duty = (band.base ?? 0) + (value - band.from) * ((band.rate ?? 0) / 100);
      break;
  }

  if (band.min !== undefined) duty = Math.max(band.min, duty);
  return Math.max(0, duty);
}

/**
 * Which scale governs this purchase.
 *
 * Order matters. NSW's premium scale supersedes everything for residential land
 * above its threshold, and an owner-occupier concession that has run out of
 * headroom (VIC above $550k, WA above $200k) falls back to general rates on the
 * whole value rather than tapering.
 */
export function selectScale(
  schedule: DutySchedule,
  dutiableValue: number,
  intent: StampDutyInput['intent'],
): { bands: readonly DutyBand[]; label: string } {
  if (schedule.premium && dutiableValue > schedule.premium.from) {
    return { bands: schedule.premium.bands, label: 'premium' };
  }

  const ceiling = schedule.ownerOccupierUpTo;
  const withinCeiling = ceiling === undefined || dutiableValue <= ceiling;
  if (intent === 'owner_occupier' && schedule.ownerOccupier && withinCeiling) {
    return { bands: schedule.ownerOccupier, label: 'owner-occupier' };
  }

  return { bands: schedule.general, label: 'general' };
}

function concessionFor(schedule: DutySchedule, category: PropertyCategory): Concession {
  switch (category) {
    case 'new': return schedule.firstHome.newHome;
    case 'vacant_land': return schedule.firstHome.vacantLand;
    default: return schedule.firstHome.established;
  }
}

/**
 * Dollars of first-home relief, never more than the duty it is relieving.
 *
 * `baseDuty` is the duty already assessed on the applicable scale — for
 * Queensland that is home-concession duty, which is what its fixed rebate is
 * designed to be subtracted from.
 */
export function concessionSaving(
  concession: Concession,
  value: number,
  baseDuty: number,
): number {
  const cap = (saving: number) => Math.max(0, Math.min(baseDuty, saving));

  switch (concession.kind) {
    case 'none':
      return 0;

    case 'exempt_all':
      return cap(baseDuty);

    case 'exempt_to_taper': {
      if (value <= concession.fullTo) return cap(baseDuty);
      if (value >= concession.taperTo) return 0;
      const span = concession.taperTo - concession.fullTo;
      if (span <= 0) return 0;
      const remaining = (concession.taperTo - value) / span;
      return cap(baseDuty * remaining);
    }

    case 'fixed_steps': {
      for (const step of concession.steps) {
        if (value < step.under) return cap(step.amount);
      }
      return 0;
    }

    case 'scale': {
      if (value > concession.appliesUpTo) return 0;
      return cap(baseDuty - evaluateScale(concession.bands, value));
    }

    case 'percent': {
      if (value > concession.upTo) return 0;
      return cap(baseDuty * (concession.pct / 100));
    }

    default:
      return 0;
  }
}

function emptyBreakdown(input: StampDutyInput, schedule?: DutySchedule): StampDutyBreakdown {
  return {
    baseDuty: 0,
    fhbConcession: 0,
    foreignSurcharge: 0,
    investorSurcharge: 0,
    totalDuty: 0,
    effectiveRate: 0,
    notes: [schedule ? 'No duty payable on a zero property value' : `No duty schedule for ${input.state}`],
    state: input.state,
    scheduleYear: schedule?.year ?? 'unknown',
    sourceUrl: schedule?.sourceUrl ?? '',
  };
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`;

/**
 * Assess transfer duty for one purchase.
 *
 * Pass `schedule` to override the built-in table — the cache-backed loader does
 * that with a schedule it has already validated. Everything else gets the
 * built-in, which is always a complete and internally consistent table rather
 * than whatever a scrape last produced.
 */
export function calculateStampDuty(input: StampDutyInput): StampDutyBreakdown {
  const value = Math.max(0, Number(input.propertyValue) || 0);
  const schedule = input.schedule ?? DUTY_SCHEDULES[input.state];

  if (!schedule || value <= 0) return emptyBreakdown(input, schedule);

  const category: PropertyCategory = input.category ?? 'established';
  const intent = input.intent;
  const isFhb = !!input.isFirstHomeBuyer && intent === 'owner_occupier';
  const isForeign = !!input.isForeignBuyer;
  const notes: string[] = [];

  // VIC off-the-plan: duty is assessed on the value less the share of the price
  // representing construction still to come. Owner-occupier new builds only —
  // investors lost access to the concession in 2017.
  let dutiableValue = value;
  const otpFraction = Math.max(0, Math.min(1, input.offThePlanConstructionFraction ?? 0));
  if (schedule.state === 'VIC' && otpFraction > 0 && intent === 'owner_occupier' && category === 'new') {
    const eligibilityCap = isFhb ? 750_000 : 550_000;
    if (value <= eligibilityCap) {
      dutiableValue = value * (1 - otpFraction);
      notes.push(
        `VIC off-the-plan: dutiable value reduced by ${money(value - dutiableValue)} (${Math.round(otpFraction * 100)}% construction outstanding)`,
      );
    }
  }

  const { bands, label } = selectScale(schedule, dutiableValue, intent);
  const baseDuty = Math.round(evaluateScale(bands, dutiableValue));

  const concession = concessionFor(schedule, category);
  const fhbSaving = isFhb ? Math.round(concessionSaving(concession, dutiableValue, baseDuty)) : 0;
  const foreign = isForeign ? Math.round(value * (schedule.foreignSurchargePct / 100)) : 0;

  const totalDuty = Math.max(0, baseDuty - fhbSaving + foreign);
  const effectiveRate = value > 0 ? (totalDuty / value) * 100 : 0;

  if (label === 'premium') {
    notes.push(`${schedule.state} premium property duty applies above ${money(schedule.premium!.from)}`);
  } else if (label === 'owner-occupier') {
    notes.push(`${schedule.state} owner-occupier concessional rates applied`);
  } else if (intent === 'owner_occupier' && schedule.ownerOccupier && schedule.ownerOccupierUpTo !== undefined) {
    notes.push(
      `${schedule.state} owner-occupier rates are unavailable above ${money(schedule.ownerOccupierUpTo)} — general rates applied`,
    );
  }

  if (fhbSaving > 0) {
    notes.push(`First home buyer concession: −${money(fhbSaving)}`);
    if (concession.note) notes.push(concession.note);
  } else if (isFhb) {
    notes.push(
      concession.kind === 'none' && concession.note
        ? concession.note
        : `No first home buyer concession applies at ${money(value)} in ${schedule.state}`,
    );
  }

  if (foreign > 0) {
    notes.push(`Foreign purchaser surcharge (${schedule.foreignSurchargePct}%): +${money(foreign)}`);
  }

  if (!notes.length) notes.push(`Standard ${schedule.state} ${intent === 'investor' ? 'investor' : 'owner-occupier'} duty`);

  return {
    baseDuty,
    fhbConcession: fhbSaving,
    foreignSurcharge: foreign,
    investorSurcharge: 0,
    totalDuty,
    effectiveRate: Math.round(effectiveRate * 100) / 100,
    notes,
    state: schedule.state,
    scheduleYear: schedule.year,
    sourceUrl: schedule.sourceUrl,
  };
}

/**
 * Rough non-duty acquisition costs. Kept here because the borrowing-capacity
 * engine has always asked this module for it; the figures are NPC's own working
 * assumptions, not a published schedule, and are flagged as such to callers.
 */
export function estimateOtherAcquisitionCosts(propertyValue: number): {
  conveyancing: number;
  buildingInspection: number;
  pestInspection: number;
  loanApplicationFee: number;
  registrationFees: number;
  total: number;
} {
  const conveyancing = 1800;
  const buildingInspection = 600;
  const pestInspection = 350;
  const loanApplicationFee = 600;
  const registrationFees = Math.min(450, Math.max(180, Math.round(propertyValue / 5000)));
  return {
    conveyancing,
    buildingInspection,
    pestInspection,
    loanApplicationFee,
    registrationFees,
    total: conveyancing + buildingInspection + pestInspection + loanApplicationFee + registrationFees,
  };
}
