/**
 * The five strategy sections: every entry rests on a fact, and nothing here
 * invents a threshold.
 *
 * Three of these tests exist because the first render against production data
 * failed them. They are the record of what rendering found that reading could
 * not.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildMonitorRows,
  buildSwot,
  composeExitOutlook,
  composeHoldingStrategy,
  composeMonitoringPlan,
  composeSuitability,
  composeSwot,
  strategySectionRules,
  type StrategyFinance,
  type StrategyRecord,
} from '../investment/strategyPositions.pure';
import type { MarketFacts, MarketFactRow } from '../../../../supabase/functions/_shared/reports/market/marketFactBlocks.pure';
import type { SubjectPrice } from '../investment/subjectPrice.pure';
import { readScoreAssessment } from '../../../../supabase/functions/_shared/reports/market/scoreAssessmentReading.pure';
import { ANNABELLE_SCORE } from './fixtures/storedScores';

const row = (over: Partial<MarketFactRow> & Pick<MarketFactRow, 'key' | 'label' | 'value'>): MarketFactRow => ({
  describes: 'postcode 2155, NSW — houses, 162 sales, 2026-03-31',
  publisher: 'NSW Department of Communities and Justice — Rent and Sales Report',
  note: null,
  benchmark: false,
  ...over,
});

const market = (rows: MarketFactRow[]): MarketFacts => ({
  rows,
  withheld: [],
  unavailable: [],
  consulted: ['nsw_dcj_rent_sales'],
  anyStated: rows.length > 0,
  evidenceMissing: false,
});

const price: SubjectPrice = {
  basis: 'accepted_input',
  value: 1_490_000,
  label: 'Purchase price this analysis is modelled on',
  provenance: 'recorded by the adviser for this assessment',
};

const finance: StrategyFinance = {
  grossYield: 2.97, netYield: 2.18, weeklyNet: -926, annualNet: -48_166,
  lvr: 80, upfront: 363_537, annualCosts: 14_886,
  loanAmount: 1_192_000, interestRate: 6.5,
  loanStructure: 'Interest only for 5 years (term not recorded; assumed), then principal and interest',
  interestOnlyYears: 5, interestOnlyAssumed: true,
  capitalGrowth: 6.2, weeklyRent: 850, occupancyWeeks: 52,
};

const base = (over: Partial<StrategyRecord> = {}): StrategyRecord => ({
  property: {
    address: '18 Annabelle Crescent, Kellyville NSW 2155',
    propertyType: 'house', landSqm: 765, councilArea: 'THE HILLS SHIRE', parking: 2, bedrooms: null,
  },
  price,
  market: market([
    row({ key: 'medianPrice', label: 'Median sale price', value: '$1,808,000' }),
    row({ key: 'growth1Year', label: 'Price growth, 1 year', value: '6.3%' }),
    row({ key: 'growth3YearCagr', label: 'Price growth, 3 years (compound annual)', value: '4.4%' }),
    row({ key: 'growth5YearCagr', label: 'Price growth, 5 years (compound annual)', value: '6.2%' }),
    row({ key: 'salesCount', label: 'Sales in the period', value: '162' }),
  ]),
  finance,
  planning: {
    zone: 'R2 — Low Density Residential', zoneStatus: 'stated',
    zoneSource: 'NSW Planning Portal — Principal Planning Layers (Land Zoning)',
    zoneEffectiveDate: '2026-08-07', council: 'THE HILLS SHIRE',
    verification: 'A spatial layer is indicative; what settles the question is a s10.7 planning certificate.',
    retrievedAt: '2026-09-17T08:58:23.845Z',
  },
  transport: {
    source: 'gtfs', verdict: 'stops_nearby',
    // What `transportCountReading` returns for the real Annabelle row: the
    // count is within 1,600 m, whatever the stored key is called.
    countReading: { count: 117, radiusMetres: 1600, label: '117 boarding places within 1.6 km', radiusAssumed: false },
    nearestKm: 0.1,
    nearestName: 'Windsor Rd Before President Rd',
    sources: ['Transport for NSW Open Data (CC BY 4.0)'],
    feedLoadedAt: '2026-09-07T05:22:15.603Z',
    measuredAt: '2026-09-17T08:58:02.529Z',
    notMeasured: ['Mode of transport is not published per stop.'],
  },
  score: SCORE,
  ...over,
});

/** The production breakdown for 18 Annabelle Crescent, read 18 Sep 2026. */
const SCORE: StrategyRecord['score'] = {
  grade: 'F', total: 40, gaps: [],
  dimensions: [
    { key: 'growth', label: 'Capital growth', score: 56, nominalPoints: 57, deliveredPoints: 31.92,
      evidence: 'Five-year capital growth: 6.2% per annum over five years.',
      inputs: ['longTerm', 'trajectory', 'momentum', 'consistency', 'relative'], excluded: false },
    { key: 'yield', label: 'Rental yield', score: 23, nominalPoints: 21, deliveredPoints: 4.83,
      evidence: 'Gross yield (on purchase price): 2.97% gross yield on a $1,490,000 purchase price.',
      inputs: ['propertyPrice', 'weeklyRent'], excluded: false },
    { key: 'demand', label: 'Demand', score: 13, nominalPoints: 21, deliveredPoints: 2.73,
      evidence: 'Population growth: -0.4% annual population growth in Kellyville - East',
      inputs: ['populationDriver'], excluded: false },
    { key: 'risk', label: 'Property risk', score: null, nominalPoints: 0, deliveredPoints: null,
      evidence: 'No property-specific risk measurement is available, so there is nothing to score.',
      inputs: [], excluded: true },
    { key: 'location', label: 'Location', score: null, nominalPoints: 0, deliveredPoints: null,
      evidence: 'No location inputs could be measured for this property.', inputs: [], excluded: true },
  ],
  coverageLabel: 'Partial score: 3 of 5 dimensions',
  weightCovered: 0.7,
  notAssessed: {
    risk: 'Not assessed — insufficient verified property-risk evidence is available.',
    location: 'Not assessed — the available location information does not meet the current verification standard.',
  },
  authority: 'v2',
  // Built by the reader under test from the production row itself, so the
  // fixture cannot agree with the composer while the engine disagrees with
  // both. `readStrategyRecord` derives it the same way in production.
  assessment: readScoreAssessment(ANNABELLE_SCORE),
};

