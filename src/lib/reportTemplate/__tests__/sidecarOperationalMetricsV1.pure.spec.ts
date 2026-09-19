/**
 * sidecar-operational-metrics-v1 downstream validator + monolithic reconciliation
 * (Path-to-100 v2 · C11). Locks the fail-open consumer contract: legacy absence,
 * unknown future versions, and malformed V1 claims are all accepted (never brick
 * an import) but only a strictly-valid V1 object is usable. Pure → runs under
 * vitest without Deno.
 */
import { describe, it, expect } from 'vitest';
import {
  validateSidecarOperationalMetricsV1,
  reconcileMonolithicMetrics,
  metricsObjectsIdentical,
  SIDECAR_OPERATIONAL_METRICS_VERSION,
} from '../../../../supabase/functions/_shared/sidecarOperationalMetricsV1.pure';

type Raw = Record<string, unknown>;

function validMonolithic(overrides: Raw = {}): Raw {
  return {
    contract_version: SIDECAR_OPERATIONAL_METRICS_VERSION,
    engine_version: 'docling-x',
    lane_enforcement_version: 'extractor-lane-policy-v2',
    scope: 'monolithic',
    status: 'succeeded',
    request_id: null,
    job_id: 'job-1',
    chunk_id: null,
    chunk_index: null,
    page_start: null,
    page_end: null,
    extractor_lane: 'accurate_table',
    requested_mode: 'hybrid',
    effective_mode: 'hybrid',
    memory_profile: 'standard',
    source_input_kind: 'url',
    timings: {
      source_download_ms: 20,
      source_resolve_ms: null,
      parse_ms: 400,
      raster_ms: 150,
      artifact_upload_ms: 90,
      per_page_artifact_ms: 40,
      sidecar_elapsed_before_callback_ms: 700,
      callback_attempt_ms: null,
    },
    measurement_state: {
      source_download_ms: 'measured',
      source_resolve_ms: 'not_applicable',
      parse_ms: 'measured',
      raster_ms: 'measured',
      artifact_upload_ms: 'measured',
      per_page_artifact_ms: 'measured',
      sidecar_elapsed_before_callback_ms: 'measured',
      callback_attempt_ms: 'not_observable_in_same_delivery',
    },
    callback_attempt_count: 0,
    counts: {
      page_count: 5, chunk_count: 0, avg_parse_ms_per_page: 80, ocr_page_ratio: 0.2,
      table_count: 3, picture_count: 2, text_block_count: 50, vector_count: 10,
    },
    bytes: { bytes_in: 2048, bytes_out: 4096 },
    ...overrides,
  };
}

function validChunk(overrides: Raw = {}): Raw {
  return validMonolithic({
    scope: 'chunk',
    chunk_id: 'c-2',
    chunk_index: 2,
    page_start: 6,
    page_end: 10,
    counts: {
      page_count: 5, chunk_count: 1, avg_parse_ms_per_page: 80, ocr_page_ratio: 0.4,
      table_count: 1, picture_count: 0, text_block_count: 20, vector_count: 3,
    },
    ...overrides,
  });
}

function validSynchronous(overrides: Raw = {}): Raw {
  return validMonolithic({
    scope: 'synchronous',
    request_id: 'req-1',
    job_id: null,
    timings: {
      source_download_ms: null, source_resolve_ms: 3, parse_ms: 120,
      raster_ms: null, artifact_upload_ms: null, per_page_artifact_ms: null,
      sidecar_elapsed_before_callback_ms: 130, callback_attempt_ms: null,
    },
    measurement_state: {
      source_download_ms: 'not_applicable', source_resolve_ms: 'measured', parse_ms: 'measured',
      raster_ms: 'not_applicable', artifact_upload_ms: 'not_applicable', per_page_artifact_ms: 'not_applicable',
      sidecar_elapsed_before_callback_ms: 'measured', callback_attempt_ms: 'not_applicable',
    },
    source_input_kind: 'base64',
    counts: {
      page_count: 2, chunk_count: 0, avg_parse_ms_per_page: 60, ocr_page_ratio: 0,
      table_count: 0, picture_count: 0, text_block_count: 5, vector_count: 0,
    },
    ...overrides,
  });
}

