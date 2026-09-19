/**
 * The Standalone requests **as they actually reach the network**, and the
 * orchestrator that produces them, run for real against a mocked Didit.
 *
 * ## Why this file exists next to `diditStandaloneIntegration.test.ts`
 *
 * That file asserts on SOURCE TEXT — `expect(CLIENT).toContain("form.append(
 * 'save_api_request', 'true')")`. That is a useful lock on which code exists,
 * and it is not evidence about what is sent: it passes if the line is present
 * and unreachable, if a second call site overrides it, if the field is appended
 * to a `FormData` that is then discarded, or if a caller builds its own body.
 * The one production sequence that has ever been billed on this account went
 * out with `save_api_request=false`, so nothing about that flag may be taken on
 * a substring match again.
 *
 * So everything here is **executed**. `globalThis.fetch` is replaced with a
 * mock Didit; the real `diditStandaloneClient.ts` builds the real `FormData`;
 * that body is encoded to multipart bytes by the same runtime primitive `fetch`
 * uses, and then **re-parsed out of those bytes** the way a server would. The
 * assertions read the parsed wire, never the source.
 *
 * The orchestration scenarios below then drive the real
 * `standaloneVerification.ts` — the real fail-fast rule, the real claim, the
 * real settlement — against that same mock, so "the third call is not made
 * after a decline" is a property of the code rather than of a comment.
 *
 * Nothing here reaches the network: `fetch` is stubbed for every test and the
 * stub throws on any host it was not told about.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';

/* ────────────────────── one realm for the body types ────────────────────── */

/**
 * jsdom replaces `FormData` and `Blob`; it does not replace `Request` and
 * `Response`, which stay Node's. Those are two realms, and the seam between
 * them is silent: undici's multipart serialiser does not recognise a jsdom
 * `Blob`, so it encodes every image part as `filename="blob"` with the literal
 * nine-character body `undefined` — no error, no warning, a body that looks
 * plausible and contains no image.
 *
 * A test that measured that would be measuring the word "undefined" and calling
 * it a photograph, which is exactly the class of false confidence this file
 * exists to remove. So all four types are pinned to Node's own
 * implementations — `Blob`/`File` from `node:buffer`, and `FormData` recovered
 * from a `Response` because Node does not export it from a module. That is one
 * realm, and it is the same multipart writer `fetch` uses in the Edge runtime.
 *
 * This is a property of testing a Deno module under jsdom and says nothing
 * about production: the Edge runtime has exactly one `Blob`.
 */
globalThis.Blob = NodeBlob as unknown as typeof globalThis.Blob;
globalThis.File = NodeFile as unknown as typeof globalThis.File;
globalThis.FormData = (await new Response('a=b', {
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
}).formData()).constructor as unknown as typeof globalThis.FormData;

/* ─────────────────────────── the Deno shim ──────────────────────────────── */

/**
 * `diditStandaloneClient.ts` reads `DIDIT_API_BASE_URL` at MODULE level, so the
 * environment has to exist before the first import of it. Declared here, at the
 * top of the file, for that reason — and mutated per test through `ENV`.
 */
const ENV = new Map<string, string>([
  ['DIDIT_API_KEY', 'test-key-suffix-ABCD'],
  ['DIDIT_LIVENESS_THRESHOLD', '50'],
  ['DIDIT_FACE_MATCH_THRESHOLD', '60'],
  ['AML_ENVIRONMENT', 'production'],
  ['AML_PROVIDER_MODE', 'live'],
  ['SUPABASE_URL', 'https://project.supabase.co'],
]);

(globalThis as unknown as { Deno: unknown }).Deno = {
  env: { get: (key: string) => ENV.get(key) },
};

const client = await import(
  '../../../supabase/functions/_shared/aml/providers/diditStandaloneClient.ts');
const orchestrator = await import(
  '../../../supabase/functions/_shared/aml/standaloneVerification.ts');

/* ──────────────────────── the wire recorder ─────────────────────────────── */

