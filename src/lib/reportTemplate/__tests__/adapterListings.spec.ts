/**
 * The adapters' report listers, and the routing read they exposed.
 *
 * `listRecentReports` is what generalised the template preview's real-data
 * picker: it was hard-wired to `investment_reports` for as long as the adapter
 * interface could not list, so eight of the nine production formats' templates
 * could only ever be previewed against sample data. Each lister here is pinned
 * to its own table, its own label column, and `[]` on error.
 *
 * The second half pins a bug this work surfaced. `clientDetailsAdapter`'s
 * routing read selected `first_name, last_name` — **neither column exists on
 * `clients`**, which stores `primary_first_name` / `primary_surname` — so
 * PostgREST answered `42703`, routing declined every client in the database,
 * and the format's fifty masters were unreachable through the product path
 * while `buildBindingContext` (`select('*')`) worked in every harness. The
 * same misspelling once 404'd `render-borrowing-capacity-pdf` for every
 * client; `CLIENT_NAME_COLUMNS` exists so there cannot be a fourth spelling,
 * and the assertion here is that the routing read uses it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface QueryLog {
  table: string;
  select: string | null;
  eq: Array<[string, unknown]>;
  in: Array<[string, unknown[]]>;
  not: Array<[string, string, unknown]>;
  head?: boolean;
  order: Array<[string, Record<string, unknown>]>;
  limit: number | null;
}

const harness: {
  rows: Record<string, Array<Record<string, unknown>>>;
  errors: Record<string, { message: string } | null>;
  queries: QueryLog[];
  secure: { data: unknown; error: unknown };
  secureCalls: Array<[string, Record<string, unknown>]>;
} = { rows: {}, errors: {}, queries: [], secure: { data: null, error: null }, secureCalls: [] };

function builderFor(table: string) {
  const log: QueryLog = { table, select: null, eq: [], in: [], not: [], order: [], limit: null };
  harness.queries.push(log);
  const result = () => {
    if (harness.errors[table]) return { data: null, error: harness.errors[table] };
    let data = harness.rows[table] ?? [];
    // `.in('id', [...])` is honoured, because a lister that reads one table
    // twice under different filters is otherwise untestable — the stub would
    // answer both with everything and the ordering under test would look
    // right for the wrong reason.
    for (const [col, values] of log.in) {
      data = data.filter((row) => (values as unknown[]).includes(row[col]));
    }
    for (const [col, value] of log.eq) {
      data = data.filter((row) => row[col] === value);
    }
    // `.select('id', { count: 'exact', head: true })` asks how many rows match
    // and asks for none of them; a stub that answered only `data` could not
    // express the difference.
    return { data, count: data.length, error: null };
  };
  const chain: Record<string, unknown> = {
    select: (cols: string, opts?: Record<string, unknown>) => {
      log.select = cols;
      if (opts?.head) log.head = true;
      return chain;
    },
    eq: (col: string, val: unknown) => { log.eq.push([col, val]); return chain; },
    in: (col: string, vals: unknown[]) => { log.in.push([col, vals]); return chain; },
    not: (col: string, op: string, val: unknown) => { log.not.push([col, op, val]); return chain; },
    order: (col: string, opts: Record<string, unknown>) => { log.order.push([col, opts]); return chain; },
    limit: (n: number) => { log.limit = n; return chain; },
    maybeSingle: async () => {
      const r = result();
      return { data: (r.data as unknown[])?.[0] ?? null, error: r.error };
    },
    // Supabase builders are thenables; the listers await the chain itself.
    then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(onOk, onErr),
  };
  return chain;
}

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (table: string) => builderFor(table) },
}));

/**
 * The gateway client, served from the same builders as the anon one.
 *
 * `authenticated-data` rewrites a PostgREST request onto an edge function that
 * verifies the session cookie — the query it sends is the query the caller
 * wrote, so a stub that answered it differently from the table stub would be
 * testing the transport rather than the lister. What the two clients differ on
 * is who may read, which is a property of the deployment and not of this file;
 * `adapterSourceReadable.spec.ts` is where the *choice* of client is held.
 */
vi.mock('@/hooks/useAuthenticatedSupabase', () => ({
  getAuthenticatedSupabaseClient: () => ({ from: (table: string) => builderFor(table) }),
}));

