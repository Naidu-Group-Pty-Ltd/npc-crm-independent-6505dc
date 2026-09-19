import { describe, it, expect } from 'vitest';
import {
  parseTimestamp,
  toReportProgress,
  activityState,
  isResumable,
  estimateRemainingMs,
  aggregateProgress,
  groupByBulkJob,
  formatEta,
  formatElapsed,
  STALLED_AFTER_MS,
  type ProgressRow,
} from '../selectors.pure';
import { sectionCountForTier } from '@/lib/reports/compassSectionRegistry';
import type { ReportProgress } from '../parts';

const NOW = Date.parse('2026-08-04T12:00:00.000Z');

function row(overrides: Partial<ProgressRow> = {}): ProgressRow {
  return {
    id: 'r1',
    property_address: '28 Bligh Street',
    status: 'processing',
    created_at: new Date(NOW - 5 * 60_000).toISOString(),
    updated_at: new Date(NOW - 10_000).toISOString(),
    last_completed_section: 6,
    total_sections: 17,
    ...overrides,
  };
}

function progress(overrides: Partial<ReportProgress> = {}): ReportProgress {
  return {
    id: 'r1',
    property_address: '28 Bligh Street',
    status: 'processing',
    sectionsCompleted: 6,
    totalSections: 17,
    contentLength: 0,
    error_message: null,
    lastUpdated: new Date(NOW - 10_000),
    lastCompletedSection: 6,
    createdAt: new Date(NOW - 5 * 60_000),
    bulkJobId: null,
    generationEngine: 'compass-40',
    ...overrides,
  };
}

describe('parseTimestamp', () => {
  it('falls back rather than producing an Invalid Date', () => {
    // The regression this guards: the API stopped returning `updated_at`, the
    // widget did `new Date(undefined)`, and every downstream comparison against
    // NaN silently evaluated false — which switched off stalled detection.
    expect(parseTimestamp(undefined, NOW)).toBe(NOW);
    expect(parseTimestamp(null, NOW)).toBe(NOW);
    expect(parseTimestamp('', NOW)).toBe(NOW);
    expect(parseTimestamp('not a date', NOW)).toBe(NOW);
  });

  it('parses a real ISO timestamp', () => {
    expect(parseTimestamp('2026-08-04T12:00:00.000Z', 0)).toBe(NOW);
  });
});

describe('toReportProgress', () => {
  it('never yields an Invalid Date when updated_at is missing', () => {
    const mapped = toReportProgress(row({ updated_at: undefined }), NOW);
    expect(Number.isNaN(mapped.lastUpdated.getTime())).toBe(false);
    expect(mapped.lastUpdated.getTime()).toBe(mapped.createdAt.getTime());
  });

  it('takes progress from the server counters', () => {
    const mapped = toReportProgress(row(), NOW);
    expect(mapped.sectionsCompleted).toBe(6);
    expect(mapped.totalSections).toBe(17);
  });

  it('falls back to the tier section count when total_sections is null', () => {
    const mapped = toReportProgress(row({ total_sections: null }), NOW);
    expect(mapped.totalSections).toBeGreaterThan(0);
    expect(mapped.totalSections).toBe(sectionCountForTier('compass'));
  });

  it('prefers the row’s own total over the registry, whatever the registry says now', () => {
    // Load-bearing across a section-list change. The v3.0 registry is 12 where
    // v2.0 was 17, and ~1,120 stored rows carry `total_sections: 17`. If the
    // fallback won, a finished 17-of-17 report would read as 17-of-12 — over
    // 100% complete — and a report stopped at 11 would read as finished.
    const stored = toReportProgress(row({ total_sections: 17, last_completed_section: 17 }), NOW);
    expect(stored.totalSections).toBe(17);
    expect(stored.sectionsCompleted).toBe(17);
    expect(sectionCountForTier('compass')).toBeLessThan(17);
  });

  it('clamps a section count that exceeds the total', () => {
    // A resumed report can report more sections than the current engine defines.
    // Unclamped this drove percent > 100 and a negative remaining, which made the
    // ETA formatter bail and the pill show "Estimating…" for a finished report.
    const mapped = toReportProgress(row({ last_completed_section: 40, total_sections: 17 }), NOW);
    expect(mapped.sectionsCompleted).toBe(17);
  });

  it('treats a negative or absent section count as zero', () => {
    expect(toReportProgress(row({ last_completed_section: -3 }), NOW).sectionsCompleted).toBe(0);
    expect(toReportProgress(row({ last_completed_section: null }), NOW).sectionsCompleted).toBe(0);
  });

  it('survives a null address', () => {
    expect(toReportProgress(row({ property_address: null }), NOW).property_address).toBe('Unknown address');
  });
});

