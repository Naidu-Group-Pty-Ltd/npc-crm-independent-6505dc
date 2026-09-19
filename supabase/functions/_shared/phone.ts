/**
 * Shared phone-number normalization and matching.
 * Single source of truth for the blacklist feature (manage-call-settings
 * validation and vapi-call-webhook matching).
 */

/** Trim, keep an optional leading '+', strip every other non-digit. */
export function normalizePhone(raw: string): string {
  const trimmed = (raw ?? '').trim();
  const digits = trimmed.replace(/\D/g, '');
  return (trimmed.startsWith('+') ? '+' : '') + digits;
}

export function digitsOnly(raw: string): string {
  return (raw ?? '').replace(/\D/g, '');
}

/**
 * Exact normalized match, else last-9-digit suffix match (both sides must
 * have >= 9 digits). The suffix rule handles national vs E.164 formats of the
 * same line (e.g. '0412 345 678' vs '+61412345678') and mirrors the GHL
 * contact-matching precedent in vapi-call-webhook.
 */
export function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const da = digitsOnly(na);
  const db = digitsOnly(nb);
  return da.length >= 9 && db.length >= 9 && da.slice(-9) === db.slice(-9);
}