/**
 * The brokers, served from the same seeded rows as the tables.
 *
 * Three of the tables these adapters need — `investment_reports`,
 * `property_comparisons`, `clients` — are invisible to the browser client
 * under this app's custom auth (see `adapters/secureSource.ts`), so the
 * adapters read them through `get-investment-reports` and `get-client-data`.
 * This stub answers those two calls out of `harness.rows`, which keeps every
 * assertion below about the thing it was written to check — the label column,
 * the ordering, the `[]`-on-error rule — rather than about the transport.
 *
 * `harness.secure` still wins when a test sets it, so a test can still say
 * "the broker failed" without reaching for a table.
 */
vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: async (name: string, payload: Record<string, unknown>) => {
    harness.secureCalls.push([name, payload]);
    if (harness.secure.data !== null || harness.secure.error !== null) return harness.secure;

    const rows = (table: string) => harness.rows[table] ?? [];
    const failed = (table: string) => harness.errors[table] ?? null;

    if (name === 'get-investment-reports') {
      const table = String(payload.table ?? 'investment_reports');
      if (failed(table)) return { data: null, error: failed(table) };
      const id = payload.reportId as string | undefined;
      if (id) {
        const row = rows(table).find((r) => r.id === id) ?? null;
        return { data: { success: true, report: row }, error: null };
      }
      return { data: { success: true, reports: rows(table) }, error: null };
    }

    if (name === 'manage-ci-assessments') {
      const table = 'commercial_industrial_assessments';
      if (failed(table)) return { data: null, error: failed(table) };
      if (payload.operation === 'list') return { data: { data: rows(table) }, error: null };
      if (payload.operation === 'get') {
        const assessment = rows(table).find((r) => r.id === payload.assessmentId) ?? null;
        if (!assessment) return { data: null, error: { message: 'not found' } };
        // The broker hands back the assessment's LATEST base run, which the
        // adapter then checks against `current_calculation_id` rather than
        // trusting — a re-issued report must say what the first one said.
        const latestRun = rows('commercial_industrial_calculation_runs')
          .find((r) => r.assessment_id === assessment.id) ?? null;
        return { data: { data: { assessment, latestRun } }, error: null };
      }
      return { data: null, error: { message: `unsupported operation ${payload.operation}` } };
    }

    if (name === 'get-client-data') {
      // List mode against a named table: the broker's own shape is
      // `{ success, records }`, and `secureSource.ts` reads exactly that.
      const options = (payload.listOptions ?? {}) as Record<string, any>;
      const listTable = options.table as string | undefined;
      if (payload.listMode && listTable && listTable !== 'clients') {
        if (failed(listTable)) return { data: null, error: failed(listTable) };
        let records = rows(listTable);
        for (const [col, value] of Object.entries(options.filters ?? {})) {
          records = records.filter((r) => r[col] === value);
        }
        if (options.limit) records = records.slice(0, options.limit as number);
        return { data: { success: true, records, count: records.length }, error: null };
      }

      if (failed('clients')) return { data: null, error: failed('clients') };
      const clientId = payload.clientId as string | undefined;
      if (clientId) {
        const client = rows('clients').find((r) => r.id === clientId) ?? null;
        if (!client) return { data: null, error: { message: 'Client not found' } };
        const include = (payload.include ?? {}) as Record<string, boolean>;
        const child = (table: string) => rows(table).filter((r) => r.client_id === clientId);
        return {
          data: {
            success: true,
            client,
            ...(include.properties === false ? {} : { properties: child('client_properties') }),
            ...(include.employment ? { employment: child('client_employment') } : {}),
            ...(include.income ? { income: child('client_income') } : {}),
            ...(include.incomeSources ? { incomeSources: child('client_income_sources') } : {}),
            ...(include.assets ? { assets: child('client_assets') } : {}),
            ...(include.liabilities ? { liabilities: child('client_liabilities') } : {}),
            ...(include.expenses ? { expenses: child('client_expenses') } : {}),
            ...(include.addressHistory ? { addressHistory: child('client_address_history') } : {}),
          },
          error: null,
        };
      }
      return { data: { success: true, clients: rows('clients') }, error: null };
    }

    return harness.secure;
  },
}));

import { listAdapters, getAdapter } from '../adapters';
import { clientDetailsAdapter } from '../adapters/clientDetailsAdapter';
import { CLIENT_NAME_COLUMNS } from '../../../../supabase/functions/_shared/clientName';

