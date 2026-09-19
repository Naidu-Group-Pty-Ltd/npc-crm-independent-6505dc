/**
 * What the document must be, structurally, before anyone looks at a page.
 *
 * The defects this format is fixing are all of this kind — a section that never
 * renders because a key name is wrong, a document that draws nothing when one
 * optional input is absent, a contents page that could list what was not built.
 * None of them are visible in the PDF bytes and all of them are visible here.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { writeRenderArtifact } from '../../__tests__/renderArtifact';
import { buildComparison } from '../normalise.pure';
import { DOCUMENT_NAME, renderComparisonFromBrand } from '../render.pure';
import { comparisonSections, comparisonSpine, validateComparisonSpine } from '../sections.pure';
import {
  comparisonFileName,
  comparisonReference,
  comparisonStoragePath,
  parseRenderRequest,
} from '../route.pure';
import { contentsEntriesFor, REPORT_ARCHETYPES, spinePageBudget } from '@/lib/reportDesign/structure.pure';
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';

const NOW = '2026-08-02T00:00:00.000Z';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

// A white-label tenant, so "the cover carries theirs and not ours" is falsifiable.
const { snapshot } = buildReportBrandSnapshot({
  whitelabel: { companyName: 'Tenant Advisory', brandColour: '#B8873A', preset: 'signature' },
  contact: { company_name: 'Tenant Advisory Pty Ltd', abn: '11 222 333 444' },
  capturedAt: NOW,
});

const years = (afterTax: number) => Array.from({ length: 10 }, (_, i) => ({
  year: i + 1,
  calendarYear: 2027 + i,
  propertyValue: 600_000 + i * 30_000,
  loanBalance: 480_000,
  rentalIncome: 28_600,
  grossYield: 4.8,
  netYield: 3.2,
  expenses: 9_000,
  interestRate: 6,
  interest: 28_800,
  principal: 0,
  preTaxAnnual: afterTax,
  afterTaxAnnual: afterTax,
  depreciation: 6_000,
  taxRefund: 0,
  landTax: 0,
  capitalGrowth: 5,
  cpiGrowth: 2.5,
}));

const projection = (afterTax: number) => ({
  acquisition: {
    purchasePrice: 600_000,
    marketValue: 600_000,
    deposit: 120_000,
    loanAmount: 480_000,
    loanTermYears: 30,
    interestRate: 6,
    loanType: 'interest_only',
    weeklyRent: 550,
    costs: [{ label: 'Stamp duty', amount: 24_000 }],
  },
  years: years(afterTax),
  assumptions: [{ label: 'Capital growth', value: '5% per year' }],
  notes: [],
});

const build = (analysis: unknown = null) => buildComparison({
  properties: [
    { reportId: A, address: '12 Example Street, Suburbia VIC 3000', isPrimary: true, projection: projection(-4_000) },
    { reportId: B, address: '9 Sample Road, Elsewhere QLD 4000', isPrimary: false, projection: projection(-2_000) },
  ],
  primaryReportId: A,
  clientName: 'Sample Client',
  investorProfile: 'balanced',
  analysis,
  now: NOW,
});

const render = (analysis: unknown = null) =>
  renderComparisonFromBrand({ comparison: build(analysis), snapshot }).html;

const FULL_ANALYSIS = {
  executiveSummary: 'A written summary.',
  cashFlowTrajectory: { strongestGrowth: { propertyNumber: 1, reason: 'Rent compounds.' } },
  capitalGrowth: { wealthBuilder: { propertyNumber: 1, reason: 'Interest only.' } },
  yieldAnalysis: { bestNetYield: { propertyNumber: 2, value: '3.3%' } },
  riskAssessment: { highestRisk: { propertyNumber: 1, risks: ['Gearing'] } },
  investorRecommendations: { balanced: { propertyNumber: 2, reason: 'The compromise.' } },
  finalRankings: [
    { rank: 1, address: '9 Sample Road, Elsewhere QLD 4000', score: 8.4, verdict: 'Best.', strengths: ['Yield'] },
  ],
  overallRecommendation: { bestProperty: { propertyNumber: 2, reason: 'It is the one.' } },
};

/** The document, on disk, for the eye — the fullest fixture. See `renderArtifact.ts`. */
beforeAll(() => {
  writeRenderArtifact('cash-flow-comparison', render(FULL_ANALYSIS));
});

describe('the contents page cannot claim something that was not printed', () => {
  it('lists exactly the sections the document builds, in printed order', () => {
    const p = build(FULL_ANALYSIS);
    expect(contentsEntriesFor(comparisonSpine(p)).map((e) => e.title))
      .toEqual(comparisonSections(p).map((s) => s.title));
  });

  it('is shorter when there is no written analysis', () => {
    expect(comparisonSections(build()).length)
      .toBeLessThan(comparisonSections(build(FULL_ANALYSIS)).length);
  });
});