describe('activityState', () => {
  it('reports generating while progress is recent', () => {
    expect(activityState(progress(), NOW)).toBe('generating');
  });

  it('reports stalled once the threshold passes with no progress', () => {
    const stale = progress({ lastUpdated: new Date(NOW - STALLED_AFTER_MS - 1000) });
    expect(activityState(stale, NOW)).toBe('stalled');
  });

  it('does not call a report stalled one millisecond early', () => {
    const edge = progress({ lastUpdated: new Date(NOW - STALLED_AFTER_MS + 1) });
    expect(activityState(edge, NOW)).toBe('generating');
  });

  it('gives a report that has produced nothing yet a longer grace period', () => {
    const fresh = progress({
      sectionsCompleted: 0,
      lastUpdated: new Date(NOW - STALLED_AFTER_MS - 1000),
    });
    expect(activityState(fresh, NOW)).toBe('generating');
  });

  it('never calls a fully generated report stalled', () => {
    const done = progress({
      sectionsCompleted: 17,
      lastUpdated: new Date(NOW - 60 * 60_000),
    });
    expect(activityState(done, NOW)).toBe('generating');
  });

  it('passes terminal statuses straight through', () => {
    expect(activityState(progress({ status: 'completed' }), NOW)).toBe('completed');
    expect(activityState(progress({ status: 'failed' }), NOW)).toBe('failed');
  });

  it('treats an untouched pending report as queued', () => {
    expect(activityState(progress({ status: 'pending', sectionsCompleted: 0 }), NOW)).toBe('queued');
  });
});

describe('isResumable', () => {
  it('resumes a stalled, incomplete report', () => {
    const stalled = progress({ lastUpdated: new Date(NOW - STALLED_AFTER_MS - 1000) });
    expect(isResumable(stalled, NOW)).toBe(true);
  });

  it('does not resume a report that already has every section', () => {
    const done = progress({
      status: 'failed',
      sectionsCompleted: 17,
      lastUpdated: new Date(NOW - 10 * 60_000),
    });
    expect(isResumable(done, NOW)).toBe(false);
  });

  it('does not resume a healthy in-flight report', () => {
    expect(isResumable(progress(), NOW)).toBe(false);
  });
});

describe('estimateRemainingMs', () => {
  it('returns null rather than 0 when every observation is the same instant', () => {
    // The old seeding pushed one identical timestamp per already-complete
    // section on the first poll, so span/(n-1) was 0 and a report at 30 of 40
    // announced "~0s left" and stayed there.
    const timeline = [NOW, NOW, NOW, NOW, NOW, NOW];
    expect(estimateRemainingMs(progress(), timeline, NOW)).toBeNull();
  });

  it('returns null with no observations at all', () => {
    expect(estimateRemainingMs(progress(), [], NOW)).toBeNull();
  });

  it('extrapolates from the observed cadence', () => {
    // Three sections seen 20s apart, 11 remaining of 17.
    const timeline = [NOW - 40_000, NOW - 20_000, NOW];
    const eta = estimateRemainingMs(progress({ sectionsCompleted: 6 }), timeline, NOW);
    expect(eta).toBe(20_000 * 11);
  });

  it('returns null once nothing remains', () => {
    const done = progress({ sectionsCompleted: 17 });
    expect(estimateRemainingMs(done, [NOW - 20_000, NOW], NOW)).toBeNull();
  });
});

