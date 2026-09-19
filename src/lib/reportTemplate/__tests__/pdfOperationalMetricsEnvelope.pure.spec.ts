/**
 * pdf-operational-metrics-v1 envelope + parent aggregation (Path-to-100 v2 · C11).
 * Locks the honest-aggregation properties: sums/maxima ignore null, a sum with
 * no measurements is null (never 0), a measured 0 is kept, per-page time is a
 * subset (never double-counted), parent elapsed + merge stay independent, and
 * recovery attempts are never aggregated as chunks. Pure → vitest, no Deno.
 */
import { describe, it, expect } from 'vitest';
import {
  validateSidecarOperationalMetricsV1,
  SIDECAR_OPERATIONAL_METRICS_VERSION,
} from '../../../../supabase/functions/_shared/sidecarOperationalMetricsV1.pure';
import {
  buildInvocationEnvelope,
  buildEdgeObservation,
  aggregateChunkMetrics,
  chooseChunkMetricsEnvelope,
  chunkEnvelopeToAggInput,
  sumMeasured,
  maxMeasured,
  PDF_OPERATIONAL_METRICS_ENVELOPE_VERSION,
  type ChunkAggregationInput,
} from '../../../../supabase/functions/_shared/pdfOperationalMetricsEnvelope.pure';

type Raw = Record<string, unknown>;

function chunkRaw(over: Raw = {}): Raw {
  return {
    contract_version: SIDECAR_OPERATIONAL_METRICS_VERSION,
    engine_version: 'e', lane_enforcement_version: 'extractor-lane-policy-v2',
    scope: 'chunk', status: 'succeeded', job_id: 'j', chunk_id: 'c', chunk_index: 1,
    page_start: 1, page_end: 5, extractor_lane: 'ocr_scanned', requested_mode: 'hybrid',
    effective_mode: 'hybrid', memory_profile: 'heavy', source_input_kind: 'url',
    timings: {
      source_download_ms: 10, source_resolve_ms: null, parse_ms: 300, raster_ms: 100,
      artifact_upload_ms: 50, per_page_artifact_ms: 20, sidecar_elapsed_before_callback_ms: 480,
      callback_attempt_ms: null,
    },
    measurement_state: {
      source_download_ms: 'measured', source_resolve_ms: 'not_applicable', parse_ms: 'measured',
      raster_ms: 'measured', artifact_upload_ms: 'measured', per_page_artifact_ms: 'measured',
      sidecar_elapsed_before_callback_ms: 'measured', callback_attempt_ms: 'not_observable_in_same_delivery',
    },
    callback_attempt_count: 0,
    counts: { page_count: 5, chunk_count: 1, avg_parse_ms_per_page: 60, ocr_page_ratio: 0.4, table_count: 1, picture_count: 0, text_block_count: 20, vector_count: 3 },
    bytes: { bytes_in: 1000, bytes_out: 2000 },
    ...over,
  };
}

/** A validated chunk envelope, as persisted on pdf_import_chunks.operational_metrics. */
function chunkEnvelope(over: Raw = {}, attempt = 0) {
  return buildInvocationEnvelope({
    validation: validateSidecarOperationalMetricsV1(chunkRaw(over)),
    source: 'chunk', receivedAt: '2026-07-17T00:00:00Z', attempt,
    edge: buildEdgeObservation({ callbackReceivedAt: '2026-07-17T00:00:00Z', edgeProcessingMs: 5, operation: 'chunk_success' }),
  });
}

function aggInput(over: Raw = {}, edge = 5): ChunkAggregationInput {
  const env = chunkEnvelope(over);
  return chunkEnvelopeToAggInput(env, edge);
}

describe('invocation envelope + edge observation', () => {
  it('#21 a legacy (no metrics) callback yields an accepted legacy_missing envelope', () => {
    const env = buildInvocationEnvelope({ validation: validateSidecarOperationalMetricsV1(undefined), source: 'monolithic', receivedAt: 'now' });
    expect(env.validation_state).toBe('legacy_missing');
    expect(env.source).toBe('legacy_missing');
    expect(env.metrics).toBeNull();
    expect(env.envelope_version).toBe(PDF_OPERATIONAL_METRICS_ENVELOPE_VERSION);
  });

  it('#22 an invalid V1 object is wrapped (not usable) but never throws', () => {
    const env = buildInvocationEnvelope({ validation: validateSidecarOperationalMetricsV1(chunkRaw({ scope: 'bad' })), source: 'chunk', receivedAt: 'now' });
    expect(env.validation_state).toBe('invalid_v1');
    expect(env.metrics).toBeNull();
    expect(env.problems.length).toBeGreaterThan(0);
  });

  it('#23 a failed invocation keeps its partial metrics', () => {
    const failed = chunkRaw({
      status: 'failed',
      timings: { ...(chunkRaw().timings as Raw), parse_ms: null, raster_ms: null, artifact_upload_ms: null, per_page_artifact_ms: null },
      measurement_state: { ...(chunkRaw().measurement_state as Raw), parse_ms: 'not_completed', raster_ms: 'not_completed', artifact_upload_ms: 'not_completed', per_page_artifact_ms: 'not_completed' },
    });
    const env = buildInvocationEnvelope({ validation: validateSidecarOperationalMetricsV1(failed), source: 'chunk', receivedAt: 'now' });
    expect(env.validation_state).toBe('valid_v1');
    expect(env.metrics?.status).toBe('failed');
    expect(env.metrics?.timings.source_download_ms).toBe(10);
    expect(env.metrics?.timings.parse_ms).toBeNull();
  });

  it('#24 the edge observation is persisted and never claims network transit', () => {
    const edge = buildEdgeObservation({ callbackReceivedAt: 't', edgeProcessingMs: 7, operation: 'monolithic_success', edgeFunctionVersion: 'v9' });
    expect(edge.edge_processing_ms).toBe(7);
    expect(edge.callback_operation).toBe('monolithic_success');
    expect(edge.edge_function_version).toBe('v9');
    expect(edge.measures_network_transit).toBe(false);
    expect(buildEdgeObservation({ callbackReceivedAt: 't', edgeProcessingMs: -1, operation: 'chunk_failure' }).edge_processing_ms).toBeNull();
  });
});

