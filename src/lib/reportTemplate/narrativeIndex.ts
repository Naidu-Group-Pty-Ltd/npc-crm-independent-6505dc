/**
 * Which of the report's own sections landed on which rendered page.
 *
 * A contents list and a PDF outline both name parts of a document, and on the
 * template path they named PAGE ARCHETYPES: a real 36-page Investment Compass
 * listed *Cover · Contents · Executive dashboard · The assessment · Risk and
 * recommendation · The report · Sources and methodology · Important
 * information* — eight rows for a body of twenty-one sections, because the
 * twenty-nine narrative sheets fold into the one row named "The report".
 * Everything a reader opens a contents page to find was inside that row.
 *
 * The sections were there the whole time; nothing had read them. A
 * `markdown-block` packs its source into buckets and draws bucket `pageIndex`,
 * so the headings in THAT bucket are the sections that page opens — a mapping
 * only the renderer can make, because pagination and conditional content
 * decide it. The renderer computes it once and publishes it here; the contents
 * block renders it and the page's own outline entry stands down for it, so the
 * two surfaces cannot describe the document differently.
 *
 * The key is named in this one module because a literal at each end is how two
 * ends drift.
 */

/** Where the index is published on the render context's `data`. */
export const NARRATIVE_INDEX_KEY = '__narrativeIndex';

export interface NarrativeIndexSection {
  /** The heading's printed text. */
  label: string;
  /** The heading's own level, as `renderMarkdown` assigned it. */
  level: number;
  /** Index into `visiblePages` — the same index `renderPage` stamps as `id="tpl-page-N"`. */
  pageIndex: number;
  /** The heading's own element id, so a link lands on the section and not the sheet. */
  anchor: string;
}

export interface NarrativeIndex {
  /**
   * Every visible page the narrative draws on, opening a section or not.
   *
   * A sheet in the MIDDLE of a section is not a part of the document, so it
   * contributes no name of its own to either surface. Pages 25 to 28 of a real
   * Compass are the middle of the risk register, and they were announcing
   * themselves as "The report (20)" … "The report (23)".
   */
  narrativePages: number[];
  /** Document order: page by page, and within a page, bucket order. */
  sections: NarrativeIndexSection[];
}

/** The index a context carries, or an empty one — never null, so no caller branches. */
export function narrativeIndexFrom(data: unknown): NarrativeIndex {
  const raw = (data as Record<string, unknown> | undefined)?.[NARRATIVE_INDEX_KEY] as
    Partial<NarrativeIndex> | undefined;
  return {
    narrativePages: Array.isArray(raw?.narrativePages) ? raw!.narrativePages : [],
    sections: Array.isArray(raw?.sections) ? raw!.sections : [],
  };
}

/**
 * The heading level a contents list should name.
 *
 * Normally the run's own shallowest level: the Compass's narrative carries 18
 * `h2` sections and 26 `h3` subsections, and listing both is 51 rows on a page
 * fitting about 30 — `fitTocEntries` would then omit the tail, losing the END
 * of the document rather than its detail.
 *
 * **But the shallowest level is often not a section tier at all.** Measured
 * 18 September 2026 across the seven retained production fixtures, three
 * distinct shapes appear and two of them put title matter at the top:
 *
 * | shape | level 1 | level 2 | what level 1 holds |
 * | --- | --- | --- | --- |
 * | Compass | — | 17–29 | nothing; `h2` is the tier |
 * | Financial Analysis | 1 | 7–8 | the document's own title |
 * | Investment Report | 2 | 11 | `# NAIDU PROPERTY CONSULTING SERVICES` and `# Investment Report: <address>` |
 *
 * The third is the instructive one. Both of its `h1`s are masthead — the
 * issuer's name and the document's title — and they sit together at the top of
 * the body, so a nineteen-to-thirty-six page report listed **two** contents
 * rows, one of them the company name, while eleven real sections were
 * reachable only by turning pages.
 *
 * ## The rule
 *
 * **A level is a section tier only if its sections open more than one page.**
 * A contents entry exists to send a reader somewhere; a tier whose entries all
 * point at the same page sends them nowhere, whether it holds one heading or
 * five. So the list takes the shallowest level whose sections open at least
 * two distinct pages, and where no level does, the shallowest stands — a
 * document that never turns a page has one entry, which is correct.
 *
 * This subsumes the narrower rule it replaces (a level holding a single
 * section opens a single page, so it is skipped either way) and additionally
 * catches masthead, which that rule did not: measured, it moves the Financial
 * Analysis from 1 listed row to 7, the Investment Report from 2 to 11, and
 * leaves the Compass shape at exactly the level it already used.
 *
 * A master that wants more than one level still sets `sectionDepth`.
 */
export function listedSectionLevel(sections: readonly NarrativeIndexSection[]): number {
  if (!sections.length) return 0;
  const pagesByLevel = new Map<number, Set<number>>();
  for (const s of sections) {
    const seen = pagesByLevel.get(s.level);
    if (seen) seen.add(s.pageIndex);
    else pagesByLevel.set(s.level, new Set([s.pageIndex]));
  }
  const levels = [...pagesByLevel.keys()].sort((a, b) => a - b);
  for (const level of levels) if ((pagesByLevel.get(level)?.size ?? 0) > 1) return level;
  return levels[0];
}
