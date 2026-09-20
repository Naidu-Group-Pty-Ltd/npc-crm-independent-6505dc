import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CGR_DIVERGENCE_POINTS,
  growthDivergenceRule,
  growthReadingsDiverge,
} from '../../../../supabase/functions/_shared/reports/market/marketFactBlocks.pure.ts';
import {
  describeStoredLoanStructure,
} from '../../../../supabase/functions/_shared/reports/investment/loanLedger.pure.ts';

/**
 * The two questions the programme named and deliberately did not turn into
 * rules, because the stored corpus held no case to test either against.
 *
 * They are answered here with CLEARLY LABELLED FIXTURES. A fixture is not a
 * property acceptance and is not offered as one — it is how a rule gets a
 * positive and a negative case before the first real document needs it, which
 * is the thing that was missing when both were left open.
 */

// ── Fixture A ──────────────────────────────────────────────────────────────
// SYNTHETIC. A report whose projections were accepted at 3.0% a year while a
// publisher's series measured 5.4% over its own past window. No stored report
// has this shape; the Cowra row it is modelled on carries an accepted 0.1%
// and NOTHING retrieved, which is why rule 1 closed it without comparing.
const FIXTURE_A_DIVERGENT = {
  acceptedPercent: 3.0,
  retrievedPercent: 5.4,
  retrievedLabel: "Queensland Government Statistician's Office, detached dwelling median, Cowra LGA, 2015-2025",
};

// ── Fixture B ──────────────────────────────────────────────────────────────
// SYNTHETIC. The same report where the two readings agree within rounding.
const FIXTURE_B_AGREEING = { acceptedPercent: 3.0, retrievedPercent: 3.2, retrievedLabel: 'the same series' };

describe('a retrieved growth reading that disagrees with the accepted rate', () => {
  it('is disclosed rather than reconciled', () => {
    const rule = growthDivergenceRule(FIXTURE_A_DIVERGENT)!;
    expect(rule).toBeTruthy();
    expect(rule).toContain('3%');
    expect(rule).toContain('5.4%');
    expect(rule).toContain("Queensland Government Statistician's Office");
  });

  it('forbids every way of silently changing the model', () => {
    const rule = growthDivergenceRule(FIXTURE_A_DIVERGENT)!;
    expect(rule).toMatch(/may not replace one with the other/);
    expect(rule).toMatch(/may not average them/);
    expect(rule).toMatch(/may not present the retrieved reading as a forecast/);
    expect(rule).toMatch(/may not quietly use/);
  });

  it('says which number the projections are actually built on', () => {
    expect(growthDivergenceRule(FIXTURE_A_DIVERGENT)!).toMatch(/the modelling uses 3%/);
  });

  it('leaves the reconciliation to the adviser rather than making it', () => {
    expect(growthDivergenceRule(FIXTURE_A_DIVERGENT)!).toMatch(/the adviser's judgement, not this report's/);
  });

  it('says nothing at all where the two agree', () => {
    expect(growthReadingsDiverge(FIXTURE_B_AGREEING)).toBe(false);
    expect(growthDivergenceRule(FIXTURE_B_AGREEING)).toBeNull();
  });

  it('says nothing where either reading is absent — a rule on every document is skipped', () => {
    expect(growthDivergenceRule({ acceptedPercent: 3, retrievedPercent: null })).toBeNull();
    expect(growthDivergenceRule({ acceptedPercent: null, retrievedPercent: 5.4 })).toBeNull();
    expect(growthDivergenceRule({ acceptedPercent: null, retrievedPercent: null })).toBeNull();
    expect(growthDivergenceRule({ acceptedPercent: Number.NaN, retrievedPercent: 5.4 })).toBeNull();
  });

  it('measures the gap in percentage POINTS, not relatively', () => {
    // A relative band on a small rate rejects ordinary rounding: 0.1 against
    // 3 is 2,900% relatively and is not a rounding disagreement at all.
    expect(CGR_DIVERGENCE_POINTS).toBe(0.5);
    expect(growthReadingsDiverge({ acceptedPercent: 0.1, retrievedPercent: 3.0 })).toBe(true);
    expect(growthReadingsDiverge({ acceptedPercent: 7.0, retrievedPercent: 7.4 })).toBe(false);
    expect(growthReadingsDiverge({ acceptedPercent: 7.0, retrievedPercent: 7.5 })).toBe(true);
    // symmetric — which one is larger changes nothing
    expect(growthReadingsDiverge({ acceptedPercent: 5.4, retrievedPercent: 3.0 })).toBe(true);
  });
});

