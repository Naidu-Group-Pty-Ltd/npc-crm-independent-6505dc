import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';

export function renderSignatureHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 700);
  const w = Number(p.width ?? 240);
  const lineColor = resolveBindableColor(p.lineColor ?? 'token:text', ctx, '#1A1A1A');
  const color = resolveBindableColor(p.color ?? 'token:text', ctx, '#1A1A1A');
  const muted = resolveBindableColor(p.mutedColor ?? 'token:muted', ctx, '#888');
  const name = resolveBindable(p.signerName ?? '{{client.name}}', ctx);
  const role = resolveBindable(p.signerRole ?? 'Signed', ctx);
  const date = resolveBindable(p.dateLabel ?? 'Date: ____________', ctx);

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;">
    <div style="border-top:0.6pt solid ${lineColor};padding-top:4pt;display:flex;justify-content:space-between;">
      <div>
        <div style="color:${color};font-weight:700;font-size:11pt;">${esc(name)}</div>
        <div style="color:${muted};font-size:9pt;margin-top:2pt;">${esc(role)}</div>
      </div>
      <div style="color:${muted};font-size:9pt;">${esc(date)}</div>
    </div>
  </div>`;
}
