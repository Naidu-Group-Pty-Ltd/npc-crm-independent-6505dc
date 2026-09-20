import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AcquisitionRecorder,
  EXPECTED_PRODUCERS,
  absenceSentence,
  isOurFault,
  readAcquisitionLedger,
  type AcquisitionOutcome,
} from '../acquisitionLedger.pure';

const GENERATOR = resolve(
  __dirname,
  '../../../../supabase/functions/generate-investment-report/index.ts',
);

describe('the five outcomes are kept apart', () => {
  it('a guard that skipped the call is never_requested, and names the precondition', () => {
    const r = new AcquisitionRecorder();
    r.skipped('planning', 'No verified coordinate was resolved', 'planning-data-service');
    const [e] = r.build().entries;
    expect(e.outcome).toBe('never_requested');
    expect(e.detail).toContain('No verified coordinate');
    expect(e.service).toBe('planning-data-service');
  });

  it('"No data returned" is the provider answering, not a failure of ours', () => {
    // The fetch wrapper says exactly this when the fetch resolved to null,
    // which is the one case the old comment ("we asked and got nothing") was
    // actually describing.
    const r = new AcquisitionRecorder();
    r.fromServiceResult('demographics', { success: false, error: 'No data returned' });
    expect(r.build().entries[0].outcome).toBe('unavailable_in_coverage');
  });

  it('a timeout, a throw and an open circuit are all requested_failed', () => {
    for (const error of ['Request timed out after 30 seconds', 'Circuit breaker open', 'fetch failed']) {
      const r = new AcquisitionRecorder();
      r.fromServiceResult('marketData', { success: false, error });
      const [e] = r.build().entries;
      expect(e.outcome).toBe('requested_failed');
      // The provider's own words, never a paraphrase — an operator sent to the
      // wrong remedy is the failure this exists to prevent.
      expect(e.detail).toBe(error);
    }
  });

  it('answered-but-not-bound is its own outcome, because it is a bug and the others are not', () => {
    const r = new AcquisitionRecorder();
    r.fromServiceResult('seifa', { success: true, data: { score: 1 } }, { bound: false });
    expect(r.build().entries[0].outcome).toBe('retrieved_not_bound');
  });

  it('a result with no error at all still says so rather than reading as empty', () => {
    const r = new AcquisitionRecorder();
    r.fromServiceResult('climate', { success: false });
    const [e] = r.build().entries;
    expect(e.outcome).toBe('requested_failed');
    expect(e.detail).toContain('reported no reason');
  });
});

describe('last write wins, because a producer can be skipped then fetched', () => {
  it('a phase-2 fetch overrides the phase-1 skip in the same run', () => {
    // Climate and planning are keyed on a coordinate that does not exist in
    // phase 1. Recording the skip and then the real attempt must leave the
    // real attempt, or every coordinate-keyed producer reads as never asked.
    const r = new AcquisitionRecorder();
    r.skipped('climate', 'Missing coordinates (fetched after location intelligence)');
    r.answered('climate', 'Retrieved from the SILO grid cell', 'climate-data-service');
    const entries = r.build().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].outcome).toBe('answered');
  });
});

describe('a producer nobody accounted for is named, not silently absent', () => {
  it('unaccounted lists every expected producer with no entry', () => {
    const r = new AcquisitionRecorder();
    r.answered('demographics');
    const l = r.build();
    expect(l.unaccounted).not.toContain('demographics');
    expect(l.unaccounted).toContain('planning');
    expect(l.unaccounted.length).toBe(EXPECTED_PRODUCERS.length - 1);
  });

  it('the tally counts every outcome, including the ones at zero', () => {
    const r = new AcquisitionRecorder();
    r.answered('demographics');
    r.skipped('planning', 'no coordinate');
    r.failed('marketData', 'HTTP 403');
    r.empty('seifa', 'nothing for this postal area');
    const t = r.build().tally;
    expect(t).toEqual({
      answered: 1,
      never_requested: 1,
      requested_failed: 1,
      unavailable_in_coverage: 1,
      retrieved_not_bound: 0,
    });
  });
});

