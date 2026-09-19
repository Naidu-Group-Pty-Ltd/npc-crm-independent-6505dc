import { describe, expect, it } from 'vitest';
import {
  ANONYMOUS_GRID_NOTICE,
  alignTableRows,
  isDelimiterRow,
  looksAnonymousNumericGrid,
  prepareMarkdownForPlainRenderer,
  splitPipeRun,
  splitTableRow,
} from '../plainMarkdownHygiene.pure';

/**
 * The standard presentation's Markdown hygiene, pinned against the shapes the
 * audit of 291 Stone Mason Drive found on the client's pages (QA-291SM,
 * 15 Sep 2026): raw fences (QA-34), visible footnote markers (QA-30), literal
 * underscores (QA-34), an echoed authoring instruction (QA-34), a delimiter
 * row that flooded seven pages (QA-35), a merged pair of tables (QA-34) and a
 * four-header five-column matrix (QA-36). Every fixture is the production
 * shape rather than a convenient one.
 */
describe('prepareMarkdownForPlainRenderer', () => {
  it('returns a clean document byte-identical', () => {
    const clean = '## Market Position\n\nKellyville trades in the $1.85–$2.0M band.\n\n| Metric | Value |\n| --- | --- |\n| Median | $1,900,000 |\n';
    const { markdown, notices } = prepareMarkdownForPlainRenderer(clean);
    expect(markdown).toBe(clean);
    expect(Object.values(notices).every((n) => n === 0)).toBe(true);
  });

  it('unwraps a stat fence into one bold line and never prints the fence (QA-34)', () => {
    const src = [
      'Over the past year growth was moderate.',
      '::: stat label="Indicative median house value" unit="$" sub="Kellyville, 12 months to mid-2026"',
      '1,900,000',
      ':::',
      'This places the suburb in a solid bracket.',
    ].join('\n');
    const { markdown, notices } = prepareMarkdownForPlainRenderer(src);
    expect(markdown).not.toContain(':::');
    expect(markdown).toContain('**Indicative median house value:** $1,900,000 — Kellyville, 12 months to mid-2026');
    expect(markdown).toContain('This places the suburb in a solid bracket.');
    expect(notices.fencesUnwrapped).toBe(1);
  });

  it('unwraps a sidenote into a labelled paragraph and keeps every sentence', () => {
    const src = '::: sidenote\nSuburban layouts prioritise parking.\nOn-site parking for 2 cars supports practical use.\n:::\n';
    const { markdown } = prepareMarkdownForPlainRenderer(src);
    expect(markdown).not.toContain(':::');
    expect(markdown).toContain('**Note:** Suburban layouts prioritise parking. On-site parking for 2 cars supports practical use.');
  });

  it('unwraps an unknown fence kind to its body, and drops a stray closing fence', () => {
    const { markdown } = prepareMarkdownForPlainRenderer('::: columns\nLeft column prose.\n:::\n\n:::\n');
    expect(markdown).not.toContain(':::');
    expect(markdown).toContain('Left column prose.');
  });

  it('turns footnote markers into numbered notes listed once, in order of first use (QA-30)', () => {
    const src = [
      'Medians sit in the $1.85–$2.0M band.[^price1][^price2]',
      'Growth of 3–5% is quoted.[^price1]',
      '[^price1]: Property.com.au lists Kellyville house medians near $1.97M.',
      '[^price2]: AU Guide places the median slightly above Sydney.',
    ].join('\n');
    const { markdown, notices } = prepareMarkdownForPlainRenderer(src);
    expect(markdown).not.toContain('[^');
    expect(markdown).toContain('band.[1][2]');
    expect(markdown).toContain('quoted.[1]');
    expect(markdown).toContain('**Notes**');
    expect(markdown).toContain('[1] Property.com.au lists Kellyville house medians near $1.97M.');
    expect(markdown).toContain('[2] AU Guide places the median slightly above Sydney.');
    expect(notices.footnoteNotesListed).toBe(2);
  });

  it('removes a citation-shaped marker with no definition and leaves prose brackets alone', () => {
    const { markdown, notices } = prepareMarkdownForPlainRenderer('Near the metro.[^metro] Regex a[^2] stays.');
    expect(markdown).toBe('Near the metro. Regex a[^2] stays.');
    expect(notices.footnoteRefsDropped).toBe(1);
  });

  it('rewrites underscore emphasis to the asterisk form and leaves snake_case alone (QA-34)', () => {
    const { markdown, notices } = prepareMarkdownForPlainRenderer('__Strata levies__ and _tandem garage_ in edited_content.');
    expect(markdown).toBe('**Strata levies** and *tandem garage* in edited_content.');
    expect(notices.underscoreEmphasisConverted).toBe(2);
  });

  it('removes the echoed authoring instruction from a heading (QA-34)', () => {
    const { markdown, notices } = prepareMarkdownForPlainRenderer('### Employment & Commuter Access (Rendered Once Here)\n\nProse.');
    expect(markdown).toContain('### Employment & Commuter Access\n');
    expect(markdown).not.toMatch(/rendered once/i);
    expect(notices.authoringNotesRemoved).toBe(1);
  });

  it('drops a delimiter row that follows no header row instead of painting it (QA-35)', () => {
    const flood = `|:${'-'.repeat(32)}|:${'-'.repeat(10)}|:${'-'.repeat(3000)}`;
    const src = `## Risk Overview\n\nThe overall risk is moderate.\n${flood}\n\n## Purchase Costs\n\n| Item | Amount |\n| --- | --- |\n| Deposit | $259,800 |\n`;
    const { markdown, notices } = prepareMarkdownForPlainRenderer(src);
    expect(markdown).not.toContain('-'.repeat(40));
    expect(markdown).toContain('The overall risk is moderate.');
    expect(markdown).toContain('| Deposit | $259,800 |');
    expect(notices.loneDelimiterRowsDropped).toBe(1);
  });

  it('rebuilds an over-long delimiter row under its header at canonical width', () => {
    const src = `| Risk | Rating | Why it matters |\n|:${'-'.repeat(200)}|:${'-'.repeat(200)}|:${'-'.repeat(2000)}|\n| Strata | Moderate | Levies |\n`;
    const { markdown, notices } = prepareMarkdownForPlainRenderer(src);
    expect(markdown).toContain('| :--- | :--- | :--- |');
    expect(markdown).toContain('| Strata | Moderate | Levies |');
    expect(notices.delimiterRowsNormalised).toBe(1);
  });

  it('collapses a bare separator line and a punctuation run inside prose', () => {
    const { markdown, notices } = prepareMarkdownForPlainRenderer(`Prose.\n${'-'.repeat(120)}\nMore ${'='.repeat(30)} prose.`);
    expect(markdown).toBe('Prose.\n---\nMore === prose.');
    expect(notices.separatorRunsCollapsed).toBe(2);
  });

  it('drops a heading left over nothing by the passes, at any level', () => {
    const src = '## Market\n\n### Competition, New Supply and Estate Context\n\n::: stat label="x"\n:::\n\n### Fit\n\nReal prose here.\n';
    const { markdown, notices } = prepareMarkdownForPlainRenderer(src);
    expect(markdown).not.toContain('Competition, New Supply');
    expect(markdown).toContain('### Fit\n\nReal prose here.');
    expect(notices.emptyHeadingsDropped).toBe(1);
  });
});

