/**
 * The five S5 corrections, pinned.
 *
 * Each `describe` is one correction from the approved list, and each test
 * names the sentence or the number that was wrong before it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildMonitorRows,
  buildSwot,
  composeExitOutlook,
  composeHoldingStrategy,
  composeScoreDimensionTable,
  composeSuitability,
  composeSwot,
  readStrategyRecord,
  type StrategyFinance,
  type StrategyRecord,
} from '../investment/strategyPositions.pure';
import {
  buildMarketFacts,
  renderMarketFacts,
  type MarketFactRow,
  type MarketFacts,
} from '../../../../supabase/functions/_shared/reports/market/marketFactBlocks.pure';
import { transportCountReading } from '../../../../supabase/functions/_shared/transportReading.pure';
import { readScoreAssessment } from '../../../../supabase/functions/_shared/reports/market/scoreAssessmentReading.pure';
import { ANNABELLE_SCORE } from './fixtures/storedScores';

const src = (rel: string) => readFileSync(resolve(__dirname, '../../../../', rel), 'utf8');

const row = (key: MarketFactRow['key'], label: string, value: string): MarketFactRow => ({
  key, label, value,
  describes: 'postcode 2155, NSW — houses, 162 sales, 2026-03-31',
  publisher: 'NSW Department of Communities and Justice — Rent and Sales Report',
  note: null, benchmark: false,
});
const market = (rows: MarketFactRow[]): MarketFacts => ({
  rows, withheld: [], unavailable: [], consulted: ['nsw_dcj_rent_sales'],
  anyStated: rows.length > 0, evidenceMissing: false,
});

const FINANCE: StrategyFinance = {
  grossYield: 2.97, netYield: 2.18, weeklyNet: -926, annualNet: -48_166,
  lvr: 80, upfront: 363_537, annualCosts: 14_886,
  loanAmount: 1_192_000, interestRate: 6.5,
  loanStructure: 'Interest only for 5 years, then principal and interest',
  interestOnlyYears: 5, interestOnlyAssumed: true,
  capitalGrowth: 6.2, weeklyRent: 850, occupancyWeeks: 52,
};

const ASSESSMENT = readScoreAssessment(ANNABELLE_SCORE);

const rec = (over: Partial<StrategyRecord> = {}): StrategyRecord => ({
  property: {
    address: '18 Annabelle Crescent, Kellyville NSW 2155',
    propertyType: 'house', landSqm: 765, councilArea: 'THE HILLS SHIRE', parking: 2, bedrooms: 4,
  },
  price: {
    basis: 'accepted_input', value: 1_490_000,
    label: 'Purchase price this analysis is modelled on',
    provenance: 'recorded by the adviser for this assessment',
  },
  market: market([
    row('medianPrice', 'Median sale price', '$1,808,000'),
    row('growth1Year', 'Price growth, 1 year', '6.3%'),
    row('growth3YearCagr', 'Price growth, 3 years (compound annual)', '4.4%'),
    row('growth5YearCagr', 'Price growth, 5 years (compound annual)', '6.2%'),
    row('salesCount', 'Sales in the period', '162'),
  ]),
  finance: FINANCE,
  planning: {
    zone: 'R2 — Low Density Residential', zoneStatus: 'stated',
    zoneSource: 'NSW Planning Portal — Principal Planning Layers (Land Zoning)',
    zoneEffectiveDate: '2026-08-07', council: 'THE HILLS SHIRE',
    verification: 'A s10.7 certificate settles it.', retrievedAt: '2026-09-17T08:58:23.845Z',
  },
  transport: {
    source: 'gtfs', verdict: 'stops_nearby',
    countReading: { count: 117, radiusMetres: 1600, label: '117 boarding places within 1.6 km', radiusAssumed: false },
    nearestKm: 0.1, nearestName: 'Windsor Rd Before President Rd',
    sources: ['Transport for NSW Open Data (CC BY 4.0)'],
    feedLoadedAt: '2026-09-07T05:22:15.603Z', measuredAt: '2026-09-17T08:58:02.529Z',
    notMeasured: ['Mode is not published per stop.'],
  },
  score: {
    grade: 'F', total: 40, gaps: [],
    dimensions: [
      { key: 'growth', label: 'Capital growth', score: 56, nominalPoints: 57, deliveredPoints: 31.92,
        evidence: 'Five-year capital growth: 6.2% per annum over five years.',
        inputs: ['longTerm', 'relative'], excluded: false },
      { key: 'demand', label: 'Demand', score: 13, nominalPoints: 21, deliveredPoints: 2.73,
        evidence: 'Population growth: -0.4% annual population growth in Kellyville - East',
        inputs: ['populationDriver'], excluded: false },
      { key: 'risk', label: 'Property risk', score: null, nominalPoints: 0, deliveredPoints: null,
        evidence: null, inputs: [], excluded: true },
    ],
    coverageLabel: 'Partial score: 3 of 5 dimensions',
    weightCovered: 0.7,
    notAssessed: { risk: 'Not assessed — insufficient verified property-risk evidence is available.' },
    authority: 'v2',
    // Derived by the reader under test from the production row, exactly as
    // `readStrategyRecord` derives it in the generator and the fork.
    assessment: ASSESSMENT,
  },
  ...over,
});

const wholeDocument = (r: StrategyRecord) => [
  composeSwot(r, 'SWOT'),
  composeSuitability(r, 'Suitability'),
  composeHoldingStrategy(r, 'Holding'),
  composeExitOutlook(r, 'Exit'),
].join('\n');

// ─── 1 · CGR is not market evidence ──────────────────────────────────────

describe('correction 1 — the accepted CGR and the observed market rate are separate facts', () => {
  it('never calls the accepted CGR the measured rate, even when they agree', () => {
    // 6.2% is BOTH the accepted assumption and the five-year register figure.
    const doc = wholeDocument(rec());
    expect(doc).not.toMatch(/runs on the measured rate/i);
    expect(doc).not.toMatch(/taken from .{0,80}the measured rate for this market/i);
    expect(doc).toContain('Accepted CGR assumption used by the financial model');
    expect(doc).toContain('Historical market growth observed in the approved register');
    expect(doc).toContain('nothing on this record states that the assumption was derived from the measurement');
  });

  it('states both labels where the two differ', () => {
    const doc = composeHoldingStrategy(
      rec({ finance: { ...FINANCE, capitalGrowth: 3 } }), 'Holding',
    );
    expect(doc).toContain('accepted CGR assumption of 3.0% a year');
    expect(doc).toContain('6.2% a year');
  });

  it('MARKET EVIDENCE CANNOT OVERWRITE THE ACCEPTED CGR, THE CASH FLOW OR THE PROJECTIONS', () => {
    /*
     * The regression the owner asked for. The register says 6.2%; the accepted
     * assumption here says 3.0%. Every modelled figure must follow the
     * ASSUMPTION, and the register figure must appear only under its own
     * label.
     */
    const divergent = rec({ finance: { ...FINANCE, capitalGrowth: 3 } });
    const exit = composeExitOutlook(divergent, 'Exit');
    // 1,490,000 × 1.03^5 = 1,727,318 and ^10 = 2,002,435 — the assumption.
    expect(exit).toContain('$1,727,318');
    expect(exit).toContain('$2,002,435');
    // What 6.2% would have produced must appear nowhere.
    expect(exit).not.toContain('$2,012,838');
    expect(exit).not.toContain('$2,719,139');
    expect(exit).toContain('accepted CGR assumption');
  });

  it('no composer writes to the finance record at all', () => {
    const before = JSON.stringify(FINANCE);
    const r = rec();
    wholeDocument(r);
    buildMonitorRows(r);
    expect(JSON.stringify(r.finance)).toBe(before);
  });

  it('neither caller derives the accepted CGR from a market row', () => {
    for (const file of [
      'supabase/functions/generate-investment-report/index.ts',
      'supabase/functions/fork-investment-report/index.ts',
    ]) {
      const text = src(file);
      expect(text, `${file} assigns capitalGrowth from market evidence`)
        .not.toMatch(/capitalGrowth\s*[:=][^;\n]*(marketFacts|marketEvidence|growth\dYear|subjectRow)/);
    }
  });
});

