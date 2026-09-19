/**
 * Phase 8 — auto-toc block
 *
 * Walks all visible pages and lists every block with a `bookmark`, producing
 * a printable table-of-contents with page numbers and clickable anchors.
 */
import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';
import { fitTocEntries, splitTocColumns, tocOmittedLine } from './tocFit';

type R = Record<string, unknown>;

export function renderAutoTocHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as R;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? ctx.page.width - 48);
  const title = String(p.title ?? 'Contents');
  const titleSize = Number(p.titleSize ?? 22);
  const size = Number(p.size ?? 11);
  const lineHeight = Number(p.lineHeight ?? 20);
  const indent = Number(p.indent ?? 12);
  const color = resolveBindableColor(p.color ?? 'token:text', ctx, '#0F172A');
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const dotted = p.dotLeader !== false;

  // ctx provides `pages` (id+name). We need the full block list, exposed via ctx.slots? No.
  // Walk via globally exposed `__tocEntries` on data set by the renderer.
  const entries: Array<{ label: string; level: number; pageIndex: number; anchor: string }> =
    Array.isArray((ctx.data as any).__tocEntries) ? (ctx.data as any).__tocEntries : [];

  const filtered = entries.filter((e) => p.maxLevel ? e.level <= Number(p.maxLevel) : true);

  // Fits the page it is printed on, like `toc.html.ts` — see `tocFit.ts`.
  const fit = fitTocEntries({
    entries: filtered.length,
    availablePt: ctx.page.height - y - Number(p.bottomReserve ?? 64),
    titlePt: title ? titleSize + 14 : 0,
    lineHeightPt: lineHeight, sizePt: size,
  });
  const leader = dotted
    ? `<span style="flex:1;border-bottom:1pt dotted ${color}40;margin:0 6pt 4pt;"></span>`
    : `<span style="flex:1;"></span>`;
  const rowsOf = (list: typeof filtered) => list
    .map((e) => {
      const pad = (e.level - 1) * indent;
      return `<a href="#${esc(e.anchor)}" style="display:flex;align-items:flex-end;color:${color};text-decoration:none;font:${e.level === 1 ? '600' : '400'} ${fit.sizePt.toFixed(2)}pt Helvetica;line-height:${fit.lineHeightPt.toFixed(2)}pt;padding-left:${pad}pt;">
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(e.label)}</span>${leader}<span style="color:${accent};font-variant-numeric:tabular-nums;">${e.pageIndex + 1}</span>
      </a>`;
    })
    .join('');
  const shown = filtered.slice(0, fit.shown);
  const columns = splitTocColumns(shown, fit.columns).map(rowsOf);
  const omitted = fit.omitted
    ? `<div style="font:400 ${fit.sizePt.toFixed(2)}pt Helvetica;line-height:${fit.lineHeightPt.toFixed(2)}pt;color:${color};">${esc(tocOmittedLine(fit.omitted))}</div>`
    : '';
  const rows = fit.columns === 1
    ? columns[0] + omitted
    : `<div style="display:flex;gap:18pt;align-items:flex-start;">${columns.map((c, ci) => `<div style="flex:1 1 0;min-width:0;">${c}${ci === columns.length - 1 ? omitted : ''}</div>`).join('')}</div>`;

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;">
    ${title ? `<div style="font:700 ${titleSize}pt Helvetica;color:${color};margin-bottom:14pt;letter-spacing:0.4pt;">${esc(title)}</div>` : ''}
    ${rows || `<div style="font-style:italic;color:${color}80;font-size:${size}pt;">No bookmarks yet — set <code>bookmark.name</code> on a block to populate.</div>`}
  </div>`;
}
