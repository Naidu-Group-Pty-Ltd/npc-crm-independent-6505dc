import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createForbiddenResponse, createCorsHeaders } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { canAccessAllClients, canAccessAllOf } from '../_shared/clientAccess.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
interface RequestBody {
  clientId?: string;
  clientIds?: string[];
  listMode?: boolean;
  listOptions?: {
    table?: string;
    select?: string;
    orderBy?: string;
    order_asc?: boolean;
    orderAsc?: boolean;
    limit?: number;
    includePropertyCount?: boolean;
    filters?: Record<string, any>;
  };
  notesOptions?: {
    limit?: number;
    offset?: number;
  };
  include?: {
    properties?: boolean;
    income?: boolean;
    expenses?: boolean;
    assets?: boolean;
    liabilities?: boolean;
    employment?: boolean;
    notes?: boolean;
    files?: boolean;
    activities?: boolean;
    borrowingCapacity?: boolean;
    client?: boolean;
    emails?: boolean;
    incomeSources?: boolean;
    additionalContacts?: boolean;
    scores?: boolean;
    deals?: boolean;
    attributions?: boolean;
    reminders?: boolean;
    addressHistory?: boolean;
  };
  session_token?: string;
}

// `custom_users` also stores authentication material. Keep its projection
// server-owned so callers of this service-role broker cannot request secrets.
const SAFE_CUSTOM_USERS_SELECT = 'id, username, email, is_active, personal_mailbox';

