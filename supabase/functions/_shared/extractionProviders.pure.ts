/**
 * PDF Extraction V3 · E9 — governed extraction provider ensemble (shared contracts).
 *
 * The canonical TS/Deno mirror of the sidecar `providers` package so the Edge
 * Functions + frontend consume the same versioned contracts, the same fail-closed
 * default policy, the same safe-error vocabulary, and the same DETERMINISTIC
 * request/configuration identities (byte-identical with the Python producer for
 * ASCII inputs, via a shared FNV-1a-32 over sorted-key JSON).
 *
 * Provider results are CANDIDATE EVIDENCE ONLY — never source truth, never final
 * output, never an accepted repair. SOURCE FIDELITY OUTRANKS PROVIDER CONFIDENCE.
 * No signed URL, credential or raw payload ever enters a persisted contract.
 */

// ── Version constants ────────────────────────────────────────────────────────

export const EXTRACTION_PROVIDER_ADAPTER_VERSION = 'extraction-provider-adapter-v1';
export const EXTRACTION_PROVIDER_REQUEST_VERSION = 'extraction-provider-request-v1';
export const EXTRACTION_PROVIDER_ATTEMPT_VERSION = 'extraction-provider-attempt-v1';
export const EXTRACTION_PROVIDER_RESULT_VERSION = 'extraction-provider-result-v1';
export const PROVIDER_CAPABILITY_MANIFEST_VERSION = 'provider-capability-manifest-v1';
export const EXTRACTION_PROVIDER_POLICY_VERSION = 'extraction-provider-policy-v1';
export const PROVIDER_EVIDENCE_BUNDLE_VERSION = 'provider-evidence-bundle-v1';
export const PROVIDER_NORMALIZATION_VERSION = 'provider-normalization-v1';
export const PROVIDER_ARBITRATION_VERSION = 'provider-arbitration-v1';
export const PROVIDER_ATTEMPT_AUDIT_VERSION = 'provider-attempt-audit-v1';
export const PROVIDER_REGISTRY_VERSION = 'provider-registry-v1';

export type ProviderId =
  | 'pymupdf-exact' | 'docling-standard-vnext' | 'docling-vlm'
  | 'google-document-ai-layout' | 'google-document-ai-ocr' | 'docling-legacy';

export const PROVIDER_IDS: readonly ProviderId[] = [
  'pymupdf-exact', 'docling-standard-vnext', 'docling-vlm',
  'google-document-ai-layout', 'google-document-ai-ocr', 'docling-legacy',
];
export const LOCAL_PROVIDER_IDS: ReadonlySet<ProviderId> = new Set(['pymupdf-exact', 'docling-standard-vnext', 'docling-vlm', 'docling-legacy']);
export const REMOTE_PROVIDER_IDS: ReadonlySet<ProviderId> = new Set(['google-document-ai-layout', 'google-document-ai-ocr']);
export const VLM_PROVIDER_IDS: ReadonlySet<ProviderId> = new Set(['docling-vlm']);

export const PROVIDER_SAFE_ERROR_CODES: readonly string[] = [
  'provider_unknown', 'provider_disabled', 'provider_policy_blocked', 'provider_dependency_missing',
  'provider_configuration_missing', 'provider_model_missing', 'provider_model_unproven',
  'provider_request_invalid', 'provider_scope_invalid', 'provider_page_limit_exceeded',
  'provider_region_limit_exceeded', 'provider_byte_limit_exceeded', 'provider_cost_limit_exceeded',
  'provider_timeout', 'provider_cancelled', 'provider_authentication_failed', 'provider_permission_denied',
  'provider_rate_limited', 'provider_quota_exceeded', 'provider_invalid_response', 'provider_partial_response',
  'provider_page_loss', 'provider_region_loss', 'provider_normalization_failed', 'provider_result_hash_failed',
  'provider_residency_not_approved', 'provider_remote_not_approved', 'provider_vlm_disabled',
  'provider_retry_exhausted', 'provider_conflict_unresolved', 'provider_evidence_incomplete',
];

