/**
 * Badge list — renders a flowing row of pill-shaped tags.
 *
 * Props: items (string[] bindable), x, y, width, color, bg, gap, paddingX, paddingY
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';

export function drawBadgeListBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const items = Array.isArray(p.items) ? (p.items as unknown[]) : [];
  if (items.length === 0) return;

  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 320);
  const maxW = Number(p.width ?? page.width - 48);
  const gap = Number(p.gap ?? 6);
  const padX = Number(p.paddingX ?? 8);
  const padY = Number(p.paddingY ?? 4);
  const size = Number(p.fontSize ?? 9);
  const radius = Number(p.radius ?? 10);

  const bg = hex(resolveBindableColor(p.bg ?? 'token:primary', ctx, '#BF9B50'));
  const color = hex(resolveBindableColor(p.color ?? '#FFFFFF', ctx, '#FFFFFF'));

  doc.setFontSize(size);
  doc.setFont('helvetica', 'bold');

  let cx = x;
  let cy = y;
  const h = size + padY * 2;

  for (const raw of items) {
    const text = resolveBindable(String(raw ?? ''), ctx);
    if (!text) continue;
    const tw = doc.getTextWidth(text);
    const w = tw + padX * 2;
    if (cx + w > x + maxW) {
      cx = x;
      cy += h + gap;
    }
    doc.setFillColor(bg.r, bg.g, bg.b);
    doc.roundedRect(cx, cy, w, h, radius, radius, 'F');
    doc.setTextColor(color.r, color.g, color.b);
    doc.text(text, cx + w / 2, cy + h / 2, { align: 'center', baseline: 'middle' });
    cx += w + gap;
  }
}

function hex(s: string) {
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
