import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createCorsHeaders } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { hasCompleteAustralianAddress, resolveCompleteReportAddress } from './report-address.pure.ts';
import { familyParentId, isBaseReport, shapeFamily } from '../_shared/reports/investment/subReportFamily.pure.ts';
import { reconcileStoredFinancials } from '../_shared/reports/investment/financialEngine.pure.ts';

type TableName = 'investment_reports' | 'generated_reports' | 'property_comparisons';
type Projection = 'library' | 'cashFlowLibrary' | 'cashFlowComparison' | 'archivedLibrary' | 'detail' | 'idLookup' | 'multiLookup' | 'generationProgress';
type ErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'REPORT_SCHEMA_MISMATCH' | 'INVALID_REPORT_QUERY' |
  'REPORT_DATABASE_UNAVAILABLE' | 'REPORT_QUERY_TIMEOUT' | 'REPORT_QUERY_FAILED' | 'REPORT_NOT_FOUND' | 'INTERNAL_REPORT_ERROR';

interface RequestBody {
  table?: TableName;
  projection?: Projection;
  reportId?: string;
  reportIds?: string[];
  /** Resolve the Compass family (parent + sub-reports + staleness) of this report id. */
  familyOf?: string;
  listMode?: boolean;
  listOptions?: {
    status?: string | string[]; isArchived?: boolean; isClientReport?: boolean | null;
    clientPropertyId?: string; clientPropertyIds?: string[]; createdAfter?: string; createdBefore?: string;
    /**
     * Activity window: rows whose `updated_at` is at or after this instant.
     * The generation-progress widget filters by this rather than `createdAfter`
     * because a regeneration moves `updated_at` (the table trigger stamps every
     * update and the generator stamps every section) and never `created_at` —
     * so a creation window hid every regeneration of a report older than it.
     */
    updatedAfter?: string;
    hasPropertyListingId?: boolean; page?: number; pageSize?: number;
    /** Deprecated and deliberately ignored: callers cannot define database projections. */
    select?: string;
  };
  /**
   * The session carriers `verifyAuth` reads off the body.
   *
   * Declared so the call type-checks: `verifyAuth`'s third parameter is
   * `{ session_token?: string; command_centre_session_token?: string }`, and a
   * `RequestBody` with no property in common with it is a TS2559 rather than a
   * structural match. Every other caller declares them; this one had not.
   *
   * `_shared/auth.ts` reads the HttpOnly `__Host-session_token` cookie and
   * nothing else (WP-11B/C), so these are inert at runtime — they exist to keep
   * the shape honest, not to reopen a carrier.
   */
  session_token?: string;
  command_centre_session_token?: string;
}

