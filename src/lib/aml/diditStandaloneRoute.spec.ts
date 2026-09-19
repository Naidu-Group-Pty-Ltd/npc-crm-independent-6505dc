import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveStandaloneRoute,
} from '../../../supabase/functions/_shared/aml/providers/diditStandaloneRoute.pure.ts';

/**
 * Where a standalone verification call goes.
 *
 * A Didit API key is scoped to an APPLICATION, and that scope includes the
 * application's whole session list — every customer's name and live
 * pre-signed URLs to their passport portrait and selfie. Measured against the
 * live account on 7 Sep 2026: one key read all eight sessions. So the
 * credential stops travelling to tenants and the CALL travels instead, through
 * Mission Control, which is already the side that meters what the prime's keys
 * spend.
 *
 * These tests hold the three properties that make that safe.
 */

const VENDOR = 'https://verification.didit.me';
const MC = 'https://mission-control.aurixasystems.com.au';

const base = {
  apiBase: VENDOR,
  missionControlUrl: MC,
  cloneApiKey: 'clone-key',
};

describe('resolveStandaloneRoute — the direct route', () => {
  it('goes to the vendor when this deployment holds the vendor key', () => {
    const route = resolveStandaloneRoute({ ...base, path: '/v3/face-match/', apiKey: 'vendor-key' });
    expect(route.via).toBe('direct');
    if (route.via !== 'direct') return;
    expect(route.url).toBe(`${VENDOR}/v3/face-match/`);
    expect(route.headers['x-api-key']).toBe('vendor-key');
    expect(route.secret).toBe('vendor-key');
  });

  it('prefers the vendor key even where the broker is also configured', () => {
    // The prime holds both: it is the account holder AND it runs Mission
    // Control. Holding the key is what entitles a deployment to spend it.
    const route = resolveStandaloneRoute({ ...base, path: '/v3/id-verification/', apiKey: 'k' });
    expect(route.via).toBe('direct');
  });

  it('meters, because this is the side that spends the vendor key', () => {
    const route = resolveStandaloneRoute({ ...base, path: '/v3/id-verification/', apiKey: 'k' });
    expect(route.via === 'direct' && route.meter).toBe(true);
  });
});

describe('resolveStandaloneRoute — the brokered route', () => {
  it('goes to Mission Control when this deployment holds no vendor key', () => {
    const route = resolveStandaloneRoute({ ...base, path: '/v3/face-match/', apiKey: null });
    expect(route.via).toBe('broker');
    if (route.via !== 'broker') return;
    expect(route.url).toBe(`${MC}/api/public/verification/face-match`);
    expect(route.headers['x-clone-api-key']).toBe('clone-key');
    expect(route.secret).toBe('clone-key');
  });

  it('is NOT metered here — Mission Control meters the vendor call it makes', () => {
    // Metering at both ends bills the tenant twice, which this platform's own
    // rule names as worse than not billing at all. `meter` is what carries it.
    for (const path of ['/v3/id-verification/', '/v3/passive-liveness/', '/v3/face-match/']) {
      const route = resolveStandaloneRoute({ ...base, path, apiKey: null });
      expect(route.via).toBe('broker');
      expect(route.via === 'broker' && route.meter).toBe(false);
    }
  });

  it('never points a brokered call at the vendor', () => {
    // The whole point of the hop is that the tenant's request carries no
    // vendor credential; a brokered URL on the vendor host would be an
    // unauthenticated call that reads as a customer failing verification.
    const route = resolveStandaloneRoute({ ...base, path: '/v3/face-match/', apiKey: null });
    expect(route.via === 'broker' && route.url.startsWith(MC)).toBe(true);
    expect(JSON.stringify(route)).not.toContain('didit.me');
  });

  it('never carries the vendor key name on the brokered hop', () => {
    const route = resolveStandaloneRoute({ ...base, path: '/v3/face-match/', apiKey: '' });
    expect(route.via === 'broker' && route.headers['x-api-key']).toBeFalsy();
  });

  it('tolerates a trailing slash on the Mission Control URL', () => {
    const route = resolveStandaloneRoute({
      ...base,
      missionControlUrl: `${MC}///`,
      path: '/v3/face-match/',
      apiKey: null,
    });
    expect(route.via === 'broker' && route.url).toBe(`${MC}/api/public/verification/face-match`);
  });
});

