/**
 * Cover block — full-bleed cover page with title, eyebrow and footer mark.
 * Designed to occupy the entire page; renders relative to ctx.page.
 *
 * Props:
 *   eyebrow?:  bindable string (small uppercase tag at top)
 *   title:     bindable string (large display)
 *   subtitle?: bindable string
 *   footnote?: bindable string (bottom)
 *   bg?:       bindable color (defaults to token:bg)
 *   accent?:   bindable color (defaults to token:primary)
 *   imageUrl?: bindable URL (full-bleed background image)
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';

export function drawCoverBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;

  // Background fill
  const bg = hex(resolveBindableColor(p.bg ?? 'token:bg', ctx, '#0D0D0D'));
  doc.setFillColor(bg.r, bg.g, bg.b);
  doc.rect(0, 0, page.width, page.height, 'F');

  // Background image (optional)
  const imageUrl = resolveBindable(p.imageUrl, ctx);
  if (imageUrl && (imageUrl.startsWith('data:') || imageUrl.startsWith('http'))) {
    try {
      const fmt = imageUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      doc.addImage(imageUrl, fmt, 0, 0, page.width, page.height);
      // dim overlay
      doc.setFillColor(bg.r, bg.g, bg.b);
      (doc as any).setGState && (doc as any).setGState(new (doc as any).GState({ opacity: 0.55 }));
      doc.rect(0, 0, page.width, page.height, 'F');
      (doc as any).setGState && (doc as any).setGState(new (doc as any).GState({ opacity: 1 }));
    } catch (e) { console.warn('[cover] image failed', e); }
  }

  const accent = hex(resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50'));
  const text = hex(resolveBindableColor(p.color ?? '#FFFFFF', ctx, '#FFFFFF'));

  // Accent rule
  doc.setFillColor(accent.r, accent.g, accent.b);
  doc.rect(48, page.height * 0.55, 60, 3, 'F');

  // Eyebrow
  const eyebrow = resolveBindable(p.eyebrow, ctx);
  if (eyebrow) {
    doc.setTextColor(accent.r, accent.g, accent.b);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(eyebrow.toUpperCase(), 48, page.height * 0.55 - 12);
  }

  // Title
  const title = resolveBindable(p.title, ctx);
  if (title) {
    doc.setTextColor(text.r, text.g, text.b);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(Number(p.titleSize ?? 40));
    const wrapped = doc.splitTextToSize(title, page.width - 96);
    doc.text(wrapped, 48, page.height * 0.55 + 36, { lineHeightFactor: 1.1 });
  }

  // Subtitle
  const subtitle = resolveBindable(p.subtitle, ctx);
  if (subtitle) {
    doc.setTextColor(text.r, text.g, text.b);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(14);
    doc.text(subtitle, 48, page.height * 0.55 + 36 + Number(p.titleSize ?? 40) * 1.4, { maxWidth: page.width - 96 });
  }

  // Footnote
  const footnote = resolveBindable(p.footnote, ctx);
  if (footnote) {
    doc.setTextColor(accent.r, accent.g, accent.b);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(footnote, 48, page.height - 36);
  }
}

function hex(s: string) {
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
