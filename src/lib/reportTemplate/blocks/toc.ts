/**
 * Table-of-Contents — auto-derived from template page names (passed via ctx.pages).
 *
 * Props: title, x, y, width, color, indexColor, dotted?
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { fitTocEntries, splitTocColumns, tocOmittedLine } from './tocFit';

export function drawTocBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page, pages = [] } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  let y = Number(p.y ?? 80);
  const w = Number(p.width ?? page.width - 48);

  const title = resolveBindable(p.title ?? 'Contents', ctx);
  if (title) {
    const c = hex(resolveBindableColor(p.titleColor ?? 'token:primary', ctx, '#BF9B50'));
    doc.setTextColor(c.r, c.g, c.b);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(Number(p.titleSize ?? 22));
    doc.text(title, x, y);
    y += Number(p.titleSize ?? 22) + 14;
  }

  const c = hex(resolveBindableColor(p.color ?? 'token:text', ctx, '#1A1A1A'));
  const idxC = hex(resolveBindableColor(p.indexColor ?? 'token:muted', ctx, '#888'));
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(Number(p.size ?? 11));

  // A continuation folds into the entry above it, exactly as the HTML renderer
  // does — the Builder preview must not disagree with the printed document
  // about how many sections a report has. See `PageSchema.tocContinues`.
  const entries = pages
    .map((pg, i) => ({ pg, i }))
    .filter(({ pg, i }) => i === 0 || pg.tocContinues !== true);

  // The same fit the printed document takes (`tocFit.ts`), so the preview and
  // the PDF agree about the columns, the size and what was cut.
  const lh = Number(p.lineHeight ?? 18);
  const size = Number(p.size ?? 11);
  const fit = fitTocEntries({
    entries: entries.length,
    availablePt: page.height - y - Number(p.bottomReserve ?? 64),
    titlePt: 0,
    lineHeightPt: lh,
    sizePt: size,
  });
  doc.setFontSize(fit.sizePt);
  const lines = entries.slice(0, fit.shown).map(({ pg, i }, n) => ({
    label: `${n + 1}. ${pg.name || `Page ${i + 1}`}`, page: String(i + 1),
  }));
  if (fit.omitted) lines.push({ label: tocOmittedLine(fit.omitted), page: '' });
  const columns = splitTocColumns(lines, fit.columns);
  const gap = 18;
  const colW = fit.columns === 1 ? w : (w - gap) / 2;
  columns.forEach((col, ci) => {
    const cx = x + ci * (colW + gap);
    let cy = y;
    col.forEach((line) => {
      doc.setTextColor(c.r, c.g, c.b);
      doc.text(line.label, cx, cy, { maxWidth: colW - 24 });
      doc.setTextColor(idxC.r, idxC.g, idxC.b);
      if (line.page) doc.text(line.page, cx + colW, cy, { align: 'right' });
      cy += fit.lineHeightPt;
    });
  });
}

function hex(s: string) {
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
