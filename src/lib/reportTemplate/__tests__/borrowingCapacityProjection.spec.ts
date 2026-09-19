/**
 * The Borrowing Capacity projection.
 *
 * The fixture's shapes are read from the live `borrowing_capacity_assessments`
 * table across all 143 assessments — arrays where the table holds arrays,
 * `component`/`grossAmount`/`shadedAmount`/`shadingRate` on an income line,
 * `type`/`balance`/`limit`/`monthlyServicing` on a liability, whole-number
 * percent rates, `green`/`amber`/`red` bands. Only the values are invented.
 *
 * `docs/reports/BORROWING_CAPACITY.md` records why that matters: four drafts of
 * that format's fixture invented shapes and "every one produced a page of
 * plausible-looking wrong output". A fixture written from imagination passes
 * while production stays broken.
 */
import { describe, it, expect } from 'vitest';
import {
  projectBorrowingCapacity,
  applyBorrowingCapacityProjection,
} from '../../../../supabase/functions/_shared/borrowingCapacityProjection.pure';
import { getAdapter, supportsProduction, normaliseReportType } from '../adapters';

/** Shaped exactly like a stored row. */
const ROW = {
  id: 'bc-1',
  gross_annual_income: 245000,
  shaded_annual_income: 228320,
  // `shadingRate` is a **0–1 fraction of income counted** — production holds
  // 0.8 and 1, never a whole-number percent. The first draft of this fixture
  // wrote 25, which the legacy normaliser dutifully formatted as "2,500%".
  income_breakdown: [
    { component: 'PAYG salary — applicant 1', grossAmount: 165000, shadedAmount: 165000, shadingRate: 1 },
    { component: 'Rental income', grossAmount: 46800, shadedAmount: 35100, shadingRate: 0.75 },
    { component: 'Bonus', grossAmount: 33200, shadedAmount: 28220, shadingRate: 0.85 },
  ],
  living_expenses_monthly: 6420,
  expense_method: 'hem',
  expense_breakdown: { declaredExpenses: 5900, hemBenchmark: 6420 },
  existing_commitments_monthly: 1840,
  liability_breakdown: [
    { type: 'Home loan', balance: 612000, limit: 612000, monthlyServicing: 1540 },
    { type: 'Credit card', balance: 4200, limit: 15000, monthlyServicing: 300 },
  ],
  interest_rate_used: 6.14,
  buffer_rate: 3,
  assessment_rate: 9.14,
  loan_term_years: 30,
  proposed_loan_amount: 1032000,
  proposed_lvr: 80,
  borrowing_capacity: 1180000,
  monthly_surplus: 1290,
  serviceability_band: 'amber',
  stress_tested_capacity: 1042000,
  dti_ratio: 5.6,
  recommendations: ['Reduce the credit card limit to lift capacity', 'Consider a 30-year term'],
  warnings: ['Assessment rate includes a 3.00% buffer'],
  // The stored column is a bare array on 86 of 143 rows and this object shape
  // — an `items` list beside the calculator's flags — on the other 57. The
  // legacy normaliser accepts both; the flags ride only on the object shape,
  // which is where `selectedLenderName` lives on all 26 rows that have one.
  assumptions: {
    items: [
      { key: 'Serviceability Basis', value: 'After-Tax Income' },
      { key: 'Buffer Rate', value: '3%' },
      { key: 'Assessment Rate', value: '9.14%' },
      { key: 'Loan Term', value: '30 years' },
    ],
    selectedLenderName: 'Example Bank', calculationMode: 'standard',
    dtiCapEnabled: true, dtiCapLimit: 6, isFirstHomeBuyer: false,
    lmiMode: 'none', proposedRentalIncome: 46800,
  },
  lmi_mode: 'none',
  property_value_estimate: 1290000,
  deposit_amount: 258000,
  net_purchase_capacity: null,
  updated_at: '2026-08-12T00:00:00.000Z',
  created_at: '2026-08-11T00:00:00.000Z',
};

function resolves(data: Record<string, any>, path: string): boolean {
  let cur: any = data;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || !(key in cur)) return false;
    cur = cur[key];
  }
  return cur !== undefined && cur !== null && cur !== '';
}

