/**
 * PDF Extraction V3 · E10 — Plan V3 assembly (the ONE immutable plan) + preflight,
 * per-page complexity classification, routing audit and persisted-shape validators.
 *
 * `buildPlanV3` composes preflight -> page complexity -> route decisions -> chunk
 * plan -> cache fingerprint -> plan id/hash into ONE immutable plan. The plan id
 * and hash are pure functions of the plan's structural content, so:
 *   * SAME inputs -> SAME plan id/hash/classifications/routes/chunk plan/fingerprint
 *     (a retry reuses the identical plan);
 *   * a genuine REROUTE (different registry / routing policy / provider policy /
 *     planner inputs / impl version) -> a NEW plan id/hash (never a silent mutation).
 *
 * Byte-identical with the Python `planner_v3` producer for ASCII inputs. Pure —
 * the only imports are the sibling E10 pure modules.
 */
import {
  COMPLEXITY_TIERS,
  PDF_EXTRACTION_PLAN_V3_VERSION,
  PDF_EXTRACTION_PREFLIGHT_VERSION,
  PDF_PAGE_COMPLEXITY_VERSION,
  PDF_ROUTING_AUDIT_VERSION,
  PLANNER_V3_IMPLEMENTATION_VERSION,
  ROUTING_SAFE_REASON_CODES,
  type ChunkPlanEntryV3,
  type ComplexityTier,
  type PdfExtractionPreflightV1,
  type PdfPageComplexityV1,
  type PdfPageSignal,
  type ServiceClass,
  type ServiceClassRegistryV1,
  type ServiceRouteDecisionV1,
  type ServiceRoutingPolicyV1,
  fnv1a32,
  isSignedUrl,
  routePages,
  stableHash,
  stableJson,
} from './pdfServiceRoutingV1.pure.ts';
import {
  classificationDigest,
  computeCacheFingerprint,
  routeDigest,
  type CacheFingerprintV3Input,
} from './pdfCacheFingerprintV3.pure.ts';

export const CHUNK_SIZE_MIN = 1;
export const CHUNK_SIZE_MAX = 50;

// ── Preflight ────────────────────────────────────────────────────────────────

