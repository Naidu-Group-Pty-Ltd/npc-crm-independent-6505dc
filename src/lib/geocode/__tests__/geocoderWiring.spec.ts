/**
 * Geocoding without Google — the wiring, asserted.
 *
 * Google's Geocoding API refused every request from 12 September 2026 and the
 * owner's decision was that the product must not depend on Google's console
 * or its charges. So every server-side geocode goes through ONE chain
 * (`_shared/geocode/geocoder.ts`: OpenStreetMap's Nominatim, then the
 * suburb's own centroid from the ABS boundary server, then Google only where
 * an operator lists it), the address field suggests from OpenStreetMap's
 * Photon, and a cache stands in front of all of it. These tests pin the
 * rules that make that safe rather than the bytes that implement them.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_ORDER,
  geocodeCacheKey,
  parseProviderOrder,
  precisionLabel,
} from '../geocodeResult.pure';

const ROOT = join(__dirname, '..', '..', '..', '..');
const FUNCTIONS = join(ROOT, 'supabase', 'functions');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
/**
 * Source with its comments removed. A URL carries `//` too, so a line comment
 * is recognised only at the start of a line or after whitespace — the
 * one-regex version stripped `https://maps.googleapis.com/…` out of the very
 * call it was meant to find, and reported an empty list as proof.
 */
const codeOnly = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');

const CHAIN = read('supabase', 'functions', '_shared', 'geocode', 'geocoder.ts');
const ALLOWANCE = read('supabase', 'functions', '_shared', 'geocode', 'osmAllowance.ts');
const AUTOCOMPLETE = read('supabase', 'functions', 'google-places-autocomplete', 'index.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('one geocoder', () => {
  it('no edge function names the Google geocoder except the chain', () => {
    // The whole point: a second call site is a second key, a second budget
    // and a second way for the product to go dark when a console setting
    // changes. Judged on code, because prose records what used to be there.
    const offenders = walk(FUNCTIONS)
      .filter((f) => codeOnly(readFileSync(f, 'utf8')).includes('maps.googleapis.com/maps/api/geocode'))
      .map((f) => relative(FUNCTIONS, f).split('\\').join('/'));
    expect(offenders).toEqual(['_shared/geocode/geocoder.ts']);
  });

  it('every former direct geocoder asks the chain', () => {
    for (const fn of ['estimate-capital-growth', 'location-intelligence-service', 'parse-property-pdf', 'resolve-listing-coordinates']) {
      expect(read('supabase', 'functions', fn, 'index.ts'), fn).toContain('_shared/geocode/geocoder.ts');
    }
  });

  it('the default order names no Google, and an operator adds it by name', () => {
    expect(DEFAULT_PROVIDER_ORDER).not.toContain('google');
    expect(parseProviderOrder(undefined)).toEqual([...DEFAULT_PROVIDER_ORDER]);
    expect(parseProviderOrder('')).toEqual([...DEFAULT_PROVIDER_ORDER]);
    expect(parseProviderOrder('nominatim, google')).toEqual(['nominatim', 'google']);
    expect(parseProviderOrder('google,google,nominatim')).toEqual(['google', 'nominatim']);
    // A misspelt setting is the default, never "no providers": a typo must
    // not switch every geocode off silently.
    expect(parseProviderOrder('bing')).toEqual([...DEFAULT_PROVIDER_ORDER]);
  });

  it('every provider is judged by the one granularity gate before it is an answer', () => {
    // The centre-of-the-continent sentinel and "matched the state, not the
    // address" were Google's failure modes; OpenStreetMap has the same ones.
    expect(CHAIN).toContain('assessGeocodeGranularity(result.lat, result.lng, result.types)');
    for (const provider of ['askNominatim', 'askPhoton', 'askAbsLocality', 'askGoogle']) {
      const start = CHAIN.indexOf(`async function ${provider}(`);
      const end = CHAIN.indexOf('\n}', start);
      expect(CHAIN.slice(start, end), provider).toContain('return gated(');
    }
  });
});