describe('the key names are read from the evidence union', () => {
  /*
   * The first render asked for `medianSalePrice`, `salesVolume`,
   * `rentalVacancy` and `auctionClearance`. Every one returned null in silence
   * on a record that held all of them.
   */
  it('finds the median, the sales count and the growth rows the record holds', () => {
    const swot = buildSwot(base());
    const text = JSON.stringify(swot);
    expect(text).toContain('$1,808,000');
    expect(composeExitOutlook(base(), 'Exit')).toContain('162');
  });
});

describe('rule 7 — a threshold nobody published may not produce a rating', () => {
  it('never grades a market thin or liquid from its sales count', () => {
    for (const count of ['3', '162', '668', '5,000']) {
      const rec = base({ market: market([row({ key: 'salesCount', label: 'Sales in the period', value: count })]) });
      const all = [composeSwot(rec, 'S'), composeSuitability(rec, 'S'), composeExitOutlook(rec, 'E')].join('\n');
      expect(all.toLowerCase()).not.toContain('a thin market');
      expect(all.toLowerCase()).not.toContain('a liquid market');
    }
  });

  it('states the one-year and longer-run growth rates side by side without rating the gap', () => {
    const wide = base({
      market: market([
        row({ key: 'growth1Year', label: 'Price growth, 1 year', value: '19.0%' }),
        row({ key: 'growth3YearCagr', label: 'Price growth, 3 years (compound annual)', value: '4.0%' }),
      ]),
    });
    const swot = buildSwot(wide);
    const quadrants = JSON.stringify([swot.strengths, swot.weaknesses, swot.opportunities, swot.threats]);
    expect(quadrants).not.toContain('ran ahead');
    expect(quadrants).not.toContain('ran behind');
    const holding = composeHoldingStrategy(wide, 'Holding');
    expect(holding).toContain('19.0%');
    expect(holding).toContain('4.0%');
    expect(holding).toContain('not graded');
  });
});