describe('aggregateProgress', () => {
  it('does not run backwards when a report completes', () => {
    // Regression: summing only active reports meant a finishing report removed
    // its own completed sections from the numerator AND its total from the
    // denominator, so the bar fell at the moment of success.
    const midway = [
      progress({ id: 'a', sectionsCompleted: 34, totalSections: 40 }),
      progress({ id: 'b', sectionsCompleted: 4, totalSections: 40 }),
    ];
    const before = aggregateProgress(midway, NOW);

    const afterFirstCompletes = [
      progress({ id: 'a', status: 'completed', sectionsCompleted: 40, totalSections: 40 }),
      progress({ id: 'b', sectionsCompleted: 4, totalSections: 40 }),
    ];
    const after = aggregateProgress(afterFirstCompletes, NOW);

    expect(after.percent).toBeGreaterThanOrEqual(before.percent);
  });

  it('counts a completed report as fully done', () => {
    const agg = aggregateProgress(
      [progress({ status: 'completed', sectionsCompleted: 0, totalSections: 17 })],
      NOW,
    );
    expect(agg.completedSections).toBe(17);
    expect(agg.percent).toBe(100);
  });

  it('buckets each report by activity state exactly once', () => {
    const agg = aggregateProgress(
      [
        progress({ id: 'a' }),
        progress({ id: 'b', status: 'failed' }),
        progress({ id: 'c', status: 'completed' }),
        progress({ id: 'd', status: 'pending', sectionsCompleted: 0 }),
        progress({ id: 'e', lastUpdated: new Date(NOW - STALLED_AFTER_MS - 1000) }),
      ],
      NOW,
    );
    expect(agg.generating).toBe(1);
    expect(agg.failed).toBe(1);
    expect(agg.completed).toBe(1);
    expect(agg.queued).toBe(1);
    expect(agg.stalled).toBe(1);
    expect(agg.total).toBe(5);
  });

  it('is safe on an empty list', () => {
    const agg = aggregateProgress([], NOW);
    expect(agg.percent).toBe(0);
    expect(agg.total).toBe(0);
  });
});

describe('groupByBulkJob', () => {
  it('keeps a bulk job grouped even when only one member is left', () => {
    // The old rule dissolved a group the moment it dropped to one member, so the
    // group header, its aggregate and its stop-all control vanished mid-run.
    const { groups, loose } = groupByBulkJob([progress({ id: 'a', bulkJobId: 'job-1' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].jobId).toBe('job-1');
    expect(loose).toHaveLength(0);
  });

  it('separates loose reports from grouped ones', () => {
    const { groups, loose } = groupByBulkJob([
      progress({ id: 'a', bulkJobId: 'job-1' }),
      progress({ id: 'b', bulkJobId: 'job-1' }),
      progress({ id: 'c' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reports).toHaveLength(2);
    expect(loose.map((r) => r.id)).toEqual(['c']);
  });

  it('orders by creation so rows do not shuffle between polls', () => {
    const older = progress({ id: 'older', createdAt: new Date(NOW - 60_000) });
    const newer = progress({ id: 'newer', createdAt: new Date(NOW) });
    expect(groupByBulkJob([newer, older]).loose.map((r) => r.id)).toEqual(['older', 'newer']);
    expect(groupByBulkJob([older, newer]).loose.map((r) => r.id)).toEqual(['older', 'newer']);
  });
});

describe('formatting', () => {
  it('refuses to present a zero or nonsense ETA as a number', () => {
    expect(formatEta(null)).toBeNull();
    expect(formatEta(0)).toBeNull();
    expect(formatEta(-1)).toBeNull();
    expect(formatEta(Number.NaN)).toBeNull();
    expect(formatEta(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('scales ETA units', () => {
    expect(formatEta(45_000)).toBe('45s');
    expect(formatEta(5 * 60_000)).toBe('5m');
    expect(formatEta(90 * 60_000)).toBe('1h 30m');
  });

  it('does not render NaN for a corrupt duration', () => {
    // History entries come from localStorage and can be schema-drifted.
    expect(formatElapsed(Number.NaN)).toBe('—');
    expect(formatElapsed(-5)).toBe('—');
    expect(formatElapsed(45_000)).toBe('45s');
    expect(formatElapsed(125_000)).toBe('2m 5s');
  });
});
