/**
 * Planning Action Table (Compass §19 — PROTECTED).
 * Columns: Item / Status / Investor relevance / Action.
 *
 * Props:
 *   items: Array<{ item: string; status: string; relevance: string; action: string }>
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable } from '../bindingResolver';
import { hex } from './_shared';

interface PlanningItem {
  item: string;
  status: string;
  relevance: string;
  action: string;
}

const STATUS_PALETTE: Record<string, { bg: string; fg: string }> = {
  Approved:  { bg: '#DCFCE7', fg: '#065F46' },
  Pending:   { bg: '#FEF3C7', fg: '#92400E' },
  Lodged:    { bg: '#DBEAFE', fg: '#1E3A8A' },
  Rejected:  { bg: '#FEE2E2', fg: '#991B1B' },
  Withdrawn: { bg: '#F3F4F6', fg: '#374151' },
};

export function drawPlanningTableBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? page.width - 48);
  const title = resolveBindable(p.title ?? 'Zoning & Planning — Action Table', ctx);
  const items = Array.isArray(p.items) ? (p.items as PlanningItem[]) : [];

  const cols = [
    { key: 'item',      label: 'Item',                frac: 0.24 },
    { key: 'status',    label: 'Status',              frac: 0.16 },
    { key: 'relevance', label: 'Investor relevance',  frac: 0.32 },
    { key: 'action',    label: 'Action',              frac: 0.28 },
  ];

  // Title
  doc.setFillColor(26, 26, 26);
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
    const rowH = Math.max(24, lines * 11 + 12);

    if (idx % 2 === 1) {
      doc.setFillColor(252, 250, 246);
      doc.rect(x, ry, w, rowH, 'F');
    }

    let rx = x + 8;
    cols.forEach((c, i) => {
      if (c.key === 'status') {
        const status = String(it.status ?? 'Pending');
        const pal = STATUS_PALETTE[status] ?? STATUS_PALETTE.Pending;
        const bgC = hex(pal.bg);
        const fgC = hex(pal.fg);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        const tw = doc.getTextWidth(status) + 12;
        doc.setFillColor(bgC.r, bgC.g, bgC.b);
        doc.roundedRect(rx, ry + 6, tw, 14, 4, 4, 'F');
        doc.setTextColor(fgC.r, fgC.g, fgC.b);
        doc.text(status, rx + 6, ry + 15);
      } else {
        doc.setTextColor(c.key === 'item' ? 26 : 60, c.key === 'item' ? 26 : 60, c.key === 'item' ? 26 : 60);
        doc.setFont('helvetica', c.key === 'item' ? 'bold' : 'normal');
        doc.setFontSize(8.5);
        doc.text(cellLines[i], rx, ry + 12);
      }
      rx += c.frac * w;
    });
    ry += rowH;
  });

  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, ry - y, 'S');
}
