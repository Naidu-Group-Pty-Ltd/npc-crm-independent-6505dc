/**
 * The chain, driven end to end against the refusal it met on 24 Sep 2026.
 *
 * From 07:51:29 UTC the public Nominatim answered every request from the
 * production egress with HTTP 403. The chain placed `1408/5 SECOND AVE,
 * Blacktown NSW 2148` at the ABS centroid of the suburb and wrote that
 * centroid into `geocode_cache` as the address's permanent answer. These run
 * the real `geocodeAddress` — providers, cache policy, pause and all — against
 * a stubbed network and an in-memory cache, and pin what it does now.
 */
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GNAF_SHARD_COLUMNS } from '../../../../supabase/functions/_shared/geocode/gnafShard.pure.ts';

type Chain = typeof import('../../../../supabase/functions/_shared/geocode/geocoder.ts');

const NOMINATIM_403 = '<html><body><h1>Access blocked</h1><p>You have been blocked because you have violated the usage policy.</p></body></html>';

const PHOTON_HOUSE = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [150.9075, -33.7685] },
    properties: { type: 'house', housenumber: '5', street: 'Second Avenue', postcode: '2148', district: 'Blacktown', state: 'New South Wales', countrycode: 'AU' },
  }],
};
const PHOTON_NOTHING = { type: 'FeatureCollection', features: [] };

const ABS_BLACKTOWN = {
  features: [{
    attributes: { SAL_CODE_2021: '10433', SAL_NAME_2021: 'Blacktown', STATE_NAME_2021: 'New South Wales' },
    geometry: { rings: [[[150.88, -33.76], [150.93, -33.76], [150.93, -33.79], [150.88, -33.79], [150.88, -33.76]]] },
  }],
};

const NOMINATIM_STREET = [{
  lat: '-33.7690', lon: '150.9068', category: 'highway', type: 'residential', addresstype: 'road',
  display_name: 'Second Avenue, Blacktown, City of Blacktown, New South Wales, 2148, Australia',
  address: { road: 'Second Avenue', suburb: 'Blacktown', state: 'New South Wales', postcode: '2148', 'ISO3166-2-lvl4': 'AU-NSW' },
}];

interface Route { status: number; body: unknown; headers?: Record<string, string> }
type Routes = { nominatim?: Route; photon?: Route; abs?: Route; gnaf?: (path: string) => Route | undefined };

let calls: string[] = [];
let gnafPaths: string[] = [];

function stubNetwork(routes: Routes) {
  calls = [];
  gnafPaths = [];
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    const { host, pathname } = new URL(url);
    const which = host.includes('gnaf') ? 'gnaf' : host.includes('nominatim') ? 'nominatim' : host.includes('photon') ? 'photon' : host.includes('abs.gov.au') ? 'abs' : 'other';
    calls.push(which);
    let route: Route | undefined;
    if (which === 'gnaf') {
      gnafPaths.push(pathname);
      route = routes.gnaf?.(pathname);
    } else {
      route = (routes as Record<string, Route | undefined>)[which];
    }
    if (!route) return new Response('not stubbed', { status: 599 });
    const body = typeof route.body === 'string' || route.body instanceof Uint8Array ? route.body : JSON.stringify(route.body);
    return new Response(body as BodyInit, { status: route.status, headers: route.headers });
  });
}

/** An in-memory `geocode_cache` and a shared limiter that always grants. */
function fakeDb(row: Record<string, unknown> | null = null) {
  let stored = row;
  const writes: Record<string, unknown>[] = [];
  return {
    writes,
    get stored() { return stored; },
    from() {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: stored, error: null }),
        upsert: async (r: Record<string, unknown>) => { writes.push(r); stored = { ...r }; return { error: null }; },
      };
      return q;
    },
    rpc: (name: string) => Promise.resolve(
      name === 'security_consume_rate_limit'
        ? { data: [{ allowed: true, retry_after_seconds: 0 }], error: null }
        : { data: null, error: null },
    ),
  };
}

const cachedLocality = (resolvedAgoMs: number) => ({
  address_key: 'k', query: '1408/5 SECOND AVE, Blacktown NSW 2148',
  lat: -33.7741, lng: 150.9036, precision: 'locality', types: ['locality'],
  provider_precision: 'SAL 10433', suburb: 'Blacktown', state: 'NSW', postcode: '2148',
  lga: null, lga_code: null, matched_address: 'Blacktown, New South Wales',
  provider: 'abs_locality', attribution: 'ABS',
  resolved_at: new Date(Date.now() - resolvedAgoMs).toISOString(),
});

