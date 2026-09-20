/**
 * A figure that names no basis.
 *
 * §3 of the 18 September 2026 instruction, in its own words: *"Numerical
 * graphics include occupier mixes, property-fit gauges, evidence mixes, risk
 * scores and investor-readiness ratings without an adequate explanation of
 * their basis. Every number requires a traceable dataset or approved
 * calculation."*
 *
 * The important half is that some of those numbers are SOUND. An occupier mix
 * drawn from the Census and one a model chose look identical on the page, and
 * `suppressUnrecordedVerdictVisuals` cannot tell them apart either - it judges
 * a rating scale, and a tenure share declares none. So this rule reports and
 * never removes, and the remedy is a caption rather than a deletion: deleting
 * a sound figure to silence a warning takes real data off the page.
 */
import { describe, expect, it } from 'vitest';
import { findFiguresWithoutABasis } from '../investment/evidenceClaims.pure';
import { runQAValidation } from '../compassQAValidator';

const doc = (body: string) => `# Report\n\n## Locality\n\n${body}\n`;

describe('a figure with no dataset, period or model basis near it', () => {
  it('catches the occupier mix', () => {
    const found = findFiguresWithoutABasis(doc(
      'The locality is predominantly owner-occupied.\n\n'
      + '{{donut: Owner-occupier 62, Renter 34, Other 4 | title=Occupier mix}}',
    ));
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('donut');
    expect(found[0].title).toBe('Occupier mix');
  });

  it('catches an evidence mix, a fit gauge and a risk wheel', () => {
    const md = doc([
      '{{donut: Register 4, Model 3, Portal 2 | title=Evidence mix}}',
      '',
      '{{gauge: 74/100 | Property fit}}',
      '',
      '{{wheel: 60,70,55 | labels=Flood,Bushfire,Coastal | max=100 | title=Risk}}',
    ].join('\n'));
    expect(findFiguresWithoutABasis(md).map((f) => f.kind).sort())
      .toEqual(['donut', 'gauge', 'wheel']);
  });

  it('catches a timeline, because a pipeline asserts dates', () => {
    const found = findFiguresWithoutABasis(doc(
      '{{timeline: Road upgrade | TAFE campus | New primary school}}',
    ));
    expect(found.map((f) => f.kind)).toEqual(['timeline']);
  });
});

describe('a stated basis satisfies it', () => {
  it('a named register in the sentence above', () => {
    const md = doc(
      'Tenure mix from the ABS Census, postal area 2794.\n\n'
      + '{{donut: Owner-occupier 62, Renter 34, Other 4 | title=Occupier mix}}',
    );
    expect(findFiguresWithoutABasis(md)).toEqual([]);
  });

  it('a period in the caption below', () => {
    const md = doc(
      '{{bars: Subject $565k, Suburb median $498k | title=Price against the market}}\n\n'
      + 'Median sale prices, June 2026 quarter.',
    );
    expect(findFiguresWithoutABasis(md)).toEqual([]);
  });

  it('an explicit model basis', () => {
    const md = doc(
      'Year-one cash position from the recorded calculation, before tax.\n\n'
      + '{{waterfall: Rent 23000, Costs -11000, Debt service -28860}}',
    );
    expect(findFiguresWithoutABasis(md)).toEqual([]);
  });

  it('a basis three lines above still counts', () => {
    const md = doc([
      'Tenure mix, ABS Census 2021.',
      '',
      'The pattern is typical of an established pocket.',
      '',
      '{{donut: Owner-occupier 62, Renter 34, Other 4}}',
    ].join('\n'));
    expect(findFiguresWithoutABasis(md)).toEqual([]);
  });
});

describe('what it must NOT flag', () => {
  it('a glance strip, a stat callout or an inline sparkline', () => {
    const md = doc([
      '{{glance: 3 bed | 1 bath | 765 m2}}',
      '',
      '{{stat: $555,000 | Asking price}}',
      '',
      'The median rose steadily ~~[480,495,510,555]~~ over the period.',
    ].join('\n'));
    expect(findFiguresWithoutABasis(md)).toEqual([]);
  });

  it('prose that merely mentions a chart', () => {
    expect(findFiguresWithoutABasis(doc('The donut below sets out the occupier mix.'))).toEqual([]);
  });

  it('a clean document', () => {
    expect(findFiguresWithoutABasis(doc('The property is a detached house.'))).toEqual([]);
  });
});

describe('the validator discloses it without failing the document', () => {
  const md = doc('{{donut: Owner-occupier 62, Renter 34, Other 4 | title=Occupier mix}}');

  it('raises a warning, at every tier', () => {
    for (const tier of ['compass-40', 'financial-analysis', 'strategic', 'briefing', 'snapshot'] as const) {
      const report = runQAValidation(md, tier);
      const f = report.findings.find((x) => x.rule === 'figure-without-a-stated-basis');
      expect(f?.severity, tier).toBe('warning');
    }
  });

  it('a warning must not fail the document, because the figure may be sound', () => {
    expect(runQAValidation(md, 'briefing').passed).toBe(true);
  });

  it('names the caption as the remedy, and the four things it must carry', () => {
    const f = runQAValidation(md, 'compass-40').findings
      .find((x) => x.rule === 'figure-without-a-stated-basis');
    expect(f?.message).toContain('caption');
    for (const part of ['units', 'period', 'geography', 'model basis']) {
      expect(f?.message, part).toContain(part);
    }
    expect(f?.message).toContain('Occupier mix');
  });
});

describe('the generator asks for it, so the rule is not judging what was never requested', () => {
  it('the prompt states the basis requirement and names the figures §3 identified', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('supabase/functions/generate-investment-report/index.ts', 'utf8');
    expect(src).toContain('EVERY FIGURE STATES ITS BASIS');
    for (const part of ['DATASET', 'PERIOD', 'GEOGRAPHY', 'UNITS', 'state the finding in words']) {
      expect(src, part).toContain(part);
    }
  });
});
