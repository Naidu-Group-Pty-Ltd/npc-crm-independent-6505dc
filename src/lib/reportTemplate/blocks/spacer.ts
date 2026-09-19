/**
 * Spacer block — invisible vertical (or horizontal) gap. Optional dashed guide
 * is drawn in the editor preview only when `showGuide` is true.
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';

export function drawSpacerBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc } = ctx;
  const p = block.props as Record<string, unknown>;
  if (!p.showGuide) return;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 100);
  const w = Number(p.width ?? 547);
  const h = Number(p.height ?? 24);
  doc.setDrawColor(200, 200, 200);
  doc.setLineDashPattern([2, 2], 0);
  doc.rect(x, y, w, h, 'S');
  doc.setLineDashPattern([], 0);
}