const ASK = { address: '1408/5 SECOND AVE, Blacktown NSW 2148' };
const ENV = (k: string) => (k === 'GEOCODER_PROVIDERS' ? undefined : undefined);

let chain: Chain;
beforeEach(async () => {
  // A fresh module per test: the pause a refusal sets is per isolate, and an
  // isolate is what a fresh import models.
  vi.resetModules();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  chain = await import('../../../../supabase/functions/_shared/geocode/geocoder.ts');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Nominatim refuses; the chain still finds the building', () => {
  it('asks Photon, places the address itself, and remembers it', async () => {
    stubNetwork({
      nominatim: { status: 403, body: NOMINATIM_403 },
      photon: { status: 200, body: PHOTON_HOUSE },
    });
    const db = fakeDb();
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.provider).toBe('photon');
    expect(out.result.precision).toBe('address');
    expect(calls).toEqual(['nominatim', 'photon']);
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ provider: 'photon', precision: 'address' });
  });

  it('does not ask Nominatim again while its 403 pause holds — and says why in the log', async () => {
    stubNetwork({
      nominatim: { status: 403, body: NOMINATIM_403, headers: { 'retry-after': '3600' } },
      photon: { status: 200, body: PHOTON_HOUSE },
    });
    const warn = vi.spyOn(console, 'warn');
    await chain.geocodeAddress(fakeDb(), ASK, { env: ENV, feature: 'spec' });
    const words = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(words).toContain('nominatim answered 403 (retry-after 3600)');
    expect(words).toContain('You have been blocked because you have violated the usage policy');
    expect(words).toContain('paused until');

    await chain.geocodeAddress(fakeDb(), { address: '12 Other Street, Blacktown NSW 2148' }, { env: ENV, feature: 'spec' });
    expect(calls.filter((c) => c === 'nominatim')).toHaveLength(1);
  });
});

describe('both street-level providers refuse', () => {
  it('serves the suburb centroid and never remembers it — the rows the outage wrote', async () => {
    stubNetwork({
      nominatim: { status: 403, body: NOMINATIM_403 },
      photon: { status: 403, body: 'blocked' },
      abs: { status: 200, body: ABS_BLACKTOWN },
    });
    const db = fakeDb();
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.precision).toBe('locality');
    expect(out.result.provider).toBe('abs_locality');
    expect(db.writes).toHaveLength(0);
  });

  it('remembers the centroid only where the street-level providers LOOKED and found nothing', async () => {
    stubNetwork({
      nominatim: { status: 200, body: [] },
      photon: { status: 200, body: PHOTON_NOTHING },
      abs: { status: 200, body: ABS_BLACKTOWN },
    });
    const db = fakeDb();
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec' });
    expect(out.ok && out.result.precision).toBe('locality');
    expect(db.writes).toHaveLength(1);
  });
});

describe('a remembered suburb centroid is provisional', () => {
  it('is replaced by a street answer once the street-level providers answer again', async () => {
    // The row the 24 Sep outage wrote for Blacktown, two hours later.
    stubNetwork({ nominatim: { status: 200, body: NOMINATIM_STREET } });
    const db = fakeDb(cachedLocality(2 * 3_600_000));
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.fromCache).toBe(false);
    expect(out.result.precision).toBe('street');
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ provider: 'nominatim', precision: 'street' });
    // The floor is already in hand: the ABS is not asked for the same centroid again.
    expect(calls).not.toContain('abs');
  });

  it('stands, untouched, while the street-level providers still refuse', async () => {
    stubNetwork({
      nominatim: { status: 403, body: NOMINATIM_403 },
      photon: { status: 403, body: 'blocked' },
    });
    const db = fakeDb(cachedLocality(2 * 3_600_000));
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec' });
    expect(out.ok && out.fromCache).toBe(true);
    expect(out.ok && out.result.precision).toBe('locality');
    expect(db.writes).toHaveLength(0);
  });

  it('is re-dated when they look again and still find no such street', async () => {
    stubNetwork({
      nominatim: { status: 200, body: [] },
      photon: { status: 200, body: PHOTON_NOTHING },
    });
    const db = fakeDb(cachedLocality(2 * 3_600_000));
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec' });
    expect(out.ok && out.fromCache).toBe(true);
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toMatchObject({ precision: 'locality', provider: 'abs_locality' });
  });

  it('is served as it stands while it is under an hour old — nothing is asked', async () => {
    stubNetwork({});
    const db = fakeDb(cachedLocality(10 * 60_000));
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec' });
    expect(out.ok && out.fromCache).toBe(true);
    expect(calls).toEqual([]);
  });

  it('is never handed to a caller that refuses a suburb-level answer', async () => {
    // The PDF import learns a suburb FROM the geocode; a centroid names only
    // what it was given. It used to receive a cached centroid anyway.
    stubNetwork({
      nominatim: { status: 403, body: NOMINATIM_403 },
      photon: { status: 403, body: 'blocked' },
    });
    const db = fakeDb(cachedLocality(10 * 60_000));
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec', allowLocalityFallback: false });
    expect(out.ok).toBe(false);
    if (out.ok === true) return;
    expect(out.providerRefused).toBe(true);
  });
});

