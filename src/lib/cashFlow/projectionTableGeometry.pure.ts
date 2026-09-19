/**
 * Column geometry for the 10-Year Projection Overview table.
 *
 * The table has twelve columns — a label, "Today", and Years 1-10 — and it
 * could never show the last of them. It declared `min-w-[1280px]`, but the
 * floor that actually bound it was the sum of its own column minimums:
 * a 220px label, a 105px `Today` head, and ten year columns that each
 * resolved to 120px, for 1525px of table. Measured against the real page,
 * the widest scrollport this workspace can ever offer is 1474px — the
 * dashboard shell caps content at 1600px and the padding between there and
 * the table costs 122px more — so Year 10 was cut off on EVERY monitor,
 * a 2560px one included. That is what the report describes.
 *
 * Two things made the columns 120px wide, and neither was the numbers:
 *
 *   • `TableCell`'s base is `px-3 py-2.5 sm:p-4`, so every cell carries 16px
 *     of padding a side from 640px up — 32px per column, 352px across the
 *     eleven year columns. The editable cells were written `p-1` intending
 *     4px, but `p-1` and `sm:p-4` are different modifiers, so tailwind-merge
 *     keeps both and the media-query rule wins in the cascade. The author's
 *     4px had never once applied. Overriding it needs the SAME key at the
 *     SAME modifier — `sm:p-*` — which is why these strings look redundant.
 *
 *   • The editable control declared `min-w-[88px]`, which with that padding
 *     is exactly the 120px the column measured.
 *
 * The widest thing a year column has to hold is a plain `1,034,829` at
 * `text-sm`, which measures 72px; the editable control's `text-xs` values
 * top out at 62px, needing 62 + 8 (p-1) + 16 (its own px-2) + 2 (border) =
 * 88px. So 88px is the floor for both, and `PROJECTION_TABLE_MIN_WIDTH` is
 * 220 + 11 x 88.
 *
 * Above that floor the table is `w-full table-fixed`: the label column takes
 * its declared width and the eleven year columns divide the remainder
 * equally, so the table is exactly as wide as the space it is given and
 * nothing can hang off the right edge. Below it the wrapper still scrolls,
 * which is what keeps the workspace usable on a tablet or a phone — the
 * floor is 1188px rather than 1525px, so far less is ever hidden.
 *
 * `table-fixed` also changes the failure mode for the better: a value wider
 * than its column wraps onto a second line instead of being clipped, so an
 * unusually large figure is still readable rather than silently truncated.
 */

/** Width of the sticky label column. Its longest label, "After-Tax Cash Flow p/w $", measures 178px and the cell adds 32px of padding. */
export const PROJECTION_LABEL_COL_WIDTH = 220;

/** The narrowest a year column can be and still hold the widest figure on one line. */
export const PROJECTION_YEAR_COL_MIN_WIDTH = 88;

/** "Today" plus Years 1-10. */
export const PROJECTION_YEAR_COL_COUNT = 11;

/** The width below which the table scrolls instead of shrinking. */
export const PROJECTION_TABLE_MIN_WIDTH =
  PROJECTION_LABEL_COL_WIDTH + PROJECTION_YEAR_COL_COUNT * PROJECTION_YEAR_COL_MIN_WIDTH;

/**
 * The table itself. `w-full` comes from the `Table` primitive; `table-fixed`
 * is what makes the year columns divide the container rather than demand a
 * width of their own.
 *
 * It is `md:` and not unconditional, and that is load-bearing. Under 768px
 * the `Table` primitive's own wrapper carries
 * `.responsive-table-scroll > table { min-width: 560px }`, whose specificity
 * (0,1,1) beats a utility class (0,1,0) — so on a phone the floor below is
 * displaced by 560px. Automatic layout shrugs that off, because the content
 * pushes the table out to its natural width regardless; FIXED layout obeys
 * it exactly, and eleven columns then divide 340px into 31px each and every
 * figure in the table wraps onto two lines. Measured at 390px: 210 wrapped
 * cells and a table 840px taller. Above 768px that rule is out of the media
 * query's range and the floor applies cleanly, so the two never meet.
 */
export const PROJECTION_TABLE_CLASS =
  'md:table-fixed min-w-[1188px] border-separate border-spacing-0 text-sm';

