/**
 * pdf-operational-metrics-v1 diagnostics summary (Path-to-100 v2 · C11.7).
 *
 * Read-time normalizer that turns a persisted `operational_metrics` envelope
 * (written by the C11 callbacks) — or a cache-hit / legacy job with none — into
 * a labelled, display-safe summary for the superadmin diagnostics UI.
 *
 * Truthfulness rules the UI relies on:
 *   - a null/unmeasured timing is a state (`—`), NEVER rendered as `0 ms`;
 *   - a measured `0` is a real value and kept;
 *   - cumulative chunk values are labelled "total", maxima "slowest";
 *   - `parent_elapsed_ms` is wall-clock elapsed, distinct from chunk sums;
 *   - `per_page_artifact_ms` is flagged as a SUBSET of artifact upload;
 *   - a cache hit shows copy/parent elapsed but NEVER the source run's parse;
 *   - the callback-delivery duration is not in the same-delivery payload.
 *
 * Pure + deterministic (shares the `_shared` validator/aggregator types) so the
 * edge function stays a thin data layer and the UI/contract can't drift.
 */

import type {
  MeasurementState,
  ValidationState,
} from '../../../../../supabase/functions/_shared/sidecarOperationalMetricsV1.pure';
import { buildCacheHitMetrics } from '../../../../../supabase/functions/_shared/pdfOperationalMetricsEnvelope.pure';

export const OPERATIONAL_METRICS_SUMMARY_VERSION = 'pdf-operational-metrics-v1';

export type MetricCellState =
  | MeasurementState
  | 'legacy'
  | 'cache_hit'
  | 'invalid';

export interface MetricTimingCell {
  key: string;
  label: string;
  ms: number | null;
  state: MetricCellState;
  /** true for per-page artifact time — a subset of artifact upload, not additive. */
  subsetOfUpload?: boolean;
  /** cumulative "total" vs "slowest"/max, for chunked aggregates. */
  aggregate?: 'total' | 'slowest';
}

export type OperationalMetricsKind =
  | 'monolithic'
  | 'synchronous'
  | 'chunked'
  | 'cache_hit'
  | 'legacy_missing'
  | 'unknown_version'
  | 'invalid';

export interface OperationalMetricsSummary {
  version: typeof OPERATIONAL_METRICS_SUMMARY_VERSION;
  present: boolean;
  kind: OperationalMetricsKind;
  /** A short state token the UI badges (e.g. `valid_v1`, `legacy_missing`, `degraded_invalid`). */
  state: string;
  degraded: boolean;
  contractVersion: string | null;
  laneEnforcementVersion: string | null;
  extractorLane: string | null;
  requestedMode: string | null;
  effectiveMode: string | null;
  memoryProfile: string | null;
  planMs: number | null;
  timings: MetricTimingCell[];
  callbackEdgeProcessingMs: number | null;
  callbackLimitationNote: string;
  parentElapsedMs: number | null;
  mergeMs: number | null;
  chunkCounts: { valid: number; legacyMissing: number; invalid: number; unknownVersion: number; total: number } | null;
  cache: {
    state: 'cache_hit';
    sourceJobId: string | null;
    copyElapsedMs: number | null;
    parentElapsedMs: number | null;
    sourceMetricsAvailable: boolean;
  } | null;
  problems: string[];
}

const CALLBACK_LIMITATION_NOTE =
  'The callback delivery duration is not contained in the same-delivery sidecar payload; ' +
  'Edge processing time is measured on receipt, network transit is not measured.';

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Map a sidecar measurement state to a display cell state (unknown → unavailable). */
function cellState(raw: unknown): MetricCellState {
  const known: MeasurementState[] = [
    'measured', 'not_applicable', 'unavailable', 'not_completed',
    'failed_before_phase', 'not_observable_in_same_delivery',
  ];
  return typeof raw === 'string' && (known as string[]).includes(raw)
    ? (raw as MeasurementState)
    : 'unavailable';
}

function timingCell(
  key: string,
  label: string,
  timings: Record<string, unknown> | undefined,
  states: Record<string, unknown> | undefined,
  opts: { subsetOfUpload?: boolean } = {},
): MetricTimingCell {
  const ms = finite(timings?.[key]);
  const state = cellState(states?.[key]);
  return { key, label, ms, state, ...(opts.subsetOfUpload ? { subsetOfUpload: true } : {}) };
}

function legacyCell(key: string, label: string, opts: { subsetOfUpload?: boolean } = {}): MetricTimingCell {
  return { key, label, ms: null, state: 'legacy', ...(opts.subsetOfUpload ? { subsetOfUpload: true } : {}) };
}

function aggCell(key: string, label: string, ms: number | null, aggregate: 'total' | 'slowest', opts: { subsetOfUpload?: boolean } = {}): MetricTimingCell {
  // Aggregate cells: a null value (no valid measurements) is a state, not 0.
  return { key, label, ms, state: ms === null ? 'unavailable' : 'measured', aggregate, ...(opts.subsetOfUpload ? { subsetOfUpload: true } : {}) };
}

