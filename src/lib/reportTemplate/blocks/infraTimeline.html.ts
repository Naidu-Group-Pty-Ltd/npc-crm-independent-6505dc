import type { Block } from '../templateSchema';
import { resolveBindable } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';
import { confidenceChipHtml } from './_chips.html';

interface InfraItem { phase: string; label: string; year?: string | number; confidence?: string }

const PHASES = [
  { key: 'Existing', label: 'Existing' },
  { key: 'Short',    label: 'Short-term (0-2y)' },
  { key: 'Medium',   label: 'Medium-term (3-5y)' },
  { key: 'Long',     label: 'Long-term (5y+)' },
];

export function renderInfraTimelineHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? ctx.page.width - 48);
  const h = Number(p.height ?? 200);
  const title = resolveBindable(p.title ?? 'Infrastructure & Growth Pipeline', ctx);
  const items = Array.isArray(p.items) ? (p.items as InfraItem[]) : [];

  const grouped: Record<string, InfraItem[]> = {};
  PHASES.forEach((ph) => (grouped[ph.key] = []));
  items.forEach((it) => {
    const key = PHASES.find((ph) => ph.key.toLowerCase() === String(it.phase ?? '').toLowerCase())?.key ?? 'Existing';
    grouped[key].push(it);
  });

  const cols = PHASES.map((ph) => {
    const li = grouped[ph.key].map((it) => {
      const labelText = it.year ? `${esc(String(it.year))} · ${esc(resolveBindable(it.label, ctx))}` : esc(resolveBindable(it.label, ctx));
      return `<div style="margin-bottom:8pt;">
        <div style="color:#1A1A1A;font-weight:700;font-size:8.5pt;line-height:1.3;">${labelText}</div>
        ${it.confidence ? `<div style="margin-top:3pt;">${confidenceChipHtml(String(it.confidence), 7, ctx)}</div>` : ''}
      </div>`;
    }).join('');
    return `<div style="flex:1;padding:0 8pt;text-align:center;">
      <div style="color:#1A1A1A;font-weight:700;font-size:8.5pt;margin-bottom:6pt;">${esc(ph.label)}</div>
      <div style="width:8pt;height:8pt;background:#BF9B50;border-radius:50%;margin:0 auto 12pt;"></div>
      <div style="text-align:left;">${li}</div>
    </div>`;
  }).join('');

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;min-height:${h}pt;border:0.5pt solid #DCDCDC;">
    <div style="background:#1A1A1A;color:#BF9B50;font-weight:700;font-size:10pt;padding:6pt 12pt;text-transform:uppercase;">${esc(title)}</div>
    <div style="position:relative;padding:14pt 0;">
      <div style="position:absolute;left:8%;right:8%;top:46pt;height:1.2pt;background:#BF9B50;"></div>
      <div style="display:flex;position:relative;">${cols}</div>
    </div>
  </div>`;
}