// ─── 2 · Transport ────────────────────────────────────────────────────────

describe('correction 2 — the transport reading states its own radius', () => {
  it('never says "within one kilometre" over a 1,600 m measurement', () => {
    const doc = composeSwot(rec(), 'SWOT');
    expect(doc).not.toMatch(/within one kilometre/i);
    expect(doc).not.toMatch(/stops within 1 ?km/i);
    expect(doc).toContain('117 boarding places within 1.6 km straight-line');
  });

  it('states the source, the radius, the unit, BOTH dates and the definition', () => {
    const doc = composeSwot(rec(), 'SWOT');
    expect(doc).toContain('Transport for NSW Open Data (CC BY 4.0)');
    expect(doc).toContain('1.6 km');
    expect(doc).toContain("straight-line distance from this property's verified coordinate");
    expect(doc).toContain('a station and its platforms counted as one place');
    // A feed-load date is not a measurement date. The count was taken when the
    // enrichment ran (2026-09-17); the stop file behind it is current as at the
    // publisher's load (2026-09-07). Stating only the second presented the
    // publisher's currency as ours.
    // Both dates, written as a reader writes them (23 Sep 2026: ISO dates
    // left these sections; the two-date rule is unchanged).
    expect(doc).toContain('Counted on 17 Sep 2026');
    expect(doc).toContain('against a stop file last loaded on 7 Sep 2026');
    expect(doc).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(doc).toContain('does not establish mode, service frequency, walking distance or travel time');
  });

  it('never presents the feed-load date as the date the count was taken', () => {
    const doc = composeSwot(rec(), 'SWOT');
    expect(doc).not.toMatch(/the count is as at that date/i);
    expect(doc).not.toMatch(/feed was last loaded on 2026-09-07; the count/i);
  });

  it('says so where the feed currency is not recorded', () => {
    const r = rec();
    const doc = composeSwot(
      { ...r, transport: { ...r.transport, feedLoadedAt: null } }, 'SWOT',
    );
    expect(doc).toContain('When the stop file behind it was loaded is not recorded on this reading');
  });

  it('never calls a station-only register count public transport access', () => {
    const r = rec();
    const doc = composeSwot({
      ...r,
      transport: {
        source: 'osm_amenity_register', verdict: null, countReading: null,
        nearestKm: null, nearestName: null, sources: [], feedLoadedAt: null, measuredAt: null, notMeasured: [],
      },
    }, 'SWOT');
    expect(doc).toContain('not read from an operator');
    expect(doc).toContain('counts one amenity category rather than boarding places');
    expect(doc).not.toMatch(/\bstops within\b/i);
  });

  it('reads the count through transportCountReading, never off the deprecated key', () => {
    // The stored Annabelle block, verbatim in shape.
    const reading = transportCountReading({
      stopsWithin1km: 117, stopsWithinRadius: 117, radiusMetres: 1600,
    });
    expect(reading.count).toBe(117);
    expect(reading.radiusMetres).toBe(1600);
    expect(reading.label).toBe('117 boarding places within 1.6 km');
    expect(src('supabase/functions/_shared/reports/investment/strategyPositions.pure.ts'))
      .not.toMatch(/transport\.stopsWithin1km/);
  });

  it('a legacy row with no radius says the radius was assumed', () => {
    const legacy = transportCountReading({ stopsWithin1km: 12 });
    expect(legacy.radiusAssumed).toBe(true);
    const r = rec();
    expect(composeSwot({ ...r, transport: { ...r.transport, countReading: legacy } }, 'SWOT'))
      .toContain('radius is not recorded on this reading');
  });
});

