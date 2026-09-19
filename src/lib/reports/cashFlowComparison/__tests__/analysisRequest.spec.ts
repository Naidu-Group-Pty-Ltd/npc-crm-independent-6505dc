/**
 * "Failed to parse AI analysis" was never true.
 *
 * An adviser comparing properties on the Cash Flow Analysis page pressed
 * Generate and got that sentence every time. The model answered, and answered
 * in JSON. Four things in the producer caused it, and this file pins each one
 * so none can come back:
 *
 *   1. 4,000 output tokens for an eight-section schema, shared with a reasoning
 *      model's own thinking;
 *   2. no `response_format` at all, so the shape was a request rather than a
 *      constraint;
 *   3. a fence regex that required a CLOSING fence, so a cut-off answer was
 *      handed to `JSON.parse` with the opening fence still attached;
 *   4. `finish_reason` never read, so "it ran out of room" was reported as "it
 *      did not answer with JSON" — which sends an operator to the wrong remedy.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readModelJson } from '../../../../../supabase/functions/_shared/llmJson.pure';
import { ANALYSIS_SECTIONS } from '../normalise.pure';
import {
  ANALYSIS_SECTION_LABELS,
  CASH_FLOW_ANALYSIS_BUDGET_MS,
  CASH_FLOW_ANALYSIS_CLIENT_MS,
  CASH_FLOW_ANALYSIS_MIN_MS,
  CASH_FLOW_ANALYSIS_SCHEMA,
  CASH_FLOW_ANALYSIS_SHAPE,
  CASH_FLOW_TOKENS_MAX,
  CASH_FLOW_TOKENS_MIN,
  attemptTimeoutMs,
  cashFlowAnalysisTokens,
  classifyCashFlowAnalysis,
  describeMissingSections,
} from '../analysisRequest.pure';

const REPO = resolve(__dirname, '../../../../..');
const PRODUCER = readFileSync(
  resolve(REPO, 'supabase/functions/compare-cash-flow-reports/index.ts'),
  'utf8',
);

/** An answer holding every section, for the readings below. */
function whole(): Record<string, unknown> {
  return {
    executiveSummary: 'Two properties, one clear winner.',
    cashFlowTrajectory: { strongestGrowth: { propertyNumber: 1, reason: 'Rent growth.' } },
    capitalGrowth: { wealthBuilder: { propertyNumber: 1, reason: 'Corridor.' } },
    yieldAnalysis: { bestGrossYield: { propertyNumber: 2, value: '5.1%' } },
    riskAssessment: { mostStable: { propertyNumber: 1, reason: 'Long lease.' } },
    investorRecommendations: { balanced: { propertyNumber: 1, reason: 'Both halves.' } },
    finalRankings: [
      { rank: 1, propertyNumber: 1, address: '48 Budgeree Street' },
      { rank: 2, propertyNumber: 2, address: '93 Bimbadeen Avenue' },
    ],
    overallRecommendation: { bestProperty: { propertyNumber: 1, reason: 'It is the one.' } },
  };
}

// ── One description of the shape ────────────────────────────────────────────

describe('the shape asked for is the shape read back', () => {
  it('names exactly the eight sections `toAnalysis` reads', () => {
    // Three descriptions of one shape drifting apart is how the sibling
    // comparison came to write a section on every run and render it on none.
    expect(Object.keys(CASH_FLOW_ANALYSIS_SCHEMA.properties)).toEqual([...ANALYSIS_SECTIONS]);
  });

  it('carries every section in the worked example too', () => {
    for (const section of ANALYSIS_SECTIONS) {
      expect(CASH_FLOW_ANALYSIS_SHAPE, `${section} is missing from the example`)
        .toContain(`"${section}"`);
    }
  });

  it('requires the summary and the rankings, and nothing else', () => {
    // A section the model had nothing to say about must not become a refusal.
    expect(CASH_FLOW_ANALYSIS_SCHEMA.required).toEqual(['executiveSummary', 'finalRankings']);
  });

  it('asks for `balanced`, the spelling the schema names', () => {
    // `INVESTOR_PROFILES` accepts `balancedApproach` because both legacy
    // generators read it — but what is asked for is one spelling.
    expect(CASH_FLOW_ANALYSIS_SCHEMA.properties.investorRecommendations.properties)
      .toHaveProperty('balanced');
    expect(CASH_FLOW_ANALYSIS_SHAPE).not.toContain('balancedApproach');
  });

  it('gives every section a label an operator can read', () => {
    for (const section of ANALYSIS_SECTIONS) {
      const label = ANALYSIS_SECTION_LABELS[section];
      expect(label, `${section} has no label`).toBeTruthy();
      // Database vocabulary never reaches the operator.
      expect(label).not.toMatch(/[a-z][A-Z]|_/);
    }
  });
});

