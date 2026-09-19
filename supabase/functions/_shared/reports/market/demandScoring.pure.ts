/**
 * ME-3 — the deterministic Market Demand methodology.
 *
 * Reads {@link MarketEvidence} and nothing else, on the same terms as
 * {@link scoreGrowth}: same evidence in, same score out, every component
 * showable to a client beside the measurement it came from.
 *
 * ## What this exists to fix
 *
 * Growth was a placeholder on 975 of 992 reports (§46). Demand is worse, and
 * the measurement is unambiguous. Across the 999 scored reports on 2026-09-08:
 *
 * ```
 * demandScore.score   = 50     on 999 of 999   (100.0%)
 * demandScore.hasData = false  on 999 of 999
 * demandScore.details = ""     on 999 of 999
 * ```
 *
 * Not "mostly a placeholder" — the base score of `50`, never once moved by any
 * evidence, on every report the platform has ever produced, holding 15% of the
 * composite weight and saying nothing at all about why.
 *
 * Every one of its four inputs fails, and each fails for its own reason:
 *
 * | input | the scorer reads | what the record holds | reports |
 * | --- | --- | --- | ---: |
 * | `vacancyRate` | `marketData.vacancyRate` | no `marketData` key exists | 0 of 1,201 |
 * | `daysOnMarket` | `marketData.daysOnMarket` | ditto | 0 of 1,201 |
 * | `medianSuburbPrice` | `marketData.medianPrice` | ditto | 0 of 1,201 |
 * | `unemploymentRate` | `demographics.unemploymentRate` | `demographics.income.unemploymentRate`, as a **string** | 865 unreachable |
 *
 * The last one is the instructive one, twice over. It is a container error —
 * the value is one level down from where the reader looks, so a real number is
 * invisible — and **849 of those 865 carry the identical value `"3.5"`**,
 * stamped `source: "ABS Census 2021 estimates"`. Repairing the path would have
 * moved Demand from one flat constant to another, and attributed it to the ABS
 * on the way. A dimension can be wired correctly and still be worthless.
 *
 * That is the argument for going through {@link MarketEvidence} rather than
 * repairing the reader: a constant cannot pass as a measurement here, because
 * every point has to name its provider, geography, period and sample size.
 *
 * ## Measuring one characteristic once
 *
 * Three inputs to the live property composite are scored in two of its
 * dimensions each, and the second site says so in its own words:
 *
 * | input | scored in | and again in | which calls it |
 * | --- | --- | --- | --- |
 * | `vacancyRate` | `calculateDemandScore:835` | `calculateRiskScore:1016` | *"weak rental **demand**"* |
 * | `daysOnMarket` | `calculateDemandScore:861` | `calculateRiskScore:1036` | *"indicates weak **demand**"* |
 * | `populationGrowth` | — | `calculateGrowthScore:736` | *"population growth driving **demand**"* |
 *
 * Risk deducts up to 22 points for a vacancy rate Demand has already scored,
 * naming the characteristic as demand while doing it; and Growth adds 10
 * points for population growth on the stated grounds that it drives demand,
 * inside the dimension that measures capital growth.
 *
 * So this module states what it owns and what it refuses, and
 * {@link DEMAND_EXCLUSIONS} makes the refusal checkable rather than a promise
 * in a comment. Two boundaries are worth naming:
 *
 * **Demand is not Growth.** Price movement is Growth's, at every horizon. A
 * suburb where prices rose is not thereby in demand *as well* — that is the
 * same fact counted twice, and it is how a strong market comes to look
 * exceptional on two dimensions for one reason. Population growth is the
 * exception, and only because it is a **driver**: it says people are arriving,
 * not that values rose, which is the distinction `MarketEvidence` already
 * carries on the field itself.
 *
 * **Demand is not Yield.** Yield measures the rent LEVEL against the price.
 * Vacancy measures whether the property lets at all. A 6% yield in a suburb
 * with 7% vacancy is a different proposition from a 6% yield at 0.8%, and
 * collapsing them loses precisely that.
 *
 * ## The four components
 *
 * | component | weight | measures |
 * | --- | ---: | --- |
 * | rental tightness | 0.35 | can it be let, and how quickly |
 * | sale urgency | 0.35 | how hard buyers compete for stock |
 * | absorption | 0.15 | turnover against stock on the market |
 * | population driver | 0.15 | whether the resident base is growing |
 *
 * Sale urgency takes three readings — days on market, vendor discount, auction
 * clearance — and **blends them into one component rather than scoring three**.
 * They are three lenses on a single characteristic, and giving each its own
 * weight would charge for it three times in the same dimension the module
 * exists to stop charging twice across dimensions.
 *
 * As in Growth: weights renormalise over what was measured, a missing
 * component is excluded rather than scored 0 or 50, and the score is `null`
 * when nothing could be computed. The two places a 50 appears — 3.0% vacancy
 * and a 60% clearance rate — are *measurements* of a balanced market, which is
 * a real finding, and they are stated rather than avoided.
 */

