/**
 * End-to-end harness for the Didit webhook receiver.
 *
 * Runs the REAL `supabase/functions/didit-webhook/index.ts` as a Deno process
 * and drives it over HTTP with genuinely signed requests, against an in-memory
 * stand-in for PostgREST and the Didit API.
 *
 * Unit tests prove the pure logic. This proves the wiring: that the function
 * boots, that the HMAC it computes matches the one Didit's documented scheme
 * produces, that supabase-js's real query encoding hits the columns we think it
 * does, and that the canonical row ends up in the state we claim. Those are the
 * things that unit tests structurally cannot see and that only show up on a
 * deployed function against a real database — which is exactly where finding
 * them is most expensive.
 *
 *   deno run --allow-net --allow-env --allow-read --allow-run \
 *     scripts/aml/didit-e2e-harness.ts
 *
 * Exits non-zero on any failed scenario.
 */

const MOCK_PORT = 54329;
const FN_PORT = 8000;   // Deno.serve() default; the function does not read PORT.
const WEBHOOK_SECRET = 'harness-webhook-secret';
const API_KEY = 'harness-api-key';
const WORKFLOW_ID = 'bb4349a9-8793-4e35-b0b8-ee559a19993a';
const CASE_ID = '11111111-1111-4111-8111-111111111111';
const PARTY_ID = '22222222-2222-4222-8222-222222222222';

/* ────────────────────────── in-memory database ────────────────────────── */

type Row = Record<string, any>;
const db: Record<string, Row[]> = {
  verification_checks: [],
  provider_events: [],
  case_events: [],
  provider_configs: [],
};

function resetDb(sessionId: string) {
  db.verification_checks = [{
    id: 'check-1',
    case_id: CASE_ID,
    party_id: PARTY_ID,
    party_label: 'Harness Customer',
    check_type: 'electronic_idv',
    provider: 'didit',
    provider_reference: sessionId,
    outcome_detail: {},
    processing_status: 'processing',
    status: 'pending',
    attempt_consumed: false,
    superseded_at: null,
    created_at: new Date(0).toISOString(),
  }];
  db.provider_events = [];
  db.case_events = [];
  db.provider_configs = [{
    id: 'cfg-1',
    tenant_id: 'default',
    capability: 'idv',
    provider_key: 'didit',
    mode: 'live',
    active: true,
    priority: 1,
    cost_per_unit_cents: 0,
    config: { flow: 'hosted_session', workflow_id: WORKFLOW_ID },
  }];
}

/** What the mock Didit API will answer for the decision endpoint. */
let decisionResponse: { status: number; body: unknown } = { status: 200, body: {} };

/* ───────────────────────── PostgREST-ish filtering ────────────────────── */

/** `provider=eq.didit`, `processing_status=in.(a,b)`, `party_id=is.null`. */
function matches(row: Row, params: URLSearchParams): boolean {
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
    const eq = raw.match(/^eq\.(.*)$/);
    if (eq) {
      if (String(row[key] ?? '') !== eq[1]) return false;
      continue;
    }
    const isOp = raw.match(/^is\.(.*)$/);
    if (isOp) {
      const want = isOp[1] === 'null' ? null : isOp[1] === 'true';
      if ((row[key] ?? null) !== want) return false;
      continue;
    }
    const inOp = raw.match(/^in\.\((.*)\)$/);
    if (inOp) {
      const vals = inOp[1].split(',').map((v) => v.replace(/^"|"$/g, ''));
      if (!vals.includes(String(row[key] ?? ''))) return false;
      continue;
    }
    const gte = raw.match(/^gte\.(.*)$/);
    if (gte) {
      if (!(String(row[key] ?? '') >= gte[1])) return false;
      continue;
    }
  }
  return true;
}

function project(rows: Row[], select: string | null): Row[] {
  if (!select || select === '*') return rows.map((r) => ({ ...r }));
  const cols = select.split(',').map((c) => c.trim()).filter(Boolean);
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
}

