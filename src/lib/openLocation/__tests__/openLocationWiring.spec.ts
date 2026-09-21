/**
 * Wiring: the three location surfaces actually walk their provider
 * orders, the etiquette a free service is owed is enforced where the
 * requests are made, and every new setting is documented where an
 * operator can find it. Source-scanning, like `geocoderWiring.spec.ts`,
 * because the thing being pinned is which module talks to whom.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const LIS = read('supabase', 'functions', 'location-intelligence-service', 'index.ts');
const SCHOOL = read('supabase', 'functions', 'school-data-service', 'index.ts');
const STREET = read('supabase', 'functions', 'street-view', 'index.ts');
const INGEST = read('supabase', 'functions', 'amenity-register-ingest', 'index.ts');
const STORE = read('supabase', 'functions', '_shared', 'openLocation', 'amenityRegisterStore.ts');
const DOC = read('docs', 'integrations', 'GEOCODING_WITHOUT_GOOGLE.md');
const REGISTRY = read('src', 'lib', 'integrations', 'registry.ts');
const MIGRATION = read('supabase', 'migrations', '20261130090000_amenity_register.sql');

describe('location-intelligence-service walks the amenity order', () => {
  it('reads the order and the register, and asks Google only for what is missing', () => {
    expect(LIS).toContain('amenityProviderOrder(Deno.env.get)');
    expect(LIS).toContain('readAmenityRegister(db, coordinates, registerState, missing');
    expect(LIS).toMatch(/missing\.map\(\(c\) => fetchNearbyPlaces\(coordinates, GOOGLE_TYPE_FOR\[c\], apiKey, db\)\)/);
  });

  it('leaves fetchNearbyPlaces itself untouched', () => {
    // The RF-7.2B.1B2 contract lives in that function; the chain wraps it.
    expect(LIS).toContain("const radius = type === 'school' ? 3000 : type === 'park' ? 2000 : 5000;");
    expect(LIS).toContain('return { ok: false, count: 0, results: [] };');
  });

  it('measures the commute through the chain, with the Distance Matrix untouched', () => {
    // The second argument is the RESOLVED destination, not a bare capital
    // coordinate. `resolveCommuteDestination` runs first and the chain is
    // handed what it chose, which is what stops Golden Square being measured
    // to Melbourne; pinning the old `cbdCoordinates` spelling would assert
    // the defect. See `urbanCentre.pure.ts`.
    expect(LIS).toContain('measureCommuteThroughChain(coordinates, destination, apiKey, db)');
    expect(LIS).toMatch(/const destination: CommuteDestination \| null = resolveCommuteDestination\(/);
    expect(LIS.indexOf('resolveCommuteDestination('))
      .toBeLessThan(LIS.indexOf('measureCommuteThroughChain(coordinates, destination'));
    expect(LIS).toContain('commuteProviderOrder(Deno.env.get)');
    expect(LIS).toContain("consumeOsmDailyAllowance(db, 'routing')");
    expect(LIS).toContain('mode=transit'); // the Google branch is still the Google branch
  });

  it('a no-route from a reached provider is final; an unusable provider is not', () => {
    expect(LIS).toMatch(/if \(answer\.kind === 'no_route'\) return \{ data: COMMUTE_NO_ROUTE/);
    expect(LIS).toMatch(/if \(answer\.kind === 'unusable'\) reachedAndFailed = true;/);
  });

  it('stamps who answered what', () => {
    expect(LIS).toContain('amenitySources: Object.fromEntries(');
    expect(LIS).toContain('amenityRegisterLoadedAt');
    expect(LIS).toContain('commuteProvider: measuredCommute.provider');
  });
});

describe('the register read declines rather than guessing', () => {
  it('consults the sync ledger before any rows, and a stateless subject is unavailable', () => {
    expect(STORE).toContain("state_unknown");
    expect(STORE).toContain('assessSliceCurrency');
    expect(STORE).toContain("from('amenity_register_syncs')");
  });

  it('a failed database read is read_failed, never an empty area', () => {
    expect(STORE).toContain("UNAVAILABLE('read_failed')");
  });

  it('prunes by sync id, and only after the upserts', () => {
    expect(STORE).toMatch(/\.delete\(\)\s*\n?\s*\.eq\('category', category\)\s*\n?\s*\.eq\('state', state\)\s*\n?\s*\.neq\('sync_id', syncId\)/);
    // The ingest orders them: upsert, then prune, then the ledger closes
    // (searched inside loadSlice, past the import list).
    const body = INGEST.slice(INGEST.indexOf('async function loadSlice'));
    const upsertAt = body.indexOf('upsertSliceRows');
    const pruneAt = body.indexOf('pruneSliceRows');
    const closeAt = body.indexOf("status: 'succeeded'", upsertAt);
    expect(upsertAt).toBeGreaterThan(0);
    expect(pruneAt).toBeGreaterThan(upsertAt);
    expect(closeAt).toBeGreaterThan(pruneAt);
  });
});

describe('school-data-service', () => {
  it('walks the same order between the directory and Google', () => {
    expect(SCHOOL).toContain('amenityProviderOrder(Deno.env.get)');
    expect(SCHOOL).toContain('fetchSchoolsFromRegister');
    expect(SCHOOL).toContain('readRegisterSchools');
  });

  it('states a sector only from tags, never the old hardcoded Government', () => {
    expect(SCHOOL).toContain("(r.school_sector ?? 'Other')");
  });

  it('answers no-data rather than "0 schools" when the register holds none nearby', () => {
    expect(SCHOOL).toMatch(/if \(schools\.length === 0\) return null;/);
  });
});

describe('street-view walks the imagery order', () => {
  it('mapillary skips without a token before any network call', () => {
    expect(STREET).toContain('imageryProviderOrder(Deno.env.get)');
    const branch = STREET.slice(STREET.indexOf('async function serveMapillary'));
    const tokenCheck = branch.indexOf("if (!token) return { kind: 'skipped' };");
    const firstFetch = branch.indexOf('fetchWithTimeout');
    expect(tokenCheck).toBeGreaterThan(-1);
    expect(firstFetch).toBeGreaterThan(tokenCheck);
  });

  it('each provider has its own circuit scope', () => {
    expect(STREET).toContain("const CIRCUIT_SCOPE = 'google_street_view';");
    expect(STREET).toContain("const MAPILLARY_CIRCUIT_SCOPE = 'mapillary_imagery';");
  });

  it('serves Mapillary imagery in the same envelope, attributed', () => {
    expect(STREET).toContain('panoramaDate: image.capturedYearMonth');
    expect(STREET).toContain('copyright: MAPILLARY_ATTRIBUTION');
  });

  it('only a provider that was reached may say ZERO_RESULTS for the chain', () => {
    expect(STREET).toContain('sawCoverageAnswer');
    expect(STREET).toMatch(/sawCoverageAnswer\) \{\s*\n?\s*return j\(\{ success: true, available: false, status: 'ZERO_RESULTS' \}\);/);
    expect(STREET).toContain("return j({ error: 'street_view_not_configured', success: false }, 500);");
  });
});

describe('the ingest owes the mirror its etiquette', () => {
  it('takes the shared turn and the daily allowance before every request', () => {
    const attempt = INGEST.slice(INGEST.indexOf('for (const mirror of OVERPASS_MIRRORS)'));
    const turnAt = attempt.indexOf("awaitOsmTurn(supabase, 'overpass')");
    const allowanceAt = attempt.indexOf("consumeOsmDailyAllowance(supabase, 'amenities')");
    const fetchAt = attempt.indexOf('fetchWithTimeout');
    expect(turnAt).toBeGreaterThan(-1);
    expect(allowanceAt).toBeGreaterThan(turnAt);
    expect(fetchAt).toBeGreaterThan(allowanceAt);
  });

  it('identifies itself and posts the query as a form body', () => {
    expect(INGEST).toContain('GEOCODER_USER_AGENT');
    expect(INGEST).toContain("'Content-Type': 'application/x-www-form-urlencoded'");
    expect(INGEST).toContain('`data=${encodeURIComponent(query)}`');
  });

  it('refuses an empty parse — an empty state slice is a wrong answer', () => {
    expect(INGEST).toContain('parsed zero rows');
  });

  it('hands off when the budget is spent instead of failing the tail', () => {
    expect(INGEST).toContain("status: 'skipped'");
    expect(INGEST).toContain('run budget spent');
  });

  it('never hangs up inside the server’s granted window', () => {
    // Every query carries [timeout:90]; aborting the fetch before the
    // server's own grant both loses the answer and wastes the mirror's
    // compute — measured as "The signal has been aborted" on VIC
    // recreation, three times, under the first 60 s ceiling.
    const ceiling = Number(INGEST.match(/const FETCH_CEILING_MS = ([\d_]+);/)?.[1]?.replace(/_/g, ''));
    const granted = Number(
      read('supabase', 'functions', '_shared', 'openLocation', 'overpassAmenities.pure.ts')
        .match(/OVERPASS_QUERY_TIMEOUT_SECONDS = (\d+);/)?.[1],
    );
    expect(granted).toBeGreaterThan(0);
    expect(ceiling).toBeGreaterThan(granted * 1000);
  });

  it('gives a single-pair category the whole ceiling, not the ladder’s hold-back', () => {
    // The union-first window exists to leave room for the per-pair ladder,
    // and a one-pair category has no ladder — measured 16 Sep 2026, VIC and
    // QLD `schools` were aborted at the 50 s hold-back under a slow mirror
    // and failed outright with nothing to fall back to.
    expect(INGEST).toContain(
      'filters.length > 1 ? UNION_FIRST_WINDOW_MS : FETCH_CEILING_MS',
    );
    // The ladder itself still only runs where there is more than one pair.
    expect(INGEST).toMatch(/if \('error' in fetched && filters\.length > 1\)/);
  });

  it('falls back to the per-pair ladder, and every pair must succeed', () => {
    expect(INGEST).toContain('retrying per tag pair');
    // A category missing one pair's rows would undercount as confidently
    // as a complete one, so a failed pair fails the slice.
    expect(INGEST).toContain('per-pair retry failed');
  });
});

describe('configuration is documented, and credentials are cards', () => {
  it('the doc names every new setting with its default', () => {
    for (const [name, fallback] of [
      ['AMENITY_PROVIDERS', 'register,google'],
      ['COMMUTE_PROVIDERS', 'osrm,google'],
      ['STREET_IMAGERY_PROVIDERS', 'mapillary,google'],
      ['OSM_AMENITIES_DAILY_LIMIT', '200'],
      ['OSRM_ROUTING_DAILY_LIMIT', '1500'],
      ['AMENITY_REGISTER_MAX_AGE_DAYS', '30'],
    ] as const) {
      expect(DOC, name).toMatch(new RegExp(`\\| \`${name}\` \\| \`${fallback}\``));
    }
    expect(DOC).toContain('`MAPILLARY_KILL_SWITCH`');
  });

  it('the Mapillary token is a real credential card with a required field', () => {
    // The all-optional card lesson: a card with no required field reads
    // "Not configured" for ever. A token is a credential, so it is a card.
    expect(REGISTRY).toMatch(/id: 'mapillary'/);
    expect(REGISTRY).toMatch(/key: 'MAPILLARY_ACCESS_TOKEN'[^}]*required: true/);
  });

  it('the provider orders stay off the credential register', () => {
    for (const name of ['AMENITY_PROVIDERS', 'COMMUTE_PROVIDERS', 'STREET_IMAGERY_PROVIDERS', 'OSM_AMENITIES_DAILY_LIMIT']) {
      expect(REGISTRY, name).not.toContain(name);
    }
  });

  it('the free hosts can never be metered', () => {
    const billing = read('supabase', 'functions', '_shared', 'apiUsageBilling.pure.ts');
    for (const host of ['kumi.systems', 'maps.mail.ru', 'project-osrm.org', 'mapillary.com']) {
      expect(billing, host).toContain(`"${host}"`);
    }
  });
});

describe('the migration and the schedule', () => {
  it('schedules one refresh job per state', () => {
    const jobs = MIGRATION.match(/amenity-register-refresh-[a-z]+/g) ?? [];
    expect(new Set(jobs).size).toBe(8);
  });

  it('locks the refresh function to service_role, naming all three roles', () => {
    // PUBLIC alone leaves the anon/authenticated default-privilege grants
    // standing — the 20261129090000 lesson.
    expect(MIGRATION).toContain('revoke all on function public.amenity_register_refresh(jsonb) from public, anon, authenticated;');
    expect(MIGRATION).toContain('grant execute on function public.amenity_register_refresh(jsonb) to service_role;');
  });

  it('enables RLS on both tables and keys rows by (category, osm_type, osm_id)', () => {
    expect(MIGRATION).toContain('alter table public.amenity_register enable row level security;');
    expect(MIGRATION).toContain('alter table public.amenity_register_syncs enable row level security;');
    expect(MIGRATION).toContain('primary key (category, osm_type, osm_id)');
  });

  it('declares the ingest function to the gateway', () => {
    expect(read('supabase', 'config.toml')).toContain('[functions.amenity-register-ingest]');
  });
});

describe('CI runs this directory', () => {
  it('is in the verify job’s vitest line', () => {
    expect(read('.github', 'workflows', 'ci.yml')).toContain('src/lib/openLocation');
  });
});