describe('chunk metrics persistence choice', () => {
  it('#25 first valid chunk metrics are persisted', () => {
    const next = chunkEnvelope();
    const r = chooseChunkMetricsEnvelope(null, next);
    expect(r.envelope.validation_state).toBe('valid_v1');
    expect(r.supersededPriorValid).toBeNull();
  });

  it('#26 a legacy chunk callback is accepted (state legacy_missing)', () => {
    const legacy = buildInvocationEnvelope({ validation: validateSidecarOperationalMetricsV1(undefined), source: 'chunk', receivedAt: 'now' });
    const r = chooseChunkMetricsEnvelope(null, legacy);
    expect(r.envelope.validation_state).toBe('legacy_missing');
  });

  it('#27 an invalid chunk metric persists as invalid (degraded downstream)', () => {
    const invalid = buildInvocationEnvelope({ validation: validateSidecarOperationalMetricsV1(chunkRaw({ scope: 'bad' })), source: 'chunk', receivedAt: 'now' });
    expect(chooseChunkMetricsEnvelope(null, invalid).envelope.validation_state).toBe('invalid_v1');
  });

  it('#28 a duplicate valid callback stays valid (idempotent)', () => {
    const first = chunkEnvelope();
    const dup = chunkEnvelope();
    const r = chooseChunkMetricsEnvelope(first, dup);
    expect(r.envelope.validation_state).toBe('valid_v1');
  });

  it('#29 a later empty/legacy duplicate does NOT overwrite a valid metric', () => {
    const valid = chunkEnvelope();
    const emptyLater = buildInvocationEnvelope({ validation: validateSidecarOperationalMetricsV1(undefined), source: 'chunk', receivedAt: 'later' });
    const r = chooseChunkMetricsEnvelope(valid, emptyLater);
    expect(r.envelope).toBe(valid); // kept the prior valid one
    expect(r.supersededPriorValid).toBeNull();
  });

  it('#30 a chunk failure keeps its partial metrics envelope', () => {
    const failed = buildInvocationEnvelope({
      validation: validateSidecarOperationalMetricsV1(chunkRaw({ status: 'failed' })),
      source: 'chunk', receivedAt: 'now',
    });
    expect(chooseChunkMetricsEnvelope(null, failed).envelope.metrics?.status).toBe('failed');
  });
});

