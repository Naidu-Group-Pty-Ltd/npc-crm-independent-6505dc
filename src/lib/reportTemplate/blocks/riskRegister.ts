/**
 * Risk Register (Compass §17 — PROTECTED).
 * Columns: Risk / Rating / Confidence / Why it matters / Recommended DD action.
 *
 * Props:
 *   x,y,width: layout
 *   title?: string (default 'Risk Register')
 *   items: Array<{ risk: string; rating: 'High'|'Medium'|'Low'; confidence: string;
 *                  why: string; ddAction: string }>
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable } from '../bindingResolver';
import { hex, ratingChip, confidenceChip } from './_shared';

interface RiskItem {
  risk: string;
  rating: string;
  confidence: string;
  why: string;
  ddAction: string;
}

export function drawRiskRegisterBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? page.width - 48);
  const title = resolveBindable(p.title ?? 'Risk Register', ctx);
  const items = Array.isArray(p.items) ? (p.items as RiskItem[]) : [];

  // Column widths (fractions of w)
  const colW = {
    risk: w * 0.22,
    rating: w * 0.12,
    conf: w * 0.13,
    why: w * 0.28,
    dd: w * 0.25,
  };

  // Header
  const headerH = 22;
  const headerBg = hex('#1A1A1A');
  doc.setFillColor(headerBg.r, headerBg.g, headerBg.b);
  doc.rect(x, y, w, headerH, 'F');
  doc.setTextColor(191, 155, 80);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(String(title).toUpperCase(), x + 12, y + 15);

  // Sub-header row
  const subY = y + headerH;
  const subH = 18;
  doc.setFillColor(244, 240, 230);
  doc.rect(x, subY, w, subH, 'F');
  doc.setTextColor(60, 60, 60);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  let cx = x + 8;
  ['Risk', 'Rating', 'Confidence', 'Why it matters', 'Recommended DD action'].forEach((h, i) => {
    const widths = [colW.risk, colW.rating, colW.conf, colW.why, colW.dd];
    doc.text(h.toUpperCase(), cx, subY + 12);
    cx += widths[i];
  });

  // Rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  let ry = subY + subH;
  items.forEach((it, idx) => {
    const whyLines = doc.splitTextToSize(resolveBindable(it.why ?? '', ctx), colW.why - 12);
    const ddLines = doc.splitTextToSize(resolveBindable(it.ddAction ?? '', ctx), colW.dd - 12);
    const riskLines = doc.splitTextToSize(resolveBindable(it.risk ?? '', ctx), colW.risk - 12);
    const lines = Math.max(whyLines.length, ddLines.length, riskLines.length, 1);
    const rowH = Math.max(28, lines * 11 + 12);

    if (idx % 2 === 1) {
      doc.setFillColor(252, 250, 246);
      doc.rect(x, ry, w, rowH, 'F');
    }

    let rx = x + 8;
    // Risk label
    doc.setTextColor(26, 26, 26);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(riskLines, rx, ry + 12);
    rx += colW.risk;

    // Rating chip
    ratingChip(doc, rx, ry + 14, String(it.rating ?? 'Medium'), 8);
    rx += colW.rating;

    // Confidence chip
    confidenceChip(doc, rx, ry + 14, String(it.confidence ?? 'Indicative'), 7.5);
    rx += colW.conf;

    // Why
    doc.setTextColor(60, 60, 60);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(whyLines, rx, ry + 12);
    rx += colW.why;

    // DD action
    doc.setTextColor(60, 60, 60);
    doc.text(ddLines, rx, ry + 12);

    ry += rowH;
  });

  // Border
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, ry - y, 'S');
}
