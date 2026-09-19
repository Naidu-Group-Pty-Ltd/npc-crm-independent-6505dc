/* eslint-disable no-restricted-syntax -- this module emits the *document's own*
   colours, read out of the .xlsx. They are not app styling and must not be
   mapped onto our semantic tokens: doing so would change what the user is
   shown, which is the one thing a faithful viewer must not do. The single
   literal below is a neutral fallback for a border whose colour the file
   omits. */

/**
 * Render an .xlsx worksheet as HTML, faithfully.
 *
 * There is no browser-native way to display a spreadsheet, and both
 * alternatives to rendering it ourselves are worse: an embedded Office viewer
 * would ship the document to a third party, and a summary table would show a
 * different document from the one it claims to show.
 *
 * The work is split between the two things that can each do half of it:
 *
 *  - **SheetJS** reads the grid — values, the *formatted* text Excel would
 *    display (`w`, which already has `$5,850,000` and `68.8%` in it), cached
 *    formula results, merges, column widths and row heights.
 *  - **`xlsxStyles`** reads fonts, fills, borders and alignment out of the file
 *    directly, because SheetJS's community build drops them and ExcelJS cannot
 *    open these documents at all. See that file's header.
 *
 * The output is a complete, script-free HTML document destined for a sandboxed
 * iframe. Nothing is injected into the app's own DOM: a spreadsheet carries its
 * own typography, and our design system would otherwise reach into it and
 * change what the user is being shown.
 */

import * as XLSX from 'xlsx';
import { readWorkbookStyles, type CellStyle, type SheetStyles } from './xlsxStyles';
import { measureDocuments } from './measureFrame';

export interface RenderedSheet {
  name: string;
  /** Complete HTML document for the iframe. */
  html: string;
  rows: number;
  columns: number;
  /**
   * Rendered size in CSS pixels, measured by laying the sheet out.
   *
   * The frame is sandboxed and script-free, so it cannot report its own size.
   * These come from `measureFrame`, which renders the identical HTML in a
   * hidden frame and reads the result — see that module for why adding up the
   * spreadsheet's own row heights is not good enough.
   */
  width: number;
  height: number;
  /**
   * Whether the size above came from a real layout. False means the fallback
   * (padded so it cannot clip, but not exact) — the viewer re-measures such a
   * sheet when its tab is shown.
   */
  measured: boolean;
}

export interface RenderedWorkbook {
  sheets: RenderedSheet[];
}

/** Excel's own conversion when a column has no explicit pixel width. */
const DEFAULT_COLUMN_PX = 64;
const DEFAULT_ROW_PX = 20;

/** Breathing room around the grid. Mirrored in `documentShell`'s `.sheet`. */
const SHEET_PADDING_PX = 20;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BORDER_WIDTHS: Record<string, string> = {
  hair: '1px', thin: '1px', medium: '2px', thick: '3px',
  dotted: '1px', dashed: '1px', double: '3px',
  mediumDashed: '2px', slantDashDot: '2px', mediumDashDot: '2px',
};

const BORDER_STYLES: Record<string, string> = {
  hair: 'solid', thin: 'solid', medium: 'solid', thick: 'solid',
  dotted: 'dotted', dashed: 'dashed', double: 'double',
  mediumDashed: 'dashed', slantDashDot: 'dashed', mediumDashDot: 'dashed',
};

const HORIZONTAL: Record<string, string> = {
  left: 'left', center: 'center', right: 'right', justify: 'justify',
  centerContinuous: 'center', distributed: 'justify', fill: 'left',
};

const VERTICAL: Record<string, string> = {
  top: 'top', middle: 'middle', center: 'middle', bottom: 'bottom',
  distributed: 'middle', justify: 'middle',
};

function borderCss(side: string, edge: { style: string; colour?: string } | undefined): string {
  if (!edge) return '';
  const width = BORDER_WIDTHS[edge.style] ?? '1px';
  const style = BORDER_STYLES[edge.style] ?? 'solid';
  return `border-${side}:${width} ${style} ${edge.colour ?? '#9aa0a6'};`;
}

