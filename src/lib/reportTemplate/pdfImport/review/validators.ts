/**
 * PDF Extraction V3 · E11 — persisted-model validators.
 *
 * A view model must never carry a signed URL, a raw buffer or a private artifact
 * path. These validators scan a model for such leaks before it could be persisted
 * (query cache dehydration, localStorage, telemetry). Returns bounded problem
 * codes; empty means safe.
 */
const SIGNED_URL_RE = /^(https?|blob|data):/i;

function isSignedUrl(v: unknown): boolean {
  return typeof v === 'string' && SIGNED_URL_RE.test(v);
}

/** Keys allowed to hold slash-bearing bare identifiers (never signed URLs). */
const PATH_TOLERANT_KEYS: ReadonlySet<string> = new Set([]);

function scan(value: unknown, key: string | null, depth: number, out: string[]): void {
  if (depth > 10 || value == null) return;
  if (typeof value === 'string') {
    if (isSignedUrl(value)) out.push('signed_url_in_model');
    // A raw private-looking path (has a slash, not a bare id) is disallowed.
    else if (key !== null && !PATH_TOLERANT_KEYS.has(key) && (value.includes('/') && value.length > 24 && /\.(png|json|jpg|jpeg|webp|pdf)$/i.test(value))) {
      out.push('private_path_in_model');
    }
    return;
  }
  if (typeof value === 'number') { if (!Number.isFinite(value)) out.push('non_finite_number'); return; }
  if (value instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer)) { out.push('raw_buffer_in_model'); return; }
  if (Array.isArray(value)) { for (const v of value) scan(v, key, depth + 1, out); return; }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) scan(v, k, depth + 1, out);
  }
}

/** Validate that a view model is safe to persist/serialize. Empty = safe. */
export function validatePersistableModel(model: unknown): string[] {
  const out: string[] = [];
  scan(model, null, 0, out);
  return Array.from(new Set(out));
}

/** True when the model is safe to persist. */
export function isPersistableModel(model: unknown): boolean {
  return validatePersistableModel(model).length === 0;
}