function respond(rows: Row[], accept: string, status = 200): Response {
  const single = accept.includes('vnd.pgrst.object+json');
  if (single) {
    if (rows.length === 0) {
      return new Response(JSON.stringify({
        code: 'PGRST116', message: 'no rows', details: '0 rows',
      }), { status: 406, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(rows[0]), {
      status, headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify(rows), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}

/* ─────────────────────────────── mock server ──────────────────────────── */

const mock = Deno.serve({ port: MOCK_PORT, onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  const accept = req.headers.get('accept') ?? '';

  // ── Didit API
  const decisionMatch = url.pathname.match(/^\/v3\/session\/([^/]+)\/decision\/$/);
  if (decisionMatch) {
    if (req.headers.get('x-api-key') !== API_KEY) {
      return new Response(JSON.stringify({ detail: 'bad key' }), { status: 401 });
    }
    return new Response(JSON.stringify(decisionResponse.body), {
      status: decisionResponse.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── PostgREST
  const restMatch = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
  if (!restMatch) return new Response('not found', { status: 404 });
  const table = restMatch[1];
  db[table] ??= [];
  const params = url.searchParams;
  const select = params.get('select');

  if (req.method === 'GET') {
    let rows = db[table].filter((r) => matches(r, params));
    const limit = params.get('limit');
    if (limit) rows = rows.slice(0, Number(limit));
    return respond(project(rows, select), accept);
  }

  if (req.method === 'POST') {
    const body = await req.json();
    const items: Row[] = Array.isArray(body) ? body : [body];
    const inserted: Row[] = [];
    for (const item of items) {
      // UNIQUE (provider, dedup_key) on aml.provider_events.
      if (table === 'provider_events' && db[table].some(
        (r) => r.provider === item.provider && r.dedup_key === item.dedup_key)) {
        return new Response(JSON.stringify({
          code: '23505', message: 'duplicate key value violates unique constraint',
          details: 'Key (provider, dedup_key) already exists.',
        }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      }
      const row = { id: `${table}-${db[table].length + 1}`, ...item };
      db[table].push(row);
      inserted.push(row);
    }
    return respond(project(inserted, select), accept, 201);
  }

  if (req.method === 'PATCH') {
    const patch = await req.json();
    const hit = db[table].filter((r) => matches(r, params));
    for (const r of hit) Object.assign(r, patch);
    return respond(project(hit, select), accept);
  }

  return new Response('method not allowed', { status: 405 });
});

/* ──────────────────────────── run the function ────────────────────────── */

const fn = new Deno.Command(Deno.execPath(), {
  args: ['run', '--allow-net', '--allow-env', 'supabase/functions/didit-webhook/index.ts'],
  env: {
    SUPABASE_URL: `http://localhost:${MOCK_PORT}`,
    SUPABASE_SERVICE_ROLE_KEY: 'harness-service-role-key',
    DIDIT_API_KEY: API_KEY,
    DIDIT_WEBHOOK_SECRET: WEBHOOK_SECRET,
    DIDIT_WORKFLOW_ID: WORKFLOW_ID,
    DIDIT_API_BASE_URL: `http://localhost:${MOCK_PORT}`,
    AML_ENVIRONMENT: 'test',
  },
  stdout: 'piped',
  stderr: 'piped',
}).spawn();

/**
 * `Deno.serve()` with no options binds 8000 and does NOT read `PORT`, so that
 * is where the function will be. Readiness is established by knocking rather
 * than by parsing its banner — the banner does not reach a piped stdout, and
 * waiting for it hangs forever, which reads like a broken function rather than
 * a harness listening for something that is never said.
 */
const fnPort = FN_PORT;

/**
 * Drain the child's pipes in the background.
 *
 * A piped stdout/stderr that nobody reads fills its buffer and blocks the
 * child mid-request. Anything the function prints is echoed on failure only,
 * so a passing run stays readable.
 */
const childOutput: string[] = [];
for (const stream of [fn.stdout, fn.stderr]) {
  (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) childOutput.push(decoder.decode(chunk));
  })().catch(() => {});
}

async function waitForFn() {
  for (let i = 0; i < 150; i++) {
    try {
      await fetch(`http://localhost:${fnPort}/`, { method: 'GET' });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(
    `function did not start on :${fnPort}; output: ${childOutput.join('').slice(0, 800)}`);
}

/* ───────────────────────────── signing + calls ────────────────────────── */

async function sign(body: string, secret = WEBHOOK_SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deliver(payload: Record<string, unknown>, opts: {
  secret?: string; timestamp?: number; signature?: string;
} = {}) {
  const body = JSON.stringify(payload);
  const ts = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const sig = opts.signature ?? await sign(body, opts.secret ?? WEBHOOK_SECRET);
  const res = await fetch(`http://localhost:${fnPort}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': sig,
      'X-Timestamp': String(ts),
    },
    body,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

function approvedDecision(sessionId: string, over: Row = {}): Row {
  return {
    session_id: sessionId,
    workflow_id: WORKFLOW_ID,
    vendor_data: `npc:${CASE_ID}:${PARTY_ID}`,
    status: 'Approved',
    environment: 'sandbox',
    features: ['ID_VERIFICATION', 'LIVENESS', 'FACE_MATCH'],
    id_verifications: [{
      status: 'Approved', warnings: [],
      document_number: 'N1234567', full_name: 'A Real Person',
      front_image: 'https://cdn.didit.me/signed/front.jpg',
      portrait_image: 'https://cdn.didit.me/signed/portrait.jpg',
    }],
    liveness_checks: [{
      status: 'Approved', score: 91, warnings: [],
      reference_image: 'https://cdn.didit.me/signed/selfie.jpg',
      video_url: 'https://cdn.didit.me/signed/liveness.mp4',
    }],
    face_matches: [{ status: 'Approved', score: 88, warnings: [] }],
    session_url: 'https://verify.didit.me/session/LIVE-TOKEN',
    created_at: '2026-08-08T08:48:18Z',
    ...over,
  };
}

function event(sessionId: string, over: Row = {}): Row {
  return {
    event_id: crypto.randomUUID(),
    webhook_type: 'status.updated',
    timestamp: Math.floor(Date.now() / 1000),
    created_at: Math.floor(Date.now() / 1000),
    application_id: 'b6e39c56-0620-46bc-8676-885d8a4705e3',
    environment: 'sandbox',
    status: 'Approved',
    session_id: sessionId,
    vendor_data: `npc:${CASE_ID}:${PARTY_ID}`,
    // Deliberately present and deliberately ignored by the receiver.
    decision: { status: 'Approved', tampered: true },
    ...over,
  };
}

/* ──────────────────────────────── scenarios ───────────────────────────── */

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ''}`); console.log(`  ✗ ${name} ${detail}`); }
}

const row = () => db.verification_checks[0];

async function scenario(name: string, fn: () => Promise<void>) {
  console.log(`\n${name}`);
  const sid = crypto.randomUUID();
  resetDb(sid);
  decisionResponse = { status: 200, body: approvedDecision(sid) };
  (globalThis as any).__sid = sid;
  await fn();
}

await waitForFn();
console.log('Didit webhook harness — real function, real HMAC, over HTTP\n');

await scenario('1. Approved + all three modules → passed, one attempt', async () => {
  const sid = (globalThis as any).__sid;
  const r = await deliver(event(sid));
  check('returns 2xx', r.status === 200, `got ${r.status}`);
  check('canonical status = passed', row().status === 'passed', `got ${row().status}`);
  check('attempt consumed', row().attempt_consumed === true);
  check('processing completed', row().processing_status === 'completed');
  check('one timeline entry', db.case_events.length === 1, `got ${db.case_events.length}`);
  const stored = JSON.stringify(row().outcome_detail);
  check('no image reference stored', !/front_image|portrait_image|video_url|cdn\.didit\.me/.test(stored));
  check('no session URL stored', !/session_url|verify\.didit\.me|LIVE-TOKEN/.test(stored));
  check('no document data stored', !/N1234567|A Real Person/.test(stored));
  check('evidence records all three modules',
    (row().outcome_detail as any)?.didit?.features?.length === 3);
});

await scenario('2. Duplicate delivery of the SAME event_id', async () => {
  const sid = (globalThis as any).__sid;
  const e = event(sid);
  await deliver(e);
  const r2 = await deliver(e);
  check('replay acknowledged', r2.status === 200 && r2.json.replay === true, JSON.stringify(r2.json));
  check('still exactly one attempt', row().attempt_consumed === true);
  check('no duplicate timeline entry', db.case_events.length === 1, `got ${db.case_events.length}`);
  check('one provider_event row', db.provider_events.length === 1);
});

await scenario('3. A DIFFERENT event for an already-settled check', async () => {
  const sid = (globalThis as any).__sid;
  await deliver(event(sid));
  const before = db.case_events.length;
  const r = await deliver(event(sid));           // new event_id, same outcome
  check('accepted', r.status === 200);
  check('reports already_applied', r.json.outcome === 'already_applied', JSON.stringify(r.json));
  check('no second attempt consumed', row().attempt_consumed === true);
  check('no duplicate timeline entry', db.case_events.length === before);
});

await scenario('4. Two concurrent deliveries', async () => {
  const sid = (globalThis as any).__sid;
  const [a, b] = await Promise.all([deliver(event(sid)), deliver(event(sid))]);
  check('both answered 2xx', a.status === 200 && b.status === 200);
  const outcomes = [a.json.outcome, b.json.outcome].filter(Boolean);
  check('exactly one applied', outcomes.filter((o) => o === 'applied').length === 1,
    JSON.stringify(outcomes));
  check('exactly one timeline entry', db.case_events.length === 1, `got ${db.case_events.length}`);
});

await scenario('5. Invalid signature', async () => {
  const sid = (globalThis as any).__sid;
  const r = await deliver(event(sid), { secret: 'wrong-secret' });
  check('rejected 401', r.status === 401, `got ${r.status}`);
  check('reason is invalid_signature', r.json.reason === 'invalid_signature');
  check('AML state untouched', row().status === 'pending' && row().attempt_consumed === false);
  check('nothing recorded', db.provider_events.length === 0 && db.case_events.length === 0);
});

await scenario('6. Stale timestamp (replay)', async () => {
  const sid = (globalThis as any).__sid;
  const r = await deliver(event(sid), { timestamp: Math.floor(Date.now() / 1000) - 3600 });
  check('rejected 401', r.status === 401, `got ${r.status}`);
  check('reason is stale_timestamp', r.json.reason === 'stale_timestamp');
  check('AML state untouched', row().status === 'pending');
});

await scenario('7. Unsigned request', async () => {
  const sid = (globalThis as any).__sid;
  const body = JSON.stringify(event(sid));
  const res = await fetch(`http://localhost:${fnPort}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  check('rejected 401', res.status === 401, `got ${res.status}`);
  check('AML state untouched', row().status === 'pending');
});

await scenario('8. Tampered body under a valid-for-the-original signature', async () => {
  const sid = (globalThis as any).__sid;
  const original = event(sid);
  const sig = await sign(JSON.stringify(original));
  const r = await deliver({ ...original, status: 'Approved', injected: true }, { signature: sig });
  check('rejected 401', r.status === 401, `got ${r.status}`);
  check('AML state untouched', row().status === 'pending');
});

await scenario('9. Unknown session', async () => {
  const r = await deliver(event('a-session-npc-never-created'));
  check('accepted without retry (202)', r.status === 202, `got ${r.status}`);
  check('reason is unknown_session', r.json.reason === 'unknown_session');
  check('AML state untouched', row().status === 'pending');
});

await scenario('10. Decision from the WRONG workflow', async () => {
  const sid = (globalThis as any).__sid;
  decisionResponse = {
    status: 200, body: approvedDecision(sid, { workflow_id: 'someone-elses-workflow' }),
  };
  const r = await deliver(event(sid));
  check('accepted without retry (202)', r.status === 202, `got ${r.status}`);
  check('reason is correlation_failed', r.json.reason === 'correlation_failed');
  check('no identity outcome', row().status === 'pending');
  check('no attempt consumed', row().attempt_consumed === false);
  check('recorded as misconfiguration', row().provider_error_category === 'provider_misconfigured');
});

await scenario('11. Decision whose vendor_data names another party', async () => {
  const sid = (globalThis as any).__sid;
  decisionResponse = {
    status: 200, body: approvedDecision(sid, { vendor_data: `npc:${CASE_ID}:somebody-else` }),
  };
  const r = await deliver(event(sid));
  check('accepted without retry (202)', r.status === 202, `got ${r.status}`);
  check('no identity outcome', row().status === 'pending');
  check('no attempt consumed', row().attempt_consumed === false);
});

await scenario('12. Approved but FACE_MATCH never ran', async () => {
  const sid = (globalThis as any).__sid;
  decisionResponse = { status: 200, body: approvedDecision(sid, { face_matches: null }) };
  const r = await deliver(event(sid));
  check('accepted', r.status === 200);
  check('MUST NOT be passed', row().status !== 'passed', `got ${row().status}`);
  check('referred to a human', row().status === 'referred', `got ${row().status}`);
  check('attempt consumed (a decision was made)', row().attempt_consumed === true);
  check('records incomplete evidence',
    (row().outcome_detail as any)?.didit?.required_features_complete === false);
});

await scenario('13. Declined', async () => {
  const sid = (globalThis as any).__sid;
  decisionResponse = { status: 200, body: approvedDecision(sid, { status: 'Declined' }) };
  const r = await deliver(event(sid, { status: 'Declined' }));
  check('accepted', r.status === 200);
  check('canonical status = failed', row().status === 'failed', `got ${row().status}`);
  check('attempt consumed', row().attempt_consumed === true);
});

await scenario('14. In Review', async () => {
  const sid = (globalThis as any).__sid;
  decisionResponse = { status: 200, body: approvedDecision(sid, { status: 'In Review' }) };
  const r = await deliver(event(sid, { status: 'In Review' }));
  check('accepted', r.status === 200);
  check('canonical status = referred', row().status === 'referred', `got ${row().status}`);
});

await scenario('15. Abandoned — customer walked away', async () => {
  const sid = (globalThis as any).__sid;
  decisionResponse = {
    status: 200,
    body: approvedDecision(sid, {
      status: 'Abandoned', id_verifications: null, liveness_checks: null, face_matches: null,
    }),
  };
  const r = await deliver(event(sid, { status: 'Abandoned' }));
  check('accepted', r.status === 200);
  check('NOT a failure', row().status === 'pending', `got ${row().status}`);
  check('no attempt consumed', row().attempt_consumed === false);
  check('slot released for a new session', row().processing_status === 'cancelled');
  check('superseded so the unique index frees up', Boolean(row().superseded_at));
});

await scenario('16. In Progress — nothing decided yet', async () => {
  const sid = (globalThis as any).__sid;
  decisionResponse = {
    status: 200,
    body: approvedDecision(sid, {
      status: 'In Progress', liveness_checks: null, face_matches: null,
    }),
  };
  const r = await deliver(event(sid, { status: 'In Progress' }));
  check('accepted', r.status === 200);
  check('no identity outcome', row().status === 'pending');
  check('no attempt consumed', row().attempt_consumed === false);
  check('still in flight', row().processing_status === 'processing');
});

await scenario('17. Decision API is down → OUR failure, not the customer\'s', async () => {
  const sid = (globalThis as any).__sid;
  decisionResponse = { status: 503, body: { detail: 'upstream unavailable' } };
  const r = await deliver(event(sid));
  check('5xx so Didit retries', r.status === 503, `got ${r.status}`);
  check('no identity outcome', row().status === 'pending');
  check('NO attempt consumed', row().attempt_consumed === false);
  check('recorded as technical', row().provider_error_category === 'provider_unavailable',
    String(row().provider_error_category));
  check('event left unprocessed for retry',
    db.provider_events.length === 1 && !db.provider_events[0].processed_at);
});

await scenario('18. Retry after the decision API recovers', async () => {
  const sid = (globalThis as any).__sid;
  const e = event(sid);
  decisionResponse = { status: 503, body: {} };
  const first = await deliver(e);
  check('first delivery failed', first.status === 503);
  check('nothing consumed', row().attempt_consumed === false);

  // Same event_id retried — the crash-safety path.
  decisionResponse = { status: 200, body: approvedDecision(sid) };
  const retry = await deliver(e);
  check('retry succeeds', retry.status === 200, `got ${retry.status}`);
  check('now passed', row().status === 'passed', `got ${row().status}`);
  check('exactly one attempt', row().attempt_consumed === true);
  check('exactly one timeline entry', db.case_events.length === 1);
});

await scenario('19. Malformed body under a valid signature', async () => {
  const sid = (globalThis as any).__sid;
  const body = 'not json at all';
  const r = await fetch(`http://localhost:${fnPort}/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': await sign(body),
      'X-Timestamp': String(Math.floor(Date.now() / 1000)),
    },
    body,
  });
  check('rejected 400 (no retry)', r.status === 400, `got ${r.status}`);
  check('AML state untouched', row().status === 'pending');
});

await scenario('20. GET is refused', async () => {
  const r = await fetch(`http://localhost:${fnPort}/`, { method: 'GET' });
  check('405', r.status === 405, `got ${r.status}`);
});

/* ───────────── persisted STANDALONE requests: acknowledged, ignored ─────── */

/**
 * `save_api_request=true` persists each Standalone call, and Didit emits
 * `status.updated` for a persisted session — so this endpoint receives events
 * for checks whose authoritative result NPC already has.
 *
 * These are REAL deliveries: genuinely signed, over HTTP, against the real
 * function. What they prove is that the receiver recognises them from the
 * metadata NPC itself supplied and then does nothing at all.
 *
 * `provider_reference` cannot answer this on its own, which is why these exist:
 * the orchestrator writes only the ID request id there, and only at
 * settlement.
 */

/** Seed the single row as a standalone check rather than a hosted one. */
function makeStandalone(over: Row = {}) {
  const r = row();
  r.provider = 'didit_standalone';
  r.provider_reference = null;
  r.outcome_detail = {};
  Object.assign(r, over);
  db.provider_configs[0].provider_key = 'didit_standalone';
  db.provider_configs[0].config = { flow: 'capture' };
}

/** Every field a standalone webhook must leave exactly as it found it. */
function frozen() {
  const r = row();
  return JSON.stringify({
    status: r.status,
    attempt_consumed: r.attempt_consumed,
    processing_status: r.processing_status,
    outcome_detail: r.outcome_detail,
  });
}

await scenario('21. Persisted standalone ID Verification event', async () => {
  // Settled: the ID request id is on provider_reference, the other two are in
  // outcome_detail — the shape the orchestrator actually writes.
  makeStandalone({
    provider_reference: 'req-id-verification',
    outcome_detail: {
      standalone: {
        provider_request_ids: {
          id_verification: 'req-id-verification',
          passive_liveness: 'req-liveness',
          face_match: 'req-face-match',
        },
      },
    },
  });
  const before = frozen();
  const r = await deliver(event('req-id-verification', {
    metadata: { npc_verification_check_id: 'check-1', npc_capture_sequence: 1 },
  }));
  check('acknowledged 202', r.status === 202, `got ${r.status}`);
  check('reason is standalone_session_ignored',
    r.json.reason === 'standalone_session_ignored', JSON.stringify(r.json));
  check('processed: false', r.json.processed === false);
  check('correlated from metadata',
    r.json.correlation === 'standalone_metadata_correlated', String(r.json.correlation));
  check('AML state completely untouched', frozen() === before);
  check('no decision was fetched', db.case_events.length === 0);
});

await scenario('22. Persisted standalone FACE MATCH event', async () => {
  /*
   * The case `provider_reference` could never have matched: the face-match
   * request id is only ever in `outcome_detail`, never in that column.
   */
  makeStandalone({
    provider_reference: 'req-id-verification',
    outcome_detail: {
      standalone: {
        provider_request_ids: {
          id_verification: 'req-id-verification',
          passive_liveness: 'req-liveness',
          face_match: 'req-face-match',
        },
      },
    },
  });
  const before = frozen();
  const r = await deliver(event('req-face-match', {
    metadata: { npc_verification_check_id: 'check-1', npc_capture_sequence: 1 },
  }));
  check('acknowledged 202', r.status === 202, `got ${r.status}`);
  check('reason is standalone_session_ignored',
    r.json.reason === 'standalone_session_ignored', JSON.stringify(r.json));
  check('recognised despite not being provider_reference',
    r.json.correlation === 'standalone_metadata_correlated', String(r.json.correlation));
  check('AML state completely untouched', frozen() === before);
});

await scenario('23. Standalone event arriving BEFORE settlement', async () => {
  /*
   * Mid-sequence: nothing has been written to `provider_reference` and no
   * request ids are recorded yet. The metadata is the only thing that can
   * identify the check, which is the whole reason it is what is used.
   */
  makeStandalone({ provider_reference: null, outcome_detail: {} });
  const before = frozen();
  const r = await deliver(event('req-liveness', {
    metadata: { npc_verification_check_id: 'check-1', npc_capture_sequence: 1 },
  }));
  check('acknowledged 202', r.status === 202, `got ${r.status}`);
  check('reason is standalone_session_ignored',
    r.json.reason === 'standalone_session_ignored', JSON.stringify(r.json));
  check('correlated with no stored request ids yet',
    r.json.correlation === 'standalone_metadata_correlated', String(r.json.correlation));
  check('status still pending', row().status === 'pending');
  check('attempt not consumed', row().attempt_consumed === false);
  check('AML state completely untouched', frozen() === before);
});

await scenario('24. Standalone event whose vendor_data is another applicant', async () => {
  // A mismatch is recorded, never acted on — the outcome is the same do-nothing
  // acknowledgement, because there is nothing here that could be abused.
  makeStandalone({ provider_reference: 'req-id-verification' });
  const before = frozen();
  const r = await deliver(event('req-id-verification', {
    vendor_data: 'npc:00000000-0000-4000-8000-000000000999:primary',
    metadata: { npc_verification_check_id: 'check-1' },
  }));
  check('still acknowledged 202', r.status === 202, `got ${r.status}`);
  check('flagged as uncorrelated',
    r.json.correlation === 'standalone_metadata_uncorrelated_session',
    String(r.json.correlation));
  check('AML state completely untouched', frozen() === before);
});

await scenario('25. A session belonging to nobody is still unknown', async () => {
  makeStandalone({ provider_reference: 'req-id-verification' });
  const before = frozen();
  const r = await deliver(event('a-session-npc-never-made', {
    metadata: { npc_verification_check_id: 'no-such-check' },
  }));
  check('acknowledged 202', r.status === 202, `got ${r.status}`);
  check('reason is unknown_session', r.json.reason === 'unknown_session',
    JSON.stringify(r.json));
  check('NOT classified as standalone', r.json.correlation === undefined);
  check('AML state completely untouched', frozen() === before);
});

await scenario('26. A HOSTED event still settles normally', async () => {
  // The regression guard: adding the standalone branch must not have taken
  // anything away from the hosted path.
  const sid = (globalThis as any).__sid;
  const r = await deliver(event(sid));
  check('applied', r.json.outcome === 'applied', JSON.stringify(r.json));
  check('canonical status = passed', row().status === 'passed', `got ${row().status}`);
  check('attempt consumed', row().attempt_consumed === true);
});

/* ──────────────────────────────── teardown ────────────────────────────── */

console.log(`\n${'─'.repeat(60)}`);
console.log(`${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
}

try { fn.kill('SIGKILL'); } catch { /* already gone */ }
await mock.shutdown();
Deno.exit(failures.length === 0 ? 0 : 1);
