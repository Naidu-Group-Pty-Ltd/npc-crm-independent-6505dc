/**
 * The letter is the band of the score — eligibility 5.0.0.
 *
 * The owner's report list, 24 Sep 2026: **60 Lawley Street, Spalding WA at
 * B+ · 89** beside **9 Hollow Street, Golden Square VIC at A · 77**. A higher
 * score printed a lower letter. Measured from the production run: Lawley's
 * growth came from the ABS state series for Western Australia (8 points, all
 * dwelling types, no sales count), whose growth confidence cannot exceed 44 —
 * one under the A test of 45 — so every property graded on a state series
 * was held at B+ whatever it scored. The owner's decision: the letter follows
 * the score, A+ from 80, and what the evidence is gets said beside it.
 *
 * These pins drive the REAL engine and the real readers: the production
 * projection, the stored-score reading, the Method page composer, the
 * condensed verdict lines, the generator's prompt block and the screen's
 * grade reading. The market VALUES below are illustrative; the SHAPE of the
 * state-series evidence is the production one (`openDataSalesPoints` for an
 * `abs_res_dwell` state reading).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  scoreForProduction,
  type ProductionScoringInput,
} from '../../../../supabase/functions/_shared/reports/market/scoringV2Production.pure';
import { readScoreAssessment } from '../../../../supabase/functions/_shared/reports/market/scoreAssessmentReading.pure';
import { composeScoreDimensionTable } from '../../../../supabase/functions/_shared/reports/investment/strategyPositions.pure';
import { evidenceCautionLine } from '../../../../supabase/functions/_shared/reports/investment/scoreSections.pure';
import { investmentScorePromptBlock } from '../../../../supabase/functions/_shared/reports/investment/scorePromptBlock.pure';
import { getInvestmentScoreSummary } from '@/components/reports/report-view/utils';

const REPO = resolve(__dirname, '../../../..');
const NOW = new Date('2026-09-24T01:54:00Z');

type Level = 'suburb' | 'postcode' | 'lga' | 'state' | 'national';

const point = (value: unknown, level: Level, areaName: string, o: Record<string, unknown> = {}) => ({
  value, level, areaName,
  dwellingType: level === 'state' || level === 'national' ? 'any' : 'house',
  dwellingTypeMatched: !(level === 'state' || level === 'national'),
  provider: level === 'state' || level === 'national' ? 'abs_res_dwell' : 'vic_vpsr_suburb',
  asOf: '2026-06-30',
  sampleSize: level === 'state' || level === 'national' ? null : 120,
  periodsAvailable: 60,
  method: 'calculated',
  licensingStatus: 'open',
  acquisition: 'open_licence',
  sourceNote: null,
  ...o,
});

/** The market points a register reading hands the scorer, at a chosen grain. */
function growthPoints(level: Level, areaName: string, g1: number, g3: number, g5: number) {
  const series = Array.from({ length: 24 }, (_, i) => ({
    period: `20${20 + Math.floor(i / 4)}-Q${(i % 4) + 1}`,
    value: Math.round(550_000 * Math.pow(1 + g5 / 100, i / 4)),
  }));
  return {
    priceSeries: point(series, level, areaName),
    growth1Year: point(g1, level, areaName),
    growth3YearCagr: point(g3, level, areaName),
    growth5YearCagr: point(g5, level, areaName),
    benchmarkGrowth1Year: point(6, 'national', 'Australia'),
    benchmarkGrowth3YearCagr: point(6, 'national', 'Australia'),
    benchmarkGrowth5YearCagr: point(6.5, 'national', 'Australia'),
  };
}