import {
  type EvidencePoint,
  type MarketEvidence,
  levelRank,
  licensingOf,
} from './marketEvidence.pure.ts';
import { interpolate, quartersSince, type ConfidenceBand } from './growthScoring.pure.ts';

/** Bumped whenever a weight, anchor or rule changes. Persisted with the score. */
export const DEMAND_METHODOLOGY_VERSION = '3.0.0';

export const DEMAND_WEIGHTS = {
  rentalTightness: 0.35,
  saleUrgency: 0.35,
  absorption: 0.15,
  populationDriver: 0.15,
} as const;

export type DemandComponentKey = keyof typeof DEMAND_WEIGHTS;

/**
 * Evidence this module deliberately does not read, and who owns it.
 *
 * Exported so a test can assert the refusal instead of trusting it. "Avoid
 * measuring the same characteristic twice" is not a property of prose.
 */
export const DEMAND_EXCLUSIONS: ReadonlyArray<{ key: string; ownedBy: string; reason: string }> = [
  { key: 'growth1Year', ownedBy: 'growth', reason: 'Price movement is Growth at every horizon.' },
  { key: 'growth3YearCagr', ownedBy: 'growth', reason: 'Price movement is Growth at every horizon.' },
  { key: 'growth5YearCagr', ownedBy: 'growth', reason: 'Price movement is Growth at every horizon.' },
  { key: 'growth10YearCagr', ownedBy: 'growth', reason: 'Price movement is Growth at every horizon.' },
  { key: 'priceSeries', ownedBy: 'growth', reason: 'The series is what Growth measures consistency on.' },
  { key: 'medianRent', ownedBy: 'yield', reason: 'The rent level against price is Yield.' },
  { key: 'medianPrice', ownedBy: 'valuation', reason: 'Price relative to a median is value, not demand.' },
  { key: 'benchmarkMedianPrice', ownedBy: 'valuation', reason: 'Same characteristic, wider geography.' },
  // Not a `MarketEvidence` key at all — listed so the boundary is stated
  // rather than merely unimplemented. It is a labour-market fact.
  { key: 'unemploymentRate', ownedBy: 'economic', reason: 'A labour-market fact, not a property-market one.' },
];

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/**
 * Rental vacancy, per cent.
 *
 * 3.0% scores 50 and that is a MEASUREMENT: the long-accepted balance point
 * for the Australian rental market, where neither side has the upper hand.
 * Below 1% a tenant takes what they can get; above 5% the market is
 * oversupplied and rents are being discounted to fill properties.
 */
export const VACANCY_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0.5, 97], [1, 90], [1.5, 80], [2, 68], [3, 50], [4, 33], [5, 20], [7, 5], [10, 0],
];

/** Median days on market. Australian medians typically sit near 30-35 days. */
export const DAYS_ON_MARKET_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [10, 100], [20, 88], [30, 70], [45, 52], [60, 38], [90, 20], [120, 8], [180, 0],
];

/**
 * Average discount from first asking price to sale, as a positive magnitude.
 *
 * Selling at asking is the strongest reading available; discounting past ~6%
 * says vendors are meeting a market that will not meet them.
 */