/**
 * The heads carry a declared width AND a minimum, because the two layout
 * modes read different properties and the table uses both.
 *
 * Fixed layout (>=768px) takes each column's width from the `width` of the
 * first row's cell and ignores `min-width` entirely, so `w-[220px]` is what
 * sizes the label column and the year columns divide what is left.
 * Automatic layout (<768px) does the opposite: `width` is a suggestion it
 * will squeeze past, `min-width` is a floor it will not. Declaring only the
 * width collapsed the label column to 90px on a phone and wrapped 143 cells,
 * two of the labels onto three lines; declaring only the minimum is what the
 * table did before, and it could never show Year 10. Both, and each mode
 * reads the one it honours.
 */
export const PROJECTION_LABEL_HEAD_CLASS =
  'sticky left-0 z-30 w-[220px] min-w-[220px] bg-card dark:bg-background text-foreground dark:text-white shadow-[6px_0_12px_-12px_rgba(15,23,42,0.7)]';

/** A year column's head. Its minimum is the phone floor; above 768px the eleven divide what is left. */
export const PROJECTION_YEAR_HEAD_CLASS =
  'min-w-[88px] px-2 sm:px-2 bg-card dark:bg-background text-center text-foreground dark:text-white';

/** A year cell holding a read-only figure. `sm:p-2` is what displaces the primitive's `sm:p-4`. */
export const PROJECTION_YEAR_CELL_CLASS = 'px-2 py-2.5 sm:p-2 sm:py-3 text-center';

/** A year cell holding the editable control. `sm:p-1` is the half of `p-1` that was missing. */
export const PROJECTION_YEAR_EDIT_CELL_CLASS = 'p-1 sm:p-1 text-center align-middle';

/**
 * The frozen rail, in the rows the audit said still moved.
 *
 * "The entire left section should be frozen and not move" (audit item 2) had a
 * first fix and a survivor. The first fix pinned each section heading as a
 * sticky inline-block inside a `colSpan={12}` cell — which does hold the TEXT
 * still, but leaves those rows with no frozen CELL at all, and it left the two
 * highlighted total rows untouched. Their sticky cells were `bg-primary/10`,
 * and a TRANSLUCENT sticky cell does not occlude what scrolls beneath it: the
 * year figures slid under "After-Tax Cash Flow p/a $" and showed through the
 * tint, which on the dark theme is exactly "the sections highlighted in dark
 * blue move while the rows beside them are frozen".
 *
 * So the rule these classes carry: **a sticky cell is opaque, and the tint is
 * an inner layer.** The cell paints `bg-background` (what every ordinary data
 * row's frozen cell already paints, proven in the production screenshot) and
 * zeroes its own padding; a full-bleed inner div carries the band colour and
 * the padding, so the rail is a continuous, opaque 220px column from the
 * header to the last row and the banded rows read as banded without leaking.
 *
 * The inner paddings mirror what each row's neighbours produce: the section
 * heading keeps its original `px-4 py-3 text-xs`, and the total label mirrors
 * the `TableCell` primitive's own `px-3 py-2.5 sm:p-4` so the row stays the
 * height it always was.
 */
export const PROJECTION_STICKY_CELL_SHADOW =
  'shadow-[6px_0_12px_-12px_rgba(15,23,42,0.45)]';

/** A section-heading row's frozen cell: opaque base, zero padding, rail shadow. */
export const PROJECTION_SECTION_LABEL_CELL_CLASS =
  `sticky left-0 z-10 w-[220px] min-w-[220px] bg-background p-0 sm:p-0 ${PROJECTION_STICKY_CELL_SHADOW}`;

/** The band layer inside it — colour, padding and type live here, not on the cell. */
export const PROJECTION_SECTION_LABEL_INNER_CLASS =
  'bg-primary/5 px-4 py-3 text-xs font-bold uppercase tracking-wide text-primary';

/** A highlighted total row's frozen cell: same opaque base and rail. */
export const PROJECTION_TOTAL_LABEL_CELL_CLASS =
  `sticky left-0 z-10 bg-background p-0 sm:p-0 font-bold ${PROJECTION_STICKY_CELL_SHADOW}`;

/** Its band layer, at the `TableCell` primitive's own padding so row height holds. */
export const PROJECTION_TOTAL_LABEL_INNER_CLASS =
  'bg-primary/10 px-3 py-2.5 sm:p-4';