/** 60 Lawley Street's own inputs, as the scoring service logged them on 24 Sep 2026. */
function lawley(points: Record<string, unknown>): ProductionScoringInput {
  return {
    subject: { suburb: 'Spalding', postcode: '6530', state: 'WA', dwellingType: 'house', resolvedFrom: 'coordinate' },
    market: {
      points: points as ProductionScoringInput['market']['points'],
      providersConsulted: ['abs_res_dwell'] as never,
      providersUnavailable: [{ provider: 'domain', reason: 'HTTP 403' }] as never,
    },
    property: { price: 499_000, weeklyRent: 525, annualOutgoings: null, propertyType: 'house' },
    finance: { lvr: 80, weeklyCashFlow: -192 },
    location: {
      walkScore: 70, commuteTimeCBD: 11, schoolsNearby: 7,
      commuteDestination: { label: 'Geraldton', ownCentre: 'yes' },
      amenities: [
        { category: 'Public Transport', count: 0, distance: null },
        { category: 'Schools', count: 7, distance: 0.75 },
        { category: 'Healthcare', count: 5, distance: 0.49 },
        { category: 'Shopping', count: 10, distance: 1.61 },
        { category: 'Recreation', count: 10, distance: 0.11 },
      ],
    },
    verifiedInputs: ['walkScore', 'commuteTimeCBD', 'schoolsNearby'],
    now: NOW,
  };
}

const LAWLEY_CAUTION = 'Capital growth is measured for Western Australia as a whole and across all dwelling '
  + "types, not for this property's suburb and dwelling type.";

describe('60 Lawley Street: a state-series growth reading no longer holds an A+ score at B+', () => {
  const record = scoreForProduction(lawley(growthPoints('state', 'Western Australia', 12, 14, 11)));
  const v2 = record.v2 as unknown as Record<string, unknown>;

  it('prints the letter the score gives', () => {
    expect(record.totalScore).not.toBeNull();
    expect(record.totalScore!).toBeGreaterThanOrEqual(80);
    expect(record.grade).toBe('A+');
    expect(v2.grade).toBe(v2.scoreGrade);
    expect(v2.gradeCapped).toBe(false);
    expect(v2.gradeCapReasons).toEqual([]);
  });

  it('states what the growth evidence is, beside the grade, in words a client can read', () => {
    expect(record.evidenceCaution).not.toBeNull();
    expect(record.evidenceCaution!.statement).toBe(LAWLEY_CAUTION);
    expect(v2.gradeCaution).toBe(LAWLEY_CAUTION);
    // The operator's detail keeps the number the owner can check.
    expect(record.evidenceCaution!.cautions.join(' ')).toMatch(/Growth evidence confidence is 44 \(low\)/);
    // What the evidence carries on its own is recorded, not applied.
    expect(record.evidenceCaution!.supports).toBe('B+');
  });

  it('44 is the ceiling of ANY state series, however fresh and deep — one under the A test', () => {
    const growthConfidence = (r: ReturnType<typeof scoreForProduction>) =>
      (r.v2.dimensions.find((d) => d.key === 'growth')?.confidence) ?? null;
    for (const [g1, g3, g5] of [[2, 3, 4], [12, 14, 11], [25, 20, 15]]) {
      const r = scoreForProduction(lawley(growthPoints('state', 'Western Australia', g1, g3, g5)));
      expect(growthConfidence(r), `${g1}/${g3}/${g5}`).toBe(44);
    }
  });

  it('a suburb series carries its letter with no caution — Hollow Street\'s case', () => {
    const suburb = scoreForProduction(lawley(growthPoints('suburb', 'Golden Square', 8, 9, 7)));
    expect(suburb.grade).not.toBeNull();
    expect(suburb.evidenceCaution).toBeNull();
    expect((suburb.v2 as unknown as Record<string, unknown>).gradeCaution).toBeNull();
  });

  it('a caution never travels without a grade', () => {
    // Two dimensions only: the publication policy withholds the grade, so no
    // caution may be published whatever the evidence tests found.
    const withheld = scoreForProduction({ ...lawley({}), location: {} });
    expect(withheld.grade).toBeNull();
    expect(withheld.evidenceCaution).toBeNull();
  });
});