export const VENDOR_DISCOUNT_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 100], [2, 80], [4, 58], [6, 38], [9, 18], [13, 0],
];

/** Auction clearance, per cent. 60% is the conventional balanced line. */
export const CLEARANCE_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [30, 0], [45, 25], [55, 42], [60, 50], [70, 70], [80, 87], [90, 100],
];

/** Sales in the period ÷ properties advertised. 1.0 means stock clears as fast as it arrives. */
export const ABSORPTION_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.2, 20], [0.4, 40], [0.6, 58], [0.8, 74], [1.0, 86], [1.4, 100],
];

/** Resident population growth, per cent per annum. The national rate is ~1.5%. */
export const POPULATION_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0], [0, 20], [0.8, 38], [1.5, 55], [2.5, 75], [3.5, 90], [5, 100],
];

export interface DemandComponent {
  key: DemandComponentKey;
  /** 0-100 for this component alone. */
  score: number;
  /** The measurement it was computed from, in its own units. */
  input: number;
  unit: 'percent' | 'days' | 'ratio' | 'percent_per_annum' | 'reading_count';
  /** Human sentence a report can print verbatim. */
  detail: string;
  /**
   * The points behind it. A list rather than one point, because sale urgency
   * legitimately blends up to three readings — and the evidence trail has to
   * show all of them, not the first.
   */
  evidence: ReadonlyArray<EvidencePoint<unknown>>;
}

/** Can a landlord let it, and how fast. */
export function scoreRentalTightness(ev: MarketEvidence): DemandComponent | null {
  const p = ev.vacancyRate;
  if (!p) return null;
  const score = clamp(interpolate(p.value, VACANCY_ANCHORS));
  return {
    key: 'rentalTightness',
    score,
    input: p.value,
    unit: 'percent',
    detail: `${p.value.toFixed(1)}% rental vacancy in ${p.areaName}`
      + (Math.abs(p.value - 3) < 0.05 ? ' — the balance point for the Australian rental market' : ''),
    evidence: [p],
  };
}

/**
 * How hard buyers compete, from up to three readings BLENDED into one score.
 *
 * The mean of the lenses present, never their sum. Days on market, vendor
 * discount and auction clearance all measure the pressure on stock; a suburb
 * that sells in eleven days at full asking with 85% clearance is telling us
 * one thing three times, and it is entitled to one component's worth of
 * weight for it.
 */
export function scoreSaleUrgency(ev: MarketEvidence): DemandComponent | null {
  const lenses: Array<{ score: number; label: string; point: EvidencePoint }> = [];

  if (ev.daysOnMarket) {
    lenses.push({
      score: clamp(interpolate(ev.daysOnMarket.value, DAYS_ON_MARKET_ANCHORS)),
      label: `${Math.round(ev.daysOnMarket.value)} days on market`,
      point: ev.daysOnMarket,
    });
  }
  if (ev.vendorDiscount) {
    // Published either way round; the magnitude of the discount is the signal.
    const magnitude = Math.abs(ev.vendorDiscount.value);
    lenses.push({
      score: clamp(interpolate(magnitude, VENDOR_DISCOUNT_ANCHORS)),
      label: `${magnitude.toFixed(1)}% average vendor discount`,
      point: ev.vendorDiscount,
    });
  }
  if (ev.auctionClearanceRate) {
    lenses.push({
      score: clamp(interpolate(ev.auctionClearanceRate.value, CLEARANCE_ANCHORS)),
      label: `${Math.round(ev.auctionClearanceRate.value)}% auction clearance`,
      point: ev.auctionClearanceRate,
    });
  }
  if (lenses.length === 0) return null;

  const score = lenses.reduce((s, l) => s + l.score, 0) / lenses.length;
  return {
    key: 'saleUrgency',
    score: clamp(score),
    // A blend has no single input measurement, so `input` is how many readings
    // went into it and the unit says exactly that. The readings themselves are
    // in `detail` and on the evidence trail.
    input: lenses.length,
    unit: 'reading_count',
    detail: lenses.map((l) => l.label).join(', '),
    evidence: lenses.map((l) => l.point),
  };
}

