/**
 * Decision Box (Compass "What This Means" — max one per section, ≤60 words).
 * Compact accent-bar panel with single-line heading + short body.
 *
 * Props:
 *   x,y,width: layout
 *   heading?: string (default 'What this means')
 *   body: string (bindable; will be word-capped to ~60 words)
 *   accent?: color
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { hex } from './_shared';

const MAX_WORDS = 60;

function cap(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ') + '…';
}

export function drawDecisionBoxBlock(block: Block, ctx: BlockRenderContext): void {
  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? page.width - 48);
  const heading = resolveBindable(p.heading ?? 'What this means', ctx);
  const body = cap(resolveBindable(p.body ?? '', ctx), MAX_WORDS);
  const accent = hex(resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50'));

  const bodyLines = body ? doc.splitTextToSize(body, w - 28) : [];
  const h = 26 + bodyLines.length * 12 + 10;

  // Background
  doc.setFillColor(252, 250, 246);
  doc.roundedRect(x, y, w, h, 6, 6, 'F');
  // Accent bar
  doc.setFillColor(accent.r, accent.g, accent.b);
  doc.rect(x, y, 4, h, 'F');

  // Heading
  doc.setTextColor(accent.r, accent.g, accent.b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(String(heading).toUpperCase(), x + 16, y + 16);

  // Body
  if (bodyLines.length) {
    doc.setTextColor(26, 26, 26);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(bodyLines, x + 16, y + 30, { lineHeightFactor: 1.35, maxWidth: w - 28 });
  }
}
