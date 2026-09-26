/**
 * When the report library re-reads itself.
 *
 * The library is read once when the page opens, and a report changes status
 * without the page knowing — written by this tab's generator, another tab,
 * the bulk worker or the cron watchdog. On 24 Sep 2026 the owner's screenshot
 * showed 93 Schofields Farm Road as "processing" and 60 Lawley Street as
 * "failed" after production had written both `completed`; a reload showed
 * the truth. So while any listed report is still being written, the page
 * re-reads the list quietly on this interval, and stops once none is.
 */

/** The statuses a report is still being written under. */
export const IN_FLIGHT_REPORT_STATUSES: ReadonlySet<string> = new Set(['pending', 'processing']);

/** How often the library re-reads itself while a report is in flight. */
export const LIBRARY_REFRESH_INTERVAL_MS = 30_000;

/** Is any listed report still being written? */
export function hasReportInFlight(reports: ReadonlyArray<{ status?: string | null } | null | undefined>): boolean {
  return reports.some((report) => !!report && typeof report.status === 'string' && IN_FLIGHT_REPORT_STATUSES.has(report.status));
}
