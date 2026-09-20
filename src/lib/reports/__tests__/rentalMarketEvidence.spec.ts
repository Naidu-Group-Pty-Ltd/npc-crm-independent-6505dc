/**
 * The suburb's rent and vacancy reach the scorer — and remain the MARKET's.
 *
 * `sqm-rent-service` answered with `medianWeeklyRent`, `vacancyRate` and
 * `stockOnMarket`, cached them, and `generate-investment-report` called it for
 * months. None of it reached the engine: the call was conditional on the
 * operator NOT supplying a rent, the answer stood in for the subject's own
 * rent, `vacancyRate` was dropped on every call, and nothing anywhere assigned
 * `evidence.medianRent`.
 *
 * Vacancy is 0.30 of Demand — its largest component — and the suburb median
 * rent is the denominator `scoreIncomeAdvantage` needs.
 */
import { describe, expect, it } from 'vitest';
import type { EvidenceSubject } from '../../../../supabase/functions/_shared/reports/market/marketEvidence.pure';
import { mayReachClientReport } from '../../../../supabase/functions/_shared/reports/market/marketEvidence.pure';
import {
  RENTAL_MARKET_EVIDENCE_VERSION,
  normaliseVacancyRate,
  rentalMarketEvidence,
} from '../../../../supabase/functions/_shared/reports/market/rentalMarketEvidence.pure';

const NOW = new Date('2026-09-20T00:00:00Z');
const SUBJECT: EvidenceSubject = {
  suburb: 'Kellyville', postcode: '2155', state: 'NSW',
  dwellingType: 'house', resolvedFrom: 'coordinate',
};
const reading = (over: Record<string, unknown> = {}) => ({
  medianWeeklyRent: 850, vacancyRate: 1.2, suburb: 'Kellyville', state: 'NSW',
  propertyType: 'house', bedrooms: 4, fetchedAt: '2026-09-20T02:00:00Z', ...over,
});

describe('both figures reach the scorer', () => {
  it('publishes the suburb median rent and the vacancy rate', () => {
    const r = rentalMarketEvidence(reading(), SUBJECT, NOW);
    expect(r.points.medianRent?.value).toBe(850);
    expect(r.points.vacancyRate?.value).toBe(1.2);
    expect(r.missing).toEqual([]);
    expect(r.version).toBe(RENTAL_MARKET_EVIDENCE_VERSION);
  });

  it('carries the geography, the provider and the publisher’s own stamp', () => {
    const rent = rentalMarketEvidence(reading(), SUBJECT, NOW).points.medianRent!;
    expect(rent.level).toBe('suburb');
    expect(rent.areaName).toBe('Kellyville, NSW');
    expect(rent.provider).toBe('sqm_research');
    expect(rent.method).toBe('observed');
    // The service's own stamp, not the clock at projection time.
    expect(rent.asOf).toBe('2026-09-20');
  });
});

describe('absent is named, never zero and never estimated', () => {
  it('produces no point and a reason where a figure was not published', () => {
    const r = rentalMarketEvidence(reading({ medianWeeklyRent: null }), SUBJECT, NOW);
    expect(r.points.medianRent).toBeUndefined();
    expect(r.points.vacancyRate?.value).toBe(1.2);
    expect(r.missing.join(' ')).toContain('median weekly rent');
  });

  it('never derives one figure from the other', () => {
    const noVacancy = rentalMarketEvidence(reading({ vacancyRate: null }), SUBJECT, NOW);
    expect(noVacancy.points.vacancyRate).toBeUndefined();
    expect(noVacancy.points.medianRent?.value).toBe(850);
    const neither = rentalMarketEvidence(reading({ medianWeeklyRent: null, vacancyRate: null }), SUBJECT, NOW);
    expect(Object.keys(neither.points)).toHaveLength(0);
    expect(neither.missing).toHaveLength(2);
  });

  it('says so when the service answered with nothing at all', () => {
    const r = rentalMarketEvidence(null, SUBJECT, NOW);
    expect(Object.keys(r.points)).toHaveLength(0);
    expect(r.missing.join(' ')).toContain('returned nothing');
  });

  it('refuses a zero or negative rent rather than publishing one', () => {
    expect(rentalMarketEvidence(reading({ medianWeeklyRent: 0 }), SUBJECT, NOW).points.medianRent).toBeUndefined();
    expect(rentalMarketEvidence(reading({ medianWeeklyRent: -5 }), SUBJECT, NOW).points.medianRent).toBeUndefined();
  });
});

describe('the vacancy rate is bounded, not trusted', () => {
  it('reads a fraction as a percentage', () => {
    expect(normaliseVacancyRate(0.012)).toBe(1.2);
    expect(normaliseVacancyRate(1.2)).toBe(1.2);
  });

  it('refuses a figure no Australian suburb produces', () => {
    // A mis-parsed page is not a measurement.
    expect(normaliseVacancyRate(45)).toBeNull();
    expect(normaliseVacancyRate(-1)).toBeNull();
    expect(normaliseVacancyRate('1.2')).toBeNull();
    expect(normaliseVacancyRate(Number.NaN)).toBeNull();
  });

  it('keeps a genuine zero, which is a real reading in a tight market', () => {
    expect(normaliseVacancyRate(0)).toBe(0);
  });
});

describe('it is the market’s figure, and it is licensed as such', () => {
  it('is unverified, so it scores but does not reach a client document', () => {
    const r = rentalMarketEvidence(reading(), SUBJECT, NOW);
    expect(r.points.medianRent!.licensingStatus).toBe('unverified');
    expect(mayReachClientReport(r.points.medianRent!)).toBe(false);
    expect(mayReachClientReport(r.points.vacancyRate!)).toBe(false);
  });

  it('records whether the published dwelling type matched the subject’s', () => {
    expect(rentalMarketEvidence(reading(), SUBJECT, NOW).points.medianRent!.dwellingTypeMatched).toBe(true);
    expect(rentalMarketEvidence(reading({ propertyType: 'unit' }), SUBJECT, NOW)
      .points.medianRent!.dwellingTypeMatched).toBe(false);
  });

  it('is deterministic', () => {
    const a = rentalMarketEvidence(reading(), SUBJECT, NOW);
    const b = rentalMarketEvidence(reading(), SUBJECT, NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
