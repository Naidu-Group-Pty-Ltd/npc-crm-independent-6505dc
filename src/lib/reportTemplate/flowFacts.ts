/**
 * The two questions `layoutFlowColumn` asks of a block, answered once.
 *
 * The HTML renderer, the browser PDF renderer and the narrative pre-pass all
 * lay out the same flowing page, and they must land every block in the same
 * place — the pre-pass sizes the report body's first box from the room the
 * summary leaves, and a box sized for one position and drawn at another
 * prints a line twice or loses it. So all three read the answers here.
 *
 *  - **Does it draw?** Asked of the block's own HTML renderer, exactly as
 *    `pagesWithContent` and `closeDroppedBlocks` already ask it: a block whose
 *    conditional is false, or whose renderer returns nothing, is dropped. The
 *    markdown block is never rendered to answer this — its drawing depends on
 *    the geometry being computed here — so it counts as drawn whenever it is
 *    allowed to render.
 *  - **How many rows draw?** For the two blocks whose depth follows the
 *    record: a KPI grid drops a tile whose bound value resolved to nothing
 *    (`boundValueResolved`, the renderer's own filter), and a data table draws
 *    only the rows with something to say (`rowsWithSomethingToSay`, likewise).
 */
import type { Block } from './templateSchema';
import type { ResolveContext } from './bindingResolver';
import { shouldRenderBlock } from './renderVisibility';
import { getHtmlBlockRenderer, type HtmlBlockContext } from './blocks/html';
import { boundValueResolved } from './boundValuePresence';
import { rowsWithSomethingToSay, type TableRow } from './blocks/_data';
import type { FlowFacts } from './flowLayout';

export function flowFactsFor(ctx: ResolveContext, blockCtx: HtmlBlockContext): FlowFacts {
  const dropped = new Map<string, boolean>();
  return {
    isDropped(block: Block): boolean {
      const known = dropped.get(block.id);
      if (known !== undefined) return known;
      let answer: boolean;
      if (!shouldRenderBlock(block, ctx)) answer = true;
      else if (block.type === 'markdown-block') answer = false;
      else {
        const renderer = getHtmlBlockRenderer(block.type);
        answer = renderer ? renderer(block, blockCtx).trim() === '' : false;
      }
      dropped.set(block.id, answer);
      return answer;
    },
    drawnRows(block: Block): number | null {
      const p = (block.props ?? {}) as Record<string, unknown>;
      if (block.type === 'kpi-grid') {
        const items = Array.isArray(p.items) ? (p.items as Array<{ value?: unknown }>) : [];
        return items.filter((it) => boundValueResolved(it?.value, ctx)).length;
      }
      if (block.type === 'data-table') {
        const rows = Array.isArray(p.rows) ? (p.rows as TableRow[]) : [];
        return rowsWithSomethingToSay(rows, ctx).rows.length;
      }
      return null;
    },
  };
}

/** A block context for a page, built the way `pagesWithContent` builds one. */
export function flowBlockContext(
  ctx: ResolveContext,
  page: { size?: { width?: number; height?: number } },
  pages: ReadonlyArray<{ id: string; name: string; tocContinues?: boolean }>,
  slots: Record<string, Block> = {},
): HtmlBlockContext {
  return {
    ...ctx,
    page: { width: page.size?.width ?? 595, height: page.size?.height ?? 842 },
    pageIndex: 0,
    pages: pages.map((p) => ({ id: p.id, name: p.name, tocContinues: p.tocContinues === true })),
    slots,
  };
}