describe('rule 2 — an absence is coverage, never a quadrant entry', () => {
  it('puts an unread planning layer in coverage and in no quadrant', () => {
    const rec = base({
      planning: {
        zone: null, zoneStatus: 'not_served', zoneSource: null, zoneEffectiveDate: null,
        council: 'Fraser Coast Regional', verification: null, retrievedAt: null,
      },
    });
    const swot = buildSwot(rec);
    const quadrants = JSON.stringify([swot.strengths, swot.weaknesses, swot.opportunities, swot.threats]);
    expect(quadrants).not.toContain('not_served');
    expect(quadrants).not.toContain('not read from a layer');
    expect(swot.coverage.join(' ')).toContain('not read from a layer');
  });

  it('never reports a property outside every loaded transport feed as poorly served', () => {
    const rec = base({
      transport: { source: 'gtfs', verdict: 'outside_loaded_networks', countReading: null, nearestKm: null, nearestName: null, sources: [], feedLoadedAt: null,
 measuredAt: null, notMeasured: [] },
    });
    const swot = buildSwot(rec);
    const quadrants = JSON.stringify([swot.strengths, swot.weaknesses, swot.opportunities, swot.threats]);
    expect(quadrants).not.toContain('transport');
    expect(swot.coverage.join(' ')).toContain('outside every transport network loaded');
  });

  it('names an empty quadrant as a statement about the record, never as a clearance', () => {
    const bare = base({
      market: market([]), finance: null,
      score: { grade: null, total: null, gaps: [], dimensions: [], coverageLabel: null, weightCovered: null, notAssessed: {}, authority: null, assessment: null },
      planning: { zone: null, zoneStatus: null, zoneSource: null, zoneEffectiveDate: null, council: null, verification: null, retrievedAt: null },
      transport: { source: null, verdict: null, countReading: null, nearestKm: null, nearestName: null, sources: [], feedLoadedAt: null,
 measuredAt: null, notMeasured: [] },
    });
    const text = composeSwot(bare, 'SWOT');
    expect(text).toContain('a statement about what was examined, not a clearance');
    expect(text).not.toMatch(/\bno risks?\b/i);
    expect(text).not.toMatch(/\bclear\b/i);
  });
});

describe('rule 3 — the modelling travels only where the tier carries it', () => {
  /*
   * `2.97%` is deliberately NOT in this list.
   *
   * The approved allocation permits the Compass "one authorised gross-yield
   * reference within the grade rationale, if required" — and the grade
   * rationale is the score-dimension table, where the yield dimension carries
   * 21 of the score's 100 nominal points. Dropping the row would misstate the
   * score; stating it anywhere else would breach the allocation. The test
   * below pins exactly that: once, and only in the table.
   */
  const NUMERIC_FINANCE = [/\$363,537/, /\$926 a week/, /2\.18% net/, /\$1,192,000/, /80% lending/];

  it('permits exactly one gross-yield reference on the Compass, inside the grade rationale', () => {
    const doc = composeSwot(base({ finance: null }), 'SWOT');
    const hits = doc.match(/2\.97%/g) ?? [];
    expect(hits, 'the allocation permits one gross-yield reference, not several').toHaveLength(1);
    const table = doc.indexOf('How this grade was reached');
    expect(table, 'the grade rationale table must be present').toBeGreaterThan(-1);
    expect(doc.indexOf('2.97%')).toBeGreaterThan(table);
  });

  it('states no yield, cash position, loan or equity figure where finance is null', () => {
    const rec = base({ finance: null });
    const doc = [
      composeSwot(rec, 'SWOT'),
      composeSuitability(rec, 'Suitability'),
      composeHoldingStrategy(rec, 'Holding'),
      composeExitOutlook(rec, 'Exit'),
      composeMonitoringPlan(rec, 'Monitoring'),
    ].join('\n');
    for (const re of NUMERIC_FINANCE) expect(doc).not.toMatch(re);
  });

  it('adds the prohibition to the pinned rules where finance is null, and not otherwise', () => {
    expect(strategySectionRules(base({ finance: null }))).toContain('does not carry the analysis of a purchase');
    expect(strategySectionRules(base())).not.toContain('does not carry the analysis of a purchase');
  });

  it('still carries the price and the market median where the modelling does not travel', () => {
    const doc = composeSwot(base({ finance: null }), 'SWOT');
    expect(doc).toContain('$1,490,000');
    expect(doc).toContain('$1,808,000');
  });

  it('opens the holding strategy on a base case even where finance is null', () => {
    const doc = composeHoldingStrategy(base({ finance: null }), 'Holding');
    expect(doc.indexOf('The base case and what holds it')).toBeLessThan(doc.indexOf('What would break it'));
  });
});

