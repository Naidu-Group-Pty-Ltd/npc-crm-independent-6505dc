/**
 * What the document must be, structurally, before anyone looks at a page.
 *
 * The findings this format is being migrated away from are all structural: a
 * contents page hand-counted from a variable that starts at 3, sections listed
 * in an order they are not printed in, an inventory that resumes at a fixed row
 * index, a cover that is a raster of our letterhead on a tenant's report. None
 * of those are visible in the PDF bytes and all of them are visible here.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { writeRenderArtifact } from '../../__tests__/renderArtifact';
import { buildPortfolioReview } from '../normalise.pure';
import {
  MEMO_CHAPTER_CLASS,
  RUN_ON_CHAPTER_CLASS,
  SECTION_SUBHEAD_CLASS,
} from '@/lib/reportDesign/primitives.pure';
import { renderPortfolioFromBrand, DOCUMENT_NAME } from '../render.pure';
import { portfolioSections, portfolioSpine, validatePortfolioSpine, DETAIL_CAP } from '../sections.pure';
import { contentsEntriesFor, REPORT_ARCHETYPES, spinePageBudget } from '@/lib/reportDesign/structure.pure';
import { buildReportBrandSnapshot } from '@/lib/reportDesign/snapshot.pure';
import {
  parseRenderRequest,
  portfolioFileName,
  portfolioStoragePath,
} from '../route.pure';

const NOW = '2026-08-02T00:00:00.000Z';

const holding = (n: number) => ({
  propertyNumber: n,
  address: `${n} Wattle Street, Example Bay, QLD 4000`,
  propertyType: 'investment',
  value: 500_000,
  loan: 400_000,
  equity: 100_000,
  lvr: 80,
  monthlyRentalIncome: 2_000,
  monthlyExpenses: 800,
  netMonthlyCashflow: 1_200,
  grossYield: 4.8,
  isOwnerOccupied: false,
});

const review = (
  count = 3,
  analysis: Record<string, unknown> = {},
  reviewRow: Record<string, unknown> | null = null,
) => buildPortfolioReview({
  report: {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    created_at: '2026-05-01T00:00:00.000Z',
    overall_health: 'Good',
    report_data: {
      portfolioMetrics: { totalValue: 1_500_000, totalProperties: count },
      propertyAnalyses: Array.from({ length: count }, (_, i) => holding(i + 1)),
      analysis,
    },
  },
  review: reviewRow as never,
  clientName: 'Sample Client',
  now: NOW,
});

// A white-label tenant, so "the cover carries the tenant's mark and not ours"
// is a claim the fixture can actually falsify.
const { snapshot } = buildReportBrandSnapshot({
  whitelabel: { companyName: 'Tenant Advisory', brandColour: '#B8873A', preset: 'signature' },
  contact: { company_name: 'Tenant Advisory Pty Ltd', abn: '11 222 333 444' },
  capturedAt: NOW,
});

const render = (p: ReturnType<typeof review>) =>
  renderPortfolioFromBrand({ review: p, snapshot }).html;

/**
 * Every branch of the format at once, at the size the archetype's page band
 * assumes.
 *
 * The assertions above run against three holdings and an empty analysis, which
 * is the smallest document this format can produce and tells you nothing about
 * how it paginates. This fixture is the one that gets rendered and looked at:
 * ten holdings, every narrative block populated, a projection, a borrowing
 * capacity, a review with scores and scenarios, and enough actions to push the
 * plan across a page break.
 */
const HOLDING_STRENGTHS = [
  'Rent has risen at each of the last four renewals.',
  'Vacancy in the immediate catchment is under one per cent.',
  'The lot is the only four-bedroom in the complex.',
  'Land value has outrun the improved value three years running.',
  'The tenant has renewed twice without an incentive.',
  'A school catchment change lands inside the horizon.',
  'Holding costs are the lowest in the portfolio per dollar of value.',
];

const HOLDING_CONCERNS = [
  'Body corporate fees are above the precinct median.',
  'Yield is below the portfolio average.',
  'The roof is at the end of its documented life.',
  'The loan reverts from interest-only in fourteen months.',
  'Insurance has risen at each of the last three renewals.',
];

