/**
 * Compass QA judges the document the tier is meant to produce.
 *
 * Two rules fired on every Compass and so could never report a true fault
 * (24 Sep 2026, five of five Compass QA runs since 23 Sep 13:30Z):
 *
 *  - `missing-protected-section compass.cover` — the cover is Protected (nothing
 *    may trim it) and `includeInCompass: false` (the template draws it; the
 *    generator writes no cover section), so requiring EVERY Protected id asked
 *    for a section no Compass run ever writes;
 *  - `financial-exclusion` on `/weekly rent/` and `/purchase price/` — the
 *    price and the rent are facts the tier keeps (TIER_FRAMEWORK.md Decision E,
 *    and the generator's own HARD EXCLUSIONS say so); what it excludes is the
 *    ANALYSIS of a purchase. 9 Hollow Street drew two errors for stating its own
 *    price and rent.
 *
 * Both validator copies are exercised, because they are the same rules in two
 * import dialects and a fix to one is a divergence.
 */
import { describe, expect, it } from 'vitest';
import {
  compassSections,
  PROTECTED_SECTION_IDS,
} from '../../../../supabase/functions/_shared/compassSectionRegistry';
import * as edge from '../../../../supabase/functions/_shared/compassQAValidator';
import * as web from '../compassQAValidator';

/** Every section the generator writes, each with a sentence and nothing else. */
function compassDocument(extra: Record<string, string> = {}): string {
  return compassSections()
    .map((s) => `## ${s.name}\n\n${extra[s.id] ?? `The ${s.name.toLowerCase()} for this property is recorded here.`}\n`)
    .join('\n');
}

const RISK_REGISTER = [
  '| Risk | Exposure | Evidence |',
  '| --- | --- | --- |',
  '| Flood | Low | Verified |',
].join('\n');

for (const [dialect, qa] of [['edge', edge], ['web', web]] as const) {
  describe(`Compass QA (${dialect} copy)`, () => {
    it('requires the Protected sections the generator writes, and not the cover', () => {
      const generated = new Set(compassSections().map((s) => s.id));
      expect(qa.REQUIRED_PROTECTED_SECTION_IDS.has('compass.cover')).toBe(false);
      for (const id of qa.REQUIRED_PROTECTED_SECTION_IDS) {
        expect(generated.has(id), `${id} is generated`).toBe(true);
        expect(PROTECTED_SECTION_IDS.has(id), `${id} is Protected`).toBe(true);
      }
      // Derived, never restated: every Protected section that IS generated is required.
      for (const id of PROTECTED_SECTION_IDS) {
        if (generated.has(id)) expect(qa.REQUIRED_PROTECTED_SECTION_IDS.has(id), id).toBe(true);
      }
    });

    it('reports no missing Protected section on a document that carries every generated one', () => {
      const report = qa.runQAValidation(
        compassDocument({ 'compass.riskDashboard': RISK_REGISTER }),
        'compass-40',
      );
      expect(report.findings.filter((f) => f.rule === 'missing-protected-section')).toEqual([]);
    });

    it('still reports a Protected section the document left out', () => {
      const withoutRisk = compassDocument()
        .split('\n## ')
        .filter((chunk) => !chunk.startsWith('Risk Dashboard'))
        .join('\n## ');
      const report = qa.runQAValidation(withoutRisk, 'compass-40');
      expect(report.findings.some((f) => f.rule === 'missing-protected-section' && f.sectionId === 'compass.riskDashboard')).toBe(true);
    });

    it('lets the Compass state its price and its rent', () => {
      const report = qa.runQAValidation(
        compassDocument({
          'compass.propertyLocalitySnapshot': 'The purchase price is $1,975,000 and the indicative weekly rent is $850.',
          'compass.riskDashboard': RISK_REGISTER,
        }),
        'compass-40',
      );
      expect(report.findings.filter((f) => f.rule === 'financial-exclusion')).toEqual([]);
    });

    it('still refuses the analysis of a purchase', () => {
      for (const analysis of ['The gross yield is 2.2%.', 'An LVR of 80% applies.', 'The monthly repayment is $9,000.']) {
        const report = qa.runQAValidation(
          compassDocument({ 'compass.marketPositioning': analysis, 'compass.riskDashboard': RISK_REGISTER }),
          'compass-40',
        );
        expect(report.findings.some((f) => f.rule === 'financial-exclusion'), analysis).toBe(true);
      }
    });
  });
}
