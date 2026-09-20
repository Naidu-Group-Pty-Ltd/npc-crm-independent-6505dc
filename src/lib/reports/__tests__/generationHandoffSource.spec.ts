/**
 * Two rules that live in the generator's own source, asserted there.
 *
 * Both are about writes to `investment_reports`, and neither can be reached
 * from a unit test without standing up an edge runtime and a database. They are
 * checked by reading the source for the same reason `finalRendererOnEveryFormat`
 * and `neverAPlaceholder` do: the property is structural, and a regression here
 * is silent in production for as long as it takes somebody to notice a report
 * that never finishes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const GENERATOR = resolve(
  __dirname,
  '../../../../supabase/functions/generate-investment-report/index.ts',
);
const source = readFileSync(GENERATOR, 'utf8');

describe('the budget hand-off', () => {
  it('writes the row only when the invocation banked something durable', () => {
    // `investment_reports` carries a BEFORE UPDATE trigger that stamps
    // `updated_at` on ANY write, and the watchdog claims on
    // `updated_at < now() - interval '2 minutes'`. A write with nothing new in
    // it refreshes that clock and blinds the stall detector — which is exactly
    // what hid the 18 Annabelle Crescent run for 21 minutes.
    expect(source).toContain('mayTouchRow(progress)');
    // And it must classify progress BEFORE deciding, not infer it afterwards.
    expect(source).toContain('classifyProgress({');
    expect(source).toContain('sectionsWrittenThisRun: sectionDurationsMs.length');
  });

  it('reports a no-progress hand-off as an explicit state', () => {
    expect(source).toContain('durableProgress: handoff.durableProgress');
    expect(source).toContain('noProgressReason');
  });

  it('never revives a run the operator stopped', () => {
    // A run already in flight when Stop is pressed lands its write afterwards.
    // The watchdog claims exactly `status = 'processing'`, so re-writing that
    // over a cancellation resurrects work a person explicitly stopped.
    const handoffWrite = source.slice(source.indexOf('=== BUDGET HANDOFF ==='));
    expect(handoffWrite).toContain(".in('status', ['pending', 'processing'])");
  });
});

describe('the generator imports only names its shared modules actually export', () => {
  /**
   * The gate that caught this in CI is `check-edge-functions.mjs`, which needs
   * Deno and so cannot run in the authoring environment. A stale named import
   * survived `esbuild --external:*` (it resolves nothing) and reached CI as
   * TS2305 — "has no exported member" — which is fatal at load, not type debt.
   *
   * This is the same check, cheap enough to run locally, over the imports most
   * likely to drift: the generator's own shared investment modules.
   */
  const importBlock = source.slice(0, source.indexOf('\n\nconst '));
  const IMPORT_RE =
    /import\s*\{([^}]+)\}\s*from\s*'(\.\.\/_shared\/reports\/investment\/[^']+)'/g;

  const imports = [...importBlock.matchAll(IMPORT_RE)].map(([, names, path]) => ({
    path,
    names: names
      .split(',')
      .map((n) => n.trim().replace(/^type\s+/, ''))
      .filter(Boolean),
  }));

  it('imports at least the modules this work added', () => {
    expect(imports.length).toBeGreaterThan(0);
  });

  it.each(imports.map((i) => [i.path, i.names] as const))(
    '%s exports every name the generator asks it for',
    (path, names) => {
      const modulePath = resolve(
        __dirname,
        '../../../../supabase/functions/generate-investment-report',
        path,
      );
      const moduleSource = readFileSync(modulePath, 'utf8');
      for (const name of names) {
        const exported = new RegExp(
          `export\\s+(?:async\\s+)?(?:function|const|type|interface|class|enum)\\s+${name}\\b`,
        ).test(moduleSource);
        expect(exported, `${path} does not export ${name}`).toBe(true);
      }
    },
  );
});

