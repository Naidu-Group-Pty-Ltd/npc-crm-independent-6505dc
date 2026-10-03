/**
 * The name a client's Investment-family document is downloaded under.
 *
 * It was `<reportId>_<suburb>_<state>_<epoch>.pdf` — a uuid, a "suburb" the
 * address parser had taken from the street line, and a millisecond clock —
 * so the five documents generated for 291 Stone Mason Drive on 15 Sep 2026
 * arrived as `9edb63bd-…_291_STONE_MASON_DRIVE_NSW_1789434458098.pdf`, and
 * the operator had to prefix each one by hand to tell a Financial Analysis
 * from a Briefing (QA-32 records the collision that followed). The tier word
 * comes from `DOCUMENT_IDENTITY`, so the file is called what its cover says.
 *
 * Since Audit 6 (1 Oct 2026) it is the same readable name every other format
 * writes (`readableFileName.pure.ts`): `Investment Compass - 18 Annabelle
 * Crescent, Kellyville NSW 2155 - 1 Oct 2026.pdf`. The underscored machine
 * form it replaces is what a person found in a downloads folder beside a
 * Portfolio Performance Review named in words. A storage key is a different
 * thing and keeps to URL-safe characters (`storageSafeFileName`).
 *
 * Deno-compatible: no `@/` aliases, explicit `.ts` extensions.
 */

import { readableFileName } from '../readableFileName.pure.ts';
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
  /** What this copy is, beside the document's name — `flattened`, `Version 2`. */
  suffix?: string;
}

/**
 * `Due Diligence Report - 291 Stone Mason Drive, Kellyville NSW 2155 - 15 Sep 2026.pdf`
 *
 * Kind first, so a folder sorts by document; the address whole, so the
 * street is not mistaken for the suburb; the date last, so two revisions of
 * the same property can be told apart. No identifier a client could not
 * read, and no placeholder where the record holds no address.
 */
export function investmentReportFileName(input: InvestmentFileNameInput): string {
  return readableFileName({
    name: documentTitleForTier(input.tier),
    qualifier: input.suffix ?? null,
    topic: input.address ?? '',
    isoDate: isoDateStamp(input.at),
  });
}
