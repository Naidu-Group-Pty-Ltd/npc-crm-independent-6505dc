/**
 * Command Centre staff identifier resolution.
 *
 * Command Centre accounts live in `custom_users` and are wholly separate from the
 * four portal user tables (`client_portal_users`, `finance_portal_users`,
 * `solicitor_portal_users`, builder portal users). Each portal authenticates
 * against its own table with its own cookie, so the same email address appearing
 * in several of them is *not* a conflict and must never be treated as one.
 *
 * What WAS a real defect: Command Centre resolved the sign-in identifier with an
 * exact, case-sensitive match on `username` only. Testers who use one email
 * across the portals typed that email here (or the username with different
 * casing / a trailing space from autofill) and received the generic
 * "Invalid username or password" — indistinguishable from a wrong password.
 *
 * This resolver accepts either the username or the account email, trimmed and
 * case-insensitively, and deliberately refuses to guess: if an identifier
 * resolves to more than one active staff account it returns `ambiguous` rather
 * than picking one, so no one can be signed into an account that is not theirs.
 * Scope stays inside `custom_users` — never widened to portal tables.
 */

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

export interface ResolvedStaffUser<T> {
  user: T | null;
  ambiguous: boolean;
}

/** Escapes PostgREST `or()` filter metacharacters in a user-supplied value. */
function sanitizeFilterValue(value: string): string {
  return value.replace(/[,()"\\]/g, '');
}

export function normalizeStaffIdentifier(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Finds the single active `custom_users` row whose username OR email matches the
 * identifier, case-insensitively. `columns` is passed straight through so callers
 * keep control of what they read.
 */
export async function resolveStaffUserByIdentifier<T = Record<string, unknown>>(
  supabase: SupabaseLike,
  identifier: string,
  columns = '*',
  options: { activeOnly?: boolean } = {},
): Promise<ResolvedStaffUser<T>> {
  const value = normalizeStaffIdentifier(identifier);
  if (!value) return { user: null, ambiguous: false };

  const safe = sanitizeFilterValue(value);
  if (!safe) return { user: null, ambiguous: false };

  let query = supabase
    .from('custom_users')
    .select(columns)
    .or(`username.ilike.${safe},email.ilike.${safe}`)
    .limit(3);

  if (options.activeOnly !== false) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error || !Array.isArray(data) || data.length === 0) {
    return { user: null, ambiguous: false };
  }
  if (data.length > 1) {
    // Prefer an exact (case-sensitive) username match before declaring the
    // identifier ambiguous — that is an unmistakable, single-account intent.
    const exact = data.filter((row: Record<string, unknown>) => row.username === value);
    if (exact.length === 1) return { user: exact[0] as T, ambiguous: false };
    return { user: null, ambiguous: true };
  }
  return { user: data[0] as T, ambiguous: false };
}