describe('the borrowing capacity adapter is real, not a stub', () => {
  it('reports production support, unlike the preview-only stubs', () => {
    expect(supportsProduction('borrowing_capacity')).toBe(true);
    // The registry alias has to keep working.
    expect(normaliseReportType('borrowing')).toBe('borrowing_capacity');
    expect(supportsProduction('borrowing')).toBe(true);
  });

  it('leaves the still-stubbed formats honestly marked', () => {
    // These have no data source wired yet; claiming production support would
    // mark their templates report-ready when they cannot render one.
    // `portfolio` left this list when it gained an adapter against
    // `portfolio_analysis_reports`, `comparison` when it gained one against
    // `property_comparisons`, and `cashflow` when it gained one against the
    // projection stored on `investment_reports` — see their projection specs.
    // `qa` left it when `markdown-block` gave the vocabulary a way to set
    // model-authored Markdown as structure; the two below have no render route
    // and no contract, so they are catalogue templates rather than formats
    // awaiting an adapter.
    for (const t of ['suburb', 'postcode']) {
      expect(supportsProduction(t), t).toBe(false);
    }
  });

  it('reads from the assessments table', () => {
    expect(getAdapter('borrowing_capacity')?.label).toBe('Borrowing Capacity');
  });
});

describe('the projection', () => {
  const p = projectBorrowingCapacity(ROW);

  it('restates the stored figures without recalculating them', () => {
    expect(p.capacity.borrowing).toBe(1180000);
    expect(p.capacity.stressTested).toBe(1042000);
    expect(p.capacity.monthlySurplus).toBe(1290);
    expect(p.capacity.dti).toBe(5.6);
    expect(p.loan.proposed).toBe(1032000);
    expect(p.loan.assessmentRate).toBe(9.14);
    expect(p.income.gross).toBe(245000);
    expect(p.income.shaded).toBe(228320);
  });

  it('converts months to years as arithmetic, not as a second opinion', () => {
    expect(p.expenses.annual).toBe(6420 * 12);
    expect(p.liabilities.annual).toBe(1840 * 12);
    expect(p.capacity.annualSurplus).toBe(1290 * 12);
    // Stated rather than left for the reader to subtract.
    expect(p.income.shadingApplied).toBe(245000 - 228320);
  });

  it('keeps the real array shapes, element keys and all', () => {
    expect(p.income.items).toHaveLength(3);
    expect((p.income.items as any[])[1]).toEqual({
      component: 'Rental income', grossAmount: 46800, shadedAmount: 35100, shadingRate: 0.75,
    });
    expect(p.liabilities.items).toHaveLength(2);
    expect((p.liabilities.items as any[])[1].limit).toBe(15000);
    expect(p.recommendations).toHaveLength(2);
    expect(p.warnings).toHaveLength(1);
  });

  it('says what a band means rather than printing a traffic-light word', () => {
    // "red" tells a reader they failed something without saying what.
    expect(p.capacity.band).toBe('amber');
    expect(p.capacity.bandLabel).toBe('Serviceable with limited headroom');
    expect(projectBorrowingCapacity({ ...ROW, serviceability_band: 'green' }).capacity.bandLabel)
      .toBe('Comfortable');
    expect(projectBorrowingCapacity({ ...ROW, serviceability_band: 'red' }).capacity.bandLabel)
      .toBe('Constrained');
    expect(projectBorrowingCapacity({ ...ROW, expense_method: 'declared' }).expenses.methodLabel)
      .toBe('Declared living expenses');
  });

  it('omits net purchase capacity rather than defaulting it to zero', () => {
    // Populated on 3 of 143 rows. Zero would read as "you can buy nothing",
    // which is a different claim from "not calculated".
    expect('netPurchase' in p.capacity).toBe(false);
    const withIt = projectBorrowingCapacity({ ...ROW, net_purchase_capacity: 1438000 });
    expect(withIt.capacity.netPurchase).toBe(1438000);
  });

  it('emits no LMI namespace when LMI does not apply', () => {
    // lmi_mode is 'none' on 140 of 143 rows; a template must be able to make
    // that page conditional rather than print an empty panel.
    expect(Object.keys(p.lmi)).toHaveLength(0);
    const withLmi = projectBorrowingCapacity({
      ...ROW, lmi_mode: 'display_deduction', lmi_amount: 21400, lmi_lvr_trigger: 80,
    });
    expect(withLmi.lmi.mode).toBe('display_deduction');
    expect(withLmi.lmi.amount).toBe(21400);
  });

  it('passes whole-number percent rates through unscaled', () => {
    // Measured across 143 rows: interest 2.5-6.5, assessment 5.5-9.5, buffer
    // 0-3, lvr 80. `percent` formats without multiplying, so scaling here would
    // print 614%.
    expect(p.loan.interestRate).toBe(6.14);
    expect(p.loan.bufferRate).toBe(3);
    expect(p.loan.lvr).toBe(80);
  });

  it('never writes an undefined key, so absent means absent', () => {
    const walk = (o: any, at: string) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        expect(v, `${at}.${k}`).not.toBeUndefined();
        walk(v, `${at}.${k}`);
      }
    };
    walk(p, 'projection');
  });

  it('does not invent what the row has no column for', () => {
    const data = applyBorrowingCapacityProjection({}, ROW);
    // The row carries client_id, not a name. `explanation` is null on all 143.
    for (const path of ['client.name', 'explanation.method', 'capacity.netPurchase', 'lmi.amount']) {
      expect(resolves(data, path), `${path} must stay absent`).toBe(false);
    }
  });

  it('survives an empty row without throwing', () => {
    expect(() => projectBorrowingCapacity({})).not.toThrow();
    const empty = projectBorrowingCapacity({});
    expect(Object.keys(empty.capacity)).toHaveLength(0);
    expect(empty.recommendations).toEqual([]);
    expect(empty.warnings).toEqual([]);
  });

  it('merges additively, leaving the raw row bound', () => {
    const data = applyBorrowingCapacityProjection({ assessment: ROW }, ROW);
    expect(resolves(data, 'assessment.borrowing_capacity')).toBe(true);
    expect(resolves(data, 'capacity.borrowing')).toBe(true);
  });
});

