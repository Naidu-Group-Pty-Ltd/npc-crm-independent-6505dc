/**
 * The Risk Dashboard's register reached a client as two lines of prose.
 *
 * Page 23 of the 9 Hollow Street Compass, 20 Sep 2026, read off the delivered
 * PDF's own text layer — body face, body size, a list bullet in front of the
 * only row:
 *
 *     Risk | Exposure level | Evidence chip | Due-diligence focus
 *     •Crime | Not assessed | Unverified | State crime register and local police data
 *
 * That is the artefact the section is built around, the thing the registry
 * calls "a scan". It is also the ONLY register the three regenerated Compass
 * reports produced — 1 Crestview Avenue and 97 Poole Road wrote none at all —
 * and the instruction is the likely reason for both, because it described the
 * register as "Risk | Exposure | Evidence" and never said the word table.
 *
 * The instruction now shows the markup. This is the guarantee behind it, and
 * most of the file below is the half that matters: the prose it must refuse.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_CELL_WORDS,
  MAX_HEADER_CELL_WORDS,
  MIN_PSEUDO_TABLE_COLUMNS,
  promotePipedPseudoTables,
} from '../investment/pseudoTables.pure';
import { presentStoredMarkdown } from '../../../../supabase/functions/_shared/reports/investment/derivedHygiene.pure';

const HOLLOW = [
  'Risk | Exposure level | Evidence chip | Due-diligence focus',
  '- Crime | Not assessed | Unverified | State crime register and local police data',
].join('\n');

describe('the register that printed as prose', () => {
  it('becomes the table it was meant to be', () => {
    const out = promotePipedPseudoTables(HOLLOW);
    expect(out.promoted).toHaveLength(1);
    expect(out.promoted[0].header).toEqual([
      'Risk', 'Exposure level', 'Evidence chip', 'Due-diligence focus',
    ]);
    expect(out.promoted[0].rows).toBe(1);
    expect(out.markdown.split('\n')).toEqual([
      '| Risk | Exposure level | Evidence chip | Due-diligence focus |',
      '| --- | --- | --- | --- |',
      '| Crime | Not assessed | Unverified | State crime register and local police data |',
    ]);
  });

  it('loses the list bullet, because a table row is not a bullet', () => {
    expect(promotePipedPseudoTables(HOLLOW).markdown).not.toMatch(/^[-*+•]/mu);
  });

  it('reaches a stored document through the one read-path scrub', () => {
    // Driven through `presentStoredMarkdown`, so the test sees the WIRING and
    // not only the implementation.
    const out = presentStoredMarkdown(`## Risk Dashboard\n\n${HOLLOW}\n`);
    expect(out).toContain('| --- | --- | --- | --- |');
    expect(out).toContain('| Crime | Not assessed | Unverified |');
  });

  it('runs before the passes that understand tables', () => {
    /*
     * The ordering claim, asserted rather than promised: a promoted table's
     * placeholder row is dropped by `stripPlaceholderRows`, which sits below
     * it in the chain and could not have seen a row of prose.
     */
    const withGap = [
      '## Risk Dashboard',
      '',
      'Risk | Exposure | Evidence',
      '- Crime | Not assessed | Unverified',
      '- Flood | N/A | N/A',
      '',
      'Something after.',
    ].join('\n');
    const out = presentStoredMarkdown(withGap);
    expect(out).toContain('| Crime | Not assessed | Unverified |');
    expect(out).not.toContain('Flood');
  });
});

describe('what it refuses, which is the half that matters', () => {
  const refuses = (label: string, md: string) => {
    it(label, () => {
      const out = promotePipedPseudoTables(md);
      expect(out.promoted, label).toHaveLength(0);
      expect(out.markdown).toBe(md);
    });
  };

  refuses('two cells — an aside, not a grid', [
    'Zone | R2',
    'Height | 10 m',
  ].join('\n'));

  refuses('a run whose lines do not line up', [
    'Risk | Exposure | Evidence',
    '- Crime | Not assessed',
  ].join('\n'));

  refuses('a single line, which is not a table', 'Risk | Exposure | Evidence');

  refuses('a run that opens with a bullet, because it has no header', [
    '- Buy | hold | sell',
    '- Rent | lease | manage',
  ].join('\n'));

  refuses('a header carrying sentence punctuation', [
    'The zone permits a dwelling. | Overlays were checked. | Nothing found.',
    'a | b | c',
  ].join('\n'));

  refuses('a header cell that is a phrase rather than a column name', [
    `${'word '.repeat(MAX_HEADER_CELL_WORDS + 1).trim()} | b | c`,
    'x | y | z',
  ].join('\n'));

  refuses('a cell carrying a paragraph', [
    'Risk | Exposure | Evidence',
    `Crime | Not assessed | ${'word '.repeat(MAX_BODY_CELL_WORDS + 1).trim()}`,
  ].join('\n'));

  refuses('a stray pipe leaving an empty cell', [
    'Risk | | Evidence',
    'Crime | Not assessed | Unverified',
  ].join('\n'));

  refuses('a table that is already marked up', [
    '| Risk | Exposure | Evidence |',
    '| --- | --- | --- |',
    '| Crime | Not assessed | Unverified |',
  ].join('\n'));

  refuses('lines inside a fenced block, which are code', [
    '```',
    'Risk | Exposure | Evidence',
    'Crime | Not assessed | Unverified',
    '```',
  ].join('\n'));

  refuses('two adjacent glance strips, which are drawings and not a grid', [
    '{{glance: ✓ Covered outdoor area | ⚠ Single bathroom | ◆ Character finishes}}',
    '{{glance: ✓ Quiet street | ⚠ No garage | ◆ Established garden}}',
  ].join('\n'));

  refuses('a bars directive sitting beside another', [
    '{{bars: Schools 8, Transport 4 | title=Amenity | max=10}}',
    '{{bars: Flood 2, Bushfire 1 | title=Hazard | max=10}}',
  ].join('\n'));

  refuses('a heading that happens to carry pipes', [
    '## Risk | Exposure | Evidence',
    'Crime | Not assessed | Unverified',
  ].join('\n'));

  it('is byte-identical on a document with no pipes at all', () => {
    const md = '## Risk Dashboard\n\nThe key planning risk is structural.\n';
    expect(promotePipedPseudoTables(md).markdown).toBe(md);
  });

  it('names its own floor rather than hiding it', () => {
    expect(MIN_PSEUDO_TABLE_COLUMNS).toBeGreaterThanOrEqual(3);
  });
});

describe('the bounds hold on a whole delivered page', () => {
  it('promotes the register and leaves every sentence around it alone', () => {
    const page = [
      '## Risk Dashboard',
      '',
      '### Summary Risk Register',
      '',
      'This register summarises the main risk themes for the property in Golden Square,',
      'using the planning and environmental desktop checks already completed.',
      '',
      HOLLOW,
      '',
      '### Material Risk Detail Blocks',
      '',
      '**Planning overlays & covenants**',
      '',
      '- Finding: The plan_overlay layer was asked for heritage, design, flood and bushfire',
      '  controls and returned no mapped control at this point.',
      '- Next check: Obtain a Planning Property Report and planning certificate.',
      '',
    ].join('\n');
    const out = promotePipedPseudoTables(page);
    expect(out.promoted).toHaveLength(1);
    expect(out.markdown).toContain('This register summarises the main risk themes');
    expect(out.markdown).toContain('- Finding: The plan_overlay layer was asked');
    expect(out.markdown).toContain('| Risk | Exposure level | Evidence chip | Due-diligence focus |');
  });
});