function styleCss(style: CellStyle | undefined, numeric: boolean): string {
  let css = '';
  if (style?.fill) css += `background:${style.fill};`;
  if (style?.fontColour) css += `color:${style.fontColour};`;
  if (style?.bold) css += 'font-weight:700;';
  if (style?.italic) css += 'font-style:italic;';
  if (style?.underline) css += 'text-decoration:underline;';
  if (style?.fontSize) css += `font-size:${style.fontSize}pt;`;
  if (style?.fontName) {
    // Single quotes, and any of its own stripped: this lands inside a
    // double-quoted `style` attribute, and a double quote here would close the
    // attribute early and spill CSS into the markup.
    const family = style.fontName.replace(/['"\\]/g, '');
    css += `font-family:'${family}','Segoe UI',system-ui,sans-serif;`;
  }

  const horizontal = HORIZONTAL[style?.horizontal ?? ''];
  // Excel's default alignment is by type: numbers right, everything else left.
  if (horizontal) css += `text-align:${horizontal};`;
  else if (numeric) css += 'text-align:right;';

  const vertical = VERTICAL[style?.vertical ?? ''];
  if (vertical) css += `vertical-align:${vertical};`;
  if (style?.wrap) css += 'white-space:pre-wrap;';
  if (style?.indent) css += `padding-left:${5 + style.indent * 8}px;`;

  if (style?.border) {
    css += borderCss('top', style.border.top);
    css += borderCss('right', style.border.right);
    css += borderCss('bottom', style.border.bottom);
    css += borderCss('left', style.border.left);
  }

  return css;
}

/** The text Excel shows: its own formatted string where there is one. */
function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell) return '';
  if (typeof cell.w === 'string' && cell.w !== '') return cell.w;
  if (cell.v == null) return '';
  if (cell.v instanceof Date) return cell.v.toLocaleDateString('en-AU');
  return String(cell.v);
}

