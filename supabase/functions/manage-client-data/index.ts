import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { checkPermission } from '../_shared/permissions.ts';
import { buildProvenance, logClientActivity } from '../_shared/client-data-provenance.ts';
import { buildDocumentDedupeKey, buildNoteDedupeKey, createSyncEvent, resolveSyncConflict, sha256Text, SYNC_CONFLICT_WINDOW_MS } from '../_shared/client-sync.ts';
import { resolvePortfolioReportDeletionTarget } from './portfolioReportDeletion.ts';
import { canManageClient, canPublishPortfolioForClient } from './portfolioPublicationAuthorization.ts';
import { internalError } from '../_shared/errorResponse.ts';
import { pickAllowed } from '../_shared/wp09Guards.ts';
import { writableColumnsFor } from '../_shared/clientDataWritableColumns.ts';

type TableName = 'clients' | 'client_properties' | 'client_income' | 'client_expenses' |
                 'client_assets' | 'client_liabilities' | 'client_employment' |
                 'client_notes' | 'client_files' | 'client_activities' | 'client_additional_contacts' |
                 'report_qa_messages' | 'report_qa_conversations' | 'portfolio_reviews' | 'client_scores' |
                 'client_income_sources' | 'client_deals' | 'deal_stages' | 'build_progress_payments' | 'builder_invoices' |
                 'portfolio_analysis_reports' | 'client_reminders' | 'lead_source_attributions' | 'client_portal_report_requests' |
                 'client_address_history';

type Operation = 'create' | 'update' | 'delete' | 'upsert' | 'bulkDelete' | 'publish_portfolio_report';

interface RequestBody {
  operation: Operation;
  table: TableName;
  clientId?: string; // Optional for report_qa tables
  recordId?: string;
  // Portfolio report deletes accept only this immutable primary key. The server resolves ownership.
  reportId?: string;
  data?: Record<string, any> | Record<string, any>[]; // Allow array for batch inserts
  session_token?: string;
}

async function isAuthorizedForClient(
  supabase: any,
  userId: string,
  clientId: string,
  authMethod?: string,
): Promise<boolean> {
  if (authMethod === 'service_role' || userId === 'service_role') return true;

  const [{ data: client }, { data: superadminRole }] = await Promise.all([
    supabase.from('clients').select('id, created_by, assigned_team_user_id').eq('id', clientId).maybeSingle(),
    supabase.from('user_roles').select('role').eq('user_id', userId).eq('role', 'superadmin').maybeSingle(),
  ]);
  return canManageClient(userId, client, Boolean(superadminRole), false);
}

const ALLOWED_TABLES: TableName[] = [
  'clients',
  'client_properties',
  'client_income',
  'client_expenses',
  'client_assets',
  'client_liabilities',
  'client_employment',
  'client_notes',
  'client_files',
  'client_activities',
  'client_additional_contacts',
  'report_qa_messages',
  'report_qa_conversations',
  'portfolio_reviews',
  'client_scores',
  'client_income_sources',
  'client_deals',
  'deal_stages',
  'build_progress_payments',
  'builder_invoices',
  'portfolio_analysis_reports',
  'client_reminders',
  'portal_configuration',
  'lead_source_attributions',
  'client_portal_reports',
  'client_portal_report_requests',
  'client_address_history',
  'ghl_conversations',
  'ghl_conversation_messages',
];

const DEAL_CHILD_TABLES: TableName[] = ['deal_stages', 'build_progress_payments', 'builder_invoices'];

async function dealBelongsToClient(supabase: any, dealId: string, clientId: string): Promise<boolean> {
  const { data: deal } = await supabase
    .from('client_deals')
    .select('id')
    .eq('id', dealId)
    .eq('client_id', clientId)
    .maybeSingle();
  return Boolean(deal);
}

async function dealChildMutationMatchesClient(
  supabase: any,
  table: TableName,
  operation: Operation,
  clientId: string,
  recordId: string | undefined,
  data: Record<string, any> | Record<string, any>[] | undefined,
): Promise<boolean> {
  const suppliedRows = data ? (Array.isArray(data) ? data : [data]) : [];
  const suppliedDealIds = suppliedRows.flatMap((row) => typeof row.deal_id === 'string' ? [row.deal_id] : []);

  if (operation === 'create' || operation === 'upsert') {
    if (suppliedDealIds.length !== suppliedRows.length) return false;
  }

  if ((operation === 'update' || operation === 'delete') && recordId) {
    const { data: existing } = await supabase.from(table).select('deal_id').eq('id', recordId).maybeSingle();
    if (!existing?.deal_id) return false;
    suppliedDealIds.push(existing.deal_id);
  }

  const uniqueDealIds = [...new Set(suppliedDealIds)];
  return uniqueDealIds.length > 0
    && (await Promise.all(uniqueDealIds.map((dealId) => dealBelongsToClient(supabase, dealId, clientId)))).every(Boolean);
}


