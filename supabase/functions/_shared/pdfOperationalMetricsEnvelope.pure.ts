/**
 * pdf-operational-metrics-v1 — downstream persisted envelope + parent
 * aggregation (Path-to-100 v2 · C11.2/C11.5/C11.9).
 *
 * The sidecar emits per-invocation `sidecar-operational-metrics-v1` objects
 * (validated by `sidecarOperationalMetricsV1.pure.ts`). This module is the
 * *downstream* representation the callbacks persist and diagnostics read:
 *
 *   A. invocation envelope   — one validated sidecar metric + its state.
 *   B. edge observation      — callback receipt + Edge processing time.
 *   C. parent aggregation    — honest chunk sums/maxima, elapsed kept separate.
 *   D. cache-hit metrics     — current-run copy time; never the source's parse.
 *   E. failure/recovery      — partial metrics + attempt identity preserved.
 *
 * Truthfulness rules encoded here:
 *   - a cumulative sum is never called "duration" / "elapsed";
 *   - parent wall-clock elapsed is supplied independently, never derived from
 *     chunk sums;
 *   - merge time is separate and never folded into chunk sums;
 *   - per_page_artifact_ms is a subset of artifact_upload_ms and is aggregated
 *     as its own field, never added into an upload total;
 *   - null/unmeasured values are ignored by sums/maxima; a measured 0 is kept;
 *   - a sum with no valid measurements is null, never 0.
 *
 * Pure module (no Deno/network) → shared by the Deno callbacks and vitest.
 */

import type {
  NormalizedSidecarOperationalMetricsV1,
  SidecarMetricsValidationResult,
  ValidationState,
} from './sidecarOperationalMetricsV1.pure.ts';

export const PDF_OPERATIONAL_METRICS_ENVELOPE_VERSION = 'pdf-operational-metrics-v1';

export type InvocationSource = 'monolithic' | 'chunk' | 'synchronous' | 'legacy_missing' | 'cache_source_reference';

export type CallbackOperation =
  | 'monolithic_success'
  | 'monolithic_failure'
  | 'chunk_success'
  | 'chunk_failure'
  | 'parent_finalize';

export type ParentAggregateState =
  | 'complete'
  | 'degraded_legacy'
  | 'degraded_invalid'
  | 'partial_failure'
  | 'unavailable';

export interface EdgeObservation {
  callback_received_at: string | null;
  edge_processing_ms: number | null;
  callback_operation: CallbackOperation;
  edge_function_version: string | null;
  /** We never claim to measure network transit or same-delivery callback time. */
  measures_network_transit: false;
}

export interface InvocationEnvelope {
  envelope_version: string;
  kind: 'invocation';
  source: InvocationSource;
  validation_state: ValidationState;
  observed_contract_version: string | null;
  problems: string[];
  received_at: string | null;
  /** The canonical validated metric — present only for a valid_v1 result. */
  metrics: NormalizedSidecarOperationalMetricsV1 | null;
  /** Which retry attempt produced this metric (chunk recovery visibility). */
  attempt: number | null;
  edge: EdgeObservation | null;
}

// -- numeric aggregation helpers --------------------------------------------

/** Sum of the measured (non-null) values, or null if none were measured. */
export function sumMeasured(values: Array<number | null | undefined>): number | null {
  let acc = 0;
  let seen = false;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      acc += v;
      seen = true;
    }
  }
  return seen ? acc : null;
}

/** Max of the measured (non-null) values, or null if none were measured. */
export function maxMeasured(values: Array<number | null | undefined>): number | null {
  let best: number | null = null;
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      best = best === null ? v : Math.max(best, v);
    }
  }
  return best;
}

// -- builders ----------------------------------------------------------------

