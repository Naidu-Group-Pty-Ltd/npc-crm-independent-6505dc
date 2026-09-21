/**
 * A heading written twice around its own content is one heading.
 *
 * The fixtures are the five sub-headings the Investment Compass delivered for
 * 9 Hollow Street, Golden Square on 21 Sep 2026 printed twice — read off the
 * PDF's text layer in reading order, not off the source that made it.
 */
import { describe, expect, it } from 'vitest';
import { mergeAdjacentDuplicateHeadings } from '../investment/sectionFolding.pure';

/** Pages 24-25, verbatim in structure. */
const PLANNING = [
  '### Planning controls & zoning',
  '',
  'The key planning finding is that the property sits in the **General Residential Zone (GRZ)**',
  'in the City of Greater Bendigo, with overlays checked and none mapped at this exact coordinate.',
  '',
  '### Planning controls & zoning',
  '',
  '- Finding: The property is in GRZ – General Residential Zone, as recorded by Vicmap Planning.',
  '- Evidence: plan_zone layer for Greater Bendigo, current at 18 February 2014.',
].join('\n');

const FIVE_RISKS = [
  'Planning controls & zoning',
  'Environmental overlays (flood, bushfire, contamination)',
  'Crime & personal safety',
  'Local supply & future development pressure',
  'Transport reliance',
];

const riskSection = (h: string) =>
  [`### ${h}`, '', `Summary of ${h}.`, '', `### ${h}`, '', `- Finding: detail about ${h}.`].join('\n');

describe('the five the register announced twice', () => {
  it('merges every one of them', () => {
    const doc = ['## Risk Dashboard', '', ...FIVE_RISKS.map(riskSection)].join('\n\n');
    const r = mergeAdjacentDuplicateHeadings(doc);
    expect(r.merged).toHaveLength(5);
    for (const h of FIVE_RISKS) {
      expect(r.markdown.split('\n').filter((l) => l.trim() === `### ${h}`)).toHaveLength(1);
    }
  });

  it('keeps both bodies, in the order they were written', () => {
    const out = mergeAdjacentDuplicateHeadings(PLANNING).markdown;
    // The summary and its evidence are now one section, summary first.
    expect(out).toContain('The key planning finding');
    expect(out).toContain('- Finding: The property is in GRZ');
    expect(out.indexOf('The key planning finding')).toBeLessThan(out.indexOf('- Finding:'));
    // …under exactly one heading.
    expect(out.split('\n').filter((l) => l.trim() === '### Planning controls & zoning')).toHaveLength(1);
  });

  it('leaves no blank run where the heading stood', () => {
    expect(mergeAdjacentDuplicateHeadings(PLANNING).markdown).not.toMatch(/\n{3,}/);
  });

  it('folds a third copy onto the first, never onto the second', () => {
    const doc = ['## A', '', 'one.', '', '## A', '', 'two.', '', '## A', '', 'three.'].join('\n');
    const r = mergeAdjacentDuplicateHeadings(doc);
    expect(r.merged).toHaveLength(2);
    expect(r.markdown.split('\n').filter((l) => l.trim() === '## A')).toHaveLength(1);
    for (const w of ['one.', 'two.', 'three.']) expect(r.markdown).toContain(w);
  });

  it('ignores case, emphasis and spacing in the comparison', () => {
    const doc = ['### Transport reliance', '', 'Body.', '', '### **Transport  Reliance**'].join('\n');
    expect(mergeAdjacentDuplicateHeadings(doc).merged).toHaveLength(1);
  });
});

describe('what it must not do', () => {
  it('leaves a repeat that another heading opened', () => {
    // A deeper heading between them means the second opens something
    // structurally new; the conservative side keeps it.
    const doc = ['### Risks', '', 'Body.', '', '#### Detail', '', 'More.', '', '### Risks', '', 'Again.'].join('\n');
    expect(mergeAdjacentDuplicateHeadings(doc).markdown).toBe(doc);
  });

  it('leaves a repeat at a different level', () => {
    const doc = ['## Notes', '', 'Body.', '', '### Notes', '', 'More.'].join('\n');
    expect(mergeAdjacentDuplicateHeadings(doc).markdown).toBe(doc);
  });

  it('leaves a distant repeat, which is a landmark rather than a reproduction', () => {
    const far = ['## Notes', '', ...Array.from({ length: 9 }, (_, i) => `Paragraph ${i}.\n`), '## Notes', '', 'Later.'].join('\n');
    expect(mergeAdjacentDuplicateHeadings(far).markdown).toBe(far);
  });

  it('does not read a heading inside a fence', () => {
    const doc = ['## A', '', '```', '## A', '```', '', 'Body.'].join('\n');
    expect(mergeAdjacentDuplicateHeadings(doc).markdown).toBe(doc);
    const stat = ['## A', '', '::: stat label="x"', '## A', ':::', '', 'Body.'].join('\n');
    expect(mergeAdjacentDuplicateHeadings(stat).markdown).toBe(stat);
  });

  it('is byte-identical on a document that announces each section once', () => {
    const doc = ['# Report', '', '## One', '', 'Body one.', '', '## Two', '', 'Body two.', '', '### Two point one', '', 'Body.'].join('\n');
    expect(mergeAdjacentDuplicateHeadings(doc).markdown).toBe(doc);
    expect(mergeAdjacentDuplicateHeadings(doc).merged).toEqual([]);
  });

  it('is idempotent', () => {
    const once = mergeAdjacentDuplicateHeadings(PLANNING).markdown;
    expect(mergeAdjacentDuplicateHeadings(once).markdown).toBe(once);
  });
});

describe('the read path carries it', () => {
  it('presentStoredMarkdown announces each risk once', async () => {
    const { presentStoredMarkdown } = await import('../investment/derivedHygiene.pure');
    const doc = ['## Risk Dashboard', '', ...FIVE_RISKS.map(riskSection)].join('\n\n');
    const out = presentStoredMarkdown(doc);
    for (const h of FIVE_RISKS) {
      expect(out.split('\n').filter((l) => l.trim() === `### ${h}`)).toHaveLength(1);
    }
    // …and every risk still carries both what was found and the detail under it.
    for (const h of FIVE_RISKS) {
      expect(out).toContain(`Summary of ${h}.`);
      expect(out).toContain(`- Finding: detail about ${h}.`);
    }
  });
});
