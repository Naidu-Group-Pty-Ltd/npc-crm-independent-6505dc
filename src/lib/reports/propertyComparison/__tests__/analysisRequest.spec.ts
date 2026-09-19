/**
 * The contract `compare-investment-reports` asks the model to keep, and what it
 * accepts back.
 *
 * Every fixture here is a shape the production table actually holds. 30 of 53
 * stored comparisons have all seven structured columns NULL, and they are not
 * one failure — they are four, each of which the old producer stored as a
 * success: a response cut off by the output ceiling, a response cut off *inside*
 * a Markdown fence it never closed, a response that closes its own brace and
 * still does not parse, and a response that carried an executive summary and
 * nothing else. The last of those is the newest row in the table and is
 * unreadable by every reader in this repository, because a row holding prose
 * with NULL columns is neither of the two shapes any of them knows.
 */
import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_BUDGET_MS,
  ANALYSIS_SECTIONS,
  CLIENT_ABORT_MS,
  COMPARISON_ANALYSIS_SCHEMA,
  COMPARISON_TOKENS_MAX,
  COMPARISON_TOKENS_MIN,
  MIN_ANALYSIS_MS,
  RESPONSE_FORMAT_LADDER,
  RESPONSE_RESERVE_MS,
  STORABLE_SECTIONS,
  comparisonOutputTokens,
  nextRung,
  preferReading,
  readAnalysisResponse,
  resolveAnalysisDeadline,
  responseFormatFor,
  rungRejected,
} from '../analysisRequest.pure.ts';
import { COMPARISON_SECTIONS } from '../salvage.pure.ts';

const ranking = (n: number) => ({
  propertyNumber: n,
  address: `${n} Example Street`,
  rank: n,
  finalScore: 90 - n,
  primaryStrengths: ['yield'],
  primaryConcerns: ['cash flow'],
  bestSuitedFor: 'balanced',
});

const axis = (n: number) => ({ propertyNumber: n, reason: 'because' });

/** A complete three-property analysis, in the producer's own vocabulary. */
const whole = () => ({
  executiveSummary: 'Three properties in New South Wales.',
  rankings: [ranking(1), ranking(2), ranking(3)],
  financialComparison: { bestYield: axis(2), bestCashFlow: axis(3), bestROI: axis(1), bestValue: axis(2) },
  locationComparison: { bestInfrastructure: axis(1), bestGrowthCorridor: axis(1), bestSchools: axis(2), bestLifestyle: axis(1) },
  riskComparison: {
    lowestRisk: axis(3), highestRisk: axis(1), bestRiskReward: axis(2),
    riskLevels: [{ propertyNumber: 1, riskLevel: 'Moderate-High', specificRisks: ['vacancy'] }],
  },
  investorMatches: [{ propertyNumber: 1, investorTypes: ['Capital Growth Investor'], reasoning: 'growth' }],
  marketTiming: { buyFirst: axis(3), holdingPeriods: [], exitStrategies: [] },
  competitiveAdvantages: [{ propertyNumber: 1, advantages: ['walk score 95'] }],
  redFlags: [{ propertyNumber: 1, concerns: ['negative cash flow'], severity: 'high' }],
  recommendations: { bestOverall: axis(3), runners: [axis(2)], avoid: [axis(1)], alternativeScenarios: [] },
});

describe('the output budget', () => {
  it('grows with the property count', () => {
    const sizes = [2, 3, 4, 5].map(comparisonOutputTokens);
    for (let i = 1; i < sizes.length; i += 1) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
    expect(new Set(sizes).size).toBeGreaterThan(1);
  });

  it('never asks for less than the old flat ceiling, at any supported count', () => {
    // 12,000 is what produced the damage. Every count must clear it, including
    // the two-property case that used to fit — a floor below the old value would
    // reintroduce the defect for the cheapest comparison.
    for (const n of [2, 3, 4, 5]) expect(comparisonOutputTokens(n)).toBeGreaterThan(12_000);
  });

  it('stays inside its own bounds for nonsense input', () => {
    for (const n of [0, -4, 500, Number.NaN, Number.POSITIVE_INFINITY]) {
      const t = comparisonOutputTokens(n as number);
      expect(t).toBeGreaterThanOrEqual(COMPARISON_TOKENS_MIN);
      expect(t).toBeLessThanOrEqual(COMPARISON_TOKENS_MAX);
    }
  });
});

