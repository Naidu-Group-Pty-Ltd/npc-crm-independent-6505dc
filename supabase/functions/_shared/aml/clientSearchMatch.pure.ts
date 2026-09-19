/**
 * AML activation client search — pure matching + projection logic.
 *
 * Extracted from the `search_clients` op in `supabase/functions/aml-cases/index.ts`
 * so the tokenised full-name matching is unit-testable from vitest (the edge
 * function itself only runs under Deno). No I/O in this module.
 *
 * Contract (directive §13.4 + activation-pathway fix):
 *  - A full name ("Rugesh Naidu") never matches a single name column, so the
 *    query is split into tokens and every token must appear somewhere in the
 *    same person's assembled name (primary or secondary applicant).
 *  - Matching is case-insensitive and tolerant of repeated whitespace.
 *  - Both active AND inactive clients are returned: the activation form is the
 *    place an authorised user confirms an existing client is active, so the
 *    picker must be able to offer inactive records (clearly labelled).
 *  - The projection carries identification data only (name, email, mobile,
 *    active flag, open-case flag) — never financial information.
 */

/** Raw row shape selected from `public.clients` for the picker. */
export interface ClientSearchRow {
  id: string;
  is_active: boolean | null;
  secondary_email?: string | null;
  primary_first_name?: string | null;
  primary_middle_name?: string | null;
  primary_surname?: string | null;
  secondary_first_name?: string | null;
  secondary_middle_name?: string | null;
  secondary_surname?: string | null;
  primary_email?: string | null;
  primary_mobile?: string | null;
}

/** Picker projection returned to the activation dialog. */
export interface ActivationClientResult {
  id: string;
  label: string;
  email: string | null;
  mobile: string | null;
  is_active: boolean;
  has_open_case: boolean;
}

export const CLIENT_SEARCH_NAME_COLUMNS = [
  'primary_first_name', 'primary_middle_name', 'primary_surname',
  'secondary_first_name', 'secondary_middle_name', 'secondary_surname',
] as const;

/**
 * Email is searchable too.
 *
 * Two reasons, and the second is the load-bearing one. An operator holding an
 * enquiry email expects to paste it in; and duplicate detection before
 * creating a client is only worth anything if it can match on the one field
 * people actually reuse. A name search cannot catch "Rob Smith" against an
 * existing "Robert Smith", but the shared email address will.
 */
export const CLIENT_SEARCH_EMAIL_COLUMNS = [
  'primary_email', 'secondary_email',
] as const;

export const CLIENT_SEARCH_MATCH_COLUMNS = [
  ...CLIENT_SEARCH_NAME_COLUMNS,
  ...CLIENT_SEARCH_EMAIL_COLUMNS,
] as const;

/** Columns the search op selects — identification only, no financials. */
export const CLIENT_SEARCH_SELECT = [
  'id', 'is_active', 'primary_email', 'primary_mobile', 'secondary_email',
  ...CLIENT_SEARCH_NAME_COLUMNS,
].join(', ');

export const CLIENT_SEARCH_RESULT_LIMIT = 20;

/**
 * Browse mode — the picker with no query typed into it.
 *
 * ── Why this exists ───────────────────────────────────────────────────
 * The picker used to return `[]` for anything shorter than two characters,
 * so opening the activation dialog showed an empty box and nothing else. An
 * operator had to already know a client's name, and spell it, before the
 * system would admit the client existed. With 775 clients on this
 * deployment — 40 active, 735 inactive — "type a name to find out what we
 * hold" is not a picker, it is a guessing game, and it is why activation
 * felt like it required re-entering clients the platform already had.
 *
 * Browse is the SAME op, the SAME projection and the SAME permission gate
 * as search — only the filter differs. That is deliberate: a second
 * "list clients" endpoint would be a second source of truth about which
 * clients an AML operator may see, and those two would drift.
 */
export const CLIENT_BROWSE_PAGE_SIZE = 25;
/** Hard ceiling on a caller-supplied page size. */
export const CLIENT_BROWSE_MAX_PAGE_SIZE = 50;

/** Which slice of the register the picker is asking for. */
export type ClientPickerStatus = 'all' | 'active' | 'inactive';

export function isClientPickerStatus(value: unknown): value is ClientPickerStatus {
  return value === 'all' || value === 'active' || value === 'inactive';
}

/** Clamp a caller-supplied page size into something the database will enjoy. */
export function clampPageSize(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return CLIENT_BROWSE_PAGE_SIZE;
  return Math.min(Math.floor(n), CLIENT_BROWSE_MAX_PAGE_SIZE);
}

