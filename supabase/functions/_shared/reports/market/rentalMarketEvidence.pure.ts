/**
 * The suburb's own rent and vacancy, as evidence the scorer can read.
 *
 * ## The gap this closes
 *
 * `sqm-rent-service` returns three figures for a suburb and dwelling type —
 * `medianWeeklyRent`, `vacancyRate` and `stockOnMarket` — caches them in
 * `median_rent_cache`, and `generate-investment-report` has called it for
 * months. Measured 20 September 2026, none of it reached the scoring engine:
 *
 * * the call is made **only when the operator supplied no rent**
 *   (`if (!weeklyRent && suburb && state)`), and the answer is used as a
 *   stand-in for the SUBJECT'S own rent. On a report where the operator typed
 *   a rent — 97 Poole Road, $1,100/week — the service was never called at all;
 * * `vacancyRate` is read out of the response and then dropped on the floor,
 *   on every call, without exception;
 * * nothing anywhere in the codebase assigns `evidence.medianRent`. It is a
 *   declared field on `MarketEvidence` with no producer.
 *
 * Both omissions cost real points, and neither is a data gap.
 *
 * **Vacancy is 0.30 of the Demand dimension** — its single largest component.
 * 97 Poole Road scored Demand on `transactionVolume` and a population driver,
 * 0.30 of the methodology, and the report said in terms that "no published
 * figure was held for vacancy". One was obtainable from a cache.
 *
 * **The suburb median rent is the denominator the income dimension needs.**
 * Without it, `scoreIncomeAdvantage` falls to the DECLARED frontier, which
 * expects 4.88% yield at 6.2% capital growth. Postcode 2155 pays about 2.4%.
 * So a property yielding 3.47% — over a point ABOVE its own market — was read
 * as 1.41 points below a national line that does not describe Sydney, and
 * scored 23 instead of about 70.
 *
 * ## Two rules
 *
 * **The market's rent is never the property's rent.** They are different
 * quantities and the existing stand-in behaviour is untouched: where the
 * operator states a rent, that is the subject's rent and this evidence is the
 * MARKET's, used as a denominator and nothing else. Collapsing the two would
 * make every property yield exactly its suburb median, which is "absent is
 * never zero" in its most expensive form.
 *
 * **It is licensed `unverified`.** SQM Research publishes the page; this
 * platform holds no distribution right to the figures. That is the treatment
 * Domain already has — the engine scores on the points and
 * `mayReachClientReport` keeps their provenance out of the client document —
 * and it is why this module sets the status explicitly rather than letting it
 * default.
 */

import type { EvidencePoint, EvidenceSubject } from './marketEvidence.pure.ts';

/** Bumped whenever the projection or its provenance changes. */
export const RENTAL_MARKET_EVIDENCE_VERSION = '1.0.0';

/** What `sqm-rent-service` answers with, as much of it as this reads. */
export interface RentalServiceReading {
  readonly medianWeeklyRent?: number | null;
  readonly vacancyRate?: number | null;
  readonly suburb?: string | null;
  readonly state?: string | null;
  readonly propertyType?: string | null;
  readonly bedrooms?: number | null;
  /** ISO stamp the service put on the reading. */
  readonly fetchedAt?: string | null;
}

export interface RentalMarketPoints {
  /** The suburb's typical weekly rent. Absent where the service had none. */
  medianRent?: EvidencePoint;
  /** The suburb's rental vacancy, per cent. Absent where the service had none. */
  vacancyRate?: EvidencePoint;
}

export interface RentalEvidenceResult {
  readonly points: RentalMarketPoints;
  /** Named reasons a figure is absent, for `providersUnavailable`. */
  readonly missing: readonly string[];
  readonly version: string;
}

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * A vacancy rate is a percentage.
 *
 * The service has been seen to answer both `1.2` and `0.012` for the same
 * market depending on the page's formatting, so a value at or below 0.2 is
 * read as a FRACTION and scaled; above that it is already per cent, because a
 * 20%-plus residential vacancy does not occur in an Australian suburb this
 * platform reports on.
 *
 * Bounded rather than trusted: anything outside 0-20% after scaling is
 * refused, because a mis-parsed page is not a measurement.
 */
export function normaliseVacancyRate(raw: unknown): number | null {
  const v = finite(raw);
  if (v === null || v < 0) return null;
  const pct = v > 0 && v <= 0.2 ? v * 100 : v;
  return pct >= 0 && pct <= 20 ? Number(pct.toFixed(2)) : null;
}

/**
 * Project the service's answer into evidence points.
 *
 * Absent figures produce no point and a named reason — never a zero, and
 * never an estimate from the other figure.
 */
export function rentalMarketEvidence(
  reading: RentalServiceReading | null | undefined,
  subject: EvidenceSubject,
  now: Date,
): RentalEvidenceResult {
  const points: RentalMarketPoints = {};
  const missing: string[] = [];
  if (!reading) {
    return {
      points,
      missing: ['the rental market service returned nothing for this suburb'],
      version: RENTAL_MARKET_EVIDENCE_VERSION,
    };
  }

  const areaName = [reading.suburb ?? subject.suburb, reading.state ?? subject.state]
    .filter(Boolean).join(', ') || subject.suburb;
  const asOf = (reading.fetchedAt ?? now.toISOString()).slice(0, 10);
  const base = {
    level: 'suburb' as const,
    areaName,
    dwellingType: (reading.propertyType ?? subject.dwellingType) as EvidencePoint['dwellingType'],
    dwellingTypeMatched:
      String(reading.propertyType ?? '').toLowerCase() === String(subject.dwellingType).toLowerCase(),
    provider: 'sqm_research' as const,
    asOf,
    sampleSize: null,
    periodsAvailable: null,
    method: 'observed' as const,
    // SQM publishes the page; this platform holds no distribution right to
    // the figures. Score on them, do not name them in a client document.
    licensingStatus: 'unverified' as const,
    sourceNote: null,
  };

  const rent = finite(reading.medianWeeklyRent);
  if (rent !== null && rent > 0) {
    points.medianRent = { ...base, value: rent } as unknown as EvidencePoint;
  } else {
    missing.push('no median weekly rent was published for this suburb and dwelling type');
  }

  const vacancy = normaliseVacancyRate(reading.vacancyRate);
  if (vacancy !== null) {
    points.vacancyRate = { ...base, value: vacancy } as unknown as EvidencePoint;
  } else {
    missing.push('no rental vacancy rate was published for this suburb');
  }

  return { points, missing, version: RENTAL_MARKET_EVIDENCE_VERSION };
}
