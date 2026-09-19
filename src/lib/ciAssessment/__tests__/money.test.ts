import { describe, expect, it } from 'vitest';
import {
  annualDebtServiceCents,
  annualInterestCents,
  annualPrincipalAndInterestCents,
  formatMoney,
  formatMultiple,
  multiplyCents,
  percentOfCents,
  principalForAnnualPayment,
  ratio,
  roundHalfUp,
  sumCents,
  toCents,
  toDollars,
  toWholeDollars,
} from '../money';

describe('roundHalfUp', () => {
  it('rounds .5 away from zero in both directions', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4)).toBe(2);
    expect(roundHalfUp(-2.4)).toBe(-2);
  });

  it('honours the decimals argument', () => {
    expect(roundHalfUp(1.005, 2)).toBe(1.01);
    expect(roundHalfUp(1.2345, 3)).toBe(1.235);
  });

  it('returns 0 for non-finite input rather than propagating NaN', () => {
    expect(roundHalfUp(Number.NaN)).toBe(0);
    expect(roundHalfUp(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('cents conversion', () => {
  it('round-trips dollars through cents exactly', () => {
    expect(toCents(1234.56)).toBe(123456);
    expect(toDollars(123456)).toBe(1234.56);
    expect(toWholeDollars(123456)).toBe(1235);
  });

  it('does not accumulate floating point drift across a long sum', () => {
    // 0.1 + 0.2 + 0.3 in float is 0.6000000000000001.
    const total = sumCents(toCents(0.1), toCents(0.2), toCents(0.3));
    expect(toDollars(total)).toBe(0.6);
  });

  it('treats nullish and NaN input as zero', () => {
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
    expect(toCents(Number.NaN)).toBe(0);
    expect(sumCents(100, null, undefined, 50)).toBe(150);
  });

  it('handles negative amounts', () => {
    expect(toCents(-500.5)).toBe(-50050);
    expect(toWholeDollars(-50050)).toBe(-501);
  });

  it('handles extreme values without losing integer precision', () => {
    const billion = toCents(1_000_000_000);
    expect(billion).toBe(100_000_000_000);
    expect(toWholeDollars(billion)).toBe(1_000_000_000);
  });
});

describe('percentOfCents', () => {
  it('applies a 0-100 scale percentage', () => {
    expect(percentOfCents(100_000, 5)).toBe(5_000);
  });

  it('clamps out-of-range percentages instead of producing nonsense', () => {
    expect(percentOfCents(100_000, -10)).toBe(0);
    expect(percentOfCents(100_000, 500)).toBe(100_000);
  });
});

describe('repayment maths', () => {
  const million = toCents(1_000_000);

  it('computes interest-only cost', () => {
    expect(toWholeDollars(annualInterestCents(million, 7))).toBe(70_000);
  });

  it('computes an amortising annual P&I payment', () => {
    // $1m at 7% over 20 years ≈ $7,752.99/month ≈ $93,036/year.
    const annual = toWholeDollars(annualPrincipalAndInterestCents(million, 7, 20));
    expect(annual).toBeGreaterThan(92_800);
    expect(annual).toBeLessThan(93_200);
  });

  it('reduces the payment when a residual balloon is outstanding', () => {
    const withoutResidual = annualPrincipalAndInterestCents(million, 7, 20, 0);
    const withResidual = annualPrincipalAndInterestCents(million, 7, 20, toCents(300_000));
    expect(withResidual).toBeLessThan(withoutResidual);
    // A residual never makes the payment cheaper than pure interest.
    expect(withResidual).toBeGreaterThan(annualInterestCents(million, 7));
  });

  it('falls back to interest-only when there is no amortisation term', () => {
    expect(annualPrincipalAndInterestCents(million, 7, 0)).toBe(annualInterestCents(million, 7));
  });

  it('handles a zero interest rate by straight-lining principal', () => {
    expect(toWholeDollars(annualPrincipalAndInterestCents(million, 0, 10))).toBe(100_000);
  });

  it('returns zero for a zero or negative principal', () => {
    expect(annualPrincipalAndInterestCents(0, 7, 20)).toBe(0);
    expect(annualDebtServiceCents({ principalCents: -5, ratePct: 7, repaymentType: 'interestOnly' })).toBe(0);
  });

  it('routes repayment type correctly', () => {
    const io = annualDebtServiceCents({ principalCents: million, ratePct: 7, repaymentType: 'interestOnly' });
    const pi = annualDebtServiceCents({
      principalCents: million, ratePct: 7, repaymentType: 'principalAndInterest', amortisationYears: 20,
    });
    expect(io).toBeLessThan(pi);
  });
});

describe('principalForAnnualPayment', () => {
  it('inverts the P&I calculation to within a dollar', () => {
    const principal = toCents(2_500_000);
    const payment = annualPrincipalAndInterestCents(principal, 6.5, 25);
    const recovered = principalForAnnualPayment(payment, 6.5, 25);
    expect(Math.abs(toWholeDollars(recovered) - toWholeDollars(principal))).toBeLessThanOrEqual(1);
  });

  it('inverts the interest-only calculation when there is no term', () => {
    const payment = annualInterestCents(toCents(1_000_000), 8);
    expect(toWholeDollars(principalForAnnualPayment(payment, 8, 0))).toBe(1_000_000);
  });

  it('returns zero capacity for zero payment', () => {
    expect(principalForAnnualPayment(0, 7, 20)).toBe(0);
  });
});

describe('ratio', () => {
  it('rounds to four decimal places', () => {
    expect(ratio(toCents(650_000), toCents(1_000_000))).toBe(0.65);
    expect(ratio(1, 3)).toBe(0.3333);
  });

  it('returns 0 rather than Infinity when dividing by zero', () => {
    expect(ratio(100, 0)).toBe(0);
  });
});

describe('formatting', () => {
  it('formats whole dollars with no cents', () => {
    expect(formatMoney(toCents(1_234_567.89))).toBe('$1,234,568');
  });

  it('renders an em dash for missing values', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMultiple(0)).toBe('—');
  });

  it('formats coverage multiples to 2dp', () => {
    expect(formatMultiple(1.2567)).toBe('1.26x');
  });
});

describe('multiplyCents', () => {
  it('keeps results on whole cents', () => {
    expect(multiplyCents(333, 1 / 3)).toBe(111);
    expect(Number.isInteger(multiplyCents(100_001, 0.333))).toBe(true);
  });
});
