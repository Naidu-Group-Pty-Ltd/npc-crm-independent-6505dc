/**
 * sidecar-operational-metrics-v1 downstream validator (Path-to-100 v2 · C11.1).
 *
 * Runtime-validates the operational-metrics object emitted by the G2 sidecar
 * (`pdf-parse-service/operational_metrics.py`) at the Supabase callback boundary.
 * The sidecar produces the metrics; this module is the *consumer* contract — it
 * decides whether an incoming object is a trustworthy V1 metric, a legacy
 * absence, an unknown future version, or a malformed V1 claim.
 *
 * Fail-open for import correctness: observability data must never brick an
 * otherwise-valid parse. The four states below are all *accepted* by the
 * callbacks; only `valid_v1` may feed aggregates.
 *
 * Pure module (no Deno/network) → shared by the Deno callbacks and vitest.
 */

export const SIDECAR_OPERATIONAL_METRICS_VERSION = 'sidecar-operational-metrics-v1';

export const METRICS_SCOPES = ['synchronous', 'monolithic', 'chunk'] as const;
export type MetricsScope = (typeof METRICS_SCOPES)[number];

export const METRICS_STATUSES = ['succeeded', 'failed', 'partial'] as const;
export type MetricsStatus = (typeof METRICS_STATUSES)[number];

export const MEASUREMENT_STATES = [
  'measured',
  'not_applicable',
  'unavailable',
  'not_completed',
  'failed_before_phase',
  'not_observable_in_same_delivery',
] as const;
export type MeasurementState = (typeof MEASUREMENT_STATES)[number];

/** Non-measured states carry a null timing; `measured` carries a real number. */
const NON_MEASURED_STATES = new Set<string>(
  MEASUREMENT_STATES.filter((s) => s !== 'measured'),
);

export const TIMING_PHASES = [
  'source_download_ms',
  'source_resolve_ms',
  'parse_ms',
  'raster_ms',
  'artifact_upload_ms',
  'per_page_artifact_ms',
  'sidecar_elapsed_before_callback_ms',
  'callback_attempt_ms',
] as const;
export type TimingPhase = (typeof TIMING_PHASES)[number];

export const COUNT_FIELDS = [
  'page_count',
  'chunk_count',
  'avg_parse_ms_per_page',
  'ocr_page_ratio',
  'table_count',
  'picture_count',
  'text_block_count',
  'vector_count',
] as const;

export type ValidationState = 'valid_v1' | 'legacy_missing' | 'unknown_version' | 'invalid_v1';

export interface NormalizedSidecarOperationalMetricsV1 {
  contractVersion: string;
  engineVersion: string | null;
  laneEnforcementVersion: string | null;
  scope: MetricsScope;
  status: MetricsStatus;
  requestId: string | null;
  jobId: string | null;
  chunkId: string | null;
  chunkIndex: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  extractorLane: string | null;
  requestedMode: string | null;
  effectiveMode: string | null;
  memoryProfile: string | null;
  sourceInputKind: string | null;
  timings: Record<TimingPhase, number | null>;
  measurementState: Record<TimingPhase, MeasurementState>;
  callbackAttemptCount: number;
  counts: {
    page_count: number | null;
    chunk_count: number;
    avg_parse_ms_per_page: number | null;
    ocr_page_ratio: number | null;
    table_count: number | null;
    picture_count: number | null;
    text_block_count: number | null;
    vector_count: number | null;
  };
  bytes: { bytes_in: number | null; bytes_out: number | null };
}

export interface SidecarMetricsValidationResult {
  ok: boolean;
  contractVersion: string | null;
  state: ValidationState;
  metrics: NormalizedSidecarOperationalMetricsV1 | null;
  problems: string[];
}