describe('the client on the cover', () => {
  /*
   * The cover named the conclusion and never the person whose assessment it
   * was. The projection would not guess a name from a `client_id` and the
   * adapter never did the join, so nothing published one at all.
   *
   * It is worth joining here in a way it was not for the investment reports:
   * all 143 stored assessments resolve to a real client row and all 143 carry
   * both a first name and a surname.
   *
   * The formatting is `clientName.ts`'s, not this module's — including the rule
   * that the document names the primary applicant. 33 of the 143 are joint, and
   * naming both here would put a different name on the cover from the one the
   * Snapshot's filename is built from.
   */
  const jane = { primary_first_name: 'Jane', primary_surname: 'Smith' };

  it('publishes `client.name` when the caller supplies a client', () => {
    const data = applyBorrowingCapacityProjection({}, ROW, jane);
    expect(data.client).toEqual({ name: 'Jane Smith' });
  });

  it('names the primary applicant on a joint assessment', () => {
    const data = applyBorrowingCapacityProjection({}, ROW, {
      ...jane, secondary_first_name: 'John', secondary_surname: 'Smith',
    });
    expect(data.client).toEqual({ name: 'Jane Smith' });
  });

  it('falls back to the secondary applicant when only that one is named', () => {
    const data = applyBorrowingCapacityProjection({}, ROW, {
      secondary_first_name: 'John', secondary_surname: 'Smith',
    });
    expect(data.client).toEqual({ name: 'John Smith' });
  });

  it('stops a shouted name reaching the page as typed', () => {
    const data = applyBorrowingCapacityProjection({}, ROW, {
      primary_first_name: 'JANE', primary_surname: 'SMITH',
    });
    expect(data.client).toEqual({ name: 'Jane Smith' });
  });

  it('publishes nothing at all when there is no name', () => {
    // An object published with an empty string in it is truthy, which is how a
    // page conditional on `client` draws blank instead of dropping out.
    expect(applyBorrowingCapacityProjection({}, ROW, null).client).toBeUndefined();
    expect(applyBorrowingCapacityProjection({}, ROW).client).toBeUndefined();
    expect(applyBorrowingCapacityProjection({}, ROW, {
      primary_first_name: '  ', primary_surname: '',
    }).client).toBeUndefined();
  });
});

