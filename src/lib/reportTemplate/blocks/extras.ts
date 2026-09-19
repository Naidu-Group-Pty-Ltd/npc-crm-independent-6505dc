/**
 * Phase 3 — jsPDF placeholder for new HTML-first block types.
 * The HTML pipeline (WeasyPrint) is the primary renderer for these blocks;
 * the jsPDF stub keeps the legacy preview surface from crashing.
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';

export function drawExtrasPlaceholder(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? page.width - 48);
  const h = Number(p.height ?? 80);

  doc.setFillColor(244, 240, 230);
  doc.roundedRect(x, y, w, h, 4, 4, 'F');
  doc.setDrawColor(191, 155, 80);
  doc.setLineDashPattern([3, 3], 0);
  doc.roundedRect(x, y, w, h, 4, 4, 'S');
  doc.setLineDashPattern([], 0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(122, 91, 0);
  doc.text(`Block "${block.type}" renders in HTML/PDF pipeline`, x + 12, y + 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Export via the HTML→PDF renderer to see the full design.', x + 12, y + 34);
}
