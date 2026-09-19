import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';

export function renderTwoColumnHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 24);
  const w = Number(p.width ?? ctx.page.width - 48);
  const gap = Number(p.gap ?? 16);
  const ratio = Math.max(0.1, Math.min(0.9, Number(p.ratio ?? 0.5)));
  const headingColor = resolveBindableColor(p.headingColor ?? 'token:primary', ctx, '#BF9B50');
  const bodyColor = resolveBindableColor(p.bodyColor ?? 'token:text', ctx, '#1A1A1A');
  const hSize = Number(p.headingSize ?? 14);
  const bSize = Number(p.bodySize ?? 10);

  const col = (heading: unknown, body: unknown) => {
    const h = resolveBindable(heading, ctx);
    const b = resolveBindable(body, ctx);
    return `<div>
      ${h ? `<div style="color:${headingColor};font-weight:700;font-size:${hSize}pt;margin-bottom:6pt;font-family:var(--font-heading, Helvetica);">${esc(h)}</div>` : ''}
      ${b ? `<div style="color:${bodyColor};font-size:${bSize}pt;line-height:1.4;white-space:pre-wrap;">${esc(b)}</div>` : ''}
    </div>`;
  };

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;display:grid;grid-template-columns:${ratio * 100}% ${(1 - ratio) * 100}%;gap:${gap}pt;">
    ${col(p.leftHeading, p.leftBody)}
    ${col(p.rightHeading, p.rightBody)}
  </div>`;
}
