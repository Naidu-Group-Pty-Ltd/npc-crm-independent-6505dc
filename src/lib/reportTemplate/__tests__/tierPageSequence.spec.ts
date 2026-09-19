import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  COMPASS_DEPTH_PAGES,
  DERIVED_TIERS,
  derivedTierOf,
  pageVerdictForTier,
  pagesForDocument,
  pagesForTier,
} from '../../../../supabase/functions/_shared/reports/investment/tierPageSequence.pure';
import { section } from '../../../../supabase/functions/_shared/reports/investment/sectionRegistry.pure';

/**
 * A derived tier keeps a typed page only where the registry places that
 * page's section on the document surface. Measured through the real journey
 * (14 Sep 2026): the Snapshot — a four-to-six page tier — printed seventeen
 * pages on Midnight, six of them Compass depth drawn from the record the
 * child copies from its parent.
 */

/** The page sequence of the production Midnight structure, verbatim. */
const MIDNIGHT = [
  'Cover', 'Contents', 'Executive dashboard', 'Plate 01', 'The assessment', 'Plate 02',
  'Financial position', 'Ten-year projection', 'Risk and recommendation',
  'The report', 'The report (2)', 'The report (3)', 'Not the whole report',
  'Sources and methodology', 'Plate 03', 'Important information',
].map((name) => ({ name }));
/** Dictionary carries a typed property page as well. */
const DICTIONARY = [
  'Cover', 'Contents', 'Executive dashboard', 'The property', 'The assessment',
  'Financial position', 'Ten-year projection', 'Risk and recommendation',
  'The report', 'The report (2)', 'Not the whole report', 'Sources and methodology', 'Important information',
].map((name) => ({ name }));
const names = (pages: Array<{ name: string }>) => pages.map((p) => p.name);

describe('which typed pages a derived tier draws', () => {
  it('the Compass, another format and no tier at all keep every page, in order', () => {
    for (const tier of ['compass', null, undefined, '', 'COMPASS', 'borrowing_capacity', 42]) {
      expect(names(pagesForTier(MIDNIGHT, tier)), String(tier)).toEqual(names(MIDNIGHT));
      expect(names(pagesForTier(DICTIONARY, tier)), String(tier)).toEqual(names(DICTIONARY));
    }
  });

  it('the Snapshot keeps the cover, the dashboard, the plates, the prose and the closing — nothing else', () => {
    expect(names(pagesForTier(MIDNIGHT, 'snapshot'))).toEqual([
      'Cover', 'Executive dashboard', 'Plate 01', 'Plate 02',
      'The report', 'The report (2)', 'The report (3)', 'Not the whole report', 'Plate 03', 'Important information',
    ]);
    expect(names(pagesForTier(DICTIONARY, 'snapshot'))).toEqual([
      'Cover', 'Executive dashboard', 'The report', 'The report (2)', 'Not the whole report', 'Important information',
    ]);
  });

  it('the Briefing keeps its contents page and the typed property page the registry gives it', () => {
    expect(names(pagesForTier(DICTIONARY, 'briefing'))).toEqual([
      'Cover', 'Contents', 'Executive dashboard', 'The property',
      'The report', 'The report (2)', 'Not the whole report', 'Important information',
    ]);
  });

  it('the Financial and Due Diligence tiers keep the contents page and lose the property page', () => {
    for (const tier of ['financial', 'strategic'] as const) {
      expect(names(pagesForTier(DICTIONARY, tier)), tier).toEqual([
        'Cover', 'Contents', 'Executive dashboard',
        'The report', 'The report (2)', 'Not the whole report', 'Important information',
      ]);
    }
  });

  it('the property page follows the registry, not a list kept here', () => {
    expect(section('propertyIdentity').tiers.briefing?.surface).toBe('document');
    expect(pageVerdictForTier('The property', 'briefing')).toBe('kept');
    for (const tier of ['snapshot', 'financial', 'strategic'] as const) {
      expect(section('propertyIdentity').tiers[tier]?.surface ?? 'markdown').not.toBe('document');
      expect(pageVerdictForTier('The property', tier)).toBe('property_in_prose');
    }
  });

  it('every Compass-depth page is a section every derived tier places in its prose', () => {
    // The pages draw the score breakdown, the financial position, the
    // ten-year projection, the risks and recommendation, and the provenance.
    // None of those is a `document`-surface section on any derived tier.
    const documentSections = (tier: (typeof DERIVED_TIERS)[number]) =>
      ['scorecard', 'purchaseHolding', 'rentalYield', 'loan', 'tenYear', 'riskDashboard', 'risks', 'recommendation', 'provenance']
        .filter((id) => section(id as never).tiers[tier]?.surface === 'document');
    for (const tier of DERIVED_TIERS) {
      expect(documentSections(tier), tier).toEqual([]);
      for (const page of COMPASS_DEPTH_PAGES) expect(pageVerdictForTier(page, tier), `${tier} ${page}`).toBe('compass_depth');
    }
  });

  it('reads the tier however the record spells it', () => {
    expect(derivedTierOf(' Briefing ')).toBe('briefing');
    expect(derivedTierOf('compass')).toBeNull();
    expect(derivedTierOf(null)).toBeNull();
  });

  it('a record that issued no grade draws no page about how the grade was reached', () => {
    // The long reference report (RS-5a): four of five dimensions unscored, no
    // grade issued — the assessment page was a heading over one sentence.
    const ungraded = { tier: 'compass', recommendation: {} };
    expect(names(pagesForDocument(MIDNIGHT, ungraded))).toEqual(names(MIDNIGHT).filter((n) => n !== 'The assessment'));
    const graded = { tier: 'compass', recommendation: { grade: 'B' } };
    expect(names(pagesForDocument(MIDNIGHT, graded))).toEqual(names(MIDNIGHT));
    // Another format's data — no Investment tier — keeps every page whatever it says.
    expect(names(pagesForDocument(MIDNIGHT, { recommendation: {} }))).toEqual(names(MIDNIGHT));
    expect(names(pagesForDocument(MIDNIGHT, undefined))).toEqual(names(MIDNIGHT));
    // On a derived tier the page is already gone; the grade rule adds nothing.
    expect(names(pagesForDocument(DICTIONARY, { tier: 'snapshot', recommendation: { grade: 'B' } })))
      .toEqual(names(pagesForTier(DICTIONARY, 'snapshot')));
  });

  it('both renderers apply the same rule', () => {
    const root = resolve(__dirname, '../../../..');
    for (const rel of ['src/lib/reportTemplate/htmlRenderer.ts', 'src/lib/reportTemplate/pdfRenderer.ts']) {
      expect(readFileSync(resolve(root, rel), 'utf8'), rel).toContain('pagesForDocument(');
    }
  });
});