export const INVESTMENT_LIBRARY_SELECT = 'id,property_address,property_listing_id,client_property_id,canonical_property_key,created_at,current_version,report_scope,report_tier,parent_report_id,status,is_archived,is_client_report,report_variant,derived_from_report_id,investment_score,generated_by';
const INVESTMENT_LIBRARY_SOURCE_SELECT = `${INVESTMENT_LIBRARY_SELECT},manual_overrides,financial_calculations`;
// `cashFlowComparison` reads the SAME columns as `cashFlowLibrary` and simply
// does not collapse them. The two answer different questions: a list needs the
// headline scalars and nothing more, while a comparison replays the ten-year
// projection from `financial_calculations` and `manual_overrides` — council
// rates, insurance, the interest rate, capital growth, the depreciation
// schedule and every per-year override. Handed the collapsed row it does not
// fail; it silently defaults to 0 / 5% / 5.5% and renders a plausible
// projection of nothing, which is the one outcome a comparison must never
// produce. It is deliberately not the list projection: the payload is large
// and only the handful of reports actually selected need it.
// `data_sources` and `validation_flags` ride along for the viewer's
// data-coverage disclosure: which sources informed the report, which
// returned nothing, and any prose-vs-record fact contradictions.
const INVESTMENT_DETAIL_SELECT = `${INVESTMENT_LIBRARY_SELECT},report_content,sources_content,manual_overrides,financial_calculations,demographics_data,economic_data,location_intelligence,data_sources,validation_flags`;
// Live-progress projection for the floating generation widget, which polls every
// few seconds. The library projection omits `updated_at`, `error_message` and the
// section counters, so the widget was rendering `new Date(undefined)` and a
// permanent 0% — see docs. `report_content` is deliberately NOT here: completed
// reports average ~95KB and the widget polls up to 20 rows, so including it
// would ship megabytes of report prose per poll. Progress comes from the
// counters, which the generator maintains authoritatively.
const INVESTMENT_PROGRESS_SELECT = 'id,property_address,status,error_message,created_at,updated_at,last_completed_section,total_sections,bulk_job_id,report_tier,generation_engine';
const TABLE_SELECTS: Record<Exclude<TableName, 'investment_reports'>, string> = {
  generated_reports: 'id,title,created_at',
  property_comparisons: 'id,property_count,property_addresses,property_states,report_title,report_ids,created_at,analysis_summary,executive_summary,rankings,recommendations,financial_comparison,location_comparison,risk_comparison,red_flags',
};
const FUNCTION_VERSION = '2026-09-14.1';
const json = (body: unknown, status: number, headers: Record<string, string>, correlationId: string) => new Response(JSON.stringify(body), {
  status, headers: { ...headers, 'Content-Type': 'application/json', 'x-correlation-id': correlationId },
});
const failure = (code: ErrorCode, details: string, retryable: boolean, status: number, headers: Record<string, string>, correlationId: string) =>
  json({ success: false, code, error: code === 'REPORT_NOT_FOUND' ? 'Investment report was not found.' : 'Investment reports could not be loaded.', details, retryable, correlationId }, status, headers, correlationId);