// ── The budget ──────────────────────────────────────────────────────────────

describe('how much room the answer is given', () => {
  it('is never the 4,000 that caused this', () => {
    for (let n = 2; n <= 5; n += 1) {
      expect(cashFlowAnalysisTokens(n), `${n} properties`).toBeGreaterThan(4_000);
    }
  });

  it('grows with the property count, which is what truncated first', () => {
    expect(cashFlowAnalysisTokens(5)).toBeGreaterThan(cashFlowAnalysisTokens(2));
  });

  it('is bounded at both ends', () => {
    expect(cashFlowAnalysisTokens(0)).toBe(CASH_FLOW_TOKENS_MIN);
    expect(cashFlowAnalysisTokens(-3)).toBe(CASH_FLOW_TOKENS_MIN);
    expect(cashFlowAnalysisTokens(500)).toBe(CASH_FLOW_TOKENS_MAX);
    expect(cashFlowAnalysisTokens(Number.NaN)).toBe(CASH_FLOW_TOKENS_MIN);
  });
});

// ── The clock ───────────────────────────────────────────────────────────────

describe('who is still waiting', () => {
  it('lets the browser wait longer than the function will take', () => {
    // `invokeSecureFunction` defaults to 60s and this call passed no override,
    // so raising the token budget alone would have swapped a parse failure for
    // an abort — and the adviser is told it failed either way.
    expect(CASH_FLOW_ANALYSIS_CLIENT_MS).toBeGreaterThan(CASH_FLOW_ANALYSIS_BUDGET_MS);
  });

  it('gives a first attempt most of the budget', () => {
    const room = attemptTimeoutMs(2_000);
    expect(room).toBeGreaterThan(60_000);
    expect(room).toBeLessThan(CASH_FLOW_ANALYSIS_BUDGET_MS);
  });

  it('refuses to start an attempt that cannot finish', () => {
    expect(attemptTimeoutMs(CASH_FLOW_ANALYSIS_BUDGET_MS)).toBe(0);
    expect(attemptTimeoutMs(CASH_FLOW_ANALYSIS_BUDGET_MS - CASH_FLOW_ANALYSIS_MIN_MS)).toBe(0);
  });

  it('treats a nonsensical elapsed time as none spent', () => {
    expect(attemptTimeoutMs(Number.NaN)).toBe(attemptTimeoutMs(0));
    expect(attemptTimeoutMs(-500)).toBe(attemptTimeoutMs(0));
  });
});

// ── Reading the answer ──────────────────────────────────────────────────────

describe('what counts as an analysis', () => {
  it('reads a whole answer as complete', () => {
    const read = classifyCashFlowAnalysis(whole());
    expect(read.status).toBe('complete');
    expect(read.missing).toEqual([]);
    expect(read.present).toEqual([...ANALYSIS_SECTIONS]);
  });

  it('keeps a partial answer and says which sections are absent', () => {
    const { overallRecommendation, riskAssessment, ...rest } = whole();
    const read = classifyCashFlowAnalysis(rest);
    expect(read.status).toBe('partial');
    expect(read.missing).toEqual(['riskAssessment', 'overallRecommendation']);
    // Six sections of real work are not thrown away because a seventh is not
    // there — but they are never presented as a whole answer either.
    expect(read.analysis).toBe(rest);
  });

  it('reports missing sections in schema order, not in the order they were found', () => {
    const read = classifyCashFlowAnalysis({ finalRankings: whole().finalRankings });
    expect(read.missing).toEqual(
      ANALYSIS_SECTIONS.filter((s) => s !== 'finalRankings'),
    );
  });

  it('treats an empty section as absent rather than present', () => {
    const read = classifyCashFlowAnalysis({
      ...whole(),
      executiveSummary: '   ',
      finalRankings: [],
      riskAssessment: {},
    });
    expect(read.missing).toEqual(
      expect.arrayContaining(['executiveSummary', 'finalRankings', 'riskAssessment']),
    );
  });

  it('refuses anything that is not an analysis object', () => {
    for (const value of [null, undefined, 'prose about three houses', 42, [whole()]]) {
      expect(classifyCashFlowAnalysis(value).status).toBe('unusable');
    }
  });

  it('refuses an object with none of the eight sections in it', () => {
    const read = classifyCashFlowAnalysis({ notes: 'hello', propertyCount: 3 });
    expect(read.status).toBe('unusable');
    expect(read.analysis).toEqual({});
    expect(read.reason).toBeTruthy();
  });
});

