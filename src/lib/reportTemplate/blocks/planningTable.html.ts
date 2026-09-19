import type { Block } from '../templateSchema';
import { resolveBindable } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';
import { chip } from './_chips.html';

interface PlanningItem { item: string; status: string; relevance: string; action: string }

const STATUS_PALETTE: Record<string, { bg: string; fg: string }> = {
  Approved:  { bg: '#DCFCE7', fg: '#065F46' },
  Pending:   { bg: '#FEF3C7', fg: '#92400E' },
  Lodged:    { bg: '#DBEAFE', fg: '#1E3A8A' },
  Rejected:  { bg: '#FEE2E2', fg: '#991B1B' },
  Withdrawn: { bg: '#F3F4F6', fg: '#374151' },
};

export function renderPlanningTableHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? ctx.page.width - 48);
  const title = resolveBindable(p.title ?? 'Zoning & Planning — Action Table', ctx);
  const items = Array.isArray(p.items) ? (p.items as PlanningItem[]) : [];

  const header = `<tr style="background:#F4F0E6;color:#3C3C3C;font-weight:700;font-size:7.5pt;text-transform:uppercase;">
    <th style="padding:6pt 8pt;text-align:left;width:24%;">Item</th>
    <th style="padding:6pt 8pt;text-align:left;width:16%;">Status</th>
    <th style="padding:6pt 8pt;text-align:left;width:32%;">Investor relevance</th>
    <th style="padding:6pt 8pt;text-align:left;width:28%;">Action</th>
  </tr>`;
  const rows = items.map((it, i) => {
    const pal = STATUS_PALETTE[String(it.status ?? 'Pending')] ?? STATUS_PALETTE.Pending;
    return `<tr style="background:${i % 2 === 1 ? '#FCFAF6' : '#FFFFFF'};vertical-align:top;font-size:8.5pt;">
      <td style="padding:8pt;font-weight:700;color:#1A1A1A;">${esc(resolveBindable(it.item ?? '', ctx))}</td>
      <td style="padding:8pt;">${chip(String(it.status ?? 'Pending'), pal.bg, pal.fg)}</td>
      <td style="padding:8pt;color:#3C3C3C;line-height:1.35;">${esc(resolveBindable(it.relevance ?? '', ctx))}</td>
      <td style="padding:8pt;color:#3C3C3C;line-height:1.35;">${esc(resolveBindable(it.action ?? '', ctx))}</td>
    </tr>`;
  }).join('');

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;border:0.5pt solid #DCDCDC;">
    <div style="background:#1A1A1A;color:#BF9B50;font-weight:700;font-size:10pt;padding:6pt 12pt;text-transform:uppercase;">${esc(title)}</div>
    <table style="width:100%;border-collapse:collapse;">${header}${rows}</table>
  </div>`;
}
