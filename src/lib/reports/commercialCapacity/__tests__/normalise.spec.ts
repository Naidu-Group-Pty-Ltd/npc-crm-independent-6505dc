/**
 * The row and its calculation run, turned into a payload.
 *
 * Every assertion below runs against the **real engine's** output over the real
 * worked example — see `fixtures/sampleRun.ts` for why the fixture is generated
 * rather than written. So a field that moves in `src/lib/ciAssessment/` fails
 * here, which is the only way a normaliser reading an untyped jsonb column can
 * be held to anything at all.
 */

import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_TYPE_LABELS,
  buildCapacitySnapshot,
  buildNarrative,
  humanise,
} from '../normalise.pure';
import {
  SAMPLE_ANALYSIS,
  sampleAssessmentRow,
  sampleOutputs,
  samplePayload,
  sampleRunRow,
} from './fixtures/sampleRun';

function build(overrides: {
  assessment?: Record<string, unknown>;
  run?: Record<string, unknown>;
  clientName?: string | null;
  analysis?: typeof SAMPLE_ANALYSIS | null;
} = {}) {
  const run = { ...sampleRunRow(), ...(overrides.run ?? {}) };
  return buildCapacitySnapshot({
    assessment: { ...sampleAssessmentRow(), ...(overrides.assessment ?? {}) },
    outputs: run.outputs,
    inputs: run.inputs_snapshot,
    clientName: overrides.clientName,
    analysis: overrides.analysis ?? null,
  });
}

