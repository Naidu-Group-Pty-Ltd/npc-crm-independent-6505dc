/**
 * E10 — Planner V3 / service routing / cache-safety / recovery shared-contract specs.
 *
 * Verifies the versioned contracts, the deterministic immutable plan, the
 * fail-closed routing ladder, the V3 cache-safety rules (no V1/V2 reuse,
 * artifact-complete hits, redaction partitioning), artifact completeness with
 * signed-URL leak detection, deterministic recovery, and — critically —
 * CROSS-RUNTIME identity parity: the TS producers emit byte-identical hashes to
 * the Python `planner_v3` sidecar producer for ASCII inputs (the embedded
 * constants below are Python-produced).
 */
import { describe, it, expect } from 'vitest';
import {
  PDF_EXTRACTION_PLAN_V3_VERSION,
  PDF_SERVICE_CLASS_REGISTRY_VERSION,
  PDF_SERVICE_ROUTING_POLICY_VERSION,
  PDF_CACHE_FINGERPRINT_V3_VERSION,
  SERVICE_CLASSES,
  fnv1a32,
  sha256Hex,
  defaultServiceClassRegistry,
  defaultRoutingPolicy,
  routePages,
  resolveExecutionTarget,
  type PdfPageComplexityV1,
  type ServiceRoutingPolicyV1,
} from '../pdfImport/pdfServiceRoutingV1.pure';
import {
  buildPreflight,
  buildPlanV3,
  buildRoutingAudit,
  classifyPages,
  validatePlanV3Shape,
  validateCacheEntryV3Shape,
  type PlanV3RequestOptions,
} from '../pdfImport/pdfExtractionPlanV3.pure';
import {
  evaluateCacheHit,
  buildCacheEntryV3,
} from '../pdfImport/pdfCacheFingerprintV3.pure';
import {
  evaluateArtifactCompleteness,
  requiredArtifactsForPage,
} from '../pdfImport/pdfArtifactCompletenessV1.pure';
import { planRecovery } from '../pdfImport/pdfRecoveryPlanV1.pure';

// ── Fixtures (mirror the Python fixtures byte-for-byte) ──────────────────────

const MIXED_SOURCE = {
  source_sha256: 'a'.repeat(64),
  byte_size: 2_500_000,
  page_count: 6,
  has_selectable_text: true,
  selectable_text_ratio: 0.7,
  ocr_hint: true,
  image_heavy: false,
  design_heavy: true,
  table_likelihood: 'high',
  encrypted: false,
  page_signals: [
    { page_number: 1, text_char_count: 1800, text_coverage_ratio: 0.55, image_area_ratio: 0.02, vector_op_count: 4, has_scanned_layer: false, table_region_count: 0 },
    { page_number: 2, text_char_count: 900, text_coverage_ratio: 0.3, image_area_ratio: 0.05, vector_op_count: 40, has_scanned_layer: false, table_region_count: 3 },
    { page_number: 3, text_char_count: 0, text_coverage_ratio: 0.0, image_area_ratio: 0.95, vector_op_count: 0, has_scanned_layer: true, table_region_count: 0 },
    { page_number: 4, text_char_count: 10, text_coverage_ratio: 0.02, image_area_ratio: 0.9, vector_op_count: 200, has_scanned_layer: false, table_region_count: 0 },
    { page_number: 5, text_char_count: 1200, text_coverage_ratio: 0.4, image_area_ratio: 0.1, vector_op_count: 400, has_scanned_layer: false, table_region_count: 0 },
    { page_number: 6, text_char_count: 0, text_coverage_ratio: 0.0, image_area_ratio: 0.0, vector_op_count: 0, has_scanned_layer: false, table_region_count: 0 },
  ],
};

function defaultOptions(overrides: Partial<PlanV3RequestOptions> = {}): PlanV3RequestOptions {
  return {
    requested_mode: 'semantic',
    allow_mode_override: true,
    max_chunk_pages: 4,
    redact_pii: false,
    redaction_policy_version: 'redaction-policy-v1',
    description_tier: 'off',
    include_markdown: true,
    include_doctags: false,
    raster_format: 'png',
    raster_dpi: 200,
    engine_version: 'docling-2.14.0',
    artifact_contract_version: 'raster-manifest-v1',
    lane_policy_version: 'extractor-lane-policy-v1',
    provider_policy_id: 'default-local-only',
    remote_approved: false,
    ...overrides,
  };
}

