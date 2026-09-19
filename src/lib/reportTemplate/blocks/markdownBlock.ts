/**
 * `markdown-block`, drawn with jsPDF.
 *
 * The HTML renderer sets this content as flowing markup and lets the layout
 * engine break the lines. jsPDF has no layout engine, so this draws the same
 * bucket — resolved by `markdownBlockContent`, which both renderers share —
 * as runs, in the block's own box.
 *
 * ## The paging boundary
 *
 * This block never adds a page and never decides which page it is on. The
 * presentation renderer walks pages; `markdownPaging.pure.ts` decides which
 * bucket of the narrative belongs to this `pageIndex`. That division is what
 * lets a master declare a fixed run of conditional pages and get a short
 * document from a short report and a long one from a long report.
 *
 * Within its bucket it draws top to bottom and stops at the page edge rather
 * than running off it. The bucket budgets are calibrated ~16% under measured
 * capacity precisely so that does not happen; a bucket that still overran
 * would print over the running foot in HTML, and the honest jsPDF equivalent
 * is to stop at the sheet.
 */
import type { Block } from '../templateSchema';
import type { BlockRenderContext } from './index';
import { resolveBindableColor } from '../bindingResolver';
import { resolveMarkdownBlockContent } from './markdownBlockContent';
import { markdownBlockToItems, type MarkdownItem, type MarkdownRun } from './markdownItems';
import type { MarkdownTableMeta } from '../../../../supabase/functions/_shared/reports/markdown.pure';
import { paintSvgFigure, svgColor } from './svgFigure';
import { COMPACT_FIGURE_FRACTION } from '../../../../supabase/functions/_shared/reportDesign/charts.pure';

interface Ink { r: number; g: number; b: number }

const rgb = (hex: string, fallback: Ink): Ink => svgColor(hex) ?? fallback;

const BODY_FALLBACK: Ink = { r: 26, g: 26, b: 26 };
const HEADING_FALLBACK: Ink = { r: 191, g: 155, b: 80 };
const RULE_FALLBACK: Ink = { r: 228, g: 228, b: 231 };

function faceFor(family: unknown, fallback: 'helvetica' | 'times'): string {
  const f = String(family ?? '').toLowerCase();
  if (f.includes('courier') || f.includes('mono')) return 'courier';
  if (f.includes('times') || f.includes('serif') || f.includes('georgia')) return 'times';
  if (f) return 'helvetica';
  return fallback;
}

