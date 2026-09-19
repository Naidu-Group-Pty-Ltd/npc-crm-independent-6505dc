/**
 * The model's contract.
 *
 * What is tested here is not the model — it is everything around it: what it is
 * told, what is accepted back, and what is refused. A language model is the one
 * component of this document that cannot be asserted on, so the boundary around
 * it is where the assertions have to be.
 *
 * The refusals matter more than the acceptances. `parseAnalysis` returning
 * `null` costs the document one section of nine; `parseAnalysis` accepting
 * something malformed puts half a section in a client's finance report.
 */

import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_SYSTEM_PROMPT,
  ANALYSIS_TOOL_SCHEMA,
  buildAnalysisPrompt,
  FORBIDDEN_CLAIMS,
  MAX_EVIDENCE_ITEMS,
  MAX_FINDINGS,
  MAX_INTERPRETATION_CHARS,
  MAX_QUESTIONS,
  MAX_SCENARIOS,
  parseAnalysis,
  type AnalysisFacts,
} from '../analysis.pure';

const WHEN = { model: 'google/gemini-2.5-flash', generatedAt: '2026-08-05T01:10:00.000Z' };

const GOOD = {
  interpretation: 'The debt service cover test binds this facility.',
  findings: [
    { title: 'Single-tenant concentration', detail: 'One covenant carries the income.', significance: 'risk' },
    { title: 'LVR headroom', detail: 'Comfortably inside the ceiling.', significance: 'strength' },
  ],
  scenarios: [
    {
      name: 'Reduce the facility',
      reasoning: 'Fund the difference from equity.',
      estimatedImpact: 'Brings the deal inside every test.',
      executionRisk: 'low',
      evidenceRequired: ['Evidence of available cash'],
    },
    {
      name: 'Extend the lease',
      reasoning: 'Term remaining is what a lender relies on.',
      estimatedImpact: 'Improves the cover position.',
      executionRisk: 'medium',
      evidenceRequired: ['Signed extension'],
    },
  ],
  questionsForCredit: ['What is the tenant\'s trading history?'],
};

const FACTS: AnalysisFacts = {
  outcome: 'Outside Current Assumptions',
  outcomeReason: 'The request exceeds the assessed capacity.',
  segment: 'industrial',
  assessmentType: 'Industrial investment',
  assetClass: 'Warehouse',
  location: '88 Foundry Link, Truganina VIC 3029',
  lenderProfile: 'Mainstream commercial bank',
  figures: [{ label: 'Maximum indicative capacity', value: '$3,055,219' }],
  constraints: [
    { label: 'Debt service coverage ratio', cap: '$3,055,219', binding: true, applied: true },
    { label: 'Loan-to-value ratio', cap: '$3,802,500', binding: false, applied: true },
    { label: 'Debt yield', cap: '—', binding: false, applied: false },
  ],
  tenancies: [{ tenant: 'National Logistics Pty Ltd', rent: '$350,000 pa', expiry: '2031-01-01' }],
  warnings: ['Break-even occupancy is high.'],
  outstanding: ['Signed lease for tenancy two'],
};

describe('parseAnalysis — what is accepted', () => {
  it('reads a well-formed answer', () => {
    const analysis = parseAnalysis(GOOD, WHEN)!;
    expect(analysis.interpretation).toBe(GOOD.interpretation);
    expect(analysis.findings).toHaveLength(2);
    expect(analysis.scenarios).toHaveLength(2);
    expect(analysis.model).toBe(WHEN.model);
    expect(analysis.generatedAt).toBe(WHEN.generatedAt);
  });

  it('reads the JSON string the gateway returns tool arguments as', () => {
    // Unwrapped here rather than at the call site, because the caller has both
    // shapes and doing it in two places is how the two drift.
    expect(parseAnalysis(JSON.stringify(GOOD), WHEN)?.findings).toHaveLength(2);
  });

  it('collapses whitespace so a model\'s line breaks do not reach the page', () => {
    const analysis = parseAnalysis({
      ...GOOD,
      interpretation: '  The\n\n  cover test   binds.  ',
    }, WHEN)!;
    expect(analysis.interpretation).toBe('The cover test binds.');
  });
});

describe('parseAnalysis — what is refused', () => {
  it.each([
    ['nothing at all', null],
    ['a string that is not JSON', 'not json'],
    ['an array', [1, 2, 3]],
    ['no interpretation', { ...GOOD, interpretation: '' }],
    ['no findings', { ...GOOD, findings: [] }],
    ['no scenarios', { ...GOOD, scenarios: [] }],
    ['findings that are not objects', { ...GOOD, findings: ['a risk'] }],
    ['a finding with no detail', { ...GOOD, findings: [{ title: 'x', significance: 'risk' }] }],
    ['a scenario with no reasoning', { ...GOOD, scenarios: [{ name: 'x', executionRisk: 'low' }] }],
  ])('refuses %s', (_label, input) => {
    // All or nothing. A report with no analysis is complete; a report with an
    // analysis missing half its parts looks like something failed, because it
    // did.
    expect(parseAnalysis(input, WHEN)).toBeNull();
  });
});

