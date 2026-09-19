/**
 * The QA validator judges the tier it was given, and the condense path gives
 * it the tier it is producing.
 *
 * ## The fault
 *
 * `runQAValidation` took two tier values — `compass-40` and
 * `financial-analysis` — and `condense-investment-report` called it with
 * `'compass-40'` for a Briefing and for a Snapshot. Neither is a Compass, so
 * every condensation in production logged and returned a report that could
 * not pass, whatever the document said:
 *
 *  - a page band for a 40-page report over a 12-page tier;
 *  - eleven `financial-exclusion` errors, on the financial chapters the
 *    condensation DELIBERATELY attaches from the recorded calculation;
 *  - four to six `missing-protected-section` errors naming Compass sections a
 *    condensed tier never declares.
 *
 * Sixteen errors on a correct Briefing and eleven on a correct Snapshot, on
 * every run. It blocks nothing — the report is returned either way — which is
 * exactly what makes it the familiar fault. A check that always fails can
 * never report a true one.
 *
 * ## What these pin
 *
 * The half that matters is the SECOND describe block. Admitting the condensed
 * tiers would be worthless, and worse than the fault, if it had quietly turned
 * the validator off for them — so the rules that are about a REPORT rather
 * than about a tier are each shown still biting on a Briefing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runQAValidation } from '../compassQAValidator';

const ROOT = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const rules = (findings: { rule: string }[]) => new Set(findings.map((f) => f.rule));

/**
 * A Briefing as `composeCondensedDocument` assembles one: the tier's own
 * sections, then the financial chapters composed from the record. Short,
 * because a Briefing is short.
 */
const BRIEFING = [
  '## Executive Summary',
  '',
  'The property is a detached house on a 765 m² block in an established pocket.',
  '',
  '## Risk Overview',
  '',
  '| Risk | Level |',
  '| --- | --- |',
  '| Crime exposure | Moderate |',
  '',
  '## Rental Assessment, Gross Yield & Net Yield',
  '',
  'Recorded rental income and the yields derived from it.',
  '',
  '| Metric | Value |',
  '| --- | --- |',
  '| Weekly rent | $850 |',
  '| Gross yield | 2.97% |',
  '',
  '## Loan Structure, Repayments & Cashflow Impact',
  '',
  '| Item | Value |',
  '| --- | --- |',
  '| Loan amount | $1,192,000 |',
  '| LVR | 80% |',
  '',
  '## Recommendation',
  '',
  'Proceed with caution.',
].join('\n');

describe('a condensed tier is not judged as a Compass', () => {
  it('passes a correct Briefing with no findings at all', () => {
    const report = runQAValidation(BRIEFING, 'briefing');
    expect(report.tier).toBe('briefing');
    expect(report.findings).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it('passes a correct Snapshot too', () => {
    const report = runQAValidation(BRIEFING, 'snapshot');
    expect(report.findings).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it('does not apply the financial exclusion — the composition ATTACHES those chapters', () => {
    // The same text as a Compass is eleven errors, and that is correct: a
    // Compass may not carry the modelling. A Briefing is defined by carrying
    // it, so the rule is about the tier and not about the words.
    expect(rules(runQAValidation(BRIEFING, 'briefing').findings)).not.toContain('financial-exclusion');
    expect(rules(runQAValidation(BRIEFING, 'compass-40').findings)).toContain('financial-exclusion');
  });

  it('does not demand Compass protected sections a condensed tier never declares', () => {
    expect(rules(runQAValidation(BRIEFING, 'briefing').findings)).not.toContain('missing-protected-section');
    expect(rules(runQAValidation(BRIEFING, 'compass-40').findings)).toContain('missing-protected-section');
  });

  it('reports no page band, because neither condensed tier declares one', () => {
    // An invented band would be a threshold nobody measured. A Briefing's
    // length is governed by the registry trim and the post-processor's word
    // caps, which are enforced elsewhere.
    for (const tier of ['briefing', 'snapshot'] as const) {
      expect(rules(runQAValidation(BRIEFING, tier).findings)).not.toContain('page-band');
    }
    expect(rules(runQAValidation(BRIEFING, 'compass-40').findings)).toContain('page-band');
  });

  it('leaves the two tiers it always knew exactly as they were', () => {
    // The change must not have moved the Compass or the Financial Analysis.
    const compass = runQAValidation(BRIEFING, 'compass-40');
    expect(compass.tier).toBe('compass-40');
    expect(rules(compass.findings)).toContain('page-band');
    const financial = runQAValidation('## Suburb profile\n\nSEIFA decile 10.\n', 'financial-analysis');
    expect(rules(financial.findings)).toContain('suburb-exclusion');
  });
});

describe('every rule about a REPORT still bites on a Briefing', () => {
  const on = (extra: string) => rules(runQAValidation(`${BRIEFING}\n\n${extra}\n`, 'briefing').findings);

  it('an unresolved placeholder', () => {
    expect(on('The median is rising [citation].')).toContain('forbidden-placeholder');
  });

  it('an editorial commentary label', () => {
    expect(on('### What This Means\n\nIt is a good buy.')).toContain('editorial-label');
  });

  it('a heading said twice', () => {
    expect(on('## Recommendation\n\nA second one.')).toContain('duplicate-h2');
  });

  it('a promise of a table with no table under it', () => {
    expect(on('## Amenity\n\nThe table below groups the main amenities by type.')).toContain('promised-table');
  });

  it('a score the record does not hold', () => {
    const report = runQAValidation(
      `${BRIEFING}\n\nThe property scores 82 out of 100 on location.\n`,
      'briefing',
      { recordedScores: [40] },
    );
    expect(rules(report.findings)).toContain('unrecorded-score');
  });
});

describe('the condense path names the tier it is producing', () => {
  const handler = read('supabase/functions/condense-investment-report/index.ts');

  it('passes `targetTier` rather than a literal', () => {
    expect(handler).toContain('runQAValidation(condensedContent, targetTier');
    expect(handler).not.toContain("runQAValidation(condensedContent, 'compass-40'");
  });
});

describe('the two copies of the validator agree', () => {
  it('differ only in where they import the score-claim matcher from', () => {
    // The frontend QA panel reads a mirror of the edge module. Two copies is
    // how two answers happen, and this file changed both — so the mirror is
    // checked rather than trusted.
    // Strip the Deno `.ts` extensions FIRST, then map the one path that
    // genuinely differs — the edge module sits a directory further from
    // `scoreClaims` than the mirror does.
    const strip = (src: string) => src.replace(/\.ts'/g, "'");
    const edge = strip(read('supabase/functions/_shared/compassQAValidator.ts'))
      .replace("'./reports/investment/scoreClaims.pure'", "'./investment/scoreClaims.pure'")
      .replace("'./reports/investment/evidenceClaims.pure'", "'./investment/evidenceClaims.pure'")
      .replace("'./reports/investment/documentConsistency.pure'", "'./investment/documentConsistency.pure'")
      .replace(/'\.\/reports\/investment\/evidenceClaims\.pure'/g, "'./investment/evidenceClaims.pure'")
      .replace(/'\.\/reports\/investment\/riskRegister\.pure'/g, "'./investment/riskRegister.pure'");
    expect(strip(read('src/lib/reports/compassQAValidator.ts'))).toBe(edge);
  });
});
