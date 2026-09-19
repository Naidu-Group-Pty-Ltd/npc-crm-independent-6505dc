/**
 * Domain suburb performance → market evidence, and the request that fetches it.
 *
 * The extraction is asserted over the documented v2 shape (one entry per
 * period, `year`/`month`/`values`), the growth horizons are asserted to be
 * COMPUTED from the series rather than read from a field, and the request
 * composer is pinned to the v2 route with the postcode as a path segment —
 * the omission that meant the old service never once succeeded.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DOMAIN_PACKAGE_NOT_ATTACHED_DETAIL,
  DOMAIN_SERIES_QUERY,
  DOMAIN_SUBURB_PERFORMANCE_BASE,
  DOMAIN_SUBURB_PERFORMANCE_LICENSING,
  abbreviateState,
  compoundAnnualGrowth,
  describeDomainRefusal,
  domainCategoryFor,
  domainEvidencePoints,
  domainSuburbPerformanceUrl,
  dwellingTypeFor,
  normaliseDomainSuburb,
  parseDomainSuburbPerformance,
  readDomainProblem,
} from '../market/domainEvidence.pure';
import { mayEnterProductionEvidence, mayReachClientReport } from '../market/marketEvidence.pure';

const ROOT = join(__dirname, '..', '..', '..', '..');

/** Twelve annual periods ending each June, the median compounding at `rate`. */
function payload(rate: number, opts: { years?: number; endYear?: number } = {}) {
  const years = opts.years ?? 12;
  const endYear = opts.endYear ?? 2026;
  const seriesInfo = [];
  let median = 1_000_000;
  for (let i = years - 1; i >= 0; i -= 1) {
    const year = endYear - i;
    seriesInfo.push({
      year,
      month: 6,
      values: {
        medianSoldPrice: Math.round(median),
        numberSold: 120 + i,
        daysOnMarket: 30 + i,
        discountPercentage: -3.5,
        auctionNumberAuctioned: 40,
        auctionNumberSold: 28,
        numberSaleListing: 200,
        numberRentListing: 90,
        medianRentListingPrice: 950,
      },
    });
    median *= 1 + rate / 100;
  }
  // Domain lists the periods newest first; the parser sorts.
  return { series: { seriesInfo: seriesInfo.reverse() } };
}

const subject = { suburb: 'Kellyville', postcode: '2155', state: 'NSW', dwellingType: 'house' as const, resolvedFrom: null };

describe('parseDomainSuburbPerformance', () => {
  it('reads the documented shape into an oldest-first series, tolerating strings', () => {
    const p = payload(5);
    (p.series.seriesInfo[0] as { values: Record<string, unknown> }).values.medianSoldPrice = '1500000';
    const series = parseDomainSuburbPerformance(p, 'house')!;
    expect(series.entries.length).toBe(12);
    expect(series.entries[0].year).toBe(2015);
    expect(series.entries[11].year).toBe(2026);
    expect(series.entries.every((e) => e.month === 6)).toBe(true);
    expect(series.entries[11].values.medianSoldPrice).toBe(1_500_000);
  });

  it('returns null for anything that is not the series shape', () => {
    expect(parseDomainSuburbPerformance(null, 'house')).toBeNull();
    expect(parseDomainSuburbPerformance({ message: 'Forbidden' }, 'house')).toBeNull();
    expect(parseDomainSuburbPerformance({ series: {} }, 'house')).toBeNull();
    expect(parseDomainSuburbPerformance('{"series":', 'house')).toBeNull();
  });
});

