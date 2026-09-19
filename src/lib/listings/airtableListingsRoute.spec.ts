import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  AIRTABLE_RECORD_ID,
  BROKERED_LISTINGS_OPERATIONS,
  listingsRequestUrl,
  MAX_RECORD_IDS,
  describeListingsFailure,
  missionControlAnswered,
  missionControlOrigin,
  missionControlRefusal,
  MISSION_CONTROL_ENDPOINT_HEADER,
  recordIdFormula,
  refuseRecordIds,
  resolveListingsRoute,
  resolveWritebackRoute,
  writebackRequestUrl,
} from '../../../supabase/functions/_shared/airtableListingsRoute.pure.ts';

const src = readFileSync('supabase/functions/_shared/airtableListingsRoute.pure.ts', 'utf8');

const MC = { missionControlUrl: 'https://mc.example', cloneApiKey: 'ck_live' };

describe('the direct route belongs to a deployment that holds the token', () => {
  it('is taken when the token AND the base id are both present', () => {
    const r = resolveListingsRoute({
      airtableToken: 'pat123',
      airtableBaseId: 'appNPC',
      ...MC,
    });
    expect(r.via).toBe('direct');
    if (r.via !== 'direct') throw new Error('unreachable');
    expect(r.baseId).toBe('appNPC');
    expect(r.meter).toBe(true);
  });

  it('wins over the broker even when both are configured', () => {
    // Holding the vendor token IS the entitlement to spend it.
    const r = resolveListingsRoute({ airtableToken: 'pat', airtableBaseId: 'app', ...MC });
    expect(r.via).toBe('direct');
  });
});

describe('a token with no base id is unconfigured, and never brokered', () => {
  it('refuses rather than silently reading Mission Control base', () => {
    // Brokering here would return a plausible marketplace of somebody else's
    // listings, which is worse than an empty page because it looks like data.
    const r = resolveListingsRoute({ airtableToken: 'pat', airtableBaseId: '', ...MC });
    expect(r.via).toBe('unconfigured');
    if (r.via !== 'unconfigured') throw new Error('unreachable');
    expect(r.why).toContain('AIRTABLE_BASE_ID');
  });
});

describe('the brokered route carries no base id at all', () => {
  const r = resolveListingsRoute({ airtableToken: '', airtableBaseId: '', ...MC });

  it('is taken when the deployment holds no token', () => {
    expect(r.via).toBe('broker');
  });

  it('has no baseId field to leak, structurally', () => {
    expect(Object.keys(r)).not.toContain('baseId');
  });

  it('builds a Mission Control URL and never an Airtable one', () => {
    const url = listingsRequestUrl(r, 'records', 'Property Intake Master', { pageSize: 100 });
    expect(url.startsWith('https://mc.example/api/public/listings/records')).toBe(true);
    expect(url).not.toContain('api.airtable.com');
  });

  it('never puts a base id in a brokered URL', () => {
    const url = listingsRequestUrl(r, 'records', 'Property Intake Master', {});
    expect(url).not.toMatch(/base/i);
  });

  it('is NOT metered here — Mission Control meters the call it makes', () => {
    if (r.via !== 'broker') throw new Error('unreachable');
    expect(r.meter).toBe(false);
  });

  it('authenticates with the clone key and never an Airtable bearer', () => {
    if (r.via !== 'broker') throw new Error('unreachable');
    expect(r.headers['x-clone-api-key']).toBe('ck_live');
    expect(Object.keys(r.headers)).not.toContain('Authorization');
  });
});

describe('metering is never both ends', () => {
  it('exactly one route meters, and it is the one that spends the vendor token', () => {
    const direct = resolveListingsRoute({ airtableToken: 't', airtableBaseId: 'b', ...MC });
    const broker = resolveListingsRoute({ airtableToken: '', airtableBaseId: '', ...MC });
    const meters = [direct, broker].filter((r) => r.via !== 'unconfigured' && r.meter);
    expect(meters).toHaveLength(1);
    expect(meters[0].via).toBe('direct');
  });
});

