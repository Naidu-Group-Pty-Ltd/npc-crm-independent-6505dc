/**
 * The chapter a page is in, for the running head at the top of it.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * The Compass body is one flowing Markdown stream across up to forty template
 * pages, so the master gave every one of them the same furniture: an eyebrow
 * reading `As assessed`, a heading reading **The report**, and a running head
 * reading **Part 03 · Report**. On the Cowra document that is the same three
 * words at the top of twenty-odd consecutive pages, over a body that moves
 * from the executive verdict to demand drivers to planning controls to the
 * risk register.
 *
 * A running head exists to tell a reader where they are. "Report" tells them
 * they are in the report, which they knew, and the heading "The report" over
 * the first page of the body is the same information a third time. It is the
 * one piece of furniture on every page and it carried nothing.
 *
 * ── Where the answer comes from ──────────────────────────────────────────
 *
 * The narrative packer already knows: it returns the blocks that landed on
 * each page, and a heading block carries its own text. So the chapter in force
 * on a page is the last top-level heading at or before its first block, and it
 * is CARRIED FORWARD — a page of continuing prose belongs to the chapter that
 * opened before it, and printing nothing there would be worse than printing
 * "Report".
 *
 * Two things follow from that, and both are why this is a module rather than
 * four lines inline. **It has to be computed at the same geometry that decides
 * the page breaks**, or the head names the chapter the page would have been in
 * under a different template — which is `narrativePlan`'s whole reason for
 * existing, applied to a second property of the same packing. And **the
 * projection's estimate and the renderer's truth must not drift**, so the
 * chapters travel by the same route the page count does: an estimate from the
 * projection, overwritten in one pass by the pre-pass that measures.
 *
 * ── What it will not do ──────────────────────────────────────────────────
 *
 * It never invents a title, never shortens one into something the document
 * does not say, and never numbers a chapter the document has not numbered.
 * Where a page has no heading before it anywhere — a body that opens with
 * prose — it falls back to the label the caller supplies, which is the
 * document's own name.
 *
 * Deno-compatible: siblings and `_shared` only, explicit `.ts` extensions.
 */
import type { MarkdownBlock } from './markdown.pure.ts';

/** The heading level a running chapter may come from. */
export const CHAPTER_LEVEL_MAX = 2;

/** Longest a running head may be before it is left to the fallback. */
export const CHAPTER_MAX_CHARS = 64;

/**
 * How many chapter slots the projection publishes.
 *
 * The Compass masters declare 40 conditional body pages, so the catalogue
 * binds `narrative.chapters.0` … `narrative.chapters.39`. A path bound by a
 * master and unresolvable against a real row is the defect
 * `reportBindingProjection.spec.ts` exists to catch — and its own history says
 * the answer is to stop binding an index the record cannot supply, or to give
 * the index a source. Here the second is right: a page past the body's end
 * never draws (its conditional is `narrative.pages > n`), so a slot for it
 * costs nothing and its value is the honest fallback a running head takes when
 * the chapter cannot be determined.
 *
 * The number is the masters', the same way `DEFAULT_LINES_PER_PAGE` is: stated
 * once here and read by both sides, because two copies of one allowance is how
 * a master grows a page the projection has no slot for.
 */
export const NARRATIVE_CHAPTER_SLOTS = 40;

function levelOf(block: MarkdownBlock): number {
  return Number(/^<h(\d)/.exec(block.html)?.[1] ?? 9);
}

/**
 * The heading's own words, with markup and entities resolved.
 *
 * Only the five entities `renderInlineMarkdown` can emit are decoded — a
 * general HTML entity decoder here would be a second, divergent implementation
 * of something the renderer already owns.
 */
export function headingText(block: MarkdownBlock): string {
  return block.html
    .replace(/^<h\d[^>]*>/, '')
    .replace(/<\/h\d>$/, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * One running-head title per packed page.
 *
 * `fallback` is used for a page before the first heading and for a heading too
 * long to set in a running head — never for a page that simply continues a
 * chapter, which takes the chapter it is continuing.
 */
export function runningChapters(
  pages: readonly (readonly MarkdownBlock[])[],
  fallback: string,
  /**
   * Pad to this many slots with the fallback, for the pages a master declares
   * and this body does not fill. Omitted, the answer is exactly one entry per
   * packed page.
   */
  slots?: number,
): string[] {
  const out: string[] = [];
  let current = '';
  for (const page of pages) {
    // The chapter in force when this page OPENS is what the running head must
    // say: a page that ends with a new heading belongs to the chapter it spent
    // its body in, not to the one starting in its last two lines.
    const opening = current;
    for (const block of page) {
      if (block.kind !== 'heading') continue;
      if (levelOf(block) > CHAPTER_LEVEL_MAX) continue;
      const text = headingText(block);
      if (text) current = text;
    }
    const chosen = opening || current;
    out.push(chosen && chosen.length <= CHAPTER_MAX_CHARS ? chosen : fallback);
  }
  while (slots !== undefined && out.length < slots) out.push(fallback);
  return out;
}
