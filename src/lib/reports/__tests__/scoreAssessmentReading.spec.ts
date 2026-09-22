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
    /*
     * This asserted `exclusionRemedy` CONTAINED 'acquisition stamp', and in
     * doing so it pinned the defect `gradeGapAudience.spec.ts` was written
     * for: `remedy` is the OPERATOR field — function names, documentation
     * paths and release codes — and this bullet is drawn in the client's
     * Compass under *What each dimension rested on*. The full sentence it was
     * vouching for reads "Regenerate the report: the location service
     * re-acquires the enrichment with its acquisition stamp (RF-7.2B) …".
     *
     * The bullet reads `readerRemedy` now and fails CLOSED, so a row written
     * before that field existed — which `ANNABELLE_SCORE` is — renders its
     * reason alone. The operator's remedy is untouched and still carries
     * every name it needs; it simply has one reader again instead of two.
     */
    expect(location.exclusionRemedy).toBeNull();
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

/**
 * The Method page printed a different grade from the cover.
 *
 * Measured on the 97 Poole Road Compass of 20 Sep 2026, read as a delivered
 * PDF. The cover, the verdict page, the risk page and the page-4 assessment
 * table all print **54**. Page 38 prints:
 *
 *     Composite score 51. The contributions come to 50.95…
 *
 * directly above the line "Calculated by this platform's investment scoring
 * service. No figure in this table is re-derived by this report; the
 * arithmetic above restates the engine's own."
 *
 * It was re-derived. `compositeScore` was `Math.round(Σ contributions)` over
 * weights this module reconstructed as `nominal ÷ Σ nominal(measured)`, while
 * the engine renormalises the EVIDENCE weights — nominal scaled by how much of
 * each dimension's own method ran. On this record that is 47/30/18/5 against a
 * reconstruction of 42/26/16/16, because Demand scored on a fraction of its
 * method.
 *
 * `storedTotal` was already computed on this reading and read by NOTHING — the
 * one field that would have caught it.
 */
const POOLE_SCORE = {
  totalScore: 54,
  grade: 'C+',
  policy: { publicationPolicyVersion: 'ME-8' },
  breakdown: {
    growthScore: { score: 56, weight: 47, details: 'Five-year capital growth 6.2% pa.' },
    locationScore: { score: 74, weight: 30, details: 'Nearest public transport 1.6 km away.' },
    yieldScore: { score: 23, weight: 18, details: '3.47% gross yield.' },
    demandScore: { score: 27, weight: 5, details: '162 sales in postcode 2155.' },
    riskScore: { excluded: true },
  },
};

describe('the composite is the record\'s, never a recomputation', () => {
  it('prints the 54 the record holds, not the 51 the reconstruction gives', () => {
    const a = readScoreAssessment(POOLE_SCORE);
    expect(a.storedTotal).toBe(54);
    expect(a.compositeScore).toBe(54);
    expect(a.compositeSource).toBe('recorded');
    // The reconstruction, for the record: 56×.421 + 74×.263 + 23×.158 +
    // 27×.158 = 50.95 → 51. That is the number the delivered PDF printed.
    const reconstructed = 56 * (0.40 / 0.95) + 74 * (0.25 / 0.95)
      + 23 * (0.15 / 0.95) + 27 * (0.15 / 0.95);
    expect(Math.round(reconstructed)).toBe(51);
    expect(a.compositeScore).not.toBe(Math.round(reconstructed));
  });

  it('uses the record\'s own weights where they contradict the reconstruction', () => {
    const a = readScoreAssessment(POOLE_SCORE);
    expect(a.weightBasis).toBe('recorded');
    const pct = (k: string) => Math.round(
      a.dimensions.find((d) => d.key === k)!.adjustedWeight * 100,
    );
    expect([pct('growth'), pct('location'), pct('yield'), pct('demand')]).toEqual([47, 30, 18, 5]);
    // Demand's original weight is 15% and it carried 5% — the gap IS the
    // coverage discount, and the reader is told so rather than shown two
    // tables that disagree.
    expect(a.dimensions.find((d) => d.key === 'demand')!.nominalWeight).toBe(0.15);
  });

  it('adds up: the printed column reaches the printed total', () => {
    const a = readScoreAssessment(POOLE_SCORE);
    expect(a.compositeExact).toBeCloseTo(54.01, 2);
    expect(a.contributionsFoot).toBe(true);
    expect(Math.round(a.compositeExact!)).toBe(a.compositeScore);
  });

  it('keeps the EXACT fractions where the record confirms them', () => {
    /*
     * The other half, and the reason this is not simply "read the record".
     * 18 Annabelle Crescent stores 57/21/21, which rounds to the
     * reconstruction's 57.14/21.43/21.43 — one weighting, and the exact
     * fractions reproduce the stored total to the decimal where the rounded
     * ones do not (39.71 → 40 against 39.48 → 39).
     */
    const a = readScoreAssessment(ANNABELLE_SCORE);
    expect(a.weightBasis).toBe('reconstructed');
    expect(a.compositeSource).toBe('recorded');
    expect(a.compositeExact).toBeCloseTo(39.71, 2);
    expect(a.compositeScore).toBe(40);
    expect(a.contributionsFoot).toBe(true);
  });

  it('reconstructs only where the record holds no total of its own', () => {
    const noTotal = { ...POOLE_SCORE, totalScore: null };
    const a = readScoreAssessment(noTotal);
    expect(a.compositeSource).toBe('reconstructed');
    expect(a.compositeScore).toBe(Math.round(a.compositeExact!));
  });

  it('never lets a stored total override the publication policy', () => {
    // One valid dimension and a totalScore of 90: the policy withholds an
    // overall, and a figure in a column is not a licence to publish one.
    const thin = {
      totalScore: 90,
      grade: 'A',
      policy: { publicationPolicyVersion: 'ME-8' },
      breakdown: {
        growthScore: { score: 56, weight: 100 },
        locationScore: { excluded: true },
        yieldScore: { excluded: true },
        demandScore: { excluded: true },
        riskScore: { excluded: true },
      },
    };
    const a = readScoreAssessment(thin);
    expect(a.publishable).toBe(false);
    expect(a.compositeScore).toBeNull();
    expect(a.compositeSource).toBeNull();
    expect(a.withheldReason).toBeTruthy();
  });

  it('says what the arithmetic is, and never asserts a rounding that does not happen', () => {
    expect(assessmentPrecisionNote(readScoreAssessment(POOLE_SCORE)))
      .toContain('the figure the scoring service recorded');
    expect(assessmentPrecisionNote(readScoreAssessment(ANNABELLE_SCORE)))
      .toContain('rounded once');
    // A record whose stored weights cannot reproduce its total says so rather
    // than printing a sum beside a different number as though they agreed.
    const skewed = {
      ...POOLE_SCORE,
      breakdown: { ...POOLE_SCORE.breakdown, demandScore: { score: 27, weight: 14 } },
    };
    const a = readScoreAssessment(skewed);
    expect(a.contributionsFoot).toBe(false);
    expect(assessmentPrecisionNote(a)).toContain('shape of the result');
  });
});
