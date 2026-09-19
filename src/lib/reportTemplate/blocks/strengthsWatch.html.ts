import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { esc, fontFamilyDecl, trackingDecl, type HtmlBlockContext } from './_shared.html';

/**
 * Strengths and considerations, side by side.
 *
 * ## `style`
 *
 * This block drew one thing: a solid full-width band of saturated colour with
 * the label reversed out of it. That is a reasonable default and the wrong
 * default for a catalogue of ten design families — it rendered *identically* in
 * Swiss Minimal and Institutional Research, two families whose whole difference
 * is how loudly they mark a section. Two blocks of full-strength green and red
 * also dominate the page they sit on and read as an alert, not as editorial
 * structure, which is heavy ink on paper for what is a pair of lists.
 *
 * `style` follows the same pattern `callout` already uses, and the Investment
 * Compass generator keys it off the same `callout_style` manifest axis, so a
 * family that marks a callout with a bar marks these with a bar too:
 *
 *  - `band`  — solid label band, reversed type. The historical rendering, and
 *              still the default, so every existing template is unchanged.
 *  - `rule`  — label in the semantic colour over paper, above a rule in the
 *              same colour. The colour still carries the meaning; it just stops
 *              carrying it as a filled rectangle.
 *  - `plain` — label in the semantic colour, no rule and no fill. For families
 *              whose callouts live in the margin.
 *
 * The glyph bullets keep their fill in every style: they are 14pt discs, small
 * enough to read as marks rather than as areas, and they are what makes a
 * strength scannable from a watch point.
 */
export function renderStrengthsWatchHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? ctx.page.width - 48);
  const strengths = Array.isArray(p.strengths) ? (p.strengths as string[]) : [];
  const watch = Array.isArray(p.watch) ? (p.watch as string[]) : [];
  const strengthsTitle = resolveBindable(p.strengthsTitle ?? 'Strengths', ctx);
  const watchTitle = resolveBindable(p.watchTitle ?? 'Watch Points', ctx);
  // Strengths and watch points are semantic, so they keep a semantic colour —
  // but the template's own, not a fixed screen green and orange that fought
  // every palette they landed in. Fallbacks are the previous literals.
  const positive = resolveBindableColor(p.positiveColor ?? '#16A34A', ctx, '#16A34A');
  const caution = resolveBindableColor(p.cautionColor ?? '#D97706', ctx, '#D97706');
  const onFill = resolveBindableColor(p.onFillColor ?? '#FFFFFF', ctx, '#FFFFFF');
  const textColor = resolveBindableColor(p.color ?? '#1A1A1A', ctx, '#1A1A1A');
  const radius = Number.isFinite(Number(p.radius)) ? Number(p.radius) : 0;

  const style = p.style === 'rule' || p.style === 'plain' ? p.style : 'band';
  const titleFont = fontFamilyDecl(p.titleFont);
  const bodyFont = fontFamilyDecl(p.bodyFont);
  const titleSize = Number(p.titleSize ?? 10);
  const bodySize = Number(p.bodySize ?? 9.5);
  const titleTracking = trackingDecl(p.titleTracking, 0.08);
  const bodyLineHeight = Number(p.bodyLineHeight ?? 1.35);
  const ruleWeight = Number(p.ruleWeight ?? 1);

  /** The label, drawn the way this family marks things. */
  const heading = (title: string, color: string) => {
    const common = `font-weight:700;font-size:${titleSize}pt;text-transform:uppercase;${titleTracking}${titleFont}`;
    if (style === 'band') {
      return `<div style="background:${color};color:${onFill};${common}padding:6pt 12pt;border-radius:${radius}pt;margin-bottom:10pt;">${esc(title)}</div>`;
    }
    if (style === 'rule') {
      return `<div style="color:${color};${common}padding-bottom:4pt;border-bottom:${ruleWeight}pt solid ${color};margin-bottom:10pt;">${esc(title)}</div>`;
    }
    return `<div style="color:${color};${common}margin-bottom:10pt;">${esc(title)}</div>`;
  };

  const resolved = (items: string[]) => items
    .map((it) => resolveBindable(it, ctx))
    .filter((text) => String(text).trim() !== '');

  const column = (title: string, items: string[], color: string, glyph: string) => {
    const li = items.map((it) => resolveBindable(it, ctx))
      // A template declares a fixed number of rows and the data decides how many
      // it fills — a portfolio's analysis writes three to six strengths, a
      // property's two. An item that resolved to nothing must not leave its
      // marker behind: a lone coloured bullet with no text beside it reads as a
      // rendering fault, which is worse than the shorter column it replaces.
      .filter((text) => String(text).trim() !== '')
      .map((text) => `<div style="display:flex;gap:8pt;align-items:flex-start;margin-bottom:8pt;">
        <span style="background:${color};color:${onFill};border-radius:50%;width:14pt;height:14pt;display:inline-flex;align-items:center;justify-content:center;font-size:8pt;font-weight:700;flex-shrink:0;">${esc(glyph)}</span>
        <span style="color:${textColor};font-size:${bodySize}pt;line-height:${bodyLineHeight};${bodyFont}">${esc(text)}</span>
      </div>`).join('');
    // A heading is the same promise a table's column head makes. Dropping the
    // empty items and keeping "CONSIDERATIONS" over white space says the report
    // has a section it declined to fill, which is not what the record says:
    // `investment_score.weaknesses` is empty on 313 of the 1,187 stored reports
    // and `strengths` on 439, so the naked heading was the printed outcome on a
    // quarter and a third of them respectively. The cell itself stays, because
    // the grid is `1fr 1fr` and the surviving column belongs in its own half.
    if (li === '') return '<div></div>';
    return `<div>
      ${heading(title, color)}
      ${li}
    </div>`;
  };

  // Neither side has anything: draw nothing at all rather than two headings.
  if (resolved(strengths).length === 0 && resolved(watch).length === 0) return '';

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;display:grid;grid-template-columns:1fr 1fr;gap:14pt;">
    ${column(String(strengthsTitle), strengths, positive, '+')}
    ${column(String(watchTitle), watch, caution, '!')}
  </div>`;
}
