/**
 * What the document must be, structurally, before anyone looks at a page.
 *
 * The legacy's defects are all of this kind — a contents page that lists what was
 * not drawn, a fallback that prints raw JSON, a section that never renders
 * because an interface omits its field — and none of them are visible in the PDF
 * bytes. All of them are visible here.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { writeRenderArtifact } from '../../__tests__/renderArtifact';
import { buildPropertyComparison } from '../normalise.pure';
import { DOCUMENT_NAME, renderComparisonFromBrand } from '../render.pure';
import { comparisonSections, comparisonSpine, validateComparisonSpine } from '../sections.pure';
import {
  comparisonFileName,
  comparisonStoragePath,
  parseRenderRequest,
} from '../route.pure';
import { contentsEntriesFor, REPORT_ARCHETYPES, spinePageBudget } from '@/lib/reportDesign/structure.pure';
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';

const NOW = '2026-08-02T00:00:00.000Z';
const UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// A white-label tenant, so "the cover carries theirs and not ours" is falsifiable.
const { snapshot } = buildReportBrandSnapshot({
  whitelabel: { companyName: 'Tenant Advisory', brandColour: '#B8873A', preset: 'signature' },
  contact: { company_name: 'Tenant Advisory Pty Ltd', abn: '11 222 333 444' },
  capturedAt: NOW,
});

const ranking = (n: number, score: number) => ({
  rank: n,
  propertyNumber: n,
  address: `${n} Example Street, Sampleton, QLD 4000`,
  finalScore: score,
  primaryStrengths: [`Strength for ${n}`],
  primaryConcerns: [`Concern for ${n}`],
  bestSuitedFor: 'Growth investors',
});

const row = (over: Record<string, unknown> = {}) => ({
  id: UUID,
  created_at: '2026-05-01T00:00:00.000Z',
  property_count: 3,
  property_addresses: [1, 2, 3].map((n) => `${n} Example Street, Sampleton, QLD 4000`),
  property_states: ['QLD'],
  report_title: 'COMPARISON ANALYSIS - 3 PROPERTIES, QLD',
  report_ids: ['r1', 'r2', 'r3'],
  executive_summary: 'Three properties compared.',
  rankings: [ranking(1, 82), ranking(2, 71), ranking(3, 60)],
  financial_comparison: {
    bestYield: { propertyNumber: 1, value: '5.1%', reason: 'Higher rent for the price.' },
    bestValue: { propertyNumber: 0, reason: 'No property stood out on value.' },
  },
  location_comparison: { bestSchools: { propertyNumber: 2, reason: 'Two schools within a kilometre.' } },
  risk_comparison: {
    lowestRisk: { propertyNumber: 1, reason: 'Lowest leverage.' },
    highestRisk: { propertyNumber: 3, reason: 'Highest leverage.' },
    riskLevels: [{ propertyNumber: 1, riskLevel: 'Moderate', specificRisks: ['Leverage'] }],
  },
  investor_matches: [{ propertyNumber: 1, investorTypes: ['Growth'], reasoning: 'Capital focus.' }],
  recommendations: { bestOverall: { propertyNumber: 1, reason: 'Best on balance.' } },
  red_flags: [{ propertyNumber: 3, severity: 'High', concerns: ['Body corporate fees'] }],
  analysis_summary: '{"timeHorizon":"5-7 years","riskTolerance":"moderate","customWeights":null}',
  is_archived: false,
  ...over,
});

const build = (over: Record<string, unknown> = {}) =>
  buildPropertyComparison({ row: row(over), clientName: 'Sample Client', now: NOW });

const render = (over: Record<string, unknown> = {}) =>
  renderComparisonFromBrand({ comparison: build(over), snapshot }).html;

/** The document, on disk, for the eye. See `renderArtifact.ts`. */
beforeAll(() => {
  writeRenderArtifact('property-comparison', render());
});