// ─── 3 · Score language ───────────────────────────────────────────────────

describe('correction 3 — every score statement is fully qualified', () => {
  it('drops the unqualified one-liners from the quadrants', () => {
    const doc = composeSwot(rec(), 'SWOT');
    for (const phrase of [
      'Measured demand in this market is soft',
      'Measured capital growth in this suburb is strong',
      'Below average rental yield may require owner contribution',
    ]) {
      expect(doc, `${phrase} is unqualified and may not be a quadrant entry`).not.toContain(phrase);
    }
  });

  /*
   * The eight readings the owner's instruction names, over the production row.
   *
   * The table this replaced printed the stored `weight` values 57/21/21 as
   * "nominal points" and `coverage.weightCovered` as a share of the nominal
   * points. Both are the same mistake — reading a RENORMALISED figure as a
   * nominal one — and together they hid the fact that the grade was capped.
   */
  it('separates the original nominal weight from the adjusted weight', () => {
    const table = composeScoreDimensionTable(rec())!;
    expect(table).toContain('| Dimension | Score | Original weight | Adjusted weight |');
    // Growth: nominal .40 of the method, adjusted to .40 / .70 = 57%.
    expect(table).toMatch(/\| Capital growth \| 56 \/ 100 \| 40% \| 57% \| 32\.00 \|/);
    // Yield and demand: nominal .15 each, adjusted to .15 / .70 = 21%.
    expect(table).toMatch(/\| Rental yield \| 23 \/ 100 \| 15% \| 21% \|/);
    expect(table).toMatch(/\| Demand \| 13 \/ 100 \| 15% \| 21% \|/);
  });

  it('draws all five dimensions, never only the ones that scored', () => {
    const table = composeScoreDimensionTable(rec())!;
    for (const label of ['Capital growth', 'Location', 'Rental yield', 'Demand', 'Property risk']) {
      expect(table, `${label} must be on the page`).toContain(`| ${label} |`);
    }
    // The unscored two carry their original weight and no contribution.
    expect(table).toContain('| Location | — | 25% | — (not scored) | — |');
    expect(table).toContain('| Property risk | — | 5% | — (not scored) | — |');
    // The evidence is a list under the table, never a seventh column: the
    // growth cell on this record is 600 characters and a print column cannot
    // carry it.
    expect(table).toContain('**What each dimension rested on.**');
    expect(table).not.toContain('| What it rested on |');
  });

  it('states the contributions, the composite and the rounding', () => {
    /*
     * RENEGOTIATED 20 September 2026 — the sentence moved, the claim did not.
     *
     * The wording was asserted verbatim ("rounds once, on that sum") and this
     * function wrote its own copy of it, while `assessmentPrecisionNote`
     * existed for exactly that and had ZERO call sites. The scorecard calls it
     * now, and it has three readings rather than one — because the composite
     * is the RECORD'S figure rather than this module's arithmetic, so a sum
     * drawn from the record's whole-percent weights does not always round to
     * it, and asserting a rounding that does not happen asks a reader to
     * distrust both numbers.
     *
     * Every assertion this test made is kept. What it no longer does is pin
     * one phrasing of the rounding — it asserts the rounding is stated.
     */
    const table = composeScoreDimensionTable(rec())!;
    expect(table).toContain('| 32.00 |');
    expect(table).toContain('| 4.93 |');
    expect(table).toContain('| 2.79 |');
    expect(table).toContain('**Composite score 40.**');
    expect(table).toContain('39.71');
    expect(table).toMatch(/rounded once|rounds once/);
    // …and it is the composite the RECORD holds, not one recomputed here.
    expect(table).toContain('the figure the scoring service recorded');
  });

  /*
   * RENEGOTIATED 18 September 2026 — the ceiling is HISTORY, not the rule.
   *
   * Annabelle's F was issued under the delivered-points ceiling, and that is
   * still exactly why its letter is what it is — so the explanation must keep
   * every figure. What changed is that the prose may no longer state the
   * ceiling as the rule in force: a record graded proportionally would then
   * be explained by a rule never applied to it, and the reader told something
   * false about their own report.
   *
   * This record carries no `publicationPolicyVersion`, so it reads as the
   * superseded methodology and keeps the full arithmetic — now labelled as
   * the method that issued it. `scorePublicationConsumers.spec.ts` asserts
   * the other half: a proportionally graded record draws none of it.
   */
  /*
   * RE-RENEGOTIATED 18 September 2026 — a missing stamp is not evidence.
   *
   * The previous version asserted the delivered-points ceiling arithmetic on
   * this record. That inferred a methodology from the ABSENCE of a stamp,
   * which is exactly what the platform owner ruled out: this fixture is
   * trimmed to the keys its readers named and carries no `policy` block at
   * all, so it genuinely does not say which methodology graded it. A V1
   * `investment-scoring-service` row never had that ceiling.
   *
   * So the reading is `unknown`, and the honest rendering follows: the
   * composite and the uncapped grade are reconstructed from what the record
   * holds, the issued F is reported unchanged, and the difference between
   * them is stated rather than explained by a rule nobody recorded. The
   * ceiling path is exercised in `scorePublicationConsumers.spec.ts` against
   * a record that DOES name scoring-v2.
   */
  it('reports a historical grade unchanged and attributes no rule it cannot show', () => {
    const table = composeScoreDimensionTable(rec())!;
    expect(table).toContain('**Grade the composite alone gives: C.**');
    expect(table).toContain('**Grade issued: F**');
    // The grade itself is untouched — no silent recomputation.
    expect(table).not.toMatch(/Grade issued: [^F]/);
    // No ceiling is asserted, because none is recorded.
    expect(table).not.toContain('Points delivered');
    expect(table).toContain('does not state which scoring methodology issued');
  });

  it('reports coverage as the share of the ORIGINAL weight that was measured', () => {
    const table = composeScoreDimensionTable(rec())!;
    expect(table).toContain('3 of 5 dimensions were scored, carrying 70% of the original weight');
    // …and names what this record does not retain, rather than substituting
    // the coarser figure for the finer one.
    expect(table).toContain('**What this record does not retain.**');
    expect(table).toContain('Evidence coverage');
  });

  it('names the calculation owner', () => {
    const table = composeScoreDimensionTable(rec())!;
    expect(table).toContain("this platform's investment scoring service");
    expect(table).toContain('No figure in this table is re-derived by this report');
  });

  it('gives an unscored dimension its reason, never a low score and never our backlog', () => {
    const table = composeScoreDimensionTable(rec())!;
    expect(table).toContain('Not assessed — insufficient verified property-risk evidence is available.');
    /*
     * This asserted the table CONTAINED "Answered property-risk questions from
     * the per-class schema", and that is the OPERATOR remedy — `GradeGap.remedy`,
     * whose audience is somebody reading the grade-gap card. See §5b of
     * REPORT_PRESENTATION_PROGRAMME.md: that field was being drawn in the
     * client's Compass, carrying `docs/…md` paths, `RF-7.2B` and
     * `market-sales-ingest` onto a customer's page.
     *
     * Two things make this worth keeping as a comment. The fixture
     * (`storedScores.ts`) is a real LEGACY row — written before `readerRemedy`
     * existed — so it is the exact case the fail-closed read is for, and the
     * table now carries the reason alone. And the very literal it asserted is
     * the one `riskRemedyFor`'s own header records as WRONG: it names hazard
     * and planning as outstanding where the planning programme retrieves both,
     * and strata on a house that is never asked about one. The test was
     * vouching for a superseded string reaching a client.
     */
    expect(table).not.toContain('Answered property-risk questions from the per-class schema');
    expect(table).not.toMatch(/\b(deployment|docs\/|market-sales-ingest|RF-\d)\b/);
    expect(table).toContain('the available location information does not meet the current verification standard');
    // The same renegotiation, for the same reason: "Regenerate the report: the
    // location service re-acquires the enrichment with its acquisition stamp
    // (RF-7.2B)" is an instruction to OUR operator, in a client's table.
    expect(table).not.toContain('the location service re-acquires the enrichment');
    expect(table).not.toContain('Regenerate the report');
    expect(table).toContain('A dimension that was not scored is not a low score');
  });

  it('never repeats the engine’s internal “could not be measured” about the area', () => {
    const table = composeScoreDimensionTable(rec())!;
    expect(
      table,
      'the record proves the readings were taken and then removed before persistence',
    ).not.toContain('No location inputs could be measured for this property');
  });

  it('draws no table where nothing scored', () => {
    const r = rec();
    const empty = { ...r, score: { ...r.score, assessment: readScoreAssessment({}) } };
    expect(composeScoreDimensionTable(empty)).toBeNull();
  });

  it('reads the dimensions off the stored breakdown shape', () => {
    const built = readStrategyRecord(
      {
        investmentScore: {
          grade: 'C', totalScore: 63,
          coverage: { partialLabel: 'Partial score: 3 of 5 dimensions', weightCovered: 0.7 },
          breakdown: {
            yieldScore: { score: 45, weight: 21, details: 'Gross yield …', hasData: true, excluded: false, dataPoints: ['propertyPrice'] },
            locationScore: { score: 0, weight: 0, details: 'No location inputs …', hasData: false, excluded: true, dataPoints: [] },
          },
          notAssessed: { location: 'Not assessed — …' },
        },
      },
      { market: market([]), price: rec().price, carriesModelling: true },
    );
    const yieldDim = built.score.dimensions.find((d) => d.key === 'yield')!;
    expect(yieldDim.score).toBe(45);
    expect(yieldDim.nominalPoints).toBe(21);
    expect(yieldDim.deliveredPoints).toBeCloseTo(9.45, 2);
    expect(built.score.dimensions.find((d) => d.key === 'location')!.excluded).toBe(true);
    expect(built.score.coverageLabel).toBe('Partial score: 3 of 5 dimensions');
  });
});

