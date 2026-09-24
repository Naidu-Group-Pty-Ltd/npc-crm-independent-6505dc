/**
 * A page whose column is laid out from what actually draws.
 *
 * ## What was wrong
 *
 * A master lays each page out as a flow — `flow()` in the Investment Compass
 * builder stacks every block at the previous one's DECLARED bottom plus a gap
 * — and the renderer positions every block absolutely at that `y`. A declared
 * height is a worst case, so the page is correct and mostly white whenever the
 * record holds less than the worst case. On the 23 Sep 2026 Compass for
 * 9 Hollow Street and 97 Poole Road, pages 3 to 6 were 54%, 68%, 66% and 74%
 * empty, on every master in the catalogue:
 *
 *  - the KPI ledger declared six rows (228pt on Board Pack Brief) and the
 *    Compass publishes two — purchase price and weekly rent — so the verdict
 *    page ended a third of the way down;
 *  - the property table declared eight guarded rows and drew five;
 *  - and each of those was its own page, with the report's body waiting on the
 *    page after the last of them.
 *
 * `closeDroppedBlocks` already closes the hole a WHOLE block leaves. This is
 * the same rule taken one step further, for a page that asks for it: the
 * column is re-stacked from what draws, so a dropped block costs nothing and a
 * block that draws fewer of its declared rows gives the difference back.
 *
 * ## The rule
 *
 * Only blocks the master STAMPED move (`props.flowSlot`, written by
 * `flowColumn` in the builder, carrying the height and gap the flow declared).
 * Furniture — running head, part marker, footer, page number — carries no
 * stamp and never moves. Blocks sharing a declared `y` are one row (mutually
 * exclusive variants at one position, or row-mates), and the row takes its
 * tallest member.
 *
 * A block's height here is never LESS than it can draw, because every figure
 * is the builder's own worst case with only whole rows taken away: a table
 * that draws five of eight guarded rows is charged eight less three, and a
 * row that can wrap keeps a spare (`rows.spare`), because a long address sets
 * over two lines. So the column can only end ABOVE where these heights say,
 * never below — which is what lets the narrative's pre-pass (`narrativePlan`)
 * size the body's first box from the same arithmetic and be sure it fits.
 *
 * A `fill` block (the report body's first page, set in the room left under
 * the summary) moves up with the column and keeps its declared bottom.
 */
import type { Block } from './templateSchema';

export interface FlowRows {
  /** Rows or items declared. */
  count: number;
  /** Height of one row, as declared. */
  height: number;
  /** Items per row, for a grid; 1 for a ledger or a table. */
  perRow?: number;
  /** Rows kept in reserve because a row can wrap. */
  spare?: number;
}

export interface FlowSlot {
  height: number;
  gap: number;
  rows?: FlowRows;
  fill?: boolean;
}

/** The stamp a builder wrote on a flowed block, validated, or null. */
export function flowSlotOf(block: Block): FlowSlot | null {
  const raw = (block.props as { flowSlot?: unknown } | undefined)?.flowSlot;
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const height = Number(s.height);
  const gap = Number(s.gap);
  if (!Number.isFinite(height) || height < 0 || !Number.isFinite(gap) || gap < 0) return null;
  const r = s.rows && typeof s.rows === 'object' ? (s.rows as Record<string, unknown>) : null;
  const count = Number(r?.count);
  const rowHeight = Number(r?.height);
  const rows = r && Number.isFinite(count) && count > 0 && Number.isFinite(rowHeight) && rowHeight > 0
    ? {
      count,
      height: rowHeight,
      perRow: Math.max(1, Math.floor(Number(r.perRow ?? 1)) || 1),
      spare: Math.max(0, Math.floor(Number(r.spare ?? 0)) || 0),
    }
    : undefined;
  return { height, gap, ...(rows ? { rows } : {}), ...(s.fill === true ? { fill: true } : {}) };
}

export interface FlowFacts {
  /** The block puts nothing on the page. */
  isDropped(block: Block): boolean;
  /** How many of a rowed block's rows or items draw; null when not known. */
  drawnRows(block: Block): number | null;
}