describe('the absence a reader is shown says which kind it is', () => {
  const OUTCOMES: AcquisitionOutcome[] = [
    'answered', 'never_requested', 'requested_failed',
    'retrieved_not_bound', 'unavailable_in_coverage',
  ];

  it('every outcome has its own sentence and no two share one', () => {
    const said = OUTCOMES.map((o) => absenceSentence(o, 'Demographics'));
    expect(new Set(said).size).toBe(OUTCOMES.length);
  });

  it('a sentence is about the record, never about the area', () => {
    // "Demographics are not available for this suburb" is a claim about the
    // suburb. Three of the five outcomes make it false.
    for (const o of OUTCOMES) {
      const s = absenceSentence(o, 'Demographics');
      expect(s).not.toMatch(/\b(no|little|limited)\s+(data|information)\s+exists\b/i);
      expect(s).toMatch(/\bthis (report|property|location|document)\b/i);
    }
  });

  it('only the provider-answered-empty case is a statement about the location', () => {
    expect(isOurFault('unavailable_in_coverage')).toBe(false);
    expect(isOurFault('answered')).toBe(false);
    expect(isOurFault('never_requested')).toBe(true);
    expect(isOurFault('requested_failed')).toBe(true);
    expect(isOurFault('retrieved_not_bound')).toBe(true);
  });
});

describe('reading a ledger back', () => {
  it('a row generated before this existed answers null, not an empty ledger', () => {
    // The Cowra row is exactly this: six nulls and no ledger. "Nothing was
    // asked" and "we do not know what was asked" are different, and only the
    // second is true of it.
    expect(readAcquisitionLedger({ data_sources: { demographics: null, seifa: null } })).toBeNull();
    expect(readAcquisitionLedger({ data_sources: null })).toBeNull();
    expect(readAcquisitionLedger(null)).toBeNull();
  });

  it('round-trips a ledger the generator wrote', () => {
    const r = new AcquisitionRecorder();
    r.skipped('planning', 'No verified coordinate was resolved');
    const built = r.build();
    const back = readAcquisitionLedger({ data_sources: { _acquisition: built } });
    expect(back?.entries[0].producer).toBe('planning');
    expect(back?.tally.never_requested).toBe(1);
  });
});

describe('the generator records what it does', () => {
  const src = readFileSync(GENERATOR, 'utf8');

  /*
   * Renegotiated twice, each time by the same finding going one level deeper.
   *
   * First: `if (planningCoords?.lat && planningCoords?.lng)` with no else,
   * which is why the Cowra report has no planning key at all. That was closed
   * by recording the skip.
   *
   * Then the measurement said recording it was not enough. Of the 105 stored
   * reports, 5 carry a coordinate on `location_intelligence` and 0 carry a
   * planning key — so the guard was false even where the report owned a
   * coordinate, because it reads the in-memory working object and the resume
   * worker starts that empty. The guard reads the QUALIFIED coordinate now
   * (this run's enrichment, or the address geocoded and accepted only at
   * parcel grade), and the else branch classifies WHICH refusal it was rather
   * than giving four causes one sentence.
   */
  it('the planning guard reads the qualified coordinate, not the working object', () => {
    const guard = src.indexOf('const planningCoords = subjectCoordinate;');
    expect(guard).toBeGreaterThan(-1);
    expect(src).not.toContain('const planningCoords = enhancedData.locationIntelligence?.coordinates;');
  });

  it('the planning guard names which refusal it was, never one sentence for four', () => {
    const guard = src.indexOf('const planningCoords = subjectCoordinate;');
    const window = src.slice(guard, guard + 6000);
    expect(window).toContain("producer: 'planning',");
    expect(window).toContain('ledgerOutcomeFor(');
    expect(window).toContain('coordinateRefusal');
  });

  it('records the coordinate itself as a producer, with its provenance', () => {
    expect(src).toContain("producer: 'subjectCoordinate'");
    expect(src).toContain('coordinateProvenance(');
  });

  it('every producer the ledger expects is recorded somewhere in the generator', () => {
    // `financials` and `investmentScore` are recorded at their own call sites;
    // the seven phase-1 producers go through one mapped loop.
    for (const p of ['planning', 'climate', 'riskAssessment', 'locationIntelligence', 'financials', 'investmentScore']) {
      expect(src).toMatch(new RegExp(`acquisition\\.(record|answered|failed|empty|skipped|fromServiceResult)\\(\\s*\\n?\\s*'${p}'|producer: '${p}'`));
    }
    expect(src).toContain('const producer = producerNames[serviceName] ?? serviceName;');
  });

  it('the ledger is persisted on data_sources and is built last', () => {
    const build = src.indexOf('const acquisitionLedger = acquisition.build();');
    const persist = src.indexOf("._acquisition = acquisitionLedger;");
    expect(build).toBeGreaterThan(-1);
    expect(persist).toBeGreaterThan(build);
    // Built after the planning fetch, or a coordinate-keyed producer is
    // recorded at the skip that was true earlier in the same run.
    expect(build).toBeGreaterThan(src.indexOf("acquisition.skipped(\n          'planning',"));
  });
});