describe('table helpers', () => {
  it('splitTableRow keeps interior empty cells and drops only the outer pipes', () => {
    expect(splitTableRow('| A |  | C |')).toEqual(['A', '', 'C']);
    expect(splitTableRow('A | B')).toEqual(['A', 'B']);
    expect(isDelimiterRow('|:---|---:|')).toBe(true);
    expect(isDelimiterRow('| Risk | Rating |')).toBe(false);
  });

  it('splits a projection table from the assumptions table written directly under it (QA-34)', () => {
    const run = [
      '| Year | Property value | Annual rent | Cashflow | Cumulative | Equity | LVR |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      '| 1 | $1,389,930 | $48,438 | -$47,384 | -$47,384 | $362,003 | 74% |',
      '| Modelling assumption | Value |',
      '| --- | --- |',
      '| Capital Growth | 5% |',
      '| Occupancy | 50 weeks a year |',
    ];
    const tables = splitPipeRun(run);
    expect(tables).toHaveLength(2);
    expect(tables[0]).toHaveLength(3);
    expect(tables[1][0]).toBe('| Modelling assumption | Value |');
  });

  it('keeps one table whole when there is one header', () => {
    expect(splitPipeRun(['| A | B |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'])).toHaveLength(1);
  });

  it('adds the missing label column to a header one cell short of its rows (QA-36)', () => {
    const rows = [
      ['Close', 'Short drive', 'Wider area', 'City-facing'],
      ['Schools', '1', '2', '3', '4'],
      ['Shopping & health', '2', '3', '4', '5'],
    ];
    const aligned = alignTableRows(rows);
    expect(aligned.labelColumnAdded).toBe(true);
    expect(aligned.header).toEqual(['', 'Close', 'Short drive', 'Wider area', 'City-facing']);
    expect(aligned.body.every((r) => r.length === 5)).toBe(true);
  });

  it('pads short rows to the header and drops cells the header did not promise', () => {
    const aligned = alignTableRows([['Item', 'Amount'], ['Deposit'], ['Duty', '$52,732', 'extra']]);
    expect(aligned.labelColumnAdded).toBe(false);
    expect(aligned.body).toEqual([['Deposit', ''], ['Duty', '$52,732']]);
  });

  it('names an anonymous numeric grid and leaves a real figures table alone', () => {
    expect(looksAnonymousNumericGrid(
      ['', 'Close', 'Short drive', 'Wider area', 'City-facing'],
      [['Schools', '1', '2', '3', '4'], ['Parks & sport', '2', '3', '4', '6']],
    )).toBe(true);
    expect(looksAnonymousNumericGrid(
      ['Year', 'Property value', 'Annual rent'],
      [['1', '$1,389,930', '$48,438'], ['3', '$1,591,331', '$51,888']],
    )).toBe(false);
    expect(looksAnonymousNumericGrid(
      ['Amenity', 'Distance (km)', 'Drive (min)'],
      [['School', '1', '4'], ['Shops', '2', '6']],
    )).toBe(false);
    expect(ANONYMOUS_GRID_NOTICE).toMatch(/not reproduced/);
  });
});