describe('what the reader is told about a short answer', () => {
  it('says nothing at all when nothing is missing', () => {
    expect(describeMissingSections([])).toBe('');
  });

  it('names one section in words, and agrees with itself about number', () => {
    const said = describeMissingSections(['riskAssessment']);
    expect(said).toContain('Risk assessment was not');
    expect(said).toContain('produce it.');
  });

  it('lists several without a trailing comma', () => {
    const said = describeMissingSections(['riskAssessment', 'overallRecommendation']);
    expect(said).toContain('Risk assessment and Overall recommendation were not');
    expect(said).toContain('produce them.');
  });

  it('never leaks a schema key onto the screen', () => {
    const said = describeMissingSections([...ANALYSIS_SECTIONS]);
    for (const section of ANALYSIS_SECTIONS) expect(said).not.toContain(section);
  });
});

// ── The regex that produced the reported sentence ───────────────────────────

describe('the fence regex this replaced', () => {
  /** Verbatim from the producer, before this change. */
  const OLD = /```(?:json)?\s*\n([\s\S]*?)\n```/;

  it('could not match a truncated answer, which is why the parse threw', () => {
    const cut = '```json\n' + JSON.stringify(whole(), null, 2).slice(0, 320);
    expect(OLD.exec(cut)).toBeNull();
    // …so `JSON.parse` was handed the string WITH the opening fence.
    expect(() => JSON.parse(cut)).toThrow();
  });

  it('is now read as truncation, with the remedy in the message', () => {
    const cut = '```json\n' + JSON.stringify(whole(), null, 2).slice(0, 320);
    const read = readModelJson(cut, 'length');
    expect(read.ok).toBe(false);
    if (read.ok === true) return;
    expect(read.reason).toBe('truncated');
    expect(read.message).toMatch(/cut off|token budget/i);
  });

  it('recovers a fenced answer the old regex would have needed a closing fence for', () => {
    const read = readModelJson<Record<string, unknown>>('```json\n' + JSON.stringify(whole()), 'stop');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(classifyCashFlowAnalysis(read.value).status).toBe('complete');
  });
});

// ── The producer does what this module says ─────────────────────────────────

describe('the producer', () => {
  it('no longer hand-rolls a fence regex', () => {
    expect(PRODUCER).not.toContain('```(?:json)?');
    expect(PRODUCER).toContain('readModelJson');
  });

  it('reads the field that says the answer was cut off', () => {
    expect(PRODUCER).toContain('finish_reason');
  });

  it('never indexes a choice it has not checked for', () => {
    expect(PRODUCER).not.toMatch(/choices\[0\]/);
    expect(PRODUCER).toContain('choices?.[0]');
  });

  it('asks for the shape rather than describing it twice', () => {
    expect(PRODUCER).toContain('CASH_FLOW_ANALYSIS_SHAPE');
    expect(PRODUCER).toContain('responseFormat');
  });

  it('sizes the budget instead of naming a number', () => {
    expect(PRODUCER).toContain('cashFlowAnalysisTokens');
    expect(PRODUCER).not.toMatch(/maxTokens:\s*4000/);
  });

  it('numbers the properties in the order the caller sent them', () => {
    // `propertyNumber` is the only handle the model has on a property in five
    // of the eight sections, and it was the order an `.in()` happened to
    // answer in.
    expect(PRODUCER).toContain('orderedReports');
  });
});

describe('the router tells a caller why a native model stopped', () => {
  const ROUTER = readFileSync(resolve(REPO, 'supabase/functions/_shared/llmRouter.ts'), 'utf8');

  it('carries a finish reason on both native reshapes', () => {
    // Both re-shape into `choices[0].message` so a caller reads one shape, and
    // both dropped the stop reason — the one field that tells a truncated
    // answer from one the model chose to end.
    expect(ROUTER.match(/finish_reason: openAiFinishReason\(/g) ?? []).toHaveLength(2);
    expect(ROUTER).toContain("if (word === 'max_tokens') return 'length';");
  });
});
