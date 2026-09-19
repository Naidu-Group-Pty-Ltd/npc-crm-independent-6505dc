/**
 * WP-08 — shared guards for the delegated-credential proxies
 * (Airtable / ManyChat / GHL messaging).
 *
 * These proxies each hold a broad third-party credential, so we enforce:
 *   - module-permission gates (registered-module aware, superadmin bypass)
 *   - superadmin-only capability checks for high-blast-radius actions
 *   - a lightweight in-memory per-user rate limiter (best-effort defense)
 *   - upstream-error redaction so raw provider text never leaks to the client
 */

export async function isSuperadmin(
  supabase: any,
  userId: string | null | undefined,
  authMethod?: string,
): Promise<boolean> {
  if (!userId) return false;
  if (authMethod === 'service_role' || userId === 'service_role') return true;
  const { data } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'superadmin')
    .maybeSingle();
  return !!data;
}

// ─── In-memory rate limiter ────────────────────────────────────────────────
// Best-effort: single-instance scope. Persistent limits live in api_usage_log
// downstream, but this stops obvious loops/abuse before we call the vendor.
const RATE_BUCKETS = new Map<string, { count: number; resetAt: number }>();

export interface RateCheck { allowed: boolean; retryAfterMs?: number }

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateCheck {
  const now = Date.now();
  const bucket = RATE_BUCKETS.get(key);
  if (!bucket || bucket.resetAt <= now) {
    RATE_BUCKETS.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }
  if (bucket.count >= limit) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }
  bucket.count += 1;
  return { allowed: true };
}

/** Redact vendor error text down to a safe short summary. */
export function redactUpstreamError(status: number, service: string): string {
  if (status === 401 || status === 403) return `${service} authorisation failed.`;
  if (status === 404) return `${service} resource not found.`;
  if (status === 422) return `${service} rejected the request as invalid.`;
  if (status === 429) return `${service} is rate-limiting; try again shortly.`;
  if (status >= 500) return `${service} service is temporarily unavailable.`;
  return `${service} rejected the request.`;
}
