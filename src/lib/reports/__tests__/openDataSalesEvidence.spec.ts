/**
 * The register → evidence-point adapter: the keys the scorer reads, the
 * grain and footing every point carries, and the horizons it refuses.
 */
import { describe, expect, it } from 'vitest';

import type { EvidenceSubject } from '@/lib/reports/market/marketEvidence.pure';
import { mayEnterProductionEvidence, mayReachClientReport } from '@/lib/reports/market/marketEvidence.pure';
import type { SalesMedianRow } from '@/lib/reports/market/openData/salesRegister.pure';
import {
  ABS_STATE_SOURCE,
  NSW_REGISTER_SOURCE,
  QLD_REGISTER_SOURCE,
  SALES_REGISTER_SOURCES,
  VIC_REGISTER_SOURCE,
  chooseSpan,
  dwellingPreference,
  openDataSalesPoints,
  salesRegisterSourceFor,
  salesRegisterSourcesFor,
} from '@/lib/reports/market/openDataSalesEvidence.pure';

const QUARTERS = ['-03', '-06', '-09', '-12'];

/** A quarterly series from `fromYear` to `2026-03`, growing `annual` per cent a year. */
function series(
  area: string, areaKind: SalesMedianRow['areaKind'], dwellingType: SalesMedianRow['dwellingType'],
  start: number, annual: number, fromYear = 2015, state: SalesMedianRow['state'] = 'QLD',
): SalesMedianRow[] {
  const rows: SalesMedianRow[] = [];
  let value = start;
  const q = Math.pow(1 + annual / 100, 1 / 4);
  for (let year = fromYear; year <= 2026; year++) {
    for (const m of QUARTERS) {
      const period = `${year}${m}`;
      if (period > '2026-03') break;
      rows.push({ state, areaKind, area, dwellingType, period, medianPrice: Math.round(value), salesCount: 500 });
      value *= q;
    }
  }
  return rows;
}

const subject: EvidenceSubject = { suburb: 'Morayfield', postcode: '4506', state: 'QLD', dwellingType: 'house', resolvedFrom: 'coordinate' };

describe('the points a series becomes', () => {
  const rows = [...series('Moreton Bay (C)', 'lga', 'house', 400000, 6), ...series('Moreton Bay (C)', 'lga', 'attached', 300000, 4)];
  const bench = series('Total (all monitored regions)', 'region', 'house', 420000, 5);
  const result = openDataSalesPoints({
    subject, askedDwelling: 'house', areaKind: 'lga', area: 'Moreton Bay (C)', rows, benchmarkRows: bench, source: QLD_REGISTER_SOURCE,
  });

  it('draws every growth key the scorer reads, from the asked dwelling type', () => {
    expect(Object.keys(result.points).sort()).toEqual([
      'benchmarkGrowth1Year', 'benchmarkGrowth3YearCagr', 'benchmarkGrowth5YearCagr', 'benchmarkMedianPrice',
      'growth10YearCagr', 'growth1Year', 'growth3YearCagr', 'growth5YearCagr', 'medianPrice', 'priceSeries', 'salesCount',
    ]);
    expect(result.dwellingType).toBe('house');
    expect(result.dwellingTypeMatched).toBe(true);
    expect(result.latestPeriod).toBe('2026-03');
    expect(result.pricedPeriods).toBe(45);
    expect(result.points.growth5YearCagr!.value).toBeCloseTo(6, 0);
    expect(result.points.growth1Year!.value).toBeCloseTo(6, 0);
    expect(result.points.priceSeries!.value).toHaveLength(45);
    expect(result.points.priceSeries!.value[0]).toEqual({ period: '2015-03', value: 400000 });
  });

  it('stamps the publisher\'s grain, the area, the quarter and the open footing on every point', () => {
    for (const [key, p] of Object.entries(result.points)) {
      if (key.startsWith('benchmark')) continue;
      expect(p!.level, key).toBe('lga');
      expect(p!.areaName, key).toBe('Moreton Bay (C) local government area, QLD');
      expect(p!.provider, key).toBe('qld_qgso_rlda');
      expect(p!.asOf, key).toBe('2026-03-31');
      expect(p!.sampleSize, key).toBe(500);
      expect(p!.periodsAvailable, key).toBe(45);
      expect(p!.licensingStatus, key).toBe('open');
      expect(p!.acquisition, key).toBe('open_public');
      expect(mayReachClientReport(p!), key).toBe(true);
      expect(mayEnterProductionEvidence(p!), key).toBe(true);
      expect(p!.sourceNote, key).toContain("Queensland Government Statistician's Office");
    }
    expect(result.points.growth5YearCagr!.method).toBe('calculated');
    expect(result.points.medianPrice!.method).toBe('observed');
    expect(result.points.growth5YearCagr!.sourceNote).toContain('March 2021 quarter to March 2026 quarter');
  });

  it('draws the benchmark at state grain from the publisher\'s total', () => {
    expect(result.points.benchmarkMedianPrice!.level).toBe('state');
    expect(result.points.benchmarkGrowth5YearCagr!.value).toBeCloseTo(5, 0);
    expect(result.points.benchmarkMedianPrice!.areaName).toBe('QLD (all areas the publisher monitors)');
  });
});

