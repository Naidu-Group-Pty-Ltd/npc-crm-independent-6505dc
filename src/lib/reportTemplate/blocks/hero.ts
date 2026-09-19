/**
 * Hero block — large headline + subtitle, optional background image and tint.
 *
 * Props:
 *   title:      bindable string (e.g. "{{property.address}}")
 *   subtitle?:  bindable string
 *   imageUrl?:  bindable URL (preloaded → data URL)
 *   tint?:      bindable color (overlay tint)
 *   x,y,width,height?: layout in pt (defaults to full page)
 *   align?: 'left' | 'center' | 'right'
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';

export function drawHeroBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;

  const x = Number(p.x ?? 0);
  const y = Number(p.y ?? 0);
  const w = Number(p.width ?? page.width);
  const h = Number(p.height ?? Math.min(280, page.height * 0.45));
  const align = (p.align as string) || 'left';

  // Background image
  const imageUrl = resolveBindable(p.imageUrl, ctx);
  if (imageUrl && (imageUrl.startsWith('data:') || imageUrl.startsWith('http'))) {
    try {
      const fmt = imageUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(imageUrl, fmt, x, y, w, h);
    } catch (e) { console.warn('[hero] image failed', e); }
  }

  // Tint
  const tintHex = resolveBindable(p.tint, ctx);
  if (tintHex && tintHex.startsWith('#')) {
    const { r, g, b } = hexRgb(tintHex);
    doc.setFillColor(r, g, b);
    (doc as any).setGState && (doc as any).setGState(new (doc as any).GState({ opacity: 0.55 }));
    doc.rect(x, y, w, h, 'F');
    (doc as any).setGState && (doc as any).setGState(new (doc as any).GState({ opacity: 1 }));
  }

  // Title
  const title = resolveBindable(p.title, ctx);
  if (title) {
    const titleColor = resolveBindableColor(p.titleColor ?? 'token:text', ctx, '#FFFFFF');
    const { r, g, b } = hexRgb(titleColor);
    doc.setTextColor(r, g, b);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(Number(p.titleSize ?? 32));
    const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w - 24 : x + 24;
    doc.text(title, tx, y + h - 60, { align: align as any, maxWidth: w - 48 });
  }

  // Subtitle
  const subtitle = resolveBindable(p.subtitle, ctx);
  if (subtitle) {
    const subColor = resolveBindableColor(p.subtitleColor ?? 'token:primary', ctx, '#BF9B50');
    const { r, g, b } = hexRgb(subColor);
    doc.setTextColor(r, g, b);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(Number(p.subtitleSize ?? 14));
    const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w - 24 : x + 24;
    doc.text(subtitle, tx, y + h - 32, { align: align as any, maxWidth: w - 48 });
  }
}

function hexRgb(hex: string) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
