/**
 * Frozen scoring inputs, reconstructed from issued reports.
 *
 * ## Where these come from
 *
 * The primary case is the Investment Compass issued for **97 Poole Road,
 * Kellyville NSW 2155 on 20 September 2026** — 43 pages, composite 49, grade
 * C, four of five dimensions. Its "What this rests on" pages print every
 * component reading the engine used, which is what makes the run replayable
 * without reading any stored row:
 *
 * ```
 * Capital growth 56 / 100   40%  ->  42%   23.58
 * Location       64 / 100   25%  ->  26%   16.84
 * Rental yield   32 / 100   15%  ->  16%    5.05
 * Demand         21 / 100   15%  ->  16%    3.32
 * Property risk  not assessed
 * Composite 48.79, rounded once -> 49.  Evidence coverage 85%.
 * ```
 *
 * and, component by component:
 *
 * * **Capital growth** — five-year 6.2% p.a.; three-year 4.4% p.a., 1.8 points
 *   behind the five-year; twelve months 6.3%; consistency "3 of 3 periods
 *   rose, period-to-period spread 5.7 points"; −1.4 points against NSW over
 *   the five-year window.
 * * **Location** — walk score 80 of 100, 39 minutes to the CBD, 10 schools
 *   within 3 km.
 * * **Rental yield** — 3.47% gross on a $1,650,000 purchase price
 *   ($1,100/week).
 * * **Demand** — `transactionVolume`: 162 sales in postcode 2155, 29% below
 *   the 3-period average of 228; population growth −0.4% a year in
 *   Kellyville - East. Nothing else was held: the report says in terms that
 *   "no published figure was held for vacancy, days on market, advertised
 *   rent, vendor discount or auction clearance in this market".
 * * **Property risk** — not assessed, insufficient verified evidence.
 *
 * ## What is reconstructed, and what is quoted
 *
 * Every number above is quoted from the issued document. Two inputs are
 * **reconstructed to reproduce a quoted reading**, and they are marked in
 * place:
 *
 * * the price series, because the document prints the consistency component's
 *   own summary ("3 of 3 periods rose, spread 5.7 points") rather than the
 *   four medians behind it. Any series with those two properties yields the
 *   same component score, and `frozenReplay.spec.ts` asserts the reproduced
 *   detail string matches the issued one word for word;
 *   the same for the sales-volume series, where the document prints the
 *   latest count and the baseline it was measured against.
 *
 * Nothing is invented. Where the document says a figure was not held, the
 * evidence key is absent — not zero, not a neutral value.
 *
 * ## The controls
 *
 * `STRONG_CASE`, `WEAK_CASE` and `SPARSE_CASE` are constructed inputs, not
 * markets: they exist so a change to the aggregation can be shown to preserve
 * ordering and to leave a fully evidenced record where it was. They carry the
 * same warning `scoringScenarios.spec.ts` carries — no result from them is a
 * statement about any Australian market.
 */
import {
  emptyEvidence,
  type EvidencePoint,
  type EvidenceSubject,
  type MarketEvidence,
} from '../../../../../supabase/functions/_shared/reports/market/marketEvidence.pure';
import type { ShadowScoreInput } from '../../../../../supabase/functions/_shared/reports/market/shadowScorer.pure';

/** The assessment date the primary report was issued on. */
export const POOLE_ASSESSED_AT = new Date('2026-09-20T00:00:00Z');

const subject = (over: Partial<EvidenceSubject> = {}): EvidenceSubject => ({
  suburb: 'Kellyville', postcode: '2155', state: 'NSW',
  dwellingType: 'house', resolvedFrom: 'coordinate', ...over,
});

const pt = (value: number, o: Partial<EvidencePoint> = {}): EvidencePoint => ({
  value,
  level: 'postcode',
  areaName: 'postcode 2155, NSW',
  dwellingType: 'house',
  dwellingTypeMatched: true,
  provider: 'nsw_dcj',
  asOf: '2026-Q1',
  sampleSize: 162,
  periodsAvailable: 21,
  method: 'observed',
  licensingStatus: 'licensed_for_client_reports',
  sourceNote: null,
  ...o,
} as EvidencePoint);

const seriesOf = <T>(value: T, o: Partial<EvidencePoint> = {}): EvidencePoint<T> =>
  ({ ...pt(0, o), value } as unknown as EvidencePoint<T>);

