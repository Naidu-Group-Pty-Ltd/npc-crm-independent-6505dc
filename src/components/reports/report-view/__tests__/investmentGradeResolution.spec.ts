import { describe, expect, it } from 'vitest';
import {
  getInvestmentGradeTone,
  getInvestmentScoreSummary,
  gradeWithheldStatement,
  readGradePolicy,
  resolveCardInvestmentGrade,
  resolveInvestmentGrade,
} from '../utils';

/**
 * The 291 Stone Mason Drive rows of 15 Sep 2026, as stored: the Compass
 * composite whose run withheld the grade under the scoring policy, and the
 * Financial fork that minted a V1 grade seven minutes later with no stamp.
 */
const withheldComposite = (id: string, created_at: string) => ({
  id, created_at, status: 'completed', report_scope: 'address',
  investment_score: {
    grade: 'N/A', totalScore: null,
    recommendation: 'An overall investment grade is only issued when sufficient verified property evidence is available. Available measured analysis is shown below.',
    coverage: { dimensionsScored: 1, totalDimensions: 5, coverageRatio: 0.2, dataInsufficient: true, partialLabel: 'Insufficient data — qualitative review only (1 of 5 dimensions)' },
    policy: { authority: 'unavailable', eligibility: 'no_authorised_scoring_system', gradeIssued: false, dimensionScoresAuthoritative: false, measuredDimensions: ['yield'] },
  },
});
const financialVariantD = (id: string, created_at: string) => ({
  id, created_at, status: 'completed', report_scope: 'address',
  investment_score: { grade: 'D', totalScore: 39, recommendation: 'CAUTION', variant: 'financial', breakdown: {} },
});

const report = (overrides: Record<string, unknown> = {}) => ({
  id: 'report-1',
  created_at: '2026-07-24T10:00:00.000Z',
  status: 'completed',
  investment_score: undefined,
  ...overrides,
});

describe('resolveInvestmentGrade', () => {
  it('uses the most recent calculated persisted score rather than report variant order', () => {
    const resolved = resolveInvestmentGrade([
      report({ id: 'compass', created_at: '2026-07-22T10:00:00.000Z', investment_score: { grade: 'B', totalScore: 68 } }),
      report({ id: 'briefing', created_at: '2026-07-24T10:00:00.000Z', investment_score: { grade: 'A', totalScore: 84 } }),
    ] as any);

    expect(resolved).toMatchObject({ status: 'calculated', grade: 'A', score: 84, sourceReportId: 'briefing' });
  });

  it('keeps a completed score authoritative while a newer regeneration is pending', () => {
    const resolved = resolveInvestmentGrade([
      report({ id: 'completed', created_at: '2026-07-22T10:00:00.000Z', investment_score: { grade: 'B+', totalScore: 76 } }),
      report({ id: 'regenerating', created_at: '2026-07-24T10:00:00.000Z', status: 'processing' }),
    ] as any);

    expect(resolved).toMatchObject({ status: 'calculated', grade: 'B+', score: 76, sourceReportId: 'completed' });
  });

  it.each([
    [{ status: 'pending' }, 'pending'],
    [{ status: 'failed' }, 'failed'],
    [{ investment_score: { coverage: { dataInsufficient: true } } }, 'insufficient_data'],
    [{}, 'not_graded'],
  ] as const)('returns %s safely without inventing a score', (input, status) => {
    const resolved = resolveInvestmentGrade([report(input)] as any);
    expect(resolved.status).toBe(status);
    expect(resolved.score).toBeNull();
  });
});