describe('rule 4 — suitability states a requirement, never a person', () => {
  const FORBIDDEN = [/suits you/i, /ideal for/i, /we recommend/i, /you should/i, /right for/i, /perfect for/i];

  it('makes no statement about any investor', () => {
    for (const rec of [base(), base({ finance: null })]) {
      const doc = composeSuitability(rec, 'Suitability');
      for (const re of FORBIDDEN) expect(doc).not.toMatch(re);
    }
  });

  it('says the match is not assessed and that nothing in it is advice', () => {
    const doc = composeSuitability(base(), 'Suitability');
    expect(doc).toContain('is not assessed here');
    expect(doc).toContain('Nothing above is personal advice');
  });
});

describe('rule 5 — liquidity is measured, equity is modelled', () => {
  it('labels the year-five and year-ten figures as the projection and not a valuation', () => {
    const doc = composeExitOutlook(base(), 'Exit');
    expect(doc).toContain('projection, not measurement');
    expect(doc).toContain('is not a valuation, an appraisal or a forecast');
  });

  it('compounds from the recorded price at the recorded rate', () => {
    const doc = composeExitOutlook(base(), 'Exit');
    // 1,490,000 × 1.062^5 and ^10, grouped by hand.
    expect(doc).toContain('$2,012,838');
    expect(doc).toContain('$2,719,139');
  });

  it('never states an equity figure where the modelling does not travel', () => {
    const doc = composeExitOutlook(base({ finance: null }), 'Exit');
    expect(doc).toContain('belongs to the Financial Analysis Report');
    expect(doc).not.toMatch(/\$2,012,838/);
  });
});

describe('rule 6 — monitoring names the register and promises nothing', () => {
  it('says plainly that nothing on this platform watches on the reader’s behalf', () => {
    expect(composeMonitoringPlan(base(), 'Monitoring')).toContain('watches these on your behalf');
  });

  it('gives every row a register, a cadence and what a different answer would mean', () => {
    for (const r of buildMonitorRows(base())) {
      expect(r.register.length).toBeGreaterThan(3);
      expect(r.cadence.length).toBeGreaterThan(3);
      expect(r.changesIf.length).toBeGreaterThan(20);
    }
  });

  it('prints the median’s own figure in the "as read" column, not its geography', () => {
    const median = buildMonitorRows(base()).find((r) => r.what.includes('median'));
    expect(median?.lastRead).toContain('$1,808,000');
  });

  it('turns an unread planning layer into a first check rather than a re-check', () => {
    const rows = buildMonitorRows(base({
      planning: { zone: null, zoneStatus: 'not_served', zoneSource: null, zoneEffectiveDate: null, council: 'Fraser Coast Regional', verification: null, retrievedAt: null },
    }));
    const planning = rows.find((r) => r.what.includes('planning'));
    expect(planning?.changesIf).toContain('not a re-check but a first check');
  });
});

describe('the recorded loan is read as recorded', () => {
  it('raises the step-up only where an interest-only term was assumed', () => {
    const explicitPandI: StrategyFinance = {
      ...finance, interestOnlyYears: 0, interestOnlyAssumed: false,
      loanStructure: 'Principal and interest over 30 years',
    };
    const doc = composeHoldingStrategy(base({ finance: explicitPandI }), 'Holding');
    expect(doc).not.toContain('the interest-only term ends');
    expect(composeHoldingStrategy(base(), 'Holding')).toContain('the interest-only term ends');
  });

  it('computes the gearing multiple rather than hard-coding one ratio', () => {
    const at90 = buildSwot(base({ finance: { ...finance, lvr: 90 } })).threats.map((t) => t.claim).join(' ');
    expect(at90).toContain('10 times faster');
    const at80 = buildSwot(base()).threats.map((t) => t.claim).join(' ');
    expect(at80).toContain('5 times faster');
  });
});

