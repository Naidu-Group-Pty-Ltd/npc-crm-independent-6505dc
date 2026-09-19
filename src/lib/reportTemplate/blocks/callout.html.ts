import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import {
  esc, fontFamilyDecl, trackingDecl, type HtmlBlockContext,
} from './_shared.html';

const VARIANT: Record<string, { bg: string; accent: string; fg: string; glyph: string }> = {
  info:    { bg: '#EEF4FB', accent: '#2563EB', fg: '#1E3A8A', glyph: 'i' },
  success: { bg: '#ECFDF3', accent: '#16A34A', fg: '#14532D', glyph: '✓' },
  warning: { bg: '#FFF7ED', accent: '#D97706', fg: '#7C2D12', glyph: '!' },
  danger:  { bg: '#FEF2F2', accent: '#DC2626', fg: '#7F1D1D', glyph: '!' },
  quote:   { bg: '#F4F0E6', accent: '#BF9B50', fg: '#1A1A1A', glyph: '“' },
};

/**
 * The callout.
 *
 * ## `style`
 *
 * `badge` is the original arrangement — a tinted panel with a circled glyph —
 * and remains the default, so nothing already in the library moves.
 *
 * The approved Investment Compass catalogue distinguishes callout treatments
 * per template. Private Banking's base is `tinted_gold_bar` and its Discretion
 * Ledger overrides to `margin_note`, which are genuinely different objects: the
 * first is a tinted block carrying a tracked uppercase label ("WHAT THIS
 * MEANS") set against a 2pt accent bar; the second is an unfilled note hung off
 * a hairline in the margin. A circled exclamation mark belongs to neither — it
 * reads as a UI alert, which is not what a private-client report does.
 *
 * | `style`   | Manifest value      | Shape |
 * | --------- | ------------------- | ----- |
 * | `badge`   | (pre-existing)      | Tinted panel, circled glyph |
 * | `bar`     | `tinted_gold_bar`   | Tinted panel, accent bar, tracked label |
 * | `margin`  | `margin_note`       | No fill, hairline rule, small type |
 */
export function renderCalloutHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const v = VARIANT[String(p.variant ?? 'info')] ?? VARIANT.info;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 24);
  const w = Number(p.width ?? ctx.page.width - 48);
  const bg = resolveBindableColor(p.bg ?? v.bg, ctx, v.bg);
  const accent = resolveBindableColor(p.accent ?? v.accent, ctx, v.accent);
  const fg = resolveBindableColor(p.color ?? v.fg, ctx, v.fg);
  const title = resolveBindable(p.title, ctx);
  const body = resolveBindable(p.body, ctx);
  const radius = Number.isFinite(Number(p.radius)) ? Number(p.radius) : 6;

  const style = String(p.style ?? 'badge');
  const titleFont = fontFamilyDecl(p.titleFont, 'var(--font-body, Helvetica)');
  const bodyFont = fontFamilyDecl(p.bodyFont, 'var(--font-body, Helvetica)');
  const titleColor = resolveBindableColor(p.titleColor ?? p.accent ?? v.accent, ctx, v.accent);
  const bodySize = Number(p.bodySize ?? (style === 'margin' ? 8 : 8.8));
  const titleSize = Number(p.titleSize ?? (style === 'badge' ? 11 : 6));
  const titleTracking = trackingDecl(p.titleTracking, style === 'badge' ? 0 : 0.18);
  const bodyLineHeight = Number(p.bodyLineHeight ?? 1.55);

  // ── bar: a tinted block behind a solid accent edge ───────────────────────
  if (style === 'bar') {
    const barWidth = Number(p.barWidth ?? 2);
    return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;background:${bg};border-left:${barWidth}pt solid ${accent};padding:11pt 13pt;color:${fg};${radius ? `border-radius:${radius}pt;` : ''}">
      ${title ? `<div style="color:${titleColor};font-size:${titleSize}pt;font-weight:700;text-transform:uppercase;${titleTracking}${titleFont}">${esc(title)}</div>` : ''}
      ${body ? `<div style="font-size:${bodySize}pt;line-height:${bodyLineHeight};margin-top:6pt;white-space:pre-wrap;${bodyFont}">${esc(body)}</div>` : ''}
    </div>`;
  }

  // ── margin: an unfilled note hung off a hairline ─────────────────────────
  if (style === 'margin') {
    const ruleColor = resolveBindableColor(p.ruleColor ?? p.accent ?? v.accent, ctx, v.accent);
    return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;border-left:1pt solid ${ruleColor};padding:2pt 0 2pt 10pt;color:${fg};">
      ${title ? `<div style="color:${titleColor};font-size:${titleSize}pt;font-weight:700;text-transform:uppercase;${titleTracking}${titleFont}">${esc(title)}</div>` : ''}
      ${body ? `<div style="font-size:${bodySize}pt;line-height:${bodyLineHeight};margin-top:5pt;white-space:pre-wrap;${bodyFont}">${esc(body)}</div>` : ''}
    </div>`;
  }

  // ── badge: the original arrangement, unchanged ───────────────────────────
  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;background:${bg};border-radius:${radius}pt;border-left:4pt solid ${accent};padding:14pt 16pt 14pt 44pt;color:${fg};">
    <div style="position:absolute;left:14pt;top:14pt;width:16pt;height:16pt;background:${accent};color:#fff;border-radius:50%;font-weight:700;font-size:11pt;display:flex;align-items:center;justify-content:center;">${esc(v.glyph)}</div>
    ${title ? `<div style="font-weight:700;font-size:11pt;margin-bottom:4pt;">${esc(title)}</div>` : ''}
    ${body ? `<div style="font-size:9.5pt;line-height:1.4;white-space:pre-wrap;">${esc(body)}</div>` : ''}
  </div>`;
}