/**
 * A four-point median series whose three period returns are all positive and
 * whose population standard deviation is 5.7 points — the two properties the
 * issued document states for this report's consistency component.
 *
 * Symmetric returns about a mean of 8.0 with a half-spread `d` give a
 * population stdev of `d * sqrt(2/3)`, so `d = 5.7 / sqrt(2/3)`.
 */
const D = 5.7 / Math.sqrt(2 / 3);
const POOLE_RETURNS = [8 - D, 8, 8 + D] as const;

function pooleSeries(): Array<{ period: string; value: number }> {
  const periods = ['2021-Q1', '2022-Q1', '2023-Q1', '2026-Q1'];
  let v = 1_000_000;
  const out = [{ period: periods[0], value: Math.round(v) }];
  POOLE_RETURNS.forEach((r, i) => {
    v *= 1 + r / 100;
    out.push({ period: periods[i + 1], value: Math.round(v) });
  });
  return out;
}

/**
 * 162 sales in the latest period against a 3-period average of 228 — the two
 * figures the document prints. A flat baseline is the only reconstruction
 * that cannot smuggle in a trend the register did not publish.
 */
const POOLE_VOLUME = [
  { period: '2023-Q1', value: 228 },
  { period: '2024-Q1', value: 228 },
  { period: '2025-Q1', value: 228 },
  { period: '2026-Q1', value: 162 },
];

export function pooleEvidence(): MarketEvidence {
  return {
    ...emptyEvidence(subject()),
    growth5YearCagr: pt(6.2),
    growth3YearCagr: pt(4.4),
    growth1Year: pt(6.3),
    benchmarkGrowth5YearCagr: pt(7.6, {
      level: 'state', areaName: 'NSW (all areas the publisher monitors)',
    }),
    benchmarkGrowth3YearCagr: pt(7.0, { level: 'state', areaName: 'NSW (all areas the publisher monitors)' }),
    benchmarkGrowth1Year: pt(11.0, { level: 'state', areaName: 'NSW (all areas the publisher monitors)' }),
    priceSeries: seriesOf(pooleSeries()),
    salesVolumeSeries: seriesOf(POOLE_VOLUME),
    populationGrowth: pt(-0.368, {
      level: 'sa2', areaName: 'Kellyville - East', provider: 'abs_erp', sampleSize: null,
    }),
    // Deliberately absent, because the report says these were not held:
    // vacancyRate, daysOnMarket, vendorDiscount, auctionClearance, medianRent.
  };
}

/** The frozen engine input for the issued 97 Poole Road Compass. */
export function pooleInput(): ShadowScoreInput {
  return {
    evidence: pooleEvidence(),
    yieldInputs: { basisAmount: 1_650_000, basis: 'purchase', weeklyRent: 1_100 },
    locationInputs: { walkScore: 80, commuteTimeCBD: 39, schoolsNearby: 10 },
    // Not assessed on the issued report: no property-risk question was answered.
    propertyRisk: { propertyType: 'house', answers: {} },
    finance: { lvr: null, weeklyCashFlow: null, purchasePrice: 1_650_000 },
    now: POOLE_ASSESSED_AT,
  };
}

/** What the issued document states, for the replay to assert against. */
export const POOLE_ISSUED = {
  growth: 56,
  location: 64,
  yield: 32,
  demand: 21,
  risk: null,
  compositeExact: 48.79,
  composite: 49,
  grade: 'C',
  evidenceCoverage: 0.845,
  adjustedWeights: { growth: 0.42, location: 0.26, yield: 0.16, demand: 0.16 },
  contributions: { growth: 23.58, location: 16.84, yield: 5.05, demand: 3.32 },
} as const;

// ── Controls ────────────────────────────────────────────────────────────────
// CONSTRUCTED INPUTS, NOT MARKET EVIDENCE. See the header.

const ctl = (value: number, o: Partial<EvidencePoint> = {}): EvidencePoint =>
  pt(value, { areaName: 'Control fixture area', provider: 'domain', ...o });

function steadySeries(rate: number, points = 6): Array<{ period: string; value: number }> {
  let v = 600_000;
  const out = [{ period: '2020-Q2', value: v }];
  for (let i = 0; i < points; i += 1) { v *= 1 + rate / 100; out.push({ period: `${2021 + i}-Q2`, value: Math.round(v) }); }
  return out;
}

function volumeSeries(ratio: number): Array<{ period: string; value: number }> {
  return [
    { period: '2023-Q2', value: 200 },
    { period: '2024-Q2', value: 200 },
    { period: '2025-Q2', value: 200 },
    { period: '2026-Q2', value: Math.round(200 * ratio) },
  ];
}

