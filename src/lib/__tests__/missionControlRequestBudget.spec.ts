/**
 * Audit item 4 — "Recalculate borrowing capacity" answering
 * "Calculation failed: Request timed out. Please try again."
 *
 * That string is the browser's own abort. `invokeSecureFunction` defaults to
 * 60s and `useBorrowingCapacity` passes no override, so the message means only
 * "the function did not answer in a minute" — it names nothing.
 *
 * What the evidence says. `calculate-borrowing-capacity` does no model call
 * and no third-party call; its nine database reads are `.eq('client_id', …)`
 * on client tables and five of them are already batched into one
 * `Promise.all`. The one place it can wait on somebody else's network is
 * `requireWorkspaceCapability` → `getWorkspaceEntitlements` → `getBalance` →
 * Mission Control. `api_health_log` measures the tail of the same handler
 * (`bc-segment-engine`, identical `no_segments` path): 43-75ms on 15-20
 * August, 238-250ms on 26 August. On that same 26 August a catalog lookup on
 * `compare-investment-reports` was measured at 83s — and the fix for THAT is
 * the comment now sitting above `MC_FETCH_TIMEOUT_MS`, which did not exist
 * until 2026-08-29.
 *
 * So the cause is very likely shared code, it was probably bounded three days
 * after the calculation was tried, and NOTHING pinned the bound. A future edit
 * that drops the abort controller reopens every one of these timeouts at once,
 * in ~300 functions, and the only symptom is a browser message that names no
 * phase. Hence this file.
 *
 * These read the deployed source. They assert the shape of the budget, not a
 * particular number of milliseconds — the value is deliberately tunable by
 * environment variable.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..');
const missionControl = readFileSync(
  join(root, 'supabase', 'functions', '_shared', 'missionControl.ts'),
  'utf8',
);
const engine = readFileSync(
  join(root, 'supabase', 'functions', 'calculate-borrowing-capacity', 'index.ts'),
  'utf8',
);

describe('every Mission Control attempt is bounded', () => {
  it('aborts a single attempt rather than waiting for the socket', () => {
    const raw = missionControl.slice(
      missionControl.indexOf('async function mcFetchRaw'),
      missionControl.indexOf('async function mcFetch('),
    );
    expect(raw).toMatch(/new AbortController\(\)/);
    expect(raw).toMatch(/setTimeout\(\(\) => controller\.abort\(\), MC_FETCH_TIMEOUT_MS\)/);
    // Whatever the ceiling is, the fetch has to be told about it.
    expect(raw).toMatch(/signal,/);
  });

  it('has a finite default, so an unset environment variable cannot unbound it', () => {
    // `Number('')` is NaN and `Number(undefined)` is NaN; both must fall
    // through to the literal rather than to `undefined`, which setTimeout
    // treats as 0 and, worse, which a bare `?? raw` would pass through.
    const decl = missionControl.slice(
      missionControl.indexOf('export const MC_FETCH_TIMEOUT_MS'),
      missionControl.indexOf('function isAbortError'),
    );
    expect(decl).toMatch(/Number\.isFinite\(raw\) && raw > 0 \? raw : \d[\d_]*/);
  });

  it('retries a stalled attempt a bounded number of times', () => {
    // Two attempts at the ceiling has to stay inside the browser's 60s
    // default. An unbounded `while` here would restore the original defect
    // one level up.
    expect(missionControl).toMatch(/for \(let attempt = 0; attempt < 2; attempt\+\+\)/);
  });
});

describe("a caller's own deadline is honoured", () => {
  it('combines the caller signal with the ceiling instead of discarding it', () => {
    // `{ ...init, signal: controller.signal }` silently dropped it: `getBalance`
    // asks for 8s and got the 10s ceiling. Combining can only abort sooner.
    expect(missionControl).toMatch(/AbortSignal\.any\(\[init\.signal, controller\.signal\]\)/);
  });

  it('still bounds a caller that passes no signal', () => {
    expect(missionControl).toMatch(/: controller\.signal;/);
  });

  it('treats a timed-out attempt as a timeout however it was raised', () => {
    // `AbortSignal.timeout` raises TimeoutError, `controller.abort()` raises
    // AbortError. Both have to reach the same branch or a caller-imposed
    // deadline surfaces as an unhandled fetch error.
    expect(missionControl).toMatch(/name === "AbortError" \|\| name === "TimeoutError"/);
  });
});

describe('the borrowing capacity engine records where its time went', () => {
  it('times each phase, so a timeout names one', () => {
    for (const phase of ['auth', 'entitlement', 'reads', 'compute', 'segments', 'save']) {
      expect(engine).toContain(`mark('${phase}')`);
    }
  });

  it('logs the timing on the way out and on the way to a 500', () => {
    expect(engine).toMatch(/timing \$\{timingLine\(\)\}/);
    expect(engine).toMatch(/Error after \$\{timingLine\(\)\}/);
  });

  it('sets the duration header its CORS policy already promised', () => {
    // `x-duration-ms` has been in Access-Control-Expose-Headers all along with
    // nothing ever setting it.
    //
    // Neither pattern below opens with a quote before `x-`, and that is
    // deliberate. `check-cors-contract.mjs` reads any `"x-…":` in a `src/`
    // file that mentions `invokeSecureFunction` as a request header the
    // browser will send — and this file mentions it in a comment. Written the
    // obvious way, the assertion failed the security gate by claiming this
    // file preflights a header it only describes. `x-duration-ms` is a
    // RESPONSE header; it belongs to Access-Control-Expose-Headers, which is
    // exactly what the first line checks.
    expect(engine).toMatch(/"Access-Control-Expose-Headers":[^\n]*x-duration-ms/);
    const sets = engine.match(/x-duration-ms": String\(Date\.now\(\) - t0\)/g) ?? [];
    expect(sets).toHaveLength(2);
  });
});