describe('unconfigured is a named state, never a silent unauthenticated call', () => {
  it('names both halves when neither is present', () => {
    const r = resolveListingsRoute({
      airtableToken: '',
      airtableBaseId: '',
      missionControlUrl: '',
      cloneApiKey: '',
    });
    expect(r.via).toBe('unconfigured');
    if (r.via !== 'unconfigured') throw new Error('unreachable');
    expect(r.why).toContain('AIRTABLE_TOKEN');
    expect(r.why).toContain('MISSION_CONTROL_URL');
  });

  it('throws rather than building a URL on an unconfigured route', () => {
    const r = resolveListingsRoute({
      airtableToken: '',
      airtableBaseId: '',
      missionControlUrl: '',
      cloneApiKey: '',
    });
    expect(() => listingsRequestUrl(r, 'records', 'T')).toThrow(/unconfigured/);
  });
});

describe('the direct URL keeps Airtable own spelling', () => {
  const r = resolveListingsRoute({ airtableToken: 'p', airtableBaseId: 'appX', ...MC });

  it('uses sort[0][field], which is what Airtable accepts', () => {
    const url = listingsRequestUrl(r, 'records', 'Intake', { sortField: 'Created', sortDirection: 'desc' });
    expect(decodeURIComponent(url)).toContain('sort[0][field]=Created');
  });

  it('reads the schema from the meta endpoint for this base', () => {
    expect(listingsRequestUrl(r, 'tables', 'ignored')).toBe(
      'https://api.airtable.com/v0/meta/bases/appX/tables',
    );
  });
});

describe('who refused is read from a header, never guessed from a body', () => {
  it('names Mission Control refusal when the header is set', () => {
    const h = new Headers({ 'x-mission-control-refusal': 'table_not_allowed' });
    expect(missionControlRefusal(h)).toBe('table_not_allowed');
  });

  it('is null for a relayed vendor answer', () => {
    expect(missionControlRefusal(new Headers({ 'content-type': 'application/json' }))).toBeNull();
  });
});

describe('the module stays pure and coupling-free', () => {
  it('names the three brokered operations and no path a caller supplies', () => {
    expect([...BROKERED_LISTINGS_OPERATIONS]).toEqual(['tables', 'records', 'selftest']);
  });

  it('imports nothing at all', () => {
    expect(src).not.toMatch(/^\s*import\s/m);
  });

  it('never reads Deno.env — the caller passes what it read', () => {
    expect(src).not.toContain('Deno.env');
  });
});

/* -------------------------------------------------------------------------- */
/* Adoption: the two consumers must actually go through the route.            */
/* -------------------------------------------------------------------------- */

/**
 * A source file with its comments stripped.
 *
 * Every source-level assertion below is about what the code DOES. These
 * functions explain in their own comments what they no longer do — the old
 * `api.airtable.com` URL, the old `pageSize=${listingIds.length}` — and a scan
 * that reads an explanation as a violation is one people satisfy by deleting
 * the explanation.
 */
const codeOf = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const proxy = readFileSync('supabase/functions/airtable-proxy/index.ts', 'utf8');
const cache = readFileSync('supabase/functions/listings-cache/index.ts', 'utf8');

describe('neither consumer reaches Airtable directly any more', () => {
  it('airtable-proxy builds every URL from the route', () => {
    // A surviving literal would be a path that still needs the token and so
    // still fails on a clone — the exact half-adoption this change exists to
    // remove.
    expect(proxy).not.toContain('api.airtable.com');
    expect(proxy).toContain('listingsRequestUrl');
  });

  it('listings-cache builds every URL from the route', () => {
    expect(cache).not.toContain('api.airtable.com');
    expect(cache).toContain('listingsRequestUrl');
  });

  it('neither builds an Airtable bearer header of its own', () => {
    // The credential belongs to the route, which is the only place that knows
    // whether this deployment is entitled to spend one.
    for (const src of [proxy, cache]) {
      expect(src).not.toMatch(/Bearer \$\{\s*(token|config\.token)\s*\}/);
    }
  });
});

describe('a brokered read is not metered at the clone', () => {
  it('airtable-proxy logs usage only on the metered route', () => {
    // Mission Control writes the usage row for a call Mission Control made.
    // Metering at both ends bills the tenant twice.
    const idx = proxy.indexOf('logApiUsage(supabase, {');
    expect(idx).toBeGreaterThan(-1);
    const before = proxy.slice(Math.max(0, idx - 600), idx);
    expect(before).toContain('if (route.meter)');
  });

  it('listings-cache meters nothing at all, so there is nothing to guard', () => {
    expect(cache).not.toContain('logApiUsage');
  });
});