function normalizeAddressPayload(payload: Record<string, any>) {
  const out = { ...(payload || {}) };
  if (typeof out.address === 'string') out.address = out.address.trim();
  if (typeof out.current_address === 'string') out.current_address = out.current_address.trim();
  if (typeof out.secondary_current_address === 'string') out.secondary_current_address = out.secondary_current_address.trim();
  if (typeof out.current_suburb === 'string') out.current_suburb = out.current_suburb.trim();
  if (typeof out.current_state === 'string') out.current_state = out.current_state.trim().toUpperCase();
  if (typeof out.current_postcode === 'string') out.current_postcode = out.current_postcode.trim();
  if (typeof out.country === 'string') out.country = out.country.trim() || 'Australia';
  if (out.is_current === true && !out.address && !out.current_address && !out.current_suburb && !out.current_state && !out.current_postcode) {
    throw new Error('Current address requires at least an address line, suburb, state or postcode');
  }
  if (out.current_postcode && !/^\d{4}$/.test(String(out.current_postcode))) {
    throw new Error('Postcode must be 4 digits');
  }
  if (out.current_state && !/^[A-Z]{2,3}$/.test(String(out.current_state))) {
    throw new Error('State must be a 2–3 letter Australian state/territory code');
  }

  // Also normalize secondary_* address fields (same rules)
  if (typeof out.secondary_current_suburb === 'string') out.secondary_current_suburb = out.secondary_current_suburb.trim();
  if (typeof out.secondary_current_state === 'string') out.secondary_current_state = out.secondary_current_state.trim().toUpperCase();
  if (typeof out.secondary_current_postcode === 'string') out.secondary_current_postcode = out.secondary_current_postcode.trim();
  if (typeof out.secondary_country === 'string') out.secondary_country = out.secondary_country.trim() || 'Australia';
  if (out.secondary_current_postcode && !/^\d{4}$/.test(String(out.secondary_current_postcode))) {
    throw new Error('Secondary postcode must be 4 digits');
  }
  if (out.secondary_current_state && !/^[A-Z]{2,3}$/.test(String(out.secondary_current_state))) {
    throw new Error('Secondary state must be a 2–3 letter Australian state/territory code');
  }

  // If "same as primary" flag is set, copy primary address into secondary_* fields server-side
  // (defensive — the UI already copies, but this guarantees persistence)
  if (out.secondary_same_address_as_primary === true) {
    out.secondary_current_address = out.current_address ?? out.secondary_current_address ?? null;
    out.secondary_current_suburb = out.current_suburb ?? out.secondary_current_suburb ?? null;
    out.secondary_current_state = out.current_state ?? out.secondary_current_state ?? null;
    out.secondary_current_postcode = out.current_postcode ?? out.secondary_current_postcode ?? null;
    out.secondary_country = out.country ?? out.secondary_country ?? 'Australia';
    out.secondary_living_situation = out.living_situation ?? out.secondary_living_situation ?? null;
    out.secondary_residential_status = out.residential_status ?? out.secondary_residential_status ?? null;
  }
  return out;
}

async function applyInheritedSecondaryAddress(supabase: any, clientId: string, payload: Record<string, any>) {
  const primaryAddressChanged = ['current_address', 'current_suburb', 'current_state', 'current_postcode', 'country', 'living_situation', 'residential_status']
    .some((key) => key in payload);
  if (!primaryAddressChanged) return payload;

  const { data: client, error } = await supabase
    .from('clients')
    .select('current_address, current_suburb, current_state, current_postcode, country, living_situation, residential_status, secondary_same_address_as_primary')
    .eq('id', clientId)
    .single();
  if (error || !client || (payload.secondary_same_address_as_primary ?? client.secondary_same_address_as_primary) !== true) {
    return payload;
  }

  return {
    ...payload,
    secondary_current_address: payload.current_address ?? client.current_address ?? null,
    secondary_current_suburb: payload.current_suburb ?? client.current_suburb ?? null,
    secondary_current_state: payload.current_state ?? client.current_state ?? null,
    secondary_current_postcode: payload.current_postcode ?? client.current_postcode ?? null,
    secondary_country: payload.country ?? client.country ?? 'Australia',
    secondary_living_situation: payload.living_situation ?? client.living_situation ?? null,
    secondary_residential_status: payload.residential_status ?? client.residential_status ?? null,
  };
}

function hasAddressFields(payload: Record<string, any> | undefined) {
  if (!payload) return false;
  return [
    'current_address', 'current_suburb', 'current_state', 'current_postcode', 'country', 'living_situation', 'residential_status', 'address',
    'secondary_current_address', 'secondary_current_suburb', 'secondary_current_state', 'secondary_current_postcode', 'secondary_country', 'secondary_living_situation', 'secondary_residential_status', 'secondary_same_address_as_primary',
  ].some((key) => key in payload);
}

async function logAddressSyncEvent(supabase: any, input: { clientId: string; entityId: string; entityTable: string; operation: string; username?: string | null; userId?: string | null; authMethod?: string | null }) {
  await createSyncEvent(supabase, {
    clientId: input.clientId,
    entityId: input.entityId,
    entityTable: input.entityTable,
    entityType: 'address',
    sourceSurface: 'internal_dashboard',
    sourceActorType: 'internal_user',
    sourceActorName: input.username || null,
    sourceReference: input.userId || null,
    sourceDetails: { operation: input.operation, auth_method: input.authMethod || 'unknown' },
    syncStatus: 'synced',
    propagatedTo: ['finance_portal', 'client_portal', 'internal_dashboard'],
  });
}

// Map employment_type to income source_type and default shading
const EMPLOYMENT_TO_INCOME_MAP: Record<string, { sourceType: string; defaultShading: number }> = {
  permanent: { sourceType: 'payg_fulltime', defaultShading: 1.0 },
  part_time: { sourceType: 'payg_parttime', defaultShading: 1.0 },
  casual: { sourceType: 'casual', defaultShading: 0.8 },
  contract: { sourceType: 'contract', defaultShading: 0.8 },
  self_employed: { sourceType: 'self_employed', defaultShading: 0.8 },
};

function convertToAnnual(amount: number, frequency: string): number {
  switch (frequency) {
    case 'weekly': return amount * 52;
    case 'fortnightly': return amount * 26;
    case 'monthly': return amount * 12;
    default: return amount;
  }
}

