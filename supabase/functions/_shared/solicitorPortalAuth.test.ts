import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  can,
  listAccessibleMatterIds,
  readAccessibleMatterIds,
  resolveMatterPermissions,
  resolveSolicitorMatterAccess,
} from './solicitorPortalAuth.ts';

/**
 * The Solicitor Portal's matter list, run against an in-memory database.
 *
 * `readAccessibleMatterIds` builds the list every solicitor page scopes its
 * reads with: the matters page, the documents, the threads, the board, the
 * notifications and the conflict search. The property that matters is the
 * one its doc comment claims: a matter it names is a matter that opens, and
 * the reverse. Until 28 Sep 2026 it was false in three ways at once. The list
 * read the environment flag where the per-matter check read the practice's
 * rollout mode. On the legacy assignments it named every matter of every
 * assigned client whatever the permission, so a denied `messages` still
 * listed the threads. And it read no errors, so a lost connection drew "no
 * matters" as a statement about the solicitor.
 *
 * The first test states the property over generated practices rather than
 * over the cases somebody thought of, because each of those three was a case
 * nobody thought of. The rest pin the edges the generator cannot reach: the
 * paging, the chunking and every failed read.
 *
 * The fake answers the query shapes the module sends and enforces the two
 * uniqueness constraints the real tables carry: one grant per solicitor and
 * matter, one assignment per solicitor and client. `.maybeSingle()` answers an
 * error on a second row, as PostgREST does, so a world the database could not
 * hold would fail here rather than pass.
 */

type Row = Record<string, any>;

interface FakeOptions {
  mode?: string | null;
  fail?: Partial<Record<string, string>>;
}

/** The largest page PostgREST answers, whatever range is asked for. */
const MAX_ROWS = 1000;

function fakeClient(tables: Record<string, Row[]>, options: FakeOptions = {}) {
  const log = { inSizes: [] as number[], rpc: [] as string[] };
  const fail = options.fail ?? {};

  const client = {
    log,
    rpc: async (name: string) => {
      log.rpc.push(name);
      if (name === 'resolve_cross_portal_feature_mode') {
        if (fail.rpc) return { data: null, error: { message: fail.rpc } };
        return { data: options.mode ?? null, error: null };
      }
      return { data: null, error: null };
    },
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      let orderKey: string | null = null;
      let from = 0;
      let to = Number.POSITIVE_INFINITY;
      const run = () => {
        if (fail[table]) return { data: null, error: { message: fail[table] } };
        let rows = (tables[table] ?? []).filter((row) => filters.every((keep) => keep(row)));
        if (orderKey) {
          const key = orderKey;
          rows = [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key])));
        }
        const end = Math.min(to + 1, from + MAX_ROWS);
        return { data: rows.slice(from, end), error: null };
      };
      const builder: any = {
        select: () => builder,
        eq: (column: string, value: unknown) => { filters.push((row) => row[column] === value); return builder; },
        is: (column: string, value: unknown) => { filters.push((row) => (row[column] ?? null) === value); return builder; },
        in: (column: string, values: unknown[]) => {
          log.inSizes.push(values.length);
          filters.push((row) => values.includes(row[column]));
          return builder;
        },
        order: (column: string) => { orderKey = column; return builder; },
        range: (a: number, b: number) => { from = a; to = b; return builder; },
        maybeSingle: async () => {
          const result = run();
          if (result.error) return result;
          if (result.data!.length > 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
          return { data: result.data![0] ?? null, error: null };
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(run()).then(resolve, reject),
      };
      return builder;
    },
  };
  return client;
}

let env: Record<string, string | undefined> = {};
beforeEach(() => {
  env = {};
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] } });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** A deterministic generator, so a failing world can be reproduced from its seed. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const KEYS = ['matters', 'messages', 'parties', 'documents'] as const;
const DAY = 86_400_000;