describe('validateSidecarOperationalMetricsV1', () => {
  it('#1 accepts a valid monolithic V1 object', () => {
    const r = validateSidecarOperationalMetricsV1(validMonolithic());
    expect(r.state).toBe('valid_v1');
    expect(r.ok).toBe(true);
    expect(r.metrics?.timings.parse_ms).toBe(400);
    expect(r.problems).toEqual([]);
  });

  it('#2 accepts a valid chunk V1 object', () => {
    const r = validateSidecarOperationalMetricsV1(validChunk());
    expect(r.state).toBe('valid_v1');
    expect(r.metrics?.scope).toBe('chunk');
    expect([r.metrics?.pageStart, r.metrics?.pageEnd]).toEqual([6, 10]);
    expect(r.metrics?.counts.chunk_count).toBe(1);
  });

  it('#3 accepts a valid synchronous V1 object', () => {
    const r = validateSidecarOperationalMetricsV1(validSynchronous());
    expect(r.state).toBe('valid_v1');
    expect(r.metrics?.scope).toBe('synchronous');
    expect(r.metrics?.measurementState.callback_attempt_ms).toBe('not_applicable');
  });

  it('#4 treats a missing metrics object as legacy_missing', () => {
    for (const raw of [undefined, null, {}, { foo: 1 }]) {
      const r = validateSidecarOperationalMetricsV1(raw);
      expect(r.state).toBe('legacy_missing');
      expect(r.ok).toBe(false);
      expect(r.metrics).toBeNull();
    }
  });

  it('#5 flags an unknown future contract version', () => {
    const r = validateSidecarOperationalMetricsV1(validMonolithic({ contract_version: 'sidecar-operational-metrics-v2' }));
    expect(r.state).toBe('unknown_version');
    expect(r.contractVersion).toBe('sidecar-operational-metrics-v2');
    expect(r.metrics).toBeNull();
  });

  it('#6 marks a V1 object with a bad scope as invalid_v1', () => {
    const r = validateSidecarOperationalMetricsV1(validMonolithic({ scope: 'weird' }));
    expect(r.state).toBe('invalid_v1');
    expect(r.problems).toContain('scope_invalid');
    expect(r.metrics).toBeNull();
  });

  it('#7 rejects a negative timing', () => {
    const bad = validMonolithic();
    (bad.timings as Raw).parse_ms = -5;
    const r = validateSidecarOperationalMetricsV1(bad);
    expect(r.state).toBe('invalid_v1');
    expect(r.problems).toContain('timing_parse_ms_not_finite_nonneg');
  });

  it('#8 rejects NaN / Infinity timings', () => {
    for (const v of [NaN, Infinity, -Infinity]) {
      const bad = validMonolithic();
      (bad.timings as Raw).raster_ms = v;
      expect(validateSidecarOperationalMetricsV1(bad).state).toBe('invalid_v1');
    }
  });

  it('#9 rejects a string timing', () => {
    const bad = validMonolithic();
    (bad.timings as Raw).parse_ms = '400';
    expect(validateSidecarOperationalMetricsV1(bad).state).toBe('invalid_v1');
  });

  it('#10 rejects an ocr_page_ratio outside 0..1', () => {
    expect(validateSidecarOperationalMetricsV1(validMonolithic({ counts: { ...(validMonolithic().counts as Raw), ocr_page_ratio: 1.5 } })).state).toBe('invalid_v1');
    expect(validateSidecarOperationalMetricsV1(validMonolithic({ counts: { ...(validMonolithic().counts as Raw), ocr_page_ratio: -0.1 } })).problems).toContain('ocr_page_ratio_out_of_bounds');
  });

  it('#11 rejects a measured state with a null timing', () => {
    const bad = validMonolithic();
    (bad.timings as Raw).parse_ms = null; // state stays 'measured'
    const r = validateSidecarOperationalMetricsV1(bad);
    expect(r.state).toBe('invalid_v1');
    expect(r.problems).toContain('timing_parse_ms_measured_but_null');
  });

  it('#12 rejects a non-measured state carrying a real timing', () => {
    const bad = validMonolithic();
    (bad.measurement_state as Raw).parse_ms = 'not_applicable'; // but value is 400
    const r = validateSidecarOperationalMetricsV1(bad);
    expect(r.state).toBe('invalid_v1');
    expect(r.problems).toContain('timing_parse_ms_nonmeasured_but_present');
  });

  it('#13 enforces same-delivery callback honesty', () => {
    const withDur = validMonolithic();
    (withDur.timings as Raw).callback_attempt_ms = 12;
    expect(validateSidecarOperationalMetricsV1(withDur).problems).toContain('callback_attempt_ms_must_be_null');

    const wrongAsyncState = validMonolithic();
    (wrongAsyncState.measurement_state as Raw).callback_attempt_ms = 'not_applicable';
    expect(validateSidecarOperationalMetricsV1(wrongAsyncState).problems).toContain('callback_attempt_ms_state_async_must_be_not_observable');

    const wrongSyncState = validSynchronous();
    (wrongSyncState.measurement_state as Raw).callback_attempt_ms = 'not_observable_in_same_delivery';
    expect(validateSidecarOperationalMetricsV1(wrongSyncState).problems).toContain('callback_attempt_ms_state_sync_must_be_not_applicable');
  });

  it('#14 rejects an invalid chunk page range', () => {
    const r = validateSidecarOperationalMetricsV1(validChunk({ page_start: 12, page_end: 6 }));
    expect(r.state).toBe('invalid_v1');
    expect(r.problems).toContain('chunk_page_start_gt_page_end');
  });

  it('#15 enforces chunk_count discipline vs scope', () => {
    expect(validateSidecarOperationalMetricsV1(validChunk({ counts: { ...(validChunk().counts as Raw), chunk_count: 0 } })).problems)
      .toContain('chunk_count_must_be_1_for_chunk_scope');
    expect(validateSidecarOperationalMetricsV1(validMonolithic({ counts: { ...(validMonolithic().counts as Raw), chunk_count: 1 } })).problems)
      .toContain('chunk_count_must_be_0_for_invocation_scope');
  });

  it('#16 never mutates its input', () => {
    const raw = validMonolithic();
    const snapshot = JSON.parse(JSON.stringify(raw));
    Object.freeze(raw);
    Object.freeze(raw.timings);
    Object.freeze(raw.counts);
    expect(() => validateSidecarOperationalMetricsV1(raw)).not.toThrow();
    expect(raw).toEqual(snapshot);
  });
});

describe('reconcileMonolithicMetrics (callback precedence)', () => {
  it('#17 top-level only → validates it', () => {
    const r = reconcileMonolithicMetrics(validMonolithic(), undefined);
    expect(r.state).toBe('valid_v1');
  });

  it('#18 nested only → validates it', () => {
    const r = reconcileMonolithicMetrics(undefined, validMonolithic());
    expect(r.state).toBe('valid_v1');
  });

  it('#19 identical top-level and nested → one canonical valid metric', () => {
    const top = validMonolithic();
    const nested = validMonolithic();
    expect(metricsObjectsIdentical(top, nested)).toBe(true);
    expect(reconcileMonolithicMetrics(top, nested).state).toBe('valid_v1');
  });

  it('#20 mismatch → invalid_v1 with top_level_nested_mismatch (never valid)', () => {
    const top = validMonolithic();
    const nested = validMonolithic({ status: 'partial' });
    const r = reconcileMonolithicMetrics(top, nested);
    expect(r.state).toBe('invalid_v1');
    expect(r.problems).toContain('top_level_nested_mismatch');
    expect(r.metrics).toBeNull();
  });
});