// `purchase_files` has a foreign key to service-role-only legal matters. Keep
// this projection server-owned so PostgREST relationship embeds cannot cross
// that authorization boundary.
const SAFE_PURCHASE_FILES_SELECT =
  'id, title, finance_status, lender, settlement_date, risk_level, client_deal_id';

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
    const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('Auth failed for get-client-data:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    console.log(`Authenticated user ${userId} requesting client data`);

    const actor = { userId, authMethod };
    const permission = await requireModulePermission(supabase, actor, 'client_management', 'can_view');
    if (!permission.ok) {
      return createForbiddenResponse(permission.error, corsHeaders);
    }

    const { clientId, clientIds, listMode, listOptions = {}, notesOptions = {}, include = {} } = body;

    // Support for querying other tables (portfolio_analysis_reports, etc.)
    // `portfolio_reviews` sits beside `portfolio_analysis_reports`: the
    // Portfolio Performance Review binds the client's newest completed review
    // alongside the report itself, and its only non-service policy is a join on
    // `clients.created_by = auth.uid()` — always NULL under this app's custom
    // cookie session, so the browser could never read one. Same client scope,
    // same module permission, and the same treatment its sibling already has.
    const allowedTables = ['clients', 'portfolio_analysis_reports', 'portfolio_reviews', 'client_properties', 'client_assets', 'client_liabilities', 'client_employment', 'client_expenses', 'client_files', 'client_additional_contacts', 'client_deals', 'deal_stages', 'build_progress_payments', 'builder_invoices', 'borrowing_capacity_assessments', 'client_reminders', 'lead_source_attributions', 'client_portal_reports', 'client_portal_report_requests', 'ghl_client_opportunities', 'ghl_conversations', 'ghl_conversation_messages', 'custom_users', 'export_jobs', 'purchase_files', 'appointment_secondary_recipients'];
    const targetTable = listOptions.table || 'clients';
    
    if (listOptions.table && !allowedTables.includes(targetTable)) {
      return new Response(
        JSON.stringify({ error: `Table '${targetTable}' is not allowed`, allowedTables }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine which clients to fetch
    const idsToFetch = clientId ? [clientId] : (clientIds || []);

    // Caller-supplied IDs are selectors, not authorization. Hide inaccessible
    // clients behind a not-found response to avoid turning this broker into an
    // ID oracle, even for users who can view the client-management module.
    //
    // Audit item 36 — the verdict is unchanged and all-or-nothing, exactly as
    // the loop that was here gave it. What changed is the cost. This was a
    // `for…of` with an `await` inside, so the CRM Conversations page, which
    // resolves 722 client names on every load, made 722 sequential round trips
    // each carrying its own superadmin read. At 80ms apiece that is 58 seconds
    // against a browser that aborts at 60 — the name lookup failed, the map
    // stayed empty, and every conversation rendered as "Unknown".
    if (!await canAccessAllOf(supabase, actor, idsToFetch)) {
      return new Response(
        JSON.stringify({ error: 'Client not found', success: false }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Handle custom table queries in list mode
    if (listMode && listOptions.table && listOptions.table !== 'clients') {
      const { 
        select = '*', 
        orderBy = 'created_at', 
        order_asc,
        orderAsc,
        limit,
        filters = {}
      } = listOptions;

      const isAscending = order_asc ?? orderAsc ?? false;

      // Do not honour caller-controlled projections for custom_users: it
      // contains password and MFA secret fields which must never be returned.
      const safeSelect = targetTable === 'custom_users'
        ? SAFE_CUSTOM_USERS_SELECT
        : targetTable === 'purchase_files'
          ? SAFE_PURCHASE_FILES_SELECT
          : select;

      let query = supabase
        .from(targetTable)
        .select(safeSelect)
        .order(orderBy, { ascending: isAscending });

      /*
       * The service-role client bypasses RLS, so a client-scoped table must be
       * constrained to the client set the actor may access.
       *
       * `purchase_files` was the only entry that did this. The tables added for
       * the report adapters are scoped the same way rather than inheriting the
       * unscoped treatment their older siblings have: reaching them through
       * this broker is what makes the design-system formats work at all, and a
       * new entry that lists every client's reviews would be a wider grant than
       * the policy it replaces. The pre-existing entries are deliberately left
       * as they are — narrowing those is a behaviour change for their own
       * callers and belongs with them, not here.
       */
      const CLIENT_SCOPED_TABLES = new Set([
        'purchase_files',
        'portfolio_reviews',
        'client_assets',
        'client_liabilities',
        'client_employment',
        'client_expenses',
      ]);
      if (CLIENT_SCOPED_TABLES.has(targetTable) && !await canAccessAllClients(supabase, actor)) {
        const { data: accessibleClients, error: accessibleClientsError } = await supabase
          .from('clients')
          .select('id')
          .or(`created_by.eq.${userId},assigned_team_user_id.eq.${userId}`);

        if (accessibleClientsError) {
          console.error('Error resolving accessible purchase-file clients:', accessibleClientsError);
          return new Response(
            JSON.stringify({ error: 'Failed to authorize purchase_files' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }

        query = query.in('client_id', (accessibleClients || []).map(({ id }: { id: string }) => id));
      }

      // Apply filters
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null) {
          query = query.eq(key, value);
        }
      }

      if (limit) {
        query = query.limit(limit);
      }

      const { data: records, error: recordsError } = await query;

      if (recordsError) {
        console.error(`Error fetching ${targetTable}:`, recordsError);
        return new Response(
          JSON.stringify({ error: `Failed to fetch ${targetTable}`, details: recordsError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`Fetched ${records?.length || 0} records from ${targetTable}`);

      return new Response(
        JSON.stringify({ success: true, records, count: records?.length || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (idsToFetch.length === 0 || listMode) {
      // Return all clients (list mode)
      const { 
        select = '*', 
        orderBy = 'created_at', 
        order_asc,
        orderAsc,
        limit,
        includePropertyCount = false 
      } = listOptions;

      const isAscending = order_asc ?? orderAsc ?? false;

      // Build select string with optional property count
      const selectString = includePropertyCount 
        ? `${select}, client_properties(id)` 
        : select;

      let query = supabase
        .from('clients')
        .select(selectString)
        .order(orderBy, { ascending: isAscending });

      if (!await canAccessAllClients(supabase, actor)) {
        query = query.or(`created_by.eq.${userId},assigned_team_user_id.eq.${userId}`);
      }

      if (limit) {
        query = query.limit(limit);
      }

      const { data: clients, error: clientsError } = await query;

      if (clientsError) {
        console.error('Error fetching clients list:', clientsError);
        return new Response(
          JSON.stringify({ error: 'Failed to fetch clients', details: clientsError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, clients, count: clients?.length || 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch specific client(s) with optional related data
    const results = await Promise.all(idsToFetch.map(async (id) => {
      const clientResult: any = { id };

      // Fetch base client data
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .single();

      if (clientError) {
        console.error(`Error fetching client ${id}:`, clientError);
        return { id, error: clientError.message };
      }

      clientResult.client = client;

      // Parallel fetch of related data based on include flags
      const fetchPromises: Promise<void>[] = [];

      if (include.properties !== false) {
        fetchPromises.push(
          supabase.from('client_properties').select('*').eq('client_id', id)
            .then(({ data }) => { clientResult.properties = data || []; })
        );
      }

      if (include.income) {
        fetchPromises.push(
          supabase.from('client_income').select('*').eq('client_id', id)
            .then(({ data }) => { clientResult.income = data || []; })
        );
      }

      if (include.expenses) {
        fetchPromises.push(
          supabase.from('client_expenses').select('*').eq('client_id', id)
            .then(({ data }) => { clientResult.expenses = data || []; })
        );
      }

      if (include.assets) {
        fetchPromises.push(
          supabase.from('client_assets').select('*').eq('client_id', id)
            .then(({ data }) => { clientResult.assets = data || []; })
        );
      }

      if (include.liabilities) {
        fetchPromises.push(
          supabase.from('client_liabilities').select('*').eq('client_id', id)
            .then(({ data }) => { clientResult.liabilities = data || []; })
        );
      }

      if (include.employment) {
        fetchPromises.push(
          supabase.from('client_employment').select('*').eq('client_id', id)
            .then(({ data }) => { clientResult.employment = data || []; })
        );
      }

      if (include.addressHistory) {
        fetchPromises.push(
          supabase.from('client_address_history').select('*').eq('client_id', id)
            .order('is_current', { ascending: false })
            .order('start_date', { ascending: false })
            .then(({ data }) => { clientResult.addressHistory = data || []; })
        );
      }

      if (include.notes) {
        fetchPromises.push(
          (async () => {
            let query = supabase.from('client_notes').select('*').eq('client_id', id).order('created_at', { ascending: false });
            
            // Apply pagination if notesOptions provided
            if (notesOptions.limit !== undefined && notesOptions.offset !== undefined) {
              const start = notesOptions.offset;
              const end = notesOptions.offset + notesOptions.limit - 1;
              query = query.range(start, end);
            }
            
            const { data } = await query;
            clientResult.notes = data || [];
          })()
        );
      }

      if (include.files) {
        fetchPromises.push(
          supabase.from('client_files').select('*').eq('client_id', id)
            .then(({ data }) => { clientResult.files = data || []; })
        );
      }

      if (include.activities) {
        fetchPromises.push(
          supabase.from('client_activities').select('*').eq('client_id', id).order('created_at', { ascending: false }).limit(50)
            .then(({ data }) => { clientResult.activities = data || []; })
        );
      }

      if (include.borrowingCapacity) {
        fetchPromises.push(
          supabase.from('borrowing_capacity_assessments').select('*').eq('client_id', id).order('created_at', { ascending: false }).limit(10)
            .then(({ data }) => { clientResult.borrowingCapacity = data || []; })
        );
      }

      if (include.emails) {
        fetchPromises.push(
          supabase.from('email_copilot_emails').select('id,sender,subject,body,received_at,status,urgency_level,summary,draft_reply,folder,conversation_id,to_recipients').eq('client_id', id).order('received_at', { ascending: false }).limit(100)
            .then(({ data }) => { clientResult.emails = data || []; })
        );
      }

      if (include.additionalContacts) {
        fetchPromises.push(
          supabase.from('client_additional_contacts').select('*').eq('client_id', id).order('display_order', { ascending: true })
            .then(({ data }) => { clientResult.additionalContacts = data || []; })
        );
      }

      if (include.incomeSources) {
        fetchPromises.push(
          supabase.from('client_income_sources').select('*').eq('client_id', id).eq('is_active', true).order('display_order', { ascending: true })
            .then(({ data }) => { clientResult.incomeSources = data || []; })
        );
      }

      if (include.scores) {
        fetchPromises.push(
          supabase.from('client_scores').select('*').eq('client_id', id).maybeSingle()
            .then(({ data }) => { clientResult.scores = data || null; })
        );
      }

      if (include.reminders) {
        fetchPromises.push(
          supabase.from('client_reminders').select('*').eq('client_id', id).order('due_date', { ascending: true })
            .then(({ data }) => { clientResult.reminders = data || []; })
        );
      }

      if (include.deals) {
        fetchPromises.push(
          (async () => {
            // Fetch deals
            const { data: deals } = await supabase
              .from('client_deals')
              .select('*')
              .eq('client_id', id)
              .order('created_at', { ascending: false });
            
            if (deals && deals.length > 0) {
              // Fetch stages and build payments for all deals in parallel
              const dealIds = deals.map((d: any) => d.id);
              
              const [stagesRes, paymentsRes, invoicesRes] = await Promise.all([
                supabase.from('deal_stages').select('*').in('deal_id', dealIds).order('display_order', { ascending: true }),
                supabase.from('build_progress_payments').select('*').in('deal_id', dealIds).order('display_order', { ascending: true }),
                supabase.from('builder_invoices').select('*').in('deal_id', dealIds).order('created_at', { ascending: false }),
              ]);
              
              // Group by deal_id
              const stagesByDeal: Record<string, any[]> = {};
              const paymentsByDeal: Record<string, any[]> = {};
              const invoicesByDeal: Record<string, any[]> = {};
              
              (stagesRes.data || []).forEach((s: any) => {
                if (!stagesByDeal[s.deal_id]) stagesByDeal[s.deal_id] = [];
                stagesByDeal[s.deal_id].push(s);
              });
              (paymentsRes.data || []).forEach((p: any) => {
                if (!paymentsByDeal[p.deal_id]) paymentsByDeal[p.deal_id] = [];
                paymentsByDeal[p.deal_id].push(p);
              });
              (invoicesRes.data || []).forEach((i: any) => {
                if (!invoicesByDeal[i.deal_id]) invoicesByDeal[i.deal_id] = [];
                invoicesByDeal[i.deal_id].push(i);
              });
              
              // Attach to each deal
              clientResult.deals = deals.map((d: any) => ({
                ...d,
                stages: stagesByDeal[d.id] || [],
                buildPayments: paymentsByDeal[d.id] || [],
                invoices: invoicesByDeal[d.id] || [],
              }));
            } else {
              clientResult.deals = [];
            }
          })()
        );
      }

      if (include.attributions) {
        fetchPromises.push(
          supabase.from('lead_source_attributions').select('*').eq('client_id', id).order('attributed_at', { ascending: false })
            .then(({ data }) => { clientResult.attributions = data || []; })
        );
      }

      await Promise.all(fetchPromises);

      return clientResult;
    }));

    // If single client requested, return flat response
    if (clientId) {
      const result = results[0];
      if (result.error) {
        return new Response(
          JSON.stringify({ error: 'Client not found', details: result.error }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ success: true, ...result }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Multiple clients: return array
    return new Response(
      JSON.stringify({ success: true, clients: results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('get-client-data error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'get-client-data'), error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