describe('the legacy document, restated through its own normaliser', () => {
  /*
   * Everything here goes through `buildSnapshot` — the legacy engine's own
   * normaliser — rather than being re-derived: the narrative's sentences, the
   * ledger's composition, a shading label, a band's vocabulary. A second
   * implementation of any of it would drift, and the drift would read as a
   * different assessment of the same row.
   */
  const jane = { primary_first_name: 'Jane', primary_surname: 'Smith' };
  const data: any = applyBorrowingCapacityProjection({}, ROW, jane);

  it('writes the executive summary in the legacy engine sentences, named', () => {
    expect(data.summary.narrative).toContain(
      'Jane Smith has an estimated maximum borrowing capacity of $1,180,000',
    );
    expect(data.summary.narrative).toContain('assessment rate of 9.14% over a 30-year loan term');
    expect(data.summary.narrative).toContain('The overall serviceability position is assessed as moderate.');
  });

  it('says "the applicant" when no client resolves, not the legacy "Client"', () => {
    // The legacy route's placeholder reads as a mail-merge failure on a page
    // of prose; a projection that cannot name the person still writes prose.
    const anon: any = applyBorrowingCapacityProjection({}, ROW);
    expect(anon.summary.narrative).toContain('the applicant has an estimated maximum');
    expect(anon.summary.narrative).not.toContain('Client has');
  });

  it('formats the DTI as the legacy engine does', () => {
    expect(data.capacity.dtiLabel).toBe('5.6x');
    expect(data.report.lenderName).toBe('Example Bank');
  });

  it('judges utilisation and states the verdict as a whole sentence', () => {
    expect(data.utilisation).toEqual({
      proposedLoan: 1032000,
      capacity: 1180000,
      shareLabel: '87%',
      withinCapacity: true,
      verdict: 'The proposed loan sits inside the assessed capacity.',
    });
    // No proposed loan, no utilisation — not a utilisation full of zeros.
    const without: any = applyBorrowingCapacityProjection({}, { ...ROW, proposed_loan_amount: null });
    expect(without.utilisation).toBeUndefined();
  });

  it('assembles the ledger in the legacy composition, units and all', () => {
    // "$245,000 pa" beside "-$6,420/mo" is the point of the ledger; a bare
    // `| currency` filter would erase the period distinction, so the amount
    // travels formatted. The gap before "pa" is the engine's own no-break
    // space, asserted as such — a unit that wraps away from its figure at a
    // line end misreads.
    expect(data.ledger.rows.map((r: any) => [r.label, r.amountLabel])).toEqual([
      ['Gross Annual Income', '$245,000\u00A0pa'],
      ['Shaded Annual Income', '$228,320\u00A0pa'],
      ['Living Expenses', '-$6,420/mo'],
      ['Existing Commitments', '-$1,840/mo'],
      ['Monthly Surplus', '$1,290/mo'],
      ['Assessment Rate Applied', '9.14%'],
      ['Loan Term', '30 years'],
      ['Maximum Borrowing Capacity', '$1,180,000'],
    ]);
    expect(data.ledger.rows[2].direction).toBe('adverse');
  });

  it('publishes income rows with the legacy shading labels, and the count', () => {
    expect(data.income.rows).toEqual([
      { label: 'PAYG salary — applicant 1', gross: 165000, shaded: 165000, shadingLabel: '100%' },
      { label: 'Rental income', gross: 46800, shaded: 35100, shadingLabel: '75%' },
      { label: 'Bonus', gross: 33200, shaded: 28220, shadingLabel: '85%' },
    ]);
    expect(data.income.rowCount).toBe(3);
  });

  it('composes a liability label the way the legacy table sets its cell', () => {
    expect(data.liabilities.rows.map((r: any) => r.label)).toEqual(['Home Loan', 'Credit Card']);
    expect(data.liabilities.rows[1].limit).toBe(15000);
  });

  it('reads assumptions from both shapes the column has held', () => {
    // 57 rows store an object with `items`; 86 store the bare array.
    expect(data.assumptions.rows).toHaveLength(4);
    expect(data.assumptions.rows[1]).toEqual({ label: 'Buffer Rate', value: '3%' });
    const bare: any = applyBorrowingCapacityProjection({}, {
      ...ROW,
      assumptions: [{ key: 'Buffer Rate', value: '3%' }],
    });
    expect(bare.assumptions.rows).toEqual([{ label: 'Buffer Rate', value: '3%' }]);
  });

  it('publishes none of it for a row with no capacity figure', () => {
    // `buildSnapshot` on an empty row manufactures a ledger of zeros and a
    // narrative that says "$0"; a fabricated figure on a client's page is
    // worse than an absent section.
    const gated: any = applyBorrowingCapacityProjection({}, { id: 'x', recommendations: [], warnings: [] });
    for (const nsName of ['summary', 'utilisation', 'ledger', 'explanation', 'audit', 'scenarios']) {
      expect(gated[nsName], nsName).toBeUndefined();
    }
  });
});