const HOLDING_VERDICTS = [
  'Hold.',
  'Hold, and review at the next lease expiry.',
  'Hold; revisit if the fee rise carries a second year.',
  'Hold, and bring the loan onto the same expiry as the others.',
];

const HOLDING_OUTLOOKS = [
  'Rents in the catchment have risen for four consecutive quarters and vacancy is under 1%.',
  'Stock of this shape turns over about twice a decade here, which supports the price rather than the yield.',
  'The precinct has one approved development of scale and it is outside the immediate comparison set.',
  'Days on market lengthened by nine over the year, which is a softening rather than a fall.',
  'Rent and value have moved together here, which is unusual in this portfolio and worth watching.',
];

const FULL_ANALYSIS: Record<string, unknown> = {
  executiveSummary: {
    overallHealth: 'Good',
    healthScore: 72,
    keyStrengths: [
      'Equity of $1.6M across ten holdings, none above 85% LVR.',
      'Net cash flow is positive in nine of the ten properties.',
      'Geographic spread across three states limits single-market exposure.',
    ],
    keyConcerns: [
      'Six of the ten holdings sit in south-east Queensland.',
      'Two loans revert from interest-only within eighteen months.',
      'No offset balance is recorded against the largest loan.',
    ],
    primaryRecommendation:
      'Refinance the two reverting loans before the interest-only period ends, and hold the remainder.',
  },
  compositionAnalysis: {
    propertyMixAssessment:
      'Ten investment holdings and no owner-occupied property. Eight houses and two units, which is a defensible mix for a portfolio at this stage.',
    assetAllocation:
      'By value the portfolio is 62% Queensland, 24% Victoria and 14% South Australia. The Queensland weighting is the single largest structural exposure.',
    recommendations: [
      'Direct the next purchase outside south-east Queensland.',
      'Retain the two units; they carry the strongest yields.',
      'Review the body corporate schedule on the Newstead unit at renewal.',
    ],
  },
  financialHealth: {
    analysis:
      'The portfolio services itself. Rental income of $240,000 covers interest of $186,000 and holding costs of $41,000 with $13,000 to spare, before tax and before depreciation.',
    cashflowStatus: 'Positive',
    equityPosition: 'Strong',
    lvrRisk: 'Moderate',
    debtServiceability: 'Comfortable',
  },
  riskAssessment: {
    overallRiskLevel: 'Moderate',
    concentrationRisk: 'High',
    vacancyRisk: 'Low',
    interestRateSensitivity: 'Moderate',
    marketRisks: [
      'A south-east Queensland correction would move 62% of the portfolio at once.',
      'Two loans revert to principal and interest within eighteen months.',
      'Insurance premiums in the coastal holdings have risen for three consecutive renewals.',
    ],
    mitigationStrategies: [
      'Fix the two reverting loans for three years at the current rate.',
      'Build the offset balance to six months of holding costs.',
      'Stagger the remaining lease expiries so no two fall in the same quarter.',
    ],
  },
  marketConditions: {
    marketCycleSummary:
      'The Queensland market has run for eleven quarters and the rate of growth is slowing rather than reversing. Victoria has been flat for six.',
    clientPositioning:
      'Holding through the slowdown is the reasonable position; nothing in this portfolio needs to be sold to fund anything else.',
    lendingEnvironment: 'Tightening',
    rbaOutlook: 'On hold',
  },
  growthOpportunities: {
    nextPurchaseRecommendations: [
      'A three-bedroom house in outer western Melbourne, at or under $650,000.',
      'A townhouse in Adelaide’s inner north, if the yield clears 4.5%.',
    ],
    equityReleaseOptions: [
      'The Wattle Street holdings support a combined release of about $180,000 at 80% LVR.',
    ],
    refinancingOpportunities: [
      'Loans 3 and 7 are 0.6% above the current market rate for their LVR band.',
    ],
    optimizationStrategies: [
      'Move the offset to the highest-rate loan.',
      'Bring the two coastal insurance policies onto one renewal date.',
    ],
  },
  // Ten holdings, ten different verdicts. Repeating one sentence across all ten
  // put the same paragraph on six consecutive sheets and fired the critique
  // rubric's only `high` rule five times on the fixture — which is to say the
  // rule could not have caught a document that really did repeat itself.
  propertyRankings: Array.from({ length: 10 }, (_, i) => ({
    address: `${i + 1} Wattle Street, Example Bay, QLD 4000`,
    rank: i + 1,
    performanceRating: i < 3 ? 'Strong' : i < 7 ? 'Good' : 'Watch',
    strengths: [HOLDING_STRENGTHS[i % HOLDING_STRENGTHS.length], HOLDING_STRENGTHS[(i * 3 + 4) % HOLDING_STRENGTHS.length]],
    concerns: [HOLDING_CONCERNS[i % HOLDING_CONCERNS.length]],
    recommendation: HOLDING_VERDICTS[i % HOLDING_VERDICTS.length],
  })),
  propertyStrategicContext: Array.from({ length: 10 }, (_, i) => ({
    address: `${i + 1} Wattle Street, Example Bay, QLD 4000`,
    strategicRole: i < 3 ? 'Growth' : 'Yield',
    individualOutlook: HOLDING_OUTLOOKS[i % HOLDING_OUTLOOKS.length],
  })),
  projections: {
    years: 5,
    projectedPortfolioValue: 6_400_000,
    projectedEquity: 2_900_000,
    projectedMonthlyCashflow: 4_200,
    plainEnglishSummary:
      'On 4% growth and 3% rent growth, the portfolio is worth $6.4M in five years with $2.9M of equity behind it.',
    assumptions: [
      'Capital growth of 4% a year, compounding.',
      'Rent growth of 3% a year.',
      'Interest at 6.15%, unchanged.',
      'No further purchases and no disposals.',
    ],
  },
  borrowingCapacityUtilisation: {
    estimatedCapacity: 4_800_000,
    totalDebtDeployed: 4_000_000,
    availableCapacity: 800_000,
    utilisationPercentage: 83.3,
    commentary:
      'At 83% of assessed capacity there is room for one more purchase at the price band recommended above, and none beyond it without a release.',
  },
  strategicRecommendations: {
    priorityActions: [
      'Refinance loans 3 and 7 before the interest-only period ends.',
      'Confirm the insurance sums insured against current replacement cost.',
    ],
    shortTerm: ['Bring the offset balance to $60,000.', 'Request a rent review on holdings 8 and 9.'],
    mediumTerm: ['Purchase outside Queensland.', 'Reassess the unit holdings at the twelve-month mark.'],
    longTerm: ['Reduce the Queensland weighting below 50% by value.'],
  },
  actionPlan: {
    twelveMonthActions: [
      'Complete the two refinances.',
      'Settle one additional property.',
      'Review every lease at expiry rather than rolling it.',
    ],
  },
};