describe('the contents page cannot claim something that was not printed', () => {
  it('lists exactly the sections the document builds, in printed order', () => {
    const p = build();
    expect(contentsEntriesFor(comparisonSpine(p)).map((e) => e.title))
      .toEqual(comparisonSections(p).map((s) => s.title));
  });

  it('numbers them from one, with no gaps', () => {
    const entries = contentsEntriesFor(comparisonSpine(build()));
    expect(entries.map((e) => e.number))
      .toEqual(entries.map((_, i) => String(i + 1).padStart(2, '0')));
  });

  it('prints no page numbers, so none of them can be wrong', () => {
    const html = render();
    const contents = html.slice(html.indexOf('page-contents'), html.indexOf('page-chapter-opener'));
    expect(contents).not.toMatch(/\bp\.?\s?\d{1,2}\b/);
  });
});

describe('the scorecard', () => {
  /**
   * `highestRisk` names the property that came off worst. A tick against it in a
   * matrix whose ticks mean "won this category" asserts the opposite.
   */
  it('does not tick a property for being the riskiest', () => {
    const html = render();
    // From the *chapter*, not the contents entry of the same name — otherwise
    // the slice is the table-of-contents row and asserts nothing.
    const matrix = html.slice(
      html.lastIndexOf('Who wins what'),
      html.lastIndexOf('Each property in turn'),
    );
    expect(matrix).toContain('Lowest risk');
    expect(matrix).not.toContain('Highest risk');
  });

  it('still reports the highest risk, in the section where the word belongs', () => {
    const html = render();
    expect(html).toContain('Highest risk');
    expect(html).toContain('Highest leverage.');
  });

  /** A pointer of 0 is "no clear winner", not property zero. */
  it('names no winner rather than indexing past the start', () => {
    const html = render();
    expect(html).toContain('No clear winner');
    expect(html).not.toContain('undefined');
  });
});

describe('scores always carry their denominator', () => {
  it('prints out of 100 for a 0–100 comparison', () => {
    expect(render()).toContain('82 / 100');
  });

  it('prints out of 10 for a 0–10 comparison', () => {
    const html = render({
      rankings: [ranking(1, 8.2), ranking(2, 7.1), ranking(3, 6)],
    });
    expect(html).toContain('8.2 / 10');
    expect(html).not.toContain('8.2 / 100');
  });
});

describe('a truncated record says so', () => {
  const truncated = () => {
    // Cut *after* `rankings` closes and partway into the next key — which is
    // where the real truncations land: rankings survives on all 27 damaged rows,
    // and it is the tail of the schema that is lost.
    const blob = JSON.stringify({
      executiveSummary: 'Recovered summary.',
      rankings: [ranking(1, 70), ranking(2, 50)],
      financialComparison: { bestYield: { propertyNumber: 1, reason: 'Higher rent.' } },
    });
    const cut = `${blob.slice(0, blob.indexOf('"financialComparison"') + 30)}`;
    return {
      property_count: 2,
      property_addresses: [1, 2].map((n) => `${n} Example Street, Sampleton, QLD 4000`),
      rankings: null,
      financial_comparison: null,
      location_comparison: null,
      risk_comparison: null,
      investor_matches: null,
      recommendations: null,
      red_flags: null,
      executive_summary: cut,
    };
  };

  it('opens with what happened, distinguishing not-written from not-found', () => {
    const html = render(truncated());
    expect(html).toContain('saved before the analysis finished');
    expect(html).toContain('not in the record');
    expect(html).toContain('Re-running the comparison');
  });

  it('builds a named placeholder for each section the record lost', () => {
    const p = buildPropertyComparison({ row: row(truncated()), clientName: '', now: NOW });
    const placeholders = comparisonSections(p).filter((s) => s.placeholderFor);
    expect(placeholders.length).toBeGreaterThan(0);
    expect(placeholders.map((s) => s.title)).toContain('What we recommend');
    // Listed on the contents page, so it cannot read as a complete document.
    expect(contentsEntriesFor(comparisonSpine(p)).map((e) => e.title))
      .toContain('What we recommend');
  });

  it('says nothing about truncation on a complete record', () => {
    expect(render()).not.toContain('saved before the analysis finished');
    expect(comparisonSections(build()).some((s) => s.placeholderFor)).toBe(false);
  });
});

