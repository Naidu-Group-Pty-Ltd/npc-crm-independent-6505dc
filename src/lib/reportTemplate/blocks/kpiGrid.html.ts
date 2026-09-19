import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import {
  absBoxStyle, esc, fontFamilyDecl, trackingDecl, type HtmlBlockContext,
} from './_shared.html';
import { isNegativeFigure, typesetFigure } from './_data';
import { boundValueResolved } from '../boundValuePresence';

interface KpiItem {
  label: string;
  value: string;
  accent?: string;
  /** Optional qualifier under the value ("50-week basis · $25,500 p.a."). */
  note?: string;
}

/**
 * The KPI band.
 *
 * ## Why this block has layout variants
 *
 * KPI composition is one of the axes the approved Investment Compass catalogue
 * uses to tell templates within a family apart: Private Banking alone declares
 * `four_column_ruled`, `six_column_ruled`, `two_by_two_display`, `stacked_rail`
 * and `ledger_rows` across its five masters. Those are genuinely different
 * arrangements of the same data, not restyles, so expressing them as one filled
 * tile grid with a different colour would have collapsed four of the five
 * templates into the same page.
 *
 * `variant` defaults to `'tile'`, which is the arrangement this block has always
 * drawn — a filled tile with a left accent bar. Every other variant is opt-in,
 * so no existing template moves.
 *
 * | `variant`  | Manifest value it serves            | Shape |
 * | ---------- | ----------------------------------- | ----- |
 * | `tile`     | (pre-existing default)              | Filled tiles, accent bar |
 * | `ruled`    | `four_column_ruled`, `six_column_ruled` | Hairline-separated columns in a ruled band |
 * | `display`  | `two_by_two_display`                | Two-up grid at display size |
 * | `rows`     | `ledger_rows`                       | Label left, figure right, rule between |
 * | `stacked`  | `stacked_rail`                      | Vertical stack against an accent rail |
 *
 * The ruled band's weights are the archetype's: 1.5pt over the band, 1pt under
 * it, 1pt between columns. That asymmetry is deliberate — the heavier rule is
 * what attaches the band to the heading above it.
 */