const FULL_REVIEW: Record<string, unknown> = {
  status: 'final',
  review_date: '2026-05-14',
  next_review_due: '2026-11-14',
  overall_score: 74,
  portfolio_health: 71,
  cash_flow_score: 68,
  growth_potential: 79,
  data_completeness_score: 92,
  risk_level: 'moderate',
  executive_summary:
    'A well-serviced portfolio with one structural exposure worth acting on and two loans that need attention inside eighteen months.',
  key_findings: [
    'Nine of the ten holdings are cash-flow positive.',
    'Queensland is 62% of the portfolio by value.',
    'Two loans revert from interest-only within eighteen months.',
  ],
  property_scores: Array.from({ length: 10 }, (_, i) => ({
    address: `${i + 1} Wattle Street, Example Bay, QLD 4000`,
    overallScore: 80 - i * 3,
    classification: i < 3 ? 'Core' : i < 7 ? 'Satellite' : 'Review',
    strengths: [HOLDING_STRENGTHS[(i * 2 + 1) % HOLDING_STRENGTHS.length]],
    concerns: [HOLDING_CONCERNS[(i * 2 + 3) % HOLDING_CONCERNS.length]],
  })),
  scenarios: [
    {
      name: 'Rates rise 1%',
      description: 'Every loan reprices at the next review.',
      impact: { cashFlowChange: -3_300, newNetCashflow: -2_200 },
    },
    {
      name: 'Rents rise 5%',
      description: 'Applied at each lease renewal over twelve months.',
      impact: { cashFlowChange: 1_000, newNetCashflow: 2_100 },
    },
    {
      name: 'One holding vacant for a quarter',
      description: 'The weakest-yielding property sits empty for thirteen weeks.',
      impact: { cashFlowChange: -1_450, newNetCashflow: -350 },
    },
  ],
  recommendations: [
    {
      title: 'Refinance the two reverting loans',
      detail: 'Both revert to principal and interest within eighteen months, adding about $2,900 a month.',
      priority: 'high',
      steps: ['Obtain three quotes.', 'Compare against the existing lender’s retention offer.', 'Settle before the reversion date.'],
    },
  ],
};