/**
 * Sales against stock advertised — how much of what comes to market clears.
 *
 * Needs both halves. A sales count on its own is ambiguous: it rises with
 * demand and it rises with churn, and nothing in the number says which.
 */
export function scoreAbsorption(ev: MarketEvidence): DemandComponent | null {
  const sales = ev.salesCount;
  const listings = ev.listingActivity;
  if (!sales || !listings || listings.value <= 0) return null;
  const ratio = sales.value / listings.value;
  return {
    key: 'absorption',
    score: clamp(interpolate(ratio, ABSORPTION_ANCHORS)),
    input: ratio,
    unit: 'ratio',
    detail:
      `${sales.value.toLocaleString('en-AU')} sales against `
      + `${listings.value.toLocaleString('en-AU')} advertised (${(ratio * 100).toFixed(0)}% absorbed)`,
    evidence: [sales, listings],
  };
}

/**
 * Resident population growth — a demand DRIVER, and never a growth figure.
 *
 * The rule `MarketEvidence` states on the field itself, kept here because this
 * is the one module allowed to read it: people arriving is a reason to expect
 * demand, not evidence that values have risen. It carries 0.15, so it can
 * inform a Demand score and cannot carry one.
 */
export function scorePopulationDriver(ev: MarketEvidence): DemandComponent | null {
  const p = ev.populationGrowth;
  if (!p) return null;
  return {
    key: 'populationDriver',
    score: clamp(interpolate(p.value, POPULATION_ANCHORS)),
    input: p.value,
    unit: 'percent_per_annum',
    detail: `${p.value.toFixed(1)}% annual population growth in ${p.areaName}`,
    evidence: [p],
  };
}

// ---------------------------------------------------------------------------
// Evidence confidence — the same separation Growth makes, on its own terms
// ---------------------------------------------------------------------------

/**
 * How far the measures BEHIND the score can be relied on.
 *
 * A statement about the evidence present, not about how much of the
 * methodology ran — a single impeccably sourced vacancy rate is high
 * confidence and 35% coverage at the same time, and both are true. It is
 * therefore read beside {@link DemandResult.weightCovered} and never instead
 * of it, and it is the composite's overall coverage — not this band — that
 * refuses a grade a thin dimension cannot carry.
 */
export interface DemandConfidence {
  score: number;
  band: ConfidenceBand;
  factors: ReadonlyArray<{ key: string; score: number; weight: number; detail: string }>;
}

/**
 * Deliberately not Growth's weights.
 *
 * Freshness carries 0.30 here against Growth's 0.10, because the two decay at
 * completely different rates. A five-year CAGR ending two years ago still
 * describes how a suburb compounds; a vacancy rate from two years ago
 * describes a rental market that no longer exists. There is no `history`
 * factor at all — demand measures are point-in-time, and the breadth of what
 * was measured is reported separately as `weightCovered` rather than folded in
 * here, which would be this module's own rule broken in its own confidence.
 */
export const DEMAND_CONFIDENCE_WEIGHTS = {
  geography: 0.30,
  dwellingType: 0.15,
  sample: 0.25,
  freshness: 0.30,
} as const;

