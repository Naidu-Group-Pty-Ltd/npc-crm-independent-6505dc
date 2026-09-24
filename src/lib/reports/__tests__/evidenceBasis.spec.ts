/**
 * One generation, one evidence basis — pinned against the run that broke it.
 *
 * 60 Lawley Street, Spalding WA (report `5d8bc97e`, 24 Sep 2026): the first
 * invocation's location call was cut off at 12 s, so it scored the property
 * `withheld` on growth and yield alone and wrote sections 1–9; the second
 * invocation's call answered, the grade was B+ 89 on growth, location and
 * yield, and sections 10–16 were written on that. The row kept `withheld` for
 * the whole run because early persistence wrote the score only when the row
 * had none, and the final write stamped whatever the last invocation computed.
 *
 * These specs replay that sequence through the rule rather than asserting the
 * rule's own vocabulary, so they fail on the old behaviour.
 */
import { describe, expect, it } from 'vitest';
import {
  WRITTEN_BASIS_KEY,
  compareEvidenceBasis,
  decideWrittenBasis,
  evidenceBasisOf,
  isLocated,
  isProductionScoreRecord,
  withWrittenBasis,
  withoutWrittenBasis,
  writtenBasisMarkerOf,
  type WrittenBasisInput,
} from '../../../../supabase/functions/_shared/reports/investment/evidenceBasis.pure';

/** A Scoring V2 production record, as `scoreForProduction` shapes it. */
const score = (grade: string | null, total: number | null, measured: string[]) => ({
  totalScore: total,
  grade,
  recommendation: grade ? 'x' : 'Grade withheld',
  policy: {
    scoringSystem: 'scoring-v2',
    authority: 'v2',
    gradeIssued: grade !== null,
    measuredDimensions: measured,
  },
});

const WITHHELD = score(null, null, ['growth', 'yield']);
const B_PLUS = score('B+', 89, ['growth', 'location', 'yield']);
const LOCATED = { coordinates: { lat: -28.7372735, lng: 114.6282027 } };

const property = (over: Partial<WrittenBasisInput>): WrittenBasisInput => ({
  applies: true,
  sectionsWritten: 0,
  storedScore: undefined,
  storedLocated: false,
  freshScore: undefined,
  freshLocated: false,
  ...over,
});

describe('60 Lawley Street, replayed', () => {
  it('pass 1 records its withheld score as the basis of the sections it is about to write', () => {
    const d = decideWrittenBasis(property({ freshScore: WITHHELD, freshLocated: false }));
    expect(d.action).toBe('record_first');
  });

  it('pass 2 holds a location the written sections lacked, so every section is rewritten', () => {
    const storedAfterPass1 = withWrittenBasis(WITHHELD, false, '2026-09-24T01:46:55Z');
    const d = decideWrittenBasis(property({
      sectionsWritten: 9,
      storedScore: storedAfterPass1,
      storedLocated: false,
      freshScore: B_PLUS,
      freshLocated: true,
    }));
    expect(d.action).toBe('rewrite');
    if (d.action !== 'rewrite') return;
    expect(d.gained).toEqual(['a verified location', 'location']);
  });

  it('pass 3 on the same evidence keeps the rewritten basis, and nothing is rewritten again', () => {
    const storedAfterRewrite = withWrittenBasis(B_PLUS, true, '2026-09-24T01:50:44Z', 1);
    const d = decideWrittenBasis(property({
      sectionsWritten: 1,
      storedScore: storedAfterRewrite,
      storedLocated: true,
      freshScore: B_PLUS,
      freshLocated: true,
    }));
    expect(d.action).toBe('keep_written');
  });

  it('a later pass that loses the location keeps B+ 89 rather than writing withheld over it', () => {
    const stored = withWrittenBasis(B_PLUS, true, '2026-09-24T01:50:44Z', 1);
    const d = decideWrittenBasis(property({
      sectionsWritten: 12,
      storedScore: stored,
      storedLocated: true,
      freshScore: WITHHELD,
      freshLocated: false,
    }));
    expect(d.action).toBe('keep_written');
    if (d.action !== 'keep_written') return;
    expect(d.change).toBe('lost');
    expect(d.lost).toEqual(['a verified location', 'location']);
  });

  it('the finished record carries the score and not the marker', () => {
    const stored = withWrittenBasis(B_PLUS, true, '2026-09-24T01:50:44Z', 1);
    const finished = withoutWrittenBasis(stored) as Record<string, unknown>;
    expect(finished[WRITTEN_BASIS_KEY]).toBeUndefined();
    expect(finished.grade).toBe('B+');
    expect(finished.totalScore).toBe(89);
  });
});