/** The document, on disk, for the eye. See `renderArtifact.ts`. */
beforeAll(() => {
  writeRenderArtifact('portfolio-performance', render(review(10, FULL_ANALYSIS, FULL_REVIEW)));
});

describe('the contents page cannot claim something that was not printed', () => {
  it('lists exactly the sections the document builds, in printed order', () => {
    const p = review(3, {
      compositionAnalysis: { assetAllocation: 'All investment.' },
      riskAssessment: { overallRiskLevel: 'Medium' },
    });
    const built = portfolioSections(p).map((s) => s.title);
    const listed = contentsEntriesFor(portfolioSpine(p)).map((e) => e.title);
    expect(listed).toEqual(built);
  });

  it('numbers them from one, with no gaps', () => {
    const entries = contentsEntriesFor(portfolioSpine(review(3)));
    expect(entries.map((e) => e.number)).toEqual(
      entries.map((_, i) => String(i + 1).padStart(2, '0')),
    );
  });

  it('prints no page numbers at all, so none of them can be wrong', () => {
    // The legacy hand-increments a counter that starts at 3 and never
    // reconciles it against the drawn page count. `@page` counters number the
    // pages here, and the contents carries titles only.
    const html = render(review(3));
    const contents = html.slice(html.indexOf('page-contents'), html.indexOf('page-chapter-opener'));
    expect(contents).not.toMatch(/\bp\.?\s?\d{1,2}\b/);
  });
});

describe('the inventory holds every property', () => {
  it('gives the holdings section a budget derived from the count', () => {
    const small = portfolioSections(review(3)).find((s) => s.id === 'holdings')!;
    const large = portfolioSections(review(40)).find((s) => s.id === 'holdings')!;
    expect(large.pageBudget).toBeGreaterThan(small.pageBudget);
  });

  it('names every property in the matrix, however many there are', () => {
    const html = render(review(40));
    for (const n of [1, 20, 40]) {
      expect(html).toContain(`${n} Wattle Street`);
    }
  });

  it('says so on the page when per-property commentary is abridged', () => {
    const many = review(40, {
      propertyRankings: Array.from({ length: 40 }, (_, i) => ({
        address: `${i + 1} Wattle Street, Example Bay, QLD 4000`,
        rank: i + 1,
        performanceRating: 'Good',
        recommendation: 'Hold.',
      })),
    });
    const html = render(many);
    expect(html).toContain('Commentary is abridged');
    expect(html).toContain(`${DETAIL_CAP} of 40 properties`);
  });

  it('says nothing about abridgement when nothing was abridged', () => {
    const html = render(review(3, {
      propertyRankings: [{
        address: '1 Wattle Street, Example Bay, QLD 4000',
        rank: 1,
        recommendation: 'Hold.',
      }],
    }));
    expect(html).not.toContain('Commentary is abridged');
  });
});

describe('the cover is the tenant’s', () => {
  const html = render(review(3));

  it('carries the tenant’s name and not ours', () => {
    expect(html).toContain('Tenant Advisory');
    expect(html).not.toContain('NPC_PDF_Template');
    expect(html).not.toContain('npc-portfolio-cover');
  });

  it('names the client as the subject', () => {
    expect(html).toContain('Sample Client');
  });
});

