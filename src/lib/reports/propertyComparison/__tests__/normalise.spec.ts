/**
 * What the normaliser must do with a stored comparison row.
 *
 * Every case below is one the record actually contains. The fixtures are
 * fictional — the shapes are real, the figures are not, because a committed
 * fixture gets shared and these are somebody's property financials.
 */
import { describe, expect, it } from 'vitest';
import {
  buildPropertyComparison,
  ComparisonPayloadError,
  detectScale,
  propertyAt,
  toRiskBand,
} from '../normalise.pure';

const NOW = '2026-08-02T00:00:00.000Z';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  created_at: '2026-05-01T00:00:00.000Z',
  property_count: 2,
  property_addresses: ['1 Example Street, Sampleton, QLD 4000', '2 Example Street, Sampleton, QLD 4000'],
  property_states: ['QLD'],
  report_title: 'COMPARISON ANALYSIS - 2 PROPERTIES, QLD',
  report_ids: ['r1', 'r2'],
  analysis_depth: 'comprehensive',
  investor_profile: 'general',
  model_used: 'google/gemini-2.5-flash',
  analysis_summary: '{"timeHorizon":"5-7 years","riskTolerance":"moderate","customWeights":null}',
  executive_summary: 'Two properties compared.',
  rankings: [
    { rank: 1, propertyNumber: 1, address: '1 Example Street, Sampleton, QLD 4000', finalScore: 82 },
    { rank: 2, propertyNumber: 2, address: '2 Example Street, Sampleton, QLD 4000', finalScore: 61 },
  ],
  financial_comparison: {},
  location_comparison: {},
  risk_comparison: {},
  investor_matches: [],
  recommendations: {},
  red_flags: [],
  is_archived: false,
  ...over,
});

const build = (over: Record<string, unknown> = {}) =>
  buildPropertyComparison({ row: row(over), clientName: 'Sample Client', now: NOW });

describe('the hard failures', () => {
  it('refuses a comparison of fewer than two properties', () => {
    expect(() => build({
      property_count: 1,
      property_addresses: ['1 Example Street'],
      rankings: [{ rank: 1, propertyNumber: 1, address: '1 Example Street', finalScore: 5 }],
    })).toThrow(ComparisonPayloadError);
  });

  it('refuses a row with neither columns nor a readable stored response', () => {
    expect(() => buildPropertyComparison({
      row: { id: 'x', executive_summary: 'just some prose', rankings: null },
      clientName: '',
      now: NOW,
    })).toThrow(ComparisonPayloadError);
  });
});

describe('property pointers', () => {
  const properties = [
    { number: 1, address: 'A', shortAddress: 'A', state: '' },
    { number: 2, address: 'B', shortAddress: 'B', state: '' },
  ];

  /**
   * 1-based, and `0` means nobody. 18 of 92 stored pointers name no property, so
   * `properties[n - 1]` on those reads index -1.
   */
  it.each([
    ['a valid pointer', 1, 'A'],
    ['the last property', 2, 'B'],
    ['zero, meaning nobody', 0, null],
    ['null', null, null],
    ['past the end', 9, null],
    ['a negative', -1, null],
    ['a non-integer', 1.5, null],
    ['a string', 'two', null],
  ])('%s', (_label, input, expected) => {
    const got = propertyAt(input, properties);
    expect(got ? got.address : null).toBe(expected);
  });
});

describe('the two score scales', () => {
  it('reads a 0–100 comparison as out of 100', () => {
    expect(build().scale?.outOf).toBe(100);
  });

  it('reads a 0–10 comparison as out of 10', () => {
    const p = build({
      rankings: [
        { rank: 1, propertyNumber: 1, address: 'A', finalScore: 8.5 },
        { rank: 2, propertyNumber: 2, address: 'B', finalScore: 4.2 },
      ],
    });
    expect(p.scale?.outOf).toBe(10);
  });

  /**
   * From the maximum of the whole set, never per score. That is the defect in
   * `migrate-comparison-scores`, which rescales any individual score below 15 by
   * ten — under which a genuine 12/100 becomes 120/100.
   */
  it('does not let one low score drag the set onto the wrong scale', () => {
    expect(detectScale([88, 61, 9])?.outOf).toBe(100);
  });

  it('says when a flat 0–10 reading is not confident', () => {
    expect(detectScale([8, 8.5])?.confident).toBe(false);
    expect(detectScale([2, 9])?.confident).toBe(true);
    expect(detectScale([88, 61])?.confident).toBe(true);
  });

  it('reports no scale when nothing was scored, which is a real state', () => {
    expect(detectScale([0, 0, 0])).toBeNull();
    expect(detectScale([])).toBeNull();
    const p = build({
      rankings: [
        { rank: 1, propertyNumber: 1, address: 'A', finalScore: 0 },
        { rank: 2, propertyNumber: 2, address: 'B', finalScore: 0 },
      ],
    });
    expect(p.scale).toBeNull();
  });
});