async function prepareSharedSyncInsert(
  supabase: any,
  table: TableName,
  clientId: string,
  record: Record<string, any>,
  provenance: Record<string, any>,
  actor: { userId: string | null; username: string | null },
) {
  const now = new Date().toISOString();
  const windowStart = new Date(Date.now() - SYNC_CONFLICT_WINDOW_MS).toISOString();

  if (table === 'client_files') {
    const dedupeKey = buildDocumentDedupeKey({
      clientId,
      filename: String(record.file_name || 'document'),
      fileSize: Number(record.file_size || 0),
      category: typeof record.category === 'string' ? record.category : null,
    });

    const { data: existing } = await supabase
      .from('client_files')
      .select('id, source_surface, uploaded_at, last_synced_at, version_group_id, version_number')
      .eq('client_id', clientId)
      .eq('dedupe_key', dedupeKey)
      .gte('uploaded_at', windowStart)
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const resolution = resolveSyncConflict({
      existing,
      incomingSurface: 'internal_dashboard',
      incomingTimestamp: now,
    });

    const conflictReason = existing ? resolution.conflictReason : null;
    return {
      record: {
        ...record,
        ...provenance,
        dedupe_key: dedupeKey,
        sync_status: resolution.status,
        last_synced_at: now,
        last_sync_error: resolution.status === 'conflict' ? conflictReason : null,
        version_group_id: resolution.versionGroupId,
        version_number: resolution.versionNumber,
        supersedes_file_id: resolution.supersedesEntityId,
        source_details: {
          ...(provenance.source_details || {}),
          dedupe_key: dedupeKey,
          sync_conflict_reason: conflictReason,
        },
      },
      syncMeta: {
        syncStatus: resolution.status,
        dedupeKey,
        versionGroupId: resolution.versionGroupId,
        versionNumber: resolution.versionNumber,
        supersedesEntityId: resolution.supersedesEntityId,
        conflictReason,
        shouldSupersedeExisting: resolution.shouldSupersedeExisting,
        existingId: existing?.id || null,
        sourceActorName: actor.username,
        sourceReference: actor.userId,
      },
    };
  }

  if (table === 'client_notes') {
    const content = String(record.content || '');
    const noteType = String(record.note_type || 'general');
    const contentHash = await sha256Text(`${noteType}:${content}`);
    const dedupeKey = buildNoteDedupeKey({ clientId, noteType, content });

    const { data: existing } = await supabase
      .from('client_notes')
      .select('id, source_surface, created_at, updated_at, version_group_id, version_number, content_hash')
      .eq('client_id', clientId)
      .eq('dedupe_key', dedupeKey)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const isDuplicate = !!existing?.content_hash && existing.content_hash === contentHash;
    const resolution = isDuplicate
      ? {
          status: 'duplicate' as const,
          versionGroupId: existing?.version_group_id || crypto.randomUUID(),
          versionNumber: existing?.version_number || 1,
          supersedesEntityId: null,
          conflictReason: 'Identical note already exists from a recent sync window',
          shouldSupersedeExisting: false,
        }
      : resolveSyncConflict({
          existing,
          incomingSurface: 'internal_dashboard',
          incomingTimestamp: now,
        });

    return {
      record: {
        ...record,
        ...provenance,
        content_hash: contentHash,
        dedupe_key: dedupeKey,
        sync_status: resolution.status,
        last_synced_at: now,
        last_sync_error: resolution.status === 'conflict' || resolution.status === 'duplicate' ? resolution.conflictReason : null,
        version_group_id: resolution.versionGroupId,
        version_number: resolution.versionNumber,
        supersedes_note_id: resolution.supersedesEntityId,
        source_details: {
          ...(provenance.source_details || {}),
          content_hash: contentHash,
          dedupe_key: dedupeKey,
          sync_conflict_reason: resolution.conflictReason,
        },
      },
      syncMeta: {
        syncStatus: resolution.status,
        dedupeKey,
        contentHash,
        versionGroupId: resolution.versionGroupId,
        versionNumber: resolution.versionNumber,
        supersedesEntityId: resolution.supersedesEntityId,
        conflictReason: resolution.conflictReason,
        shouldSupersedeExisting: resolution.shouldSupersedeExisting,
        existingId: existing?.id || null,
        sourceActorName: actor.username,
        sourceReference: actor.userId,
      },
    };
  }

  return { record, syncMeta: null };
}

/**
 * Syncs an employment record to its linked income source.
 * Creates the income source if it doesn't exist, updates if it does.
 */