// -- primitives --------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A finite, non-negative number. Rejects NaN, Infinity, negatives, strings. */
function isFiniteNonNeg(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function optionalString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** A present numeric count must be finite/non-negative; absent → null. */
function normalizeCount(v: unknown, problems: string[], field: string): number | null {
  if (v === undefined || v === null) return null;
  if (!isFiniteNonNeg(v)) {
    problems.push(`count_${field}_not_finite_nonneg`);
    return null;
  }
  return v;
}

// -- validation --------------------------------------------------------------

/**
 * Classify + validate a candidate metrics object. Never throws; never mutates
 * the input. See module header for the fail-open contract.
 */
export function validateSidecarOperationalMetricsV1(
  raw: unknown,
): SidecarMetricsValidationResult {
  // No metrics object at all → the old sidecar. Accept; nothing to interpret.
  if (raw === undefined || raw === null || !isObject(raw)) {
    return { ok: false, contractVersion: null, state: 'legacy_missing', metrics: null, problems: [] };
  }

  const contractVersion = optionalString(raw.contract_version);
  if (contractVersion === null) {
    // A payload with no contract_version is treated as a legacy absence, not V1.
    return { ok: false, contractVersion: null, state: 'legacy_missing', metrics: null, problems: [] };
  }
  if (contractVersion !== SIDECAR_OPERATIONAL_METRICS_VERSION) {
    // A future/unknown contract: preserve its version tag but do NOT read fields as V1.
    return { ok: false, contractVersion, state: 'unknown_version', metrics: null, problems: [] };
  }

  // From here the object claims to be V1: validate strictly.
  const problems: string[] = [];

  const scope = raw.scope;
  if (typeof scope !== 'string' || !METRICS_SCOPES.includes(scope as MetricsScope)) {
    problems.push('scope_invalid');
  }
  const status = raw.status;
  if (typeof status !== 'string' || !METRICS_STATUSES.includes(status as MetricsStatus)) {
    problems.push('status_invalid');
  }

  const rawTimings = isObject(raw.timings) ? raw.timings : {};
  const rawStates = isObject(raw.measurement_state) ? raw.measurement_state : {};
  if (!isObject(raw.timings)) problems.push('timings_missing');
  if (!isObject(raw.measurement_state)) problems.push('measurement_state_missing');

  const timings = {} as Record<TimingPhase, number | null>;
  const measurementState = {} as Record<TimingPhase, MeasurementState>;

  for (const phase of TIMING_PHASES) {
    const tv = rawTimings[phase];
    const sv = rawStates[phase];

    // State must be a known measurement state.
    if (typeof sv !== 'string' || !MEASUREMENT_STATES.includes(sv as MeasurementState)) {
      problems.push(`state_${phase}_invalid`);
      measurementState[phase] = 'unavailable';
    } else {
      measurementState[phase] = sv as MeasurementState;
    }

    // Timing must be null or a finite non-negative number — never NaN/Inf/neg/string.
    let normalizedTiming: number | null;
    if (tv === undefined || tv === null) {
      normalizedTiming = null;
    } else if (isFiniteNonNeg(tv)) {
      normalizedTiming = tv;
    } else {
      problems.push(`timing_${phase}_not_finite_nonneg`);
      normalizedTiming = null;
    }
    timings[phase] = normalizedTiming;

    // State/value coherence.
    const state = measurementState[phase];
    if (state === 'measured' && normalizedTiming === null) {
      problems.push(`timing_${phase}_measured_but_null`);
    }
    if (NON_MEASURED_STATES.has(state) && tv !== undefined && tv !== null && normalizedTiming !== null) {
      problems.push(`timing_${phase}_nonmeasured_but_present`);
    }
  }

  // Callback-attempt honesty: the same-delivery attempt duration is never present.
  if (timings.callback_attempt_ms !== null) {
    problems.push('callback_attempt_ms_must_be_null');
  }
  const cbState = measurementState.callback_attempt_ms;
  if (scope === 'synchronous') {
    if (cbState !== 'not_applicable') problems.push('callback_attempt_ms_state_sync_must_be_not_applicable');
  } else if (scope === 'monolithic' || scope === 'chunk') {
    if (cbState !== 'not_observable_in_same_delivery') {
      problems.push('callback_attempt_ms_state_async_must_be_not_observable');
    }
  }

  // Counts.
  const rawCounts = isObject(raw.counts) ? raw.counts : {};
  if (!isObject(raw.counts)) problems.push('counts_missing');
  const pageCount = normalizeCount(rawCounts.page_count, problems, 'page_count');
  let chunkCount = normalizeCount(rawCounts.chunk_count, problems, 'chunk_count');
  const avgParse = normalizeCount(rawCounts.avg_parse_ms_per_page, problems, 'avg_parse_ms_per_page');
  const tableCount = normalizeCount(rawCounts.table_count, problems, 'table_count');
  const pictureCount = normalizeCount(rawCounts.picture_count, problems, 'picture_count');
  const textBlockCount = normalizeCount(rawCounts.text_block_count, problems, 'text_block_count');
  const vectorCount = normalizeCount(rawCounts.vector_count, problems, 'vector_count');

  // OCR ratio must be within [0, 1].
  let ocrRatio: number | null = null;
  const rawRatio = rawCounts.ocr_page_ratio;
  if (rawRatio === undefined || rawRatio === null) {
    ocrRatio = null;
  } else if (isFiniteNonNeg(rawRatio) && rawRatio <= 1) {
    ocrRatio = rawRatio;
  } else {
    problems.push('ocr_page_ratio_out_of_bounds');
    ocrRatio = null;
  }

  // chunk_count discipline vs scope.
  if (scope === 'chunk') {
    if (chunkCount !== 1) problems.push('chunk_count_must_be_1_for_chunk_scope');
  } else if (scope === 'monolithic' || scope === 'synchronous') {
    if (chunkCount !== 0) problems.push('chunk_count_must_be_0_for_invocation_scope');
  }

  // Chunk identity + page range coherence.
  const chunkIndex = rawCounts && typeof raw.chunk_index === 'number' && Number.isFinite(raw.chunk_index)
    ? raw.chunk_index
    : (raw.chunk_index === undefined || raw.chunk_index === null ? null : NaN);
  const pageStart = typeof raw.page_start === 'number' && Number.isFinite(raw.page_start) ? raw.page_start : null;
  const pageEnd = typeof raw.page_end === 'number' && Number.isFinite(raw.page_end) ? raw.page_end : null;
  if (scope === 'chunk') {
    if (typeof raw.chunk_id !== 'string' || !raw.chunk_id) problems.push('chunk_id_missing');
    if (chunkIndex === null || Number.isNaN(chunkIndex) || chunkIndex < 0) problems.push('chunk_index_invalid');
    if (pageStart === null || pageEnd === null) {
      problems.push('chunk_page_range_missing');
    } else if (pageStart > pageEnd) {
      problems.push('chunk_page_start_gt_page_end');
    }
  } else if (pageStart !== null && pageEnd !== null && pageStart > pageEnd) {
    problems.push('page_start_gt_page_end');
  }

  // Bytes.
  const rawBytes = isObject(raw.bytes) ? raw.bytes : {};
  const bytesIn = normalizeCount(rawBytes.bytes_in, problems, 'bytes_in');
  const bytesOut = normalizeCount(rawBytes.bytes_out, problems, 'bytes_out');

  const callbackAttemptCount = isFiniteNonNeg(raw.callback_attempt_count)
    ? Math.trunc(raw.callback_attempt_count as number)
    : 0;

  if (problems.length > 0) {
    // Claims V1 but is malformed. Accept the callback; do NOT feed aggregates.
    return { ok: false, contractVersion, state: 'invalid_v1', metrics: null, problems };
  }

  if (chunkCount === null) chunkCount = scope === 'chunk' ? 1 : 0;

  const metrics: NormalizedSidecarOperationalMetricsV1 = {
    contractVersion,
    engineVersion: optionalString(raw.engine_version),
    laneEnforcementVersion: optionalString(raw.lane_enforcement_version),
    scope: scope as MetricsScope,
    status: status as MetricsStatus,
    requestId: optionalString(raw.request_id),
    jobId: optionalString(raw.job_id),
    chunkId: optionalString(raw.chunk_id),
    chunkIndex: chunkIndex === null || Number.isNaN(chunkIndex) ? null : chunkIndex,
    pageStart,
    pageEnd,
    extractorLane: optionalString(raw.extractor_lane),
    requestedMode: optionalString(raw.requested_mode),
    effectiveMode: optionalString(raw.effective_mode),
    memoryProfile: optionalString(raw.memory_profile),
    sourceInputKind: optionalString(raw.source_input_kind),
    timings,
    measurementState,
    callbackAttemptCount,
    counts: {
      page_count: pageCount,
      chunk_count: chunkCount,
      avg_parse_ms_per_page: avgParse,
      ocr_page_ratio: ocrRatio,
      table_count: tableCount,
      picture_count: pictureCount,
      text_block_count: textBlockCount,
      vector_count: vectorCount,
    },
    bytes: { bytes_in: bytesIn, bytes_out: bytesOut },
  };

  return { ok: true, contractVersion, state: 'valid_v1', metrics, problems: [] };
}

/**
 * Reconcile the monolithic callback's top-level `metrics` with
 * `result_payload.metrics`. G2 emits the SAME object in both on success:
 *   - both present + identical  → validate the one canonical object;
 *   - only one present          → validate that one;
 *   - both present + different  → invalid_v1 (`top_level_nested_mismatch`); the
 *     malformed delivery is never treated as valid and never fails the import.
 */
export function reconcileMonolithicMetrics(topLevel: unknown, nested: unknown): SidecarMetricsValidationResult {
  const hasTop = topLevel !== undefined && topLevel !== null;
  const hasNested = nested !== undefined && nested !== null;
  if (hasTop && hasNested && !metricsObjectsIdentical(topLevel, nested)) {
    return {
      ok: false,
      contractVersion:
        typeof (topLevel as { contract_version?: unknown })?.contract_version === 'string'
          ? ((topLevel as { contract_version: string }).contract_version)
          : null,
      state: 'invalid_v1',
      metrics: null,
      problems: ['top_level_nested_mismatch'],
    };
  }
  return validateSidecarOperationalMetricsV1(hasTop ? topLevel : nested);
}

/**
 * Two metrics objects are canonically identical when they serialize equally.
 * Used by the monolithic callback to reconcile the top-level `metrics` field
 * with `result_payload.metrics` (G2 emits the same object in both).
 */
export function metricsObjectsIdentical(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return a === b;
  try {
    return stableStringify(a) === stableStringify(b);
  } catch {
    return false;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
