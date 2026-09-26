/**
 * A live web search is not a retrieval — for crime and climate too.
 *
 * Two contradictions inside one document, the Investment Compass delivered for
 * 9 Hollow Street, Golden Square on 21 Sep 2026, read off the PDF.
 *
 * CRIME. Page 20: "the latest violent-crime rate per 100,000 residents is
 * lower than the Greater Bendigo benchmark", "using Crime Statistics Agency
 * Victoria data", another tool "summarises Golden Square's crime exposure as
 * moderate", the suburb "recorded 522 crimes in a recent year". Pages 24, 25
 * and 26 say four times that no recorded-crime register is integrated and that
 * "no crime counts, rates or safety scores are held".
 *
 * CLIMATE. Pages 8 and 28 state annual rainfall of 511.3 mm from the SILO grid
 * cell with its 1991–2020 window named. Page 19 states "about 420–430 mm" and
 * names no source.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CENSUS_WEB_SEARCH_RULE,
  CLIMATE_WEB_SEARCH_RULE,
  CRIME_WEB_SEARCH_RULE,
  MACRO_WEB_SEARCH_RULE,
  REGIONAL_WEB_SEARCH_RULE,
  webSearchIsNotARetrieval,
} from '../../../../supabase/functions/_shared/reports/registerAuthority.pure';
import { crimeStatBlocks } from '../../../../supabase/functions/_shared/reports/crimePromptBlocks.pure';
import { climateStatBlocks } from '../../../../supabase/functions/_shared/reports/climatePromptBlocks.pure';

describe('the clause reaches both registers, held and absent', () => {
  it('is on the crime block when nothing is integrated', () => {
    // The state the delivered document was in.
    expect(crimeStatBlocks({})).toContain(CRIME_WEB_SEARCH_RULE);
    expect(crimeStatBlocks({ crimeStatistics: {} })).toContain(CRIME_WEB_SEARCH_RULE);
  });

  it('is on the crime block when a register DID answer', () => {
    // A web figure must not be mixed with register figures either — page 20
    // compared an unheld rate against an LGA benchmark.
    const held = crimeStatBlocks({
      crimeStatistics: {
        totalLast12Months: 522, area: 'Golden Square', areaKind: 'suburb',
        source: 'Crime Statistics Agency Victoria', referencePeriod: 'year to December 2025',
      },
    });
    expect(held).toContain('522');
    expect(held).toContain(CRIME_WEB_SEARCH_RULE);
  });

  it('is on the climate block, held and absent', () => {
    expect(climateStatBlocks({})).toContain(CLIMATE_WEB_SEARCH_RULE);
    const held = climateStatBlocks({
      climate: { annualRainfallMm: 511.3, normalPeriod: '1991–2020' },
    } as never);
    expect(held).toContain(CLIMATE_WEB_SEARCH_RULE);
  });
});

describe('what the clause says, and what it is careful not to say', () => {
  const rule = CRIME_WEB_SEARCH_RULE;

  it('names the kinds of page a model actually finds', () => {
    for (const kind of ['community report', 'news page', 'listing portal', 'government media release']) {
      expect(rule).toContain(kind);
    }
  });

  it('refuses the figure, the rate, the ranking and the attribution', () => {
    // Every one of these is something page 20 did.
    for (const refused of ['a figure', 'a rate', 'a ranking', 'attributed to an agency this report did not ask']) {
      expect(rule).toContain(refused);
    }
    expect(rule).toMatch(/low \/ moderate \/ average/);
    expect(rule).toMatch(/used to compare this area with another/);
  });

  it('permits the qualitative discussion, because a bare prohibition is routed around', () => {
    // `rentalEvidence`'s rule: a prohibition with no permitted action is one a
    // model routes around.
    expect(rule).toContain('qualitatively is fine');
    expect(rule).toContain('naming none is the correct answer');
  });

  it('is one sentence pattern, parameterised — never two copies', () => {
    expect(CRIME_WEB_SEARCH_RULE).toBe(webSearchIsNotARetrieval('crime', 'the recorded-crime register'));
    expect(CLIMATE_WEB_SEARCH_RULE)
      .toBe(webSearchIsNotARetrieval('climate', 'a measured reading at this property'));
    // The two differ only in what they name.
    expect(CRIME_WEB_SEARCH_RULE.replace(/crime/g, 'X').replace(/the recorded-X register/, 'R'))
      .toBe(CLIMATE_WEB_SEARCH_RULE.replace(/climate/g, 'X').replace(/a measured reading at this property/, 'R'));
  });

  it('neither block composes its own copy of the wording', () => {
    // Two copies of one rule is how the two come to disagree.
    for (const f of [
      'supabase/functions/_shared/reports/crimePromptBlocks.pure.ts',
      'supabase/functions/_shared/reports/climatePromptBlocks.pure.ts',
    ]) {
      const src = readFileSync(f, 'utf8');
      expect(src).toMatch(/_WEB_SEARCH_RULE/);
      expect(src).not.toMatch(/is not a retrieval/i);
    }
  });
});

describe('the prohibitions it sits beside are untouched', () => {
  it('keeps the crime block’s own refusals', () => {
    const absent = crimeStatBlocks({});
    expect(absent).toContain('do NOT print a crime table, a safety score, a rating or an estimated rate');
    expect(absent).toContain('Recorded crime for this area is not covered by this report');
  });

  it('keeps the climate block’s own refusals', () => {
    const absent = climateStatBlocks({});
    expect(absent).toContain('do NOT print a climate table, name a climate zone, or rate any hazard');
  });
});

/**
 * Every register block that had NO clause now carries the same one.
 *
 * Two of the three said "from memory", which is the tell — the author was
 * thinking about the model's own knowledge and not about a model that
 * searches. `marketFactBlocks` and `planningFactBlocks` are deliberately not
 * changed: each already states the rule in its own voice, and rewriting a
 * rule that works to make it look like its neighbours is a change with no
 * reader behind it.
 */
