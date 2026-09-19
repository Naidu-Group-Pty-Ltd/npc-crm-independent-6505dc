import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';

export function renderBadgeListHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const items = Array.isArray(p.items) ? (p.items as unknown[]) : [];
  if (!items.length) return '';
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 320);
  const w = Number(p.width ?? ctx.page.width - 48);
  const gap = Number(p.gap ?? 6);
  const padX = Number(p.paddingX ?? 8);
  const padY = Number(p.paddingY ?? 4);
  const size = Number(p.fontSize ?? 9);
  const radius = Number(p.radius ?? 10);
  const bg = resolveBindableColor(p.bg ?? 'token:primary', ctx, '#BF9B50');
  const color = resolveBindableColor(p.color ?? '#FFFFFF', ctx, '#FFFFFF');

  const chips = items.map((raw) => {
    const t = resolveBindable(String(raw ?? ''), ctx);
    if (!t) return '';
    return `<span style="background:${bg};color:${color};font-weight:700;font-size:${size}pt;padding:${padY}pt ${padX}pt;border-radius:${radius}pt;display:inline-block;">${esc(t)}</span>`;
  }).join('');

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;display:flex;flex-wrap:wrap;gap:${gap}pt;">${chips}</div>`;
}