describe('the schema', () => {
  it('names exactly the sections the salvager and the normaliser know', () => {
    // Three descriptions of one shape — the prompt's literal, this schema, and
    // `COMPARISON_SECTIONS` — drifting apart is how `investorMatches` came to be
    // written by every comparison and rendered by none.
    expect(Object.keys(COMPARISON_ANALYSIS_SCHEMA.properties).sort())
      .toEqual([...COMPARISON_SECTIONS].sort());
    expect(ANALYSIS_SECTIONS).toEqual(COMPARISON_SECTIONS);
  });

  it('requires only what makes the payload a comparison', () => {
    expect(COMPARISON_ANALYSIS_SCHEMA.required).toEqual(['executiveSummary', 'rankings']);
  });

  it('judges completeness against the sections that have a column', () => {
    // `marketTiming` and `competitiveAdvantages` are asked for and discarded by
    // the writer. Counting them would report a failure for something the storage
    // throws away on purpose.
    expect(STORABLE_SECTIONS).not.toContain('marketTiming');
    expect(STORABLE_SECTIONS).not.toContain('competitiveAdvantages');
    for (const s of STORABLE_SECTIONS) expect(COMPARISON_SECTIONS).toContain(s);
  });
});

describe('the response-format ladder', () => {
  it('descends from the strongest guarantee to none', () => {
    expect(RESPONSE_FORMAT_LADDER).toEqual(['json_schema', 'json_object', 'none']);
    expect(nextRung('json_schema')).toBe('json_object');
    expect(nextRung('json_object')).toBe('none');
    expect(nextRung('none')).toBeNull();
  });

  it('carries the schema on the top rung and nothing on the last', () => {
    const top = responseFormatFor('json_schema') as any;
    expect(top.type).toBe('json_schema');
    expect(top.json_schema.schema).toBe(COMPARISON_ANALYSIS_SCHEMA);
    expect(top.json_schema.strict).toBeUndefined();
    expect(responseFormatFor('json_object')).toEqual({ type: 'json_object' });
    expect(responseFormatFor('none')).toBeUndefined();
  });

  it('drops a rung only when the provider refused the format itself', () => {
    expect(rungRejected(400, 'Unsupported parameter: response_format')).toBe(true);
    expect(rungRejected(422, 'json_schema is not supported for this model')).toBe(true);
    // Capacity, credit and health are different questions. Weakening the
    // guarantee for one of those would quietly degrade every later call.
    expect(rungRejected(429, 'rate limited')).toBe(false);
    expect(rungRejected(402, 'credits exhausted')).toBe(false);
    expect(rungRejected(500, 'response_format')).toBe(false);
    expect(rungRejected(400, 'context length exceeded')).toBe(false);
  });
});

