import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { imgTag,
  esc, absBoxStyle, fontFamilyDecl, trackingDecl, type HtmlBlockContext,
} from './_shared.html';

/**
 * A picture, optionally captioned.
 *
 * ## `placeholder`
 *
 * An unresolved `src` draws a bordered box reading "No image". That is right in
 * the editor — a designer needs to see the slot they are meant to fill — and
 * wrong in a client's PDF, where it is a grey rectangle announcing a missing
 * photograph on a document somebody is paying for.
 *
 * The approved Investment Compass catalogue names this failure directly. Its
 * Luxury Editorial *Monograph* variant is described as "editorial typography
 * without image slots. **Empty plates never print as holes because there are
 * none**" — the design's answer was to remove the slots rather than risk the
 * hole. A template that keeps its slots needs the other half of that: a slot
 * that prints nothing when it is empty.
 *
 * `placeholder` defaults to `true`, so every existing template is unchanged.
 * The catalogue's plates set it false and additionally carry a `conditional`,
 * so an unbound plate is not rendered at all.
 */
export function renderImageBlockHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const src = resolveBindable(p.src, ctx);
  const caption = resolveBindable(p.caption, ctx);
  const fit = (p.fit as string) || 'cover';
  const capColor = resolveBindableColor(p.captionColor ?? 'token:muted', ctx, '#666');
  const style = absBoxStyle(p, { x: 24, y: 24, w: ctx.page.width - 48, h: 220 });

  const showPlaceholder = p.placeholder !== false;
  // An empty plate with no placeholder occupies its space and prints nothing —
  // no border, no label, no grey rectangle.
  if (!src && !showPlaceholder) return '';

  const captionSize = Number(p.captionSize ?? 8);
  const captionFont = fontFamilyDecl(p.captionFont);
  const captionTracking = trackingDecl(p.captionTracking);
  const captionStyle = p.captionStyle === 'normal' ? 'normal' : 'italic';
  const captionTransform = p.captionTransform === 'uppercase' ? 'text-transform:uppercase;' : '';
  const radius = Number.isFinite(Number(p.radius)) ? Number(p.radius) : 0;

  const capHeight = caption ? captionSize + 6 : 0;
  const imgH = caption ? `calc(100% - ${capHeight}pt)` : '100%';
  const inner = src
    ? imgTag(src, {
      // The author's `alt`, then the caption the page already prints, then the
      // block's own designer label. That last one is not a guess: it is text a
      // person wrote about this block — the catalogue names its cover monogram
      // "Brand mark" — and on the 36-page render it is the difference between
      // a reader being told "Brand mark" and being told the description is
      // missing. `MISSING_ALT` stays for a block with no name at all.
      alt: resolveBindable(p.alt, ctx) || caption || block.name,
      style: `width:100%;height:${imgH};object-fit:${fit};${radius ? `border-radius:${radius}pt;` : ''}display:block;`,
    })
    : `<div style="width:100%;height:${imgH};border:1pt solid #ddd;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:10pt;">No image</div>`;
  return `<div style="${style}">
    ${inner}
    ${caption ? `<div style="font-style:${captionStyle};font-size:${captionSize}pt;color:${capColor};margin-top:4pt;${captionTracking}${captionTransform}${captionFont}">${esc(caption)}</div>` : ''}
  </div>`;
}