describe('an unconfigured deployment says which half is missing', () => {
  it('both consumers carry the reason out rather than a bare refusal', () => {
    for (const src of [proxy, cache]) {
      expect(src).toMatch(/route\.via === 'unconfigured'/);
      expect(src).toContain('route.why');
    }
  });
});

const images = readFileSync('supabase/functions/listing-images/index.ts', 'utf8');
const enrichment = readFileSync('supabase/functions/listing-enrichment/index.ts', 'utf8');
const autoReport = readFileSync('supabase/functions/auto-report-sync/index.ts', 'utf8');

const ID_A = 'recAAAAAAAAAAAAAA';
const ID_B = 'recBBBBBBBBBBBBBB';

/**
 * Reading the photograph columns is what puts pictures on a listing, and it is
 * the one read expressed in Airtable as a formula.
 *
 * A clone held no Airtable token and `listing-images` still built a direct
 * Airtable URL, so `airtableConfig()` returned null and the sweep refused
 * before it began: a marketplace with no photographs on any card. Brokering it
 * meant admitting the read WITHOUT admitting a query language, which is what
 * `recordIds` is — the caller names rows, this module composes the formula.
 */
describe('a read may name rows, never ask a question', () => {
  it('accepts Airtable record ids and rejects anything that could be an expression', () => {
    expect(AIRTABLE_RECORD_ID.test(ID_A)).toBe(true);
    for (const bad of ["rec'),RECORD_ID()='x", 'recSHORT', 'tblAAAAAAAAAAAAAA', 'rec AAAAAAAAAAAAA']) {
      expect(AIRTABLE_RECORD_ID.test(bad)).toBe(false);
    }
  });

  it('refuses an empty, oversized or malformed set rather than filtering it', () => {
    // Silently dropping one would fingerprint that listing as having no
    // photographs and re-arm its schedule having done nothing.
    expect(refuseRecordIds([])).toBeTruthy();
    expect(refuseRecordIds(Array(MAX_RECORD_IDS + 1).fill(ID_A))).toBeTruthy();
    expect(refuseRecordIds([ID_A, 'nope'])).toBeTruthy();
    expect(refuseRecordIds([ID_A, ID_B])).toBeNull();
  });

  it('composes the formula only from checked ids', () => {
    expect(recordIdFormula([ID_A, ID_B])).toBe(
      `OR(RECORD_ID()='${ID_A}',RECORD_ID()='${ID_B}')`,
    );
    expect(() => recordIdFormula(["'"])).toThrow();
  });

  it('sends IDS on the brokered route and a FORMULA on the direct one', () => {
    const broker = new URL(
      listingsRequestUrl(resolveListingsRoute({ ...MC, airtableToken: null, airtableBaseId: null }), 'records', 'Intake', {
        recordIds: [ID_A, ID_B],
      }),
    );
    // Nothing Mission Control could mistake for a query.
    expect(broker.searchParams.get('recordIds')).toBe(`${ID_A},${ID_B}`);
    expect(broker.searchParams.get('filterByFormula')).toBeNull();

    const direct = new URL(
      listingsRequestUrl(
        resolveListingsRoute({ airtableToken: 'pat', airtableBaseId: 'appNPC', ...MC }),
        'records',
        'Intake',
        { recordIds: [ID_A, ID_B] },
      ),
    );
    // The deployment holding the token writes its own formula.
    expect(direct.searchParams.get('filterByFormula')).toBe(recordIdFormula([ID_A, ID_B]));
    expect(direct.searchParams.get('recordIds')).toBeNull();
  });

  it('refuses to build a URL from ids it has not checked, on either route', () => {
    for (const route of [
      resolveListingsRoute({ ...MC, airtableToken: null, airtableBaseId: null }),
      resolveListingsRoute({ airtableToken: 'pat', airtableBaseId: 'app', ...MC }),
    ]) {
      expect(() => listingsRequestUrl(route, 'records', 'Intake', { recordIds: ["'"] })).toThrow();
    }
  });
});