describe('what the free providers never do', () => {
  it('spend a credential: only the Google call is metered', () => {
    // `meteredFetch` exists to attach a bill to a key. Nominatim, Photon and
    // the ABS spend none, so they are fetched plainly — through the bounded
    // fetch, never the raw one.
    expect(CHAIN.split('meteredFetch(').length - 1).toBe(1);
    expect(CHAIN).toMatch(/meteredFetch\(`https:\/\/maps\.googleapis\.com\/maps\/api\/geocode/);
    expect(CHAIN.split('fetchWithTimeout(').length - 1).toBeGreaterThanOrEqual(3);
    expect(codeOnly(CHAIN)).not.toMatch(/\bawait fetch\(/);
  });

  it('get billed to a tenant: the billing map lists them as never metered', () => {
    const billing = read('supabase', 'functions', '_shared', 'apiUsageBilling.pure.ts');
    for (const host of ['openstreetmap.org', 'komoot.io', 'abs.gov.au']) {
      expect(billing, host).toContain(`"${host}"`);
    }
  });

  it('touch the raw abuse-control quota from a Maps caller: the allowance is one module, and it fails closed', () => {
    expect(ALLOWANCE).toContain('enforceGlobalDailyQuota(');
    expect(CHAIN).not.toMatch(/enforceGlobalDailyQuota\s*\(/);
    expect(AUTOCOMPLETE).not.toMatch(/enforceGlobalDailyQuota\s*\(/);
    // `degraded` is read BEFORE `ok`: the per-isolate fallback answers `ok`
    // for the first N requests of every isolate, which is no ceiling at all.
    const consume = ALLOWANCE.slice(ALLOWANCE.indexOf('export async function consumeOsmDailyAllowance'));
    expect(consume.indexOf('.degraded')).toBeGreaterThan(-1);
    expect(consume.indexOf('.degraded')).toBeLessThan(consume.indexOf('verdict.ok ?'));
  });

  it('identify a person: the User-Agent names the product and carries no address', () => {
    const ua = CHAIN.match(/GEOCODER_USER_AGENT = '([^']+)'/)?.[1] ?? '';
    expect(ua).toMatch(/^npc-property-dashboard\/\d/);
    expect(ua).not.toContain('@');
  });

  it('hold the line in one isolate only: the turn is taken in the shared limiter', () => {
    // Nominatim's absolute maximum is one request a second from one
    // application. Edge Functions scale horizontally, so a per-isolate pause
    // alone is not that; the shared limiter is asked for the turn.
    expect(CHAIN).toContain('await awaitOsmTurn(supabase)');
    expect(ALLOWANCE).toContain('enforceKeyQuota(supabase, key, OSM_TURN_SCOPE, { limit: 1, windowMs: OSM_TURN_WINDOW_MS })');
  });
});

describe('the cache', () => {
  const migration = read('supabase', 'migrations', '20261128090000_geocode_cache.sql');

  it('is service-role only: RLS on, no policy, the touch closed to every client role', () => {
    expect(migration).toContain('alter table public.geocode_cache enable row level security;');
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).toContain('grant execute on function public.geocode_cache_touch(text) to service_role;');
    expect(migration).not.toMatch(/grant .* to (anon|authenticated)/i);

    // The revoke this migration wrote — `from public` — SUCCEEDED and did not
    // close the function: measured on the live catalogue minutes after it
    // applied, the ACL read `anon=X | authenticated=X` with no PUBLIC entry,
    // because this project's default privileges grant both roles EXECUTE on a
    // new function directly. 20261129090000 is the revoke that closes it, and
    // the rule asserted here is the EFFECTIVE one: somewhere in the corpus,
    // all three roles are revoked.
    const lock = read('supabase', 'migrations', '20261129090000_lock_secdef_functions_to_service_role.sql');
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(lock, role).toMatch(
        new RegExp(`revoke all on function public\\.geocode_cache_touch\\(text\\) from [^;]*\\b${role}\\b`, 'i'),
      );
    }
  });

  it('is read before any provider and written after the answer', () => {
    const body = CHAIN.slice(CHAIN.indexOf('export async function geocodeAddress('));
    expect(body.indexOf('await readCache(')).toBeGreaterThan(-1);
    expect(body.indexOf('await readCache(')).toBeLessThan(body.indexOf('askNominatim('));
    expect(body).toContain('await writeCache(');
  });

  it('keys one question one way, and refuses to guess that two spellings are one', () => {
    expect(geocodeCacheKey({ address: '10 Leakes Rd, Truganina VIC 3029' }))
      .toBe(geocodeCacheKey({ address: '10 leakes rd  truganina vic 3029' }));
    expect(geocodeCacheKey({ address: '10 Leakes Rd, Truganina' }))
      .not.toBe(geocodeCacheKey({ address: '10 Leakes Road, Truganina' }));
    expect(geocodeCacheKey({ address: '10 Leakes Rd', suburb: 'Truganina', state: 'VIC', postcode: '3029' }))
      .toBe('au:10 leakes rd truganina vic 3029');
  });
});

describe('what a pin says', () => {
  it("keeps Google's vocabulary for Google and qualifies every other provider", () => {
    // `listing_geocodes.precision` is read by the map; nothing that reads
    // Google's words changes, and every other provider is legible by suffix.
    expect(precisionLabel({ provider: 'google', precision: 'address', providerPrecision: 'ROOFTOP' })).toBe('ROOFTOP');
    expect(precisionLabel({ provider: 'nominatim', precision: 'street', providerPrecision: 'road' })).toBe('nominatim:street');
    expect(precisionLabel({ provider: 'abs_locality', precision: 'locality', providerPrecision: 'SAL 21234' })).toBe('abs_locality:locality');
  });

  it('records which provider placed the listing', () => {
    const resolver = read('supabase', 'functions', 'resolve-listing-coordinates', 'index.ts');
    expect(resolver).toContain('provider: found.provider,');
    expect(resolver).not.toContain("provider: 'google'");
  });
});

describe('the address field', () => {
  it('suggests from OpenStreetMap unless an operator chooses Google by name', () => {
    expect(AUTOCOMPLETE).toContain("(Deno.env.get('ADDRESS_AUTOCOMPLETE_PROVIDER') || 'osm')");
    expect(AUTOCOMPLETE).toContain("=== 'google' ? 'google' : 'osm'");
  });

  it('tells the caller which refusal it was, through the one shared mapping', () => {
    expect(AUTOCOMPLETE).toContain('clientStatusFor(osmBudget.reason)');
    expect(AUTOCOMPLETE).toContain('clientHttpStatusFor(osmBudget.reason)');
    expect(codeOnly(AUTOCOMPLETE)).not.toContain("'daily_quota_exceeded'");
  });

  it('breaks the circuit per provider, so an outage at one cannot open the other', () => {
    expect(AUTOCOMPLETE).toContain("const CIRCUIT_SCOPES = { google: 'google_places', osm: 'osm_autocomplete' } as const;");
  });

  it('hands the form the projection it already reads', () => {
    // The form uses exactly one field of a prediction; the projection is the
    // contract, whichever service answered.
    const form = read('src', 'components', 'shared', 'AddressAutocomplete.tsx');
    expect(form).toContain('google-places-autocomplete');
    expect(AUTOCOMPLETE).toContain('predictionsFromPhoton(osmData, input, 8)');
  });
});

describe('the configuration is declared where an operator looks', () => {
  /**
   * The Integrations page is a register of CREDENTIALS — every card maps to a
   * key an edge function or the browser reads, and the page derives a card's
   * status from its required fields. The chain's settings are not credentials:
   * the providers are free and keyless and on by default, so a card for them
   * would carry no required field and read "Not configured" for ever
   * (`allowedSecrets.test.ts` pins that rule). They are project environment
   * variables, and the place an operator finds them is the doc.
   */
  const DOC = read('docs', 'integrations', 'GEOCODING_WITHOUT_GOOGLE.md');

  it('documents every name the chain reads, with its default', () => {
    for (const [name, fallback] of [
      ['GEOCODER_PROVIDERS', 'gnaf,nominatim,photon,abs_locality'],
      ['GEOCODER_OSM_URL', 'https://nominatim.openstreetmap.org'],
      ['GEOCODER_PHOTON_URL', 'https://photon.komoot.io'],
      ['OSM_GEOCODING_DAILY_LIMIT', '2000'],
      ['ADDRESS_AUTOCOMPLETE_PROVIDER', 'osm'],
      ['AUTOCOMPLETE_PHOTON_URL', 'https://photon.komoot.io'],
      ['OSM_AUTOCOMPLETE_DAILY_LIMIT', '5000'],
    ] as const) {
      // Named in the doc's settings table, beside the default the code uses...
      expect(DOC, name).toMatch(new RegExp(`\\| \`${name}\` \\| \`${fallback}\``));
      // ...and actually read by the runtime, so the table cannot describe a
      // setting nothing consults.
      expect(CHAIN + ALLOWANCE + AUTOCOMPLETE, name).toContain(`'${name}'`);
    }
  });

  it('reads no setting the doc does not name', () => {
    // The other direction: a name the code grew and the doc never learned is
    // configuration an operator cannot find, which is the thing being avoided.
    const read_ = /Deno\.env\.get\('([A-Z0-9_]+)'\)|env\('([A-Z0-9_]+)'\)|OSM_ALLOWANCE_ENV[\s\S]{0,200}?'([A-Z0-9_]+)'/g;
    const names = new Set<string>();
    for (const m of (CHAIN + ALLOWANCE).matchAll(read_)) {
      const name = m[1] ?? m[2] ?? m[3];
      if (name && name.startsWith('OSM_')) names.add(name);
      if (name && name.startsWith('GEOCODER_')) names.add(name);
    }
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) expect(DOC, name).toContain(`\`${name}\``);
  });

  it('keeps them off the credential register, and says why there', () => {
    const registry = read('src', 'lib', 'integrations', 'registry.ts');
    for (const name of ['GEOCODER_PROVIDERS', 'ADDRESS_AUTOCOMPLETE_PROVIDER', 'OSM_GEOCODING_DAILY_LIMIT']) {
      expect(registry, name).not.toContain(name);
    }
    expect(DOC).toMatch(/environment variable/i);
  });

  it('CI runs this directory', () => {
    expect(read('.github', 'workflows', 'ci.yml')).toContain('npx vitest run src/lib/reports src/lib/geocode');
  });
});
