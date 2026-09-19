/**
 * A column with a header and nothing under it, and a citation bracket with
 * nothing in it.
 *
 * Both were on the five documents supplied for acceptance on 18 September
 * 2026. They are the same defect as the placeholder rows `stripPlaceholderRows`
 * already removes, one grain apart: the reader is shown a heading - `Source`,
 * `Period`, `Evidence` - and left to decide whether it means *nothing was
 * found* or *nothing was printed*, and a reference they are invited to follow
 * that goes nowhere.
 *
 * The negative cases carry the weight. A dash is a VALUE in this product, and
 * a meaningful limitation must survive: a column of em dashes says the record
 * holds nothing there, which is a fact worth printing, and a sentence that
 * cites a real register keeps its bracket.
 */
import { describe, expect, it } from 'vitest';
import {
  dropEmptyTableColumns,
  presentStoredMarkdown,
  stripEmptyCitations,
} from '../investment/derivedHygiene.pure';

const table = (rows: string[]) => rows.join('\n');

describe('a column that is empty in every body row', () => {
  const MEASURED = table([
    '| Control | Value | Source |',
    '| --- | --- | --- |',
    '| Zone | R2 Low Density Residential |  |',
    '| Maximum building height | 8.5 m |  |',
    '| Minimum lot size | 450 m2 |  |',
  ]);

  it('is removed with its header', () => {
    const r = dropEmptyTableColumns(MEASURED);
    expect(r.removed).toEqual([{ table: 0, header: 'Source' }]);
    expect(r.markdown).not.toContain('Source');
    expect(r.markdown).toContain('| Zone | R2 Low Density Residential |');
  });

  it('keeps every other column, in order', () => {
    const lines = dropEmptyTableColumns(MEASURED).markdown.split('\n');
    expect(lines[0]).toBe('| Control | Value |');
    expect(lines[1]).toBe('| --- | --- |');
    expect(lines).toHaveLength(5);
  });

  it('removes two at once', () => {
    const r = dropEmptyTableColumns(table([
      '| Item | Value | Period | Source |',
      '| --- | --- | --- | --- |',
      '| Median | $555,000 |  |  |',
    ]));
    expect(r.removed.map((x) => x.header).sort()).toEqual(['Period', 'Source']);
  });
});

describe('what it must NOT remove', () => {
  it('a column of dashes - the record says it holds nothing, which is a fact', () => {
    const md = table([
      '| Item | Value | Source |',
      '| --- | --- | --- |',
      '| Bedrooms | 3 | — |',
      '| Bathrooms | 1 | — |',
    ]);
    expect(dropEmptyTableColumns(md).removed).toEqual([]);
  });

  it('a column with one value and the rest empty', () => {
    const md = table([
      '| Item | Value | Source |',
      '| --- | --- | --- |',
      '| Median | $555,000 | ABS |',
      '| Rent | $442 |  |',
    ]);
    expect(dropEmptyTableColumns(md).removed).toEqual([]);
  });

  it('the first column, which is the row label', () => {
    const md = table([
      '|  | Value | Source |',
      '| --- | --- | --- |',
      '|  | $555,000 | ABS |',
    ]);
    expect(dropEmptyTableColumns(md).removed).toEqual([]);
  });

  it('a two-column table, whatever it holds', () => {
    const md = table(['| Item | Value |', '| --- | --- |', '| Median |  |']);
    expect(dropEmptyTableColumns(md).removed).toEqual([]);
  });

  it('a table with a header and no body rows', () => {
    const md = table(['| Item | Value | Source |', '| --- | --- | --- |']);
    expect(dropEmptyTableColumns(md).removed).toEqual([]);
  });

  it('ordinary prose containing a pipe', () => {
    const md = 'The zone is R2 | low density | residential.';
    expect(dropEmptyTableColumns(md).markdown).toBe(md);
  });
});

describe('a citation bracket with nothing in it', () => {
  it('is removed with the space in front of it', () => {
    const r = stripEmptyCitations('The lot is zoned R2. [Source: ]');
    expect(r.markdown).toBe('The lot is zoned R2.');
    expect(r.removed).toBe(1);
  });

  it('catches the bare forms too', () => {
    for (const form of ['[ ]', '[Source]', '[source:]', '[Reference: ]', '[citation]']) {
      expect(stripEmptyCitations(`A sentence. ${form}`).markdown).toBe('A sentence.');
    }
  });

  it('leaves a real citation alone', () => {
    const md = 'The lot is bushfire prone.[NSW Rural Fire Service bushfire prone land map, 2026]';
    expect(stripEmptyCitations(md)).toEqual({ markdown: md, removed: 0 });
  });

  it('leaves a markdown link alone', () => {
    const md = 'See [the register](https://example.test/register).';
    expect(stripEmptyCitations(md)).toEqual({ markdown: md, removed: 0 });
  });
});

describe('the read path carries both', () => {
  it('a stored document is cleaned for every reader, with no migration', () => {
    const stored = [
      '## Planning Controls',
      '',
      '| Control | Value | Source |',
      '| --- | --- | --- |',
      '| Zone | R2 Low Density Residential |  |',
      '',
      'The zone admits a dwelling house. [Source: ]',
    ].join('\n');
    const out = presentStoredMarkdown(stored);
    expect(out).not.toContain('Source');
    expect(out).toContain('| Zone | R2 Low Density Residential |');
    expect(out).toContain('The zone admits a dwelling house.');
  });

  it('a clean document is returned byte-identical', () => {
    const clean = [
      '## Planning Controls',
      '',
      '| Control | Value | Source |',
      '| --- | --- | --- |',
      '| Zone | R2 | NSW ePlanning |',
      '',
      'The zone admits a dwelling house.',
    ].join('\n');
    expect(presentStoredMarkdown(clean)).toBe(clean);
  });
});