/** The document shell. No scripts — the iframe is sandboxed with none allowed. */
function documentShell(body: string): string {
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<style>
        :root { color-scheme: light; }
        html, body { margin:0; padding:0; background:#ffffff; }
        body {
          font-family:"Aptos Narrow","Calibri","Segoe UI",system-ui,sans-serif;
          font-size:11pt; color:#111827; -webkit-text-size-adjust:100%;
        }
        .sheet { padding:${SHEET_PADDING_PX}px; width:max-content; min-width:100%; box-sizing:border-box; }
        table { border-collapse:collapse; table-layout:fixed; }
        td { padding:2px 5px; vertical-align:bottom; overflow:hidden; word-wrap:break-word; }
      </style></head><body>${body}</body></html>`;
}

interface SheetGeometry {
  merges: Map<string, { rowSpan: number; colSpan: number }>;
  covered: Set<string>;
}

function geometry(sheet: XLSX.WorkSheet): SheetGeometry {
  const merges = new Map<string, { rowSpan: number; colSpan: number }>();
  const covered = new Set<string>();

  (sheet['!merges'] ?? []).forEach((range) => {
    merges.set(`${range.s.r}:${range.s.c}`, {
      rowSpan: range.e.r - range.s.r + 1,
      colSpan: range.e.c - range.s.c + 1,
    });
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      for (let col = range.s.c; col <= range.e.c; col += 1) {
        if (row === range.s.r && col === range.s.c) continue;
        covered.add(`${row}:${col}`);
      }
    }
  });

  return { merges, covered };
}

function renderSheet(
  name: string, sheet: XLSX.WorkSheet, styles: Map<string, CellStyle> | undefined,
): RenderedSheet {
  const reference = sheet['!ref'];
  if (!reference) {
    return {
      name, html: documentShell('<div class="sheet"></div>'),
      rows: 0, columns: 0, width: 0, height: 0, measured: false,
    };
  }

  const range = XLSX.utils.decode_range(reference);
  const { merges, covered } = geometry(sheet);
  const columnInfo = sheet['!cols'] ?? [];
  const rowInfo = sheet['!rows'] ?? [];

  // Render from column 0 even when the sheet's range starts further right, so
  // the gutter columns these workbooks use for indentation are preserved.
  const firstColumn = 0;
  const firstRow = 0;

  const widths: string[] = [];
  let contentWidth = 0;
  for (let col = firstColumn; col <= range.e.c; col += 1) {
    const info = columnInfo[col];
    if (info?.hidden) { widths.push('<col style="width:0px">'); continue; }
    const px = Math.round(info?.wpx ?? (info?.wch ? info.wch * 7 + 5 : DEFAULT_COLUMN_PX));
    contentWidth += px;
    widths.push(`<col style="width:${px}px">`);
  }

  const rows: string[] = [];
  let contentHeight = 0;
  for (let row = firstRow; row <= range.e.r; row += 1) {
    const info = rowInfo[row];
    if (info?.hidden) continue;

    const heightPx = Math.round(info?.hpx ?? DEFAULT_ROW_PX);
    contentHeight += heightPx;
    const cells: string[] = [];

    for (let col = firstColumn; col <= range.e.c; col += 1) {
      const key = `${row}:${col}`;
      if (covered.has(key)) continue;

      const address = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = sheet[address] as XLSX.CellObject | undefined;
      const text = cellText(cell);
      const span = merges.get(key);

      const attributes = [
        span && span.colSpan > 1 ? ` colspan="${span.colSpan}"` : '',
        span && span.rowSpan > 1 ? ` rowspan="${span.rowSpan}"` : '',
      ].join('');

      const css = styleCss(styles?.get(address), cell?.t === 'n');
      cells.push(
        `<td${attributes}${css ? ` style="${escapeHtml(css)}"` : ''}>${escapeHtml(text)}</td>`,
      );
    }

    rows.push(`<tr style="height:${heightPx}px">${cells.join('')}</tr>`);
  }

  const body = '<div class="sheet"><table role="presentation">'
    + `<colgroup>${widths.join('')}</colgroup><tbody>${rows.join('')}</tbody></table></div>`;

  return {
    name,
    html: documentShell(body),
    rows: range.e.r + 1,
    columns: range.e.c + 1,
    // A floor only. The real size is measured after rendering: a row whose text
    // wraps to two lines in a browser where Excel used one is taller than the
    // height stored in the file, and summing those heights under-measured every
    // sheet in the pack.
    width: contentWidth + SHEET_PADDING_PX * 2,
    height: contentHeight + SHEET_PADDING_PX * 2,
    measured: false,
  };
}

/**
 * Read a workbook and render every visible sheet.
 *
 * `cellStyles` is on for the widths and heights, `cellNF` and `cellDates` so
 * `w` carries the number format Excel would apply rather than a bare figure.
 */
export async function renderWorkbookToHtml(data: ArrayBuffer): Promise<RenderedWorkbook> {
  const workbook = XLSX.read(data, {
    type: 'array', cellStyles: true, cellNF: true, cellDates: true,
  });

  // Styling is a separate read of the same bytes; a failure there costs the
  // colours, not the document, so it must not take the viewer down with it.
  let styles: SheetStyles = new Map();
  try {
    styles = await readWorkbookStyles(data);
  } catch {
    styles = new Map();
  }

  const hidden = new Set(
    (workbook.Workbook?.Sheets ?? [])
      .filter((entry) => entry.Hidden)
      .map((entry) => entry.name),
  );

  const sheets = workbook.SheetNames
    .filter((name) => !hidden.has(name))
    .map((name) => renderSheet(name, workbook.Sheets[name], styles.get(name)));

  if (!sheets.length) throw new Error('The workbook has no visible sheets.');

  // Lay each sheet out for real and take the size from that. Sheets with no
  // grid have nothing to measure and keep their (zero) estimate.
  const measured = await measureDocuments(sheets.map((sheet) => ({
    html: sheet.html,
    selector: 'table',
    fallback: { width: sheet.width, height: sheet.height },
  })));

  return {
    sheets: sheets.map((sheet, index) => {
      const size = measured[index];
      if (size?.measured) {
        return { ...sheet, width: size.width, height: size.height, measured: true };
      }
      // No measurement — only the arithmetic floor, which on this pack runs up
      // to 358px short (rows wrap wider in a browser than they did in Excel).
      // Pad it so the degraded mode shows blank space below the grid instead of
      // silently cutting rows off: too tall is visible and harmless, too short
      // is invisible data loss. Sheets with no grid at all stay zero.
      if (!sheet.height || !sheet.width) return sheet;
      return {
        ...sheet,
        width: Math.round(sheet.width * 1.05) + 64,
        height: Math.round(sheet.height * 1.3) + 400,
      };
    }),
  };
}
