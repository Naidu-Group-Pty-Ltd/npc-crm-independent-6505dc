import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { imgTag, esc, absBoxStyle, type HtmlBlockContext } from './_shared.html';

interface Item { src: string; caption?: string; alt?: string }

export function renderGalleryHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const items = Array.isArray(p.items) ? (p.items as Item[]) : [];
  if (!items.length) return '';
  const cols = Math.max(1, Math.min(6, Number(p.columns ?? Math.min(items.length, 3))));
  const gap = Number(p.gap ?? 8);
  const capColor = resolveBindableColor(p.captionColor ?? 'token:muted', ctx, '#666');
  const style = absBoxStyle(p, { x: 24, y: 24, w: ctx.page.width - 48, h: 260 });

  const tiles = items.map((it) => {
    const src = resolveBindable(it.src, ctx);
    const cap = resolveBindable(it.caption, ctx);
    const inner = src
      ? imgTag(src, {
        alt: resolveBindable(it.alt, ctx) || cap,
        style: 'width:100%;flex:1;object-fit:cover;',
      })
      : `<div style="width:100%;flex:1;border:1pt solid #ddd;"></div>`;
    return `<div style="display:flex;flex-direction:column;">
      ${inner}
      ${cap ? `<div style="font-style:italic;font-size:7.5pt;color:${capColor};margin-top:2pt;">${esc(cap)}</div>` : ''}
    </div>`;
  }).join('');

  return `<div style="${style}display:grid;grid-template-columns:repeat(${cols}, 1fr);gap:${gap}pt;">
    ${tiles}
  </div>`;
}
