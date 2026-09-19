/**
 * The canonical Market Evidence contract, and the hierarchy that fills it.
 *
 * These pin the three rules the design turns on, each of which exists because
 * the alternative has already cost this product something:
 *
 *  - provenance is per MEASURE, so a suburb median and a GCCSA benchmark can
 *    sit in one bundle without either borrowing the other's authority;
 *  - a dwelling-type MATCH outranks a finer geography, because a mismatch is a
 *    different market while a coarser reading is the same market;
 *  - benchmarks resolve to the COARSER point, because a benchmark filled from
 *    the subject's own suburb makes every property average by construction —
 *    which deletes exactly the relative-performance signal audit §48 says the
 *    score needs.
 */
import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_KEYS,
  GEOGRAPHIC_LEVELS,
  describePoint,
  licensingOf,
  mayReachClientReport,
  emptyEvidence,
  finestSubjectLevel,
  isFinerThan,
  levelRank,
  mergeEvidence,
  presentPoints,
  type EvidencePoint,
  type EvidenceSubject,
  type MarketEvidence,
} from '../market/marketEvidence.pure';

const SUBJECT: EvidenceSubject = {
  suburb: 'Bowral', postcode: '2576', state: 'NSW',
  dwellingType: 'house', resolvedFrom: 'coordinate',
};

const point = (o: Partial<EvidencePoint> & { value: number }): EvidencePoint => ({
  level: 'suburb', areaName: 'Bowral', dwellingType: 'house', dwellingTypeMatched: true,
  provider: 'domain', asOf: '2026-Q2', sampleSize: null, periodsAvailable: null,
  method: 'observed', sourceNote: null, ...o,
});

