/**
 * Data-table block — header + rows. Each cell is a bindable string.
 *
 * Props:
 *   x,y,width: layout
 *   rowHeight?: pt (default 22)
 *   headers: string[]
 *   rows: Array<{ cells: string[]; when?: string }>
 *   columnWidths?: number[]   // fractions summing to 1; defaults to equal
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { rowsWithSomethingToSay, type TableRow } from './_data';

export function drawDataTableBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 24);
  const w = Number(p.width ?? page.width - 48);
  const rowH = Number(p.rowHeight ?? 22);

  const headers = Array.isArray(p.headers) ? (p.headers as string[]) : [];
  // The same per-row filter the HTML renderer applies, through the same helper,
  // so the Builder preview cannot disagree with the printed document about
  // which rows exist.
  const authored = Array.isArray(p.rows) ? (p.rows as TableRow[]) : [];
  // The same row rule the HTML twin applies, so the preview and the final
  // document agree about which rows exist. See `rowsWithSomethingToSay`.
  const said = rowsWithSomethingToSay(authored, ctx);
  if (authored.length > 0 && (said.rows.length === 0 || !said.saysSomething)) return;
  const rows = said.rows.map(({ row }) => row);
  if (headers.length === 0) return;

  const widths: number[] = Array.isArray(p.columnWidths) && (p.columnWidths as number[]).length === headers.length
    ? (p.columnWidths as number[]).map((f) => f * w)
    : headers.map(() => w / headers.length);

  const headerBg = hex(resolveBindableColor(p.headerBg ?? 'token:primary', ctx, '#BF9B50'));
  const headerFg = hex(resolveBindableColor(p.headerFg ?? '#FFFFFF', ctx, '#FFFFFF'));
  const stripeBg = hex(resolveBindableColor(p.stripeBg ?? '#F4F0E6', ctx, '#F4F0E6'));
  const cellFg = hex(resolveBindableColor(p.cellFg ?? '#1A1A1A', ctx, '#1A1A1A'));

  // Header
  doc.setFillColor(headerBg.r, headerBg.g, headerBg.b);
  doc.rect(x, y, w, rowH, 'F');
  doc.setTextColor(headerFg.r, headerFg.g, headerFg.b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  let cx = x;
  headers.forEach((h, i) => {
    // Resolved, for the reason the HTML renderer's copy of this records: every
    // body cell went through `resolveBindable` and the headers did not, so a
    // bound header printed as a literal `{{…}}`.
    doc.text(resolveBindable(h, ctx).toUpperCase(), cx + 6, y + rowH / 2, { baseline: 'middle', maxWidth: widths[i] - 12 });
    cx += widths[i];
  });

  // Rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  rows.forEach((row, rIdx) => {
    const ry = y + rowH * (rIdx + 1);
    if (rIdx % 2 === 1) {
      doc.setFillColor(stripeBg.r, stripeBg.g, stripeBg.b);
      doc.rect(x, ry, w, rowH, 'F');
    }
    doc.setTextColor(cellFg.r, cellFg.g, cellFg.b);
    let rx = x;
    (row.cells || []).forEach((cell, i) => {
      const text = resolveBindable(cell, ctx);
      if (i < widths.length) {
        doc.text(text, rx + 6, ry + rowH / 2, { baseline: 'middle', maxWidth: widths[i] - 12 });
        rx += widths[i];
      }
    });
  });

  // Outer border
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.rect(x, y, w, rowH * (rows.length + 1), 'S');
}

function hex(s: string) {
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