describe('a grade the scoring policy withheld', () => {
  it('reads the stamp, and draws no grade and no score — never the literal N/A', () => {
    // The page header read "Investment Grade N/A" on 15 Sep 2026: the
    // record's placeholder drawn as a grade.
    const summary = getInvestmentScoreSummary(withheldComposite('compass', '2026-09-15T05:49:46Z') as any);
    expect(summary.grade).toBeNull();
    expect(summary.score).toBeNull();
    expect(summary.insufficient).toBe(true);
    expect(summary.withheld).toMatchObject({ reason: 'no_authorised_scoring_system', measured: ['yield'] });
    expect(summary.withheld!.statement).toBe(
      'Withheld by the scoring policy: no scoring system is currently authorised to issue an overall grade for new reports. 1 of 5 dimensions measured (yield).',
    );
    // The client-facing sentence the record carries is still available to draw beneath it.
    expect(summary.recommendation).toMatch(/only issued when sufficient verified property evidence/);
  });

  it('names insufficient verified evidence when that is what the stamp says', () => {
    const reading = readGradePolicy({ policy: { gradeIssued: false, eligibility: 'insufficient_verified_evidence', measuredDimensions: ['yield', 'growth'] } });
    expect(reading).toEqual({ stamped: true, issued: false, reason: 'insufficient_verified_evidence', measured: ['yield', 'growth'], gaps: [] });
    expect(gradeWithheldStatement(reading)).toBe('Withheld by the scoring policy: insufficient verified property evidence. Measured: yield, growth.');
  });

  it('reads an unstamped score as issued — a historical grade renders as it always did', () => {
    expect(readGradePolicy({ grade: 'B', totalScore: 68 })).toEqual({ stamped: false, issued: true, reason: null, measured: [], gaps: [] });
    const summary = getInvestmentScoreSummary({ investment_score: { grade: 'B', totalScore: 68 } } as any);
    expect(summary).toMatchObject({ grade: 'B', score: 68, withheld: null, insufficient: false });
  });

  it('a stamp that ISSUED the grade changes nothing', () => {
    const summary = getInvestmentScoreSummary({ investment_score: { grade: 'B+', totalScore: 71, policy: { gradeIssued: true, eligibility: 'issued' } } } as any);
    expect(summary).toMatchObject({ grade: 'B+', score: 71, withheld: null });
  });
});

describe('one property, one grade reading (15 Sep 2026)', () => {
  it('the withheld composite outranks the Financial fork\'s D · 39, on the package card and every sibling', () => {
    // As stored: Compass 05:49 (withheld), Financial 00:49 (D · 39, no stamp),
    // Snapshot and Briefing (withheld, older). The package card showed the D.
    const pool = [
      withheldComposite('compass-2', '2026-09-15T05:49:46Z'),
      withheldComposite('snapshot', '2026-09-15T01:03:06Z'),
      financialVariantD('financial', '2026-09-15T00:49:42Z'),
      withheldComposite('compass-1', '2026-09-15T00:35:33Z'),
    ];
    const resolved = resolveInvestmentGrade(pool as any);
    expect(resolved.status).toBe('withheld');
    expect(resolved.sourceReportId).toBe('compass-2');
    expect(resolved.grade).toBeNull();
    expect(resolved.score).toBeNull();
    expect(resolved.withheld?.reason).toBe('no_authorised_scoring_system');

    // The Financial card borrows the property's reading and says whose it is.
    const card = resolveCardInvestmentGrade(financialVariantD('financial', '2026-09-15T00:49:42Z') as any, pool as any);
    expect(card.show).toBe(true);
    expect(card.grade.status).toBe('withheld');
    expect(card.borrowedFromReportId).toBe('compass-2');
  });

  it('a variant score never stands for the property while a composite exists, even a newer variant', () => {
    const pool = [
      financialVariantD('financial', '2026-09-02T00:00:00Z'),
      { ...withheldComposite('compass', '2026-09-01T00:00:00Z'), investment_score: { grade: 'B', totalScore: 68 } },
    ];
    expect(resolveInvestmentGrade(pool as any)).toMatchObject({ status: 'calculated', grade: 'B', score: 68, sourceReportId: 'compass' });
  });

  it('a variant score stands only where no report carries a composite score at all', () => {
    expect(resolveInvestmentGrade([financialVariantD('financial', '2026-09-02T00:00:00Z')] as any))
      .toMatchObject({ status: 'calculated', grade: 'D', score: 39, sourceReportId: 'financial' });
  });

  it('the newest decision wins between a withholding and a calculated composite', () => {
    const graded = { ...withheldComposite('graded', '2026-09-12T00:00:00Z'), investment_score: { grade: 'B', totalScore: 68 } };
    expect(resolveInvestmentGrade([withheldComposite('withheld', '2026-09-11T00:00:00Z'), graded] as any).status).toBe('calculated');
    expect(resolveInvestmentGrade([withheldComposite('withheld', '2026-09-13T00:00:00Z'), graded] as any).status).toBe('withheld');
  });

  it('a withheld reading is never lent to an area-scope report', () => {
    const suburb = { id: 'suburb', created_at: '2026-09-15T06:00:00Z', status: 'completed', report_scope: 'suburb', investment_score: null };
    const card = resolveCardInvestmentGrade(suburb as any, [withheldComposite('compass', '2026-09-15T05:49:46Z'), suburb] as any);
    expect(card.show).toBe(false);
  });
});

