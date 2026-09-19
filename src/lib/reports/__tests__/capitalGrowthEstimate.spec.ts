/**
 * Estimate CGR: the long run outranks the fine grain, every coarsening is
 * a caveat, and nothing is invented.
 */
import { describe, expect, it } from 'vitest';

import {
  CAPITAL_GROWTH_ESTIMATE_VERSION,
  MIN_LONG_RUN_HORIZON,
  TYPICAL_RANGE_PCT,
  candidateFromPoints,
  estimateCapitalGrowth,
  type CgrCandidate,
} from '@/lib/reports/market/capitalGrowthEstimate.pure';
import type { EvidencePoint } from '@/lib/reports/market/marketEvidence.pure';

function point(value: number, level: EvidencePoint['level'], areaName: string, provider = 'vic_vpsr_suburb'): EvidencePoint<number> {
  return {
    value, level, areaName, dwellingType: 'house', dwellingTypeMatched: true, provider: provider as EvidencePoint['provider'],
    asOf: '2025-12-31', sampleSize: null, periodsAvailable: 11, method: 'calculated', licensingStatus: 'open', acquisition: 'open_public',
    sourceNote: `growth of ${areaName}`,
  };
}

function candidate(partial: Partial<CgrCandidate> & Pick<CgrCandidate, 'level' | 'areaName' | 'horizons'>): CgrCandidate {
  return {
    provider: 'vic_vpsr_suburb', sourceLabel: 'Victorian Valuer-General', licence: 'CC BY 3.0 AU', measure: 'median',
    dwellingType: 'house', dwellingTypeMatched: true, latestPeriod: '2025-12', capturedAt: null, periodsAvailable: 11,
    ...partial,
  };
}

describe('candidateFromPoints', () => {
  it('reads the growth horizons an adapter answer carries, longest first', () => {
    const c = candidateFromPoints({
      growth1Year: point(3.1, 'suburb', 'Truganina, VIC'),
      growth5YearCagr: point(4.4, 'suburb', 'Truganina, VIC'),
      growth10YearCagr: point(5.7, 'suburb', 'Truganina, VIC'),
      medianPrice: point(670000, 'suburb', 'Truganina, VIC'),
    }, { sourceLabel: 'VG', licence: 'CC BY', measure: 'median', dwellingType: 'house', dwellingTypeMatched: true, latestPeriod: '2025-12', capturedAt: '2026-08-03T04:09:29Z' });
    expect(c?.horizons.map((h) => h.years)).toEqual([10, 5, 1]);
    expect(c?.level).toBe('suburb');
    expect(c?.capturedAt).toBe('2026-08-03T04:09:29Z');
  });

  it('answers null where an answer carries no growth at all', () => {
    expect(candidateFromPoints({ medianPrice: point(670000, 'suburb', 'Truganina, VIC') }, { sourceLabel: 'VG', licence: 'CC BY', measure: 'median', dwellingType: 'house', dwellingTypeMatched: true, latestPeriod: '2025-12', capturedAt: null })).toBeNull();
    expect(candidateFromPoints({}, { sourceLabel: 'VG', licence: 'CC BY', measure: 'median', dwellingType: null, dwellingTypeMatched: false, latestPeriod: null, capturedAt: null })).toBeNull();
  });
});