describe('the level ordering is the hierarchy', () => {
  it('runs finest to coarsest', () => {
    expect(GEOGRAPHIC_LEVELS[0]).toBe('property');
    expect(GEOGRAPHIC_LEVELS[GEOGRAPHIC_LEVELS.length - 1]).toBe('national');
    const ranks = GEOGRAPHIC_LEVELS.map(levelRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('answers which of two levels is finer', () => {
    expect(isFinerThan('suburb', 'postcode')).toBe(true);
    expect(isFinerThan('gccsa', 'suburb')).toBe(false);
    expect(isFinerThan('state', 'state')).toBe(false);
  });
});

describe('absent is absent', () => {
  it('an empty bundle carries no measure and no fabricated zero', () => {
    const ev = emptyEvidence(SUBJECT);
    expect(presentPoints(ev)).toEqual([]);
    for (const k of EVIDENCE_KEYS) expect((ev as unknown as Record<string, unknown>)[k]).toBeUndefined();
  });

  it('a measured zero is a value, not an absence', () => {
    const ev: MarketEvidence = { ...emptyEvidence(SUBJECT), salesCount: point({ value: 0 }) };
    expect(presentPoints(ev).map((p) => p.key)).toEqual(['salesCount']);
    expect(ev.salesCount?.value).toBe(0);
  });
});

describe('the hierarchy resolves per measure', () => {
  it('takes the median from the suburb and the vacancy from the postcode', () => {
    const suburb: MarketEvidence = {
      ...emptyEvidence(SUBJECT),
      medianPrice: point({ value: 1_450_000, level: 'suburb' }),
      providersConsulted: ['domain'],
    };
    const postcode: MarketEvidence = {
      ...emptyEvidence(SUBJECT),
      medianPrice: point({ value: 1_200_000, level: 'postcode', areaName: '2576' }),
      vacancyRate: point({ value: 1.2, level: 'postcode', areaName: '2576' }),
      providersConsulted: ['cotality'],
    };
    const merged = mergeEvidence(SUBJECT, [suburb, postcode]);
    expect(merged.medianPrice?.value).toBe(1_450_000);
    expect(merged.medianPrice?.level).toBe('suburb');
    expect(merged.vacancyRate?.value).toBe(1.2);
    expect(merged.vacancyRate?.level).toBe('postcode');
    expect(merged.providersConsulted).toEqual(['domain', 'cotality']);
  });

  it('prefers a dwelling-type MATCH over a finer geography', () => {
    // The whole point: a suburb figure mixing houses and units is a statement
    // about a different market; a postcode house figure is the same market,
    // measured more broadly.
    const suburbMixed: MarketEvidence = {
      ...emptyEvidence(SUBJECT),
      growth1Year: point({ value: 9, level: 'suburb', dwellingType: 'any', dwellingTypeMatched: false }),
      providersConsulted: [],
    };
    const postcodeHouse: MarketEvidence = {
      ...emptyEvidence(SUBJECT),
      growth1Year: point({ value: 4, level: 'postcode', areaName: '2576' }),
      providersConsulted: [],
    };
    const merged = mergeEvidence(SUBJECT, [suburbMixed, postcodeHouse]);
    expect(merged.growth1Year?.value).toBe(4);
    expect(merged.growth1Year?.level).toBe('postcode');
    expect(merged.growth1Year?.dwellingTypeMatched).toBe(true);
  });

  it('keeps the earlier candidate when level and match are equal', () => {
    const a: MarketEvidence = { ...emptyEvidence(SUBJECT), medianPrice: point({ value: 1 }), providersConsulted: [] };
    const b: MarketEvidence = { ...emptyEvidence(SUBJECT), medianPrice: point({ value: 2 }), providersConsulted: [] };
    expect(mergeEvidence(SUBJECT, [a, b]).medianPrice?.value).toBe(1);
  });

  it('resolves a BENCHMARK to the coarser point, never the subject\'s own suburb', () => {
    // Filling the benchmark from the suburb makes every property exactly
    // average against itself, which deletes the relative signal entirely.
    const fine: MarketEvidence = {
      ...emptyEvidence(SUBJECT),
      benchmarkGrowth3YearCagr: point({ value: 8, level: 'suburb' }),
      providersConsulted: [],
    };
    const coarse: MarketEvidence = {
      ...emptyEvidence(SUBJECT),
      benchmarkGrowth3YearCagr: point({
        value: 4.5, level: 'gccsa', areaName: 'Rest of NSW', provider: 'abs_res_dwell',
      }),
      providersConsulted: [],
    };
    const merged = mergeEvidence(SUBJECT, [fine, coarse]);
    expect(merged.benchmarkGrowth3YearCagr?.value).toBe(4.5);
    expect(merged.benchmarkGrowth3YearCagr?.areaName).toBe('Rest of NSW');
  });

  it('carries every provider that could not answer, with its reason', () => {
    const a: MarketEvidence = {
      ...emptyEvidence(SUBJECT), providersConsulted: ['domain'],
      providersUnavailable: [{ provider: 'domain', reason: 'DOMAIN_API_KEY not configured' }],
    };
    const merged = mergeEvidence(SUBJECT, [a, emptyEvidence(SUBJECT)]);
    expect(merged.providersUnavailable).toEqual([
      { provider: 'domain', reason: 'DOMAIN_API_KEY not configured' },
    ]);
  });
});

describe('the bundle reports its own precision honestly', () => {
  it('reads the finest SUBJECT level and ignores benchmarks', () => {
    const ev: MarketEvidence = {
      ...emptyEvidence(SUBJECT),
      growth1Year: point({ value: 5, level: 'postcode' }),
      // A suburb-level BENCHMARK must not make the bundle read as suburb-precise.
      benchmarkGrowth1Year: point({ value: 3, level: 'suburb' }),
    };
    expect(finestSubjectLevel(ev)).toBe('postcode');
  });

  it('is null when nothing was measured', () => {
    expect(finestSubjectLevel(emptyEvidence(SUBJECT))).toBeNull();
  });
});

describe('a measure describes what it covered', () => {
  it('names the area, the dwelling split, the sample and the period', () => {
    expect(describePoint(point({ value: 1, sampleSize: 62 })))
      .toBe('Bowral — houses, 62 sales, 2026-Q2');
  });

  it('says so when the dwelling type was not matched', () => {
    expect(describePoint(point({ value: 1, dwellingType: 'any', dwellingTypeMatched: false })))
      .toContain('(dwelling type not matched)');
  });
});

describe('licensing is a production gate, and it is never inferred', () => {
  it('defaults to unverified when nothing says otherwise', () => {
    // Assuming a right nobody confirmed is how a licence gets breached in a
    // document that has already been emailed. Cotality's own scoping spec §4
    // leaves redistribution for client-facing PDFs explicitly open.
    expect(licensingOf(point({ value: 1 }))).toBe('unverified');
    expect(mayReachClientReport(point({ value: 1 }))).toBe(false);
  });

  it('lets open government data through', () => {
    const abs = point({ value: 1, provider: 'abs_res_dwell', licensingStatus: 'open' });
    expect(mayReachClientReport(abs)).toBe(true);
  });

  it('lets positively licensed commercial data through', () => {
    expect(mayReachClientReport(point({ value: 1, licensingStatus: 'licensed_for_client_reports' })))
      .toBe(true);
  });

  it('refuses internal-only material even though it is licensed', () => {
    // "We may use it" and "we may show it to a client" are different rights.
    expect(mayReachClientReport(point({ value: 1, licensingStatus: 'internal_only' }))).toBe(false);
  });

  it('does not stop a measure being SCORED — only rendered', () => {
    // The gate is on the document, not on the arithmetic: a shadow backtest
    // may use unverified material, which is what lets qualification proceed
    // while the commercial questions are still open.
    const ev: MarketEvidence = {
      ...emptyEvidence(SUBJECT),
      growth3YearCagr: point({ value: 7.2, licensingStatus: 'unverified' }),
    };
    expect(presentPoints(ev).map((p) => p.key)).toEqual(['growth3YearCagr']);
  });
});
