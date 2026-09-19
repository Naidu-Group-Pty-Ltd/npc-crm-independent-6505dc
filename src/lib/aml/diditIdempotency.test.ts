import { describe, expect, it, beforeEach } from 'vitest';
import {
  applyDiditDecision, DiditCorrelationError,
} from '../../../supabase/functions/_shared/aml/diditOutcome.ts';
import { buildVendorData } from '../../../supabase/functions/_shared/aml/providers/didit.pure.ts';

/**
 * The ugly cases, run for real rather than asserted about.
 *
 * `applyDiditDecision` depends on nothing but pure modules and WebCrypto, so a
 * small in-memory stand-in for the Supabase query builder is enough to execute
 * the actual settling logic — including the conditional UPDATE that is the
 * only thing standing between a retried webhook and a customer charged twice
 * for one verification.
 */

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const PARTY_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const WORKFLOW_ID = 'bb4349a9-8793-4e35-b0b8-ee559a19993a';

interface Row { [k: string]: any }

/**
 * Minimal in-memory Supabase-shaped client.
 *
 * Supports exactly the operations `applyDiditDecision` performs: filtered
 * selects, and filtered updates that report the rows they matched. The
 * filter-then-update semantics are the point — that is what makes the second
 * writer a no-op.
 */
function makeDb(rows: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(rows));

  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let mode: 'select' | 'update' | 'insert' = 'select';
    let patch: Row = {};
    let inserting: Row | null = null;

    const matched = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));

    const api: any = {
      select() { return api; },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val); return api;
      },
      is(col: string, val: unknown) {
        filters.push((r) => (r[col] ?? null) === val); return api;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col])); return api;
      },
      order() { return api; },
      limit() { return api; },
      update(p: Row) { mode = 'update'; patch = p; return api; },
      insert(r: Row) { mode = 'insert'; inserting = r; return api; },
      maybeSingle() { return api.then((res: any) => res); },
      then(resolve: (v: any) => unknown) {
        if (mode === 'insert') {
          tables[table] = [...(tables[table] ?? []), { ...inserting }];
          return Promise.resolve({ data: inserting, error: null }).then(resolve);
        }
        const hit = matched();
        if (mode === 'update') {
          for (const r of hit) Object.assign(r, patch);
          // Supabase returns the affected rows only when `.select()` was
          // chained; the caller relies on the length, which is what matters.
          return Promise.resolve({ data: hit, error: null }).then(resolve);
        }
        return Promise.resolve({ data: hit, error: null }).then(resolve);
      },
    };
    // `.maybeSingle()` resolves to a single row rather than an array.
    api.maybeSingle = () => Promise.resolve({ data: matched()[0] ?? null, error: null });
    return api;
  }

  return {
    tables,
    schema() {
      return { from: (table: string) => builder(table) };
    },
  };
}

function freshCheck(over: Row = {}): Row {
  return {
    id: 'check-1',
    case_id: CASE_ID,
    party_id: PARTY_ID,
    party_label: 'A Customer',
    provider: 'didit',
    provider_reference: SESSION_ID,
    outcome_detail: {},
    processing_status: 'processing',
    status: 'pending',
    attempt_consumed: false,
    superseded_at: null,
    check_type: 'electronic_idv',
    ...over,
  };
}

function decision(over: Row = {}): Row {
  return {
    session_id: SESSION_ID,
    workflow_id: WORKFLOW_ID,
    vendor_data: buildVendorData(CASE_ID, PARTY_ID),
    status: 'Approved',
    environment: 'sandbox',
    features: ['ID_VERIFICATION', 'LIVENESS', 'FACE_MATCH'],
    id_verifications: [{ status: 'Approved', warnings: [] }],
    liveness_checks: [{ status: 'Approved', score: 91, warnings: [] }],
    face_matches: [{ status: 'Approved', score: 88, warnings: [] }],
    ...over,
  };
}

let db: ReturnType<typeof makeDb>;
const apply = (d: Row, source = 'webhook') => applyDiditDecision({
  db: db as any,
  check: db.tables.verification_checks[0] as any,
  decision: d,
  expectedWorkflowId: WORKFLOW_ID,
  source,
  environment: 'test',
});

/** Re-read so a second delivery sees the row as it now stands. */
const reapply = (d: Row, source = 'webhook') => applyDiditDecision({
  db: db as any,
  check: db.tables.verification_checks[0] as any,
  decision: d, expectedWorkflowId: WORKFLOW_ID, source, environment: 'test',
});

const row = () => db.tables.verification_checks[0];
const events = () => db.tables.case_events ?? [];

