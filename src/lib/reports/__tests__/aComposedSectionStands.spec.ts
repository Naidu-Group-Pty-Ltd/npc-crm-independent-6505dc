/**
 * The composed copy is the one that stands.
 *
 * Measured on the 97 Poole Road Compass of 20 Sep 2026, read as a delivered
 * PDF. Four sections the model wrote that it should not have:
 *
 *     p19  ## Suitability Profile      (financial:required — no Compass carries one)
 *     p19  ## Holding Strategy         (financial:required — likewise)
 *     p20  ## Exit Outlook             …and p34 ## Resale Liquidity & Exit Outlook
 *     p20  ## Monitoring Plan          …and p38 ## Monitoring & Review Plan
 *
 * The last two are the same subject twice, fourteen and eighteen pages apart,
 * and the copies CONTRADICT each other. The composed Resale Liquidity opens
 * "Neither answers how easily this sells … no figure below should be read as
 * standing in for them"; the model's Exit Outlook says "the cleanest exit path
 * is to sell into the owner-occupier market", which is the claim the composed
 * section exists to refuse.
 *
 * `strategySectionRules` is the cause and is fixed separately: it told the
 * model FIVE sections were "COMPOSED from the record and supplied to you
 * complete" while the Compass composes three, so two of them were named as
 * supplied and supplied by nothing.
 */
import { describe, expect, it } from 'vitest';
import {
  dropComposedSectionReproductions,
} from '../investment/sectionFolding.pure';
import {
  SECTION_REGISTRY,
  sectionIdForHeading,
} from '../investment/sectionRegistry.pure';
import { presentStoredMarkdown } from '../../../../supabase/functions/_shared/reports/investment/derivedHygiene.pure';
import { runQAValidation } from '../compassQAValidator';

const POOLE = [
  '## Market Positioning',
  '',
  'Recorded price against market medians.',
  '',
  '## Exit Outlook',
  '',
  'The cleanest exit path is to sell into the owner-occupier market.',
  '',
  '## Monitoring Plan',
  '',
  'The most useful watchpoints are local price direction and supply flow.',
  '',
  '## Property Fit Within the Suburb',
  '',
  'Positioning of the asset within local housing stock.',
  '',
  '## Resale Liquidity & Exit Outlook',
  '',
  'Neither answers how easily this sells. Days on market are not measured here.',
  '',
  '## Monitoring & Review Plan',
  '',
  'A report is a reading taken on a day.',
  '',
].join('\n');

describe('the headings that resolved to nothing', () => {
  it('now name the sections they are', () => {
    /*
     * This is why no rule could fire: `sectionIdForHeading` returned null for
     * all three, so the document had one section the registry knew and one it
     * did not, and nothing could see they were the same subject. It also
     * stopped `fork-investment-report` routing them, which drops an unmatched
     * heading from both children without saying so.
     */
    expect(sectionIdForHeading('Exit Outlook')).toBe('exitStrategy');
    expect(sectionIdForHeading('Monitoring Plan')).toBe('monitoring');
    expect(sectionIdForHeading('Suitability Profile')).toBe('suitability');
  });

  it('a heading still belongs to exactly ONE section', () => {
    /*
     * The registry's own rule, re-checked because three aliases were added:
     * listed in two entries a heading resolves to whichever comes first and
     * the other silently loses it. Collisions WITHIN one entry's list are not
     * the defect — `provenance` legitimately carries "PROFESSIONAL DISCLAIMER"
     * with and without its dingbat — so the key is compared across entries.
     */
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const entry of SECTION_REGISTRY) {
      for (const alias of entry.aliases) {
        const key = alias.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const held = owner.get(key);
        if (held && held !== entry.id) clashes.push(`"${alias}" -> ${held} and ${entry.id}`);
        owner.set(key, entry.id);
      }
    }
    expect(clashes).toEqual([]);
  });
});

describe('a section the platform composes, written again by the model', () => {
  it('keeps the composed copy and drops the reproduction', () => {
    const out = dropComposedSectionReproductions(POOLE);
    expect(out.dropped.map((d) => d.id).sort()).toEqual(['exitStrategy', 'monitoring']);
    expect(out.dropped.map((d) => d.heading).sort()).toEqual(['Exit Outlook', 'Monitoring Plan']);
    expect(out.markdown).not.toContain('## Exit Outlook');
    expect(out.markdown).not.toContain('## Monitoring Plan');
    expect(out.markdown).toContain('## Resale Liquidity & Exit Outlook');
    expect(out.markdown).toContain('## Monitoring & Review Plan');
    // The claim the composed section exists to refuse goes with it.
    expect(out.markdown).not.toContain('cleanest exit path');
    expect(out.markdown).toContain('Neither answers how easily this sells');
  });

  it('keeps the canonical copy wherever it sits, first or last', () => {
    /*
     * Position is what `dedupeChartDirectives` keys on and it is the wrong key
     * here: the composed section is APPENDED after the model's prose, so
     * "keep the first" would keep the reproduction every time. Asserted both
     * ways round.
     */
    const lastIsCanonical = dropComposedSectionReproductions(POOLE);
    expect(lastIsCanonical.markdown).toContain('Neither answers how easily this sells');

    const firstIsCanonical = [
      '## Resale Liquidity & Exit Outlook',
      '',
      'Neither answers how easily this sells.',
      '',
      '## Exit Outlook',
      '',
      'The cleanest exit path is to sell into the owner-occupier market.',
      '',
    ].join('\n');
    const out = dropComposedSectionReproductions(firstIsCanonical);
    expect(out.dropped).toHaveLength(1);
    expect(out.markdown).toContain('Neither answers how easily this sells');
    expect(out.markdown).not.toContain('cleanest exit path');
  });

  it('leaves everything else in the document untouched', () => {
    const out = dropComposedSectionReproductions(POOLE);
    expect(out.markdown).toContain('## Market Positioning');
    expect(out.markdown).toContain('## Property Fit Within the Suburb');
    expect(out.markdown).toContain('Positioning of the asset within local housing stock.');
  });

  it('reaches a stored document through the one read-path scrub', () => {
    const out = presentStoredMarkdown(POOLE);
    expect(out).not.toContain('## Exit Outlook');
    expect(out).not.toContain('## Monitoring Plan');
    expect(out).toContain('## Resale Liquidity & Exit Outlook');
  });
});

