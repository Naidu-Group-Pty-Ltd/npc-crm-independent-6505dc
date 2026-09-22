/**
 * A grade gap has two audiences, and one field had none declared.
 *
 * ## What reached a client
 *
 * `GradeGap` documented `reason` as "the client sentence, no codebase
 * vocabulary" and `detail` as "the operator detail" from the day it was
 * written. `remedy` said only *"what would close the gap"* — and the
 * Compass's **What each dimension rested on** bullets drew it, through
 * `readScoreAssessment`'s `exclusionRemedy`.
 *
 * Executed against a stored score on 21 Sep 2026, that printed:
 *
 *     **Location.** … Regenerate the report: the location service re-acquires
 *     the enrichment with its acquisition stamp (RF-7.2B), and stamped,
 *     stage-proven readings verify automatically.
 *
 *     **Demand.** … four periods of the open sales register's own transaction
 *     counts for this market (market-sales-ingest; NSW and QLD carry one on
 *     every row, VIC and SA one per load) …
 *
 *     **Property risk.** … Evidence this deployment does not hold: condition
 *     and maintenance. … what is outstanding for them is a query against the
 *     parcel rather than the address point.
 *
 * and growth's carried `docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md` and
 * `docs/integrations/DOMAIN_ACTIVATION_REQUEST.md`. Repository paths, an
 * internal release code, an edge-function name and a description of our own
 * loaders, in a customer's investment report.
 *
 * ## Why it survived
 *
 * `remedy` is CORRECT for the audience it was written for. An operator
 * reading the grade-gap card needs the function name, the doc and the release
 * code — that is the whole point of `riskRemedyFor` deriving from the schema
 * so it cannot name as missing something the platform already reads. Nothing
 * was wrong with the string; what was wrong was that a second reader was
 * added to it silently.
 *
 * So `publisherNames.spec.ts` could not have caught it either: it refuses an
 * underscore-cased IDENTIFIER in a rendered field, and *"Regenerate the
 * report: the location service re-acquires the enrichment"* is a well-formed
 * English sentence.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  READER_REMEDY,
} from '../../../../supabase/functions/_shared/reports/market/scoringV2Production.pure';
import { readScoreAssessment }
  from '../../../../supabase/functions/_shared/reports/market/scoreAssessmentReading.pure';
import { NOT_ASSESSED_REASON }
  from '../../../../supabase/functions/_shared/reports/market/scoringInputPolicy.pure';

/** What may never appear in a sentence a customer reads. */
const REPOSITORY_VOCABULARY: ReadonlyArray<[string, RegExp]> = [
  ['a repository path', /\b(docs|src|supabase|scripts)\/[\w./-]+/],
  ['a source filename', /\b[\w.-]+\.(ts|tsx|mjs|sql|md|json)\b/],
  ['an edge-function or module name', /\b[a-z]+(?:-[a-z]+){1,}\b(?=[^a-z]|$)/],
  ['a camelCase identifier', /\b[a-z]+[A-Z][a-zA-Z]*\b/],
  ['a snake_case identifier', /\b[a-z0-9]+(?:_[a-z0-9]+)+\b/],
  ['an internal release code', /\bRF-\d|\bME-\d|\bQA-\d/],
  ['this platform’s plumbing', /\b(deployment|database|endpoint|ingest(?:ed|ion)?|migration|cache|API)\b/i],
];

/** Hyphenated English that the module-name pattern must not condemn. */
const ORDINARY_HYPHENATION = /\b(open-data|days-on-market|year-on-year|sub-national|per-class|high-density|medium-density|low-density|re-acquires|re-taken|site-specific|property-specific|market-wide)\b/g;

function offendingClasses(sentence: string): string[] {
  const text = sentence.replace(ORDINARY_HYPHENATION, ' ');
  return REPOSITORY_VOCABULARY.filter(([, re]) => re.test(text)).map(([label]) => label);
}

