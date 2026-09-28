/**
 * Solicitor Portal — Compliance, Audit & Hardening (Phase 8)
 *
 * Portal-facing compliance control plane. Every operation resolves the caller's
 * session, confirms the matter belongs to their firm and that they hold access
 * to it, then gates on that matter's permission matrix (`audit` for the
 * trail/export, `matters` for conflict checks and closure).
 *
 * Tri-portal separation: nothing here is reachable from the Client Portal or
 * Finance Portal. Audit rows and conflict-check results never leak restricted
 * financial or AML data.
 *
 * Operations
 *   audit_timeline | audit_verify
 *   conflict_list | conflict_run | conflict_clear
 *   closure_state | closure_update | matter_close | matter_reopen
 *   compliance_export | compliance_health
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.55.0";
import { createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { conflictHit, conflictOutcome, conflictSearchTerms } from '../_shared/conflictSearch.pure.ts';
import {
  resolveSolicitorSession,
  solicitorGovernanceError,
  resolveSolicitorMatterAccess,
  resolveMatterPermissions,
  listAccessibleMatterIds,
  readAccessibleMatterIds,
  logSolicitorActivity,
  requestIp,
  can,
  type PermissionMatrix,
} from "../_shared/solicitorPortalAuth.ts";
import {
  recordLegalAuditEvent,
  verifyLegalAuditChain,
  retentionUntil,
  LEGAL_AUDIT_SELECT,
  LEGAL_RETENTION_CLASSES,
  LEGAL_CLOSURE_CHECKLIST_KEYS,
  type LegalAuditCategory,
} from "../_shared/legalAudit.ts";

const AUDIT_CATEGORIES = new Set<string>([
  'access', 'matter', 'party', 'document', 'search', 'requisition', 'disbursement',
  'critical_date', 'settlement', 'communication', 'intelligence', 'conflict',
  'closure', 'retention', 'export', 'admin',
]);

const CONFLICT_OUTCOMES = new Set(['pending', 'clear', 'potential_conflict', 'conflict', 'waived']);
const LEGAL_INTEGRITY_COMMANDS_V1 = Deno.env.get('SOLICITOR_LEGAL_INTEGRITY_V1') !== 'false';

const text = (v: unknown, max = 500): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

/** Matches kept on the record. `match_count` is always the full number found. */
const CONFLICT_STORED_MATCHES = 200;
/** UUIDs per `.in()` filter, and PostgREST's ceiling on rows per request. */
const CONFLICT_ID_CHUNK = 100;
const CONFLICT_PAGE = 1000;

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

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

    const accessibleMatterIds = await listAccessibleMatterIds(supabase, me.id, me.firm_id, 'audit');

    const loadMatter = async (matterId: string): Promise<
      { ok: true; matter: any; perms: PermissionMatrix } | { ok: false; status: number; error: string }
    > => {
      if (!matterId) return { ok: false, status: 400, error: 'matter_id is required' };
      const { data: matter } = await supabase
        .from('legal_matters')
        .select(`
          id, matter_reference, title, status, client_id, firm_id, settlement_date,
          actual_settlement_date, closure_status, closure_reason, closure_checklist,
          closed_at, closed_by_type, closed_by_solicitor_user_id, retention_class,
          retention_until, archived_at, conflict_check_status, conflict_checked_at, row_version
        `)
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

    const audit = (
      matter: any,
      category: LegalAuditCategory,
      action: string,
      extra: Record<string, unknown> = {},
    ) => recordLegalAuditEvent(supabase, {
      legal_matter_id: matter.id,
      client_id: matter.client_id,
      firm_id: matter.firm_id ?? me.firm_id ?? null,
      actor_type: 'solicitor_user',
      actor_solicitor_user_id: me.id,
      category,
      action,
      ip_address: ip,
      user_agent: userAgent,
      ...extra,
    });

    // ───────────────────── AUDIT TIMELINE ─────────────────────
    if (operation === 'audit_timeline') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      if (!can(loaded.perms, 'audit', 'view')) {
        return json({ error: 'You do not have access to the audit trail' }, 403);
      }

      let query = supabase
        .from('legal_matter_audit_events')
        .select(LEGAL_AUDIT_SELECT)
        .eq('legal_matter_id', loaded.matter.id)
        .order('created_at', { ascending: false })
        .limit(Math.min(Number(body.limit) || 200, 500));

      const category = text(body.category, 40);
      if (category && AUDIT_CATEGORIES.has(category)) query = query.eq('category', category);
      const severity = text(body.severity, 20);
      if (severity) query = query.eq('severity', severity);

      const { data, error } = await query;
      if (error) throw error;

      const rows = data || [];
      const stats = {
        total: rows.length,
        critical: rows.filter((r: any) => r.severity === 'critical').length,
        warning: rows.filter((r: any) => r.severity === 'warning').length,
        by_category: rows.reduce((acc: Record<string, number>, r: any) => {
          acc[r.category] = (acc[r.category] ?? 0) + 1;
          return acc;
        }, {}),
      };

      return json({ success: true, records: rows, stats });
    }

    if (operation === 'audit_verify') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      if (!can(loaded.perms, 'audit', 'view')) {
        return json({ error: 'You do not have access to the audit trail' }, 403);
      }
      const verification = await verifyLegalAuditChain(supabase, loaded.matter.id);
      await audit(loaded.matter, 'access', 'audit_chain_verified', {
        severity: verification.verified ? 'info' : 'critical',
        metadata: { verified: verification.verified, checked: verification.checked },
      });
      return json({ success: true, verification });
    }

    if (operation === 'audit_record') return json({ error: 'General audit insertion is not available' }, 404);

    // ───────────────────── CONFLICT CHECKS ─────────────────────
    if (operation === 'conflict_list') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      const { data, error } = await supabase
        .from('legal_conflict_checks')
        .select('*')
        .eq('legal_matter_id', loaded.matter.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return json({
        success: true,
        records: data || [],
        conflict_check_status: loaded.matter.conflict_check_status,
        conflict_checked_at: loaded.matter.conflict_checked_at,
      });
    }

    if (operation === 'conflict_run') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      if (!can(loaded.perms, 'matters', 'edit')) {
        return json({ error: 'You do not have permission to run conflict checks' }, 403);
      }

      /*
       * The search, and what it may and may not conclude.
       *
       * Until 28 Sep 2026 this operation threw on every call that had
       * something to search for: it scoped the search by `assignedClientIds`,
       * which a merge had deleted. A matter with no parties searched nothing
       * and recorded "clear", which is the only call that ever succeeded. And
       * the query behind it could not be trusted even when it ran: a filter
       * composed as a string, a read error discarded, and a term normalised on
       * one side of the comparison only. Each of the three reported absence
       * rather than failure. Now:
       *
       * - Nothing to search for is refused, and nothing is recorded. A matter
       *   with no parties has not been checked against anything.
       * - The scope is every other matter this solicitor may see, and whose
       *   parties they may see, through the same resolver that opens a single
       *   matter. A read that fails fails the check. It does not narrow it.
       * - No other matter in scope records `pending`, never `clear`. A search
       *   over nothing is not a clearance, and a person has to decide.
       * - Parties are read in pages and matched here by `conflictHit`, both
       *   sides normalised by `conflictKey`, so no term is ever spliced into a
       *   filter. `_shared/conflictSearch.pure.ts` holds those rules, and its
       *   spec runs them.
       *
       * The scope is deliberately NOT the whole practice. Party data on a
       * matter this solicitor cannot open is not theirs to read, and returning
       * it as a match would disclose it. Whether a practice-wide check should
       * report hits it cannot show is a decision for the owner. The screen says
       * which matters were searched rather than claiming the practice.
       */
      const { data: parties, error: partiesError } = await supabase
        .from('legal_matter_parties')
        .select('name, organisation')
        .eq('legal_matter_id', loaded.matter.id);
      if (partiesError) throw partiesError;
      const searched = conflictSearchTerms(body.terms, parties || []);
      if (searched.length === 0) {
        return json({
          error: 'Record the parties on this matter before running a conflict check. There is nothing to search for yet.',
          code: 'NO_TERMS',
        }, 422);
      }
      const terms = searched.map(([, term]) => term);

      const scope = await readAccessibleMatterIds(supabase, me.id, me.firm_id, ['matters', 'parties']);
      if (!scope.ok) throw new Error(`The matters to search could not be read: ${scope.error}`);
      const otherMatterIds = scope.ids.filter((id) => id !== loaded.matter.id);

      const matterMap = new Map<string, any>();
      for (let i = 0; i < otherMatterIds.length; i += CONFLICT_ID_CHUNK) {
        const { data: rows, error: mattersError } = await supabase
          .from('legal_matters')
          .select('id, matter_reference, title, status, client_id')
          .in('id', otherMatterIds.slice(i, i + CONFLICT_ID_CHUNK))
          .eq('firm_id', me.firm_id);
        if (mattersError) throw mattersError;
        for (const m of rows || []) matterMap.set(m.id, m);
      }
      const matterIds = Array.from(matterMap.keys());

      const matches: any[] = [];
      for (let i = 0; i < matterIds.length; i += CONFLICT_ID_CHUNK) {
        const chunk = matterIds.slice(i, i + CONFLICT_ID_CHUNK);
        for (let from = 0; ; from += CONFLICT_PAGE) {
          const { data: rows, error: partiesReadError } = await supabase
            .from('legal_matter_parties')
            .select('id, legal_matter_id, name, organisation, role')
            .in('legal_matter_id', chunk)
            .order('id', { ascending: true })
            .range(from, from + CONFLICT_PAGE - 1);
          if (partiesReadError) throw partiesReadError;
          for (const party of rows || []) {
            const hit = conflictHit(searched, party);
            if (!hit) continue;
            const m = matterMap.get(party.legal_matter_id);
            matches.push({
              party_id: party.id,
              party_name: party.name,
              party_organisation: party.organisation,
              party_role: party.role,
              matched_term: hit[1],
              matter_id: party.legal_matter_id,
              matter_reference: m?.matter_reference ?? null,
              matter_title: m?.title ?? null,
              matter_status: m?.status ?? null,
              same_client: m?.client_id === loaded.matter.client_id,
            });
          }
          if ((rows || []).length < CONFLICT_PAGE) break;
        }
      }
      matches.sort((a, b) => Number(b.same_client) - Number(a.same_client)
        || String(a.matter_reference ?? '').localeCompare(String(b.matter_reference ?? ''))
        || String(a.party_name ?? a.party_organisation ?? '').localeCompare(String(b.party_name ?? b.party_organisation ?? '')));

      const mattersSearched = matterIds.length;
      const outcome = conflictOutcome(mattersSearched, matches.length);
      const { data: inserted, error } = await supabase
        .from('legal_conflict_checks')
        .insert({
          legal_matter_id: loaded.matter.id,
          firm_id: me.firm_id ?? null,
          client_id: loaded.matter.client_id,
          searched_terms: terms,
          outcome,
          matches: matches.slice(0, CONFLICT_STORED_MATCHES),
          match_count: matches.length,
          notes: text(body.notes, 2000),
          created_by_type: 'solicitor_user',
          created_by: me.id,
          ...(outcome === 'clear'
            ? { cleared_at: new Date().toISOString(), cleared_by_type: 'solicitor_user', cleared_by_solicitor_user_id: me.id }
            : {}),
        })
        .select('*')
        .maybeSingle();
      if (error) throw error;

      await supabase
        .from('legal_matters')
        .update({ conflict_check_status: outcome, conflict_checked_at: new Date().toISOString() })
        .eq('id', loaded.matter.id);

      await audit(loaded.matter, 'conflict', 'conflict_check_run', {
        severity: outcome === 'potential_conflict' ? 'warning' : outcome === 'pending' ? 'notice' : 'info',
        target_type: 'legal_conflict_check',
        target_id: inserted?.id ?? null,
        metadata: { outcome, match_count: matches.length, term_count: terms.length, matters_searched: mattersSearched },
      });
      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id,
        firm_id: me.firm_id,
        action: 'conflict_check_run',
        client_id: loaded.matter.client_id,
        legal_matter_id: loaded.matter.id,
        entity_type: 'legal_conflict_check',
        entity_id: inserted?.id ?? null,
        metadata: { outcome, match_count: matches.length, matters_searched: mattersSearched },
        ip_address: ip,
        user_agent: userAgent,
      });

      return json({
        success: true,
        record: inserted,
        outcome,
        match_count: matches.length,
        matters_searched: mattersSearched,
      });
    }

    if (operation === 'conflict_clear') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      if (!can(loaded.perms, 'matters', 'edit')) {
        return json({ error: 'You do not have permission to resolve conflict checks' }, 403);
      }
      const checkId = text(body.check_id, 64);
      if (!checkId) return json({ error: 'check_id is required' }, 400);
      const outcome = text(body.outcome, 40) ?? 'clear';
      if (!CONFLICT_OUTCOMES.has(outcome)) return json({ error: 'Unsupported outcome' }, 400);

      const { data: updated, error } = await supabase
        .from('legal_conflict_checks')
        .update({
          outcome,
          notes: text(body.notes, 2000),
          cleared_at: new Date().toISOString(),
          cleared_by_type: 'solicitor_user',
          cleared_by_solicitor_user_id: me.id,
        })
        .eq('id', checkId)
        .eq('legal_matter_id', loaded.matter.id)
        .select('*')
        .maybeSingle();
      if (error) throw error;
      if (!updated) return json({ error: 'Conflict check not found' }, 404);

      await supabase
        .from('legal_matters')
        .update({ conflict_check_status: outcome, conflict_checked_at: new Date().toISOString() })
        .eq('id', loaded.matter.id);

      await audit(loaded.matter, 'conflict', 'conflict_check_resolved', {
        severity: outcome === 'conflict' ? 'critical' : 'notice',
        target_type: 'legal_conflict_check',
        target_id: checkId,
        metadata: { outcome },
      });

      return json({ success: true, record: updated });
    }

    // ───────────────────── CLOSURE & RETENTION ─────────────────────
    if (operation === 'closure_state') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);

      const [{ count: openDates }, { count: openTasks }, { count: unpaidDisb }, { count: openReqs }] =
        await Promise.all([
          supabase.from('legal_matter_critical_dates')
            .select('id', { count: 'exact', head: true })
            .eq('legal_matter_id', loaded.matter.id).neq('status', 'satisfied'),
          supabase.from('legal_matter_settlement_tasks')
            .select('id', { count: 'exact', head: true })
            .eq('legal_matter_id', loaded.matter.id).neq('status', 'complete'),
          supabase.from('legal_matter_disbursements')
            .select('id', { count: 'exact', head: true })
            .eq('legal_matter_id', loaded.matter.id).neq('status', 'paid'),
          supabase.from('legal_matter_requisitions')
            .select('id', { count: 'exact', head: true })
            .eq('legal_matter_id', loaded.matter.id).neq('status', 'answered'),
        ]);

      const blockers: Array<{ code: string; label: string; count: number }> = [];
      if ((openTasks ?? 0) > 0) blockers.push({ code: 'settlement_tasks', label: 'Settlement tasks outstanding', count: openTasks ?? 0 });
      if ((openDates ?? 0) > 0) blockers.push({ code: 'critical_dates', label: 'Critical dates unsatisfied', count: openDates ?? 0 });
      if ((unpaidDisb ?? 0) > 0) blockers.push({ code: 'disbursements', label: 'Disbursements unpaid', count: unpaidDisb ?? 0 });
      if ((openReqs ?? 0) > 0) blockers.push({ code: 'requisitions', label: 'Requisitions unanswered', count: openReqs ?? 0 });
      if (loaded.matter.conflict_check_status === 'not_run') {
        blockers.push({ code: 'conflict_check', label: 'Conflict check never run', count: 1 });
      }

      return json({
        success: true,
        closure: {
          closure_status: loaded.matter.closure_status,
          closure_reason: loaded.matter.closure_reason,
          closure_checklist: loaded.matter.closure_checklist ?? {},
          closed_at: loaded.matter.closed_at,
          retention_class: loaded.matter.retention_class,
          retention_until: loaded.matter.retention_until,
          archived_at: loaded.matter.archived_at,
        },
        checklist_keys: LEGAL_CLOSURE_CHECKLIST_KEYS,
        retention_classes: LEGAL_RETENTION_CLASSES,
        blockers,
      });
    }

    if (operation === 'closure_update') {
      if (!LEGAL_INTEGRITY_COMMANDS_V1) return json({ error: 'Legal mutations are temporarily unavailable' }, 503);
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      if (!can(loaded.perms, 'matters', 'edit')) {
        return json({ error: 'You do not have permission to edit closure details' }, 403);
      }

      const expectedVersion = Number(body.expected_version);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) return json({ error: 'expected_version is required' }, 400);
      const checklist: Record<string, boolean> = { ...(loaded.matter.closure_checklist ?? {}) };
      if (body.checklist && typeof body.checklist === 'object') {
        for (const key of LEGAL_CLOSURE_CHECKLIST_KEYS) {
          if (key in body.checklist) checklist[key] = !!body.checklist[key];
        }
      }
      const patch: Record<string, unknown> = { closure_checklist: checklist };
      const retention = text(body.retention_class, 40);
      if (retention && (LEGAL_RETENTION_CLASSES as readonly string[]).includes(retention)) {
        patch.retention_class = retention;
        patch.retention_until = retentionUntil(
          retention,
          loaded.matter.closed_at ? new Date(loaded.matter.closed_at) : new Date(),
        );
      }
      if (typeof body.closure_reason === 'string') patch.closure_reason = text(body.closure_reason, 1000);

      const { data: updated, error } = await supabase
        .from('legal_matters')
        .update({ ...patch, row_version: expectedVersion + 1, updated_at: new Date().toISOString() })
        .eq('id', loaded.matter.id)
        .eq('row_version', expectedVersion)
        .select('row_version, closure_status, closure_reason, closure_checklist, closed_at, retention_class, retention_until, archived_at')
        .maybeSingle();
      if (error) throw error;
      if (!updated) return json({ error: 'This matter was changed by another user', code: 'STALE_VERSION' }, 409);

      await audit(loaded.matter, 'closure', 'closure_details_updated', {
        metadata: { fields: Object.keys(patch) },
      });

      return json({ success: true, closure: updated });
    }

    if (operation === 'matter_close' || operation === 'matter_reopen') {
      if (!LEGAL_INTEGRITY_COMMANDS_V1) return json({ error: 'Legal mutations are temporarily unavailable' }, 503);
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      if (!can(loaded.perms, 'matters', 'edit')) return json({ error: 'You do not have permission to close or reopen matters' }, 403);
      const expectedVersion = Number(body.expected_version);
      const reason = text(body.reason, 1000);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || !reason) return json({ error: 'expected_version and reason are required' }, 400);

      if (operation === 'matter_reopen') {
        const targetStatus = String(body.target_status || 'pre_settlement');
        const { data, error } = await supabase.rpc('reopen_legal_matter', {
          _matter_id: loaded.matter.id, _expected_version: expectedVersion,
          _target_status: targetStatus, _reason: reason, _actor_solicitor_user_id: me.id,
        });
        if (error) {
          const conflict = /STALE_VERSION|INVALID_REOPEN|MATTER_NOT_CLOSED/.test(error.message || '');
          return json({ error: 'Unable to reopen matter', code: error.message }, conflict ? 409 : 400);
        }
        return json({ success: true, closure: data });
      }

      const retention = text(body.retention_class, 40) ?? loaded.matter.retention_class ?? 'standard_7y';
      if (!(LEGAL_RETENTION_CLASSES as readonly string[]).includes(retention)) return json({ error: 'Unsupported retention class' }, 400);
      const { data, error } = await supabase.rpc('close_legal_matter', {
        _matter_id: loaded.matter.id, _expected_version: expectedVersion,
        _retention_class: retention, _reason: reason, _actor_solicitor_user_id: me.id,
        _actor_staff_user_id: null, _override_authorized: false, _override_category: null,
        _override_step_up_verified_at: null,
      });
      if (error) {
        const conflict = /STALE_VERSION|CLOSURE_BLOCKED|INVALID_CLOSURE_STATUS/.test(error.message || '');
        return json({ error: /CLOSURE_BLOCKED/.test(error.message || '') ? 'Closure blockers must be resolved' : 'Unable to close matter', code: error.message }, conflict ? 409 : 400);
      }
      await logSolicitorActivity(supabase, {
        solicitor_user_id: me.id, firm_id: me.firm_id, action: 'matter_closed',
        client_id: loaded.matter.client_id, legal_matter_id: loaded.matter.id,
        entity_type: 'legal_matter', entity_id: loaded.matter.id,
        metadata: { retention_class: retention, row_version: data?.row_version }, ip_address: ip, user_agent: userAgent,
      });
      return json({ success: true, closure: data });
    }

    // ───────────────────── COMPLIANCE EXPORT ─────────────────────
    if (operation === 'compliance_export') {
      const loaded = await loadMatter(String(body.matter_id || ''));
      if (!loaded.ok) return json({ error: loaded.error }, loaded.status);
      if (!can(loaded.perms, 'audit', 'view')) {
        return json({ error: 'You do not have permission to export the compliance pack' }, 403);
      }

      const matterId = loaded.matter.id;
      const [
        parties, dates, tasks, documents, searches, requisitions, disbursements,
        statusHistory, conflicts, auditEvents,
      ] = await Promise.all([
        supabase.from('legal_matter_parties').select('*').eq('legal_matter_id', matterId),
        supabase.from('legal_matter_critical_dates').select('*').eq('legal_matter_id', matterId),
        supabase.from('legal_matter_settlement_tasks').select('*').eq('legal_matter_id', matterId),
        supabase.from('legal_matter_documents')
          .select('id, category, label, status, owner, file_name, version, uploaded_at, reviewed_at')
          .eq('legal_matter_id', matterId),
        supabase.from('legal_matter_searches').select('*').eq('legal_matter_id', matterId),
        supabase.from('legal_matter_requisitions').select('*').eq('legal_matter_id', matterId),
        supabase.from('legal_matter_disbursements').select('*').eq('legal_matter_id', matterId),
        supabase.from('legal_matter_status_history').select('*').eq('legal_matter_id', matterId),
        supabase.from('legal_conflict_checks').select('*').eq('legal_matter_id', matterId),
        supabase.from('legal_matter_audit_events').select(LEGAL_AUDIT_SELECT)
          .eq('legal_matter_id', matterId).order('created_at', { ascending: true }).limit(2000),
      ]);

      const verification = await verifyLegalAuditChain(supabase, matterId);

      const sections = {
        matter: loaded.matter,
        parties: parties.data || [],
        critical_dates: dates.data || [],
        settlement_tasks: tasks.data || [],
        documents: documents.data || [],
        searches: searches.data || [],
        requisitions: requisitions.data || [],
        disbursements: disbursements.data || [],
        status_history: statusHistory.data || [],
        conflict_checks: conflicts.data || [],
        audit_events: auditEvents.data || [],
      };
      const section_counts = Object.fromEntries(
        Object.entries(sections).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1]),
      );

      const { data: exportRow } = await supabase
        .from('legal_compliance_exports')
        .insert({
          legal_matter_id: matterId,
          firm_id: me.firm_id ?? null,
          client_id: loaded.matter.client_id,
          export_scope: text(body.scope, 40) ?? 'full',
          format: 'json',
          section_counts,
          chain_verified: verification.verified,
          chain_broken_at: verification.broken_at,
          requested_by_type: 'solicitor_user',
          requested_by_solicitor_user_id: me.id,
          ip_address: ip,
        })
        .select('id, created_at')
        .maybeSingle();

      await audit(loaded.matter, 'export', 'compliance_pack_exported', {
        severity: 'notice',
        target_type: 'legal_compliance_export',
        target_id: exportRow?.id ?? null,
        metadata: { section_counts, chain_verified: verification.verified },
      });

      return json({
        success: true,
        export: {
          id: exportRow?.id ?? null,
          generated_at: exportRow?.created_at ?? new Date().toISOString(),
          generated_by: me.name || me.email,
          firm_id: me.firm_id,
          chain_verification: verification,
          section_counts,
          sections,
        },
      });
    }

    // ───────────────────── FIRM COMPLIANCE HEALTH ─────────────────────
    if (operation === 'compliance_health') {
      if (!accessibleMatterIds.length) {
        return json({ success: true, health: { matters: 0, signals: [] } });
      }
      const { data: matters } = await supabase
        .from('legal_matters')
        .select('id, matter_reference, title, status, closure_status, retention_until, conflict_check_status, settlement_date, actual_settlement_date')
        .in('id', accessibleMatterIds)
        .eq('firm_id', me.firm_id)
        .limit(500);

      const rows = matters || [];
      const today = new Date().toISOString().slice(0, 10);
      const signals = [
        {
          code: 'conflict_not_run',
          label: 'Conflict check never run',
          severity: 'high',
          matters: rows.filter((m: any) => m.conflict_check_status === 'not_run').map((m: any) => m.id),
        },
        {
          code: 'conflict_open',
          label: 'Unresolved conflict flagged',
          severity: 'critical',
          matters: rows.filter((m: any) => ['potential_conflict', 'conflict'].includes(m.conflict_check_status)).map((m: any) => m.id),
        },
        {
          code: 'settled_not_closed',
          label: 'Settled but file not closed',
          severity: 'medium',
          matters: rows.filter((m: any) => m.actual_settlement_date && m.closure_status === 'open').map((m: any) => m.id),
        },
        {
          code: 'retention_expired',
          label: 'Retention period elapsed — review for destruction',
          severity: 'medium',
          matters: rows.filter((m: any) => m.retention_until && m.retention_until < today).map((m: any) => m.id),
        },
      ].filter((s) => s.matters.length > 0);

      return json({
        success: true,
        health: {
          matters: rows.length,
          open: rows.filter((m: any) => m.closure_status === 'open').length,
          closed: rows.filter((m: any) => m.closure_status === 'closed').length,
          archived: rows.filter((m: any) => m.closure_status === 'archived').length,
          conflict_clear: rows.filter((m: any) => m.conflict_check_status === 'clear').length,
          signals,
          index: rows.map((m: any) => ({ id: m.id, matter_reference: m.matter_reference, title: m.title })),
        },
      });
    }

    return json({ error: `Unsupported operation: ${operation}` }, 400);
  } catch (error) {
    console.error('[solicitor-portal-compliance] error:', error);
    return json({ ...internalError(error, 'solicitor-portal-compliance') }, 500);
  }
});
