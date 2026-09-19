/**
 * Finance Portal — Batch 6 (Client-Facing Polish)
 *
 * Single edge function covering features #34, #35, #36, #37:
 *   #34  Onboarding checklist (client + broker visible, joint progress)
 *   #35  Escalating auto-reminders for outstanding document requirements
 *   #36  Multi-applicant / co-borrower support per Purchase File
 *   #37  Self-service booking + finance partner availability windows
 *
 * Auth: finance partner via x-finance-session-token (mirrors finance-portal-client-tasks).
 * Cron auth: `reminders_run_due` takes either the dedicated cron secret
 * (`x-cron-secret` = FINANCE_PORTAL_CRON_SECRET) or the signed internal envelope
 * from pg_cron — no partner token. The schedule that calls it moved onto
 * `cron_invoke_signed_function`, which sends the envelope and no secret header,
 * so a function that accepted only the header answered 401 to every tick.
 *
 * Operations
 *  applicants_list         { purchase_file_id }
 *  applicants_upsert       { purchase_file_id, applicant }              // applicant.id present = update
 *  applicants_delete       { applicant_id }
 *
 *  onboarding_list         { purchase_file_id }
 *  onboarding_seed         { purchase_file_id, preset? }                 // seeds default ~12-step template, idempotent
 *  onboarding_upsert       { purchase_file_id, step }                    // step.id present = update
 *  onboarding_set_status   { step_id, status }
 *  onboarding_delete       { step_id }
 *
 *  availability_list       { finance_user_id? }                          // defaults to caller
 *  availability_upsert     { window }                                    // window.id = update
 *  availability_delete     { window_id }
 *
 *  bookings_list           { from?, to? }                                // caller's bookings
 *  bookings_create         { purchase_file_id?, client_id?, start_at, end_at, ... }
 *  bookings_update         { booking_id, payload }
 *  bookings_cancel         { booking_id, reason? }
 *
 *  reminders_configure     { instance_id, auto_reminder_enabled, due_date? }
 *  reminders_run_due       (cron) — escalates gentle → firm → broker_notified for stale doc requests
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.55.0";
import {
  canAccessFinanceClient,
} from '../_shared/financePortalObjectAuthz.ts';
import { hasFinancePortalPermission, type FinancePortalPermissionAction } from '../_shared/finance-portal-permissions.ts';
import { constantTimeEqual, verifyInternal } from '../_shared/auth_v2.ts';

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceCredential } from '../_shared/financeSessionToken.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const APPLICANT_COLS = ['display_name','role','email','phone','date_of_birth','is_primary','position','metadata'];
const STEP_COLS = ['step_key','label','description','category','owner','status','position','visible_to_client','metadata'];
const AVAIL_COLS = ['weekday','start_time','end_time','slot_duration_min','timezone','is_active'];
const BOOKING_COLS = ['purchase_file_id','client_id','start_at','end_at','timezone','meeting_type','meeting_url','topic','notes','contact_email','contact_name','status','cancelled_reason','metadata'];

const DEFAULT_ONBOARDING = [
  { step_key: 'intake_form',        label: 'Complete intake form',                category: 'general',        owner: 'client',  position: 1 },
  { step_key: 'consent_credit',     label: 'Sign credit guide & privacy consent', category: 'consents',       owner: 'client',  position: 2 },
  { step_key: 'id_verification',    label: 'Verify identity (VOI)',               category: 'compliance',     owner: 'client',  position: 3 },
  { step_key: 'income_docs',        label: 'Upload income documents (payslips, tax returns)', category: 'docs', owner: 'client', position: 4 },
  { step_key: 'liability_docs',     label: 'Upload bank statements & liability statements',   category: 'docs', owner: 'client', position: 5 },
  { step_key: 'deposit_evidence',   label: 'Provide deposit / equity evidence',   category: 'docs',           owner: 'client',  position: 6 },
  { step_key: 'property_contract',  label: 'Share Contract of Sale (when available)', category: 'property',  owner: 'client',  position: 7 },
  { step_key: 'borrowing_review',   label: 'Borrowing capacity reviewed',         category: 'finance',        owner: 'broker',  position: 8 },
  { step_key: 'lender_strategy',    label: 'Lender strategy agreed',              category: 'finance',        owner: 'shared',  position: 9 },
  { step_key: 'application_lodged', label: 'Application lodged with lender',      category: 'finance',        owner: 'broker',  position: 10 },
  { step_key: 'conditions_cleared', label: 'Lender conditions cleared',           category: 'finance',        owner: 'broker',  position: 11 },
  { step_key: 'settlement_ready',   label: 'Ready for settlement',                category: 'finance',        owner: 'broker',  position: 12 },
];

function jsonWithHeaders(d: unknown, responseCorsHeaders: Record<string, string>, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' } });
}
function pick(payload: any, allow: string[]) {
  const out: Record<string, any> = {};
  if (!payload || typeof payload !== 'object') return out;
  for (const k of allow) if (k in payload) out[k] = payload[k];
  return out;
}
async function isCronCall(req: Request, supabase: SupabaseClient, rawBody: string): Promise<boolean> {
  const configured = Deno.env.get('FINANCE_PORTAL_CRON_SECRET') ?? '';
  const presented = req.headers.get('x-cron-secret') ?? '';
  if (
    configured.length >= 16
    && presented.length === configured.length
    && constantTimeEqual(configured, presented)
  ) return true;
  // The signed envelope, restricted to pg_cron — the same `verifyInternal`
  // the rest of the platform uses, checked only when the header is present,
  // so an unsigned request still gets the identical 401 it always did.
  if (req.headers.get('x-internal-signature')) {
    const ctx = await verifyInternal(supabase, req, rawBody, { allowedCallers: ['pg_cron'] });
    return ctx.ok === true && ctx.authType === 'internal_service';
  }
  return false;
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const json = (data: any, status = 200) => jsonWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // Read the body ONCE: the signed envelope is verified over the exact
    // bytes, so it cannot be re-read after `req.json()`.
    const rawBody = await req.text();
    let body: any = {};
    try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }
    const operation = body.operation as string | undefined;
    if (!operation) return json({ error: 'operation required' }, 400);

    /* ── reminders cron — no partner session required ── */
    if (operation === 'reminders_run_due') {
      if (!(await isCronCall(req, supabase, rawBody))) return json({ error: 'Cron auth required' }, 401);
      return await runRemindersDue(supabase, json);
    }

    /* ── partner auth for everything else ── */
    // The session may arrive in the HttpOnly `__Host-finance_session_token`
    // cookie, which is the only place the client has it from the second page
    // view onwards. A cookie is ambient on cross-site requests (SameSite=None),
    // so honouring one requires the origin allow-list; a header or body
    // credential cannot be forged cross-site and stays unguarded.
    // See docs/agreements/PARTNER_SESSION_TRANSPORT.md.
    const credential = extractFinanceCredential(req.headers, body);
    if (credential.source === 'cookie') {
      const csrf = enforceCsrf(req);
      if (!csrf.ok) return csrfDenied(corsHeaders, csrf);
    }
    const token = credential.token;
    if (!token) return json({ error: 'Finance session token required' }, 401);
    const { data: portalUser } = await supabase.from('finance_portal_users')
      .select('id, email, is_active, revoked_at, session_expires_at, global_permissions')
      .eq('session_token', token).maybeSingle();
    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) return json({ error: 'Invalid session' }, 401);
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) return json({ error: 'Session expired' }, 401);

    const requireFileAccess = async (purchaseFileId: string, action: 'view' | 'edit' | 'delete') =>
      canAccessPurchaseFile(
        supabase, portalUser.id, purchaseFileId,
        portalUser.global_permissions, 'purchase_files', action,
      );
    const requireResourceAccess = async (
      table: string,
      resourceId: string,
      action: 'view' | 'edit' | 'delete',
      permissionKey = 'purchase_files',
    ) => canAccessPurchaseFileResource(
      supabase, portalUser.id, table, resourceId,
      portalUser.global_permissions, permissionKey, action,
    );
    const requireBookingAssociationAccess = async (purchaseFileId?: string | null, clientId?: string | null) => {
      if (purchaseFileId) {
        if (!await requireFileAccess(purchaseFileId, 'edit')) return false;
        if (!clientId) return true;
        const { data: matchingFile, error } = await supabase.from('purchase_files')
          .select('id').eq('id', purchaseFileId).eq('client_id', clientId).maybeSingle();
        return !error && !!matchingFile;
      }
      return !clientId || canAccessFinanceClient(
        supabase, portalUser.id, clientId, null,
        portalUser.global_permissions, 'purchase_files', 'edit',
      );
    };

    /* ===== Applicants ===== */
    if (operation === 'applicants_list') {
      const fid = body.purchase_file_id;
      if (!fid) return json({ error: 'purchase_file_id required' }, 400);
      if (!await requireFileAccess(fid, 'view')) return json({ error: 'Not authorised' }, 403);
      const { data, error } = await supabase.from('purchase_file_applicants')
        .select('*').eq('purchase_file_id', fid).order('position').order('created_at');
      if (error) return json({ error: error.message }, 500);
      return json({ applicants: data || [] });
    }
    if (operation === 'applicants_upsert') {
      const fid = body.purchase_file_id;
      const applicant = body.applicant || {};
      if (!fid || !applicant.display_name) return json({ error: 'purchase_file_id and display_name required' }, 400);
      if (!await requireFileAccess(fid, 'edit')) return json({ error: 'Not authorised' }, 403);
      const insert = pick(applicant, APPLICANT_COLS);
      if (applicant.id) {
        const { data, error } = await supabase.from('purchase_file_applicants')
          .update({ ...insert, updated_at: new Date().toISOString() })
          .eq('id', applicant.id).eq('purchase_file_id', fid).select().single();
        if (error) return json({ error: error.message }, 500);
        return json({ applicant: data });
      }
      const { data, error } = await supabase.from('purchase_file_applicants')
        .insert({ ...insert, purchase_file_id: fid }).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ applicant: data });
    }
    if (operation === 'applicants_delete') {
      const id = body.applicant_id;
      if (!id) return json({ error: 'applicant_id required' }, 400);
      if (!await requireResourceAccess('purchase_file_applicants', id, 'delete')) return json({ error: 'Not authorised' }, 403);
      const { error } = await supabase.from('purchase_file_applicants').delete().eq('id', id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    /* ===== Onboarding checklist ===== */
    if (operation === 'onboarding_list') {
      const fid = body.purchase_file_id;
      if (!fid) return json({ error: 'purchase_file_id required' }, 400);
      if (!await requireFileAccess(fid, 'view')) return json({ error: 'Not authorised' }, 403);
      const { data, error } = await supabase.from('purchase_file_onboarding_checklist')
        .select('*').eq('purchase_file_id', fid).order('position').order('created_at');
      if (error) return json({ error: error.message }, 500);
      return json({ steps: data || [] });
    }
    if (operation === 'onboarding_seed') {
      const fid = body.purchase_file_id;
      if (!fid) return json({ error: 'purchase_file_id required' }, 400);
      if (!await requireFileAccess(fid, 'edit')) return json({ error: 'Not authorised' }, 403);
      const { data: pf } = await supabase.from('purchase_files').select('client_id').eq('id', fid).maybeSingle();
      const rows = DEFAULT_ONBOARDING.map(s => ({
        purchase_file_id: fid, client_id: pf?.client_id ?? null,
        step_key: s.step_key, label: s.label, category: s.category, owner: s.owner, position: s.position,
        visible_to_client: true, status: 'pending',
      }));
      const { data, error } = await supabase.from('purchase_file_onboarding_checklist')
        .upsert(rows, { onConflict: 'purchase_file_id,step_key', ignoreDuplicates: true })
        .select();
      if (error) return json({ error: error.message }, 500);
      return json({ seeded: data?.length ?? 0 });
    }
    if (operation === 'onboarding_upsert') {
      const fid = body.purchase_file_id;
      const step = body.step || {};
      if (!fid || !step.label || !step.step_key) return json({ error: 'purchase_file_id, step_key and label required' }, 400);
      if (!await requireFileAccess(fid, 'edit')) return json({ error: 'Not authorised' }, 403);
      const insert = pick(step, STEP_COLS);
      if (step.id) {
        const { data, error } = await supabase.from('purchase_file_onboarding_checklist')
          .update({ ...insert, updated_at: new Date().toISOString() })
          .eq('id', step.id).eq('purchase_file_id', fid).select().single();
        if (error) return json({ error: error.message }, 500);
        return json({ step: data });
      }
      const { data: pf } = await supabase.from('purchase_files').select('client_id').eq('id', fid).maybeSingle();
      const { data, error } = await supabase.from('purchase_file_onboarding_checklist')
        .insert({ ...insert, purchase_file_id: fid, client_id: pf?.client_id ?? null })
        .select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ step: data });
    }
    if (operation === 'onboarding_set_status') {
      const id = body.step_id;
      const status = body.status;
      if (!id || !status) return json({ error: 'step_id and status required' }, 400);
      if (!await requireResourceAccess('purchase_file_onboarding_checklist', id, 'edit')) return json({ error: 'Not authorised' }, 403);
      const patch: any = { status, updated_at: new Date().toISOString() };
      if (status === 'complete') {
        patch.completed_at = new Date().toISOString();
        patch.completed_by = portalUser.email || portalUser.id;
      } else { patch.completed_at = null; patch.completed_by = null; }
      const { data, error } = await supabase.from('purchase_file_onboarding_checklist')
        .update(patch).eq('id', id).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ step: data });
    }
    if (operation === 'onboarding_delete') {
      const id = body.step_id;
      if (!id) return json({ error: 'step_id required' }, 400);
      if (!await requireResourceAccess('purchase_file_onboarding_checklist', id, 'delete')) return json({ error: 'Not authorised' }, 403);
      const { error } = await supabase.from('purchase_file_onboarding_checklist').delete().eq('id', id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    /* ===== Availability ===== */
    if (operation === 'availability_list') {
      const uid = body.finance_user_id || portalUser.id;
      const { data, error } = await supabase.from('finance_partner_availability')
        .select('*').eq('finance_user_id', uid).order('weekday').order('start_time');
      if (error) return json({ error: error.message }, 500);
      return json({ windows: data || [] });
    }
    if (operation === 'availability_upsert') {
      const w = body.window || {};
      if (w.weekday == null || !w.start_time || !w.end_time) return json({ error: 'weekday, start_time, end_time required' }, 400);
      if (!Number.isInteger(w.slot_duration_min) || w.slot_duration_min < 1 || w.slot_duration_min > 32767) {
        return json({ error: 'slot_duration_min must be an integer between 1 and 32767' }, 400);
      }
      const insert = pick(w, AVAIL_COLS);
      if (w.id) {
        const { data, error } = await supabase.from('finance_partner_availability')
          .update({ ...insert, updated_at: new Date().toISOString() })
          .eq('id', w.id).eq('finance_user_id', portalUser.id).select().single();
        if (error) return json({ error: error.message }, 500);
        return json({ window: data });
      }
      const { data, error } = await supabase.from('finance_partner_availability')
        .insert({ ...insert, finance_user_id: portalUser.id }).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ window: data });
    }
    if (operation === 'availability_delete') {
      const id = body.window_id;
      if (!id) return json({ error: 'window_id required' }, 400);
      const { error } = await supabase.from('finance_partner_availability')
        .delete().eq('id', id).eq('finance_user_id', portalUser.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    /* ===== Bookings ===== */
    if (operation === 'bookings_list') {
      const from = body.from || new Date(Date.now() - 7 * 86400000).toISOString();
      const to = body.to || new Date(Date.now() + 60 * 86400000).toISOString();
      const { data, error } = await supabase.from('finance_partner_bookings')
        .select('*').eq('finance_user_id', portalUser.id)
        .gte('start_at', from).lte('start_at', to).order('start_at');
      if (error) return json({ error: error.message }, 500);
      return json({ bookings: data || [] });
    }
    if (operation === 'bookings_create') {
      const insert = pick(body, BOOKING_COLS);
      if (!insert.start_at || !insert.end_at) return json({ error: 'start_at and end_at required' }, 400);
      if (!await requireBookingAssociationAccess(insert.purchase_file_id, insert.client_id)) {
        return json({ error: 'Not authorised' }, 403);
      }
      const { data, error } = await supabase.from('finance_partner_bookings')
        .insert({ ...insert, finance_user_id: portalUser.id, booked_by: 'partner' })
        .select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ booking: data });
    }
    if (operation === 'bookings_update') {
      const id = body.booking_id;
      if (!id) return json({ error: 'booking_id required' }, 400);
      const patch = pick(body.payload || {}, BOOKING_COLS);
      if ('purchase_file_id' in patch || 'client_id' in patch) {
        const { data: booking } = await supabase.from('finance_partner_bookings')
          .select('purchase_file_id, client_id').eq('id', id).eq('finance_user_id', portalUser.id).maybeSingle();
        if (!booking) return json({ error: 'Not authorised' }, 403);
        const purchaseFileId = 'purchase_file_id' in patch ? patch.purchase_file_id : booking.purchase_file_id;
        const clientId = 'client_id' in patch ? patch.client_id : booking.client_id;
        if (!await requireBookingAssociationAccess(purchaseFileId, clientId)) {
          return json({ error: 'Not authorised' }, 403);
        }
      }
      const { data, error } = await supabase.from('finance_partner_bookings')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id).eq('finance_user_id', portalUser.id).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ booking: data });
    }
    if (operation === 'bookings_cancel') {
      const id = body.booking_id;
      if (!id) return json({ error: 'booking_id required' }, 400);
      const { data, error } = await supabase.from('finance_partner_bookings')
        .update({ status: 'cancelled', cancelled_reason: body.reason || null, updated_at: new Date().toISOString() })
        .eq('id', id).eq('finance_user_id', portalUser.id).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ booking: data });
    }

    /* ===== Auto-reminder configuration ===== */
    if (operation === 'reminders_configure') {
      const id = body.instance_id;
      if (!id) return json({ error: 'instance_id required' }, 400);
      if (!await requireResourceAccess('document_requirement_instances', id, 'edit', 'documents')) return json({ error: 'Not authorised' }, 403);
      const patch: any = { updated_at: new Date().toISOString() };
      if (body.auto_reminder_enabled != null) patch.auto_reminder_enabled = !!body.auto_reminder_enabled;
      if ('due_date' in body) patch.due_date = body.due_date || null;
      if (body.reset_escalation) { patch.escalation_level = 'gentle'; patch.reminder_count = 0; patch.last_reminder_sent_at = null; }
      const { data, error } = await supabase.from('document_requirement_instances')
        .update(patch).eq('id', id).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ instance: data });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (e: any) {
    console.error('[finance-portal-batch6]', e);
    return json({ ...internalError(e, 'finance-portal-batch6') }, 500);
  }
});

