/**
 * Parity test (rehaul Phase 4): the client resolver, the edge resolver, and
 * their shared precedence contract must never drift.
 *
 * Both modules used to carry a hand-maintained "KEEP IN SYNC" comment; this
 * spec makes the sync mechanical:
 * - rankReportTemplates (client) vs rankReportTemplates (edge) over a fixed
 *   scenario matrix AND a seeded randomized matrix.
 * - full resolve flows: RPC-first behaviour, authoritative no-match, and JS
 *   fallback parity when the RPC is unavailable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  rpcImpl: vi.fn<(...args: any[]) => any>(),
  listImpl: vi.fn<(...args: any[]) => any>(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: any[]) => harness.rpcImpl(...args) },
}));

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: (...args: any[]) => harness.listImpl(...args),
}));

import {
  rankReportTemplates as rankClient,
  resolveReportTemplate as resolveClient,
  type ResolveOpts,
} from '../resolveTemplate';
// The jsr import inside the edge module is type-only, so it transpiles away.
import {
  rankReportTemplates as rankEdge,
  resolveReportTemplate as resolveEdge,
} from '../../../../supabase/functions/_shared/resolveReportTemplate';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const USER_A = 'user-aaa';
const USER_B = 'user-bbb';
const AGENCY_A = 'agency-aaa';

let rowSeq = 0;
function row(partial: Record<string, any>): Record<string, any> {
  rowSeq += 1;
  return {
    id: `tpl-${rowSeq}`,
    report_type: 'investment',
    is_active: true,
    scope: 'global',
    variant: null,
    priority: 0,
    owner_user_id: null,
    agency_id: null,
    engine: 'weasyprint',
    updated_at: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

/** Fake edge SupabaseClient: rpc + from().select().eq().eq().order().limit(). */
function fakeEdgeClient(rows: any[], rpc: (name: string, params: any) => any) {
  const result = Promise.resolve({ data: rows, error: null });
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => result,
  };
  return {
    rpc: (name: string, params: any) => Promise.resolve(rpc(name, params)),
    from: () => chain,
  } as any;
}

const RPC_DOWN = { data: null, error: { message: 'function resolve_report_template does not exist' } };

function clientWithFallback(rows: any[]) {
  harness.rpcImpl.mockResolvedValue(RPC_DOWN);
  harness.listImpl.mockResolvedValue({ data: { records: rows }, error: null });
}

// ── Scenario matrix ──────────────────────────────────────────────────────────

interface Scenario {
  name: string;
  rows: Record<string, any>[];
  opts: ResolveOpts;
  expectedId: string | null;
  expectedSource?: string;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'user scope beats agency and global',
    rows: [
      row({ id: 'global', scope: 'global', variant: 'composite' }),
      row({ id: 'agency', scope: 'agency', agency_id: AGENCY_A, variant: 'composite' }),
      row({ id: 'user', scope: 'user', owner_user_id: USER_A, variant: 'composite' }),
    ],
    opts: { reportType: 'investment', variant: 'composite', agencyId: AGENCY_A, userId: USER_A },
    expectedId: 'user',
    expectedSource: 'user',
  },
  {
    name: 'agency beats global when no user template matches',
    rows: [
      row({ id: 'global', scope: 'global', variant: 'composite' }),
      row({ id: 'agency', scope: 'agency', agency_id: AGENCY_A, variant: 'composite' }),
      row({ id: 'other-user', scope: 'user', owner_user_id: USER_B, variant: 'composite' }),
    ],
    opts: { reportType: 'investment', variant: 'composite', agencyId: AGENCY_A, userId: USER_A },
    expectedId: 'agency',
    expectedSource: 'agency',
  },
  {
    name: 'global exact variant beats global catch-all',
    rows: [
      row({ id: 'catch-all', scope: 'global', variant: null }),
      row({ id: 'exact', scope: 'global', variant: 'financial' }),
    ],
    opts: { reportType: 'investment', variant: 'financial' },
    expectedId: 'exact',
    expectedSource: 'global-variant',
  },
  {
    name: 'global catch-all wins when variant has no exact match',
    rows: [
      row({ id: 'catch-all', scope: 'global', variant: null }),
      row({ id: 'other-variant', scope: 'global', variant: 'financial' }),
    ],
    opts: { reportType: 'investment', variant: 'due_diligence' },
    expectedId: 'catch-all',
    expectedSource: 'global-any',
  },
  {
    name: 'priority DESC breaks ties within the same source',
    rows: [
      row({ id: 'low', scope: 'global', variant: 'composite', priority: 1 }),
      row({ id: 'high', scope: 'global', variant: 'composite', priority: 9 }),
    ],
    opts: { reportType: 'investment', variant: 'composite' },
    expectedId: 'high',
  },
  {
    name: 'updated_at DESC breaks priority ties',
    rows: [
      row({ id: 'older', scope: 'global', variant: null, updated_at: '2026-01-01T00:00:00Z' }),
      row({ id: 'newer', scope: 'global', variant: null, updated_at: '2026-03-01T00:00:00Z' }),
    ],
    opts: { reportType: 'investment' },
    expectedId: 'newer',
  },
  {
    name: 'user-scope template with NULL variant matches any requested variant',
    rows: [
      row({ id: 'user-any', scope: 'user', owner_user_id: USER_A, variant: null }),
      row({ id: 'global-exact', scope: 'global', variant: 'composite' }),
    ],
    opts: { reportType: 'investment', variant: 'composite', userId: USER_A },
    expectedId: 'user-any',
    expectedSource: 'user',
  },
  {
    name: 'user scope is ignored when no userId is provided',
    rows: [
      row({ id: 'user', scope: 'user', owner_user_id: USER_A, variant: null }),
      row({ id: 'global', scope: 'global', variant: null }),
    ],
    opts: { reportType: 'investment' },
    expectedId: 'global',
    expectedSource: 'global-any',
  },
  {
    name: 'missing scope defaults to global',
    rows: [row({ id: 'legacy', scope: undefined, variant: null })],
    opts: { reportType: 'investment' },
    expectedId: 'legacy',
    expectedSource: 'global-any',
  },
  {
    name: 'no candidates → null',
    rows: [
      row({ id: 'foreign-agency', scope: 'agency', agency_id: 'someone-else', variant: null }),
      row({ id: 'global-wrong-variant', scope: 'global', variant: 'financial' }),
    ],
    opts: { reportType: 'investment', variant: 'composite' },
    expectedId: null,
  },
];

