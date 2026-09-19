import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { boundValueResolved } from '../boundValuePresence';
import {
  esc, fontFamilyDecl, trackingDecl, type HtmlBlockContext,
} from './_shared.html';

const MAX_WORDS = 60;
function cap(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= maxWords ? text : words.slice(0, maxWords).join(' ') + '…';
}

/**
 * The decision box — the recommendation, set apart.
 *
 * ## Why the colours became props
 *
 * The panel was `#FCFAF6` and the body `#1A1A1A`, both literals in the
 * renderer. Under the Investment Compass colourway system that makes this block
 * the one element on the page that ignores the palette: a Midnight Navy or
 * Obsidian Reverse report would print a warm off-white recommendation card.
 * Every colour now defaults to the literal it replaced, so an existing template
 * is unchanged, and a template that passes `token:*` follows its colourway.
 *
 * `recommendation_style: obsidian_card` in the approved catalogue is exactly
 * this block with `bg: token:bg` — the one place a content page carries the
 * cover's ground.
 *
 * `maxWords` is exposed for the same reason: the 60-word cap is right for a
 * generated verdict and wrong for a recommendation an adviser wrote, and
 * silently truncating a client-facing sentence at word 61 is not a default
 * anyone should be unable to change.
 */
export function renderDecisionBoxHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? ctx.page.width - 48);
  const heading = resolveBindable(p.heading ?? 'What this means', ctx);
  const maxWords = Number(p.maxWords) > 0 ? Number(p.maxWords) : MAX_WORDS;
  const body = cap(resolveBindable(p.body ?? '', ctx), maxWords);
  // A box whose heading and body are bound and received nothing is a tinted
  // panel with an accent bar and no recommendation in it — measured on a
  // record with none (RS-3, 14 Sep 2026). It draws nothing; a static heading
  // or body is an author's own words and keeps the box.
  const bound = (v: unknown) => typeof v === 'string' && v.includes('{{');
  const headingSaysNothing = !heading || (bound(p.heading) && !boundValueResolved(p.heading, ctx));
  const bodySaysNothing = !body || (bound(p.body) && !boundValueResolved(p.body, ctx));
  if ((bound(p.heading) || bound(p.body)) && headingSaysNothing && bodySaysNothing) return '';
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');

  const bg = resolveBindableColor(p.bg ?? '#FCFAF6', ctx, '#FCFAF6');
  const color = resolveBindableColor(p.color ?? '#1A1A1A', ctx, '#1A1A1A');
  const headingColor = resolveBindableColor(p.headingColor ?? p.accent ?? 'token:primary', ctx, accent);
  const radius = Number.isFinite(Number(p.radius)) ? Number(p.radius) : 6;
  const barWidth = Number.isFinite(Number(p.barWidth)) ? Number(p.barWidth) : 4;
  const headingFont = fontFamilyDecl(p.headingFont);
  const bodyFont = fontFamilyDecl(p.bodyFont);
  const headingSize = Number(p.headingSize ?? 9);
  const bodySize = Number(p.bodySize ?? 10);
  const headingTracking = trackingDecl(p.headingTracking, 0.06);

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;background:${bg};border-radius:${radius}pt;border-left:${barWidth}pt solid ${accent};padding:12pt 16pt;">
    <div style="color:${headingColor};font-weight:700;font-size:${headingSize}pt;text-transform:uppercase;${headingTracking}margin-bottom:6pt;${headingFont}">${esc(heading)}</div>
    ${body ? `<div style="color:${color};font-size:${bodySize}pt;line-height:1.4;${bodyFont}">${esc(body)}</div>` : ''}
  </div>`;
}
