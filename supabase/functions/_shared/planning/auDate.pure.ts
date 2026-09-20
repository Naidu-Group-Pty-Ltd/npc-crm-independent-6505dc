/**
 * The one date format a planning reading shows a reader.
 *
 * Page 32 of the Investment Compass issued for 97 Poole Road, Kellyville on
 * 20 Sep 2026 printed, in prose:
 *
 * > Under The Hills Local Environmental Plan 2019, **as read on 2026-09-20**, a
 * > dwelling house is permitted with development consent on this land.
 *
 * while every table on the same page and the two either side of it said
 * `7 Aug 2026` and `20 Sep 2026`. One document, two date formats, and the
 * machine-readable one in the sentence a client reads.
 *
 * `instrumentAnchor` built its date with `retrievedAt.slice(0, 10)` — an ISO
 * prefix, which is the right thing to STORE and never the right thing to
 * print — while `planningFacts` and `infrastructureEvidence` each carried a
 * private, byte-identical `auDate` that the tables went through. Two copies of
 * a rule and one place that had neither.
 *
 * This is `ONGOING_CDD_AND_REMINDERS.md`'s rule one level down: **a date a
 * reader sees is formatted for the reader, and the format is named in exactly
 * one place.** It is a pure string transform rather than
 * `toLocaleDateString` — deliberately, because the AML defect that rule came
 * from was a formatter taking the READER'S machine, and an edge function has
 * no reader's machine to take.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * `1 Jan 2026` from an ISO date, or the string back where it is not one.
 *
 * Returning the input unchanged is the conservative side: a publisher's own
 * wording for a period ("Q2 2026", "2025-26") is a fact, and reformatting what
 * this cannot parse would be inventing one.
 */
export function auDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${Number(m[3])} ${month} ${m[1]}`;
}
