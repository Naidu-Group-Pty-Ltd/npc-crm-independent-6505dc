/**
 * The Solicitor Portal's conflict search: what it searches for, what counts as
 * a hit, and what a search may conclude.
 *
 * `solicitor-portal-compliance` owns the reads (which matters, which parties,
 * in pages) and this module owns the judgement, so the judgement can be run by
 * a test rather than described by one. Until 28 Sep 2026 the judgement was
 * half in a PostgREST filter string and half in code that could not run: the
 * term was stripped of `%_(),` and ILIKE-matched against the raw column, so a
 * term copied from a party ("ACME (Aust) Pty Ltd") could not find that party,
 * and a search over nothing recorded "clear".
 *
 * Three rules:
 *
 * - **Both sides are normalised by the same function.** A comparison
 *   normalised on one side only misses, and a miss reads as a clearance.
 * - **A term is data, never syntax.** Nothing here is spliced into a filter;
 *   the caller reads rows and asks `conflictHit`.
 * - **A search over nothing is not a clearance.** No other matter searched is
 *   `pending`, which a person must decide, never `clear`.
 */

/**
 * The form a comparison is made in: case folded, and every character that is
 * not a letter or a digit dropped, so "O'Brien", "OBrien" and "o brien" are one
 * key, as are "Pty. Ltd." and "Pty Ltd". NFKD first splits an accented letter
 * into the letter and a combining mark, and a mark is neither, so "Zoë" and
 * "Zoe" meet too, as do full-width and ordinary letters.
 */
export const conflictKey = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');

/** A term as the solicitor reads it back: whitespace collapsed, bounded. */
export const conflictTerm = (value: unknown): string =>
  String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

/** Shorter than this, a key matches too much to be a search. */
export const CONFLICT_MIN_KEY = 3;
/** Terms a caller may add to the matter's own parties. */
export const CONFLICT_MAX_EXPLICIT_TERMS = 25;
/** Terms one search compares, after de-duplication. */
export const CONFLICT_MAX_TERMS = 40;

export interface ConflictParty {
  name?: unknown;
  organisation?: unknown;
}

/** A searched term: its comparison key, and the term as it is read back. */
export type ConflictSearchTerm = readonly [key: string, term: string];

/**
 * What one search looks for: the caller's own terms first, then every name
 * and organisation among the matter's parties. One entry per key, in that
 * order, and none shorter than `CONFLICT_MIN_KEY`.
 */
export function conflictSearchTerms(
  explicitTerms: unknown,
  parties: readonly ConflictParty[],
): ConflictSearchTerm[] {
  const explicit = Array.isArray(explicitTerms)
    ? explicitTerms.filter((term) => typeof term === 'string').slice(0, CONFLICT_MAX_EXPLICIT_TERMS)
    : [];
  const termsByKey = new Map<string, string>();
  for (const raw of [...explicit, ...parties.flatMap((party) => [party.name, party.organisation])]) {
    const term = conflictTerm(raw);
    const key = conflictKey(term);
    if (key.length >= CONFLICT_MIN_KEY && !termsByKey.has(key)) termsByKey.set(key, term);
  }
  return Array.from(termsByKey).slice(0, CONFLICT_MAX_TERMS) as ConflictSearchTerm[];
}

/**
 * The first searched term a party's name or organisation contains, or
 * `undefined`. Containment rather than equality, deliberately: a potential
 * conflict goes to a person, so the search errs towards showing one.
 */
export function conflictHit(
  searched: readonly ConflictSearchTerm[],
  party: ConflictParty,
): ConflictSearchTerm | undefined {
  const keys = [party.name, party.organisation].map(conflictKey).filter(Boolean);
  if (keys.length === 0) return undefined;
  return searched.find(([key]) => keys.some((candidate) => candidate.includes(key)));
}

export type ConflictOutcome = 'pending' | 'clear' | 'potential_conflict';

/** What a search may conclude from how many matters it searched and what it found. */
export function conflictOutcome(mattersSearched: number, matchCount: number): ConflictOutcome {
  if (matchCount > 0) return 'potential_conflict';
  return mattersSearched > 0 ? 'clear' : 'pending';
}
