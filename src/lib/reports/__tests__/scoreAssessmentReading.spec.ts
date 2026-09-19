/**
 * The assessment behind a grade, reconstructed from two real stored scores.
 *
 * One row can be reproduced by coincidence; two with different caps cannot.
 * Both fixtures are production rows read on 18 September 2026 — see
 * `fixtures/storedScores.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  assessmentPrecisionNote,
  readScoreAssessment,
} from '../../../../supabase/functions/_shared/reports/market/scoreAssessmentReading.pure';
import { ANNABELLE_SCORE, PALLAS_SCORE } from './fixtures/storedScores';

describe('the stored weight is the ADJUSTED weight', () => {
  it('reads 57/21/21 as .40/.15/.15 renormalised over the measured .70', () => {
    const a = readScoreAssessment(ANNABELLE_SCORE);
    const growth = a.dimensions.find((d) => d.key === 'growth')!;
    expect(growth.nominalWeight).toBe(0.4);
    expect(growth.adjustedWeight).toBeCloseTo(0.5714, 4);
    const rental = a.dimensions.find((d) => d.key === 'yield')!;
    expect(rental.nominalWeight).toBe(0.15);
    expect(rental.adjustedWeight).toBeCloseTo(0.2143, 4);
  });

  it('gives an unscored dimension its original weight and no contribution', () => {
    const a = readScoreAssessment(ANNABELLE_SCORE);
    const location = a.dimensions.find((d) => d.key === 'location')!;
    expect(location.nominalWeight).toBe(0.25);
    expect(location.adjustedWeight).toBe(0);
    expect(location.contribution).toBeNull();
    expect(location.deliveredPoints).toBeNull();
    expect(location.excluded).toBe(true);
  });
});

describe('the arithmetic reproduces the stored total exactly', () => {
  /*
   * Rounding each contribution first gives 31.9 + 4.8 + 2.7 = 39.4 against a
   * stored 40, and 44.0 + 11.1 + 7.4 = 62.3 against a stored 63. The engine
   * rounds ONCE, on the sum, using the exact fractions.
   */
  it('18 Annabelle Crescent: 39.71 rounds once to the stored 40', () => {
    const a = readScoreAssessment(ANNABELLE_SCORE);
    expect(a.compositeExact).toBeCloseTo(39.71, 2);
    expect(a.compositeScore).toBe(40);
    expect(a.compositeScore).toBe(a.storedTotal);
    expect(a.uncappedGrade).toBe('C');
    /*
     * RENEGOTIATED 18 September 2026 — a missing stamp is not evidence.
     *
     * The delivered-points ceiling belonged to scoring-v2 alone, and this
     * fixture names no scoring system, so attributing it here would infer a
     * methodology from an ABSENCE. The composite, the uncapped grade and the
     * issued grade are unaffected and still asserted above; the ceiling path
     * is exercised in `scorePublicationConsumers.spec.ts` against a record
     * that DOES name scoring-v2.
     */
    expect(a.methodology).toBe('unknown');
    expect(a.deliveredPoints, 'no ceiling for an unstated methodology').toBeNull();
    expect(a.nominalCeiling).toBeNull();
    expect(a.issuedGrade).toBe('F');
    expect(a.capped).toBe(true);
  });

  it('262 Pallas Street: 62.86 rounds once to the stored 63, and caps to C', () => {
    const a = readScoreAssessment(PALLAS_SCORE);
    expect(a.compositeExact).toBeCloseTo(62.86, 2);
    expect(a.compositeScore).toBe(63);
    expect(a.compositeScore).toBe(a.storedTotal);
    expect(a.uncappedGrade).toBe('B');
    // Same rule as Annabelle above: this fixture names no scoring system.
    expect(a.methodology).toBe('unknown');
    expect(a.deliveredPoints).toBeNull();
    expect(a.nominalCeiling).toBeNull();
    expect(a.issuedGrade).toBe('C');
    expect(a.capped).toBe(true);
  });

  it('explains the rounding rather than asserting the number', () => {
    const note = assessmentPrecisionNote(readScoreAssessment(ANNABELLE_SCORE))!;
    expect(note).toContain('39.71');
    expect(note).toContain('rounded once');
  });
});

describe('what the record does not retain is named, never substituted', () => {
  it('reports evidence coverage as absent rather than as weightCovered', () => {
    const a = readScoreAssessment(ANNABELLE_SCORE);
    expect(a.evidenceCoverage).toBeNull();
    expect(a.measuredNominalWeight).toBe(0.7);
    expect(a.notRetained.join(' ')).toContain('Evidence coverage');
    // The ceiling paragraph follows the methodology that applies; on a record
    // that states none, the honest sentence is that none is claimed.
    expect(a.notRetained.join(' ')).toContain('does not state which scoring methodology');
  });

  it('never describes its own position on the page', () => {
    const a = readScoreAssessment(ANNABELLE_SCORE);
    for (const n of a.notRetained) {
      expect(n, n).not.toMatch(/\b(above|below)\b/);
    }
  });
});

describe('an exclusion is about the record, never about the area', () => {
  it('prefers the row’s client sentence over the engine’s internal one', () => {
    const a = readScoreAssessment(ANNABELLE_SCORE);
    const location = a.dimensions.find((d) => d.key === 'location')!;
    expect(location.exclusionReason).toBe(
      'Not assessed — the available location information does not meet the current verification standard.',
    );
    expect(location.exclusionReason).not.toContain('could be measured');
    expect(location.exclusionRemedy).toContain('acquisition stamp');
  });

  it('falls back to a corrected sentence where the row carries none', () => {
    const stripped = { ...ANNABELLE_SCORE, notAssessed: {}, gradeGaps: [] };
    const location = readScoreAssessment(stripped).dimensions.find((d) => d.key === 'location')!;
    expect(location.exclusionReason).toContain('no longer carries them in a form');
    expect(location.exclusionReason).not.toContain('No location inputs could be measured');
    expect(location.exclusionRemedy).toBeNull();
  });
});

describe('total on anything', () => {
  it('answers an absent, malformed or empty score without throwing', () => {
    for (const input of [null, undefined, 42, 'x', [], {}, { breakdown: null }]) {
      const a = readScoreAssessment(input);
      expect(a.dimensions).toHaveLength(5);
      expect(a.compositeScore).toBeNull();
      expect(a.dimensions.every((d) => d.score === null)).toBe(true);
    }
  });
});
