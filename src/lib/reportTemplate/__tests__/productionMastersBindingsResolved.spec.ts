import { describe, expect, it } from 'vitest';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';
import { renderTemplateToBlob } from '../pdfRenderer';

/**
 * A drawn document may never carry a binding token.
 *
 * The renderer's own contract is that an unresolved binding renders as the
 * empty string, never as a visible `{{…}}` — and all three selectable
 * Investment structures broke it in the same place: `definition-list` read
 * `String(item.definition)` instead of resolving it, so THIRTEEN tokens
 * (`{{org.name}}`, `{{property.address}}`, `{{assumptions.capitalGrowth |
 * percent}}`, `{{recommendation.grade}}`, …) were set as body copy on the
 * assumptions page and the colophon of every rendered report.
 *
 * The guard is on the BYTES rather than on the block, because that is the only
 * place the question is actually asked: a renderer that forgets to resolve a
 * prop typechecks, lints and draws a plausible page.
 */
const STRUCTURES = ['Chancery', 'Dictionary', 'Frontispiece'] as const;

const master = (name: string): any =>
  (INVESTMENT_COMPASS_TEMPLATES as any[]).find((t) => t.name === name);

/** A payload shaped like the adapter's, with nothing the masters bind left out. */
const DATA = {
  report: { type: 'investment_compass', title: 'Investment Compass', documentTitle: 'Investment Compass', generatedDate: '2026-09-13' },
  org: { name: 'Naidu Property Consulting Services' },
  property: { address: '48 Redfern Street, Cowra NSW 2794' },
  recommendation: { grade: 'N/A', score: null, gradedLine: 'No grade issued.', gradedDetailLine: 'Insufficient verified evidence.' },
  assumptions: { capitalGrowth: 0.1, interestRate: 6.5, vacancy: 0.02, occupancyWeeks: 50 },
  assessment: { 2: { details: 'Established regional location.' }, 4: { details: 'Verification outstanding.' } },
  narrative: { source: '## Location Overview\n\nEstablished pocket with strong access.\n', pages: 1 },
};

describe('a production master draws no binding token', () => {
  for (const name of STRUCTURES) {
    it(`${name} renders with zero '{{' in the document`, async () => {
      const blob = renderTemplateToBlob(master(name).schema, { data: DATA });
      const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1');
      const found = pdf.match(/\{\{[^}\n]{0,60}/g) ?? [];
      expect(found).toEqual([]);
    });
  }

  /**
   * The same assertion with NOTHING bound. An unresolved binding must vanish,
   * which is the half of the rule that a fully-populated payload cannot test.
   */
  it('draws no token even when the payload publishes nothing it binds', async () => {
    const blob = renderTemplateToBlob(master('Chancery').schema, { data: { report: { type: 'investment_compass' } } });
    const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1');
    expect(pdf.match(/\{\{[^}\n]{0,60}/g) ?? []).toEqual([]);
  });
});