export interface OperationalMetricsSummaryInput {
  /** `pdf_import_jobs.operational_metrics` (may be null on legacy/cache-hit rows). */
  operationalMetrics?: unknown;
  cacheHit?: boolean | null;
  cacheSourceJobId?: string | null;
  /** `pdf_import_jobs.duration_ms` — current-run wall clock (used for cache copy elapsed). */
  durationMs?: number | null;
  /** `plan_payload.plan_ms` when available. */
  planMs?: number | null;
  /** Whether the cache source job itself had metrics (looked up on the detail path). */
  cacheSourceMetricsAvailable?: boolean;
  cacheSourceMetricsContractVersion?: string | null;
}

function emptyBase(): Omit<OperationalMetricsSummary, 'kind' | 'state' | 'present' | 'degraded'> {
  return {
    version: OPERATIONAL_METRICS_SUMMARY_VERSION,
    contractVersion: null,
    laneEnforcementVersion: null,
    extractorLane: null,
    requestedMode: null,
    effectiveMode: null,
    memoryProfile: null,
    planMs: null,
    timings: [],
    callbackEdgeProcessingMs: null,
    callbackLimitationNote: CALLBACK_LIMITATION_NOTE,
    parentElapsedMs: null,
    mergeMs: null,
    chunkCounts: null,
    cache: null,
    problems: [],
  };
}

/**
 * Build the diagnostics operational-metrics summary for one job. Never throws;
 * an absent/legacy/malformed envelope yields an explicit non-`measured` summary.
 */
