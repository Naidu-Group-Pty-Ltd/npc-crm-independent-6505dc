/**
 * Two-column block — side-by-side bodies with optional headings.
 * Props: x,y,width, height?, gap?, ratio? (0..1, left col fraction),
 *        leftHeading, leftBody, rightHeading, rightBody
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';

export function drawTwoColumnBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 24);
  const w = Number(p.width ?? page.width - 48);
  const gap = Number(p.gap ?? 16);
  const ratio = Math.max(0.1, Math.min(0.9, Number(p.ratio ?? 0.5)));
  const lw = (w - gap) * ratio;
  const rw = (w - gap) * (1 - ratio);

  drawColumn(x, y, lw, p.leftHeading, p.leftBody, p, ctx);
  drawColumn(x + lw + gap, y, rw, p.rightHeading, p.rightBody, p, ctx);
}

function drawColumn(
  x: number, y: number, w: number,
  heading: unknown, body: unknown,
  p: Record<string, unknown>,
  ctx: BlockRenderContext,
) {
  const { doc } = ctx;
  let cursor = y;
  const h = resolveBindable(heading, ctx);
  if (h) {
    const c = hex(resolveBindableColor(p.headingColor ?? 'token:primary', ctx, '#BF9B50'));
    doc.setTextColor(c.r, c.g, c.b);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(Number(p.headingSize ?? 14));
    doc.text(h, x, cursor + Number(p.headingSize ?? 14), { maxWidth: w });
    cursor += Number(p.headingSize ?? 14) + 8;
  }
  const b = resolveBindable(body, ctx);
  if (b) {
    const size = Number(p.bodySize ?? 10);
    const c = hex(resolveBindableColor(p.bodyColor ?? 'token:text', ctx, '#1A1A1A'));
    doc.setTextColor(c.r, c.g, c.b);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    const wrapped = doc.splitTextToSize(b, w);
    doc.text(wrapped, x, cursor + size, { lineHeightFactor: 1.4, maxWidth: w });
  }
}

function hex(s: string) {
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
