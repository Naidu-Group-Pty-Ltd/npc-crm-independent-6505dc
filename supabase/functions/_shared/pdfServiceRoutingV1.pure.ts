/**
 * PDF Extraction V3 · E10 — service routing + shared Planner-V3 contract vocabulary.
 *
 * This is the FOUNDATION module of the E10 shared contract set. To avoid drift,
 * it carries the deterministic identity primitives (FNV-1a-32 over sorted-key
 * compact JSON — byte-identical with the Python `planner_v3` producer and the
 * E1/E9 producers for ASCII inputs), the thirteen version constants, the logical
 * service-class vocabulary, all core contract types, and the fail-closed routing
 * layer. The plan builder, cache fingerprint, artifact-completeness and recovery
 * modules import from here.
 *
 * A logical service CLASS (`fast_cpu` / `heavy_cpu_au` / `docai_au` /
 * `vlm_gpu_sg` / `raster_only`) is a capability contract, NEVER a host. Routing
 * names a class; the runtime binds the physical target separately, so the same
 * immutable plan can run against different concrete URLs without changing its
 * identity. Remote/GPU classes are fail-closed: never routable unless the policy
 * independently approves the remote flag, the residency region, the GPU risk and
 * the per-job budget.
 *
 * Pure and runtime-agnostic (zero imports) — importable by the Deno dispatcher,
 * the frontend and vitest alike.
 */

// ── Version constants (13 contracts + planner impl) ──────────────────────────

export const PDF_EXTRACTION_PREFLIGHT_VERSION = 'pdf-extraction-preflight-v1' as const;
export const PDF_PAGE_COMPLEXITY_VERSION = 'pdf-page-complexity-v1' as const;
export const PDF_EXTRACTION_PLAN_V3_VERSION = 'pdf-extraction-plan-v3' as const;
export const PDF_SERVICE_CLASS_REGISTRY_VERSION = 'pdf-service-class-registry-v1' as const;
export const PDF_SERVICE_ROUTING_POLICY_VERSION = 'pdf-service-routing-policy-v1' as const;
export const PDF_SERVICE_ROUTE_DECISION_VERSION = 'pdf-service-route-decision-v1' as const;
export const PDF_EXECUTION_TARGET_VERSION = 'pdf-execution-target-v1' as const;
export const PDF_EXECUTION_ATTEMPT_VERSION = 'pdf-execution-attempt-v1' as const;
export const PDF_CACHE_FINGERPRINT_V3_VERSION = 'pdf-cache-fingerprint-v3' as const;
export const PDF_CACHE_ENTRY_V3_VERSION = 'pdf-cache-entry-v3' as const;
export const PDF_ARTIFACT_COMPLETENESS_VERSION = 'pdf-artifact-completeness-v1' as const;
export const PDF_RECOVERY_PLAN_VERSION = 'pdf-recovery-plan-v1' as const;
export const PDF_ROUTING_AUDIT_VERSION = 'pdf-routing-audit-v1' as const;

/** The planner's own implementation version — bump on any input->plan mapping change. */
export const PLANNER_V3_IMPLEMENTATION_VERSION = 'planner-v3-impl-1' as const;

// ── Logical service classes (SEPARATE from physical URLs) ────────────────────

export type ServiceClass = 'fast_cpu' | 'heavy_cpu_au' | 'docai_au' | 'vlm_gpu_sg' | 'raster_only';

export const SERVICE_CLASS_FAST_CPU: ServiceClass = 'fast_cpu';
export const SERVICE_CLASS_HEAVY_CPU_AU: ServiceClass = 'heavy_cpu_au';
export const SERVICE_CLASS_DOCAI_AU: ServiceClass = 'docai_au';
export const SERVICE_CLASS_VLM_GPU_SG: ServiceClass = 'vlm_gpu_sg';
export const SERVICE_CLASS_RASTER_ONLY: ServiceClass = 'raster_only';

