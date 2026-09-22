/**
 * Where a composed block lands, and what a report may not say about price.
 *
 * Both defects below were read off the Investment Compass delivered for
 * 9 Hollow Street, Golden Square on 21 Sep 2026 — the PDF, 39 pages, not the
 * source that made it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  declaredOrderFor,
  headingSequence,
  placeBlocksByDeclaredOrder,
} from '../investment/documentPlacement.pure';

/** The H2 sequence of that document, verbatim, before the composed blocks. */
const AUTHORED = [
  'Executive Verdict',
  'Property & Locality Snapshot',
  'Why This Location Matters',
  'Demand Drivers',
  'Amenity & Access',
  'Transport & Connectivity',
  'Zoning, Planning and Development Considerations',
  'Environment, Climate & Safety',
  'Market Positioning',
  'Property Fit Within the Suburb',
  'Risk Dashboard',
  'Due Diligence Checklist',
  'Final Recommendation',
  'Appendix, Source Notes & Disclaimer',
];

const doc = () =>
  '# Investment Report: 9 Hollow Street\n\n'
  + AUTHORED.map((h) => `## ${h}\n\nBody of ${h}.`).join('\n\n');

/** What the generator composes after the post-processor. */
const BLOCKS = [
  { heading: 'Resale Liquidity & Exit Outlook', markdown: '## Resale Liquidity & Exit Outlook\n\nComposed.' },
  { heading: 'SWOT Analysis', markdown: '## SWOT Analysis\n\nComposed.' },
  { heading: 'Monitoring & Review Plan', markdown: '## Monitoring & Review Plan\n\nComposed.' },
  {
    heading: 'Planning controls and development registers',
    order: 89,
    markdown: '## Planning controls and development registers\n\nTables.',
  },
];

describe('the document closes on its disclaimer', () => {
  /*
   * The delivered contents page printed the defect itself:
   *
   *   16. Final Recommendation                        p.29
   *   17. Appendix, Source Notes & Disclaimer         p.29
   *   18. Planning controls and development registers p.30
   *   19. Resale Liquidity & Exit Outlook             p.33
   *   20. SWOT Analysis                               p.33
   *   21. Monitoring & Review Plan                    p.36
   *
   * Eight pages of a thirty-nine page document after the disclaimer.
   */
  it('puts every composed block at the order the registry declares', () => {
    const placed = headingSequence(placeBlocksByDeclaredOrder(doc(), BLOCKS, 'compass'));
    expect(placed).toEqual([
      'Executive Verdict',
      'Property & Locality Snapshot',
      'Why This Location Matters',
      'Demand Drivers',
      'Amenity & Access',
      'Transport & Connectivity',
      'Zoning, Planning and Development Considerations',
      'Environment, Climate & Safety',
      'Market Positioning',
      'Resale Liquidity & Exit Outlook',
      'Property Fit Within the Suburb',
      'SWOT Analysis',
      'Risk Dashboard',
      'Due Diligence Checklist',
      'Monitoring & Review Plan',
      'Final Recommendation',
      'Planning controls and development registers',
      'Appendix, Source Notes & Disclaimer',
    ]);
  });

  it('ends on the disclaimer, which is the whole point', () => {
    const placed = headingSequence(placeBlocksByDeclaredOrder(doc(), BLOCKS, 'compass'));
    expect(placed[placed.length - 1]).toBe('Appendix, Source Notes & Disclaimer');
  });

  it('reads those orders from the registry rather than a list of its own', () => {
    // Each one below what it was until W2.2 (22 Sep 2026): `supplyPipeline`
    // took order 13, directly after Market Positioning, and everything from
    // there down shifted by one. What this pins is unchanged — that the orders
    // are READ rather than listed — and the relation under it is what the
    // document depends on, so it is asserted rather than left to the literals.
    expect(declaredOrderFor('Competitive Landscape and Supply Pipeline', 'compass')).toBe(13);
    expect(declaredOrderFor('Resale Liquidity & Exit Outlook', 'compass')).toBe(14);
    expect(declaredOrderFor('SWOT Analysis', 'compass')).toBe(16);
    expect(declaredOrderFor('Monitoring & Review Plan', 'compass')).toBe(19);
    expect(declaredOrderFor('Final Recommendation', 'compass')).toBe(20);
    expect(declaredOrderFor('Appendix, Source Notes & Disclaimer', 'compass')).toBe(90);
  });
});

describe('what it must not do', () => {
  it('moves nothing that was already there', () => {
    const placed = headingSequence(placeBlocksByDeclaredOrder(doc(), BLOCKS, 'compass'));
    // Every authored heading keeps its relative order; only insertions happen.
    expect(placed.filter((h) => AUTHORED.includes(h))).toEqual(AUTHORED);
  });

  it('loses nothing — every section and every block survives', () => {
    const placed = headingSequence(placeBlocksByDeclaredOrder(doc(), BLOCKS, 'compass'));
    for (const h of AUTHORED) expect(placed).toContain(h);
    for (const b of BLOCKS) expect(placed).toContain(b.heading);
  });

  it('is byte-identical when there is nothing to place', () => {
    const d = doc();
    expect(placeBlocksByDeclaredOrder(d, [], 'compass')).toBe(d);
  });

  it('does not insert a block the document already carries', () => {
    const once = placeBlocksByDeclaredOrder(doc(), BLOCKS, 'compass');
    expect(placeBlocksByDeclaredOrder(once, BLOCKS, 'compass')).toBe(once);
  });

  /*
   * The failure mode is today's behaviour, never a missing section: a block
   * the registry cannot place, in a document whose headings it does not
   * recognise, still lands.
   */
  it('appends rather than dropping when there is no later section', () => {
    const thin = '# Title\n\n## Something The Registry Never Heard Of\n\nBody.';
    const placed = placeBlocksByDeclaredOrder(thin, BLOCKS, 'compass');
    for (const b of BLOCKS) expect(placed).toContain(b.heading);
  });
});

describe('a report may not value the subject against a median', () => {
  /*
   * Page 4 of the delivered document printed, under "Opportunities Noted":
   *
   *   Priced below suburb median - potential for value appreciation
   *
   * `MARKET_FIGURES_IN_THE_REPORT.md` rule 6 forbids exactly that by name.
   * The scan is of CODE, not prose: a comment recording why the line went is
   * evidence, and deleting the explanation with the defect is how it returns.
   */
  const SOURCES = [
    'supabase/functions/_shared/reports/market/scoringV2Production.pure.ts',
    'supabase/functions/investment-scoring-service/index.ts',
  ];

  const statements = (src: string) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  it.each(SOURCES)('%s pushes no valuation of the subject', (file) => {
    const code = statements(readFileSync(file, 'utf8'));
    expect(code).not.toMatch(/below\s+(the\s+)?suburb\s+median/i);
    expect(code).not.toMatch(/under[-\s]?priced/i);
    expect(code).not.toMatch(/above\s+market/i);
  });

  it('keeps the reason on the record', () => {
    for (const file of SOURCES) {
      expect(readFileSync(file, 'utf8')).toContain('NO VALUATION OF THE SUBJECT');
    }
  });
});
