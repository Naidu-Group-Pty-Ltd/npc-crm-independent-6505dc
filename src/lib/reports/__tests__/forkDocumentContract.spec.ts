/**
 * What the two FORKED documents must contain — the Financial Analysis Report
 * and the Property & Location Due Diligence Report.
 *
 * These are the two of the five investment tiers that are made by SPLITTING a
 * Compass rather than by condensing one, and they had never been drawn and
 * read. Driven through `composeForkDocuments` on 20 Sep 2026, each was missing
 * the section it exists for.
 *
 * **The Due Diligence report had no verification checklist and no
 * recommendation.** `PLDD_SECTION_ORDER` stopped at 17; the Compass's *Due
 * Diligence Checklist* was routed onto the heading the risk register already
 * used, and the *Final Recommendation* went to the Financial report alone.
 * `sectionRegistry` recorded both as `depth: 'optional', producer: null` —
 * honest, and `optional` is the one depth `PRODUCER_GAPS` does not police, so
 * the document defined by its verification register declared that register's
 * absence "not a defect" and nothing ever asked.
 *
 * **The Financial report lost its recommendation whenever a strategy record
 * was present**, which is the production path. `FIN_SECTION_ORDER` gained
 * `Holding Strategy` at 15 — "only the two ordinals after it moved", says the
 * comment — and the three routes that restate those ordinals were left behind,
 * so the routed recommendation arrived at the composed Holding Strategy's
 * ordinal and `mergeComposedChapters`, which evicts by ORDINAL, deleted it.
 *
 * **And the mechanism underneath both was a de-duplicator.** `assembleForVariant`
 * keyed on the heading alone and kept the longest body, which is right for a
 * parent that wrote one section twice and catastrophic for a routing table
 * that gives three different sections one name: the parent's verification
 * list and its source notes reached neither document, with a section count as
 * the only trace.
 *
 * The rule these tests hold: **a fork may lose a heading; it must never lose a
 * body.**
 */
import { describe, expect, it } from 'vitest';

import {
  composeForkDocuments,
} from '../../../../supabase/functions/_shared/reports/investment/forkSplit.pure';
import {
  SPLIT_ROUTES, FIN_SECTION_ORDER, PLDD_SECTION_ORDER, loadSplitRegistry,
  routeCompositeSection,
  type SplitRoute,
} from '../../../../supabase/functions/_shared/reportSplitRegistry';
import { readStrategyRecord } from '../../../../supabase/functions/_shared/reports/investment/strategyPositions.pure';
import { buildMarketFacts } from '../../../../supabase/functions/_shared/reports/market/marketFactBlocks.pure';
import { describeSubjectPrice } from '../../../../supabase/functions/_shared/reports/investment/subjectPrice.pure';
import { transportCountReading } from '../../../../supabase/functions/_shared/transportReading.pure';
import { sectionsForTier, mergesForTier } from '../../../../supabase/functions/_shared/reports/investment/sectionRegistry.pure';

/** A client that answers nothing, so the registry resolves to its code defaults. */
const NO_OVERLAY = { from: () => ({ select: () => ({ in: async () => ({ data: null }) }) }) } as never;

const ADDRESS = '97 Poole Road, Kellyville NSW 2155';

const FINANCIALS = {
  keyMetrics: {
    grossRentalYield: 3.47, netRentalYield: 2.1, weeklyNet: -420, annualNet: -21_840,
    lvr: 80, totalInvestment: 480_000, occupancyWeeks: 50,
  },
  income: { weeklyRent: 850, annualRent: 44_200, effectiveAnnualRent: 42_500 },
  annualCosts: { totalAnnual: 18_500, councilRates: 2_000, waterRates: 1_100 },
  loanDetails: {
    loanAmount: 1_580_000, interestRate: 6.1, loanTerm: 30, lvr: 80,
    structure: 'Principal and interest over 30 years', monthlyPayment: 9_570, annualPayment: 114_840,
  },
  assumptions: { capitalGrowth: 4.5, occupancyWeeks: 50 },
  initialCosts: { propertyValue: 1_975_000, deposit: 395_000, stampDuty: 98_000, totalUpfront: 500_000 },
};