describe('the document refuses to render when its structure is wrong', () => {
  it('throws rather than producing a document with no holdings', () => {
    const p = { ...review(3), holdings: [] } as ReturnType<typeof review>;
    expect(() => render(p)).toThrow(/invalid structure/);
    expect(validatePortfolioSpine(p)).toContain('the portfolio has no holdings to review');
  });

  it('throws rather than addressing a review to nobody', () => {
    const p = review(3);
    const nameless = { ...p, meta: { ...p.meta, clientName: '  ' } };
    expect(() => render(nameless)).toThrow(/invalid structure/);
  });
});

describe('the spine stays inside its archetype', () => {
  const [min, max] = REPORT_ARCHETYPES['portfolio-performance'].pageBudget;

  /**
   * `report_data.analysis` is stored model output, so an empty one is a real
   * state rather than corruption. The document that produces is thin — the
   * figures and nothing else — and it must still render, because refusing turns
   * a content problem into an outage for a client whose numbers are all there.
   */
  it('renders a report whose analysis came back empty', () => {
    const bare = review(1);
    expect(validatePortfolioSpine(bare)).toEqual([]);
    expect(spinePageBudget(portfolioSpine(bare))).toBe(min);
    expect(() => render(bare)).not.toThrow();
  });

  it.each([1, 3, 4, 20, 60])('a %i-property portfolio spines inside the band', (count) => {
    const p = review(count, {
      compositionAnalysis: { assetAllocation: 'Mixed.' },
      financialHealth: { analysis: 'Healthy.' },
      riskAssessment: { overallRiskLevel: 'Medium' },
      marketConditions: { marketCycleSummary: 'Recovering.' },
      growthOpportunities: { equityReleaseOptions: ['Refinance'] },
      borrowingCapacityUtilisation: { estimatedCapacity: 250_000 },
      projections: { projectedPortfolioValue: 2_000_000 },
      propertyRankings: Array.from({ length: count }, (_, i) => ({
        address: `${i + 1} Wattle Street, Example Bay, QLD 4000`,
        rank: i + 1,
      })),
    });
    const total = spinePageBudget(portfolioSpine(p));
    expect(total).toBeGreaterThanOrEqual(min);
    expect(total).toBeLessThanOrEqual(max);
    expect(validatePortfolioSpine(p)).toEqual([]);
  });
});

describe('nothing is escaped into the page unread', () => {
  it('escapes a client name that carries markup', () => {
    const p = review(3);
    const hostile = { ...p, meta: { ...p.meta, clientName: '<script>alert(1)</script>' } };
    const html = render(hostile);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes prose the model wrote', () => {
    const p = review(3, { financialHealth: { analysis: 'Debt <b>rose</b> & held.' } });
    const html = render(p);
    expect(html).not.toContain('<b>rose</b>');
    expect(html).toContain('&amp;');
  });
});