function world(seed: number) {
  const random = rng(seed);
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
  const user = 'user-a';
  const firm = 'firm-a';
  const now = Date.now();

  const clients = ['client-1', 'client-2', 'client-3', 'client-4'];
  const matters: Row[] = [];
  for (let i = 0; i < 14; i++) {
    matters.push({ id: `matter-${String(i).padStart(2, '0')}`, client_id: pick(clients), firm_id: pick([firm, firm, firm, 'firm-b', null]) });
  }

  const legacyValue = () => pick([undefined, { view: true }, { view: false }]);
  const triValue = () => pick([undefined, { view: 'allow' }, { view: 'deny' }]);
  const matrix = (value: () => unknown) => {
    const out: Row = {};
    for (const key of KEYS) {
      const entry = value();
      if (entry !== undefined) out[key] = entry;
    }
    return pick([null, out, out]);
  };

  const grants: Row[] = [];
  for (const matter of matters) {
    if (random() < 0.3) continue;
    grants.push({
      id: `grant-${matter.id}`,
      solicitor_user_id: user,
      legal_matter_id: matter.id,
      firm_id: pick([firm, firm, firm, 'firm-b']),
      access_role: pick(['team_member', 'read_only']),
      permissions: matrix(triValue),
      valid_from: pick([new Date(now - DAY).toISOString(), new Date(now + DAY).toISOString(), null]),
      valid_until: pick([null, null, new Date(now + DAY).toISOString(), new Date(now - DAY / 2).toISOString()]),
      revoked_at: pick([null, null, null, new Date(now - DAY).toISOString()]),
    });
  }
  // Another solicitor's grants and assignments are in the same tables.
  grants.push({ id: 'grant-user-b', solicitor_user_id: 'user-b', legal_matter_id: matters[0].id, firm_id: firm, access_role: 'team_member', permissions: null, valid_from: new Date(now - DAY).toISOString(), valid_until: null, revoked_at: null });

  const assignments: Row[] = [];
  for (const client of clients) {
    if (random() < 0.35) continue;
    assignments.push({ id: `assignment-${client}`, solicitor_user_id: user, client_id: client, permissions: matrix(legacyValue), assigned_at: new Date(now - DAY).toISOString() });
  }
  assignments.push({ id: 'assignment-b', solicitor_user_id: 'user-b', client_id: clients[0], permissions: null, assigned_at: new Date(now - DAY).toISOString() });

  const baseline = pick([null, matrix(() => pick([undefined, { view: true }, { view: false }, { view: 'allow' }]))]);
  const defaults: Row[] = baseline === null && random() < 0.5
    ? []
    : [{ solicitor_user_id: user, permissions: baseline }];

  return {
    user,
    firm,
    matters,
    mode: pick([null, 'cutover', 'off', 'shadow', 'dual_read', 'rollback']),
    flag: pick([undefined, 'true', 'false']),
    keys: pick([['matters'], ['messages'], ['matters', 'parties'], ['documents', 'messages']]) as string[],
    tables: {
      legal_matters: matters,
      solicitor_matter_access: grants,
      solicitor_portal_client_assignments: assignments,
      solicitor_portal_default_permissions: defaults,
    },
  };
}