const strategyRecord = () => readStrategyRecord(
  {
    propertyAddress: ADDRESS,
    propertySpecs: { property_type: 'house', bedrooms: 4, bathrooms: 2, price: 1_975_000 },
    financialCalculations: FINANCIALS,
    investmentScore: { totalScore: 61, grade: 'B' },
    dataSources: {},
    locationIntelligence: {},
  } as never,
  {
    measuredAt: null,
    market: buildMarketFacts({} as never),
    price: describeSubjectPrice({ listingPrice: 1_975_000 } as never),
    carriesModelling: true,
    transport: transportCountReading(undefined as never),
  } as never,
);

/**
 * A parent written with the CURRENT Compass's own headings.
 *
 * Taken from the registry rather than typed out, because the v4.0 merge is
 * what emptied seven of the Due Diligence document's declared slots: a fixture
 * carrying headings the Compass no longer writes would test a document nobody
 * can produce. Three sections carry distinctive content so the assertions can
 * follow a BODY rather than a heading.
 */
const CHECKLIST_ITEM = 'Obtain a section 10.7 planning certificate';
const APPENDIX_SOURCE = 'ABS Census 2021, read 7 August 2026';
const RISK_ROW_PROPERTY = 'Flood overlay mapped over the rear boundary';

const DISTINCTIVE: Record<string, string> = {
  'Due Diligence Checklist': `- [ ] ${CHECKLIST_ITEM}\n- [ ] Order a building and pest inspection\n`,
  'Appendix, Source Notes & Disclaimer': `Sources: ${APPENDIX_SOURCE}.\n`,
  'Risk Dashboard': [
    '| Risk | Level | Why It Matters | Required Check |',
    '| --- | --- | --- | --- |',
    `| ${RISK_ROW_PROPERTY} | Moderate | Affects insurance and rebuild | Obtain the flood certificate |`,
  ].join('\n') + '\n',
  'Final Recommendation': 'Proceed with caution. The call rests on the corridor rather than the yield.\n',
};

const compassHeadings = () => sectionsForTier('compass' as never)
  .filter((s) => s.surface === 'markdown')
  .map((s) => s.label);

const parentContent = () => compassHeadings()
  .map((label) => `## ${label}\n\n${DISTINCTIVE[label]
    ?? `Prose for ${label}. Two sentences, so nothing is dropped as an empty section.`}\n`)
  .join('\n');

const compose = async (over: Record<string, unknown> = {}) => composeForkDocuments({
  registry: await loadSplitRegistry(NO_OVERLAY),
  parentContent: parentContent(),
  propertyAddress: ADDRESS,
  financialCalculations: FINANCIALS,
  financialScore: { totalScore: 61 },
  composeFinancial: true,
  strategy: null,
  generatedOn: '2026-09-20',
  ...over,
});

const headings = (markdown: string): string[] =>
  [...markdown.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);

describe('a route and the section order are one statement of the document', () => {
  const pick = (variant: 'fin' | 'pldd', r: SplitRoute) => (variant === 'fin'
    ? { heading: r.newHeadingFinancial, ordinal: r.ordinalFinancial }
    : { heading: r.newHeadingDueDiligence, ordinal: r.ordinalDueDiligence });

  it.each([
    ['FIN', 'fin', FIN_SECTION_ORDER],
    ['PLDD', 'pldd', PLDD_SECTION_ORDER],
  ] as const)('%s: every route names a heading the order declares, at the order\'s own ordinal', (_n, variant, order) => {
    const byHeading = new Map(order.map((e) => [e.heading, e.ordinal]));
    for (const route of SPLIT_ROUTES) {
      const { heading, ordinal } = pick(variant, route);
      if (!heading || ordinal === undefined) continue;
      /*
       * Both halves matter. A heading the order does not carry has no slot;
       * an ordinal that disagrees with the order puts the section in another
       * section's place — which is how the Financial recommendation came to
       * sit on the Holding Strategy's ordinal and be evicted by it.
       */
      expect(byHeading.has(heading), `no ${_n} section is called "${heading}"`).toBe(true);
      expect(byHeading.get(heading), `"${heading}" (route matches "${route.match[0]}")`).toBe(ordinal);
    }
  });

  it.each([
    ['FIN', FIN_SECTION_ORDER],
    ['PLDD', PLDD_SECTION_ORDER],
  ] as const)('%s: the order itself carries no repeated ordinal and no repeated heading', (_n, order) => {
    expect(new Set(order.map((e) => e.ordinal)).size).toBe(order.length);
    expect(new Set(order.map((e) => e.heading)).size).toBe(order.length);
  });
});

