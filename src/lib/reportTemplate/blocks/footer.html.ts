import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { esc, type HtmlBlockContext } from './_shared.html';

export function renderFooterHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const h = Number(p.height ?? 28);
  const bg = resolveBindableColor(p.bg ?? 'token:bg', ctx, '#0D0D0D');
  const color = resolveBindableColor(p.color ?? 'token:muted', ctx, '#999999');
  const text = resolveBindable(p.text, ctx);
  const align = (p.align as string) || 'center';
  // A footer that sits on the paper reads as part of the page; one that fills
  // with `token:bg` reads as a slab. Templates that want the rule opt in.
  const rule = p.ruleColor
    ? `border-top:0.5pt solid ${resolveBindableColor(p.ruleColor, ctx, '#DCDCDC')};`
    : '';
  // How far in from the page edge the footer — and therefore its rule — sits.
  //
  // Defaults to the 24pt this block has always used. A template whose margin is
  // not 24pt needs to say so, or the footer rule spans a different measure from
  // the content above it: on a 20mm page that is a 33pt discrepancy, which
  // reads as a mistake on a document whose whole argument is precision.
  const inset = Number.isFinite(Number(p.inset)) ? Number(p.inset) : 24;
  const size = Number(p.fontSize ?? 8);
  return `<div style="position:absolute;left:${inset}pt;right:${inset}pt;bottom:0;height:${h}pt;background:${bg};color:${color};${rule}display:flex;align-items:center;justify-content:${align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center'};font-size:${size}pt;">
    ${text ? esc(text) : ''}
  </div>`;
}