beforeEach(() => {
  db = makeDb({ verification_checks: [freshCheck()], case_events: [] });
});

describe('A/B — the same terminal event delivered twice', () => {
  it('consumes exactly one attempt and writes one timeline entry', async () => {
    const first = await apply(decision());
    expect(first.kind).toBe('applied');
    expect(row().status).toBe('passed');
    expect(row().attempt_consumed).toBe(true);
    expect(events()).toHaveLength(1);

    const second = await reapply(decision());
    expect(second.kind).toBe('already_applied');
    expect(row().status).toBe('passed');
    expect(row().attempt_consumed).toBe(true);
    // No duplicate attempt, no duplicate timeline entry.
    expect(events()).toHaveLength(1);
  });

  it('holds for a declined outcome too', async () => {
    await apply(decision({ status: 'Declined' }));
    expect(row().status).toBe('failed');
    const again = await reapply(decision({ status: 'Declined' }));
    expect(again.kind).toBe('already_applied');
    expect(events()).toHaveLength(1);
  });
});

describe('C/D — data update and status update in either order', () => {
  it('data-then-status settles once', async () => {
    const progress = await apply(decision({ status: 'In Progress' }));
    expect(progress.kind).toBe('in_flight');
    expect(row().status).toBe('pending');
    expect(row().attempt_consumed).toBe(false);

    const settled = await reapply(decision());
    expect(settled.kind).toBe('applied');
    expect(row().status).toBe('passed');
  });

  it('status-then-data does not regress a settled row', async () => {
    await apply(decision());
    expect(row().status).toBe('passed');

    // A late `data.updated` for the same session.
    const late = await reapply(decision({ status: 'In Progress' }));
    expect(late.kind).toBe('in_flight');
    // The settled state survives: the in-flight update is filtered to
    // unsettled processing states and matches nothing.
    expect(row().status).toBe('passed');
    expect(row().processing_status).toBe('completed');
  });
});

describe('E/F/G — crashes and retries', () => {
  it('E: DB update succeeded then the response died — the retry is a no-op', async () => {
    await apply(decision());
    const attemptsBefore = row().attempt_consumed;
    const retry = await reapply(decision());
    expect(retry.kind).toBe('already_applied');
    expect(row().attempt_consumed).toBe(attemptsBefore);
    expect(events()).toHaveLength(1);
  });

  it('F/G: the DB write never happened — the retry settles it properly', async () => {
    // Nothing was applied yet (the crash was before the update).
    expect(row().status).toBe('pending');
    const retry = await apply(decision());
    expect(retry.kind).toBe('applied');
    expect(row().status).toBe('passed');
    expect(row().attempt_consumed).toBe(true);
  });
});

describe('H — an old webhook arriving after a newer state', () => {
  it('cannot regress a passed check to pending', async () => {
    await apply(decision());
    await reapply(decision({ status: 'Not Started' }));
    expect(row().status).toBe('passed');
    expect(row().attempt_consumed).toBe(true);
  });

  it('cannot turn a settled check into an abandoned one', async () => {
    await apply(decision());
    const late = await reapply(decision({ status: 'Abandoned' }));
    expect(late.kind).toBe('already_applied');
    expect(row().status).toBe('passed');
    expect(row().superseded_at ?? null).toBeNull();
  });
});

describe('J/K/L — correlation failures never change AML state', () => {
  const cases: Array<[string, Row]> = [
    ['wrong workflow', { workflow_id: 'another-workflow' }],
    ['wrong vendor_data', { vendor_data: buildVendorData(CASE_ID, 'someone-else') }],
    ['wrong session', { session_id: 'a-different-session' }],
    ['missing correlation metadata', { workflow_id: undefined, vendor_data: undefined }],
  ];

  for (const [label, over] of cases) {
    it(`${label}: throws and leaves the row untouched`, async () => {
      await expect(apply(decision(over))).rejects.toBeInstanceOf(DiditCorrelationError);
      expect(row().status).toBe('pending');
      expect(row().attempt_consumed).toBe(false);
      expect(events()).toHaveLength(0);
    });
  }
});

describe('Q — concurrent duplicate delivery', () => {
  it('two simultaneous deliveries consume exactly one attempt', async () => {
    const snapshot = { ...row() };
    // Both readers loaded the row before either wrote — the real race.
    const results = await Promise.all([
      applyDiditDecision({
        db: db as any, check: snapshot as any, decision: decision(),
        expectedWorkflowId: WORKFLOW_ID, source: 'webhook', environment: 'test',
      }),
      applyDiditDecision({
        db: db as any, check: snapshot as any, decision: decision(),
        expectedWorkflowId: WORKFLOW_ID, source: 'webhook', environment: 'test',
      }),
    ]);
    expect(results.filter((r) => r.kind === 'applied')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'already_applied')).toHaveLength(1);
    expect(row().attempt_consumed).toBe(true);
    expect(events()).toHaveLength(1);
  });
});

