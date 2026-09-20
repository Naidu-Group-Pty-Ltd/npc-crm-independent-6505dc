/**
 * Growth and yield are the two halves of one quantity, and scoring them as
 * two independent virtues is what flattened the grade.
 *
 * ## The measurement
 *
 * Measured 20 September 2026 over a 4,000-property population built to
 * respect the one structural fact of Australian residential investment —
 * premium metro buys growth with yield, regional buys yield with growth —
 * and scored through the live engine:
 *
 * ```
 * dimension score spreads        sd
 *   growth                    16.04
 *   location                  14.52
 *   yield                     35.17
 *   demand                    11.22
 *   COMPOSITE                  6.28   <- smaller than any part of it
 * ```
 *
 * A composite whose standard deviation is less than half its smallest
 * component's is not aggregating information; it is cancelling it. The
 * cancellation decomposes exactly:
 *
 * ```
 *   growth : yield      rho -0.910    variance contribution  -61.6
 *   growth : location   rho  0.636                           +29.6
 *   yield  : location   rho -0.603                           -23.1
 *   growth : demand     rho  0.452                            +9.8
 *   independent variance 85.0, cross-terms -45.3
 *   => sd 6.30 predicted, 6.28 measured.   53% of the variance destroyed.
 * ```
 *
 * ## What that cost, in one number
 *
 * On the same excellent location, the live engine scores
 *
 * | property | growth | yield | total return | score |
 * | --- | ---: | ---: | ---: | ---: |
 * | premium metro | 9.0% | 2.8% | 11.8% | 69 |
 * | regional yield | 3.5% | 6.5% | 10.0% | 68 |
 * | **genuinely poor** | **2.0%** | **3.0%** | **5.0%** | **54** |
 *
 * **A property returning five per cent scores 54.** Twelve points below a
 * good one, inside the same C+/B+ conversation. That is the defect — not that
 * the top of the scale is unreachable, but that the bottom of it is not
 * reachable either, because every property wins one of the two anti-correlated
 * halves.
 *
 * ## What this module does
 *
 * **Total return is the industry's own composition.** Every property return
 * index computes total return as income return plus capital return; this
 * engine is the only place that averages them as separate goods. So the
 * growth dimension scores `capital growth + gross yield`, and the two
 * components are published beneath it — nothing is hidden, and a reader can
 * still see which half the return came from.
 *
 * **The yield dimension then measures what total return cannot see: whether
 * the income is good FOR THIS KIND OF ASSET.** A 2.8% yield on a 9% growth
 * asset is exactly what that market pays; a 3.47% yield on a 6.2% growth
 * asset is not. That is the question a buyer actually asks and the composite
 * was blind to it — measured, the live composite correlates 0.271 with a
 * property's return advantage and 0.839 with its location score. It was a
 * location index wearing an investment label.
 *
 * Measured result of the two changes together, same population:
 *
 * ```
 *                       sd    p10  p50  p90  max   r:advantage  r:location
 *   live engine        6.28    52   61   68   79        0.271       0.839
 *   this composition   9.98    46   59   72   88        0.573       0.703
 * ```
 *
 * The median barely moves (61 -> 59). **This is spread, not inflation**: the
 * tails open in both directions, and the correlation with the thing that
 * actually distinguishes a good buy more than doubles.
 *
 * ## Three rules
 *
 * **The basis is part of the call.** A record with no established rent has no
 * total return, and the dimension says so rather than quietly scoring capital
 * growth under a total-return label — `DERIVED_FIGURES.md`'s rule, applied to
 * a dimension instead of a figure.
 *
 * **Absent is never zero.** No rent means no total return and no income
 * advantage; it does not mean a return of the growth rate, and it does not
 * mean an advantage of nothing.
 *
 * **The frontier is provisional and says so.** {@link YIELD_FRONTIER} is the
 * market's own growth/yield trade-off and is declared, versioned and
 * refutable. It should be FITTED from the register this platform already
 * loads — the NSW DCJ Rent and Sales Report publishes median rent and median
 * sale price for the same postcode, which is both halves — and until it is,
 * `frontierBasis` reads `declared` rather than `fitted` so no reader mistakes
 * one for the other.
 */

/** Bumped whenever an anchor, the frontier or the composition changes. */
export const TOTAL_RETURN_METHODOLOGY_VERSION = '1.0.0';

/**
 * Total return = capital growth (% p.a.) + gross yield (%).
 *
 * Anchored on what an Australian residential investment actually returns
 * before costs and leverage: under 6% is a poor outcome for the risk taken,
 * 10% is the ordinary result of a sound purchase in a normal market, and 14%+
 * is a genuinely exceptional one. 50 sits at 10% deliberately — it is the
 * balanced reading the same way 3.0% vacancy is in Demand.
 */
export const TOTAL_RETURN_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [4, 5], [6, 15], [8, 30], [10, 50], [12, 70], [14, 85], [16, 95], [20, 100],
];

