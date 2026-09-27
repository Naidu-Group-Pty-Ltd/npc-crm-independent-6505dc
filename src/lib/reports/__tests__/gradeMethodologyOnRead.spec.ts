/**
 * The grade appendix is drawn from the record on every read.
 *
 * The 37 Bolin Street Compass and the Financial Analysis forked from it
 * (27 Sep 2026) printed "How this grade was reached" and stopped after its
 * third bullet: Demand, Property risk, "How the grade follows" and the
 * coverage statement were gone, with nothing on the page saying so.
 */
import { describe, expect, it } from 'vitest';
import { restoreGradeMethodology } from '../../../../supabase/functions/_shared/reports/investment/gradeMethodologyOnRead.pure';
import { presentStoredMarkdown } from '../../../../supabase/functions/_shared/reports/investment/derivedHygiene.pure';

const SCORE = {
  totalScore: 60, grade: 'B', overallScore: 60,
  breakdown: {
    growthScore: { score: 63, weight: 47, excluded: false, details: 'Five-year capital growth: 7.5% per annum over five years' },
    locationScore: { score: 68, weight: 30, excluded: false, details: 'nearest transit station 1.7 km away. 10 schools within 3 km' },
    yieldScore: { score: 47, weight: 18, excluded: false, details: 'Gross yield (on purchase price): 3.75% gross yield on a $1,110,000 purchase price.' },
    demandScore: { score: 37, weight: 5, excluded: false, details: 'Sales volume: 48 sales in postcode 2762, NSW, 33% below the 3-period average of 72.' },
    riskScore: { score: 0, weight: 0, excluded: true, details: 'could not be measured' },
  },
};

/** What the delivered documents carried: the section cut after its third bullet. */
const TRUNCATED = [
  '## Appendix, Source Notes & Disclaimer',
  '',
  '### Sources used',
  '',
  'The findings draw on the ABS.[^1]',
  '',
  '### How this grade was reached',
  '',
  'Five dimensions carry the method.',
  '',
  '**What each dimension rested on.**',
  '',
  '- **Capital growth.** Five-year capital growth: 7.5% per annum over five years',
  '',
  '- **Location.** nearest transit station 1.7 km away. 10 schools within 3 km',
  '- **Rental yield.** Gross yield (on purchase price): 3.75% gross yield on a $1,110,000 purchase price.',
  '',
  '[^1]: Australian Bureau of Statistics, accessed September 2026.',
  '',
  '---',
  '',
  '## Disclaimer',
  '',
  'General information only.',
].join('\n');

describe('a stored grade appendix that lost its tail', () => {
  const { markdown, restored } = restoreGradeMethodology(TRUNCATED, SCORE);

  it('is replaced by the complete section the record composes', () => {
    expect(restored).toBe(true);
    for (const part of ['**Demand.**', '**Property risk.**', '**How the grade follows.**', '**Coverage.**']) {
      expect(markdown).toContain(part);
    }
    expect(markdown.match(/### How this grade was reached/g)).toHaveLength(1);
  });

  it('keeps everything that is not the method: the section before, the note, the rule and the next chapter', () => {
    expect(markdown).toContain('### Sources used');
    expect(markdown).toContain('[^1]: Australian Bureau of Statistics, accessed September 2026.');
    expect(markdown).toContain('---');
    expect(markdown.indexOf('## Disclaimer')).toBeGreaterThan(markdown.indexOf('**Coverage.**'));
    expect(markdown).toContain('General information only.');
  });

  it('is idempotent', () => {
    expect(restoreGradeMethodology(markdown, SCORE).markdown).toBe(markdown);
  });

  it('keeps the heading level the document uses', () => {
    const h2 = TRUNCATED.replace('### How this grade was reached', '## How this grade was reached');
    const out = restoreGradeMethodology(h2, SCORE).markdown;
    expect(out).toMatch(/^## How this grade was reached$/m);
    expect(out).not.toMatch(/^### How this grade was reached$/m);
  });

  it('reaches the page through the read path, stated once', () => {
    const scorecard = [
      '## Financial Investment Scorecard', '',
      '**What each dimension rested on.**', '',
      '- **Yield.** Gross yield.', '- **Demand.** Sales volume.', '- **Growth.** Five-year.', '- **Location.** Nearest.', '',
    ].join('\n');
    const shown = presentStoredMarkdown(restoreGradeMethodology(`${scorecard}\n${TRUNCATED}`, SCORE).markdown);
    expect(shown.match(/What each dimension rested on\.\*\*/g)).toHaveLength(1);
    expect(shown).toContain('**Property risk.**');
    expect(shown).toContain('What each dimension rested on is set out under “How this grade was reached”.');
  });
});

describe('what it never does', () => {
  it('adds the section to a document that does not carry it', () => {
    const doc = '## Snapshot\n\nA short document.';
    expect(restoreGradeMethodology(doc, SCORE)).toEqual({ markdown: doc, restored: false });
  });

  it('invents a section where the record composes none', () => {
    expect(restoreGradeMethodology(TRUNCATED, null)).toEqual({ markdown: TRUNCATED, restored: false });
    expect(restoreGradeMethodology(TRUNCATED, { breakdown: {} })).toEqual({ markdown: TRUNCATED, restored: false });
  });
});
