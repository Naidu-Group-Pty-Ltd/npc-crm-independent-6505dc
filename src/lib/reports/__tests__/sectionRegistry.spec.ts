/**
 * Phase 2 of the tier framework — law 3, enforced.
 *
 * *One registry is the constitution. Structure is selected by section id, never
 * by matching heading strings; a declared section with no producer fails CI.*
 *
 * The registry (`sectionRegistry.pure.ts`) is the declaration. This file is the
 * half that makes it worth something, and it exists because the six definitions
 * it replaces were never checked against anything:
 *
 *  - FIN declared 16 sections and two of them — `10-Year Cashflow, Equity &
 *    Growth Projection` and `Financial Investment Scorecard` — had never
 *    appeared in one of the 11 financial reports ever produced;
 *  - PLDD declared 17 and six consecutive ones, `Planning, Zoning and Title Due
 *    Diligence` among them, appear on 1 of 11 — on the tier whose whole promise
 *    is due diligence;
 *  - `TIER_CONFIG[*].sections` was read by nothing, and the snapshot's copy
 *    disagreed with the guide sitting beside it in the same object literal.
 *
 * So every check below resolves a declaration against something that runs:
 * a composer is invoked and its output inspected, an authored section must be
 * named in the prompt that asks for it, a routed one must exist at that ordinal
 * in the split registry, and a projection namespace must be one the projection
 * actually merges. The first draft of the registry named two namespaces
 * (`keyFigures.*`, `sources.*`) that do not exist; this is the test that said so.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  markdownHeadingsForTier,
  mergesForTier,
  normaliseHeading,
  PRODUCER_GAPS,
  REPORT_TIERS,
  SECTION_IDS,
  SECTION_REGISTRY,
  sectionIdForHeading,
  sectionsForTier,
  spineForTier,
  type ReportTier,
  type SectionId,
  type TierPlacement,
} from '../investment/sectionRegistry.pure';
import {
  composeFinancialChapters,
  composeFinancialSnapshotSection,
} from '../investment/financialChapters.pure';
import {
  composeScoreBreakdownSection,
  composeScoreDimensionsSection,
  composeSwotSection,
  composeVerdictSection,
} from '../investment/scoreSections.pure';
import {
  FIN_SECTION_ORDER,
  PLDD_SECTION_ORDER,
} from '../../../../supabase/functions/_shared/reportSplitRegistry';
import { compassSections } from '../../../../supabase/functions/_shared/compassSectionRegistry';
import {
  composeExitOutlook,
  composeHoldingStrategy,
  composeMonitoringPlan,
  composeStrategicRead,
  composeSuitability,
  composeSwot,
  type StrategyRecord,
} from '../investment/strategyPositions.pure';

const REPO = resolve(__dirname, '../../../..');
const readFile = (p: string) => readFileSync(resolve(REPO, p), 'utf8');
const read = (p: string) => (p === FORK ? `${readFile(FORK)}\n${readFile(FORK_SPLIT)}` : readFile(p));

const CONDENSE = 'supabase/functions/condense-investment-report/index.ts';
/**
 * The fork is two files: the handler and the composition it calls.
 *
 * `forkSplit.pure.ts` holds the routing, the section contracts, the composed
 * chapters and the hygiene pass, which used to be 257 lines of `index.ts`. A
 * rule about what the fork DOES is satisfied by either, so `read(FORK)`
 * returns both — which also means the next move cannot silently pass.
 */
const FORK = 'supabase/functions/fork-investment-report/index.ts';
const FORK_SPLIT = 'supabase/functions/_shared/reports/investment/forkSplit.pure.ts';
const PROJECTION = 'supabase/functions/_shared/reportBindingProjection.pure.ts';

/** Every (section, tier) placement in the registry, flattened. */
const placements: Array<{ id: SectionId; tier: ReportTier; placement: TierPlacement }> =
  SECTION_REGISTRY.flatMap((definition) =>
    (Object.entries(definition.tiers) as Array<[ReportTier, TierPlacement]>).map(
      ([tier, placement]) => ({ id: definition.id, tier, placement }),
    ),
  );

// ---------------------------------------------------------------------------
// The declaration is well-formed
// ---------------------------------------------------------------------------

