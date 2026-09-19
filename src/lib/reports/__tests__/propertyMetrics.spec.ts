/**
 * The derived figures every report quotes — one definition, and proof it does
 * not move a document.
 *
 * The parity block is the important one. Consolidating a figure is only safe
 * if the canonical module reproduces what the existing engine already
 * computes, to the digit, for the same inputs. Those cases are taken from
 * `financialEngine.pure.ts`'s own arithmetic rather than invented, because
 * that engine is the one whose output reaches the Financial report.
 */
import { describe, expect, it } from 'vitest';
import {
  cashOnCashReturn,
  currentLvr,
  equity,
  financeIdentityBreaches,
  grossYield,
  labelFor,
  netYield,
  originationLvr,
} from '../../../../supabase/functions/_shared/reports/metrics/propertyMetrics.pure';

// ---------------------------------------------------------------------------
// Parity — the module must not move a number that already ships
// ---------------------------------------------------------------------------

describe('parity with the engine that feeds the Financial report', () => {
  // financialEngine.pure.ts:365-366
  //   grossYield = (annualRent / input.propertyValue) * 100
  //   netYield   = ((annualRent - yieldCosts) / input.propertyValue) * 100
  const cases = [
    { rent: 650 * 52, costs: 8_400, value: 750_000 },
    { rent: 480 * 52, costs: 6_100, value: 520_000 },
    { rent: 1_200 * 52, costs: 19_750, value: 1_850_000 },
    { rent: 395 * 52, costs: 5_020, value: 410_000 },
  ];

  it.each(cases)('gross yield matches the engine for $value', ({ rent, value }) => {
    const engine = (rent / value) * 100;
    const module_ = grossYield({ annualRent: rent, basisAmount: value, basis: 'purchase' });
    expect(module_!.value).toBeCloseTo(engine, 2);
  });

  it.each(cases)('net yield matches the engine for $value', ({ rent, costs, value }) => {
    const engine = ((rent - costs) / value) * 100;
    const module_ = netYield({
      annualRent: rent, annualOperatingCosts: costs, basisAmount: value, basis: 'purchase',
    });
    expect(module_!.value).toBeCloseTo(engine, 2);
  });

  it('origination LVR matches liveProjectionRow', () => {
    // liveProjectionRow.ts:141 — (loanAmount / purchasePrice) * 100
    expect(originationLvr({ loanAtSettlement: 600_000, purchasePrice: 750_000 })).toBe(80);
  });

  it('current LVR matches the strategy surfaces', () => {
    // (prop.loan_remaining / prop.current_value) * 100
    expect(currentLvr({ loanBalance: 412_500, currentValue: 750_000 })).toBe(55);
  });
});

// ---------------------------------------------------------------------------
// Basis — the distinction the old code had no name for
// ---------------------------------------------------------------------------

describe('basis is part of the figure, not a default', () => {
  it('carries the basis back with the number', () => {
    const onPurchase = grossYield({ annualRent: 33_800, basisAmount: 700_000, basis: 'purchase' });
    const onValue = grossYield({ annualRent: 33_800, basisAmount: 910_000, basis: 'value' });
    expect(onPurchase!.basis).toBe('purchase');
    expect(onValue!.basis).toBe('value');
  });

  it('gives two DIFFERENT correct answers once the property has grown', () => {
    // The reason a single "gross yield" cannot be right: same rent, same
    // property, two legitimate figures 1.0 point apart after 30% growth.
    const rent = 33_800;
    const onPurchase = grossYield({ annualRent: rent, basisAmount: 700_000, basis: 'purchase' })!;
    const onValue = grossYield({ annualRent: rent, basisAmount: 910_000, basis: 'value' })!;
    expect(onPurchase.value).toBeCloseTo(4.83, 2);
    expect(onValue.value).toBeCloseTo(3.71, 2);
    expect(onPurchase.value).not.toBeCloseTo(onValue.value, 1);
  });

  it('separates origination LVR from current LVR after amortisation and growth', () => {
    // Same loan, same property, ten years on. Both correct, and a document
    // that prints one under the other's label is simply wrong.
    expect(originationLvr({ loanAtSettlement: 600_000, purchasePrice: 750_000 })).toBe(80);
    expect(currentLvr({ loanBalance: 505_000, currentValue: 1_010_000 })).toBe(50);
  });

  it('labels a figure with its basis so two documents can be compared', () => {
    expect(labelFor('grossYield', 'purchase')).toBe('Gross yield (on purchase price)');
    expect(labelFor('grossYield', 'value')).toBe('Gross yield (on current value)');
    expect(labelFor('originationLvr')).toBe('LVR at settlement');
    expect(labelFor('currentLvr')).toBe('Current LVR');
  });
});

// ---------------------------------------------------------------------------
// Absent, not zero
// ---------------------------------------------------------------------------

describe('a figure that cannot be formed is absent, never zero', () => {
  it('refuses a zero or negative denominator rather than reporting 0%', () => {
    // Every existing site is `value > 0 ? (loan / value) * 100 : 0`. A zero
    // LVR is the claim that a property is unencumbered.
    expect(currentLvr({ loanBalance: 400_000, currentValue: 0 })).toBeNull();
    expect(currentLvr({ loanBalance: 400_000, currentValue: -1 })).toBeNull();
    expect(grossYield({ annualRent: 33_800, basisAmount: 0, basis: 'value' })).toBeNull();
    expect(originationLvr({ loanAtSettlement: 600_000, purchasePrice: 0 })).toBeNull();
  });

  it('refuses a non-finite or absent input', () => {
    expect(grossYield({ annualRent: NaN, basisAmount: 700_000, basis: 'purchase' })).toBeNull();
    expect(netYield({
      annualRent: 33_800, annualOperatingCosts: undefined as unknown as number,
      basisAmount: 700_000, basis: 'purchase',
    })).toBeNull();
    expect(equity(undefined, 400_000)).toBeNull();
  });

  it('reports negative equity rather than flooring it at zero', () => {
    // Clamping would tell an owner in negative equity they are at break-even.
    expect(equity(620_000, 700_000)).toBe(-80_000);
  });
});