const validIso = (value?: string) => !value || (Number.isFinite(Date.parse(value)) && /T/.test(value));
const schemaField = (message = '') => message.match(/(?:column|field)\s+(?:investment_reports\.)?["']?([a-z_][a-z0-9_]*)/i)?.[1] || 'requested field';
const classifyDatabaseError = (error: { code?: string; message?: string }) => {
  const message = error.message || '';
  if (error.code === '42703' || error.code === 'PGRST204' || /schema cache|column .* does not exist/i.test(message)) return { code: 'REPORT_SCHEMA_MISMATCH' as const, details: `The database contract is missing ${schemaField(message)}.`, retryable: false, status: 500 };
  if (error.code === '57014' || /statement timeout|canceling statement/i.test(message)) return { code: 'REPORT_QUERY_TIMEOUT' as const, details: 'The report query timed out.', retryable: true, status: 504 };
  if (/connection|unavailable|gateway/i.test(message)) return { code: 'REPORT_DATABASE_UNAVAILABLE' as const, details: 'The report database is temporarily unavailable.', retryable: true, status: 503 };
  return { code: 'REPORT_QUERY_FAILED' as const, details: 'The report query could not be completed.', retryable: true, status: 500 };
};

type ReportRow = Record<string, unknown> & { id?: string; property_address?: string; report_content?: string; sources_content?: string };

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const positiveNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'string' ? Number(value.replace(/[$,\s]/g, '')) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const firstPositive = (...values: unknown[]): number | null => {
  for (const value of values) {
    const parsed = positiveNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

function toLibraryFinancialSummary(row: ReportRow): ReportRow {
  const overrides = record(row.manual_overrides);
  const financials = record(row.financial_calculations);
  const initialCosts = record(financials.initialCosts);
  const income = record(financials.income);
  const libraryRow = { ...row };
  delete libraryRow.manual_overrides;
  delete libraryRow.financial_calculations;

  return {
    ...libraryRow,
    cash_flow_purchase_price: firstPositive(
      overrides.purchasePrice,
      initialCosts.propertyValue,
      financials.purchasePrice,
      financials.propertyValue,
      financials.purchase_price,
    ),
    cash_flow_weekly_rent: firstPositive(
      overrides.weeklyRent,
      income.weeklyRent,
      financials.weeklyRent,
      financials.weekly_rent,
    ),
  };
}

async function hydrateCompleteAddresses(
  supabase: ReturnType<typeof createClient>,
  rows: ReportRow[],
): Promise<{ rows: ReportRow[]; error: { code?: string; message?: string } | null }> {
  const incompleteIds = rows
    .filter(row => typeof row.id === 'string' && !hasCompleteAustralianAddress(row.property_address))
    .map(row => row.id as string);
  if (!incompleteIds.length) return { rows, error: null };

  const missingContentIds = rows
    .filter(row => incompleteIds.includes(row.id as string) && typeof row.report_content !== 'string')
    .map(row => row.id as string);
  let contentById = new Map<string, { report_content?: string; sources_content?: string }>();
  if (missingContentIds.length) {
    const contentResult = await supabase
      .from('investment_reports')
      .select('id,report_content,sources_content')
      .in('id', missingContentIds);
    if (contentResult.error) return { rows, error: contentResult.error };
    // Typed at the boundary rather than inferred. The client cannot resolve a
    // runtime `select` string to a row type, so `item` widens to `unknown` and
    // the Map infers `Map<unknown, …>`, which does not assign to the declared
    // `Map<string, …>`. The shape asserted here is exactly the three columns
    // the select above names.
    contentById = new Map(
      ((contentResult.data || []) as Array<{
        id: string; report_content?: string; sources_content?: string;
      }>).map((item) => [item.id, item]),
    );
  }

  return {
    error: null,
    rows: rows.map(row => {
      const content = typeof row.id === 'string' ? contentById.get(row.id) : undefined;
      return {
        ...row,
        property_address: resolveCompleteReportAddress(
          row.property_address,
          row.report_content ?? content?.report_content,
          row.sources_content ?? content?.sources_content,
        ),
      };
    }),
  };
}

Deno.serve(async (req) => {
  const correlationId = req.headers.get('x-correlation-id') || crypto.randomUUID();
  const corsHeaders = createCorsHeaders(req.headers.get('origin') || '');
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const csrf = enforceCsrf(req); if (!csrf.ok) return csrfDenied(corsHeaders, csrf);
  const started = performance.now();
  try {
    let body: RequestBody;
    try { body = await req.json(); } catch { return failure('INVALID_REPORT_QUERY', 'The request body must be valid JSON.', false, 400, corsHeaders, correlationId); }
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) return failure('UNAUTHENTICATED', 'Authentication is required.', false, 401, corsHeaders, correlationId);
    const table = body.table || 'investment_reports';
    if (!['investment_reports', 'generated_reports', 'property_comparisons'].includes(table)) return failure('INVALID_REPORT_QUERY', 'The requested report collection is invalid.', false, 400, corsHeaders, correlationId);
    // Single report fetch / Multiple reports fetch by IDs / List mode - fetch reports with filters
    const permission = await requireModulePermission(supabase, { userId: auth.userId, authMethod: auth.authMethod }, table === 'generated_reports' ? 'generated_reports' : 'reports', 'can_view');
    if (!permission.ok) return failure('FORBIDDEN', 'Report library access is required.', false, 403, corsHeaders, correlationId);

    // ── The Compass family, resolved server-side ──────────────────────────────
    //
    // `familyOf` answers "who belongs to this report's package, and is each
    // child still true to its parent". It exists because the tier switcher
    // used to read `investment_reports` from the BROWSER, where the
    // service-role-only policies filter every row: siblings always read as
    // absent, so switching to an existing child was impossible and every
    // click regenerated one — the fourth surface to hit the read-through-the-
    // server trap. History wrote the parent link in two columns (fork wrote
    // `derived_from_report_id`, condense wrote `parent_report_id`), so
    // children are the union over both — two indexed lookups, never a
    // composed `.or()` string. Staleness is derived here, never stored.
    if (body.familyOf) {
      if (typeof body.familyOf !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.familyOf)) {
        return failure('INVALID_REPORT_QUERY', 'familyOf must be a report id.', false, 400, corsHeaders, correlationId);
      }
      const FAMILY_SELECT = 'id, property_address, status, report_tier, report_variant, parent_report_id, derived_from_report_id, variant_generated_at, updated_at, created_at, is_archived';
      const anchorRes = await supabase.from('investment_reports').select(FAMILY_SELECT).eq('id', body.familyOf).maybeSingle();
      if (anchorRes.error) {
        const mapped = classifyDatabaseError(anchorRes.error);
        return failure(mapped.code, mapped.details, mapped.retryable, mapped.status, corsHeaders, correlationId);
      }
      if (!anchorRes.data) return failure('REPORT_NOT_FOUND', 'No report exists for that ID.', false, 404, corsHeaders, correlationId);
      const anchor = anchorRes.data as Record<string, unknown>;
      const parentId = isBaseReport(anchor) ? String(anchor.id) : familyParentId(anchor);

      const rows: Record<string, unknown>[] = [anchor];
      if (parentId) {
        const [parentRes, byDerived, byParent] = await Promise.all([
          parentId === anchor.id
            ? Promise.resolve({ data: null, error: null })
            : supabase.from('investment_reports').select(FAMILY_SELECT).eq('id', parentId).maybeSingle(),
          supabase.from('investment_reports').select(FAMILY_SELECT).eq('derived_from_report_id', parentId),
          supabase.from('investment_reports').select(FAMILY_SELECT).eq('parent_report_id', parentId),
        ]);
        const firstError = parentRes.error || byDerived.error || byParent.error;
        if (firstError) {
          const mapped = classifyDatabaseError(firstError);
          return failure(mapped.code, mapped.details, mapped.retryable, mapped.status, corsHeaders, correlationId);
        }
        if (parentRes.data) rows.push(parentRes.data as Record<string, unknown>);
        for (const row of [...(byDerived.data || []), ...(byParent.data || [])]) rows.push(row as Record<string, unknown>);
      }

      const family = shapeFamily(String(anchor.id), rows.filter((r) => r.is_archived !== true));
      console.info('[get-investment-reports]', { correlationId, userId: auth.userId, projection: 'familyOf', childCount: family.children.length, staleCount: family.staleChildren.length, durationMs: Math.round(performance.now() - started), functionVersion: FUNCTION_VERSION });
      return json({ success: true, family, correlationId }, 200, corsHeaders, correlationId);
    }

    const options = body.listOptions || {};
    if (!validIso(options.createdAfter) || !validIso(options.createdBefore) || !validIso(options.updatedAfter) || (options.createdAfter && options.createdBefore && Date.parse(options.createdAfter) > Date.parse(options.createdBefore)))
      return failure('INVALID_REPORT_QUERY', 'Date filters must be valid ISO timestamps in chronological order.', false, 400, corsHeaders, correlationId);
    const page = options.page ?? 1, pageSize = options.pageSize ?? 50;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200)
      return failure('INVALID_REPORT_QUERY', 'Page must be positive and pageSize must be between 1 and 200.', false, 400, corsHeaders, correlationId);
    const projection: Projection = body.projection || (body.reportId ? 'detail' : body.reportIds ? 'multiLookup' : options.isArchived ? 'archivedLibrary' : 'library');
    const allowed: Projection[] = ['library', 'cashFlowLibrary', 'cashFlowComparison', 'archivedLibrary', 'detail', 'idLookup', 'multiLookup', 'generationProgress'];
    if (!allowed.includes(projection)) return failure('INVALID_REPORT_QUERY', 'The requested projection is invalid.', false, 400, corsHeaders, correlationId);

    const select = table === 'investment_reports'
      ? projection === 'detail' ? INVESTMENT_DETAIL_SELECT
        : projection === 'idLookup' ? 'id'
        : projection === 'generationProgress' ? INVESTMENT_PROGRESS_SELECT
        : projection === 'cashFlowLibrary' || projection === 'cashFlowComparison' ? INVESTMENT_LIBRARY_SOURCE_SELECT
        : INVESTMENT_LIBRARY_SELECT
      : TABLE_SELECTS[table as Exclude<TableName, 'investment_reports'>];
    let query = supabase.from(table).select(select, { count: 'exact' });
    if (body.reportId) query = query.eq('id', body.reportId);
    if (body.reportIds) {
      if (!body.reportIds.length || body.reportIds.length > 200 || body.reportIds.some(id => typeof id !== 'string')) return failure('INVALID_REPORT_QUERY', 'reportIds must contain between 1 and 200 IDs.', false, 400, corsHeaders, correlationId);
      query = query.in('id', body.reportIds);
    }
    if (table === 'investment_reports' && !body.reportId && !body.reportIds) {
      const statuses = typeof options.status === 'string' ? [options.status] : options.status;
      if (statuses?.length) query = query.in('status', statuses);
      // Legacy NULL means active/non-client. Explicit archive mode includes only true.
      query = (projection === 'archivedLibrary' || options.isArchived === true) ? query.eq('is_archived', true) : query.or('is_archived.is.null,is_archived.eq.false');
      if (options.isClientReport === true) query = query.eq('is_client_report', true);
      else query = query.or('is_client_report.is.null,is_client_report.eq.false');
      if (options.clientPropertyId) query = query.eq('client_property_id', options.clientPropertyId);
      else if (options.clientPropertyIds?.length) query = query.in('client_property_id', options.clientPropertyIds);
      if (options.createdAfter) query = query.gte('created_at', options.createdAfter);
      if (options.createdBefore) query = query.lte('created_at', options.createdBefore);
      // `updated_at` is NOT NULL DEFAULT now() and trigger-stamped on every
      // update, so a plain gte never drops a freshly inserted row.
      if (options.updatedAfter) query = query.gte('updated_at', options.updatedAfter);
      if (options.hasPropertyListingId === true) query = query.not('property_listing_id', 'is', null);
      if (options.hasPropertyListingId === false) query = query.is('property_listing_id', null);
    }
    query = query.order('created_at', { ascending: false });
    if (!body.reportId && !body.reportIds) query = query.range((page - 1) * pageSize, page * pageSize - 1);
    const { data, error, count } = await query;
    if (error) {
      console.error('[get-investment-reports]', { correlationId, userId: auth.userId, projection, page, pageSize, durationMs: Math.round(performance.now() - started), postgrestCode: error.code, functionVersion: FUNCTION_VERSION, technicalError: error });
      const mapped = classifyDatabaseError(error); return failure(mapped.code, mapped.details, mapped.retryable, mapped.status, corsHeaders, correlationId);
    }
    if (body.reportId && !data?.length) return failure('REPORT_NOT_FOUND', 'No report exists for that ID.', false, 404, corsHeaders, correlationId);
    // Row pagination must never produce an incomplete visual property package.
    // Fetch lightweight siblings for keys represented by this page; large payloads
    // remain detail-only and IDs are de-duplicated below.
    let responseData = data || [];
    // The sibling sweep exists so the library grid never shows a partial property
    // package. The progress widget lists individual in-flight jobs, so pulling in
    // every sibling of every row is pure noise there (and inflates a 50-row page).
    if (table === 'investment_reports' && projection !== 'generationProgress' && !body.reportId && !body.reportIds && responseData.length) {
      const keys = [...new Set(responseData.map(row => row.canonical_property_key).filter((key): key is string => Boolean(key)))];
      if (keys.length) {
        let siblingsQuery = supabase.from('investment_reports')
          .select(projection === 'cashFlowLibrary' || projection === 'cashFlowComparison' ? INVESTMENT_LIBRARY_SOURCE_SELECT : INVESTMENT_LIBRARY_SELECT)
          .in('canonical_property_key', keys);
        siblingsQuery = (projection === 'archivedLibrary' || options.isArchived === true) ? siblingsQuery.eq('is_archived', true) : siblingsQuery.or('is_archived.is.null,is_archived.eq.false');
        siblingsQuery = options.isClientReport === true ? siblingsQuery.eq('is_client_report', true) : siblingsQuery.or('is_client_report.is.null,is_client_report.eq.false');
        const siblings = await siblingsQuery;
        if (siblings.error) {
          console.error('[get-investment-reports]', { correlationId, postgrestCode: siblings.error.code, functionVersion: FUNCTION_VERSION, technicalError: siblings.error });
          const mapped = classifyDatabaseError(siblings.error); return failure(mapped.code, mapped.details, mapped.retryable, mapped.status, corsHeaders, correlationId);
        }
        responseData = [...new Map([...(data || []), ...(siblings.data || [])].map(row => [row.id, row])).values()];
      }
    }
    if (table === 'investment_reports' && projection !== 'idLookup' && projection !== 'generationProgress' && responseData.length) {
      const hydrated = await hydrateCompleteAddresses(supabase, responseData as ReportRow[]);
      if (hydrated.error) {
        console.error('[get-investment-reports]', { correlationId, functionVersion: FUNCTION_VERSION, technicalError: hydrated.error });
        const mapped = classifyDatabaseError(hydrated.error); return failure(mapped.code, mapped.details, mapped.retryable, mapped.status, corsHeaders, correlationId);
      }
      responseData = hydrated.rows as typeof responseData;
    }
    // Read-boundary heal (audit F26): a row whose stored projections were
    // folded against triple-charged operating costs is reconciled before it
    // leaves the service — the same heal the two PDF routes and the binding
    // projection apply — so browser charts, the library summaries and the
    // legacy browser generator all read one set of figures. Idempotent on
    // healthy rows, and it never writes anything back.
    if (table === 'investment_reports' && responseData.length) {
      const healed = (responseData as unknown as ReportRow[]).map((r) => {
        if (!r || typeof r !== 'object' || !r.financial_calculations) return r;
        return { ...r, financial_calculations: reconcileStoredFinancials(r.financial_calculations).fin };
      });
      responseData = healed as unknown as typeof responseData;
    }
    if (table === 'investment_reports' && projection === 'cashFlowLibrary') {
      responseData = responseData.map(row => toLibraryFinancialSummary(row as ReportRow)) as typeof responseData;
    }
    const totalRows = count || 0, totalPages = Math.ceil(totalRows / pageSize);
    console.info('[get-investment-reports]', { correlationId, userId: auth.userId, projection, filters: { status: options.status, archived: options.isArchived, client: options.isClientReport, hasDateRange: Boolean(options.createdAfter || options.createdBefore) }, page, pageSize, durationMs: Math.round(performance.now() - started), returnedCount: responseData.length, functionVersion: FUNCTION_VERSION });
    if (body.reportId) return json({ success: true, report: responseData[0], correlationId }, 200, corsHeaders, correlationId);
    return json({ success: true, reports: responseData, count: totalRows, pagination: { page, pageSize, totalRows, totalPages, hasNextPage: page < totalPages, hasPreviousPage: page > 1 }, correlationId }, 200, corsHeaders, correlationId);
  } catch (error) {
    console.error('[get-investment-reports]', { correlationId, functionVersion: FUNCTION_VERSION, technicalError: error });
    return failure('INTERNAL_REPORT_ERROR', 'An unexpected report service error occurred.', true, 500, corsHeaders, correlationId);
  }
});