describe('what never restates a written grade', () => {
  const stored = withWrittenBasis(B_PLUS, true, '2026-09-24T01:50:44Z');

  it('a scoring call that failed outright', () => {
    const d = decideWrittenBasis(property({
      sectionsWritten: 5, storedScore: stored, storedLocated: true,
      freshScore: undefined, freshLocated: true,
    }));
    expect(d.action).toBe('keep_written');
  });

  it('the same evidence printing a different figure', () => {
    const d = decideWrittenBasis(property({
      sectionsWritten: 5, storedScore: stored, storedLocated: true,
      freshScore: score('B', 84, ['growth', 'location', 'yield']), freshLocated: true,
    }));
    expect(d.action).toBe('keep_written');
    if (d.action !== 'keep_written') return;
    expect(d.change).toBe('same');
    expect(d.note).toMatch(/different figure/);
  });

  it('a pass that gained one dimension and lost another', () => {
    const d = decideWrittenBasis(property({
      sectionsWritten: 5, storedScore: stored, storedLocated: true,
      freshScore: score('B', 80, ['demand', 'location', 'yield']), freshLocated: true,
    }));
    expect(d.action).toBe('keep_written');
    if (d.action !== 'keep_written') return;
    expect(d.change).toBe('mixed');
  });
});

describe('what the rule refuses to judge', () => {
  it('an unmarked stored score is never kept over a fresh one — it may be another generation\'s', () => {
    // A regeneration's row still carries the previous generation's grade.
    const leftover = score('A', 92, ['demand', 'growth', 'location', 'yield']);
    const d = decideWrittenBasis(property({
      sectionsWritten: 4, storedScore: leftover, storedLocated: true,
      freshScore: B_PLUS, freshLocated: true,
    }));
    expect(d.action).toBe('not_applicable');
  });

  it('an unmarked stored score is still superseded by strictly better evidence', () => {
    const d = decideWrittenBasis(property({
      sectionsWritten: 4, storedScore: WITHHELD, storedLocated: false,
      freshScore: B_PLUS, freshLocated: true,
    }));
    expect(d.action).toBe('rewrite');
  });

  it('sections written with no score at all are rewritten once a score exists', () => {
    const d = decideWrittenBasis(property({
      sectionsWritten: 3, storedScore: null, storedLocated: true,
      freshScore: B_PLUS, freshLocated: true,
    }));
    expect(d.action).toBe('rewrite');
  });

  it('an area report is not judged here', () => {
    expect(decideWrittenBasis(property({
      applies: false, sectionsWritten: 4, storedScore: WITHHELD, freshScore: B_PLUS, freshLocated: true,
    })).action).toBe('not_applicable');
  });

  it('a first invocation with no production score records nothing', () => {
    expect(decideWrittenBasis(property({ freshScore: undefined })).action).toBe('not_applicable');
    expect(decideWrittenBasis(property({ freshScore: { grade: 'C', totalScore: 55 } })).action)
      .toBe('not_applicable');
  });

  it('a first pass with no score of its own clears a marker a stopped document left behind', () => {
    // The previous generation was stopped at section 6: its B+ is still on the
    // row, marked. The regeneration's first pass could not score.
    const leftover = withWrittenBasis(B_PLUS, true, '2026-09-20T03:00:00Z', 0);
    const d = decideWrittenBasis(property({
      sectionsWritten: 0, storedScore: leftover, storedLocated: true,
      freshScore: undefined, freshLocated: true,
    }));
    expect(d.action).toBe('clear_marker');
  });

  it('…because left in place, the next pass would hold the stopped document\'s grade over its own', () => {
    const leftover = withWrittenBasis(B_PLUS, true, '2026-09-20T03:00:00Z', 0);
    const nextPass = { sectionsWritten: 4, storedLocated: true, freshScore: B_PLUS, freshLocated: true };
    // Not cleared: the marker reads as the basis of four sections it never
    // described, and the fresh score is refused.
    expect(decideWrittenBasis(property({ ...nextPass, storedScore: leftover })).action).toBe('keep_written');
    // Cleared: nothing claims to be the written basis, and the pass writes on
    // its own evidence, exactly as before this rule.
    expect(decideWrittenBasis(property({ ...nextPass, storedScore: withoutWrittenBasis(leftover) })).action)
      .toBe('not_applicable');
  });

  it('with no marker on the row there is nothing to clear', () => {
    expect(decideWrittenBasis(property({ storedScore: B_PLUS, freshScore: undefined })).action)
      .toBe('not_applicable');
  });

  it('a rewrite needs a fresh score it can record — a location alone cannot loop', () => {
    // Without this, a pass whose scoring failed but which held a location
    // would rewrite, persist nothing, and rewrite again on every invocation.
    const d = decideWrittenBasis(property({
      sectionsWritten: 3, storedScore: null, storedLocated: false,
      freshScore: undefined, freshLocated: true,
    }));
    expect(d.action).not.toBe('rewrite');
  });
});