describe('what the adapter refuses', () => {
  it('computes a horizon only where the same quarter exists that many years earlier', () => {
    const short = series('Isaac (R)', 'lga', 'house', 300000, 3, 2024);
    const r = openDataSalesPoints({ subject, askedDwelling: 'house', areaKind: 'lga', area: 'Isaac (R)', rows: short, source: QLD_REGISTER_SOURCE });
    expect(r.points.growth1Year).toBeDefined();
    expect(r.points.growth3YearCagr).toBeUndefined();
    expect(r.points.growth5YearCagr).toBeUndefined();
    expect(r.notes.some((n) => /No priced period 3 years before/.test(n))).toBe(true);
  });

  it('falls back to all-dwellings data and says so, never a different area', () => {
    const rows = series('2155', 'postcode', 'any', 1200000, 5, 2019, 'NSW');
    const r = openDataSalesPoints({
      subject: { ...subject, state: 'NSW', postcode: '2155', suburb: 'Kellyville' },
      askedDwelling: 'house', areaKind: 'postcode', area: '2155', rows, source: NSW_REGISTER_SOURCE,
    });
    expect(r.dwellingType).toBe('any');
    expect(r.dwellingTypeMatched).toBe(false);
    expect(r.points.medianPrice!.dwellingTypeMatched).toBe(false);
    expect(r.points.medianPrice!.level).toBe('postcode');
    expect(r.points.medianPrice!.areaName).toBe('postcode 2155, NSW');
    expect(r.points.medianPrice!.provider).toBe('nsw_dcj_rent_sales');
    expect(r.notes[0]).toMatch(/houses not priced for 2155; all dwellings used instead/);
  });

  it('answers nothing for land, for an empty register and for a series of one', () => {
    const rows = series('Moreton Bay (C)', 'lga', 'house', 400000, 6);
    expect(openDataSalesPoints({ subject, askedDwelling: 'land', areaKind: 'lga', area: 'Moreton Bay (C)', rows, source: QLD_REGISTER_SOURCE }).points).toEqual({});
    const none = openDataSalesPoints({ subject, askedDwelling: 'house', areaKind: 'lga', area: 'Nowhere (S)', rows: [], source: QLD_REGISTER_SOURCE });
    expect(none.points).toEqual({});
    expect(none.notes[0]).toMatch(/No priced period for Nowhere/);
    const suppressed = rows.map((r) => ({ ...r, medianPrice: null }));
    expect(openDataSalesPoints({ subject, askedDwelling: 'house', areaKind: 'lga', area: 'Moreton Bay (C)', rows: suppressed, source: QLD_REGISTER_SOURCE }).points).toEqual({});
    const one = openDataSalesPoints({ subject, askedDwelling: 'house', areaKind: 'lga', area: 'Moreton Bay (C)', rows: rows.slice(-1), source: QLD_REGISTER_SOURCE });
    expect(Object.keys(one.points)).toEqual(['medianPrice', 'salesCount']);
  });

  it('knows which states have a register, and in what order dwelling series are tried', () => {
    expect(salesRegisterSourceFor('QLD')!.areaKind).toBe('lga');
    expect(salesRegisterSourceFor('NSW')!.areaKind).toBe('postcode');
    expect(salesRegisterSourceFor('VIC')!.areaKind).toBe('suburb');
    expect(salesRegisterSourceFor('SA')!.areaKind).toBe('suburb');
    // Western Australia has no publisher series: only the ABS floor, which is never the "finest publisher source".
    expect(salesRegisterSourceFor('WA')).toBeNull();
    expect(salesRegisterSourceFor(null)).toBeNull();
    expect(salesRegisterSourcesFor('QLD').map((x) => x.areaKind)).toEqual(['lga', 'state']);
    expect(salesRegisterSourcesFor('WA')).toEqual([ABS_STATE_SOURCE]);
    expect(salesRegisterSourcesFor('XX')).toEqual([]);
    for (const list of Object.values(SALES_REGISTER_SOURCES)) expect(list[list.length - 1]).toBe(ABS_STATE_SOURCE);
    expect(VIC_REGISTER_SOURCE.route).toBe('archive');
    expect(dwellingPreference('house')).toEqual(['house', 'any']);
    expect(dwellingPreference('attached')).toEqual(['attached', 'any']);
    expect(dwellingPreference('any')).toEqual(['any', 'house', 'attached']);
    expect(dwellingPreference('land')).toEqual([]);
  });
});

