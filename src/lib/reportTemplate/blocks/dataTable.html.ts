import type { Block } from '../templateSchema';
import { resolveBindable, resolveBindableColor } from '../bindingResolver';
import { isNegativeFigure, rowsWithSomethingToSay, typesetFigure, type TableRow } from './_data';
import { absBoxStyle, esc, type HtmlBlockContext } from './_shared.html';

export function renderDataTableHtml(block: Block, ctx: HtmlBlockContext): string {
  const p = block.props as Record<string, unknown>;
  const headers = Array.isArray(p.headers) ? (p.headers as string[]) : [];
  const authored = Array.isArray(p.rows) ? (p.rows as TableRow[]) : [];
  if (headers.length === 0) return '';
  // A row may carry its own `when`, and a row is drawn only if it says
  // something — see `rowsWithSomethingToSay`, which applies both rules.
  const { rows, saysSomething } = rowsWithSomethingToSay(authored, ctx);
  // A column head is a promise too. When every row of a table is conditional
  // and none of them holds, or every bound row received nothing, the honest
  // output is nothing — not a ruled header band over white space, which reads
  // as a table whose body failed to render.
  if (authored.length > 0 && (rows.length === 0 || !saysSomething)) return '';

  const headerBg = resolveBindableColor(p.headerBg ?? 'token:primary', ctx, '#BF9B50');
  const headerFg = resolveBindableColor(p.headerFg ?? '#FFFFFF', ctx, '#FFFFFF');
  const stripeBg = resolveBindableColor(p.stripeBg ?? '#F4F0E6', ctx, '#F4F0E6');
  const cellFg = resolveBindableColor(p.cellFg ?? '#1A1A1A', ctx, '#1A1A1A');
  const borderColor = resolveBindableColor(p.borderColor ?? '#DCDCDC', ctx, '#DCDCDC');
  const widths = Array.isArray(p.columnWidths) && (p.columnWidths as number[]).length === headers.length
    ? (p.columnWidths as number[])
    : headers.map(() => 1 / headers.length);
  const style = absBoxStyle(p, { x: 24, y: 24, w: ctx.page.width - 48 });

  // Figure columns are right-aligned so the digits stack, and set in the
  // template's mono face when it declares one. A projection table is only
  // readable down the column if the decimal points line up.
  const numeric = new Set(
    (Array.isArray(p.numericColumns) ? (p.numericColumns as unknown[]) : [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0),
  );
  const numericFont = tokenFont(p.numericFont);
  const fontSize = Number(p.fontSize) > 0 ? Number(p.fontSize) : 9;
  const cellPad = Number(p.cellPadding) >= 0 ? Number(p.cellPadding) : 6;

  // Band rows group a long matrix into named sections (STATISTICS, CASH
  // DEDUCTIONS, …). A ten-year projection is 23 rows deep; without the bands a
  // reader has to count rows to work out which block of figures they are in.
  const sections = new Set(
    (Array.isArray(p.sectionRows) ? (p.sectionRows as unknown[]) : [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0),
  );
  const sectionBg = resolveBindableColor(p.sectionBg ?? stripeBg, ctx, '#F4F0E6');
  const sectionFg = resolveBindableColor(p.sectionFg ?? cellFg, ctx, '#1A1A1A');
  // Negative figures print red. In a cash-flow table the sign is the single
  // most-read piece of information on the page.
  const negativeFg = p.negativeColor
    ? resolveBindableColor(p.negativeColor, ctx, '#B91C1C')
    : null;

  // ── Ledger treatment (additive; every default reproduces the filled look) ──
  //
  // The approved Investment Compass catalogue distinguishes table treatments
  // per template — Private Banking alone declares `ledger_hairline`,
  // `ledger_tight` and `double_rule_statement` — and none of the three has a
  // filled header band. A statement sets its column heads in small tracked
  // capitals over a single heavy rule, separates rows with hairlines, and
  // closes a total with a doubled rule. Expressing that as a differently
  // coloured fill would have lost the distinction the catalogue is making.
  //
  // `headerStyle: 'fill'` is the pre-existing behaviour and stays the default,
  // so no template already in the library changes.
  const headerStyle = String(p.headerStyle ?? 'fill');
  const ruledHeader = headerStyle === 'rule';
  const headerFont = tokenFont(p.headerFont);
  const headerSize = Number(p.headerSize) > 0 ? Number(p.headerSize) : fontSize;
  const headerTracking = Number.isFinite(Number(p.headerTracking))
    ? Math.max(0, Math.min(1, Number(p.headerTracking)))
    : 0.06;
  // Rows that close a total. `double_rule_statement` sets them in a heavier
  // weight over a doubled rule — the accounting convention for "this is the
  // number the ones above add up to".
  const totals = new Set(
    (Array.isArray(p.totalRows) ? (p.totalRows as unknown[]) : [])
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 0),
  );
  const rowRule = p.rowRule === true;
  const outerBorder = p.outerBorder !== false;
  // Vertical rules between every cell. The analyst and Swiss families rule both
  // axes — a worksheet and a module grid are both systems the reader is meant
  // to see — where a statement rules only the rows.
  const gridLines = p.gridLines === true;
  const emphasisColor = resolveBindableColor(p.emphasisColor ?? borderColor, ctx, '#1A1A1A');

  const colgroup = `<colgroup>${widths.map(w => `<col style="width:${w * 100}%;"/>`).join('')}</colgroup>`;
  const thead = `<thead><tr style="${ruledHeader ? '' : `background:${headerBg};`}color:${ruledHeader ? cellFg : headerFg};">
    ${headers.map((h, i) => {
    const cellStyle = `padding:${cellPad}pt ${ruledHeader ? '4pt' : '8pt'};text-align:${numeric.has(i) ? 'right' : 'left'};`
      + `font-size:${headerSize}pt;font-weight:${ruledHeader ? 500 : 700};text-transform:uppercase;`
      + `letter-spacing:${headerTracking}em;`
      + (ruledHeader ? `border-bottom:1.5pt solid ${emphasisColor};` : '')
      + (gridLines && i < headers.length - 1 ? `border-right:1pt solid ${borderColor};` : '')
      + (headerFont ? `font-family:${headerFont};` : '');
    // Resolved, not printed verbatim.
    //
    // Every cell in the body goes through `resolveBindable`; the headers did
    // not, so a template that bound one — a comparison putting the property
    // address above its column, which is the natural thing to do — printed a
    // literal `{{cashFlowComparison.properties.0.shortAddress}}` at the top of
    // the table. Visibly wrong rather than silently blank, which is the one
    // mercy in it; no format bound a header until the seventh, which is why it
    // survived this long.
    return `<th style="${cellStyle}">${esc(resolveBindable(h, ctx))}</th>`;
  }).join('')}
  </tr></thead>`;
  // `i` is where the author put the row and `drawn` is where it lands. Band and
  // total rows are named by the author, so they key on `i`; the stripe is a
  // property of the printed page, so it keys on `drawn`.
  const tbody = `<tbody>${rows.map(({ row, index: i }, drawn) => {
    const cells = row.cells || [];
    if (sections.has(i)) {
      // A band names a group of rows and reads as one bar across the table.
      // It was one `<td colspan>`, and *measured on WeasyPrint 69.0* that is a
      // PDF/UA-1 failure on every table carrying one: the engine writes the
      // spanning cell into the structure tree as `/TD` with
      // `/A {/O /Table, /Headers […]}` and **no `/ColSpan`**, so a validator
      // counts the row one column wide and clause 7.2 test 43 — "table rows
      // shall have the same number of columns (taking into account column
      // spans)" — fails. veraPDF 1.30.2 reported exactly that.
      //
      // So the band is `headers.length` real cells sharing one ground, and the
      // label is carried by a block of zero width that is allowed to overflow.
      // Three arrangements were rendered and measured against the colspan
      // version they replace:
      //
      //   in flow, full width  — clean, but the long label widens the first
      //                          column and every figure in the table moves
      //   absolutely positioned — clean of 7.2-43 and fails **7.2-9**: the
      //                          engine tags an abspos child of a cell as a
      //                          second `/TD` nested inside the first
      //   zero-width block     — clean, no nested cell, and 4 pixels of
      //                          2,005,644 differ at 144 dpi
      //
      // The third is what this draws. `width:0` contributes nothing to the
      // column's intrinsic width, `overflow:visible` lets the label paint
      // across the band, and being in flow it keeps the row's height — which
      // is what the spanning cell used to provide.
      const band = `background:${sectionBg};color:${sectionFg};padding:${cellPad}pt 8pt;`
        + `font-size:${fontSize}pt;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;`;
      const label = esc(resolveBindable(cells[0], ctx));
      return `<tr>${headers.map((_, col) => (col === 0
        ? `<td style="${band}">`
          + `<span style="display:block;width:0;overflow:visible;white-space:nowrap;">${label}</span></td>`
        : `<td style="${band}"></td>`)).join('')}</tr>`;
    }
    const isTotal = totals.has(i);
    return `<tr style="background:${drawn % 2 ? stripeBg : 'transparent'};color:${cellFg};">
      ${cells.map((c, col) => {
    const isNumeric = numeric.has(col);
    // A real minus, so the signs stack with the digits in a right-aligned
    // column of tabular numerals. Shared with the KPI tile — see `_data.ts`.
    const text = typesetFigure(resolveBindable(c, ctx));
    const isNegative = negativeFg !== null && isNegativeFigure(text);
    const cellStyle = `padding:${cellPad}pt ${ruledHeader ? '4pt' : '8pt'};font-size:${fontSize}pt;font-variant-numeric:tabular-nums lining-nums;`
      + (isNumeric ? `text-align:right;` : '')
      + (isNumeric && numericFont ? `font-family:${numericFont};` : '')
      + (rowRule && !isTotal ? `border-bottom:1pt solid ${borderColor};` : '')
      + (gridLines && col < cells.length - 1 ? `border-right:1pt solid ${borderColor};` : '')
      // A total is closed by a doubled rule: the heavy line the figures sit on
      // and the hairline under it. `border-double` collapses at these weights
      // in WeasyPrint, so it is drawn as two borders on the same cell.
      + (isTotal ? `border-top:1.5pt solid ${emphasisColor};border-bottom:1pt solid ${emphasisColor};font-weight:600;` : '')
      + (isNegative ? `color:${negativeFg};font-weight:600;` : '');
    return `<td style="${cellStyle}">${esc(text)}</td>`;
  }).join('')}
    </tr>`;
  }).join('')}</tbody>`;

  return `<div style="${style}"><table style="width:100%;border-collapse:collapse;${outerBorder ? `border:0.5pt solid ${borderColor};` : ''}">${colgroup}${thead}${tbody}</table></div>`;
}

/**
 * Resolve a font prop to a CSS value.
 *
 * `token:mono` becomes `var(--font-mono)` — the custom property
 * `tokensToCssVariables()` emits from `tokens.fonts.mono`. Anything else is
 * treated as a literal family name. Returns null when unset, so callers can
 * omit the declaration entirely and inherit.
 */
function tokenFont(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.startsWith('token:')) {
    const key = value.slice(6).replace(/[^a-zA-Z0-9_-]/g, '');
    return key ? `var(--font-${key}, inherit)` : null;
  }
  return /^[\w\s'"-]+$/.test(value) ? value : null;
}