export function demandConfidence(
  components: ReadonlyArray<DemandComponent>,
  now: Date = new Date(),
): DemandConfidence {
  const points = components.flatMap((c) => c.evidence);
  const factors: Array<{ key: string; score: number; weight: number; detail: string }> = [];

  const finest = points.length
    ? points.reduce((best, p) => (levelRank(p.level) < levelRank(best.level) ? p : best))
    : null;
  const geoScore = !finest
    ? 0
    : finest.level === 'property' || finest.level === 'suburb'
      ? 100
      : finest.level === 'postcode'
        ? 80
        : finest.level === 'sa2'
          ? 70
        : finest.level === 'lga' || finest.level === 'sa3'
          ? 55
          : finest.level === 'gccsa'
            ? 25
            : 10;
  factors.push({
    key: 'geography', score: geoScore, weight: DEMAND_CONFIDENCE_WEIGHTS.geography,
    detail: finest ? `finest evidence at ${finest.level} level (${finest.areaName})` : 'no evidence',
  });

  const matched = points.filter((p) => p.dwellingTypeMatched).length;
  factors.push({
    key: 'dwellingType',
    score: points.length ? (matched / points.length) * 100 : 0,
    weight: DEMAND_CONFIDENCE_WEIGHTS.dwellingType,
    detail: `${matched} of ${points.length} measures matched the dwelling type`,
  });

  const samples = points.map((p) => p.sampleSize).filter((n): n is number => typeof n === 'number');
  const bestSample = samples.length ? Math.max(...samples) : null;
  factors.push({
    key: 'sample',
    // Unstated is not zero — many publishers simply do not print a count.
    score: bestSample === null
      ? 30
      : clamp(interpolate(bestSample, [[0, 0], [10, 25], [25, 50], [60, 75], [120, 90], [250, 100]])),
    weight: DEMAND_CONFIDENCE_WEIGHTS.sample,
    detail: bestSample === null ? 'observation count not published' : `${bestSample} observations`,
  });

  // Freshness — the period the SOURCE describes, never when it was fetched.
  // Steeper than Growth's: a demand reading a year old has largely expired.
  const ages = points.map((p) => quartersSince(p.asOf, now)).filter((n): n is number => n !== null);
  const newest = ages.length ? Math.min(...ages) : null;
  factors.push({
    key: 'freshness',
    score: newest === null
      ? 30
      : clamp(interpolate(newest, [[0, 100], [1, 92], [2, 78], [4, 50], [6, 28], [8, 12], [12, 0]])),
    weight: DEMAND_CONFIDENCE_WEIGHTS.freshness,
    detail: newest === null ? 'as-of date not parseable' : `newest evidence ${newest} quarter(s) old`,
  });

  const score = clamp(factors.reduce((sum, f) => sum + f.score * f.weight, 0));
  const band: ConfidenceBand = score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';
  return { score: Math.round(score), band, factors };
}

// ---------------------------------------------------------------------------
// The Demand result
// ---------------------------------------------------------------------------

export interface DemandResult {
  methodologyVersion: string;
  /** 0-100, or null when nothing could be computed. Never a placeholder. */
  score: number | null;
  confidence: DemandConfidence;
  components: ReadonlyArray<DemandComponent & { weight: number }>;
  /** Components that could not be computed, named so a report can say so. */
  missing: ReadonlyArray<DemandComponentKey>;
  /** Share of the nominal weight that was actually measured. */
  weightCovered: number;
  /** True when no measure may be shown to a client (licensing). */
  renderRestricted: boolean;
}

/**
 * The deterministic Demand score.
 *
 * Returns `null` rather than a number when nothing could be measured. That is
 * the whole point of the module: 999 reports say `50` today, and not one of
 * them was ever entitled to say anything.
 */
export function scoreDemand(ev: MarketEvidence, now: Date = new Date()): DemandResult {
  const built = [
    scoreRentalTightness(ev),
    scoreSaleUrgency(ev),
    scoreAbsorption(ev),
    scorePopulationDriver(ev),
  ].filter((c): c is DemandComponent => c !== null);

  const present = new Set(built.map((c) => c.key));
  const missing = (Object.keys(DEMAND_WEIGHTS) as DemandComponentKey[]).filter((k) => !present.has(k));

  const weightCovered = built.reduce((s, c) => s + DEMAND_WEIGHTS[c.key], 0);
  const score = weightCovered > 0
    ? Math.round(built.reduce((s, c) => s + c.score * (DEMAND_WEIGHTS[c.key] / weightCovered), 0))
    : null;

  const points = built.flatMap((c) => c.evidence);
  const renderRestricted = points.length > 0
    && points.every((p) => licensingOf(p) === 'unverified' || licensingOf(p) === 'internal_only');

  return {
    methodologyVersion: DEMAND_METHODOLOGY_VERSION,
    score,
    confidence: demandConfidence(built, now),
    components: built.map((c) => ({ ...c, weight: DEMAND_WEIGHTS[c.key] })),
    missing,
    weightCovered: Number(weightCovered.toFixed(3)),
    renderRestricted,
  };
}
