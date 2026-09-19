/**
 * The authenticated read an adapter has to make, and the trap it exists to
 * close.
 *
 * ## The defect this module is the fix for
 *
 * Command Centre identity is a **custom HttpOnly-cookie session**, not a
 * Supabase Auth session. `src/integrations/supabase/client.ts` says so in its
 * own header and creates the client with `persistSession: false` and the anon
 * key — so in the browser `auth.uid()` is **always NULL**.
 *
 * Three of the tables the report adapters read have exactly one non-service
 * SELECT policy, and it is gated on `auth.uid()`:
 *
 * | Table | Policy |
 * | --- | --- |
 * | `investment_reports` | `generated_by = auth.uid()` OR a client join on `auth.uid()` |
 * | `property_comparisons` | `user_id = auth.uid()` |
 * | `clients` | `created_by = auth.uid()` |
 *
 * A `supabase.from(...)` read of any of them from the browser therefore
 * returns **zero rows for every record and every user** — not an error, an
 * empty result. The adapters read `maybeSingle()` and answered `null`, the
 * router read `null` as "this adapter refuses this record", and the caller
 * fell through to the legacy generator. So a person could choose a template,
 * be told the choice was kept, and receive the standard layout every single
 * time — which is what "the final render doesn't follow the template" was.
 *
 * It also explains `docs/reports/COVERAGE.md`: the design system rendered
 * 0.14% of documents, and the one format that ever rendered
 * (`investment_compass`) is the one whose adapter already read through a
 * broker.
 *
 * ## The rule
 *
 * **An adapter never reads a record through the browser client.** Every read
 * goes through an edge function that holds a service-role client and scopes
 * the read to the verified session user — the same treatment every other data
 * path in this app already gets. There are two such paths, and both already
 * existed, so this adds no new surface and no new authorisation decision:
 *
 * 1. **A broker with a shape of its own**, invoked by name. These carry an
 *    authorisation rule the table's policy cannot express:
 *    - `get-investment-reports` — `investment_reports` (the `detail`
 *      projection, which carries `financial_calculations`) and
 *      `property_comparisons`. Permission-gated on the `reports` module.
 *    - `get-client-data` — `clients` and every client-scoped child in one
 *      call, authorised per client by `canAccessClient`.
 *    - `manage-ci-assessments` — a commercial assessment with its stored
 *      calculation run, scoped by its own `loadOwned`.
 *
 * 2. **The `authenticated-data` gateway**, through
 *    `getAuthenticatedSupabaseClient()`. It rewrites a PostgREST request onto
 *    an edge function that verifies the session cookie, then applies the
 *    table's rule server-side — so `db().from('x').select(...)` reads exactly
 *    like the browser client while running under a service-role key it never
 *    hands out. This is the right path for a table whose policy is a plain
 *    "any verified session may read", where a bespoke broker would only be
 *    that rule spelt a second time.
 *
 * What is never acceptable is the third option: `supabase.from(...)` on the
 * anon browser client. `adapterSourceReadable.spec.ts` holds that line against
 * every file in this directory, so a tenth format cannot reintroduce the class
 * by reading one of these tables directly.
 *
 * ## Every failure is still null
 *
 * A refused read, a 404, a broker that is not deployed: all answer `null`, and
 * the caller's next line is the generator that has produced this document for
 * the life of the product. This module never throws.
 */
import { invokeSecureFunction } from '@/lib/secureInvoke';

/**
 * Tables whose only non-service SELECT policy is `auth.uid()`-gated, and which
 * are therefore invisible to the browser client under this app's custom auth.
 *
 * Exported so the enforcement spec can assert no adapter reads one directly.
 * Measured against `pg_policies` in production on 2026-08-14.
 */