async function syncEmploymentToIncomeSource(supabase: any, employment: any, clientId: string) {
  const mapping = EMPLOYMENT_TO_INCOME_MAP[employment.employment_type] || { sourceType: 'payg_fulltime', defaultShading: 1.0 };
  const grossAnnual = employment.gross_annual_salary || convertToAnnual(employment.salary_amount || 0, employment.salary_frequency || 'annual');

  const incomeData = {
    client_id: clientId,
    employment_id: employment.id,
    contact_type: employment.contact_type || 'primary',
    additional_contact_id: employment.additional_contact_id || null,
    source_category: 'employment',
    source_type: mapping.sourceType,
    source_name: employment.employer_name || '',
    gross_annual_amount: grossAnnual,
    input_amount: employment.salary_amount || 0,
    input_frequency: employment.salary_frequency || 'annual',
    bonus: employment.bonus || 0,
    commission: employment.commission || 0,
    overtime_essential: employment.overtime_essential || 0,
    overtime_non_essential: employment.overtime_non_essential || 0,
    allowance: employment.allowance || 0,
    other_taxable_income: employment.other_taxable_income || 0,
    default_shading_rate: mapping.defaultShading,
    is_active: employment.is_current !== false,
  };

  // Check if a linked income source already exists
  const { data: existing } = await supabase
    .from('client_income_sources')
    .select('id')
    .eq('employment_id', employment.id)
    .maybeSingle();

  if (existing) {
    // Update existing
    await supabase
      .from('client_income_sources')
      .update(incomeData)
      .eq('id', existing.id);
    console.log(`Updated linked income source ${existing.id} for employment ${employment.id}`);
  } else {
    // Create new
    const { data: created } = await supabase
      .from('client_income_sources')
      .insert(incomeData)
      .select('id')
      .single();
    console.log(`Created linked income source ${created?.id} for employment ${employment.id}`);
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: RequestBody = await req.json();

    // Validate authentication (JWT first, then session token)
    const { error: authError, userId, username } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('Auth failed for manage-client-data:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    console.log(`Authenticated user ${userId} (${username}) performing ${body.operation} on ${body.table}`);

    const authMethod = (await verifyAuth(supabase, req.headers, body)).authMethod;

    const { operation, table, clientId, recordId, reportId, data: rawData } = body;
    // A report ID is the sole browser-supplied identifier for portfolio report deletion.
    // Never trust a browser-provided client ID to establish report ownership.
    const portfolioReportId = table === 'portfolio_analysis_reports' && operation === 'delete'
      ? (reportId || recordId)
      : undefined;
    let resolvedClientId: string | undefined;

    // The dedicated publication operation has the same reports permission as creating a portal report.
    const permissionOperation = operation === 'publish_portfolio_report' ? 'create' : operation;
    // ── Server-side permission check ──
    // Verify the user has the required module-level permission for this operation
    const permCheck = await checkPermission(supabase, userId!, table, permissionOperation, authMethod);
    if (!permCheck.allowed) {
      console.log(`[manage-client-data] Permission denied for user ${userId} on ${table}.${operation}: ${permCheck.reason}`);
      return new Response(
        JSON.stringify({ error: permCheck.reason || 'Permission denied', permissionDenied: true }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate table name
    if (!ALLOWED_TABLES.includes(table)) {
      return new Response(
        JSON.stringify({ error: `Invalid table: ${table}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate operation
    if (!['create', 'update', 'delete', 'upsert', 'bulkDelete', 'publish_portfolio_report'].includes(operation)) {
      return new Response(
        JSON.stringify({ error: `Invalid operation: ${operation}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // WP-25 (item 15): narrow the body to the columns this table declares
    // writable, ONCE, here — before `data` is visible to the create/update/
    // upsert branches. Doing it per-branch was the alternative and it is the
    // worse one: three call sites is three chances to add a fourth branch that
    // forgets, and the whole point of a multiplexer is that branches get added.
    //
    // `ALLOWED_TABLES` above checks which table the caller may write. This
    // checks which columns, which nothing checked before: one `data` object
    // reached 29 tables, so the writable surface was the union of all of them.
    //
    // ONLY the three operations that spread `data` into a write are narrowed.
    // `publish_portfolio_report` is not one of them: it builds its insert
    // field-by-field and reads `data.notify_email` and `data.client_visible_notes`
    // as control flags — `notify_email` is not a column of any table, and
    // `client_visible_notes` belongs to `client_portal_reports` while the
    // operation runs against `portfolio_analysis_reports`. Narrowing it against
    // the named table stripped both and silently turned the email notification
    // off. Narrowing an object that is not a column set is not a safer version
    // of the same thing; it is a different thing that happens to compile.
    const SPREADS_DATA_INTO_WRITE = ['create', 'update', 'upsert'];
    const writable = writableColumnsFor(table);
    if (SPREADS_DATA_INTO_WRITE.includes(operation) && !writable) {
      // Every entry in ALLOWED_TABLES has a column set, so this only fires if
      // somebody adds a table there without adding its columns. The safe answer
      // to "I do not know what may be written here" is nothing.
      console.error(`[manage-client-data] No writable column set declared for table ${table}`);
      return new Response(
        JSON.stringify({ error: `Writes to ${table} are not configured`, code: 'table_not_writable' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const data: any = !SPREADS_DATA_INTO_WRITE.includes(operation) || !writable
        || rawData === undefined || rawData === null
      ? rawData
      : Array.isArray(rawData)
        ? rawData.map((row: Record<string, any>) => pickAllowed(row, writable!))
        : pickAllowed(rawData as Record<string, any>, writable!);

    /**
     * Tables a mutation names directly, rather than through a client.
     *
     * `ghl_conversation_messages` is keyed by `conversation_id` and has NO
     * `client_id` column at all — so it was unwritable through this function
     * from either direction: with no `clientId` the guard below answered 400
     * "clientId is required for related tables", and with one the create branch
     * would have added `client_id` to the payload and drawn 42703. The
     * Conversations page catches that and warns "Email sent, but it could not
     * be added to the conversation history", which is the 19 Sep 2026 clone
     * audit's "the email doesn't appear in the history in the crm conversations
     * page. However, it shows under the sent folder in email copilot".
     *
     * `ghl_conversations` has a nullable `client_id` and is discovered from
     * GoHighLevel rather than created under a client, so it belongs here too.
     *
     * Being standalone skips the per-client ownership binding, which for these
     * two is not a loosening: there is no client to bind to. The module
     * permission check above still applies.
     */
    const STANDALONE_TABLES = ['clients', 'report_qa_messages', 'report_qa_conversations', 'deal_stages', 'build_progress_payments', 'builder_invoices', 'portal_configuration', 'client_portal_report_requests', 'client_reminders', 'ghl_conversations', 'ghl_conversation_messages'];
    
    // Validate clientId for client-related tables only
    const isPortfolioReportDelete = table === 'portfolio_analysis_reports' && operation === 'delete';
    if (table === 'clients' && operation !== 'create' && !clientId) {
      return new Response(
        JSON.stringify({ error: 'clientId is required for client mutations' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (!STANDALONE_TABLES.includes(table) && !isPortfolioReportDelete && !clientId) {
      return new Response(
        JSON.stringify({ error: 'clientId is required for related tables' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    if (DEAL_CHILD_TABLES.includes(table) && !clientId) {
      return new Response(
        JSON.stringify({ error: 'clientId is required for deal mutations' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // The service-role client bypasses RLS, so module permission alone is not
    // sufficient. Bind every client-scoped mutation to a client the actor owns
    // or is assigned to. New client creation has no existing object to check.
    const authorizationClientId = table === 'clients'
      ? (operation === 'create' ? undefined : clientId)
      : ((!STANDALONE_TABLES.includes(table) || DEAL_CHILD_TABLES.includes(table)) && !isPortfolioReportDelete ? clientId : undefined);
    if (authorizationClientId && !await isAuthorizedForClient(supabase, userId!, authorizationClientId, authMethod)) {
      return new Response(
        JSON.stringify({ error: 'You are not authorized to manage this client', permissionDenied: true }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (clientId && DEAL_CHILD_TABLES.includes(table)
      && !await dealChildMutationMatchesClient(supabase, table, operation, clientId, recordId, data)) {
      return new Response(
        JSON.stringify({ error: 'The deal record does not belong to this client', permissionDenied: true }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let result: any;
    let error: any;

    // Canonical, server-validated path for publishing a saved portfolio report.
    // It deliberately links the source object rather than copying it and is idempotent by client/report.
    if (operation === 'publish_portfolio_report') {
      if (table !== 'client_portal_reports' || !clientId || !reportId) {
        return new Response(JSON.stringify({ success: false, error: 'A client and portfolio report are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      // Publishing crosses two module boundaries: require edit access to the
      // source portfolio report as well as create access to the portal report.
      const sourcePermCheck = await checkPermission(supabase, userId!, 'portfolio_analysis_reports', 'update', authMethod);
      if (!sourcePermCheck.allowed) {
        return new Response(
          JSON.stringify({ error: sourcePermCheck.reason || 'Permission denied', permissionDenied: true }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const [{ data: targetClient }, { data: superadminRole }] = await Promise.all([
        supabase.from('clients').select('id, created_by, assigned_team_user_id').eq('id', clientId).maybeSingle(),
        supabase.from('user_roles').select('role').eq('user_id', userId).eq('role', 'superadmin').maybeSingle(),
      ]);
      if (!canPublishPortfolioForClient(
        userId!,
        targetClient,
        Boolean(superadminRole),
        authMethod === 'service_role',
      )) {
        return new Response(
          JSON.stringify({ error: 'You are not authorized to publish reports for this client', permissionDenied: true }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const { data: sourceReport, error: sourceError } = await supabase
        .from('portfolio_analysis_reports')
        .select('id, client_id, created_at, status, pdf_file_path')
        .eq('id', reportId).eq('client_id', clientId).maybeSingle();
      if (sourceError || !sourceReport) {
        return new Response(JSON.stringify({ success: false, error: 'The selected portfolio report is unavailable' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (sourceReport.status !== 'completed') {
        return new Response(JSON.stringify({ success: false, error: 'The selected report is still being generated' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (!sourceReport.pdf_file_path || !sourceReport.pdf_file_path.toLowerCase().endsWith('.pdf')) {
        return new Response(JSON.stringify({ success: false, error: 'The report file could not be located' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const { error: storageError } = await supabase.storage.from('client-files').createSignedUrl(sourceReport.pdf_file_path, 60);
      if (storageError) {
        console.warn('[manage-client-data] Portfolio publication file validation failed', { reportId, clientId, code: storageError.statusCode || null });
        return new Response(JSON.stringify({ success: false, error: 'The report file could not be located' }), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const { data: existing, error: existingError } = await supabase.from('client_portal_reports')
        .select('id').eq('client_id', clientId).eq('source_report_id', reportId).maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        return new Response(JSON.stringify({ success: true, alreadyPublished: true, publication: existing }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const title = `Portfolio Analysis - ${new Date(sourceReport.created_at).toLocaleDateString('en-AU')}`;
      const { data: publication, error: publicationError } = await supabase.from('client_portal_reports').insert({
        client_id: clientId, source_report_id: reportId, storage_path: sourceReport.pdf_file_path,
        report_title: title, report_type: 'portfolio', published_by: userId,
        published_at: new Date().toISOString(), client_visible_notes: data?.client_visible_notes || null,
      }).select().single();
      if (publicationError) throw publicationError;
      try {
        const notificationMessage = `Your advisor has published "${title}" to your portal.${data?.client_visible_notes ? ' Note: ' + data.client_visible_notes : ''}`;
        await supabase.from('client_portal_notifications').insert({ client_id: clientId, title: 'New Report Available', message: notificationMessage, type: 'info', category: 'document', action_url: '/client/reports' });
        if (data?.notify_email === true) {
          const { resolveClientEmailInfo, sendPortalNotificationEmail } = await import('../_shared/portal-notification-email.ts');
          const emailInfo = await resolveClientEmailInfo(supabase, clientId);
          if (emailInfo) await sendPortalNotificationEmail({ to: emailInfo.email, clientFirstName: emailInfo.firstName, title: 'New Report Available', message: notificationMessage, type: 'info', category: 'document', actionUrl: '/client/reports', companyName: emailInfo.companyName });
        }
      } catch (notificationError) { console.warn('[manage-client-data] Portfolio publication notification failed', { reportId, clientId }); }
      return new Response(JSON.stringify({ success: true, alreadyPublished: false, publication }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    switch (operation) {
      case 'create': {
        if (!data) {
          return new Response(
            JSON.stringify({ error: 'data is required for create operation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Handle batch inserts (array) or single inserts
        const isArray = Array.isArray(data);
        let insertData: Record<string, any> | Record<string, any>[];
        
        const provenance = buildProvenance({
          sourceSurface: 'internal_dashboard',
          sourceActorType: 'internal_user',
          sourceActorName: username || null,
          sourceReference: userId || null,
          sourceDetails: { auth_method: authMethod || 'unknown' },
        });

        if (STANDALONE_TABLES.includes(table)) {
          // For standalone tables, use data as-is
          insertData = data;
        } else {
          // For client-related tables, add client_id
          insertData = isArray 
            ? data.map((item: Record<string, any>) => ({ ...item, client_id: clientId }))
            : { ...data, client_id: clientId };
          if (table === 'client_address_history') {
            insertData = isArray
              ? (insertData as Record<string, any>[]).map((item) => normalizeAddressPayload(item))
              : normalizeAddressPayload(insertData as Record<string, any>);
          }
        }

        if (table === 'clients') {
          insertData = Array.isArray(insertData)
            ? insertData.map((item) => normalizeAddressPayload({ ...item, created_by: userId }))
            : normalizeAddressPayload({ ...insertData, created_by: userId });
        }

        const syncPlans = table === 'client_files' || table === 'client_notes'
          ? await Promise.all((Array.isArray(insertData) ? insertData : [insertData]).map((item) =>
              prepareSharedSyncInsert(supabase, table, clientId!, { ...item }, provenance, { userId: userId || null, username: username || null }),
            ))
          : null;

        if (syncPlans) {
          insertData = Array.isArray(insertData)
            ? syncPlans.map((plan) => plan.record)
            : syncPlans[0].record;
        }

        // Use .select() without .single() to handle both array and single inserts
        const { data: inserted, error: insertError } = await supabase
          .from(table)
          .insert(insertData)
          .select();

        result = isArray ? inserted : inserted?.[0];
        error = insertError;

        if (!error && syncPlans) {
          const insertedRows = Array.isArray(result) ? result : [result];
          await Promise.all(insertedRows.map(async (row: any, index: number) => {
            const plan = syncPlans[index];
            if (!row || !plan?.syncMeta) return;

            if (plan.syncMeta.shouldSupersedeExisting && plan.syncMeta.existingId) {
              const supersedeField = table === 'client_files' ? 'supersedes_file_id' : 'supersedes_note_id';
              await supabase
                .from(table)
                .update({
                  sync_status: 'superseded',
                  last_synced_at: new Date().toISOString(),
                  last_sync_error: plan.syncMeta.conflictReason,
                  [supersedeField]: row.id,
                })
                .eq('id', plan.syncMeta.existingId)
                .eq('client_id', clientId);
            }

            await createSyncEvent(supabase, {
              clientId: clientId!,
              entityId: row.id,
              entityTable: table,
              entityType: table === 'client_files' ? 'document' : 'note',
              sourceSurface: 'internal_dashboard',
              sourceActorType: 'internal_user',
              sourceActorName: username || null,
              sourceReference: userId || null,
              sourceDetails: {
                ...(row.source_details || {}),
                operation: 'create',
              },
              syncStatus: plan.syncMeta.syncStatus,
              dedupeKey: plan.syncMeta.dedupeKey,
              contentHash: plan.syncMeta.contentHash || null,
              propagatedTo: ['finance_portal', 'client_portal'],
              versionGroupId: plan.syncMeta.versionGroupId,
              versionNumber: plan.syncMeta.versionNumber,
              supersedesEntityId: plan.syncMeta.supersedesEntityId,
              conflictReason: plan.syncMeta.conflictReason,
            });
          }));
        }

        // Update last_note_at on the client when a note is created
        if (!error && table === 'client_notes' && clientId) {
          await supabase
            .from('clients')
            .update({ last_note_at: new Date().toISOString() })
            .eq('id', clientId);
        }

        // Auto-create linked income source when employment is created
        if (!error && table === 'client_employment' && result && clientId) {
          try {
            await syncEmploymentToIncomeSource(supabase, result, clientId);
          } catch (syncError) {
            console.warn('Failed to sync employment to income source:', syncError);
          }
        }

        if (!error && table === 'client_address_history' && result && clientId) {
          await logAddressSyncEvent(supabase, { clientId, entityId: result.id, entityTable: table, operation: 'create', username, userId, authMethod });
        }

        // ── Portal Notification: Report published to client ──
        if (!error && table === 'client_portal_reports' && clientId && result) {
          try {
            const reportTitle = (isArray ? result[0] : result)?.report_title || 'New Report';
            const clientVisibleNotes = (isArray ? result[0] : result)?.client_visible_notes;
            const notifTitle = 'New Report Available';
            const notifMessage = `Your advisor has published "${reportTitle}" to your portal.${clientVisibleNotes ? ' Note: ' + clientVisibleNotes : ''}`;
            
            await supabase.from('client_portal_notifications').insert({
              client_id: clientId,
              title: notifTitle,
              message: notifMessage,
              type: 'info',
              category: 'document',
              action_url: '/client/reports',
            });
            console.log(`[manage-client-data] Portal notification created for report publish to client ${clientId}`);

            // Send email notification
            const { resolveClientEmailInfo, sendPortalNotificationEmail } = await import('../_shared/portal-notification-email.ts');
            const emailInfo = await resolveClientEmailInfo(supabase, clientId);
            if (emailInfo) {
              await sendPortalNotificationEmail({
                to: emailInfo.email,
                clientFirstName: emailInfo.firstName,
                title: notifTitle,
                message: notifMessage,
                type: 'info',
                category: 'document',
                actionUrl: '/client/reports',
                companyName: emailInfo.companyName,
              });
            }
          } catch (notifErr) {
            console.warn('[manage-client-data] Failed to create portal notification for report:', notifErr);
          }
        }
        break;
      }

      case 'update': {
        if (!recordId && table !== 'clients') {
          return new Response(
            JSON.stringify({ error: 'recordId is required for update operation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!data) {
          return new Response(
            JSON.stringify({ error: 'data is required for update operation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // For clients table, use clientId as the record ID
        const idToUpdate = table === 'clients' ? clientId : recordId;

        let updatePayload = { ...data } as Record<string, any>;
        delete updatePayload.id;
        if (!STANDALONE_TABLES.includes(table) && clientId) updatePayload.client_id = clientId;
        if (table === 'client_address_history' || (table === 'clients' && hasAddressFields(updatePayload))) {
          updatePayload = normalizeAddressPayload(updatePayload);
        }
        if (table === 'clients' && idToUpdate) {
          updatePayload = await applyInheritedSecondaryAddress(supabase, idToUpdate, updatePayload);
        }
        if (table === 'client_notes' || table === 'client_files') {
          Object.assign(updatePayload, {
            ...buildProvenance({
              sourceSurface: 'internal_dashboard',
              sourceActorType: 'internal_user',
              sourceActorName: username || null,
              sourceReference: userId || null,
              sourceDetails: { auth_method: authMethod || 'unknown', updated_via: 'manage-client-data' },
            }),
            last_synced_at: new Date().toISOString(),
            sync_status: 'synced',
            last_sync_error: null,
          });

          if (table === 'client_notes') {
            updatePayload.content_hash = await sha256Text(`${String(updatePayload.note_type || 'general')}:${String(updatePayload.content || '')}`);
            updatePayload.dedupe_key = buildNoteDedupeKey({
              clientId: clientId!,
              noteType: String(updatePayload.note_type || 'general'),
              content: String(updatePayload.content || ''),
            });
          }
        }

        let updateQuery = supabase
          .from(table)
          .update(updatePayload)
          .eq('id', idToUpdate);
        // Never let a valid record ID escape the authorized client boundary.
        if (!STANDALONE_TABLES.includes(table) && clientId) {
          updateQuery = updateQuery.eq('client_id', clientId);
        }
        const { data: updated, error: updateError } = await updateQuery
          .select()
          .single();

        result = updated;
        error = updateError;

        // Auto-sync linked income source when employment is updated
        if (!error && table === 'client_employment' && result && clientId) {
          try {
            await syncEmploymentToIncomeSource(supabase, result, clientId);
          } catch (syncError) {
            console.warn('Failed to sync employment to income source:', syncError);
          }
        }

        if (!error && result && clientId && (table === 'client_address_history' || (table === 'clients' && hasAddressFields(updatePayload)))) {
          await logAddressSyncEvent(supabase, { clientId, entityId: result.id || clientId, entityTable: table === 'clients' ? 'clients' : table, operation: 'update', username, userId, authMethod });
        }

        // ── Portal Notification: Report request status updated ──
        if (!error && table === 'client_portal_report_requests' && result) {
          try {
            const status = (data as Record<string, any>).status;
            const reqClientId = result.client_id;
            if (status && reqClientId && ['completed', 'in_progress', 'declined'].includes(status)) {
              const typeLabel = (result.request_type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
              const statusMessages: Record<string, { title: string; message: string; type: string }> = {
                completed: {
                  title: 'Report Request Completed',
                  message: `Your ${typeLabel} request has been completed. Check your Reports page for the new document.`,
                  type: 'success',
                },
                in_progress: {
                  title: 'Report Request In Progress',
                  message: `Your ${typeLabel} request is now being worked on by our team.`,
                  type: 'info',
                },
                declined: {
                  title: 'Report Request Update',
                  message: `Your ${typeLabel} request has been reviewed. Please contact your advisor for more details.`,
                  type: 'warning',
                },
              };
              const msg = statusMessages[status];
              if (msg) {
                await supabase.from('client_portal_notifications').insert({
                  client_id: reqClientId,
                  title: msg.title,
                  message: msg.message,
                  type: msg.type,
                  category: 'document',
                  action_url: '/client/reports',
                });
                console.log(`[manage-client-data] Portal notification created for report request status: ${status}`);

                // Send email notification
                const { resolveClientEmailInfo, sendPortalNotificationEmail } = await import('../_shared/portal-notification-email.ts');
                const emailInfo = await resolveClientEmailInfo(supabase, reqClientId);
                if (emailInfo) {
                  await sendPortalNotificationEmail({
                    to: emailInfo.email,
                    clientFirstName: emailInfo.firstName,
                    title: msg.title,
                    message: msg.message,
                    type: msg.type,
                    category: 'document',
                    actionUrl: '/client/reports',
                    companyName: emailInfo.companyName,
                  });
                }
              }
            }
          } catch (notifErr) {
            console.warn('[manage-client-data] Failed to create portal notification for report request:', notifErr);
          }
        }
        break;
      }

      case 'delete': {
        if (table === 'portfolio_analysis_reports') {
          if (!portfolioReportId) {
            return new Response(
              JSON.stringify({ error: 'reportId is required for portfolio report deletion' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          // Resolve the canonical report first. This prevents a missing or forged clientId
          // from selecting a different client’s data and supports legacy reports with no link.
          const { data: report, error: reportLookupError } = await supabase
            .from('portfolio_analysis_reports')
            .select('id, client_id, client_name, created_at, status, pdf_file_path')
            .eq('id', portfolioReportId)
            .maybeSingle();

          if (reportLookupError || !report) {
            console.warn('[manage-client-data] Portfolio report delete target was not found or could not be resolved', {
              reportId: portfolioReportId,
              userId,
              lookupError: reportLookupError?.code || null,
            });
            return new Response(
              JSON.stringify({ error: 'Portfolio report not found' }),
              { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          const deletionTarget = resolvePortfolioReportDeletionTarget(portfolioReportId, report);
          if (!deletionTarget) {
            return new Response(
              JSON.stringify({ error: 'Portfolio report not found' }),
              { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          resolvedClientId = deletionTarget.clientId || undefined;
          if (resolvedClientId && !await isAuthorizedForClient(supabase, userId!, resolvedClientId, authMethod)) {
            return new Response(
              JSON.stringify({ error: 'You are not authorized to manage this client', permissionDenied: true }),
              { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
          }
          let deleteQuery = supabase
            .from('portfolio_analysis_reports')
            .delete()
            .eq('id', deletionTarget.reportId);
          // Scope by the server-resolved owner when it exists. Legacy rows without an
          // owner can still be safely removed by their immutable report ID alone.
          if (resolvedClientId) deleteQuery = deleteQuery.eq('client_id', resolvedClientId);
          const { error: deleteError } = await deleteQuery;
          error = deleteError;

          result = {
            deleted: !error,
            id: report.id,
          };
          break;
        }

        if (!recordId && table !== 'clients') {
          return new Response(
            JSON.stringify({ error: 'recordId is required for delete operation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // For clients table, use clientId as the record ID
        const idToDelete = table === 'clients' ? clientId : recordId;

        // When deleting employment, the linked income source is auto-deleted via ON DELETE CASCADE on employment_id FK

        let deleteQuery = supabase
          .from(table)
          .delete()
          .eq('id', idToDelete);
        // Never let a valid record ID escape the authorized client boundary.
        if (!STANDALONE_TABLES.includes(table) && clientId) {
          deleteQuery = deleteQuery.eq('client_id', clientId);
        }
        const { error: deleteError } = await deleteQuery;

        result = { deleted: true, id: idToDelete };
        error = deleteError;
        if (!error && table === 'client_address_history' && clientId && idToDelete) {
          await logAddressSyncEvent(supabase, { clientId, entityId: idToDelete, entityTable: table, operation: 'delete', username, userId, authMethod });
        }
        break;
      }

      case 'upsert': {
        if (!data) {
          return new Response(
            JSON.stringify({ error: 'data is required for upsert operation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // For client-related tables, add client_id
        const upsertData: Record<string, any> = STANDALONE_TABLES.includes(table)
          ? { ...data as Record<string, any> }
          : { ...data as Record<string, any>, client_id: clientId };
        if (table === 'clients') upsertData.id = clientId;

        // Use appropriate conflict target
        const conflictTarget = STANDALONE_TABLES.includes(table) ? 'id' : 'client_id';

        // Upsert using the appropriate conflict target
        const { data: upserted, error: upsertError } = await supabase
          .from(table)
          .upsert(upsertData, { onConflict: conflictTarget })
          .select()
          .single();

        result = upserted;
        error = upsertError;
        break;
      }

      case 'bulkDelete': {
        // Delete ALL records for a given client_id in the specified table
        if (!clientId) {
          return new Response(
            JSON.stringify({ error: 'clientId is required for bulkDelete operation' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Only allow bulkDelete on client-related tables (not standalone)
        if (STANDALONE_TABLES.includes(table)) {
          return new Response(
            JSON.stringify({ error: `bulkDelete is not supported for ${table}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { data: bulkDeleted, error: bulkDeleteError } = await supabase
          .from(table)
          .delete()
          .eq('client_id', clientId)
          .select('id');

        result = { deleted: true, count: bulkDeleted?.length || 0 };
        error = bulkDeleteError;
        console.log(`bulkDelete on ${table} for client ${clientId}: removed ${bulkDeleted?.length || 0} records`);
        break;
      }
    }

    if (error) {
      console.error(`Error in ${operation} on ${table}:`, error);
      /*
       * A client with an AML/CTF case can no longer be deleted through this
       * path. `aml.cases.client_id` was ON DELETE SET NULL, so this statement
       * used to succeed and ORPHAN the case — the customer vanished from the
       * register while the case, its screening subjects, its determinations
       * and its event chain remained, attached to nobody (1 case in 6, in
       * production). The constraint is RESTRICT now, so Postgres refuses.
       *
       * That refusal arrives as `23503` and a message naming a constraint,
       * which tells an operator nothing they can act on. It is translated
       * here into the one thing they need: there is another route, it is
       * compliance-aware, and it is the reason this one says no.
       */
      const isAmlCaseLink = (error as { code?: string })?.code === '23503'
        && /cases_client_id_fkey/.test(String(error.message ?? ''));
      if (isAmlCaseLink) {
        return new Response(
          JSON.stringify({
            error: 'This client has an AML/CTF case and cannot be deleted here.',
            code: 'aml_case_present',
            details: 'Deleting them this way would leave the case attached to nobody. '
              + 'Use Delete on the client row, which routes to the AML reset: it closes or '
              + 'removes the case explicitly, and refuses outright if the case holds '
              + 'evidence that must be retained.',
          }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ error: `Failed to ${operation} record`, details: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log the activity (only for client-related tables)
    const activityClientId = resolvedClientId || clientId;
    if (activityClientId && !['report_qa_messages', 'report_qa_conversations'].includes(table)) {
      try {
        await logClientActivity(supabase, {
          clientId: activityClientId,
          activityType: `${table}_${operation}`,
          title: `${operation.charAt(0).toUpperCase() + operation.slice(1)}d ${table.replace('client_', '').replace('_', ' ')}`,
          description: `Record ${operation}d via secure API`,
          createdBy: userId,
          metadata: {
            table,
            operation,
            recordId: recordId || result?.id,
            sync_status: result?.sync_status || null,
            source_surface: result?.source_surface || 'internal_dashboard',
            conflict_reason: result?.last_sync_error || result?.source_details?.sync_conflict_reason || null,
            version_number: result?.version_number || null,
          },
          provenance: {
            sourceSurface: 'internal_dashboard',
            sourceActorType: 'internal_user',
            sourceActorName: username || null,
            sourceReference: userId || null,
            sourceDetails: { auth_method: authMethod || 'unknown' },
          },
        });
      } catch (logError) {
        console.warn('Failed to log activity:', logError);
        // Don't fail the main operation due to logging failure
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        operation, 
        table, 
        result,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('manage-client-data error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'manage-client-data'), error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
