import type { Block } from '../templateSchema';
import { resolveBindable } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';

interface AmenityItem { amenity: string; current: string; future: string; relevance: string }

export function renderAmenityMatrixHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? ctx.page.width - 48);
  const title = resolveBindable(p.title ?? 'Amenity & Livability Matrix', ctx);
  const items = Array.isArray(p.items) ? (p.items as AmenityItem[]) : [];

  const header = `<tr style="background:#F4F0E6;color:#3C3C3C;font-weight:700;font-size:7.5pt;text-transform:uppercase;">
    <th style="padding:6pt 8pt;text-align:left;width:22%;">Amenity</th>
    <th style="padding:6pt 8pt;text-align:left;width:26%;">Current state</th>
    <th style="padding:6pt 8pt;text-align:left;width:26%;">Future state</th>
    <th style="padding:6pt 8pt;text-align:left;width:26%;">Investor relevance</th>
  </tr>`;
  const rows = items.map((it, i) => `
    <tr style="background:${i % 2 === 1 ? '#FCFAF6' : '#FFFFFF'};vertical-align:top;font-size:8.5pt;">
      <td style="padding:8pt;font-weight:700;color:#1A1A1A;">${esc(resolveBindable(it.amenity ?? '', ctx))}</td>
      <td style="padding:8pt;color:#3C3C3C;line-height:1.35;">${esc(resolveBindable(it.current ?? '', ctx))}</td>
      <td style="padding:8pt;color:#3C3C3C;line-height:1.35;">${esc(resolveBindable(it.future ?? '', ctx))}</td>
      <td style="padding:8pt;color:#3C3C3C;line-height:1.35;">${esc(resolveBindable(it.relevance ?? '', ctx))}</td>
    </tr>`).join('');

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;border:0.5pt solid #DCDCDC;">
    <div style="background:#1A1A1A;color:#BF9B50;font-weight:700;font-size:10pt;padding:6pt 12pt;text-transform:uppercase;">${esc(title)}</div>
    <table style="width:100%;border-collapse:collapse;">${header}${rows}</table>
  </div>`;
}
