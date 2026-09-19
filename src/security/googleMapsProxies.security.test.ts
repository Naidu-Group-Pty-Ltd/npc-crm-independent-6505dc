import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Repo-relative, like `ModuleGuard.security.test.ts` and the AML contracts.
 *
 * This was `new URL('./<name>/index.ts', import.meta.url)`, and under this
 * Vitest `import.meta.url` is not a file-scheme URL — `readFileSync` resolved
 * it to the literal path `src/security/undefined` and both tests failed with
 * ENOENT. They were not checking the two proxies at all; they were checking
 * that a path did not exist. The handlers were never under `src/security/`
 * either, which the URL form quietly implied.
 */
const readHandler = (name: string) => readFileSync(
  join(process.cwd(), 'supabase', 'functions', name, 'index.ts'),
  'utf8',
);

/**
 * What every Google Maps proxy owes, and what only one of them does.
 *
 * This asserted `enforceActorQuota` and `enforceIpQuota` on BOTH handlers.
 * `resolve-listing-coordinates` deliberately has neither, and says so at the
 * call site: "Per-request actor/IP throttles caused normal map pagination to
 * lock itself out and, worse, discarded cache hits with a blanket 429.
 * Provider spend remains bounded by the global daily quota, the per-request
 * lookup cap, and the circuit breaker below."
 *
 * That decision is recorded in the code and the test simply predated it — the
 * file has been unrunnable since the path bug above, so nothing reconciled
 * them. Asserting the throttle back would reintroduce the lockout; deleting
 * the whole case would drop the controls that ARE shared. So the shared floor
 * is asserted for both, and the per-actor throttle is asserted only where it
 * belongs — with `resolve-listing-coordinates` asserted NOT to have it, so its
 * removal stays deliberate rather than becoming an accident nobody notices.
 */
/**
 * The controls both handlers keep at the call site. The daily allowance and
 * the bounded fetch moved: `resolve-listing-coordinates` no longer names a
 * vendor at all — it asks the geocoding chain (`_shared/geocode/geocoder.ts`,
 * OpenStreetMap then the ABS then Google only where an operator lists it),
 * which holds the fetch timeout and the allowances for every geocode in the
 * product — and `street-view` consumes the Google cap rather than the raw
 * abuse-control quota (RC-2: the raw quota does not fail closed).
 */
const SHARED_CONTROLS = [
  'provider_circuit_is_open',
  'provider_circuit_record_failure',
  'provider_circuit_record_success',
  'killSwitchActive',
] as const;

/** Where each handler spends, and what it spends through. */
const SPEND = {
  'resolve-listing-coordinates': { call: 'geocodeAddress(', control: "from '../_shared/geocode/geocoder.ts'" },
  'street-view': { call: 'maps.googleapis.com', control: 'consumeGoogleDailyCap' },
} as const;

describe('Google Maps proxy security controls', () => {
  for (const functionName of ['resolve-listing-coordinates', 'street-view'] as const) {
    it(`${functionName} authorizes before it spends, and bounds the spend`, () => {
      const source = readHandler(functionName);
      const authorization = source.indexOf("requireModulePermission(supabase, { userId, authMethod }, 'listings', 'can_view')");
      const providerCall = source.indexOf(SPEND[functionName].call);

      expect(authorization).toBeGreaterThan(-1);
      expect(providerCall).toBeGreaterThan(authorization);
      expect(source).toContain(SPEND[functionName].control);
      for (const control of SHARED_CONTROLS) {
        expect(source, `${functionName} must keep ${control}`).toContain(control);
      }
    });
  }

  it('the geocoding chain bounds every geocode: a timeout on every fetch and a fail-closed allowance per provider', () => {
    const chain = readFileSync(join(process.cwd(), 'supabase', 'functions', '_shared', 'geocode', 'geocoder.ts'), 'utf8');
    for (const control of ['fetchWithTimeout', 'consumeOsmDailyAllowance', 'consumeGoogleDailyCap']) {
      expect(chain, `the chain must keep ${control}`).toContain(control);
    }
    expect(chain).not.toMatch(/enforceGlobalDailyQuota\s*\(/);
  });

  it('throttles street-view per actor and per IP', () => {
    const source = readHandler('street-view');
    expect(source).toContain('enforceActorQuota');
    expect(source).toContain('enforceIpQuota');
  });

  it('keeps the per-request throttles off the paginating endpoint, on purpose', () => {
    const source = readHandler('resolve-listing-coordinates');
    expect(source).not.toContain('enforceActorQuota(');
    expect(source).not.toContain('enforceIpQuota(');
    // The reason has to survive with the absence, or the next reader restores
    // the throttle and the map locks itself out again.
    // Matched on one line: the sentence wraps in the source.
    expect(source).toMatch(/actor\/IP throttles caused normal map/);
  });
});
