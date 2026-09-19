/**
 * The comparison table read 160,902.0% for a property, and the arithmetic
 * below is why.
 *
 * These fixtures are the figures off the reported screen. 48 Budgeree Street is
 * the property the adviser had open, whose metrics were CORRECT — it went
 * through `readBaseFinancials`. 93 Bimbadeen Avenue is a peer, whose metrics
 * went through a hand-rolled reading that missed `initialCosts.propertyValue`
 * and so divided every return by the $2,000 solicitor-fee default. The two
 * readings are now one, and this pins both halves: the correct property must
 * not move, and the broken one must come back to earth.
 */
import { describe, expect, it } from 'vitest';

import {
  acquisitionCashFor,
  depositFor,
  annualiseReturn,
  deriveInvestmentMetrics,
  formatBreakEven,
  formatMetricMultiple,
  formatMetricPercent,
  type MetricsBase,
  type MetricsProjection,
} from '../investmentMetrics.pure';

/** A projection that grows a value and loses the same cash each year. */
function projection(opts: {
  startValue: number;
  endValue: number;
  openingEquity: number;
  closingEquity: number;
  annualCashFlow: number;
}): MetricsProjection[] {
  const rows: MetricsProjection[] = [];
  for (let year = 0; year <= 10; year += 1) {
    const t = year / 10;
    rows.push({
      propertyMarketValue: opts.startValue + (opts.endValue - opts.startValue) * t,
      equityInProperty: opts.openingEquity + (opts.closingEquity - opts.openingEquity) * t,
      afterTaxCashFlowPA: year === 0 ? 0 : opts.annualCashFlow,
    });
  }
  return rows;
}

const BUDGEREE_BASE: MetricsBase = {
  purchasePrice: 1_190_000,
  depositValue: 238_000,
  stampDuty: 47_737,
  solicitorFees: 2_000,
  lmiAmount: 0,
  loanToValueRatio: 80,
};

describe('the property that was already correct does not move', () => {
  it('reproduces 48 Budgeree Street to the dollar', () => {
    // Deposit 238,000 + duty 47,737 + legal 2,000 = 287,737 committed.
    expect(acquisitionCashFor(BUDGEREE_BASE)).toBe(287_737);
  });

  it('still measures a capital gain of $1,627,163', () => {
    // Bought today, so today's value IS the purchase price and measuring the
    // gain over the horizon changes nothing.
    const read = deriveInvestmentMetrics(
      projection({
        startValue: 1_190_000,
        endValue: 2_817_163,
        openingEquity: 238_000,
        closingEquity: 2_010_094,
        annualCashFlow: -31_890,
      }),
      BUDGEREE_BASE,
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.metrics.capitalGain).toBe(1_627_163);
    expect(read.metrics.totalCashFlow).toBeCloseTo(-318_900, 0);
    expect(read.metrics.totalReturn).toBeCloseTo(1_308_263, 0);
    expect(read.metrics.capitalCommitted).toBe(287_737);
    expect(read.metrics.capitalBasis).toBe('acquisition_cash');
    // 1,308,263 / 287,737 = 454.7%
    expect(read.metrics.roi).toBeCloseTo(454.7, 1);
    expect(read.metrics.annualisedRoi).toBeCloseTo(18.69, 1);
  });
});

describe('the $2,000 cost base', () => {
  // What the peer reading produced: no price, no deposit, no duty — just the
  // solicitor-fee default the old code substituted.
  const COLLAPSED: MetricsBase = {
    purchasePrice: 0,
    depositValue: 0,
    stampDuty: 0,
    solicitorFees: 2_000,
    lmiAmount: 0,
    loanToValueRatio: 80,
  };

  it('is exactly what produced 160,902%', () => {
    // The old code: totalReturn / 2,000 × 100. Kept here as the arithmetic
    // this test exists to make impossible.
    expect((3_218_039 / 2_000) * 100).toBeCloseTo(160_901.95, 1);
  });

  it('is refused rather than used, when there is no equity either', () => {
    const read = deriveInvestmentMetrics(
      projection({
        startValue: 0, endValue: 0, openingEquity: 0, closingEquity: 0, annualCashFlow: 0,
      }),
      COLLAPSED,
    );
    expect(read.ok).toBe(false);
    if (read.ok === true) return;
    expect(read.reason).toBe('capital_unknown');
  });

  it('never divides a real return by a fee', () => {
    // The peer's own projection was always correct — it is only the
    // denominator that was fiction. With real equity in the property, the
    // equity is the basis and the answer is a number a person can read.
    const read = deriveInvestmentMetrics(
      projection({
        startValue: 1_413_200, endValue: 3_631_239,
        openingEquity: 1_000_000, closingEquity: 2_511_229,
        annualCashFlow: -41_320,
      }),
      COLLAPSED,
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.metrics.capitalBasis).toBe('opening_equity');
    expect(read.metrics.capitalCommitted).toBe(1_000_000);
    expect(read.metrics.roi).toBeLessThan(1_000);
    expect(read.metrics.roi).toBeGreaterThan(0);
  });
});

