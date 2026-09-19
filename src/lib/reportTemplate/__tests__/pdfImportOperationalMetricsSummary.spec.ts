/**
 * pdf-operational-metrics-v1 diagnostics summary (Path-to-100 v2 · C11.7).
 * Locks the read-time display contract: cache hits never claim a current parse,
 * legacy jobs render unavailable (not zero), null is never shown as 0, totals vs
 * maxima are distinctly labelled, the callback-timing limitation is surfaced, and
 * no secrets/signed URLs are exposed. Pure → vitest, no Deno.
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
  chunkEnvelopeToAggInput,
} from '../../../../supabase/functions/_shared/pdfOperationalMetricsEnvelope.pure';
import { buildOperationalMetricsSummary } from '../ingestion/diagnostics/pdfImportOperationalMetricsSummary';

type Raw = Record<string, unknown>;

function monoRaw(over: Raw = {}): Raw {
  return {
    contract_version: SIDECAR_OPERATIONAL_METRICS_VERSION,
    engine_version: 'e', lane_enforcement_version: 'extractor-lane-policy-v2',
    scope: 'monolithic', status: 'succeeded', job_id: 'j',
    chunk_id: null, chunk_index: null, page_start: null, page_end: null,
    extractor_lane: 'accurate_table', requested_mode: 'hybrid', effective_mode: 'hybrid',
    memory_profile: 'standard', source_input_kind: 'url',
    timings: {
      source_download_ms: 20, source_resolve_ms: null, parse_ms: 400, raster_ms: null,
      artifact_upload_ms: 90, per_page_artifact_ms: 40, sidecar_elapsed_before_callback_ms: 700, callback_attempt_ms: null,
    },
    measurement_state: {
      source_download_ms: 'measured', source_resolve_ms: 'not_applicable', parse_ms: 'measured', raster_ms: 'not_applicable',
      artifact_upload_ms: 'measured', per_page_artifact_ms: 'measured', sidecar_elapsed_before_callback_ms: 'measured',
      callback_attempt_ms: 'not_observable_in_same_delivery',
    },
    callback_attempt_count: 0,
    counts: { page_count: 5, chunk_count: 0, avg_parse_ms_per_page: 80, ocr_page_ratio: 0.2, table_count: 3, picture_count: 2, text_block_count: 50, vector_count: 10 },
    bytes: { bytes_in: 2048, bytes_out: 4096 },
    ...over,
  };
}

function monoEnvelope(over: Raw = {}) {
  return {
    ...buildInvocationEnvelope({
      validation: validateSidecarOperationalMetricsV1(monoRaw(over)),
      source: 'monolithic', receivedAt: 'now',
      edge: buildEdgeObservation({ callbackReceivedAt: 'now', edgeProcessingMs: 8, operation: 'monolithic_success' }),
    }),
    scope_kind: 'monolithic',
    parent_elapsed_ms: 900,
  };
}

function chunkRaw(over: Raw = {}): Raw {
  return monoRaw({ scope: 'chunk', chunk_id: 'c', chunk_index: 1, page_start: 1, page_end: 5, counts: { ...(monoRaw().counts as Raw), chunk_count: 1 }, ...over });
}

describe('cache-hit summary', () => {
  const cacheSummary = () => buildOperationalMetricsSummary({
    cacheHit: true, cacheSourceJobId: 'source-job-9', durationMs: 42,
    cacheSourceMetricsAvailable: true, cacheSourceMetricsContractVersion: SIDECAR_OPERATIONAL_METRICS_VERSION,
  });

  it('#41 a cache hit never claims a current-run parse time', () => {
    const s = cacheSummary();
    expect(s.kind).toBe('cache_hit');
    expect(s.timings.find((c) => c.key === 'parse_ms')).toBeUndefined();
    expect(s.cache?.copyElapsedMs).toBe(42);
  });

  it('#42 the source-job metrics reference is labelled as source data', () => {
    const s = cacheSummary();
    expect(s.cache?.sourceJobId).toBe('source-job-9');
    expect(s.cache?.sourceMetricsAvailable).toBe(true);
  });

  it('#43 cache copy + parent elapsed are the current run values', () => {
    const s = cacheSummary();
    expect(s.cache?.copyElapsedMs).toBe(42);
    expect(s.cache?.parentElapsedMs).toBe(42);
    expect(s.parentElapsedMs).toBe(42);
  });
});

describe('diagnostics summary display contract', () => {
  it('#47 a legacy job renders as legacy/unavailable, not measured', () => {
    const s = buildOperationalMetricsSummary({ operationalMetrics: null, durationMs: 1000 });
    expect(s.kind).toBe('legacy_missing');
    expect(s.present).toBe(false);
    // (a job whose callback ran but carried no metrics)
    const s2 = buildOperationalMetricsSummary({ operationalMetrics: monoEnvelope() && buildInvocationEnvelope({ validation: validateSidecarOperationalMetricsV1(undefined), source: 'monolithic', receivedAt: 'now' }) });
    expect(s2.kind).toBe('legacy_missing');
    expect(s2.timings.every((c) => c.state === 'legacy' && c.ms === null)).toBe(true);
  });

  it('#48 a null phase is a state, never displayed as 0', () => {
    const s = buildOperationalMetricsSummary({ operationalMetrics: monoEnvelope() });
    const raster = s.timings.find((c) => c.key === 'raster_ms');
    expect(raster?.ms).toBeNull();
    expect(raster?.state).toBe('not_applicable');
    const parse = s.timings.find((c) => c.key === 'parse_ms');
    expect(parse?.ms).toBe(400);
  });

  it('#49 totals and maxima carry distinct aggregate labels', () => {
    const agg = aggregateChunkMetrics({
      chunks: [chunkEnvelopeToAggInput(buildInvocationEnvelope({ validation: validateSidecarOperationalMetricsV1(chunkRaw({ timings: { ...(chunkRaw().timings as Raw), parse_ms: 100 } })), source: 'chunk', receivedAt: 'now' }), 3),
               chunkEnvelopeToAggInput(buildInvocationEnvelope({ validation: validateSidecarOperationalMetricsV1(chunkRaw({ timings: { ...(chunkRaw().timings as Raw), parse_ms: 300 } })), source: 'chunk', receivedAt: 'now' }), 4)],
      parentElapsedMs: 5000, mergeMs: 20,
    });
    const s = buildOperationalMetricsSummary({ operationalMetrics: agg });
    expect(s.kind).toBe('chunked');
    const total = s.timings.find((c) => c.aggregate === 'total');
    const slowest = s.timings.find((c) => c.aggregate === 'slowest');
    expect(total).toBeTruthy();
    expect(slowest).toBeTruthy();
    expect(total?.label).not.toBe(slowest?.label);
    expect(s.parentElapsedMs).toBe(5000);
    expect(s.mergeMs).toBe(20);
  });

  it('#50 the callback-timing limitation note is present', () => {
    const s = buildOperationalMetricsSummary({ operationalMetrics: monoEnvelope() });
    expect(s.callbackLimitationNote).toMatch(/not contained in the same-delivery/i);
  });

  it('#51 the summary exposes no secrets or signed URLs', () => {
    const blob = JSON.stringify([
      buildOperationalMetricsSummary({ operationalMetrics: monoEnvelope() }),
      buildOperationalMetricsSummary({ cacheHit: true, cacheSourceJobId: 'x', durationMs: 5 }),
    ]).toLowerCase();
    for (const secret of ['http://', 'https://', 'bearer', 'service_role', 'token=', '?sig', 'signedurl']) {
      expect(blob).not.toContain(secret);
    }
  });

  it('surfaces a valid monolithic summary with lane identity', () => {
    const s = buildOperationalMetricsSummary({ operationalMetrics: monoEnvelope() });
    expect(s.kind).toBe('monolithic');
    expect(s.state).toBe('valid_v1');
    expect(s.extractorLane).toBe('accurate_table');
    expect(s.callbackEdgeProcessingMs).toBe(8);
  });
});