interface WireRequest {
  url: string;
  method: string;
  apiKey: string | null;
  /** The header `fetch` derived from the body. Must carry a boundary. */
  contentType: string | null;
  /** The encoded multipart bytes, decoded 1:1 so headers are readable. */
  raw: string;
  /** Non-file parts, parsed back out of the encoded bytes. */
  fields: Record<string, string>;
  /** File parts, parsed back out of the encoded bytes. */
  files: Record<string, { filename: string; type: string; bytes: number }>;
}

let wire: WireRequest[] = [];
/** Responses the mock Didit will give, in order, keyed by endpoint path. */
let responder: (path: string, call: number) => { status: number; body: unknown };
/** What the media host answers for a portrait URL fetch. */
let mediaResponder: (url: string) => Response | null;

/**
 * Encode a request exactly as `fetch` would, then read it back apart.
 *
 * `new Request(url, init)` is the primitive `fetch` uses to normalise its
 * arguments: it is what derives `multipart/form-data; boundary=…` from a
 * `FormData` body. Taking the bytes from it and re-parsing them through
 * `Response.formData()` means every assertion below is made against a real
 * multipart encode/decode round-trip rather than against the `FormData` object
 * the client happened to hand over.
 */
async function record(url: string, init: RequestInit): Promise<WireRequest> {
  const encoded = new Request(url, init);
  const contentType = encoded.headers.get('content-type');
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  const raw = new TextDecoder('latin1').decode(bytes);

  const fields: Record<string, string> = {};
  const files: Record<string, { filename: string; type: string; bytes: number }> = {};
  if (contentType?.startsWith('multipart/form-data')) {
    const parsed = await new Response(bytes, {
      headers: { 'content-type': contentType },
    }).formData();
    for (const [key, value] of parsed.entries()) {
      if (typeof value === 'string') fields[key] = value;
      else {
        files[key] = {
          filename: value.name, type: value.type, bytes: value.size,
        };
      }
    }
  }

  return {
    url,
    method: String(init.method ?? 'GET'),
    apiKey: (init.headers as Record<string, string> | undefined)?.['x-api-key'] ?? null,
    contentType, raw, fields, files,
  };
}

const DIDIT_HOST = 'https://verification.didit.me';
const MEDIA_HOST = 'https://service-didit-verification-production-a1c5f9b8.s3.amazonaws.com';

