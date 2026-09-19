/**
 * PDF Extraction V3 · E10 — cache fingerprint V3 and cache entry V3.
 *
 * The V3 fingerprint folds in every plan-affecting input, including all the
 * fields the C1 `pdf-cache-contract-v2` fingerprint covered PLUS the Planner V3
 * additions (service-class registry id, routing policy id, provider policy id,
 * planner impl version, classification digest, route digest). Two hard rules:
 *
 *   1. NO V1/V2 REUSE. The payload is namespaced by `pdf-cache-fingerprint-v3`
 *      and the planner impl version; `isReusableContract` rejects any non-V3
 *      contract outright, so a V1/V2 row can never satisfy a V3 request.
 *   2. A V3 HIT MUST BE ARTIFACT-COMPLETE. `evaluateCacheHit` admits a candidate
 *      only when the fingerprints match, the contract is exactly V3, AND the
 *      entry is artifact-complete — an incomplete entry is a MISS, never a
 *      partial/false hit.
 *
 * Byte-identical with the Python `planner_v3.fingerprint` producer for ASCII.
 */
import {
  PDF_CACHE_ENTRY_V3_VERSION,
  PDF_CACHE_FINGERPRINT_V3_VERSION,
  PLANNER_V3_IMPLEMENTATION_VERSION,
  type PdfPageComplexityV1,
  type ServiceRouteDecisionV1,
  sha256Hex,
  stableHash,
  stableJson,
  stripUrls,
} from './pdfServiceRoutingV1.pure.ts';

export interface CacheFingerprintV3Input {
  source_sha256: string;
  requested_mode: string;
  allow_mode_override: boolean;
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
  registry_id: string;
  routing_policy_id: string;
  classification_digest: string;
  route_digest: string;
  planner_impl_version?: string;
}

/** The canonical fingerprint payload dict (matches Python `to_dict`). */
function fingerprintPayload(inp: CacheFingerprintV3Input): Record<string, unknown> {
  return {
    // 'contract' first so a V1/V2 payload can never collide with a V3 payload.
    contract: PDF_CACHE_FINGERPRINT_V3_VERSION,
    source_sha256: inp.source_sha256,
    requested_mode: inp.requested_mode,
    allow_mode_override: inp.allow_mode_override,
    redact_pii: inp.redact_pii,
    redaction_policy_version: inp.redaction_policy_version,
    description_tier: inp.description_tier,
    include_markdown: inp.include_markdown,
    include_doctags: inp.include_doctags,
    raster_format: inp.raster_format,
    raster_dpi: inp.raster_dpi,
    engine_version: inp.engine_version,
    artifact_contract_version: inp.artifact_contract_version,
    lane_policy_version: inp.lane_policy_version,
    provider_policy_id: inp.provider_policy_id,
    registry_id: inp.registry_id,
    routing_policy_id: inp.routing_policy_id,
    planner_impl_version: inp.planner_impl_version ?? PLANNER_V3_IMPLEMENTATION_VERSION,
    classification_digest: inp.classification_digest,
    route_digest: inp.route_digest,
  };
}

/** Order-independent digest of the page classifications (by page number). */
export function classificationDigest(pages: PdfPageComplexityV1[]): string {
  const rows = [...pages]
    .map((p) => ({
      version: p.version,
      page_number: p.page_number,
      tier: p.tier,
      requires_ocr: p.requires_ocr,
      requires_tables: p.requires_tables,
      requires_raster: p.requires_raster,
      requires_vlm: p.requires_vlm,
      reason_codes: p.reason_codes,
    }))
    .sort((a, b) => a.page_number - b.page_number);
  return stableHash('cls', rows);
}

/** Digest of the resolved routes (class + pages + admission), order-stable. */
export function routeDigest(decisions: ServiceRouteDecisionV1[]): string {
  const rows = decisions.map((r) => ({
    resolved_class: r.resolved_class,
    desired_class: r.desired_class,
    admitted: r.admitted,
    page_numbers: [...r.page_numbers].sort((a, b) => a - b),
  }));
  rows.sort((a, b) => {
    const am = a.page_numbers.length ? a.page_numbers[0] : 0;
    const bm = b.page_numbers.length ? b.page_numbers[0] : 0;
    if (am !== bm) return am - bm;
    return a.resolved_class < b.resolved_class ? -1 : a.resolved_class > b.resolved_class ? 1 : 0;
  });
  return stableHash('rt', rows);
}

/** The canonical collision-resistant V3 fingerprint: `pf3-<sha256(...)>`. */
export function computeCacheFingerprint(inp: CacheFingerprintV3Input): string {
  return `pf3-${sha256Hex(stripUrls(stableJson(fingerprintPayload(inp))))}`;
}

/** Only an exact `pdf-cache-fingerprint-v3` entry is ever reusable by V3. */
export function isReusableContract(contractVersion: unknown): boolean {
  return contractVersion === PDF_CACHE_FINGERPRINT_V3_VERSION;
}

/**
 * Decide whether a candidate cache entry is a true, safe hit.
 * Returns [isHit, reasonCode]. A hit requires exact fingerprint match + a V3
 * contract + artifact completeness; any failure is a MISS with a bounded reason.
 */
export function evaluateCacheHit(
  requestFingerprint: string,
  entryFingerprint: unknown,
  entryContractVersion: unknown,
  entryArtifactsComplete: boolean,
): [boolean, string] {
  if (!isReusableContract(entryContractVersion)) return [false, 'cache_reuse_forbidden_legacy_contract'];
  if (entryFingerprint !== requestFingerprint) return [false, 'cache_miss_no_fingerprint_match'];
  if (!entryArtifactsComplete) return [false, 'cache_miss_incomplete_artifacts'];
  return [true, 'cache_hit_artifact_complete'];
}

export interface PdfExtractionPlanIdentity {
  plan_id: string;
  plan_hash: string;
  cache_fingerprint: string;
}

/** Build a persisted cache-entry-v3 record (no signed URLs, no wall-clock). */
export function buildCacheEntryV3(plan: PdfExtractionPlanIdentity, artifactsComplete: boolean): Record<string, unknown> {
  return {
    version: PDF_CACHE_ENTRY_V3_VERSION,
    cache_fingerprint: plan.cache_fingerprint,
    contract_version: PDF_CACHE_FINGERPRINT_V3_VERSION,
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    artifacts_complete: Boolean(artifactsComplete),
  };
}
