import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { encodeQrModules } from '../qrCodeEncoder';
import { esc, type HtmlBlockContext } from './_shared.html';

export function renderQrCodeHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 320);
  const size = Number(p.size ?? 120);
  const data = resolveBindable(p.data, ctx);
  const caption = resolveBindable(p.caption, ctx);
  const capColor = resolveBindableColor(p.color ?? 'token:muted', ctx, '#666');
  const modules = data ? encodeQrModules(data) : [];
  const path = modules.flatMap((row, y) => row.flatMap((dark, x) => dark ? [`M${x} ${y}h1v1H${x}z`] : [])).join('');
  const inner = modules.length
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${modules.length + 4} ${modules.length + 4}" shape-rendering="crispEdges" style="width:${size}pt;height:${size}pt;background:#fff;"><path d="${path}"/></svg>`
    : `<div style="width:${size}pt;height:${size}pt;border:1pt solid #ccc;display:flex;align-items:center;justify-content:center;color:#999;">QR</div>`;
  return `<div style="position:absolute;left:${x}pt;top:${y}pt;text-align:center;">
    ${inner}
    ${caption ? `<div style="color:${capColor};font-size:${Number(p.captionSize ?? 9)}pt;margin-top:6pt;max-width:${size + 80}pt;">${esc(caption)}</div>` : ''}
  </div>`;
}