export const SERVICE_CLASSES: readonly ServiceClass[] = [
  'fast_cpu', 'heavy_cpu_au', 'docai_au', 'vlm_gpu_sg', 'raster_only',
];

export const REMOTE_SERVICE_CLASSES: ReadonlySet<ServiceClass> = new Set(['docai_au', 'vlm_gpu_sg']);
export const GPU_SERVICE_CLASSES: ReadonlySet<ServiceClass> = new Set(['vlm_gpu_sg']);
export const SERVICE_CLASS_REGION: Record<ServiceClass, string> = {
  fast_cpu: 'local',
  heavy_cpu_au: 'australia-southeast1',
  docai_au: 'australia-southeast1',
  vlm_gpu_sg: 'asia-southeast1',
  raster_only: 'local',
};

export const ROUTING_SAFE_REASON_CODES: readonly string[] = [
  'route_class_local_default', 'route_class_heavy_tables', 'route_class_ocr_scanned',
  'route_class_design_heavy', 'route_class_raster_only', 'route_class_docai_requested',
  'route_class_vlm_requested', 'route_blocked_class_disabled', 'route_blocked_remote_not_approved',
  'route_blocked_residency_not_approved', 'route_blocked_gpu_not_approved', 'route_blocked_budget_exhausted',
  'route_fallback_raster_only', 'route_target_unavailable', 'cache_hit_artifact_complete',
  'cache_miss_no_fingerprint_match', 'cache_miss_contract_version_mismatch', 'cache_miss_incomplete_artifacts',
  'cache_reuse_forbidden_legacy_contract', 'recovery_retry_same_route', 'recovery_reroute_new_plan',
  'recovery_fallback_raster_only', 'recovery_exhausted_manual_review', 'recovery_abort_no_source_raster',
];

