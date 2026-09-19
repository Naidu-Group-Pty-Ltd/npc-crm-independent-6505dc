/**
 * The Property Comparison projection.
 *
 * The fixtures are shaped exactly like the two storage shapes that coexist in
 * `property_comparisons`, both stamped `structure_version = 1`, and the counts
 * quoted below were measured across all 50 stored rows:
 *
 *  - **Shape A, 23 rows.** The seven jsonb columns populated. A superlative is
 *    `{propertyNumber, reason}` and sometimes `value`; a recommendation is
 *    `{propertyNumber, reason}`; a ranking element is `{propertyNumber, rank,
 *    finalScore, address, primaryStrengths[], primaryConcerns[],
 *    bestSuitedFor}`.
 *  - **Shape B, 27 rows.** All seven columns NULL, with the model's raw
 *    response — truncated mid-token on every one of them — in
 *    `executive_summary`.
 *
 * What is asserted here is the projection's contract, not the normaliser's:
 * `normalise.spec.ts` and `salvage.spec.ts` already cover the reading. These
 * tests exist because a restatement can still lose or mislabel what it was
 * given, and two of the things it must not lose are easy to get wrong in ways
 * no render would reveal — a score without its denominator, and a winner
 * pointer that names nobody.
 */
import { describe, it, expect } from 'vitest';
import {
  projectComparison,
  applyComparisonProjection,
  NO_WINNER,
} from '../../../../supabase/functions/_shared/comparisonProjection.pure';
import { getAdapter, supportsProduction } from '../adapters';

const NOW = '2026-08-13T00:00:00.000Z';

function ranking(n: number, rank: number, score: number, address: string) {
  return {
    propertyNumber: n,
    rank,
    finalScore: score,
    address,
    primaryStrengths: [`strength ${n}a`, `strength ${n}b`],
    primaryConcerns: [`concern ${n}`],
    bestSuitedFor: `investor type ${n}`,
  };
}

/** Shape A — the seven columns populated. */
const ROW_A = {
  id: 'cmp-1',
  property_count: 3,
  property_addresses: ['1 Alpha Street, Ashgrove', '2 Beta Road, Bardon', '3 Gamma Way, Chermside'],
  // De-duplicated, not per-property: `property_states` is the list of states
  // INVOLVED, so a three-property comparison inside one state stores one entry.
  // 19 of the 50 stored rows leave it null, and the normaliser aligns a state
  // onto a property only when every property shares one.
  property_states: ['QLD'],
  report_title: 'COMPARISON ANALYSIS - 3 PROPERTIES, QLD',
  report_ids: ['r1', 'r2', 'r3'],
  structure_version: 1,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-02T00:00:00.000Z',
  analysis_depth: 'comprehensive',
  investor_profile: 'growth',
  model_used: 'sonar-pro',
  analysis_summary: '{"timeHorizon":"5-7 years","riskTolerance":"moderate","customWeights":null}',
  executive_summary: 'Three properties compared across inner-north Brisbane. '.repeat(20),
  rankings: [
    ranking(2, 1, 88.5, '2 Beta Road, Bardon'),
    ranking(1, 2, 74, '1 Alpha Street, Ashgrove'),
    ranking(3, 3, 61.5, '3 Gamma Way, Chermside'),
  ],
  financial_comparison: {
    bestROI: { propertyNumber: 2, reason: 'Highest modelled return on the entry price.', value: '6.4%' },
    bestYield: { propertyNumber: 1, reason: 'Strongest gross yield of the three.', value: '4.9%' },
    bestCashFlow: { propertyNumber: 2, reason: 'Only one of the three that is positive from year one.' },
    // 15 of 253 stored pointers are 0 and 28 are null: the analysis considered
    // the axis and named nobody.
    bestValue: { propertyNumber: 0, reason: 'No property is clearly under the market.' },
  },
  location_comparison: {
    bestSchools: { propertyNumber: 3, reason: 'Two state schools inside the catchment.' },
    bestGrowthCorridor: { propertyNumber: 2, reason: 'Inside the declared growth corridor.' },
    bestInfrastructure: { propertyNumber: 2, reason: 'Rail upgrade committed and funded.' },
    bestLifestyle: { propertyNumber: null, reason: 'All three are comparable on amenity.' },
  },
  risk_comparison: {
    lowestRisk: { propertyNumber: 1, reason: 'Established street, long tenancy history.' },
    highestRisk: { propertyNumber: 3, reason: 'Flood overlay on the rear third of the lot.' },
    bestRiskReward: { propertyNumber: 2, reason: 'Growth exposure without the overlay.' },
    riskLevels: [
      { propertyNumber: 1, riskLevel: 'Low', specificRisks: ['Ageing kitchen'] },
      { propertyNumber: 2, riskLevel: 'Moderate', specificRisks: ['Body corporate sinking fund'] },
      { propertyNumber: 3, riskLevel: 'High', specificRisks: ['Flood overlay', 'Single access road'] },
    ],
  },
  investor_matches: [
    { propertyNumber: 2, investorTypes: ['Growth', 'Long hold'], reasoning: 'Suits a ten-year horizon.' },
    { propertyNumber: 1, investorTypes: ['Income'], reasoning: 'Yield now, growth later.' },
  ],
  recommendations: {
    bestOverall: { propertyNumber: 2, reason: 'Wins on four of the eleven axes and loses none badly.' },
    runners: [{ propertyNumber: 1, reason: 'Cheaper entry, thinner growth.' }],
    avoid: [{ propertyNumber: 3, reason: 'The overlay is not compensated by the price.' }],
    alternativeScenarios: [
      { scenario: 'If the budget lifts by $100k', reason: 'Property 2 remains the pick.', propertyNumber: 2 },
    ],
  },
  red_flags: [
    { propertyNumber: 3, severity: 'High', concerns: ['Flood overlay', 'Single access road'] },
  ],
};

