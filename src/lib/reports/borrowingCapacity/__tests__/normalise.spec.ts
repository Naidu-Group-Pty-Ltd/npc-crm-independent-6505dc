/**
 * Raw records in, one payload out.
 *
 * The cases below are the ones that broke something real: a `0` that three
 * generators read as `1`, a field name that four drafts of a fixture guessed
 * wrong, a subtraction against `undefined` that put `NaN` on a page, and a
 * colour keyed to the sign of a number rather than to what the number means.
 */
import { describe, expect, it } from 'vitest';

import { formatMeasure } from '@/lib/reportDesign/measure.pure';
import {
  AUDIT_CATEGORY_ORDER,
  buildSnapshot,
  describeAdjustments,
  toAssumptions,
  toAuditSection,
  toBand,
  toIncomeRow,
  toLiabilityRow,
  toScenarioRows,
} from '../normalise.pure';
import {
  SAMPLE_ASSESSMENT,
  SAMPLE_AUDIT_TRAIL,
  SAMPLE_CLIENT_NAME,
  SAMPLE_EXPLANATION,
  SAMPLE_SCENARIO_PRESETS,
} from './fixtures/sampleAssessment';

const snapshot = () =>
  buildSnapshot({
    clientName: SAMPLE_CLIENT_NAME,
    assessment: SAMPLE_ASSESSMENT,
    auditTrail: SAMPLE_AUDIT_TRAIL,
    explanation: SAMPLE_EXPLANATION,
    scenarioPresets: SAMPLE_SCENARIO_PRESETS,
  });

describe('income rows', () => {
  /**
   * The finding, and the reason this module exists at all.
   *
   * `const rate = item.shadingRate || item.custom_shading_rate ||
   * item.default_shading_rate || 1` — a lender counting **none** of an income
   * falls all the way through to `1` and is reported to the client as fully
   * assessed (F10).
   */
  it('keeps a shading rate of zero (F10)', () => {
    const row = toIncomeRow({ component: 'Unbanked cash', grossAmount: 9_000, shadingRate: 0, shadedAmount: 0 })!;
    expect(formatMeasure(row.shading)).toBe('0%');
    expect(formatMeasure(row.shaded)).toBe(`$0\u00A0pa`);

    // And the same value through the `||` chain the shipping code uses:
    const wrong = ({ shadingRate: 0 } as { shadingRate: number }).shadingRate || 1;
    expect(wrong).toBe(1);
  });

  it('reads the shape the engine writes', () => {
    const row = toIncomeRow({ component: 'Rental income', grossAmount: 20_000, shadingRate: 0.8, shadedAmount: 16_000 })!;
    expect(row.label).toBe('Rental income');
    expect(formatMeasure(row.gross)).toBe(`$20,000\u00A0pa`);
    expect(formatMeasure(row.shading)).toBe('80%');
    expect(formatMeasure(row.shaded)).toBe(`$16,000\u00A0pa`);
  });

  it('reads the older client_income_sources shape too', () => {
    const row = toIncomeRow({ source_name: 'PAYG salary', gross_annual_amount: 124_000, custom_shading_rate: 1 })!;
    expect(row.label).toBe('PAYG salary');
    expect(formatMeasure(row.gross)).toBe(`$124,000\u00A0pa`);
    expect(formatMeasure(row.shaded)).toBe(`$124,000\u00A0pa`);
  });

  it('derives the shaded amount when only the rate is recorded', () => {
    expect(formatMeasure(toIncomeRow({ component: 'Bonus', grossAmount: 21_200, shadingRate: 0.5 })!.shaded))
      .toBe(`$10,600\u00A0pa`);
  });

  it('drops a row with no gross amount rather than inventing a zero', () => {
    expect(toIncomeRow({ component: 'Nothing' })).toBeNull();
    expect(toIncomeRow(null)).toBeNull();
  });
});

describe('liability rows', () => {
  it('title-cases the kind and keeps the provider separate', () => {
    const row = toLiabilityRow({ type: 'credit_card', label: 'Example Bank', balance: 8_000, limit: 8_000, monthlyServicing: 240 })!;
    expect(row.kind).toBe('Credit Card');
    expect(row.provider).toBe('Example Bank');
    expect(formatMeasure(row.balance!)).toBe('$8,000');
    expect(formatMeasure(row.monthlyServicing)).toBe('$240/mo');
  });

  /** The producer writes the provider into `label`, which sometimes holds the kind. */
  it('does not repeat the kind as its own provider', () => {
    expect(toLiabilityRow({ type: 'mortgage', label: 'mortgage', balance: 1, monthlyServicing: 1 })!.provider).toBeNull();
    expect(toLiabilityRow({ type: 'Mortgage', label: 'Mortgage', balance: 1, monthlyServicing: 1 })!.provider).toBeNull();
  });

  it('distinguishes a zero balance from no balance', () => {
    expect(toLiabilityRow({ type: 'hecs', balance: 0, monthlyServicing: 180 })!.balance).not.toBeNull();
    expect(toLiabilityRow({ type: 'hecs', monthlyServicing: 180 })!.balance).toBeNull();
  });
});

