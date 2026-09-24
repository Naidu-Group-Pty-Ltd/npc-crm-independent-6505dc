/**
 * The grade fix, wired where it runs.
 *
 * 60 Lawley Street (24 Sep 2026) was written from two evidence bases because
 * three things were each true: the location call was cut off at a ceiling
 * built for one vendor call, nothing compared a later invocation's evidence
 * with the evidence the written sections came from, and the row kept the first
 * invocation's `withheld` until the final write stamped the last one's B+ 89.
 * The pure modules decide each of those; these pins assert the generator, the
 * location service and the browser's regeneration loop actually ask them —
 * a rule is only real where something applies it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nextSectionIndex } from '../investment/runProgress.pure';

const REPO = resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(resolve(REPO, rel), 'utf8');
const generator = read('supabase/functions/generate-investment-report/index.ts');
const location = read('supabase/functions/location-intelligence-service/index.ts');
const transport = read('supabase/functions/public-transport-service/index.ts');
const hook = read('src/hooks/useChunkedRegeneration.ts');

describe('nextSectionIndex — the row is the authority on how far the document has got', () => {
  it('the ordinary case is unchanged: a section past the one asked for', () => {
    expect(nextSectionIndex({ success: true, sectionCompleted: 10 }, 9)).toBe(10);
  });

  it('a hand-off that banked nothing still asks for the same section again', () => {
    expect(nextSectionIndex({ success: true, sectionCompleted: 9, durableProgress: false }, 9)).toBeNull();
    expect(nextSectionIndex({ success: true, sectionCompleted: 9 }, 9)).toBeNull();
    expect(nextSectionIndex({ success: false, sectionCompleted: 1, sectionsRestarted: true }, 9)).toBeNull();
  });

  it('a restart is followed DOWN to the record — read by the old rule it was "no progress"', () => {
    // Section 10 was asked for; the server restarted on a better basis and
    // wrote section 1.
    expect(nextSectionIndex({ success: true, sectionCompleted: 1, sectionsRestarted: true, sectionWrittenThisRun: true }, 9)).toBe(1);
    // …or restarted and deferred before writing anything.
    expect(nextSectionIndex({ success: true, sectionCompleted: 0, sectionsRestarted: true }, 9)).toBe(0);
  });

  it('the invocation after a restart is followed too — it writes section 2 while the loop still expects 11', () => {
    expect(nextSectionIndex({ success: true, sectionCompleted: 2, sectionWrittenThisRun: true }, 9)).toBe(2);
  });

  it('an older server that says neither keeps today\'s behaviour exactly', () => {
    expect(nextSectionIndex({ success: true, sectionCompleted: 2 }, 9)).toBeNull();
  });
});

describe('the location call gets the ceiling of what it is', () => {
  const liCall = generator.slice(
    generator.indexOf('functions/v1/location-intelligence-service'),
    generator.indexOf('functions/v1/location-intelligence-service') + 900,
  );

  it("is `composite`, not a single vendor call's 12 s", () => {
    expect(liCall).toContain("'composite', 'location-intelligence-service'");
    expect(generator).not.toContain("'vendor', 'location-intelligence-service'");
  });

  it('is asked once more on a transient failure, bounded by the run clock', () => {
    expect(generator).toContain('for (let attempt = 1; attempt <= LOCATION_CALL_MAX_ATTEMPTS; attempt++)');
    expect(generator).toContain("acquisitionWindowMs(acquisitionBudgetFor('composite'))");
    expect(generator).toContain('mayRetryLocationNow({ reading, attempt, windowMs: retryWindowMs })');
  });

  it('keeps a sound stored reading when its re-fetch fails', () => {
    expect(generator).toContain('standsInAfterFailedRefetch(reuse)');
  });
});

describe('the location service takes its three readings together, and reads transport directly', () => {
  it('no longer calls the transport service over HTTP', () => {
    expect(location).not.toContain('functions/v1/public-transport-service');
    expect(location).toContain('readTransportAt(');
  });

  it('awaits the three branches together', () => {
    expect(location).toMatch(/await Promise\.all\(\[\s*transportBranch,\s*amenityBranch,\s*commuteBranch,\s*\]\)/);
    // Each branch is started before any is awaited.
    const allAt = location.indexOf('await Promise.all([\n    transportBranch');
    for (const branch of ['const transportBranch =', 'const amenityBranch =', 'const commuteBranch =']) {
      expect(location.indexOf(branch), branch).toBeGreaterThan(-1);
      expect(location.indexOf(branch), branch).toBeLessThan(allAt);
    }
  });

  it('the transport service answers through the same shared read', () => {
    expect(transport).toContain('readTransportAt(supabase, lat, lng)');
    expect(transport).toContain('loadedTransportNetworks(supabase)');
  });
});

describe('the geography is resolved once per point', () => {
  it('the generator opts in to the stored row', () => {
    expect(generator).toMatch(/resolveOneReportGeography\(\{[\s\S]{0,700}?reuseStored: true,/);
  });
});

describe('one generation, one evidence basis', () => {
  const decisionAt = generator.indexOf('writtenBasisDecision = decideWrittenBasis({');
  const acquisitionEnds = generator.indexOf('acquisition finished at +');
  const gateAt = generator.indexOf('RF-7.2B.1 — CLIENT-SAFE GATE ACTIVATION');

  it('is decided after the last score and before the gate or any prompt reads it', () => {
    expect(decisionAt).toBeGreaterThan(acquisitionEnds);
    expect(decisionAt).toBeLessThan(gateAt);
  });

  it('a rewrite discards the written sections before the section loop starts', () => {
    const block = generator.slice(decisionAt, gateAt);
    expect(block).toMatch(/action === 'rewrite'\) \{[\s\S]{0,700}?existingReportContent = '';\s*completedSectionIndices\.length = 0;/);
  });

  it('keep_written holds the written score for the prompts and the record', () => {
    const block = generator.slice(decisionAt, gateAt);
    expect(block).toContain("investmentScore: existingEnhancedFields.investmentScore");
  });

  it('the counter resets in the SAME early write that records the new basis', () => {
    const early = generator.slice(
      generator.indexOf('EARLY ENHANCED DATA PERSISTENCE'),
      generator.indexOf('AREA REPORT SECTION EXCLUSION'),
    );
    expect(early).toContain('earlyUpdate.investment_score = basisScoreForRow();');
    expect(early).toContain('earlyUpdate.last_completed_section = 0;');
    // One `.update(earlyUpdate)` carries both.
    expect(early.match(/\.update\(earlyUpdate\)/g) ?? []).toHaveLength(1);
  });

  it('a new document with no score of its own clears a marker a stopped one left — early write and fallback both', () => {
    const early = generator.slice(
      generator.indexOf('EARLY ENHANCED DATA PERSISTENCE'),
      generator.indexOf('AREA REPORT SECTION EXCLUSION'),
    );
    expect(early).toMatch(
      /action === 'clear_marker'\) \{[\s\S]{0,600}?earlyUpdate\.investment_score = withoutWrittenBasis\(existingEnhancedFields\.investmentScore\);/,
    );
    const fallback = generator.slice(generator.indexOf('First generated section in this run'));
    expect(fallback.slice(0, 2_000)).toMatch(
      /action === 'clear_marker'\) \{[\s\S]{0,400}?progressiveUpdatePayload\.investment_score = withoutWrittenBasis\(/,
    );
  });

  it('an early write the database refused is not read as saved', () => {
    // A client that answers with an error does not throw. Read as saved, the
    // first section's fallback never ran and the basis — and a rewrite's
    // reset — reached the row a section late or not at all.
    const early = generator.slice(
      generator.indexOf('EARLY ENHANCED DATA PERSISTENCE'),
      generator.indexOf('AREA REPORT SECTION EXCLUSION'),
    );
    expect(early).toContain('const { error: earlyWriteError } = await supabaseClient');
    expect(early).toMatch(/if \(earlyWriteError\) \{[\s\S]*?\} else \{\s*enhancedDataPersisted = true;/);
    // Exactly one place marks the write persisted after it was attempted.
    const afterWrite = early.slice(early.indexOf('.update(earlyUpdate)'));
    expect(afterWrite.split('enhancedDataPersisted = true;').length - 1).toBe(1);
  });

  it('the finished record carries no marker', () => {
    expect(generator).toContain('investment_score: withoutWrittenBasis(enhancedData.investmentScore) || null,');
  });

  it('every continuation response says whether the document was restarted', () => {
    const flags = generator.match(/sectionsRestarted: sectionsRestartedThisRun/g) ?? [];
    // single-section success, deferral, single-section failure, budget hand-off
    expect(flags.length).toBe(4);
    expect(generator).toContain('sectionWrittenThisRun: true,');
  });
});

describe("the browser's regeneration loop follows the record", () => {
  it('reads the server counter through nextSectionIndex, not sectionWasWritten alone', () => {
    expect(hook).toContain('nextSectionIndex(data ?? {}, section)');
    expect(hook).not.toContain('sectionWasWritten(data');
  });

  it('lands the loop on the record and bounds the whole run', () => {
    expect(hook).toContain('if (resumeAt !== null) section = resumeAt - 1;');
    expect(hook).toContain('if (callsMade > maxCalls)');
  });
});
