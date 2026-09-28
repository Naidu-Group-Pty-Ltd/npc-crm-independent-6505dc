/**
 * The Opportunities block draws, and says nothing where there is nothing.
 *
 * Seed v19 changed this block's TYPE — a definition list whose term read
 * `Noted` became a callout titled `Opportunity` — and nothing asserted that it
 * draws at all. The geometry gate could not: its PDF is written once per
 * family reference and overwritten per tier, so the artefact on disk is
 * whichever tier rendered last, and that tier's page set excludes the page
 * this block sits on. So the change was verified in the SEED (34 schemas carry
 * `"title":"Opportunity"`, 0 carry `"term":"Noted"`) and in the geometry (710
 * renders clean), and not once as ink.
 *
 * `investment_score.opportunities` is empty on all but **19 of the 985 scored
 * reports**, which is why the block is conditional and why both states matter:
 * on 98% of records it must draw nothing at all.
 */
import { describe, expect, it } from 'vitest';
import { renderTemplateToHtml } from '@/lib/reportTemplate/htmlRenderer';
import { applyInvestmentProjection } from '../../../../supabase/functions/_shared/reportBindingProjection.pure';
import { INVESTMENT_COMPASS_TEMPLATES } from '../../../../scripts/template-library/investmentCompass/templates';

const OPPORTUNITY = 'Approved secondary-dwelling footprint not yet built out';

/** A stored row, projected as the tier that carries every binding. */
const row = (opportunities: string[] | undefined) => ({
  id: 'b0f1b6d0-0000-4000-8000-000000000000',
  property_address: '93 Bimbadeen Avenue, Banora Point NSW 2486, Australia',
  investment_score: {
    overallScore: 71,
    grade: 'B',
    risks: ['Interest rate sensitivity'],
    ...(opportunities ? { opportunities } : {}),
  },
});

function render(opportunities: string[] | undefined): string {
  const data = applyInvestmentProjection(
    { report: {}, brand: {} } as Record<string, unknown>,
    row(opportunities) as never,
    // The composite: since seed v20 the typed "Risk and recommendation" page
    // is drawn by the stored pre-tier report, and every tier produced today
    // carries its risks and recommendation in the flowing body instead.
    { tier: 'composite' },
  );
  return INVESTMENT_COMPASS_TEMPLATES
    .map((t) => renderTemplateToHtml((t as unknown as { schema: never }).schema, { data }).html)
    .join('\n');
}

describe('the Opportunities callout', () => {
  it('draws the opportunity the record holds', () => {
    expect(render([OPPORTUNITY])).toContain(OPPORTUNITY);
  });

  it('is titled for the thing, not for a placeholder', () => {
    const html = render([OPPORTUNITY]);
    expect(html).toContain('Opportunity');
    // `Noted` was a placeholder occupying the label slot of a definition list.
    // No master may carry it, in that slot or the risk register's rating.
    expect(html).not.toMatch(/>Noted</);
  });

  it('draws nothing at all when the record holds none — the 98% case', () => {
    const html = render(undefined);
    expect(html).not.toContain(OPPORTUNITY);
    expect(html).not.toMatch(/>Opportunity</);
  });

  it('draws nothing for an empty array, not an empty box', () => {
    const html = render([]);
    expect(html).not.toMatch(/>Opportunity</);
  });
});

describe('the risk register says the platform’s own word', () => {
  it('reads "Not assessed", never "Noted"', () => {
    const html = render([OPPORTUNITY]);
    expect(html).toContain('Not assessed');
    expect(html).not.toMatch(/>Noted</);
  });

  it('every master that draws a rating draws one from the exposure vocabulary', () => {
    // `Noted` was a fifth word in a four-word vocabulary. Nothing may
    // reintroduce one: a rating cell either carries a level the register
    // publishes, or the row is not drawn.
    const html = render([OPPORTUNITY]);
    for (const word of ['Noted', 'Minimal', 'Negligible', 'Favourable', 'Limited']) {
      expect(html, `${word} is not an exposure level`).not.toMatch(new RegExp(`>${word}<`));
    }
  });
});
