/**
 * The truncated-blob reader, and the one property it exists to guarantee.
 *
 * 27 of the 50 stored comparisons were saved while the analysis was still being
 * written: the model's response exceeded its token ceiling, `JSON.parse` threw,
 * and the raw text was stored with every structured column left NULL.
 *
 * The obvious way to read those back — take the longest prefix that parses — has
 * to *repair* the string by closing whatever brackets are open, and closing an
 * array mid-element yields a partial last element: a ranking with an address and
 * no score, printed on a client's document as though it were whole. Nothing
 * downstream can tell it apart from a real one, which is why the fuzz below
 * asserts its absence at every cut rather than at a few chosen ones.
 *
 * The fixtures are fictional. Real blobs were used to *find* these shapes — the
 * fence, the mid-string cut, the section written under two names — but a
 * committed fixture gets shared, and these are somebody's property financials.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPARISON_SECTIONS,
  canonicalSection,
  looksLikeRawJson,
  MAX_SALVAGE_CHARS,
  salvageTruncatedJson,
} from '../salvage.pure';

/** The shape the producer emits, in the order it writes it. */
const WHOLE = {
  executiveSummary: 'Two properties compared. Both are fine.',
  rankings: [
    { rank: 1, propertyNumber: 1, address: '1 Example Street, Sampleton', finalScore: 82 },
    { rank: 2, propertyNumber: 2, address: '2 Example Street, Sampleton', finalScore: 61 },
  ],
  financialComparison: { bestYield: { propertyNumber: 1, value: '5.1%', reason: 'Higher rent.' } },
  locationComparison: { bestSchools: { propertyNumber: 2, reason: 'Closer to two schools.' } },
  riskComparison: { riskLevels: [{ propertyNumber: 1, riskLevel: 'Moderate', specificRisks: ['Leverage'] }] },
  investorMatches: [{ propertyNumber: 1, investorTypes: ['Growth'], reasoning: 'Capital focus.' }],
  redFlags: [{ propertyNumber: 2, severity: 'High', concerns: ['Body corporate'] }],
  recommendations: { bestOverall: { propertyNumber: 1, reason: 'Better on balance.' } },
};

const json = JSON.stringify(WHOLE, null, 2);
const fenced = '```json\n' + json + '\n```';

describe('recognising a stored raw response', () => {
  it.each([
    ['a bare object', json, true],
    ['a fenced object', fenced, true],
    ['ordinary prose', 'This comparison evaluates two properties.', false],
    ['nothing', '', false],
    ['not a string', null, false],
  ])('%s', (_label, input, expected) => {
    expect(looksLikeRawJson(input as string)).toBe(expected);
  });
});

describe('a complete document', () => {
  it('round-trips unchanged, and is not reported as truncated', () => {
    const out = salvageTruncatedJson(json)!;
    expect(out.truncated).toBe(false);
    expect(out.value).toEqual(WHOLE);
    expect(out.missing).toEqual(['marketTiming', 'competitiveAdvantages']);
  });

  it('round-trips through a code fence', () => {
    expect(salvageTruncatedJson(fenced)!.value).toEqual(WHOLE);
  });

  /**
   * Anchored, never global. The producer's own strip is global, which would
   * happily delete a fence-like sequence that appears inside a string value.
   */
  it('does not strip a fence that appears inside a string value', () => {
    const withFenceInside = JSON.stringify({
      executiveSummary: 'The model replied with ```json in the middle of a sentence.',
      rankings: [],
    });
    const out = salvageTruncatedJson(withFenceInside)!;
    expect(out.value.executiveSummary).toContain('```json');
  });

  it('returns null for something that is not a stored response', () => {
    expect(salvageTruncatedJson('This comparison evaluates two properties.')).toBeNull();
    expect(salvageTruncatedJson('')).toBeNull();
    expect(salvageTruncatedJson(null)).toBeNull();
  });
});

describe('a document cut off mid-write', () => {
  it('recovers the sections that closed, and names the ones that did not', () => {
    // Cut in the middle of `redFlags`.
    const cut = json.slice(0, json.indexOf('"redFlags"') + 40);
    const out = salvageTruncatedJson(cut)!;
    expect(out.truncated).toBe(true);
    expect(out.recovered).toEqual([
      'executiveSummary',
      'rankings',
      'financialComparison',
      'locationComparison',
      'riskComparison',
      'investorMatches',
    ]);
    expect(out.missing).toContain('redFlags');
    expect(out.missing).toContain('recommendations');
    expect(out.value.rankings).toEqual(WHOLE.rankings);
  });

  it.each([
    ['mid-string', json.indexOf('Higher rent') + 5],
    ['mid-key', json.indexOf('"locationComparison"') + 8],
    ['mid-array', json.indexOf('"2 Example Street') + 10],
    ['mid-number', json.indexOf('82') + 1],
  ])('never throws when cut %s', (_label, at) => {
    expect(() => salvageTruncatedJson(json.slice(0, at))).not.toThrow();
  });

  it('reports nothing recovered rather than throwing when the cut is immediate', () => {
    const out = salvageTruncatedJson('{ "executiveSum')!;
    expect(out.recovered).toEqual([]);
    expect(out.reason).toBeTruthy();
    expect(out.missing).toEqual([...COMPARISON_SECTIONS]);
  });
});

describe('the section written under two names', () => {
  /**
   * The producer emits its last section as `finalRecommendation` as well as
   * `recommendations`. Without the alias, `missing` would report a section the
   * result is holding.
   */
  it('treats finalRecommendation as recommendations', () => {
    expect(canonicalSection('finalRecommendation')).toBe('recommendations');
    const renamed = JSON.stringify({
      executiveSummary: 'x',
      finalRecommendation: { bestOverall: { propertyNumber: 1, reason: 'y' } },
    });
    const out = salvageTruncatedJson(renamed)!;
    expect(out.recovered).toContain('finalRecommendation');
    expect(out.missing).not.toContain('recommendations');
  });
});

describe('the guarantee, fuzzed', () => {
  /**
   * Truncate at **every** character and assert the three properties that make
   * this design safe. A partial array element is the failure that would be
   * invisible on the page, so it is checked at every cut rather than at a few.
   */
  it('never throws, always terminates, and never yields a partial ranking', () => {
    let partial = 0;
    for (let cut = 1; cut < json.length; cut += 1) {
      const out = salvageTruncatedJson(json.slice(0, cut));
      if (!out) continue;
      const ranks = out.value.rankings;
      if (!Array.isArray(ranks)) continue;
      for (const e of ranks) {
        const whole = e && typeof e === 'object'
          && 'rank' in e && 'propertyNumber' in e && 'address' in e && 'finalScore' in e;
        if (!whole) partial += 1;
      }
    }
    expect(partial).toBe(0);
  });

  it('bounds the work rather than reading an unbounded string', () => {
    const huge = `{"executiveSummary": "${'a'.repeat(MAX_SALVAGE_CHARS * 2)}"`;
    const out = salvageTruncatedJson(huge);
    // Cut past the cap, so the one section never closes and nothing is recovered
    // — the point is that it returns rather than reading 130,000 characters.
    expect(out).not.toBeNull();
    expect(out!.truncated).toBe(true);
  });
});