describe('the registry is internally coherent', () => {
  it('declares each id exactly once, and SECTION_IDS is the whole set', () => {
    const declared = SECTION_REGISTRY.map((s) => s.id);
    expect(new Set(declared).size).toBe(declared.length);
    expect([...declared].sort()).toEqual([...SECTION_IDS].sort());
  });

  it('orders every drawn section, and never ties two within a tier', () => {
    for (const tier of REPORT_TIERS) {
      const drawn = sectionsForTier(tier);
      expect(drawn.length, `${tier} draws nothing`).toBeGreaterThan(0);
      const orders = drawn.map((s) => s.order);
      expect(new Set(orders).size, `${tier} has a tied order: ${orders.join()}`).toBe(orders.length);
      for (const s of drawn) {
        expect(s.placement.order, `${tier}/${s.id} has no order`).toBeTypeOf('number');
      }
    }
  });

  it('gives every markdown section a heading, and never gives one to a document section', () => {
    for (const { id, tier, placement } of placements) {
      if (placement.depth === 'merged') continue;
      const surface = placement.surface ?? 'markdown';
      if (surface === 'markdown') {
        // A markdown section with no label would be drawn under its canonical
        // name in a tier that renames it — silently, and differently from the
        // producer that writes the heading.
        expect(placement.label, `${tier}/${id} is markdown with no label`).toBeTruthy();
      } else {
        expect(placement.label, `${tier}/${id} is drawn by the template but declares a heading`).toBeUndefined();
      }
    }
  });

  it('merges only into a section the same tier actually draws', () => {
    for (const tier of REPORT_TIERS) {
      const drawn = new Set(sectionsForTier(tier).map((s) => s.id));
      for (const { id, into } of mergesForTier(tier)) {
        // A merge into a merged or excluded section is content with nowhere to
        // go: the Compass's planning content is inside Risk Dashboard, and if
        // Risk Dashboard were itself merged the substance would have no heading
        // on the document at all.
        expect(drawn.has(into), `${tier}/${id} merges into ${into}, which ${tier} does not draw`).toBe(true);
      }
    }
  });

  it('a merged placement carries no order, no label and no producer', () => {
    for (const { id, tier, placement } of placements) {
      if (placement.depth !== 'merged') continue;
      expect(placement.mergedInto, `${tier}/${id} is merged into nothing`).toBeTruthy();
      expect(placement.order, `${tier}/${id} is merged but ordered`).toBeUndefined();
      expect(placement.label, `${tier}/${id} is merged but labelled`).toBeUndefined();
      expect(placement.producer, `${tier}/${id} is merged but claims a producer`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// The spine
// ---------------------------------------------------------------------------

describe('the spine is mandatory in every tier', () => {
  const SPINE: SectionId[] = ['identity', 'verdict', 'propertyIdentity', 'keyFigures', 'provenance'];

  it('is exactly the framework\'s five sections', () => {
    const spineIds = new Set(
      SECTION_REGISTRY.filter((s) => Object.values(s.tiers).some((p) => p.depth === 'spine')).map((s) => s.id),
    );
    expect([...spineIds].sort()).toEqual([...SPINE].sort());
  });

  it('every tier carries all five, and none of them is optional or merged', () => {
    for (const tier of REPORT_TIERS) {
      const ids = spineForTier(tier).map((s) => s.id).sort();
      expect(ids, `${tier} is missing a spine section`).toEqual([...SPINE].sort());
    }
  });
});

// ---------------------------------------------------------------------------
// Producibility — the half that makes a declaration cost something
// ---------------------------------------------------------------------------

// A production-shaped record, the same one the Phase 1 pins use, so a composer
// that stops emitting a chapter fails here rather than being reported as an
// absent section that is "allowed to be absent".
const FIN = {
  initialCosts: {
    propertyValue: 550_000, deposit: 110_000, stampDuty: 20_000, lmi: 0,
    legalFees: 1_500, inspectionFees: 600, totalUpfront: 132_100,
  },
  annualCosts: {
    councilRates: 2_000, waterRates: 1_100, landlordInsurance: 2_200,
    propertyManagement: 1_716, propertyManagementPercent: 5.5,
    maintenance: 2_600, lettingFees: 550,
  },
  income: { weeklyRent: 600 },
  loanDetails: {
    loanAmount: 440_000, lvr: 80, loanType: 'interest_only', interestRate: 6.5,
    monthlyPayment: 2_383, weeklyPayment: 550, totalInterest: 214_470,
  },
  keyMetrics: {
    lvr: 80, annualNet: -7_562, weeklyNet: -145, totalInvestment: 132_100,
    cashOnCashReturn: -5.72, grossRentalYield: 5.67, netRentalYield: 4.1,
  },
  sensitivityAnalysis: {
    rentChanges: { minus10Percent: -10_682, plus10Percent: -4_442, plus20Percent: -1_322 },
    interestRateChanges: { minus1Percent: -3_162, plus1Percent: -11_962, plus2Percent: -16_362 },
  },
  projections: {
    moderate: [1, 3, 5, 7, 10].map((year) => ({
      year,
      propertyValue: 550_000 + year * 30_000,
      annualRent: 31_200 + year * 900,
      cashFlow: -7_562 + year * 400,
      cumulativeCashFlow: -7_562 * year,
      equity: 110_000 + year * 30_000,
      loanBalance: 440_000,
    })),
  },
  assumptions: { capitalGrowth: 6, cpiGrowth: 3, occupancyWeeks: 52 },
};

/**
 * A record with every input the strategy composers read, so a declaration that
 * names one of them is checked by RUNNING it — the same standard the financial
 * chapters and the score sections answer to a few lines below.
 */
const STRATEGY: StrategyRecord = {
  property: {
    address: '18 Annabelle Crescent, Kellyville NSW 2155',
    propertyType: 'house', landSqm: 765, councilArea: 'THE HILLS SHIRE', parking: 2, bedrooms: 4,
  },
  price: {
    basis: 'accepted_input', value: 1_490_000,
    label: 'Purchase price this analysis is modelled on',
    provenance: 'recorded by the adviser for this assessment',
  },
  market: {
    rows: ([
      ['medianPrice', 'Median sale price', '$1,808,000'],
      ['growth1Year', 'Price growth, 1 year', '6.3%'],
      ['growth3YearCagr', 'Price growth, 3 years (compound annual)', '4.4%'],
      ['growth5YearCagr', 'Price growth, 5 years (compound annual)', '6.2%'],
      ['priceSeries', 'Median price series', '4 periods, 2021-03 to 2026-03'],
      ['salesCount', 'Sales in the period', '162'],
    ] as const).map(([key, label, value]) => ({
      key, label, value,
      describes: 'postcode 2155, NSW — houses, 162 sales, 2026-03-31',
      publisher: 'NSW Department of Communities and Justice — Rent and Sales Report',
      note: null, benchmark: false,
    })),
    withheld: [], unavailable: [], consulted: ['nsw_dcj_rent_sales'],
    anyStated: true, evidenceMissing: false,
  },
  finance: {
    grossYield: 2.97, netYield: 2.18, weeklyNet: -926, annualNet: -48_166,
    lvr: 80, upfront: 363_537, annualCosts: 14_886,
    loanAmount: 1_192_000, interestRate: 6.5,
    loanStructure: 'Interest only for 5 years (term not recorded; assumed), then principal and interest',
    interestOnlyYears: 5, interestOnlyAssumed: true,
    capitalGrowth: 6.2, weeklyRent: 850, occupancyWeeks: 52,
  },
  planning: {
    zone: 'R2 — Low Density Residential', zoneStatus: 'stated',
    zoneSource: 'NSW Planning Portal — Principal Planning Layers (Land Zoning)',
    zoneEffectiveDate: '2026-08-07', council: 'THE HILLS SHIRE',
    verification: 'A spatial layer is indicative; a s10.7 certificate settles it.',
    retrievedAt: '2026-09-17T08:58:23.845Z',
  },
  transport: {
    source: 'gtfs', verdict: 'stops_nearby',
    countReading: { count: 117, radiusMetres: 1600, label: '117 boarding places within 1.6 km', radiusAssumed: false },
    nearestKm: 0.1, nearestName: 'Windsor Rd Before President Rd',
    sources: ['Transport for NSW Open Data (CC BY 4.0)'],
    feedLoadedAt: '2026-09-07T05:22:15.603Z', measuredAt: '2026-09-17T08:58:02.529Z',
    notMeasured: ['Mode of transport is not published per stop.'],
  },
  score: {
    grade: 'F', total: 40, gaps: [],
    dimensions: [
      { key: 'growth', label: 'Capital growth', score: 56, nominalPoints: 57, deliveredPoints: 31.92,
        evidence: 'Five-year capital growth: 6.2% per annum over five years.',
        inputs: ['longTerm'], excluded: false },
      { key: 'risk', label: 'Property risk', score: null, nominalPoints: 0, deliveredPoints: null,
        evidence: null, inputs: [], excluded: true },
    ],
    coverageLabel: 'Partial score: 3 of 5 dimensions',
    weightCovered: 0.7,
    notAssessed: { risk: 'Not assessed — insufficient verified property-risk evidence is available.' },
    authority: null,
    assessment: null,
  },
};

const STRATEGY_COMPOSERS: Record<string, (rec: StrategyRecord, heading: string) => string> = {
  composeSwot, composeSuitability, composeHoldingStrategy, composeExitOutlook, composeMonitoringPlan,
  composeStrategicRead,
};

const SCORE = {
  grade: 'B', totalScore: 62,
  recommendation: 'HOLD/BUY - Moderate investment potential',
  breakdown: {
    riskScore: { score: 75, weight: 11, hasData: true },
    yieldScore: { score: 65, weight: 33, hasData: true },
    locationScore: { score: 60, weight: 30, hasData: true },
  },
  strengths: ['High walkability'], weaknesses: ['Negative cashflow'],
  opportunities: ['Rezoning under review'], risks: ['Rate sensitivity'],
};

/** The chapters `composeFinancialChapters` can actually produce from a full record. */
const composedChapters = composeFinancialChapters(
  { financialCalculations: FIN, investmentScore: SCORE },
  { scenarios: 'all' },
);

/** The `structureGuide` template literal for one condense tier. */
function structureGuide(tier: 'briefing' | 'snapshot' | 'financial'): string {
  const src = read(CONDENSE);
  const tierAt = src.indexOf(`\n  ${tier}: {`);
  expect(tierAt, `TIER_CONFIG has no ${tier}`).toBeGreaterThan(-1);
  const open = src.indexOf('structureGuide: `', tierAt);
  expect(open, `${tier} has no structureGuide`).toBeGreaterThan(-1);
  const from = open + 'structureGuide: `'.length;
  const close = src.indexOf('`', from);
  expect(close, `${tier}'s structureGuide is unterminated`).toBeGreaterThan(from);
  return src.slice(from, close);
}

const GUIDES: Record<string, () => string> = {
  'condense.briefing': () => structureGuide('briefing'),
  'condense.snapshot': () => structureGuide('snapshot'),
};

/** Namespaces `applyInvestmentProjection` merges onto the binding context. */
const projectionNamespaces = (() => {
  const src = read(PROJECTION);
  const body = src.slice(src.indexOf('export function applyInvestmentProjection'));
  const names = new Set<string>();
  for (const m of body.matchAll(/merge\('([a-zA-Z]+)'/g)) names.add(m[1]);
  for (const m of body.matchAll(/data\.([a-zA-Z]+) = /g)) names.add(m[1]);
  return names;
})();

describe('every declared section names a producer that resolves', () => {
  it('the projection really merges the namespaces the registry names', () => {
    // Sanity: if this set were empty the namespace check below would pass
    // vacuously, which is how a resolution test becomes decorative.
    expect(projectionNamespaces.size).toBeGreaterThan(4);
    expect(projectionNamespaces.has('property')).toBe(true);
    expect(projectionNamespaces.has('financials')).toBe(true);
  });

  it('no spine or required placement is missing a producer outside the frozen list', () => {
    const gaps = placements
      .filter(({ placement }) => placement.depth === 'spine' || placement.depth === 'required')
      .filter(({ placement }) => placement.producer === null)
      .map(({ tier, id }) => `${tier}:${id}`)
      .sort();
    expect(gaps).toEqual([...PRODUCER_GAPS].sort());
  });

  it('the frozen gap list carries nothing that is no longer a gap', () => {
    const live = new Set(
      placements
        .filter(({ placement }) => (placement.depth === 'spine' || placement.depth === 'required') && placement.producer === null)
        .map(({ tier, id }) => `${tier}:${id}`),
    );
    for (const entry of PRODUCER_GAPS) {
      expect(live.has(entry), `${entry} is in PRODUCER_GAPS but is no longer a gap — delete the line`).toBe(true);
    }
  });

  it.each(
    placements
      .filter(({ placement }) => placement.producer !== null)
      .map(({ id, tier, placement }) => [`${tier}/${id}`, tier, id, placement] as const),
  )('%s', (_name, tier, id, placement) => {
    const producer = placement.producer!;
    const label = placement.label;

    if (producer.kind === 'composed') {
      const [, ref] = producer.ref.split('#');
      if (producer.ref.startsWith('financialChapters') && /^\d+$/.test(ref)) {
        // Run it. A declared ordinal that the composer never emits from a full
        // record is a section the tier promises and nothing writes.
        const chapter = composedChapters.find((c) => c.ordinal === Number(ref));
        expect(chapter, `composeFinancialChapters emits no ordinal ${ref}`).toBeTruthy();
        expect(chapter!.heading).toBe(label);
        expect(chapter!.markdown.startsWith(`## ${label}`)).toBe(true);
      } else if (producer.ref.startsWith('financialChapters')) {
        // A named composer in the same module — the Snapshot's one financial
        // table, which is not one of the Financial tier's numbered chapters.
        const fn = ref === 'composeFinancialSnapshotSection'
          ? composeFinancialSnapshotSection
          : null;
        expect(fn, `financialChapters has no export ${ref}`).toBeTruthy();
        const markdown = fn!(FIN, label!);
        expect(markdown, `${ref} produced nothing from a full record`).toBeTruthy();
        expect(markdown!.startsWith(`## ${label}`)).toBe(true);
      } else if (producer.ref.startsWith('scoreSections')) {
        const fn = ref === 'composeScoreBreakdownSection'
          ? composeScoreBreakdownSection
          : ref === 'composeSwotSection'
            ? composeSwotSection
            : ref === 'composeVerdictSection'
              ? composeVerdictSection
              : ref === 'composeScoreDimensionsSection'
                ? composeScoreDimensionsSection
                : null;
        expect(fn, `scoreSections has no export ${ref}`).toBeTruthy();
        const markdown = fn!(SCORE, label!);
        expect(markdown, `${ref} produced nothing from a full score`).toBeTruthy();
        expect(markdown!.startsWith(`## ${label}`)).toBe(true);
      } else if (producer.ref.startsWith('strategyPositions')) {
        /*
         * Run it, for the reason the financial chapters are run: a composer
         * that returns nothing from a full record is a section the tier
         * promises and no reader ever sees. The Compass placements are run
         * with `finance: null` as well, because that is the shape the tier
         * actually hands them and a composer that only works with the
         * modelling would draw a heading over nothing there.
         */
        const fn = STRATEGY_COMPOSERS[ref];
        expect(fn, `strategyPositions has no export ${ref}`).toBeTruthy();
        const carriesModelling = tier === 'financial' || tier === 'briefing';
        const record = carriesModelling ? STRATEGY : { ...STRATEGY, finance: null };
        const markdown = fn!(record, label!);
        expect(markdown, `${ref} produced nothing from a full record on ${tier}`).toBeTruthy();
        expect(markdown.startsWith(`## ${label}`)).toBe(true);
        // A heading with nothing under it is the defect this catches.
        expect(markdown.split('\n').filter((l) => l.trim()).length).toBeGreaterThan(3);
      } else {
        // The fork writes its disclaimer directly; assert the heading is really
        // in the source that claims to write it.
        const [file] = producer.ref.split('#');
        expect(read(file)).toContain(`## ${label}`);
      }
      return;
    }

    if (producer.kind === 'authored') {
      if (producer.ref === 'generator.compass') {
        const names = compassSections().map((s) => normaliseHeading(s.name));
        expect(names, `the Compass registry has no section called "${label}"`)
          .toContain(normaliseHeading(label!));
        return;
      }
      // An authored section whose prompt never names it is a section nobody
      // will write — which is exactly how the briefing came to carry the
      // parent's structure on 21 of 21 documents.
      const guide = GUIDES[producer.ref];
      expect(guide, `unknown authoring guide ${producer.ref}`).toBeTruthy();
      expect(guide!(), `${producer.ref} never asks for "## ${label}"`).toContain(`## ${label}`);
      return;
    }

    if (producer.kind === 'routed') {
      const [, ordinal] = producer.ref.split('#');
      const order = producer.ref.includes('dueDiligence') ? PLDD_SECTION_ORDER : FIN_SECTION_ORDER;
      const entry = order.find((e) => e.ordinal === Number(ordinal));
      expect(entry, `${producer.ref} names an ordinal the split registry does not have`).toBeTruthy();
      expect(normaliseHeading(entry!.heading)).toBe(normaliseHeading(label!));
      return;
    }

    // projection
    const namespace = producer.ref.split('.')[0];
    expect(
      projectionNamespaces.has(namespace),
      `${tier}/${id} is drawn from projection namespace "${namespace}", which applyInvestmentProjection does not merge`,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The other definitions are subordinate to this one
// ---------------------------------------------------------------------------

describe('the competing definitions are expressible in registry ids', () => {
  it('every FIN section is a registry placement on the financial tier, at the same heading', () => {
    const financial = new Map(sectionsForTier('financial').map((s) => [normaliseHeading(s.label), s]));
    for (const { heading } of FIN_SECTION_ORDER) {
      const id = sectionIdForHeading(heading);
      expect(id, `FIN heading "${heading}" belongs to no registry section`).toBeTruthy();
      expect(
        financial.has(normaliseHeading(heading)),
        `FIN declares "${heading}" but the financial tier does not draw it`,
      ).toBe(true);
    }
  });

  it('every PLDD section is a registry placement on the strategic tier, at the same heading', () => {
    const strategic = new Map(sectionsForTier('strategic').map((s) => [normaliseHeading(s.label), s]));
    for (const { heading } of PLDD_SECTION_ORDER) {
      const id = sectionIdForHeading(heading);
      expect(id, `PLDD heading "${heading}" belongs to no registry section`).toBeTruthy();
      expect(
        strategic.has(normaliseHeading(heading)),
        `PLDD declares "${heading}" but the strategic tier does not draw it`,
      ).toBe(true);
    }
  });

  it('every Compass section is a registry placement on the compass tier', () => {
    const compass = new Set(sectionsForTier('compass').map((s) => normaliseHeading(s.label)));
    for (const s of compassSections()) {
      expect(
        compass.has(normaliseHeading(s.name)),
        `the Compass registry declares "${s.name}" and the compass tier does not draw it`,
      ).toBe(true);
    }
  });

  it('the snapshot guide asks for exactly its authored headings, in order', () => {
    // This used to compare the guide against EVERY declared heading, because
    // the snapshot composed nothing and the two lists were the same list. Three
    // of its nine sections are composed from the record now — `Investment
    // Score`, `Score Breakdown` and `Financial Snapshot` — so the contract is
    // the briefing's: the guide asks for the authored ones and no others.
    //
    // The "no others" half is what matters. A guide that still asked for a
    // composed heading would get the model's version written, kept by the trim
    // (it is declared), and then replaced during assembly — or, if the ids ever
    // drifted, printed twice with different figures in each copy.
    const guide = structureGuide('snapshot');
    const asked = [...guide.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => normaliseHeading(m[1]));
    const declared = sectionsForTier('snapshot')
      .filter((s) => s.surface === 'markdown' && s.placement.producer?.kind === 'authored')
      .map((s) => normaliseHeading(s.label));
    expect(asked).toEqual(declared);
  });

  it('the snapshot composes its three numeric sections from the record', () => {
    // The Snapshot was the only member of the family composing nothing, while
    // four of its nine authored sections were numeric. `Key Market Stats` stays
    // authored on purpose: median price, vacancy rate, days on market and walk
    // score are not in `financial_calculations`, so composing it would mean
    // inventing a source.
    const composed = sectionsForTier('snapshot')
      .filter((s) => s.placement.producer?.kind === 'composed')
      .map((s) => s.id);
    expect(composed).toEqual(['verdict', 'scorecard', 'financialSnapshot']);
    expect(
      sectionsForTier('snapshot').find((s) => s.id === 'marketStats')?.placement.producer?.kind,
    ).toBe('authored');
  });

  it('the briefing guide asks for exactly its authored headings, in order', () => {
    const guide = structureGuide('briefing');
    const asked = [...guide.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => normaliseHeading(m[1]));
    const declared = sectionsForTier('briefing')
      .filter((s) => s.surface === 'markdown' && s.placement.producer?.kind === 'authored')
      .map((s) => normaliseHeading(s.label));
    expect(asked).toEqual(declared);
  });

  it('the briefing\'s composed chapters are the registry\'s composed placements', () => {
    const declared = sectionsForTier('briefing')
      .filter((s) => s.placement.producer?.kind === 'composed')
      .map((s) => s.label)
      .sort();
    const produced = [
      ...composedChapters.map((c) => c.heading),
      'Investment Score Breakdown',
      'SWOT Analysis',
    ];
    for (const label of declared) {
      expect(produced, `the briefing declares "${label}" and nothing composes it`).toContain(label);
    }
  });
});

// ---------------------------------------------------------------------------
// Heading resolution — what Phase 3 will assemble with
// ---------------------------------------------------------------------------

describe('a heading resolves to one section, however production spelled it', () => {
  it('strips the decorations the corpus actually carries', () => {
    expect(normaliseHeading('1. Location Overview')).toBe('location overview');
    expect(normaliseHeading('⚖️ PROFESSIONAL DISCLAIMER')).toBe('professional disclaimer');
    expect(normaliseHeading('Market Commentary:')).toBe('market commentary');
    expect(normaliseHeading('10. 10-Year Projection Scenarios')).toBe('10-year projection scenarios');
    expect(normaliseHeading('  Risk   Dashboard ')).toBe('risk dashboard');
  });

  it.each([
    // Sampled from the corpus by report count, across every tier and engine.
    ['Location Overview', 'locationCase'],
    ['1. Location Overview', 'locationCase'],
    ['Demographics & Demand Drivers', 'population'],
    ['Current Market Performance (Q3/Q4 2025)', 'marketPosition'],
    ['Historical Price Growth Table', 'marketPosition'],
    ['Property-Level Information', 'propertyIdentity'],
    ['Property Summary', 'propertyIdentity'],
    ['Core Property Facts & Physical Profile', 'propertyIdentity'],
    ['Client Investment Decision Summary', 'verdict'],
    ['Executive Verdict', 'verdict'],
    ['Investment Score', 'verdict'],
    ['Score Breakdown (simplified)', 'scorecard'],
    ['Overall Investment Score', 'scorecard'],
    ['Purchase & Ongoing Costs', 'purchaseHolding'],
    ['Loan Analysis (P&I and Interest-Only)', 'loan'],
    ['Sensitivity Analysis', 'sensitivity'],
    ['Cumulative Cashflow Projections', 'tenYear'],
    ['SWOT Analysis', 'swot'],
    ['Crime Statistics', 'environmentalRisk'],
    ['Environmental Risks', 'environmentalRisk'],
    ['Transport & Accessibility', 'transport'],
    ['Healthcare & Shopping', 'amenityAccess'],
    ['Education Facilities', 'education'],
    ['Major Industries & Job Growth', 'employment'],
    ['Population & Household Characteristics', 'population'],
    ['Planning, Zoning and Title Due Diligence', 'planning'],
    ['⚖️ PROFESSIONAL DISCLAIMER', 'provenance'],
    ['Market Data Sources', 'provenance'],
    ['Base Assumptions', 'assumptions'],
    ['Quick Recommendation', 'recommendation'],
    ['Top 3 Opportunities', 'opportunities'],
    ['Top 3 Risks', 'risks'],
    ['Key Market Stats', 'marketStats'],
    ['Financial Snapshot', 'financialSnapshot'],
  ] as Array<[string, SectionId]>)('%s → %s', (heading, id) => {
    expect(sectionIdForHeading(heading)).toBe(id);
  });

  it('answers null rather than guessing', () => {
    expect(sectionIdForHeading('📞 CONTACT US')).toBeNull();
    expect(sectionIdForHeading('')).toBeNull();
    expect(sectionIdForHeading('Something nobody ever wrote')).toBeNull();
  });
});
