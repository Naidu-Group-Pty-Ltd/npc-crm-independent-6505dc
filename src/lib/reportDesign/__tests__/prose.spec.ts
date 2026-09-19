/**
 * What a lone newline means.
 *
 * Two callers reached this rule from opposite directions and each one's input is
 * the other's counter-example, so the tests are written as that pair: the
 * hard-wrapped disclaimer that must rejoin, and the transcribed KPI card that
 * must not. A rule that passes only one of them has already shipped twice.
 */
import { describe, expect, it } from 'vitest';

import { paragraphsFromWrapped, rewrapMarkdownProse } from '../prose.pure';

describe('a wrapped line rejoins', () => {
  it('joins a line that did not finish to one that continues it', () => {
    // The real disclaimer, off a real render: it printed as two ragged halves
    // on the last page of every report in nine formats.
    expect(paragraphsFromWrapped(
      'This report is based on our\nexpertise and experience in the real estate market.',
    )).toEqual([
      'This report is based on our expertise and experience in the real estate market.',
    ]);
  });

  it('keeps sentences that were written one per line', () => {
    // Some tenants type the disclaimer this way. Each line finished, so each
    // line is a paragraph.
    expect(paragraphsFromWrapped('One thing.\nAnother thing.\nA third.'))
      .toEqual(['One thing.', 'Another thing.', 'A third.']);
  });

  it('always breaks on a blank line', () => {
    expect(paragraphsFromWrapped('opening half\n\nsecond half')).toEqual(['opening half', 'second half']);
  });
});

describe('a line-per-unit block does not rejoin', () => {
  it('keeps a KPI card as three lines', () => {
    // Ending punctuation alone cannot do this: `BORROWING CAPACITY` ends on no
    // punctuation, so a rule that only tested the *previous* line joined all
    // three into body copy — the exact defect, reproduced verbatim.
    expect(paragraphsFromWrapped('BORROWING CAPACITY\n$856,932\nEstimate'))
      .toEqual(['BORROWING CAPACITY', '$856,932', 'Estimate']);
  });

  it('keeps two runs of label-value pairs apart', () => {
    expect(paragraphsFromWrapped(
      'Loan Term: 30 years Buffer Rate: 3.0%\nBuffer: Included Expense Method: Declared Expenses',
    )).toEqual([
      'Loan Term: 30 years Buffer Rate: 3.0%',
      'Buffer: Included Expense Method: Declared Expenses',
    ]);
  });
});

describe('the Markdown pass leaves structure alone', () => {
  it('does not put a blank line inside a pipe table', () => {
    // The first version separated every block with a blank line, which stopped
    // every table in the document being a table.
    const table = '| Source | Amount |\n|---|---|\n| Salary | $40,000 |';
    expect(rewrapMarkdownProse(table)).toBe(table);
  });

  it('keeps a list tight', () => {
    const list = '- first\n- second\n- third';
    expect(rewrapMarkdownProse(list)).toBe(list);
  });

  it('never joins a bullet onto the line above it', () => {
    // A bullet begins lowercase often enough that the prose rule would eat it.
    expect(rewrapMarkdownProse('What we found\n- rates held\n- credit grew'))
      .toBe('What we found\n\n- rates held\n- credit grew');
  });

  it('separates prose from a table it sits above', () => {
    expect(rewrapMarkdownProse('Gross: $223,698\n| A | B |\n|---|---|'))
      .toBe('Gross: $223,698\n\n| A | B |\n|---|---|');
  });

  it('rejoins wrapped prose and separates the units around it', () => {
    expect(rewrapMarkdownProse(
      'The assessment used a rate of\nnine percent over thirty years.\nBORROWING CAPACITY\n$856,932',
    )).toBe('The assessment used a rate of nine percent over thirty years.\n\nBORROWING CAPACITY\n\n$856,932');
  });

  it('breaks before a line that opens on a figure, which is the ambiguous case', () => {
    // `9.44% over thirty years.` after `…a rate of` really is a wrapped line,
    // and `$856,932` after `BORROWING CAPACITY` really is not — and the two are
    // indistinguishable from the text alone. The rule breaks, because in this
    // corpus the second shape is the common one and joining it is the defect
    // being fixed. Pinned so the choice is visible rather than incidental.
    expect(rewrapMarkdownProse('The assessment used a rate of\n9.44% over thirty years.'))
      .toBe('The assessment used a rate of\n\n9.44% over thirty years.');
  });

  it('passes a fenced block through verbatim', () => {
    const fenced = '```\nline one\n\nline two\n```';
    expect(rewrapMarkdownProse(fenced)).toBe(fenced);
  });

  it('leaves an empty body empty', () => {
    expect(rewrapMarkdownProse('')).toBe('');
    expect(rewrapMarkdownProse(null)).toBe('');
  });
});