describe('every section a forked document declares can actually be produced', () => {
  /*
   * The guard that would have caught the deepest fault here.
   *
   * `PLDD_SECTION_ORDER` described the PRE-v3.0 composite, and the v4.0
   * Compass merges six of its sources away — so measured 20 Sep 2026 SEVEN of
   * seventeen declared Due Diligence sections could not be produced from a
   * current parent by any route, and an eighth (FIN 7, Vacancy Risk) was the
   * same fault on the Financial side, left behind when the Due Diligence half
   * of the v3.0 catch-up was fixed. A slot a document can only ever leave
   * empty is not a section; it is a promise the shape cannot keep.
   *
   * Composed sections are read from the registry rather than listed, so the
   * exemption cannot drift into a hand-maintained allow-list.
   */
  const routedOrdinals = (variant: 'fin' | 'pldd') => {
    const out = new Set<number>();
    for (const label of sectionsForTier('compass' as never)
      .filter((s) => s.surface === 'markdown').map((s) => s.label)) {
      const { route } = routeCompositeSection(label);
      if (!route) continue;
      if (variant === 'fin' && (route.target === 'financial' || route.target === 'both') && route.ordinalFinancial) {
        out.add(route.ordinalFinancial);
      }
      if (variant === 'pldd' && (route.target === 'due_diligence' || route.target === 'both') && route.ordinalDueDiligence) {
        out.add(route.ordinalDueDiligence);
      }
    }
    return out;
  };

  const composedHeadings = (tier: 'financial' | 'strategic') => new Set(
    sectionsForTier(tier as never)
      .filter((s) => s.placement.producer?.kind === 'composed')
      .map((s) => s.label),
  );

  it.each([
    ['FIN', 'fin', FIN_SECTION_ORDER, 'financial'],
    ['PLDD', 'pldd', PLDD_SECTION_ORDER, 'strategic'],
  ] as const)('%s: every declared section is routed from a v4.0 Compass or composed', (name, variant, order, tier) => {
    const routed = routedOrdinals(variant);
    const composed = composedHeadings(tier);
    // Sanity: an empty routed set would make this pass vacuously.
    expect(routed.size).toBeGreaterThan(3);
    const unfillable = order
      .filter((e) => !routed.has(e.ordinal) && !composed.has(e.heading))
      .map((e) => `#${e.ordinal} ${e.heading}`);
    expect(unfillable, `${name} declares sections nothing can fill`).toEqual([]);
  });

  it('the strategic tier sorts the same way the document does', () => {
    /*
     * Two statements of one order again: `sectionsForTier('strategic')` is
     * sorted by the tier's own `order`, and the document is rendered by the
     * PLDD ordinal. They had drifted — the risk dashboard sorted before the
     * environmental section in the registry and after it in the document.
     */
    const routedSections = sectionsForTier('strategic' as never)
      .filter((s) => s.placement.producer?.kind === 'routed');
    const ordinals = routedSections.map((s) => Number(s.placement.producer!.ref.split('#')[1]));
    expect(ordinals.length).toBeGreaterThan(8);
    expect([...ordinals].sort((a, b) => a - b)).toEqual(ordinals);
  });
});