describe('band', () => {
  it('maps the stored colour to the judgement it stands for', () => {
    expect(toBand('green')).toBe('strong');
    expect(toBand('amber')).toBe('moderate');
    expect(toBand('red')).toBe('limited');
  });

  it('reads an unrecognised value cautiously', () => {
    expect(toBand(undefined)).toBe('limited');
    expect(toBand('chartreuse')).toBe('limited');
  });
});

describe('audit section', () => {
  it('groups in the order the report shows, entries in sequence', () => {
    const audit = toAuditSection(SAMPLE_AUDIT_TRAIL)!;
    const categories = audit.groups.map((g) => g.category);
    expect(categories).toEqual(['income', 'expense', 'liability', 'policy']);
    // …which is the report's order with the empty categories removed.
    const expected = AUDIT_CATEGORY_ORDER.filter((c) => categories.includes(c));
    expect(categories).toEqual(expected);
    expect(audit.groups[0].rows.map((r) => r.seq)).toEqual([1, 2]);
  });

  it('carries the summary as measures', () => {
    const audit = toAuditSection(SAMPLE_AUDIT_TRAIL)!;
    expect(formatMeasure(audit.summary.incomeShading)).toBe('$14,600');
    expect(formatMeasure(audit.summary.transformations)).toBe('5');
  });

  it('is null when there is nothing to show', () => {
    expect(toAuditSection(undefined)).toBeNull();
    expect(toAuditSection({ entries: [] })).toBeNull();
  });

  it('renders the rate override as a rate and the liability delta as nothing', () => {
    const rows = toAuditSection(SAMPLE_AUDIT_TRAIL)!.groups.flatMap((g) => g.rows);
    const override = rows.find((r) => r.action === 'override_applied')!;
    expect(formatMeasure(override.raw)).toBe('6.15%');
    expect(override.direction).toBe('adverse');

    const liability = rows.find((r) => r.category === 'liability')!;
    expect(liability.delta).toBeNull();

    const profile = rows.find((r) => r.action === 'lender_profile_selected')!;
    expect(formatMeasure(profile.raw)).toBe('—');
    expect(profile.direction).toBe('neutral');
  });
});

describe('scenario adjustments', () => {
  /**
   * `si2.interestRate - bi.interestRate` where the base carries no
   * `interestRate` is `NaN`, and the shipping generator prints it. A
   * well-formed preset cannot produce that — `adjustedInputs` is typed as a
   * whole `BorrowingCapacityInput` — but "the type says it cannot happen" is
   * not a reason to subtract `undefined`.
   */
  it('never produces NaN from a half-populated preset', () => {
    const described = describeAdjustments({}, { interestRate: 7.15, grossAnnualIncome: 200_000 });
    expect(described.join(' ')).not.toContain('NaN');
    expect(described).toEqual([]);
  });

  it('describes each moved input in its own unit', () => {
    expect(
      describeAdjustments(
        { grossAnnualIncome: 100_000, monthlyCommitments: 1_310, interestRate: 6.15, loanTermYears: 30 },
        { grossAnnualIncome: 110_000, monthlyCommitments: 1_070, interestRate: 7.15, loanTermYears: 25 },
      ),
    ).toEqual(['Income +10%', 'Commitments -$240/mo', 'Rate +1.00%', 'Term -5 years']);
  });

  it('says nothing about an input that did not move', () => {
    expect(describeAdjustments({ interestRate: 6.15 }, { interestRate: 6.15 })).toEqual([]);
  });
});

describe('scenario rows', () => {
  const rows = toScenarioRows(SAMPLE_SCENARIO_PRESETS)!;

  it('puts the base case first and gives it no change', () => {
    expect(rows[0].name).toBe('Base Case (Original)');
    expect(rows[0].change).toBeNull();
  });

  it('measures each scenario against the base', () => {
    expect(formatMeasure(rows[1].change!)).toBe('$27,000');
    expect(formatMeasure(rows[2].change!)).toBe('-$81,000');
  });

  it('carries the band as a judgement, not a colour', () => {
    expect(rows.map((r) => r.band)).toEqual(['strong', 'strong', 'moderate']);
  });

  it('reads acquisition capacity as the object it is', () => {
    expect(rows[1].details).toContain('Purchase power: max $975,000.');
  });

  it('is null when there is nothing but a base case', () => {
    expect(toScenarioRows([SAMPLE_SCENARIO_PRESETS[0]])).toBeNull();
    expect(toScenarioRows(undefined)).toBeNull();
  });
});

