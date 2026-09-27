/**
 * The property's features are stated once — the tables the 37 Bolin Street
 * Due Diligence report printed on pages 5, 8, 9, 10 and 12 (27 Sep 2026).
 */
import { describe, expect, it } from 'vitest';

import { dedupeDimensionBasisLists, dedupeIdenticalTables, dedupePropertyFactTables } from '../../../../supabase/functions/_shared/reports/investment/propertyFactTables.pure.ts';
import { presentStoredMarkdown } from '../../../../supabase/functions/_shared/reports/investment/derivedHygiene.pure.ts';

const CORE = [
  '| Feature | Detail |', '|---|---|',
  '| Property type | House |', '| Land size | 300 m² |', '| Bedrooms | 4 |', '| Bathrooms | 2 |', '| Parking | 1 |',
].join('\n');

const FULL = [
  '| Feature | Detail |', '|---|---|',
  '| Property type | House |', '| Land size | 300 m² |', '| Bedrooms | 4 |', '| Bathrooms | 2 |', '| Parking | 1 space |',
  '| Dwelling configuration | To be confirmed against the listing |', '| Suburb/locality | Tallawong |',
].join('\n');

const LISTING = [
  '| Feature | Detail |', '|---|---|',
  '| Dwelling | House |', '| Land | 300 m² |', '| Accommodation | Four bedrooms and two bathrooms |',
  '| Layout described by the listing | Multiple open-plan living areas |',
].join('\n');

const DOC = [
  '## Core Property Facts & Physical Profile', '', FULL, '',
  '## Dwelling, Suburb Character & Occupier Appeal', '', LISTING, '',
  '## Position Within the Locality & Infrastructure Context', '', 'The published position is as follows.', '', CORE, '',
  '## Amenity Maturity & Daily Liveability', '', CORE, '',
  '## Transport, Commute & Daily Movement', '', CORE, '',
].join('\n');

describe('the property’s features, stated once', () => {
  it('keeps the first table of core facts and replaces every later restatement with a pointer to it', () => {
    const out = dedupePropertyFactTables(DOC);
    expect(out.replaced).toEqual([5, 5, 5]);
    expect(out.markdown.match(/\| Bedrooms \| 4 \|/g)).toHaveLength(1);
    expect(out.markdown.match(/set out under “Core Property Facts & Physical Profile”/g)).toHaveLength(3);
  });

  it('never touches a table with any row that is not a core fact', () => {
    const out = dedupePropertyFactTables(DOC);
    expect(out.markdown).toContain('| Layout described by the listing | Multiple open-plan living areas |');
    expect(out.markdown).toContain('| Dwelling configuration | To be confirmed against the listing |');
  });

  it('is byte-identical on a document that states the facts once', () => {
    const once = ['## Core facts', '', CORE, '', '## Market', '', 'Prose.'].join('\n');
    expect(dedupePropertyFactTables(once)).toEqual({ markdown: once, replaced: [] });
  });

  it('leaves unrelated two-column tables alone, however alike they look', () => {
    const years = ['## Trend', '', '| Year | Median |', '|---|---|', '| 2025 | $1,300,000 |', '| 2026 | $1,378,000 |'].join('\n');
    const doc = ['## Core facts', '', CORE, '', years, '', years].join('\n');
    expect(dedupePropertyFactTables(doc).replaced).toEqual([]);
  });

  it('runs on the read path every renderer applies', () => {
    const out = presentStoredMarkdown(DOC);
    expect(out.match(/\| Bedrooms \| 4 \|/g)).toHaveLength(1);
  });
});

describe('what each dimension rested on, stated once', () => {
  const SHORT = ['**What each dimension rested on.**', '', '- **Growth.** Measured.', '- **Location.** Measured.'].join('\n');
  const FULL = ['**What each dimension rested on.**', '', '- **Growth.** Measured.', '- **Yield.** Measured.',
    '- **Demand.** Not scored.', '- **Location.** Measured.'].join('\n');

  it('keeps the complete list and points the partial copy at it', () => {
    const doc = ['## Financial Investment Scorecard', '', SHORT, '', '## Appendix', '', '### How this grade was reached', '', FULL].join('\n');
    const out = dedupeDimensionBasisLists(doc);
    expect(out.match(/What each dimension rested on\.\*\*/g)).toHaveLength(1);
    expect(out).toContain('- **Demand.** Not scored.');
    expect(out).toContain('*What each dimension rested on is set out under “How this grade was reached”.*');
  });

  it('is byte-identical on a document with one list', () => {
    const doc = ['## Scorecard', '', FULL].join('\n');
    expect(dedupeDimensionBasisLists(doc)).toBe(doc);
  });

  it('runs on the read path', () => {
    const doc = ['## A', '', SHORT, '', '## B', '', FULL].join('\n');
    expect(presentStoredMarkdown(doc).match(/What each dimension rested on\.\*\*/g)).toHaveLength(1);
  });
});

describe('a table printed twice, word for word, is printed once', () => {
  const projection = [
    '| Series | 2021 (estimated base) | 2026 | 2031 | 2036 | 2041 |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    '| Main series | 25,363 | 43,335 | 55,100 | 70,576 | 89,174 |',
  ].join('\n');
  const doc = [
    '## Dwelling, Suburb Character & Occupier Appeal', '', 'The Main series projects the SA2:', '', projection, '',
    '## Position Within the Locality', '', 'The same SA2 is projected:', '', projection, '', 'After.',
  ].join('\n');

  it('keeps the first copy and points the second at it (37 Bolin Street, 27 Sep 2026)', () => {
    const out = dedupeIdenticalTables(doc);
    expect(out.replaced).toEqual([1]);
    expect(out.markdown.split('| Main series |').length - 1).toBe(1);
    expect(out.markdown).toContain('*Set out in full under “Dwelling, Suburb Character & Occupier Appeal”.*');
    expect(out.markdown).toContain('After.');
  });

  it('runs on the read path', () => {
    expect(presentStoredMarkdown(doc).split('| Main series |').length - 1).toBe(1);
  });

  it('leaves a table that merely looks alike, and a document with no repeat, untouched', () => {
    const other = projection.replace('89,174', '89,175');
    const alike = doc.replace(/(The same SA2 is projected:\n\n)[\s\S]*?(\n\nAfter\.)/, `$1${other}$2`);
    expect(dedupeIdenticalTables(alike)).toEqual({ markdown: alike, replaced: [] });
    const once = doc.slice(0, doc.indexOf('## Position'));
    expect(dedupeIdenticalTables(once)).toEqual({ markdown: once, replaced: [] });
  });

  it('drops a repeat inside the same section without a pointer to itself', () => {
    const same = ['## Population', '', projection, '', 'Between.', '', projection].join('\n');
    const out = dedupeIdenticalTables(same);
    expect(out.markdown).not.toMatch(/Set out in full/);
    expect(out.markdown.split('| Main series |').length - 1).toBe(1);
  });
});