export function buildEdgeObservation(args: {
  callbackReceivedAt: string | null;
  edgeProcessingMs: number | null;
  operation: CallbackOperation;
  edgeFunctionVersion?: string | null;
}): EdgeObservation {
  return {
    callback_received_at: args.callbackReceivedAt,
    edge_processing_ms:
      typeof args.edgeProcessingMs === 'number' && Number.isFinite(args.edgeProcessingMs) && args.edgeProcessingMs >= 0
        ? args.edgeProcessingMs
        : null,
    callback_operation: args.operation,
    edge_function_version: args.edgeFunctionVersion ?? null,
    measures_network_transit: false,
  };
}

/**
 * Wrap a sidecar-metrics validation result as a persisted invocation envelope.
 * Truthful about legacy/invalid/unknown — the raw values are never coerced.
 */
export function buildInvocationEnvelope(args: {
  validation: SidecarMetricsValidationResult;
  source: InvocationSource;
  receivedAt: string | null;
  attempt?: number | null;
  edge?: EdgeObservation | null;
}): InvocationEnvelope {
  const { validation } = args;
  const source: InvocationSource =
    validation.state === 'legacy_missing' ? 'legacy_missing' : args.source;
  return {
    envelope_version: PDF_OPERATIONAL_METRICS_ENVELOPE_VERSION,
    kind: 'invocation',
    source,
    validation_state: validation.state,
    observed_contract_version: validation.contractVersion,
    problems: validation.problems,
    received_at: args.receivedAt,
    metrics: validation.state === 'valid_v1' ? validation.metrics : null,
    attempt: args.attempt ?? null,
    edge: args.edge ?? null,
  };
}

// -- parent aggregation ------------------------------------------------------

export interface ChunkAggregationInput {
  /** Validation state for this non-split chunk's metrics. */
  state: ValidationState;
  /** The canonical metric when state === 'valid_v1', else null. */
  metrics: NormalizedSidecarOperationalMetricsV1 | null;
  /** This chunk's Edge callback processing time, if observed. */
  edgeProcessingMs?: number | null;
}

export interface ParentAggregation {
  envelope_version: string;
  kind: 'parent';
  scope: 'chunked';
  aggregate_state: ParentAggregateState;
  problems: string[];

  chunk_metric_count: number;
  valid_chunk_metric_count: number;
  legacy_missing_chunk_metric_count: number;
  invalid_chunk_metric_count: number;
  unknown_version_chunk_metric_count: number;

  chunk_parse_ms_sum: number | null;
  chunk_parse_ms_max: number | null;
  chunk_raster_ms_sum: number | null;
  chunk_raster_ms_max: number | null;
  chunk_artifact_upload_ms_sum: number | null;
  chunk_artifact_upload_ms_max: number | null;
  chunk_per_page_artifact_ms_sum: number | null;
  chunk_per_page_artifact_ms_max: number | null;
  chunk_sidecar_elapsed_ms_sum: number | null;
  chunk_sidecar_elapsed_ms_max: number | null;
  chunk_bytes_in_sum: number | null;
  chunk_bytes_out_sum: number | null;

  merge_ms: number | null;
  parent_elapsed_ms: number | null;
  callback_edge_processing_ms_sum: number | null;
  callback_edge_processing_ms_max: number | null;
}

/**
 * Aggregate validated chunk metrics into an honest parent envelope. Never
 * mutates the inputs. `parentElapsedMs` and `mergeMs` are supplied/measured
 * independently and are NEVER derived from the chunk sums.
 */
