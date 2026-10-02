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
  COMPARISON_ANALYSIS_QUALIFIER,
  COMPARISON_LEGACY_QUALIFIER,
  comparisonFileName,
  comparisonReference,
  comparisonStoragePath,
  parseRenderRequest,
} from '../route.pure';
import { contentsEntriesFor, REPORT_ARCHETYPES, spinePageBudget } from '@/lib/reportDesign/structure.pure';
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';
import { SECTION_SUBHEAD_CLASS } from '@/lib/reportDesign/primitives.pure';

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

/**
 * Audit 8 (1 Oct 2026): what the page says, measured against all 51 designs.
 * Each assertion is a defect the audit found on a rendered page.
 */
describe('what the page says', () => {
  const cell = (html: string, text: string) => new RegExp(`<td[^>]*>${text}</td>`).test(html);

  it('sets each subhead at a subhead\'s size, under a memo section\'s title', () => {
    const html = render(FULL_ANALYSIS);
    expect(html).toContain(`<h2 class="${SECTION_SUBHEAD_CLASS}">What the analysis said</h2>`);
    expect(html).not.toMatch(/<h2>[^<]+<\/h2>/);
  });

  /** Which property the adviser opened is a fact about the session, not the property. */
  it('does not mark the property the analysis was opened from', () => {
    const html = render(FULL_ANALYSIS);
    expect(html).not.toContain('(opened)');
    expect(html).not.toMatch(/12 Example Street ·/);
  });

  it('sets the property tables and the year matrices as the tables of figures they are', () => {
    const html = render();
    expect(html).toContain('class="data cfc-properties');
    expect(html).toContain('<table class="data cfc-years">');
  });

  /** "No clear leader" was two different findings. */
  it('says a tie is a tie, and a payback nobody reaches is none within the term', () => {
    const html = render();
    expect(cell(html, 'Tied')).toBe(true);
    expect(cell(html, 'None within the term')).toBe(true);
    expect(html).not.toContain('No clear leader');
  });

  /** "Ahead by 76.7%" read as 76.7% better than second place. */
  it('states a lead between two percentages in points', () => {
    const html = render();
    expect(html).toMatch(/<td[^>]*>\d+(\.\d)? points?<\/td>/);
  });

  /**
   * The label is ours and the sentence the model's: "Reaches positive cash flow
   * first" sat over "though it stays negative across the term".
   */
  it('names the nearest to positive cash flow where no property gets there', () => {
    const withTrajectory = {
      ...FULL_ANALYSIS,
      cashFlowTrajectory: {
        fastestPositiveCashFlow: { propertyNumber: 2, reason: 'Smallest shortfall, though it stays negative.' },
      },
    };
    expect(render(withTrajectory)).toContain('Nearest to positive cash flow:');
    expect(render(withTrajectory)).not.toContain('Reaches positive cash flow first');
  });

  /**
   * The analysis's ending values restated section five in millions, unattributed,
   * in the order the properties run, which read as an attribution the producer
   * cannot make (F4).
   */
  it('prints none of the analysis\'s unattributed ending values, and no heading over nothing', () => {
    const endingOnly = {
      ...FULL_ANALYSIS,
      capitalGrowth: { year10Values: [{ propertyNumber: 1, value: '$1.1M', equity: '$0.6M' }] },
    };
    const html = render(endingOnly);
    expect(html).not.toContain('Value at the end of the term');
    expect(html).not.toContain('$1.1M');
    expect(html).not.toContain('>Capital growth</h2>');
    const both = render({
      ...FULL_ANALYSIS,
      capitalGrowth: {
        wealthBuilder: { propertyNumber: 1, reason: 'Interest only.' },
        year10Values: [{ propertyNumber: 1, value: '$1.1M', equity: '$0.6M' }],
      },
    });
    expect(both).toContain('>Capital growth</h2>');
    expect(both).not.toContain('$1.1M');
  });

  /** The rate-rise margins are nowhere else, so they stay, said to belong to no named property. */
  it('keeps the break-even figures and says they are attributed to nobody', () => {
    const html = render({
      ...FULL_ANALYSIS,
      riskAssessment: {
        ...FULL_ANALYSIS.riskAssessment,
        breakEvenAnalysis: [{ propertyNumber: 1, breakEvenYear: 'Year 7', safetyMargin: '1.5%' }],
      },
    });
    expect(html).toContain('without saying which property each belongs to');
    expect(html).toContain('in no property’s order');
    // The first column is the row's header cell; the margin is a figure cell.
    expect(html).toContain('>Year 7</th>');
    expect(cell(html, '1.5%')).toBe(true);
  });

  it('sets the model\'s paragraphs as paragraphs', () => {
    const html = render({ ...FULL_ANALYSIS, executiveSummary: 'First thought.\n\nSecond thought.' });
    expect(html).toContain('<p>First thought.</p><p>Second thought.</p>');
  });

  /** At three or fewer the cover listed the properties directly under a title naming them. */
  it('lists the properties under the cover title only when the title could not name them all', () => {
    const two = render();
    expect(two).not.toMatch(/>Properties<\//);
    const ids = ['a', 'b', 'c', 'd'].map((c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`);
    const four = renderComparisonFromBrand({
      comparison: buildComparison({
        properties: ids.map((id, i) => ({
          reportId: id,
          address: `${i + 1} Example Street, Suburbia VIC 3000`,
          isPrimary: i === 0,
          projection: projection(-1_000 * (i + 1)),
        })),
        primaryReportId: ids[0],
        clientName: 'Sample Client',
        investorProfile: 'balanced',
        analysis: null,
        now: NOW,
      }),
      snapshot,
    }).html;
    expect(four).toMatch(/>Properties</);
    expect(four).toContain('1 Example Street · 2 Example Street · 3 Example Street · 4 Example Street');
  });

  /** "Repay what it cost to buy" misstated the measure under it. */
  it('describes the payback measure as what it is', () => {
    const measures = comparisonSections(build()).find((x) => x.id === 'measures');
    expect(measures?.note).toBe('Return, yield, and when each repays what it cost to hold.');
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

  /**
   * Renegotiated (28 Sep 2026). It was the count, the date and the reference —
   * `Cash_Flow_Comparison_2_Properties_2026-08-02_11111111.pdf` — which says
   * nothing about which comparison a file is. The properties are the subject,
   * so they name it; the reference stays on the cover foot, and the storage key
   * stays URL-safe.
   */
  it('names the file after the properties and the date, readably', () => {
    expect(comparisonFileName(['12 Example Street', '9 Sample Road'], NOW))
      .toBe('Cash Flow Comparison - 12 Example Street and 9 Sample Road - 02 Aug 2026.pdf');
    expect(comparisonReference(A)).toBe('11111111');
    expect(comparisonStoragePath(A, 'Cash Flow Comparison - 12 Example Street.pdf', NOW, 'u'))
      .toBe(`cash-flow-comparison/${A}/2026-08-02/u-Cash_Flow_Comparison_-_12_Example_Street.pdf`);
  });

  /**
   * Audit 8. The modal's own downloads saved as
   * `cash-flow-comparison-3-properties-2026-10-01.pdf` and
   * `ai-cash-flow-analysis-2026-10-01.pdf`. They take the typeset document's
   * name now, qualified, and never the word the flatten button adds itself.
   */
  it('names the modal\'s own downloads the same way, qualified', () => {
    expect(comparisonFileName(['12 Example Street', '9 Sample Road'], NOW, COMPARISON_LEGACY_QUALIFIER))
      .toBe('Cash Flow Comparison - legacy layout - 12 Example Street and 9 Sample Road - 02 Aug 2026.pdf');
    expect(comparisonFileName(
      ['12 Example Street'],
      NOW,
      `${COMPARISON_ANALYSIS_QUALIFIER}, ${COMPARISON_LEGACY_QUALIFIER}`,
    )).toBe('Cash Flow Comparison - written analysis, legacy layout - 12 Example Street - 02 Aug 2026.pdf');
    expect(`${COMPARISON_ANALYSIS_QUALIFIER} ${COMPARISON_LEGACY_QUALIFIER}`).not.toMatch(/flattened/i);
  });

  /** Keyed by the primary report: the properties may belong to different clients. */
  it('files it under the primary report and a random segment', () => {
    const path = comparisonStoragePath(A, 'x.pdf', NOW, 'uuid-here');
    expect(path).toBe(`cash-flow-comparison/${A}/2026-08-02/uuid-here-x.pdf`);
  });
});
