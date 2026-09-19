/**
 * The capital growth rate a ten-year projection is asked to assume,
 * estimated from the open sales register rather than typed from habit.
 *
 * The Financials tab's `Growth` field seeds every year of the ten-year
 * cash flow. It defaulted to 5, and a "smart default" table of one figure
 * per state (`localityGrowthEstimates.ts`) stood in for evidence. The
 * register now holds a measured series for the address — a suburb in
 * Victoria and South Australia, a council in Queensland, a postcode in New
 * South Wales, and beneath every state the ABS state series — so the
 * estimate is the compound annual growth actually recorded for the finest
 * area that reaches far enough back, with its basis and its caveats said
 * beside the number.
 *
 * Three rules. **The long run outranks the fine grain**: a ten-year
 * projection wants a ten-year (or five-year) rate, so the finest area that
 * carries a horizon of at least five years is read before a finer area
 * that carries only the last year or three — the swing of one cycle is not
 * a rate to compound for a decade. **Every coarsening is a caveat**, never
 * a silent substitution: a council-wide, postcode-wide or state-wide
 * series, a mean rather than a median, a dwelling type that did not match,
 * an archive capture date, a short horizon, and a figure outside the range
 * most projections assume are each named on the estimate. **Nothing is
 * invented**: no series, no estimate — the field is left as it was and
 * the caller says so.
 */
import type { EvidencePoint, GeographicLevel } from './marketEvidence.pure.ts';
import type { OpenDataSalesPoints } from './openDataSalesEvidence.pure.ts';
import { dwellingWords, type SalesDwellingType } from './openData/salesRegister.pure.ts';

export const CAPITAL_GROWTH_ESTIMATE_VERSION = 'cgr.1';

export type CgrHorizonYears = 1 | 3 | 5 | 10;

export interface CgrHorizon {
  years: CgrHorizonYears;
  /** Compound annual growth, per cent. */
  ratePct: number;
  sourceNote: string;
  asOf: string;
}

export interface CgrCandidate {
  level: GeographicLevel;
  areaName: string;
  provider: string;
  sourceLabel: string;
  licence: string;
  measure: 'median' | 'mean';
  dwellingType: SalesDwellingType | null;
  dwellingTypeMatched: boolean;
  latestPeriod: string | null;
  /** The latest period in the publisher's own words — `March 2026 quarter`, `calendar year 2025`. */
  latestPeriodLabel: string | null;
  capturedAt: string | null;
  /** When the register last took this series from its source. */
  loadedAt: string | null;
  periodsAvailable: number;
  /** Longest first. */
  horizons: CgrHorizon[];
}

export interface CgrAlternative {
  level: GeographicLevel;
  areaName: string;
  horizonYears: CgrHorizonYears;
  ratePct: number;
}

export interface CapitalGrowthEstimate {
  version: string;
  /** Rounded to one decimal place. */
  ratePct: number;
  horizonYears: CgrHorizonYears;
  level: GeographicLevel;
  areaName: string;
  provider: string;
  sourceLabel: string;
  licence: string;
  measure: 'median' | 'mean';
  dwellingType: SalesDwellingType | null;
  dwellingTypeMatched: boolean;
  latestPeriod: string | null;
  /** The latest period in the publisher's own words. */
  latestPeriodLabel: string | null;
  capturedAt: string | null;
  /** When the register last took the chosen series from its source — the reading's own currency. */
  loadedAt: string | null;
  /** One sentence a reader can defend the number with. */
  basis: string;
  caveats: string[];
  alternatives: CgrAlternative[];
}

/** The order horizons are preferred in: the longest run the area carries. */
export const PREFERRED_HORIZONS: readonly CgrHorizonYears[] = [10, 5, 3, 1];
/** The shortest horizon that counts as a long-run rate. */
export const MIN_LONG_RUN_HORIZON: CgrHorizonYears = 5;
/** The band most ten-year projections assume; outside it the estimate carries a caveat. */
export const TYPICAL_RANGE_PCT = { min: 0, max: 8 } as const;

const HORIZON_KEYS: ReadonlyArray<[CgrHorizonYears, keyof OpenDataSalesPoints]> = [
  [10, 'growth10YearCagr'],
  [5, 'growth5YearCagr'],
  [3, 'growth3YearCagr'],
  [1, 'growth1Year'],
];

const isNumberPoint = (p: unknown): p is EvidencePoint<number> =>
  typeof p === 'object' && p !== null && typeof (p as EvidencePoint).value === 'number' && Number.isFinite((p as EvidencePoint).value as number);

export interface CandidateMeta {
  sourceLabel: string;
  licence: string;
  measure: 'median' | 'mean';
  dwellingType: SalesDwellingType | null;
  dwellingTypeMatched: boolean;
  latestPeriod: string | null;
  latestPeriodLabel?: string | null;
  capturedAt: string | null;
  loadedAt?: string | null;
}