export function aggregateChunkMetrics(args: {
  chunks: ChunkAggregationInput[];
  parentElapsedMs: number | null;
  mergeMs: number | null;
}): ParentAggregation {
  const { chunks } = args;
  const problems: string[] = [];

  const valid = chunks.filter((c) => c.state === 'valid_v1' && c.metrics);
  const legacyCount = chunks.filter((c) => c.state === 'legacy_missing').length;
  const invalidCount = chunks.filter((c) => c.state === 'invalid_v1').length;
  const unknownCount = chunks.filter((c) => c.state === 'unknown_version').length;

  const parseVals = valid.map((c) => c.metrics!.timings.parse_ms);
  const rasterVals = valid.map((c) => c.metrics!.timings.raster_ms);
  const uploadVals = valid.map((c) => c.metrics!.timings.artifact_upload_ms);
  const perPageVals = valid.map((c) => c.metrics!.timings.per_page_artifact_ms);
  const elapsedVals = valid.map((c) => c.metrics!.timings.sidecar_elapsed_before_callback_ms);
  const bytesInVals = valid.map((c) => c.metrics!.bytes.bytes_in);
  const bytesOutVals = valid.map((c) => c.metrics!.bytes.bytes_out);
  const edgeVals = chunks.map((c) => c.edgeProcessingMs ?? null);

  // Any chunk whose invocation self-reported a non-success status is a partial failure.
  const anyFailedStatus = valid.some((c) => c.metrics!.status !== 'succeeded');

  let aggregate_state: ParentAggregateState;
  if (chunks.length === 0) {
    aggregate_state = 'unavailable';
    problems.push('no_chunk_metrics');
  } else if (invalidCount > 0 || unknownCount > 0) {
    aggregate_state = 'degraded_invalid';
    if (invalidCount > 0) problems.push('invalid_chunk_metrics_present');
    if (unknownCount > 0) problems.push('unknown_version_chunk_metrics_present');
  } else if (legacyCount > 0) {
    aggregate_state = 'degraded_legacy';
    problems.push('legacy_missing_chunk_metrics_present');
  } else if (anyFailedStatus) {
    aggregate_state = 'partial_failure';
    problems.push('chunk_metric_reports_non_success_status');
  } else if (valid.length > 0) {
    aggregate_state = 'complete';
  } else {
    aggregate_state = 'unavailable';
    problems.push('no_valid_chunk_metrics');
  }

  return {
    envelope_version: PDF_OPERATIONAL_METRICS_ENVELOPE_VERSION,
    kind: 'parent',
    scope: 'chunked',
    aggregate_state,
    problems,

    chunk_metric_count: chunks.length,
    valid_chunk_metric_count: valid.length,
    legacy_missing_chunk_metric_count: legacyCount,
    invalid_chunk_metric_count: invalidCount,
    unknown_version_chunk_metric_count: unknownCount,

    chunk_parse_ms_sum: sumMeasured(parseVals),
    chunk_parse_ms_max: maxMeasured(parseVals),
    chunk_raster_ms_sum: sumMeasured(rasterVals),
    chunk_raster_ms_max: maxMeasured(rasterVals),
    chunk_artifact_upload_ms_sum: sumMeasured(uploadVals),
    chunk_artifact_upload_ms_max: maxMeasured(uploadVals),
    chunk_per_page_artifact_ms_sum: sumMeasured(perPageVals),
    chunk_per_page_artifact_ms_max: maxMeasured(perPageVals),
    chunk_sidecar_elapsed_ms_sum: sumMeasured(elapsedVals),
    chunk_sidecar_elapsed_ms_max: maxMeasured(elapsedVals),
    chunk_bytes_in_sum: sumMeasured(bytesInVals),
    chunk_bytes_out_sum: sumMeasured(bytesOutVals),

    merge_ms: typeof args.mergeMs === 'number' && Number.isFinite(args.mergeMs) && args.mergeMs >= 0 ? args.mergeMs : null,
    parent_elapsed_ms:
      typeof args.parentElapsedMs === 'number' && Number.isFinite(args.parentElapsedMs) && args.parentElapsedMs >= 0
        ? args.parentElapsedMs
        : null,
    callback_edge_processing_ms_sum: sumMeasured(edgeVals),
    callback_edge_processing_ms_max: maxMeasured(edgeVals),
  };
}

// -- chunk persistence + aggregation-input helpers ---------------------------

/**
 * Decide which chunk operational-metrics envelope to persist. A later
 * duplicate/empty callback must never clobber an already-valid chunk metric; a
 * genuine re-run (recovery) that produces new valid metrics supersedes the prior
 * one, and the prior valid envelope is returned so the caller can preserve it in
 * the job attempt log (never silently replaced).
 */