describe('reading a response', () => {
  it('accepts a whole analysis', () => {
    const r = readAnalysisResponse(JSON.stringify(whole()));
    expect(r.status).toBe('complete');
    expect(r.missing).toEqual([]);
    expect(r.truncated).toBe(false);
    expect((r.analysis.rankings as unknown[]).length).toBe(3);
  });

  it('accepts one fenced by a model that was told not to fence it', () => {
    const r = readAnalysisResponse('```json\n' + JSON.stringify(whole(), null, 2) + '\n```');
    expect(r.status).toBe('complete');
  });

  it('reads back a response the output ceiling cut mid-section', () => {
    // The commonest stored shape: 25 of the 27 blobs the migration measured.
    const full = JSON.stringify(whole(), null, 2);
    const cut = full.slice(0, full.indexOf('"redFlags"') + 400);
    const r = readAnalysisResponse(cut);
    expect(r.status).toBe('partial');
    expect(r.truncated).toBe(true);
    expect(r.present).toContain('rankings');
    expect(r.missing).toContain('recommendations');
  });

  it('reads back one cut inside a fence it never closed', () => {
    // 8 of the 27 are still wrapped. The old strip needed a CLOSING fence, so it
    // matched nothing and handed `JSON.parse` a string starting with backticks.
    const full = JSON.stringify(whole(), null, 2);
    const cut = '```json\n' + full.slice(0, full.indexOf('"investorMatches"') + 200);
    const r = readAnalysisResponse(cut);
    expect(r.status).toBe('partial');
    expect(r.present).toContain('rankings');
  });

  it('reads back one that closes its own brace and still does not parse', () => {
    // Two rows from 2026-08-15 and two from 2026-05-20. The model closed an
    // object with `]`; Postgres puts the fault at line 225 of 251, deep inside
    // `competitiveAdvantages`, with six good sections in front of it.
    const full = JSON.stringify(whole(), null, 2);
    // The counts balance and the TYPES do not, exactly as the stored row does:
    // `]` where `}` belongs, and `}` where `]` belongs, one line later.
    const broken = full.replace(
      '        "walk score 95"\n      ]\n    }\n  ]',
      '        "walk score 95"\n      ]\n    ]\n  }',
    );
    expect(broken).not.toBe(full);
    expect(() => JSON.parse(broken)).toThrow();
    const r = readAnalysisResponse(broken);
    expect(r.status).toBe('partial');
    expect(r.present).toContain('rankings');
    expect(r.present).toContain('redFlags');
  });

  it('refuses a response that parsed and is not a comparison', () => {
    // `a1e484eb` — 2026-08-19, the newest row in the table. It PARSED, the
    // producer logged "Successfully parsed AI analysis", and it wrote 1,434
    // characters of prose into `executive_summary` with seven NULL columns. The
    // PDF route refuses it and the viewer shows one empty tab.
    const r = readAnalysisResponse(JSON.stringify({ executiveSummary: 'Three properties in NSW.' }));
    expect(r.status).toBe('unusable');
    expect(r.analysis).toEqual({});
    expect(r.reason).toMatch(/rankings/i);
  });

  it('refuses a single-property ranking', () => {
    const r = readAnalysisResponse(JSON.stringify({ ...whole(), rankings: [ranking(1)] }));
    expect(r.status).toBe('unusable');
    expect(r.reason).toMatch(/at least two/);
  });

  it('refuses prose, rather than storing it as an executive summary', () => {
    const r = readAnalysisResponse('This report compares three properties in New South Wales.');
    expect(r.status).toBe('unusable');
    expect(r.reason).toMatch(/prose/);
  });

  it('refuses an empty answer', () => {
    for (const empty of [null, undefined, '', '   ']) {
      expect(readAnalysisResponse(empty as unknown).status).toBe('unusable');
    }
  });

  it('treats finalRecommendation as the section it is stored in', () => {
    const { recommendations, ...rest } = whole();
    const r = readAnalysisResponse(JSON.stringify({ ...rest, finalRecommendation: recommendations }));
    expect(r.status).toBe('complete');
    expect(r.missing).toEqual([]);
    expect(r.analysis.recommendations).toEqual(recommendations);
  });

  it('counts an empty section as absent, not as present', () => {
    const r = readAnalysisResponse(JSON.stringify({ ...whole(), redFlags: [], executiveSummary: '  ' }));
    expect(r.status).toBe('partial');
    expect(r.missing).toContain('redFlags');
    expect(r.missing).toContain('executiveSummary');
  });

  it('never hands back a half-written ranking row, cut at any character', () => {
    // The property `salvage.spec.ts` fuzzes for, re-asserted at this boundary:
    // the producer writes the columns, so a partial ranking here would reach a
    // client's document as though it were whole.
    const full = JSON.stringify(whole(), null, 2);
    for (let i = 1; i <= full.length; i += 1) {
      const r = readAnalysisResponse(full.slice(0, i));
      for (const row of (Array.isArray(r.analysis.rankings) ? r.analysis.rankings : []) as any[]) {
        expect(typeof row.propertyNumber).toBe('number');
        expect(typeof row.rank).toBe('number');
        expect(typeof row.finalScore).toBe('number');
        expect(typeof row.bestSuitedFor).toBe('string');
      }
    }
  });
});