describe('the tables are the document and the analysis is a suffix', () => {
  /**
   * The whole point of the migration. `exportAiAnalysisPDF` returns without
   * drawing anything when `aiAnalysis` is null, so today an adviser who has not
   * pressed "Generate AI Analysis" cannot hand over the comparison at all.
   */
  it('renders a complete document with no analysis at all', () => {
    const html = render();
    expect(html).toContain('Which property comes out ahead');
    expect(html).toContain('10 years of cash flow');
    expect(html).toContain('The measures side by side');
    expect(html).toContain('On what basis');
    // And it says so, rather than leaving the absence to be noticed.
    expect(html).toContain('No written analysis was generated');
  });

  it('adds the four model sections only when the model wrote something', () => {
    const without = render();
    for (const title of [
      'What the analysis found',
      'Each property in turn',
      'Who each property suits',
      'Risk, and what to avoid',
    ]) {
      expect(without).not.toContain(title);
      expect(render(FULL_ANALYSIS)).toContain(title);
    }
  });

  /**
   * Independently conditional, not gated as a block. The producer asks for eight
   * sections under a 4,000-token ceiling and a response that closed its braces
   * early still parses, so a partial analysis is a normal arrival.
   */
  it('prints the sections that arrived when the rest did not', () => {
    const html = render({ investorRecommendations: { balanced: { reason: 'Only this.' } } });
    expect(html).toContain('Who each property suits');
    expect(html).not.toContain('Each property in turn');
    expect(html).toContain('The written analysis is partial');
  });
});

describe('the model half is escaped, and never attributed', () => {
  it('escapes a script tag in the summary', () => {
    const html = render({ executiveSummary: '<script>alert(1)</script> and more.' });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes model prose inside a callout body', () => {
    const html = render({
      riskAssessment: { highestRisk: { risks: ['<img src=x onerror=1>'] } },
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('says a ranking was not matched rather than pointing it at a column', () => {
    const html = render({
      finalRankings: [{ rank: 1, address: 'Never compared', verdict: 'Unknown.' }],
    });
    expect(html).toContain('Not matched to a property');
    expect(html).toContain('Never compared');
  });
});

describe('the tenant is on it and we are not', () => {
  it('carries the tenant on the cover', () => {
    expect(render()).toContain('Tenant Advisory');
  });

  it('names no house brand anywhere', () => {
    const html = render(FULL_ANALYSIS);
    for (const ours of ['NPC Services', 'npcservices', 'National Property']) {
      expect(html).not.toContain(ours);
    }
  });

  it('names the document by its archetype', () => {
    expect(DOCUMENT_NAME).toBe(REPORT_ARCHETYPES['cash-flow-comparison'].documentName);
  });
});

describe('the spine holds', () => {
  it('is valid for both shapes', () => {
    expect(validateComparisonSpine(build())).toEqual([]);
    expect(validateComparisonSpine(build(FULL_ANALYSIS))).toEqual([]);
  });

  /**
   * The band was pinned from four real WeasyPrint renders — 17, 20, 25 and 27
   * pages — after the first estimate had every wide section at one page when it
   * costs three.
   */
  it('budgets inside the archetype band', () => {
    const [min, max] = REPORT_ARCHETYPES['cash-flow-comparison'].pageBudget;
    for (const p of [build(), build(FULL_ANALYSIS)]) {
      const budget = spinePageBudget(comparisonSpine(p));
      expect(budget).toBeGreaterThanOrEqual(min);
      expect(budget).toBeLessThanOrEqual(max);
    }
  });

  it('refuses a one-property comparison, which would render as a finished document', () => {
    const p = build();
    const single = { ...p, properties: [p.properties[0]] };
    expect(validateComparisonSpine(single)).toContainEqual(expect.stringContaining('at least 2'));
  });
});

describe('the request and where the file lands', () => {
  const body = {
    primaryReportId: A,
    properties: [
      { reportId: A, projection: projection(-4_000) },
      { reportId: B, projection: projection(-2_000) },
    ],
  };

  it('accepts a well-formed request', () => {
    expect(parseRenderRequest(body).ok).toBe(true);
  });

  it('refuses a primary that is not one of the properties', () => {
    const parsed = parseRenderRequest({
      ...body,
      primaryReportId: '33333333-3333-4333-8333-333333333333',
    });
    expect(parsed.ok).toBe(false);
  });

  it('refuses one property, and six', () => {
    expect(parseRenderRequest({ ...body, properties: body.properties.slice(0, 1) }).ok).toBe(false);
    expect(parseRenderRequest({
      ...body,
      properties: Array.from({ length: 6 }, () => body.properties[0]),
    }).ok).toBe(false);
  });

  it('names the file after the count, the date and the cover reference', () => {
    const reference = comparisonReference(A);
    expect(comparisonFileName(2, NOW, reference))
      .toBe('Cash_Flow_Comparison_2_Properties_2026-08-02_11111111.pdf');
    expect(reference).toBe('11111111');
  });

  /** Keyed by the primary report: the properties may belong to different clients. */
  it('files it under the primary report and a random segment', () => {
    const path = comparisonStoragePath(A, 'x.pdf', NOW, 'uuid-here');
    expect(path).toBe(`cash-flow-comparison/${A}/2026-08-02/uuid-here-x.pdf`);
  });
});
