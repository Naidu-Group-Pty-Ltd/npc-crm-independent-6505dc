/**
 * pdf-cache-contract-v2 — policy-safe parse-cache fingerprint.
 *
 * The dispatcher previously keyed cache reuse on `source_file_hash` + requested
 * `mode` only. That is unsafe: a NON-redacted cached result could satisfy a
 * REDACTED request (a privacy regression), and differences in lane / raster DPI
 * / description policy / engine version silently reused incompatible artifacts.
 *
 * This module builds a deterministic canonical fingerprint string from every
 * request-level input that can change the produced artifacts. The dispatcher
 * hashes it into `cache_contract_fingerprint`; a cache hit requires an EXACT
 * fingerprint match. Effective mode and lane are deterministic consequences of
 * (source + these request inputs), so encoding the request inputs is sufficient
 * for a pre-plan cache lookup while preserving the security invariant.
 *
 * Pure and runtime-agnostic (zero imports); importable by the Deno dispatcher
 * and by a vitest spec.
 */

export const PDF_CACHE_CONTRACT_VERSION = 'pdf-cache-contract-v2' as const;

export interface CacheContractFingerprintInput {
  contractVersion: string;
  /** SHA-256 of the source bytes. */
  sourceHash: string;
  /** Requested (DB-form) mode: semantic | hybrid | pixel_perfect. */
  requestedMode: string;
  /** Whether the plan is permitted to override the requested mode. */
  allowModeOverride: boolean;
  /** Redaction is security-critical: it MUST partition the cache. */
  redactPii: boolean;
  redactionPolicyVersion: string;
  /** Picture-description tier (on | off | ...). */
  descriptionTier: string;
  includeMarkdown: boolean;
  includeDoctags: boolean;
  rasterFormat: string;
  rasterDpi: number;
  engineVersion: string;
  artifactContractVersion: string;
  lanePolicyVersion: string;
  provider: string;
  serviceClass: string;
}

function bit(v: boolean): string {
  return v ? '1' : '0';
}

function scalar(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return 'none';
  return String(v).replace(/[|=]/g, '_');
}

/**
 * Build the canonical, deterministic fingerprint string. Field order is fixed
 * (not sorted at runtime) so the output is stable and diffable. Identical inputs
 * always produce identical output; any artifact-affecting change alters it.
 */
export function buildCacheContractFingerprintInput(input: CacheContractFingerprintInput): string {
  const parts: Array<[string, string]> = [
    ['v', scalar(input.contractVersion)],
    ['hash', scalar(input.sourceHash)],
    ['reqmode', scalar(input.requestedMode)],
    ['override', bit(input.allowModeOverride)],
    ['redact', bit(input.redactPii)],
    ['redactver', scalar(input.redactionPolicyVersion)],
    ['desc', scalar(input.descriptionTier)],
    ['md', bit(input.includeMarkdown)],
    ['doctags', bit(input.includeDoctags)],
    ['rformat', scalar(input.rasterFormat)],
    ['rdpi', scalar(input.rasterDpi)],
    ['engine', scalar(input.engineVersion)],
    ['artifact', scalar(input.artifactContractVersion)],
    ['lanever', scalar(input.lanePolicyVersion)],
    ['provider', scalar(input.provider)],
    ['class', scalar(input.serviceClass)],
  ];
  return parts.map(([k, v]) => `${k}=${v}`).join('|');
}
