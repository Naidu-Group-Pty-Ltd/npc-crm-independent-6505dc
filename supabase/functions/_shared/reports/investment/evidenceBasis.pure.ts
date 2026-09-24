/**
 * One generation, one evidence basis.
 *
 * ## What happened
 *
 * An investment report is written across several invocations, and every
 * invocation acquires its evidence again and scores it again before writing
 * the sections it has time for. Nothing compared one invocation's evidence
 * with the evidence the sections ALREADY on the row were written from.
 *
 * Measured on 60 Lawley Street, Spalding WA (report `5d8bc97e`, 24 Sep 2026):
 * the first invocation's location call was cut off at its 12 s ceiling, so it
 * held no coordinate, no geography, no demographics and no planning reading,
 * scored the property `withheld`, and wrote sections 1–9 on that. The next
 * invocation's location call answered in six seconds, the geography resolved,
 * five more registers answered, the grade was B+ 89 — and sections 10–16 were
 * written on THAT. One document, two evidence bases, and the verdict on page 1
 * contradicted the cover. The row made it worse: early persistence wrote
 * `investment_score` only when the row had none, so the stored grade stayed
 * `withheld` for the whole run and the final write stamped whatever the LAST
 * invocation happened to compute.
 *
 * ## The rule
 *
 * **The sections on the row and the score on the row describe one basis.**
 * The first invocation to write a section records the score it wrote from,
 * marked with whether it held a verified location. After that, a later
 * invocation's score changes the document in exactly one way:
 *
 *  - it holds STRICTLY MORE evidence — a location the written basis lacked, or
 *    a dimension it could not measure, and nothing it could — and every
 *    section is rewritten from the first on the better basis (`rewrite`);
 *  - anything else leaves the written score standing (`keep_written`): an
 *    invocation that lost a reading, or measured the same things and printed
 *    a different figure, or whose scoring call failed outright, does not get
 *    to restate a grade the document already carries.
 *
 * The asymmetry is the module's reason to exist. A failed re-acquisition says
 * nothing about the property (`acquisitionBudget.pure.ts`: a timeout is not
 * evidence of absence), so it must never overwrite a measurement; a better
 * acquisition is new evidence, so the document is rewritten rather than half
 * rewritten. While the document keeps growing, the recorded basis only ever
 * moves UP the lattice (located × five dimensions), so it rewrites at most six
 * times and cannot oscillate. The one way back down is an invocation that
 * restarts the document and dies before writing its first section: the next
 * invocation then records afresh, as a new document's first pass does. That
 * path needs a death per restart, and it is bounded by the drivers' own limits
 * (the watchdog's resume count, the pump's and the hook's call bounds), not by
 * this module.
 *
 * ## What it refuses
 *
 * **An unmarked score is never kept.** A score written before this rule
 * existed — a report in flight across the deploy, or a regeneration whose row
 * still carries an earlier generation's grade — cannot be shown to be the
 * basis of the sections beside it, so it is never held over a fresh one. It
 * can still be superseded: a strictly better fresh basis rewrites.
 *
 * **A marker never outlives its document.** The final write strips it, but a
 * generation that never finishes (stopped, or failed for good) leaves it on
 * the row. A new document's first pass overwrites it when it can score; when
 * it cannot, it CLEARS it (`clear_marker`). Left in place, a later pass would
 * read the old generation's grade as the basis of sections it never described
 * and hold it over its own.
 *
 * **An area report is not judged here.** Suburb, postcode and statewide
 * reports are scored by a different engine with no production policy stamp,
 * and they keep exactly today's behaviour.
 */

/** Where the marker lives on the persisted score. Compared, never displayed. */
export const WRITTEN_BASIS_KEY = '__writtenBasis' as const;

/** What the first section-writing invocation records beside its score. */
export interface WrittenBasisMarker {
  readonly version: 1;
  /** Whether a verified coordinate was held when the sections were written. */
  readonly located: boolean;
  /** When the basis was recorded, ISO. */
  readonly recordedAt: string;
  /**
   * How many times the document has been rewritten on a better basis since
   * its basis was last recorded from nothing. The finished record carries it
   * in its quality metadata, so "was this report written on one basis from the
   * start, or rewritten when the location answered late?" is a question the
   * row can answer. It counts from zero again where a restarted document's
   * first pass died and the next pass recorded afresh, so it can understate,
   * never overstate.
   */
  readonly rewrites: number;
}

