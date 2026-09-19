/**
 * Two table rules the template path did not have, found by reading a drawn
 * Executive Briefing rather than by reading the code.
 *
 * ## 1 · A template page has no long edge to turn to
 *
 * `renderMarkdown` sends a table wider than the portrait measure to
 * `renderPage('landscape-table', …)` and charges it `LANDSCAPE_BREAK_LINES`
 * — 38 — for the two page boundaries that page opens. Correct in the FLOWING
 * route. In the template route a master page is a fixed box, no stylesheet
 * defines `page-landscape-table`, and the `<section>` is inert: the table
 * draws portrait, inline, exactly where it was.
 *
 * So the charge bought a page break that never happened, and the flag's
 * default (`landscapeWideTables !== false` — ON unless denied) handed it to a
 * path that had never named it. Measured on the Briefing's ten-year
 * projection, 7 columns by 6 rows: charged 48.8 lines against a 41-line
 * continuation budget, so it fitted in NO bucket. It took a page of its own at
 * 23% full and stranded its own heading and standfirst on the page before —
 * "10-Year Cashflow, Equity & Growth Projection", "The recorded ten-year
 * modelling, shown at years 1, 3, 5, 7 and 10", and 93% white paper. A promise
 * of a table with the table on the next sheet. Turning it off took the
 * document from 22 pages to 20 and removed every page under 40% full.
 *
 * ## 2 · The first cell of a row is not a second column head
 *
 * `renderDataTable` marks it `<th scope="row">`, which is what makes the table
 * navigable in a tagged PDF, and it carries no class. `styleTags` selected on
 * the tag alone, so the row LABEL took the column head's rule: heading gold,
 * head weight, and none of the `vertical-align:top` every `td` beside it has.
 * On a risk register that is the risk's name set in gold, bold, floating in
 * the middle of a fifteen-line row whose other four cells start at the top.
 *
 * The shared print stylesheet already states the rule for this element — "it
 * must not look like the column head" (`reportDesign/css.pure.ts`) — and the
 * template path was the second implementation without it.
 */
import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';

/** Seven columns: one more than `MAX_PORTRAIT_TABLE_COLS`. */
const WIDE = [
  '## 10-Year Cashflow, Equity & Growth Projection',
  '',
  'The recorded ten-year modelling, shown at years 1, 3, 5, 7 and 10.',
  '',
  '| Year | Property value | Annual rent | Cashflow | Cumulative | Equity | LVR |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  '| 1 | $1,582,380 | $45,526 | -$47,376 | -$47,376 | $390,380 | 75.3% |',
  '| 3 | $1,784,678 | $48,299 | -$45,638 | -$139,548 | $592,678 | 66.8% |',
  '| 10 | $2,719,139 | $59,401 | -$57,205 | -$525,646 | $1,639,638 | 39.7% |',
].join('\n');

const schemaWith = (props: Record<string, unknown>) => ({
  version: 1 as const,
  name: 'Report',
  tokens: { colors: {}, fonts: {}, spacing: {} },
  pages: [{
    id: 'p1',
    name: 'Report',
    size: { width: 595, height: 842 },
    background: { color: '#ffffff' },
    blocks: [{
      id: 'b1',
      type: 'markdown-block',
      props: { x: 40, y: 40, width: 515, ...props },
      overlays: [],
    }],
  }],
});

const render = (source: string, data: Record<string, unknown>) =>
  renderTemplateToHtml(schemaWith({ source }) as never, { data }).html;

describe('a wide table stays on the page the master gave it', () => {
  it('opens no landscape page, because a template page has no long edge', () => {
    // Necessary, not sufficient — and worth saying so. Checked against the
    // unfixed code this one PASSES, because the landscape charge pushed the
    // table into a second bucket and this master declares one page: the
    // `<section>` never reached the document because the TABLE never did.
    // The assertion that bites is the next one.
    const html = render('{{doc.body}}', { doc: { body: WIDE } });
    expect(html).not.toContain('page-landscape-table');
  });

  it('keeps the heading, the standfirst and the table together', () => {
    // The whole point: all three on one page. They are short enough to fit any
    // budget, and only the landscape charge could have separated them.
    const html = render('{{doc.body}}', { doc: { body: WIDE } });
    expect(html).toContain('10-Year Cashflow, Equity &amp; Growth Projection');
    expect(html).toContain('The recorded ten-year modelling');
    expect(html).toContain('$1,582,380');
  });

  it('still draws every column, so nothing was dropped to make it fit', () => {
    const html = render('{{doc.body}}', { doc: { body: WIDE } });
    for (const head of ['Year', 'Property value', 'Annual rent', 'Cashflow', 'Cumulative', 'Equity', 'LVR']) {
      expect(html, head).toContain(`>${head}</th>`);
    }
  });
});

describe('the first cell of a row is the row label, not a column head', () => {
  const rowHeader = (html: string) => {
    const m = /<th scope="row"[^>]*style="([^"]*)"/.exec(html);
    return m?.[1] ?? '';
  };
  const colHeader = (html: string) => {
    const m = /<th scope="col"[^>]*style="([^"]*)"/.exec(html);
    return m?.[1] ?? '';
  };

  const html = () => render('{{doc.body}}', { doc: { body: WIDE } });

  it('is styled at all — the rule exists and is selected', () => {
    expect(rowHeader(html())).not.toBe('');
  });

  it('takes the top alignment its siblings have', () => {
    // It had none, so it centred in the row while every `td` beside it began
    // at the top. Read as a different kind of cell, which is exactly what it
    // must not be.
    expect(rowHeader(html())).toContain('vertical-align:top');
  });

  it('does not take the column head’s weight', () => {
    expect(colHeader(html())).toContain('font-weight:600');
    expect(rowHeader(html())).toContain('font-weight:500');
  });

  it('does not take the column head’s colour', () => {
    const colColour = /color:(#[0-9A-Fa-f]{3,8})/.exec(colHeader(html()))?.[1];
    const rowColour = /color:(#[0-9A-Fa-f]{3,8})/.exec(rowHeader(html()))?.[1];
    expect(colColour).toBeTruthy();
    expect(rowColour).toBeTruthy();
    expect(rowColour).not.toBe(colColour);
  });

  it('the column head keeps its own treatment, so nothing was traded away', () => {
    // A fix that made both cells look the same would pass every assertion
    // above by flattening the head, which is the opposite of the rule.
    expect(colHeader(html())).toContain('font-weight:600');
  });
});