// ─── 4 · Suitability ──────────────────────────────────────────────────────

describe('correction 4 — an evidence window is not a holding requirement', () => {
  it('never turns the series length into a period an investor must hold for', () => {
    const doc = composeSuitability(rec(), 'Suitability');
    expect(doc).not.toMatch(/horizon at least as long as/i);
    expect(doc).not.toMatch(/must hold/i);
    expect(doc).toContain('Awareness that the growth evidence covers 5 years');
    expect(doc).toContain('risk and monitoring consideration about the EVIDENCE');
    expect(doc).toContain('does not establish how long anybody should hold the asset');
  });
});

// ─── 5 · Liquidity and absence ────────────────────────────────────────────

describe('correction 5 — a sales count is not liquidity', () => {
  it('states the count and discloses what was not measured', () => {
    const doc = composeExitOutlook(rec(), 'Exit');
    expect(doc).toContain('162 dwellings settled in the latest published quarter');
    expect(doc).toContain('postcode 2155, NSW — houses');
    expect(doc).toContain('not a measure of liquidity');
    expect(doc).toContain('Days on market, time to sell and buyer depth are not held for this market');
    // 4d — an absence is about the registers THIS report reads, never about
    // what any publisher issues. "No publisher issues them" is a claim about
    // the world that nothing here measured.
    expect(doc).toMatch(/the registers this report reads did not return them/i);
    expect(doc).not.toMatch(/no publisher (issues|publishes)/i);
  });

  it('never calls it buyer depth or a liquidity reading', () => {
    const doc = wholeDocument(rec());
    expect(doc).not.toMatch(/depth of the buyer pool/i);
    expect(doc).not.toMatch(/Resale liquidity — measured/);
    expect(doc).not.toMatch(/tolerance for however long an exit takes/i);
  });

  it('creates no reassurance from an absent register', () => {
    const doc = composeExitOutlook(rec({ market: market([]) }), 'Exit');
    expect(doc).toContain('Nothing is estimated in their place');
    expect(doc).toContain('not evidence that the market is thin, deep, slow or fast');
  });

  it('keeps a provider’s own error out of the client block', () => {
    const facts = buildMarketFacts({
      marketEvidence: {
        points: { subject: {} },
        providersConsulted: ['domain'],
        providersUnavailable: [{
          provider: 'domain',
          reason: 'Operation not permitted on project — no API package is attached to the Domain project this key belongs to',
        }],
      },
    });
    const block = renderMarketFacts(facts);
    expect(block).toContain('Asked and could not answer');
    expect(block).toContain('Domain');
    expect(block).not.toContain('Operation not permitted on project');
    expect(block).not.toMatch(/API package/i);
    expect(block).not.toMatch(/\bkey\b/);
    expect(block).toContain("recorded on this report's evidence record");
    // The reason itself is not lost — it stays on the structured record.
    expect(facts.unavailable[0].reason).toContain('Operation not permitted on project');
  });
});
