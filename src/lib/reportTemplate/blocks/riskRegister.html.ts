import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { boundValueResolved } from '../boundValuePresence';
import {
  esc, fontFamilyDecl, trackingDecl, type HtmlBlockContext,
} from './_shared.html';
import { ratingChipHtml, confidenceChipHtml } from './_chips.html';

interface RiskItem {
  risk: string;
  rating: string;
  confidence: string;
  why: string;
  ddAction: string;
  /**
   * Bar length, 0–1. Optional: `severityFromRating` reads the rating when it is
   * absent, so an existing template needs no new data to use `display: 'bars'`.
   */
  severity?: number;
  /** Short qualifier printed beside the rating in the bars display. */
  note?: string;
}

/**
 * How full the bar is for a written rating.
 *
 * The approved Private Banking archetype draws six hazards at four lengths —
 * 100%, 88%, 78% and 55% — against the labels HIGH, HIGH, MOD–HIGH and
 * MODERATE/UNVERIFIED. Those are the steps reproduced here. An unrecognised
 * rating returns null so the bar is omitted rather than drawn at a length that
 * states a severity nobody assessed.
 */
export function severityFromRating(rating: string): number | null {
  const key = String(rating ?? '').trim().toLowerCase();
  if (!key) return null;
  if (/(^|[^a-z])(critical|severe)([^a-z]|$)/.test(key)) return 1;
  if (key.includes('mod') && key.includes('high')) return 0.78;
  if (/(^|[^a-z])high([^a-z]|$)/.test(key)) return 1;
  if (/(^|[^a-z])(moderate|medium|unverified)([^a-z]|$)/.test(key)) return 0.55;
  if (/(^|[^a-z])(low|minor)([^a-z]|$)/.test(key)) return 0.3;
  return null;
}

/**
 * Semantic colour for a rating — and MUTED where nothing was assessed.
 *
 * This returned `caution` for `null`, and `null` is precisely the answer
 * `severityFromRating` gives for a rating it does not recognise — deliberately,
 * under its own comment, *"so the bar is omitted rather than drawn at a length
 * that states a severity nobody assessed."*
 *
 * The colour is used twice: for the bar, and for the RATING WORD's own text
 * colour in the row's third cell. So the bar was correctly withheld and the
 * word was printed in the caution colour anyway — `NOT ASSESSED` set in the
 * same amber as `MODERATE`, indistinguishable at a glance. One function
 * guarded the absence and the next one below it undid the guard.
 *
 * That is `PLANNING_CONTROLS_IN_THE_REPORT.md` §9's rule — **an absence may not
 * be rated** — committed in colour rather than in a word, which is the same
 * shape as `withholdRatedAbsenceCharts`: a picture has no sentence for a rule
 * about sentences to catch.
 *
 * The chip display already had this right: `ratingChipHtml` falls back to
 * `Neutral` for an unknown rating. The two displays of one register disagreed.
 */
function severityColour(
  severity: number | null,
  negative: string,
  caution: string,
  positive: string,
  muted: string,
): string {
  if (severity === null) return muted;
  if (severity >= 0.85) return negative;
  if (severity >= 0.45) return caution;
  return positive;
}

/**
 * The risk register.
 *
 * ## Why this block gained colour props
 *
 * Every colour here used to be a literal in the renderer — `#1A1A1A` title bar,
 * `#BF9B50` title text, `#F4F0E6` header, `#FCFAF6` stripe. That passed
 * `isBrandSafe()`, which only inspects the schema, while making the block the
 * one thing on the page that ignores the template's palette entirely. Under a
 * colourway system that is a visible defect: a Midnight Navy report would print
 * a beige-and-gold risk register.
 *
 * So the colours are now props that default to those exact literals. An
 * existing template renders byte-identically; a template that passes
 * `token:*` values follows its palette.
 *
 * ## `display: 'bars'`
 *
 * The approved catalogue distinguishes `risk_display: rated_table` (the
 * default, unchanged) from `severity_bars`, which Private Banking's Discretion
 * Ledger declares. The bars form is three columns — hazard, a proportional bar,
 * and the rating set in small tracked capitals — because a client reading the
 * numbers first wants the shape of the risk before its prose.
 */