function mixedPlan(overrides: Partial<PlanV3RequestOptions> = {}) {
  return buildPlanV3(buildPreflight(MIXED_SOURCE), defaultServiceClassRegistry(), defaultRoutingPolicy(), defaultOptions(overrides));
}

// ── Version constants + service-class separation ─────────────────────────────

describe('E10 contract versions + service classes', () => {
  it('version constants are exact', () => {
    expect(PDF_EXTRACTION_PLAN_V3_VERSION).toBe('pdf-extraction-plan-v3');
    expect(PDF_SERVICE_CLASS_REGISTRY_VERSION).toBe('pdf-service-class-registry-v1');
    expect(PDF_SERVICE_ROUTING_POLICY_VERSION).toBe('pdf-service-routing-policy-v1');
    expect(PDF_CACHE_FINGERPRINT_V3_VERSION).toBe('pdf-cache-fingerprint-v3');
  });
  it('logical service classes are separate from URLs', () => {
    expect(SERVICE_CLASSES).toEqual(['fast_cpu', 'heavy_cpu_au', 'docai_au', 'vlm_gpu_sg', 'raster_only']);
    for (const cap of defaultServiceClassRegistry().classes) {
      expect(cap.service_class).not.toContain('://');
      expect(cap.region).not.toContain('://');
    }
  });
});

// ── Cross-runtime parity anchors (Python-produced) ───────────────────────────