export function renderKpiGridHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const authored = Array.isArray(p.items) ? (p.items as KpiItem[]) : [];
  /*
   * A tile whose value is bound and received nothing is dropped. A label over
   * an em dash is a figure the record does not hold, and four of them in a
   * band — measured on a record with no financials, RS-3, 14 Sep 2026 — is a
   * verdict page a client cannot tell from a broken one. A static value is
   * kept as authored. When nothing survives, nothing is drawn; when some do,
   * the band closes up around them rather than leaving their cells empty.
   */
  const items = authored.filter((it) => boundValueResolved(it.value, ctx));
  if (items.length === 0) return '';
  const cols = Math.min(Number(p.columns ?? items.length), 6, items.length);
  const gap = Number(p.gap ?? 12);
  const tileBg = resolveBindableColor(p.tileBg ?? 'token:bg', ctx, '#1A1A1A');
  const accentDefault = resolveBindableColor(p.accent ?? 'token:primary', ctx, '#BF9B50');
  const labelColor = resolveBindableColor(p.labelColor ?? 'token:muted', ctx, '#999999');
  const style = absBoxStyle(p, { x: 24, y: 24, w: ctx.page.width - 48, h: 90 });
  // Print wants far less rounding than screen; a template's voice sets it.
  const radius = Number.isFinite(Number(p.radius)) ? Number(p.radius) : 6;
  // A four-up grid gives each tile ~87pt of usable width, and a formatted
  // currency value ("$1,285,000") overruns that at the old fixed 20pt. Callers
  // that know their column count set this; the default is unchanged.
  const valueSize = Number.isFinite(Number(p.valueSize)) ? Number(p.valueSize) : 20;

  const variant = String(p.variant ?? 'tile');

  // ── Shared typography for the non-tile variants ──────────────────────────
  const valueFont = fontFamilyDecl(p.valueFont, 'var(--font-heading, Helvetica)');
  const labelFont = fontFamilyDecl(p.labelFont, 'var(--font-body, Helvetica)');
  const noteFont = fontFamilyDecl(p.noteFont, 'var(--font-body, Helvetica)');
  const labelTracking = trackingDecl(p.labelTracking, 0.18);
  const labelSize = Number(p.labelSize ?? 8);
  const noteSize = Number(p.noteSize ?? 7.4);
  const valueColor = resolveBindableColor(p.valueColor ?? 'token:ink', ctx, '#1A1A1A');
  const ruleColor = resolveBindableColor(p.ruleColor ?? 'token:line', ctx, '#DDD1C0');
  const emphasisColor = resolveBindableColor(p.emphasisColor ?? 'token:ink', ctx, '#1A1A1A');
  const valueWeight = Number(p.valueWeight ?? 400);
  // Figures are set with lining tabular numerals wherever a column of them has
  // to align. `numeric_typography: playfair_lining_tabular` is exactly this.
  const figures = 'font-variant-numeric:tabular-nums lining-nums;';

  /**
   * Reserve a fixed number of label lines so the values sit on one baseline.
   *
   * A KPI band is read across, and it only reads across if the figures line up.
   * They stop lining up as soon as one label wraps: at five-up, "WEEKLY
   * POSITION" takes two lines where "WEEKLY RENT" takes one, and that column's
   * value — and its note — drop by a line while the other four stay put. It
   * looks like a mistake because it is one.
   *
   * `labelLines` reserves the space whether or not it is used, which costs a few
   * points of white above the shorter labels and buys alignment across the band.
   * Unset by default, so an existing template is unchanged.
   */
  const labelLines = Number(p.labelLines ?? 0);
  const labelLineHeight = 1.25;
  const labelReserve = labelLines > 0
    ? `min-height:${(labelSize * labelLineHeight * labelLines).toFixed(2)}pt;`
    : '';
  // `resolveBindable`, exactly as the value and note below it: a KPI label can
  // legitimately be data — the Commercial Capacity band names its third cell
  // "Shortfall" or "Headroom" from the projection, and this helper escaping the
  // raw string printed the literal `{{capacity.headline.differenceLabel}}` in
  // uppercase mono on the answer page of every render.
  const label = (item: KpiItem) =>
    `<div style="color:${labelColor};font-size:${labelSize}pt;line-height:${labelLineHeight};text-transform:uppercase;${labelReserve}${labelTracking}${labelFont}">${esc(resolveBindable(String(item.label || ''), ctx))}</div>`;

  const note = (item: KpiItem) => (item.note
    ? `<div style="color:${labelColor};font-size:${noteSize}pt;margin-top:5pt;line-height:1.35;${noteFont}">${esc(resolveBindable(item.note, ctx))}</div>`
    : '');

  /**
   * Negative figures print in the brand's print-weight red.
   *
   * REPORT_RULES §7 states it without qualification — "the sign is the most-read
   * thing on the page" — and `dataTable` has done it since the ledger treatment
   * landed. This block never did, so the cover KPI band, which is where the
   * weekly cash position is headlined, set a loss in body ink. `token:negative`
   * is a Category B semantic colour present in every colourway, so it resolves
   * everywhere rather than needing a prop nobody set.
   *
   * `negativeColor: 'none'` opts a band out.
   */
  const negativeColor = p.negativeColor === 'none'
    ? null
    : resolveBindableColor(p.negativeColor ?? 'token:negative', ctx, '#B91C1C');

  /** The value as it should be set: real minus sign, em dash when absent. */
  const valueText = (item: KpiItem) => typesetFigure(resolveBindable(item.value, ctx)) || '—';
  /** `colour`, unless the figure is negative and the band has not opted out. */
  const valueTone = (item: KpiItem, colour: string) =>
    (negativeColor && isNegativeFigure(valueText(item)) ? negativeColor : colour);

  /**
   * A sentence in a value slot is set as prose, never as a figure.
   *
   * The cover band binds the graded verdict line into a tile beside GRADE and
   * SCORE, and on a record whose grade is withheld that line is the withholding
   * sentence — 150 characters at 20pt in an 87pt column, one word a line,
   * running out of the tile and over the band below it (measured: report A,
   * page 3, `OFF-PAGE` and `OVERLAP`). A figure has no spaces and is short; a
   * value that is neither is copy, and copy is set at reading size.
   */
  const isProse = (text: string) => text.length > 24 && /\s/.test(text.trim());
  const proseSize = Math.max(8.5, noteSize + 1.5);

  const figure = (item: KpiItem, size: number, colour: string) => {
    const text = valueText(item);
    if (isProse(text)) {
      return `<div style="color:${colour};font-size:${proseSize}pt;line-height:1.4;margin-top:8pt;${noteFont}">${esc(text)}</div>`;
    }
    return `<div style="color:${valueTone(item, colour)};font-size:${size}pt;line-height:1;margin-top:8pt;font-weight:${valueWeight};${figures}${valueFont}">${esc(text)}</div>`;
  };

  // ── ruled: a band of hairline-separated columns ──────────────────────────
  if (variant === 'ruled' || variant === 'display') {
    const perRow = variant === 'display' ? Math.min(cols, 2) : cols;
    // Every item is shown, wrapping into as many rows as it takes. A console of
    // twelve figures is six across and two deep; slicing to one row instead
    // would silently drop half the dashboard.
    const shown = items;
    const rows = Math.ceil(shown.length / perRow);
    // A full cell grid rather than column separators — the Swiss module and the
    // analyst's field cells, where the boundary is the system made visible.
    const cellBorders = p.cellBorders === true;
    const cells = shown.map((item, i) => {
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      const last = col === perRow - 1;
      const first = col === 0;
      const lastRow = row === rows - 1;
      const pad = cellBorders
        ? 'padding:10pt 10pt 11pt'
        : `padding:11pt ${last ? '0' : '12pt'} 12pt ${first ? '0' : '12pt'}`;
      const borders = cellBorders
        ? `border:1pt solid ${ruleColor};margin:-0.5pt;`
        : `${last ? '' : `border-right:1pt solid ${ruleColor};`}`
          + `${lastRow ? '' : `border-bottom:1pt solid ${ruleColor};`}`;
      return `<div style="${pad};${borders}">
        ${label(item)}
        ${figure(item, valueSize, item.accent ? resolveBindableColor(item.accent, ctx, valueColor) : valueColor)}
        ${note(item)}
      </div>`;
    }).join('');
    const frame = cellBorders
      ? ''
      : `border-top:1.5pt solid ${emphasisColor};border-bottom:1pt solid ${ruleColor};`;
    return `<div style="${style}${frame}display:grid;grid-template-columns:repeat(${perRow}, 1fr);">${cells}</div>`;
  }

  // ── rows: a ledger. Label left, figure right, hairline between ───────────
  if (variant === 'rows') {
    const rows = items.map((item, i) => `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12pt;padding:7pt 0;${i === items.length - 1 ? '' : `border-bottom:1pt solid ${ruleColor};`}">
      <div style="flex:1;min-width:0;">
        ${label(item)}
        ${item.note ? `<div style="color:${labelColor};font-size:${noteSize}pt;margin-top:3pt;${noteFont}">${esc(resolveBindable(item.note, ctx))}</div>` : ''}
      </div>
      <div style="color:${valueTone(item, item.accent ? resolveBindableColor(item.accent, ctx, valueColor) : valueColor)};font-size:${valueSize}pt;line-height:1;font-weight:${valueWeight};${figures}${valueFont}">${esc(valueText(item))}</div>
    </div>`).join('');
    return `<div style="${style}border-top:1.5pt solid ${emphasisColor};">${rows}</div>`;
  }

  // ── stacked: a vertical run against an accent rail ───────────────────────
  if (variant === 'stacked') {
    const stack = items.map((item, i) => `<div style="${i === 0 ? '' : 'margin-top:12pt;'}">
      ${label(item)}
      ${figure(item, valueSize, item.accent ? resolveBindableColor(item.accent, ctx, valueColor) : valueColor)}
      ${note(item)}
    </div>`).join('');
    return `<div style="${style}border-left:2pt solid ${accentDefault};padding-left:14pt;">${stack}</div>`;
  }

  /*
   * Tiles.
   *
   * Three things this used to do that the other variants do not. It drew
   * `items.slice(0, cols)` — one row only, so anything past the column count
   * vanished, where `ruled` and `display` deliberately wrap ("slicing to one
   * row instead would silently drop half the dashboard"). It never called
   * `note(item)`, although `card_row_with_trend` maps to this variant and the
   * trend note is what its name is about. And it set the label at a literal
   * `8pt` with no `labelReserve`, so labels of different lengths wrapped
   * independently and the tiles' bottoms fell out of line — while
   * `overflow:hidden` clipped whatever did not fit into a box the authoring
   * side had declared at a flat 82pt.
   *
   * The clip stays: it is the right guard once the box is measured, which it
   * now is.
   */
  const tiles = items.map((item) => {
    const value = valueText(item);
    const accent = item.accent ? resolveBindableColor(item.accent, ctx, accentDefault) : accentDefault;
    const valueStyle = isProse(value)
      ? `color:${accent};font-size:${proseSize}pt;line-height:1.4;${noteFont}`
      : `color:${accent};font-weight:700;font-size:${valueSize}pt;line-height:1.1;font-variant-numeric:tabular-nums;`;
    return `<div style="position:relative;background:${tileBg};border-radius:${radius}pt;padding:12pt 12pt 10pt 16pt;overflow:hidden;">
      <div style="position:absolute;left:0;top:0;bottom:0;width:3pt;background:${accent};"></div>
      <div style="${valueStyle}">${esc(value)}</div>
      <div style="color:${labelColor};font-size:${labelSize}pt;text-transform:uppercase;letter-spacing:0.08em;margin-top:8pt;${labelReserve}">${esc(resolveBindable(String(item.label || ''), ctx))}</div>
      ${note(item)}
    </div>`;
  }).join('');

  return `<div style="${style}display:grid;grid-template-columns:repeat(${cols}, 1fr);gap:${gap}pt;">${tiles}</div>`;
}