beforeEach(() => {
  wire = [];
  responder = () => ({ status: 200, body: {} });
  mediaResponder = () => null;

  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);

    if (url.startsWith(DIDIT_HOST)) {
      const captured = await record(url, init);
      wire.push(captured);
      const path = new URL(url).pathname;
      const calls = wire.filter((w) => new URL(w.url).pathname === path).length;
      const answer = responder(path, calls);
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    // The portrait fetch. Recorded too, so "the credential is never sent to a
    // media host" is an assertion rather than a claim.
    wire.push(await record(url, init));
    const answer = mediaResponder(url);
    if (answer) return answer;
    throw new Error(`unstubbed host: ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const didit = () => wire.filter((w) => w.url.startsWith(DIDIT_HOST));
const pathsCalled = () => didit().map((w) => new URL(w.url).pathname);

/* ───────────────────────── realistic payloads ───────────────────────────── */

const jpeg = (n: number) => {
  const out = new Uint8Array(n);
  out[0] = 0xff; out[1] = 0xd8; out[2] = 0xff; out[n - 2] = 0xff; out[n - 1] = 0xd9;
  return out;
};

const PORTRAIT_URL = `${MEDIA_HOST}/ocr/req-portrait_image-abc.jpg?X-Amz-Signature=deadbeef`;
const PORTRAIT_BYTES = jpeg(512);
const PORTRAIT_BASE64 = btoa(String.fromCharCode(...PORTRAIT_BYTES));

/** An approved ID response in the documented shape. `portrait` picks the form. */
const idBody = (opts: {
  status?: 'Approved' | 'Declined';
  portrait?: string | null;
  documentType?: string | null;
  issuingState?: string | null;
  warnings?: Array<{ risk: string; log_type: string }>;
} = {}) => ({
  request_id: 'id-req-0001',
  id_verification: {
    status: opts.status ?? 'Approved',
    document_type: opts.documentType === undefined ? 'Passport' : opts.documentType,
    document_subtype: 'EPASSPORT',
    issuing_state: opts.issuingState === undefined ? 'AUS' : opts.issuingState,
    issuing_state_name: 'Australia',
    expiration_date: '2031-04-02',
    first_name: 'REDACT', last_name: 'ME', full_name: 'REDACT ME',
    address: '1 Test St', date_of_birth: '1980-01-01',
    portrait_image: opts.portrait === undefined ? PORTRAIT_BASE64 : opts.portrait,
    front_image: 'https://media.example/front.jpg',
    back_image: null,
    warnings: opts.warnings ?? [],
  },
  vendor_data: 'npc:case:party',
  metadata: {},
  created_at: '2026-08-14T09:00:00Z',
});

const livenessBody = (status: 'Approved' | 'Declined' = 'Approved', score = 91.2) => ({
  request_id: 'live-req-0001',
  liveness: {
    status, method: 'PASSIVE', score, face_quality: 88.4, face_luminance: 61.0,
    warnings: status === 'Declined' ? [{ risk: 'LOW_LIVENESS_SCORE', log_type: 'error' }] : [],
  },
  created_at: '2026-08-14T09:00:02Z',
});

const faceMatchBody = (status: 'Approved' | 'Declined' = 'Approved', score = 84.7) => ({
  request_id: 'face-req-0001',
  face_match: {
    status, score,
    warnings: status === 'Declined' ? [{ risk: 'LOW_FACE_MATCH_SIMILARITY', log_type: 'error' }] : [],
  },
  created_at: '2026-08-14T09:00:04Z',
});

/* ══════════════════════════════════════════════════════════════════════════
   PART 1 — the three request functions, at the wire
   ══════════════════════════════════════════════════════════════════════════ */

describe('every Standalone request carries save_api_request=true on the wire', () => {
  const metadata = { npc_verification_check_id: 'check-1', npc_capture_sequence: 2 };

  const callers: Array<[string, string, () => Promise<unknown>]> = [
    ['verifyIdentityDocument', '/v3/id-verification/', () => client.verifyIdentityDocument({
      apiKey: 'test-key-suffix-ABCD',
      frontImage: jpeg(4096), backImage: jpeg(3072),
      vendorData: 'npc:case-1:party-1', metadata,
    })],
    ['checkPassiveLiveness', '/v3/passive-liveness/', () => client.checkPassiveLiveness({
      apiKey: 'test-key-suffix-ABCD',
      userImage: jpeg(4096), declineThreshold: 50,
      vendorData: 'npc:case-1:party-1', metadata,
    })],
    ['compareFaces', '/v3/face-match/', () => client.compareFaces({
      apiKey: 'test-key-suffix-ABCD',
      userImage: jpeg(4096), refImage: jpeg(512), declineThreshold: 60,
      vendorData: 'npc:case-1:party-1', metadata,
    })],
  ];

  for (const [name, path, invoke] of callers) {
    it(`${name}() sends save_api_request="true" in the encoded multipart body`, async () => {
      responder = () => ({ status: 200, body: { request_id: 'x' } });
      await invoke();

      expect(wire).toHaveLength(1);
      const sent = wire[0];

      // Parsed back out of the encoded bytes — not read off the FormData.
      expect(sent.fields.save_api_request).toBe('true');
      // And present in the raw wire, in the documented part shape.
      expect(sent.raw).toContain('name="save_api_request"');
      expect(sent.raw).toMatch(
        /name="save_api_request"\r\n\r\ntrue\r\n/);
      // The failure this test exists to catch.
      expect(sent.fields.save_api_request).not.toBe('false');

      expect(new URL(sent.url).pathname).toBe(path);
      expect(sent.url).toBe(`https://verification.didit.me${path}`);
      expect(sent.method).toBe('POST');
      expect(sent.apiKey).toBe('test-key-suffix-ABCD');
    });
  }

  it('the boundary is generated by fetch, never written by the client', async () => {
    responder = () => ({ status: 200, body: {} });
    await callers[0][2]();
    const sent = wire[0];
    expect(sent.contentType).toMatch(/^multipart\/form-data; boundary=.+/);
    // A hand-written header would have no boundary parameter and the server
    // could not split the body.
    expect(sent.contentType!.split('boundary=')[1]?.length ?? 0).toBeGreaterThan(8);
  });

  it('vendor_data is person-scoped and metadata is a JSON string', async () => {
    responder = () => ({ status: 200, body: {} });
    for (const [, , invoke] of callers) await invoke();

    expect(didit()).toHaveLength(3);
    for (const sent of didit()) {
      expect(sent.fields.vendor_data).toBe('npc:case-1:party-1');
      // No attempt suffix: Didit groups persisted requests on this exact string.
      expect(sent.fields.vendor_data.split(':')).toHaveLength(3);
      expect(JSON.parse(sent.fields.metadata)).toEqual({
        npc_verification_check_id: 'check-1', npc_capture_sequence: 2,
      });
    }
  });

  it('sends the documented field names for each endpoint', async () => {
    responder = () => ({ status: 200, body: {} });
    for (const [, , invoke] of callers) await invoke();
    const [id, live, face] = didit();

    expect(Object.keys(id.files).sort()).toEqual(['back_image', 'front_image']);
    expect(id.fields.perform_document_liveness).toBe('true');
    expect(id.fields.invalid_mrz_action).toBe('NO_ACTION');
    expect(id.fields.inconsistent_data_action).toBe('NO_ACTION');
    expect(id.fields.expiration_date_not_detected_action).toBe('NO_ACTION');

    expect(Object.keys(live.files)).toEqual(['user_image']);
    expect(live.fields.face_liveness_score_decline_threshold).toBe('50');

    expect(Object.keys(face.files).sort()).toEqual(['ref_image', 'user_image']);
    expect(face.fields.face_match_score_decline_threshold).toBe('60');

    for (const sent of didit()) {
      for (const file of Object.values(sent.files)) {
        expect(file.type).toBe('image/jpeg');
        expect(file.filename).toMatch(/\.jpg$/);
        expect(file.bytes).toBeGreaterThan(0);
      }
    }
  });

  it('omits back_image when there is none, rather than sending an empty part', async () => {
    responder = () => ({ status: 200, body: {} });
    await client.verifyIdentityDocument({
      apiKey: 'k', frontImage: jpeg(2048), backImage: null,
      vendorData: 'npc:c:p', metadata: {},
    });
    expect(Object.keys(wire[0].files)).toEqual(['front_image']);
    expect(wire[0].raw).not.toContain('name="back_image"');
  });

  it('never sends a hosted-session field', async () => {
    responder = () => ({ status: 200, body: {} });
    for (const [, , invoke] of callers) await invoke();
    for (const sent of didit()) {
      for (const forbidden of ['workflow_id', 'callback', 'expected_details', 'features']) {
        expect(sent.raw, forbidden).not.toContain(`name="${forbidden}"`);
      }
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   PART 2 — the orchestrator, driven for real
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A Supabase-shaped double.
 *
 * Only the operations `standaloneVerification.ts` actually performs are
 * modelled, and every write is retained so a test can assert on the row the
 * sequence would have left behind.
 */
function makeDb(opts: {
  check: Record<string, unknown>;
  providerConfig?: Record<string, unknown> | null;
  storage?: Record<string, Uint8Array>;
  claimable?: boolean;
} = { check: {} }) {
  const writes: Array<{ table: string; verb: string; values: Record<string, unknown> }> = [];
  let claimTaken = false;
  const claimable = opts.claimable ?? true;
  const providerConfig = opts.providerConfig === undefined
    ? {
      id: 'cfg-1', provider_key: 'didit_standalone', mode: 'live',
      config: { standalone_unit_costs_cents: { id_verification: 20, passive_liveness: 5, face_match: 5 } },
      cost_per_unit_cents: 20, priority: 5, active: true,
    }
    : opts.providerConfig;

  let row: Record<string, unknown> = { ...opts.check };

  class Query {
    table: string; verb = 'select'; values: Record<string, unknown> = {};
    constructor(table: string) { this.table = table; }
    select() { return this; }
    update(values: Record<string, unknown>) {
      this.verb = 'update'; this.values = values; return this;
    }
    insert(values: Record<string, unknown>) {
      this.verb = 'insert'; this.values = values; return this;
    }
    eq() { return this; }
    in() { return this; }
    is() { return this; }
    order() { return this; }
    limit() { return this; }
    async maybeSingle() { return this.resolve(); }
    async single() { return this.resolve(); }
    then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
      return this.resolve().then(onOk, onErr);
    }
    async resolve(): Promise<{ data: unknown; error: unknown }> {
      if (this.verb === 'update' || this.verb === 'insert') {
        writes.push({ table: this.table, verb: this.verb, values: this.values });
      }
      if (this.table === 'provider_configs') {
        if (this.verb === 'update') return { data: null, error: null };
        return { data: providerConfig, error: null };
      }
      if (this.table === 'provider_metrics_daily') {
        return { data: null, error: null };
      }
      if (this.table === 'verification_checks') {
        if (this.verb === 'update') {
          // The claim is the only conditional update the double models: it is
          // the one whose losing branch the design depends on.
          const isClaim = this.values.processing_status === 'processing';
          if (isClaim) {
            if (!claimable || claimTaken) return { data: null, error: null };
            claimTaken = true;
            row = { ...row, ...this.values };
            return { data: row, error: null };
          }
          row = { ...row, ...this.values };
          return { data: row, error: null };
        }
        return { data: row, error: null };
      }
      return { data: null, error: null };
    }
  }

  const db = {
    schema() {
      return {
        from: (table: string) => new Query(table),
        rpc: async () => ({ data: 0, error: null }),
      };
    },
    storage: {
      from: () => ({
        download: async (path: string) => {
          const bytes = (opts.storage ?? {})[path];
          if (!bytes) return { data: null, error: { message: 'not found' } };
          return {
            data: { arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer },
            error: null,
          };
        },
      }),
    },
    /** Test-only accessors. */
    _writes: writes,
    _row: () => row,
    _final: () => writes.filter((w) => w.table === 'verification_checks' && w.verb === 'update')
      .slice(-1)[0]?.values ?? {},
  };
  return db;
}

const CHECK_ID = '11111111-2222-3333-4444-555555555555';
const CASE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PARTY_ID = '99999999-8888-7777-6666-555555555555';

const PATHS = {
  front: 'case/front.jpg', back: 'case/back.jpg', selfie: 'case/selfie.jpg',
};

function baseCheck(choice = 'passport') {
  return {
    id: CHECK_ID, case_id: CASE_ID, party_id: PARTY_ID,
    capture_sequence: 2, attempt_number: 2,
    status: 'pending', processing_status: 'queued', attempt_consumed: false,
    outcome_detail: {
      standalone_capture: {
        document_choice: choice,
        objects: {
          document_front: { bucket: 'aml-idv', path: PATHS.front },
          document_back: choice === 'passport' ? null : { bucket: 'aml-idv', path: PATHS.back },
          selfie: { bucket: 'aml-idv', path: PATHS.selfie },
        },
      },
    },
  };
}

const STORAGE = {
  [PATHS.front]: jpeg(9000), [PATHS.back]: jpeg(8000), [PATHS.selfie]: jpeg(7000),
};

describe('the orchestrated sequence, against a mocked Didit', () => {
  it('SCENARIO A — full pass: three calls, all persisted, settles verified', async () => {
    responder = (path) => {
      if (path === '/v3/id-verification/') return { status: 200, body: idBody() };
      if (path === '/v3/passive-liveness/') return { status: 200, body: livenessBody() };
      return { status: 200, body: faceMatchBody() };
    };
    const db = makeDb({ check: baseCheck(), storage: STORAGE });

    const result = await orchestrator.processStandaloneCheck(db, CHECK_ID);

    expect(pathsCalled()).toEqual([
      '/v3/id-verification/', '/v3/passive-liveness/', '/v3/face-match/',
    ]);
    // The whole point of the file, asserted on every outbound call.
    for (const sent of didit()) {
      expect(sent.fields.save_api_request).toBe('true');
      expect(sent.fields.vendor_data).toBe(`npc:${CASE_ID}:${PARTY_ID}`);
      const meta = JSON.parse(sent.fields.metadata);
      expect(meta.npc_verification_check_id).toBe(CHECK_ID);
      expect(meta.npc_capture_sequence).toBe(2);
    }

    expect(result.outcome).toBe('passed');
    const final = db._final();
    expect(final.status).toBe('passed');
    expect(final.processing_status).toBe('completed');
    expect(final.attempt_consumed).toBe(true);
    expect(final.provider).toBe('didit_standalone');
    expect(final.provider_reference).toBe('id-req-0001');
  });

  it('SCENARIO A2 — the evidence records save_api_request: true for the attempt', async () => {
    responder = (path) => {
      if (path === '/v3/id-verification/') return { status: 200, body: idBody() };
      if (path === '/v3/passive-liveness/') return { status: 200, body: livenessBody() };
      return { status: 200, body: faceMatchBody() };
    };
    const db = makeDb({ check: baseCheck(), storage: STORAGE });
    await orchestrator.processStandaloneCheck(db, CHECK_ID);

    const evidence = db._final().outcome_detail as Record<string, any>;
    expect(evidence.standalone.save_api_request).toBe(true);
    expect(evidence.standalone.provider_request_ids).toEqual({
      id_verification: 'id-req-0001',
      passive_liveness: 'live-req-0001',
      face_match: 'face-req-0001',
    });
    // Nothing image-shaped and no OCR'd identity detail survives.
    const blob = JSON.stringify(evidence);
    expect(blob).not.toContain(PORTRAIT_BASE64);
    expect(blob).not.toContain('1 Test St');
    expect(blob).not.toContain('REDACT ME');
  });

  it('SCENARIO B — document declined: ONE call, nothing further is bought', async () => {
    responder = () => ({ status: 200, body: idBody({ status: 'Declined' }) });
    const db = makeDb({ check: baseCheck(), storage: STORAGE });

    const result = await orchestrator.processStandaloneCheck(db, CHECK_ID);

    expect(pathsCalled()).toEqual(['/v3/id-verification/']);
    expect(result.outcome).toBe('failed');
    expect(db._final().attempt_consumed).toBe(true);
  });

  it('SCENARIO C — liveness declined: TWO calls, no face match', async () => {
    responder = (path) => {
      if (path === '/v3/id-verification/') return { status: 200, body: idBody() };
      return { status: 200, body: livenessBody('Declined', 12) };
    };
    const db = makeDb({ check: baseCheck(), storage: STORAGE });

    const result = await orchestrator.processStandaloneCheck(db, CHECK_ID);

    expect(pathsCalled()).toEqual(['/v3/id-verification/', '/v3/passive-liveness/']);
    expect(result.outcome).toBe('failed');
  });

  it('SCENARIO D — face mismatch: three calls, failed outcome', async () => {
    responder = (path) => {
      if (path === '/v3/id-verification/') return { status: 200, body: idBody() };
      if (path === '/v3/passive-liveness/') return { status: 200, body: livenessBody() };
      return { status: 200, body: faceMatchBody('Declined', 21) };
    };
    const db = makeDb({ check: baseCheck(), storage: STORAGE });

    const result = await orchestrator.processStandaloneCheck(db, CHECK_ID);
    expect(pathsCalled()).toHaveLength(3);
    expect(result.outcome).toBe('failed');
    expect(db._final().attempt_consumed).toBe(true);
  });

  it('SCENARIO E — portrait as base64 (save_api_request=false shape): face match still runs', async () => {
    responder = (path) => {
      if (path === '/v3/id-verification/') {
        return { status: 200, body: idBody({ portrait: PORTRAIT_BASE64 }) };
      }
      if (path === '/v3/passive-liveness/') return { status: 200, body: livenessBody() };
      return { status: 200, body: faceMatchBody() };
    };
    const db = makeDb({ check: baseCheck(), storage: STORAGE });

    await orchestrator.processStandaloneCheck(db, CHECK_ID);

    const face = didit().find((w) => w.url.endsWith('/v3/face-match/'))!;
    expect(face.files.ref_image.bytes).toBe(PORTRAIT_BYTES.byteLength);
    expect((db._final().outcome_detail as any).standalone.face_match_reference).toBe('id_portrait');
  });

  it('SCENARIO F — portrait as a media URL (save_api_request=true shape): downloaded and sent', async () => {
    responder = (path) => {
      if (path === '/v3/id-verification/') {
        return { status: 200, body: idBody({ portrait: PORTRAIT_URL }) };
      }
      if (path === '/v3/passive-liveness/') return { status: 200, body: livenessBody() };
      return { status: 200, body: faceMatchBody() };
    };
    mediaResponder = (url) => (url === PORTRAIT_URL
      ? new Response(PORTRAIT_BYTES, {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': String(PORTRAIT_BYTES.byteLength) },
      })
      : null);
    const db = makeDb({ check: baseCheck(), storage: STORAGE });

    const result = await orchestrator.processStandaloneCheck(db, CHECK_ID);

    expect(pathsCalled()).toHaveLength(3);
    const face = didit().find((w) => w.url.endsWith('/v3/face-match/'))!;
    // The bytes the media host served, not the URL string.
    expect(face.files.ref_image.bytes).toBe(PORTRAIT_BYTES.byteLength);
    expect(result.outcome).toBe('passed');

    // The credential is never sent to a media host.
    const media = wire.find((w) => w.url === PORTRAIT_URL)!;
    expect(media.apiKey).toBeNull();
    expect(media.method).toBe('GET');

    // …and the URL is never persisted.
    expect(JSON.stringify(db._final().outcome_detail)).not.toContain('X-Amz-Signature');
  });

  it('SCENARIO G — a portrait URL off the allow-list is refused: referral, no fetch, no SSRF', async () => {
    const HOSTILE = 'https://attacker.example/portrait.jpg';
    responder = (path) => {
      if (path === '/v3/id-verification/') return { status: 200, body: idBody({ portrait: HOSTILE }) };
      return { status: 200, body: livenessBody() };
    };
    const db = makeDb({ check: baseCheck(), storage: STORAGE });

    const result = await orchestrator.processStandaloneCheck(db, CHECK_ID);

    // The hostile host was never contacted at all.
    expect(wire.some((w) => w.url === HOSTILE)).toBe(false);
    // Face match never ran — there is no reference image.
    expect(pathsCalled()).toEqual(['/v3/id-verification/', '/v3/passive-liveness/']);
    expect(result.outcome).toBe('referred');
    expect((db._final().outcome_detail as any).standalone.face_match_reference).toBe('unavailable');
  });

  it('SCENARIO H — 403 (bad key): provider failure, never a customer failure', async () => {
    responder = () => ({
      status: 403, body: { detail: 'You do not have permission to perform this action.' },
    });
    const db = makeDb({ check: baseCheck(), storage: STORAGE });

    const result = await orchestrator.processStandaloneCheck(db, CHECK_ID);

    expect(result.outcome).toBe('technical_failure');
    const final = db._final();
    expect(final.processing_status).toBe('technical_failure');
    expect(final.provider_error_category).toBe('provider_not_configured');
    // The identity position is untouched: no status, no consumed attempt.
    expect(final.status).toBeUndefined();
    expect(final.attempt_consumed).toBeUndefined();
  });

  it('SCENARIO I — 403 naming credits: classified as insufficient_credits', async () => {
    responder = () => ({
      status: 403, body: { error: "You don't have enough credits to perform this action." },
    });
    const db = makeDb({ check: baseCheck(), storage: STORAGE });

    await orchestrator.processStandaloneCheck(db, CHECK_ID);
    expect(db._final().provider_error_category).toBe('insufficient_credits');
    expect(db._final().status).toBeUndefined();
  });

  it('SCENARIO J — 429: technical failure and NO blind paid retry', async () => {
    responder = () => ({ status: 429, body: { detail: 'Write request rate limit exceeded' } });
    const db = makeDb({ check: baseCheck(), storage: STORAGE });

    await orchestrator.processStandaloneCheck(db, CHECK_ID);

    expect(didit()).toHaveLength(1);
    expect(db._final().provider_error_category).toBe('rate_limited');
  });

  it('SCENARIO J2 — 400 COULD_NOT_RECOGNIZE_DOCUMENT: retake, no attempt consumed', async () => {
    responder = () => ({ status: 400, body: { error: 'COULD_NOT_RECOGNIZE_DOCUMENT' } });
    const db = makeDb({ check: baseCheck(), storage: STORAGE });

    const result = await orchestrator.processStandaloneCheck(db, CHECK_ID);
    expect(result.outcome).toBe('retake_required');
    expect(db._final().processing_status).toBe('capture_unusable');
    expect(db._final().status).toBeUndefined();
  });

  it('SCENARIO K — timeout after the request left: billing_unknown, no second purchase', async () => {
    vi.stubGlobal('fetch', async () => {
      const err = new Error('timed out');
      err.name = 'TimeoutError';
      throw err;
    });
    const db = makeDb({ check: baseCheck(), storage: STORAGE });

    const result = await orchestrator.processStandaloneCheck(db, CHECK_ID);

    expect(result.outcome).toBe('technical_failure');
    const final = db._final();
    expect(final.provider_error_category).toBe('timeout');
    expect((final.outcome_detail as any).standalone.billing_unknown).toBe(true);
    expect(final.status).toBeUndefined();
  });

  it('SCENARIO L — a second processor loses the claim and spends nothing', async () => {
    responder = (path) => {
      if (path === '/v3/id-verification/') return { status: 200, body: idBody() };
      if (path === '/v3/passive-liveness/') return { status: 200, body: livenessBody() };
      return { status: 200, body: faceMatchBody() };
    };
    const db = makeDb({ check: baseCheck(), storage: STORAGE });

    const first = await orchestrator.processStandaloneCheck(db, CHECK_ID);
    const callsAfterFirst = didit().length;
    const second = await orchestrator.processStandaloneCheck(db, CHECK_ID);

    expect(first.outcome).toBe('passed');
    expect(second.outcome).toBe('not_claimed');
    expect(didit()).toHaveLength(callsAfterFirst);
    expect(callsAfterFirst).toBe(3);
  });

  it('a document the provider classified as something else is referred, never passed', async () => {
    responder = (path) => {
      if (path === '/v3/id-verification/') {
        // The customer chose "passport"; Didit read a driver licence.
        return { status: 200, body: idBody({ documentType: "Driver's License" }) };
      }
      if (path === '/v3/passive-liveness/') return { status: 200, body: livenessBody() };
      return { status: 200, body: faceMatchBody() };
    };
    const db = makeDb({ check: baseCheck('passport'), storage: STORAGE });

    const result = await orchestrator.processStandaloneCheck(db, CHECK_ID);
    expect(result.outcome).toBe('referred');
    expect(db._final().status).toBe('referred');
  });

  it('a foreign document is referred rather than declined', async () => {
    responder = (path) => {
      if (path === '/v3/id-verification/') return { status: 200, body: idBody({ issuingState: 'NZL' }) };
      if (path === '/v3/passive-liveness/') return { status: 200, body: livenessBody() };
      return { status: 200, body: faceMatchBody() };
    };
    const db = makeDb({ check: baseCheck(), storage: STORAGE });
    const result = await orchestrator.processStandaloneCheck(db, CHECK_ID);
    expect(result.outcome).toBe('referred');
  });

  it('a driver licence sends both sides', async () => {
    responder = (path) => {
      if (path === '/v3/id-verification/') {
        return { status: 200, body: idBody({ documentType: "Driver's License" }) };
      }
      if (path === '/v3/passive-liveness/') return { status: 200, body: livenessBody() };
      return { status: 200, body: faceMatchBody() };
    };
    const db = makeDb({ check: baseCheck('driver_licence'), storage: STORAGE });
    await orchestrator.processStandaloneCheck(db, CHECK_ID);

    const id = didit()[0];
    expect(Object.keys(id.files).sort()).toEqual(['back_image', 'front_image']);
    expect(id.files.front_image.bytes).toBe(STORAGE[PATHS.front].byteLength);
    expect(id.files.back_image.bytes).toBe(STORAGE[PATHS.back].byteLength);
  });

  it('a missing capture costs nothing: no provider call is made at all', async () => {
    responder = () => ({ status: 200, body: idBody() });
    const db = makeDb({ check: baseCheck(), storage: {} });

    const result = await orchestrator.processStandaloneCheck(db, CHECK_ID);
    expect(didit()).toHaveLength(0);
    expect(result.outcome).toBe('technical_failure');
    expect(db._final().provider_error_category).toBe('storage_unreadable');
  });
});