describe('choosing between attempts', () => {
  const reading = (over: Record<string, unknown>) => ({
    status: 'partial', analysis: {}, present: [], missing: [], truncated: false, reason: '', ...over,
  }) as any;

  it('keeps the first attempt when the retry came back no better', () => {
    // A retry that is worse must not replace what is already in hand — the
    // whole point of asking again is that the failure is stochastic.
    const first = reading({ present: ['rankings', 'redFlags'] });
    const worse = reading({ present: ['rankings'] });
    expect(preferReading(first, worse)).toBe(first);
    expect(preferReading(first, reading({ status: 'unusable' }))).toBe(first);
  });

  it('takes a complete attempt over any partial, and a partial over nothing', () => {
    const partial = reading({ present: ['rankings'] });
    const complete = reading({ status: 'complete', present: ['rankings', 'redFlags'] });
    expect(preferReading(partial, complete)).toBe(complete);
    expect(preferReading(reading({ status: 'unusable' }), partial)).toBe(partial);
    expect(preferReading(null, partial)).toBe(partial);
  });

  it('takes the broader partial, and the one that parsed whole on a tie', () => {
    const narrow = reading({ present: ['rankings'] });
    const broad = reading({ present: ['rankings', 'redFlags'] });
    expect(preferReading(narrow, broad)).toBe(broad);

    const scanned = reading({ present: ['rankings'], truncated: true });
    const parsed = reading({ present: ['rankings'], truncated: false });
    expect(preferReading(scanned, parsed)).toBe(parsed);
    expect(preferReading(parsed, scanned)).toBe(parsed);
  });
});

describe('when the answer must be in', () => {
  // Fixed clocks: the function takes timestamps, so nothing here is flaky.
  const handlerStart = 1_756_000_000_000;

  it('keeps the handler budget when the wrapper was quick — the behaviour it always had', () => {
    // The measured healthy gap: auth, the price lookup and the reserve in ~4.5s.
    const d = resolveAnalysisDeadline(handlerStart, String(handlerStart - 4_500));
    expect(d.deadlineAt).toBe(handlerStart + ANALYSIS_BUDGET_MS);
    expect(d.preHandlerMs).toBe(4_500);
    expect(d.tooLate).toBe(false);
  });

  it('shrinks the budget when the wrapper burned into it', () => {
    // Mission Control stalled for a minute before the handler started. The
    // browser aborts CLIENT_ABORT_MS after the REQUEST started, so the loop
    // has to stop early enough for the insert, the commit and the response.
    const d = resolveAnalysisDeadline(handlerStart, String(handlerStart - 60_000));
    expect(d.deadlineAt).toBe(handlerStart - 60_000 + CLIENT_ABORT_MS - RESPONSE_RESERVE_MS);
    expect(d.roomMs).toBe(CLIENT_ABORT_MS - RESPONSE_RESERVE_MS - 60_000);
    expect(d.tooLate).toBe(false);
  });

  it('refuses to start a run whose answer nobody can receive', () => {
    // The production incident: 115s spent before the handler. Starting the
    // analysis anyway is how a stored, charged comparison came to be reported
    // as "Request timed out".
    const d = resolveAnalysisDeadline(handlerStart, String(handlerStart - 115_000));
    expect(d.tooLate).toBe(true);
    expect(d.roomMs).toBeLessThan(MIN_ANALYSIS_MS);
  });

  it('falls back to the handler clock on a missing or nonsensical header', () => {
    for (const header of [null, undefined, '', 'soon', '-5', String(handlerStart + 10_000)]) {
      const d = resolveAnalysisDeadline(handlerStart, header);
      expect(d.deadlineAt).toBe(handlerStart + ANALYSIS_BUDGET_MS);
      expect(d.preHandlerMs).toBe(0);
      expect(d.tooLate).toBe(false);
    }
  });

  it('keeps the constants mutually consistent', () => {
    // The handler budget plus the response reserve must fit inside the
    // browser's abort, or the healthy path times out by construction.
    expect(ANALYSIS_BUDGET_MS + RESPONSE_RESERVE_MS).toBeLessThanOrEqual(CLIENT_ABORT_MS);
    // The refusal floor has to be reachable: a floor above the budget would
    // refuse every request, including the healthy ones.
    expect(MIN_ANALYSIS_MS).toBeLessThan(ANALYSIS_BUDGET_MS);
  });
});
