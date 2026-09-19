import { describe, expect, it } from 'vitest';
import { MAX_MARKDOWN_CHARS, renderMarkdown } from '../../../../supabase/functions/_shared/reports/markdown.pure';

/**
 * RS-5c.5 — a table's delimiter row is never allowed to spend the budget.
 *
 * A stored Market Intelligence layer (14 Sep 2026) carried a delimiter row
 * whose fourth cell was 123,913 dashes. The renderer's own delimiter test is
 * length-agnostic, so the table was well-formed — but the 65,536-character cap
 * fell inside that row, every body row after it was cut, and the header plus
 * the truncated separator printed raw as a paragraph and ran off the page.
 */
const table = (dashes: number) => [
  '## Risk/Opportunity Matrix',
  '',
  '| Factor | Risk Level | Opportunity Level | Key Insight |',
  `| :------------------------ | :-------- | :---------- | :${'-'.repeat(dashes)} |`,
  '| Interest rates | High | Medium | A cut is priced in for November. |',
  '| Housing supply | Medium | High | Approvals are running below trend. |',
  '',
  'The paragraph after the table.',
].join('\n');

describe('a degenerate delimiter row', () => {
  it('is normalised before the character cap, so the table and what follows survive', () => {
    const out = renderMarkdown(table(123_913));
    expect(out.notices.delimiterRowsNormalised).toBe(1);
    expect(out.notices.truncatedAtChars).toBeNull();
    expect(out.notices.tablesRejected).toBe(0);
    expect((out.html.match(/<table/g) ?? []).length).toBe(1);
    expect(out.html).toContain('Approvals are running below trend.');
    expect(out.html).toContain('The paragraph after the table.');
    expect(out.html.replace(/<[^>]+>/g, '')).not.toMatch(/-{6,}/);
  });

  it('keeps the alignment the row declared — the long row draws exactly what the short one does', () => {
    const rows = (delim: string) => ['| Item | Value |', delim, '| Rent | 650 |', '| Yield | 4.8% |'].join('\n');
    const long = renderMarkdown(rows(`| :--- | ${'-'.repeat(500)}: |`));
    const short = renderMarkdown(rows('| :--- | ---: |'));
    expect(long.notices.delimiterRowsNormalised).toBe(1);
    expect(short.notices.delimiterRowsNormalised).toBe(0);
    expect(long.html).toMatch(/<table/);
    expect(long.html).toBe(short.html);
  });

  it('leaves an ordinary document byte-identical', () => {
    const ordinary = table(8);
    const out = renderMarkdown(ordinary);
    expect(out.notices.delimiterRowsNormalised).toBe(0);
    expect((out.html.match(/<table/g) ?? []).length).toBe(1);
  });

  it('a table the model started and never filled prints nothing, not pipes', () => {
    // The stored layer ends inside its delimiter row: header, separator, end of text.
    const out = renderMarkdown([
      '## Risk/Opportunity Matrix',
      '',
      '| Factor | Risk Level | Opportunity Level | Key Insight |',
      `| :------------------------ | :-------- | :---------- | :${'-'.repeat(123_000)}`,
    ].join('\n'));
    expect(out.notices.tablesRejected).toBe(1);
    const text = out.html.replace(/<[^>]+>/g, '');
    expect(text).not.toContain('|');
    expect(text).not.toMatch(/:-+/);
    // The heading stood over nothing once the fragment went, and a heading
    // with nothing under it is dropped — the module's own rule, not a new one.
    expect(out.notices.headingsDroppedEmpty).toBe(1);
    expect(out.html).toBe('');
  });

  it('an unfilled table between a heading and its prose leaves both standing', () => {
    const out = renderMarkdown([
      '## Risk/Opportunity Matrix',
      '',
      '| Factor | Risk Level |',
      '| :--- | :--- |',
      '',
      'Rates and supply pull in opposite directions this quarter.',
    ].join('\n'));
    expect(out.notices.tablesRejected).toBe(1);
    expect(out.notices.headingsDroppedEmpty).toBe(0);
    expect(out.html).toContain('Risk/Opportunity Matrix');
    expect(out.html).toContain('Rates and supply pull in opposite directions this quarter.');
    expect(out.html.replace(/<[^>]+>/g, '')).not.toContain('|');
  });

  it('is what lets a long layer keep its budget for words', () => {
    // Without the rule the cap would have fallen inside the delimiter row.
    expect(123_913).toBeGreaterThan(MAX_MARKDOWN_CHARS);
  });
});
