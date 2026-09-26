/**
 * Where a composed block goes in the document.
 *
 * ## The defect this closes
 *
 * `generate-investment-report` finishes the model's sections, then does this:
 *
 *     reportContent += `\n\n---\n\n## Planning controls and development registers…`
 *     reportContent += `\n\n---\n\n${strategySectionsMarkdown}\n`
 *
 * Two blind concatenations onto the end. Measured on the Compass delivered for
 * 9 Hollow Street, Golden Square on 21 Sep 2026, the reader therefore reaches:
 *
 *     … 13. Final Recommendation
 *         14. Appendix, Source Notes & Disclaimer
 *         15. Planning controls and development registers
 *         16. Resale Liquidity & Exit Outlook
 *         17. SWOT Analysis
 *         18. Monitoring & Review Plan
 *
 * The document closes — recommendation, then appendix and disclaimer — and
 * then carries on for four more sections, two of which are substantive
 * analysis the recommendation above them should have been informed by.
 *
 * The registry is not what is wrong. It declares, for the Compass,
 * `exitOutlook` at order 13, `swot` at 15, `monitoring` at 18,
 * `recommendation` at 19 and `provenance` at **90** — deliberately last. Every
 * model-authored section in that document is in its declared position. Only
 * the three appended ones are displaced, and they are displaced by the
 * append.
 *
 * ## Why they are not simply composed earlier
 *
 * Because the late composition is correct and the generator says why: landing
 * after the post-processor is what stops a word cap trimming a row of
 * evidence, and every entry in these blocks carries the fact it rests on, so
 * trimming one removes a source rather than a flourish. The registers are
 * appended verbatim for the same reason the tables are — asking a model to
 * reproduce a table is how a table comes back paraphrased.
 *
 * So composition stays exactly where it is. What changes is that the block is
 * INSERTED at its declared order instead of concatenated at the end.
 *
 * ## Three rules
 *
 * **Nothing already in the document moves.** This only chooses an insertion
 * point; the existing sections keep their relative order exactly, because
 * re-sorting a document from a registry would reorder prose the model wrote
 * to read in sequence. A heading the registry does not recognise is passed
 * over as an insertion candidate rather than reordered or dropped.
 *
 * **A block with nowhere to go is appended, not lost.** If no later section is
 * found — a truncated document, an unrecognised set of headings — the block
 * lands where it lands today. The failure mode is the current behaviour, never
 * a missing section.
 *
 * **A block already present is not inserted again.** The caller composes these
 * from the record, so a second copy would be a duplicate of a register, which
 * is the defect `dedupeRegisterTables` exists to clean up after.
 */

import {
  type ReportTier,
  sectionIdForHeading,
  sectionsForTier,
} from './sectionRegistry.pure.ts';

export interface PlaceableBlock {
  /** The block's own H2 text, without the `## `. */
  readonly heading: string;
  /** The whole block, beginning with its own `## <heading>` line. */
  readonly markdown: string;
  /**
   * The order to place it at, where the registry does not declare one.
   *
   * The planning/infrastructure register is the case: it is evidence appended
   * under a heading of its own rather than a section the registry declares, so
   * the caller states where it belongs.
   */
  readonly order?: number;
}

/** A document cut at its top-level headings, preamble first. */
interface Segment {
  /** The heading text, or null for the preamble before the first `## `. */
  readonly heading: string | null;
  readonly text: string;
  /** The registry's order for this heading, where it recognises it. */
  readonly order: number | null;
}

const H2 = /^##[ \t]+(.+?)[ \t]*$/;

/**
 * Cut the document at its `## ` headings.
 *
 * Only level two, because that is the level the Compass writes its sections
 * at and the level `markdownHeadingsForTier` names. An `H1` title and any
 * `###` sub-heading stay inside the segment they belong to, which is what
 * keeps a sub-heading from being read as a section boundary.
 */
function cut(document: string, orderOf: (heading: string) => number | null): Segment[] {
  const lines = String(document ?? '').split('\n');
  const segments: Segment[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (heading === null && buffer.join('').trim() === '' && segments.length === 0) {
      // A document that opens straight on a heading has no preamble to keep.
      buffer = [];
      return;
    }
    segments.push({ heading, text: buffer.join('\n'), order: heading === null ? null : orderOf(heading) });
    buffer = [];
  };

  for (const line of lines) {
    const m = H2.exec(line);
    if (m) {
      flush();
      heading = m[1];
      buffer = [line];
    } else {
      buffer.push(line);
    }
  }
  flush();
  return segments;
}

/** The registry's declared order for a heading in this tier, if it knows it. */
export function declaredOrderFor(heading: string, tier: ReportTier): number | null {
  const id = sectionIdForHeading(heading);
  if (!id) return null;
  const placed = sectionsForTier(tier).find((s) => s.id === id);
  return placed ? placed.order : null;
}

/**
 * Insert each block at its declared order, leaving everything else alone.
 *
 * Returns the document unchanged when there is nothing to place, so a caller
 * that composes no blocks — an area report — is byte-identical.
 */