/**
 * The write-back is the other half, and it does NOT travel.
 *
 * `listing-images` publishes signed URLs into its own bucket, and
 * `listing-enrichment` writes resolved field values — into a table every
 * deployment reads. From a clone those URLs point at storage no other reader
 * can open, so the act is wrong there for a reason that has nothing to do with
 * secrecy, and the broker must never grow a write operation to carry it.
 */
describe('the write-back never leaves the account holder', () => {
  it('is direct where the token is held', () => {
    const w = resolveWritebackRoute({ airtableToken: 'pat', airtableBaseId: 'appNPC' });
    expect(w.via).toBe('direct');
    if (w.via !== 'direct') throw new Error('unreachable');
    expect(writebackRequestUrl(w, 'Intake')).toBe('https://api.airtable.com/v0/appNPC/Intake');
  });

  it('is refused everywhere else, and there is no brokered branch to fall to', () => {
    for (const input of [
      { airtableToken: null, airtableBaseId: null },
      { airtableToken: 'pat', airtableBaseId: null },
      { airtableToken: null, airtableBaseId: 'appNPC' },
    ]) {
      const w = resolveWritebackRoute(input);
      expect(w.via).toBe('refused');
      if (w.via !== 'refused') throw new Error('unreachable');
      // The refusal names the RULE. "Not configured" would send an operator
      // looking for a setting that must never exist on a clone.
      expect(w.why).toMatch(/shared record|does not hold/);
      expect(() => writebackRequestUrl(w, 'Intake')).toThrow();
    }
  });

  it('the type carries no broker option at all', () => {
    expect(src).not.toMatch(/WritebackRoute[\s\S]{0,400}via: 'broker'/);
  });
});