function finite(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
function intOf(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? Math.trunc(v) : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function buildPageSignal(raw: Record<string, unknown>): PdfPageSignal {
  return {
    page_number: Math.max(1, intOf(raw.page_number, 1)),
    text_char_count: Math.max(0, intOf(raw.text_char_count, 0)),
    text_coverage_ratio: clamp01(finite(raw.text_coverage_ratio, 0)),
    image_area_ratio: clamp01(finite(raw.image_area_ratio, 0)),
    vector_op_count: Math.max(0, intOf(raw.vector_op_count, 0)),
    has_scanned_layer: Boolean(raw.has_scanned_layer),
    table_region_count: Math.max(0, intOf(raw.table_region_count, 0)),
  };
}

export function buildPreflight(raw: Record<string, unknown>): PdfExtractionPreflightV1 {
  const rawSignals = Array.isArray(raw.page_signals) ? (raw.page_signals as Record<string, unknown>[]) : [];
  const page_signals = rawSignals
    .filter((p) => p && typeof p === 'object')
    .map(buildPageSignal)
    .sort((a, b) => a.page_number - b.page_number);
  const page_count = (intOf(raw.page_count, page_signals.length) || page_signals.length);
  const scannedPages = page_signals.filter((s) => s.has_scanned_layer).length;
  const scannedRatio = page_count > 0 ? clamp01(scannedPages / page_count) : 0;
  return {
    version: PDF_EXTRACTION_PREFLIGHT_VERSION,
    source_sha256: String(raw.source_sha256 ?? ''),
    byte_size: Math.max(0, intOf(raw.byte_size, 0)),
    page_count: Math.max(0, page_count),
    file_type: 'pdf',
    has_selectable_text: Boolean(raw.has_selectable_text),
    selectable_text_ratio: clamp01(finite(raw.selectable_text_ratio, 0)),
    scanned_page_ratio: clamp01(finite(raw.scanned_page_ratio, scannedRatio)),
    ocr_hint: Boolean(raw.ocr_hint),
    image_heavy: Boolean(raw.image_heavy),
    design_heavy: Boolean(raw.design_heavy),
    table_likelihood: String(raw.table_likelihood ?? 'low'),
    encrypted: Boolean(raw.encrypted),
    page_signals,
  };
}

// ── Per-page complexity classification ───────────────────────────────────────

const MIN_NATIVE_TEXT_CHARS = 40;
const MIN_TEXT_COVERAGE = 0.12;
const RICH_VECTOR_OPS = 120;
const IMAGE_DOMINANT_RATIO = 0.75;
const LOW_TEXT_COVERAGE = 0.04;

function mkComplexity(
  pageNumber: number,
  tier: ComplexityTier,
  flags: { ocr: boolean; tables: boolean; raster: boolean; vlm: boolean },
  reasons: string[],
): PdfPageComplexityV1 {
  return {
    version: PDF_PAGE_COMPLEXITY_VERSION,
    page_number: pageNumber,
    tier,
    requires_ocr: flags.ocr,
    requires_tables: flags.tables,
    requires_raster: flags.raster,
    requires_vlm: flags.vlm,
    reason_codes: reasons,
  };
}

export function classifyPage(signal: PdfPageSignal): PdfPageComplexityV1 {
  const hasText = signal.text_char_count >= MIN_NATIVE_TEXT_CHARS && signal.text_coverage_ratio >= MIN_TEXT_COVERAGE;
  const hasTables = signal.table_region_count > 0;
  const imageDominant = signal.image_area_ratio >= IMAGE_DOMINANT_RATIO;
  const veryLowText = signal.text_coverage_ratio < LOW_TEXT_COVERAGE;

  if (signal.has_scanned_layer && !hasText) {
    return mkComplexity(signal.page_number, 'scanned', { ocr: true, tables: hasTables, raster: true, vlm: false }, ['scanned_layer_without_text']);
  }
  if (!hasText && imageDominant) {
    return mkComplexity(signal.page_number, 'design_heavy', { ocr: signal.has_scanned_layer, tables: hasTables, raster: true, vlm: false }, ['image_dominant_low_text']);
  }
  if (!hasText && veryLowText && !signal.has_scanned_layer && signal.vector_op_count === 0) {
    return mkComplexity(signal.page_number, 'unreadable', { ocr: false, tables: false, raster: true, vlm: false }, ['no_usable_signal']);
  }
  if (hasTables || signal.vector_op_count >= RICH_VECTOR_OPS || imageDominant) {
    const reasons: string[] = [];
    if (hasTables) reasons.push('native_with_tables');
    if (signal.vector_op_count >= RICH_VECTOR_OPS) reasons.push('native_heavy_vectors');
    if (imageDominant) reasons.push('native_with_dominant_image');
    return mkComplexity(signal.page_number, 'native_rich', { ocr: false, tables: hasTables, raster: imageDominant, vlm: false }, reasons);
  }
  return mkComplexity(signal.page_number, 'native_simple', { ocr: false, tables: hasTables, raster: false, vlm: false }, ['native_simple_text']);
}

export function classifyPages(preflight: PdfExtractionPreflightV1): PdfPageComplexityV1[] {
  return preflight.page_signals.map(classifyPage);
}

// ── Plan V3 ──────────────────────────────────────────────────────────────────

export interface PlanV3RequestOptions {
  requested_mode: string;
  allow_mode_override: boolean;
  max_chunk_pages: number;
  redact_pii: boolean;
  redaction_policy_version: string;
  description_tier: string;
  include_markdown: boolean;
  include_doctags: boolean;
  raster_format: string;
  raster_dpi: number;
  engine_version: string;
  artifact_contract_version: string;
  lane_policy_version: string;
  provider_policy_id: string;
  remote_approved?: boolean;
}

export interface PdfExtractionPlanV3 {
  version: typeof PDF_EXTRACTION_PLAN_V3_VERSION;
  plan_id: string;
  plan_hash: string;
  planner_impl_version: string;
  registry_id: string;
  routing_policy_id: string;
  provider_policy_id: string;
  source_sha256: string;
  requested_mode: string;
  allow_mode_override: boolean;
  effective_mode: string;
  page_count: number;
  page_classifications: PdfPageComplexityV1[];
  route_decisions: ServiceRouteDecisionV1[];
  chunk_plan: ChunkPlanEntryV3[];
  cache_fingerprint: string;
}

function effectiveMode(requestedMode: string, allowOverride: boolean, pages: PdfPageComplexityV1[]): string {
  if (!allowOverride || pages.length === 0) return requestedMode;
  const tiers = pages.map((p) => p.tier);
  if (tiers.length > 0 && tiers.every((t) => t === 'unreadable')) return 'pixel-perfect';
  if (tiers.some((t) => t === 'scanned' || t === 'design_heavy')) {
    if (requestedMode === 'semantic') return 'hybrid';
  }
  return requestedMode;
}

function buildChunkPlan(decisions: ServiceRouteDecisionV1[], maxChunkPages: number): ChunkPlanEntryV3[] {
  const chunks: ChunkPlanEntryV3[] = [];
  const ordered = [...decisions].sort((a, b) => {
    const am = a.page_numbers.length ? Math.min(...a.page_numbers) : 0;
    const bm = b.page_numbers.length ? Math.min(...b.page_numbers) : 0;
    return am - bm;
  });
  let chunkIndex = 0;
  for (const decision of ordered) {
    const pages = [...decision.page_numbers].sort((a, b) => a - b);
    let i = 0;
    while (i < pages.length) {
      const start = pages[i];
      let end = start;
      let count = 1;
      let j = i + 1;
      while (j < pages.length && pages[j] === end + 1 && count < maxChunkPages) {
        end = pages[j];
        count += 1;
        j += 1;
      }
      chunks.push({ chunk_index: chunkIndex, page_start: start, page_end: end, service_class: decision.resolved_class });
      chunkIndex += 1;
      i = j;
    }
  }
  return chunks;
}

/** Assemble the ONE immutable Plan V3 for this (source, request, config). */
export function buildPlanV3(
  preflight: PdfExtractionPreflightV1,
  registry: ServiceClassRegistryV1,
  routingPolicy: ServiceRoutingPolicyV1,
  options: PlanV3RequestOptions,
): PdfExtractionPlanV3 {
  const maxChunkPages = Math.max(CHUNK_SIZE_MIN, Math.min(CHUNK_SIZE_MAX, Math.trunc(options.max_chunk_pages)));
  const page_classifications = classifyPages(preflight);
  const route_decisions = routePages(page_classifications, routingPolicy, registry, options.remote_approved ?? false);
  const chunk_plan = buildChunkPlan(route_decisions, maxChunkPages);
  const effective_mode = effectiveMode(options.requested_mode, options.allow_mode_override, page_classifications);

  const fpInput: CacheFingerprintV3Input = {
    source_sha256: preflight.source_sha256,
    requested_mode: options.requested_mode,
    allow_mode_override: options.allow_mode_override,
    redact_pii: options.redact_pii,
    redaction_policy_version: options.redaction_policy_version,
    description_tier: options.description_tier,
    include_markdown: options.include_markdown,
    include_doctags: options.include_doctags,
    raster_format: options.raster_format,
    raster_dpi: options.raster_dpi,
    engine_version: options.engine_version,
    artifact_contract_version: options.artifact_contract_version,
    lane_policy_version: options.lane_policy_version,
    provider_policy_id: options.provider_policy_id,
    registry_id: registry.registry_id,
    routing_policy_id: routingPolicy.policy_id,
    classification_digest: classificationDigest(page_classifications),
    route_digest: routeDigest(route_decisions),
  };
  const cache_fingerprint = computeCacheFingerprint(fpInput);

  const core = {
    version: PDF_EXTRACTION_PLAN_V3_VERSION,
    planner_impl_version: PLANNER_V3_IMPLEMENTATION_VERSION,
    registry_id: registry.registry_id,
    routing_policy_id: routingPolicy.policy_id,
    provider_policy_id: options.provider_policy_id,
    source_sha256: preflight.source_sha256,
    requested_mode: options.requested_mode,
    allow_mode_override: options.allow_mode_override,
    effective_mode,
    page_count: preflight.page_count,
    page_classifications,
    route_decisions,
    chunk_plan,
    cache_fingerprint,
  };
  const plan_hash = fnv1a32(stableJson(core));
  const plan_id = `plan3-${plan_hash}`;

  return {
    version: PDF_EXTRACTION_PLAN_V3_VERSION,
    plan_id,
    plan_hash,
    planner_impl_version: PLANNER_V3_IMPLEMENTATION_VERSION,
    registry_id: registry.registry_id,
    routing_policy_id: routingPolicy.policy_id,
    provider_policy_id: options.provider_policy_id,
    source_sha256: preflight.source_sha256,
    requested_mode: options.requested_mode,
    allow_mode_override: options.allow_mode_override,
    effective_mode,
    page_count: preflight.page_count,
    page_classifications,
    route_decisions,
    chunk_plan,
    cache_fingerprint,
  };
}

// ── Routing audit (pdf-routing-audit-v1) ─────────────────────────────────────

/** Summarize a plan's routing into a deterministic, PII-safe audit record. */
export function buildRoutingAudit(plan: PdfExtractionPlanV3): Record<string, unknown> {
  const classPages: Record<string, number> = {};
  let admittedPages = 0;
  let degradedPages = 0;
  const reasonHist: Record<string, number> = {};
  for (const decision of plan.route_decisions) {
    const n = decision.page_numbers.length;
    classPages[decision.resolved_class] = (classPages[decision.resolved_class] ?? 0) + n;
    if (decision.admitted) admittedPages += n; else degradedPages += n;
    for (const code of decision.reason_codes) {
      if (ROUTING_SAFE_REASON_CODES.includes(code)) reasonHist[code] = (reasonHist[code] ?? 0) + 1;
    }
  }
  const pagesByClass: Record<string, number> = {};
  for (const cls of Object.keys(classPages).sort()) pagesByClass[cls] = classPages[cls];
  const reasonHistogram: Record<string, number> = {};
  for (const code of Object.keys(reasonHist).sort()) reasonHistogram[code] = reasonHist[code];

  const audit: Record<string, unknown> = {
    version: PDF_ROUTING_AUDIT_VERSION,
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    registry_id: plan.registry_id,
    routing_policy_id: plan.routing_policy_id,
    provider_policy_id: plan.provider_policy_id,
    page_count: plan.page_count,
    effective_mode: plan.effective_mode,
    pages_by_class: pagesByClass,
    admitted_pages: admittedPages,
    degraded_pages: degradedPages,
    chunk_count: plan.chunk_plan.length,
    reason_histogram: reasonHistogram,
  };
  audit.audit_id = stableHash('raud', audit);
  return audit;
}

// ── Persisted-shape validators ───────────────────────────────────────────────

const LEGACY_CACHE_CONTRACTS: ReadonlySet<string> = new Set([
  'parse-cache-safety-v1', 'pdf-cache-contract-v1', 'pdf-cache-contract-v2',
]);

function scanForbidden(value: unknown, depth = 0): string[] {
  if (depth > 8 || value == null) return [];
  if (typeof value === 'string') return isSignedUrl(value) ? ['signed_url_persisted'] : [];
  if (typeof value === 'boolean') return [];
  if (typeof value === 'number') return Number.isFinite(value) ? [] : ['non_finite_number'];
  if (value instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer)) return ['raw_payload_persisted'];
  if (Array.isArray(value)) return value.flatMap((v) => scanForbidden(v, depth + 1));
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => (
      k === 'durable_path' || k === 'durable_ref' || k === 'ref' || k === 'target_ref' ? [] : scanForbidden(v, depth + 1)
    ));
  }
  return [];
}