export function placeBlocksByDeclaredOrder(
  document: string,
  blocks: ReadonlyArray<PlaceableBlock>,
  tier: ReportTier,
): string {
  const source = String(document ?? '');
  const wanted = (blocks ?? []).filter((b) => b && String(b.markdown ?? '').trim());
  if (!wanted.length) return source;

  const orderOf = (h: string) => declaredOrderFor(h, tier);
  const segments = cut(source, orderOf);
  if (!segments.length) return source;

  const present = new Set(
    segments
      .map((s) => (s.heading ? sectionIdForHeading(s.heading) ?? s.heading.toLowerCase() : null))
      .filter((x): x is string => !!x),
  );

  // Oldest order first, so two blocks landing before the same section keep
  // their own sequence rather than inverting it.
  const ordered = [...wanted]
    .map((b) => ({ block: b, order: b.order ?? orderOf(b.heading) }))
    .filter(({ block }) => {
      const key = sectionIdForHeading(block.heading) ?? block.heading.toLowerCase();
      return !present.has(key);
    })
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));

  if (!ordered.length) return source;

  const out = [...segments];
  for (const { block, order } of ordered) {
    const body = String(block.markdown).trim();
    const segment: Segment = { heading: block.heading, text: body, order: order ?? null };
    if (order === null) {
      out.push(segment);
      continue;
    }
    // The first section that the registry places AFTER this block. An
    // unrecognised heading is not a candidate: nothing can be said about where
    // it belongs, and guessing would move it.
    const at = out.findIndex((s) => s.order !== null && s.order > order);
    if (at === -1) out.push(segment);
    else out.splice(at, 0, segment);
  }

  return out
    .map((s) => s.text.replace(/\s+$/, ''))
    .filter((t) => t.trim() !== '')
    .join('\n\n');
}

/**
 * Evidence that belongs INSIDE a section the model wrote, rather than beside it.
 *
 * ## The defect this closes
 *
 * The retrieved planning and infrastructure registers were placed as a section
 * of their own at order 89 — after the Final Recommendation. Measured on the
 * Compass for 60 Lawley Street, Spalding on 25 Sep 2026: the planning chapter
 * on page 10 said *"Set out in full under 'Planning controls and development
 * registers'"* and the reader had to go to page 21, past the recommendation
 * that rests on it, to find the register the chapter was about. The
 * recommendation was no longer the last substantive thing in the document.
 *
 * The registry already knows where each half belongs: the controls are the
 * substance of `planning`, the project and development registers the substance
 * of `infrastructure`. So each half is appended to the END of the section it
 * belongs to, as a sub-section, where the prose that explains it already is.
 *
 * ## Rules
 *
 * **Appended, never interleaved.** The block lands after everything the model
 * wrote in that section, so no sentence is separated from the paragraph it
 * continues and nothing already in the document moves.
 *
 * **A section is found by what it IS, not how it is spelled** — through
 * `sectionIdForHeading`, the same resolution everything else uses.
 *
 * **Nowhere to go means the old behaviour, never a lost block.** Where the
 * section is absent (a truncated document, a heading the registry does not
 * recognise) the block's `fallback` is placed by declared order, exactly as
 * before this existed.
 *
 * **A block already present is not merged again.** Its own first heading is
 * the identity: a document that already carries it is returned unchanged.
 */
export interface MergeableBlock {
  /** The registry id of the section this block completes. */
  readonly into: string;
  /** The block, opening on its own sub-heading (`###` or deeper). */
  readonly markdown: string;
  /** Where that section is absent: placed as a section of its own, by order. */
  readonly fallback: PlaceableBlock;
}

const ANY_HEADING = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const headingKey = (text: string): string =>
  text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The text of a block's first heading, or null. */
function firstHeadingOf(markdown: string): string | null {
  for (const line of String(markdown ?? '').split('\n')) {
    const m = ANY_HEADING.exec(line.trim());
    if (m) return m[1];
  }
  return null;
}

export function mergeBlocksIntoSections(
  document: string,
  blocks: ReadonlyArray<MergeableBlock>,
  tier: ReportTier,
): string {
  const source = String(document ?? '');
  const wanted = (blocks ?? []).filter((b) => b && String(b.markdown ?? '').trim());
  if (!wanted.length) return source;

  const present = new Set(
    source.split('\n')
      .map((l) => ANY_HEADING.exec(l.trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => headingKey(m[1])),
  );

  const segments = cut(source, (h) => declaredOrderFor(h, tier));
  const merged = segments.map((s) => ({ ...s }));
  const unplaced: PlaceableBlock[] = [];
  let changed = false;

  for (const block of wanted) {
    const own = firstHeadingOf(block.markdown);
    if (own && present.has(headingKey(own))) continue;
    const at = merged.findIndex((s) => s.heading !== null && sectionIdForHeading(s.heading) === block.into);
    if (at === -1) {
      unplaced.push(block.fallback);
      continue;
    }
    const target = merged[at];
    merged[at] = { ...target, text: `${target.text.replace(/\s+$/, '')}\n\n${String(block.markdown).trim()}` };
    changed = true;
  }

  if (!changed) return unplaced.length ? placeBlocksByDeclaredOrder(source, unplaced, tier) : source;
  const joined = merged
    .map((s) => s.text.replace(/\s+$/, ''))
    .filter((t) => t.trim() !== '')
    .join('\n\n');
  return unplaced.length ? placeBlocksByDeclaredOrder(joined, unplaced, tier) : joined;
}

/**
 * The document's top-level headings, in the order a reader meets them.
 *
 * Exported because asserting a placement means reading the result rather than
 * trusting the function that produced it.
 */
export function headingSequence(document: string): string[] {
  return String(document ?? '')
    .split('\n')
    .map((l) => H2.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => m[1]);
}