describe('parseAnalysis — what is repaired rather than refused', () => {
  it('treats an unrecognised significance as an observation', () => {
    // The model got the words right and the label wrong, and the words are the
    // part a reader needs.
    const analysis = parseAnalysis({
      ...GOOD,
      findings: [{ title: 'x', detail: 'y', significance: 'catastrophic' }],
    }, WHEN)!;
    expect(analysis.findings[0].significance).toBe('observation');
  });

  it('treats an unrecognised execution risk as medium', () => {
    // There is no "unrated" column on the page, and defaulting to `low` would
    // understate something nobody assessed.
    const analysis = parseAnalysis({
      ...GOOD,
      scenarios: [{ ...GOOD.scenarios[0], executionRisk: 'extreme' }],
    }, WHEN)!;
    expect(analysis.scenarios[0].executionRisk).toBe('medium');
  });

  it('accepts a risk in any case', () => {
    const analysis = parseAnalysis({
      ...GOOD,
      scenarios: [{ ...GOOD.scenarios[0], executionRisk: 'HIGH' }],
    }, WHEN)!;
    expect(analysis.scenarios[0].executionRisk).toBe('high');
  });

  it('drops evidence items that are not strings, without dropping the scenario', () => {
    const analysis = parseAnalysis({
      ...GOOD,
      scenarios: [{ ...GOOD.scenarios[0], evidenceRequired: ['Valuation', 42, null, ''] }],
    }, WHEN)!;
    expect(analysis.scenarios[0].evidenceRequired).toEqual(['Valuation']);
  });
});

describe('parseAnalysis — the page budget is enforced, not requested', () => {
  const many = (n: number, make: (i: number) => unknown) => Array.from({ length: n }, (_, i) => make(i));

  it('caps every list', () => {
    const analysis = parseAnalysis({
      interpretation: 'x'.repeat(MAX_INTERPRETATION_CHARS * 3),
      findings: many(20, (i) => ({ title: `f${i}`, detail: 'd', significance: 'risk' })),
      scenarios: many(20, (i) => ({
        name: `s${i}`, reasoning: 'r', estimatedImpact: 'i', executionRisk: 'low',
        evidenceRequired: many(20, (j) => `e${j}`),
      })),
      questionsForCredit: many(20, (i) => `q${i}`),
    }, WHEN)!;

    // The spine claims two pages for this section and `validateSpine` rejects a
    // document outside its band, so a section whose length the model decides is
    // a page budget nobody can honour.
    expect(analysis.interpretation.length).toBeLessThanOrEqual(MAX_INTERPRETATION_CHARS);
    expect(analysis.findings).toHaveLength(MAX_FINDINGS);
    expect(analysis.scenarios).toHaveLength(MAX_SCENARIOS);
    expect(analysis.questionsForCredit).toHaveLength(MAX_QUESTIONS);
    expect(analysis.scenarios[0].evidenceRequired).toHaveLength(MAX_EVIDENCE_ITEMS);
  });
});

describe('the prompt', () => {
  it('gives the model every figure already formatted', () => {
    const prompt = buildAnalysisPrompt(FACTS);
    // Formatted, so the model cannot round differently from the page and cannot
    // reach a figure the document does not contain.
    expect(prompt).toContain('$3,055,219');
    expect(prompt).toContain('Maximum indicative capacity');
  });

  it('names the binding constraint unmistakably', () => {
    const prompt = buildAnalysisPrompt(FACTS);
    expect(prompt).toContain('THIS IS THE BINDING CONSTRAINT');
    expect(prompt).toContain('not binding');
    // "Not run" and "did not bind" are different facts about a facility.
    expect(prompt).toContain('not applicable to this deal');
  });

  it('carries the tenancies, the warnings and what is outstanding', () => {
    const prompt = buildAnalysisPrompt(FACTS);
    expect(prompt).toContain('National Logistics Pty Ltd');
    expect(prompt).toContain('Break-even occupancy is high.');
    expect(prompt).toContain('Signed lease for tenancy two');
  });

  it('omits sections it has no facts for, rather than printing empty headings', () => {
    const bare = buildAnalysisPrompt({ ...FACTS, tenancies: [], warnings: [], outstanding: [] });
    expect(bare).not.toContain('## Tenancies');
    expect(bare).not.toContain('## Risk indicators');
    expect(bare).not.toContain('## Information still outstanding');
  });

  it('tells the model what it must not claim', () => {
    for (const claim of FORBIDDEN_CLAIMS) {
      expect(ANALYSIS_SYSTEM_PROMPT).toContain(claim);
    }
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('Do not compute new ones');
  });
});

describe('the tool schema', () => {
  it('has no numeric field anywhere in it', () => {
    // The structural guarantee behind "no figure in this report comes from the
    // model": it is given no field to put one in. A prompt instruction is a
    // request; this is not.
    const json = JSON.stringify(ANALYSIS_TOOL_SCHEMA);
    expect(json).not.toContain('"number"');
    expect(json).not.toContain('"integer"');
  });

  it('requires all four parts of the section', () => {
    const required = ANALYSIS_TOOL_SCHEMA.function.parameters.required;
    expect([...required].sort())
      .toEqual(['findings', 'interpretation', 'questionsForCredit', 'scenarios']);
  });

  it('bounds the arrays it asks for, in the schema as well as in the parser', () => {
    const props = ANALYSIS_TOOL_SCHEMA.function.parameters.properties;
    expect(props.findings.maxItems).toBe(MAX_FINDINGS);
    expect(props.scenarios.maxItems).toBe(MAX_SCENARIOS);
    expect(props.questionsForCredit.maxItems).toBe(MAX_QUESTIONS);
  });

  it('carries the scenario fields the calculator\'s agent carries', () => {
    // Field-for-field with `commercial-bc-scenario-agent`, so a scenario an
    // adviser saw in the calculator reads identically in the client's document.
    const scenario = ANALYSIS_TOOL_SCHEMA.function.parameters.properties.scenarios.items;
    expect([...scenario.required].sort()).toEqual(
      ['estimatedImpact', 'evidenceRequired', 'executionRisk', 'name', 'reasoning'],
    );
  });
});