describe('domainEvidencePoints', () => {
  const series = parseDomainSuburbPerformance(payload(5), 'house')!;
  const { points, notes, pricedPeriods } = domainEvidencePoints({ subject, series, askedDwelling: 'house' });

  it('computes every growth horizon from the series, never from a growth field', () => {
    expect(pricedPeriods).toBe(12);
    expect(points.growth1Year?.value).toBeCloseTo(5, 1);
    expect(points.growth3YearCagr?.value).toBeCloseTo(5, 1);
    expect(points.growth5YearCagr?.value).toBeCloseTo(5, 1);
    expect(points.growth10YearCagr?.value).toBeCloseTo(5, 1);
    expect(points.growth5YearCagr?.method).toBe('calculated');
    expect(points.priceSeries?.value.length).toBe(12);
    expect(points.priceSeries?.value[0]).toEqual({ period: '2015-06', value: 1_000_000 });
    expect(notes).toEqual([]);
  });

  it('reads the latest period\'s demand readings', () => {
    expect(points.medianPrice?.value).toBe(series.entries[11].values.medianSoldPrice);
    expect(points.salesCount?.value).toBe(120);
    expect(points.daysOnMarket?.value).toBe(30);
    expect(points.vendorDiscount?.value).toBe(3.5); // magnitude, never the sign
    expect(points.auctionClearanceRate?.value).toBe(70);
    expect(points.listingActivity?.value).toBe(200);
    expect(points.medianRent?.value).toBe(950);
    expect(points.medianRent?.sampleSize).toBe(90);
  });

  it('every point carries Domain provenance at suburb level, existing-licence footing and the declared licensing', () => {
    for (const point of Object.values(points)) {
      expect(point.provider).toBe('domain');
      expect(point.level).toBe('suburb');
      expect(point.areaName).toBe('Kellyville NSW 2155');
      expect(point.dwellingType).toBe('house');
      expect(point.dwellingTypeMatched).toBe(true);
      expect(point.asOf).toBe('2026-06-01');
      expect(point.acquisition).toBe('existing_licensed');
      expect(point.licensingStatus).toBe('unverified');
      expect(mayEnterProductionEvidence(point)).toBe(true);
      expect(mayReachClientReport(point)).toBe(false);
    }
    expect(DOMAIN_SUBURB_PERFORMANCE_LICENSING).toBe('unverified');
  });

  it('a horizon the series does not span is not computed, and says so', () => {
    const short = parseDomainSuburbPerformance(payload(4, { years: 4 }), 'house')!;
    const r = domainEvidencePoints({ subject, series: short, askedDwelling: 'house' });
    expect(r.points.growth1Year?.value).toBeCloseTo(4, 1);
    expect(r.points.growth3YearCagr?.value).toBeCloseTo(4, 1);
    expect(r.points.growth5YearCagr).toBeUndefined();
    expect(r.points.growth10YearCagr).toBeUndefined();
    expect(r.notes.some((n) => /5 years before/.test(n))).toBe(true);
  });

  it('marks a unit series as not matching a house subject, and refuses to compute on an unpriced series', () => {
    const units = parseDomainSuburbPerformance(payload(3), 'unit')!;
    const r = domainEvidencePoints({ subject, series: units, askedDwelling: 'house' });
    expect(r.points.medianPrice?.dwellingType).toBe('attached');
    expect(r.points.medianPrice?.dwellingTypeMatched).toBe(false);
    const empty = parseDomainSuburbPerformance({ series: { seriesInfo: [{ year: 2026, month: 6, values: {} }] } }, 'house')!;
    const none = domainEvidencePoints({ subject, series: empty, askedDwelling: 'house' });
    expect(Object.keys(none.points)).toEqual([]);
    expect(none.pricedPeriods).toBe(0);
  });

  it('clearance needs at least ten auctions', () => {
    const p = payload(5);
    for (const e of p.series.seriesInfo) { e.values.auctionNumberAuctioned = 6; e.values.auctionNumberSold = 6; }
    const r = domainEvidencePoints({ subject, series: parseDomainSuburbPerformance(p, 'house')!, askedDwelling: 'house' });
    expect(r.points.auctionClearanceRate).toBeUndefined();
    expect(r.notes.some((n) => /Only 6 auctions/.test(n))).toBe(true);
  });
});

describe('compoundAnnualGrowth', () => {
  it('is the compound rate, rounded to two places, and null over nothing', () => {
    expect(compoundAnnualGrowth(100, 121, 2)).toBe(10);
    expect(compoundAnnualGrowth(100, 100, 5)).toBe(0);
    expect(compoundAnnualGrowth(0, 100, 5)).toBeNull();
    expect(compoundAnnualGrowth(100, 0, 5)).toBeNull();
    expect(compoundAnnualGrowth(100, 110, 0)).toBeNull();
  });
});