describe('resolveStandaloneRoute — unconfigured', () => {
  it('refuses rather than making an unauthenticated vendor call', () => {
    const route = resolveStandaloneRoute({
      path: '/v3/face-match/',
      apiKey: null,
      apiBase: VENDOR,
      missionControlUrl: null,
      cloneApiKey: null,
    });
    expect(route.via).toBe('unconfigured');
    // Nothing that could be handed to `fetch`.
    expect(JSON.stringify(route)).not.toContain('http');
  });

  it('refuses on half a broker, either half', () => {
    for (const half of [
      { missionControlUrl: MC, cloneApiKey: null },
      { missionControlUrl: null, cloneApiKey: 'clone-key' },
      { missionControlUrl: '   ', cloneApiKey: 'clone-key' },
      { missionControlUrl: MC, cloneApiKey: '   ' },
    ]) {
      const route = resolveStandaloneRoute({
        ...base, ...half, path: '/v3/face-match/', apiKey: null,
      });
      expect(route.via).toBe('unconfigured');
      expect(route.via === 'unconfigured' && route.why).toMatch(/MISSION_CONTROL|DIDIT_API_KEY/);
    }
  });

  it('treats a blank vendor key as no key, never as a key', () => {
    // An env var set to an empty string is how a half-provisioned deployment
    // looks; `'   '` as an `x-api-key` is a 401 that reads like a rejected
    // customer.
    for (const blank of ['', '   ', null, undefined]) {
      const route = resolveStandaloneRoute({ ...base, path: '/v3/face-match/', apiKey: blank });
      expect(route.via).toBe('broker');
    }
  });

  it('refuses a path the broker does not carry rather than attempting it', () => {
    const route = resolveStandaloneRoute({ ...base, path: '/v3/sessions/', apiKey: null });
    expect(route.via).toBe('unconfigured');
    expect(route.via === 'unconfigured' && route.why).toContain('/v3/sessions/');
  });
});

