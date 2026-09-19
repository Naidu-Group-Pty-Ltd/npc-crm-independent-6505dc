/**
 * Slot block — references a reusable block defined in `template.slots`.
 *
 * Props: { slotKey: string }
 *
 * At render time the slot resolves to the underlying block (Header / Footer /
 * etc.) and dispatches through the normal block registry. Edit once, apply
 * everywhere the slot key is referenced.
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { getBlockRenderer } from './index';
import { evalConditional } from '../bindingResolver';

export function drawSlotBlock(block: Block, ctx: BlockRenderContext) {
  const slotKey = String(block.props?.slotKey ?? '');
  if (!slotKey) return;
  const slot = ctx.slots?.[slotKey];
  if (!slot) {
    console.warn(`[pdfRenderer] slot "${slotKey}" not found`);
    return;
  }
  if (!evalConditional(slot.conditional, ctx)) return;
  const renderer = getBlockRenderer(slot.type);
  if (renderer) renderer(slot, ctx);
  for (const overlay of slot.overlays) {
    if (!evalConditional(overlay.conditional, ctx)) continue;
    // Reuse the overlay drawer from pdfRenderer via a small shim
    // (overlays are drawn from pdfRenderer's loop normally; here we draw
    //  them explicitly so the slot acts like a self-contained group).
    ctx._drawOverlay?.(overlay, ctx);
  }
}