describe('the reader’s half of a grade gap', () => {
  it('covers every dimension, so a new one cannot ship without a sentence', () => {
    expect(Object.keys(READER_REMEDY).sort())
      .toEqual(['demand', 'growth', 'location', 'risk', 'yield']);
  });

  it('names nothing from this repository', () => {
    for (const [dimension, sentence] of Object.entries(READER_REMEDY)) {
      expect(offendingClasses(sentence), `${dimension}: "${sentence}"`).toEqual([]);
    }
  });

  it('is a whole sentence, because it renders straight after the reason', () => {
    // "Not recorded. A recorded weekly rent and purchase price for this
    // property." is a fragment, and it is what the operator remedies looked
    // like in the bullet.
    for (const [dimension, sentence] of Object.entries(READER_REMEDY)) {
      expect(sentence, dimension).toMatch(/^[A-Z]/);
      expect(sentence, dimension).toMatch(/\.$/);
      expect(sentence, dimension).toMatch(/\b(is|are|can|needs?)\b/);
    }
  });

  it('says what is missing rather than how this platform would obtain it', () => {
    for (const [dimension, sentence] of Object.entries(READER_REMEDY)) {
      expect(sentence, dimension).not.toMatch(/\b(load|loaded|run|deploy|configure|enable|activate)\b/i);
    }
  });

  it('repeats nothing its own reason already said', () => {
    // location's first draft closed "not a finding about the area" three
    // words after NOT_ASSESSED_REASON.location closed "It is not a reading
    // about the area".
    for (const key of Object.keys(READER_REMEDY) as Array<keyof typeof READER_REMEDY>) {
      const reason = NOT_ASSESSED_REASON[key] ?? '';
      const tail = reason.split('.').filter((s) => s.trim()).pop()?.trim().toLowerCase() ?? '';
      if (tail.length < 12) continue;
      const shared = tail.split(/\s+/).slice(-5).join(' ');
      expect(READER_REMEDY[key].toLowerCase(), key).not.toContain(shared);
    }
  });
});

describe('the client bullet reads the reader’s field and never the operator’s', () => {
  const OPERATOR = 'Load docs/reports/OPEN_DATA_GROWTH_EVIDENCE.md through market-sales-ingest.';

  const storedWith = (gap: Record<string, unknown>) => ({
    compositeScore: 54,
    grade: 'C',
    breakdown: [{ dimension: 'growth', score: 55, weight: 100 }],
    gradeGaps: [{ dimension: 'risk', withholdsGrade: true, reason: 'r', detail: 'd', ...gap }],
    v2: { authority: 'v2' },
  });

  const riskRow = (stored: unknown) =>
    readScoreAssessment(stored).dimensions.find((x) => x.key === 'risk')!;
  const riskBullet = (stored: unknown) => {
    const d = riskRow(stored);
    return [d.exclusionReason ?? '', d.exclusionRemedy ?? ''].join(' ').trim();
  };

  it('draws the reader sentence when the row carries one', () => {
    const out = riskBullet(storedWith({ remedy: OPERATOR, readerRemedy: READER_REMEDY.risk }));
    expect(out).toContain(READER_REMEDY.risk);
    expect(out).not.toContain('market-sales-ingest');
    expect(out).not.toContain('docs/reports');
  });

  it('fails CLOSED on a legacy row, rather than falling back to the operator string', () => {
    /*
     * Every row written before `readerRemedy` existed carries only `remedy`.
     * Falling back to it is the defect, so the bullet renders its reason
     * alone — a complete sentence that already tells the reader this is a gap
     * in the record and not a finding about the property.
     */
    const row = riskRow(storedWith({ remedy: OPERATOR }));
    // Nothing is appended at all: the reading carries its own reason, and the
    // remedy slot is empty rather than filled with the operator's string.
    expect(row.exclusionRemedy).toBeNull();
    const out = riskBullet(storedWith({ remedy: OPERATOR }));
    expect(out).not.toContain('OPEN_DATA_GROWTH_EVIDENCE');
    expect(out).not.toContain('market-sales-ingest');
    // Still a complete sentence, so the bullet does not read as a broken row.
    expect(out.length).toBeGreaterThan(40);
    expect(out).toMatch(/\.$/);
    expect(offendingClasses(out)).toEqual([]);
  });
});

describe('the operator field keeps every name it needs', () => {
  it('still points an operator at the doc, the function and the release', () => {
    // The fix must not have quietly degraded the operator's remedy, which is
    // the reason `riskRemedyFor` derives from the schema in the first place.
    const src = readFileSync(
      'supabase/functions/_shared/reports/market/scoringV2Production.pure.ts',
      'utf8',
    );
    expect(src).toContain('OPEN_DATA_GROWTH_EVIDENCE.md');
    expect(src).toContain('market-sales-ingest');
    expect(src).toContain('RF-7.2B');
  });
});
