import { describe, expect, it } from 'vitest';
import { ASSUMED_INTEREST_ONLY_YEARS, amortisingPayment, buildLoanLedger, describeLoanStructure, ledgerYear } from '@/lib/reports/investment/loanLedger.pure';

/**
 * Gate 2 of the audit's acceptance criteria (QA-291SM-20260915), verified
 * against the engine rather than reasoned: for L = $1,039,200, r = 6.5%,
 * n = 360 the monthly payment is $6,568.4509 and the year-10 balance is
 * $880,993.51 (QA-05); a pure interest-only loan pays $67,548 a year with no
 * principal reduction before its stated transition (QA-04).
 */
describe('buildLoanLedger', () => {
  const L = 1_039_200;

  it('reproduces the audited P&I payment and the monthly-consistent year-10 balance (QA-05)', () => {
    const ledger = buildLoanLedger({ loanAmount: L, annualRatePercent: 6.5, termYears: 30 });
    expect(ledger.loanType).toBe('principal_interest');
    expect(ledger.firstMonthlyPayment).toBeCloseTo(6_568.4509, 3);
    expect(ledgerYear(ledger, 10)!.closingBalance).toBeCloseTo(880_993.51, 1);
    // The audit's other reconstruction points, to the cent.
    expect(ledgerYear(ledger, 1)!.closingBalance).toBeCloseTo(1_027_584.60, 1);
    expect(ledgerYear(ledger, 5)!.closingBalance).toBeCloseTo(972_805.28, 1);
    // Every year foots: opening + interest − payments = closing.
    for (const y of ledger.years) {
      expect(y.openingBalance + y.interest - y.payments).toBeCloseTo(y.closingBalance, 6);
    }
    expect(ledger.years[29].closingBalance).toBeCloseTo(0, 4);
    expect(ledger.totalInterest).toBeCloseTo(6_568.4509 * 360 - L, 0);
  });

  it('the annual-accrual shortcut the report used is NOT what this produces', () => {
    const ledger = buildLoanLedger({ loanAmount: L, annualRatePercent: 6.5, termYears: 30 });
    let annualShortcut = L;
    for (let y = 1; y <= 10; y += 1) annualShortcut = annualShortcut * 1.065 - 6_568.4509 * 12;
    expect(annualShortcut).toBeCloseTo(887_071.83, 0);
    expect(ledgerYear(ledger, 10)!.closingBalance).toBeLessThan(annualShortcut - 6_000);
  });

  it('an interest-only loan pays interest alone for its period and amortises after (QA-04)', () => {
    const ledger = buildLoanLedger({ loanAmount: L, annualRatePercent: 6.5, termYears: 30, loanType: 'interest_only', interestOnlyYears: 5 });
    expect(ledger.firstMonthlyPayment).toBeCloseTo(L * 0.065 / 12, 6);
    expect(ledgerYear(ledger, 1)!.payments).toBeCloseTo(67_548, 0);
    expect(ledgerYear(ledger, 1)!.principal).toBe(0);
    expect(ledgerYear(ledger, 5)!.closingBalance).toBe(L);
    expect(ledgerYear(ledger, 5)!.interestOnly).toBe(true);
    expect(ledgerYear(ledger, 6)!.interestOnly).toBe(false);
    expect(ledgerYear(ledger, 6)!.principal).toBeGreaterThan(0);
    expect(ledger.amortisingMonthlyPayment).toBeCloseTo(amortisingPayment(L, 0.065 / 12, 300), 6);
    expect(ledger.years[29].closingBalance).toBeCloseTo(0, 4);
    expect(describeLoanStructure(ledger)).toBe('Interest only for 5 years, then principal and interest over the remaining 25 years (30-year term)');
  });

  it('an interest-only label with no period is a P&I schedule — the label alone changes nothing', () => {
    const ledger = buildLoanLedger({ loanAmount: L, annualRatePercent: 6.5, termYears: 30, loanType: 'interest_only', interestOnlyYears: 0 });
    expect(ledger.interestOnlyYears).toBe(0);
    expect(ledger.firstMonthlyPayment).toBeCloseTo(6_568.4509, 3);
    expect(describeLoanStructure(ledger)).toBe('Principal and interest over 30 years');
  });

  it('handles a zero rate and caps an interest-only period inside the term', () => {
    const zero = buildLoanLedger({ loanAmount: 120_000, annualRatePercent: 0, termYears: 10 });
    expect(zero.firstMonthlyPayment).toBe(1_000);
    expect(zero.years[9].closingBalance).toBeCloseTo(0, 6);
    const capped = buildLoanLedger({ loanAmount: L, annualRatePercent: 6.5, termYears: 5, loanType: 'interest_only', interestOnlyYears: 40 });
    expect(capped.interestOnlyYears).toBe(4);
    expect(capped.years[4].closingBalance).toBeCloseTo(0, 4);
  });
});