// ── Seeded randomized matrix ─────────────────────────────────────────────────

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function randomRows(rand: () => number): Record<string, any>[] {
  const scopes = ['user', 'agency', 'global', undefined];
  const variants = ['composite', 'financial', 'due_diligence', null];
  const count = 1 + Math.floor(rand() * 8);
  return Array.from({ length: count }, () =>
    row({
      scope: scopes[Math.floor(rand() * scopes.length)],
      variant: variants[Math.floor(rand() * variants.length)],
      priority: Math.floor(rand() * 4),
      owner_user_id: rand() > 0.5 ? USER_A : USER_B,
      agency_id: rand() > 0.5 ? AGENCY_A : 'agency-other',
      updated_at: new Date(1700000000000 + Math.floor(rand() * 5) * 86_400_000).toISOString(),
    }),
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  harness.rpcImpl.mockReset();
  harness.listImpl.mockReset();
});

describe('client/edge ranking parity', () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, () => {
      const client = rankClient(scenario.rows, scenario.opts);
      const edge = rankEdge(scenario.rows, scenario.opts);

      expect(edge?.row?.id ?? null).toBe(client?.row?.id ?? null);
      expect(edge?.source ?? null).toBe(client?.source ?? null);

      expect(client?.row?.id ?? null).toBe(scenario.expectedId);
      if (scenario.expectedSource) expect(client?.source).toBe(scenario.expectedSource);
    });
  }

  it('agrees across 250 seeded randomized row sets', () => {
    const rand = lcg(0xc0ffee);
    const variants = ['composite', 'financial', 'due_diligence', null] as const;
    for (let i = 0; i < 250; i++) {
      const rows = randomRows(rand);
      const opts: ResolveOpts = {
        reportType: 'investment',
        variant: variants[Math.floor(rand() * variants.length)],
        agencyId: rand() > 0.3 ? AGENCY_A : null,
        userId: rand() > 0.3 ? USER_A : null,
      };
      const client = rankClient(rows, opts);
      const edge = rankEdge(rows, opts);
      expect(edge?.row?.id ?? null).toBe(client?.row?.id ?? null);
      expect(edge?.source ?? null).toBe(client?.source ?? null);
    }
  });
});

describe('full resolve parity (RPC unavailable → JS fallback)', () => {
  for (const scenario of SCENARIOS) {
    it(scenario.name, async () => {
      clientWithFallback(scenario.rows);
      const edgeClient = fakeEdgeClient(scenario.rows, () => RPC_DOWN);

      const client = await resolveClient(scenario.opts);
      const edge = await resolveEdge(edgeClient, scenario.opts);

      expect(edge?.template?.id ?? null).toBe(client?.template?.id ?? null);
      expect(edge?.source ?? null).toBe(client?.source ?? null);
      expect(edge?.engine ?? null).toBe(client?.engine ?? null);
      expect(client?.template?.id ?? null).toBe(scenario.expectedId);
    });
  }
});

describe('RPC-first behaviour', () => {
  const winner = row({ id: 'rpc-winner', scope: 'global', variant: null });

  it('both resolvers honor the RPC result without falling back', async () => {
    harness.rpcImpl.mockResolvedValue({ data: [{ template: winner, source: 'global-any' }], error: null });
    const edgeClient = fakeEdgeClient([], () => ({ data: [{ template: winner, source: 'global-any' }], error: null }));

    const client = await resolveClient({ reportType: 'investment' });
    const edge = await resolveEdge(edgeClient, { reportType: 'investment' });

    expect(client?.template.id).toBe('rpc-winner');
    expect(edge?.template.id).toBe('rpc-winner');
    expect(client?.source).toBe('global-any');
    expect(harness.listImpl).not.toHaveBeenCalled();
  });

  it('an empty RPC result is an authoritative no-match (no fallback)', async () => {
    harness.rpcImpl.mockResolvedValue({ data: [], error: null });
    const edgeClient = fakeEdgeClient([row({ id: 'should-not-resolve' })], () => ({ data: [], error: null }));

    expect(await resolveClient({ reportType: 'investment' })).toBeNull();
    expect(await resolveEdge(edgeClient, { reportType: 'investment' })).toBeNull();
    expect(harness.listImpl).not.toHaveBeenCalled();
  });

  it('passes lowercased report type and normalized params to the RPC', async () => {
    harness.rpcImpl.mockResolvedValue({ data: [], error: null });
    await resolveClient({ reportType: 'INVESTMENT', variant: undefined, agencyId: undefined, userId: undefined });
    expect(harness.rpcImpl).toHaveBeenCalledWith('resolve_report_template', {
      p_report_type: 'investment',
      p_variant: null,
      p_agency_id: null,
      p_user_id: null,
    });
  });

  it('returns null for an empty report type without touching the network', async () => {
    expect(await resolveClient({ reportType: '' })).toBeNull();
    expect(harness.rpcImpl).not.toHaveBeenCalled();
    expect(harness.listImpl).not.toHaveBeenCalled();
  });
});
