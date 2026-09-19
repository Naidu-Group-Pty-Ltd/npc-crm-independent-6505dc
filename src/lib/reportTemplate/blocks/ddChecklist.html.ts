import type { Block } from '../templateSchema';
import { resolveBindable } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';

interface DDItem { action: string; owner?: string; timing?: string; done?: boolean }

export function renderDDChecklistHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? ctx.page.width - 48);
  const title = resolveBindable(p.title ?? 'Due-Diligence Checklist', ctx);
  const items = Array.isArray(p.items) ? (p.items as DDItem[]) : [];

  const rows = items.map((it, i) => {
    const meta: string[] = [];
    if (it.owner) meta.push(`Owner: ${resolveBindable(it.owner, ctx)}`);
    if (it.timing) meta.push(`Timing: ${resolveBindable(it.timing, ctx)}`);
    const checkbox = it.done
      ? `<span style="display:inline-block;width:10pt;height:10pt;border:0.8pt solid #16A34A;background:#16A34A;color:#fff;font-size:8pt;text-align:center;line-height:10pt;font-weight:700;">✓</span>`
      : `<span style="display:inline-block;width:10pt;height:10pt;border:0.8pt solid #3C3C3C;"></span>`;
    return `<div style="display:flex;gap:10pt;align-items:flex-start;padding:8pt 12pt;background:${i % 2 === 0 ? '#FCFAF6' : '#FFFFFF'};">
      ${checkbox}
      <div style="flex:1;">
        <div style="color:#1A1A1A;font-weight:700;font-size:9.5pt;">${esc(resolveBindable(it.action ?? '', ctx))}</div>
        ${meta.length ? `<div style="color:#6E6E6E;font-size:8pt;margin-top:2pt;">${esc(meta.join('   ·   '))}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;border:0.5pt solid #DCDCDC;">
    <div style="background:#1A1A1A;color:#BF9B50;font-weight:700;font-size:10pt;padding:6pt 12pt;text-transform:uppercase;">${esc(title)}</div>
    ${rows}
  </div>`;
}
