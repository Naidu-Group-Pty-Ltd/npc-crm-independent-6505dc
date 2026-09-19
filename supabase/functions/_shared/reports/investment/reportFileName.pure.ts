/**
 * The name a client's Investment-family document is downloaded under.
 *
 * It was `<reportId>_<suburb>_<state>_<epoch>.pdf` — a uuid, a "suburb" the
 * address parser had taken from the street line, and a millisecond clock —
 * so the five documents generated for 291 Stone Mason Drive on 15 Sep 2026
 * arrived as `9edb63bd-…_291_STONE_MASON_DRIVE_NSW_1789434458098.pdf`, and
 * the operator had to prefix each one by hand to tell a Financial Analysis
 * from a Briefing (QA-32 records the collision that followed). Every other
 * format already names its file `<Kind>_<Subject>_<YYYY-MM-DD>.pdf`
 * (`route.pure.ts` in each format's folder); this is the Investment family's
 * version of that one rule, and the tier word comes from `DOCUMENT_IDENTITY`
 * so the file is called what its cover says.
 *
 * Deno-compatible: no `@/` aliases, explicit `.ts` extensions.
 */

import { documentTitleForTier } from './tierIdentity.pure.ts';

/** `[^a-zA-Z0-9]` → `_`, runs collapsed, ends trimmed — the rule every format's `route.pure.ts` applies. */
export function fileSafeSegment(value: string, max = 80): string {
  return String(value ?? '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max)
    .replace(/_+$/g, '');
}

/** `YYYY-MM-DD` of the given instant, in UTC. The clock is the caller's: a pure module reads none. */
export function isoDateStamp(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export interface InvestmentFileNameInput {
  /** `compass` | `financial` | `strategic` | `snapshot` | `briefing` — any alias resolves to compass. */
  tier: string | null | undefined;
  /** The property address as the record holds it. */
  address: string | null | undefined;
  /** The instant of the download, passed in by the caller. */
  at: Date;
  /** Appended before `.pdf` when present — `flattened`, a version, a variant. */
  suffix?: string;
}

/**
 * `Due_Diligence_Report_291_Stone_Mason_Drive_Kellyville_NSW_2155_2026-09-15.pdf`
 *
 * Kind first, so a folder sorts by document; address whole, so the street is
 * not mistaken for the suburb; the date last, so two revisions of the same
 * property can be told apart. No identifier a client could not read.
 */
export function investmentReportFileName(input: InvestmentFileNameInput): string {
  const kind = fileSafeSegment(documentTitleForTier(input.tier), 40) || 'Investment_Report';
  const address = fileSafeSegment(input.address ?? '', 80) || 'Property';
  const suffix = input.suffix ? `_${fileSafeSegment(input.suffix, 24)}` : '';
  return `${kind}_${address}_${isoDateStamp(input.at)}${suffix}.pdf`;
}