describe('an interest-only loan whose term nobody recorded', () => {
  /*
   * 262 Pallas Street, regenerated 17 Sep 2026. The operator's overrides said
   * `loanType: 'interest_only'` and carried no `interestOnlyPeriodYears`, so
   * the generator omitted `interestOnlyYears` entirely — and this module read
   * the absence as a zero. The stored ledger came back
   * `loanType: "interest_only"` beside `structure: "Principal and interest over
   * 30 years"` and `annualPayment: 34,890`, which is the P&I figure; the
   * interest-only one is $29,900. One object, two products.
   *
   * The Cash Flow report never had this: `readBaseFinancials` has assumed five
   * years since QA-04 and disclosed it. Two modules describing one loan were
   * answering differently, so the constant now lives here and that module
   * imports it.
   */
  const L = 460_000;

  it('runs the product the loan says it is, on the ordinary term', () => {
    const ledger = buildLoanLedger({ loanAmount: L, annualRatePercent: 6.5, termYears: 30, loanType: 'interest_only' });
    expect(ledger.interestOnlyYears).toBe(ASSUMED_INTEREST_ONLY_YEARS);
    expect(ledger.interestOnlyYearsAssumed).toBe(true);
    expect(ledgerYear(ledger, 1)!.payments).toBeCloseTo(L * 0.065, 0); // $29,900, not $34,890
    expect(ledgerYear(ledger, 1)!.principal).toBe(0);
    expect(ledger.years[29].closingBalance).toBeCloseTo(0, 4);
  });

  it('says in the sentence that the term was assumed', () => {
    const assumed = buildLoanLedger({ loanAmount: L, annualRatePercent: 6.5, termYears: 30, loanType: 'interest_only' });
    expect(describeLoanStructure(assumed))
      .toBe('Interest only for 5 years (term not recorded; assumed), then principal and interest over the remaining 25 years (30-year term)');
    // A term somebody DID record is never dressed as an assumption.
    const stated = buildLoanLedger({ loanAmount: L, annualRatePercent: 6.5, termYears: 30, loanType: 'interest_only', interestOnlyYears: 3 });
    expect(stated.interestOnlyYearsAssumed).toBe(false);
    expect(describeLoanStructure(stated)).not.toMatch(/assumed/);
  });

  it('leaves a recorded zero alone — "none" and "not recorded" are different statements', () => {
    for (const interestOnlyYears of [0, null]) {
      const ledger = buildLoanLedger({ loanAmount: L, annualRatePercent: 6.5, termYears: 30, loanType: 'interest_only', interestOnlyYears });
      // null is an absence, 0 is a statement.
      if (interestOnlyYears === 0) {
        expect(ledger.interestOnlyYears).toBe(0);
        expect(ledger.interestOnlyYearsAssumed).toBe(false);
        expect(describeLoanStructure(ledger)).toBe('Principal and interest over 30 years');
      } else {
        expect(ledger.interestOnlyYears).toBe(ASSUMED_INTEREST_ONLY_YEARS);
        expect(ledger.interestOnlyYearsAssumed).toBe(true);
      }
    }
  });

  it('changes nothing for a principal-and-interest loan', () => {
    const pi = buildLoanLedger({ loanAmount: L, annualRatePercent: 6.5, termYears: 30 });
    expect(pi.interestOnlyYears).toBe(0);
    expect(pi.interestOnlyYearsAssumed).toBe(false);
  });
});

