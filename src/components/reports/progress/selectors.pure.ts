/**
 * Pure derivation for the report generation progress widget.
 *
 * Everything here is a plain function of its inputs, including "now" — the
 * component used to call `Date.now()` mid-render, which made renders impure and
 * froze every elapsed-time readout whenever polling paused. Pass the clock in.
 *
 * This module exists because the widget's bugs were all derivation bugs, and
 * none of them were reachable by a test while the logic lived inside JSX.
 */

import { sectionCountForTier } from '@/lib/reports/compassSectionRegistry';
import type { ReportProgress } from './parts';

/** Shape returned by `get-investment-reports` under the `generationProgress` projection. */
export interface ProgressRow {
  id: string;
  property_address: string | null;
  status: string;
  error_message?: string | null;
  created_at: string;
  updated_at?: string | null;
  last_completed_section?: number | null;
  total_sections?: number | null;
  bulk_job_id?: string | null;
  report_tier?: string | null;
  generation_engine?: string | null;
}

/**
 * A report is "stalled" once this long passes with no forward progress.
 *
 * There used to be three different thresholds — 75s to trigger auto-retry, 120s
 * for the header chip, 120s for the row banner — so the header could read
 * "1 Stalled" while the row read "Processing", and a report could be silently
 * retried while "Retry all stalled" was still disabled. One number now.
 */
export const STALLED_AFTER_MS = 90_000;

/** How long a finished report stays pinned in the list as a success confirmation. */
export const COMPLETED_RETENTION_MS = 30_000;

/** A report that has never produced a section is stuck differently — give it longer. */
const NO_PROGRESS_STALLED_AFTER_MS = 180_000;

/**
 * Parse a timestamp defensively.
 *
 * `new Date(undefined)` yields an Invalid Date whose `getTime()` is NaN, and
 * every comparison against NaN is false — which is precisely how the widget
 * silently lost stalled-detection when the API stopped returning `updated_at`.
 * Never hand an Invalid Date to the UI.
 */
