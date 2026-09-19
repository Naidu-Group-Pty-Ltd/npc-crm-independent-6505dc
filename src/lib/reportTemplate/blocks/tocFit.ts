/**
 * A contents list fits the page it is printed on.
 *
 * `renderTocHtml` drew one line per section from a fixed top with no notion of
 * where the page ends. A 43-page Market Intelligence document (RS-5c.5,
 * measured 14 Sep 2026) listed 41 sections: the list ran off the foot of the
 * contents page and WeasyPrint carried the overflow onto the next sheet, where
 * it was drawn UNDER that page's own blocks — invisible text the measurer read
 * as an illegible run and an overlap. A declared position is a promise the
 * renderer keeps only while the list is as short as the author assumed.
 *
 * The fit is decided once, here, and both renderers (the printed HTML and the
 * Builder's jsPDF preview) draw from the same answer, so the preview cannot
 * disagree with the document about how the contents are laid out. Nothing
 * here infers a continuation from a page's name — that is `tocContinues`, set
 * by the master — this only decides how the entries it is given are arranged.
 *
 * Three steps, in order, and only as far as needed: a second column; then a
 * proportional shrink of the line height and type down to a floor; then, if
 * the list still cannot fit, it is cut and the cut is SAID ("… and N more
 * sections"). Overflowing is never an option.
 */

export interface TocFitInput {
  /** How many entries want a line. */
  entries: number;
  /** Vertical room from the block's top to the foot reserve, in points. */
  availablePt: number;
  /** Room the title takes above the list, in points (0 when there is none). */
  titlePt: number;
  lineHeightPt: number;
  sizePt: number;
  /** The most the type may shrink. 0.8 keeps 11pt at 8.8pt, still legible in print. */
  minScale?: number;
}

export interface TocFit {
  columns: 1 | 2;
  lineHeightPt: number;
  sizePt: number;
  /** How many entries are drawn; the rest are folded into one closing line. */
  shown: number;
  omitted: number;
  /** The scale applied to the line height and type (1 = as authored). */
  scale: number;
}

export function fitTocEntries(input: TocFitInput): TocFit {
  const minScale = input.minScale ?? 0.8;
  const room = Math.max(0, input.availablePt - input.titlePt);
  const perColumn = (lh: number) => Math.max(1, Math.floor(room / lh));
  const asIs: TocFit = {
    columns: 1, lineHeightPt: input.lineHeightPt, sizePt: input.sizePt,
    shown: input.entries, omitted: 0, scale: 1,
  };
  if (input.entries <= perColumn(input.lineHeightPt)) return asIs;

  // A second column doubles the room before anything gets smaller.
  if (input.entries <= 2 * perColumn(input.lineHeightPt)) return { ...asIs, columns: 2 };

  // Shrink both columns together, no further than the floor.
  const needed = Math.ceil(input.entries / 2) * input.lineHeightPt;
  const scale = Math.max(minScale, Math.min(1, room / needed));
  const lh = input.lineHeightPt * scale;
  const size = input.sizePt * scale;
  const capacity = 2 * perColumn(lh);
  if (input.entries <= capacity) {
    return { columns: 2, lineHeightPt: lh, sizePt: size, shown: input.entries, omitted: 0, scale };
  }

  // Still too many: keep one line for saying so.
  const shown = Math.max(1, capacity - 1);
  return { columns: 2, lineHeightPt: lh, sizePt: size, shown, omitted: input.entries - shown, scale };
}

/** Split entries across the fitted columns, first column fuller when odd. */
export function splitTocColumns<T>(entries: T[], columns: 1 | 2): T[][] {
  if (columns === 1) return [entries];
  const half = Math.ceil(entries.length / 2);
  return [entries.slice(0, half), entries.slice(half)];
}

/** The closing line for a list that was cut. */
export function tocOmittedLine(omitted: number): string {
  return `… and ${omitted} more ${omitted === 1 ? 'section' : 'sections'}`;
}