// ── Deterministic identity (FNV-1a-32 over sorted-key JSON; parity with Python) ─

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
function stripUrls(s: string): string { return s.replace(/(https?|blob|data):\/\/[^"'\s]+/gi, 'URL'); }

const SIGNED_URL_RE = /^(https?|blob|data):/i;
export function isSignedUrl(v: unknown): boolean { return typeof v === 'string' && SIGNED_URL_RE.test(v); }

export function providerConfigurationIdentity(input: {
  providerId: ProviderId; adapterVersion: string; enginePackageVersion: string | null;
  modelPreset: string | null; processorType: string | null; processorVersion: string | null;
  trustedLocation: string | null; ocrOptions: Record<string, unknown>; tableOptions: Record<string, unknown>;
  chartOptions: Record<string, unknown>; vlmPreset: string | null; privacyPolicyVersion: string | null;
}): string {
  const payload = {
    providerId: input.providerId, adapterVersion: input.adapterVersion, enginePackageVersion: input.enginePackageVersion,
    modelPreset: input.modelPreset, processorType: input.processorType, processorVersion: input.processorVersion,
    trustedLocation: input.trustedLocation, ocrOptions: input.ocrOptions, tableOptions: input.tableOptions,
    chartOptions: input.chartOptions, vlmPreset: input.vlmPreset, privacyPolicyVersion: input.privacyPolicyVersion,
  };
  return `pcfg-${fnv1a32(stripUrls(stableJson(payload)))}`;
}

export function providerRequestId(input: {
  sourceSha256: string; providerId: ProviderId; configurationIdentity: string; purpose: string;
  pageStart: number; pageEnd: number; regionIds: string[];
  regionBBoxes: Array<{ regionId: string; pageNumber: number; bbox: unknown }>;
  requestedCapabilities: string[]; optionsHash: string; policyHash: string;
}): string {
  const payload = {
    sourceSha256: input.sourceSha256, providerId: input.providerId, configurationIdentity: input.configurationIdentity,
    purpose: input.purpose, pageStart: input.pageStart, pageEnd: input.pageEnd,
    regionIds: [...input.regionIds].sort(),
    regionBBoxes: [...input.regionBBoxes].sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : a.pageNumber - b.pageNumber)),
    requestedCapabilities: [...input.requestedCapabilities].sort(),
    optionsHash: input.optionsHash, policyHash: input.policyHash,
  };
  return `preq-${fnv1a32(stableJson(payload))}`;
}

// ── Fail-closed default policy (mirror) ──────────────────────────────────────

export interface ExtractionProviderPolicyV1 {
  version: typeof EXTRACTION_PROVIDER_POLICY_VERSION;
  policyId: string;
  enabledProviders: ProviderId[];
  remoteProvidersEnabled: boolean;
  remoteVlmEnabled: boolean;
  privacyClass: 'public' | 'internal' | 'confidential' | 'restricted';
  residencyClass: 'local-only' | 'australia-approved' | 'approved-regions-only' | 'remote-prohibited';
  approvedRemoteLocations: string[];
  maxRemotePagesPerJob: number; maxRemoteRegionsPerJob: number; maxRemoteBytesPerJob: number;
  requireExplicitRemoteApproval: boolean;
}

export function defaultLocalProviderPolicy(): ExtractionProviderPolicyV1 {
  return {
    version: EXTRACTION_PROVIDER_POLICY_VERSION, policyId: 'default-local-only',
    enabledProviders: ['pymupdf-exact', 'docling-standard-vnext'],
    remoteProvidersEnabled: false, remoteVlmEnabled: false,
    privacyClass: 'confidential', residencyClass: 'local-only', approvedRemoteLocations: [],
    maxRemotePagesPerJob: 0, maxRemoteRegionsPerJob: 0, maxRemoteBytesPerJob: 0, requireExplicitRemoteApproval: true,
  };
}

/** Fail-closed gate: no public client may enable a remote provider. */
export function isRemoteProviderPermitted(policy: ExtractionProviderPolicyV1, providerId: ProviderId, opts: { remoteApproved: boolean; trustedLocation: string | null }): boolean {
  if (VLM_PROVIDER_IDS.has(providerId) && !policy.remoteVlmEnabled) return false;
  if (REMOTE_PROVIDER_IDS.has(providerId)) {
    if (!policy.remoteProvidersEnabled) return false;
    if (policy.requireExplicitRemoteApproval && !opts.remoteApproved) return false;
    if (!opts.trustedLocation || !policy.approvedRemoteLocations.includes(opts.trustedLocation)) return false;
  }
  return policy.enabledProviders.includes(providerId);
}

// ── Persisted-shape validators (bounded diagnostics) ─────────────────────────

/** Reject wrong version / non-finite numbers / signed URLs / raw buffers. */
export function validateProviderPersistedShape(value: unknown, expectedVersion: string): string[] {
  const problems: string[] = [];
  if (!value || typeof value !== 'object') return ['provider_evidence_incomplete'];
  if ((value as { version?: string }).version !== expectedVersion) problems.push('provider_invalid_response');
  problems.push(...scanForbidden(value));
  return Array.from(new Set(problems));
}

function scanForbidden(value: unknown, depth = 0): string[] {
  if (depth > 7 || value == null) return [];
  if (typeof value === 'string') return isSignedUrl(value) ? ['signed_url_persisted'] : [];
  if (typeof value === 'number') return Number.isFinite(value) ? [] : ['non_finite_number'];
  if (value instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer)) return ['raw_payload_persisted'];
  if (Array.isArray(value)) return value.flatMap((v) => scanForbidden(v, depth + 1));
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => (
      k === 'durablePath' || k === 'ref' || k === 'sourceEvidenceRefs' ? [] : scanForbidden(v, depth + 1)
    ));
  }
  return [];
}
