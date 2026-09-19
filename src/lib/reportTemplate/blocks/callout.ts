/**
 * Callout block — coloured panel with optional icon glyph + title + body.
 * Great for "Note", "Warning", quotes, key takeaways.
 *
 * Props: x,y,width,height?, variant ('info'|'success'|'warning'|'danger'|'quote'),
 *        title (bindable), body (bindable), accent? (color)
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';

const VARIANT: Record<string, { bg: string; accent: string; fg: string; glyph: string }> = {
  info:    { bg: '#EEF4FB', accent: '#2563EB', fg: '#1E3A8A', glyph: 'i' },
  success: { bg: '#ECFDF3', accent: '#16A34A', fg: '#14532D', glyph: '✓' },
  warning: { bg: '#FFF7ED', accent: '#D97706', fg: '#7C2D12', glyph: '!' },
  danger:  { bg: '#FEF2F2', accent: '#DC2626', fg: '#7F1D1D', glyph: '!' },
  quote:   { bg: '#F4F0E6', accent: '#BF9B50', fg: '#1A1A1A', glyph: '“' },
};

export function drawCalloutBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const variant = String(p.variant ?? 'info');
  const v = VARIANT[variant] ?? VARIANT.info;

  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 24);
  const w = Number(p.width ?? page.width - 48);
  const titleStr = resolveBindable(p.title, ctx);
  const bodyStr = resolveBindable(p.body, ctx);
  const bodyLines = bodyStr ? doc.splitTextToSize(bodyStr, w - 48) : [];
  const calcHeight = (titleStr ? 22 : 0) + Math.max(bodyLines.length * 12, 14) + 18;
  const h = Number(p.height ?? calcHeight);

  const bg = hex(resolveBindableColor(p.bg ?? v.bg, ctx, v.bg));
  const accent = hex(resolveBindableColor(p.accent ?? v.accent, ctx, v.accent));
  const fg = hex(resolveBindableColor(p.color ?? v.fg, ctx, v.fg));

  doc.setFillColor(bg.r, bg.g, bg.b);
  doc.roundedRect(x, y, w, h, 6, 6, 'F');
  doc.setFillColor(accent.r, accent.g, accent.b);
  doc.rect(x, y, 4, h, 'F');

  // Glyph badge
  doc.setFillColor(accent.r, accent.g, accent.b);
  doc.circle(x + 22, y + 18, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(v.glyph, x + 22, y + 18, { align: 'center', baseline: 'middle' });

  let cursor = y + 14;
  if (titleStr) {
    doc.setTextColor(fg.r, fg.g, fg.b);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(titleStr, x + 38, cursor + 6, { maxWidth: w - 48 });
    cursor += 18;
  }
  if (bodyLines.length) {
    doc.setTextColor(fg.r, fg.g, fg.b);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(bodyLines, x + 38, cursor + 8, { lineHeightFactor: 1.4, maxWidth: w - 48 });
  }
}

function hex(s: string) {
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
