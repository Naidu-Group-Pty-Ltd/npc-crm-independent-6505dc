/**
 * The four presentation defects a client could see on page after page of
 * 262 Pallas Street, Maryborough — and the rule each one broke.
 *
 * Every one of these is a construct the product itself asks for and then does
 * not draw, or a verdict it mints from a number that cannot carry one.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderMarkdown, renderInlineMarkdown } from '../../../../supabase/functions/_shared/reports/markdown.pure';
import { renderGauge } from '../../../../supabase/functions/_shared/reportDesign/charts.pure';
import { markdownToPlainText } from '../../../../supabase/functions/_shared/reportSections';

const read = (p: string) => readFileSync(p, 'utf8');

describe('the inline sparkline the prompt demands', () => {
  /*
   * `generate-investment-report`'s prompt says, in its own words, "Use
   * `~~[…]~~` inline sparklines liberally for any time-series mentioned in
   * prose". `markdown.pure.ts` had no handling of `~~` at all — the only
   * tildes in two thousand lines were in comments and a code-fence regex that
   * needs three of them on a line of their own — so the construct printed
   * verbatim, and where the markers were stripped instead a bare array of
   * numbers printed inside a client's sentence.
   */
  const source = 'Median values climbed steadily ~~[820,860,910,980,1050,1180]~~ over six years.';

  it('draws it when the caller can', () => {
    const drawn = renderInlineMarkdown(source, undefined, {
      renderInlineSpark: (values) => `<svg data-spark="${values.join('|')}"></svg>`,
    });
    expect(drawn).toContain('<svg data-spark="820|860|910|980|1050|1180"></svg>');
    expect(drawn).not.toContain('~~');
    expect(drawn).not.toContain('820,860');
  });

  it('removes it when the caller cannot — never prints it', () => {
    // The same decision `renderDirective` records: a shortcode is instruction
    // to the renderer and not something to show a client either way.
    const plain = renderInlineMarkdown(source);
    expect(plain).not.toContain('~~');
    expect(plain).not.toContain('820');
    expect(plain).toContain('Median values climbed steadily');
    expect(plain).toContain('over six years.');
  });

  it('counts what it drew and what it dropped', () => {
    const drew = renderMarkdown(source, { renderInlineSpark: () => '<svg></svg>' });
    expect(drew.notices.sparksDrawn).toBe(1);
    expect(drew.notices.sparksDropped).toBe(0);
    const dropped = renderMarkdown(source, {});
    expect(dropped.notices.sparksDrawn).toBe(0);
    expect(dropped.notices.sparksDropped).toBe(1);
  });

  it('leaves emphasis, code spans and ordinary strikethrough alone', () => {
    const opts = { renderInlineSpark: () => '<svg id="s"></svg>' };
    // Emphasis outside the drawing still works.
    expect(renderInlineMarkdown('**bold** ~~[1,2]~~ *italic*', undefined, opts))
      .toBe('<strong>bold</strong> <svg id="s"></svg> <em>italic</em>');
    // A code span is not a directive.
    expect(renderInlineMarkdown('`~~[1,2]~~`', undefined, opts)).toContain('<code>~~[1,2]~~</code>');
    // A series of one number is not a series.
    expect(renderInlineMarkdown('~~[42]~~', undefined, opts)).toBe('');
  });

  it('is removed WHOLE from plain text, not unwrapped', () => {
    // `markdownToPlainText` feeds the `{{sections.*}}` vocabulary the Compass
    // adapter publishes. It unwrapped `~~…~~`, which left `[820,860,…]` — the
    // bare array a reader actually saw.
    const plain = markdownToPlainText(source);
    expect(plain).not.toContain('820');
    expect(plain).not.toContain('[');
    // Ordinary strikethrough still unwraps.
    expect(markdownToPlainText('a ~~struck~~ word')).toContain('struck');
  });
});

describe('a gauge grades a score out of a hundred and nothing else', () => {
  const ctx = {
    palette: {
      ink: '#111', inkMuted: '#666', rule: '#ccc', ground: '#fff', groundAlt: '#eee',
      accent: '#a80', accentDeep: '#640', positive: '#070', caution: '#a70', negative: '#900',
    },
    fonts: { body: 'serif', display: 'serif', mono: 'monospace' },
    width: 520,
  } as unknown as Parameters<typeof renderGauge>[0];

  it('bands a 0-100 score', () => {
    expect(renderGauge(ctx, 82, { max: 100 })).toContain('STRONG');
  });

  it('bands nothing on any other denominator', () => {
    /*
     * A SEIFA decile reaching the gauge as `{{gauge: 7/10}}` printed
     * "7 / 10 · SOLID" inside the ring — a grading of a customer's suburb
     * that no record holds, minted from thresholds calibrated for a score out
     * of a hundred applied to an arbitrary maximum.
     */
    const svg = renderGauge(ctx, 7, { max: 10 });
    expect(svg).toContain('/10');
    for (const word of ['STRONG', 'SOLID', 'MIXED', 'CAUTIOUS']) {
      expect(svg, `a ${word} verdict on a denominator of 10`).not.toContain(word);
    }
  });
});

