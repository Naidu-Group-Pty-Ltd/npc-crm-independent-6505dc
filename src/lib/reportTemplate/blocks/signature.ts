/**
 * Signature block — signature line, name, role, date.
 *
 * Props: x, y, width, signerName, signerRole, dateLabel, lineColor
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';

export function drawSignatureBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 700);
  const w = Number(p.width ?? 240);

  const lc = hex(resolveBindableColor(p.lineColor ?? 'token:text', ctx, '#1A1A1A'));
  doc.setDrawColor(lc.r, lc.g, lc.b);
  doc.setLineWidth(0.6);
  doc.line(x, y, x + w, y);

  const tc = hex(resolveBindableColor(p.color ?? 'token:text', ctx, '#1A1A1A'));
  const mc = hex(resolveBindableColor(p.mutedColor ?? 'token:muted', ctx, '#888'));

  doc.setTextColor(tc.r, tc.g, tc.b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(Number(p.nameSize ?? 11));
  const name = resolveBindable(p.signerName ?? '{{client.name}}', ctx);
  if (name) doc.text(name, x, y + 14);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(mc.r, mc.g, mc.b);
  doc.setFontSize(Number(p.roleSize ?? 9));
  const role = resolveBindable(p.signerRole ?? 'Signed', ctx);
  if (role) doc.text(role, x, y + 26);

  const date = resolveBindable(p.dateLabel ?? 'Date: ____________', ctx);
  if (date) doc.text(date, x + w, y + 14, { align: 'right' });
}

function hex(s: string) {
  let h = s.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