export const BROWSER_INVISIBLE_TABLES = [
  'investment_reports',
  'property_comparisons',
  'clients',
  /*
   * The rest of the same measurement, taken 2026-08-16.
   *
   * The first three were the tables whose policy is `auth.uid()`-gated. These
   * are the remainder of what the adapters read, and they are invisible for
   * two further reasons — same symptom, same silence:
   *
   * | Table | Why the browser sees nothing |
   * | --- | --- |
   * | `borrowing_capacity_assessments` | client join on `auth.uid()` |
   * | `portfolio_analysis_reports` | `generated_by = auth.uid()` OR client join |
   * | `portfolio_reviews` | client join on `auth.uid()` |
   * | `commercial_industrial_assessments` | service_role only |
   * | `commercial_industrial_calculation_runs` | service_role only |
   * | `client_properties` … `client_expenses` | service_role only |
   * | `marketing_intelligence_reports` | `authenticated` only; the browser is anon |
   * | `report_qa_conversations` / `_messages` | table GRANT to anon revoked (42501) |
   * | `report_structure_templates` | `auth.role() = 'authenticated'`; the browser is anon |
   *
   * Row counts as the browser sees them, against what is actually there:
   * borrowing capacity 0/128, portfolio reports 0/22, portfolio reviews 0/14,
   * commercial assessments 0/21, market intelligence 0/6, Q&A conversations
   * 0/253, published structure guides 0/4. Every one of the nine formats binds
   * a template that cannot be filled.
   *
   * Six of the nine active premium templates had rendered **zero** documents
   * when this was measured; the three that had — `client_details`, `cashflow`,
   * `investment_compass` — are precisely the three whose data does not come
   * from one of these tables.
   *
   * `report_structure_templates` is the one that is not a record store, and it
   * is the reason it went unnoticed longest: the Investment adapter reads it
   * "best-effort" and documents a degradation to the report's own headings when
   * the read fails. Because the read always came back empty rather than
   * failing, the degradation was not a fallback — it was the only behaviour.
   */
  'borrowing_capacity_assessments',
  'portfolio_analysis_reports',
  'portfolio_reviews',
  'commercial_industrial_assessments',
  'commercial_industrial_calculation_runs',
  'marketing_intelligence_reports',
  'report_qa_conversations',
  'report_qa_messages',
  'report_structure_templates',
  'client_properties',
  'client_assets',
  'client_liabilities',
  'client_employment',
  'client_expenses',
] as const;

/**
 * One row from a client-scoped table, through `get-client-data`.
 *
 * That broker already authorises per client with `canAccessClient` and already
 * allow-lists these tables, so this adds no authorisation decision — it is the
 * same treatment the Clients page gets. `filters` selects the row; the broker
 * decides whether the caller may see it.
 */
async function loadClientScopedRow(
  table: string,
  filters: Record<string, unknown>,
  select = '*',
): Promise<Record<string, any> | null> {
  const rows = await listClientScopedRows(table, { select, filters, limit: 1 });
  return rows[0] ?? null;
}

/** Rows from a client-scoped table, through `get-client-data`. */
export async function listClientScopedRows(
  table: string,
  options: {
    select?: string;
    orderBy?: string;
    orderAsc?: boolean;
    limit?: number;
    filters?: Record<string, unknown>;
  } = {},
): Promise<Record<string, any>[]> {
  try {
    const { data, error } = await invokeSecureFunction('get-client-data', {
      listMode: true,
      listOptions: {
        table,
        select: options.select ?? '*',
        orderBy: options.orderBy ?? 'created_at',
        orderAsc: options.orderAsc ?? false,
        ...(options.limit ? { limit: options.limit } : {}),
        ...(options.filters ? { filters: options.filters } : {}),
      },
    } as any);
    if (error) {
      /*
       * Said out loud, because this is the one distinction the broker erases.
       *
       * A refused or failed read and a table with nothing in it both arrive
       * here as `[]`, and every caller treats `[]` as "there is no such
       * record" — which is the correct posture for a genuinely empty table and
       * exactly how the anon-client defect stayed invisible for the life of the
       * product. The caller still degrades rather than failing; the console is
       * the only place the difference can be told.
       */
      console.warn(
        `[reportTemplate] ${table} could not be read through get-client-data: `
        + `${(error as { message?: string })?.message ?? 'unknown error'}`,
      );
      return [];
    }
    const payload = data as Record<string, any> | null;
    // The broker answers list-mode table queries under the table's own name or
    // a generic `records`, depending on the branch; accept either rather than
    // depending on which one this table takes.
    const rows = payload?.[table] ?? payload?.records ?? payload?.data;
    return Array.isArray(rows) ? rows as Record<string, any>[] : [];
  } catch {
    return [];
  }
}

