/**
 * Calculates 3-year (36-month) history coverage for employment and address records.
 * Used by both the internal dashboard and the client portal.
 */

const REQUIRED_MONTHS = 36;

export interface CoverageRecord {
  start_date?: string | null;
  end_date?: string | null;
  is_current?: boolean | null;
}

export interface CoverageResult {
  totalMonths: number;
  requiredMonths: number;
  remainingMonths: number;
  coveragePercent: number;
  isMet: boolean;
  gaps: { from: string; to: string; months: number }[];
}

/**
 * Calculate months between two dates (rounded down).
 */
function monthsBetween(start: Date, end: Date): number {
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  return Math.max(0, months);
}

/**
 * Compute 3-year coverage from a list of records with start_date/end_date.
 * Records without a start_date are ignored.
 */
export function calculateCoverage(records: CoverageRecord[]): CoverageResult {
  const now = new Date();
  
  // Filter to records that have a start date and parse them
  const parsed = records
    .filter(r => r.start_date)
    .map(r => ({
      start: new Date(r.start_date!),
      end: r.is_current || !r.end_date ? now : new Date(r.end_date),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (parsed.length === 0) {
    return {
      totalMonths: 0,
      requiredMonths: REQUIRED_MONTHS,
      remainingMonths: REQUIRED_MONTHS,
      coveragePercent: 0,
      isMet: false,
      gaps: [],
    };
  }

  // Merge overlapping ranges and sum total months
  const merged: { start: Date; end: Date }[] = [];
  for (const range of parsed) {
    if (merged.length === 0) {
      merged.push({ ...range });
    } else {
      const last = merged[merged.length - 1];
      if (range.start <= last.end) {
        // Overlapping — extend
        last.end = range.end > last.end ? range.end : last.end;
      } else {
        merged.push({ ...range });
      }
    }
  }

  let totalMonths = 0;
  for (const range of merged) {
    totalMonths += monthsBetween(range.start, range.end);
  }

  // Find gaps between merged ranges
  const gaps: { from: string; to: string; months: number }[] = [];
  for (let i = 1; i < merged.length; i++) {
    const gapStart = merged[i - 1].end;
    const gapEnd = merged[i].start;
    const gapMonths = monthsBetween(gapStart, gapEnd);
    if (gapMonths > 0) {
      gaps.push({
        from: gapStart.toISOString().split('T')[0],
        to: gapEnd.toISOString().split('T')[0],
        months: gapMonths,
      });
    }
  }

  const remainingMonths = Math.max(0, REQUIRED_MONTHS - totalMonths);
  const coveragePercent = Math.min(100, Math.round((totalMonths / REQUIRED_MONTHS) * 100));

  return {
    totalMonths,
    requiredMonths: REQUIRED_MONTHS,
    remainingMonths,
    coveragePercent,
    isMet: totalMonths >= REQUIRED_MONTHS,
    gaps,
  };
}

/**
 * Format a coverage result into a human-readable summary.
 */
export function formatCoverageSummary(coverage: CoverageResult): string {
  if (coverage.isMet) {
    return `3-year history requirement met (${coverage.totalMonths} months)`;
  }
  return `${coverage.totalMonths} of ${coverage.requiredMonths} months covered — ${coverage.remainingMonths} months remaining`;
}