describe('the second reading: suburb spans, the state floor and the national benchmark', () => {
  const subjectVic = { suburb: 'Truganina', postcode: '3029', state: 'VIC', dwellingType: 'house', resolvedFrom: 'coordinate' } as const;

  function annual(area: string, years: number[], base: number, step: number): SalesMedianRow[] {
    return years.map((y, i) => ({ state: 'VIC' as const, areaKind: 'suburb' as const, area, dwellingType: 'house' as const, period: `${y}-12`, medianPrice: base + i * step, salesCount: null, priceMeasure: 'median' as const, periodSpan: 'year' as const, capturedAt: '2026-08-03T04:09:29Z' }));
  }
  function quarters(area: string, periods: string[], base: number, step: number, sales = 40): SalesMedianRow[] {
    return periods.map((p, i) => ({ state: 'VIC' as const, areaKind: 'suburb' as const, area, dwellingType: 'house' as const, period: p, medianPrice: base + i * step, salesCount: i === periods.length - 1 ? sales : null, priceMeasure: 'median' as const, periodSpan: 'quarter' as const, capturedAt: '2026-08-03T04:09:29Z' }));
  }

  it('reads the calendar-year series where it is as current as the quarters, and labels it as years', () => {
    const rows = [...annual('TRUGANINA', [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025], 392000, 27000), ...quarters('TRUGANINA', ['2024-12', '2025-03', '2025-06', '2025-09', '2025-12'], 667500, 1000, 257)];
    expect(chooseSpan(rows)).toBe('year');
    const r = openDataSalesPoints({ subject: subjectVic, askedDwelling: 'house', areaKind: 'suburb', area: 'TRUGANINA', rows, source: VIC_REGISTER_SOURCE });
    expect(r.span).toBe('year');
    expect(r.points.medianPrice?.level).toBe('suburb');
    expect(r.points.medianPrice?.areaName).toBe('Truganina, VIC');
    expect(r.points.medianPrice?.sourceNote).toContain('calendar year 2025');
    expect(r.points.medianPrice?.sourceNote).toContain('Internet Archive captured it on 2026-08-03');
    expect(r.points.growth10YearCagr).toBeDefined();
    expect(r.points.growth1Year?.sourceNote).toContain('calendar year 2024 to calendar year 2025');
    expect(r.points.priceSeries?.value).toHaveLength(11);
  });

  it('reads the quarters where they are newer, and takes the longer horizons from the years with their own labels', () => {
    const rows = [...annual('TRUGANINA', [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025], 392000, 27000), ...quarters('TRUGANINA', ['2025-03', '2025-06', '2025-09', '2025-12', '2026-03'], 660000, 3000, 210)];
    expect(chooseSpan(rows)).toBe('quarter');
    const r = openDataSalesPoints({ subject: subjectVic, askedDwelling: 'house', areaKind: 'suburb', area: 'TRUGANINA', rows, source: VIC_REGISTER_SOURCE });
    expect(r.span).toBe('quarter');
    expect(r.latestPeriod).toBe('2026-03');
    expect(r.points.salesCount?.value).toBe(210);
    expect(r.points.growth1Year?.sourceNote).toContain('March 2025 quarter to March 2026 quarter');
    expect(r.points.growth5YearCagr?.sourceNote).toContain('calendar year 2020 to calendar year 2025');
    expect(r.points.growth5YearCagr?.asOf).toBe('2025-12-31');
  });

  it('reads the ABS state floor as growth only — never a median, never a sales count — benchmarked against the nation', () => {
    const periods = ['2016-06', '2017-06', '2018-06', '2019-06', '2020-06', '2021-06', '2022-06', '2023-06', '2024-06', '2025-06', '2026-06'];
    const wa: SalesMedianRow[] = periods.map((p, i) => ({ state: 'WA', areaKind: 'state', area: 'Western Australia', dwellingType: 'any', period: p, medianPrice: 531300 + i * 59000, salesCount: null, priceMeasure: 'mean', periodSpan: 'quarter', capturedAt: null }));
    const au: SalesMedianRow[] = periods.map((p, i) => ({ state: 'AU', areaKind: 'national', area: 'Australia', dwellingType: 'any', period: p, medianPrice: 619500 + i * 48000, salesCount: null, priceMeasure: 'mean', periodSpan: 'quarter', capturedAt: null }));
    const r = openDataSalesPoints({
      subject: { suburb: 'Scarborough', postcode: '6019', state: 'WA', dwellingType: 'house', resolvedFrom: 'coordinate' },
      askedDwelling: 'house', areaKind: 'state', area: 'Western Australia', rows: wa, nationalRows: au, source: ABS_STATE_SOURCE,
    });
    expect(r.points.medianPrice).toBeUndefined();
    expect(r.points.salesCount).toBeUndefined();
    expect(r.dwellingTypeMatched).toBe(false);
    expect(r.notes.join(' ')).toMatch(/mean price of the dwelling stock/);
    expect(r.points.growth10YearCagr?.level).toBe('state');
    expect(r.points.growth10YearCagr?.areaName).toBe('Western Australia');
    expect(r.points.growth10YearCagr?.provider).toBe('abs_res_dwell');
    expect(r.points.growth10YearCagr?.sourceNote).toMatch(/mean price of the residential dwelling stock/);
    expect(r.points.benchmarkGrowth5YearCagr?.level).toBe('national');
    expect(r.points.benchmarkGrowth5YearCagr?.areaName).toBe('Australia');
    expect(r.points.benchmarkMedianPrice).toBeUndefined();
  });

  it('benchmarks a suburb against the ABS state series where the publisher has no state-wide row', () => {
    const rows = annual('TRUGANINA', [2020, 2021, 2022, 2023, 2024, 2025], 580000, 18000);
    const vic: SalesMedianRow[] = ['2020-12', '2021-12', '2022-12', '2023-12', '2024-12', '2025-12'].map((p, i) => ({ state: 'VIC', areaKind: 'state', area: 'Victoria', dwellingType: 'any', period: p, medianPrice: 800000 + i * 20000, salesCount: null, priceMeasure: 'mean', periodSpan: 'quarter', capturedAt: null }));
    const r = openDataSalesPoints({ subject: subjectVic, askedDwelling: 'house', areaKind: 'suburb', area: 'TRUGANINA', rows, benchmarkRows: vic, source: VIC_REGISTER_SOURCE });
    expect(r.points.benchmarkGrowth1Year?.provider).toBe('abs_res_dwell');
    expect(r.points.benchmarkGrowth1Year?.areaName).toBe('Victoria');
    expect(r.points.benchmarkGrowth1Year?.level).toBe('state');
    expect(r.points.benchmarkMedianPrice).toBeUndefined();
  });
});
