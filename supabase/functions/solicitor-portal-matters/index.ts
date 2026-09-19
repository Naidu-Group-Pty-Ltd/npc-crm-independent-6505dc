/**
 * Solicitor Portal — Matters (Phase 3)
 *
 * Portal-facing matter workspace. Every operation is scoped by the caller's
 * session, an explicit matter grant AND an exact non-null firm, then gated on the tri-state
 * permission matrix. Financial-position and AML-restricted data is never
 * selected here — tri-portal separation is enforced by the shared whitelists.
 *
 * Operations
 *   list_matters | get_matter | update_matter | set_status
 *   list_parties | upsert_party | delete_party
 *   status_history | matter_stats
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import {
  resolveSolicitorSession,
  solicitorGovernanceError,
  resolveSolicitorMatterAccess,
  resolveMatterPermissions,
  listAccessibleMatterIds,
  logSolicitorActivity,
  requestIp,
  can,
  type PermissionMatrix,
} from "../_shared/solicitorPortalAuth.ts";
import {
  SOLICITOR_MATTER_LIST_SELECT,
  SOLICITOR_MATTER_RISK_SELECT,
  LEGAL_MATTER_SOLICITOR_DETAIL_SELECT,
  PARTY_SELECT,
  LEGAL_MATTER_STATUSES,
  buildMatterPayload,
  buildPartyPayload,
  cleanEnum,
  cleanText,
} from "../_shared/legalMatters.ts";
import {
  CRITICAL_DATE_SELECT,
  SETTLEMENT_TASK_SELECT,
  LEGAL_CRITICAL_DATE_STATUSES,
  LEGAL_SETTLEMENT_TASK_STATUSES,
  buildCriticalDatePayload,
  buildSettlementTaskPayload,
  summariseRunway,
} from "../_shared/legalCriticalDates.ts";

const LEGAL_INTEGRITY_COMMANDS_V1 = Deno.env.get('SOLICITOR_LEGAL_INTEGRITY_V1') !== 'false';
const FINANCE_SOLICITOR_COLLABORATION = Deno.env.get('FINANCE_SOLICITOR_COLLABORATION') === 'true';

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  const json = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({} as Record<string, any>));
    const operation = String(body.operation || '');

    const session = await resolveSolicitorSession(supabase, req.headers, body);
    if (!session.ok || !session.user) {
      return json({ error: session.error || 'Unauthorised' }, session.status || 401);
    }
    const me = session.user;
    const governanceError = solicitorGovernanceError(me);
    if (governanceError) return json({ error: 'Portal setup required', code: governanceError }, 403);
    const ip = requestIp(req);
    const userAgent = req.headers.get('user-agent');

    const accessibleMatterIds = await listAccessibleMatterIds(supabase, me.id, me.firm_id);
    if (!accessibleMatterIds.length && operation !== 'matter_stats') {
      if (operation === 'list_matters' || operation === 'list_flagged_matters') {
        return json({ success: true, records: [] });
      }
    }

    /** Assigned clients for which the merged permission matrix allows matter visibility. */
    const listViewableClientIds = async (): Promise<string[]> => {
      const permissions = await Promise.all(
        assignedClientIds.map(async (clientId) => ({
          clientId,
          matrix: await resolveClientPermissions(supabase, me.id, clientId),
        })),
      );
      return permissions
        .filter(({ matrix }) => can(matrix, 'matters', 'view'))
        .map(({ clientId }) => clientId);
    };

    /** Load a matter and confirm this solicitor may see it. */
    const loadMatter = async (matterId: string): Promise<
      { ok: true; matter: any; perms: PermissionMatrix } | { ok: false; status: number; error: string }
    > => {
      if (!matterId) return { ok: false, status: 400, error: 'matter_id is required' };
      const { data: matter } = await supabase
        .from('legal_matters')
        .select(LEGAL_MATTER_SOLICITOR_DETAIL_SELECT)
        .eq('id', matterId)
        .maybeSingle();
      if (!matter) return { ok: false, status: 404, error: 'Matter not found' };
      if (!matter.firm_id || matter.firm_id !== me.firm_id) {
        return { ok: false, status: 404, error: 'Matter not found' };
      }
      const access = await resolveSolicitorMatterAccess(supabase, me.id, me.firm_id, matter.id);
      if (!access) {
        return { ok: false, status: 404, error: 'Matter not found' };
      }
      const perms = await resolveMatterPermissions(supabase, access);
      if (!perms || !can(perms, 'matters', 'view')) {
        return { ok: false, status: 403, error: 'You do not have access to this matter' };
      }
      return { ok: true, matter, perms };
    };

    if (operation === 'get_finance_coordination') {
      if (!FINANCE_SOLICITOR_COLLABORATION) return json({ error: 'Not found' }, 404);
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'finance_status', 'view')) return json({ error: 'Access denied' }, 403);
      const { data: link } = await supabase.from('transaction_case_links').select('case_id,purchase_file_id').eq('legal_matter_id', res.matter.id).maybeSingle();
      if (!link?.case_id) return json({ error: 'Transaction case link required', code: 'CASE_LINK_REQUIRED' }, 409);
      const [{ data: projection }, { data: runway }, { data: solicitorDocs }, { data: financeGrants }, { data: conversations }] = await Promise.all([
        supabase.from('solicitor_case_read_model').select('case_id,purchase_file_id,finance_status,lender,finance_clause_date,finance_clause_state,finance_contact_name,finance_contact_email,finance_source_version,finance_updated_at,link_health,updated_at').eq('case_id', link.case_id).maybeSingle(),
        supabase.rpc('get_case_runway', { _case_id: link.case_id, _audience: 'solicitor' }),
        supabase.rpc('list_accessible_documents', { _case_id: link.case_id, _audience: 'solicitor', _grantee_id: me.id }),
        supabase.from('document_access_grants').select('document_record_id,document_records!inner(case_id)').eq('audience', 'finance').is('revoked_at', null).eq('document_records.case_id', link.case_id),
        supabase.rpc('get_participant_conversations', { _participant_type: 'solicitor_user', _participant_id: me.id, _case_id: link.case_id }),
      ]);
      if (!projection) return json({ error: 'Finance projection unavailable', code: 'PROJECTION_UNAVAILABLE' }, 409);
      const financeDocumentIds = new Set((financeGrants || []).map((grant: any) => grant.document_record_id));
      const sharedDocuments = (solicitorDocs || []).filter((entry: any) => financeDocumentIds.has(entry.record?.id) && entry.version?.malware_scan_status === 'clean' && ['reviewed','retained','legal_hold'].includes(entry.version?.lifecycle_status)).map((entry: any) => ({ id: entry.record.id, title: entry.record.title, category: entry.record.category, current_version: entry.version ? { id: entry.version.id, version_number: entry.version.version_number, filename: entry.version.original_filename, mime_type: entry.version.detected_mime_type, byte_size: entry.version.byte_size, sha256: entry.version.sha256 } : null }));
      const sharedTasks = (runway?.tasks || []).filter((task: any) => task.visibility === 'shared').map((task: any) => ({ id: task.id, label: task.label, description: task.description, status: task.status, due_at: task.due_at, completed_at: task.completed_at, row_version: task.row_version }));
      const milestones = (runway?.milestones || []).filter((milestone: any) => milestone.visibility === 'shared').map((milestone: any) => ({ id: milestone.id, milestone_type: milestone.milestone_type, title: milestone.title, due_at: milestone.due_at, status: milestone.status, authority: milestone.authority, row_version: milestone.row_version }));
      const threads = [];
      for (const entry of (conversations || []).filter((item: any) => item.conversation?.scope === 'finance_solicitor')) {
        const { data: messages } = await supabase.rpc('get_conversation_messages', { _conversation_id: entry.conversation.id, _participant_type: 'solicitor_user', _participant_id: me.id, _limit: 100, _before: null });
        threads.push({ id: entry.conversation.id, subject: entry.conversation.subject, unread_count: entry.unread_count, messages: (messages || []).map((message: any) => ({ id: message.id, sender_type: message.sender_type, sender_name: message.sender_name, body: message.body, created_at: message.created_at })) });
      }
      return json({ success: true, coordination: { case: projection, milestones, shared_tasks: sharedTasks, shared_documents: sharedDocuments, conversations: threads, provenance: { finance: { source: 'finance_case_projection', version: projection.finance_source_version, updated_at: projection.finance_updated_at } } } });
    }

    // ───────────────────────── LIST ─────────────────────────
    // The list projection is the minimal one. `LEGAL_MATTER_SOLICITOR_LIST_SELECT`
    // is the 38-column shared contract and served this operation for a long
    // time, which put `purchase_price`, `deposit_amount`, `deposit_percent`,
    // `title_reference`, `pexa_workspace_id`, `risk_notes` and `shared_summary`
    // in every page of every matter list — none of which any list surface
    // renders. `get_matter` still returns the full detail contract, so nothing
    // a solicitor may see has been taken away; it is now fetched when the
    // matter is opened rather than shipped for every row of every page.
    if (operation === 'list_matters') {
      const page = Math.max(1, Math.floor(Number(body.page) || 1));
      const pageSize = Math.min(100, Math.max(10, Math.floor(Number(body.page_size) || 25)));
      const from = (page - 1) * pageSize;
      let query = supabase
        .from('legal_matters')
        .select(SOLICITOR_MATTER_LIST_SELECT, { count: 'exact' })
        .in('id', accessibleMatterIds)
        .eq('firm_id', me.firm_id)
        .order('settlement_date', { ascending: true, nullsFirst: false });

      const status = cleanEnum(body.status, LEGAL_MATTER_STATUSES);
      if (status) query = query.eq('status', status);
      if (body.mine_only === true) query = query.eq('assigned_solicitor_user_id', me.id);
      const search = cleanText(body.search, 120);
      if (search) {
        const escaped = search.replace(/[%_,()]/g, ' ');
        query = query.or(`title.ilike.%${escaped}%,matter_reference.ilike.%${escaped}%,property_address.ilike.%${escaped}%,property_suburb.ilike.%${escaped}%`);
      }

      const { data, error, count } = await query.range(from, from + pageSize - 1);
      if (error) throw error;

      const rows = data || [];
      const clientIds = Array.from(new Set(rows.map((r: any) => r.client_id).filter(Boolean)));
      const clientMap = new Map<string, string>();
      if (clientIds.length) {
        const { data: clients } = await supabase
          .from('clients')
          .select('id, primary_first_name, primary_surname')
          .in('id', clientIds);
        for (const c of clients || []) {
          clientMap.set(c.id, [c.primary_first_name, c.primary_surname].filter(Boolean).join(' '));
        }
      }

      const records = rows
        .map((r: any) => ({ ...r, client_name: clientMap.get(r.client_id) ?? null }));

      return json({ success: true, records, pagination: { page, page_size: pageSize, total: count || 0, total_pages: Math.max(1, Math.ceil((count || 0) / pageSize)) } });
    }

    // ─────────────────── FLAGGED (risk notes) ───────────────────
    // The dashboard's "Needs attention" card is the one list surface that needs
    // `risk_notes`, and it needs it for at most five flagged matters. Filtering
    // on `risk_flag` in the query rather than in the client is what makes this
    // narrower than the projection it came out of: the note is read only for
    // matters somebody actually flagged. Same access scoping as `list_matters`
    // — `accessibleMatterIds` from `listAccessibleMatterIds`, plus the firm
    // boundary — so this widens the columns without widening the rows.
    if (operation === 'list_flagged_matters') {
      const limit = Math.min(25, Math.max(1, Math.floor(Number(body.limit) || 5)));
      const { data, error } = await supabase
        .from('legal_matters')
        .select(SOLICITOR_MATTER_RISK_SELECT)
        .in('id', accessibleMatterIds)
        .eq('firm_id', me.firm_id)
        .eq('risk_flag', true)
        .order('settlement_date', { ascending: true, nullsFirst: false })
        .limit(limit);
      if (error) throw error;
      return json({ success: true, records: data || [] });
    }

    // ───────────────────────── DETAIL ─────────────────────────
    if (operation === 'get_matter') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const { matter, perms } = res;

      const [{ data: parties }, { data: history }, { data: client }] = await Promise.all([
        can(perms, 'parties', 'view')
          ? supabase.from('legal_matter_parties').select(PARTY_SELECT)
              .eq('legal_matter_id', matter.id).order('created_at', { ascending: true })
          : Promise.resolve({ data: [] as any[] }),
        supabase.from('legal_matter_status_history')
          .select('id, from_status, to_status, changed_by_type, reason, created_at')
          .eq('legal_matter_id', matter.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('clients').select('id, primary_first_name, primary_surname, primary_email, primary_mobile').eq('id', matter.client_id).maybeSingle(),
      ]);

      // Finance collaboration is projection-only — never the client's financial position.
      let finance_snapshot: Record<string, unknown> | null = null;
      if (can(perms, 'finance_status', 'view')) {
        const { data: caseLink } = await supabase.from('transaction_case_links').select('case_id').eq('legal_matter_id', matter.id).maybeSingle();
        if (caseLink?.case_id) {
          const { data: projectedFinance } = await supabase.from('solicitor_case_read_model')
            .select('case_id,purchase_file_id,finance_status,lender,finance_clause_date,finance_clause_state,finance_contact_name,finance_contact_email,finance_source_version,finance_updated_at,link_health,updated_at')
            .eq('case_id', caseLink.case_id).maybeSingle();
          if (projectedFinance) finance_snapshot = projectedFinance;
        }
      }

      // Phase 4 — typed critical dates + settlement runway.
      const canDates = can(perms, 'critical_dates', 'view');
      const canRunway = can(perms, 'settlement', 'view');
      const [{ data: criticalDates }, { data: runwayTasks }] = await Promise.all([
        canDates
          ? supabase.from('legal_matter_critical_dates').select(CRITICAL_DATE_SELECT)
              .eq('legal_matter_id', matter.id)
              .order('due_date', { ascending: true, nullsFirst: false })
          : Promise.resolve({ data: [] as any[] }),
        canRunway
          ? supabase.from('legal_matter_settlement_tasks').select(SETTLEMENT_TASK_SELECT)
              .eq('legal_matter_id', matter.id).order('sequence', { ascending: true })
          : Promise.resolve({ data: [] as any[] }),
      ]);


      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_viewed',
        client_id: matter.client_id, legal_matter_id: matter.id,
        entity_type: 'legal_matter', entity_id: matter.id, ip_address: ip, user_agent: userAgent,
      });

      return json({
        success: true,
        matter: {
          ...matter,
          client_name: client
            ? [client.primary_first_name, client.primary_surname].filter(Boolean).join(' ')
            : null,
        },
        client: client ?? null,
        parties: parties || [],
        status_history: history || [],
        finance_snapshot,
        critical_dates: criticalDates || [],
        settlement_tasks: runwayTasks || [],
        runway: summariseRunway(
          (criticalDates || []) as any[],
          (runwayTasks || []) as any[],
        ),
        permissions: perms,
      });
    }

    // ───────────────────────── UPDATE ─────────────────────────
    if (operation === 'update_matter') {
      if (!LEGAL_INTEGRITY_COMMANDS_V1) return json({ error: 'Legal mutations are temporarily unavailable' }, 503);
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const { matter, perms } = res;
      if (!can(perms, 'matters', 'edit')) {
        return json({ error: 'You do not have permission to edit this matter' }, 403);
      }

      const expectedVersion = Number(body.expected_version);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return json({ error: 'expected_version is required' }, 400);
      const payload = buildMatterPayload(body, { isCreate: false });
      delete (payload as any).matter_reference; // reference is Command Centre owned
      if (!Object.keys(payload).length) return json({ error: 'Nothing to update' }, 400);

      const { data: updated, error } = await supabase
        .from('legal_matters')
        .update({ ...payload, row_version: expectedVersion + 1, updated_at: new Date().toISOString() })
        .eq('id', matter.id)
        .eq('row_version', expectedVersion)
        .select(LEGAL_MATTER_SOLICITOR_DETAIL_SELECT)
        .maybeSingle();
      if (error) throw error;
      if (!updated) { await supabase.rpc('record_portal_operational_event',{_event_name:'stale_write_conflict',_severity:'warning',_correlation_id:crypto.randomUUID(),_request_id:req.headers.get('x-request-id'),_actor_type:'solicitor_user',_actor_id:me.id,_portal:'solicitor',_case_id:null,_matter_id:matter.id,_firm_id:me.firm_id,_duration_ms:null,_success:false,_metadata:{command:'update_matter',expected_version:expectedVersion}}); return json({ error: 'This matter was changed by another user', code: 'STALE_VERSION' }, 409); }

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_updated',
        client_id: matter.client_id, legal_matter_id: matter.id,
        entity_type: 'legal_matter', entity_id: matter.id,
        metadata: { fields: Object.keys(payload) }, ip_address: ip, user_agent: userAgent,
      });

      return json({ success: true, matter: updated });
    }

    // ───────────────────────── STATUS ─────────────────────────
    if (operation === 'set_status') {
      if (!LEGAL_INTEGRITY_COMMANDS_V1) return json({ error: 'Legal mutations are temporarily unavailable' }, 503);
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const { matter, perms } = res;
      if (!can(perms, 'matters', 'edit')) return json({ error: 'You do not have permission to change this matter' }, 403);
      const next = cleanEnum(body.status, LEGAL_MATTER_STATUSES);
      const expectedVersion = Number(body.expected_version);
      const reason = cleanText(body.reason, 1000);
      if (!next || !Number.isInteger(expectedVersion) || expectedVersion < 1 || !reason) {
        return json({ error: 'status, expected_version and reason are required' }, 400);
      }
      const { data: updated, error } = await supabase.rpc('transition_legal_matter', {
        _matter_id: matter.id, _expected_version: expectedVersion, _from: matter.status,
        _to: next, _reason: reason, _actor_type: 'solicitor_user',
        _actor_solicitor_user_id: me.id, _actor_staff_user_id: null,
      });
      if (error) {
        const conflict = /STALE_VERSION|STALE_STATUS|INVALID_TRANSITION/.test(error.message || '');
        return json({ error: conflict ? 'Stale write or invalid status transition' : 'Unable to transition matter', code: error.message }, conflict ? 409 : 400);
      }
      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_status_changed',
        client_id: matter.client_id, legal_matter_id: matter.id, entity_type: 'legal_matter', entity_id: matter.id,
        metadata: { from: matter.status, to: next, row_version: updated?.row_version }, visible_to_client: true,
        ip_address: ip, user_agent: userAgent,
      });
      return json({ success: true, matter: updated });
    }

    // ───────────────────────── PARTIES ─────────────────────────
    if (operation === 'list_parties') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'parties', 'view')) return json({ error: 'Access denied' }, 403);
      const { data } = await supabase.from('legal_matter_parties').select(PARTY_SELECT)
        .eq('legal_matter_id', res.matter.id).order('created_at', { ascending: true });
      return json({ success: true, records: data || [] });
    }

    if (operation === 'upsert_party') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'parties', 'edit')) {
        return json({ error: 'You do not have permission to manage parties' }, 403);
      }
      const payload = buildPartyPayload(body);
      if (!payload.name) return json({ error: 'Party name is required' }, 400);

      let record: any;
      if (body.party_id) {
        const { data, error } = await supabase.from('legal_matter_parties')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', body.party_id).eq('legal_matter_id', res.matter.id)
          .select(PARTY_SELECT).maybeSingle();
        if (error) throw error;
        if (!data) return json({ error: 'Party not found' }, 404);
        record = data;
      } else {
        const { data, error } = await supabase.from('legal_matter_parties')
          .insert({ ...payload, legal_matter_id: res.matter.id })
          .select(PARTY_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      }

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id,
        action: body.party_id ? 'matter_party_updated' : 'matter_party_added',
        client_id: res.matter.client_id, legal_matter_id: res.matter.id,
        entity_type: 'legal_matter_party', entity_id: record?.id ?? null,
        ip_address: ip, user_agent: userAgent,
      });
      return json({ success: true, record });
    }

    if (operation === 'delete_party') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'parties', 'delete')) {
        return json({ error: 'You do not have permission to remove parties' }, 403);
      }
      const { error } = await supabase.from('legal_matter_parties')
        .delete().eq('id', body.party_id).eq('legal_matter_id', res.matter.id);
      if (error) throw error;

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_party_removed',
        client_id: res.matter.client_id, legal_matter_id: res.matter.id,
        entity_type: 'legal_matter_party', entity_id: body.party_id ?? null,
        ip_address: ip, user_agent: userAgent,
      });
      return json({ success: true });
    }

    if (operation === 'status_history') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      const { data } = await supabase.from('legal_matter_status_history')
        .select('id, from_status, to_status, changed_by_type, reason, created_at')
        .eq('legal_matter_id', res.matter.id).order('created_at', { ascending: false }).limit(100);
      return json({ success: true, records: data || [] });
    }

    // ─────────────── CRITICAL DATES (Phase 4) ───────────────
    if (operation === 'list_dates') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'critical_dates', 'view')) return json({ error: 'Access denied' }, 403);
      const { data } = await supabase.from('legal_matter_critical_dates')
        .select(CRITICAL_DATE_SELECT).eq('legal_matter_id', res.matter.id)
        .order('due_date', { ascending: true, nullsFirst: false });
      return json({ success: true, records: data || [] });
    }

    if (operation === 'upsert_date') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'critical_dates', 'edit')) {
        return json({ error: 'You do not have permission to manage critical dates' }, 403);
      }
      const isCreate = !body.date_id;
      const payload = buildCriticalDatePayload(body, { isCreate });
      if (isCreate && !payload.label) return json({ error: 'A label is required' }, 400);

      let record: any;
      if (isCreate) {
        const { data, error } = await supabase.from('legal_matter_critical_dates')
          .insert({ ...payload, legal_matter_id: res.matter.id, source: 'manual' })
          .select(CRITICAL_DATE_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      } else {
        const { data: existing } = await supabase.from('legal_matter_critical_dates')
          .select('id, source, due_date').eq('id', body.date_id)
          .eq('legal_matter_id', res.matter.id).maybeSingle();
        if (!existing) return json({ error: 'Critical date not found' }, 404);
        // Derived rows are owned by the matter fields — the date itself is read-only.
        if (existing.source === 'matter_field') delete (payload as any).due_date;
        const { data, error } = await supabase.from('legal_matter_critical_dates')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', existing.id).select(CRITICAL_DATE_SELECT).maybeSingle();
        if (error) throw error;
        record = data;
      }

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id,
        action: isCreate ? 'matter_date_added' : 'matter_date_updated',
        client_id: res.matter.client_id, legal_matter_id: res.matter.id,
        entity_type: 'legal_matter_critical_date', entity_id: record?.id ?? null,
        metadata: { label: record?.label ?? null, due_date: record?.due_date ?? null },
        ip_address: ip, user_agent: userAgent,
      });
      return json({ success: true, record });
    }

    if (operation === 'set_date_status') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'critical_dates', 'edit')) {
        return json({ error: 'You do not have permission to manage critical dates' }, 403);
      }
      const status = cleanEnum(body.status, LEGAL_CRITICAL_DATE_STATUSES);
      if (!status) return json({ error: 'A valid status is required' }, 400);

      const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
      if (status === 'satisfied') {
        patch.satisfied_at = new Date().toISOString();
        patch.satisfied_by_type = 'solicitor_user';
        patch.satisfied_by_solicitor_user_id = me.id;
      } else {
        patch.satisfied_at = null;
        patch.satisfied_by_type = null;
        patch.satisfied_by_solicitor_user_id = null;
      }

      const { data: record, error } = await supabase.from('legal_matter_critical_dates')
        .update(patch).eq('id', body.date_id).eq('legal_matter_id', res.matter.id)
        .select(CRITICAL_DATE_SELECT).maybeSingle();
      if (error) throw error;
      if (!record) return json({ error: 'Critical date not found' }, 404);

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_date_status_changed',
        client_id: res.matter.client_id, legal_matter_id: res.matter.id,
        entity_type: 'legal_matter_critical_date', entity_id: record.id,
        metadata: { status, label: record.label }, visible_to_client: !!record.visible_to_client,
        ip_address: ip, user_agent: userAgent,
      });
      return json({ success: true, record });
    }

    if (operation === 'delete_date') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'critical_dates', 'delete')) {
        return json({ error: 'You do not have permission to remove critical dates' }, 403);
      }
      const { data: existing } = await supabase.from('legal_matter_critical_dates')
        .select('id, source').eq('id', body.date_id)
        .eq('legal_matter_id', res.matter.id).maybeSingle();
      if (!existing) return json({ error: 'Critical date not found' }, 404);
      if (existing.source === 'matter_field') {
        return json({ error: 'Contract dates are derived from the matter — clear the date on the matter instead.' }, 400);
      }
      const { error } = await supabase.from('legal_matter_critical_dates')
        .delete().eq('id', existing.id);
      if (error) throw error;

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_date_removed',
        client_id: res.matter.client_id, legal_matter_id: res.matter.id,
        entity_type: 'legal_matter_critical_date', entity_id: existing.id,
        ip_address: ip, user_agent: userAgent,
      });
      return json({ success: true });
    }

    // ─────────────── SETTLEMENT RUNWAY (Phase 4) ───────────────
    if (operation === 'list_runway') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'settlement', 'view')) return json({ error: 'Access denied' }, 403);
      if (Deno.env.get('CASE_RUNWAY_V1') !== 'false') {
        const { data: link } = await supabase.from('transaction_case_links').select('case_id').eq('legal_matter_id', res.matter.id).maybeSingle();
        if (link?.case_id) {
          const { data: runway, error } = await supabase.rpc('get_case_runway', { _case_id: link.case_id, _audience: 'solicitor' });
          if (error) throw error;
          return json({ success: true, case_id: link.case_id, milestones: runway?.milestones || [], records: runway?.tasks || [] });
        }
      }
      const { data } = await supabase.from('legal_matter_settlement_tasks')
        .select(SETTLEMENT_TASK_SELECT).eq('legal_matter_id', res.matter.id)
        .order('sequence', { ascending: true });
      return json({ success: true, records: data || [] });
    }

    if (operation === 'seed_runway') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'settlement', 'edit')) {
        return json({ error: 'You do not have permission to manage the settlement runway' }, 403);
      }
      const { error } = await supabase.rpc('seed_legal_matter_settlement_tasks', {
        _matter_id: res.matter.id,
      });
      if (error) throw error;
      const { data } = await supabase.from('legal_matter_settlement_tasks')
        .select(SETTLEMENT_TASK_SELECT).eq('legal_matter_id', res.matter.id)
        .order('sequence', { ascending: true });

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_runway_seeded',
        client_id: res.matter.client_id, legal_matter_id: res.matter.id,
        entity_type: 'legal_matter', entity_id: res.matter.id,
        ip_address: ip, user_agent: userAgent,
      });
      return json({ success: true, records: data || [] });
    }

    if (operation === 'update_task') {
      const res = await loadMatter(String(body.matter_id || ''));
      if (!res.ok) return json({ error: res.error }, res.status);
      if (!can(res.perms, 'settlement', 'edit')) {
        return json({ error: 'You do not have permission to manage the settlement runway' }, 403);
      }
      const payload = buildSettlementTaskPayload(body);
      if (!Object.keys(payload).length) return json({ error: 'Nothing to update' }, 400);

      if (Deno.env.get('CASE_RUNWAY_V1') !== 'false' && body.expected_version !== undefined) {
        const { data: caseLink } = await supabase.from('transaction_case_links').select('case_id').eq('legal_matter_id', res.matter.id).maybeSingle();
        const { data: sharedTask } = caseLink?.case_id
          ? await supabase.from('case_tasks').select('id,case_id').eq('id', body.task_id).eq('case_id', caseLink.case_id).maybeSingle()
          : { data: null };
        if (sharedTask) {
          const status = payload.status === 'complete' ? 'completed' : payload.status;
          const { data: record, error } = await supabase.rpc('update_case_task_status', {
            _task_id: sharedTask.id, _expected_version: Number(body.expected_version), _status: status,
            _actor_type: 'solicitor_user', _actor_id: me.id,
            _reason: String(body.reason || 'Solicitor settlement runway update'),
            _completion_evidence: body.completion_evidence || {},
          });
          if (error) {
            const conflict = /STALE_VERSION|INVALID_TASK_STATUS|TASK_DOMAIN_FORBIDDEN/.test(error.message || '');
            return json({ error: error.message }, conflict ? 409 : 400);
          }
          return json({ success: true, record });
        }
      }

      if ('status' in payload) {
        const status = cleanEnum(payload.status, LEGAL_SETTLEMENT_TASK_STATUSES, 'not_started');
        if (status === 'complete') {
          payload.completed_at = new Date().toISOString();
          payload.completed_by_type = 'solicitor_user';
          payload.completed_by_solicitor_user_id = me.id;
        } else {
          payload.completed_at = null;
          payload.completed_by_type = null;
          payload.completed_by_solicitor_user_id = null;
        }
        if (status !== 'blocked') payload.blocked_reason = null;
      }

      const { data: record, error } = await supabase.from('legal_matter_settlement_tasks')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', body.task_id).eq('legal_matter_id', res.matter.id)
        .select(SETTLEMENT_TASK_SELECT).maybeSingle();
      if (error) throw error;
      if (!record) return json({ error: 'Settlement task not found' }, 404);

      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_runway_task_updated',
        client_id: res.matter.client_id, legal_matter_id: res.matter.id,
        entity_type: 'legal_matter_settlement_task', entity_id: record.id,
        metadata: { task_key: record.task_key, status: record.status },
        visible_to_client: false, ip_address: ip, user_agent: userAgent,
      });
      return json({ success: true, record });
    }

    // ─────────────── UPCOMING DATES ACROSS THE PRACTICE ───────────────
    if (operation === 'upcoming_dates') {
      const dateMatterIds = await listAccessibleMatterIds(supabase, me.id, me.firm_id, 'critical_dates');
      if (!dateMatterIds.length) return json({ success: true, records: [] });
      const horizonDays = Math.min(Math.max(Number(body.days) || 30, 1), 120);
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + horizonDays);

      const { data: matters } = await supabase
        .from('legal_matters')
        .select('id, title, property_address, property_suburb, status, client_id, firm_id')
        .in('id', dateMatterIds)
        .eq('firm_id', me.firm_id)
        .limit(500);

      const matterMap = new Map<string, any>((matters || []).map((m: any) => [m.id, m]));
      if (!matterMap.size) return json({ success: true, records: [] });

      const { data: dates } = await supabase
        .from('legal_matter_critical_dates')
        .select(CRITICAL_DATE_SELECT)
        .in('legal_matter_id', Array.from(matterMap.keys()))
        .not('due_date', 'is', null)
        .lte('due_date', horizon.toISOString().slice(0, 10))
        .in('status', ['pending', 'at_risk', 'extended', 'missed'])
        .order('due_date', { ascending: true })
        .limit(200);

      const records = (dates || []).map((d: any) => ({
        ...d,
        matter: matterMap.get(d.legal_matter_id) ?? null,
      }));
      return json({ success: true, records });
    }


    // ───────────────────────── STATS ─────────────────────────
    if (operation === 'matter_stats') {
      if (!accessibleMatterIds.length) {
        return json({ success: true, stats: { total: 0, by_status: {}, settling_30d: 0, at_risk: 0 } });
      }
      const { data } = await supabase
        .from('legal_matters')
        .select('id, status, settlement_date, risk_flag')
        .in('id', accessibleMatterIds)
        .eq('firm_id', me.firm_id);

      const rows = data || [];
      const byStatus: Record<string, number> = {};
      const horizon = new Date();
      horizon.setDate(horizon.getDate() + 30);
      let settling = 0;
      let atRisk = 0;
      for (const r of rows) {
        byStatus[r.status] = (byStatus[r.status] || 0) + 1;
        if (r.settlement_date) {
          const d = new Date(r.settlement_date);
          if (d >= new Date(new Date().toDateString()) && d <= horizon) settling++;
        }
        if (r.risk_flag) atRisk++;
      }
      return json({
        success: true,
        stats: { total: rows.length, by_status: byStatus, settling_30d: settling, at_risk: atRisk },
      });
    }

    return json({ error: `Unknown operation: ${operation || '(none)'}` }, 400);
  } catch (error: any) {
    console.error('[solicitor-portal-matters] error:', error);
    return json({ error: 'Internal server error' }, 500);
  }
});