/**
 * Escalating auto-reminder runner.
 * Cadence (UTC, conservative):
 *   gentle:           ≥ 48h since last reminder OR never sent     → notify client
 *   firm:             ≥ 48h since last reminder, count ≥ 2        → notify client, escalation=firm
 *   broker_notified:  ≥ 48h since last reminder, count ≥ 4        → notify finance partner
 * Only acts on instances with auto_reminder_enabled=true and status in ('requested').
 */
async function runRemindersDue(supabase: any, json: (data: unknown, status?: number) => Response) {
  const now = Date.now();
  const cutoff = new Date(now - 48 * 3600 * 1000).toISOString();
  const { data: dueRows, error } = await supabase
    .from('document_requirement_instances')
    .select('id, client_id, purchase_file_id, label, status, reminder_count, escalation_level, last_reminder_sent_at, due_date, requested_by_finance_user_id')
    .eq('auto_reminder_enabled', true)
    .eq('status', 'requested')
    .or(`last_reminder_sent_at.is.null,last_reminder_sent_at.lt.${cutoff}`);
  if (error) return json({ error: error.message }, 500);

  let notifiedClient = 0;
  let notifiedPartner = 0;
  for (const row of dueRows || []) {
    const nextCount = (row.reminder_count || 0) + 1;
    let nextLevel: 'gentle' | 'firm' | 'broker_notified' = row.escalation_level || 'gentle';
    if (nextCount >= 4) nextLevel = 'broker_notified';
    else if (nextCount >= 2) nextLevel = 'firm';
    else nextLevel = 'gentle';

    // Update the instance
    await supabase.from('document_requirement_instances').update({
      reminder_count: nextCount,
      escalation_level: nextLevel,
      last_reminder_sent_at: new Date().toISOString(),
    }).eq('id', row.id);

    if (nextLevel === 'broker_notified' && row.requested_by_finance_user_id) {
      await supabase.from('finance_portal_notifications').insert({
        portal_user_id: row.requested_by_finance_user_id,
        notification_type: 'doc_reminder_escalated',
        title: `Client unresponsive: ${row.label}`,
        body: `${nextCount} auto-reminders sent without upload. Time to intervene.`,
        link_path: `/finance/purchase-files/${row.purchase_file_id}?tab=documents`,
        metadata: { instance_id: row.id, level: nextLevel, count: nextCount },
      });
      notifiedPartner++;
    } else if (row.client_id) {
      const tone = nextLevel === 'firm' ? 'Important' : 'Friendly nudge';
      // `client_portal_messages` carries one `message` column and has no
      // `subject`, `body` or `metadata` — so this insert answered PGRST204 and
      // the automated document reminder never reached a single client, while
      // `notifiedClient` counted it as sent. The subject is folded into the
      // message the way `cross-portal-outbox-worker` already writes one.
      const { error: reminderError } = await supabase.from('client_portal_messages').insert({
        client_id: row.client_id,
        sender_type: 'system',
        sender_name: `${tone}: ${row.label} still outstanding`,
        message: `Hi — we're still waiting on "${row.label}" to keep your file moving. Please upload when you have a moment.`,
      });
      if (reminderError) {
        // Counted only when it was really written. A reminder tally that
        // includes the ones nobody received is worse than no tally.
        console.error('[finance-portal-batch6] client reminder not written:', reminderError.message);
      } else {
        notifiedClient++;
      }
    }
  }
  return json({ ok: true, processed: dueRows?.length || 0, notified_client: notifiedClient, notified_partner: notifiedPartner });
}
