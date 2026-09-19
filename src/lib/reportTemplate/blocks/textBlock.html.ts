import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { boundValueResolved } from '../boundValuePresence';
import {
  absBoxStyle, esc, fontFamilyDecl, trackingDecl, type HtmlBlockContext,
} from './_shared.html';

/**
 * Section text — eyebrow, heading, body.
 *
 * ## The typography props
 *
 * `eyebrowFont` / `headingFont` / `bodyFont`, `eyebrowTracking`,
 * `headingWeight` and `bodyLineHeight` are additive and default to exactly what
 * this block emitted before them, so an existing template renders unchanged.
 *
 * They exist because a design family can set more than two faces. The approved
 * Private Banking family runs four with one job each — Cinzel on the cover,
 * Playfair on headings and figures, Inter for body copy, IBM Plex Mono for
 * every uppercase label — and until this block could be told which face an
 * eyebrow takes, all three of its elements resolved to `--font-body` and
 * `--font-heading`. The eyebrow in particular was pinned at 0.18em, which is
 * the brand's section tracking but not its cover tracking (0.34em).
 *
 * Fonts resolve through `fontFamilyDecl`, which points at the `--font-*` custom
 * property rather than interpolating a font name into the style attribute.
 */
export function renderTextBlockHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const eyebrow = resolveBindable(p.eyebrow, ctx);
  const heading = resolveBindable(p.heading, ctx);
  const body = resolveBindable(p.body, ctx);
  /*
   * A heading and a body that are bound and received nothing leave an eyebrow
   * over nothing: `RECOMMENDATION` with no headline and no sentence under it
   * (measured on a record with no risks and no recommendation, RS-3, 14 Sep
   * 2026). The block draws nothing. A static heading or body is an author's
   * own words and is always kept; so is a bound part that resolved.
   */
  const bound = (v: unknown) => typeof v === 'string' && v.includes('{{');
  const headingSaysNothing = !heading || (bound(p.heading) && !boundValueResolved(p.heading, ctx));
  const bodySaysNothing = !body || (bound(p.body) && !boundValueResolved(p.body, ctx));
  if ((bound(p.heading) || bound(p.body)) && headingSaysNothing && bodySaysNothing) return '';
  const eyebrowColor = resolveBindableColor(p.eyebrowColor ?? 'token:primary', ctx, '#BF9B50');
  const headingColor = resolveBindableColor(p.headingColor ?? 'token:primary', ctx, '#BF9B50');
  const color = resolveBindableColor(p.color ?? 'token:text', ctx, '#1A1A1A');
  const eyebrowSize = Number(p.eyebrowSize ?? 8);
  const headingSize = Number(p.headingSize ?? 16);
  const bodySize = Number(p.bodySize ?? 10);

  // Defaults reproduce the pre-existing output byte for byte: body face for the
  // eyebrow and body, heading face for the heading, 0.18em tracking, weight
  // 700, line-height 1.4.
  const eyebrowFont = fontFamilyDecl(p.eyebrowFont, 'var(--font-body, Helvetica)');
  const headingFont = fontFamilyDecl(p.headingFont, 'var(--font-heading, Helvetica)');
  const bodyFont = fontFamilyDecl(p.bodyFont, 'var(--font-body, Helvetica)');
  const eyebrowTracking = trackingDecl(p.eyebrowTracking, 0.18);
  const headingWeight = Number(p.headingWeight ?? 700);
  // Emitted only when set. The heading previously carried no `line-height` at
  // all, so defaulting one here would re-leaded every existing template's
  // headings — the kind of change that is invisible in review and obvious in a
  // customer's PDF.
  const headingLineHeight = p.headingLineHeight != null && Number.isFinite(Number(p.headingLineHeight))
    ? `line-height:${Number(p.headingLineHeight)};`
    : '';
  const bodyLineHeight = Number(p.bodyLineHeight ?? 1.4);
  // The standfirst on a Private Banking cover is Playfair set italic. Italic is
  // a typographic role here, not emphasis, so it belongs on the block rather
  // than in the copy.
  const bodyStyle = p.bodyStyle === 'italic' ? 'font-style:italic;' : '';
  const headingStyle = p.headingStyle === 'italic' ? 'font-style:italic;' : '';
  const bodyAlign = typeof p.bodyAlign === 'string' && /^(left|right|center|justify)$/.test(p.bodyAlign)
    ? `text-align:${p.bodyAlign};`
    : '';
  // Body tracking is emitted only when asked for. A wordmark and a running head
  // are both body-role elements that carry brand tracking; ordinary copy must
  // not, so there is no default.
  const bodyTracking = trackingDecl(p.bodyTracking);

  // `anchorBottom` pins the block's foot and lets it grow upward — see
  // `absBoxStyle`. The cover title is the case it exists for.
  const style = absBoxStyle(p, { x: 24, y: 24, w: ctx.page.width - 48 }, ctx.page.height);
  // A bottom-anchored block's last element must sit ON the anchor, so the
  // trailing margin that separates a heading from the body below it is exactly
  // the gap that would push the title off its rule.
  const anchored = p.anchorBottom != null && Number.isFinite(Number(p.anchorBottom));
  const headingTail = anchored && !body ? '0' : '0 0 8pt';
  /**
   * This heading is a HEADING, and it is not a section NAME.
   *
   * `<h2>` is right: a reader of the structure tree should hear the page's
   * headline as its heading, and PDF/UA wants one. But WeasyPrint also builds
   * the PDF outline from every `h1`–`h6`, and this heading is display type
   * bound to the record — `{{recommendation.headline}}`, `{{property.address}}`
   * — so *"AVOID - Poor investment opportunity with multiple red flags"* was
   * the third entry in every Investment Compass outline, and the page a reader
   * knows as "The assessment" appeared under the words "Five dimensions,
   * weighted". A conclusion about a property cannot name a part of a document.
   *
   * The page contributes its own name instead (`pageBookmarkStyle` in
   * `htmlRenderer.ts`), so nothing is lost from the outline and the entry says
   * what the reader is looking at. Nothing else changes: the element, its
   * role in the structure tree and every drawn pixel are untouched.
   *
   * `includeBookmarks: false` means the renderer emits no outline property at
   * all, so the opt-out opts out of this one too.
   */
  const headingOutline = (ctx as { _includeBookmarks?: boolean })._includeBookmarks === false
    ? '' : 'bookmark-level:none;';
  return `<div style="${style}">
    ${eyebrow ? `<div style="color:${eyebrowColor};font-size:${eyebrowSize}pt;font-weight:700;text-transform:uppercase;${eyebrowTracking}margin:0 0 6pt;${eyebrowFont}">${esc(eyebrow)}</div>` : ''}
    ${heading ? `<h2 style="color:${headingColor};font-size:${headingSize}pt;font-weight:${headingWeight};${headingStyle}${headingLineHeight}margin:${headingTail};${headingOutline}${headingFont}">${esc(heading)}</h2>` : ''}
    ${body ? `<div style="color:${color};font-size:${bodySize}pt;line-height:${bodyLineHeight};${bodyStyle}${bodyAlign}${bodyTracking}white-space:pre-wrap;${bodyFont}">${esc(body)}</div>` : ''}
  </div>`;
}
