/**
 * Amenity & Livability Matrix (Compass §15).
 * Columns: Amenity / Current state / Future state / Investor relevance.
 *
 * Props:
 *   items: Array<{ amenity: string; current: string; future: string; relevance: string }>
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable } from '../bindingResolver';
import { hex } from './_shared';

interface AmenityItem {
  amenity: string;
  current: string;
  future: string;
  relevance: string;
}

export function drawAmenityMatrixBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? page.width - 48);
  const title = resolveBindable(p.title ?? 'Amenity & Livability Matrix', ctx);
  const items = Array.isArray(p.items) ? (p.items as AmenityItem[]) : [];

  const cols = [
    { key: 'amenity',   label: 'Amenity',           frac: 0.22 },
    { key: 'current',   label: 'Current state',     frac: 0.26 },
    { key: 'future',    label: 'Future state',      frac: 0.26 },
    { key: 'relevance', label: 'Investor relevance', frac: 0.26 },
  ];

  // Title
  const headerBg = hex('#1A1A1A');
  doc.setFillColor(headerBg.r, headerBg.g, headerBg.b);
  doc.rect(x, y, w, 22, 'F');
  doc.setTextColor(191, 155, 80);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(String(title).toUpperCase(), x + 12, y + 15);

  // Sub-header
  const subY = y + 22;
  doc.setFillColor(244, 240, 230);
  doc.rect(x, subY, w, 16, 'F');
  doc.setTextColor(60, 60, 60);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  let cx = x + 8;
  cols.forEach((c) => {
    doc.text(c.label.toUpperCase(), cx, subY + 11);
    cx += c.frac * w;
  });

  // Rows
  let ry = subY + 16;
  items.forEach((it, idx) => {
    const cellLines = cols.map((c) =>
      doc.splitTextToSize(resolveBindable((it as any)[c.key] ?? '', ctx), c.frac * w - 12),
    );
    const lines = Math.max(...cellLines.map((l) => l.length), 1);
    const rowH = Math.max(22, lines * 11 + 10);

    if (idx % 2 === 1) {
      doc.setFillColor(252, 250, 246);
      doc.rect(x, ry, w, rowH, 'F');
    }

    let rx = x + 8;
    cols.forEach((c, i) => {
      doc.setTextColor(c.key === 'amenity' ? 26 : 60, c.key === 'amenity' ? 26 : 60, c.key === 'amenity' ? 26 : 60);
      doc.setFont('helvetica', c.key === 'amenity' ? 'bold' : 'normal');
      doc.setFontSize(8.5);
      doc.text(cellLines[i], rx, ry + 12);
      rx += c.frac * w;
    });
    ry += rowH;
  });

  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, ry - y, 'S');
}
