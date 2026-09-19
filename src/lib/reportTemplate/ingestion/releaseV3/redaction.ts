/**
 * PDF Extraction V3 · E12 — deterministic identity + leak redaction.
 *
 * Shared FNV-1a-32 over sorted-key compact JSON (byte-identical with the E1/E9/E10
 * producers for ASCII), plus the forbidden-content scanner that keeps every
 * contract, report and evidence artifact free of signed URLs, raw buffers,
 * private paths, credentials and non-finite numbers.
 */

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

export function stableJson(value: unknown): string { return JSON.stringify(sortValue(value)); }
export function stableHash(prefix: string, value: unknown): string { return `${prefix}-${fnv1a32(stableJson(value))}`; }

const SIGNED_URL_RE = /(https?|blob|data):/i;
const BEARER_RE = /bearer\s+[a-z0-9._-]+/i;
const CRED_RE = /(api[_-]?key|secret|password|authorization|x-goog|service_role)/i;
const PROCESSOR_RE = /projects\/[^/]+\/locations\/[^/]+\/processors\//i;
const PRIVATE_PATH_RE = /\.(pdf|png|jpe?g|webp|ttf|otf|woff2?)$/i;

export function isSignedUrl(v: unknown): boolean { return typeof v === 'string' && SIGNED_URL_RE.test(v); }

/**
 * Scan a value for forbidden content. Returns bounded problem codes; empty = safe.
 * Keys named `sha256`/`sourceHash`/`*HashPrefix` may hold hex; `relativePath` may
 * hold a generated-only temp path (still scanned for signed URLs).
 */
export function scanForbidden(value: unknown, key: string | null = null, depth = 0): string[] {
  if (depth > 12 || value == null) return [];
  if (typeof value === 'string') {
    const out: string[] = [];
    if (SIGNED_URL_RE.test(value)) out.push('signed_url_detected');
    if (BEARER_RE.test(value)) out.push('bearer_token_detected');
    if (PROCESSOR_RE.test(value)) out.push('processor_resource_detected');
    if (CRED_RE.test(value) && value.includes('=')) out.push('credential_detected');
    // A private artifact path with a slash and a media extension (not a bare id).
    if (key !== 'relativePath' && value.includes('/') && PRIVATE_PATH_RE.test(value) && value.length > 20) out.push('private_path_detected');
    return out;
  }
  if (typeof value === 'boolean') return [];
  if (typeof value === 'number') return Number.isFinite(value) ? [] : ['non_finite_number'];
  if (value instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer)) return ['raw_buffer_detected'];
  if (Array.isArray(value)) return value.flatMap((v) => scanForbidden(v, key, depth + 1));
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => scanForbidden(v, k, depth + 1));
  }
  return [];
}

/** True when a value is safe to persist/upload in a report. */
export function isSanitized(value: unknown): boolean { return scanForbidden(value).length === 0; }

/** Truncate an id/hash for display without exposing the full value. */
export function prefixId(v: unknown, keep = 12): string | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  return v.length <= keep ? v : `${v.slice(0, keep)}…`;
}

export function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