describe('risk, as free text', () => {
  /** Ten distinct spellings appear in the record. Severe words win over milder. */
  it.each([
    ['Low-Moderate', 'moderate'],
    ['Moderate', 'moderate'],
    ['Moderate-High', 'high'],
    ['Moderate to High', 'high'],
    ['High', 'high'],
    ['High (Undetermined)', 'high'],
    ['Very High', 'high'],
    ['Critical', 'severe'],
    ['Extreme', 'severe'],
    ['', 'unrated'],
    ['banana', 'unrated'],
  ])('%s → %s', (input, expected) => {
    expect(toRiskBand(input)).toBe(expected);
  });
});

describe('axis polarity', () => {
  /**
   * `highestRisk` names the property that came off worst and sits in the same
   * block as `lowestRisk`. Without polarity the scorecard ticks both, asserting
   * that a property won the category of being riskiest.
   */
  it('marks highestRisk negative and everything else positive', () => {
    const p = build({
      risk_comparison: {
        lowestRisk: { propertyNumber: 1, reason: 'Lower leverage.' },
        highestRisk: { propertyNumber: 2, reason: 'Higher leverage.' },
      },
    });
    const risk = p.axes.find((g) => g.id === 'risk')!;
    expect(risk.winners.find((w) => w.key === 'lowestRisk')!.polarity).toBe('positive');
    expect(risk.winners.find((w) => w.key === 'highestRisk')!.polarity).toBe('negative');
  });
});

describe('the two shapes', () => {
  it('reads the columns when they are populated', () => {
    const p = build();
    expect(p.provenance.shape).toBe('columns');
    expect(p.provenance.missing).toEqual([]);
    expect(p.summary).toBe('Two properties compared.');
  });

  it('salvages when every column is empty and the summary holds a blob', () => {
    const blob = JSON.stringify({
      executiveSummary: 'Recovered summary.',
      rankings: [
        { rank: 1, propertyNumber: 1, address: 'A', finalScore: 70 },
        { rank: 2, propertyNumber: 2, address: 'B', finalScore: 50 },
      ],
    });
    // Cut it, the way the producer's token limit does.
    const p = build({
      rankings: null,
      financial_comparison: null,
      location_comparison: null,
      risk_comparison: null,
      investor_matches: null,
      recommendations: null,
      red_flags: null,
      executive_summary: `${blob.slice(0, blob.length - 2)}, "financialCompar`,
    });
    expect(p.provenance.shape).toBe('salvaged');
    expect(p.provenance.truncated).toBe(true);
    // The recovered key is the summary — never the raw column, which holds the blob.
    expect(p.summary).toBe('Recovered summary.');
    expect(p.provenance.missing).toContain('recommendations');
  });
});

describe('the basis nothing has ever rendered', () => {
  it('parses the settings blob stored in analysis_summary', () => {
    const b = build().basis;
    expect(b.timeHorizon).toBe('5-7 years');
    expect(b.riskTolerance).toBe('moderate');
    expect(b.depth).toBe('comprehensive');
  });

  it('prints nothing rather than raw JSON when it will not parse', () => {
    const b = build({ analysis_summary: '{not json' }).basis;
    expect(b.timeHorizon).toBe('');
    expect(b.riskTolerance).toBe('');
  });

  it('reads custom weights when a row has them', () => {
    const b = build({
      analysis_summary: '{"timeHorizon":"5-7 years","riskTolerance":"low","customWeights":{"growth":30,"yield":20}}',
    }).basis;
    expect(b.weights.map((w) => w.label)).toEqual(['Growth', 'Yield']);
  });
});

describe('the built sentence', () => {
  it('is arithmetic over the payload, so it cannot disagree with the table', () => {
    expect(build().narrative).toContain('2 properties compared in QLD');
    expect(build().narrative).toContain('82 out of 100');
  });

  it('says so plainly when nothing was scored', () => {
    const p = build({
      rankings: [
        { rank: 1, propertyNumber: 1, address: 'A', finalScore: 0 },
        { rank: 2, propertyNumber: 2, address: 'B', finalScore: 0 },
      ],
    });
    expect(p.narrative).toContain('could not score');
  });
});

describe('notes', () => {
  it('says out loud when the comparison is archived', () => {
    expect(build({ is_archived: true }).notes.join(' ')).toMatch(/archived/i);
  });

  it('carries what the route learned', () => {
    const p = buildPropertyComparison({
      row: row(),
      clientName: '',
      notes: ['1 of the 2 reports is no longer in the record.'],
      now: NOW,
    });
    expect(p.notes.join(' ')).toContain('no longer in the record');
  });
});