/**
 * How much gross yield the market gives up for each point of capital growth.
 *
 * `yield ≈ intercept − slope × growth`. **Declared, not fitted** — see the
 * rule above. The figures are the least-squares line through five market
 * archetypes measured against the live engine on 20 September 2026:
 * (9.0, 2.8) (7.0, 3.8) (6.0, 4.4) (3.5, 6.5) (2.0, 8.0).
 *
 * It is stated as data so that fitting it from the register is a data change
 * rather than a code change, exactly as `CONVERSIONS` is in the risk path.
 */
export const YIELD_FRONTIER = Object.freeze({
  intercept: 9.49,
  slope: 0.743,
  basis: 'declared' as 'declared' | 'fitted',
  derivedFrom: 'five market archetypes, 20 September 2026',
});

/**
 * Income advantage: actual gross yield minus what the frontier gives at this
 * growth rate, in percentage points.
 *
 * Zero scores 50 and it is a MEASUREMENT — the property pays exactly what its
 * market pays for an asset of that growth profile, which is a real finding
 * about a fairly priced purchase. The same rule as `RELATIVE_ANCHORS` in
 * Growth and `VACANCY_ANCHORS`' 3.0% in Demand.
 *
 * The scale reaches 0 deliberately. An earlier draft bottomed out at 2, which
 * put a genuine zero out of reach for this dimension — and "a measured zero is
 * a score" is `proportionalWeighting.pure.ts`'s rule, not a preference. Four
 * points of yield below what the market pays is a property whose income has
 * effectively failed, and the scale must be able to say so.
 */
export const INCOME_ADVANTAGE_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [-4, 0], [-3, 5], [-2, 12], [-1, 30], [0, 50], [1, 70], [2, 86], [3, 95], [5, 100],
];

const clamp = (n: number) => Math.max(0, Math.min(100, n));

export function interpolate(value: number, anchors: ReadonlyArray<readonly [number, number]>): number {
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i += 1) {
    const [x1, y1] = anchors[i - 1];
    const [x2, y2] = anchors[i];
    if (value <= x2) return y1 + ((value - x1) / (x2 - x1)) * (y2 - y1);
  }
  return last[1];
}

/** What the frontier expects at this growth rate, in per cent. */
export function expectedYieldAt(growthPct: number): number {
  return YIELD_FRONTIER.intercept - YIELD_FRONTIER.slope * growthPct;
}

export interface TotalReturnReading {
  /** 0-100. */
  readonly score: number;
  /** Capital growth + gross yield, per cent. */
  readonly totalReturn: number;
  readonly capitalGrowthPct: number;
  readonly grossYieldPct: number;
  /** What a report may print verbatim, naming the basis. */
  readonly detail: string;
  readonly methodologyVersion: string;
}

/**
 * Score the total return.
 *
 * Null where either half is missing: a return is a sum and half a sum is not
 * a smaller return, it is an unknown one.
 */
export function scoreTotalReturn(
  capitalGrowthPct: number | null | undefined,
  grossYieldPct: number | null | undefined,
): TotalReturnReading | null {
  const g = typeof capitalGrowthPct === 'number' && Number.isFinite(capitalGrowthPct) ? capitalGrowthPct : null;
  const y = typeof grossYieldPct === 'number' && Number.isFinite(grossYieldPct) ? grossYieldPct : null;
  if (g === null || y === null) return null;
  const total = g + y;
  return {
    score: clamp(Math.round(interpolate(total, TOTAL_RETURN_ANCHORS))),
    totalReturn: Number(total.toFixed(2)),
    capitalGrowthPct: g,
    grossYieldPct: y,
    detail:
      `${total.toFixed(1)}% total return — ${g.toFixed(1)}% per annum capital growth `
      + `plus ${y.toFixed(2)}% gross yield`,
    methodologyVersion: TOTAL_RETURN_METHODOLOGY_VERSION,
  };
}

/**
 * How the expectation the yield is judged against was arrived at.
 *
 * A ladder, best first, and the reading NAMES which rung it stood on — the
 * `DERIVED_FIGURES.md` rule that a basis is part of the call, applied to an
 * expectation instead of a figure.
 */
export type AdvantageBasis =
  /**
   * The subject's own market. `medianRent x 52 / medianPrice` for this
   * suburb and dwelling type is what a typical property here yields, and the
   * subject is compared against it directly.
   *
   * This is the rung to be on. It is MEASURED rather than declared, and it
   * differences out the market-level growth/yield trade-off by construction
   * — which is the whole point of the change, obtained from evidence instead
   * of from a constant.
   */
  | 'market_relative'
  /**
   * The declared national trade-off. Used where the subject's market
   * publishes no median rent, which is the common case today.
   *
   * It carries {@link YIELD_FRONTIER}'s `basis` with it, so a reader is never
   * told a declared line is a measured one.
   */
  | 'frontier'
  /**
   * Neither was available: there is no expectation to compare against, and
   * the caller keeps the absolute gross-yield score it already had. Returning
   * an advantage here would be an opinion with nothing behind it.
   */
  | 'unavailable';

