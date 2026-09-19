/**
 * Who may read the restored location enrichment, and on what terms.
 *
 * S2 put the measured readings back into `location_intelligence` so Location
 * can be scored. The owner's rule on that: **retaining a measurement must not
 * automatically make it verified, or suitable for every downstream use.** Two
 * separate questions —
 *
 *   *stored* is decided by the acquisition (`locationEnrichmentReuse`),
 *   *verified* is decided by the stamp (`locationInputVerification`),
 *   *sayable* is decided by the Client-Safe Gate (`DISOWNED_LOCATION_PATHS`).
 *
 * This file is the register of every module that reads a stored enrichment,
 * classified by what it does with it, and it FAILS when a reader appears that
 * nobody has classified. That is the point: the defect S2 fixed was one
 * consumer quietly becoming a different kind of consumer.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DISOWNED_LOCATION_PATHS } from '../contract/safeGenerationInputs.pure';

const FUNCTIONS = resolve(process.cwd(), 'supabase/functions');
const read = (fn: string) => readFileSync(resolve(FUNCTIONS, fn, 'index.ts'), 'utf8');

/**
 * `narrative` — its output reaches a model or a client document, so the
 *   disowned paths must not reach it.
 * `scorer` — it computes a grade. Reading them is the whole point of S2.
 * `record` — it copies or serves the row without composing prose from it.
 */
const CONSUMERS: Record<string, 'narrative' | 'scorer' | 'record' | 'producer'> = {
  'location-intelligence-service': 'producer',
  'generate-investment-report': 'narrative',
  'compare-investment-reports': 'narrative',
  'regenerate-report-qualitative': 'narrative',
  'render-investment-report-pdf': 'narrative',
  'investment-scoring-service': 'scorer',
  'backfill-investment-scores': 'scorer',
  'fork-investment-report': 'scorer',
  'condense-investment-report': 'record',
  'get-investment-reports': 'record',
  'report-engine-agent': 'record',
  'report-schema-validator': 'record',
  'resolve-report-geography': 'record',
};

/** Every function whose source names the enrichment, in either spelling. */
const readers = readdirSync(FUNCTIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(resolve(FUNCTIONS, d.name, 'index.ts')))
  .filter((d) => /location_intelligence|locationIntelligence/.test(read(d.name)))
  .map((d) => d.name)
  .sort();

/** The three readings the verifier counts, as they appear in source. */
const VERIFIER_READINGS = ['walkScore', 'commute', 'schoolsWithin3km'];

describe('who reads the stored location enrichment', () => {
  it('every reader is classified — a new one fails this rather than shipping unreviewed', () => {
    const unclassified = readers.filter((fn) => !(fn in CONSUMERS));
    expect(unclassified).toEqual([]);
  });

  it('and nothing is classified that no longer reads it', () => {
    const stale = Object.keys(CONSUMERS).filter((fn) => !readers.includes(fn));
    expect(stale).toEqual([]);
  });
});

describe('a narrative consumer never receives a disowned reading', () => {
  it('generate-investment-report gates the narrative and persists the record', () => {
    const src = read('generate-investment-report');
    expect(src).toContain('enhancedData = safeGeneration.enhancedData as typeof enhancedData;');
    expect(src).toContain('measuredLocationIntelligence = enhancedData.locationIntelligence ?? null;');
  });

  it('compare-investment-reports withholds the walk score from its model payload', () => {
    const src = read('compare-investment-reports');
    expect(src).toContain('walkScore: null,');
    expect(src).not.toContain('walkScore: location.walkScore');
  });

  it('regenerate-report-qualitative reads none of the three', () => {
    // It composes the model's location context by hand; the three are absent
    // from that block by an explicit decision recorded in its comment.
    const src = read('regenerate-report-qualitative');
    const block = src.slice(src.indexOf('**LOCATION INTELLIGENCE:**') - 1600, src.indexOf('**LOCATION INTELLIGENCE:**'));
    for (const reading of VERIFIER_READINGS) {
      expect(block).not.toMatch(new RegExp(`loc\\.${reading}|locationIntelligence\\.${reading}`));
    }
  });

  it('render-investment-report-pdf draws none of the three', () => {
    const src = read('render-investment-report-pdf');
    for (const reading of VERIFIER_READINGS) {
      expect(src).not.toMatch(new RegExp(`loc\\.${reading}\\b`));
    }
  });
});

describe('the three questions stay three questions', () => {
  it('the gate disowns exactly what it disowned — this list is not a place to trade', () => {
    expect([...DISOWNED_LOCATION_PATHS].sort()).toEqual(
      ['commute', 'schools.schoolsWithin3km', 'transport.qualityScore', 'walkScore'],
    );
  });

  it('a scorer reads the readings directly, which is what S2 restored', () => {
    expect(read('investment-scoring-service')).toContain('locationIntelligence.walkScore');
  });
});