/** One borrowing-capacity assessment. */
export async function loadBorrowingCapacityRow(
  assessmentId: string,
  select = '*',
): Promise<Record<string, any> | null> {
  return loadClientScopedRow('borrowing_capacity_assessments', { id: assessmentId }, select);
}

/** Recent borrowing-capacity assessments, for a picker. */
export async function listBorrowingCapacityRows(
  limit = 20,
  select = '*',
): Promise<Record<string, any>[]> {
  return listClientScopedRows('borrowing_capacity_assessments', { select, limit });
}

/** One portfolio analysis report. */
export async function loadPortfolioReportRow(
  reportId: string,
  select = '*',
): Promise<Record<string, any> | null> {
  return loadClientScopedRow('portfolio_analysis_reports', { id: reportId }, select);
}

/** Recent portfolio analysis reports, for a picker. */
export async function listPortfolioReportRows(
  limit = 20,
  select = '*',
): Promise<Record<string, any>[]> {
  return listClientScopedRows('portfolio_analysis_reports', { select, limit });
}

/**
 * One commercial & industrial assessment with its stored calculation run.
 *
 * `manage-ci-assessments`' own `get` returns exactly this pair — the
 * assessment and its latest base run — scoped to the caller by `loadOwned`.
 * The format's figures come from the stored run and never from a
 * recomputation (`docs/reports/COMMERCIAL_CAPACITY.md`), so taking both from
 * the one authorised call keeps that true.
 */
export async function loadCommercialAssessment(
  assessmentId: string,
): Promise<{ assessment: Record<string, any>; latestRun: Record<string, any> | null } | null> {
  try {
    const { data, error } = await invokeSecureFunction('manage-ci-assessments', {
      operation: 'get',
      assessmentId,
    } as any);
    if (error) return null;
    const payload = (data as Record<string, any> | null)?.data;
    const assessment = payload?.assessment as Record<string, any> | undefined;
    if (!assessment) return null;
    return { assessment, latestRun: (payload?.latestRun as Record<string, any>) ?? null };
  } catch {
    return null;
  }
}

/** Recent commercial & industrial assessments, for a picker. */
export async function listCommercialAssessments(
  limit = 20,
): Promise<Record<string, any>[]> {
  try {
    const { data, error } = await invokeSecureFunction('manage-ci-assessments', {
      operation: 'list',
      limit: Math.min(Math.max(limit, 1), 200),
    } as any);
    if (error) return [];
    const payload = data as Record<string, any> | null;
    const rows = payload?.data ?? payload?.assessments;
    return Array.isArray(rows) ? rows as Record<string, any>[] : [];
  } catch {
    return [];
  }
}

/**
 * One investment report, with `financial_calculations` — the `detail`
 * projection, which `reportId` selects on its own.
 */
export async function loadInvestmentReportRow(
  reportId: string,
): Promise<Record<string, any> | null> {
  try {
    const { data, error } = await invokeSecureFunction('get-investment-reports', {
      table: 'investment_reports',
      reportId,
    } as any);
    if (error) return null;
    return ((data as any)?.report as Record<string, any>) ?? null;
  } catch {
    return null;
  }
}

/**
 * Recent investment reports, for a picker.
 *
 * The list projection, which omits the heavy blobs by design — a caller that
 * needs `financial_calculations` asks for one report by id.
 */
export async function listInvestmentReportRows(
  limit = 20,
): Promise<Record<string, any>[]> {
  try {
    const { data, error } = await invokeSecureFunction('get-investment-reports', {
      table: 'investment_reports',
      listMode: true,
      listOptions: { page: 1, pageSize: Math.min(Math.max(limit, 1), 200) },
    } as any);
    if (error) return [];
    const rows = (data as any)?.reports;
    return Array.isArray(rows) ? rows as Record<string, any>[] : [];
  } catch {
    return [];
  }
}

