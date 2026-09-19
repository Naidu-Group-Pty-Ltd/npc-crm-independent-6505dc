/**
 * Infrastructure Pipeline timeline (Compass §8 — PROTECTED).
 * Horizontal swimlane: Existing → Short-Term → Medium-Term → Long-Term.
 * Each item is a dot + label + confidence chip.
 *
 * Props:
 *   x,y,width,height: layout
 *   title?: string
 *   items: Array<{ phase: 'Existing'|'Short'|'Medium'|'Long'; label: string;
 *                  year?: string|number; confidence?: string }>
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable } from '../bindingResolver';
import { hex, confidenceChip } from './_shared';

interface InfraItem {
  phase: string;
  label: string;
  year?: string | number;
  confidence?: string;
}

const PHASES: Array<{ key: string; label: string }> = [
  { key: 'Existing', label: 'Existing' },
  { key: 'Short',    label: 'Short-term (0-2y)' },
  { key: 'Medium',   label: 'Medium-term (3-5y)' },
  { key: 'Long',     label: 'Long-term (5y+)' },
];

export function drawInfraTimelineBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? page.width - 48);
  const title = resolveBindable(p.title ?? 'Infrastructure & Growth Pipeline', ctx);
  const items = Array.isArray(p.items) ? (p.items as InfraItem[]) : [];

  // Title bar
  const headerBg = hex('#1A1A1A');
  doc.setFillColor(headerBg.r, headerBg.g, headerBg.b);
  doc.rect(x, y, w, 22, 'F');
  doc.setTextColor(191, 155, 80);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(String(title).toUpperCase(), x + 12, y + 15);

  // Timeline axis
  const axisY = y + 50;
  const colW = w / PHASES.length;

  // Axis line
  doc.setDrawColor(191, 155, 80);
  doc.setLineWidth(1.2);
  doc.line(x + 12, axisY, x + w - 12, axisY);

  // Phase markers + labels
  PHASES.forEach((ph, i) => {
    const cx = x + colW * i + colW / 2;
    doc.setFillColor(191, 155, 80);
    doc.circle(cx, axisY, 4, 'F');
    doc.setTextColor(26, 26, 26);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(ph.label, cx, axisY - 8, { align: 'center' });
  });

  // Items below their phase column
  const grouped: Record<string, InfraItem[]> = {};
  PHASES.forEach((ph) => (grouped[ph.key] = []));
  items.forEach((it) => {
    const key = PHASES.find((p) => p.key.toLowerCase() === String(it.phase ?? '').toLowerCase())?.key
      ?? 'Existing';
    grouped[key].push(it);
  });

  PHASES.forEach((ph, i) => {
    const colX = x + colW * i + 8;
    const colInner = colW - 16;
    let cy = axisY + 18;
    grouped[ph.key].forEach((it) => {
      // Label
      doc.setTextColor(26, 26, 26);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      const labelText = it.year ? `${it.year} · ${resolveBindable(it.label, ctx)}` : resolveBindable(it.label, ctx);
      const labelLines = doc.splitTextToSize(labelText, colInner);
      doc.text(labelLines.slice(0, 2), colX, cy);
      cy += labelLines.slice(0, 2).length * 10;
      // Confidence chip
      if (it.confidence) {
        confidenceChip(doc, colX, cy + 4, String(it.confidence), 7);
        cy += 12;
      }
      cy += 6;
    });
  });

  // Border
  const totalH = Math.max(140, Number(p.height ?? 0));
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, totalH, 'S');
}
