import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { imgTag, esc, absBoxStyle, type HtmlBlockContext } from './_shared.html';

export function renderChartHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const url = resolveBindable(p.chartUrl, ctx);
  const caption = resolveBindable(p.caption, ctx);
  const capColor = resolveBindableColor(p.captionColor ?? 'token:muted', ctx, '#666');
  const style = absBoxStyle(p, { x: 24, y: 24, w: ctx.page.width - 48, h: 240 });
  const imgH = caption ? 'calc(100% - 18pt)' : '100%';
  // No image, no block. This used to draw a bordered "Chart unavailable"
  // panel, which is a placeholder on a client's page — exactly the structured
  // absence the report rules forbid. An unresolved chart is omitted.
  if (!url) return '';
  const inner = imgTag(url, {
    alt: resolveBindable(p.alt, ctx) || caption || 'Chart',
    style: `width:100%;height:${imgH};object-fit:contain;`,
  });
  return `<div style="${style}">
    ${inner}
    ${caption ? `<div style="text-align:center;font-style:italic;font-size:8pt;color:${capColor};margin-top:4pt;">${esc(caption)}</div>` : ''}
  </div>`;
}