describe('the projection restates the normalised model', () => {
  const p = projectComparison({ row: ROW_A, clientName: 'Example Client', notes: [], now: NOW });

  it('carries every property, in propertyNumber order', () => {
    expect(p.properties).toHaveLength(3);
    expect(p.properties.map((x) => x.number)).toEqual([1, 2, 3]);
    expect(p.properties[0].address).toBe('1 Alpha Street, Ashgrove');
    expect(p.properties[0].state).toBe('QLD');
  });

  it('ranks best first and keeps the score WITH its denominator', () => {
    // `finalScore` is on two scales across the table — 17 comparisons score
    // 0-100 and 6 score 0-10, the 0-10 group running to the most recent row. A
    // bare "8.5" means two different things, so the projection never publishes
    // one without `outOf` beside it.
    expect(p.ranked[0].address).toBe('2 Beta Road, Bardon');
    expect(p.ranked[0].rank).toBe(1);
    expect(p.ranked[0].score).toBe(88.5);
    expect(p.ranked[0].outOf).toBe(100);
    expect(p.comparison.scaleOutOf).toBe(100);
    for (const r of p.ranked) {
      if (r.score !== undefined) expect(r.outOf, String(r.address)).toBeDefined();
    }
  });

  it('detects the ten-point scale rather than assuming a hundred', () => {
    const tenPoint = projectComparison({
      row: {
        ...ROW_A,
        rankings: [ranking(1, 1, 9.2, 'a'), ranking(2, 2, 7.4, 'b'), ranking(3, 3, 4.1, 'c')],
      },
      now: NOW,
    });
    expect(tenPoint.comparison.scaleOutOf).toBe(10);
    expect(tenPoint.ranked[0].score).toBe(9.2);
  });

  it('says "no clear winner" instead of pointing at a property that was never named', () => {
    // A `propertyNumber` of 0 or null is a real answer, and 43 of the 253
    // stored pointers are one. `properties[n - 1]` on a 0 reads index -1.
    const money = p.axes.money as { winners: Array<Record<string, unknown>> };
    const bestValue = money.winners.find((w) => w.key === 'bestValue');
    expect(bestValue?.winner).toBe(NO_WINNER);
    expect(bestValue?.property).toBeUndefined();

    const place = p.axes.place as { winners: Array<Record<string, unknown>> };
    const lifestyle = place.winners.find((w) => w.key === 'bestLifestyle');
    expect(lifestyle?.winner).toBe(NO_WINNER);

    // And where one IS named, the address is the one the pointer points at.
    const roi = money.winners.find((w) => w.key === 'bestROI');
    expect(roi?.winner).toContain('Beta');
    expect(roi?.value).toBe('6.4%');
  });

  it('groups the axes rather than flattening them', () => {
    // `money`, `place`, `risk` — the normaliser's own group ids.
    expect(Object.keys(p.axes).sort()).toEqual(['money', 'place', 'risk']);
    expect((p.axes.risk as { winners: unknown[] }).winners).toHaveLength(3);
  });

  it('carries the risk verdicts, red flags and investor matches', () => {
    expect(p.risks).toHaveLength(3);
    expect(p.risks[2].level).toBe('High');
    expect(p.risks[2].specificRisks).toEqual(['Flood overlay', 'Single access road']);

    expect(p.redFlags).toHaveLength(1);
    expect(p.redFlags[0].severity).toBe('High');

    expect(p.matches).toHaveLength(2);
    // A template has one line for the list and cannot join an array itself.
    expect(p.matches[0].investorTypesLine).toBe('Growth · Long hold');
  });

  it('names the recommendation, its runners and what to avoid', () => {
    const recs = p.recommendations as Record<string, any>;
    expect(recs.bestOverall.winner).toBe('2 Beta Road, Bardon');
    expect(recs.bestOverall.reason).toContain('four of the eleven axes');
    expect(recs.runners).toHaveLength(1);
    expect(recs.avoid[0].winner).toBe('3 Gamma Way, Chermside');
    expect(recs.alternativeScenarios[0].scenario).toContain('budget lifts');
    expect(recs.alternativeScenarios[0].reason).toContain('remains the pick');
  });

  it('publishes the basis, which no comparison document has ever stated', () => {
    // `analysis_summary` holds a settings blob on 44 of 50 rows and is not a
    // summary at all. It is the only record of the assumptions behind the
    // ranking, so the format states them.
    expect(p.basis.timeHorizon).toBe('5-7 years');
    expect(p.basis.riskTolerance).toBe('moderate');
    expect(p.basis.depth).toBe('comprehensive');
    expect(p.basis.model).toBe('sonar-pro');
  });
});

