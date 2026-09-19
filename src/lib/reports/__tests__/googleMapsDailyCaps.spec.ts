import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  COMMUTE_CAP_REACHED,
  COMMUTE_NO_ROUTE,
} from '@/lib/reports/location/cbdDestination.pure';
import {
  clientMessageFor,
  clientStatusFor,
  consumeGoogleDailyCap,
  dailyCapFor,
  GOOGLE_CAP_ENV_NAMES,
  GOOGLE_CAP_SCOPES,
  type GoogleCapKind,
  type GoogleCapRefusal,
} from '../../../../supabase/functions/_shared/googleMapsDailyCaps.ts';
import {
  measuredCount,
  unavailableCategories,
} from '../../../../supabase/functions/_shared/reports/location/placesAvailability.pure.ts';

const ROOT = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/**
 * Source with comments removed.
 *
 * `rf72b1b0GeocodeRefusal.spec.ts` established the rule these assertions
 * follow: a claim may appear in PROSE — including a comment that quotes the
 * false claim in order to forbid it — and may not appear in CODE.
 */
const codeOnly = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const ALL_KINDS: GoogleCapKind[] = [
  'geocoding', 'placesNearby', 'placesAutocomplete',
  'distanceMatrix', 'streetView', 'staticMaps',
];

/**
 * A `supabase`-shaped double for `security_consume_rate_limit`.
 *
 * `unavailable` returns an error, which is what drives `consumeQuota` onto its
 * per-isolate fallback and sets `degraded`.
 */
function limiter(mode: 'healthy' | 'exhausted' | 'unavailable') {
  const calls: string[] = [];
  return {
    calls,
    rpc: async (_fn: string, args: { p_key: string }) => {
      calls.push(args.p_key);
      if (mode === 'unavailable') return { data: null, error: { message: 'rpc down' } };
      return { data: [{ allowed: mode === 'healthy', retry_after_seconds: 0 }], error: null };
    },
  };
}

const noEnv = () => undefined;

describe('RC-2 — the Maps spending boundary', () => {
  const env = (values: Record<string, string>) => (k: string) => values[k];

  it('has one scope per Google BILLING SKU, not per API family', () => {
    // Nearby Search and Autocomplete are separately priced, so one bucket
    // would let a busy address field spend the allowance a report needs.
    expect(GOOGLE_CAP_SCOPES.placesNearby).not.toBe(GOOGLE_CAP_SCOPES.placesAutocomplete);
    expect(new Set(Object.values(GOOGLE_CAP_SCOPES)).size)
      .toBe(Object.keys(GOOGLE_CAP_SCOPES).length);
  });

  it('uses scopes the rate-limit key regex accepts', () => {
    // `security_consume_rate_limit` RAISES on a key outside this pattern, which
    // would turn a ceiling into a 500 on every request rather than a refusal.
    for (const scope of Object.values(GOOGLE_CAP_SCOPES)) {
      expect(`public:global:${scope}:daily`).toMatch(/^[a-z0-9:_./-]{1,200}$/);
    }
  });

  it('defaults to a zero-paid ceiling for every SKU, never to uncapped', () => {
    for (const kind of ALL_KINDS) {
      const cap = dailyCapFor(kind, noEnv);
      expect(cap).toBeGreaterThan(0);
      expect(cap).toBeLessThanOrEqual(250);
    }
    expect(dailyCapFor('placesNearby', noEnv)).toBe(150);
  });

  it('treats a malformed limit as the default, never as uncapped', () => {
    for (const bad of ['', 'abc', '0', '-5', '12.5', 'NaN']) {
      expect(dailyCapFor('placesNearby', env({ GOOGLE_PLACES_NEARBY_DAILY_LIMIT: bad })))
        .toBe(dailyCapFor('placesNearby', noEnv));
    }
  });

  it('still honours the legacy Places name for autocomplete', () => {
    // Splitting the SKUs must not silently discard a value an operator set.
    expect(dailyCapFor('placesAutocomplete', env({ GOOGLE_PLACES_DAILY_LIMIT: '42' }))).toBe(42);
    // The specific name wins where both are set.
    expect(dailyCapFor('placesAutocomplete', env({
      GOOGLE_PLACES_DAILY_LIMIT: '42',
      GOOGLE_PLACES_AUTOCOMPLETE_DAILY_LIMIT: '7',
    }))).toBe(7);
    // Nearby has no legacy name — it never had a ceiling at all.
    expect(dailyCapFor('placesNearby', env({ GOOGLE_PLACES_DAILY_LIMIT: '42' }))).toBe(150);
  });
});