describe('buildCapacitySnapshot', () => {
  it('carries the engine\'s headline figures without rescaling them', () => {
    const outputs = sampleOutputs();
    const payload = build();

    // `summary` is already in whole dollars. Passing it through `dollars()`
    // would divide it by a hundred — the single easiest mistake to make against
    // this shape, and the reason the two readers are named differently.
    expect(payload.headline.maximumCapacity.value).toBe(outputs.summary.maximumIndicativeLoan);
    expect(payload.headline.requestedLoan.value).toBe(outputs.summary.requestedLoan);
    expect(payload.headline.difference.value).toBe(outputs.summary.difference);
    expect(payload.headline.requiredContribution.value).toBe(outputs.summary.requiredContribution);
  });

  it('converts cents fields, and only cents fields', () => {
    const outputs = sampleOutputs();
    const payload = build();

    // `serviceability.*Cents` is integer cents; the payload is dollars.
    expect(payload.headline.sensitisedSurplus.value)
      .toBe(outputs.serviceability.sensitisedSurplusCents / 100);
    expect(payload.transaction.totalProjectCost.value)
      .toBe(outputs.transaction.totalProjectCostCents / 100);
    expect(payload.propertyIncome!.netOperatingIncome.value)
      .toBe(outputs.propertyIncome.netOperatingIncomeCents / 100);

    // And a sanity check that the two agree: the engine publishes NOI in both
    // places, so if either reader were wrong they would differ by 100×.
    expect(payload.propertyIncome!.netOperatingIncome.value)
      .toBeCloseTo(outputs.summary.netOperatingIncome, 2);
  });

  it('gives every figure a unit', () => {
    const payload = build();
    expect(payload.headline.maximumCapacity.unit).toBe('aud');
    expect(payload.headline.monthlyDebtService.unit).toBe('aud/month');
    expect(payload.headline.surplus.unit).toBe('aud/year');
    expect(payload.headline.assessmentRate.unit).toBe('percent');
    expect(payload.headline.loanTerm.unit).toBe('years');
    // LVR is a 0–1 fraction, so `rate` and never `percent`. Reading 0.7 as
    // `percent` prints "0.70%" for a 70% LVR.
    expect(payload.ratios.lvr.unit).toBe('rate');
    expect(payload.ratios.dscr.unit).toBe('ratio');
  });

  it('carries every capacity test the engine ran, with its formula', () => {
    const outputs = sampleOutputs();
    const payload = build();

    expect(payload.constraints).toHaveLength(outputs.serviceability.caps.length);
    expect(payload.constraints.map((c) => c.key))
      .toEqual(outputs.serviceability.caps.map((c) => c.key));
    expect(payload.constraints.every((c) => c.formula.length > 0)).toBe(true);
  });

  it('marks exactly one test as binding, and it is the engine\'s', () => {
    const outputs = sampleOutputs();
    const payload = build();

    const binding = payload.constraints.filter((c) => c.binding);
    expect(binding).toHaveLength(1);
    expect(binding[0].key).toBe(outputs.serviceability.bindingConstraint);
    expect(payload.headline.bindingConstraint).toBe(outputs.summary.bindingConstraint);
  });

  it('gives the five ratio tests a threshold and an actual, and the rest neither', () => {
    const payload = build();
    const byKey = new Map(payload.constraints.map((c) => [c.key, c]));

    for (const key of ['lvr', 'ltc', 'dscr', 'icr', 'debt_yield']) {
      expect(byKey.get(key)?.threshold, key).not.toBeNull();
      expect(byKey.get(key)?.actual, key).not.toBeNull();
    }
    // A test with no ratio behind it must report no threshold rather than a
    // plausible-looking zero. `borrower_contribution` is a dollar cap, not a
    // ratio, and "policy minimum 0%" would be a claim nobody made.
    expect(byKey.get('borrower_contribution')?.threshold).toBeNull();
    expect(byKey.get('global_servicing')?.actual).toBeNull();
  });

  it('builds the serviceability ledger so its total is the engine\'s surplus', () => {
    const outputs = sampleOutputs();
    const payload = build();
    const surplus = payload.serviceability.rows.find((r) => r.label.startsWith('Surplus'));

    expect(surplus?.amount.value)
      .toBe(outputs.serviceability.surplusAfterDebtServiceCents / 100);
    // Deductions are carried negative and labelled adverse. A ledger whose
    // deductions are positive numbers adds up to something that is not the
    // total printed under it.
    const deductions = payload.serviceability.rows.filter((r) => r.direction === 'adverse');
    expect(deductions.length).toBeGreaterThan(0);
    expect(deductions.every((r) => r.amount.value <= 0)).toBe(true);
  });

  it('reads the tenancy schedule and its shares', () => {
    const payload = build();
    const tenancies = payload.propertyIncome!.tenancies;
    expect(tenancies.length).toBeGreaterThan(0);

    const shares = tenancies.reduce((total, t) => total + t.share.value, 0);
    expect(shares).toBeCloseTo(1, 6);
    expect(tenancies.every((t) => t.share.unit === 'rate')).toBe(true);
  });

  it('directions describe the borrower, not the arithmetic', () => {
    const payload = build();
    const rows = new Map(payload.portfolio!.rows.map((r) => [r.label, r]));

    // More debt is worse for the borrower even though the number went up; more
    // equity is better. This is the defect `BORROWING_CAPACITY.md` F6 records —
    // colour tracking the sign of a delta rather than what it means.
    const debt = rows.get('Total debt')!;
    if (debt.change!.value > 0) expect(debt.direction).toBe('adverse');

    const equity = rows.get('Net equity')!;
    if (equity.change!.value > 0) expect(equity.direction).toBe('favourable');

    const lvr = rows.get('Portfolio LVR')!;
    if (lvr.change!.value > 0) expect(lvr.direction).toBe('adverse');
  });

  it('names the client when there is one, and the assessment when there is not', () => {
    expect(build({ clientName: 'Asteron Industrial Holdings Pty Ltd' }).meta.subject)
      .toBe('Asteron Industrial Holdings Pty Ltd');
    // A standalone assessment is a supported state in this workflow. Inventing
    // a borrower for it would be worse than saying what it is.
    expect(build({ clientName: null }).meta.subject)
      .toBe(sampleAssessmentRow().title);
  });

  it('labels the transaction type from the engine\'s own vocabulary', () => {
    const payload = build();
    expect(payload.meta.assessmentTypeLabel).toBe(ASSESSMENT_TYPE_LABELS.industrial_investment);
  });

  it('omits a section rather than printing an empty one', () => {
    const empty = buildCapacitySnapshot({
      assessment: sampleAssessmentRow(),
      outputs: {},
      inputs: {},
    });

    // No tenancies, no rent, no assets — three headings that must not appear
    // over an empty table, because a document that prints them says something
    // false about the deal.
    expect(empty.propertyIncome).toBeNull();
    expect(empty.businessIncome).toBeNull();
    expect(empty.portfolio).toBeNull();
    expect(empty.method).toBeNull();
  });

  it('reports no trend for a single financial period', () => {
    const outputs = sampleOutputs();
    const single = build({
      run: {
        outputs: {
          ...outputs,
          businessIncome: { ...outputs.businessIncome, periods: [outputs.businessIncome.periods[0]] },
        },
      },
    });
    // A trend needs two periods. "0.0% year on year" beside a single set of
    // accounts states a fact nobody measured.
    expect(single.businessIncome!.trend).toBeNull();
    expect(build().businessIncome!.trend).not.toBeNull();
  });

  it('survives a row with nothing in it', () => {
    const nothing = buildCapacitySnapshot({ assessment: {}, outputs: null, inputs: undefined });
    expect(nothing.headline.maximumCapacity.value).toBe(0);
    expect(nothing.headline.outcome).toBe('insufficient_information');
    expect(nothing.constraints).toEqual([]);
    expect(nothing.narrative.length).toBeGreaterThan(0);
  });

  it('attaches the analysis it is given, and nothing when given none', () => {
    expect(build({ analysis: SAMPLE_ANALYSIS }).analysis).toEqual(SAMPLE_ANALYSIS);
    expect(build().analysis).toBeNull();
  });
});