/** The evidence a score was computed from, in the terms that can be compared. */
export interface EvidenceBasis {
  /** A Scoring V2 production record was read. */
  readonly readable: boolean;
  /** A verified coordinate was held. */
  readonly located: boolean;
  /** The dimensions the engine measured, sorted and unique. */
  readonly measured: readonly string[];
  /** The issued letter, or null where the grade was withheld. */
  readonly grade: string | null;
  readonly totalScore: number | null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Whether this is a record Scoring V2 production wrote.
 *
 * The policy stamp is what names the measured dimensions; a record without it
 * (a legacy score, an area score) cannot say what it measured, so it cannot be
 * compared and is treated as having measured nothing.
 */
export function isProductionScoreRecord(score: unknown): boolean {
  const policy = asRecord(asRecord(score)?.policy);
  return !!policy
    && policy.scoringSystem === 'scoring-v2'
    && Array.isArray(policy.measuredDimensions);
}

/** Whether an enrichment holds a usable coordinate. */
export function isLocated(locationIntelligence: unknown): boolean {
  const coords = asRecord(asRecord(locationIntelligence)?.coordinates);
  return !!coords
    && typeof coords.lat === 'number' && Number.isFinite(coords.lat)
    && typeof coords.lng === 'number' && Number.isFinite(coords.lng);
}

/** The basis a score and a location flag describe. Total. */
export function evidenceBasisOf(score: unknown, located: boolean): EvidenceBasis {
  if (!isProductionScoreRecord(score)) {
    return { readable: false, located, measured: [], grade: null, totalScore: null };
  }
  const record = score as Record<string, unknown>;
  const policy = record.policy as Record<string, unknown>;
  const measured = [...new Set(
    (policy.measuredDimensions as unknown[]).filter((d): d is string => typeof d === 'string' && d !== ''),
  )].sort();
  const grade = typeof record.grade === 'string' && record.grade.trim() !== '' ? record.grade : null;
  const total = typeof record.totalScore === 'number' && Number.isFinite(record.totalScore)
    ? record.totalScore
    : null;
  return { readable: true, located, measured, grade, totalScore: total };
}

/** The marker on a stored score, or null where there is none to trust. */
export function writtenBasisMarkerOf(score: unknown): WrittenBasisMarker | null {
  const marker = asRecord(asRecord(score)?.[WRITTEN_BASIS_KEY]);
  if (!marker || marker.version !== 1 || typeof marker.located !== 'boolean') return null;
  // A marker only means something on the record it was written with.
  if (!isProductionScoreRecord(score)) return null;
  const rewrites = typeof marker.rewrites === 'number' && Number.isInteger(marker.rewrites) && marker.rewrites >= 0
    ? marker.rewrites
    : 0;
  return {
    version: 1,
    located: marker.located,
    recordedAt: typeof marker.recordedAt === 'string' ? marker.recordedAt : '',
    rewrites,
  };
}

/** The score with its basis marker attached. Returns a new object. */
export function withWrittenBasis<T>(score: T, located: boolean, recordedAt: string, rewrites = 0): T {
  const record = asRecord(score);
  if (!record) return score;
  const marker: WrittenBasisMarker = { version: 1, located, recordedAt, rewrites };
  return { ...record, [WRITTEN_BASIS_KEY]: marker } as T;
}

/**
 * The score without its marker — what a finished report stores.
 *
 * The marker is generation state. Once the last section is written there is
 * nothing left to compare it against, and a completed record should carry the
 * score and nothing about how the run that made it was scheduled.
 */
export function withoutWrittenBasis<T>(score: T): T {
  const record = asRecord(score);
  if (!record || !(WRITTEN_BASIS_KEY in record)) return score;
  const { [WRITTEN_BASIS_KEY]: _marker, ...rest } = record;
  return rest as T;
}

export type BasisChange = 'same' | 'gained' | 'lost' | 'mixed';

export interface BasisComparison {
  readonly change: BasisChange;
  /** What the fresh basis holds that the written one did not, in reader words. */
  readonly gained: readonly string[];
  /** What the written basis held that the fresh one does not. */
  readonly lost: readonly string[];
}

const LOCATION_LABEL = 'a verified location';

/**
 * How a fresh basis stands against the written one.
 *
 * A partial order on (located, measured dimensions): `gained` only where
 * something was added and nothing taken away, `lost` the mirror, `mixed`
 * where both happened. The grade letter is deliberately not part of it — the
 * same evidence can print a different figure (a rent source that answered
 * differently), and a different figure on the same evidence is not new
 * evidence.
 */
export function compareEvidenceBasis(written: EvidenceBasis, fresh: EvidenceBasis): BasisComparison {
  const gained: string[] = [];
  const lost: string[] = [];
  if (fresh.located && !written.located) gained.push(LOCATION_LABEL);
  if (written.located && !fresh.located) lost.push(LOCATION_LABEL);
  const had = new Set(written.measured);
  const has = new Set(fresh.measured);
  for (const d of fresh.measured) if (!had.has(d)) gained.push(d);
  for (const d of written.measured) if (!has.has(d)) lost.push(d);
  const change: BasisChange = gained.length === 0 && lost.length === 0
    ? 'same'
    : lost.length === 0 ? 'gained'
      : gained.length === 0 ? 'lost'
        : 'mixed';
  return { change, gained, lost };
}

export type WrittenBasisDecision =
  /** Nothing to decide: an area report, or no production score to record. Today's behaviour. */
  | { readonly action: 'not_applicable'; readonly note: string }
  /** No section is written yet: record this invocation's score as the basis. */
  | { readonly action: 'record_first'; readonly note: string }
  /**
   * No section is written yet and there is no score to record, but the row
   * carries a marker left by a document that never finished. The marker is
   * removed and the score kept: it is still a measurement, only not the basis
   * of anything now on the row.
   */
  | { readonly action: 'clear_marker'; readonly note: string }
  /** Strictly more evidence than the written sections had: rewrite from the first. */
  | { readonly action: 'rewrite'; readonly note: string; readonly gained: readonly string[] }
  /** The written score stands for this invocation and for the record. */
  | {
    readonly action: 'keep_written';
    readonly note: string;
    readonly change: BasisChange;
    readonly lost: readonly string[];
  };

export interface WrittenBasisInput {
  /** False for an area report, which this rule does not judge. */
  readonly applies: boolean;
  /** Sections already on the row when this invocation started. */
  readonly sectionsWritten: number;
  /** The row's `investment_score` when this invocation started. */
  readonly storedScore: unknown;
  /** The row's `location_intelligence` held a coordinate when this invocation started. */
  readonly storedLocated: boolean;
  /** This invocation's score, or undefined where scoring did not answer. */
  readonly freshScore: unknown;
  /** This invocation holds a verified coordinate. */
  readonly freshLocated: boolean;
}

const list = (items: readonly string[]): string => items.join(', ');

/** What this invocation does with the score it computed. Total. */
export function decideWrittenBasis(input: WrittenBasisInput): WrittenBasisDecision {
  if (!input.applies) {
    return { action: 'not_applicable', note: 'An area report is scored by another engine; not judged here.' };
  }
  const fresh = evidenceBasisOf(input.freshScore, input.freshLocated);

  if (input.sectionsWritten <= 0) {
    if (fresh.readable) {
      return {
        action: 'record_first',
        note: 'No section is written yet — this invocation\'s score is recorded as the basis '
          + 'the sections will be written from.',
      };
    }
    if (writtenBasisMarkerOf(input.storedScore)) {
      return {
        action: 'clear_marker',
        note: 'No section is written yet and this invocation has no production score to record; '
          + 'the row carries a basis marker from a document that never finished, which describes '
          + 'sections no longer on the row. The marker is cleared and the score kept.',
      };
    }
    return { action: 'not_applicable', note: 'No production score this invocation, and nothing written to protect.' };
  }

  const marker = writtenBasisMarkerOf(input.storedScore);
  const written = evidenceBasisOf(input.storedScore, marker ? marker.located : input.storedLocated);
  const comparison = compareEvidenceBasis(written, fresh);

  if (fresh.readable && comparison.change === 'gained') {
    return {
      action: 'rewrite',
      gained: comparison.gained,
      note: `This invocation holds evidence the ${input.sectionsWritten} written section(s) were not `
        + `written from (${list(comparison.gained)}), and has lost nothing they had — rewriting from `
        + 'the first section so the document rests on one basis.',
    };
  }

  if (!marker) {
    // Nothing proves the stored score is the one the sections were written
    // from, so it is never held over a fresh one. Today's behaviour.
    return {
      action: 'not_applicable',
      note: 'The stored score carries no basis marker, so it cannot be shown to describe the written '
        + 'sections; nothing is held and nothing is rewritten.',
    };
  }

  const why = comparison.change === 'same'
    ? (fresh.grade !== written.grade || fresh.totalScore !== written.totalScore
      ? 'this invocation measured the same evidence and computed a different figure'
      : 'this invocation measured the same evidence')
    : !fresh.readable
      ? 'this invocation\'s scoring did not answer'
      : `this invocation could not re-acquire ${list(comparison.lost)}`
        + (comparison.gained.length > 0 ? ` (though it gained ${list(comparison.gained)})` : '');
  return {
    action: 'keep_written',
    change: comparison.change,
    lost: comparison.lost,
    note: `The written sections' score stands: ${why}. A failed or equal re-acquisition does not `
      + 'restate a grade the document already carries.',
  };
}