describe('a truncated record', () => {
  /**
   * Shape B: all seven columns NULL, the model's raw response in
   * `executive_summary`, cut off mid-token. 27 of the 50 stored rows.
   */
  const raw = JSON.stringify({
    executiveSummary: 'Two properties compared in Brisbane.',
    rankings: [ranking(1, 1, 82, '1 Alpha Street, Ashgrove'), ranking(2, 2, 70, '2 Beta Road, Bardon')],
    financialComparison: {
      bestROI: { propertyNumber: 1, reason: 'Higher modelled return.' },
    },
    recommendations: { bestOverall: { propertyNumber: 1, reason: 'Wins on entry price.' } },
  });

  const ROW_B = {
    id: 'cmp-2',
    property_count: 2,
    property_addresses: ['1 Alpha Street, Ashgrove', '2 Beta Road, Bardon'],
    property_states: ['QLD'],
    report_ids: ['r1', 'r2'],
    structure_version: 1,
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:00.000Z',
    rankings: null,
    financial_comparison: null,
    location_comparison: null,
    risk_comparison: null,
    investor_matches: null,
    recommendations: null,
    red_flags: null,
    // Cut mid-token, exactly as the producer stored it.
    executive_summary: raw.slice(0, raw.length - 60),
  };

  it('reads back what survived the cut', () => {
    const p = projectComparison({ row: ROW_B, now: NOW });
    expect(p.ranked.length).toBeGreaterThan(0);
    expect(p.ranked[0].address).toContain('Alpha');
    expect(p.comparison.shape).toBe('salvaged');
  });

  it('never publishes a half-written ranking row', () => {
    // The rule that makes salvage safe: a section is recorded only after its
    // terminator is seen, so an array cut mid-element is never recorded at all.
    // A ranking with an address and no score, printed as though it were whole,
    // is the failure this prevents.
    let cutsWithRankings = 0;
    for (let cut = 40; cut < raw.length; cut += 7) {
      let p;
      try {
        p = projectComparison({ row: { ...ROW_B, executive_summary: raw.slice(0, cut) }, now: NOW });
      } catch {
        // Cut so early that no section reached its terminator. Refusing is the
        // contract — the alternative is a document built from a fragment.
        continue;
      }
      if (p.ranked.length) cutsWithRankings += 1;
      for (const r of p.ranked) {
        expect(typeof r.address, `cut at ${cut}`).toBe('string');
        expect(String(r.address).length, `cut at ${cut}`).toBeGreaterThan(0);
        // A ranking that reached the output has its whole element, never an
        // address with the score still missing.
        expect(r.rank, `cut at ${cut}`).toBeDefined();
      }
    }
    // The loop has to actually exercise the path it claims to.
    expect(cutsWithRankings).toBeGreaterThan(0);
  });

  it('publishes the two sections only a damaged record carries', () => {
    /*
     * `marketTiming` and `competitiveAdvantages` have no column: the writer
     * that destructures a successful response drops them, and only the salvage
     * path reads them back — 23 and 10 of the 27 stored salvaged rows. The
     * projection's header claimed they were published from the start; the code
     * dropped both until the binding audit compared it against the payload.
     */
    const richRaw = JSON.stringify({
      executiveSummary: 'Two properties compared in Brisbane.',
      rankings: [ranking(1, 1, 82, '1 Alpha Street, Ashgrove'), ranking(2, 2, 70, '2 Beta Road, Bardon')],
      marketTiming: {
        buyFirst: { propertyNumber: 1, reason: 'Momentum favours acting on Ashgrove now.' },
        holdingPeriods: [
          { propertyNumber: 1, recommendedPeriod: '7-10 years', reason: 'Growth case needs a full cycle.' },
          { propertyNumber: 2, recommendedPeriod: '5+ years', reason: 'Yield carries the hold.' },
        ],
      },
      competitiveAdvantages: [
        { propertyNumber: 1, advantages: ['Corner block', 'Walk score 91'] },
        { propertyNumber: 2, advantages: ['Newer build'] },
      ],
      recommendations: { bestOverall: { propertyNumber: 1, reason: 'Wins on entry price.' } },
    });
    const p = projectComparison({
      row: { ...ROW_B, executive_summary: richRaw.slice(0, richRaw.length - 40) },
      now: NOW,
    });
    const timing = p.comparison.timing as Record<string, any>;
    expect(timing.buyFirstWinner).toContain('Alpha');
    expect(timing.buyFirstReason).toContain('Momentum');
    expect(timing.holds).toHaveLength(2);
    expect(timing.holds[0]).toMatchObject({ period: '7-10 years', reason: 'Growth case needs a full cycle.' });
    const advantages = p.comparison.advantages as Array<Record<string, any>>;
    expect(advantages).toHaveLength(2);
    expect(advantages[0].line).toBe('Corner block · Walk score 91');
    expect(advantages[0].winner).toContain('Alpha');
  });

  it('composes the truncation note in the legacy callout sentences', () => {
    // On a salvaged row `recommendations` is absent on all but two of the 27 —
    // the verdict page shows this note in the pick's place, so a missing
    // recommendation reads as "the response was cut off", never as a blank
    // display-size heading.
    const p = projectComparison({ row: ROW_B, now: NOW });
    const note = String(p.comparison.truncationNote);
    expect(p.comparison.truncated).toBe(true);
    expect(note).toContain('The analysis was cut short while it was being written');
    expect(note).toContain('read back');
    expect(note).toContain('Re-running the comparison would produce them.');
    // A whole sentence names what was never written, in the legacy's labels.
    expect(note).toMatch(/never written: .*the final recommendation/);
  });

  it('publishes none of the salvage vocabulary for an intact record', () => {
    const p = projectComparison({ row: ROW_A, clientName: 'Example Client', now: NOW });
    expect(p.comparison.timing).toBeUndefined();
    expect(p.comparison.advantages).toBeUndefined();
    expect(p.comparison.truncated).toBeUndefined();
    expect(p.comparison.truncationNote).toBeUndefined();
  });
});