describe('RC-2 release gate — the four refusal states and the two success states', () => {
  it('limiter healthy → the request is permitted, and one unit is consumed', async () => {
    const db = limiter('healthy');
    const verdict = await consumeGoogleDailyCap(db, 'geocoding', noEnv);
    expect(verdict).toEqual({ ok: true });
    // One consume per call, against the geocoding scope.
    expect(db.calls).toEqual(['public:global:google_geocoding:daily']);
  });

  it('daily allowance exhausted → the paid request is refused', async () => {
    const verdict = await consumeGoogleDailyCap(limiter('exhausted'), 'placesNearby', noEnv);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('daily_cap');
  });

  it('global limiter DEGRADED → the paid request is refused', async () => {
    // The rule this test exists for. `consumeQuota` falls back to a per-isolate
    // counter and answers `ok: true` for the first N requests of EVERY isolate.
    // Edge Functions scale horizontally, so that is not a product-wide ceiling
    // — under the exact fault the ceiling exists for, spend would be unbounded.
    const verdict = await consumeGoogleDailyCap(limiter('unavailable'), 'geocoding', noEnv);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('limiter_unavailable');
    // And it must NOT be reported as an exhausted allowance: they send an
    // operator to opposite remedies.
    expect(verdict.reason).not.toBe('daily_cap');
  });

  it('kill switch active → refused, for the correct internal reason', async () => {
    const verdict = await consumeGoogleDailyCap(
      limiter('healthy'), 'streetView',
      (k) => (k === 'GOOGLE_STREET_VIEW_KILL_SWITCH' ? '1' : undefined),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('kill_switch');
    // A provider somebody turned off and an allowance that ran out are
    // different operational facts and stay distinct.
    expect(verdict.reason).not.toBe('daily_cap');
  });

  it('provider failure → unavailable, not zero', () => {
    const refused = { ok: false, count: 0, results: [] };
    expect(measuredCount(refused)).toBeNull();
  });

  it('a genuine successful zero is RETAINED', () => {
    // A rural address with no hospital within five kilometres is a fact worth
    // printing. Collapsing it with a failure is the defect this guards.
    const reached = { ok: true, count: 0, results: [] };
    expect(measuredCount(reached)).toBe(0);
  });

  it('a successful measurement is retained unchanged', () => {
    expect(measuredCount({ ok: true, count: 7, results: [] })).toBe(7);
  });

  it('names exactly the refused category, not the whole lookup', () => {
    const ok = { ok: true, count: 3, results: [] };
    const refused = { ok: false, count: 0, results: [] };
    expect(unavailableCategories({
      transit: ok, schools: ok, healthcare: refused,
      shopping: ok, recreation: ok, restaurants: ok,
    })).toEqual(['healthcare']);
  });
});

describe('RC-2 — no client-facing output may carry infrastructure wording', () => {
  /** Strings a paying client could read. */
  const CLIENT_FACING = [
    COMMUTE_CAP_REACHED.detail,
    COMMUTE_NO_ROUTE.detail,
    // The geocode refusal is returned in `location-intelligence-service`'s
    // response body, so it is judged the same way.
    (read('supabase/functions/location-intelligence-service/index.ts')
      .match(/geocoder_not_attempted:[\s\S]*?',\n/)?.[0] ?? ''),
  ];

  it('exposes no environment-variable name', () => {
    for (const text of CLIENT_FACING) {
      expect(text).toBeTruthy();
      expect(text).not.toMatch(/GOOGLE_[A-Z_]+/);
      expect(text).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
    }
  });

  it('exposes no infrastructure or vendor plumbing vocabulary', () => {
    for (const text of CLIENT_FACING) {
      expect(text).not.toMatch(/\b(quota|rate limit|rate-limit|API|endpoint|Google|kill switch|env|environment variable)\b/i);
    }
  });

  it('carries no digit — a number in a refusal is a number a report can print', () => {
    expect(COMMUTE_CAP_REACHED.detail).not.toMatch(/\d/);
  });

  it('keeps a ceiling distinct from a measurement', () => {
    // `no_route_returned` is a MEASUREMENT a reader may act on: we asked, and
    // transit does not connect these points. A ceiling means nobody asked.
    expect(COMMUTE_CAP_REACHED.reason).toBe('daily_cap_reached');
    expect(COMMUTE_CAP_REACHED.reason).not.toBe(COMMUTE_NO_ROUTE.reason);
  });
});

describe('RC-2 — every billable production caller is accounted for', () => {
  /**
   * The targeted scan, as an executable assertion rather than a claim in a
   * document. Any file making an outbound Google Maps Platform request must
   * consume the shared allowance — the earlier version of this work asserted
   * "location-intelligence-service is the only uncapped site" and was wrong
   * twice over, because nothing checked it.
   */
  // `_shared/builderStock/images.ts` WAS on this list and is deleted: the
  // Builder Stock image pipeline left with the Builder Portal (network
  // extraction Phase 7), along with the two Edge Functions that dispatched it.
  // It was a real Maps caller — a geocoder and a Street View consumer — and it
  // now makes those calls on the Builders Network, against that deployment's
  // own allowance. Removed here rather than guarded, because a file this scan
  // cannot open is a scan that reports nothing.
  // `parse-property-pdf` and `resolve-listing-coordinates` WERE on this list
  // and are not Maps callers any more: every server-side geocode goes through
  // `_shared/geocode/geocoder.ts` (OpenStreetMap, then the ABS, then Google
  // only where an operator lists it), whose Google provider is the ONE place
  // the Google geocoder is named — and it meters, judges and consumes exactly
  // as the four call sites it replaced did. `location-intelligence-service`
  // stays: its Places Nearby and Distance Matrix calls are still Google's.
  const CALLERS = [
    '_shared/geocode/geocoder.ts',
    'google-places-autocomplete/index.ts',
    'location-intelligence-service/index.ts',
    'school-data-service/index.ts',
    'street-view/index.ts',
  ];

  it('every known caller consumes the shared allowance', () => {
    for (const caller of CALLERS) {
      const src = read(`supabase/functions/${caller}`);
      expect(src, caller).toMatch(/maps\.googleapis\.com\/maps\/api\//);
      expect(src, caller).toContain('consumeGoogleDailyCap');
    }
  });

  it('no caller still spends a paid Maps request on the raw abuse-control quota', () => {
    // `enforceGlobalDailyQuota` does not fail closed, so a Maps call site that
    // still used it directly would have a ceiling that evaporates under the
    // exact fault it exists for.
    for (const caller of CALLERS) {
      expect(read(`supabase/functions/${caller}`), caller)
        .not.toMatch(/enforceGlobalDailyQuota\s*\(/);
    }
  });

  it('ONE product-wide Geocoding budget across every geocoding caller', () => {
    // Google bills every geocode in this deployment together. A per-function
    // bucket would make GOOGLE_GEOCODING_DAILY_LIMIT mean "N times however many
    // functions happen to geocode", which is not a ceiling anybody can reason
    // about — and it is the "configure N/2" workaround this replaces.
    //
    // There is ONE Google geocoder now, inside the chain, and it consumes the
    // one scope. The four functions that used to geocode directly ask the
    // chain and name no Google geocoder at all — which is what makes the
    // budget one thing rather than four copies of one thing.
    const chain = read('supabase/functions/_shared/geocode/geocoder.ts');
    expect(chain).toMatch(/maps\.googleapis\.com\/maps\/api\/geocode/);
    expect(chain).toContain("consumeGoogleDailyCap(supabase, 'geocoding')");
    for (const caller of [
      'estimate-capital-growth/index.ts',
      'location-intelligence-service/index.ts',
      'parse-property-pdf/index.ts',
      'resolve-listing-coordinates/index.ts',
    ]) {
      const src = read(`supabase/functions/${caller}`);
      expect(src, caller).not.toMatch(/maps\.googleapis\.com\/maps\/api\/geocode/);
      expect(src, caller).toContain('_shared/geocode/geocoder.ts');
    }
    expect(GOOGLE_CAP_SCOPES.geocoding).toBe('google_geocoding');
  });

  it('a circuit-breaker scope is a different axis and survives', () => {
    // A breaker is about one caller's error rate; a budget is about the
    // account's spend (or a public service's goodwill). Collapsing them would
    // make one ceiling trip the other. The scope no longer names Google
    // because the chain behind it no longer does.
    expect(read('supabase/functions/resolve-listing-coordinates/index.ts'))
      .toContain("CIRCUIT_SCOPE = 'listing_geocoding'");
  });

  it('every ceiling the runtime reads is declared in the Integrations registry', () => {
    // A spending limit that exists only in code is configuration an operator
    // cannot see, which is how a ceiling goes unset for a year.
    const registry = read('src/lib/integrations/registry.ts');
    const allowlist = read('supabase/functions/_shared/integrationSecrets.ts');
    for (const name of GOOGLE_CAP_ENV_NAMES) {
      if (name.endsWith('_KILL_SWITCH')) continue; // an incident control, not a setting
      expect(registry, name).toContain(name);
      expect(allowlist, name).toContain(name);
    }
  });
});

describe('RC-2 — a refusal is reported for what it actually was', () => {
  const ALL_REASONS: GoogleCapRefusal[] = ['kill_switch', 'daily_cap', 'limiter_unavailable'];

  it('calls it an exhausted quota ONLY when the allowance is genuinely spent', () => {
    // "Daily quota exceeded" tells an operator to wait until tomorrow. That is
    // true of exactly one of the three, and waiting clears neither of the
    // others — a provider somebody switched off stays off, and a counter that
    // cannot be read stays unreadable.
    expect(clientStatusFor('daily_cap')).toBe('daily_quota_exceeded');
    expect(clientStatusFor('kill_switch')).toBe('temporarily_unavailable');
    expect(clientStatusFor('limiter_unavailable')).toBe('temporarily_unavailable');
    // An unknown or absent reason takes the neutral reading, never the
    // specific claim.
    expect(clientStatusFor(undefined)).toBe('temporarily_unavailable');
  });

  it('says the same thing in prose, for a status a person will read', () => {
    expect(clientMessageFor('daily_cap')).toMatch(/allowance/i);
    for (const reason of ['kill_switch', 'limiter_unavailable'] as GoogleCapRefusal[]) {
      expect(clientMessageFor(reason)).not.toMatch(/daily|allowance|limit|quota/i);
    }
  });

  it('never leaks configuration or infrastructure vocabulary in either form', () => {
    for (const reason of [...ALL_REASONS, undefined]) {
      const text = clientMessageFor(reason);
      expect(text).not.toMatch(/GOOGLE_[A-Z_]+/);
      expect(text).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
      expect(text).not.toMatch(/\b(Google|Maps|API|endpoint|kill switch|rate.?limit|env)\b/i);
      expect(text).not.toMatch(/\d/);
    }
  });

  it('no caller flattens all three refusals into an exhausted-quota claim', () => {
    // The defect this replaces: `street-view` and `google-places-autocomplete`
    // answered `daily_quota_exceeded` for every refusal, and
    // `builderStock/images.ts` PERSISTED "the daily limit ... has been reached"
    // onto the row, where it outlives the incident. That third file is gone
    // with the Builder Portal; the rule it taught is kept here, and travels
    // with the pipeline to the network's own copy of this suite.
    const callers = [
      'supabase/functions/google-places-autocomplete/index.ts',
      'supabase/functions/street-view/index.ts',
    ];
    for (const caller of callers) {
      const code = codeOnly(read(caller));
      // The claim may only be made through the shared mapping...
      expect(code, caller).toMatch(/clientStatusFor|clientMessageFor/);
      // ...never spelled at the call site, in either form.
      expect(code, caller).not.toMatch(/'daily_quota_exceeded'/);
      expect(code, caller).not.toMatch(/daily limit .{0,40}reached/i);
    }
  });

  it("the geocoder's own state is named for what happened, not for one cause", () => {
    // The reason CODE is returned in the response body, so it has to be true
    // for all three refusals. `geocoder_daily_cap_reached` was true for one.
    const src = read('supabase/functions/location-intelligence-service/index.ts');
    expect(src).not.toContain('geocoder_daily_cap_reached');
    expect(src).toContain('geocoder_not_attempted');
    // And the exact reason still travels, so the diagnostic record is true
    // even though the client-facing reading deliberately is not that specific.
    expect(src).toMatch(/capReason\??:\s*GoogleCapRefusal/);
    expect(src).toContain('capReason: budget.reason');
  });
});
