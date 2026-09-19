import type { Block, Overlay } from './templateSchema';
import { evalConditional, type ResolveContext } from './bindingResolver';

/** Shared export guard for overlays across HTML and PDF renderers. */
export function shouldRenderOverlay(overlay: Overlay, ctx: ResolveContext): boolean {
  return overlay.hidden !== true && evalConditional(overlay.conditional, ctx);
}

/**
 * A block's `visibility` rule — `always`, or an expression under `if`/`unless`.
 * Separate from `conditional` because a master may carry both, and they AND.
 */
export function evalBlockVisibility(
  v: Block['visibility'] | undefined,
  ctx: ResolveContext,
): boolean {
  if (!v || !v.mode || v.mode === 'always') return true;
  const expr = String(v.expr ?? '').trim();
  if (!expr) return true;
  const truthy = evalConditional(expr, ctx);
  return v.mode === 'unless' ? !truthy : truthy;
}

/**
 * The block counterpart of `shouldRenderOverlay`, and it lives here for the
 * same reason.
 *
 * This rule was stated once, privately, inside `htmlRenderer` — while the PDF
 * renderer beside it tested `conditional` alone. So a block the author had
 * hidden was absent from the HTML document and present in the PDF of the same
 * template, and the PDF renderer disagreed with ITSELF: it already honoured
 * `hidden` on an overlay through `shouldRenderOverlay` directly above.
 * Both surfaces now ask one function.
 */
export function shouldRenderBlock(block: Block, ctx: ResolveContext): boolean {
  return !block.hidden
    && evalConditional(block.conditional, ctx)
    && evalBlockVisibility(block.visibility, ctx);
}
