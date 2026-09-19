/**
 * Macro Investment Scorecard (Compass §5).
 *
 * 8 weighted categories shown as a vertical list with a coloured rating chip
 * (Strong / Moderate / Watch) plus a one-line "why" note per row.
 *
 * Props:
 *   x,y,width: layout
 *   title?: string (default 'Macro Investment Scorecard')
 *   items: Array<{ category: string; rating: 'Strong'|'Moderate'|'Watch'; note?: string; weight?: number }>
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { hex, ratingChip } from './_shared';

interface ScorecardItem {
  category: string;
  rating: string;
  note?: string;
  weight?: number;
}

export function drawScorecardBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? page.width - 48);
  const title = resolveBindable(p.title ?? 'Macro Investment Scorecard', ctx);
  const items = Array.isArray(p.items) ? (p.items as ScorecardItem[]) : [];

  const accent = hex(resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50'));
  const headerBg = hex(resolveBindableColor(p.headerBg ?? '#1A1A1A', ctx, '#1A1A1A'));

  // Title bar
  doc.setFillColor(headerBg.r, headerBg.g, headerBg.b);
  doc.rect(x, y, w, 24, 'F');
  doc.setTextColor(accent.r, accent.g, accent.b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(String(title).toUpperCase(), x + 12, y + 16);

  // Rows
  let cy = y + 24;
  const rowH = 28;
  items.forEach((it, idx) => {
    const ry = cy + idx * rowH;
    // Zebra stripe
    if (idx % 2 === 0) {
      doc.setFillColor(248, 246, 240);
      doc.rect(x, ry, w, rowH, 'F');
    }
    // Category
    doc.setTextColor(26, 26, 26);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(String(it.category ?? ''), x + 12, ry + 11);

    // Note
    if (it.note) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(85, 85, 85);
      const noteLines = doc.splitTextToSize(resolveBindable(it.note, ctx), w - 180);
      doc.text(noteLines.slice(0, 1), x + 12, ry + 22);
    }

    // Rating chip on the right
    const chipText = String(it.rating ?? 'Moderate');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    const chipW = doc.getTextWidth(chipText) + 12;
    ratingChip(doc, x + w - chipW - 12, ry + 14, chipText, 8);
  });

  // Outer border
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, 24 + items.length * rowH, 'S');
}