describe('the seven slots nothing could fill', () => {
  const MERGED_AWAY: Array<[string, string]> = [
    ['suburbCharacter', 'propertyFit'],
    ['socioeconomic', 'population'],
    ['employment', 'population'],
    ['tenantDemand', 'population'],
    ['infrastructure', 'locationCase'],
    ['supplyPipeline', 'marketPosition'],
    ['dwelling', 'propertyFit'],
  ];

  it('merges each one exactly where the Compass merges it', () => {
    /*
     * The Due Diligence document is MADE of the Compass, so it cannot carry a
     * section the Compass no longer writes. Each of these is asserted against
     * the compass tier rather than against a literal, so a future Compass
     * merge that this document does not follow fails here rather than
     * shipping an empty heading.
     */
    const compassMerges = new Map(
      mergesForTier('compass' as never).map((m) => [m.id, m.into]),
    );
    const strategicMerges = new Map(
      mergesForTier('strategic' as never).map((m) => [m.id, m.into]),
    );
    for (const [id, into] of MERGED_AWAY) {
      expect(compassMerges.get(id), `${id} is no longer merged on the Compass`).toBe(into);
      expect(strategicMerges.get(id), `${id} must merge where the Compass merges it`).toBe(into);
    }
  });

  it('draws no heading for them, and the carrier is there instead', () => {
    const labels = sectionsForTier('strategic' as never).map((s) => s.label);
    for (const gone of [
      'Suburb Character, Lifestyle & Occupier Appeal',
      'Socioeconomic Profile & SEIFA Interpretation',
      'Employment, Income & Affordability Profile',
      'Tenant Demand and Occupier Personas',
      'Infrastructure and Growth Context',
      'Competitive Landscape and Supply Pipeline',
      'Future Buyer and Resale Appeal',
    ]) {
      expect(labels, `"${gone}" is a slot no parent can fill`).not.toContain(gone);
    }
    for (const carrier of [
      'Dwelling, Suburb Character & Occupier Appeal',
      'Position Within the Locality & Infrastructure Context',
      'Population, Socioeconomics, Employment & Tenant Demand',
      'Market Position, Competitive Landscape & Supply Pipeline',
    ]) {
      expect(labels).toContain(carrier);
    }
  });

  it('loses nothing from a LEGACY composite, which still writes them', async () => {
    /*
     * 1,199 stored reports predate the v3.0 merge and write the old headings.
     * The routes are re-pointed at the carrier rather than deleted, and
     * `assembleForVariant` joins two routes that name one slot — so a legacy
     * parent's suburb-character prose lands in the carrier instead of being
     * dropped for want of a heading.
     */
    const legacy: Array<[string, string]> = [
      ['Executive Summary', 'VERDICT-MARK'],
      ['Property Snapshot', 'SNAPSHOT-MARK'],
      ['Dwelling Layout & Functional Fit', 'DWELLING-MARK'],
      ['Location Overview', 'LOCATION-MARK'],
      ['Suburb Character & Community Identity', 'SUBURB-MARK'],
      ['Education & Family Amenity', 'AMENITY-MARK'],
      ['Connectivity & Transport', 'TRANSPORT-MARK'],
      ['SEIFA & Socioeconomic Profile', 'SEIFA-MARK'],
      ['Population & Housing Demand', 'POPULATION-MARK'],
      ['Employment & Economic Linkages', 'EMPLOYMENT-MARK'],
      ['Primary and Secondary Tenant Personas', 'TENANT-MARK'],
      ['Future Buyer & Resale Appeal', 'BUYER-MARK'],
      ['Planning, Zoning & Overlays', 'PLANNING-MARK'],
      ['Future Infrastructure', 'INFRA-MARK'],
      ['Climate & Environmental Risk', 'CLIMATE-MARK'],
      ['Supply & Development Pipeline', 'SUPPLY-MARK'],
      ['Current Market Performance', 'MARKET-MARK'],
      ['Risk Dashboard', 'RISK-MARK'],
      ['Due Diligence Checklist', 'CHECKLIST-MARK'],
      ['Final Recommendation', 'RECO-MARK'],
      ['Professional Disclaimer', 'APPENDIX-MARK'],
    ];
    const docs = await compose({
      parentContent: legacy.map(([h, m]) => `## ${h}\n\n${m} — prose for ${h}.\n`).join('\n'),
      strategy: strategyRecord(),
    });
    const both = `${docs.financial.markdown}\n${docs.dueDiligence.markdown}`;
    const lost = legacy.filter(([, mark]) => !both.includes(mark)).map(([h]) => h);
    expect(lost, 'a legacy parent lost these bodies entirely').toEqual([]);
  });
});