export function drawMarkdownBlock(block: Block, ctx: BlockRenderContext): void {
  const content = resolveMarkdownBlockContent(block, ctx);
  if (!content || !content.page.length) return;

  const { doc, page } = ctx;
  const p = block.props as Record<string, unknown>;

  const x = Number(p.x ?? 40);
  const width = Number(p.width ?? 515);
  const bodySize = Number(p.bodySize ?? 9.5);
  const lineHeight = Number(p.lineHeight ?? 1.5);
  const body = rgb(resolveBindableColor(p.color ?? 'token:text', ctx, '#1A1A1A'), BODY_FALLBACK);
  const headingInk = rgb(resolveBindableColor(p.headingColor ?? 'token:primary', ctx, '#BF9B50'), HEADING_FALLBACK);
  const rule = rgb(resolveBindableColor(p.ruleColor ?? 'token:border', ctx, '#E4E4E7'), RULE_FALLBACK);
  const bodyFace = faceFor(p.bodyFont, 'helvetica');
  const headingFace = faceFor(p.headingFont, 'helvetica');

  // The sheet is the hard stop. `y` is a baseline-independent cursor: every
  // painter below advances it by the height it drew.
  const bottom = page.height - 24;
  let y = Number(p.y ?? 120);

  const setRun = (run: MarkdownRun, size: number, face: string, ink: Ink) => {
    doc.setFont(run.mono ? 'courier' : face,
      run.bold && run.italic ? 'bolditalic' : run.bold ? 'bold' : run.italic ? 'italic' : 'normal');
    doc.setFontSize(run.sup ? size * 0.7 : size);
    doc.setTextColor(ink.r, ink.g, ink.b);
  };

  /**
   * Draw a run of styled spans as wrapped lines.
   *
   * jsPDF measures one font at a time, so the wrap is done run by run against
   * the remaining width — which is what keeps a bold phrase in the middle of a
   * sentence on the same line as the words either side of it rather than
   * starting a new one.
   *
   * ## Where the spaces go
   *
   * A word is drawn together with the white space that PRECEDES it, and
   * `spaceForward` first moves a run's trailing space onto the next run's
   * first word. Both halves are load-bearing, and getting either wrong is
   * invisible on screen:
   *
   * - Advancing the cursor by a space's width without drawing a space puts a
   *   correct-looking gap on the page that is not in the document. The text of
   *   `**diversified** agricultural` came out as `diversifiedagricultural`,
   *   and a paragraph whose words run together when copied is one a client
   *   cannot quote.
   * - Leaving the space at the END of a run draws it — jsPDF emits
   *   `(supports a ) Tj` — but the next run is then positioned at the advance
   *   INCLUDING that space, so a reader that reconstructs words from glyph
   *   positions sees two adjacent runs and joins them anyway. Leading the
   *   following word with the space is right on both counts.
   */
  const spaceForward = (runs: readonly MarkdownRun[]): MarkdownRun[] => {
    const out = runs.map((r) => ({ ...r }));
    for (let i = 0; i < out.length - 1; i += 1) {
      const trailing = /\s+$/.exec(out[i].text);
      if (!trailing) continue;
      out[i].text = out[i].text.slice(0, -trailing[0].length);
      if (!/^\s/.test(out[i + 1].text)) out[i + 1].text = trailing[0] + out[i + 1].text;
    }
    return out.filter((r) => r.text.length > 0);
  };

  const drawRuns = (
    runs: readonly MarkdownRun[], left: number, right: number, size: number, face: string, ink: Ink,
  ): void => {
    let cursor = left;
    const spaced = spaceForward(runs);
    for (const run of spaced) {
      setRun(run, size, face, ink);
      const words = run.text.match(/\s*\S+/g) ?? [];
      let pending = '';
      const flush = () => {
        if (!pending) return;
        if (y <= bottom) {
          doc.text(pending, cursor, run.sup ? y - size * 0.28 : y);
          cursor += doc.getTextWidth(pending);
        }
        pending = '';
      };
      const newline = () => {
        y += size * lineHeight;
        cursor = left;
        setRun(run, size, face, ink);
      };
      for (const word of words) {
        const candidate = pending + word;
        if (cursor + doc.getTextWidth(candidate) <= right) {
          pending = candidate;
          continue;
        }
        // It does not fit. `pending` being empty is NOT a reason to place it
        // anyway: at the start of every run it IS empty, and accepting the
        // first word of each run unconditionally is how a paragraph with three
        // emphasis spans ran 54pt past its own measure and off the page.
        // Only a word too wide for an empty line is placed regardless, because
        // wrapping it again would not help.
        if (pending) flush();
        if (cursor > left) {
          newline();
          // The space that would have opened the line goes with it.
          pending = word.replace(/^\s+/, '');
          continue;
        }
        pending = candidate;
      }
      flush();
    }
    if (spaced.length) y += size * lineHeight;
  };

  const drawItem = (item: MarkdownItem, left: number, right: number): void => {
    if (y > bottom) return;
    switch (item.kind) {
      case 'heading': {
        const size = item.level === 2 ? bodySize * 1.5 : item.level === 3 ? bodySize * 1.2 : bodySize;
        y += item.level === 2 ? 2 : 6;
        drawRuns(item.runs, left, right, size, headingFace,
          item.level === 4 ? body : headingInk);
        y += 2;
        break;
      }
      case 'paragraph':
        drawRuns(item.runs, left, right, bodySize, bodyFace, body);
        y += 3;
        break;
      case 'listItem': {
        const indent = left + 10 + item.depth * 12;
        doc.setFont(bodyFace, 'normal');
        doc.setFontSize(bodySize);
        doc.setTextColor(body.r, body.g, body.b);
        if (y <= bottom) doc.text(item.marker, left + item.depth * 12, y);
        drawRuns(item.runs, indent, right, bodySize, bodyFace, body);
        y += 1;
        break;
      }
      case 'callout': {
        const top = y;
        const inner = left + 10;
        y += 2;
        if (item.label) {
          drawRuns([{ text: item.label.toUpperCase(), bold: true }], inner, right,
            bodySize * 0.78, bodyFace, headingInk);
        }
        for (const child of item.items) drawItem(child, inner, right);
        // The rule is drawn last because its height is only known once the
        // body has been laid out.
        doc.setDrawColor(rule.r, rule.g, rule.b);
        doc.setLineWidth(1.5);
        doc.line(left, top - bodySize, left, Math.min(y, bottom));
        y += 4;
        break;
      }
      case 'table': {
        y = drawTable(item.meta, left, right, y);
        break;
      }
      case 'figure': {
        // A compact figure keeps the chart renderer's own width and is centred
        // in the measure, which is what `.chart-compact` does on the HTML side.
        const figWidth = (right - left) * (item.compact ? COMPACT_FIGURE_FRACTION : 1);
        const figLeft = left + ((right - left) - figWidth) / 2;
        const drawn = paintSvgFigure(doc, item.svg, { x: figLeft, y: y - bodySize, width: figWidth });
        // A figure that could not be mapped to the page draws nothing and is
        // NOT replaced with its alt text: a sentence where a chart belongs
        // reads as the document's own prose. `figuresDropped` already counts
        // the directive that produced nothing at all.
        y += drawn.height ? drawn.height + 6 : 0;
        break;
      }
    }
  };

  /**
   * A table from its structured `cols`/`rows` — never from its HTML. The
   * renderer carries the rows precisely so a painter does not have to parse
   * the markup it just produced, and a row is a RECORD keyed by column, not a
   * list of cells: reading it positionally would silently transpose a table
   * whose columns were reordered.
   */
  const drawTable = (meta: MarkdownTableMeta, left: number, right: number, startY: number): number => {
    const size = bodySize * 0.92;
    const cols = meta.cols.length;
    if (!cols) return startY;
    const colWidth = (right - left) / cols;
    let cursorY = startY;

    const row = (cells: readonly string[], weight: 'bold' | 'normal', ink: Ink, ruleWidth: number): void => {
      if (cursorY > bottom) return;
      doc.setFont(bodyFace, weight);
      doc.setFontSize(size);
      doc.setTextColor(ink.r, ink.g, ink.b);
      let tallest = 1;
      cells.forEach((cell, i) => {
        const align = meta.cols[i]?.align === 'right' ? 'right' : 'left';
        const lines = doc.splitTextToSize(cell, colWidth - 6) as string[];
        tallest = Math.max(tallest, lines.length);
        doc.text(lines, left + i * colWidth + (align === 'right' ? colWidth - 4 : 2), cursorY, { align });
      });
      cursorY += tallest * size * 1.25 + 3;
      if (cursorY <= bottom) {
        doc.setDrawColor(rule.r, rule.g, rule.b);
        doc.setLineWidth(ruleWidth);
        doc.line(left, cursorY - size * 0.5, right, cursorY - size * 0.5);
      }
    };

    row(meta.cols.map((c) => c.label), 'bold', headingInk, 0.75);
    for (const r of meta.rows) {
      const total = r.__total === true;
      row(meta.cols.map((c) => String(r[c.key] ?? '')), total ? 'bold' : 'normal', body, total ? 0.75 : 0.4);
    }
    if (meta.caption && cursorY <= bottom) {
      drawRuns([{ text: meta.caption, italic: true }], left, right, size * 0.9, bodyFace, body);
      cursorY = y;
    }
    if (meta.note && cursorY <= bottom) {
      drawRuns([{ text: meta.note, italic: true }], left, right, size * 0.9, bodyFace, body);
      cursorY = y;
    }
    return cursorY + 4;
  };

  for (const mdBlock of content.page) {
    for (const item of markdownBlockToItems(mdBlock)) drawItem(item, x, x + width);
    if (y > bottom) break;
  }
}