/**
 * The height a flowed block takes: its declared height less the whole rows it
 * does not draw, keeping its spares. Never more than declared, never less
 * than the rows it draws can need.
 */
export function flowedHeight(slot: FlowSlot, drawn: number | null): number {
  if (!slot.rows || drawn === null || !Number.isFinite(drawn)) return slot.height;
  const per = slot.rows.perRow ?? 1;
  const declaredRows = Math.ceil(slot.rows.count / per);
  const drawnRows = Math.ceil(Math.max(0, drawn) / per);
  const freed = Math.max(0, declaredRows - drawnRows - (slot.rows.spare ?? 0));
  return Math.max(0, slot.height - freed * slot.rows.height);
}

/** Where each stamped block lands, by block id, and the column's end. */
export interface FlowPlacement {
  y: Map<string, number>;
  height: Map<string, number>;
  /** The `y` the next block would take: the top of the room left. */
  end: number;
}

/**
 * Stack the stamped blocks from the top of the column, counting only what
 * draws. Pure: the facts are handed in, so the renderer and the pre-pass that
 * must agree with it ask the same questions of the same blocks.
 */
export function placeFlowColumn(blocks: readonly Block[], facts: FlowFacts): FlowPlacement {
  const flowed = blocks
    .map((b, index) => ({ b, index, slot: flowSlotOf(b), y: Number((b.props as { y?: unknown } | undefined)?.y) }))
    .filter((f): f is { b: Block; index: number; slot: FlowSlot; y: number } => f.slot !== null && Number.isFinite(f.y));
  const y = new Map<string, number>();
  const height = new Map<string, number>();
  if (!flowed.length) return { y, height, end: 0 };

  let cursor = Math.min(...flowed.map((f) => f.y));
  const drawn = flowed
    .filter((f) => !facts.isDropped(f.b))
    .sort((a, b) => a.y - b.y || a.index - b.index);

  for (let i = 0; i < drawn.length;) {
    const rowY = drawn[i].y;
    const row: typeof drawn = [];
    while (i < drawn.length && Math.abs(drawn[i].y - rowY) < 0.5) row.push(drawn[i++]);
    let rowHeight = 0;
    let rowGap = 0;
    for (const f of row) {
      y.set(f.b.id, cursor);
      if (f.slot.fill) continue;
      const h = flowedHeight(f.slot, facts.drawnRows(f.b));
      height.set(f.b.id, h);
      rowHeight = Math.max(rowHeight, h);
      rowGap = Math.max(rowGap, f.slot.gap);
    }
    // A row of nothing but a fill ends the column where it starts.
    if (rowHeight > 0 || rowGap > 0) cursor += rowHeight + rowGap;
  }
  return { y, height, end: cursor };
}

/**
 * The page's blocks with every stamped block moved to where it lands.
 *
 * A block that carries an explicit `height` (a KPI grid does) is given the
 * height it will draw, so its box closes up with its content; a fill block
 * keeps its declared bottom and grows by what the column gave back. Nothing
 * unstamped is touched, and a page with no stamp is returned as it came.
 */
export function layoutFlowColumn(blocks: readonly Block[], facts: FlowFacts): Block[] {
  const placed = placeFlowColumn(blocks, facts);
  if (!placed.y.size) return [...blocks];
  return blocks.map((b) => {
    const at = placed.y.get(b.id);
    if (at === undefined) return b;
    const props = { ...(b.props as Record<string, unknown>) };
    const declaredY = Number(props.y);
    props.y = at;
    const slot = flowSlotOf(b);
    if (slot?.fill) {
      const h = Number(props.height);
      if (Number.isFinite(h) && Number.isFinite(declaredY)) props.height = h + (declaredY - at);
    } else {
      const h = placed.height.get(b.id);
      const own = Number(props.height);
      if (h !== undefined && Number.isFinite(own) && h < own) props.height = h;
    }
    return { ...b, props } as Block;
  });
}