describe('the Due Diligence report carries what it is named for', () => {
  it('ends on the checklist, the review plan and the call', async () => {
    const docs = await compose({ strategy: strategyRecord() });
    const pldd = headings(docs.dueDiligence.markdown);
    for (const wanted of ['Due Diligence Checklist', 'Monitoring & Review Plan', 'Final Recommendation']) {
      expect(pldd, `the Due Diligence report has no "${wanted}"`).toContain(wanted);
    }
    // In that order, and after the risk register they follow from.
    const at = (h: string) => pldd.indexOf(h);
    expect(at('Property & Location Risk Dashboard')).toBeLessThan(at('Due Diligence Checklist'));
    expect(at('Due Diligence Checklist')).toBeLessThan(at('Monitoring & Review Plan'));
    expect(at('Monitoring & Review Plan')).toBeLessThan(at('Final Recommendation'));
  });

  it('carries the parent\'s actual verification items, not just the heading', async () => {
    const docs = await compose({ strategy: strategyRecord() });
    // The defect was a deletion, so the assertion follows the BODY. A heading
    // with nothing under it would satisfy the test above and fail this one.
    expect(docs.dueDiligence.markdown).toContain(CHECKLIST_ITEM);
  });

  it('composes the review plan from the record, and only where there is a record', async () => {
    const withRecord = await compose({ strategy: strategyRecord() });
    const without = await compose({ strategy: null });
    expect(headings(withRecord.dueDiligence.markdown)).toContain('Monitoring & Review Plan');
    /*
     * With no strategy record there is nothing to compose, and the document
     * is exactly what it was before this section existed. The gate is the
     * RECORD and never `composeFinancial`: this is the Due Diligence
     * document's own section, and hanging it off the other document's switch
     * is how one report's chapters come to decide what another's reader sees.
     */
    expect(headings(without.dueDiligence.markdown)).not.toContain('Monitoring & Review Plan');
    expect(without.dueDiligence.markdown).toBe(
      (await compose({ strategy: null, composeFinancial: false })).dueDiligence.markdown,
    );
  });
});

describe('the Due Diligence document carries no modelling', () => {
  /*
   * `tierContent.strategic` declares `financialModelling: false` and the
   * document's own cover says the financial position is in the Financial
   * Analysis Report. Nothing enforced it on the composed path, and the first
   * cut of the Due Diligence composition took the fork's ONE strategy
   * record — which `fork-investment-report` builds with
   * `carriesModelling: true`, because it is building it for the other
   * document. Measured on a real fork, that put the interest rate, the
   * weekly rent and "each percentage point is $15,800 a year on the recorded
   * balance" into this document.
   *
   * `StrategyRecord.finance` is null for a tier that does not carry the
   * analysis of a purchase, which is what `carriesModelling: false` produces
   * and what the Compass has always passed. The fork narrows the record here
   * rather than re-reading it.
   */
  const MODELLING_FIGURES: Array<[string, RegExp]> = [
    ['the loan balance', /1,580,000/],
    ['the interest rate', /6\.10%/],
    ['the weekly rent', /\$850\b/],
    ['a cost per rate point', /\$15,800/],
    ['the upfront total', /480,000/],
  ];

  it('prints none of the figures that belong to the Financial report', async () => {
    const docs = await compose({ strategy: strategyRecord() });
    for (const [what, pattern] of MODELLING_FIGURES) {
      expect(pattern.test(docs.dueDiligence.markdown), `${what} reached the Due Diligence document`)
        .toBe(false);
    }
  });

  it('and the Financial report still prints them, so this is a narrowing and not a loss', async () => {
    const docs = await compose({ strategy: strategyRecord() });
    // Sanity: if the record carried nothing, the assertion above would pass
    // for the wrong reason on every future change.
    const present = MODELLING_FIGURES.filter(([, p]) => p.test(docs.financial.markdown));
    expect(present.length).toBeGreaterThan(0);
  });
});

describe('the resale section, which was routed nowhere', () => {
  it('reaches the Due Diligence document', async () => {
    const docs = await compose({ strategy: strategyRecord() });
    const pldd = headings(docs.dueDiligence.markdown);
    expect(pldd).toContain('Resale Liquidity & Exit Outlook');
    // After the market section it reads from, before the risk register.
    expect(pldd.indexOf('Market Position, Competitive Landscape & Supply Pipeline'))
      .toBeLessThan(pldd.indexOf('Resale Liquidity & Exit Outlook'));
    expect(pldd.indexOf('Resale Liquidity & Exit Outlook'))
      .toBeLessThan(pldd.indexOf('Property & Location Risk Dashboard'));
  });

  it('gives each document the half its tier may carry, from one composer', async () => {
    const docs = await compose({ strategy: strategyRecord() });
    const pldd = docs.dueDiligence.markdown;
    /*
     * The same function writes both. The Due Diligence copy states that the
     * equity path belongs elsewhere rather than printing it, which is the
     * branch `carriesModelling: false` has always taken on the Compass and
     * which no fork had ever reached.
     */
    expect(pldd).toContain('belongs to the Financial Analysis Report');
    expect(pldd).toContain('Days on market, time to sell and buyer depth are not measured');
    // The Financial report carries the projection itself.
    expect(docs.financial.markdown).toContain('Resale Liquidity & Exit Strategy');
    expect(docs.financial.markdown).toMatch(/Modelled value|accepted CGR assumption/);
  });

  it('is composed only where there is a record, and never invents a market', async () => {
    const without = await compose({ strategy: null });
    expect(headings(without.dueDiligence.markdown)).not.toContain('Resale Liquidity & Exit Outlook');
  });
});

