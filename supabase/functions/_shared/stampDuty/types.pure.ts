/**
 * Types for the Australian transfer/stamp duty engine.
 *
 * Deno-parseable and dependency-free: this module is imported by Edge Functions
 * *and*, through `src/utils/stampDutyCalculator.ts`, by the browser bundle. No
 * `@/` aliases, explicit `.ts` extensions on every relative import.
 *
 * The shape here is deliberately data-driven rather than a function per state.
 * The previous design was eight hand-written `calcXXX()` functions copied into
 * four files, and every copy drifted — see `docs/reports/STAMP_DUTY.md`. A rate
 * change should be a data edit in `schedules.pure.ts` that the validator and the
 * golden tests both check, never a new branch of arithmetic.
 */

export type AustralianState = 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'NT' | 'ACT';

export const AUSTRALIAN_STATES: readonly AustralianState[] = [
  'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'NT', 'ACT',
] as const;

export type PurchaseIntent = 'owner_occupier' | 'investor';

export type PropertyCategory = 'established' | 'new' | 'vacant_land';

/**
 * How a band converts a dutiable value into duty.
 *
 * - `marginal` — `base` dollars plus `rate`% of the excess over `from`. The
 *   ordinary progressive case.
 * - `flat` — `rate`% of the **entire** dutiable value, ignoring `base` and
 *   `from`. Real, and easy to get wrong: VIC charges a flat 5.5% between
 *   $960,000 and $2,000,000, and the ACT charges a flat 4.54% above
 *   $1,455,000. Both are genuinely discontinuous with the band below.
 * - `nt_quadratic` — the Northern Territory's formula for values at or under
 *   $525,000: `D = (0.06571441 × V²) + 15V`, where `V` is the value in
 *   thousands. Not expressible as bands at any useful precision, which is why
 *   every linear approximation of NT in this repo was wrong.
 */
export type BandMode = 'marginal' | 'flat' | 'nt_quadratic';

/** One row of a duty scale. Scales are held sorted ascending by `from`. */
export interface DutyBand {
  /** Inclusive lower bound in dollars. The first band of a scale must be 0. */
  from: number;
  /** Fixed dollars charged at `from`. Ignored when mode is not `marginal`. */
  base?: number;
  /** Percent — 4.5 means $4.50 per $100, i.e. 4.5%. */
  rate?: number;
  /** Defaults to `marginal`. */
  mode?: BandMode;
  /** Floor for duty assessed in this band (NSW charges a $20 minimum). */
  min?: number;
}

/**
 * First-home relief. Modelled as a discriminated union because the eight
 * jurisdictions genuinely do five different things, and collapsing them into
 * "threshold + taper" is how the old code came to report a VIC-shaped
 * concession for Queensland.
 */
export type Concession =
  /** No first-home duty relief in force for this category. */
  | { kind: 'none'; note?: string }
  /** Full exemption at any value (QLD new home post-1 May 2025, SA new home, ACT HBCS). */
  | { kind: 'exempt_all'; note?: string }
  /** Full exemption to `fullTo`, tapering linearly to nil at `taperTo` (NSW, VIC). */
  | { kind: 'exempt_to_taper'; fullTo: number; taperTo: number; note?: string }
  /** Fixed dollar concession chosen by value band (QLD established homes). */
  | { kind: 'fixed_steps'; steps: ReadonlyArray<{ under: number; amount: number }>; note?: string }
  /**
   * A replacement scale rather than a deduction (WA's first home owner rate).
   * Above `appliesUpTo` the concession falls away entirely and the ordinary
   * scale governs — WA's FHOR bands are calibrated to meet the general scale
   * exactly at that ceiling, so the transition is continuous.
   */
  | { kind: 'scale'; bands: readonly DutyBand[]; appliesUpTo: number; note?: string }
  /** A percentage discount on duty up to a value ceiling. */
  | { kind: 'percent'; pct: number; upTo: number; note?: string };

/** The complete duty position for one jurisdiction at one point in time. */
export interface DutySchedule {
  state: AustralianState;
  /** Financial year label this schedule expresses, e.g. `2026-27`. */
  year: string;
  /** ISO date the schedule takes effect. */
  effectiveFrom: string;
  /**
   * True when the jurisdiction re-indexes its thresholds every 1 July. Those
   * are the schedules that silently rot; `assessStaleness()` only warns about
   * these once the financial year has rolled over.
   */
  indexedAnnually: boolean;
  /** Revenue office page the figures were taken from. */
  sourceUrl: string;
  /** General / investor scale. Every schedule has one. */
  general: readonly DutyBand[];
  /**
   * Concessional scale for buyers who will live in the property, where the
   * jurisdiction has one: VIC's PPR rates, QLD's home concession, the ACT's
   * owner-occupier schedule. Absent means owner-occupiers pay general rates.
   */
  ownerOccupier?: readonly DutyBand[];
  /**
   * Value ceiling on `ownerOccupier`. Above it the owner-occupier concession is
   * unavailable and general rates govern the whole amount — VIC's PPR rates stop
   * at $550,000 and WA's concessional rate at $200,000. Absent means the
   * owner-occupier scale applies at every value (QLD, ACT).
   */
  ownerOccupierUpTo?: number;
  /**
   * NSW premium property duty — a separate scale that replaces `general`
   * entirely for residential land above `from`.
   */
  premium?: { from: number; bands: readonly DutyBand[] };
  /** First-home relief, by what is being bought. */
  firstHome: {
    established: Concession;
    newHome: Concession;
    vacantLand: Concession;
  };
  /** Foreign purchaser surcharge as a percent of the whole value. 0 where none. */
  foreignSurchargePct: number;
  /** Anything a reader needs in order to trust or challenge the figures above. */
  notes?: readonly string[];
}

export interface StampDutyInput {
  propertyValue: number;
  state: AustralianState;
  intent: PurchaseIntent;
  category?: PropertyCategory;
  isFirstHomeBuyer?: boolean;
  isForeignBuyer?: boolean;
  /**
   * VIC off-the-plan concession: the fraction of the price representing
   * construction not yet complete at contract date (0–1). VIC only, and only
   * for owner-occupiers buying new — investors lost access in 2017.
   */
  offThePlanConstructionFraction?: number;
  /**
   * Overrides the built-in schedule. The cache-backed loader passes a verified
   * schedule here; everything else leaves it undefined and gets the built-in.
   */
  schedule?: DutySchedule;
}

export interface StampDutyBreakdown {
  baseDuty: number;
  /** Dollars saved by first-home relief (positive). */
  fhbConcession: number;
  /** Dollars added by the foreign purchaser surcharge. */
  foreignSurcharge: number;
  /**
   * Retained for callers that destructure it. No Australian jurisdiction
   * currently levies a separate investor surcharge at acquisition — the
   * investor position is expressed by which scale applies, not by an add-on.
   */
  investorSurcharge: number;
  totalDuty: number;
  /** Duty as a percent of the property value, to 2dp. */
  effectiveRate: number;
  notes: string[];
  state: AustralianState;
  /** Financial year of the schedule used, so a report can cite it. */
  scheduleYear: string;
  /** Revenue office URL the schedule came from. */
  sourceUrl: string;
}
