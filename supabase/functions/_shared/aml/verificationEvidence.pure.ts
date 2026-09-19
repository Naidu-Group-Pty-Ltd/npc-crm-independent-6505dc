/**
 * What may be written into `aml.verification_checks.outcome_detail`.
 *
 * That column is the evidence a human adjudicator reads, and it is carried
 * into the case timeline and the audit record. The biometric record of truth
 * is the `aml-biometrics` bucket, whose every read is logged — so an image
 * that also landed in `outcome_detail` would be a second copy of the most
 * sensitive data we hold, in a place nobody is auditing reads of.
 *
 * The self-hosted service is stateless and returns scores, not images, so
 * today nothing image-shaped comes back. This exists so that stays true
 * without depending on it: the adapter's `raw` is passed straight through to
 * the database, so a future field — an annotated crop, an echoed request, a
 * debug payload — would be persisted silently. Strip it at the boundary
 * instead, and record that something was stripped rather than dropping it
 * quietly.
 */

/** Field names that would carry image data, whatever their content. */
const IMAGE_KEY = /(^|_)(image|photo|selfie|document_image|frame|thumbnail|crop|bytes|b64|base64)($|_)/i;

/** A long run of base64, with or without a data: URL wrapper. */
const BASE64_BLOB = /^(data:[^;]*;base64,)?[A-Za-z0-9+/\r\n]{512,}={0,2}$/;

export const REDACTED = '[redacted: image data is not stored in the case record]';

/** How deep to walk before giving up — provider payloads are shallow. */
const MAX_DEPTH = 8;

function looksLikeImage(key: string, value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length >= 512 && BASE64_BLOB.test(value)) return true;
  // A short value under an image-shaped key is a filename or a verdict, not a
  // payload; only redact when the key says image AND the value is substantial.
  return IMAGE_KEY.test(key) && value.length >= 256;
}

/**
 * Return `value` with anything image-shaped replaced by a marker.
 *
 * Structure is preserved so the adjudicator still sees which fields the
 * provider returned — a silently missing key would be worse evidence than a
 * visibly redacted one.
 */
export function stripImagePayloads<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item, i) =>
      looksLikeImage(String(i), item) ? REDACTED : stripImagePayloads(item, depth + 1)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = looksLikeImage(key, item) ? REDACTED : stripImagePayloads(item, depth + 1);
  }
  return out as unknown as T;
}
