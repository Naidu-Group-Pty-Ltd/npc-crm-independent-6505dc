/**
 * Does the document agree with itself?
 *
 * Every case here is one of the four contradictions read off the five PDFs
 * supplied for acceptance on 18 September 2026, written with the figures as
 * they printed. They are regressions in the strict sense: each one FAILED
 * before `documentConsistency.pure.ts` existed, on the document a client was
 * about to be given.
 *
 * The negative cases matter as much. A weekly rent, a weekly repayment and a
 * weekly cash position all print as "$N a week"; a comparable sale legitimately
 * carries another house's bedroom count; a sensitivity table legitimately
 * prints several annual positions. A rule that fires on those is a false
 * caveat, and a false caveat teaches people to dismiss the warning.
 */
import { describe, expect, it } from 'vitest';
import {
  findAttributeContradictions,
  findDocumentContradictions,
  findLoanBasisContradiction,
  findOverallAssessmentDisagreements,
  findWeeklyCashDisagreements,
} from '../investment/documentConsistency.pure';
import { runQAValidation } from '../compassQAValidator';

const rules = (md: string) => findDocumentContradictions(md).map((f) => f.rule);

// ── 1. the weekly cash position ───────────────────────────────────────────

describe('two weekly cash positions in one document', () => {
  /** As printed: page 12 against page 17 of the Financial Analysis. */
  const MEASURED = [
    '## Year One Position',
    '',
    '| Cash position | Recorded value |',
    '| --- | --- |',
    '| Weekly net position | -$467 |',
    '',
    '## Holding the Property',
    '',
    'The investor funds a weekly shortfall of $450 across the first year.',
  ].join('\n');

  it('catches the pair that shipped', () => {
    const found = findWeeklyCashDisagreements(MEASURED);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe('weekly-cash-position-disagrees');
    expect(found[0].severity).toBe('error');
  });

  it('quotes both statements back, so the remedy is locatable', () => {
    const [f] = findWeeklyCashDisagreements(MEASURED);
    expect(f.statements.join(' ')).toContain('467');
    expect(f.statements.join(' ')).toContain('450');
  });

  it('names the remedy as a binding or a label, never a recalculation', () => {
    const [f] = findWeeklyCashDisagreements(MEASURED);
    expect(f.message).toContain('same approved financial output');
    expect(f.message).toContain('say so in the label');
    expect(f.message).not.toMatch(/recalculat|correct the figure to/i);
  });

  it('a labelled second basis is a WARNING, not an error', () => {
    /*
     * Two figures on stated, different bases is a distinction a reader can
     * follow. It is still disclosed — two weekly cash figures is worth a look
     * either way — but it does not fail the document.
     */
    const md = [
      '| Weekly net position (50 of 52 weeks let) | -$467 |',
      '',
      'On the contractual rent, before the vacancy allowance, the weekly shortfall is $450.',
    ].join('\n');
    const [f] = findWeeklyCashDisagreements(md);
    expect(f.severity).toBe('warning');
  });

  it('agrees to the dollar and says nothing', () => {
    const md = '| Weekly net position | -$467 |\n\nA weekly shortfall of $467 is funded by the investor.';
    expect(findWeeklyCashDisagreements(md)).toEqual([]);
  });

  it('a weekly RENT is not a weekly cash position', () => {
    const md = '| Weekly rent | $442 |\n\n| Weekly net position | -$467 |';
    expect(findWeeklyCashDisagreements(md)).toEqual([]);
  });

  it('a weekly REPAYMENT is not a weekly cash position', () => {
    const md = '| Weekly repayment | $555 |\n\n| Weekly net position | -$467 |';
    expect(findWeeklyCashDisagreements(md)).toEqual([]);
  });

  it('a break-even rent is not a weekly cash position', () => {
    const md = 'The position is $467 a week short, so break-even rent is $909 a week.\n\n'
      + '| Weekly net position | -$467 |';
    expect(findWeeklyCashDisagreements(md)).toEqual([]);
  });

  it('one figure alone raises nothing', () => {
    expect(findWeeklyCashDisagreements('| Weekly net position | -$467 |')).toEqual([]);
  });
});

// ── 2. the loan basis ─────────────────────────────────────────────────────

