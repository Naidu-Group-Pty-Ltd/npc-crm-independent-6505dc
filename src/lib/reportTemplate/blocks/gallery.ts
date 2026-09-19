/**
 * Image gallery — N×M grid of preloaded images with optional captions.
 * Props: x,y,width,height, columns?, gap?, items: Array<{ src, caption? }>
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';

interface Item { src: string; caption?: string }

export function drawGalleryBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 24);
  const w = Number(p.width ?? page.width - 48);
  const h = Number(p.height ?? 260);
  const items = Array.isArray(p.items) ? (p.items as Item[]) : [];
  if (!items.length) return;

  const cols = Math.max(1, Math.min(6, Number(p.columns ?? Math.min(items.length, 3))));
  const gap = Number(p.gap ?? 8);
  const rows = Math.ceil(items.length / cols);
  const tileW = (w - gap * (cols - 1)) / cols;
  const tileH = (h - gap * (rows - 1)) / rows;
  const captionColor = hex(resolveBindableColor(p.captionColor ?? 'token:muted', ctx, '#666666'));

  items.forEach((item, idx) => {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const tx = x + c * (tileW + gap);
    const ty = y + r * (tileH + gap);
    const src = resolveBindable(item.src, ctx);
    if (src && (src.startsWith('data:') || src.startsWith('http'))) {
      try {
        const fmt = src.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        doc.addImage(src, fmt, tx, ty, tileW, tileH - (item.caption ? 12 : 0));
      } catch (e) { console.warn('[gallery] image failed', e); }
    } else {
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.5);
      doc.rect(tx, ty, tileW, tileH - (item.caption ? 12 : 0), 'S');
    }
    const cap = resolveBindable(item.caption, ctx);
    if (cap) {
      doc.setTextColor(captionColor.r, captionColor.g, captionColor.b);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7.5);
      doc.text(cap, tx, ty + tileH - 2, { maxWidth: tileW });
    }
  });
}

function hex(s: string) {
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