describe('the article agrees with the number it introduces', () => {
  it('writes "an 84% rise" and "a 109% rise"', () => {
    const eightyFour: StrategyFinance = { ...finance, weeklyRent: 500, weeklyNet: -419 };
    expect(composeHoldingStrategy(base({ finance: eightyFour }), 'H')).toContain('an 84% rise');
    expect(composeHoldingStrategy(base(), 'H')).toContain('a 109% rise');
  });
});

describe('something renders them', () => {
  /*
   * `builderPortalUiMounted.spec.ts`'s rule, in a different part of the tree: a
   * composer is not shipped until something calls it. The Builder Portal
   * shipped three components with zero call sites — written, documented,
   * merged and deployed, with nothing rendering them — and an unused export
   * typechecks, lints and builds.
   */
  const read = (rel: string) =>
    readFileSync(resolve(__dirname, '../../../../', rel), 'utf8');

  it('the generator composes them and appends them to the document', () => {
    const src = read('supabase/functions/generate-investment-report/index.ts');
    expect(src).toContain('composeStrategySections');
    expect(src).toContain('readStrategyRecord');
    expect(src).toContain('strategySectionsMarkdown');
    // Appended, not merely built.
    expect(src).toMatch(/reportContent \+= .*strategySectionsMarkdown/s);
  });

  it('the generator composes the Compass copy without the modelling', () => {
    const src = read('supabase/functions/generate-investment-report/index.ts');
    expect(src).toContain('carriesModelling: false');
    expect(src).not.toContain('carriesModelling: true');
  });

  it('the generator records the market evidence the fork reads back', () => {
    const src = read('supabase/functions/generate-investment-report/index.ts');
    expect(src).toContain('marketEvidence: enhancedData.marketEvidence');
  });

  it('the fork composes them with the modelling, from the recorded evidence', () => {
    const src = read('supabase/functions/fork-investment-report/index.ts');
    expect(src).toContain('readStrategyRecord');
    expect(src).toContain('carriesModelling: true');
    expect(src).toContain('data_sources');
    expect(src).toContain('marketEvidence');
  });

  it('the fork composer places them at the split registry’s own ordinals', () => {
    const src = read('supabase/functions/_shared/reports/investment/forkSplit.pure.ts');
    expect(src).toContain('composeStrategySections');
    expect(src).toContain('finSectionOrder.find');
  });

  it('the split registry carries a Holding Strategy section for them to land in', () => {
    const src = read('supabase/functions/_shared/reportSplitRegistry.ts');
    expect(src).toContain("heading: 'Holding Strategy'");
  });
});

describe('the monitoring plan is blocks, not a five-column table', () => {
  /*
   * Page 36 of the 9 Hollow Street Compass, verbatim from the PDF's own text
   * layer — a five-column table whose fifth column is a paragraph:
   *
   *     What to re-Where it isHow often itAs read for this
   *     What a different answer would mean
   *     checkpublishedchangesreport
   *     The market'svic_vpsr_suburbQuarterly, on$567,500 —A median that moves…
   */
  const plan = () => composeMonitoringPlan(base(), 'Monitoring & Review Plan');

  it('draws no table at all', () => {
    expect(plan()).not.toContain('| What to re-check |');
    expect(plan().split('\n').filter((l) => l.trim().startsWith('|'))).toEqual([]);
  });

  it('leads every dependency with its own name', () => {
    const rows = buildMonitorRows(base());
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(plan()).toContain(`**${r.what}**`);
  });

  it('prints every cell it used to — register, cadence, reading and consequence', () => {
    const out = plan();
    for (const r of buildMonitorRows(base())) {
      expect(out).toContain(r.register);
      expect(out).toContain(r.cadence);
      expect(out).toContain(r.changesIf);
      if (r.lastRead && r.lastRead !== '—') expect(out).toContain(r.lastRead);
    }
  });

  it('omits the reading rather than printing a dash for it', () => {
    // `stripPlaceholderRows`' rule: an absence is omitted, never worded.
    const rows = buildMonitorRows(base());
    if (rows.some((r) => r.lastRead === '—')) {
      expect(plan()).not.toContain('As read for this report: —');
    }
    expect(plan()).not.toMatch(/As read for this report:\s*$/m);
  });

  it('keeps the promise it exists to make', () => {
    expect(plan()).toContain('watches these on your behalf');
    expect(plan()).toContain('this report does not set one');
  });
});