describe('the route and the calls it has to carry', () => {
  const clientSrc = readFileSync(
    resolve(
      __dirname,
      '../../../supabase/functions/_shared/aml/providers/diditStandaloneClient.ts',
    ),
    'utf8',
  );

  it('brokers every vendor path this client actually posts to', () => {
    // The drift that would break a brokered tenant silently: a fourth call
    // added to the client with no operation on the broker. Read the paths from
    // the client rather than restating them here.
    const paths = [...clientSrc.matchAll(/postMultipart\([^,]+,\s*'([^']+)'/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThanOrEqual(3);
    for (const path of paths) {
      const route = resolveStandaloneRoute({ ...base, path, apiKey: null });
      expect(route.via, `${path} is not an operation Mission Control brokers`).toBe('broker');
    }
  });

  it('meters exactly where the route says to', () => {
    // `meteredFetch` on the broker route would bill the tenant twice; a plain
    // `fetch` on the direct route would bill it to nobody.
    expect(clientSrc).toContain('route.meter');
    expect(clientSrc.match(/meteredFetch\(/g)?.length).toBe(1);
    expect(clientSrc).toContain('await fetch(route.url, init)');
    // The other way to double-bill is to log adjacently to a metered call.
    expect(clientSrc).not.toContain('logApiUsage');
  });

  it('does not report a brokered deployment as unconfigured', () => {
    /*
     * A tenant deliberately holds no Didit key, so "no key" must not mean "not
     * ready" — one function decides it (`standaloneIdvReadiness`), and
     * `adapterConfigured` and the Command Centre card both read that one
     * answer. Gating readiness on the key alone would have every brokered
     * clone reporting `misconfigured` while verifying perfectly.
     */
    const providers = readFileSync(
      resolve(__dirname, '../../../supabase/functions/_shared/aml/providers/index.ts'),
      'utf8',
    );
    const fn = providers.slice(
      providers.indexOf('export function standaloneIdvReadiness'),
      providers.indexOf('function adapterConfigured'),
    );
    expect(fn).toContain('MISSION_CONTROL_CLONE_API_KEY');
    expect(fn).not.toMatch(/ready:\s*apiKeyPresent/);
    expect(fn).toContain('credential !== "none"');
    // Thresholds stay required on BOTH routes: they are this deployment's own
    // policy, and the broker neither supplies nor overrides them.
    expect(fn).toContain('liveness === "ok" && faceMatch === "ok"');
  });

  it('never writes the multipart Content-Type, on either route', () => {
    // `fetch` derives `multipart/form-data; boundary=…` from the FormData
    // body. Writing the header drops the boundary and every request becomes a
    // 400 that looks like an unreadable photograph — and the broker forwards
    // the header onward, so one hand-written header breaks both hops.
    const routeSrc = readFileSync(
      resolve(
        __dirname,
        '../../../supabase/functions/_shared/aml/providers/diditStandaloneRoute.pure.ts',
      ),
      'utf8',
    );
    expect(routeSrc.toLowerCase()).not.toContain('multipart/form-data');
    for (const path of ['/v3/face-match/']) {
      for (const apiKey of ['k', null]) {
        const route = resolveStandaloneRoute({ ...base, path, apiKey });
        if (route.via === 'unconfigured') throw new Error('unexpected');
        const names = Object.keys(route.headers).map((h) => h.toLowerCase());
        expect(names).not.toContain('content-type');
      }
    }
  });
});

describe('the self-test proves reachability without spending anything', () => {
  const clientSrc = readFileSync(
    resolve(
      __dirname,
      '../../../supabase/functions/_shared/aml/providers/diditStandaloneClient.ts',
    ),
    'utf8',
  );
  const probeSrc = clientSrc.slice(clientSrc.indexOf('export async function probeStandaloneRoute'));
  const verificationSrc = readFileSync(
    resolve(__dirname, '../../../supabase/functions/aml-verification/index.ts'),
    'utf8',
  );

  it('exists, because configuration is not reachability', () => {
    // Every readiness reading in this product answers a question about
    // configuration, and all of them were green on three tenants that had
    // never completed a verification.
    expect(probeSrc.length).toBeGreaterThan(0);
    expect(verificationSrc).toContain('case "verification_selftest"');
  });

  it('is NEVER metered — a diagnostic must not reach a tenant\'s invoice', () => {
    expect(probeSrc).toContain('await fetch(route.url');
    expect(probeSrc).not.toContain('meteredFetch');
  });

  it('writes nothing: no record, no case, no check', () => {
    for (const forbidden of ['.insert(', '.update(', '.upsert(', '.delete(', 'appendEvent']) {
      expect(probeSrc, forbidden).not.toContain(forbidden);
    }
  });

  it('sends an INCOMPLETE body, which is what makes the vendor reject it for free', () => {
    // Being rejected at validation is the pass: it proves the call
    // authenticated, arrived and was answered, with nothing billed.
    expect(probeSrc).toContain('body: new FormData()');
  });

  it('reads WHO refused from a header, never guesses it from a body', () => {
    // Mission Control's 401 and the vendor's 401 are the same status with a
    // similar body and opposite remedies. Only Mission Control can set this.
    // The name is Mission Control's; this end must spell it identically, so
    // the literal is pinned here and the probe is pinned to the constant.
    expect(clientSrc).toContain("const MC_REFUSAL_HEADER = 'x-mission-control-refusal';");
    expect(probeSrc).toContain('res.headers.get(MC_REFUSAL_HEADER)');
    expect(probeSrc).toContain("answered_by: 'mission_control'");
    expect(probeSrc).toContain("answered_by: 'vendor'");
  });

  it('reports the host, never the URL and never a credential', () => {
    expect(probeSrc).toContain('new URL(route.url).host');
    // The only thing that ever carries the secret is the redaction call.
    const secretMentions = probeSrc.match(/route\.secret/g) ?? [];
    expect(secretMentions.length).toBe(1);
    expect(probeSrc).toContain('redact(');
  });

  it('is offered to a reviewer or an MLRO, never to an analyst', () => {
    const at = verificationSrc.indexOf('case "verification_selftest"');
    const block = verificationSrc.slice(at, at + 700);
    expect(block).toContain('!roles.has("reviewer") && !roles.has("mlro")');
  });

  it('says the vendor rejecting it is the PASS, so nobody reads it as a fault', () => {
    const at = verificationSrc.indexOf('case "verification_selftest"');
    const block = verificationSrc.slice(at, at + 1400);
    expect(block).toContain('spent: false');
    expect(block).toContain('Verification can reach the provider on this route.');
  });
});

describe('Mission Control can ask a clone the same question', () => {
  const webhook = readFileSync(
    resolve(__dirname, '../../../supabase/functions/mission-control-webhook/index.ts'),
    'utf8',
  );

  it('answers the probe on the signed webhook channel', () => {
    // The alternative was admitting a service credential to `aml-verification`,
    // which deliberately refuses service_role outright — that function serves
    // people, and one hole in it for a diagnostic is how such a boundary stops
    // meaning anything.
    expect(webhook).toContain('if (event === "verification.selftest")');
    expect(webhook).toContain('probeStandaloneRoute()');
  });

  it('runs it BEFORE the de-dupe, because a probe asked twice must ask twice', () => {
    // Everything past the de-dupe is an event applied exactly once. Keyed like
    // one, a second probe would be answered from a table without making the
    // call — the stale reading it exists to replace.
    const probeAt = webhook.indexOf('if (event === "verification.selftest")');
    // The INSERT, not the comment at the top of the file that names the table.
    const dedupeAt = webhook.indexOf('from("token_webhook_events").insert');
    expect(probeAt).toBeGreaterThan(-1);
    expect(dedupeAt).toBeGreaterThan(-1);
    expect(probeAt).toBeLessThan(dedupeAt);
  });

  it('returns the reading rather than storing it', () => {
    const at = webhook.indexOf('if (event === "verification.selftest")');
    const block = webhook.slice(at, at + 500);
    expect(block).toContain('JSON.stringify({ ok: true, event, probe })');
    for (const forbidden of ['.insert(', '.upsert(', '.update(']) {
      expect(block, forbidden).not.toContain(forbidden);
    }
  });
});

describe('the loop check sends a real capture, and says what that costs', () => {
  const loop = readFileSync(
    resolve(
      __dirname,
      '../../../supabase/functions/_shared/aml/providers/diditStandaloneLoopCheck.ts',
    ),
    'utf8',
  );

  /*
   * The module explains itself at length, and prose that NAMES a thing must
   * never stand in for code that DOES it — in either direction. A comment
   * saying "no verification_checks row" is not a write, and a comment is not
   * where a write may hide either. Every guard below that judges behaviour
   * judges this.
   */
  const code = loop.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('runs the PRODUCTION calls, never a reimplementation of them', () => {
    // A test that reimplements the call proves the reimplementation works,
    // which is not the question anybody is asking.
    for (const fn of ['verifyIdentityDocument(', 'checkPassiveLiveness(', 'compareFaces(']) {
      expect(loop, fn).toContain(fn);
    }
    // And therefore goes through the one route resolver and the one
    // postMultipart — no second HTTP call of its own.
    expect(loop).not.toContain('await fetch(');
  });

  it('covers all three operations, because that is the loop', () => {
    for (const op of ["'id-verification'", "'passive-liveness'", "'face-match'"]) {
      expect(loop, op).toContain(op);
    }
  });

  it('writes NO compliance record', () => {
    // The AML record is a regulated artifact about real customers. Putting a
    // synthetic identity in it to prove a network path works corrupts the
    // thing being protected.
    for (const forbidden of ['.insert(', '.update(', '.upsert(', 'verification_checks', 'aml.cases']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    // It cannot reach a table at all: no client is constructed and none is taken.
    expect(code).not.toContain('createClient');
    expect(code).not.toContain('supabase');
    expect(loop).toContain('wrote_compliance_record: false');
  });

  it('declares that it spends, unlike the probe', () => {
    expect(loop).toContain('spends: true');
  });

  it('reads no credential and resolves no route of its own', () => {
    /*
     * Both for the same reason. `diditAmlScope.test.ts` keeps an explicit list
     * of files permitted to name DIDIT_API_KEY and a diagnostic must not join
     * it; and a route resolved here would restate the API base and its
     * default, so a drift would report a route the calls did not take — a
     * diagnostic lying about the one thing it measures.
     */
    expect(code).not.toContain('Deno.env.get');
    expect(code).not.toContain('resolveStandaloneRoute(');
    expect(code).toContain('describeStandaloneRoute(');
  });

  it('carries a real, decodable JPEG rather than a header with padding', () => {
    /*
     * The seed is decoded here rather than described. A capture that is not a
     * JPEG is refused by the vendor for being unreadable, which is the SAME
     * 400 a vendor returns when a multipart part never arrived — so the one
     * thing this check exists to tell apart would be indistinguishable.
     */
    const literal = /const SEED_JPEG_BASE64 =\s*([\s\S]*?);\n/.exec(loop);
    expect(literal, 'SEED_JPEG_BASE64 is declared').not.toBeNull();
    const b64 = Array.from(literal![1].matchAll(/'([^']*)'/g), (m) => m[1]).join('');
    const seed = Buffer.from(b64, 'base64');

    expect(seed.length, 'the seed decodes to bytes').toBeGreaterThan(100);
    expect([seed[0], seed[1]], 'starts with SOI').toEqual([0xff, 0xd8]);
    expect(
      [seed[seed.length - 2], seed[seed.length - 1]],
      'ends with EOI',
    ).toEqual([0xff, 0xd9]);

    /*
     * And the padding goes INSIDE the image: SOI, then COM segments, then the
     * rest of the seed ending in EOI. Bytes appended past EOI are trailing
     * garbage a strict decoder discards, so the size would be a claim about
     * the request that the decoded image does not support.
     */
    const soi = code.indexOf('seed.subarray(0, 2)');
    const com = code.indexOf('0xfe');
    const tail = code.indexOf('seed.subarray(2)');
    expect(soi, 'SOI is emitted first').toBeGreaterThan(-1);
    expect(com, 'a COM marker is written').toBeGreaterThan(soi);
    expect(tail, 'the rest of the image follows the padding').toBeGreaterThan(com);
  });

  it('counts a transport failure as the loop NOT closing', () => {
    // "The vendor refused it" and "it never got there" are opposite readings.
    // Only the first proves the file arrived.
    expect(loop).toContain("DID_NOT_REACH");
    for (const cat of ["'provider_unavailable'", "'timeout'", "'provider_not_configured'"]) {
      expect(loop, cat).toContain(cat);
    }
  });

  it('keeps the vendor handle free of anything person-shaped', () => {
    expect(loop).toContain('npc:loopcheck:${crypto.randomUUID()}:1');
  });
});
