/**
 * The archive as a delivery route: what the CDX index says, which capture
 * is chosen, and the URLs that return original bytes.
 */
import { describe, expect, it } from 'vitest';

import {
  archivePageUrl,
  capturedAtIso,
  cdxUrl,
  newestByRank,
  newestCapturePerOriginal,
  originalBytesUrl,
  parseCdxJson,
  rankedCaptures,
  rankedFiles,
} from '@/lib/reports/market/openData/waybackMirror.pure';

const CDX = JSON.stringify([
  ['timestamp', 'original', 'mimetype', 'statuscode', 'length'],
  ['20251120102927', 'https://www.land.vic.gov.au/__data/assets/excel_doc/0032/756581/houses-by-suburb-2014-2024.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '200', '221550'],
  ['20260803040929', 'https://www.land.vic.gov.au/__data/assets/excel_doc/0033/775617/houses-by-suburb-2015-2025.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '200', '137623'],
  ['20260101000000', 'https://www.land.vic.gov.au/__data/assets/excel_doc/0033/775617/houses-by-suburb-2015-2025.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '200', '137000'],
  ['20240925021808', 'https://www.land.vic.gov.au/__data/assets/excel_doc/0029/709751/Houses-by-suburb-2013-2023.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '200', '106970'],
  ['20260803040929', 'https://www.land.vic.gov.au/__data/assets/excel_doc/0034/775618/units-by-suburb-2015-2025.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '200', '83657'],
  ['20260803040929', 'https://www.land.vic.gov.au/__data/assets/excel_doc/0030/773742/median-house-q4-2025.xls', 'application/vnd.ms-excel', '200', '77050'],
  ['20260809092957', 'https://www.land.vic.gov.au/__data/assets/excel_doc/0036/766719/median-house-q3-2025.xls', 'application/vnd.ms-excel', '200', '70578'],
  ['20230101000000', 'https://www.land.vic.gov.au/__data/assets/excel_doc/0031/000001/broken.xlsx', 'text/html', '404', ''],
]);

describe('the CDX index', () => {
  it('builds a query for JSON, the five fields and 200s only', () => {
    const url = cdxUrl({ urlPattern: 'land.vic.gov.au/__data/assets/excel_doc/*', from: '2024', limit: 500 });
    expect(url.startsWith('https://web.archive.org/cdx/search/cdx?')).toBe(true);
    expect(url).toContain('url=land.vic.gov.au%2F__data%2Fassets%2Fexcel_doc%2F*');
    expect(url).toContain('output=json');
    expect(url).toContain('fl=timestamp%2Coriginal%2Cmimetype%2Cstatuscode%2Clength');
    expect(url).toContain('filter=statuscode%3A200');
    expect(url).toContain('from=2024');
    expect(url).toContain('limit=500');
  });

  it('parses the header-first JSON shape and keeps only well-formed rows', () => {
    const caps = parseCdxJson(CDX);
    expect(caps).toHaveLength(8);
    expect(caps[0]).toEqual({
      timestamp: '20251120102927',
      original: 'https://www.land.vic.gov.au/__data/assets/excel_doc/0032/756581/houses-by-suburb-2014-2024.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      statusCode: 200,
      length: 221550,
    });
    expect(caps[7].length).toBeNull();
  });

  it('an empty index is no captures; a challenge page is a refusal, never "nothing archived"', () => {
    expect(parseCdxJson('')).toEqual([]);
    expect(parseCdxJson('[]')).toEqual([]);
    expect(() => parseCdxJson('<!DOCTYPE html><title>Just a moment...</title>')).toThrow(/not JSON/);
    expect(() => parseCdxJson('{"error":"x"}')).toThrow(/not a list/);
    expect(() => parseCdxJson('[["urlkey","x"]]')).toThrow(/field header/);
  });
});

describe('choosing a capture', () => {
  const caps = parseCdxJson(CDX);

  it('keeps the newest capture of each original and drops non-200s', () => {
    const newest = newestCapturePerOriginal(caps);
    expect(newest.size).toBe(6);
    expect(newest.get('https://www.land.vic.gov.au/__data/assets/excel_doc/0033/775617/houses-by-suburb-2015-2025.xlsx')?.timestamp).toBe('20260803040929');
    expect([...newest.keys()].some((k) => k.endsWith('broken.xlsx'))).toBe(false);
  });

  it('ranks files by what the name says they describe, then takes the newest capture of the winner', () => {
    const chosen = newestByRank(caps, /^houses-by-suburb-(\d{4})-(\d{4})\.xlsx$/i, (m) => Number(m[2]));
    expect(chosen?.rank).toBe(2025);
    expect(chosen?.capture.timestamp).toBe('20260803040929');
    const quarterly = newestByRank(caps, /^median-house-q([1-4])-(\d{4})\.xls$/i, (m) => Number(m[2]) * 4 + Number(m[1]));
    expect(quarterly?.capture.original).toContain('median-house-q4-2025.xls');
  });

  it('lists every matched file newest-described first', () => {
    const ranked = rankedCaptures(caps, /^houses-by-suburb-(\d{4})-(\d{4})\.xlsx$/i, (m) => Number(m[2]));
    expect(ranked.map((r) => r.rank)).toEqual([2025, 2024, 2023]);
  });

  it('answers null when nothing matches', () => {
    expect(newestByRank(caps, /^nothing-(\d+)\.csv$/, (m) => Number(m[1]))).toBeNull();
  });
});

describe('the URLs', () => {
  it('returns the original bytes with the id_ flag and the archive page without it', () => {
    const c = { timestamp: '20260803040929', original: 'https://www.land.vic.gov.au/__data/assets/excel_doc/0033/775617/houses-by-suburb-2015-2025.xlsx' };
    expect(originalBytesUrl(c)).toBe('https://web.archive.org/web/20260803040929id_/https://www.land.vic.gov.au/__data/assets/excel_doc/0033/775617/houses-by-suburb-2015-2025.xlsx');
    expect(archivePageUrl(c)).toBe('https://web.archive.org/web/20260803040929/https://www.land.vic.gov.au/__data/assets/excel_doc/0033/775617/houses-by-suburb-2015-2025.xlsx');
  });

  it('reads the capture time as an ISO instant', () => {
    expect(capturedAtIso('20260803040929')).toBe('2026-08-03T04:09:29Z');
    expect(() => capturedAtIso('2026')).toThrow(/not a Wayback timestamp/);
  });
});

describe('every capture of a file', () => {
  const cap = (timestamp: string, original: string, statusCode = 200) => ({ timestamp, original, mimetype: 'application/octet-stream', statusCode, length: 1000 });
  const captures = [
    cap('20250516131629', 'https://x/lsg_stats_2025_q1.xlsx'),
    cap('20230405195446', 'https://x/lsg_stats_2022_q1.xlsx'),
    cap('20240101000000', 'https://x/lsg_stats_2022_q1.xlsx'),
    cap('20220101000000', 'https://x/lsg_stats_2022_q1.xlsx', 404),
    cap('20230405231858', 'https://x/lsgstats-2015q1.xlsx'),
    cap('20230405231900', 'https://x/readme.txt'),
  ];
  const rank = (m: RegExpExecArray) => Number(m[1]) * 4 + Number(m[2]);

  it('lists each matched file once, newest-described first, with its 200 captures newest first', () => {
    const files = rankedFiles(captures, /lsg_?stats[-_]?(\d{4})[-_]?q(\d)\.xlsx$/i, rank);
    expect(files.map((f) => f.original.slice(f.original.lastIndexOf('/') + 1))).toEqual(['lsg_stats_2025_q1.xlsx', 'lsg_stats_2022_q1.xlsx', 'lsgstats-2015q1.xlsx']);
    // the 2022 file: two 200 captures, newest first; the 404 dropped
    expect(files[1].captures.map((c) => c.timestamp)).toEqual(['20240101000000', '20230405195446']);
    expect(files[0].captures).toHaveLength(1);
  });

  it('answers nothing for nothing', () => {
    expect(rankedFiles([], /x/, () => 1)).toEqual([]);
  });
});