describe('what it refuses', () => {
  const unchanged = (label: string, md: string) => {
    it(label, () => {
      const out = dropComposedSectionReproductions(md);
      expect(out.dropped, label).toHaveLength(0);
      expect(out.markdown).toBe(md);
    });
  };

  unchanged('a document that carries each section once', POOLE
    .split('## Exit Outlook')[0] + '## Resale Liquidity & Exit Outlook\n\nOnce.\n');

  unchanged('two copies where NEITHER carries the canonical label', [
    '## Exit Outlook',
    '',
    'One.',
    '',
    '## Exit Strategy',
    '',
    'Two.',
    '',
  ].join('\n'));

  unchanged('two copies where BOTH carry the canonical label', [
    '## Resale Liquidity & Exit Outlook',
    '',
    'One.',
    '',
    '## Resale Liquidity & Exit Outlook',
    '',
    'Two.',
    '',
  ].join('\n'));

  unchanged('a projection sub-heading written beside its canonical section', [
    /*
     * The bound that matters most. `tenYear` is `computed` too, and its alias
     * list carries sub-heading names a Financial report legitimately writes as
     * sections of their own — so a rule keyed on "every computed section"
     * would delete real content. It is keyed on the five
     * `STRATEGY_SECTION_IDS` that `composeStrategySections` builds whole.
     */
    '## 10-Year Cashflow, Equity & Growth Projection',
    '',
    'The canonical projection.',
    '',
    '## Property Value Projections',
    '',
    'A real section of its own, not a reproduction.',
    '',
  ].join('\n'));

  unchanged('a section that is MEASURED rather than composed', [
    '## Market Positioning',
    '',
    'One.',
    '',
    '## Market Analysis',
    '',
    'Two.',
    '',
  ].join('\n'));

  unchanged('a section the platform composes but the document names once', [
    '## Suitability Profile',
    '',
    'Only copy — it belongs to the Financial report, but that is not this',
    'rule\'s business and dropping it would delete the only version.',
    '',
  ].join('\n'));

  unchanged('a document with no headings at all', 'Just prose, no sections.\n');
});

/**
 * The other two of the four, and the tier that owns them.
 *
 * `Suitability Profile` and `Holding Strategy` are `financial:required` in
 * `sectionRegistry.pure.ts` and declared for no other tier. A Compass carrying
 * them is `TIER_FRAMEWORK.md`'s defect — each report answering the other's
 * question — and it is not a duplicate, so the fold above correctly leaves
 * them alone. QA knows the tier, so QA is where this is said.
 */
describe('a section that belongs to a different report', () => {
  const findingsFor = (heading: string) =>
    runQAValidation(`# R\n\n## ${heading}\n\nProse.\n`, 'compass-40').findings
      .filter((f) => f.rule === 'section-belongs-to-another-report');

  it('names the two the Compass wrote, and the report they belong to', () => {
    for (const heading of ['Suitability Profile', 'Holding Strategy']) {
      const found = findingsFor(heading);
      expect(found.map((f) => f.rule), heading).toEqual(['section-belongs-to-another-report']);
      expect(found[0].severity).toBe('error');
      expect(found[0].message).toContain('financial report');
    }
  });

  it('says nothing about a section this tier composes or declares', () => {
    for (const heading of [
      'Resale Liquidity & Exit Outlook',
      'SWOT Analysis',
      'Monitoring & Review Plan',
      'Market Positioning',
      'Risk Dashboard',
      'Property Fit Within the Suburb',
    ]) {
      expect(findingsFor(heading), heading).toEqual([]);
    }
  });

  it('says nothing about a heading the registry does not know', () => {
    // A rule that cannot name what a section IS cannot say it is foreign.
    expect(findingsFor('Some Heading Nobody Declared')).toEqual([]);
  });

  it('runs only for a tier the map names', () => {
    const md = '# R\n\n## Suitability Profile\n\nProse.\n';
    expect(runQAValidation(md, 'financial-analysis').findings
      .filter((f) => f.rule === 'section-belongs-to-another-report')).toEqual([]);
    expect(runQAValidation(md, 'briefing').findings
      .filter((f) => f.rule === 'section-belongs-to-another-report')).toEqual([]);
  });
});
