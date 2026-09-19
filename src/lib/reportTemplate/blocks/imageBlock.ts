/**
 * Image block — single image with optional caption (block-level, not overlay).
 *
 * Props:
 *   x,y,width,height
 *   src: bindable URL
 *   caption?: bindable string
 *   fit?: 'cover'|'contain'|'fill' (currently visual only — jsPDF stretches to box)
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';

export function drawImageBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 24);
  const w = Number(p.width ?? page.width - 48);
  const h = Number(p.height ?? 220);
  const src = resolveBindable(p.src, ctx);
  const captionH = p.caption ? 14 : 0;

  if (src && (src.startsWith('data:') || src.startsWith('http'))) {
    try {
      const fmt = src.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(src, fmt, x, y, w, h - captionH);
    } catch (e) { console.warn('[image-block] failed', e); }
  } else {
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.5);
    doc.rect(x, y, w, h - captionH, 'S');
    doc.setTextColor(180, 180, 180);
    doc.setFontSize(10);
    doc.text('No image', x + w / 2, y + (h - captionH) / 2, { align: 'center', baseline: 'middle' });
  }

  const caption = resolveBindable(p.caption, ctx);
  if (caption) {
    const c = hex(resolveBindableColor(p.captionColor ?? 'token:muted', ctx, '#666666'));
    doc.setTextColor(c.r, c.g, c.b);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.text(caption, x, y + h - 2, { maxWidth: w });
  }
}

function hex(s: string) {
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
