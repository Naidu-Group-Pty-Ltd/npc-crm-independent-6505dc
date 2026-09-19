/**
 * A client's name, off the row it is actually stored in.
 *
 * ## Why this module exists
 *
 * `render-borrowing-capacity-pdf` selected `id, first_name, surname,
 * company_name` from `clients`. **None of those three columns exists.** The
 * table stores a primary and a secondary applicant — `primary_first_name`,
 * `primary_surname`, `secondary_first_name`, `secondary_surname` — and has no
 * company name at all.
 *
 * PostgREST answered that select with `column clients.first_name does not
 * exist`, supabase-js returned `{ data: null, error }`, and the route's
 * `if (!clientRes.data) return json({ error: 'not found' }, 404)` turned it into
 * a 404 for **every client in the database**. `borrowing_capacity_renders` had
 * no rows because the function never got past its first read.
 *
 * Every other edge function in this repo reads `primary_first_name,
 * primary_surname`; the two report renderers were the outliers. One constant and
 * one function so a third format cannot invent a fourth spelling.
 *
 * ## Two applicants
 *
 * A borrowing capacity assessment is regularly joint, and `clients` models that
 * directly. The document names the **primary** applicant, which is what the
 * rest of the app displays and — because the filename is built from it — what
 * every Snapshot a client has ever received is called. The secondary applicant
 * is read so a record with only a secondary name still produces a document with
 * a name on it, rather than "Client".
 */

/**
 * The columns to select. Exported as one string so a caller cannot ask for
 * three of the four and quietly lose the fallback.
 */
export const CLIENT_NAME_COLUMNS =
  'id, primary_first_name, primary_surname, secondary_first_name, secondary_surname';

/** What `CLIENT_NAME_COLUMNS` returns. Every field is nullable in the table. */
export interface ClientNameRow {
  primary_first_name?: string | null;
  primary_surname?: string | null;
  secondary_first_name?: string | null;
  secondary_surname?: string | null;
}

/**
 * Cased for print.
 *
 * The rule is the one `smartCapitalize` uses on the client: a name that is
 * already mixed case is left alone, and one that is all upper or all lower is
 * title-cased. Someone entered "JOHN SMITH" into a form, and the cover of their
 * report should not shout.
 */
export function smartCapitalize(raw: string): string {
  const name = (raw || '').trim();
  if (!name) return '';
  if (name !== name.toLowerCase() && name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s\-'])(\w)/g, (_m, lead: string, ch: string) => lead + ch.toUpperCase());
}

/**
 * The name to print, or `''` when the row carries none.
 *
 * Returning empty rather than a placeholder is deliberate: a caller that needs
 * "Client" on the cover can say so, and one that would rather omit the line
 * entirely — the Cash Flow cover does — can do that instead.
 */
export function clientDisplayName(row: ClientNameRow | null | undefined): string {
  if (!row) return '';
  const join = (first: unknown, last: unknown) =>
    [first, last].filter((p) => typeof p === 'string' && p.trim()).join(' ').trim();

  const primary = join(row.primary_first_name, row.primary_surname);
  if (primary) return smartCapitalize(primary);

  return smartCapitalize(join(row.secondary_first_name, row.secondary_surname));
}