describe('the sections that cascade in as the calculator stores them', () => {
  /*
   * `explanation` and `audit_trail` are columns null on all 143 stored rows —
   * the calculator's keep-update post-dates every one — so these fixtures are
   * shaped from the **producer**: `generateExplanationServer`'s report shape
   * and `AuditTrailBuilder.build()`'s trail shape, verbatim.
   */
  const producerSteps = (n: number) => Array.from({ length: n }, (_, i) => ({
    step: i + 1, title: `Step ${i + 1}`, narrative: `Narrative ${i + 1}.`,
    figures: [{ label: 'Gross', value: '$245,000' }], icon: 'income',
  }));
  // `income/shading_applied` on every entry: both sides are aud/year, so the
  // delta is computable. A liability entry's raw is a balance and its assessed
  // a monthly repayment (F13), and the normaliser's honest answer for that
  // non-comparable pair is a null delta — the em dash, tested separately.
  const producerEntries = (n: number) => Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    category: 'income',
    action: 'shading_applied',
    label: `Line ${i + 1}`,
    rawValue: 1000 + i,
    assessedValue: i === 0 ? 1000 : 900 + i,
    rule: 'APRA',
    delta: i === 0 ? 0 : -100,
    impact: i === 0 ? 'neutral' : 'decrease',
  }));

  it('projects the stored explanation up to the producer ceiling of ten', () => {
    const d: any = applyBorrowingCapacityProjection({}, {
      ...ROW,
      explanation: { headline: 'In short.', steps: producerSteps(12), executiveSummary: 'x', generatedAt: 'x' },
    });
    expect(d.explanation.headline).toBe('In short.');
    // Eight unconditional steps plus lender policy plus LMI is the producer's
    // own ceiling; a cap of eight was cutting the stress test and the band
    // off the end of every explanation.
    expect(d.explanation.steps).toHaveLength(10);
    expect(d.explanation.steps[0]).toEqual({ title: 'Step 1', narrative: 'Narrative 1.' });
  });

  it('composes audit labels as the legacy table does, and signs the deltas', () => {
    const d: any = applyBorrowingCapacityProjection({}, {
      ...ROW,
      audit_trail: { entries: producerEntries(3), summary: {}, generatedAt: 'x' },
    });
    // Category caption, em-rule, label — the legacy item cell, composed in the
    // projection so a template cannot strand the separator.
    expect(d.audit.rows[0].label).toBe('Income — Line 1');
    expect(d.audit.rows[1].label).toBe('Income — Line 2');
    // A zero delta is "did not move", which is an em dash and never "+$0";
    // a moved one arrives signed, unit and no-break space intact.
    expect(d.audit.rows[0].deltaLabel).toBe('—');
    expect(d.audit.rows[1].deltaLabel).toBe('-$100\u00A0pa');
    expect(d.audit.omissionNote).toBeUndefined();
  });

  it('caps the audit at fourteen rows and says what it left out', () => {
    const d: any = applyBorrowingCapacityProjection({}, {
      ...ROW,
      audit_trail: { entries: producerEntries(17), summary: {}, generatedAt: 'x' },
    });
    expect(d.audit.rows).toHaveLength(14);
    // A whole sentence, never a fragment for the page to complete.
    expect(d.audit.omissionNote).toBe('3 further audit entries are not shown in this edition.');
  });

  it('never publishes scenarios from a row, because no column carries them', () => {
    // Scenario presets only ever travel in a render request; a row-shaped
    // fixture claiming otherwise would assert a cascade that cannot happen.
    const d: any = applyBorrowingCapacityProjection({}, ROW);
    expect(d.scenarios).toBeUndefined();
  });
});