describe('the render request', () => {
  it('accepts a uuid and nothing else about the contents', () => {
    const parsed = parseRenderRequest({ reportId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.request.includeReview).toBe(true);
      expect(parsed.request.edition).toBeNull();
    }
  });

  it('refuses anything that is not a uuid', () => {
    for (const body of [null, {}, { reportId: '' }, { reportId: 'not-a-uuid' }]) {
      expect(parseRenderRequest(body).ok).toBe(false);
    }
  });

  it('lets a caller turn the review off explicitly, and only explicitly', () => {
    const off = parseRenderRequest({ reportId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', includeReview: false });
    expect(off.ok && off.request.includeReview).toBe(false);
    const absent = parseRenderRequest({ reportId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', includeReview: undefined });
    expect(absent.ok && absent.request.includeReview).toBe(true);
  });

  it('names the file the way the cover names the document, for whom and when', () => {
    // It was `Portfolio_Analysis_<Client>_<date>.pdf` — a word the cover never
    // uses, joined by underscores (PORTFOLIO.md §10).
    expect(portfolioFileName('Sample Client', NOW)).toBe('Portfolio Performance Review - Sample Client - 02 Aug 2026.pdf');
    expect(portfolioFileName('Jordan & Priya Whitfield', NOW))
      .toBe('Portfolio Performance Review - Jordan and Priya Whitfield - 02 Aug 2026.pdf');
  });

  it('keeps the storage key to URL-safe characters while the person gets the readable name', () => {
    const path = portfolioStoragePath('client-1', portfolioFileName('Sample Client', NOW), NOW, 'uid');
    expect(path).toBe('portfolio-reports/client-1/typeset/2026-08-02/uid-Portfolio_Performance_Review_-_Sample_Client_-_02_Aug_2026.pdf');
    expect(path).not.toMatch(/\s/);
  });

  it('writes under the prefix the format already uses, without colliding with it', () => {
    const path = portfolioStoragePath('client-1', 'Portfolio_Analysis.pdf', NOW, 'uid');
    expect(path.startsWith('portfolio-reports/client-1/')).toBe(true);
    // The legacy writes `portfolio-reports/<clientId>/<name>`; the extra segment
    // is what makes a collision with a file `pdf_file_path` points at impossible.
    expect(path).toContain('/typeset/');
    expect(path).toContain('uid-');
  });
});

describe('the format writes no colour of its own', () => {
  it.each(['payload', 'normalise', 'sections', 'render', 'charts', 'route'])(
    '%s.pure.ts names no hex colour',
    async (name) => {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const source = readFileSync(
        resolve(__dirname, `../../../../../supabase/functions/_shared/reports/portfolio/${name}.pure.ts`),
        'utf8',
      ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(source, `${name}.pure.ts writes a colour instead of taking one from the palette`)
        .not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    },
  );

  it('has a document name that comes from the archetype', () => {
    expect(DOCUMENT_NAME).toBe(REPORT_ARCHETYPES['portfolio-performance'].documentName);
  });
});

/**
 * The Portfolio audit (PORTFOLIO.md §10), pinned on the document's markup.
 * The page measurements behind it were taken on the pinned engine across all
 * fifty designs and the standard layout; what a unit test can hold is the
 * structure those measurements depend on.
 */
describe('the audit — the document reads as one continuous review', () => {
  const html = render(review(4, FULL_ANALYSIS, FULL_REVIEW));
  const chapters = [...html.matchAll(/<section class="chapter([^"]*)"[^>]*data-chapter-title="([^"]+)"/g)]
    .map((m) => ({ classes: m[1].trim().split(/\s+/), title: m[2] }));

  it('runs every section on after the first, as a memo', () => {
    expect(chapters.length).toBeGreaterThan(3);
    expect(chapters[0].classes).toContain(MEMO_CHAPTER_CLASS);
    expect(chapters[0].classes).not.toContain(RUN_ON_CHAPTER_CLASS);
    for (const c of chapters.slice(1)) {
      expect(c.classes, c.title).toContain(RUN_ON_CHAPTER_CLASS);
      expect(c.classes, c.title).toContain(MEMO_CHAPTER_CLASS);
    }
  });

  it('sets its subheads a step below the section title, and keeps them headings', () => {
    expect(html).toContain(`<h2 class="${SECTION_SUBHEAD_CLASS}">1 Wattle Street, Example Bay, QLD 4000</h2>`);
    expect(html).toContain(`<h2 class="${SECTION_SUBHEAD_CLASS}">What it means for this portfolio</h2>`);
  });

  it('sets up to five properties side by side on the page, headed by street, with no landscape sheet', () => {
    // The stylesheet names the landscape page whatever is drawn; the body
    // opens it only for a matrix wider than the portrait measure.
    const LANDSCAPE = '<section class="page-landscape-table">';
    expect(html).not.toContain(LANDSCAPE);
    expect(html).toContain('class="data holdings-matrix"><colgroup>');
    expect(html).toMatch(/>1\. 1 Wattle Street<\/th>/);
    const ten = render(review(10, FULL_ANALYSIS, FULL_REVIEW));
    expect(ten).toContain(LANDSCAPE);
  });

  it('keeps a short table whole and gives a long one at least three rows at a page foot', () => {
    expect(html).toContain('<div class="table-block keep-together">');
    // The action table runs past seven estimated lines, so it is set as row
    // groups, two leading rows each refusing the break after them.
    const actions = html.slice(html.indexOf('class="data action-plan"'));
    expect(actions.indexOf('<tbody class="lead">')).toBeGreaterThan(-1);
    expect(actions.split('<tbody class="lead">').length - 1).toBe(2);
  });

  it('keeps the action table’s horizon on one line', () => {
    expect(html).toContain('<table class="data action-plan">');
    expect(html).toMatch(/table\.data\.action-plan th\[scope="row"\] \{ white-space: nowrap; \}/);
  });

  it('prints every score the review recorded, data completeness included', () => {
    // The strip used to take the first four, so the fifth was scored and
    // never printed.
    for (const label of ['Overall', 'Portfolio health', 'Cash flow', 'Growth potential', 'Data completeness']) {
      expect(html).toContain(`<div class="kpi-label">${label}</div>`);
    }
    expect(html).toContain('92 / 100');
  });
});

describe('the audit — the figures a reader acts on', () => {
  const metrics = {
    totalValue: 1_500_000,
    totalDebt: 1_000_000,
    totalEquity: 500_000,
    totalMonthlyRentalIncome: 4_000,
    totalMonthlyExpenses: 1_600,
    netMonthlyCashflow: 2_400,
    totalProperties: 2,
    investmentCount: 2,
    ownerOccupiedCount: 0,
  };
  const withAnalysis = (analysis: Record<string, unknown>, reviewRow: Record<string, unknown> | null = null) =>
    buildPortfolioReview({
      report: {
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        created_at: '2026-05-01T00:00:00.000Z',
        overall_health: 'Good',
        report_data: {
          portfolioMetrics: metrics,
          propertyAnalyses: [holding(1), holding(2)],
          analysis,
        },
      },
      review: reviewRow as never,
      clientName: 'Sample Client',
      now: NOW,
    });

  it('states what a rate rise does in plain amounts under a head that says "each month"', () => {
    const doc = render(withAnalysis({
      // The rate-rise table belongs to the health section, which a review
      // with neither a health nor a risk assessment does not have.
      financialHealth: { analysis: 'The portfolio services itself.' },
      interestRateSensitivity: {
        investmentProperties: {
          available: true, loansCovered: 2, balanceCovered: 800_000,
          currentMonthlyCashflow: 2_400, plusOnePercentImpact: -667, plusTwoPercentImpact: -1_333,
        },
        ownerOccupiedProperties: { available: false, loansCovered: 1, unavailableReason: 'amortising_loan_without_term' },
      },
    }));
    expect(doc).toContain('>Each month<');
    expect(doc).toContain('Change on the investment loans');
    expect(doc).toContain('Net cash flow (investments) after the rise');
    expect(doc).toContain('-$667');
    expect(doc).not.toContain('-$667/mo');
    expect(doc).toContain('$1,733');
    expect(doc).toContain('A rate-rise figure is not shown for the owner-occupied loans');
    expect(doc).not.toContain('change a month');
  });

  it('prints today beside the projection only where the projection provably starts there', () => {
    const calculated = {
      years: 10,
      projectedPortfolioValue: Math.round(1_500_000 * 1.05 ** 10),
      projectedDebt: 1_000_000,
      projectedEquity: Math.round(1_500_000 * 1.05 ** 10) - 1_000_000,
      projectedMonthlyCashflow: null,
      assumptionDetail: {
        scenario: 'moderate', annualCapitalGrowthPercent: 5, horizonYears: 10,
        debtTreatment: 'held_constant', cashflowTreatment: 'not_projected',
      },
    };
    const proven = render(withAnalysis({ projections: calculated }));
    expect(proven).toContain('Value, debt and equity, today and projected');
    expect(proven).toContain('>Today<');
    expect(proven).toContain('>In 10 years<');
    expect(proven).toContain('Debt, held at today&#39;s balance');
    expect(proven).not.toContain('>Projected<');
    expect(proven).not.toContain('>Amount<');

    const unproven = render(withAnalysis({ projections: { ...calculated, projectedPortfolioValue: 2_000_000 } }));
    expect(unproven).toContain('Projected position at 10 years');
    expect(unproven).not.toContain('>Today<');
  });

  it('says whose ranking it is, and whose score, and draws no column of dashes without one', () => {
    const rankings = {
      propertyRankings: [1, 2].map((n) => ({
        address: `${n} Wattle Street, Example Bay, QLD 4000`, rank: n, performanceRating: 'Good',
      })),
    };
    const plain = render(withAnalysis(rankings));
    expect(plain).toContain('How the analysis ranks each property');
    expect(plain).not.toContain('>Review score<');
    expect(plain).not.toContain('>Score<');

    const scored = render(withAnalysis(rankings, {
      status: 'completed',
      overall_score: 70,
      property_scores: [{ address: '1 Wattle Street, Example Bay, QLD 4000', overallScore: 61, classification: 'Core' }],
    }));
    expect(scored).toContain('>Review score<');
    expect(scored).toContain('61 / 100');
  });

  it('prints an action both assessments named once, and says both named it', () => {
    const doc = render(withAnalysis(
      { strategicRecommendations: { shortTerm: ['Review the rent at renewal.', 'Quote the insurance.'] } },
      {
        status: 'completed',
        overall_score: 70,
        recommendations: [{ title: 'Review the rent at renewal', priority: 'medium', description: 'Comparables lease higher.' }],
      },
    ));
    const table = doc.slice(doc.indexOf('class="data action-plan"'), doc.indexOf('</table>', doc.indexOf('class="data action-plan"')));
    expect(table.match(/Review the rent at renewal/g)).toHaveLength(1);
    expect(table).toContain('>Both<');
    expect(table).toContain('>Analysis<');
  });

  it('names the scope of each cash line where a home is in the portfolio', () => {
    const home = { ...holding(3), propertyType: 'owner_occupied', isOwnerOccupied: true,
      monthlyRentalIncome: 0, monthlyExpenses: 2_500, netMonthlyCashflow: -2_500, grossYield: 'N/A' };
    const doc = render(buildPortfolioReview({
      report: {
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        created_at: '2026-05-01T00:00:00.000Z',
        report_data: {
          portfolioMetrics: { ...metrics, totalProperties: 3, ownerOccupiedCount: 1, includeOwnerOccupied: true },
          propertyAnalyses: [holding(1), holding(2), home],
          analysis: {},
        },
      },
      review: null,
      clientName: 'Sample Client',
      now: NOW,
    }));
    expect(doc).toContain('Net cash flow (investments)');
    expect(doc).toContain('Owner-occupied outgoings, not in the net');
    expect(doc).toContain('an owner-occupied home earns no rent');
  });

  it('puts a note under the section it is about', () => {
    const tenancy = { ...holding(3), address: '3/18 Station Street, Penrith NSW 2750', propertyType: 'rental' };
    const doc = render(buildPortfolioReview({
      report: {
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        created_at: '2026-05-01T00:00:00.000Z',
        report_data: { portfolioMetrics: metrics, propertyAnalyses: [holding(1), holding(2), tenancy], analysis: {} },
      },
      review: null,
      clientName: 'Sample Client',
      now: NOW,
    }));
    const holdingsAt = doc.indexOf('data-chapter-title="Every property"');
    const noteAt = doc.indexOf('3/18 Station Street, Penrith NSW 2750 is rented, not owned');
    expect(holdingsAt).toBeGreaterThan(-1);
    expect(noteAt).toBeGreaterThan(holdingsAt);
    expect(doc.match(/is rented, not owned/g)).toHaveLength(1);
  });

  it('sets a short opening under the contents and a long one at the head of the first section', () => {
    const short = render(withAnalysis({ personalizedNarrative: { openingStatement: 'Thank you for the time last week.' } }));
    const contentsAt = short.indexOf('page-contents');
    const firstChapterAt = short.indexOf('<section class="chapter');
    const shortAt = short.indexOf('Thank you for the time last week.');
    expect(shortAt).toBeGreaterThan(contentsAt);
    expect(shortAt).toBeLessThan(firstChapterAt);
    expect(short).toContain('<div class="contents-after">');

    const longText = 'We looked at every loan and every lease. '.repeat(40).trim();
    const long = render(withAnalysis({ personalizedNarrative: { openingStatement: longText } }));
    expect(long.indexOf('We looked at every loan')).toBeGreaterThan(long.indexOf('<section class="chapter'));
    expect(long).not.toContain('<div class="contents-after">');
  });

  it('prints the reference whole on the cover', () => {
    const doc = render(withAnalysis({}));
    expect(doc).toContain('AAAAAAAA');
    expect(doc).not.toContain('AAAAAAAA…');
  });
});
