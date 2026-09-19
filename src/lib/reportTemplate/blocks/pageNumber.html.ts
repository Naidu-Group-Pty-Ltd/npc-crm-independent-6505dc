import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';

export function renderPageNumberHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const text = resolveBindable(p.text ?? 'Page {{pageNumber}} of {{pageCount}}', ctx);
  if (!text) return '';
  const color = resolveBindableColor(p.color ?? 'token:muted', ctx, '#999999');
  const align = (p.align as string) ?? 'center';
  const y = Number(p.y ?? ctx.page.height - 20);
  const size = Number(p.size ?? 8);
  // Matches `footer`'s `inset`, so a page number sitting on the footer line
  // lands on the same measure as the rule above it rather than 24pt from the
  // paper edge.
  const inset = Number.isFinite(Number(p.inset)) ? Number(p.inset) : 24;
  const horiz = align === 'left' ? `left:${inset}pt;` : align === 'right' ? `right:${inset}pt;` : 'left:0;right:0;text-align:center;';
  return `<div style="position:absolute;top:${y}pt;${horiz}color:${color};font-size:${size}pt;">${esc(text)}</div>`;
}
