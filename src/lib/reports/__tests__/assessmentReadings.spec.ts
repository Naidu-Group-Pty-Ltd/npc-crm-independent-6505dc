/**
 * The four readings, and that every report can bind them.
 *
 * A Compass cover read "assessment performance F · 40" while its assessment
 * page said the composite would be a C. Both are in the record; one label was
 * carrying two readings. These are published through the shared projection —
 * the authority every master and both routes bind — so the separation reaches
 * user-generated reports rather than a review script.
 */
import { describe, expect, it } from 'vitest';

import { assessmentReadings } from '../../../../supabase/functions/_shared/reports/investment/assessmentReadings.pure.ts';
import { projectInvestmentReport } from '../../../../supabase/functions/_shared/reportBindingProjection.pure.ts';

/** A record in the shape the scorer writes: capped, three of five measured. */
const CAPPED = {
  grade: 'F',
  totalScore: 40,
  v2: {
    grade: 'F',
    score: 40,
    scoreGrade: 'C',
    gradeCapped: true,
    gradeCapReasons: [
      "The measured evidence delivers 28 of the composite's 100 nominal points, which "
      + 'supports at most F. A dimension that was not measured is never scored — and '
      + 'never lifts the grade.',
    ],
    evidenceCoverage: 0.5725,
    gradeEligibility: { ceiling: 'F' },
    dimensions: [
      { key: 'growth', available: true, coverage: 1, nominalWeight: 0.4, effectiveWeight: 0.5714 },
      { key: 'location', available: false, coverage: 0, nominalWeight: 0.25, effectiveWeight: 0 },
      { key: 'yield', available: true, coverage: 1, nominalWeight: 0.15, effectiveWeight: 0.2143 },
      { key: 'demand', available: true, coverage: 0.15, nominalWeight: 0.15, effectiveWeight: 0.2143 },
      { key: 'risk', available: false, coverage: 0, nominalWeight: 0.05, effectiveWeight: 0 },
    ],
  },
  // The scorecard reads `breakdown`, keyed `<dimension>Score`, while
  // `v2.dimensions` keys the same criterion plainly. Both are here because
  // the projection joins them and pairing them by position would be wrong.
  breakdown: {
    growthScore: { score: 56, weight: 57, hasData: true },
    locationScore: { score: 0, weight: 0, hasData: false, excluded: true },
    yieldScore: { score: 23, weight: 21, hasData: true, details: '2.97% gross yield on a $1,490,000 purchase price.' },
    demandScore: { score: 13, weight: 21, hasData: true },
    riskScore: { score: 0, weight: 0, hasData: false, excluded: true },
  },
};

describe('the four readings stay four', () => {
  it('separates the measured composite from the grade issued', () => {
    const r = assessmentReadings(CAPPED);
    expect(r.measuredScore).toBe(40);
    expect(r.measuredGrade).toBe('C');
    expect(r.issuedGrade).toBe('F');
    // The two are never the same field, which is the whole correction.
    expect(r.measuredGrade).not.toBe(r.issuedGrade);
  });

  it('reports coverage as its own reading, with the criteria count beside it', () => {
    const r = assessmentReadings(CAPPED);
    expect(r.coveragePercent).toBe(57);
    expect(r.criteriaMeasured).toBe(3);
    expect(r.criteriaTotal).toBe(5);
  });

  it('carries the engine’s own cap sentence and never re-derives the figure', () => {
    const r = assessmentReadings(CAPPED);
    expect(r.capped).toBe(true);
    expect(r.capExplanation).toContain('28 of the composite');
  });

  it('withholds an overall conclusion while the evidence caps the grade', () => {
    const r = assessmentReadings(CAPPED);
    expect(r.supportsConclusion).toBe(false);
    expect(r.conclusionLine).toBe(
      'The evidence available does not support an overall recommendation on this property.',
    );
  });

  it('supports one where a grade issued uncapped', () => {
    const uncapped = { ...CAPPED, v2: { ...CAPPED.v2, gradeCapped: false, grade: 'B', scoreGrade: 'B' } };
    const r = assessmentReadings(uncapped);
    expect(r.supportsConclusion).toBe(true);
    expect(r.conclusionLine).toContain('supports the overall assessment');
  });

  it('states the rounding caveat rather than claiming the printed weights total 100', () => {
    const r = assessmentReadings(CAPPED);
    // 57.14 + 21.43 + 21.43 = 100.00; 57 + 21 + 21 = 99.
    expect(r.weightRoundingNote).toContain('exactly 100% unrounded');
    expect(r.weightRoundingNote).toContain('so they may not');
  });
});