describe('the request', () => {
  it('composes the v2 route with the postcode as a path segment', () => {
    const r = domainSuburbPerformanceUrl({ state: 'nsw', suburb: 'Surry-Hills', postcode: '2010', propertyCategory: 'house' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url).toBe(`${DOMAIN_SUBURB_PERFORMANCE_BASE}/NSW/Surry%20Hills/2010?propertyCategory=house&${DOMAIN_SERIES_QUERY}`);
    expect(r.url).toContain('/v2/suburbPerformanceStatistics/');
    expect(r.url).not.toContain('/v1/');
    expect(DOMAIN_SERIES_QUERY).toBe('chronologicalSpan=12&tPlusFrom=1&tPlusTo=12');
  });

  it('refuses without a four-digit postcode, a suburb or an Australian state', () => {
    expect(domainSuburbPerformanceUrl({ state: 'NSW', suburb: 'Kellyville', postcode: undefined, propertyCategory: 'house' })).toMatchObject({ ok: false });
    expect(domainSuburbPerformanceUrl({ state: 'NSW', suburb: 'Kellyville', postcode: '21550', propertyCategory: 'house' })).toMatchObject({ ok: false });
    expect(domainSuburbPerformanceUrl({ state: 'NSW', suburb: '', postcode: '2155', propertyCategory: 'house' })).toMatchObject({ ok: false });
    expect(domainSuburbPerformanceUrl({ state: 'Texas', suburb: 'Kellyville', postcode: '2155', propertyCategory: 'house' })).toMatchObject({ ok: false });
  });

  it('abbreviates a full state name and normalises the suburb', () => {
    expect(abbreviateState('New South Wales')).toBe('NSW');
    expect(abbreviateState('vic')).toBe('VIC');
    expect(abbreviateState('Australian Capital Territory')).toBe('ACT');
    expect(abbreviateState('')).toBeNull();
    expect(abbreviateState(null)).toBeNull();
    expect(normaliseDomainSuburb('  Mount   Druitt ')).toBe('Mount Druitt');
    expect(normaliseDomainSuburb('surry-hills')).toBe('surry hills');
  });

  it('names the project-without-a-package refusal Domain actually answers with, and where to fix it', () => {
    // Measured from the production egress, 15 Sep 2026, on both products.
    const r = describeDomainRefusal(403, null, DOMAIN_PACKAGE_NOT_ATTACHED_DETAIL);
    expect(r.kind).toBe('package_not_attached');
    expect(r.summary).toContain('Operation not permitted on project');
    expect(r.summary).toMatch(/Properties & Locations/);
    expect(r.summary).toMatch(/API Access/);
    expect(readDomainProblem('{"type":"https://developer.domain.com.au/docs/latest/conventions/access","title":"Not Authorized","detail":"Operation not permitted on project"}'))
      .toEqual({ title: 'Not Authorized', detail: 'Operation not permitted on project' });
    expect(readDomainProblem('<html>Forbidden</html>')).toEqual({ title: null, detail: null });
    expect(readDomainProblem(null)).toEqual({ title: null, detail: null });
  });

  it('names Domain\'s refusal, quoting its own reason header where one was sent', () => {
    expect(describeDomainRefusal(403, null).summary).toMatch(/no X-Domain-Security-Reason header/);
    expect(describeDomainRefusal(403, null, 'Some other restriction').summary).toContain('"Some other restriction"');
    expect(describeDomainRefusal(403, 'Package not enabled').summary).toContain('X-Domain-Security-Reason: Package not enabled');
    expect(describeDomainRefusal(401, null).kind).toBe('unauthenticated');
    expect(describeDomainRefusal(404, null).kind).toBe('not_found');
    expect(describeDomainRefusal(429, null).kind).toBe('rate_limited');
    expect(describeDomainRefusal(503, null).kind).toBe('server_error');
  });

  it('maps property types onto Domain\'s two categories and the engine\'s dwelling vocabulary', () => {
    expect(domainCategoryFor('Apartment')).toBe('unit');
    expect(domainCategoryFor('House')).toBe('house');
    expect(domainCategoryFor(null)).toBe('house');
    expect(dwellingTypeFor('Unit')).toBe('attached');
    expect(dwellingTypeFor('Vacant Land')).toBe('land');
    expect(dwellingTypeFor('House')).toBe('house');
  });
});

/** The header records what the old service did; the assertions are about the code. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ');

describe('the service', () => {
  const SERVICE = stripComments(readFileSync(join(ROOT, 'supabase', 'functions', 'domain-data-service', 'index.ts'), 'utf8'));

  it('never names the deprecated v1 route and composes every URL through the one composer', () => {
    expect(SERVICE).not.toContain('/v1/suburbPerformanceStatistics');
    expect(SERVICE).not.toContain('api.domain.com.au');
    expect(SERVICE).toContain('domainSuburbPerformanceUrl(');
  });

  it('meters every Domain call and extracts through the shared adapter', () => {
    expect(SERVICE).toContain("from '../_shared/meteredFetch.ts'");
    expect(SERVICE).not.toMatch(/\bawait fetch\(/);
    expect(SERVICE).toContain('parseDomainSuburbPerformance(');
    expect(SERVICE).toContain('domainEvidencePoints(');
    expect(SERVICE).toContain('DOMAIN_SUBURB_PERFORMANCE_LICENSING');
  });

  it('reads the fields the response actually carries — never the three the old service invented', () => {
    expect(SERVICE).not.toContain('medianSoldPricePercentChange');
    expect(SERVICE).not.toContain('numberListedForRent');
    expect(SERVICE).not.toMatch(/values\?\.auctionClearanceRate/);
  });

  it('the generator keys the call on the trusted geography and passes the postcode', () => {
    const generator = readFileSync(join(ROOT, 'supabase', 'functions', 'generate-investment-report', 'index.ts'), 'utf8');
    expect(generator).toContain('const marketPostcode = subjectPostcodeOf(subjectGeography);');
    expect(generator).toContain('postcode: marketPostcode,');
    expect(generator).toContain("providersUnavailable.push({ provider: 'domain'");
    expect(generator).toContain('populationGrowthPoint(erpSeries');
    // The phase-1 slot no longer fires on the typed suburb and parsed postcode.
    expect(generator).not.toMatch(/fetchServiceWithFallback\('domain-data-service'/);
  });
});
