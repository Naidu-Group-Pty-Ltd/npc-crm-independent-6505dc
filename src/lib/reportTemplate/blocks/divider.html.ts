import type { Block } from '../templateSchema';
import { resolveBindableColor } from '../bindingResolver';
import type { HtmlBlockContext } from './_shared.html';

/**
 * A rule.
 *
 * `orientation: 'vertical'` is additive — omit it and this draws exactly the
 * horizontal rule it always has. It exists because a rule running down the page
 * is a structural element in the approved catalogue rather than a decoration:
 * Private Banking's Bullion Rail declares `navigation_style: vertical_rail`, a
 * gold rail carrying the part number and section name down every page, and
 * there was no primitive that could draw one.
 *
 * A vertical rule takes its extent from `height` (falling back to `length`),
 * because `width` means the rule's weight in that orientation and reusing it
 * for both would make the prop mean two things.
 */
export function renderDividerHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 0);
  const t = Number(p.thickness ?? 1);
  const style = (p.style as string) ?? 'solid';
  const color = resolveBindableColor(p.color ?? 'token:muted', ctx, '#999999');

  if (p.orientation === 'vertical') {
    const h = Number(p.height ?? p.length ?? ctx.page.height - Number(y) - 48);
    return `<div style="position:absolute;left:${x}pt;top:${y}pt;height:${h}pt;border-left:${t}pt ${style} ${color};"></div>`;
  }

  const w = Number(p.width ?? ctx.page.width - 48);
  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;border-top:${t}pt ${style} ${color};"></div>`;
}
