import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import {
  esc, fontFamilyDecl, trackingDecl, type HtmlBlockContext,
} from './_shared.html';

/**
 * A banner band.
 *
 * ## Why this block gained a background colour
 *
 * It drew an image and a tint over it, and nothing else — so a hero with no
 * `imageUrl` rendered as transparent text on whatever was behind it. That is a
 * real gap rather than a design choice: a *band* is the primitive the approved
 * Investment Compass catalogue reaches for repeatedly. Wealth Management opens
 * every page on one (`section_header_style: band_header`), and eleven of the
 * twenty-nine cover overlays are a field band at the head with paper below.
 *
 * `bg` defaults to transparent, so an existing image hero is unchanged.
 *
 * `eyebrow` and the `*Font` props follow the same pattern as `text-block`: a
 * band in a design family carries a tracked label, and before this it could
 * carry only a title and a subtitle in the default faces.
 *
 * ## `tintFade`
 *
 * The tint is a flat wash, which is right over a whole page and wrong over part
 * of one: a band tinted across the foot of a photograph draws a hard horizontal
 * edge through the picture, and the eye reads that edge as damage rather than
 * as design. The Luxury Editorial archetype scrims its plates with gradients
 * for exactly this reason.
 *
 * `tintFade` ramps the same tint from transparent at the top of the band to
 * full strength across the bottom two fifths, where the type sits. Both ends
 * are the one resolved token colour, so this stays a token and never becomes a
 * colour literal. It defaults off, so every existing hero is unchanged.
 */
export function renderHeroHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 0);
  const y = Number(p.y ?? 0);
  const w = Number(p.width ?? ctx.page.width);
  const h = Number(p.height ?? Math.min(280, ctx.page.height * 0.45));
  const align = (p.align as string) || 'left';
  const imageUrl = resolveBindable(p.imageUrl, ctx);
  const tint = p.tint ? resolveBindableColor(p.tint, ctx, 'transparent') : null;
  const titleColor = resolveBindableColor(p.titleColor ?? p.color ?? 'token:text', ctx, '#FFFFFF');
  const subColor = resolveBindableColor(p.subtitleColor ?? 'token:primary', ctx, '#BF9B50');
  const title = resolveBindable(p.title, ctx);
  const subtitle = resolveBindable(p.subtitle, ctx);
  const eyebrow = resolveBindable(p.eyebrow, ctx);
  const titleSize = Number(p.titleSize ?? 32);
  const subSize = Number(p.subtitleSize ?? 14);
  const eyebrowSize = Number(p.eyebrowSize ?? 8);

  // Transparent by default: this block has never painted a ground, and an
  // existing image hero must not acquire one.
  const bg = p.bg ? resolveBindableColor(p.bg, ctx, 'transparent') : null;
  const eyebrowColor = resolveBindableColor(p.eyebrowColor ?? 'token:primary', ctx, '#BF9B50');
  const titleFont = fontFamilyDecl(p.titleFont, 'var(--font-heading, Helvetica)');
  const subtitleFont = fontFamilyDecl(p.subtitleFont);
  const eyebrowFont = fontFamilyDecl(p.eyebrowFont);
  const eyebrowTracking = trackingDecl(p.eyebrowTracking, 0.18);
  const padding = Number.isFinite(Number(p.padding)) ? Number(p.padding) : 24;

  const bgLayer = bg ? `<div style="position:absolute;inset:0;background:${bg};"></div>` : '';
  const bgImg = imageUrl
    ? `<div style="position:absolute;inset:0;background:url('${esc(imageUrl)}') center/cover no-repeat;"></div>`
    : '';
  const tintPaint = tint && p.tintFade
    ? `linear-gradient(to bottom, transparent 0%, ${tint} 60%, ${tint} 100%)`
    : tint;
  const tintLayer = tint
    ? `<div style="position:absolute;inset:0;background:${tintPaint};opacity:0.55;"></div>`
    : '';
  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;height:${h}pt;overflow:hidden;">
    ${bgLayer}${bgImg}${tintLayer}
    <div style="position:absolute;left:${padding}pt;right:${padding}pt;bottom:${padding}pt;text-align:${align};">
      ${eyebrow ? `<div style="color:${eyebrowColor};font-size:${eyebrowSize}pt;font-weight:700;text-transform:uppercase;${eyebrowTracking}margin-bottom:6pt;${eyebrowFont}">${esc(eyebrow)}</div>` : ''}
      ${title ? `<div style="color:${titleColor};font-weight:700;font-size:${titleSize}pt;line-height:1.1;${titleFont}">${esc(title)}</div>` : ''}
      ${subtitle ? `<div style="color:${subColor};font-size:${subSize}pt;margin-top:6pt;${subtitleFont}">${esc(subtitle)}</div>` : ''}
    </div>
  </div>`;
}