describe('cross-runtime identity parity (matches the Python planner_v3 producer)', () => {
  it('fnv1a32 matches the shared algorithm', () => {
    expect(fnv1a32('abc')).toBe('1a47e90b');
  });
  it('sha256 matches the standard UTF-8 test vector', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('registry + policy ids are byte-identical to Python', () => {
    expect(defaultServiceClassRegistry().registry_id).toBe('svcreg-52451c5f');
    expect(defaultRoutingPolicy().policy_id).toBe('svcpol-f3fd6a52');
  });
  it('plan id/hash + cache fingerprint + audit id are byte-identical to Python', () => {
    const plan = mixedPlan();
    expect(plan.plan_id).toBe('plan3-a8ce0afb');
    expect(plan.plan_hash).toBe('a8ce0afb');
    expect(plan.cache_fingerprint).toBe('pf3-aab8d89ced1d9f08a7250086264be2968872c18c6fdf76c0dbee39ab28aa067b');
    expect(plan.cache_fingerprint).toMatch(/^pf3-[0-9a-f]{64}$/);
    expect(buildRoutingAudit(plan).audit_id).toBe('raud-ee8cfe89');
  });
});

// ── Determinism / retry / reroute ────────────────────────────────────────────

describe('immutable plan: determinism, retry invariance, reroute-new-plan', () => {
  it('same inputs produce the same plan identity', () => {
    const a = mixedPlan();
    const b = mixedPlan();
    expect(b.plan_id).toBe(a.plan_id);
    expect(b.plan_hash).toBe(a.plan_hash);
    expect(b.cache_fingerprint).toBe(a.cache_fingerprint);
    expect(b.route_decisions.map((r) => r.resolved_class)).toEqual(a.route_decisions.map((r) => r.resolved_class));
  });
  it('does not reuse the known FNV-colliding source identities', () => {
    const planFor = (source_sha256: string) => buildPlanV3(
      buildPreflight({ ...MIXED_SOURCE, source_sha256 }),
      defaultServiceClassRegistry(),
      defaultRoutingPolicy(),
      defaultOptions(),
    );
    const entry = planFor('147255048da408b63dc6fc8234108ea5021990625213c27e56d70bff706c1ec3');
    const request = planFor('9caaeb566c2b80604cc159af7cb1ef56db95eff5926c7d6a430b404a3779fe52');
    expect(entry.cache_fingerprint).not.toBe(request.cache_fingerprint);
  });
  it('any planner-input change yields a NEW plan id (reroute != mutation)', () => {
    const base = mixedPlan();
    expect(mixedPlan({ redact_pii: true }).plan_id).not.toBe(base.plan_id);
    expect(mixedPlan({ raster_dpi: 300 }).plan_id).not.toBe(base.plan_id);
    expect(mixedPlan({ requested_mode: 'hybrid' }).plan_id).not.toBe(base.plan_id);
  });
  it('classifies + chunks the mixed doc deterministically', () => {
    const plan = mixedPlan();
    const byPage = Object.fromEntries(plan.page_classifications.map((p) => [p.page_number, p.tier]));
    expect(byPage[1]).toBe('native_simple');
    expect(byPage[2]).toBe('native_rich');
    expect(byPage[3]).toBe('scanned');
    expect(byPage[4]).toBe('design_heavy');
    expect(byPage[5]).toBe('native_rich');
    expect(byPage[6]).toBe('unreadable');
    expect(plan.chunk_plan.every((c) => c.page_end - c.page_start + 1 <= 4)).toBe(true);
    expect(plan.chunk_plan.some((c) => c.service_class === 'raster_only')).toBe(true);
  });
});

// ── Fail-closed routing ──────────────────────────────────────────────────────

const vlmPage: PdfPageComplexityV1 = {
  version: 'pdf-page-complexity-v1',
  page_number: 1,
  tier: 'design_heavy',
  requires_ocr: false,
  requires_tables: false,
  requires_raster: true,
  requires_vlm: true,
  reason_codes: ['vlm'],
};

describe('fail-closed routing', () => {
  const reg = defaultServiceClassRegistry();
  it('default policy never admits a remote/GPU class', () => {
    const dec = routePages([vlmPage], defaultRoutingPolicy(), reg, true);
    expect(dec[0].resolved_class).not.toBe('vlm_gpu_sg');
    expect(dec[0].resolved_class).not.toBe('docai_au');
    expect(dec[0].admitted).toBe(false);
    expect(dec[0].reason_codes).toContain('route_blocked_class_disabled');
  });
  it('each remote risk is gated independently', () => {
    const enabled = SERVICE_CLASSES as unknown as ServiceRoutingPolicyV1['enabled_classes'];
    const noApprove: ServiceRoutingPolicyV1 = { version: 'pdf-service-routing-policy-v1', policy_id: 'p1', enabled_classes: enabled, remote_classes_enabled: true, gpu_classes_enabled: true, approved_regions: ['asia-southeast1'], require_explicit_remote_approval: true, max_remote_pages_per_job: 100, max_gpu_pages_per_job: 100 };
    expect(routePages([vlmPage], noApprove, reg, false)[0].reason_codes).toContain('route_blocked_remote_not_approved');
    const noRegion: ServiceRoutingPolicyV1 = { ...noApprove, policy_id: 'p2', approved_regions: ['local'] };
    expect(routePages([vlmPage], noRegion, reg, true)[0].reason_codes).toContain('route_blocked_residency_not_approved');
    const noGpu: ServiceRoutingPolicyV1 = { ...noApprove, policy_id: 'p3', gpu_classes_enabled: false, max_gpu_pages_per_job: 0 };
    expect(routePages([vlmPage], noGpu, reg, true)[0].reason_codes).toContain('route_blocked_gpu_not_approved');
  });
  it('execution target is a logical ref, never a URL', () => {
    const t = resolveExecutionTarget('fast_cpu', reg, { fast_cpu: 'PDF_FAST_CPU_TARGET' });
    expect(t.target_ref).toBe('PDF_FAST_CPU_TARGET');
    expect(t.target_ref).not.toContain('://');
    expect(t.available).toBe(true);
    expect(resolveExecutionTarget('vlm_gpu_sg', reg, {}).available).toBe(false);
  });
});

// ── Cache safety ─────────────────────────────────────────────────────────────

describe('V3 cache safety', () => {
  it('a hit requires a V3 contract, exact fingerprint AND artifact completeness', () => {
    const fp = mixedPlan().cache_fingerprint;
    expect(evaluateCacheHit(fp, fp, 'pdf-cache-contract-v2', true)).toEqual([false, 'cache_reuse_forbidden_legacy_contract']);
    expect(evaluateCacheHit(fp, fp, 'pdf-cache-fingerprint-v3', false)).toEqual([false, 'cache_miss_incomplete_artifacts']);
    expect(evaluateCacheHit(fp, 'pf3-00000000', 'pdf-cache-fingerprint-v3', true)).toEqual([false, 'cache_miss_no_fingerprint_match']);
    expect(evaluateCacheHit(fp, fp, 'pdf-cache-fingerprint-v3', true)).toEqual([true, 'cache_hit_artifact_complete']);
  });
  it('redaction partitions the fingerprint', () => {
    expect(mixedPlan({ redact_pii: false }).cache_fingerprint).not.toBe(mixedPlan({ redact_pii: true }).cache_fingerprint);
  });
  it('validators reject legacy contracts and signed-URL leaks', () => {
    const entry = buildCacheEntryV3(mixedPlan(), true);
    expect(validateCacheEntryV3Shape(entry)).toEqual([]);
    expect(validateCacheEntryV3Shape({ ...entry, contract_version: 'pdf-cache-contract-v2' })).toContain('cache_reuse_forbidden_legacy_contract');
    expect(validateCacheEntryV3Shape({ ...entry, leaked: 'https://signed/x' })).toContain('signed_url_persisted');
    const planDict = JSON.parse(JSON.stringify(mixedPlan()));
    expect(validatePlanV3Shape(planDict)).toEqual([]);
    expect(validatePlanV3Shape({ ...planDict, leak: 'https://signed/y' })).toContain('signed_url_persisted');
  });
});

// ── Artifact completeness ────────────────────────────────────────────────────

describe('artifact completeness', () => {
  it('missing artifacts + signed-URL leaks fail the gate', () => {
    const plan = mixedPlan();
    const empty = evaluateArtifactCompleteness(plan.page_classifications, plan.route_decisions, {});
    expect(empty.complete).toBe(false);
    expect(empty.missing.length).toBe(plan.page_count);
    const leak = evaluateArtifactCompleteness(plan.page_classifications, plan.route_decisions, { 1: { raster: 'https://signed/x.png' } });
    expect(leak.signed_url_leak_pages).toContain(1);
    expect(leak.complete).toBe(false);
  });
  it('a raster-only page needs only a raster', () => {
    const unreadable: PdfPageComplexityV1 = { version: 'pdf-page-complexity-v1', page_number: 1, tier: 'unreadable', requires_ocr: false, requires_tables: false, requires_raster: true, requires_vlm: false, reason_codes: ['no_usable_signal'] };
    expect(requiredArtifactsForPage(unreadable, 'raster_only')).toEqual(['raster']);
  });
});

// ── Deterministic recovery ───────────────────────────────────────────────────

describe('deterministic recovery', () => {
  it('transient -> retry; deterministic -> reroute; floor -> raster fallback / abort', () => {
    expect(planRecovery('heavy_cpu_au', [], 'provider_timeout', true).action).toBe('retry_same_route');
    const r2 = planRecovery('heavy_cpu_au', [], 'provider_invalid_response', true);
    expect(r2.action).toBe('reroute');
    expect(r2.reason_codes).toContain('recovery_reroute_new_plan');
    expect(planRecovery('fast_cpu', [], 'provider_invalid_response', true).action).toBe('fallback_raster_only');
    const r4 = planRecovery('raster_only', [], 'provider_invalid_response', false);
    expect(r4.action).toBe('abort_manual_review');
    expect(r4.reason_codes).toContain('recovery_abort_no_source_raster');
  });
  it('same-route budget exhausted -> reroute', () => {
    const attempts = [0, 1].map((i) => ({ version: 'pdf-execution-attempt-v1' as const, plan_id: 'plan3-x', route_class: 'heavy_cpu_au' as const, attempt_index: i, outcome: 'failed' as const, safe_error_code: 'provider_timeout' }));
    expect(planRecovery('heavy_cpu_au', attempts, 'provider_timeout', true).action).toBe('reroute');
  });
  it('recovery is deterministic', () => {
    const a = planRecovery('fast_cpu', [], 'provider_invalid_response', true);
    const b = planRecovery('fast_cpu', [], 'provider_invalid_response', true);
    expect(a.recovery_id).toBe(b.recovery_id);
  });
});
