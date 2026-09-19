/**
 * Chart block — embeds a remote chart image (e.g. QuickChart URL).
 * The URL is preloaded to a data URL by `imagePreloader` before render.
 *
 * Props:
 *   x,y,width,height: layout
 *   chartUrl: bindable string (URL)
 *   caption?: bindable string
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';

export function drawChartBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 24);
  const w = Number(p.width ?? page.width - 48);
  const h = Number(p.height ?? 240);

  const url = resolveBindable(p.chartUrl, ctx);
  if (url && (url.startsWith('data:') || url.startsWith('http'))) {
    try {
      const fmt = url.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(url, fmt, x, y, w, h - 18);
    } catch (e) { console.warn('[chart] image failed', e); }
  } else {
    // Placeholder
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.rect(x, y, w, h - 18, 'S');
    doc.setTextColor(150, 150, 150);
    doc.setFontSize(10);
    doc.text('Chart unavailable', x + w / 2, y + (h - 18) / 2, { align: 'center', baseline: 'middle' });
  }

  const caption = resolveBindable(p.caption, ctx);
  if (caption) {
    const cap = hex(resolveBindableColor(p.captionColor ?? 'token:muted', ctx, '#666666'));
    doc.setTextColor(cap.r, cap.g, cap.b);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.text(caption, x + w / 2, y + h - 4, { align: 'center', maxWidth: w });
  }
}

function hex(s: string) {
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