describe('applying it to a binding context', () => {
  it('nests the whole format under `comparison`, and merges rather than replaces', () => {
    const data: Record<string, any> = {
      report: { id: 'cmp-1', type: 'comparison' },
      client: { email: 'someone@example.com' },
      comparison: { keptFromBefore: true },
      analysis: ROW_A,
    };
    applyComparisonProjection(data, { row: ROW_A, clientName: 'Example Client', notes: [], now: NOW });

    expect(data.report.id).toBe('cmp-1');
    expect(data.client.email).toBe('someone@example.com');
    expect(data.client.name).toBe('Example Client');
    expect(data.comparison.keptFromBefore).toBe(true);
    expect(data.analysis.property_count).toBe(3);

    // Nested, because `risks`, `recommendations` and `properties` already mean
    // three other things to the voice and Portfolio templates and the preview
    // sample is one shared object. `client` and `report` stay ambient.
    expect(data.comparison.ranked).toHaveLength(3);
    expect(data.comparison.properties).toHaveLength(3);
    expect(data.comparison.risks).toHaveLength(3);
    expect(Object.keys(data.comparison.axes).sort()).toEqual(['money', 'place', 'risk']);
    expect(data.comparison.recommendations.bestOverall.winner).toContain('Beta');
    expect(data.comparison.basis.timeHorizon).toBe('5-7 years');
    expect(data.ranked).toBeUndefined();
    expect(data.risks).toBeUndefined();
    expect(data.properties).toBeUndefined();
  });
});

describe('the adapter registry', () => {
  it('treats comparison as a production report type', () => {
    expect(supportsProduction('comparison')).toBe(true);
    expect(getAdapter('comparison')?.legacyFallback?.reason).toBeTruthy();
  });
});