describe('condensation is governed by the same rules as the parent', () => {
  const condense = readFileSync(
    resolve(__dirname, '../../../../supabase/functions/condense-investment-report/index.ts'),
    'utf8',
  );

  /*
   * A condensation may not introduce a claim its parent did not make, and the
   * evidence available to the child is exactly the evidence available to the
   * parent — a Briefing is drawn from a Compass's ROW, not from a second
   * acquisition. This path carried its own hand-written prohibitions and had
   * ZERO occurrences of `claimSupportRules`, so a rule tightened for the
   * generator reached the parent and not the child.
   *
   * The corpus holds two condensed documents, from one parent, both predating
   * the current prompt — so the hazard could not be measured after the fact.
   * The fix is to stop there being two standards rather than to wait for a
   * case, and this is what fails if the two are ever separated again.
   */
  it('hands the condenser the generator\'s own claim rules', () => {
    expect(condense).toContain('claimSupportRules(');
    expect(condense).toContain('readEvidenceInventory(');
  });

  it('builds them from the PARENT\'s evidence, never from the child\'s', () => {
    expect(condense).toMatch(/claimSupportRules\(readEvidenceInventory\(parentReport/);
  });

  it('imports them from the one module, never a second copy', () => {
    expect(condense).toContain("from '../_shared/reports/investment/chartEvidence.pure.ts'");
  });
});

describe('a numerical inference never becomes a confirmed instruction', () => {
  /*
   * Measured: 92 of 92 parent rows carry `loanType: "interest_only"` beside a
   * `monthlyPayment` that is the principal-and-interest figure, and `structure`
   * is absent on every one. The read path derives a sentence from the FIGURES,
   * because the figures are what every projection in the document was built
   * on — but the borrower's actual product is a question for the loan offer,
   * and nothing here may answer it.
   */
  const CONTRADICTORY = {
    loanAmount: 444_000,
    interestRate: 6.5,
    loanTerm: 30,
    loanType: 'interest_only',
    // the P&I payment, which is what the record's own projections used
    monthlyPayment: 2806.4,
  };

  it('derives the schedule the figures were calculated on', () => {
    const d = describeStoredLoanStructure(CONTRADICTORY);
    expect(d).not.toBeNull();
    expect(d!.basis).toBe('figures_contradict_label');
    expect(d!.figuresProduct).toBe('principal_interest');
  });

  it('attributes it to the CALCULATION, never to the borrower', () => {
    const said = describeStoredLoanStructure(CONTRADICTORY)!.structure;
    expect(said).toContain('the schedule these repayments were calculated on');
    expect(said).not.toMatch(/\byou (have|hold|chose|selected)\b/i);
    expect(said).not.toMatch(/\b(confirmed|instructed|agreed)\b/i);
  });

  it('keeps the stated product on the page rather than erasing it', () => {
    const said = describeStoredLoanStructure(CONTRADICTORY)!.structure;
    expect(said).toMatch(/The record separately states/);
    expect(said).toMatch(/interest[- ]only/i);
    expect(said).toMatch(/which the repayment figures do not reflect/);
  });

  it('derives nothing where the label and the figures agree', () => {
    const agreeing = { ...CONTRADICTORY, loanType: 'principal_interest' };
    const d = describeStoredLoanStructure(agreeing);
    expect(d?.basis).toBe('stated');
    expect(d?.structure).not.toMatch(/do not reflect/);
  });

  it('derives nothing at all where the record holds no loan', () => {
    expect(describeStoredLoanStructure(null)).toBeNull();
    expect(describeStoredLoanStructure({})).toBeNull();
    expect(describeStoredLoanStructure({ loanAmount: 0, interestRate: 6.5, monthlyPayment: 1 })).toBeNull();
  });
});