describe('the one path the calculator service actually uses', () => {
  /*
   * `buildLoanLedger` drew the distinction between "no interest-only term was
   * recorded" and "the term is zero", and `ledgerForInput` — the only way
   * `financial-calculator-service` reaches it — erased that distinction one
   * line earlier with `input.interestOnlyYears ?? 0`.
   *
   * Measured on the 17 Sep 2026 regeneration of 262 Pallas Street, AFTER the
   * ledger fix shipped: `loanType: "interest_only"`, `interestOnlyPeriod: 0`,
   * `interestOnlyPeriodAssumed: false`, `structure: "Principal and interest
   * over 30 years"`, `annualPayment: 34,890`. A default at the boundary makes
   * a careful rule downstream unreachable.
   */
  const base = { propertyValue: 575_000, deposit: 115_000, loanTerm: 30, interestRate: 6.5 };

  it('assumes and discloses when the term is absent', async () => {
    const { ledgerForInput } = await import('@/lib/reports/investment/financialEngine.pure');
    for (const input of [
      { ...base, loanType: 'interest_only' },
      { ...base, loanType: 'interest_only', interestOnlyYears: null },
    ]) {
      const ledger = ledgerForInput(input as never);
      expect(ledger.interestOnlyYears, JSON.stringify(input)).toBe(ASSUMED_INTEREST_ONLY_YEARS);
      expect(ledger.interestOnlyYearsAssumed).toBe(true);
      // $29,900, not the $34,890 the report printed.
      expect(ledgerYear(ledger, 1)!.payments).toBeCloseTo(460_000 * 0.065, 0);
      expect(describeLoanStructure(ledger)).toMatch(/term not recorded; assumed/);
    }
  });

  it('still honours a recorded zero and a recorded term', async () => {
    const { ledgerForInput } = await import('@/lib/reports/investment/financialEngine.pure');
    const zero = ledgerForInput({ ...base, loanType: 'interest_only', interestOnlyYears: 0 } as never);
    expect(zero.interestOnlyYears).toBe(0);
    expect(zero.interestOnlyYearsAssumed).toBe(false);
    expect(describeLoanStructure(zero)).toBe('Principal and interest over 30 years');
    const three = ledgerForInput({ ...base, loanType: 'interest_only', interestOnlyYears: 3 } as never);
    expect(three.interestOnlyYears).toBe(3);
    expect(three.interestOnlyYearsAssumed).toBe(false);
  });

  it('changes nothing for a principal-and-interest loan', async () => {
    const { ledgerForInput } = await import('@/lib/reports/investment/financialEngine.pure');
    const pi = ledgerForInput({ ...base } as never);
    expect(pi.interestOnlyYears).toBe(0);
    expect(pi.interestOnlyYearsAssumed).toBe(false);
  });
});

/**
 * A stored loan block that carries no structure sentence.
 *
 * `financial-calculator-service` has published `loanDetails.structure` since
 * the ledger was wired into it on 15 Sep 2026, and `financialChapters` prints
 * it in the row under "Loan type" so that QA-04 — an interest-only label over
 * principal-and-interest figures — reads as one reconciled fact. Measured on
 * 19 Sep 2026, the field is absent on 92 of 92 stored reports holding a loan
 * block, so on every one of them that row does not print at all and a client
 * is left with the contradiction the row exists to reconcile.
 */
