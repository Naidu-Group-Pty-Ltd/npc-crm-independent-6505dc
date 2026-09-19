/**
 * One canonical key per Airtable table.
 *
 * Airtable accepts either a table id (`tblWIg5cs85O30pcY`) or its display name
 * ("Property Intake Master") in a URL, and callers here used both — which is
 * fine for Airtable and quietly fatal for anything that *keys* on the value.
 *
 * The listings cache did exactly that. Cron syncs with no `tableName`, so it
 * writes rows under the configured default, which is the table **id**. The
 * Listings page asks for the display name. `WHERE table_key = 'Property Intake
 * Master'` matched nothing, the read returned an empty set, the client treated
 * that as "cache cannot answer" and fell back to the fifteen-request Airtable
 * walk — on the one page the cache was built for, while Overview (which passes
 * no name at all) was served from it. The two pages disagreed and nobody was
 * told.
 *
 * So every entry point resolves to one canonical key before it is used as an
 * allowlist subject or a storage key. Resolution is deliberately cheap and
 * offline where it can be, because it sits in front of a permission check.
 *
 * Pure: no Deno, Supabase, network, DOM or clock, so both runtimes can share it
 * and the resolution rules can be tested directly.
 */

/** Airtable table ids are `tbl` + 14 url-safe characters. */
const TABLE_ID = /^tbl[A-Za-z0-9]{14}$/;

export function looksLikeTableId(value: unknown): boolean {
  return typeof value === 'string' && TABLE_ID.test(value.trim());
}

/**
 * Parses the optional `AIRTABLE_TABLE_ALIASES` override.
 *
 * Format is `Display Name=tblXXXXXXXXXXXXXX,Another Name=tblYYYYYYYYYYYYYY`.
 * This exists so an operator can pin a mapping without the runtime having to ask
 * Airtable for its schema; when it is absent the resolver falls back to a
 * metadata lookup, so the common case needs no configuration at all.
 *
 * Names are matched case-insensitively and whitespace-trimmed, because a display
 * name typed into an env var and one typed into a component will differ by a
 * capital letter eventually.
 */
export function parseTableAliases(raw: string | null | undefined): Map<string, string> {
  const aliases = new Map<string, string>();
  if (!raw) return aliases;
  for (const entry of raw.split(',')) {
    const separator = entry.indexOf('=');
    if (separator <= 0) continue;
    const name = entry.slice(0, separator).trim();
    const id = entry.slice(separator + 1).trim();
    if (!name || !looksLikeTableId(id)) continue;
    aliases.set(normaliseName(name), id);
  }
  return aliases;
}

export function normaliseName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface ResolveInput {
  /** What the caller asked for: a table id, a display name, or nothing. */
  requested?: string | null;
  /** `AIRTABLE_TABLE_NAME` — in this deployment it holds an id. */
  fallback?: string | null;
  /** Display name → id, from the env override or a metadata lookup. */
  aliases?: Map<string, string>;
}

/**
 * The canonical key for a request, or null when nothing was supplied.
 *
 * Returns the table id whenever one can be determined, and otherwise hands back
 * the trimmed input unchanged — an unresolvable name is still a valid Airtable
 * URL segment, so the caller degrades to the previous behaviour rather than
 * failing. The allowlist check downstream is what refuses unknown tables; this
 * function's job is only to make sure both sides of that check are speaking
 * about the same thing.
 */
export function canonicalTableKey({ requested, fallback, aliases }: ResolveInput): string | null {
  const asked = (requested ?? '').trim();
  const chosen = asked || (fallback ?? '').trim();
  if (!chosen) return null;
  if (looksLikeTableId(chosen)) return chosen;
  return aliases?.get(normaliseName(chosen)) ?? chosen;
}

/**
 * Whether two keys name the same table.
 *
 * Used for the allowlist, so that a deployment which allowlists ids still admits
 * a caller who asked by name, and vice versa.
 */
export function sameTable(a: string | null, b: string | null, aliases?: Map<string, string>): boolean {
  if (!a || !b) return false;
  const left = canonicalTableKey({ requested: a, aliases });
  const right = canonicalTableKey({ requested: b, aliases });
  if (!left || !right) return false;
  return left === right || normaliseName(left) === normaliseName(right);
}

/**
 * Builds the allowlist as canonical keys.
 *
 * Both the configured default and every entry of `AIRTABLE_TABLE_ALLOWLIST` go
 * through the same resolution as the request, so a mixed configuration — some
 * ids, some names — still admits exactly the intended set.
 */
export function buildAllowlist(
  defaultTable: string | null | undefined,
  allowlistEnv: string | null | undefined,
  aliases?: Map<string, string>,
): Set<string> {
  const allowed = new Set<string>();
  const add = (value: string | null | undefined) => {
    const key = canonicalTableKey({ requested: value ?? '', aliases });
    if (key) {
      allowed.add(key);
      allowed.add(normaliseName(key));
    }
  };
  add(defaultTable);
  for (const entry of (allowlistEnv ?? '').split(',')) add(entry);
  return allowed;
}

/** True when `key` is admitted by an allowlist built with `buildAllowlist`. */
export function allowlistAdmits(allowed: Set<string>, key: string | null): boolean {
  if (!key) return false;
  return allowed.has(key) || allowed.has(normaliseName(key));
}