describe('non-final and abandoned sessions', () => {
  it('a non-final status consumes no attempt and sets no identity status', async () => {
    for (const status of ['Not Started', 'In Progress', 'Awaiting User', 'Resubmitted']) {
      db = makeDb({ verification_checks: [freshCheck()], case_events: [] });
      const r = await apply(decision({ status }));
      expect(r.kind).toBe('in_flight');
      expect(row().status).toBe('pending');
      expect(row().attempt_consumed).toBe(false);
      expect(events()).toHaveLength(0);
    }
  });

  it('an abandoned session releases the slot without failing the customer', async () => {
    const r = await apply(decision({ status: 'Abandoned' }));
    expect(r.kind).toBe('released');
    expect(row().status).toBe('pending');
    expect(row().attempt_consumed).toBe(false);
    expect(row().processing_status).toBe('cancelled');
    expect(row().superseded_at).toBeTruthy();
    // Recorded, and explicitly as "no attempt consumed".
    expect(events()).toHaveLength(1);
    expect(events()[0].payload.attempt_consumed).toBe(false);
  });

  it('an expired unfinished session does the same', async () => {
    const r = await apply(decision({ status: 'Expired' }));
    expect(r.kind).toBe('released');
    expect(row().status).toBe('pending');
    expect(row().attempt_consumed).toBe(false);
  });
});

describe('required-feature validation through the full write path', () => {
  it('Approved with a missing module is REFERRED, never passed', async () => {
    await apply(decision({ face_matches: null }));
    expect(row().status).toBe('referred');
    expect(row().attempt_consumed).toBe(true);
    expect(row().outcome_detail.didit.required_features_complete).toBe(false);
  });

  it('records which module was missing, for the reviewer', async () => {
    await apply(decision({ liveness_checks: null }));
    const stored = row().outcome_detail.didit;
    expect(stored.reason).toContain('LIVENESS');
    expect(stored.features.find((f: any) => f.feature === 'LIVENESS').executed).toBe(false);
  });
});

describe('exhaustion uses the existing rule', () => {
  it('a decline on the last attempt exhausts the customer', async () => {
    db = makeDb({
      verification_checks: [
        // Two attempts already consumed by earlier checks for this party.
        { ...freshCheck({ id: 'old-1' }), attempt_consumed: true, status: 'failed', processing_status: 'completed' },
        { ...freshCheck({ id: 'old-2' }), attempt_consumed: true, status: 'failed', processing_status: 'completed' },
        freshCheck(),
      ],
      case_events: [],
    });
    await applyDiditDecision({
      db: db as any,
      check: db.tables.verification_checks[2] as any,
      decision: decision({ status: 'Declined' }),
      expectedWorkflowId: WORKFLOW_ID, source: 'webhook', environment: 'test',
    });
    expect(db.tables.verification_checks[2].status).toBe('exhausted');
  });
});

describe('what reaches the case record', () => {
  it('stores no image reference, session URL or document data', async () => {
    await apply(decision({
      session_url: 'https://verify.didit.me/session/LIVE-TOKEN',
      id_verifications: [{
        status: 'Approved', document_number: 'N1234567', full_name: 'A Real Person',
        front_image: 'https://cdn.didit.me/x.jpg', warnings: [],
      }],
    }));
    const serialised = JSON.stringify(row().outcome_detail);
    for (const forbidden of ['LIVE-TOKEN', 'session_url', 'N1234567',
      'A Real Person', 'front_image', 'cdn.didit.me']) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('the timeline entry carries identifiers and categories only', async () => {
    await apply(decision());
    const serialised = JSON.stringify(events()[0]);
    expect(serialised).not.toContain('verify.didit.me');
    expect(serialised).not.toContain('session_url');
    expect(events()[0].payload.verification_check_id).toBe('check-1');
    // And says plainly that this is identity evidence, not an AML clearance.
    expect(events()[0].payload.scope).toBe('identity_verification_only');
  });

  it('never writes a case status, hold, or screening field', async () => {
    await apply(decision());
    // A Didit approval touches the verification check and nothing else.
    expect(Object.keys(db.tables)).toEqual(['verification_checks', 'case_events']);
    for (const forbidden of ['risk_rating', 'screening', 'pep', 'sanctions', 'cleared']) {
      expect(Object.keys(row())).not.toContain(forbidden);
    }
  });
});