/** Clamp a caller-supplied offset to a non-negative integer. */
export function clampOffset(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Does this request mean "browse" rather than "search"?
 *
 * An empty or one-character query browses. This is the one place that
 * decision is made, so the server and the tests cannot disagree about what
 * a single stray keystroke does.
 */
export function isBrowseQuery(raw: unknown): boolean {
  return sanitizeClientSearchQuery(raw).length < 2;
}

/**
 * Order a page of browsed rows: active first, then inactive, surname order
 * preserved within each group as the database delivered it.
 *
 * Active-first matters here in a way it does not in search. A search has a
 * name behind it; a browse does not, and the 40 clients someone is likely to
 * be activating against must not sit behind 735 inactive ones.
 */
export function orderBrowsedClients(rows: ClientSearchRow[]): ClientSearchRow[] {
  const active = rows.filter((r) => r.is_active === true);
  const inactive = rows.filter((r) => r.is_active !== true);
  return [...active, ...inactive];
}

/**
 * Strip characters that carry meaning inside a PostgREST `or=` filter
 * (`%`, `,`, `(`, `)`, backslash) and collapse repeated whitespace.
 */
export function sanitizeClientSearchQuery(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[%,()\\.*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split a sanitised query into matching tokens. Single-character tokens are
 * dropped (too noisy) unless nothing longer survives, in which case the whole
 * sanitised query is used as one term. Capped at 4 tokens.
 */
export function tokenizeClientSearch(sanitized: string): string[] {
  const tokens = sanitized.split(/\s+/).filter((t) => t.length >= 2).slice(0, 4);
  return tokens.length > 0 ? tokens : (sanitized ? [sanitized] : []);
}

/**
 * PostgREST `or=` candidate filter: any token in any name column. This is a
 * deliberately wide database-side pre-filter; `matchesAllTerms` applies the
 * strict all-tokens-in-one-person rule afterwards.
 */
export function buildClientSearchOrFilter(terms: string[]): string {
  return terms
    .flatMap((t) => CLIENT_SEARCH_MATCH_COLUMNS.map((c) => `${c}.ilike.%${t}%`))
    .join(',');
}

/** Assemble one applicant's display name off the row it is actually stored in. */
export function clientDisplayName(
  row: ClientSearchRow,
  prefix: 'primary' | 'secondary',
): string {
  const r = row as unknown as Record<string, string | null | undefined>;
  return [r[`${prefix}_first_name`], r[`${prefix}_middle_name`], r[`${prefix}_surname`]]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when every token appears (case-insensitively) in the primary applicant's
 * assembled name, or every token appears in the secondary applicant's name.
 * "Rugesh Naidu" therefore matches `primary_first_name = Rugesh`,
 * `primary_surname = Naidu`.
 */
export function matchesAllTerms(row: ClientSearchRow, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const lower = terms.map((t) => t.toLowerCase());
  // One applicant's name and their own email form a single haystack, so the
  // all-tokens-on-ONE-person rule still holds: "rugesh naidu" must not match
  // by taking "rugesh" from the primary applicant and "naidu" from the
  // secondary, and it must not match by taking a token from someone else's
  // email either.
  const haystacks = (['primary', 'secondary'] as const).map((prefix) => {
    const r = row as unknown as Record<string, string | null | undefined>;
    return [clientDisplayName(row, prefix), r[`${prefix}_email`] ?? '']
      .filter(Boolean).join(' ').toLowerCase();
  });
  return haystacks.some((hay) => hay.length > 0 && lower.every((t) => hay.includes(t)));
}

export function toActivationClientResult(
  row: ClientSearchRow,
  hasOpenCase: boolean,
): ActivationClientResult {
  return {
    id: row.id,
    label: clientDisplayName(row, 'primary')
      || clientDisplayName(row, 'secondary')
      || 'Unnamed client',
    email: row.primary_email ?? null,
    mobile: row.primary_mobile ?? null,
    is_active: row.is_active === true,
    has_open_case: hasOpenCase,
  };
}

/**
 * Full in-memory pipeline over the candidate rows the database returned:
 * strict tokenised matching, stable active-first ordering (surname order is
 * preserved within each group as delivered by the query), capped result set.
 * Inactive clients are included and selectable — the activation form is where
 * they get confirmed active.
 */
export function selectActivationMatches(
  rows: ClientSearchRow[],
  query: string,
  limit: number = CLIENT_SEARCH_RESULT_LIMIT,
): ClientSearchRow[] {
  const terms = tokenizeClientSearch(sanitizeClientSearchQuery(query));
  if (terms.length === 0) return [];
  const matched = rows.filter((r) => matchesAllTerms(r, terms));
  return orderBrowsedClients(matched).slice(0, limit);
}

/**
 * A page of search results, plus how many matched in total.
 *
 * The count is the number that MATCHED, not the number returned — the picker
 * says "12 of 48 shown", and a page size masquerading as a total is how a
 * picker quietly tells an operator a client does not exist. Matching is
 * still done in memory (the database pre-filter is deliberately wide and
 * cannot express the all-tokens-on-one-person rule), so the page is taken
 * after the strict match rather than before it.
 */
export function selectActivationPage(
  rows: ClientSearchRow[],
  query: string,
  limit: number = CLIENT_BROWSE_PAGE_SIZE,
  offset = 0,
): { rows: ClientSearchRow[]; total: number } {
  const terms = tokenizeClientSearch(sanitizeClientSearchQuery(query));
  if (terms.length === 0) return { rows: [], total: 0 };
  const matched = orderBrowsedClients(rows.filter((r) => matchesAllTerms(r, terms)));
  return { rows: matched.slice(offset, offset + limit), total: matched.length };
}