describe('a stored grade is read by the line it was issued against', () => {
  const current = scoreForProduction(lawley(growthPoints('state', 'Western Australia', 12, 14, 11)));
  const asStored = (over: { grade: string; totalScore: number; version: string; caution?: boolean }) => {
    const row = JSON.parse(JSON.stringify(current)) as Record<string, any>;
    row.grade = over.grade;
    row.totalScore = over.totalScore;
    row.v2.gradeEligibility = { ...row.v2.gradeEligibility, version: over.version };
    row.v2.componentVersions = { ...row.v2.componentVersions, eligibility: over.version };
    if (!over.caution) {
      delete row.evidenceCaution;
      row.v2.gradeCaution = null;
    }
    return row;
  };

  it('an 82 issued as an A before 5.0.0 is NOT re-labelled a cap from A+', () => {
    const a = readScoreAssessment(asStored({ grade: 'A', totalScore: 82, version: '4.0.0' }));
    expect(a.uncappedGrade).toBe('A');
    expect(a.issuedGrade).toBe('A');
    expect(a.capped).toBe(false);
  });

  it('Lawley\'s own stored row — B+ at 89 under 4.0.0 — is still explained by the rule that capped it', () => {
    const a = readScoreAssessment(asStored({ grade: 'B+', totalScore: 89, version: '4.0.0' }));
    expect(a.uncappedGrade).toBe('A+');
    expect(a.issuedGrade).toBe('B+');
    expect(a.capped).toBe(true);
    expect(a.caution).toBeNull();
  });

  it('a 5.0.0 row carries its caution and is never read as capped', () => {
    const a = readScoreAssessment(asStored({ grade: 'A+', totalScore: 82, version: '5.0.0', caution: true }));
    expect(a.uncappedGrade).toBe('A+');
    expect(a.capped).toBe(false);
    expect(a.caution).toBe(LAWLEY_CAUTION);
    // No apology for an unretained ceiling: nothing was capped and what the
    // evidence carries is on the record.
    expect(a.notRetained.join(' ')).not.toMatch(/evidence ceiling/);
  });
});

describe('the caution reaches every surface that prints the grade', () => {
  const record = scoreForProduction(lawley(growthPoints('state', 'Western Australia', 12, 14, 11)));

  it('the Method page states it in the "Grade issued" step, not "both support"', () => {
    const table = composeScoreDimensionTable({
      score: { assessment: readScoreAssessment(record), authority: 'v2' },
    } as never);
    expect(table).not.toBeNull();
    expect(table!).toContain(`**Grade issued: A+**, the grade the composite gives. ${LAWLEY_CAUTION}`);
    expect(table!).not.toContain('which the composite and the evidence behind it both support');
  });

  it('the condensed documents read it through one helper, and only beside a printable grade', () => {
    expect(evidenceCautionLine(record)).toBe(LAWLEY_CAUTION);
    expect(evidenceCautionLine({ ...record, grade: 'N/A' })).toBeUndefined();
    expect(evidenceCautionLine({ ...record, evidenceCaution: null })).toBeUndefined();
  });

  it('the screen reads it beside the grade, and never beside a withheld one', () => {
    const shown = getInvestmentScoreSummary({ investment_score: record } as never);
    expect(shown.grade).toBe('A+');
    expect(shown.evidenceCaution).toBe(LAWLEY_CAUTION);
    const withheld = getInvestmentScoreSummary({
      investment_score: { ...record, policy: { ...record.policy, gradeIssued: false } },
    } as never);
    expect(withheld.evidenceCaution).toBeNull();
  });

  it('the Compass prompt states it beside the grade, and says nothing where there is none', () => {
    const block = investmentScorePromptBlock(record, { hasDocument: true });
    expect(block).toContain('**Investment Grade:** A+');
    expect(block).toContain(`**Evidence behind the grade:** ${LAWLEY_CAUTION}`);
    const plain = investmentScorePromptBlock({ ...record, evidenceCaution: null }, { hasDocument: true });
    expect(plain).not.toContain('Evidence behind the grade');
    // A withheld grade carries no caution into the prompt either.
    const withheld = investmentScorePromptBlock({ ...record, grade: 'N/A' }, { hasDocument: true });
    expect(withheld).not.toContain('Evidence behind the grade');
  });

  it('the model is handed it with the grade, so the prose cannot contradict it', () => {
    const generator = readFileSync(resolve(REPO, 'supabase/functions/generate-investment-report/index.ts'), 'utf8');
    const block = generator.slice(generator.indexOf('**INVESTMENT SCORE DATA (USE THESE EXACT VALUES):**'));
    expect(block.slice(0, 1_500)).toContain('evidenceCautionLine(score)');
    expect(block.slice(0, 1_500)).toContain('- Evidence behind the grade:');
  });
});