describe('nothing is invented where the record holds nothing', () => {
  it('answers an empty record with nulls and no conclusion', () => {
    for (const empty of [null, undefined, {}, { v2: null }]) {
      const r = assessmentReadings(empty as never);
      expect(r.measuredScore).toBeNull();
      expect(r.issuedGrade).toBeNull();
      expect(r.coveragePercent).toBeNull();
      expect(r.supportsConclusion).toBe(false);
      expect(r.conclusionLine).toBeNull();
      expect(r.weightRoundingNote).toBeNull();
    }
  });

  it('treats the scorer’s N/A sentinel as no grade, never as a grade', () => {
    const r = assessmentReadings({ v2: { grade: 'N/A', scoreGrade: 'N/A' } } as never);
    expect(r.issuedGrade).toBeNull();
    expect(r.measuredGrade).toBeNull();
  });
});

describe('every report binds them, because the projection publishes them', () => {
  const projected = projectInvestmentReport({
    id: 'r1',
    property_address: '1 Example Street, Sampletown NSW 2000',
    investment_score: CAPPED,
  } as never);

  it('publishes each reading under its own name', () => {
    const r = projected.recommendation as Record<string, unknown>;
    expect(r.measuredLine).toBe('40 · C');
    expect(r.coverageLabel).toBe('57%');
    expect(r.criteriaMeasuredLine).toBe('3 of 5');
    expect(r.gradeCapped).toBe(true);
    expect(r.capExplanation).toContain('28 of the composite');
    expect(r.conclusionLine).toContain('does not support an overall recommendation');
    expect(r.weightRoundingNote).toContain('unrounded');
  });

  it('publishes nothing bindable where the record holds nothing', () => {
    const empty = projectInvestmentReport({ id: 'r2', property_address: 'x' } as never);
    const r = empty.recommendation as Record<string, unknown>;
    for (const key of ['measuredLine', 'coverageLabel', 'criteriaMeasuredLine', 'gradeCapped',
      'capExplanation', 'conclusionLine', 'weightRoundingNote']) {
      expect(r[key]).toBeUndefined();
    }
  });
});

describe('the document being PRODUCED decides, everywhere', () => {
  const row = {
    id: 'r3',
    property_address: '1 Example Street, Sampletown NSW 2000',
    report_tier: 'compass',
    investment_score: CAPPED,
  };

  it('names the tier it is producing, not the tier it was stored as', () => {
    // `options.tier` used to reach the content policy and nothing else, so a
    // fork producing a Financial Analysis from a Compass parent carried the
    // parent's title on every page while drawing the child's content.
    const produced = projectInvestmentReport({ ...row } as never, { tier: 'financial' });
    expect((produced.report as Record<string, unknown>).tier).toBe('financial');
    expect((produced.report as Record<string, unknown>).documentTitle).not.toBe('Investment Compass');
  });

  it('falls back to the stored tier when no tier is named', () => {
    const stored = projectInvestmentReport({ ...row } as never);
    expect((stored.report as Record<string, unknown>).tier).toBe('compass');
    expect((stored.report as Record<string, unknown>).documentTitle).toBe('Investment Compass');
  });

  it('publishes coverage per criterion, so a withheld rationale leaves no empty cell', () => {
    // The scorecard's fourth column bound `details` — the criterion's
    // RATIONALE — and for Yield that rationale IS the modelling, so a tier
    // that withholds modelling drew a labelled blank.
    const p = projectInvestmentReport({ ...row } as never);
    const byLabel = Object.fromEntries(
      (p.assessment as Array<Record<string, unknown>>).filter((e) => e.scored).map((e) => [e.label, e]),
    );
    expect(byLabel.Growth?.measuredOn).toBe('Full method');
    expect(byLabel.Yield?.measuredOn).toBe('Full method');
    expect(byLabel.Demand?.measuredOn).toBe('15% of method');
    // Yield's rationale stays withheld on a Compass; its coverage does not.
    expect(byLabel.Yield?.details).toBeUndefined();
  });
});