describe('assumptions', () => {
  it('reads both shapes the column has held', () => {
    expect(toAssumptions([{ key: 'hem_benchmark', value: '$4,820' }])).toEqual([
      { label: 'HEM Benchmark', value: '$4,820' },
    ]);
    expect(toAssumptions({ items: [{ key: 'loan_term', value: '30 years' }] })).toEqual([
      { label: 'Loan Term', value: '30 years' },
    ]);
    expect(toAssumptions(null)).toEqual([]);
  });
});

describe('the whole snapshot', () => {
  const s = snapshot();

  it('carries the headline figures with their units', () => {
    expect(formatMeasure(s.headline.capacity)).toBe('$785,000');
    expect(formatMeasure(s.headline.monthlySurplus)).toBe('$1,840/mo');
    expect(formatMeasure(s.headline.assessmentRate)).toBe('8.65%');
    expect(formatMeasure(s.headline.dti!)).toBe('5.4x');
    expect(s.headline.band).toBe('strong');
  });

  /**
   * The same numbers the Phase 0 golden renders. If the payload and the golden
   * disagree, one of them is lying about what this assessment says.
   */
  it('agrees with the golden capture on every figure it shares', () => {
    expect(formatMeasure(s.income.gross)).toBe(`$186,000\u00A0pa`);
    expect(formatMeasure(s.income.shaded)).toBe(`$171,400\u00A0pa`);
    expect(formatMeasure(s.expenses.monthlyLiving)).toBe('$4,820/mo');
    expect(formatMeasure(s.expenses.monthlyCommitments)).toBe('$1,310/mo');
    expect(formatMeasure(s.headline.stressTested!)).toBe('$712,000');
    expect(formatMeasure(s.lmi!.premium)).toBe('$18,640');
  });

  it('writes the rate into the narrative as a rate', () => {
    expect(s.narrative).toContain('assessment rate of 8.65%');
    expect(s.narrative).toContain('maximum borrowing capacity of $785,000');
    expect(s.narrative).not.toMatch(/\$8\.65|\$9\b/);
  });

  it('says the proposed loan falls within capacity, and by how much', () => {
    expect(formatMeasure(s.utilisation!.share)).toBe('97%');
    expect(s.utilisation!.withinCapacity).toBe(true);
  });

  /**
   * A deduction is adverse whether it is printed as `-$4,820` or as `+$700`
   * (F6). The ledger says which lines are which, so nothing downstream has to
   * infer it from a minus sign.
   */
  it('marks deductions adverse regardless of how they are signed', () => {
    const byLabel = Object.fromEntries(s.ledger.map((r) => [r.label, r]));
    expect(byLabel['Living Expenses'].direction).toBe('adverse');
    expect(byLabel['Existing Commitments'].direction).toBe('adverse');
    expect(byLabel['Shaded Annual Income'].direction).toBe('favourable');
    expect(byLabel['Assessment Rate Applied'].direction).toBe('neutral');
    expect(byLabel['Maximum Borrowing Capacity'].emphasis).toBe('total');
  });

  it('carries the zero-shaded income row through to the document', () => {
    const zero = s.income.rows.find((r) => r.label === 'Unbanked cash income')!;
    expect(formatMeasure(zero.shading)).toBe('0%');
  });

  it('names the tenant nothing — the payload carries the client, not the brand', () => {
    expect(s.meta.clientName).toBe(SAMPLE_CLIENT_NAME);
    expect(JSON.stringify(s)).not.toContain('Naidu');
  });

  it('survives an empty assessment without throwing', () => {
    const empty = buildSnapshot({ clientName: 'Nobody', assessment: {} });
    expect(formatMeasure(empty.headline.capacity)).toBe('$0');
    expect(empty.headline.band).toBe('limited');
    expect(empty.income.rows).toEqual([]);
    expect(empty.lmi).toBeNull();
    expect(empty.utilisation).toBeNull();
    expect(empty.audit).toBeNull();
    expect(empty.scenarios).toBeNull();
    expect(empty.narrative).not.toContain('NaN');
  });

  /**
   * Neither is a column. `calculate-borrowing-capacity` computes both and its
   * `insert` does not persist them, so every generator reading them off the
   * stored row gets `undefined` — which is why these two pages have never
   * appeared in a shipping PDF (F12). They are parameters here so that the
   * caller has to decide where they come from.
   */
  it('takes the audit trail and the explanation as inputs, not off the row', () => {
    const withoutExtras = buildSnapshot({ clientName: SAMPLE_CLIENT_NAME, assessment: SAMPLE_ASSESSMENT });
    expect(withoutExtras.audit).toBeNull();
    expect(withoutExtras.explanation).toBeNull();
    expect(snapshot().audit).not.toBeNull();
    expect(snapshot().explanation).not.toBeNull();
  });
});
