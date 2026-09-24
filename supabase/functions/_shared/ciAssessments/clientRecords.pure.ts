/**
 * The rules for finding and creating a client from a Commercial & Industrial
 * assessment.
 *
 * ## Why these are written down
 *
 * An adviser who cannot find the client they are looking at creates them
 * again, and a duplicate client splits one person's history across two
 * records. Three things in `manage-ci-assessments` pushed people that way:
 *
 *  - **A full name found nobody.** The search matched the whole typed string
 *    against the first name OR the surname OR the email, so "Marcus Chen"
 *    matched neither "Marcus" nor "Chen" and the list came back empty for a
 *    client who was on file. Each word now has to match somewhere; the words
 *    may match different fields.
 *  - **A single name crashed.** `clients.primary_first_name` and
 *    `primary_surname` are both NOT NULL, and the create path accepted "a first
 *    name OR a surname" and wrote `null` into the other — an opaque 500 for a
 *    form the page had just accepted. `createClientRecord.ts` already requires
 *    both for exactly this reason; this is the same rule, for the same column.
 *  - **The duplicate-email guard trusted `ilike`**, where `_` is a wildcard, so
 *    `jo_smith@…` could collide with `joesmith@…`. The database now only
 *    narrows the candidates; {@link sameEmail} decides.
 *
 * ## Never compose a filter from a raw term
 *
 * Every word that reaches a PostgREST `or()` goes through
 * {@link filterSafeWord}, which removes the characters that separate or group
 * conditions (and PostgREST's own wildcard spellings). A term therefore cannot
 * add a condition of its own, whatever it contains. An `_` is left in: inside a
 * search it can only widen a match, never narrow one, and email addresses use
 * it.
 */

/** A search matches at most this many words; the rest are ignored. */
export const MAX_SEARCH_WORDS = 4;

/** Words shorter than this are dropped — a single letter matches half the book. */
export const MIN_WORD_LENGTH = 2;

/**
 * Remove what would let a word change the shape of a PostgREST filter.
 *
 * Commas separate conditions, parentheses group them, a backslash escapes, a
 * double quote opens a quoted value, and `%` and `*` are wildcards — none of
 * them is part of a name, an email address or a phone number.
 */
export function filterSafeWord(word: string): string {
  return word.replace(/[,()\\*"%]/g, '').trim();
}

/** The words of a search term, cleaned, de-duplicated and capped. */
export function searchWords(term: string): string[] {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of term.slice(0, 120).split(/\s+/)) {
    const word = filterSafeWord(raw);
    if (word.length < MIN_WORD_LENGTH) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(word);
    if (words.length >= MAX_SEARCH_WORDS) break;
  }
  return words;
}

/**
 * The `or()` filter one word has to satisfy.
 *
 * A word may match a first name, a surname or an email; a word that is a run
 * of four or more digits is also tried against the mobile number.
 */
export function wordFilter(word: string): string {
  const conditions = [
    `primary_first_name.ilike.%${word}%`,
    `primary_surname.ilike.%${word}%`,
    `primary_email.ilike.%${word}%`,
  ];
  if (/^\d{4,}$/.test(word)) conditions.push(`primary_mobile.ilike.%${word}%`);
  return conditions.join(',');
}

/** A term that is a phone number: digits, with the punctuation people type in them. */
const PHONE_TERM = /^\+?[\d\s().-]+$/;

/**
 * Every `or()` filter a search has to satisfy — all of them, one per word.
 *
 * A term that is a phone number is one search, not several words: "0412 345
 * 678" split on spaces would require "345" to match a name. Its digits are
 * matched in order with anything between them, because a stored number keeps
 * whatever spacing somebody first typed into it. Six digits is the floor —
 * fewer, spread out like that, would match numbers that merely share digits.
 */
export function clientSearchFilters(term: string): string[] {
  const trimmed = term.trim().slice(0, 120);
  if (PHONE_TERM.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length >= 6) return [`primary_mobile.ilike.%${digits.split('').join('%')}%`];
  }
  return searchWords(trimmed).map(wordFilter);
}

/**
 * Whether two email addresses are the same address.
 *
 * Case-insensitive, because that is how every mail system on the platform's
 * path treats them, and exact otherwise.
 */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? '').trim().toLowerCase();
  const right = (b ?? '').trim().toLowerCase();
  return left.length > 0 && left === right;
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface NewClientName {
  firstName: string;
  surname: string;
  email?: string;
}

/**
 * Why a new client cannot be created as entered, or null when it can.
 *
 * Both names are required because the table requires both. A company or trust
 * is not a client record here — it is the borrowing entity on the ownership
 * step — so the client is the person the adviser deals with.
 */
export function newClientProblem(input: NewClientName): { code: string; message: string } | null {
  if (!input.firstName.trim() || !input.surname.trim()) {
    return {
      code: 'MISSING_NAME',
      message: 'A first name and a surname are both required to create a client.',
    };
  }
  const email = (input.email ?? '').trim();
  if (email && !EMAIL_SHAPE.test(email)) {
    return { code: 'INVALID_EMAIL', message: 'The email address is not valid.' };
  }
  return null;
}
