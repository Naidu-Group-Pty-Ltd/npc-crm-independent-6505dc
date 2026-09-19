/**
 * The one place a report tier is translated into words.
 *
 * The cover eyebrow, the running head, the standard presentation's title, the
 * PDF metadata and the download name all read from here, so a Financial
 * Analysis cannot be titled "Investment Compass" on one surface and
 * "Financial Analysis" on another (§17 of the audit record), and the Due
 * Diligence Report cannot come out as "Snapshot Report" from one renderer and
 * "Strategic Overview" from the other (QA-32, 15 Sep 2026).
 *
 * `strategic` is the stored value and the alias; the words are locked
 * decision B of `docs/reports/TIER_FRAMEWORK.md`. An unrecognised tier reads
 * as the Compass, the ranking's default document.
 *
 * Deno-compatible: no imports.
 */

export const DOCUMENT_IDENTITY: Record<string, { title: string; standfirst: string }> = {
  compass: {
    title: 'Investment Compass',
    standfirst: 'What the property is, what it costs to hold, and what the assessment concluded.',
  },
  financial: {
    title: 'Financial Analysis',
    standfirst: 'What it costs to buy and hold, what it returns, and how the position moves over ten years.',
  },
  snapshot: {
    title: 'Snapshot Report',
    standfirst: 'The numbers that matter and a short assessment.',
  },
  briefing: {
    title: 'Executive Briefing',
    standfirst: 'The assessment, condensed for a decision.',
  },
  strategic: {
    title: 'Due Diligence Report',
    standfirst: 'What must be verified before contract: the property and location risks at depth, and the verification register.',
  },
};

/** The tier's document title, for every surface that writes one — the cover, the running head, the file name. */
export function documentTitleForTier(tier: string | null | undefined): string {
  const key = String(tier ?? '').trim().toLowerCase();
  return (DOCUMENT_IDENTITY[key] ?? DOCUMENT_IDENTITY.compass).title;
}
