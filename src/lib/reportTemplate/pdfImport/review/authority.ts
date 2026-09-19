/**
 * PDF Extraction V3 · E11 — authority helpers.
 *
 * Small, side-effect-free helpers the builders use to project AUTHORITATIVE
 * upstream values into view models without rederiving them. The cardinal
 * discipline lives here:
 *   - `numOrNull` keeps `null` distinct from `0` (unavailable is never zero);
 *   - `prefix` truncates ids for display without ever exposing a full secret;
 *   - `stripSigned` guarantees no signed URL / private path leaks into a model.
 *
 * These operate on bounded, already-decided upstream inputs. They never compute
 * quality, routing, arbitration, selection or cache validity.
 */

/** A finite number, or null. Guarantees `0` is preserved and `NaN`/undefined → null. */
export function numOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

/** A non-empty string, or null. */
export function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** A boolean, or null when genuinely unknown (never coerces unknown → false). */
export function boolOrNull(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

/** Truncated id for display, e.g. `plan3-99e3a652` → `plan3-99e…`. Never a full secret. */
export function prefix(id: unknown, keep = 12): string | null {
  const s = strOrNull(id);
  if (s === null) return null;
  if (s.length <= keep) return s;
  return `${s.slice(0, keep)}…`;
}

const SIGNED_URL_RE = /^(https?|blob|data):/i;
export function isSignedUrl(v: unknown): boolean {
  return typeof v === 'string' && SIGNED_URL_RE.test(v);
}

/** True when a string looks like a private artifact path (has a slash, not a bare id). */
export function looksLikePrivatePath(v: unknown): boolean {
  return typeof v === 'string' && (v.includes('/') || v.includes('\\')) && !isSignedUrl(v);
}

/** Deep-freeze guard used by builders to prove they do not mutate their inputs. */
export function isFrozenDeep(v: unknown): boolean {
  if (v == null || typeof v !== 'object') return true;
  if (!Object.isFrozen(v)) return false;
  return Object.values(v as Record<string, unknown>).every(isFrozenDeep);
}

/** Ratio in [0,1] or null; never divides by zero into a misleading value. */
export function ratioOrNull(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (typeof numerator !== 'number' || typeof denominator !== 'number') return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  const r = numerator / denominator;
  return Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : null;
}

/** Count occurrences of a discriminant across an array (order-independent). */
export function countBy<T>(rows: readonly T[], key: (row: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row);
    if (typeof k === 'string' && k.length > 0) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