describe('a remembered street or address is the answer', () => {
  it('is served with nothing asked', async () => {
    stubNetwork({});
    const db = fakeDb({ ...cachedLocality(30 * 24 * 3_600_000), precision: 'street', provider: 'nominatim', types: ['route'] });
    const out = await chain.geocodeAddress(db, ASK, { env: ENV, feature: 'spec' });
    expect(out.ok && out.fromCache).toBe(true);
    expect(out.ok && out.result.precision).toBe('street');
    expect(calls).toEqual([]);
  });
});

describe('G-NAF leads the chain where a register is configured', () => {
  const GNAF_BASE = 'https://gnaf.test/tok/gnaf';
  const GNAF_ENV = (k: string) => (k === 'GEOCODER_GNAF_URL' ? GNAF_BASE : undefined);
  const line = (o: Record<string, string>) => GNAF_SHARD_COLUMNS.map((c) => o[c] ?? '').join('|');
  const SHARD_2148 = gzipSync(Buffer.from([
    GNAF_SHARD_COLUMNS.join('|'),
    line({ n1: '5', street: 'SECOND', type: 'AVENUE', locality: 'BLACKTOWN', lat: '-33.768512', lng: '150.907511', gt: 'BC', pid: 'GANSW0001' }),
  ].join('\n')));
  const MANIFEST = { format: 1, release: { label: 'AUG 2026' } };
  const INDEX = gzipSync(Buffer.from(JSON.stringify({ format: 1, states: { NSW: { BLACKTOWN: ['2148'] } } })));

  const register = (over: Record<string, Route> = {}) => (path: string): Route | undefined => {
    const tail = path.replace('/tok/gnaf/', '');
    if (over[tail]) return over[tail];
    if (tail === 'v1/manifest.json') return { status: 200, body: MANIFEST };
    if (tail === 'v1/localities.json.gz') return { status: 200, body: new Uint8Array(INDEX) };
    if (tail === 'v1/NSW/2148.psv.gz') return { status: 200, body: new Uint8Array(SHARD_2148) };
    return { status: 404, body: 'Not Found' };
  };

  it('places the unit\'s building from the register, asks nothing else, and remembers it', async () => {
    stubNetwork({ gnaf: register(), nominatim: { status: 403, body: NOMINATIM_403 } });
    const db = fakeDb();
    const out = await chain.geocodeAddress(db, ASK, { env: GNAF_ENV, feature: 'spec' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result).toMatchObject({ provider: 'gnaf', precision: 'address', postcode: '2148', providerPrecision: 'G-NAF AUG 2026 BC' });
    expect(out.tried).toEqual(['gnaf']);
    expect(calls.every((c) => c === 'gnaf')).toBe(true);
    expect(gnafPaths).toEqual(['/tok/gnaf/v1/manifest.json', '/tok/gnaf/v1/NSW/2148.psv.gz']);
    expect(db.writes[0]).toMatchObject({ provider: 'gnaf', precision: 'address' });
  });

  it('is skipped without a request where no register is configured — and is not counted as tried', async () => {
    stubNetwork({ gnaf: register(), nominatim: { status: 200, body: NOMINATIM_STREET } });
    const out = await chain.geocodeAddress(fakeDb(), ASK, { env: ENV, feature: 'spec' });
    expect(out.ok && out.result.provider).toBe('nominatim');
    expect(calls).not.toContain('gnaf');
    expect(out.tried).not.toContain('gnaf');
  });

  it('treats a missing manifest as an outage — never as "no such address" — and rests the register', async () => {
    stubNetwork({
      gnaf: register({ 'v1/manifest.json': { status: 404, body: 'Not Found' } }),
      nominatim: { status: 200, body: NOMINATIM_STREET },
    });
    const warn = vi.spyOn(console, 'warn');
    const first = await chain.geocodeAddress(fakeDb(), ASK, { env: GNAF_ENV, feature: 'spec' });
    expect(first.ok && first.result.provider).toBe('nominatim');
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('no manifest at GEOCODER_GNAF_URL');
    const before = calls.filter((c) => c === 'gnaf').length;
    await chain.geocodeAddress(fakeDb(), { address: '12 Other Street, Blacktown NSW 2148' }, { env: GNAF_ENV, feature: 'spec' });
    expect(calls.filter((c) => c === 'gnaf').length).toBe(before);
  });

  it('keeps a floor answer out of the cache when the register could not be read', async () => {
    stubNetwork({
      gnaf: register({ 'v1/manifest.json': { status: 503, body: 'down' } }),
      nominatim: { status: 200, body: [] },
      photon: { status: 200, body: PHOTON_NOTHING },
      abs: { status: 200, body: ABS_BLACKTOWN },
    });
    const db = fakeDb();
    const out = await chain.geocodeAddress(db, ASK, { env: GNAF_ENV, feature: 'spec' });
    expect(out.ok && out.result.precision).toBe('locality');
    expect(db.writes).toHaveLength(0);
  });

  it('reads a postal area the register holds nothing in as no such address, and asks the next provider', async () => {
    const photonIn2149 = { ...PHOTON_HOUSE, features: [{ ...PHOTON_HOUSE.features[0], properties: { ...PHOTON_HOUSE.features[0].properties, postcode: '2149' } }] };
    stubNetwork({ gnaf: register(), photon: { status: 200, body: photonIn2149 }, nominatim: { status: 200, body: [] } });
    const out = await chain.geocodeAddress(fakeDb(), { address: '5 Second Avenue, Blacktown NSW 2149' }, { env: GNAF_ENV, feature: 'spec' });
    expect(gnafPaths).toContain('/tok/gnaf/v1/NSW/2149.psv.gz');
    expect(out.ok && out.result.provider).toBe('photon');
    expect(out.ok && out.tried).toEqual(['gnaf', 'nominatim', 'photon']);
  });

  it('reads a unit filed as a part of its own — "Unit 3, 5 Second Avenue" — and places its building', async () => {
    stubNetwork({ gnaf: register(), nominatim: { status: 403, body: NOMINATIM_403 } });
    const out = await chain.geocodeAddress(fakeDb(), { address: 'Unit 3, 5 Second Avenue, Blacktown NSW 2148' }, { env: GNAF_ENV, feature: 'spec' });
    expect(out.ok && out.result).toMatchObject({ provider: 'gnaf', precision: 'address' });
    expect(out.ok && out.tried).toEqual(['gnaf']);
  });

  it('finds the suburb\'s postal area in the index when the ask names no postcode', async () => {
    stubNetwork({ gnaf: register() });
    const out = await chain.geocodeAddress(fakeDb(), { address: '5 Second Avenue, Blacktown NSW' }, { env: GNAF_ENV, feature: 'spec' });
    expect(out.ok && out.result.provider).toBe('gnaf');
    expect(gnafPaths).toEqual(['/tok/gnaf/v1/manifest.json', '/tok/gnaf/v1/localities.json.gz', '/tok/gnaf/v1/NSW/2148.psv.gz']);
  });

  describe('a remembered street answer is put to the register (rule 4)', () => {
    // 25 Sep 2026 00:18 UTC: `60 Lawley Street, Spalding WA 6530` was served
    // OpenStreetMap's street point remembered from before the register
    // existed, and G-NAF — which holds the address — was never asked.
    const DAYS = 24 * 3_600_000;
    const rememberedStreet = (resolvedAgoMs: number, over: Record<string, unknown> = {}) => ({
      ...cachedLocality(resolvedAgoMs),
      lat: -33.769, lng: 150.9068, precision: 'street', types: ['route'], provider_precision: 'road',
      provider: 'nominatim', matched_address: 'Second Avenue, Blacktown, New South Wales, 2148, Australia',
      ...over,
    });

    it('takes the register\'s address point in place of the street, asks nobody else, and remembers it', async () => {
      stubNetwork({ gnaf: register() });
      const db = fakeDb(rememberedStreet(2 * DAYS));
      const out = await chain.geocodeAddress(db, ASK, { env: GNAF_ENV, feature: 'spec' });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(out.fromCache).toBe(false);
      expect(out.result).toMatchObject({ provider: 'gnaf', precision: 'address' });
      expect(out.tried).toEqual(['gnaf']);
      expect(calls.every((c) => c === 'gnaf')).toBe(true);
      expect(db.writes).toHaveLength(1);
      expect(db.writes[0]).toMatchObject({ provider: 'gnaf', precision: 'address' });
    });

    it('keeps the street answer, re-dated, where the register holds no finer point', async () => {
      stubNetwork({ gnaf: register() });
      const db = fakeDb(rememberedStreet(2 * DAYS, { query: '9 Second Avenue, Blacktown NSW 2148' }));
      const out = await chain.geocodeAddress(db, { address: '9 Second Avenue, Blacktown NSW 2148' }, { env: GNAF_ENV, feature: 'spec' });
      expect(out.ok && out.fromCache).toBe(true);
      expect(out.ok && out.result).toMatchObject({ provider: 'nominatim', precision: 'street' });
      expect(gnafPaths).toContain('/tok/gnaf/v1/NSW/2148.psv.gz');
      expect(db.writes).toHaveLength(1);
      expect(db.writes[0]).toMatchObject({ provider: 'nominatim', precision: 'street' });
      expect(Date.now() - Date.parse(String(db.writes[0].resolved_at))).toBeLessThan(60_000);
    });

    it('leaves the street answer untouched when the register cannot be read — an outage is ours, not the address\'s', async () => {
      stubNetwork({ gnaf: register({ 'v1/manifest.json': { status: 503, body: 'down' } }) });
      const db = fakeDb(rememberedStreet(2 * DAYS));
      const out = await chain.geocodeAddress(db, ASK, { env: GNAF_ENV, feature: 'spec' });
      expect(out.ok && out.fromCache).toBe(true);
      expect(out.ok && out.result.provider).toBe('nominatim');
      expect(db.writes).toHaveLength(0);
    });

    it('asks nothing while the street answer is under an hour old', async () => {
      stubNetwork({ gnaf: register() });
      const out = await chain.geocodeAddress(fakeDb(rememberedStreet(10 * 60_000)), ASK, { env: GNAF_ENV, feature: 'spec' });
      expect(out.ok && out.result.provider).toBe('nominatim');
      expect(calls).toEqual([]);
    });

    it('never puts an ask with no number to the register', async () => {
      stubNetwork({ gnaf: register() });
      const db = fakeDb(rememberedStreet(2 * DAYS, { query: 'Second Avenue, Blacktown NSW 2148' }));
      const out = await chain.geocodeAddress(db, { address: 'Second Avenue, Blacktown NSW 2148' }, { env: GNAF_ENV, feature: 'spec' });
      expect(out.ok && out.fromCache).toBe(true);
      expect(calls).toEqual([]);
    });

    it('does not re-ask the register about a street it placed itself', async () => {
      stubNetwork({ gnaf: register() });
      const out = await chain.geocodeAddress(fakeDb(rememberedStreet(2 * DAYS, { provider: 'gnaf' })), ASK, { env: GNAF_ENV, feature: 'spec' });
      expect(out.ok && out.fromCache).toBe(true);
      expect(calls).toEqual([]);
    });

    it('asks nothing where the operator\'s order leaves the register out', async () => {
      const env = (k: string) => (k === 'GEOCODER_GNAF_URL' ? GNAF_BASE : k === 'GEOCODER_PROVIDERS' ? 'nominatim,photon,abs_locality' : undefined);
      stubNetwork({ gnaf: register() });
      const out = await chain.geocodeAddress(fakeDb(rememberedStreet(2 * DAYS)), ASK, { env, feature: 'spec' });
      expect(out.ok && out.fromCache).toBe(true);
      expect(calls).toEqual([]);
    });
  });
});
