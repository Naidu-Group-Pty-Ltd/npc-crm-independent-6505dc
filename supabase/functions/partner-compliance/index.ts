/**
 * Phase 6 — Partner Compliance Hardening
 *
 * Command Centre surface for:
 *  · hash-chained compliance audit trail (agreements / referrals / consent / undertakings / banking)
 *  · privacy incident register with notification deadlines
 *  · records retention register (holds, destruction)
 *  · termination handling with accrued-entitlement snapshots
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { internalError } from '../_shared/errorResponse.ts';
import {
  recordPartnerAudit,
  verifyPartnerAuditChain,
  partnerRequestFingerprint,
} from '../_shared/partnerAudit.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const INCIDENTS = 'partner_privacy_incidents';
const AGREEMENTS = 'partner_agreements';

const INCIDENT_STATUSES = new Set([
  'open', 'under_assessment', 'notifiable', 'not_notifiable', 'notified', 'closed',
]);
const INCIDENT_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const INCIDENT_TYPES = new Set([
  'unauthorised_disclosure', 'unauthorised_access', 'data_loss', 'misdirected_communication',
  'system_compromise', 'boundary_breach', 'other',
]);

const INCIDENT_WRITABLE = [
  'agreement_id', 'finance_agent_contact_id', 'referral_id', 'direction',
  'incident_type', 'severity', 'reported_by_party', 'discovered_at', 'occurred_at',
  'notification_deadline_at', 'assessment_due_at', 'title', 'description',
  'affected_data_categories', 'affected_individual_count', 'containment_actions',
  'remediation_actions', 'root_cause', 'is_notifiable', 'notifiable_assessment_note',
  'regulator_reference',
] as const;

function json(body: unknown, corsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function sanitizeIncident(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const key of INCIDENT_WRITABLE) {
    if (!(key in input)) continue;
    let value = input[key];
    if (value === '' || value === undefined) value = null;
    if (key === 'affected_individual_count' && value !== null) {
      const n = parseInt(String(value), 10);
      value = Number.isFinite(n) ? n : 0;
    }
    if (key === 'affected_data_categories' && value !== null && !Array.isArray(value)) {
      value = String(value).split(',').map((s) => s.trim()).filter(Boolean);
    }
    out[key] = value;
  }
  if (out.severity && !INCIDENT_SEVERITIES.has(String(out.severity))) delete out.severity;
  if (out.incident_type && !INCIDENT_TYPES.has(String(out.incident_type))) out.incident_type = 'other';
  return out;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();

    const authResult = await verifyAuth(supabase, req.headers, body);
    if (authResult.error) return createUnauthorizedResponse(authResult.error, corsHeaders);

    const actorId = authResult.userId ?? null;
    const actorLabel = authResult.username ?? null;
    const fp = partnerRequestFingerprint(req);
    const { action } = body;

    // ───────────────────────── AUDIT TRAIL ─────────────────────────
    if (action === 'audit_timeline') {
      let q = supabase
        .from('partner_compliance_audit_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(Math.min(Number(body.limit) || 250, 1000));

      if (body.agreement_id) q = q.eq('agreement_id', body.agreement_id);
      if (body.referral_id) q = q.eq('referral_id', body.referral_id);
      if (body.scope_type) q = q.eq('scope_type', body.scope_type);
      if (body.category) q = q.eq('category', body.category);
      if (body.severity) q = q.eq('severity', body.severity);
      if (body.since) q = q.gte('created_at', body.since);

      const { data, error } = await q;
      if (error) throw error;
      return json({ events: data ?? [] }, corsHeaders);
    }

    if (action === 'audit_verify') {
      const chainKey = body.agreement_id || body.chain_key || 'global';
      const result = await verifyPartnerAuditChain(supabase, chainKey);
      return json({ chain_key: chainKey, ...result }, corsHeaders);
    }

    if (action === 'audit_record') {
      // Allows other Command Centre surfaces to append compliance events.
      if (!body.event_action) return json({ error: 'event_action_required' }, corsHeaders, 400);
      await recordPartnerAudit(supabase, {
        agreement_id: body.agreement_id ?? null,
        referral_id: body.referral_id ?? null,
        scope_type: body.scope_type || 'system',
        scope_id: body.scope_id ?? null,
        actor_id: actorId,
        actor_label: actorLabel,
        severity: body.severity,
        category: body.category,
        action: String(body.event_action).slice(0, 120),
        target_type: body.target_type ?? null,
        target_id: body.target_id ?? null,
        description: body.description ?? null,
        metadata: body.metadata ?? {},
        ...fp,
      });
      return json({ success: true }, corsHeaders);
    }

    // ─────────────────────── PRIVACY INCIDENTS ─────────────────────
    if (action === 'incident_list') {
      let q = supabase.from(INCIDENTS).select('*').order('discovered_at', { ascending: false });
      if (body.status && INCIDENT_STATUSES.has(body.status)) q = q.eq('status', body.status);
      if (body.agreement_id) q = q.eq('agreement_id', body.agreement_id);
      if (body.severity) q = q.eq('severity', body.severity);
      const { data, error } = await q;
      if (error) throw error;
      return json({ incidents: data ?? [] }, corsHeaders);
    }

    if (action === 'incident_create') {
      const payload = sanitizeIncident(body.data || {});
      if (!payload.title || String(payload.title).trim().length < 3) {
        return json({ error: 'title_required' }, corsHeaders, 400);
      }
      const { data, error } = await supabase
        .from(INCIDENTS)
        .insert({ ...payload, created_by: actorId })
        .select('*')
        .single();
      if (error) throw error;

      await recordPartnerAudit(supabase, {
        agreement_id: data.agreement_id,
        scope_type: 'incident',
        scope_id: data.id,
        actor_id: actorId,
        actor_label: actorLabel,
        severity: data.severity === 'critical' ? 'critical' : 'warn',
        category: 'privacy',
        action: 'privacy_incident_logged',
        target_type: 'privacy_incident',
        target_id: data.id,
        description: `Privacy incident ${data.reference} logged: ${data.title}`,
        metadata: { incident_type: data.incident_type, severity: data.severity },
        ...fp,
      });
      return json({ incident: data }, corsHeaders);
    }

    if (action === 'incident_update') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const payload = sanitizeIncident(body.data || {});
      if (body.data?.status && INCIDENT_STATUSES.has(body.data.status)) {
        payload.status = body.data.status;
      }
      const { data, error } = await supabase
        .from(INCIDENTS).update(payload).eq('id', id).select('*').single();
      if (error) throw error;

      await recordPartnerAudit(supabase, {
        agreement_id: data.agreement_id,
        scope_type: 'incident',
        scope_id: data.id,
        actor_id: actorId,
        actor_label: actorLabel,
        category: 'privacy',
        action: 'privacy_incident_updated',
        target_type: 'privacy_incident',
        target_id: data.id,
        fields_touched: Object.keys(payload),
        description: `Privacy incident ${data.reference} updated`,
        ...fp,
      });
      return json({ incident: data }, corsHeaders);
    }

    if (action === 'incident_notify') {
      const { id, party } = body;
      if (!id || !['partner', 'individuals', 'regulator'].includes(party)) {
        return json({ error: 'id_and_valid_party_required' }, corsHeaders, 400);
      }
      const column =
        party === 'partner' ? 'notified_partner_at'
        : party === 'individuals' ? 'notified_individuals_at'
        : 'notified_regulator_at';

      const patch: Record<string, unknown> = { [column]: new Date().toISOString() };
      if (party === 'regulator' && body.regulator_reference) {
        patch.regulator_reference = String(body.regulator_reference).slice(0, 200);
      }
      patch.status = 'notified';

      const { data, error } = await supabase
        .from(INCIDENTS).update(patch).eq('id', id).select('*').single();
      if (error) throw error;

      await recordPartnerAudit(supabase, {
        agreement_id: data.agreement_id,
        scope_type: 'incident',
        scope_id: data.id,
        actor_id: actorId,
        actor_label: actorLabel,
        severity: 'notice',
        category: 'privacy',
        action: `privacy_incident_notified_${party}`,
        target_type: 'privacy_incident',
        target_id: data.id,
        description: `Notification recorded for ${party} on ${data.reference}`,
        ...fp,
      });
      return json({ incident: data }, corsHeaders);
    }

    if (action === 'incident_close') {
      const { id, closure_note } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: existing } = await supabase
        .from(INCIDENTS).select('is_notifiable, notified_partner_at, reference, agreement_id').eq('id', id).maybeSingle();
      if (!existing) return json({ error: 'not_found' }, corsHeaders, 404);
      if (existing.is_notifiable === true && !existing.notified_partner_at && body.override !== true) {
        return json({
          error: 'Incident is assessed as notifiable but the partner has not been notified — record the notification or pass override',
        }, corsHeaders, 409);
      }

      const { data, error } = await supabase
        .from(INCIDENTS)
        .update({
          status: 'closed',
          closed_at: new Date().toISOString(),
          closed_by: actorId,
          closure_note: closure_note || null,
        })
        .eq('id', id).select('*').single();
      if (error) throw error;

      await recordPartnerAudit(supabase, {
        agreement_id: data.agreement_id,
        scope_type: 'incident',
        scope_id: data.id,
        actor_id: actorId,
        actor_label: actorLabel,
        severity: 'notice',
        category: 'privacy',
        action: 'privacy_incident_closed',
        target_type: 'privacy_incident',
        target_id: data.id,
        description: `Privacy incident ${data.reference} closed`,
        metadata: { override: body.override === true },
        ...fp,
      });
      return json({ incident: data }, corsHeaders);
    }

    // ───────────────────────── RETENTION ───────────────────────────
    if (action === 'retention_register') {
      let q = supabase
        .from('partner_agreement_retention_register')
        .select('*')
        .order('retention_until', { ascending: true });
      if (body.retention_state) q = q.eq('retention_state', body.retention_state);
      const { data, error } = await q;
      if (error) throw error;
      return json({ records: data ?? [] }, corsHeaders);
    }

    if (action === 'retention_set_hold') {
      const { id, hold, reason } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data, error } = await supabase
        .from(AGREEMENTS)
        .update({
          retention_hold: !!hold,
          retention_hold_reason: hold ? (reason || null) : null,
          retention_hold_set_at: hold ? new Date().toISOString() : null,
          updated_by: actorId,
        })
        .eq('id', id).select('id, retention_hold, retention_hold_reason, retention_until').single();
      if (error) throw error;

      await recordPartnerAudit(supabase, {
        agreement_id: id,
        scope_type: 'retention',
        scope_id: id,
        actor_id: actorId,
        actor_label: actorLabel,
        severity: 'notice',
        category: 'retention',
        action: hold ? 'retention_hold_applied' : 'retention_hold_released',
        target_type: 'partner_agreement',
        target_id: id,
        description: hold ? `Legal hold applied: ${reason || 'no reason given'}` : 'Legal hold released',
        ...fp,
      });
      return json({ agreement: data }, corsHeaders);
    }

    if (action === 'retention_mark_destroyed') {
      const { id, note } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: rec } = await supabase
        .from('partner_agreement_retention_register')
        .select('retention_state, retention_hold, retention_until')
        .eq('id', id).maybeSingle();
      if (!rec) return json({ error: 'not_found' }, corsHeaders, 404);
      if (rec.retention_hold) {
        return json({ error: 'Agreement is under legal hold — release the hold before recording destruction' }, corsHeaders, 409);
      }
      if (rec.retention_state !== 'eligible_for_destruction' && body.override !== true) {
        return json({
          error: `Retention period has not elapsed (ends ${rec.retention_until}) — pass override to record early destruction`,
        }, corsHeaders, 409);
      }

      const { data, error } = await supabase
        .from(AGREEMENTS)
        .update({ destroyed_at: new Date().toISOString(), destruction_note: note || null, updated_by: actorId })
        .eq('id', id).select('id, destroyed_at, destruction_note').single();
      if (error) throw error;

      await recordPartnerAudit(supabase, {
        agreement_id: id,
        scope_type: 'retention',
        scope_id: id,
        actor_id: actorId,
        actor_label: actorLabel,
        severity: 'warn',
        category: 'retention',
        action: 'records_destruction_recorded',
        target_type: 'partner_agreement',
        target_id: id,
        description: note || 'Records destruction recorded',
        metadata: { override: body.override === true },
        retention_class: 'extended_10y',
        ...fp,
      });
      return json({ agreement: data }, corsHeaders);
    }

    // ─────────────────────── TERMINATION ───────────────────────────
    if (action === 'termination_preview') {
      const { id } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: agreement } = await supabase
        .from(AGREEMENTS)
        .select('id, status, direction, partner_legal_name, termination_notice_days, post_termination_entitlement, finance_agent_contact_id, effective_date')
        .eq('id', id).maybeSingle();
      if (!agreement) return json({ error: 'not_found' }, corsHeaders, 404);

      const { data: accrued, error: accErr } = await supabase
        .rpc('partner_accrued_entitlements', { _agreement_id: id });
      if (accErr) throw accErr;

      const { count: referralCount } = await supabase
        .from('partner_referrals')
        .select('id', { count: 'exact', head: true })
        .eq('agreement_id', id)
        .not('status', 'in', '("settled","closed","declined","withdrawn")');

      return json({
        agreement,
        accrued: (accrued || [])[0] || null,
        open_referrals: referralCount ?? 0,
      }, corsHeaders);
    }

    if (action === 'termination_execute') {
      const { id, termination_reason, termination_effective_date, post_termination_cutoff_date, notice_given_at } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      if (!termination_reason || String(termination_reason).trim().length < 3) {
        return json({ error: 'termination_reason_required' }, corsHeaders, 400);
      }

      const { data: agreement } = await supabase
        .from(AGREEMENTS).select('id, status').eq('id', id).maybeSingle();
      if (!agreement) return json({ error: 'not_found' }, corsHeaders, 404);
      if (agreement.status !== 'active') {
        return json({ error: `Only active agreements can be terminated (current: ${agreement.status})` }, corsHeaders, 409);
      }

      const { data: accruedRows } = await supabase.rpc('partner_accrued_entitlements', { _agreement_id: id });
      const snapshot = (accruedRows || [])[0] || {};

      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from(AGREEMENTS)
        .update({
          status: 'terminated',
          terminated_at: nowIso,
          terminated_by: actorId,
          termination_reason: String(termination_reason).slice(0, 2000),
          termination_notice_given_at: notice_given_at || nowIso,
          termination_effective_date: termination_effective_date || nowIso.slice(0, 10),
          post_termination_cutoff_date: post_termination_cutoff_date || null,
          accrued_entitlements_snapshot: { ...snapshot, captured_at: nowIso },
          updated_by: actorId,
        })
        .eq('id', id).select('*').single();
      if (error) throw error;

      await supabase.from('partner_agreement_events').insert({
        agreement_id: id,
        event_type: 'terminated',
        actor_id: actorId,
        actor_label: actorLabel,
        summary: `Agreement terminated — ${String(termination_reason).slice(0, 160)}`,
        payload: { accrued: snapshot, effective: data.termination_effective_date },
      });

      await recordPartnerAudit(supabase, {
        agreement_id: id,
        scope_type: 'termination',
        scope_id: id,
        actor_id: actorId,
        actor_label: actorLabel,
        severity: 'critical',
        category: 'lifecycle',
        action: 'agreement_terminated',
        target_type: 'partner_agreement',
        target_id: id,
        description: String(termination_reason).slice(0, 500),
        metadata: { accrued: snapshot, retention_until: data.retention_until },
        retention_class: 'extended_10y',
        ...fp,
      });

      return json({ agreement: data, accrued: snapshot }, corsHeaders);
    }

    if (action === 'termination_resolve_entitlements') {
      const { id, note } = body;
      if (!id) return json({ error: 'id_required' }, corsHeaders, 400);
      const { data: accruedRows } = await supabase.rpc('partner_accrued_entitlements', { _agreement_id: id });
      const snapshot = (accruedRows || [])[0] || {};
      const outstanding =
        Number(snapshot.pending_commission_count || 0) +
        Number(snapshot.unpaid_statement_count || 0) +
        Number(snapshot.open_clawback_count || 0);

      if (outstanding > 0 && body.override !== true) {
        return json({
          error: 'Accrued entitlements are still outstanding — settle them or pass override',
          accrued: snapshot,
        }, corsHeaders, 409);
      }

      const { data, error } = await supabase
        .from(AGREEMENTS)
        .update({ accrued_entitlements_resolved_at: new Date().toISOString(), updated_by: actorId })
        .eq('id', id).select('id, accrued_entitlements_resolved_at').single();
      if (error) throw error;

      await recordPartnerAudit(supabase, {
        agreement_id: id,
        scope_type: 'termination',
        scope_id: id,
        actor_id: actorId,
        actor_label: actorLabel,
        severity: 'notice',
        category: 'lifecycle',
        action: 'accrued_entitlements_resolved',
        target_type: 'partner_agreement',
        target_id: id,
        description: note || 'Post-termination entitlements marked resolved',
        metadata: { accrued: snapshot, override: body.override === true },
        ...fp,
      });
      return json({ agreement: data }, corsHeaders);
    }

    // ───────────────────────── OVERVIEW ────────────────────────────
    if (action === 'overview') {
      const [incidents, retention, chain] = await Promise.all([
        supabase.from(INCIDENTS).select('status, severity, is_notifiable, notification_deadline_at, notified_partner_at, closed_at'),
        supabase.from('partner_agreement_retention_register').select('retention_state, retention_hold'),
        verifyPartnerAuditChain(supabase, 'global'),
      ]);

      const inc = incidents.data || [];
      const ret = retention.data || [];
      const now = Date.now();

      return json({
        incidents: {
          total: inc.length,
          open: inc.filter((i: any) => i.status !== 'closed').length,
          notifiable: inc.filter((i: any) => i.is_notifiable === true).length,
          overdue_notifications: inc.filter((i: any) =>
            i.is_notifiable === true && !i.notified_partner_at &&
            i.notification_deadline_at && new Date(i.notification_deadline_at).getTime() < now).length,
        },
        retention: {
          total: ret.length,
          eligible_for_destruction: ret.filter((r: any) => r.retention_state === 'eligible_for_destruction').length,
          expiring_soon: ret.filter((r: any) => r.retention_state === 'expiring_soon').length,
          legal_hold: ret.filter((r: any) => r.retention_hold).length,
          destroyed: ret.filter((r: any) => r.retention_state === 'destroyed').length,
        },
        global_chain: chain,
      }, corsHeaders);
    }

    return json({ error: 'unknown_action' }, corsHeaders, 400);
  } catch (err) {
    console.error('[partner-compliance] error', err);
    return json({ ...internalError(err, 'partner-compliance') }, createCorsHeaders(origin), 500);
  }
});