describe('describeStoredLoanStructure', () => {
  const cowra = {
    loanAmount: 444_000,
    interestRate: 6.5,
    loanTerm: 30,
    loanType: 'interest_only',
    interestOnlyPeriod: 2,
    monthlyPayment: 2_806.382024308766,
  };

  it('names the principal-and-interest schedule the figures were built on, and the label it contradicts', async () => {
    const { describeStoredLoanStructure } = await import('@/lib/reports/investment/loanLedger.pure');
    const read = describeStoredLoanStructure(cowra)!;
    expect(read.basis).toBe('figures_contradict_label');
    expect(read.figuresProduct).toBe('principal_interest');
    // BOTH halves are stated. Neither is corrected: the loan offer settles
    // which one is right and this module has never seen it.
    expect(read.structure).toContain('Principal and interest over 30 years');
    expect(read.structure).toContain('interest only for 2 years');
    expect(read.structure).toContain('do not reflect');
  });

  it('is decided by the figures, not by the label — the arbiter is the stored repayment', async () => {
    const { describeStoredLoanStructure, buildLoanLedger } = await import('@/lib/reports/investment/loanLedger.pure');
    // The stored repayment agrees with the P&I schedule to the cent, and is
    // $401 away from what the record's own stated product would repay.
    const stated = buildLoanLedger({ loanAmount: 444_000, annualRatePercent: 6.5, termYears: 30, loanType: 'interest_only', interestOnlyYears: 2 });
    const pi = buildLoanLedger({ loanAmount: 444_000, annualRatePercent: 6.5, termYears: 30 });
    expect(Math.abs(cowra.monthlyPayment - pi.firstMonthlyPayment)).toBeLessThan(0.01);
    expect(Math.abs(cowra.monthlyPayment - stated.firstMonthlyPayment)).toBeGreaterThan(400);

    // Give the same record an interest-only repayment and the same function
    // reports the label as sound, with no contradiction sentence.
    const consistent = describeStoredLoanStructure({ ...cowra, monthlyPayment: stated.firstMonthlyPayment })!;
    expect(consistent.basis).toBe('stated');
    expect(consistent.structure).toBe(describeLoanStructure(stated));
    expect(consistent.structure).not.toContain('do not reflect');
  });

  it('says an assumed interest-only term was assumed, on either branch', async () => {
    const { describeStoredLoanStructure } = await import('@/lib/reports/investment/loanLedger.pure');
    const noTerm = { ...cowra, interestOnlyPeriod: undefined, monthlyPayment: 2_781.10, loanAmount: 440_000 };
    const read = describeStoredLoanStructure(noTerm)!;
    expect(read.basis).toBe('figures_contradict_label');
    expect(read.structure).toContain('no interest-only term recorded');
    expect(read.structure).not.toMatch(/interest only for \d/);
  });

  it('derives nothing where the repayment matches neither schedule', async () => {
    const { describeStoredLoanStructure } = await import('@/lib/reports/investment/loanLedger.pure');
    // `healFinanceIdentity`'s rule: a repair that cannot say which figure is
    // sound is just a third opinion.
    expect(describeStoredLoanStructure({ ...cowra, monthlyPayment: 3_500 })).toBeNull();
    // And a loan already recorded as principal and interest has one schedule,
    // so a repayment that does not match it does not match anything here.
    expect(describeStoredLoanStructure({ ...cowra, loanType: 'principal_interest', monthlyPayment: 2_405 })).toBeNull();
  });

  it('derives nothing without the terms to run a schedule on', async () => {
    const { describeStoredLoanStructure } = await import('@/lib/reports/investment/loanLedger.pure');
    expect(describeStoredLoanStructure(null)).toBeNull();
    expect(describeStoredLoanStructure({ ...cowra, loanAmount: undefined })).toBeNull();
    expect(describeStoredLoanStructure({ ...cowra, interestRate: undefined })).toBeNull();
    expect(describeStoredLoanStructure({ ...cowra, monthlyPayment: 0 })).toBeNull();
  });
});
