/**
 * Victoria's quarters, found by the catalogue and the archive together.
 *
 * Every resource below is verbatim from `discover.data.vic.gov.au`'s
 * `package_search` answer, read from production on 21 Sep 2026 — including the
 * one that made this necessary.
 */
import { describe, expect, it } from 'vitest';
import {
  dwellingOfVicCatalogueResource,
  newestCatalogueQuarter,
  parseVicCatalogue,
  periodOfVicCatalogueResource,
  vicQuarterlyMedianResources,
} from '../../../../supabase/functions/_shared/reports/market/openData/vicVpsrCatalogue.pure.ts';
import {
  mergeVicQuarterSources,
  chooseNextVicQuarter,
} from '../../../../supabase/functions/_shared/reports/market/openData/vicVolumeBackfill.pure.ts';

const ASSET = 'https://www.land.vic.gov.au/__data/assets/excel_doc';

/** The catalogue's own answer, trimmed to the datasets that matter. */
const CKAN = {
  success: true,
  result: {
    count: 9,
    results: [
      {
        title: 'Victorian Property Sales Report - Yearly Summary',
        resources: [
          { format: 'XLS', name: 'September 2024 Quarter', url: `${ASSET}/0038/739289/vpsr-yearly-summary-q3-2024.xls` },
          { format: 'XLS', name: 'December 2025 Quarter', url: `${ASSET}/0029/773741/yearly-summary-q4-2025.xls` },
        ],
      },
      {
        title: 'Victorian Property Sales Report - Median House by Suburb Quarterly',
        resources: [
          // The state's own catalogue points at the Internet Archive here.
          { format: 'XLS', name: 'December 2023 Quarter', url: 'https://web.archive.org/web/20240718210312/https://www.land.vic.gov.au/__data/assets/excel_doc/0023/706334/median-house-q4-2023.xls' },
          // The spelling no filename pattern in this repo can match.
          { format: 'XLS', name: 'March 2024 Quarter', url: `${ASSET}/0021/716052/Median-House-VGS-1st-Qtr-2024.xls` },
          { format: 'XLS', name: 'December 2025 Quarter', url: `${ASSET}/0030/773742/median-house-q4-2025.xls` },
        ],
      },
      {
        title: 'Victorian Property Sales Report - Time Series',
        resources: [
          { format: 'XLSX', name: 'Year Summary 2024', url: `${ASSET}/0031/756580/year-summary-2024.xlsx` },
        ],
      },
    ],
  },
};

describe('reading the publisher\'s own index', () => {
  const all = parseVicCatalogue(CKAN);

  it('reads the quarter from the publisher\'s words', () => {
    expect(periodOfVicCatalogueResource('December 2025 Quarter')).toBe('2025-12');
    expect(periodOfVicCatalogueResource('March 2024 Quarter')).toBe('2024-03');
    expect(periodOfVicCatalogueResource('September 2024 Quarter')).toBe('2024-09');
    expect(periodOfVicCatalogueResource('June 2025 Quarter')).toBe('2025-06');
  });

  it('falls back to the file name in BOTH spellings the catalogue contains', () => {
    expect(periodOfVicCatalogueResource('', `${ASSET}/x/median-house-q4-2025.xls`)).toBe('2025-12');
    expect(periodOfVicCatalogueResource('', `${ASSET}/x/Median-House-VGS-1st-Qtr-2024.xls`)).toBe('2024-03');
  });

  it('is null for a resource that names no quarter', () => {
    expect(periodOfVicCatalogueResource('Year Summary 2024', `${ASSET}/x/year-summary-2024.xlsx`)).toBeNull();
  });

  it('separates land from dwellings rather than ignoring it', () => {
    expect(dwellingOfVicCatalogueResource('Median Land by Suburb', `${ASSET}/x/median-land-q4-2025.xls`)).toBe('land');
    expect(dwellingOfVicCatalogueResource('Median House by Suburb', '')).toBe('house');
    expect(dwellingOfVicCatalogueResource('Median Unit by Suburb', '')).toBe('attached');
  });

  it('keeps the median-by-suburb quarters and drops the yearly summary', () => {
    const houses = vicQuarterlyMedianResources(all, 'house');
    expect(houses.map((r) => r.period)).toEqual(['2025-12', '2024-03', '2023-12']);
    // A rolling year filed under a quarter would be a bigger number wearing a
    // smaller label.
    expect(houses.some((r) => /yearly-summary/i.test(r.fileName))).toBe(false);
  });

  /*
   * The reading a filename pattern cannot give. Asked whether Victoria had
   * published a 2026 quarter, a regex can only answer "no file I recognise";
   * the catalogue answers "December 2025", which is a fact about the
   * publisher.
   */
  it('states the newest quarter the publisher has actually released', () => {
    expect(newestCatalogueQuarter(vicQuarterlyMedianResources(all, 'house'))).toBe('2025-12');
  });

  it('refuses a body that is not a CKAN answer rather than reporting no quarters', () => {
    expect(() => parseVicCatalogue({ success: false })).toThrow(/not a CKAN result/);
    expect(() => parseVicCatalogue('<html>Just a moment...</html>')).toThrow(/not a CKAN result/);
  });
});

describe('the two sources together', () => {
  const catalogue = vicQuarterlyMedianResources(parseVicCatalogue(CKAN), 'house');
  const archived = [
    { original: `${ASSET}/0036/766719/median-house-q3-2025.xls` },
    { original: `${ASSET}/0030/773742/median-house-q4-2025.xls` },
  ];

  it('finds quarters neither source has alone', () => {
    const merged = mergeVicQuarterSources(catalogue, archived);
    expect(merged.map((c) => c.period)).toEqual(['2025-12', '2025-09', '2024-03', '2023-12']);
  });

  it('records which source found each, so a gap in either is visible', () => {
    const merged = mergeVicQuarterSources(catalogue, archived);
    const by = Object.fromEntries(merged.map((c) => [c.period, c.discoveredBy]));
    expect(by['2025-12']).toBe('both');
    // Only the archive holds q3-2025…
    expect(by['2025-09']).toBe('archive');
    // …and only the catalogue names the 2024 spelling.
    expect(by['2024-03']).toBe('catalogue');
  });

  it('keeps working when one source returns nothing', () => {
    expect(mergeVicQuarterSources([], archived).map((c) => c.period)).toEqual(['2025-12', '2025-09']);
    expect(mergeVicQuarterSources(catalogue, []).map((c) => c.period)).toEqual(['2025-12', '2024-03', '2023-12']);
  });

  it('honours the floor', () => {
    const merged = mergeVicQuarterSources(catalogue, archived, '2025-01');
    expect(merged.map((c) => c.period)).toEqual(['2025-12', '2025-09']);
  });

  it('skips quarters the register already counts, so a backfill resumes', () => {
    const merged = mergeVicQuarterSources(catalogue, archived);
    const { next, remaining } = chooseNextVicQuarter(merged, ['2025-12', '2025-09']);
    expect(next?.period).toBe('2024-03');
    expect(remaining.map((c) => c.period)).toEqual(['2024-03', '2023-12']);
  });

  it('is a no-op once everything is counted', () => {
    const merged = mergeVicQuarterSources(catalogue, archived);
    expect(chooseNextVicQuarter(merged, merged.map((c) => c.period)).next).toBeNull();
  });
});