/** Every dimension measured, every component present, all of them strong. */
export function strongCase(): ShadowScoreInput {
  return {
    evidence: {
      ...emptyEvidence(subject({ suburb: 'Control Strong', postcode: '0001' })),
      growth5YearCagr: ctl(9.5),
      growth3YearCagr: ctl(10.3),
      growth1Year: ctl(11.0),
      benchmarkGrowth5YearCagr: ctl(6.0, { level: 'state', areaName: 'Control benchmark' }),
      priceSeries: seriesOf(steadySeries(9.5)),
      salesVolumeSeries: seriesOf(volumeSeries(1.35)),
      vacancyRate: ctl(0.9),
      daysOnMarket: ctl(18),
      auctionClearance: ctl(78),
      listingActivity: ctl(0.9),
      populationGrowth: ctl(2.6, { level: 'sa2', provider: 'abs_erp' }),
    } as MarketEvidence,
    yieldInputs: { basisAmount: 700_000, basis: 'purchase', weeklyRent: 720 },
    locationInputs: { walkScore: 96, commuteTimeCBD: 18, schoolsNearby: 9 },
    propertyRisk: { propertyType: 'house', answers: {} },
    finance: { lvr: null, weeklyCashFlow: null, purchasePrice: 700_000 },
    now: POOLE_ASSESSED_AT,
  };
}

/** Every dimension measured, every component present, all of them weak. */
export function weakCase(): ShadowScoreInput {
  return {
    evidence: {
      ...emptyEvidence(subject({ suburb: 'Control Weak', postcode: '0002' })),
      growth5YearCagr: ctl(0.4),
      growth3YearCagr: ctl(-1.2),
      growth1Year: ctl(-2.5),
      benchmarkGrowth5YearCagr: ctl(5.0, { level: 'state', areaName: 'Control benchmark' }),
      priceSeries: seriesOf([
        { period: '2020-Q2', value: 400_000 },
        { period: '2021-Q2', value: 452_000 },
        { period: '2022-Q2', value: 404_000 },
        { period: '2023-Q2', value: 441_000 },
        { period: '2024-Q2', value: 398_000 },
        { period: '2025-Q2', value: 412_000 },
      ]),
      salesVolumeSeries: seriesOf(volumeSeries(0.55)),
      vacancyRate: ctl(5.4),
      daysOnMarket: ctl(96),
      auctionClearance: ctl(38),
      listingActivity: ctl(0.22),
      populationGrowth: ctl(-0.6, { level: 'sa2', provider: 'abs_erp' }),
    } as MarketEvidence,
    yieldInputs: { basisAmount: 620_000, basis: 'purchase', weeklyRent: 330 },
    locationInputs: { walkScore: 38, commuteTimeCBD: 72, schoolsNearby: 1 },
    propertyRisk: { propertyType: 'house', answers: {} },
    finance: { lvr: null, weeklyCashFlow: null, purchasePrice: 620_000 },
    now: POOLE_ASSESSED_AT,
  };
}

/**
 * The same STRONG fundamentals as `strongCase`, with Demand reduced to the
 * two components 97 Poole Road actually had.
 *
 * This is the symmetry control: if a thinly evidenced weak Demand is to lose
 * influence, a thinly evidenced strong Demand must lose exactly as much.
 */
export function sparseDemandStrongCase(): ShadowScoreInput {
  const base = strongCase();
  const ev = { ...base.evidence } as Record<string, unknown>;
  delete ev.vacancyRate;
  delete ev.daysOnMarket;
  delete ev.auctionClearance;
  delete ev.listingActivity;
  return { ...base, evidence: ev as unknown as MarketEvidence };
}

/** Thin everywhere: one growth horizon, one location input, no demand primary. */
export function sparseCase(): ShadowScoreInput {
  return {
    evidence: {
      ...emptyEvidence(subject({ suburb: 'Control Sparse', postcode: '0003' })),
      growth5YearCagr: ctl(7.0),
      populationGrowth: ctl(2.0, { level: 'sa2', provider: 'abs_erp' }),
    } as MarketEvidence,
    yieldInputs: { basisAmount: 800_000, basis: 'purchase', weeklyRent: 600 },
    locationInputs: { walkScore: 92, commuteTimeCBD: null, schoolsNearby: null },
    propertyRisk: { propertyType: 'house', answers: {} },
    finance: { lvr: null, weeklyCashFlow: null, purchasePrice: 800_000 },
    now: POOLE_ASSESSED_AT,
  };
}