const lastQuery = (table: string) =>
  [...harness.queries].reverse().find((q) => q.table === table);

/** The last call made to a broker, for the reads that no longer touch a table. */
const lastCall = (fn: string) =>
  [...harness.secureCalls].reverse().find(([name]) => name === fn)?.[1] ?? null;

beforeEach(() => {
  harness.rows = {};
  harness.errors = {};
  harness.queries = [];
  harness.secureCalls = [];
  harness.secure = { data: null, error: null };
});

describe('every production adapter can list', () => {
  it('implements listRecentReports on all nine, so no format is picker-blind again', () => {
    const production = listAdapters().filter((a) => a.supportsProduction);
    expect(production).toHaveLength(9);
    for (const adapter of production) {
      expect(typeof adapter.listRecentReports, adapter.reportType).toBe('function');
    }
  });
});

describe('each lister reads its own table', () => {
  it('investment lists through the secure edge function', async () => {
    harness.secure = {
      data: { reports: [{ id: 'i1', property_address: '12 Harbour St, Kirribilli', created_at: '2026-08-01' }] },
      error: null,
    };
    const rows = await getAdapter('investment')!.listRecentReports!();
    expect(harness.secureCalls[0][0]).toBe('get-investment-reports');
    expect(harness.secureCalls[0][1]).toMatchObject({ listMode: true });
    expect(rows).toEqual([
      { id: 'i1', label: '12 Harbour St, Kirribilli', savedAt: '2026-08-01' },
    ]);
  });

  it('investment does not fall back to the table, because it cannot be read', async () => {
    // This used to assert a browser-client fallback. That fallback could never
    // work: `investment_reports`' only non-service SELECT policy is gated on
    // `auth.uid()`, which is NULL under this app's custom cookie auth, so the
    // read returns zero rows for every report. It read as though a second
    // route existed, and it turned a broker failure into the same empty list
    // more slowly. An empty list is the honest answer.
    harness.secure = { data: null, error: { message: 'unavailable' } };
    harness.rows.investment_reports = [
      { id: 'i2', property_address: '4/9 Bent St, Neutral Bay', created_at: '2026-07-20' },
    ];
    const rows = await getAdapter('investment')!.listRecentReports!();
    expect(rows).toEqual([]);
    expect(lastQuery('investment_reports'), 'the adapter read the invisible table directly')
      .toBeUndefined();
  });

  it('borrowing capacity joins the client names through CLIENT_NAME_COLUMNS', async () => {
    harness.rows.borrowing_capacity_assessments = [
      { id: 'b1', client_id: 'c1', created_at: '2026-08-10' },
      { id: 'b2', client_id: 'c-missing', created_at: '2026-08-09' },
    ];
    harness.rows.clients = [
      { id: 'c1', primary_first_name: 'JORDAN', primary_surname: 'NGUYEN' },
    ];
    const rows = await getAdapter('borrowing_capacity')!.listRecentReports!();
    // Through the broker now — `clients` is invisible to the browser client —
    // but still asking for the one sanctioned spelling of the name columns.
    const call = lastCall('get-client-data') as Record<string, any> | null;
    expect(call?.listOptions?.select).toContain(CLIENT_NAME_COLUMNS);
    expect(lastQuery('clients'), 'the adapter read `clients` directly').toBeUndefined();
    // The name is cased for print, and a client that cannot be read still
    // lists — without a name, not without a row.
    expect(rows.map((r) => r.label)).toEqual(['Jordan Nguyen', 'Borrowing capacity assessment']);
  });

  it('portfolio labels by the stored client name', async () => {
    harness.rows.portfolio_analysis_reports = [
      { id: 'p1', client_name: 'Jordan & Sarah Nguyen', created_at: '2026-08-12' },
    ];
    const rows = await getAdapter('portfolio')!.listRecentReports!();
    expect(rows).toEqual([
      { id: 'p1', label: 'Jordan & Sarah Nguyen', savedAt: '2026-08-12' },
    ]);
  });

  it('comparison labels by the report title', async () => {
    harness.rows.property_comparisons = [
      { id: 'x1', report_title: 'Newtown vs Marrickville', created_at: '2026-08-11' },
      { id: 'x2', report_title: null, created_at: '2026-08-10' },
    ];
    const rows = await getAdapter('comparison')!.listRecentReports!();
    expect(rows.map((r) => r.label)).toEqual(['Newtown vs Marrickville', 'Property comparison']);
  });

  it('cash flow lists only reports that store a projection', async () => {
    harness.rows.investment_reports = [
      { id: 'i3', property_address: '7 Regent St, Newtown', created_at: '2026-08-08' },
    ];
    const rows = await getAdapter('cashflow')!.listRecentReports!();
    // The `projections is not null` filter cannot travel with the brokered
    // read: the list projection omits the `financial_calculations` blob on
    // purpose. `projectCashFlow`'s structural check is — and always was — the
    // guard that actually refuses a report with no series, at render time.
    // Listing one costs a refusal; the direct read cost the whole picker.
    expect(lastQuery('investment_reports'), 'the adapter read the invisible table directly')
      .toBeUndefined();
    expect(rows.map((r) => r.label)).toEqual(['7 Regent St, Newtown']);
  });

  it('client details lists clients by their real name columns', async () => {
    harness.rows.clients = [
      { id: 'c2', primary_first_name: 'sam', primary_surname: 'taylor', updated_at: '2026-08-05' },
    ];
    const rows = await getAdapter('client_details')!.listRecentReports!();
    // Through the broker, and still naming the columns that exist: this is the
    // assertion that caught `first_name, last_name`, which is on no table.
    const call = lastCall('get-client-data') as Record<string, any> | null;
    expect(call?.listOptions?.select).toBe(
      `${CLIENT_NAME_COLUMNS}, primary_middle_name, secondary_middle_name, updated_at, created_at`,
    );
    expect(rows).toEqual([{ id: 'c2', label: 'Sam Taylor', savedAt: '2026-08-05' }]);
  });

  it('client details offers the clients who have something to show first', async () => {
    // 34 of 775 production clients hold any financial record, so ordering by
    // recency alone filled the picker with documents of empty tables.
    harness.rows.client_properties = [{ client_id: 'has-property' }];
    harness.rows.client_assets = [{ client_id: 'has-asset' }, { client_id: 'has-property' }];
    harness.rows.client_liabilities = [];
    harness.rows.client_employment = [];
    harness.rows.client_expenses = [{ client_id: 'has-expenses' }];
    harness.rows.clients = [
      { id: 'empty-1', primary_first_name: 'em', primary_surname: 'one', updated_at: '2026-08-14' },
      { id: 'empty-2', primary_first_name: 'em', primary_surname: 'two', updated_at: '2026-08-13' },
      { id: 'has-property', primary_first_name: 'pat', primary_surname: 'property', updated_at: '2026-08-02' },
      { id: 'has-asset', primary_first_name: 'ash', primary_surname: 'asset', updated_at: '2026-08-01' },
      { id: 'has-expenses', primary_first_name: 'ex', primary_surname: 'expense', updated_at: '2026-07-30' },
    ];

    const rows = await getAdapter('client_details')!.listRecentReports!({ limit: 5 });
    const ids = rows.map((r) => r.id);
    // The three with records lead, despite being the three least recently
    // touched, and each appears once.
    expect(ids.slice(0, 3)).toEqual(['has-property', 'has-asset', 'has-expenses']);
    expect(new Set(ids).size).toBe(ids.length);
    // And a client with nothing recorded is still one click away, because that
    // is 96% of the table and what these masters are built around.
    expect(ids).toContain('empty-1');
  });

  it('client details still lists when the record tables cannot be read', async () => {
    harness.errors.client_properties = { message: 'permission denied' };
    harness.errors.client_assets = { message: 'permission denied' };
    harness.errors.client_liabilities = { message: 'permission denied' };
    harness.errors.client_employment = { message: 'permission denied' };
    harness.errors.client_expenses = { message: 'permission denied' };
    harness.rows.clients = [
      { id: 'c9', primary_first_name: 'ada', primary_surname: 'lovelace', updated_at: '2026-08-05' },
    ];
    // The preference is a preference: a picker ordered by recency is still a
    // picker, and this read failing must not empty it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const rows = await getAdapter('client_details')!.listRecentReports!();
    expect(rows.map((r) => r.label)).toEqual(['Ada Lovelace']);
    // Degrading quietly is what hid this whole class: the broker answers `[]`
    // for a refusal and for an empty table alike, so the refusal is said out
    // loud even though nothing fails. One line per table that could not be
    // read.
    expect(warn).toHaveBeenCalledTimes(5);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('client_expenses'));
    warn.mockRestore();
  });

  it('report q&a labels by the conversation title', async () => {
    harness.rows.report_qa_conversations = [
      { id: 'q1', title: 'Questions about the Newtown report', created_at: '2026-08-04' },
      { id: 'q2', title: null, created_at: '2026-08-03' },
    ];
    const rows = await getAdapter('qa')!.listRecentReports!();
    expect(rows.map((r) => r.label))
      .toEqual(['Questions about the Newtown report', 'Report Q&A']);
  });

  it('commercial capacity offers only what the render route would accept', async () => {
    harness.rows.commercial_industrial_assessments = [
      { id: 'a1', title: 'Warehouse — Botany', reference: 'CIA-001', status: 'completed', current_calculation_id: 'run-1', created_at: '2026-08-02' },
      { id: 'a2', title: 'Draft deal', reference: 'CIA-002', status: 'draft', current_calculation_id: 'run-2', created_at: '2026-08-01' },
      { id: 'a3', title: 'No run yet', reference: 'CIA-003', status: 'completed', current_calculation_id: null, created_at: '2026-07-30' },
      { id: 'a4', title: '', reference: 'CIA-004', status: 'linked', current_calculation_id: 'run-4', created_at: '2026-07-29' },
    ];
    const rows = await getAdapter('commercial_capacity')!.listRecentReports!();
    // `isReportable` plus a linked run — the picker cannot offer a row the
    // adapter would then decline. The empty title falls back to the reference.
    expect(rows.map((r) => r.label)).toEqual(['Warehouse — Botany', 'CIA-004']);
  });

  it('market intelligence labels by the edition period', async () => {
    harness.rows.marketing_intelligence_reports = [
      { id: 'm1', report_period: 'March 2026', generated_at: '2026-03-02' },
      { id: 'm2', report_period: null, generated_at: '2026-02-02' },
    ];
    const rows = await getAdapter('market_intelligence')!.listRecentReports!();
    expect(rows.map((r) => r.label))
      .toEqual(['Market Intelligence — March 2026', 'Market Intelligence']);
  });

  it('returns an empty list — never throws — when the read errors', async () => {
    harness.errors.portfolio_analysis_reports = { message: 'permission denied' };
    await expect(getAdapter('portfolio')!.listRecentReports!()).resolves.toEqual([]);
  });
});