/** One saved property comparison. */
export async function loadPropertyComparisonRow(
  comparisonId: string,
): Promise<Record<string, any> | null> {
  try {
    const { data, error } = await invokeSecureFunction('get-investment-reports', {
      table: 'property_comparisons',
      reportId: comparisonId,
    } as any);
    if (error) return null;
    return ((data as any)?.report as Record<string, any>) ?? null;
  } catch {
    return null;
  }
}

/**
 * What a client-shaped document needs from a client, in one authorised call.
 *
 * The flags mirror `get-client-data`'s own `include` map. Asking for only what
 * the format binds keeps this from pulling a client's whole file to print a
 * cover: the broker runs one query per included relation.
 */
export interface ClientRecordIncludes {
  properties?: boolean;
  income?: boolean;
  incomeSources?: boolean;
  expenses?: boolean;
  assets?: boolean;
  liabilities?: boolean;
  employment?: boolean;
  addressHistory?: boolean;
}

/**
 * One client and the relations asked for.
 *
 * Returns the broker's flat single-client response — `{ client, properties,
 * income, … }` — or null when the client is not accessible, which the broker
 * answers as a 404 rather than as an empty row, deliberately (it refuses to be
 * an id oracle).
 */
export async function loadClientRecord(
  clientId: string,
  include: ClientRecordIncludes = {},
): Promise<Record<string, any> | null> {
  try {
    const { data, error } = await invokeSecureFunction('get-client-data', {
      clientId,
      include,
    } as any);
    if (error) return null;
    const payload = data as Record<string, any> | null;
    if (!payload || payload.success !== true) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Just the client row, for the formats that print a name and nothing more. */
export async function loadClientRow(clientId: string): Promise<Record<string, any> | null> {
  const record = await loadClientRecord(clientId);
  return (record?.client as Record<string, any>) ?? null;
}

/**
 * Clients for a picker, ordered by the caller's column.
 *
 * The broker scopes the list to what this user may see (own or assigned)
 * unless they may see all, which is the same rule the Clients page gets.
 */
export async function listClientRows(
  options: { select?: string; orderBy?: string; limit?: number } = {},
): Promise<Record<string, any>[]> {
  try {
    const { data, error } = await invokeSecureFunction('get-client-data', {
      listMode: true,
      listOptions: {
        select: options.select ?? '*',
        orderBy: options.orderBy ?? 'updated_at',
        orderAsc: false,
        ...(options.limit ? { limit: options.limit } : {}),
      },
    } as any);
    if (error) return [];
    const rows = (data as any)?.clients;
    return Array.isArray(rows) ? rows as Record<string, any>[] : [];
  } catch {
    return [];
  }
}

/**
 * Several clients by id, for labelling a list of records that each name one.
 *
 * One list call, indexed here, rather than one call per id: a picker of twenty
 * assessments would otherwise make twenty edge requests to write twenty
 * labels. The broker's `clientIds` parameter is deliberately not used — it
 * refuses the *whole* request when any single id is inaccessible, because it
 * will not be an id oracle, so one stranger's record would cost every label.
 *
 * An id outside the page simply has no entry, and the caller falls back to its
 * generic label: a picker missing one name is a picker, a picker that failed
 * is not.
 */
export async function loadClientRowsByIds(
  clientIds: readonly string[],
  select?: string,
): Promise<Map<string, Record<string, any>>> {
  const wanted = new Set(clientIds.filter(Boolean));
  const out = new Map<string, Record<string, any>>();
  if (!wanted.size) return out;
  const rows = await listClientRows({
    select: select ? `id, ${select}` : '*',
    limit: 200,
  });
  for (const row of rows) {
    const id = String(row.id ?? '');
    if (id && wanted.has(id)) out.set(id, row);
  }
  return out;
}

/** Recent saved comparisons, for a picker. */
export async function listPropertyComparisonRows(
  limit = 20,
): Promise<Record<string, any>[]> {
  try {
    const { data, error } = await invokeSecureFunction('get-investment-reports', {
      table: 'property_comparisons',
      listMode: true,
      listOptions: { page: 1, pageSize: Math.min(Math.max(limit, 1), 200) },
    } as any);
    if (error) return [];
    const rows = (data as any)?.reports;
    return Array.isArray(rows) ? rows as Record<string, any>[] : [];
  } catch {
    return [];
  }
}