describe('buildNarrative', () => {
  const base = {
    subject: 'Asteron Industrial Holdings',
    outcomeLabel: 'Outside Current Assumptions',
    capacity: 3_055_219,
    requested: 4_095_000,
    difference: -1_039_781,
    bindingConstraint: 'Debt service coverage ratio',
    assessmentRatePct: 7.85,
    termYears: 15,
    contribution: 3_533_031,
  };

  it('says which way the difference points, in words', () => {
    expect(buildNarrative(base)).toContain('exceeds the assessed capacity by $1,039,781');
    expect(buildNarrative({ ...base, difference: 240_000 }))
      .toContain('leaves $240,000 of headroom');
    expect(buildNarrative({ ...base, difference: 0 }))
      .toContain('exactly at the assessed capacity');
  });

  it('names the binding constraint', () => {
    expect(buildNarrative(base)).toContain('debt service coverage ratio');
  });

  it('never claims an approval', () => {
    const narrative = buildNarrative(base).toLowerCase();
    for (const word of ['approved', 'pre-approved', 'guaranteed', 'will lend']) {
      expect(narrative, `narrative must not say "${word}"`).not.toContain(word);
    }
  });
});

describe('humanise', () => {
  it('reads snake_case and camelCase alike', () => {
    expect(humanise('debt_yield')).toBe('Debt yield');
    expect(humanise('documents_held')).toBe('Documents held');
    expect(humanise('requiresSpecialistReview')).toBe('Requires specialist review');
    expect(humanise('')).toBe('');
  });
});

describe('the fixture is the engine\'s own output', () => {
  it('exercises every conditional section', () => {
    const payload = build({ analysis: SAMPLE_ANALYSIS });
    // A fixture that is easier than production hides defects as reliably as one
    // that is wrong invents them — `BORROWING_CAPACITY.md` §12.
    expect(payload.propertyIncome).not.toBeNull();
    expect(payload.businessIncome).not.toBeNull();
    expect(payload.portfolio).not.toBeNull();
    expect(payload.method).not.toBeNull();
    expect(payload.analysis).not.toBeNull();
    expect(payload.warnings.length).toBeGreaterThan(0);
  });

  it('is the payload the sample intake pack describes', () => {
    expect(samplePayload().property.classification).toBe('industrial');
  });
});