describe('an interest-only loan with an amortising repayment', () => {
  /** As printed: $444,000 at 6.5%, first-year repayments $33,677. */
  const MEASURED = [
    '| Debt and funding | Recorded value |',
    '| --- | --- |',
    '| Loan amount | $444,000 |',
    '| Interest rate assumed for modelling | 6.50% |',
    '| Loan structure | Interest only for 5 years |',
    '',
    '| Year-1 repayments | $33,677 |',
  ].join('\n');

  it('catches the loan that shipped', () => {
    const found = findLoanBasisContradiction(MEASURED);
    expect(found).toHaveLength(1);
    expect(found[0].rule).toBe('interest-only-repayment-is-amortising');
    expect(found[0].severity).toBe('error');
  });

  it('states the interest a year on that balance, and the excess', () => {
    const [f] = findLoanBasisContradiction(MEASURED);
    // 444,000 × 6.5% = 28,860; 33,677 − 28,860 = 4,817.
    expect(f.message).toContain('$28,860');
    expect(f.message).toContain('$4,817');
  });

  it('refuses to name the remedy as changing the assumption', () => {
    const [f] = findLoanBasisContradiction(MEASURED);
    expect(f.message).toContain('Establish it at the producer');
    expect(f.message).toContain('do not change the accepted assumption');
  });

  it('the interest-only figure itself passes', () => {
    const md = MEASURED.replace('$33,677', '$28,860');
    expect(findLoanBasisContradiction(md)).toEqual([]);
  });

  it('a principal-and-interest loan is not judged by this rule at all', () => {
    const md = MEASURED.replace('Interest only for 5 years', 'Principal and interest over 30 years');
    expect(findLoanBasisContradiction(md)).toEqual([]);
  });

  it('a MONTHLY figure is not an annual one', () => {
    const md = MEASURED.replace('| Year-1 repayments | $33,677 |', '| Year-1 monthly repayment | $2,806 |');
    expect(findLoanBasisContradiction(md)).toEqual([]);
  });

  it('says nothing when the document does not state both the balance and the rate', () => {
    const md = '| Loan structure | Interest only for 5 years |\n\n| Year-1 repayments | $33,677 |';
    expect(findLoanBasisContradiction(md)).toEqual([]);
  });

  it('a growth or yield percentage is never read as the lending rate', () => {
    const md = [
      '| Loan amount | $444,000 |',
      '| Capital growth assumed | 6.50% |',
      '| Gross rental yield | 6.50% |',
      '| Loan structure | Interest only for 5 years |',
      '| Year-1 repayments | $33,677 |',
    ].join('\n');
    expect(findLoanBasisContradiction(md)).toEqual([]);
  });
});

// ── 3. the overall assessment ─────────────────────────────────────────────

describe('two overall assessments in one document', () => {
  /** As printed: the Briefing's dashboard against its own score block. */
  const MEASURED = [
    '## Investment Dashboard',
    '',
    '| Overall investment score | B · 62 |',
    '',
    '## Overall Investment Score',
    '',
    'Total Score: 60/100 (Overall Risk Score)',
  ].join('\n');

  it('catches the pair that shipped', () => {
    const found = findOverallAssessmentDisagreements(MEASURED);
    expect(found.some((f) => f.rule === 'overall-assessment-disagrees')).toBe(true);
    expect(found[0].severity).toBe('error');
  });

  it('names the legitimate separate metric rather than forbidding it', () => {
    const [f] = findOverallAssessmentDisagreements(MEASURED);
    expect(f.message).toContain('separate metric');
    expect(f.message).toMatch(/risk score/i);
  });

  it('one score repeated is one score', () => {
    const md = '| Overall investment score | 62 |\n\nThe overall investment score is 62/100.';
    expect(findOverallAssessmentDisagreements(md)).toEqual([]);
  });

  it('a dimension score under its own name is not the overall one', () => {
    const md = '| Overall investment score | 62/100 |\n\n| Location | 71/100 |\n| Growth | 55/100 |';
    expect(findOverallAssessmentDisagreements(md)).toEqual([]);
  });

  it('two different grades are an error in their own right', () => {
    const md = '| Overall investment grade | Grade B |\n\nThe investment grade is rated C.';
    const found = findOverallAssessmentDisagreements(md);
    expect(found.map((f) => f.message).join(' ')).toMatch(/different overall grades/);
  });

  it('a withheld grade raises nothing', () => {
    const md = 'The overall investment score is withheld: three of five dimensions could not be measured.';
    expect(findOverallAssessmentDisagreements(md)).toEqual([]);
  });
});

// ── 4. an attribute both asserted and withheld ────────────────────────────