describe('the gain is over the ten years, not since purchase', () => {
  // 71 Saltwater Creek Road: bought for $810,000, worth $2.73m today,
  // projected to $6.45m. Measuring from the purchase price folded two decades
  // of past appreciation into a ten-year forecast and read 3,997%.
  const HELD: MetricsBase = {
    purchasePrice: 810_000,
    depositValue: 94_275,
    stampDuty: 48_000,
    solicitorFees: 2_000,
    lmiAmount: 0,
    loanToValueRatio: 80,
  };
  const projs = projection({
    startValue: 2_730_000, endValue: 6_451_592,
    openingEquity: 2_400_000, closingEquity: 5_963_592,
    annualCashFlow: -7_492,
  });

  it('measures from today, not from the contract', () => {
    const read = deriveInvestmentMetrics(projs, HELD);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.metrics.capitalGain).toBeCloseTo(3_721_592, 0);
    // Not 5,641,592 — that is the gain since purchase.
    expect(read.metrics.capitalGain).not.toBeCloseTo(5_641_592, 0);
  });

  it('divides by the capital in it today, not the deposit paid decades ago', () => {
    const read = deriveInvestmentMetrics(projs, HELD);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.metrics.capitalBasis).toBe('opening_equity');
    expect(read.metrics.capitalCommitted).toBe(2_400_000);
    // ~154%, not 3,997%.
    expect(read.metrics.roi).toBeLessThan(300);
  });

  it('keeps acquisition cash as the basis for a property being bought', () => {
    // The duty and fees are sunk into the purchase, so the cash outlay exceeds
    // the equity it buys — which is why the greater of the two is right.
    const read = deriveInvestmentMetrics(
      projection({
        startValue: 1_190_000, endValue: 2_817_163,
        openingEquity: 238_000, closingEquity: 2_010_094, annualCashFlow: -31_890,
      }),
      BUDGEREE_BASE,
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.metrics.capitalBasis).toBe('acquisition_cash');
  });
});

describe('a deposit that was never recorded', () => {
  it('is derived from the price and the LVR, without a float tail', () => {
    expect(depositFor({
      purchasePrice: 800_000, depositValue: 0, stampDuty: 0,
      solicitorFees: 0, lmiAmount: 0, loanToValueRatio: 80,
    })).toBe(160_000);
    expect(acquisitionCashFor({
      purchasePrice: 800_000, depositValue: 0, stampDuty: 0,
      solicitorFees: 0, lmiAmount: 0, loanToValueRatio: 80,
    })).toBe(160_000);
  });

  it('is zero when there is no price to derive it from', () => {
    // And zero is what makes the metrics refuse, rather than a default.
    expect(acquisitionCashFor({
      purchasePrice: 0, depositValue: 0, stampDuty: 0,
      solicitorFees: 0, lmiAmount: 0, loanToValueRatio: 80,
    })).toBe(0);
  });

  it('counts LMI, which the peer reading did not have a key for', () => {
    expect(acquisitionCashFor({ ...BUDGEREE_BASE, lmiAmount: 21_500 })).toBe(287_737 + 21_500);
  });
});

describe('annualising a return', () => {
  it('compounds a gain over ten years', () => {
    expect(annualiseReturn(454.7)).toBeCloseTo(18.69, 1);
  });

  it('is null rather than NaN for a loss beyond the capital', () => {
    // Math.pow of a negative base to a fractional exponent is NaN, and "NaN%"
    // in a client-facing table is a spreadsheet error on a letterhead.
    expect(annualiseReturn(-150)).toBeNull();
    expect(annualiseReturn(-100)).toBeNull();
  });

  it('handles a total loss of exactly nothing left', () => {
    expect(annualiseReturn(-99.9)).toBeLessThan(0);
  });
});

describe('what an absent figure looks like', () => {
  it('is a dash, never a zero', () => {
    expect(formatMetricPercent(null)).toBe('—');
    expect(formatMetricPercent(undefined)).toBe('—');
    expect(formatMetricPercent(Number.NaN)).toBe('—');
    expect(formatMetricMultiple(null)).toBe('—');
    expect(formatMetricPercent(0)).toBe('0.0%');
  });

  it('says where break-even falls, or that it does not', () => {
    expect(formatBreakEven(4)).toBe('Year 4');
    // Five columns of "N/A" told the reader nothing at all.
    expect(formatBreakEven(null)).toBe('Beyond year 10');
  });
});

describe('an incomplete projection', () => {
  it('is refused, not padded', () => {
    const read = deriveInvestmentMetrics(
      [{ propertyMarketValue: 1, equityInProperty: 1, afterTaxCashFlowPA: 1 }],
      BUDGEREE_BASE,
    );
    expect(read.ok).toBe(false);
    if (read.ok === true) return;
    expect(read.reason).toBe('projection_incomplete');
  });

  it('is refused when there is no base at all', () => {
    const read = deriveInvestmentMetrics(
      projection({ startValue: 1, endValue: 2, openingEquity: 1, closingEquity: 2, annualCashFlow: 0 }),
      null,
    );
    expect(read.ok).toBe(false);
  });
});