describe('every acquisition call is bounded by the run clock', () => {
  /**
   * Derived, not listed.
   *
   * The first version of this test named six services by hand and passed while
   * FOURTEEN other acquisition calls still carried their own fixed ceilings —
   * 290 seconds of timeout allowance inside a run whose hard stop is 125. A
   * hand-list cannot see the call it does not mention, which is the whole
   * failure mode, so the assertion reads the source instead.
   */
  // Any identifier applied to an internal service URL, awaited or not — the
  // wave starts four of them inside a ternary, with the `await` far below.
  const SERVICE_CALL =
    /(\w+)\(`\$\{(?:supabaseUrl|Deno\.env\.get\('SUPABASE_URL'\))\}\/functions\/v1\/([^`]+)`/g;

  const calls = [...source.matchAll(SERVICE_CALL)].map(([, wrapper, service]) => ({
    wrapper,
    service: service.replace(/\$\{.*/, '${…}'),
  }));

  it('finds the acquisition calls at all', () => {
    // A regex that matches nothing passes every assertion under it.
    expect(calls.length).toBeGreaterThanOrEqual(20);
  });

  it.each(calls.map((c, i) => [`${i}:${c.service}`, c.wrapper] as const))(
    '%s goes through the bounded wrapper',
    (_label, wrapper) => {
      // A bare `fetch` has no AbortSignal at all; `fetchWithTimeout` has a
      // constant that knows nothing about how much of the invocation is left.
      // Both are how one slow provider consumes a run that must also write
      // fifteen sections.
      expect(['acquisitionFetch', 'startAcquisition']).toContain(wrapper);
    },
  );

  it('leaves no `fetchWithTimeout` pointed at an internal service', () => {
    expect(source).not.toMatch(/fetchWithTimeout\(`\$\{supabaseUrl\}\/functions\/v1\//);
    expect(source).not.toMatch(
      /fetchWithTimeout\(`\$\{Deno\.env\.get\('SUPABASE_URL'\)\}\/functions\/v1\//,
    );
  });

  it('refuses to start a call with no window rather than calling it anyway', () => {
    expect(source).toContain('acquisitionWindowMs(acquisitionBudgetFor(ceiling))');
    expect(source).toContain('NO_WINDOW_STATUS');
  });

  it('reserves room for the section loop and for persisting the checkpoint', () => {
    expect(source).toContain('sectionReserveMs: SECTION_MIN_CALL_WINDOW_MS');
    expect(source).toContain('checkpointReserveMs: ACQUISITION_CHECKPOINT_RESERVE_MS');
  });

  it('never lets a non-answer be recorded as "the provider holds nothing"', () => {
    // `fetchServiceWithFallback` turns a null into "No data returned", which the
    // acquisition ledger maps to `unavailable_in_coverage` — a statement about
    // the property. An HTTP error, and a call with no window that was never
    // made, are not entitled to make it.
    expect(source).toContain('assertAcquisitionAnswered');
    const phase1 = source.slice(
      source.indexOf('PHASE 1: PARALLEL INDEPENDENT DATA FETCHING'),
      source.indexOf('PHASE 2: SEQUENTIAL DEPENDENT DATA FETCHING'),
    );
    const wrapped = phase1.match(/await acquisitionFetch\(/g) ?? [];
    const guarded = phase1.match(/assertAcquisitionAnswered\(/g) ?? [];
    expect(guarded.length).toBe(wrapped.length);
    expect(wrapped.length).toBeGreaterThan(0);
  });
});

describe('the four geography-dependent registers are one wave', () => {
  /**
   * Planning, climate, regional trends and Domain depend on the resolved
   * geography and on nothing else, and were awaited in series — 45 + 40 + 30 +
   * 30 seconds of ceiling inside a 125s run. Starting them together costs the
   * slowest instead of the sum.
   *
   * What is asserted is the SHAPE: every one of the four is started before any
   * of them is awaited. Ordering of the answers is deliberately not asserted,
   * because each is still read and bound exactly where it was.
   */
  const REQUESTS = ['planningRequest', 'climateRequest', 'regionalRequest', 'domainRequest'];

  it.each(REQUESTS)('%s is started, then awaited later', (name) => {
    const started = source.indexOf(`const ${name} = (`);
    const awaited = source.indexOf(`await ${name}`);
    expect(started, `${name} is never started`).toBeGreaterThan(-1);
    expect(awaited, `${name} is never awaited`).toBeGreaterThan(-1);
    expect(awaited).toBeGreaterThan(started);
  });

  it('starts all four before it awaits any of them', () => {
    const lastStart = Math.max(...REQUESTS.map((n) => source.indexOf(`const ${n} = (`)));
    const firstAwait = Math.min(...REQUESTS.map((n) => source.indexOf(`await ${n}`)));
    expect(firstAwait).toBeGreaterThan(lastStart);
  });

  it('keeps the QLD crime re-key behind planning, because it reads planning\'s answer', () => {
    // It is keyed on `planningData.parcel.lga` — the cadastre's own LGA. A
    // dependency is not made concurrent by wishing.
    const crimeRekey = source.indexOf("state === 'QLD' && qldLga");
    const planningAwait = source.indexOf('await planningRequest');
    expect(crimeRekey).toBeGreaterThan(planningAwait);
    expect(source).not.toContain('const crimeRekeyRequest');
  });

  it('marks every started request handled so an early rejection cannot kill the isolate', () => {
    // Deno treats an unhandled rejection as fatal, and a request started before
    // anything awaits it can reject first. The no-op catch swallows nothing:
    // the call site awaits the original promise.
    const starter = source.slice(
      source.indexOf('const startAcquisition = ('),
      source.indexOf('const assertAcquisitionAnswered'),
    );
    expect(starter).toContain('pending.catch(() => {});');
    expect(starter).toContain('return pending;');
  });
});


describe('the research phase is timed', () => {
  /**
   * `traceStartRun` is called AFTER the acquisition block, so
   * `report_generation_runs` has never once included acquisition in its own
   * clock — which is why "21 minutes at 0 of 15" could not be attributed to
   * anything from the record. The only phase that could have consumed the
   * invocation was the one phase nothing timed.
   */
  it('measures the phase from the run clock, at its close', () => {
    const measured = source.indexOf('const acquisitionMs = Date.now() - runStartedAt;');
    const traceStart = source.indexOf('await traceStartRun(');
    expect(measured).toBeGreaterThan(-1);
    // It has to be taken BEFORE the trace starts, or it measures nothing new.
    expect(measured).toBeLessThan(traceStart);
  });

  it('hands the figure back, so measuring needs no edge-log access', () => {
    const handoff = source.slice(source.indexOf('=== BUDGET HANDOFF ==='));
    expect(handoff).toContain('acquisitionMs,');
    expect(handoff).toContain('sectionMsThisRun: sectionDurationsMs,');
  });

  it('says when calls were deferred, and that a deferral is not an absence', () => {
    expect(source).toContain('SOME CALLS DEFERRED for want of a window');
    expect(source).toContain('not recorded as absences');
  });
});