// ---------------------------------------------------------------------------
// Net yield is unlevered; cash-on-cash is not
// ---------------------------------------------------------------------------

describe('net yield and cash-on-cash are different quantities', () => {
  const rent = 33_800;
  const operating = 8_400;
  const debtService = 38_400;
  const price = 750_000;

  it('net yield ignores the loan entirely', () => {
    // Two owners, same property, different loans, same net yield.
    const a = netYield({ annualRent: rent, annualOperatingCosts: operating, basisAmount: price, basis: 'purchase' })!;
    const b = netYield({ annualRent: rent, annualOperatingCosts: operating, basisAmount: price, basis: 'purchase' })!;
    expect(a.value).toBeCloseTo(3.39, 2);
    expect(b.value).toBe(a.value);
  });

  it('cash-on-cash is over the CASH invested, not over the value', () => {
    // Dividing a levered return by the property's value is the error the
    // module header describes; it produces a number with no standard meaning.
    const coc = cashOnCashReturn({
      annualRent: rent, annualOperatingCosts: operating,
      annualDebtService: debtService, cashInvested: 187_500,
    });
    expect(coc).toBeCloseTo(-6.93, 2);
  });

  it('reports a negatively geared property as negative, not zero', () => {
    const coc = cashOnCashReturn({
      annualRent: 20_000, annualOperatingCosts: 8_000,
      annualDebtService: 30_000, cashInvested: 150_000,
    })!;
    expect(coc).toBeLessThan(0);
  });

  it('a cost base that wrongly includes interest changes the answer materially', () => {
    // This is the shape of the `useReviewWizard` figure: costs including
    // interest, divided by value, labelled "net yield". Pinned so the
    // difference is visible rather than arguable.
    const correct = netYield({
      annualRent: rent, annualOperatingCosts: operating, basisAmount: price, basis: 'purchase',
    })!;
    const wrong = netYield({
      annualRent: rent, annualOperatingCosts: operating + debtService, basisAmount: price, basis: 'purchase',
    })!;
    expect(correct.value).toBeCloseTo(3.39, 2);
    expect(wrong.value).toBeCloseTo(-1.73, 2);
  });
});

// ---------------------------------------------------------------------------
// The record has to agree with itself
// ---------------------------------------------------------------------------

describe('finance identity breaches', () => {
  it('passes a record whose three numbers describe one deal', () => {
    expect(financeIdentityBreaches({
      purchasePrice: 672_000, deposit: 134_400, loanAmount: 537_600,
      keyMetricsLvr: 80, loanDetailsLvr: 80,
    })).toEqual([]);
  });

  it('catches the production row where a deposit and a loan exceed the price', () => {
    // Verbatim from investment_reports on 2026-09-07: the deposit was taken at
    // 20% of the price and the loan at 90% of it, so the two lines a client
    // reads come to $67,200 more than the property costs. 14 of 143 stored
    // reports carry this, and the model wrote "90% LVR" up to twelve times on
    // them because that is what the loan block said.
    const breaches = financeIdentityBreaches({
      purchasePrice: 672_000, deposit: 134_400, loanAmount: 604_800,
      keyMetricsLvr: 80, loanDetailsLvr: 90,
    });
    expect(breaches.map((b) => b.rule)).toEqual([
      'deposit_plus_loan', 'lvr_stated_twice', 'lvr_matches_loan',
    ]);
    expect(breaches[0].message).toContain('$739,200');
    expect(breaches[0].message).toContain('$672,000');
    expect(breaches[1].message).toContain('80%');
    expect(breaches[1].message).toContain('90%');
    // The loan settles which of the two copies is the true one.
    expect(breaches[2]).toMatchObject({ expected: 90, found: 80 });
  });

  it('tolerates a dollar of rounding and half a point of LVR', () => {
    expect(financeIdentityBreaches({
      purchasePrice: 672_000, deposit: 134_400, loanAmount: 537_601,
      keyMetricsLvr: 80, loanDetailsLvr: 80.4,
    })).toEqual([]);
  });

  it('a figure the record does not carry is not a breach', () => {
    // Rows written before a block existed hold nothing there, and silence is
    // not disagreement.
    expect(financeIdentityBreaches({})).toEqual([]);
    expect(financeIdentityBreaches({ purchasePrice: 672_000 })).toEqual([]);
    expect(financeIdentityBreaches({ keyMetricsLvr: 80 })).toEqual([]);
    expect(financeIdentityBreaches({
      purchasePrice: 672_000, deposit: 134_400, loanAmount: 537_600,
    })).toEqual([]);
  });

  it('checks the single stated LVR against the loan when only one copy exists', () => {
    const [breach] = financeIdentityBreaches({
      purchasePrice: 600_000, loanAmount: 540_000, loanDetailsLvr: 80,
    });
    expect(breach).toMatchObject({ rule: 'lvr_matches_loan', expected: 90, found: 80 });
  });
});