describe('the sources that carry the rest of it', () => {
  it('routes a SEIFA decile to a rank, not to a swept arc', () => {
    const legacy = read('supabase/functions/render-investment-report-pdf/index.ts');
    const injector = legacy.slice(legacy.indexOf('SEIFA decile mentions'), legacy.indexOf('Sub-score bullet lists'));
    // What it EMITS, not what its prose mentions.
    const emitted = [...injector.matchAll(/return `\$\{full\}[^`]*`/g)].map((m) => m[0]);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain('{{bullet:');
    expect(emitted[0], 'a decile is a rank, not a share of anything').not.toContain('{{gauge:');
  });

  it('removes a score the record does not hold from the parent document', () => {
    // `suppressUnrecordedScores` had one call site — the condense fork — so
    // the derived Briefing was cleaned and the document a client receives was
    // not. This route measured the same claims and filed a finding.
    const gen = read('supabase/functions/generate-investment-report/index.ts');
    expect(gen).toMatch(/import \{[^}]*suppressUnrecordedScores[^}]*\} from '\.\.\/_shared\/reports\/investment\/scoreClaims\.pure\.ts'/);
    const call = gen.indexOf('suppressUnrecordedScores(reportContent');
    expect(call, 'the parent route must run the guard').toBeGreaterThan(0);
    // Above the overlay branch: a switch that turns a correctness control off
    // is not a switch about formatting.
    expect(call).toBeLessThan(gen.indexOf("let compassQa: ReturnType<typeof runQAValidation> | null = null;"));
  });

  it('measures the tile grid instead of declaring it', () => {
    const blocks = read('scripts/template-library/investmentCompass/blocks.ts');
    const tile = blocks.slice(blocks.indexOf("if (plan.variant === 'tile')"), blocks.indexOf('// ruled — one or more rows'));
    expect(tile, 'a declared height clips, because the tile is the one variant with overflow:hidden')
      .not.toMatch(/const height = \d+;/);
    expect(tile).toContain('gridHeight(plan.columns');
    expect(tile, 'without `shared` the label reserve never reaches the renderer').toContain('...shared');
    const grid = read('src/lib/reportTemplate/blocks/kpiGrid.html.ts');
    expect(grid, 'slicing to one row silently drops half the dashboard')
      .not.toMatch(/^\s*const tiles = items\.slice\(/m);
    expect(grid).toMatch(/^\s*const tiles = items\.map\(/m);
  });

  it('gives every section heading the furniture name the page passes judge by', () => {
    // `pagesWithContent` and `closeDroppedBlocks` classify furniture by block
    // NAME. 'Section band' was in neither set, so a band-header master's
    // heading counted as content that draws — which is why the Risk page
    // could open over nothing and the hole could not be closed.
    const blocks = read('scripts/template-library/investmentCompass/blocks.ts');
    // The names actually EMITTED, not every occurrence of the words.
    const names = [...blocks.matchAll(/\}, '(Section [a-z]+)'\)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThanOrEqual(3);
    expect(new Set(names)).toEqual(new Set(['Section opener']));
  });

  it('states a withheld risk register rather than heading a blank page', () => {
    const templates = read('scripts/template-library/investmentCompass/templates.ts');
    const page = templates.slice(templates.indexOf("page('Risk and recommendation'"), templates.indexOf('06b The report itself'));
    expect(page).toContain("conditional: '!(risks && risks[0] && risks[0].risk)'");
    expect(page).toMatch(/statement about the record/);
  });
});

describe('a percentage cell is scaled by magnitude, never by sign', () => {
  /*
   * Both cell formatters decided whether a number was a ratio by comparing it
   * against 1 — `n > 1 ? 1 : 100` in one and `n <= 1 ? 100 : 1` in the other.
   * Every negative number fails that test, so a cash-on-cash return of -2.9%
   * printed as **-290.0%**, and the bigger the loss the worse the misprint.
   *
   * Currently unreachable from the seeded library: none of the 543 masters
   * declares a column `format` at all, so this only ever bit a hand-authored
   * Template Builder column. It is fixed rather than left because nothing
   * stops the next authored table from declaring one.
   */
  it('leaves a negative return at its own magnitude', async () => {
    const { formatCell } = await import('../../reportTemplate/blocks/_data');
    expect(formatCell(-2.9, 'percent')).toBe('-2.9%');
    expect(formatCell(-16.92, 'percent')).toBe('-16.9%');
    // A negative RATIO still scales, because its magnitude is below one.
    expect(formatCell(-0.029, 'percent')).toBe('-2.9%');
  });

  it('changes nothing on the positive side', () => {
    // 0.85 is genuinely ambiguous and this formatter was written for callers
    // storing ratios; `bindingResolver`'s filter is the unscaled reading.
    return import('../../reportTemplate/blocks/_data').then(({ formatCell }) => {
      expect(formatCell(0.85, 'percent')).toBe('85.0%');
      expect(formatCell(3.71, 'percent')).toBe('3.7%');
      expect(formatCell(0, 'percent')).toBe('0.0%');
    });
  });
});
