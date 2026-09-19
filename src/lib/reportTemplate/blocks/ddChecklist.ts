/**
 * Due-Diligence Checklist (Compass §20 — PROTECTED).
 * Vertical list of "[ ] action — owner — timing" items.
 *
 * Props:
 *   items: Array<{ action: string; owner?: string; timing?: string; done?: boolean }>
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable } from '../bindingResolver';
import { hex } from './_shared';

interface DDItem {
  action: string;
  owner?: string;
  timing?: string;
  done?: boolean;
}

export function drawDDChecklistBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? page.width - 48);
  const title = resolveBindable(p.title ?? 'Due-Diligence Checklist', ctx);
  const items = Array.isArray(p.items) ? (p.items as DDItem[]) : [];

  // Title
  doc.setFillColor(26, 26, 26);
  doc.rect(x, y, w, 22, 'F');
  doc.setTextColor(191, 155, 80);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(String(title).toUpperCase(), x + 12, y + 15);

  let cy = y + 22;
  const rowH = 26;
  items.forEach((it, idx) => {
    const ry = cy + idx * rowH;
    if (idx % 2 === 0) {
      doc.setFillColor(252, 250, 246);
      doc.rect(x, ry, w, rowH, 'F');
    }

    // Checkbox
    const cbSize = 10;
    const cbX = x + 12;
    const cbY = ry + (rowH - cbSize) / 2;
    doc.setDrawColor(60, 60, 60);
    doc.setLineWidth(0.8);
    doc.rect(cbX, cbY, cbSize, cbSize, 'S');
    if (it.done) {
      const t = hex('#16A34A');
      doc.setDrawColor(t.r, t.g, t.b);
      doc.setLineWidth(1.6);
      doc.line(cbX + 2, cbY + 5, cbX + 4.5, cbY + 8);
      doc.line(cbX + 4.5, cbY + 8, cbX + 8.5, cbY + 2);
      doc.setLineWidth(0.5);
    }

    // Action
    doc.setTextColor(26, 26, 26);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(resolveBindable(it.action ?? '', ctx), x + 32, ry + 11);

    // Meta line
    const meta: string[] = [];
    if (it.owner) meta.push(`Owner: ${resolveBindable(it.owner, ctx)}`);
    if (it.timing) meta.push(`Timing: ${resolveBindable(it.timing, ctx)}`);
    if (meta.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(110, 110, 110);
      doc.text(meta.join('   ·   '), x + 32, ry + 22);
    }
  });

  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, 22 + items.length * rowH, 'S');
}
