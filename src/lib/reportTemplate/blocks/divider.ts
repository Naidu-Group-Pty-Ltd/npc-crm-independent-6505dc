/**
 * Divider block — horizontal rule across the page.
 * Props: x?, y, width?, thickness?, color?, style? ('solid'|'dashed'|'dotted')
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindableColor } from '../bindingResolver';

export function drawDividerBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 0);
  const w = Number(p.width ?? page.width - 48);
  const t = Number(p.thickness ?? 1);
  const style = (p.style as string) ?? 'solid';
  const c = hex(resolveBindableColor(p.color ?? 'token:muted', ctx, '#999999'));
  doc.setDrawColor(c.r, c.g, c.b);
  doc.setLineWidth(t);
  if (style === 'dashed') (doc as any).setLineDashPattern?.([4, 3], 0);
  else if (style === 'dotted') (doc as any).setLineDashPattern?.([1, 2], 0);
  else (doc as any).setLineDashPattern?.([], 0);
  doc.line(x, y, x + w, y);
  (doc as any).setLineDashPattern?.([], 0);
}

function hex(s: string) {
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