describe('the cover is the tenant’s', () => {
  it('carries the tenant’s name and none of our raster letterhead', () => {
    const html = render();
    expect(html).toContain('Tenant Advisory');
    expect(html).not.toContain('NPC_PDF_Template');
  });
});

describe('the document refuses to render when its structure is wrong', () => {
  it('throws rather than comparing one property', () => {
    const p = { ...build(), properties: [build().properties[0]] } as ReturnType<typeof build>;
    expect(() => renderComparisonFromBrand({ comparison: p, snapshot })).toThrow(/invalid structure/);
    expect(validateComparisonSpine(p)).toContain('a comparison needs at least two properties');
  });

  it('throws rather than producing a document that ranks nothing', () => {
    const p = { ...build(), ranked: [] } as ReturnType<typeof build>;
    expect(() => renderComparisonFromBrand({ comparison: p, snapshot })).toThrow(/invalid structure/);
  });
});

describe('the spine stays inside its archetype', () => {
  const [min, max] = REPORT_ARCHETYPES['property-comparison'].pageBudget;

  it.each([2, 3, 4, 5])('a %i-property comparison spines inside the band', (count) => {
    const p = build({
      property_count: count,
      property_addresses: Array.from({ length: count }, (_, i) => `${i + 1} Example Street, Sampleton, QLD 4000`),
      rankings: Array.from({ length: count }, (_, i) => ranking(i + 1, 90 - i * 5)),
    });
    const total = spinePageBudget(comparisonSpine(p));
    expect(total).toBeGreaterThanOrEqual(min);
    expect(total).toBeLessThanOrEqual(max);
    expect(validateComparisonSpine(p)).toEqual([]);
  });
});

describe('nothing reaches the page unescaped', () => {
  it('escapes a title that carries markup', () => {
    const html = render({ report_title: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes prose the model wrote', () => {
    const html = render({ executive_summary: 'Yield <b>rose</b> & held.' });
    expect(html).not.toContain('<b>rose</b>');
    expect(html).toContain('&amp;');
  });
});

describe('the render request', () => {
  it('accepts a uuid and nothing about the contents', () => {
    const parsed = parseRenderRequest({ comparisonId: UUID });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.request.edition).toBeNull();
  });

  it('refuses anything that is not a uuid', () => {
    for (const body of [null, {}, { comparisonId: '' }, { comparisonId: 'nope' }]) {
      expect(parseRenderRequest(body).ok).toBe(false);
    }
  });

  it('names the file after the row’s own reference, matching the cover', () => {
    expect(comparisonFileName(3, NOW, 'AAAAAAAA'))
      .toBe('Property_Comparison_3_Properties_2026-08-02_AAAAAAAA.pdf');
  });

  it('keys storage on the comparison, never on an inferred client', () => {
    const path = comparisonStoragePath(UUID, 'x.pdf', NOW, 'uid');
    expect(path.startsWith(`property-comparisons/${UUID}/`)).toBe(true);
    expect(path).toContain('/typeset/');
    expect(path).toContain('uid-');
  });
});

describe('the format writes no colour of its own', () => {
  it.each(['payload', 'salvage', 'normalise', 'sections', 'render', 'charts', 'route'])(
    '%s.pure.ts names no hex colour',
    async (name) => {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const source = readFileSync(
        resolve(__dirname, `../../../../../supabase/functions/_shared/reports/propertyComparison/${name}.pure.ts`),
        'utf8',
      ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(source, `${name}.pure.ts writes a colour instead of taking one from the palette`)
        .not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    },
  );

  it('takes its document name from the archetype', () => {
    expect(DOCUMENT_NAME).toBe(REPORT_ARCHETYPES['property-comparison'].documentName);
  });
});