describe('estimateCapitalGrowth', () => {
  const suburb10 = candidate({ level: 'suburb', areaName: 'Truganina, VIC', horizons: [{ years: 10, ratePct: 5.66, sourceNote: 's', asOf: '2025-12-31' }, { years: 1, ratePct: 3.1, sourceNote: 's', asOf: '2025-12-31' }] });
  const suburb1 = candidate({ level: 'suburb', areaName: 'Cobblebank, VIC', horizons: [{ years: 1, ratePct: -1.1, sourceNote: 's', asOf: '2025-12-31' }] });
  const state10 = candidate({ level: 'state', areaName: 'Victoria', provider: 'abs_res_dwell', sourceLabel: 'ABS', measure: 'mean', dwellingType: 'any', dwellingTypeMatched: false, horizons: [{ years: 10, ratePct: 4.92, sourceNote: 's', asOf: '2026-06-30' }, { years: 5, ratePct: 3.2, sourceNote: 's', asOf: '2026-06-30' }] });

  it('takes the finest area that carries a long-run horizon, rounded to one decimal, with its basis', () => {
    const e = estimateCapitalGrowth([suburb10, state10]);
    expect(e).toMatchObject({ ratePct: 5.7, horizonYears: 10, level: 'suburb', areaName: 'Truganina, VIC', version: CAPITAL_GROWTH_ESTIMATE_VERSION });
    expect(e!.basis).toBe('10-year compound annual growth of the median sale price of houses, Truganina, VIC (Victorian Valuer-General).');
    expect(e!.caveats).toEqual([]);
    expect(e!.alternatives).toEqual([{ level: 'state', areaName: 'Victoria', horizonYears: 10, ratePct: 4.9 }]);
  });

  it('prefers the state\'s ten years over a suburb\'s single year, and says why', () => {
    const e = estimateCapitalGrowth([suburb1, state10]);
    expect(e!.level).toBe('state');
    expect(e!.ratePct).toBe(4.9);
    expect(e!.caveats.join(' ')).toMatch(/state-wide series/);
    expect(e!.caveats.join(' ')).toMatch(/mean price of the residential dwelling stock/);
    expect(e!.caveats.join(' ')).toMatch(/all dwellings, not the property's own dwelling type/);
    expect(e!.alternatives).toEqual([{ level: 'suburb', areaName: 'Cobblebank, VIC', horizonYears: 1, ratePct: -1.1 }]);
    expect(MIN_LONG_RUN_HORIZON).toBe(5);
  });

  it('falls back to three years, then one, with the short-horizon caveat', () => {
    const three = candidate({ level: 'postcode', areaName: 'postcode 2155, NSW', horizons: [{ years: 3, ratePct: 6.02, sourceNote: 's', asOf: '2026-03-31' }, { years: 1, ratePct: 2, sourceNote: 's', asOf: '2026-03-31' }] });
    const e3 = estimateCapitalGrowth([three]);
    expect(e3).toMatchObject({ ratePct: 6, horizonYears: 3 });
    expect(e3!.caveats.join(' ')).toMatch(/Only 3 years of history/);
    expect(e3!.caveats.join(' ')).toMatch(/postcode-wide series/);
    const e1 = estimateCapitalGrowth([suburb1]);
    expect(e1).toMatchObject({ ratePct: -1.1, horizonYears: 1 });
    expect(e1!.caveats.join(' ')).toMatch(/Only one year of history/);
    expect(e1!.caveats.join(' ')).toMatch(new RegExp(`Outside the ${TYPICAL_RANGE_PCT.min}–${TYPICAL_RANGE_PCT.max}%`));
  });

  it('names an archive capture and a figure outside the typical range', () => {
    const archived = candidate({ level: 'suburb', areaName: 'Prospect, SA', capturedAt: '2025-05-17T06:36:20Z', horizons: [{ years: 5, ratePct: 11.94, sourceNote: 's', asOf: '2024-03-31' }] });
    const e = estimateCapitalGrowth([archived]);
    expect(e!.ratePct).toBe(11.9);
    expect(e!.caveats.join(' ')).toMatch(/Internet Archive's capture .* 2025-05-17/);
    expect(e!.caveats.join(' ')).toMatch(/more conservative figure/);
  });

  it('invents nothing: no horizons, no estimate', () => {
    expect(estimateCapitalGrowth([])).toBeNull();
    expect(estimateCapitalGrowth([candidate({ level: 'suburb', areaName: 'x', horizons: [] })])).toBeNull();
  });
});