export function validatePlanV3Shape(value: unknown): string[] {
  const problems: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['plan_not_object'];
  const v = value as Record<string, unknown>;
  if (v.version !== PDF_EXTRACTION_PLAN_V3_VERSION) problems.push('plan_invalid_version');
  if (typeof v.plan_id !== 'string' || !v.plan_id) problems.push('plan_missing_id');
  if (typeof v.plan_hash !== 'string' || !v.plan_hash) problems.push('plan_missing_hash');
  problems.push(...scanForbidden(value));
  return Array.from(new Set(problems)).sort();
}

export function validateCacheEntryV3Shape(value: unknown): string[] {
  const problems: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['cache_entry_not_object'];
  const v = value as Record<string, unknown>;
  if (v.version !== 'pdf-cache-entry-v3') problems.push('cache_entry_invalid_version');
  const contract = v.contract_version;
  if (typeof contract === 'string' && LEGACY_CACHE_CONTRACTS.has(contract)) problems.push('cache_reuse_forbidden_legacy_contract');
  else if (contract !== 'pdf-cache-fingerprint-v3') problems.push('cache_entry_invalid_contract');
  if (typeof v.cache_fingerprint !== 'string' || !v.cache_fingerprint) problems.push('cache_entry_missing_fingerprint');
  problems.push(...scanForbidden(value));
  return Array.from(new Set(problems)).sort();
}

export { COMPLEXITY_TIERS };