describe('routing declines what binding would decline', () => {
  /**
   * Routing resolves before binding. If it resolves for a record the binding
   * then refuses, the operator is offered a ready-looking template that
   * produces nothing — and until the router was fixed to honour a null
   * context, it produced something far worse: the whole document with every
   * field empty. `cashFlowAdapter` documents this rule and checks it in both
   * of its methods; these two did not.
   */
  it('report q&a refuses a conversation with no answer in it', async () => {
    // 22 of the 252 stored conversations have no assistant turn, 21 of them no
    // message at all.
    harness.rows.report_qa_conversations = [{ id: 'q1', title: 'Unanswered', created_at: '2026-08-04' }];
    harness.rows.report_qa_messages = [
      { id: 'm1', conversation_id: 'q1', role: 'user', content: 'What about Newtown?' },
    ];
    expect(await getAdapter('qa')!.resolveRoutingContext({ reportId: 'q1' })).toBeNull();

    const counted = harness.queries.find((q) => q.table === 'report_qa_messages');
    // Asked as a count with no body: cheaper than the transcript read it saves.
    expect(counted?.head).toBe(true);
    expect(counted?.eq).toEqual([['conversation_id', 'q1'], ['role', 'assistant']]);
  });

  it('report q&a routes a conversation that has one', async () => {
    harness.rows.report_qa_conversations = [{ id: 'q2', title: 'Answered', created_at: '2026-08-04' }];
    harness.rows.report_qa_messages = [
      { id: 'm1', conversation_id: 'q2', role: 'user', content: 'What about Newtown?' },
      { id: 'm2', conversation_id: 'q2', role: 'assistant', content: 'Here is the answer.' },
    ];
    const routing = await getAdapter('qa')!.resolveRoutingContext({ reportId: 'q2' });
    expect(routing?.title).toBe('Answered');
  });

  it('report q&a refuses the structured subject when none is stored', async () => {
    harness.rows.report_qa_messages = [
      { id: 'm2', conversation_id: 'q3', role: 'assistant', content: 'Here is the answer.' },
    ];
    harness.rows.report_qa_conversations = [
      { id: 'q3', title: 'Answered', structured_report: null, created_at: '2026-08-04' },
    ];
    const qa = getAdapter('qa')!;
    // The transcript is there to render; the structured report is not.
    expect(await qa.resolveRoutingContext({ reportId: 'q3', variant: 'structured' })).toBeNull();
    expect(await qa.resolveRoutingContext({ reportId: 'q3', variant: 'transcript' })).toBeTruthy();
  });

  it('market intelligence refuses a report the normaliser would refuse', async () => {
    const payload = { suburbName: 'Newtown' };
    // Both latent today — all six stored reports are completed and carry a
    // payload — and both free, because the routing read already selects them.
    harness.rows.marketing_intelligence_reports = [
      { id: 'm1', report_data: null, status: 'completed', report_period: 'March 2026' },
    ];
    expect(await getAdapter('market_intelligence')!.resolveRoutingContext({ reportId: 'm1' })).toBeNull();

    harness.rows.marketing_intelligence_reports = [
      { id: 'm2', report_data: payload, status: 'generating', report_period: 'March 2026' },
    ];
    expect(await getAdapter('market_intelligence')!.resolveRoutingContext({ reportId: 'm2' })).toBeNull();

    harness.rows.marketing_intelligence_reports = [
      { id: 'm3', report_data: payload, status: 'completed', report_period: 'March 2026' },
    ];
    const routing = await getAdapter('market_intelligence')!.resolveRoutingContext({ reportId: 'm3' });
    expect(routing?.title).toBe('Market Intelligence — March 2026');
  });
});

