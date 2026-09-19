import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { imgTag, esc, type HtmlBlockContext } from './_shared.html';

export function renderCoverHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const bg = resolveBindableColor(p.bg ?? 'token:bg', ctx, '#0D0D0D');
  const accent = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const text = resolveBindableColor(p.color ?? '#FFFFFF', ctx, '#FFFFFF');
  const imageUrl = resolveBindable(p.imageUrl, ctx);
  const eyebrow = resolveBindable(p.eyebrow, ctx);
  const title = resolveBindable(p.title, ctx);
  const subtitle = resolveBindable(p.subtitle, ctx);
  const footnote = resolveBindable(p.footnote, ctx);
  const titleSize = Number(p.titleSize ?? 40);

  const bgImage = imageUrl
    ? `<div style="position:absolute;inset:0;background:url('${esc(imageUrl)}') center/cover no-repeat;"></div>
       <div style="position:absolute;inset:0;background:${bg};opacity:0.55;"></div>`
    : '';

  /*
   * The mark, top-left.
   *
   * `REPORT_RULES.md` §5: the cover is one of the two surfaces a mark may go
   * on, at ~14mm with generous clear space. 40pt is 14.1mm. It sits above the
   * title block, which is anchored at 55%, so there is no composition to move.
   *
   * Painted after the scrim so it is never dimmed by it, and never over the
   * image's focal area — the top-left corner is the one part of a cover
   * photograph the title does not already claim.
   *
   * Optional, and drawn only when it resolves: a tenant who has uploaded no
   * mark gets none, rather than ours.
   */
  const mark = resolveBindable(p.mark, ctx);
  const markHeight = Number(p.markHeight ?? 40);
  // A mark's alternative text is the organisation it stands for. `alt=""` was
  // here and does nothing on the pinned engine — see `imgTag`.
  const markOwner = resolveBindable('{{org.name}}', ctx);
  const markBlock = mark
    ? imgTag(mark, {
      alt: markOwner ? `${markOwner} logo` : 'Logo of the issuing firm',
      style: `position:absolute;left:48pt;top:48pt;`
        + `height:${markHeight}pt;width:auto;max-width:200pt;object-fit:contain;`,
    })
    : '';

  return `
  <div class="block-cover" style="position:absolute;inset:0;background:${bg};color:${text};">
    ${bgImage}
    ${markBlock}
    <div style="position:absolute;left:48pt;top:55%;right:48pt;">
      <div style="width:60pt;height:3pt;background:${accent};margin-bottom:12pt;"></div>
      ${eyebrow ? `<div style="color:${accent};font-weight:700;font-size:10pt;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8pt;">${esc(eyebrow)}</div>` : ''}
      ${title ? `<h1 style="font-family:var(--font-heading, Helvetica);font-size:${titleSize}pt;line-height:1.1;font-weight:700;margin:0;">${esc(title)}</h1>` : ''}
      ${subtitle ? `<div style="font-size:14pt;margin-top:${titleSize * 0.6}pt;opacity:0.9;">${esc(subtitle)}</div>` : ''}
    </div>
    ${footnote ? `<div style="position:absolute;left:48pt;bottom:36pt;color:${accent};font-size:9pt;">${esc(footnote)}</div>` : ''}
  </div>`;
}