describe('the marker', () => {
  it('only means something on the production record it was written with', () => {
    const forged = { grade: 'A', [WRITTEN_BASIS_KEY]: { version: 1, located: true, recordedAt: 'x', rewrites: 0 } };
    expect(writtenBasisMarkerOf(forged)).toBeNull();
    expect(isProductionScoreRecord(forged)).toBe(false);
  });

  it('round-trips located and the rewrite count', () => {
    const marked = withWrittenBasis(B_PLUS, true, '2026-09-24T01:50:44Z', 2);
    expect(writtenBasisMarkerOf(marked)).toEqual({
      version: 1, located: true, recordedAt: '2026-09-24T01:50:44Z', rewrites: 2,
    });
    // The original is not mutated.
    expect((B_PLUS as Record<string, unknown>)[WRITTEN_BASIS_KEY]).toBeUndefined();
  });

  it('reads a marker without a rewrite count as zero rewrites', () => {
    const legacy = { ...B_PLUS, [WRITTEN_BASIS_KEY]: { version: 1, located: false, recordedAt: 'x' } };
    expect(writtenBasisMarkerOf(legacy)?.rewrites).toBe(0);
  });

  it('isLocated reads a coordinate and nothing else', () => {
    expect(isLocated(LOCATED)).toBe(true);
    expect(isLocated({ coordinates: { lat: null, lng: 1 } })).toBe(false);
    expect(isLocated(undefined)).toBe(false);
  });
});

describe('the recorded basis only moves up, so a generation cannot oscillate', () => {
  const DIMENSIONS = ['demand', 'growth', 'location', 'risk', 'yield'];

  // A small deterministic generator, so a failure names its seed.
  const rng = (seed: number) => () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };

  it('over many noisy generations: never loses recorded evidence, rewrites a bounded number of times', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const next = rng(seed);
      let stored: unknown = undefined;
      let storedLocated = false;
      let sections = 0;
      // Rewrites since the basis was last recorded from nothing.
      let rewritesSinceRecorded = 0;
      // Which document the row's content is, and which one its marker was
      // recorded in: a kept score must always belong to the current one.
      let documentId = 0;
      let markerDocument = -1;
      for (let pass = 0; pass < 30; pass++) {
        const measured = DIMENSIONS.filter(() => next() < 0.6);
        const fresh = next() < 0.1 ? undefined : score(measured.length >= 3 ? 'B' : null, 70, measured);
        const freshLocated = next() < 0.7;
        const d = decideWrittenBasis(property({
          sectionsWritten: sections,
          storedScore: stored,
          storedLocated,
          freshScore: fresh,
          freshLocated,
        }));
        const at = `seed ${seed} pass ${pass}`;
        switch (d.action) {
          case 'record_first':
            documentId += 1;
            markerDocument = documentId;
            rewritesSinceRecorded = 0;
            stored = withWrittenBasis(fresh, freshLocated, 't', 0);
            storedLocated = freshLocated;
            sections = 1;
            break;
          case 'rewrite': {
            // Strictly up the lattice from whatever the row said it was
            // written from, marked or not.
            const written = evidenceBasisOf(stored, writtenBasisMarkerOf(stored)?.located ?? storedLocated);
            expect(compareEvidenceBasis(written, evidenceBasisOf(fresh, freshLocated)).change, at).toBe('gained');
            documentId += 1;
            markerDocument = documentId;
            rewritesSinceRecorded += 1;
            stored = withWrittenBasis(fresh, freshLocated, 't', rewritesSinceRecorded);
            storedLocated = freshLocated;
            // The reset and the new basis land in one write, and sometimes the
            // pass then dies before its first section: the next pass starts a
            // new document.
            sections = next() < 0.15 ? 0 : 1;
            break;
          }
          case 'clear_marker':
            expect(sections, at).toBe(0);
            documentId += 1;
            markerDocument = -1;
            stored = withoutWrittenBasis(stored);
            sections = 1;
            break;
          case 'keep_written':
            // A kept score was recorded in THIS document — never one a
            // restarted or stopped document left behind.
            expect(markerDocument, at).toBe(documentId);
            sections += 1;
            break;
          default:
            if (sections === 0) documentId += 1;
            sections += 1;
        }
        // located + five dimensions: at most six strict steps up from any
        // recorded basis. Only a restart that died goes back to the start, and
        // then the count starts again with it.
        expect(rewritesSinceRecorded, at).toBeLessThanOrEqual(6);
      }
    }
  });
});
