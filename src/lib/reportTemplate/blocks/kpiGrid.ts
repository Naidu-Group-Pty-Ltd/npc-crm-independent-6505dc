/**
 * KPI grid block — N stat tiles in a horizontal row.
 *
 * Props:
 *   x,y,width,height: layout in pt
 *   columns?: number (default = items.length, max 6)
 *   gap?: number (pt)
 *   items: Array<{ label: string; value: string|bindable; accent?: string }>
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { boundValueResolved } from '../boundValuePresence';

interface KpiItem { label: string; value: string; accent?: string }

export function drawKpiGridBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 24);
  const w = Number(p.width ?? page.width - 48);
  const h = Number(p.height ?? 90);
  // The same tile rule the HTML twin applies — a bound value that received
  // nothing is no tile — so the preview and the final document agree about
  // which figures exist. See `renderKpiGridHtml`.
  const authored = Array.isArray(p.items) ? (p.items as KpiItem[]) : [];
  const items = authored.filter((it) => boundValueResolved(it.value, ctx));
  if (items.length === 0) return;

  const cols = Math.min(Number(p.columns ?? items.length), 6, items.length);
  const gap = Number(p.gap ?? 12);
  const tileW = (w - gap * (cols - 1)) / cols;

  const bgHex = resolveBindableColor(p.tileBg ?? 'token:bg', ctx, '#1A1A1A');
  const accentDefault = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const labelHex = resolveBindableColor(p.labelColor ?? 'token:muted', ctx, '#999999');

  items.slice(0, cols).forEach((item, i) => {
    const tx = x + i * (tileW + gap);
    // Tile bg
    const { r, g, b } = hex(bgHex);
    doc.setFillColor(r, g, b);
    doc.roundedRect(tx, y, tileW, h, 6, 6, 'F');

    // Accent bar (left edge)
    const accentHex = item.accent ? resolveBindableColor(item.accent, ctx, accentDefault) : accentDefault;
    const a = hex(accentHex);
    doc.setFillColor(a.r, a.g, a.b);
    doc.rect(tx, y, 3, h, 'F');

    // Value
    const value = resolveBindable(item.value, ctx) || '—';
    doc.setTextColor(a.r, a.g, a.b);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(value, tx + 12, y + h / 2, { baseline: 'middle', maxWidth: tileW - 24 });

    // Label
    const lab = hex(labelHex);
    doc.setTextColor(lab.r, lab.g, lab.b);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    // Bindable for the same reason `value` is: a master is free to bind a
    // tile's caption, and a caption that renders as `{{…}}` is the defect this
    // renderer's contract names. Today's masters author them as literals, so
    // this changes no drawn document.
    doc.text(resolveBindable(item.label ?? '', ctx).toUpperCase(), tx + 12, y + h - 10, { maxWidth: tileW - 24 });
  });
}

function hex(s: string) {
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