describe('the clause reaches every block that lacked one', () => {
  const BLOCKS = [
    'supabase/functions/_shared/reports/crimePromptBlocks.pure.ts',
    'supabase/functions/_shared/reports/climatePromptBlocks.pure.ts',
    'supabase/functions/_shared/reports/censusPromptBlocks.pure.ts',
    'supabase/functions/_shared/reports/regionalPromptBlocks.pure.ts',
    'supabase/functions/_shared/reports/macroPromptBlocks.pure.ts',
  ];

  it.each(BLOCKS)('%s imports the shared rule and writes none of its own', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src).toMatch(/import \{ [A-Z_]+_WEB_SEARCH_RULE \} from '\.\/registerAuthority\.pure\.ts';/);
    // Two copies of one rule is how the two come to disagree.
    expect(src).not.toMatch(/is not a retrieval/i);
  });

  it.each(BLOCKS)('%s carries it on BOTH branches', (file) => {
    const src = readFileSync(file, 'utf8');
    const uses = src.match(/[A-Z_]+_WEB_SEARCH_RULE/g) ?? [];
    // One import plus the absent branch plus the held branch.
    expect(uses.length).toBeGreaterThanOrEqual(3);
  });

  it('every constant is the one pattern, parameterised', () => {
    expect(CENSUS_WEB_SEARCH_RULE).toBe(webSearchIsNotARetrieval('demographic', 'the Census tables above'));
    expect(REGIONAL_WEB_SEARCH_RULE)
      .toBe(webSearchIsNotARetrieval('population', 'the measured trend for this area'));
    expect(MACRO_WEB_SEARCH_RULE)
      .toBe(webSearchIsNotARetrieval('economic', 'the measured indicator table above'));
  });

  it('leaves the two blocks that already had one alone', () => {
    // `marketFactBlocks` carries it in both branches in its own words, and
    // `planningFactBlocks` states it as part of the sentence giving its rules
    // precedence over the rest of the prompt.
    for (const [file, phrase] of [
      ['supabase/functions/_shared/reports/market/marketFactBlocks.pure.ts', 'not from a live web search'],
      ['supabase/functions/_shared/planning/planningFacts.pure.ts', 'anything a live web search returns'],
    ] as const) {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain(phrase);
      expect(src).not.toMatch(/_WEB_SEARCH_RULE/);
    }
  });
});
