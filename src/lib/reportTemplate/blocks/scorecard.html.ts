import type { Block } from '../templateSchema';
import { resolveBindable } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';
import { ratingChipHtml } from './_chips.html';

interface ScorecardItem { category: string; rating: string; note?: string }

export function renderScorecardHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? ctx.page.width - 48);
  const title = resolveBindable(p.title ?? 'Macro Investment Scorecard', ctx);
  const items = Array.isArray(p.items) ? (p.items as ScorecardItem[]) : [];

  const rows = items.map((it, i) => `
    <tr style="background:${i % 2 === 0 ? '#F8F6F0' : '#FFFFFF'};">
      <td style="padding:8pt 12pt;font-weight:700;color:#1A1A1A;font-size:10pt;width:38%;">${esc(it.category ?? '')}</td>
      <td style="padding:8pt 12pt;color:#555;font-size:8.5pt;">${esc(resolveBindable(it.note ?? '', ctx))}</td>
      <td style="padding:8pt 12pt;text-align:right;white-space:nowrap;">${ratingChipHtml(String(it.rating ?? 'Moderate'), 8, ctx)}</td>
    </tr>`).join('');

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;border:0.5pt solid #DCDCDC;">
    <div style="background:#1A1A1A;color:#BF9B50;font-weight:700;font-size:11pt;padding:6pt 12pt;text-transform:uppercase;">${esc(title)}</div>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
  </div>`;
}
