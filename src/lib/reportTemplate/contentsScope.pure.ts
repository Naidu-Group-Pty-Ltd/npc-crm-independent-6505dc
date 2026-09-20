/**
 * A contents list names what a reader would turn TO.
 *
 * Page 2 of the Investment Compass issued for 97 Poole Road, Kellyville on
 * 20 Sep 2026 opened its twenty-two-row contents with:
 *
 * ```
 * 1. Cover                                              1
 * 2. Contents                                           2
 * 3. Executive dashboard                                3
 * ```
 *
 * The first row points at the sheet before this one; the second points at the
 * sheet the reader is holding. Neither is somewhere to turn, and a contents
 * entry whose destination is the contents is a link to itself — which is also
 * two of the twenty-two rows on a page that `fitTocEntries` can be forced to
 * truncate, so they are not free.
 *
 * `renderTocHtml`'s filter kept both by construction: a page with no narrative
 * section on it is listed unless it declares `tocContinues`, and page 0 was
 * FORCED in by an `i === 0` clause that bypassed even that.
 *
 * ## The rule
 *
 * **The front matter of a list is not an entry in it.** Two pages are dropped,
 * and both are identified structurally rather than by their names — a master
 * may call its cover anything, and matching on the word "Contents" would drop
 * a report section that happens to be called that.
 *
 *  - **The page the list is printed on**, which the renderer already knows as
 *    `ctx.pageIndex`.
 *  - **The cover**, which is page 0 — but only where the list is not itself on
 *    page 0, because a format that opens with its contents has no cover to
 *    drop.
 *
 * ## Two things it will not do
 *
 * **It never drops a page that opens a section.** If a master ever draws
 * narrative on its cover, that page is content and is listed; the caller
 * passes `opensSection` so this cannot be decided from a page's furniture
 * alone.
 *
 * **It never empties the list.** A one-page document, or any arrangement where
 * these rules would take the list to nothing, keeps what it had — an empty
 * contents page reads as a broken render, which is worse than a row naming the
 * sheet it is on.
 */

export interface ContentsScopeInput {
  /** Every candidate page index, in document order, as the filter found them. */
  readonly candidates: readonly number[];
  /** The index of the page the contents block is being drawn on. */
  readonly selfIndex: number;
  /** Whether a page index opens one of the report's own sections. */
  readonly opensSection: (pageIndex: number) => boolean;
}

export interface ContentsScopeResult {
  /** The indices that remain, in the order given. */
  readonly listed: readonly number[];
  /** What was dropped and why — for a test, and for nothing else. */
  readonly dropped: ReadonlyArray<{ pageIndex: number; reason: 'self' | 'cover' }>;
}

/**
 * Drop the list's own page and the cover from a set of contents candidates.
 *
 * Returns the input unchanged, and an empty `dropped`, wherever neither rule
 * applies or applying them would leave nothing to print.
 */
export function scopeContentsEntries(input: ContentsScopeInput): ContentsScopeResult {
  const { candidates, selfIndex, opensSection } = input;
  if (candidates.length === 0) return { listed: candidates, dropped: [] };

  const dropped: Array<{ pageIndex: number; reason: 'self' | 'cover' }> = [];
  const listed = candidates.filter((i) => {
    // Content is listed whatever sheet it is on.
    if (opensSection(i)) return true;
    if (i === selfIndex) { dropped.push({ pageIndex: i, reason: 'self' }); return false; }
    // A list printed on page 0 has no cover before it to drop.
    if (i === 0 && selfIndex !== 0) { dropped.push({ pageIndex: i, reason: 'cover' }); return false; }
    return true;
  });

  // An empty contents page reads as a broken render.
  if (listed.length === 0) return { listed: candidates, dropped: [] };
  return { listed, dropped };
}