describe('every Airtable reader in the pipeline goes through the router', () => {
  it('none of the five names api.airtable.com itself', () => {
    for (const [name, source] of [
      ['airtable-proxy', proxy],
      ['listings-cache', cache],
      ['listing-images', images],
      ['listing-enrichment', enrichment],
      ['auto-report-sync', autoReport],
    ] as const) {
      expect(codeOf(source), name).not.toContain('api.airtable.com');
    }
  });

  it('none of them builds an Airtable bearer header of its own', () => {
    for (const source of [proxy, cache, images, enrichment, autoReport]) {
      expect(codeOf(source)).not.toMatch(/Authorization: `Bearer \$\{[^}]*[Tt]oken/);
    }
  });

  it('the two writers refuse rather than reporting a missing setting', () => {
    for (const source of [images, enrichment]) {
      expect(source).toContain('resolveWritebackRoute');
      expect(source).toMatch(/via === 'refused'/);
    }
  });

  it('listing-images chunks a sweep larger than one read may name', () => {
    // A sweep can claim 120; the old code sent `pageSize=${listingIds.length}`,
    // which Airtable rejects above 100.
    expect(images).toContain('MAX_RECORD_IDS');
    expect(codeOf(images)).not.toMatch(/pageSize=\$\{listingIds\.length\}/);
  });

  it('a brokered refusal is told apart from a vendor one at every reader', () => {
    // The rule, not the mechanism: each reader must SEPARATE the ends. It used
    // to be asserted as "contains the header literal", which passed for four
    // hand-written two-way copies of a rule that turned out to have three
    // outcomes — and every one of them would have needed finding again.
    for (const [name, source] of [
      ['airtable-proxy', proxy],
      ['listings-cache', cache],
      ['listing-images', images],
      ['auto-report-sync', autoReport],
    ] as const) {
      expect(codeOf(source), name).toContain('describeListingsFailure');
    }
  });

  it('and no reader spells the header itself', () => {
    // One implementation. Four is how a fifth outcome gets added in one place
    // and the other three keep reporting the old two.
    for (const [name, source] of [
      ['airtable-proxy', proxy],
      ['listings-cache', cache],
      ['listing-images', images],
      ['auto-report-sync', autoReport],
    ] as const) {
      expect(codeOf(source), name).not.toContain('x-mission-control-refusal');
      expect(codeOf(source), name).not.toContain('missionControlRefusal');
    }
  });
});

/**
 * When a brokered read fails, the clone must be able to say WHICH END refused.
 *
 * Mission Control and Airtable both answer 401, 403 and 429, and the remedies
 * are opposite: one is fixed in Mission Control's environment, the other on
 * this deployment. `x-mission-control-refusal` is set on Mission Control's OWN
 * refusals and never on what it relays, so the header's ABSENCE is what
 * identifies a vendor answer.
 *
 * Measured 8 Sep 2026 on NPC Test — the first brokered read the fleet ever
 * made. It failed and `listings_cache_sync.last_error` read `airtable_401`,
 * which happened to be TRUE (Mission Control had made the call and Airtable
 * refused its token). But it was true by luck: the same six characters would
 * have been written had Mission Control rejected the clone's key, and an
 * operator reading that row had nothing to tell the two apart.
 */
describe('a failed read names the end that refused', () => {
  const withHeader = new Headers({ 'x-mission-control-refusal': 'unauthorized' });
  const without = new Headers();

  it('reads the header rather than guessing from the body', () => {
    expect(missionControlRefusal(withHeader)).toBe('unauthorized');
    expect(missionControlRefusal(without)).toBeNull();
  });

  it('every consumer that can take the brokered route reads it', () => {
    // `listing-enrichment` is deliberately absent: its only Airtable call is
    // the write-back, which is never brokered, so there is no second end for
    // it to distinguish.
    for (const [name, source] of [
      ['airtable-proxy', proxy],
      ['listings-cache', cache],
      ['listing-images', images],
      ['auto-report-sync', autoReport],
    ] as const) {
      expect(codeOf(source), name).toMatch(
        /describeListingsFailure|missionControlRefusal|x-mission-control-refusal/,
      );
    }
  });

  it('listings-cache carries the distinction out to the sync row', () => {
    // The sync row is the only record an operator sees for a cron-driven read,
    // so a warning in a log the fleet page does not show is not enough. The
    // rule is that the walk's `error` comes from the classifier — not that it
    // is spelled as one particular expression.
    const walk = codeOf(cache);
    expect(walk).toMatch(/const failure = describeListingsFailure\(config\.route, response\)/);
    expect(walk).toMatch(/error: failure\.detail/);
  });

  it('neither consumer spells the code itself any more', () => {
    // Two hand-written copies of the same three-way rule is how one surface
    // comes to report something the other does not.
    for (const [name, source] of [
      ['airtable-proxy', proxy],
      ['listings-cache', cache],
    ] as const) {
      expect(codeOf(source), name).not.toMatch(/`mission_control_\$\{/);
      expect(codeOf(source), name).not.toMatch(/`airtable_\$\{response/);
    }
  });

  it('airtable-proxy labels the SERVICE it reports, rather than always saying Airtable', () => {
    expect(codeOf(proxy)).toMatch(/redactUpstreamError\([^)]*service\)/);
    expect(codeOf(proxy)).not.toMatch(/redactUpstreamError\([^)]*'Airtable'\)/);
  });
});

describe('a brokered answer nobody marked never reached Mission Control', () => {
  /*
   * The reading that did not exist, and what its absence cost.
   *
   * Measured 8 Sep 2026: one clone recorded `airtable_404` on every Listings
   * sync for a morning while the two beside it were served normally, and
   * nothing from it reached Mission Control's ledger at any tick. Its bundle
   * carried the broker, so it had addressed whatever MISSION_CONTROL_URL
   * named — and wrote the answer down as the vendor's, which is where it sent
   * everyone who looked.
   */
  const BROKER = resolveListingsRoute({
    airtableToken: null,
    airtableBaseId: null,
    ...MC,
  });
  const DIRECT = resolveListingsRoute({
    airtableToken: 'pat123',
    airtableBaseId: 'appNPC',
    ...MC,
  });
  const marked = (extra: Record<string, string> = {}) =>
    new Headers({ [MISSION_CONTROL_ENDPOINT_HEADER]: 'listings', ...extra });

  it('knows Mission Control answered from the endpoint header alone', () => {
    expect(missionControlAnswered(marked())).toBe(true);
    expect(missionControlAnswered(new Headers())).toBe(false);
  });

  it('an unmarked brokered answer is neither end we know', () => {
    const f = describeListingsFailure(BROKER, { status: 404, headers: new Headers() });
    expect(f.end).toBe('not_mission_control');
    expect(f.code).toBe('mission_control_unreachable_404');
    // The remedy has to name the setting, because investigating Airtable
    // cannot succeed and looks reasonable for as long as you like.
    expect(f.service).toMatch(/MISSION_CONTROL_URL/);
  });

  it('a marked relay is the vendor answering', () => {
    const f = describeListingsFailure(BROKER, { status: 401, headers: marked() });
    expect(f.end).toBe('airtable');
    expect(f.code).toBe('airtable_401');
  });

  it("a marked refusal is Mission Control's own no", () => {
    const f = describeListingsFailure(BROKER, {
      status: 401,
      headers: marked({ 'x-mission-control-refusal': 'unauthorized' }),
    });
    expect(f.end).toBe('mission_control');
    expect(f.code).toBe('mission_control_unauthorized');
  });

  it('the direct route can only ever be the vendor', () => {
    // Nothing sits between this deployment and Airtable, so an unmarked
    // answer there means exactly what it always meant.
    const f = describeListingsFailure(DIRECT, { status: 404, headers: new Headers() });
    expect(f.end).toBe('airtable');
    expect(f.code).toBe('airtable_404');
  });

  it('the three codes share no spelling', () => {
    const codes = [
      describeListingsFailure(BROKER, { status: 404, headers: new Headers() }).code,
      describeListingsFailure(BROKER, { status: 404, headers: marked() }).code,
      describeListingsFailure(BROKER, {
        status: 404,
        headers: marked({ 'x-mission-control-refusal': 'rate_limited' }),
      }).code,
    ];
    expect(new Set(codes).size).toBe(3);
  });

  it('reports rather than throws on a route that made no call', () => {
    // This runs on a failure path. Throwing here replaces a real fault with a
    // stack trace about the reporting of it.
    const un = resolveListingsRoute({
      airtableToken: 'pat123',
      airtableBaseId: null,
      ...MC,
    });
    expect(un.via).toBe('unconfigured');
    expect(describeListingsFailure(un, { status: 0, headers: new Headers() }).end).toBe(
      'unconfigured',
    );
  });
});

describe('MISSION_CONTROL_URL is an origin, and a path on it is the 404', () => {
  /*
   * Measured 8 Sep 2026. NPC Client Dashboard recorded `airtable_404` on every
   * Listings sync while the two clones beside it were served normally, and it
   * appeared in Mission Control's ledger zero times. Its deployed bundle
   * carried the broker and composed the path correctly, and Mission Control's
   * endpoint answers 401 (not 404) to an unknown key — so the request was
   * reaching a URL nobody serves.
   *
   * Probed directly: `…/api/api/public/listings/tables` answers 404 with none
   * of Mission Control's headers on it, and nothing is metered because no
   * handler runs. A base of `…/api` composes exactly that.
   */
  it('trims a path and says what it trimmed', () => {
    const r = missionControlOrigin('https://mc.example/api');
    expect(r.origin).toBe('https://mc.example');
    expect(r.trimmedPath).toBe('/api');
  });

  it('leaves a bare origin alone and reports no trim', () => {
    const r = missionControlOrigin('https://mc.example');
    expect(r.origin).toBe('https://mc.example');
    expect(r.trimmedPath).toBeUndefined();
  });

  it('still trims trailing slashes, which it always did', () => {
    expect(missionControlOrigin('https://mc.example///').origin).toBe('https://mc.example');
    expect(missionControlOrigin('https://mc.example///').trimmedPath).toBeUndefined();
  });

  it('hands back an unparseable value rather than emptying it', () => {
    // An empty string reads as "not configured" and sends an operator to the
    // opposite remedy from the one they need.
    expect(missionControlOrigin('mission-control').origin).toBe('mission-control');
  });

  it('the brokered route composes from the origin, never the path', () => {
    const r = resolveListingsRoute({
      airtableToken: null,
      airtableBaseId: null,
      missionControlUrl: 'https://mc.example/api',
      cloneApiKey: 'ck_live',
    });
    expect(r.via).toBe('broker');
    if (r.via !== 'broker') throw new Error('unreachable');
    expect(r.missionControlUrl).toBe('https://mc.example');
    expect(r.trimmedPath).toBe('/api');
    expect(listingsRequestUrl(r, 'tables', 'tblX')).toContain(
      'https://mc.example/api/public/listings/tables',
    );
    expect(listingsRequestUrl(r, 'tables', 'tblX')).not.toContain('/api/api/');
  });

  it('a failure names the URL that was addressed, and the trim', () => {
    const r = resolveListingsRoute({
      airtableToken: null,
      airtableBaseId: null,
      missionControlUrl: 'https://mc.example/api',
      cloneApiKey: 'ck_live',
    });
    const f = describeListingsFailure(r, { status: 404, headers: new Headers() });
    expect(f.end).toBe('not_mission_control');
    expect(f.service).toContain('https://mc.example');
    expect(f.detail).toContain('/api');
  });

  it('the code stays stable while the URL travels in detail', () => {
    // The code is grepped and compared across ticks; anything variable in it
    // makes two readings of the same fault look like two faults.
    const withPath = resolveListingsRoute({
      airtableToken: null, airtableBaseId: null,
      missionControlUrl: 'https://a.example/api', cloneApiKey: 'ck',
    });
    const without = resolveListingsRoute({
      airtableToken: null, airtableBaseId: null,
      missionControlUrl: 'https://b.example', cloneApiKey: 'ck',
    });
    const a = describeListingsFailure(withPath, { status: 404, headers: new Headers() });
    const b = describeListingsFailure(without, { status: 404, headers: new Headers() });
    expect(a.code).toBe(b.code);
    expect(a.service).not.toBe(b.service);
  });

  it('listings-cache carries the detail out to the sync row', () => {
    expect(codeOf(cache)).toMatch(/failure\.detail \? `\$\{failure\.code\}; \$\{failure\.detail\}`/);
  });
});

describe('a vendor status names the ROAD it came by', () => {
  /*
   * Both roads reach Airtable and both report its status, so `airtable_404`
   * alone is true on either and distinguishes nothing.
   *
   * Measured 8 Sep 2026. NPC Client Dashboard answered `airtable_404` on every
   * Listings sync for five hours while appearing ZERO times in Mission
   * Control's ledger. Mission Control marks every answer it gives, so a
   * brokered relay would have carried that mark — leaving only the direct
   * road, taken because a withheld secret stops Mission Control FORWARDING a
   * value and does not remove one already on the project. Every reading the
   * clone produced was true. None of them said which road it had taken.
   */
  const DIRECT = resolveListingsRoute({
    airtableToken: 'pat123', airtableBaseId: 'appNPC',
    missionControlUrl: 'https://mc.example', cloneApiKey: 'ck_live',
  });
  const BROKER = resolveListingsRoute({
    airtableToken: null, airtableBaseId: null,
    missionControlUrl: 'https://mc.example', cloneApiKey: 'ck_live',
  });
  const marked = new Headers({ [MISSION_CONTROL_ENDPOINT_HEADER]: 'listings' });

  it('names a direct read, and the two settings that put it on that road', () => {
    const f = describeListingsFailure(DIRECT, { status: 404, headers: new Headers() });
    expect(f.detail).toContain('directly');
    expect(f.detail).toContain('AIRTABLE_TOKEN');
    expect(f.detail).toContain('AIRTABLE_BASE_ID');
  });

  it('names a relay as Mission Control having made the call', () => {
    const f = describeListingsFailure(BROKER, { status: 404, headers: marked });
    expect(f.detail).toContain('brokered');
  });

  it('the two roads to the same status are told apart', () => {
    const direct = describeListingsFailure(DIRECT, { status: 404, headers: new Headers() });
    const relay = describeListingsFailure(BROKER, { status: 404, headers: marked });
    // Same end, same code — the code is what gets compared across ticks and
    // must not fork. The detail is what tells them apart.
    expect(direct.end).toBe(relay.end);
    expect(direct.code).toBe(relay.code);
    expect(direct.detail).not.toBe(relay.detail);
  });

  it('no detail ever carries a credential', () => {
    for (const f of [
      describeListingsFailure(DIRECT, { status: 404, headers: new Headers() }),
      describeListingsFailure(BROKER, { status: 404, headers: marked }),
      describeListingsFailure(BROKER, { status: 404, headers: new Headers() }),
    ]) {
      expect(f.detail ?? '').not.toContain('pat123');
      expect(f.detail ?? '').not.toContain('ck_live');
    }
  });
});