export function parseTimestamp(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Map one API row onto the view model.
 *
 * Progress comes from the server's counters rather than from counting markdown
 * headings in the report body. The old `countSections` regex matched the legacy
 * engine's headings ("## Executive Summary", "## Location Overview"), so it
 * returned 0 for every Compass report — whose sections are "Cover Page",
 * "Executive Verdict", "Demand Drivers" and so on — and it required shipping the
 * whole report body to the browser on every poll to do it.
 *
 * `total_sections` on the row wins over the registry count, and that ordering is
 * load-bearing across a section-list change: the v3.0 registry declares 12 where
 * v2.0 declared 17, and ~1,120 stored rows carry 17. Reading the registry first
 * would make every one of them read as over 100% complete.
 */
export function toReportProgress(row: ProgressRow, now: number): ReportProgress {
  const createdAt = parseTimestamp(row.created_at, now);
  // A row with no updated_at falls back to created_at, never to Invalid Date.
  const lastUpdated = parseTimestamp(row.updated_at, createdAt);

  const persistedTotal = Number(row.total_sections) || 0;
  const totalSections = persistedTotal > 0 ? persistedTotal : sectionCountForTier(row.report_tier ?? undefined);

  // Clamp: a resumed report can briefly report a section count above its total
  // if the engine changed between runs. Left unclamped this drove percentages
  // over 100% and a negative "remaining", which made the ETA formatter bail and
  // the pill fall back to "Estimating…" for an all-but-finished report.
  const rawCompleted = Math.max(0, Number(row.last_completed_section) || 0);
  const sectionsCompleted = Math.min(rawCompleted, totalSections);

  const engine: ReportProgress['generationEngine'] =
    row.generation_engine === 'compass-40' ? 'compass-40'
    : row.generation_engine === 'legacy' ? 'legacy'
    : null;

  return {
    id: row.id,
    property_address: row.property_address || 'Unknown address',
    status: row.status,
    sectionsCompleted,
    totalSections,
    contentLength: 0,
    error_message: row.error_message ?? null,
    lastUpdated: new Date(lastUpdated),
    lastCompletedSection: sectionsCompleted,
    createdAt: new Date(createdAt),
    bulkJobId: row.bulk_job_id ?? null,
    generationEngine: engine,
    // `totalSections` above may be the registry's guess. This says whether the
    // RECORD stated it, which is the difference between a run that is
    // researching and a run that is hung — see `generationPhase`.
    sectionPlanSettled: persistedTotal > 0,
  };
}

/**
 * What the run is doing, as far as the record can say.
 *
 * The reported incident was a run reading `Section 1 of 15 · 0/15 · 0% · 21m 2s
 * elapsed`. Two things were wrong with that line and only one of them was the
 * run: it had genuinely banked nothing, and the widget had also been printing
 * exactly that line since the first second, because `totalSections` falls back
 * to the tier registry when the server has not stated one. So a healthy
 * forty-second research phase and a twenty-one minute hang produced the same
 * words, and nobody could tell them apart by looking.
 *
 * `investment_reports` writes `total_sections` on the first progressive save —
 * which is also the first moment any prose exists — so its absence is a real,
 * readable signal that the run has not yet started writing. Nothing new is
 * stored and nothing is inferred: this reads two columns the row already has.
 *
 * Deliberately NOT a fifth `ActivityState`. Stall detection, the header counts
 * and the resume decision all key on that vocabulary, and adding a member would
 * change what those mean. A phase says what is happening; a state says whether
 * anything is wrong.
 */
export type GenerationPhase = 'queued' | 'researching' | 'writing' | 'assembling';

export function generationPhase(report: ReportProgress): GenerationPhase {
  if (report.status === 'pending') return 'queued';
  // A legacy row, or one mid-flight before the widget was updated, has no flag.
  // Treat it as settled so it renders exactly as it did before.
  const settled = report.sectionPlanSettled !== false;
  if (!settled && report.sectionsCompleted === 0) return 'researching';
  if (settled && report.totalSections > 0 && report.sectionsCompleted >= report.totalSections) {
    return 'assembling';
  }
  return 'writing';
}

export type ActivityState = 'queued' | 'generating' | 'stalled' | 'failed' | 'completed';

/**
 * The single source of truth for what a row *is*, used by the container, the
 * header counts and the row itself so they can never disagree.
 */
export function activityState(report: ReportProgress, now: number): ActivityState {
  if (report.status === 'completed') return 'completed';
  if (report.status === 'failed') return 'failed';

  const sinceUpdate = now - report.lastUpdated.getTime();
  const hasProgress = report.sectionsCompleted > 0;
  const threshold = hasProgress ? STALLED_AFTER_MS : NO_PROGRESS_STALLED_AFTER_MS;
  const incomplete = report.sectionsCompleted < report.totalSections;

  if (report.status === 'processing' && incomplete && sinceUpdate > threshold) return 'stalled';
  if (report.status === 'pending') return hasProgress ? 'stalled' : 'queued';
  return 'generating';
}

/** Whether the widget should try to drive this report forward itself. */
export function isResumable(report: ReportProgress, now: number): boolean {
  const state = activityState(report, now);
  if (state === 'completed') return false;
  if (report.sectionsCompleted >= report.totalSections) return false;
  return state === 'stalled' || state === 'failed';
}

/**
 * Estimated milliseconds remaining, or null when we genuinely cannot say.
 *
 * `timeline` holds the wall-clock instants at which this client *observed* a new
 * section land. The previous implementation seeded it by pushing one timestamp
 * per already-completed section on the first poll — all with the same value —
 * so `last - first` was 0 and a report sitting at section 30 of 40 confidently
 * announced "~0s left". Anything narrower than two genuinely distinct
 * observations is not an estimate, so say nothing instead of lying.
 */
export function estimateRemainingMs(
  report: ReportProgress,
  timeline: number[],
  now: number,
): number | null {
  const remaining = report.totalSections - report.sectionsCompleted;
  if (remaining <= 0) return null;

  const distinct = Array.from(new Set(timeline)).sort((a, b) => a - b);
  if (distinct.length >= 2) {
    const span = distinct[distinct.length - 1] - distinct[0];
    const perSection = span / (distinct.length - 1);
    if (perSection > 0) return perSection * remaining;
  }

  // Single observation: measure from it rather than from creation, so queue wait
  // does not inflate the estimate.
  if (distinct.length === 1 && report.sectionsCompleted > 0) {
    const elapsedSinceFirstSeen = now - distinct[0];
    if (elapsedSinceFirstSeen > 0) return elapsedSinceFirstSeen * remaining;
  }

  return null;
}

export interface AggregateProgress {
  queued: number;
  generating: number;
  stalled: number;
  failed: number;
  completed: number;
  total: number;
  completedSections: number;
  totalSections: number;
  percent: number;
}

/**
 * Header/pill aggregate.
 *
 * `completedSections` counts a finished report's sections in full. Summing only
 * the *active* list made the bar run backwards: when a report at 34/40 finished
 * it left the list, taking both its 34 from the numerator and its 40 from the
 * denominator, so a second report at 4/40 dropped the readout from 48% to 10%
 * at the exact moment something succeeded.
 */
export function aggregateProgress(reports: ReportProgress[], now: number): AggregateProgress {
  const counts = { queued: 0, generating: 0, stalled: 0, failed: 0, completed: 0 };
  let completedSections = 0;
  let totalSections = 0;

  for (const report of reports) {
    const state = activityState(report, now);
    counts[state] += 1;
    totalSections += report.totalSections;
    completedSections += state === 'completed' ? report.totalSections : report.sectionsCompleted;
  }

  return {
    ...counts,
    total: reports.length,
    completedSections,
    totalSections,
    percent: totalSections > 0 ? Math.round((completedSections / totalSections) * 100) : 0,
  };
}

export interface BulkGroup {
  jobId: string;
  reports: ReportProgress[];
}

/**
 * Group by bulk job, preserving a stable order.
 *
 * Grouping is by job identity, not by how many members happen to still be
 * in-flight. The old rule ("only group if 2+") meant a batch dissolved into a
 * loose row the moment it got down to its last report — the group header, its
 * aggregate and its stop-all control vanished mid-run with no explanation.
 * Rows are ordered by creation so they do not shuffle under the pointer on
 * every 3-second poll.
 */
export function groupByBulkJob(reports: ReportProgress[]): {
  groups: BulkGroup[];
  loose: ReportProgress[];
} {
  const byCreation = [...reports].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const map = new Map<string, ReportProgress[]>();
  const loose: ReportProgress[] = [];

  for (const report of byCreation) {
    if (report.bulkJobId) {
      const arr = map.get(report.bulkJobId) ?? [];
      arr.push(report);
      map.set(report.bulkJobId, arr);
    } else {
      loose.push(report);
    }
  }

  return {
    groups: Array.from(map.entries()).map(([jobId, list]) => ({ jobId, reports: list })),
    loose,
  };
}

/** Human-readable duration for an ETA. Returns null when there is nothing honest to show. */
export function formatEta(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Elapsed-time label for "no progress for …". */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
