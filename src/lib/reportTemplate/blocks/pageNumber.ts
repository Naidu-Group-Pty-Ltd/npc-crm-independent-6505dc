/**
 * Page number block — small "Page X / Y" indicator.
 * Resolves {{pageNumber}} / {{pageCount}} provided in render context.
 *
 * Props: text? (bindable, default 'Page {{pageNumber}} of {{pageCount}}'),
 *        align?, color?, y? (default page.height-20), size?
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';

export function drawPageNumberBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const text = resolveBindable(p.text ?? 'Page {{pageNumber}} of {{pageCount}}', ctx);
  if (!text) return;
  const c = hex(resolveBindableColor(p.color ?? 'token:muted', ctx, '#999999'));
  const align = (p.align as string) ?? 'center';
  const y = Number(p.y ?? page.height - 20);
  const x =
    align === 'left' ? 24 :
    align === 'right' ? page.width - 24 :
    page.width / 2;
  doc.setTextColor(c.r, c.g, c.b);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(Number(p.size ?? 8));
  doc.text(text, x, y, { align: align as any, baseline: 'middle' });
}

function hex(s: string) {
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