describe('readAccessibleMatterIds', () => {
  it('names exactly the matters the per-matter check opens, in every generated practice', async () => {
    let compared = 0;
    let named = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const w = world(seed);
      env.SOLICITOR_MATTER_ACCESS_V1 = w.flag;
      const supabase = fakeClient(w.tables, { mode: w.mode });

      const read = await readAccessibleMatterIds(supabase, w.user, w.firm, w.keys);
      expect(read.ok, `seed ${seed}`).toBe(true);
      const listed = new Set(read.ok ? read.ids : []);

      for (const matter of w.matters) {
        const access = await resolveSolicitorMatterAccess(supabase, w.user, w.firm, matter.id);
        const perms = access ? await resolveMatterPermissions(supabase, access) : null;
        const viewable = !!perms && w.keys.every((key) => can(perms, key, 'view'));
        expect(listed.has(matter.id), `seed ${seed}, ${matter.id}, keys ${w.keys.join('+')}, mode ${w.mode}, flag ${w.flag}`)
          .toBe(viewable);
        compared++;
        if (viewable) named++;
      }
    }
    // The comparison must have exercised both answers, or it proved nothing.
    expect(compared).toBe(400 * 14);
    expect(named).toBeGreaterThan(200);
    expect(compared - named).toBeGreaterThan(200);
  });

  it('keeps a legacy assignment that denies a key from listing that client under it', async () => {
    const supabase = fakeClient({
      legal_matters: [
        { id: 'm-1', client_id: 'c-denied', firm_id: 'firm-a' },
        { id: 'm-2', client_id: 'c-allowed', firm_id: 'firm-a' },
      ],
      solicitor_portal_client_assignments: [
        { id: 'a-1', solicitor_user_id: 'u', client_id: 'c-denied', permissions: { messages: { view: false } } },
        { id: 'a-2', solicitor_user_id: 'u', client_id: 'c-allowed', permissions: { messages: { view: true } } },
      ],
      solicitor_portal_default_permissions: [{ solicitor_user_id: 'u', permissions: { messages: { view: false } } }],
    }, { mode: 'off' });

    expect(await readAccessibleMatterIds(supabase, 'u', 'firm-a', 'messages')).toEqual({ ok: true, ids: ['m-2'] });
    // The same assignment says nothing about a key it does not name.
    expect(await readAccessibleMatterIds(supabase, 'u', 'firm-a', 'matters')).toEqual({ ok: true, ids: ['m-1', 'm-2'] });
  });

  it('follows the practice rollout mode, not the environment flag alone', async () => {
    const tables = {
      legal_matters: [
        { id: 'granted', client_id: 'c-1', firm_id: 'firm-a' },
        { id: 'assigned', client_id: 'c-2', firm_id: 'firm-a' },
      ],
      solicitor_matter_access: [
        { id: 'g-1', solicitor_user_id: 'u', legal_matter_id: 'granted', firm_id: 'firm-a', permissions: { matters: { view: 'allow' } }, valid_from: new Date(Date.now() - DAY).toISOString(), valid_until: null, revoked_at: null },
      ],
      solicitor_portal_client_assignments: [{ id: 'a', solicitor_user_id: 'u', client_id: 'c-2', permissions: null }],
    };
    expect(await readAccessibleMatterIds(fakeClient(tables, { mode: 'cutover' }), 'u', 'firm-a')).toEqual({ ok: true, ids: ['granted'] });
    expect(await readAccessibleMatterIds(fakeClient(tables, { mode: 'off' }), 'u', 'firm-a')).toEqual({ ok: true, ids: ['assigned'] });

    env.SOLICITOR_MATTER_ACCESS_V1 = 'false';
    const rollback = fakeClient(tables, { mode: 'cutover' });
    expect(await readAccessibleMatterIds(rollback, 'u', 'firm-a')).toEqual({ ok: true, ids: ['assigned'] });
    // The emergency rollback does not consult the practice at all.
    expect(rollback.log.rpc).toEqual([]);
  });

  it('pages past the thousand rows PostgREST answers and keeps every filter to a hundred ids', async () => {
    // 1,001 assignments, 2,500 grants, and one client holding 1,500 matters:
    // each read that answers a list crosses a page boundary at least once.
    const matters: Row[] = [];
    for (let i = 0; i < 2500; i++) matters.push({ id: `m-${String(i).padStart(4, '0')}`, client_id: i < 1500 ? 'c-big' : `c-${i}`, firm_id: 'firm-a' });
    const assignments: Row[] = [{ id: 'a-big', solicitor_user_id: 'u', client_id: 'c-big', permissions: null }];
    for (let i = 1500; i < 2500; i++) assignments.push({ id: `a-${i}`, solicitor_user_id: 'u', client_id: `c-${i}`, permissions: null });

    const legacy = fakeClient({ legal_matters: matters, solicitor_portal_client_assignments: assignments }, { mode: 'off' });
    const read = await readAccessibleMatterIds(legacy, 'u', 'firm-a');
    expect(read.ok && read.ids.length).toBe(2500);
    expect(Math.max(...legacy.log.inSizes)).toBeLessThanOrEqual(100);

    const grants = matters.map((m) => ({ id: `g-${m.id}`, solicitor_user_id: 'u', legal_matter_id: m.id, firm_id: 'firm-a', permissions: { matters: { view: 'allow' } }, valid_from: new Date(Date.now() - DAY).toISOString(), valid_until: null, revoked_at: null }));
    const cutover = fakeClient({ legal_matters: matters, solicitor_matter_access: grants }, { mode: 'cutover' });
    const granted = await readAccessibleMatterIds(cutover, 'u', 'firm-a');
    expect(granted.ok && granted.ids.length).toBe(2500);
    expect(Math.max(...cutover.log.inSizes)).toBeLessThanOrEqual(100);
  });

  it('reports every failed read instead of answering an empty list', async () => {
    const tables = {
      legal_matters: [{ id: 'm-1', client_id: 'c-1', firm_id: 'firm-a' }],
      solicitor_matter_access: [{ id: 'g-1', solicitor_user_id: 'u', legal_matter_id: 'm-1', firm_id: 'firm-a', permissions: null, valid_from: new Date(Date.now() - DAY).toISOString(), valid_until: null, revoked_at: null }],
      solicitor_portal_client_assignments: [{ id: 'a', solicitor_user_id: 'u', client_id: 'c-1', permissions: null }],
      solicitor_portal_default_permissions: [{ solicitor_user_id: 'u', permissions: { matters: { view: 'allow' } } }],
    };
    const cases: Array<[FakeOptions, RegExp]> = [
      [{ mode: 'cutover', fail: { rpc: 'rpc down' } }, /access mode: rpc down/],
      [{ mode: 'cutover', fail: { solicitor_portal_default_permissions: 'baseline down' } }, /baseline permissions: baseline down/],
      [{ mode: 'cutover', fail: { solicitor_matter_access: 'grants down' } }, /matter grants: grants down/],
      [{ mode: 'cutover', fail: { legal_matters: 'matters down' } }, /matters: matters down/],
      [{ mode: 'off', fail: { solicitor_portal_client_assignments: 'assignments down' } }, /client assignments: assignments down/],
      [{ mode: 'off', fail: { legal_matters: 'matters down' } }, /matters: matters down/],
    ];
    for (const [options, reason] of cases) {
      const read = await readAccessibleMatterIds(fakeClient(tables, options), 'u', 'firm-a');
      expect(read.ok).toBe(false);
      expect(read.ok ? '' : read.error).toMatch(reason);
      await expect(listAccessibleMatterIds(fakeClient(tables, options), 'u', 'firm-a'))
        .rejects.toThrow(/could not be read/);
    }
    // And the control: the same tables with nothing failing do list the matter.
    expect(await listAccessibleMatterIds(fakeClient(tables, { mode: 'cutover' }), 'u', 'firm-a')).toEqual(['m-1']);
  });

  it('refuses a request that names no permission at all', async () => {
    const read = await readAccessibleMatterIds(fakeClient({}), 'u', 'firm-a', []);
    expect(read.ok).toBe(false);
  });
});