describe('investment score display values', () => {
  it('discards malformed JSON values before they reach the report UI', () => {
    const summary = getInvestmentScoreSummary(report({
      investment_score: {
        grade: { unexpected: 'A' },
        recommendation: ['Buy'],
        totalScore: 82,
        coverage: { partialLabel: 42 },
      },
    }) as any);

    expect(summary).toMatchObject({
      grade: null,
      recommendation: null,
      partialLabel: null,
      score: 82,
    });
  });

  it('handles a non-string grade defensively when called with untyped data', () => {
    expect(getInvestmentGradeTone({ unexpected: 'A' } as any)).toBe('bg-muted text-muted-foreground');
  });
});

/**
 * The reported defect: a property with all five report types showed the
 * Investment Grade on three cards and nothing at all on the Financial and
 * Strategic ones.
 *
 * It survived a partial fix because resolution and the render gate were two
 * expressions of one idea in two places — the card resolved across siblings
 * and then asked its own `investment_score` column whether to draw. These pin
 * the joined answer.
 */
describe('resolveCardInvestmentGrade', () => {
  const compass = {
    id: 'compass', created_at: '2026-09-01T00:00:00Z', status: 'completed',
    report_scope: 'property',
    investment_score: { overall_score: 82, grade: 'A', recommendation: 'Strong buy' },
  };
  const financial = {
    id: 'financial', created_at: '2026-09-02T00:00:00Z', status: 'completed',
    report_scope: 'property', investment_score: null,
  };

  it('shows the property grade on a report that carries no score of its own', () => {
    const result = resolveCardInvestmentGrade(financial as any, [compass, financial] as any);
    expect(result.show).toBe(true);
    expect(result.grade.status).toBe('calculated');
    expect(result.grade.score).toBe(82);
  });

  it('says the grade was borrowed, so the card can attribute it', () => {
    const result = resolveCardInvestmentGrade(financial as any, [compass, financial] as any);
    expect(result.borrowedFromReportId).toBe('compass');
  });

  it('does not call a report grade borrowed when it produced the score itself', () => {
    const result = resolveCardInvestmentGrade(compass as any, [compass, financial] as any);
    expect(result.borrowedFromReportId).toBeNull();
    expect(result.show).toBe(true);
  });

  it('shows nothing when no sibling ever calculated a grade', () => {
    // Pending, failed and ungraded are the sibling's news, not this
    // property's; repeating them here reports a state this report is not in.
    const pending = { ...financial, id: 'pending', status: 'processing' };
    const result = resolveCardInvestmentGrade(financial as any, [pending, financial] as any);
    expect(result.show).toBe(false);
  });

  it('never lends a property grade to an area-scope report', () => {
    const suburb = { ...financial, id: 'suburb', report_scope: 'suburb' };
    const result = resolveCardInvestmentGrade(suburb as any, [compass, suburb] as any);
    expect(result.show).toBe(false);
  });

  it('falls back to the report alone when the siblings are unknown', () => {
    expect(resolveCardInvestmentGrade(financial as any).show).toBe(false);
    expect(resolveCardInvestmentGrade(compass as any).show).toBe(true);
  });
});