export function renderRiskRegisterHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const x = Number(p.x ?? 24);
  const y = Number(p.y ?? 80);
  const w = Number(p.width ?? ctx.page.width - 48);
  const title = resolveBindable(p.title ?? 'Risk Register', ctx);
  // A hazard row whose name is bound and received nothing is no hazard; a
  // register with none left is a titled frame around nothing and draws
  // nothing. The same rule the data table and the definition list apply.
  const authored = Array.isArray(p.items) ? (p.items as RiskItem[]) : [];
  const items = authored.filter((it) => boundValueResolved(it.risk ?? '', ctx));
  if (authored.length > 0 && items.length === 0) return '';

  // Defaults are the previous hardcoded literals, so an untouched template is
  // untouched output.
  const titleBg = resolveBindableColor(p.titleBg ?? '#1A1A1A', ctx, '#1A1A1A');
  const titleFg = resolveBindableColor(p.titleFg ?? '#BF9B50', ctx, '#BF9B50');
  const headerBg = resolveBindableColor(p.headerBg ?? '#F4F0E6', ctx, '#F4F0E6');
  const headerFg = resolveBindableColor(p.headerFg ?? '#3C3C3C', ctx, '#3C3C3C');
  const stripeBg = resolveBindableColor(p.stripeBg ?? '#FCFAF6', ctx, '#FCFAF6');
  const rowBg = resolveBindableColor(p.rowBg ?? '#FFFFFF', ctx, '#FFFFFF');
  const cellFg = resolveBindableColor(p.cellFg ?? '#1A1A1A', ctx, '#1A1A1A');
  const mutedColor = resolveBindableColor(p.mutedColor ?? '#3C3C3C', ctx, '#3C3C3C');
  const borderColor = resolveBindableColor(p.borderColor ?? '#DCDCDC', ctx, '#DCDCDC');
  const negativeColor = resolveBindableColor(p.negativeColor ?? '#B91C1C', ctx, '#B91C1C');
  const cautionColor = resolveBindableColor(p.cautionColor ?? '#B45309', ctx, '#B45309');
  const positiveColor = resolveBindableColor(p.positiveColor ?? '#15803D', ctx, '#15803D');

  const display = String(p.display ?? 'table');

  // ── severity bars ────────────────────────────────────────────────────────
  if (display === 'bars') {
    const labelFont = fontFamilyDecl(p.labelFont, 'var(--font-body, Helvetica)');
    const bodyFont = fontFamilyDecl(p.bodyFont, 'var(--font-body, Helvetica)');
    const eyebrowFont = fontFamilyDecl(p.eyebrowFont, 'var(--font-body, Helvetica)');
    const labelTracking = trackingDecl(p.labelTracking, 0.06);
    const eyebrowTracking = trackingDecl(p.eyebrowTracking, 0.18);
    const fontSize = Number(p.fontSize ?? 8.4);
    const titleSize = Number(p.titleSize ?? 6.4);

    const rows = items.map((it, i) => {
      const rating = String(resolveBindable(it.rating ?? '', ctx));
      const severity = typeof it.severity === 'number'
        ? Math.max(0, Math.min(1, it.severity))
        : severityFromRating(rating);
      const colour = severityColour(severity, negativeColor, cautionColor, positiveColor, mutedColor);
      const last = i === items.length - 1;
      const bar = severity === null
        ? ''
        : `<span style="display:inline-block;width:${Math.round(severity * 100)}%;height:4pt;background:${colour};"></span>`;
      return `<tr>
        <td style="padding:7pt 6pt 7pt 0;${last ? '' : `border-bottom:1pt solid ${borderColor};`}width:32%;color:${cellFg};font-size:${fontSize}pt;${bodyFont}">${esc(resolveBindable(it.risk ?? '', ctx))}</td>
        <td style="padding:7pt 6pt;${last ? '' : `border-bottom:1pt solid ${borderColor};`}width:34%;">${bar}</td>
        <td style="padding:7pt 0 7pt 6pt;${last ? '' : `border-bottom:1pt solid ${borderColor};`}text-align:right;color:${colour};font-size:${Math.max(6, fontSize - 1.4)}pt;text-transform:uppercase;${labelTracking}${labelFont}">${esc(rating)}${it.note ? ` · ${esc(resolveBindable(it.note, ctx))}` : ''}</td>
      </tr>`;
    }).join('');

    return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;">
      ${title ? `<div style="color:${mutedColor};font-size:${titleSize}pt;text-transform:uppercase;${eyebrowTracking}margin-bottom:7pt;${eyebrowFont}">${esc(title)}</div>` : ''}
      <table style="width:100%;border-collapse:collapse;">${rows}</table>
    </div>`;
  }

  // ── rated table (unchanged shape) ────────────────────────────────────────
  const headerRow = `<tr style="background:${headerBg};color:${headerFg};font-weight:700;font-size:7.5pt;text-transform:uppercase;">
    <th style="padding:6pt 8pt;text-align:left;width:22%;">Risk</th>
    <th style="padding:6pt 8pt;text-align:left;width:12%;">Rating</th>
    <th style="padding:6pt 8pt;text-align:left;width:13%;">Confidence</th>
    <th style="padding:6pt 8pt;text-align:left;width:28%;">Why it matters</th>
    <th style="padding:6pt 8pt;text-align:left;width:25%;">Recommended DD action</th>
  </tr>`;
  const rows = items.map((it, i) => `
    <tr style="background:${i % 2 === 1 ? stripeBg : rowBg};vertical-align:top;font-size:8.5pt;">
      <td style="padding:8pt;font-weight:700;color:${cellFg};font-size:9pt;">${esc(resolveBindable(it.risk ?? '', ctx))}</td>
      <td style="padding:8pt;">${ratingChipHtml(String(it.rating ?? 'Medium'), 8, ctx)}</td>
      <td style="padding:8pt;">${confidenceChipHtml(String(it.confidence ?? 'Indicative'), 7.5, ctx)}</td>
      <td style="padding:8pt;color:${mutedColor};line-height:1.35;">${esc(resolveBindable(it.why ?? '', ctx))}</td>
      <td style="padding:8pt;color:${mutedColor};line-height:1.35;">${esc(resolveBindable(it.ddAction ?? '', ctx))}</td>
    </tr>`).join('');

  return `<div style="position:absolute;left:${x}pt;top:${y}pt;width:${w}pt;border:0.5pt solid ${borderColor};">
    <div style="background:${titleBg};color:${titleFg};font-weight:700;font-size:10pt;padding:6pt 12pt;text-transform:uppercase;">${esc(title)}</div>
    <table style="width:100%;border-collapse:collapse;">${headerRow}${rows}</table>
  </div>`;
}