describe('a configuration both stated and said to be missing', () => {
  /** As printed on the Cowra lineage. */
  const MEASURED = [
    '| Bedrooms | 3 |',
    '| Bathrooms | 1 |',
    '',
    'Exact bedroom and bathroom details are not provided in the record supplied for this property.',
  ].join('\n');

  it('catches both attributes', () => {
    const found = findAttributeContradictions(MEASURED);
    expect(found.map((f) => f.rule)).toEqual(
      expect.arrayContaining(['attribute-asserted-and-withheld']),
    );
    expect(found.length).toBeGreaterThanOrEqual(2);
  });

  it('says a neighbour cannot establish the subject\'s configuration', () => {
    const [f] = findAttributeContradictions(MEASURED);
    expect(f.message).toContain('neighbouring property');
    expect(f.message).toContain('cannot establish this property');
  });

  it('a comparable sale\'s bedroom count is not the subject\'s', () => {
    const md = 'Bedrooms are not stated in the record.\n\n'
      + '| Comparable | Beds |\n| --- | --- |\n| 119 Redfern Street | 3 |';
    expect(findAttributeContradictions(md)).toEqual([]);
  });

  it('withheld everywhere is consistent', () => {
    expect(findAttributeContradictions('Bedrooms and bathrooms are not stated in the record.')).toEqual([]);
  });

  it('stated everywhere is consistent', () => {
    expect(findAttributeContradictions('| Bedrooms | 3 |\n\nThe three-bedroom house sits on a level lot.')).toEqual([]);
  });
});

// ── the whole reading, and the path it reaches ────────────────────────────

describe('the reading as a whole', () => {
  it('a clean document raises nothing', () => {
    const md = '# Report\n\n## Executive Verdict\n\nThe property is a detached house on a level lot.\n';
    expect(findDocumentContradictions(md)).toEqual([]);
    expect(findDocumentContradictions('')).toEqual([]);
  });

  it('all four contradictions in one document are all four reported', () => {
    const md = [
      '| Weekly net position | -$467 |',
      'The investor funds a weekly shortfall of $450.',
      '| Loan amount | $444,000 |',
      '| Interest rate assumed for modelling | 6.50% |',
      '| Loan structure | Interest only for 5 years |',
      '| Year-1 repayments | $33,677 |',
      '| Overall investment score | B · 62 |',
      'Total Score: 60/100 (Overall Risk Score)',
      '| Bedrooms | 3 |',
      'Exact bedroom details are not provided in the record.',
    ].join('\n\n');
    expect(new Set(rules(md))).toEqual(new Set([
      'weekly-cash-position-disagrees',
      'interest-only-repayment-is-amortising',
      'overall-assessment-disagrees',
      'attribute-asserted-and-withheld',
    ]));
  });

  it('a fenced code block is not a statement', () => {
    const md = '```\n| Weekly net position | -$467 |\n| Weekly net position | -$450 |\n```';
    expect(findDocumentContradictions(md)).toEqual([]);
  });

  it('the QA validator carries it, at every tier', () => {
    const md = '# Report\n\n## Executive Verdict\n\n| Weekly net position | -$467 |\n\n'
      + 'The investor funds a weekly shortfall of $450.\n';
    for (const tier of ['compass', 'financial', 'strategic', 'briefing', 'snapshot']) {
      const report = runQAValidation(md, tier);
      expect(report.findings.map((f) => f.rule), tier).toContain('weekly-cash-position-disagrees');
      expect(report.passed, tier).toBe(false);
    }
  });
});

describe('both copies of the validator carry it', () => {
  it('the edge copy and the browser copy both import the one implementation', async () => {
    const { readFileSync } = await import('node:fs');
    const edge = readFileSync('supabase/functions/_shared/compassQAValidator.ts', 'utf8');
    const browser = readFileSync('src/lib/reports/compassQAValidator.ts', 'utf8');
    for (const src of [edge, browser]) {
      expect(src).toContain('findDocumentContradictions');
      expect(src).toContain('documentConsistency.pure');
    }
    // Imported, never restated: a detector holding its own copy of a rule
    // reports one thing while the module enforces another.
    expect(edge).not.toContain('interest-only-repayment-is-amortising:');
  });

  it('the module computes one thing only, and says which', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      'supabase/functions/_shared/reports/investment/documentConsistency.pure.ts', 'utf8');
    // The header's first rule, and the guard that keeps it true: exactly one
    // arithmetic expression, the definition of an interest-only payment.
    expect(src).toContain('computes nothing new');
    expect(src).toContain('const interestOnlyAnnual = principal * (rate / 100);');
    // Judged over the CODE. The header is prose and uses `**` for emphasis, so
    // a guard that reads the whole file reports its own documentation.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of ['Math.pow', 'Math.exp', 'growthRate', 'taxRate', 'occupancyWeeks']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    // No exponentiation: compounding is a model, and this module has no
    // business holding one.
    expect(code).not.toMatch(/\*\*/);
  });
});
