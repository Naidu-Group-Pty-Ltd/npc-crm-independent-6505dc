/**
 * Read a whole result set past PostgREST's `max_rows`.
 *
 * ## Why this is a module rather than a `.limit()`
 *
 * PostgREST answers at most `max_rows` rows (1,000 on these projects) and says
 * NOTHING about having truncated: the response is a 200 with a short array,
 * which is indistinguishable from a table that really holds that many. Every
 * unbounded `.select()` in this repository is therefore silently capped, and
 * the ones that matter are the ones whose answer is used as a COMPLETE set.
 *
 * Two in the GoHighLevel import were exactly that, and each fails in its own
 * direction:
 *
 *   `sync-ghl-conversations` read every client with a contact id as one
 *   select and then paged THAT array with a cursor. At 1,001 clients the
 *   1,001st is invisible to the bulk import for ever, and `total_contacts`
 *   reports a number that is not the total.
 *
 *   The held-message set is worse, because a truncated one is worse than none
 *   at all. The conversation pager stops walking when a whole page is already
 *   held; handed the newest 1,000 of a 3,000-message thread, page one is held,
 *   the walk stops, and the 2,000 below are never reached — or, if the
 *   truncation lands mid-page, the walk runs to the bottom of the thread on
 *   every tick for ever. The no-op proof inverts into a spin.
 *
 * ## Two rules
 *
 * **A read that FAILED is not a set that is EMPTY.** `failed` is carried
 * separately from `rows`, because every caller here would otherwise take the
 * empty array as a fact about the table — the same collapse `CaseRead` exists
 * to prevent.
 *
 * **A cap is reported, never silent.** `truncated` is true only when the
 * ceiling was actually reached, and a caller decides what that means: the
 * bootstrap sweep proceeds and logs, the held-message set refuses outright.
 *
 * Pure: no imports and no Supabase types. The caller supplies a function that
 * runs one page, which is also what makes it testable without a client.
 */

/** One PostgREST page. Matches the project's `max_rows`. */
export const SCAN_PAGE = 1000;

/** 25 pages — 25,000 rows. Reaching it is reported as `truncated`. */
export const MAX_SCAN_PAGES = 25;

export interface PagedRead<T> {
  readonly rows: T[];
  /** The page ceiling was reached and there may be more. */
  readonly truncated: boolean;
  /** Non-null when a page errored. `rows` then holds whatever arrived before it. */
  readonly failed: string | null;
}

/**
 * @param page   runs one page; `from`/`to` are inclusive, for `.range(from, to)`
 * @param maxPages  ceiling, in pages. Defaults to `MAX_SCAN_PAGES`.
 */
export async function pageAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  maxPages: number = MAX_SCAN_PAGES,
): Promise<PagedRead<T>> {
  const cap = Math.max(1, Math.floor(maxPages));
  const rows: T[] = [];
  for (let i = 0; i < cap; i++) {
    const from = i * SCAN_PAGE;
    const { data, error } = await page(from, from + SCAN_PAGE - 1);
    if (error) return { rows, truncated: false, failed: error.message };
    const batch = data ?? [];
    rows.push(...batch);
    // A short page is the end of the set. Only a FULL page at the ceiling is
    // evidence of truncation, which is why the test is here and not after the
    // loop alone.
    if (batch.length < SCAN_PAGE) return { rows, truncated: false, failed: null };
  }
  return { rows, truncated: true, failed: null };
}
