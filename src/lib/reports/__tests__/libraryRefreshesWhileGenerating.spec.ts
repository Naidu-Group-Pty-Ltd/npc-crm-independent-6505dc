/**
 * The report library says what the rows say while a report is being written.
 *
 * 24 Sep 2026, the owner's screenshot: 93 Schofields Farm Road read
 * "processing" and 60 Lawley Street "failed" after production had written
 * both `completed` (generator logs 07:56:07 and 08:00:35); a reload showed
 * the truth. The page read the list once, on open.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { hasReportInFlight, IN_FLIGHT_REPORT_STATUSES, LIBRARY_REFRESH_INTERVAL_MS } from '../libraryRefresh.pure';

const PAGE = readFileSync(join(__dirname, '..', '..', '..', 'pages', 'GeneratedReports.tsx'), 'utf8');

describe('hasReportInFlight', () => {
  it('is true while any listed report is still being written, and false once none is', () => {
    expect(hasReportInFlight([{ status: 'completed' }, { status: 'processing' }])).toBe(true);
    expect(hasReportInFlight([{ status: 'pending' }])).toBe(true);
    expect(hasReportInFlight([{ status: 'completed' }, { status: 'failed' }, { status: null }, null])).toBe(false);
    expect(hasReportInFlight([])).toBe(false);
  });

  it('counts only the statuses a live run writes', () => {
    expect([...IN_FLIGHT_REPORT_STATUSES].sort()).toEqual(['pending', 'processing']);
    expect(LIBRARY_REFRESH_INTERVAL_MS).toBeGreaterThanOrEqual(15_000);
  });
});

describe('the library page re-reads itself', () => {
  it('re-reads quietly on an interval only while a report is in flight, and only when visible', () => {
    expect(PAGE).toContain('const investmentReportInFlight = hasReportInFlight(investmentReports);');
    expect(PAGE).toMatch(/if \(!investmentReportInFlight\) return;/);
    expect(PAGE).toMatch(/document\.visibilityState === 'visible'\) void fetchInvestmentReportsRef\.current\(\{ silent: true \}\)/);
    expect(PAGE).toMatch(/window\.clearInterval\(timer\)/);
  });

  it('re-reads when a generation starts or is stopped', () => {
    expect(PAGE).toMatch(/window\.addEventListener\(REPORT_GENERATION_STARTED_EVENT, onGenerationChanged\)/);
    expect(PAGE).toMatch(/window\.addEventListener\(REPORT_GENERATION_CANCELLED_EVENT, onGenerationChanged\)/);
  });

  it('re-reads through a ref, so an interval never applies an earlier render\'s filters', () => {
    expect(PAGE).toContain('fetchInvestmentReportsRef.current = fetchInvestmentReports;');
    expect(PAGE).not.toMatch(/setInterval\(\(\) => \{?\s*void fetchInvestmentReports\(/);
  });

  it('a quiet re-read never raises the error state or a toast over a good list', () => {
    const fetchBody = PAGE.slice(PAGE.indexOf('const fetchInvestmentReports = async'), PAGE.indexOf('// Fetch archived reports separately'));
    expect(fetchBody).toMatch(/if \(!options\.silent\) \{\s*if \(hadSuccessfulData\) setInvestmentRefreshing\(true\);/);
    expect((fetchBody.match(/if \(options\.silent\) return;/g) ?? []).length).toBe(2);
  });
});
