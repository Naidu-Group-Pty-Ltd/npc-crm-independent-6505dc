/**
 * Footer block — thin bar across the bottom of the page.
 *
 * Props:
 *   text: bindable string ('{{client.name}} — Page {{pageNumber}}')
 *   bg?: bindable color
 *   color?: bindable color
 *   height?: pt (default 28)
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';

export function drawFooterBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const h = Number(p.height ?? 28);
  const bg = hex(resolveBindableColor(p.bg ?? 'token:bg', ctx, '#0D0D0D'));
  const fg = hex(resolveBindableColor(p.color ?? 'token:muted', ctx, '#999999'));

  doc.setFillColor(bg.r, bg.g, bg.b);
  doc.rect(0, page.height - h, page.width, h, 'F');

  const text = resolveBindable(p.text, ctx);
  if (text) {
    doc.setTextColor(fg.r, fg.g, fg.b);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const align = (p.align as string) || 'center';
    const x =
      align === 'left' ? 24 :
      align === 'right' ? page.width - 24 :
      page.width / 2;
    doc.text(text, x, page.height - h / 2, { align: align as any, baseline: 'middle' });
  }
}

function hex(s: string) {
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
