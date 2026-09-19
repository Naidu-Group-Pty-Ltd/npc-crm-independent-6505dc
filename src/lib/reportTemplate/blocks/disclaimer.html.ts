import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { imgTag, esc, fontFamilyDecl, type HtmlBlockContext } from './_shared.html';

function sanitise(text: string): string {
  if (!text) return '';
  return text
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/gu,
      '',
    );
}

export function renderDisclaimerHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const companyName = resolveBindable(p.companyName ?? 'Property Consulting', ctx).toUpperCase();
  /*
   * The deployment's disclaimer, falling back to whatever the template baked in.
   *
   * `disclaimerText` is now a binding (`{{org.disclaimer}}`) rather than a
   * literal, so that editing the Report Settings page changes the next document
   * instead of requiring a re-seed of 543 templates. An unresolved binding
   * renders as the empty string — that is the rule this whole programme runs on
   * — so without a fallback a deployment that has set no disclaimer, or has
   * turned it off, would get a blank foot on every report. `disclaimerFallback`
   * carries the standard text for exactly that case.
   *
   * A template that still sets a literal `disclaimerText` is unaffected: the
   * resolve returns it unchanged and the fallback is never reached.
   */
  const configured = sanitise(resolveBindable(p.disclaimerText, ctx));
  const text = configured || sanitise(resolveBindable(p.disclaimerFallback ?? '', ctx));
  /*
   * Same shape for the size. The setting's vocabulary is small/medium/large and
   * this block is the only place that decides what each is worth in points.
   * A numeric prop (the masters used to pass `8`) matched none of the three and
   * silently fell through to 8.5.
   */
  const sizeToken = resolveBindable(p.fontSize ?? '', ctx)
    || resolveBindable(p.fontSizeFallback ?? '', ctx);
  const fontSize = sizeToken === 'medium' ? 10 : sizeToken === 'large' ? 12 : 8.5;
  /*
   * The page dresses in the FAMILY's tokens, not its own.
   *
   * This block used to hardcode a near-black ground (#141414), one of the
   * audit's eight stray golds (#BF9B50) and a Helvetica fallback — so the
   * closing page of every templated document arrived from a different design
   * system than the thirty-odd pages before it, whatever family the operator
   * chose. It reads the colourway now: the family's field for the ground, its
   * on-field accent for labels, its on-field inks for text — with the old
   * literals kept as fallbacks so a template with no such tokens (the voice
   * catalogue, hand-built rows) renders exactly as it always did.
   */
  const ground = resolveBindableColor('token:bg', ctx, '#141414');
  const accent = resolveBindableColor('token:accentOnField', ctx, '#BF9B50');
  const inkOnField = resolveBindableColor('token:text', ctx, '#F3EFE6');
  const mutedOnField = resolveBindableColor('token:mutedOnField', ctx, '#B9B3A6');
  const headingFont = fontFamilyDecl('token:heading', '--font-heading');

  const row = (label: string, raw: unknown) => {
    const v = resolveBindable(raw, ctx);
    if (!v) return '';
    return `<div style="display:flex;font-size:9pt;margin-bottom:6pt;">
      <div style="color:${accent};font-weight:700;width:80pt;">${esc(label).toUpperCase()}:</div>
      <div style="color:${inkOnField};">${esc(v)}</div>
    </div>`;
  };
  /*
   * One wordmark, one size. The old split set every word but the last at 28pt
   * and the last at 16pt beneath it — which turned "Naidu Property Consulting
   * Services" into a large name with "SERVICES" reading as a subtitle. A name
   * is one object: a single line in the family's heading face, wrapping if it
   * must, never re-weighted by word position.
   */
  const heading = `<div style="${headingFont}font-size:24pt;font-weight:600;line-height:1.15;`
    + `letter-spacing:0.02em;max-width:420pt;">${esc(companyName)}</div>`;

  /*
   * The mark above the contact block.
   *
   * `REPORT_RULES.md` §5 puts the monogram on exactly two surfaces — the cover
   * and this one — and this page is the obsidian ground it names, so the mono
   * lockup belongs here. It is drawn inside the block rather than laid over it
   * because the block is `inset:0` and opaque: anything painted before it is
   * covered, and anything after it lands on the company name.
   *
   * Optional. An absent mark leaves the composition exactly as it was, which is
   * what a tenant who has uploaded none must get — never ours.
   */
  const mark = resolveBindable(p.mark, ctx);
  const markHeight = Number(p.markHeight ?? 37);
  const markOwner = resolveBindable('{{org.name}}', ctx);
  const markBlock = mark
    ? imgTag(mark, {
      alt: markOwner ? `${markOwner} logo` : 'Logo of the issuing firm',
      style: `height:${markHeight}pt;width:auto;max-width:180pt;`
        + `object-fit:contain;display:block;margin:0 0 22pt;`,
    })
    : '';

  return `<div style="position:absolute;inset:0;background:${ground};color:${accent};padding:40pt 20pt;font-family:var(--font-body, Helvetica);">
    ${markBlock}
    ${heading}
    <div style="${headingFont}margin-top:30pt;font-size:12pt;font-weight:700;letter-spacing:0.08em;color:${accent};">CONTACT US</div>
    <div style="margin-top:18pt;">
      ${row('Website', p.website)}
      ${row('Email', p.email)}
      ${row('Phone', p.phone)}
      ${row('Address', p.address)}
      ${row('ABN', p.abn)}
    </div>
    ${text ? `<div style="margin-top:28pt;color:${mutedOnField};font-size:${fontSize}pt;line-height:1.5;white-space:pre-wrap;">${esc(text)}</div>` : ''}
  </div>`;
}
