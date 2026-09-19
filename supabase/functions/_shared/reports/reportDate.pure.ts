/**
 * Every date this product prints, formatted in one place.
 *
 * ## What this replaces
 *
 * Twelve copies of the same eight lines. Eleven of the render routes carried a
 * private `MONTHS` table and a private reader of it, under three names for one
 * function — `formatReportDate` in eight of them, `formatAssessedOn` in
 * Borrowing Capacity, `formatPreparedOn` in the two Cash Flow routes — plus
 * `shortDate`, which is the same again with the month clipped to three letters.
 * The template renderer then grew a twelfth in `bindingResolver.ts`.
 *
 * They did not all agree, and the disagreement was invisible because no two of
 * them were ever read side by side. The flowing routes print `16 August 2026`;
 * the template renderer's `| date` filter printed `16 Aug 2026`. One report can
 * be drawn by either engine, so the same document dated itself two ways
 * depending on which path produced it. Both spellings stay — they are a style,
 * and the masters are typeset around the short one — but they are now two
 * arguments to one function rather than two implementations that drifted.
 *
 * ## Why the string is read and never parsed
 *
 * Three reasons, and the third is the one that was actually costing something:
 *
 * 1. **Purity.** These modules run inside Edge Functions and are imported by
 *    the browser; they take no ambient input, and a clock is ambient input.
 * 2. **ICU.** `toLocaleDateString` depends on the runtime's ICU build, so the
 *    same payload would date itself differently in Deno and in Node.
 * 3. **The timezone.** `new Date('2016-02-14')` is midnight **UTC**, and
 *    `toLocaleDateString` renders it in the runtime's zone — so a client's
 *    move-in date printed as *13 Feb 2016* on every render west of UTC, and
 *    `2026-08-16T08:58:56Z` printed as *15 Aug* in Honolulu. Template documents
 *    are typeset in the operator's browser, so that zone is whoever happens to
 *    be at the keyboard. The date on a client's page is not theirs to move.
 *
 * ## Two readers, on purpose
 *
 * `formatReportDate` and its siblings match an ISO **prefix**: they are given a
 * column value and asked to date a document with it, and they answer for
 * anything that starts with a calendar date. That is their behaviour today and
 * it is preserved exactly.
 *
 * `formatIsoDate` requires the **whole** value to be a bare ISO date, and
 * returns `null` otherwise. It backs a different question — "is this bound
 * value a machine timestamp that should not reach a page?" — where a prefix
 * match would rewrite `2026-08-16 (estimated)` into a date and lose the
 * qualifier, and where prose that merely opens with a date is still prose.
 */

export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * `short`   `16 Aug 2026`     — the template renderer's `| date` default
 * `long`    `16 August 2026`  — what every flowing render route prints
 * `numeric` `16/08/2026`
 * `iso`     `2026-08-16`      — the machine form, when a caller asks for it
 */
export type ReportDateStyle = 'short' | 'long' | 'numeric' | 'iso';

/** A value that BEGINS with a calendar date. */
const ISO_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/** A value that is ENTIRELY a calendar date, optionally with a time. */
const ISO_WHOLE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function assemble(
  year: string,
  month: string,
  day: string,
  style: ReportDateStyle,
): string | null {
  const index = Number(month) - 1;
  if (index < 0 || index > 11) return null;
  if (style === 'iso') return `${year}-${month}-${day}`;
  if (style === 'numeric') return `${day}/${month}/${year}`;
  const name = style === 'long' ? MONTHS_LONG[index] : MONTHS_SHORT[index];
  return `${day} ${name} ${year}`;
}

/** Whether a value is entirely a bare ISO date or date-time, and nothing else. */
export function isIsoDateValue(value: unknown): boolean {
  return typeof value === 'string' && ISO_WHOLE.test(value.trim());
}

/**
 * A bare ISO date as a reader should see it, or `null` when it is not one.
 *
 * Strict: the whole value must be the date. A caller that holds a column value
 * and simply wants it dated wants `formatReportDate` instead.
 */
export function formatIsoDate(value: string, style: ReportDateStyle = 'short'): string | null {
  const m = ISO_WHOLE.exec((value ?? '').trim());
  return m ? assemble(m[1], m[2], m[3], style) : null;
}

/**
 * `2026-08-02T…` → `02 August 2026`; `''` when there is no date to read.
 *
 * The flowing render routes' formatter, unchanged: an ISO prefix, the long
 * month, and the empty string rather than a guess. An empty date is a gap on
 * the page, which is the honest rendering of a column that holds nothing.
 */
export function formatReportDate(iso: string): string {
  const m = ISO_PREFIX.exec(iso ?? '');
  return (m && assemble(m[1], m[2], m[3], 'long')) || '';
}

/**
 * `2026-04-22` → `22 Apr 2026`. Short, for a timeline column.
 *
 * Hands the input back rather than an empty string when it cannot be read: a
 * timeline row already carries whatever the source called the date, and losing
 * it would leave the row anchored to nothing.
 */
export function formatReportDateShort(iso: string): string {
  const m = ISO_PREFIX.exec(iso ?? '');
  return (m && assemble(m[1], m[2], m[3], 'short')) || (iso ?? '');
}