describe('the client details routing read', () => {
  it('selects the columns that exist, through the one sanctioned constant', async () => {
    harness.rows.clients = [
      { id: 'c3', primary_first_name: 'JORDAN', primary_surname: 'NGUYEN', updated_at: '2026-08-05', created_at: '2026-08-01' },
    ];
    const routing = await clientDetailsAdapter.resolveRoutingContext({ reportId: 'c3' });
    // The read is brokered now, and the broker returns the whole client row
    // rather than a projection — so the misspelling this test was written for
    // (`first_name, last_name`, a PostgREST 42703 that declined every client)
    // is no longer expressible on this path at all. What is still worth
    // pinning is the consequence it broke: the routing read reaches a real
    // client and titles the document with the name the page will print.
    expect(lastQuery('clients'), 'the routing read touched the invisible table')
      .toBeUndefined();
    expect(lastCall('get-client-data')).toMatchObject({ clientId: 'c3' });
    expect(routing?.title).toBe('Client details — Jordan Nguyen');
  });

  it('titles the file with the name the document prints, middle name and all', async () => {
    harness.rows.clients = [{
      id: 'c4',
      primary_first_name: 'ada', primary_middle_name: 'beatrice', primary_surname: 'lovelace',
      updated_at: '2026-08-05',
    }];
    const routing = await clientDetailsAdapter.resolveRoutingContext({ reportId: 'c4' });
    // Eleven production records carry a middle name and the pages print it;
    // the file used to be titled for a differently-named person.
    expect(routing?.title).toBe('Client details — Ada Beatrice Lovelace');
  });

  it('titles a two-person record the way the document names the household', async () => {
    harness.rows.clients = [{
      id: 'c5',
      primary_first_name: 'ada', primary_surname: 'lovelace',
      secondary_first_name: 'charles', secondary_surname: 'babbage',
      updated_at: '2026-08-05',
    }];
    const routing = await clientDetailsAdapter.resolveRoutingContext({ reportId: 'c5' });
    expect(routing?.title).toBe('Client details — Ada Lovelace & Charles Babbage');
  });

  it('falls back to the plain title when the record names nobody', async () => {
    harness.rows.clients = [{ id: 'c6', updated_at: '2026-08-05' }];
    const routing = await clientDetailsAdapter.resolveRoutingContext({ reportId: 'c6' });
    // `composeClientName` answers 'Client' rather than empty, and a file
    // called "Client details — Client" reads like a bug.
    expect(routing?.title).toBe('Client details');
  });
});
