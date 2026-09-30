import type { PdfOutlineEntry } from '@/components/reports/PdfPageStack';

/** A printed section, placed on the page — and the point down it — where it starts. */
export interface SectionPlace {
  title: string;
  /** Its place in the document's section list, from 0. */
  index: number;
  /** 1-based, or null where the document carries no bookmark for it. */
  page: number | null;
  /** How far down its page it starts (0–1), or null where the bookmark does not say. */
  top: number | null;
  /** The bookmark it was placed by, in the document's outline. */
  outlineIndex: number | null;
}

/**
 * A section starting this near a page's top has the page to itself: above it
 * is the margin and the running head, not the end of the section before.
 */
export const TOP_BAND = 0.2;

/** A title as the outline and the section list both carry it. */
const titleKey = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The route's section list, placed by the document's own bookmarks.
 *
 * Matched in order, so a title the document uses twice ("Notes") is placed at
 * its own occurrence rather than both at the first; a section the bookmarks
 * do not name has no page, and is never guessed onto one.
 */
export function placeSections(
  sections: readonly string[],
  outline: readonly PdfOutlineEntry[],
): SectionPlace[] {
  const used = new Set<number>();
  let from = 0;
  return sections.map((title, index) => {
    const key = titleKey(title);
    let at = outline.findIndex((o, i) => i >= from && !used.has(i) && titleKey(o.title) === key);
    if (at < 0) at = outline.findIndex((o, i) => !used.has(i) && titleKey(o.title) === key);
    if (at < 0) return { title, index, page: null, top: null, outlineIndex: null };
    used.add(at);
    from = at + 1;
    return { title, index, page: outline[at].page, top: outline[at].top, outlineIndex: at };
  });
}

/**
 * The sections a page carries, in reading order: whatever runs on from an
 * earlier page — unless something starts in the page's top band — then every
 * section that starts on it.
 *
 * Every bookmark ends what came before it, the contents page and the closing
 * page included, so the page after the last section is nobody's section. And
 * a page whose top is the end of one section and whose middle opens the next
 * belongs to both: naming only the one that starts there sends the person to
 * the wrong words for the table at the top of the page.
 */
export function sectionsOnPage(
  places: readonly SectionPlace[],
  outline: readonly PdfOutlineEntry[],
  page: number,
): SectionPlace[] {
  const byOutline = new Map<number, SectionPlace>();
  for (const place of places) if (place.outlineIndex !== null) byOutline.set(place.outlineIndex, place);
  const marks = outline.map((o, i) => ({ page: o.page, top: o.top, place: byOutline.get(i) ?? null }));

  const starting = marks.filter((m) => m.page === page);
  const earlier = marks.filter((m) => m.page < page);
  const runningOn = earlier.length ? earlier[earlier.length - 1] : null;
  const first = starting[0];
  const ownsTop = first !== undefined && first.top !== null && first.top <= TOP_BAND;
  return [...(runningOn && !ownsTop ? [runningOn] : []), ...starting]
    .map((m) => m.place)
    .filter((p): p is SectionPlace => p !== null);
}