describe('the Financial report keeps its recommendation', () => {
  it('prints the call whether or not the strategy chapters are composed', async () => {
    for (const strategy of [null, strategyRecord()]) {
      const docs = await compose({ strategy });
      const fin = headings(docs.financial.markdown);
      expect(fin, `strategy ${strategy ? 'present' : 'absent'}`)
        .toContain('Financial Recommendation & Portfolio Fit');
    }
  });

  it('puts the Holding Strategy before it, which is why 15 was inserted', async () => {
    const fin = headings((await compose({ strategy: strategyRecord() })).financial.markdown);
    expect(fin.indexOf('Holding Strategy')).toBeGreaterThan(-1);
    expect(fin.indexOf('Holding Strategy'))
      .toBeLessThan(fin.indexOf('Financial Recommendation & Portfolio Fit'));
  });

  it('replaces only what the record states better', async () => {
    const docs = await compose({ strategy: strategyRecord() });
    /*
     * A composed chapter legitimately replaces routed prose about the same
     * money. It must not replace the recommendation, which is not a figure —
     * that was the ordinal collision, and `replacedByComposedChapters` named
     * it on every fork.
     */
    expect(docs.replacedByComposedChapters).not.toContain('Financial Recommendation & Portfolio Fit');
  });
});

describe('a fork may lose a heading; it may never lose a body', () => {
  it('keeps every routed body somewhere in the document it was routed to', async () => {
    const docs = await compose({ strategy: strategyRecord() });
    // The checklist goes to both, under each document's own name.
    expect(docs.financial.markdown).toContain(CHECKLIST_ITEM);
    expect(docs.dueDiligence.markdown).toContain(CHECKLIST_ITEM);
    // The appendix is the Financial report's verification page. It used to
    // reach neither, destroyed by the heading collision on the other side.
    expect(docs.financial.markdown).toContain(APPENDIX_SOURCE);
  });

  it('merges two routes that name one slot instead of keeping the longer', async () => {
    const docs = await compose({ strategy: strategyRecord() });
    const fin = headings(docs.financial.markdown);
    const page = 'Assumptions, Verification Items & Adviser Disclaimer';
    // The checklist route and the appendix route both name this section, on
    // purpose. One heading, both bodies.
    expect(fin.filter((h) => h === page)).toHaveLength(1);
    expect(docs.financial.markdown).toContain(CHECKLIST_ITEM);
    expect(docs.financial.markdown).toContain(APPENDIX_SOURCE);
  });

  it('keeps the richer copy when the PARENT wrote one section twice', async () => {
    const short = '## Due Diligence Checklist\n\n- [ ] A single item\n';
    const long = `## Due Diligence Checklist\n\n- [ ] ${CHECKLIST_ITEM}\n- [ ] A second item\n- [ ] A third\n`;
    const docs = await compose({
      parentContent: `# Compass\n\n${short}\n${long}\n`,
      strategy: strategyRecord(),
    });
    const pldd = headings(docs.dueDiligence.markdown);
    // One route, one heading, twice: a repeat, not two sections.
    expect(pldd.filter((h) => h === 'Due Diligence Checklist')).toHaveLength(1);
    expect(docs.dueDiligence.markdown).toContain(CHECKLIST_ITEM);
  });

  it('gives the two documents different content, and neither the other\'s', async () => {
    const docs = await compose({ strategy: strategyRecord() });
    expect(docs.financial.markdown).not.toBe(docs.dueDiligence.markdown);
    // The property risk register row is the Due Diligence report's; the
    // Financial dashboard keeps the money rows. `splitRiskRegister`'s rule.
    expect(docs.dueDiligence.markdown).toContain(RISK_ROW_PROPERTY);
    expect(docs.financial.markdown).not.toContain(RISK_ROW_PROPERTY);
  });

  it('produces the same bytes twice', async () => {
    const a = await compose({ strategy: strategyRecord() });
    const b = await compose({ strategy: strategyRecord() });
    expect(a.dueDiligence.markdown).toBe(b.dueDiligence.markdown);
    expect(a.financial.markdown).toBe(b.financial.markdown);
  });
});
