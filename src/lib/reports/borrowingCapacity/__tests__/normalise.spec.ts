/**
 * Raw records in, one payload out.
 *
 * The cases below are the ones that broke something real: a `0` that three
 * generators read as `1`, a field name that four drafts of a fixture guessed
 * wrong, a subtraction against `undefined` that put `NaN` on a page, and a
 * colour keyed to the sign of a number rather than to what the number means.
 */
import { describe, expect, it } from 'vitest';

import { audPerMonth, audPerYear, formatMeasure, rate } from '@/lib/reportDesign/measure.pure';
import {
  AUDIT_CATEGORY_ORDER,
  AUDIT_LABEL,
  auditRule,
  buildSnapshot,
  CAPITALISED_LMI_LABEL,
  capitalisedLmiRepayment,
  commitmentItemsTotal,
  describeAdjustments,
  incomeItemsTotal,
  liabilityKindLabel,
  PROPOSED_RENT_LABEL,
  proposedRentRow,
  provenNetForPurchase,
  toAssumptions,
  toAuditSection,
  toBand,
  toIncomeRow,
  toLiabilityRow,
  toScenarioRows,
} from '../normalise.pure';
import { KNOWN_AUDIT_ACTIONS } from '../audit.pure';
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

  /**
   * The engine writes the rent a household pays on its home as
   * `Rent Expense (${address.substring(0, 30)}...)` — the cut the income label
   * carried, ellipsis and all (§21).
   */
  it('reads the rent on the home back to a whole place name', () => {
    expect(liabilityKindLabel('Rent Expense (14 Wattle Grove Sampleton, NSW...)')).toBe('Rent — 14 Wattle Grove Sampleton');
    expect(liabilityKindLabel('Rent Expense (3 Short St...)')).toBe('Rent — 3 Short St');
    expect(liabilityKindLabel('Rent Expense (Rental...)')).toBe('Rent');
    expect(liabilityKindLabel('credit_card')).toBe('Credit Card');
    expect(toLiabilityRow({ type: 'Rent Expense (14 Wattle Grove Sampleton, NSW...)', balance: 0, monthlyServicing: 2_100 })!.kind)
      .toBe('Rent — 14 Wattle Grove Sampleton');
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

  it('carries the count, and none of the engine\'s category totals (§21)', () => {
    // Two of the engine's four totals are not totals of anything a client can
    // check — a liability's repayment less its balance, and the Medicare levy
    // added to an after-tax figure that already nets it — so none is read.
    const audit = toAuditSection(SAMPLE_AUDIT_TRAIL)!;
    expect(formatMeasure(audit.summary.transformations)).toBe('5');
    expect(Object.keys(audit.summary)).toEqual(['transformations']);
  });

  it('reads every action the engine emits in the report\'s words (§21)', () => {
    // A new audit entry surfaces here, red, rather than as a log's label on a
    // client's page.
    for (const action of KNOWN_AUDIT_ACTIONS) expect(AUDIT_LABEL[action], action).toBeTypeOf('function');
    const rows = toAuditSection(SAMPLE_AUDIT_TRAIL)!.groups.flatMap((g) => g.rows);
    expect(rows.map((r) => r.label)).toEqual([
      'Rental income', 'Bonus', 'Living expenses', 'Credit Card', 'Interest rate', 'Lender policy',
    ]);
    expect(rows.map((r) => r.rule)).toEqual([
      '80% counted', '50% counted', 'Higher of HEM and declared', 'Serviced on the card limit', 'Set by the adviser',
      'Example Bank — Investor P&I',
    ]);
  });

  it('states each engine rule in words, and leaves one it cannot read as written', () => {
    expect(auditRule('income', 'shading_applied', '80% shading', null)).toBe('80% counted');
    expect(auditRule('tax', 'tax_calculated', '26.4% effective rate', null)).toBe('26.4% of assessable income');
    expect(auditRule('tax', 'medicare_levy_applied', '2% of gross', null)).toBe('2% of gross income');
    expect(auditRule('property', 'negative_cf_layered', 'Layered on expenses', null)).toBe('Added to living expenses');
    expect(auditRule('constraint', 'stress_test_applied', '+1% above assessment', null)).toBe('At the assessment rate plus 1%');
    expect(auditRule('constraint', 'lmi_capitalised', '+$123/mo servicing', null)).toBe('Adds $123/mo of servicing');
    // The living-expense row reads the document's method; without one, the
    // engine's "Method: X" through the same reader the terms use.
    expect(auditRule('expense', 'override_applied', 'Method: Declared', 'HEM benchmark')).toBe('HEM benchmark');
    expect(auditRule('expense', 'hem_benchmark_applied', 'Method: HEM', null)).toBe('HEM benchmark');
    expect(auditRule('expense', 'declared_expenses_used', 'Method: Declared Higher', null)).toBe('Declared (above HEM)');
    expect(auditRule('income', 'shading_applied', 'Something new', null)).toBe('Something new');
  });

  it('reads a property\'s shortfall back to a whole address', () => {
    const shortfall = AUDIT_LABEL['property/negative_cf_layered'];
    expect(shortfall('Neg CF: 22 Example Road Sampleton NSW 2380')).toBe(
      'Property costs not covered by rent — 22 Example Road Sampleton NSW 2380',
    );
    // Cut at forty characters, with no ellipsis to say so: the partial last
    // segment goes back to the last comma.
    expect(shortfall('Neg CF: 1402/88 Example Esplanade Sampleton, NSW')).toBe(
      'Property costs not covered by rent — 1402/88 Example Esplanade Sampleton',
    );
    expect(shortfall('Neg CF: Investment Property')).toBe('Property costs not covered by rent');
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
    ).toEqual(['Income +10%', 'Commitments -$240/mo', 'Interest rate 6.15% → 7.15%', 'Loan term 30 years → 25 years']);
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
    expect(rows[1].details).toContain('Purchase power: up to $975,000.');
  });

  it('says whether purchase power clears the target, as the in-browser document always did (§21)', () => {
    const withTarget = (acq: Record<string, unknown>) => toScenarioRows([
      SAMPLE_SCENARIO_PRESETS[0],
      { ...SAMPLE_SCENARIO_PRESETS[1], acquisitionCapacity: { ...SAMPLE_SCENARIO_PRESETS[1].acquisitionCapacity, ...acq } },
    ])![1].details;
    expect(withTarget({ targetPurchasePrice: 650_000, meetsTarget: true }))
      .toContain('Purchase power: up to $975,000, which clears the $650,000 target.');
    expect(withTarget({ targetPurchasePrice: 1_100_000, meetsTarget: false, shortfallToTarget: 125_000 }))
      .toContain('Purchase power: up to $975,000, $125,000 short of the $1,100,000 target.');
    // Neither met nor short: nothing said about the target, never "short by $0".
    expect(withTarget({ targetPurchasePrice: 1_100_000, meetsTarget: false }))
      .toContain('Purchase power: up to $975,000.');
  });

  it('does not list a rate lever as a strategy action beside the rate change it is (§21)', () => {
    expect(rows[2].adjustments).toContain('Interest rate 6.15% → 7.15%');
    expect(rows[2].details.join(' ')).not.toContain('Interest rate (1.00%)');
    // A step the client takes is still listed.
    expect(rows[1].details.join(' ')).toContain('Close credit card');
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
    expect(byLabel['Living expenses'].direction).toBe('adverse');
    expect(byLabel['Existing commitments'].direction).toBe('adverse');
    expect(byLabel['Assessed (shaded) annual income'].direction).toBe('favourable');
    // The rate and term are in the capacity line's label now, not rows of a
    // money column (§16); the capacity is still the total.
    const total = s.ledger[s.ledger.length - 1];
    expect(total.label).toBe('Maximum borrowing capacity (the surplus, repaid at 8.65% over 30 years)');
    expect(total.emphasis).toBe('total');
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

/**
 * §21. The calculator sends its own income and commitment totals and the engine
 * stores them beside a breakdown it reads from the client's records, so a total
 * row could print a figure its own rows did not reach. Two lines the calculator
 * adds are recorded elsewhere on the row and are printed as lines; anything left
 * is stated, never absorbed.
 */
describe('what the tables add up to', () => {
  const row = (label: string, gross: number, shading: number) => ({
    label, gross: audPerYear(gross), shading: rate(shading), shaded: audPerYear(gross * shading),
  });

  it('reads the proposed rent the way the calculator counts it', () => {
    const plain = proposedRentRow({ inputAmount: 650, frequency: 'weekly', shadingRate: 0.8, vacancyRate: 0, interestOnlyOffset: 0 })!;
    expect(plain.label).toBe(PROPOSED_RENT_LABEL);
    expect(plain.gross.value).toBe(33_800);
    expect(plain.shaded.value).toBeCloseTo(27_040, 6);
    expect(plain.shading.value).toBeCloseTo(0.8, 6);
    // Vacancy and the interest-only offset come off the assessed side only.
    const net = proposedRentRow({ inputAmount: 650, frequency: 'weekly', shadingRate: 0.8, vacancyRate: 5, interestOnlyOffset: 200 })!;
    expect(net.gross.value).toBe(33_800);
    expect(net.shaded.value).toBeCloseTo(33_800 * 0.95 * 0.8 - 2_400, 6);
    expect(proposedRentRow({ inputAmount: 2_900, frequency: 'monthly', shadingRate: 0.7 })!.gross.value).toBe(34_800);
  });

  it('prints no proposed rent where none was proposed, or the setting cannot say what was counted', () => {
    expect(proposedRentRow(null)).toBeNull();
    expect(proposedRentRow({ inputAmount: 0, frequency: 'weekly', shadingRate: 0.8 })).toBeNull();
    expect(proposedRentRow({ inputAmount: 650, frequency: 'weekly' })).toBeNull();
  });

  it('amortises a capitalised premium the way the engine does', () => {
    expect(capitalisedLmiRepayment(18_640, 8.65, 30)!).toBeCloseTo(145.31, 2);
    expect(capitalisedLmiRepayment(0, 8.65, 30)).toBeNull();
    expect(capitalisedLmiRepayment(18_640, 0, 30)).toBeNull();
  });

  it('says nothing where the lines foot, to the dollar', () => {
    const lines = [row('Salary', 100_000, 1), row('Rent', 20_000, 0.8)];
    expect(incomeItemsTotal(lines, 120_000, 116_000)).toBeNull();
    expect(incomeItemsTotal(lines, 120_000.4, 116_000.4)).toBeNull();
    expect(incomeItemsTotal([], 120_000, 116_000)).toBeNull();
    expect(commitmentItemsTotal([], 1_000)).toBeNull();
  });

  it('states what the lines come to where they do not', () => {
    const lines = [row('Salary', 100_000, 1), row('Rent', 20_000, 0.8)];
    const items = incomeItemsTotal(lines, 130_000, 126_000)!;
    expect(items.gross.value).toBe(120_000);
    expect(items.shaded.value).toBe(116_000);
    const debt = [{ kind: 'Car Loan', provider: null, balance: null, limit: null, monthlyServicing: audPerMonth(600), note: null }];
    expect(commitmentItemsTotal(debt, 850)!.value).toBe(600);
  });

  it('foots the sample: its income, and its liabilities with the premium the engine capitalised', () => {
    const s = snapshot();
    expect(s.income.proposedRent).toBeNull();
    expect(s.income.itemsTotal).toBeNull();
    expect(s.expenses.capitalisedLmi!.kind).toBe(CAPITALISED_LMI_LABEL);
    expect(s.expenses.capitalisedLmi!.monthlyServicing.value).toBeCloseTo(145.31, 2);
    expect(formatMeasure(s.expenses.capitalisedLmi!.balance!)).toBe('$18,640');
    expect(s.expenses.itemsTotal).toBeNull();
  });

  it('prints the proposed rent as a line, and the table foots with it', () => {
    const s = buildSnapshot({
      clientName: 'X',
      assessment: {
        ...SAMPLE_ASSESSMENT,
        gross_annual_income: 186_000 + 33_800,
        shaded_annual_income: 171_400 + 27_040,
        assumptions: { ...SAMPLE_ASSESSMENT.assumptions, proposedRentalIncome: { weeklyRent: 650, inputAmount: 650, frequency: 'weekly', shadingRate: 0.8, vacancyRate: 0, interestOnlyOffset: 0 } },
      },
    });
    expect(s.income.proposedRent!.gross.value).toBe(33_800);
    expect(s.income.itemsTotal).toBeNull();
  });

  it('keeps a difference the calculator made, and the totals the assessment ran on', () => {
    const s = buildSnapshot({
      clientName: 'X',
      assessment: { ...SAMPLE_ASSESSMENT, gross_annual_income: 196_000, shaded_annual_income: 181_400, existing_commitments_monthly: 1_610 },
    });
    expect(formatMeasure(s.income.gross)).toBe('$196,000\u00A0pa');
    expect(s.income.itemsTotal!.gross.value).toBe(186_000);
    expect(s.income.itemsTotal!.shaded.value).toBe(171_400);
    expect(s.expenses.itemsTotal!.value).toBeCloseTo(1_310.31, 2);
    // The working is the assessment's, whatever the lines say.
    expect(s.ledger.some((l) => formatMeasure(l.amount) === '-$1,610/mo')).toBe(true);
  });

  it('prints the calculator\'s "Net for Purchase" only where it is the capacity less the premium', () => {
    expect(formatMeasure(provenNetForPurchase(766_360, 785_000, 18_640)!)).toBe('$766,360');
    expect(provenNetForPurchase(942_000, 785_000, 18_640)).toBeNull();
    expect(provenNetForPurchase(null, 785_000, 18_640)).toBeNull();
    expect(formatMeasure(snapshot().lmi!.netForPurchase!)).toBe('$766,360');
  });

  it('does not count a capitalised premium as debt already owed', () => {
    const dti = snapshot().debtToIncome!;
    // 5.4 × $186,000 − $785,000 − $18,640 = $200,760, about $200,000.
    expect(formatMeasure(dti.existingDebt!)).toBe('$200,000');
    expect(formatMeasure(dti.capitalisedPremium!)).toBe('$18,640');
  });

  it('says where a deducted premium is paid from: the loan, as the calculator says, not the deposit', () => {
    const s = buildSnapshot({ clientName: 'X', assessment: { ...SAMPLE_ASSESSMENT, lmi_mode: 'display_deduction' } });
    expect(s.narrative).toContain('is paid from the loan, leaving $766,360 of the capacity for the purchase.');
    expect(s.narrative).not.toMatch(/deposit/i);
    expect(s.expenses.capitalisedLmi).toBeNull();
  });
});
