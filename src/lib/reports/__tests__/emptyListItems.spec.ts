/**
 * W4.6 — the four empty bullets on page 16.
 *
 * A marker is drawn from the list style rather than from the item's content,
 * so an item holding nothing still prints its dot and still takes its line.
 * Nothing removed them: driven through the real read path before this, every
 * one survived to the end.
 */
import { describe, it, expect } from 'vitest';
import { stripEmptyListItems } from '../investment/blockHygiene.pure';
import { presentStoredMarkdown } from '../investment/derivedHygiene.pure';

describe('an item with nothing after its marker', () => {
  it('removes every bullet flavour', () => {
    const r = stripEmptyListItems([
      '- real one',
      '- ',
      '*',
      '+  ',
      '- real two',
    ].join('\n'));
    expect(r.markdown).toBe('- real one\n- real two');
    expect(r.removed).toEqual(['- ', '*', '+  ']);
  });

  it('removes an empty ordered item and keeps the numbering it was written with', () => {
    const r = stripEmptyListItems('1. first\n2. \n3. third');
    expect(r.markdown).toBe('1. first\n3. third');
  });

  it('leaves a document carrying none byte-identical', () => {
    const doc = '## Heading\n\n- one\n- two\n\nProse.\n';
    const r = stripEmptyListItems(doc);
    expect(r.markdown).toBe(doc);
    expect(r.removed).toEqual([]);
  });

  it('changes no surviving line', () => {
    const src = '- Zone: General Residential Zone (GRZ)\n- \n- Overlays: none mapped at the coordinate';
    const out = stripEmptyListItems(src).markdown.split('\n');
    for (const line of out) expect(src.split('\n')).toContain(line);
  });
});

describe('the three bounds', () => {
  it('keeps an empty parent whose children carry the content', () => {
    const src = ['- ', '  - a nested child', '  - another', '- '].join('\n');
    const r = stripEmptyListItems(src);
    expect(r.keptAsParents).toBe(1);
    expect(r.markdown).toBe('- \n  - a nested child\n  - another');
  });

  it('looks past a blank line to find the child', () => {
    const src = ['- ', '', '  - a nested child'].join('\n');
    expect(stripEmptyListItems(src).keptAsParents).toBe(1);
  });

  it('a task list has content after its marker and is never touched', () => {
    const src = '- [ ] unchecked\n- [x] checked';
    expect(stripEmptyListItems(src).markdown).toBe(src);
  });

  it('a four-digit line is not a list marker', () => {
    // `2026.` opening a line is a year, not an ordered item; the pattern caps
    // at three digits, which is every ordered list a report will ever write.
    const src = 'Prose.\n\n2026.\n\nMore prose.';
    expect(stripEmptyListItems(src).markdown).toBe(src);
  });

  it('never edits a fenced block', () => {
    const src = ['Before.', '', '```', '- ', '*', '```', '', '- ', 'After.'].join('\n');
    const r = stripEmptyListItems(src);
    expect(r.markdown).toContain('```\n- \n*\n```');
    expect(r.removed).toEqual(['- ']);
  });

  it('never edits an inline code span', () => {
    const src = 'The marker is `- ` and this one is empty:\n- \nDone.';
    const r = stripEmptyListItems(src);
    expect(r.markdown).toContain('`- `');
    expect(r.removed).toEqual(['- ']);
  });
});

describe('through the real read path', () => {
  const page16 = [
    '## Zoning and land use',
    '',
    'The parcel sits in the General Residential Zone.',
    '',
    '- Zone: General Residential Zone (GRZ)',
    '- ',
    '- ',
    '- ',
    '- ',
    '',
    'Closing prose.',
  ].join('\n');

  it('the four bullets are gone and nothing else moved', () => {
    const out = presentStoredMarkdown(page16);
    expect(out).toContain('- Zone: General Residential Zone (GRZ)');
    expect(out).toContain('The parcel sits in the General Residential Zone.');
    expect(out).toContain('Closing prose.');
    expect(out.split('\n').filter((l) => /^[ \t]*[-*+][ \t]*$/.test(l))).toEqual([]);
  });

  it('a clean document is byte-identical', () => {
    const clean = [
      '## Zoning and land use',
      '',
      'The parcel sits in the General Residential Zone.',
      '',
      '- Zone: General Residential Zone (GRZ)',
      '- Overlays: none mapped at the coordinate',
      '',
      'Closing prose.',
    ].join('\n');
    expect(presentStoredMarkdown(clean)).toBe(clean);
  });
});
