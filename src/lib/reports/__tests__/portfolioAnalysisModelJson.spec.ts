import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readModelJson } from '../../../../supabase/functions/_shared/llmJson.pure';

const ROOT = resolve(__dirname, '../../../..');
const FN = readFileSync(
  resolve(ROOT, 'supabase/functions/generate-portfolio-analysis/index.ts'),
  'utf8',
);

/**
 * The failure arm, named explicitly.
 *
 * `ModelJsonRead` is a discriminated union, which narrows correctly under
 * Deno's strict settings — where the edge function actually compiles. The app
 * project sets `strictNullChecks: false`, and a boolean discriminant does not
 * narrow there, so the union stays (it is the right type for its consumer) and
 * the test says which arm it is asserting about.
 */
function failure(read: ReturnType<typeof readModelJson>) {
  expect(read.ok).toBe(false);
  return read as Extract<ReturnType<typeof readModelJson>, { ok: false }>;
}

describe('reading a model JSON answer', () => {
  it('reads a bare object', () => {
    const r = readModelJson<{ a: number }>('{"a":1}', 'stop');
    expect(r.ok && r.value.a).toBe(1);
  });

  it('reads a fenced object', () => {
    const r = readModelJson<{ a: number }>('```json\n{"a":1}\n```', 'stop');
    expect(r.ok && r.value.a).toBe(1);
  });

  it('reads a fence that was never closed', () => {
    // The exact shape production produced. The old regex needed a closing
    // fence, so this fell through to a raw `JSON.parse` on the backtick.
    const r = readModelJson<{ a: number }>('```json\n{"a":1}', 'stop');
    expect(r.ok && r.value.a).toBe(1);
  });

  it('reads an answer with prose in front of it', () => {
    const r = readModelJson<{ a: number }>('Here is the analysis:\n{"a":1}', 'stop');
    expect(r.ok && r.value.a).toBe(1);
  });

  it('calls a cut-off answer TRUNCATED, not malformed', () => {
    // Verbatim from the production log at 2026-09-01T02:13:01Z.
    const cut = '```json\n{\n  "summary": "Hello Arvin, your portfolio is in an '
      + 'exceptionally strong financial position. With substantial equity, a very low '
      + 'loan-to-value ratio, and healthy positive cash flow';
    const r = failure(readModelJson(cut, 'length'));
    expect(r.reason).toBe('truncated');
    // The message has to name the remedy: retrying stops at the same place.
    expect(r.message).toMatch(/budget/i);
  });

  it('a cut-off answer with no finish reason is only "not JSON"', () => {
    // Never claim truncation without the evidence for it.
    expect(failure(readModelJson('```json\n{"a":', 'stop')).reason).toBe('not_json');
  });

  it('an empty answer is its own reading', () => {
    expect(failure(readModelJson('   ', 'stop')).reason).toBe('empty');
  });

  it('a COMPLETE object is accepted even when the model kept going after it', () => {
    // Parsing decides; `finish_reason` only ever explains a failure. A
    // top-level object that closed is whole whatever the model did next.
    const r = readModelJson<{ a: number }>('{"a":1}\nand then some more prose', 'length');
    expect(r.ok && r.value.a).toBe(1);
  });
});

describe('generate-portfolio-analysis parses through the shared reader', () => {
  const code = FN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('has no hand-rolled fence regex left in either branch', () => {
    // Two call sites each wrote their own, and both were wrong in a different
    // way. One implementation, imported.
    expect(code).not.toMatch(/match\(\/```/);
    expect(code).toContain('readModelJson');
  });

  it('never calls JSON.parse on a model response again', () => {
    expect(code).not.toMatch(/JSON\.parse\(\s*(?:jsonString|analysisText|insightsText|braced)/);
  });

  it('asks for JSON as JSON on both calls, through one caller', () => {
    // Both branches go through `callForJson`, which adds `response_format` and
    // — this is the part that matters — DROPS it if the provider answers a 4xx
    // naming the field. `compare-investment-reports` built that rule after the
    // same lesson; it is imported rather than restated.
    expect((code.match(/await callForJson\(/g) ?? []).length).toBe(2);
    expect(code).toContain("responseFormat: { type: 'json_object' }");
    expect(code).toContain('rungRejected');
    // A capacity or credit failure must NOT be read as a format refusal, which
    // is exactly what `rungRejected` refuses to do — so neither branch may
    // decide that for itself.
    expect(code).not.toMatch(/status === 429[\s\S]{0,80}responseFormat/);
  });

  it('gives a reasoning model room for reasoning AND an answer', () => {
    // Production spent 1,196 of 1,200 and 7,996 of 8,000 — four short of the
    // ceiling on every single run.
    const budgets = [...code.matchAll(/maxTokens: (\d+)/g)].map((m) => Number(m[1]));
    expect(budgets.length).toBe(2);
    for (const budget of budgets) expect(budget).toBeGreaterThan(1200);
    expect(Math.max(...budgets)).toBeGreaterThan(8000);
  });

  it('reports a model failure as a gateway fault, not the function crashing', () => {
    // A 500 reads as "this product is broken"; the model running out of room
    // is an upstream answer this function correctly refused to use.
    expect(code).toMatch(/status: 502/);
  });

  it('the wall clock allows for the larger answer', () => {
    const config = readFileSync(resolve(ROOT, 'supabase/config.toml'), 'utf8');
    const block = config.slice(config.indexOf('[functions.generate-portfolio-analysis]'));
    const timeout = Number(/request_timeout = (\d+)/.exec(block)?.[1] ?? 0);
    expect(timeout).toBeGreaterThanOrEqual(240);
  });
});
