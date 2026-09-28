/**
 * The engine's advice, in words a client reads (`advice.pure.ts`).
 *
 * Read off two production Snapshots on 28 Sep 2026: "Consider paying down
 * high-interest debts first" printed to a client with no debt at all, and
 * "Monthly expenses exceed income - unable to service new debt" to a client with
 * no income recorded, where the thing to do is record it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  HIGH_INTEREST_DEBT,
  RECORD_INCOME_ADVICE,
  isKnownAdvice,
  presentAdvice,
  presentAdviceList,
  type AdviceFacts,
} from '../advice.pure';

const ENGINE = readFileSync(
  resolve(__dirname, '../../../../../supabase/functions/calculate-borrowing-capacity/index.ts'),
  'utf8',
);

/**
 * Every string the engine pushes into `recommendations` or `warnings`, with a
 * template's `${…}` replaced by a plausible value so it can be matched.
 */
function engineAdviceStrings(): string[] {
  const out: string[] = [];
  for (const m of ENGINE.matchAll(/(?:recommendations|warnings)\.push\((["'`])([\s\S]*?)\1\)/g)) {
    out.push(m[2].replace(/\$\{fmtCurrencyServer\([^}]*\)\}/g, '$1,000').replace(/\$\{[^}]*\}/g, '6'));
  }
  return out;
}

const FACTS: AdviceFacts = {
  grossIncome: 164_400,
  commitmentsMonthly: 2_450,
  liabilityCount: 1,
  hasHighInterestDebt: false,
  dti: 9.27,
  surplusMonthly: 3_709,
};

describe('every engine sentence has a client wording', () => {
  const strings = engineAdviceStrings();

  it('finds the engine’s advice (the scan is not vacuous)', () => {
    expect(strings.length).toBeGreaterThanOrEqual(14);
  });

  it.each(strings)('knows "%s"', (s) => {
    expect(isKnownAdvice(s), `a new engine sentence needs a wording in advice.pure.ts: ${s}`).toBe(true);
  });

  it('never prints the engine’s " - " joins or its market claim', () => {
    for (const s of strings) {
      const said = presentAdvice(s, FACTS);
      if (said === null) continue;
      expect(said).not.toMatch(/\s-\s/);
      expect(said).not.toMatch(/while rates are favou?rable/i);
    }
  });
});

describe('advice the record contradicts is not printed', () => {
  it('does not tell a client with no consumer debt to pay down high-interest debt', () => {
    // A mortgage is not high-interest debt; no debt at all is not either.
    expect(presentAdvice('Consider paying down high-interest debts first', FACTS)).toBeNull();
    expect(presentAdvice('Consider paying down high-interest debts first', {
      ...FACTS, hasHighInterestDebt: true,
    })).toMatch(/high-interest debt/);
    expect(HIGH_INTEREST_DEBT.test('Credit Card')).toBe(true);
    expect(HIGH_INTEREST_DEBT.test('Mortgage')).toBe(false);
  });

  it('names the ratio when the band is limited beside a positive surplus', () => {
    expect(presentAdvice('Limited borrowing capacity - focus on strengthening financial position', FACTS))
      .toMatch(/debt-to-income ratio/);
    expect(presentAdvice('Limited borrowing capacity - focus on strengthening financial position', {
      ...FACTS, surplusMonthly: -200,
    })).toMatch(/More income, or lower expenses/);
  });

  it('states the DTI the record holds', () => {
    expect(presentAdvice('DTI ratio exceeds most lender thresholds', FACTS))
      .toBe('At 9.3x, the debt-to-income ratio is above the 7x that most lenders accept.');
  });
});

describe('a record with no income', () => {
  const NONE: AdviceFacts = {
    grossIncome: 0, commitmentsMonthly: 0, liabilityCount: 0, hasHighInterestDebt: false, dti: null, surplusMonthly: -2_100,
  };

  it('leads with recording the income, and drops what cannot apply', () => {
    expect(presentAdviceList([
      'Limited borrowing capacity - focus on strengthening financial position',
      'Consider paying down high-interest debts first',
    ], NONE, { leadWithIncome: true })).toEqual([RECORD_INCOME_ADVICE]);
    expect(presentAdviceList(['Monthly expenses exceed income - unable to service new debt'], NONE)).toEqual([]);
  });
});

describe('an unrecognised sentence', () => {
  it('is printed tidied rather than lost', () => {
    expect(presentAdvice('Something new - worth reading', FACTS)).toBe('Something new — worth reading');
    expect(presentAdvice('  ', FACTS)).toBeNull();
  });

  it('is printed once', () => {
    expect(presentAdviceList(['A - b', 'A - b'], FACTS)).toEqual(['A — b']);
  });
});