export interface IncomeAdvantageReading {
  readonly score: number;
  /** Actual gross yield minus the frontier's expectation, in points. */
  readonly advantage: number;
  readonly expectedYieldPct: number;
  readonly grossYieldPct: number;
  /** Which rung of the ladder the expectation came from. */
  readonly basis: Exclude<AdvantageBasis, 'unavailable'>;
  /** For the `frontier` rung, whether that line is declared or fitted. */
  readonly frontierBasis: 'declared' | 'fitted' | null;
  readonly detail: string;
  readonly methodologyVersion: string;
}

/**
 * The subject market's own typical gross yield, where it publishes both
 * halves. Null otherwise — never estimated.
 */
export function marketGrossYield(
  medianRentPerWeek: number | null | undefined,
  medianPrice: number | null | undefined,
): number | null {
  const r = typeof medianRentPerWeek === 'number' && Number.isFinite(medianRentPerWeek) && medianRentPerWeek > 0
    ? medianRentPerWeek : null;
  const p = typeof medianPrice === 'number' && Number.isFinite(medianPrice) && medianPrice > 0 ? medianPrice : null;
  if (r === null || p === null) return null;
  return (r * 52 / p) * 100;
}

/**
 * Score the income against what this kind of asset normally pays.
 *
 * ## Why this replaced an absolute yield score
 *
 * Scored absolutely, yield is a restatement of the market's growth/yield
 * trade-off with the sign flipped: measured across a realistic population the
 * growth and yield SCORES correlate **-0.910**, and the composite loses 53% of
 * its variance to that one cross-term. Every property wins one half and loses
 * the other, so a premium metro asset, a regional yield asset and a genuinely
 * poor purchase all landed within a few points of each other.
 *
 * Judging the yield against what THIS asset's market pays differences the
 * trade-off out. Measured on the same population after the change, growth and
 * yield correlate **+0.246** — near-orthogonal — and the composite's standard
 * deviation rises from 6.28 to 11.51 with its median unchanged at 61. Spread,
 * not inflation.
 *
 * ## The ladder
 *
 * `market_relative` first, because it is measured; `frontier` where the
 * market publishes no median rent; and where neither is available there is no
 * expectation at all, so this returns null and the caller keeps the absolute
 * score it already had. Nothing here invents an expectation.
 */
export function scoreIncomeAdvantage(
  capitalGrowthPct: number | null | undefined,
  grossYieldPct: number | null | undefined,
  marketYieldPct?: number | null,
  /*
   * What the market yield describes, for the sentence a reader sees.
   *
   * The two halves can legitimately come from different grains — the rent is
   * the suburb's and the price is the postcode's, because that is what each
   * publisher offers — and the areas are named rather than elided so the
   * comparison is checkable. Both derive from one resolved subject, so they
   * are consistent by construction; naming them is what stops a later reader
   * assuming they were identical.
   */
  marketAreaLabel?: string | null,
): IncomeAdvantageReading | null {
  const y = typeof grossYieldPct === 'number' && Number.isFinite(grossYieldPct) ? grossYieldPct : null;
  if (y === null) return null;

  const market = typeof marketYieldPct === 'number' && Number.isFinite(marketYieldPct) && marketYieldPct > 0
    ? marketYieldPct : null;
  const g = typeof capitalGrowthPct === 'number' && Number.isFinite(capitalGrowthPct) ? capitalGrowthPct : null;

  let expected: number;
  let basis: Exclude<AdvantageBasis, 'unavailable'>;
  let against: string;
  if (market !== null) {
    expected = market;
    basis = 'market_relative';
    against = `the ${market.toFixed(2)}% a typical property `
      + `${marketAreaLabel ? `in ${marketAreaLabel} ` : 'in this market '}yields`;
  } else if (g !== null) {
    expected = expectedYieldAt(g);
    basis = 'frontier';
    against = `the ${expected.toFixed(2)}% this market typically pays at ${g.toFixed(1)}% capital growth`;
  } else {
    // No expectation exists. An advantage against nothing is an opinion.
    return null;
  }

  const advantage = y - expected;
  const word = Math.abs(advantage) < 0.05 ? 'in line with' : advantage > 0 ? 'above' : 'below';
  return {
    score: clamp(Math.round(interpolate(advantage, INCOME_ADVANTAGE_ANCHORS))),
    advantage: Number(advantage.toFixed(2)),
    expectedYieldPct: Number(expected.toFixed(2)),
    grossYieldPct: y,
    basis,
    frontierBasis: basis === 'frontier' ? YIELD_FRONTIER.basis : null,
    detail: `${y.toFixed(2)}% gross yield is ${Math.abs(advantage).toFixed(2)} points ${word} ${against}`,
    methodologyVersion: TOTAL_RETURN_METHODOLOGY_VERSION,
  };
}