export function buildOperationalMetricsSummary(
  input: OperationalMetricsSummaryInput,
): OperationalMetricsSummary {
  const base = emptyBase();
  base.planMs = finite(input.planMs);

  // 1. Cache hit — a cached job did not run the sidecar. Derive honest current-run
  //    metrics from the row; never surface the source job's parse time as ours.
  if (input.cacheHit) {
    const cache = buildCacheHitMetrics({
      cacheSourceJobId: input.cacheSourceJobId ?? null,
      cacheCopyElapsedMs: finite(input.durationMs),
      parentElapsedMs: finite(input.durationMs),
      sourceMetricsAvailable: Boolean(input.cacheSourceMetricsAvailable),
      sourceMetricsContractVersion: input.cacheSourceMetricsContractVersion ?? null,
    });
    return {
      ...base,
      present: true,
      kind: 'cache_hit',
      state: 'cache_hit',
      degraded: false,
      parentElapsedMs: cache.parent_elapsed_ms,
      // Parse/raster deliberately absent: no sidecar ran this time.
      timings: [
        { key: 'cache_copy_elapsed_ms', label: 'Cache copy', ms: cache.cache_copy_elapsed_ms, state: cache.cache_copy_elapsed_ms === null ? 'unavailable' : 'cache_hit' },
      ],
      cache: {
        state: 'cache_hit',
        sourceJobId: cache.cache_source_job_id,
        copyElapsedMs: cache.cache_copy_elapsed_ms,
        parentElapsedMs: cache.parent_elapsed_ms,
        sourceMetricsAvailable: cache.source_job_metrics_available,
      },
    };
  }

  const env = input.operationalMetrics;
  // 2. No envelope at all → legacy sidecar (accepted; nothing to interpret).
  if (!env || typeof env !== 'object') {
    return { ...base, present: false, kind: 'legacy_missing', state: 'legacy_missing', degraded: false };
  }

  const e = env as Record<string, unknown>;

  // 3. Parent aggregation (chunked job).
  if (e.kind === 'parent') {
    const aggState = String(e.aggregate_state ?? 'unavailable');
    const degraded = aggState !== 'complete';
    const finalizeEdge = (e.finalize_edge as Record<string, unknown> | undefined)?.edge_processing_ms;
    return {
      ...base,
      present: true,
      kind: 'chunked',
      state: aggState,
      degraded,
      timings: [
        aggCell('chunk_parse_ms_sum', 'Chunk parse total', finite(e.chunk_parse_ms_sum), 'total'),
        aggCell('chunk_parse_ms_max', 'Slowest chunk parse', finite(e.chunk_parse_ms_max), 'slowest'),
        aggCell('chunk_raster_ms_sum', 'Chunk raster total', finite(e.chunk_raster_ms_sum), 'total'),
        aggCell('chunk_raster_ms_max', 'Slowest chunk raster', finite(e.chunk_raster_ms_max), 'slowest'),
        aggCell('chunk_artifact_upload_ms_sum', 'Chunk artifact upload total', finite(e.chunk_artifact_upload_ms_sum), 'total'),
        aggCell('chunk_per_page_artifact_ms_sum', 'Chunk per-page artifacts total', finite(e.chunk_per_page_artifact_ms_sum), 'total', { subsetOfUpload: true }),
        aggCell('chunk_sidecar_elapsed_ms_max', 'Slowest chunk sidecar elapsed', finite(e.chunk_sidecar_elapsed_ms_max), 'slowest'),
      ],
      callbackEdgeProcessingMs: finite(e.callback_edge_processing_ms_sum),
      parentElapsedMs: finite(e.parent_elapsed_ms),
      mergeMs: finite(e.merge_ms ?? finalizeEdge),
      chunkCounts: {
        valid: Number(e.valid_chunk_metric_count ?? 0),
        legacyMissing: Number(e.legacy_missing_chunk_metric_count ?? 0),
        invalid: Number(e.invalid_chunk_metric_count ?? 0),
        unknownVersion: Number(e.unknown_version_chunk_metric_count ?? 0),
        total: Number(e.chunk_metric_count ?? 0),
      },
      problems: Array.isArray(e.problems) ? (e.problems as string[]) : [],
    };
  }

  // 4. Invocation envelope (monolithic / synchronous).
  if (e.kind === 'invocation') {
    const validationState = String(e.validation_state ?? 'legacy_missing') as ValidationState;
    const edge = (e.edge as Record<string, unknown> | undefined)?.edge_processing_ms;
    const parentElapsed = finite(e.parent_elapsed_ms);

    if (validationState === 'legacy_missing') {
      return {
        ...base, present: true, kind: 'legacy_missing', state: 'legacy_missing', degraded: false,
        callbackEdgeProcessingMs: finite(edge), parentElapsedMs: parentElapsed,
        timings: [
          legacyCell('parse_ms', 'Parse'), legacyCell('raster_ms', 'Raster'),
          legacyCell('artifact_upload_ms', 'Artifact upload'),
          legacyCell('per_page_artifact_ms', 'Per-page artifacts', { subsetOfUpload: true }),
        ],
      };
    }
    if (validationState === 'unknown_version') {
      return { ...base, present: true, kind: 'unknown_version', state: 'unknown_version', degraded: true,
        contractVersion: typeof e.observed_contract_version === 'string' ? e.observed_contract_version : null,
        callbackEdgeProcessingMs: finite(edge), parentElapsedMs: parentElapsed,
        problems: Array.isArray(e.problems) ? (e.problems as string[]) : [] };
    }
    if (validationState !== 'valid_v1' || !e.metrics || typeof e.metrics !== 'object') {
      return { ...base, present: true, kind: 'invalid', state: validationState, degraded: true,
        contractVersion: typeof e.observed_contract_version === 'string' ? e.observed_contract_version : null,
        callbackEdgeProcessingMs: finite(edge), parentElapsedMs: parentElapsed,
        problems: Array.isArray(e.problems) ? (e.problems as string[]) : [] };
    }

    // The persisted metric is the NORMALIZED shape (camelCase container fields;
    // snake_case phase keys inside `timings`/`measurementState`).
    const m = e.metrics as Record<string, unknown>;
    const timings = (m.timings as Record<string, unknown>) ?? {};
    const states = (m.measurementState as Record<string, unknown>) ?? {};
    const scope = String(m.scope ?? 'monolithic');
    return {
      ...base,
      present: true,
      kind: scope === 'synchronous' ? 'synchronous' : 'monolithic',
      state: 'valid_v1',
      degraded: false,
      contractVersion: typeof m.contractVersion === 'string' ? m.contractVersion : null,
      laneEnforcementVersion: typeof m.laneEnforcementVersion === 'string' ? m.laneEnforcementVersion : null,
      extractorLane: typeof m.extractorLane === 'string' ? m.extractorLane : null,
      requestedMode: typeof m.requestedMode === 'string' ? m.requestedMode : null,
      effectiveMode: typeof m.effectiveMode === 'string' ? m.effectiveMode : null,
      memoryProfile: typeof m.memoryProfile === 'string' ? m.memoryProfile : null,
      timings: [
        timingCell('source_download_ms', 'Source fetch', timings, states),
        timingCell('source_resolve_ms', 'Source decode', timings, states),
        timingCell('parse_ms', 'Parse', timings, states),
        timingCell('raster_ms', 'Raster', timings, states),
        timingCell('artifact_upload_ms', 'Artifact upload', timings, states),
        timingCell('per_page_artifact_ms', 'Per-page artifacts', timings, states, { subsetOfUpload: true }),
        timingCell('sidecar_elapsed_before_callback_ms', 'Sidecar elapsed before callback', timings, states),
      ],
      callbackEdgeProcessingMs: finite(edge),
      parentElapsedMs: parentElapsed,
    };
  }

  // 5. Anything else → present but unrecognized.
  return { ...base, present: true, kind: 'unknown_version', state: 'unrecognized_envelope', degraded: true };
}