describe('parent aggregation', () => {
  it('#31 three valid chunks produce correct sums and maxima', () => {
    const agg = aggregateChunkMetrics({
      chunks: [aggInput({ timings: { ...(chunkRaw().timings as Raw), parse_ms: 100 } }), aggInput({ timings: { ...(chunkRaw().timings as Raw), parse_ms: 200 } }), aggInput({ timings: { ...(chunkRaw().timings as Raw), parse_ms: 300 } })],
      parentElapsedMs: 5000, mergeMs: 40,
    });
    expect(agg.aggregate_state).toBe('complete');
    expect(agg.chunk_parse_ms_sum).toBe(600);
    expect(agg.chunk_parse_ms_max).toBe(300);
    expect(agg.valid_chunk_metric_count).toBe(3);
  });

  it('#32 parent elapsed is independent of the chunk sums', () => {
    const agg = aggregateChunkMetrics({ chunks: [aggInput(), aggInput()], parentElapsedMs: 9999, mergeMs: 10 });
    expect(agg.parent_elapsed_ms).toBe(9999);
    expect(agg.parent_elapsed_ms).not.toBe(agg.chunk_parse_ms_sum);
  });

  it('#33 merge time is separate and not folded into chunk sums', () => {
    const agg = aggregateChunkMetrics({ chunks: [aggInput()], parentElapsedMs: 100, mergeMs: 37 });
    expect(agg.merge_ms).toBe(37);
    expect(agg.chunk_parse_ms_sum).toBe(300); // unaffected by merge
  });

  it('#34 null/unmeasured phases are ignored by sums and maxima', () => {
    const withNullRaster = aggInput({
      timings: { ...(chunkRaw().timings as Raw), raster_ms: null },
      measurement_state: { ...(chunkRaw().measurement_state as Raw), raster_ms: 'not_applicable' },
    });
    const agg = aggregateChunkMetrics({ chunks: [aggInput(), withNullRaster], parentElapsedMs: 1, mergeMs: 1 });
    expect(agg.chunk_raster_ms_sum).toBe(100); // only the one measured raster
    expect(agg.chunk_raster_ms_max).toBe(100);
  });

  it('#35 a sum with no valid measurements is null, never 0', () => {
    const noRaster = () => aggInput({
      timings: { ...(chunkRaw().timings as Raw), raster_ms: null },
      measurement_state: { ...(chunkRaw().measurement_state as Raw), raster_ms: 'not_applicable' },
    });
    const agg = aggregateChunkMetrics({ chunks: [noRaster(), noRaster()], parentElapsedMs: 1, mergeMs: 1 });
    expect(agg.chunk_raster_ms_sum).toBeNull();
    expect(agg.chunk_raster_ms_max).toBeNull();
  });

  it('#36 a measured zero is retained (not treated as missing)', () => {
    const zeroParse = aggInput({ timings: { ...(chunkRaw().timings as Raw), parse_ms: 0 } });
    const agg = aggregateChunkMetrics({ chunks: [zeroParse], parentElapsedMs: 1, mergeMs: 1 });
    expect(agg.chunk_parse_ms_sum).toBe(0);
    expect(agg.chunk_parse_ms_sum).not.toBeNull();
  });

  it('#37 per-page artifact time is not double-counted into the upload total', () => {
    const agg = aggregateChunkMetrics({ chunks: [aggInput(), aggInput()], parentElapsedMs: 1, mergeMs: 1 });
    expect(agg.chunk_artifact_upload_ms_sum).toBe(100); // 50 + 50 only
    expect(agg.chunk_per_page_artifact_ms_sum).toBe(40); // 20 + 20, tracked separately
  });

  it('#38 one legacy chunk downgrades the aggregate to degraded_legacy', () => {
    const legacy: ChunkAggregationInput = { state: 'legacy_missing', metrics: null };
    const agg = aggregateChunkMetrics({ chunks: [aggInput(), legacy], parentElapsedMs: 1, mergeMs: 1 });
    expect(agg.aggregate_state).toBe('degraded_legacy');
    expect(agg.legacy_missing_chunk_metric_count).toBe(1);
  });

  it('#39 one invalid chunk downgrades the aggregate to degraded_invalid', () => {
    const invalid: ChunkAggregationInput = { state: 'invalid_v1', metrics: null };
    const agg = aggregateChunkMetrics({ chunks: [aggInput(), invalid], parentElapsedMs: 1, mergeMs: 1 });
    expect(agg.aggregate_state).toBe('degraded_invalid');
    expect(agg.invalid_chunk_metric_count).toBe(1);
  });

  it('#40 aggregation never mutates its inputs', () => {
    const inputs = [aggInput(), aggInput()];
    const snapshot = JSON.parse(JSON.stringify(inputs));
    inputs.forEach((c) => Object.freeze(c));
    expect(() => aggregateChunkMetrics({ chunks: inputs, parentElapsedMs: 1, mergeMs: 1 })).not.toThrow();
    expect(inputs).toEqual(snapshot);
  });
});

describe('recovery semantics', () => {
  it('#44 a recovered re-run preserves the prior attempt as superseded', () => {
    const priorFailed = chunkEnvelope({ status: 'failed' }, 0);
    const recovered = chunkEnvelope({ status: 'succeeded' }, 1);
    const r = chooseChunkMetricsEnvelope(priorFailed, recovered);
    expect(r.supersededPriorValid).not.toBeNull();
    expect(r.supersededPriorValid?.metrics?.status).toBe('failed');
  });

  it('#45 the successful recovered attempt becomes the chunk metric', () => {
    const priorFailed = chunkEnvelope({ status: 'failed' }, 0);
    const recovered = chunkEnvelope({ status: 'succeeded' }, 1);
    expect(chooseChunkMetricsEnvelope(priorFailed, recovered).envelope.metrics?.status).toBe('succeeded');
  });

  it('#46 attempts are counted as one chunk, never aggregated as parallel chunks', () => {
    // Two chunk rows (the final metric of each), not two attempts of one chunk.
    const agg = aggregateChunkMetrics({ chunks: [aggInput(), aggInput()], parentElapsedMs: 1, mergeMs: 1 });
    expect(agg.chunk_metric_count).toBe(2);
    expect(agg.valid_chunk_metric_count).toBe(2);
  });
});

describe('numeric helpers', () => {
  it('sumMeasured/maxMeasured ignore null and keep measured zero', () => {
    expect(sumMeasured([null, undefined])).toBeNull();
    expect(sumMeasured([0, null])).toBe(0);
    expect(sumMeasured([1, 2, null, 3])).toBe(6);
    expect(maxMeasured([null, 5, 2])).toBe(5);
    expect(maxMeasured([])).toBeNull();
  });
});