// ── Deterministic identity (FNV-1a-32 over sorted-key JSON; Python parity) ────

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1a32(text: string): string {
  let h = FNV_OFFSET;
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i += 1) {
    h ^= bytes[i];
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Lowercase SHA-256 of UTF-8 text, implemented synchronously for pure planners. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  const rotr = (value: number, count: number) => (value >>> count) | (value << (32 - count));

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      [a, b, c, d, e, f, g, hh] = [(t1 + t2) >>> 0, a, b, c, (d + t1) >>> 0, e, f, g];
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((value) => value.toString(16).padStart(8, '0')).join('');
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sortValue((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/** Sorted-key compact JSON (matches Python `stable_json` for ASCII inputs). */
export function stableJson(value: unknown): string { return JSON.stringify(sortValue(value)); }

export function stripUrls(s: string): string { return s.replace(/(https?|blob|data):\/\/[^"'\s]+/gi, 'URL'); }

/** `<prefix>-<fnv1a32(stripUrls(stableJson(value)))>` — the canonical id form. */
export function stableHash(prefix: string, value: unknown): string {
  return `${prefix}-${fnv1a32(stripUrls(stableJson(value)))}`;
}

const SIGNED_URL_RE = /^(https?|blob|data):/i;
export function isSignedUrl(v: unknown): boolean { return typeof v === 'string' && SIGNED_URL_RE.test(v); }

/** A durable object reference: non-empty, no scheme, no traversal, not absolute. */
export function isDurableRef(v: unknown): boolean {
  return (
    typeof v === 'string' && v.length > 0 && !isSignedUrl(v) && !v.startsWith('/') && !v.split('/').includes('..')
  );
}

// ── Core contract types ──────────────────────────────────────────────────────

export interface PdfPageSignal {
  page_number: number;
  text_char_count: number;
  text_coverage_ratio: number;
  image_area_ratio: number;
  vector_op_count: number;
  has_scanned_layer: boolean;
  table_region_count: number;
}

export interface PdfExtractionPreflightV1 {
  version: typeof PDF_EXTRACTION_PREFLIGHT_VERSION;
  source_sha256: string;
  byte_size: number;
  page_count: number;
  file_type: 'pdf';
  has_selectable_text: boolean;
  selectable_text_ratio: number;
  scanned_page_ratio: number;
  ocr_hint: boolean;
  image_heavy: boolean;
  design_heavy: boolean;
  table_likelihood: string;
  encrypted: boolean;
  page_signals: PdfPageSignal[];
}

export type ComplexityTier = 'native_simple' | 'native_rich' | 'scanned' | 'design_heavy' | 'unreadable';
export const COMPLEXITY_TIERS: readonly ComplexityTier[] = [
  'native_simple', 'native_rich', 'scanned', 'design_heavy', 'unreadable',
];

export interface PdfPageComplexityV1 {
  version: typeof PDF_PAGE_COMPLEXITY_VERSION;
  page_number: number;
  tier: ComplexityTier;
  requires_ocr: boolean;
  requires_tables: boolean;
  requires_raster: boolean;
  requires_vlm: boolean;
  reason_codes: string[];
}

export interface ServiceClassCapabilityV1 {
  service_class: ServiceClass;
  region: string;
  remote: boolean;
  gpu: boolean;
  supports_native: boolean;
  supports_ocr: boolean;
  supports_tables: boolean;
  supports_vlm: boolean;
  supports_raster: boolean;
}

export interface ServiceClassRegistryV1 {
  version: typeof PDF_SERVICE_CLASS_REGISTRY_VERSION;
  registry_id: string;
  classes: ServiceClassCapabilityV1[];
}

export interface ServiceRoutingPolicyV1 {
  version: typeof PDF_SERVICE_ROUTING_POLICY_VERSION;
  policy_id: string;
  enabled_classes: ServiceClass[];
  remote_classes_enabled: boolean;
  gpu_classes_enabled: boolean;
  approved_regions: string[];
  require_explicit_remote_approval: boolean;
  max_remote_pages_per_job: number;
  max_gpu_pages_per_job: number;
}

export interface ServiceRouteDecisionV1 {
  version: typeof PDF_SERVICE_ROUTE_DECISION_VERSION;
  desired_class: ServiceClass;
  resolved_class: ServiceClass;
  admitted: boolean;
  reason_codes: string[];
  page_numbers: number[];
}

export interface ExecutionTargetV1 {
  version: typeof PDF_EXECUTION_TARGET_VERSION;
  service_class: ServiceClass;
  target_ref: string;
  region: string;
  available: boolean;
}

export interface ExecutionAttemptV1 {
  version: typeof PDF_EXECUTION_ATTEMPT_VERSION;
  plan_id: string;
  route_class: ServiceClass;
  attempt_index: number;
  outcome: 'started' | 'succeeded' | 'failed' | 'timed_out' | 'aborted';
  safe_error_code: string | null;
}

export interface ChunkPlanEntryV3 {
  chunk_index: number;
  page_start: number;
  page_end: number;
  service_class: ServiceClass;
}

// ── Default service-class registry ───────────────────────────────────────────

/** The canonical capability description of the five logical service classes. */
export function defaultServiceClassRegistry(): ServiceClassRegistryV1 {
  const classes: ServiceClassCapabilityV1[] = [
    { service_class: 'fast_cpu', region: SERVICE_CLASS_REGION.fast_cpu, remote: false, gpu: false,
      supports_native: true, supports_ocr: false, supports_tables: true, supports_vlm: false, supports_raster: true },
    { service_class: 'heavy_cpu_au', region: SERVICE_CLASS_REGION.heavy_cpu_au, remote: false, gpu: false,
      supports_native: true, supports_ocr: true, supports_tables: true, supports_vlm: false, supports_raster: true },
    { service_class: 'docai_au', region: SERVICE_CLASS_REGION.docai_au, remote: true, gpu: false,
      supports_native: true, supports_ocr: true, supports_tables: true, supports_vlm: false, supports_raster: false },
    { service_class: 'vlm_gpu_sg', region: SERVICE_CLASS_REGION.vlm_gpu_sg, remote: true, gpu: true,
      supports_native: true, supports_ocr: true, supports_tables: true, supports_vlm: true, supports_raster: true },
    { service_class: 'raster_only', region: SERVICE_CLASS_REGION.raster_only, remote: false, gpu: false,
      supports_native: false, supports_ocr: false, supports_tables: false, supports_vlm: false, supports_raster: true },
  ];
  const registry_id = stableHash('svcreg', { version: PDF_SERVICE_CLASS_REGISTRY_VERSION, classes });
  return { version: PDF_SERVICE_CLASS_REGISTRY_VERSION, registry_id, classes };
}

export function getServiceClassCapability(registry: ServiceClassRegistryV1, serviceClass: ServiceClass): ServiceClassCapabilityV1 | null {
  for (const c of registry.classes) if (c.service_class === serviceClass) return c;
  return null;
}

// ── Default fail-closed routing policy ───────────────────────────────────────

export function defaultRoutingPolicy(): ServiceRoutingPolicyV1 {
  const enabled: ServiceClass[] = ['fast_cpu', 'heavy_cpu_au', 'raster_only'];
  const policy_id = stableHash('svcpol', {
    version: PDF_SERVICE_ROUTING_POLICY_VERSION,
    enabled_classes: enabled,
    remote_classes_enabled: false,
    gpu_classes_enabled: false,
    approved_regions: ['local', 'australia-southeast1'],
    require_explicit_remote_approval: true,
    max_remote_pages_per_job: 0,
    max_gpu_pages_per_job: 0,
  });
  return {
    version: PDF_SERVICE_ROUTING_POLICY_VERSION,
    policy_id,
    enabled_classes: enabled,
    remote_classes_enabled: false,
    gpu_classes_enabled: false,
    approved_regions: ['local', 'australia-southeast1'],
    require_explicit_remote_approval: true,
    max_remote_pages_per_job: 0,
    max_gpu_pages_per_job: 0,
  };
}

// ── Desired class from complexity (pre-policy) ───────────────────────────────

const TIER_DESIRED_CLASS: Record<ComplexityTier, ServiceClass> = {
  native_simple: 'fast_cpu',
  native_rich: 'heavy_cpu_au',
  scanned: 'heavy_cpu_au',
  design_heavy: 'heavy_cpu_au',
  unreadable: 'raster_only',
};

const DESIRED_REASON: Record<ServiceClass, string> = {
  fast_cpu: 'route_class_local_default',
  heavy_cpu_au: 'route_class_heavy_tables',
  docai_au: 'route_class_docai_requested',
  vlm_gpu_sg: 'route_class_vlm_requested',
  raster_only: 'route_class_raster_only',
};

export function desiredClassForPage(page: PdfPageComplexityV1): ServiceClass {
  if (page.requires_vlm) return 'vlm_gpu_sg';
  return TIER_DESIRED_CLASS[page.tier] ?? 'heavy_cpu_au';
}

// ── Fail-closed admission ────────────────────────────────────────────────────

function degrade(
  desired: ServiceClass,
  policy: ServiceRoutingPolicyV1,
  registry: ServiceClassRegistryV1,
  reasons: string[],
): { resolved: ServiceClass; admitted: boolean; reasons: string[] } {
  const ladder: ServiceClass[] = ['heavy_cpu_au', 'fast_cpu', 'raster_only'];
  for (const candidate of ladder) {
    const cap = getServiceClassCapability(registry, candidate);
    if (cap === null || candidate === desired) continue;
    if (!policy.enabled_classes.includes(candidate)) continue;
    if (cap.remote || cap.gpu) continue;
    if (candidate === 'raster_only') reasons.push('route_fallback_raster_only');
    return { resolved: candidate, admitted: false, reasons };
  }
  reasons.push('route_fallback_raster_only');
  return { resolved: 'raster_only', admitted: false, reasons };
}

function admitClass(
  desired: ServiceClass,
  policy: ServiceRoutingPolicyV1,
  registry: ServiceClassRegistryV1,
  pageCount: number,
  remoteApproved: boolean,
): { resolved: ServiceClass; admitted: boolean; reasons: string[] } {
  const reasons: string[] = [DESIRED_REASON[desired] ?? 'route_class_local_default'];
  const cap = getServiceClassCapability(registry, desired);

  if (cap === null || !policy.enabled_classes.includes(desired)) {
    reasons.push('route_blocked_class_disabled');
    return degrade(desired, policy, registry, reasons);
  }
  if (cap.remote) {
    if (!policy.remote_classes_enabled) { reasons.push('route_blocked_remote_not_approved'); return degrade(desired, policy, registry, reasons); }
    if (policy.require_explicit_remote_approval && !remoteApproved) { reasons.push('route_blocked_remote_not_approved'); return degrade(desired, policy, registry, reasons); }
    if (!policy.approved_regions.includes(cap.region)) { reasons.push('route_blocked_residency_not_approved'); return degrade(desired, policy, registry, reasons); }
    if (policy.max_remote_pages_per_job <= 0 || pageCount > policy.max_remote_pages_per_job) { reasons.push('route_blocked_budget_exhausted'); return degrade(desired, policy, registry, reasons); }
  }
  if (cap.gpu) {
    if (!policy.gpu_classes_enabled) { reasons.push('route_blocked_gpu_not_approved'); return degrade(desired, policy, registry, reasons); }
    if (policy.max_gpu_pages_per_job <= 0 || pageCount > policy.max_gpu_pages_per_job) { reasons.push('route_blocked_budget_exhausted'); return degrade(desired, policy, registry, reasons); }
  }
  return { resolved: desired, admitted: true, reasons };
}

/** Produce grouped route decisions over contiguous same-resolved-class runs. */
export function routePages(
  pages: PdfPageComplexityV1[],
  policy: ServiceRoutingPolicyV1,
  registry: ServiceClassRegistryV1,
  remoteApproved = false,
): ServiceRouteDecisionV1[] {
  const ordered = [...pages].sort((a, b) => a.page_number - b.page_number);
  const pageCount = ordered.length;
  const decisions: ServiceRouteDecisionV1[] = [];
  for (const page of ordered) {
    const desired = desiredClassForPage(page);
    const { resolved, admitted, reasons } = admitClass(desired, policy, registry, pageCount, remoteApproved);
    const last = decisions[decisions.length - 1];
    if (
      last &&
      last.resolved_class === resolved &&
      last.desired_class === desired &&
      last.admitted === admitted &&
      stableJson(last.reason_codes) === stableJson(reasons)
    ) {
      last.page_numbers.push(page.page_number);
    } else {
      decisions.push({
        version: PDF_SERVICE_ROUTE_DECISION_VERSION,
        desired_class: desired,
        resolved_class: resolved,
        admitted,
        reason_codes: reasons,
        page_numbers: [page.page_number],
      });
    }
  }
  return decisions;
}

/** Bind a logical class to a physical target REFERENCE (never a URL here). */
export function resolveExecutionTarget(
  serviceClass: ServiceClass,
  registry: ServiceClassRegistryV1,
  availableTargetRefs: Record<string, string>,
): ExecutionTargetV1 {
  const cap = getServiceClassCapability(registry, serviceClass);
  const region = cap ? cap.region : (SERVICE_CLASS_REGION[serviceClass] ?? 'local');
  const target_ref = availableTargetRefs[serviceClass] ?? '';
  return {
    version: PDF_EXECUTION_TARGET_VERSION,
    service_class: serviceClass,
    target_ref,
    region,
    available: Boolean(target_ref),
  };
}