export function chooseChunkMetricsEnvelope(
  existing: unknown,
  next: InvocationEnvelope,
): { envelope: InvocationEnvelope; supersededPriorValid: InvocationEnvelope | null } {
  const priorValid =
    existing && typeof existing === 'object' && (existing as { validation_state?: unknown }).validation_state === 'valid_v1'
      ? (existing as InvocationEnvelope)
      : null;
  if (next.validation_state === 'valid_v1') {
    return { envelope: next, supersededPriorValid: priorValid };
  }
  // Incoming is legacy/invalid/unknown: keep an existing valid metric intact.
  if (priorValid) return { envelope: priorValid, supersededPriorValid: null };
  return { envelope: next, supersededPriorValid: null };
}

/** Extract the (state, metrics) pair from a persisted chunk envelope for aggregation. */
export function chunkEnvelopeToAggInput(env: unknown, edgeProcessingMs: number | null): ChunkAggregationInput {
  if (!env || typeof env !== 'object') {
    return { state: 'legacy_missing', metrics: null, edgeProcessingMs };
  }
  const state = ((env as { validation_state?: unknown }).validation_state ?? 'legacy_missing') as ValidationState;
  const metrics = ((env as { metrics?: unknown }).metrics ?? null) as NormalizedSidecarOperationalMetricsV1 | null;
  const edge = (env as { edge?: { edge_processing_ms?: unknown } }).edge?.edge_processing_ms;
  return {
    state,
    metrics: state === 'valid_v1' ? metrics : null,
    edgeProcessingMs: typeof edge === 'number' ? edge : edgeProcessingMs,
  };
}

// -- cache-hit metrics -------------------------------------------------------

export interface CacheHitMetrics {
  envelope_version: string;
  kind: 'cache_hit';
  state: 'cache_hit';
  cache_source_job_id: string | null;
  /** Wall time to copy the cached artifacts in THIS run, if measurable. */
  cache_copy_elapsed_ms: number | null;
  /** THIS run's wall-clock elapsed — never the source job's. */
  parent_elapsed_ms: number | null;
  source_job_metrics_available: boolean;
  /** A read-only pointer to the source job's metrics — labelled as source data. */
  source_metrics_reference: { job_id: string; contract_version: string | null } | null;
}

/**
 * Build honest cache-hit metrics for the CURRENT run. Deliberately carries no
 * parse_ms/raster_ms/sidecar_elapsed of its own: a cache hit did not run the
 * sidecar. The source job's parse time is never copied in as the current run's.
 */
export function buildCacheHitMetrics(args: {
  cacheSourceJobId: string | null;
  cacheCopyElapsedMs: number | null;
  parentElapsedMs: number | null;
  sourceMetricsContractVersion?: string | null;
  sourceMetricsAvailable?: boolean;
}): CacheHitMetrics {
  const available = Boolean(args.sourceMetricsAvailable);
  return {
    envelope_version: PDF_OPERATIONAL_METRICS_ENVELOPE_VERSION,
    kind: 'cache_hit',
    state: 'cache_hit',
    cache_source_job_id: args.cacheSourceJobId,
    cache_copy_elapsed_ms:
      typeof args.cacheCopyElapsedMs === 'number' && Number.isFinite(args.cacheCopyElapsedMs) && args.cacheCopyElapsedMs >= 0
        ? args.cacheCopyElapsedMs
        : null,
    parent_elapsed_ms:
      typeof args.parentElapsedMs === 'number' && Number.isFinite(args.parentElapsedMs) && args.parentElapsedMs >= 0
        ? args.parentElapsedMs
        : null,
    source_job_metrics_available: available,
    source_metrics_reference:
      available && args.cacheSourceJobId
        ? { job_id: args.cacheSourceJobId, contract_version: args.sourceMetricsContractVersion ?? null }
        : null,
  };
}