/** The growth horizons an adapter answer carries, as a candidate; null where it carries none. */
export function candidateFromPoints(points: OpenDataSalesPoints, meta: CandidateMeta): CgrCandidate | null {
  const horizons: CgrHorizon[] = [];
  let first: EvidencePoint | null = null;
  for (const [years, key] of HORIZON_KEYS) {
    const p = points[key];
    if (!isNumberPoint(p)) continue;
    first ??= p;
    horizons.push({ years, ratePct: p.value, sourceNote: p.sourceNote ?? '', asOf: p.asOf });
  }
  if (!first || !horizons.length) return null;
  return {
    level: first.level,
    areaName: first.areaName,
    provider: first.provider,
    sourceLabel: meta.sourceLabel,
    licence: meta.licence,
    measure: meta.measure,
    dwellingType: meta.dwellingType,
    dwellingTypeMatched: meta.dwellingTypeMatched,
    latestPeriod: meta.latestPeriod,
    latestPeriodLabel: meta.latestPeriodLabel ?? null,
    capturedAt: meta.capturedAt,
    loadedAt: meta.loadedAt ?? null,
    periodsAvailable: first.periodsAvailable ?? 0,
    horizons,
  };
}

const LEVEL_WORDS: Partial<Record<GeographicLevel, string>> = {
  lga: 'a council-wide series',
  postcode: 'a postcode-wide series',
  sa2: 'a statistical-area series',
  sa3: 'a district-wide series',
  gccsa: 'a capital-city-wide series',
  state: 'a state-wide series',
  national: 'a national series',
};

function longestAtLeast(c: CgrCandidate, min: CgrHorizonYears): CgrHorizon | null {
  return c.horizons.find((h) => h.years >= min) ?? null;
}

/**
 * Choose the estimate. Candidates are finest grain first; the first with a
 * long-run horizon wins, else the first with three years, else the first
 * with one, else nothing.
 */
export function estimateCapitalGrowth(candidates: ReadonlyArray<CgrCandidate>): CapitalGrowthEstimate | null {
  const usable = candidates.filter((c) => c.horizons.length > 0);
  if (!usable.length) return null;
  let chosen: { candidate: CgrCandidate; horizon: CgrHorizon } | null = null;
  for (const min of [MIN_LONG_RUN_HORIZON, 3, 1] as CgrHorizonYears[]) {
    for (const c of usable) {
      const h = longestAtLeast(c, min);
      if (h) { chosen = { candidate: c, horizon: h }; break; }
    }
    if (chosen) break;
  }
  if (!chosen) return null;
  const { candidate: c, horizon: h } = chosen;
  const ratePct = Math.round(h.ratePct * 10) / 10;

  const caveats: string[] = [];
  const levelWords = LEVEL_WORDS[c.level];
  if (levelWords) caveats.push(`This is ${levelWords} — the finest open series that reaches this address — so it describes ${c.areaName}, not the street or suburb.`);
  if (c.measure === 'mean') caveats.push('The series is the mean price of the residential dwelling stock, not a median sale price.');
  if (!c.dwellingTypeMatched && c.dwellingType) caveats.push(`The series is for ${dwellingWords(c.dwellingType)}, not the property's own dwelling type.`);
  if (h.years < MIN_LONG_RUN_HORIZON) caveats.push(`Only ${h.years === 1 ? 'one year' : `${h.years} years`} of history reaches this area; a short horizon carries the cycle's swing and is a weak basis for a ten-year projection.`);
  if (c.capturedAt) caveats.push(`Read from the Internet Archive's capture of the publisher's file on ${c.capturedAt.slice(0, 10)}, because the publisher's own host refuses automated readers.`);
  if (ratePct < TYPICAL_RANGE_PCT.min || ratePct > TYPICAL_RANGE_PCT.max) {
    caveats.push(`Outside the ${TYPICAL_RANGE_PCT.min}–${TYPICAL_RANGE_PCT.max}% a year most ten-year projections assume; consider a more conservative figure.`);
  }

  const alternatives: CgrAlternative[] = usable
    .filter((o) => o !== c)
    .map((o) => ({ level: o.level, areaName: o.areaName, horizonYears: o.horizons[0].years, ratePct: Math.round(o.horizons[0].ratePct * 10) / 10 }));

  return {
    version: CAPITAL_GROWTH_ESTIMATE_VERSION,
    ratePct,
    horizonYears: h.years,
    level: c.level,
    areaName: c.areaName,
    provider: c.provider,
    sourceLabel: c.sourceLabel,
    licence: c.licence,
    measure: c.measure,
    dwellingType: c.dwellingType,
    dwellingTypeMatched: c.dwellingTypeMatched,
    latestPeriod: c.latestPeriod,
    latestPeriodLabel: c.latestPeriodLabel,
    capturedAt: c.capturedAt,
    loadedAt: c.loadedAt,
    basis: `${h.years}-year compound annual growth of the ${c.measure === 'mean' ? 'mean price of the dwelling stock' : `median sale price of ${c.dwellingType ? dwellingWords(c.dwellingType) : 'dwellings'}`}, ${c.areaName} (${c.sourceLabel}).`,
    caveats,
    alternatives,
  };
}
