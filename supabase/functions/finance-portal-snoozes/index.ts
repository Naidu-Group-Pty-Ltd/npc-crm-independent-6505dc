/**
 * Finance Portal — Smart Snoozes
 * Operations: list, create, clear, run_due (cron entry → posts notifications)
 *
 * `create` accepts either an explicit ISO `snooze_until` or a `raw_input` string
 * parsed via a lightweight natural-language date parser (see parseNaturalDate).
 */
import { extractFinanceToken, makeServiceClient, resolveFinancePartner } from '../_shared/finance-portal-session.ts';
import { hasFinancePortalPermission } from '../_shared/finance-portal-permissions.ts';
import { parseNaturalDate } from '../_shared/parse-natural-date.ts';
import { enforceRawBodyLimit, verifySignedInternal } from '../_shared/requestSecurity.ts';

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function jsonWithHeaders(data: any, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
}

// parseNaturalDate is imported from ../_shared/parse-natural-date.ts

async function notifyDue(supabase: any) {
  const { data: due } = await supabase
    .from('finance_partner_snoozes')
    .select('id, finance_contact_id, purchase_file_id, client_id, scope, reason, snooze_until')
    .lte('snooze_until', new Date().toISOString())
    .is('cleared_at', null)
    .eq('notified', false)
    .limit(200);

  if (!due?.length) return { processed: 0 };

  let processed = 0;
  for (const s of due) {
    try {
      const link = s.purchase_file_id
        ? `/finance/purchase-files/${s.purchase_file_id}`
        : s.client_id ? `/finance/clients/${s.client_id}` : '/finance';

      await supabase.from('finance_portal_notifications').insert({
        portal_user_id: s.finance_contact_id,
        notification_type: 'snooze_due',
        title: 'Reminder: snoozed item is due',
        body: s.reason || 'You asked to be reminded about this.',
        link_path: link,
        metadata: { snooze_id: s.id, scope: s.scope },
      });
      await supabase.from('finance_partner_snoozes').update({ notified: true }).eq('id', s.id);
      processed++;
    } catch (e) {
      console.error('[snoozes] notify error', s.id, e);
    }
  }
  return { processed };
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const json = (data: any, status = 200) => jsonWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = makeServiceClient();
    // Read the body ONCE, as bytes. `run_due` is authenticated by an HMAC over
    // exactly these bytes, so it cannot be re-derived from a parsed object.
    const bounded = await enforceRawBodyLimit(req, 16 * 1024);
    if (!bounded.ok) return bounded.error;
    let body: any = {};
    try { body = bounded.raw ? JSON.parse(bounded.raw) : {}; } catch { body = {}; }
    const { operation } = body;

    // run_due is the cron entry and takes no partner session, so it carries its
    // own credential: the HMAC that `public.cron_invoke_signed_function` signs
    // every scheduled invocation with. The live job is
    //
    //   select public.cron_invoke_signed_function(
    //     'finance-portal-snoozes', '{"operation":"run_due"}'::jsonb, 'pg_cron');
    //
    // so `pg_cron` is the caller to allow — read off the schedule rather than
    // assumed. `resume-bulk-generation` and `resume-investment-reports` each
    // allow-list a bespoke caller name that no job sends, and reject every
    // invocation they get; that is the mistake this comment exists to avoid.
    //
    // This branch used to require nothing at all. Its comment said "cron +
    // service", which described the intent — the gateway JWT was assumed to be
    // standing in front of it. It was not: `supabase/config.toml` never
    // declared this function, an undeclared function reads as
    // `verify_jwt = true`, and it is deployed with the check OFF. So an
    // unauthenticated `{"operation":"run_due"}` from anywhere on the internet
    // reached here and ran `notifyDue` under the service client. Measured
    // 15 Aug 2026 by probing production: the request reached the function,
    // where a gateway-guarded function answers `UNAUTHORIZED_NO_AUTH_HEADER`.
    //
    // Fails closed: `verifySignedInternal` returns `missing_credentials` when
    // `INTERNAL_EDGE_SECRET` is unset, and legacy static-secret and
    // service-role-key fallbacks are both refused inside it.
    if (operation === 'run_due') {
      const cron = await verifySignedInternal(supabase, req, bounded.raw, ['pg_cron']);
      if (!cron.ok) {
        console.warn('[finance-portal-snoozes] rejected unsigned run_due', {
          correlationId: cron.correlationId, errorCode: cron.errorCode,
        });
        return json({ error: 'Cron authentication required' }, 401);
      }
      const result = await notifyDue(supabase);
      return json({ ok: true, ...result });
    }

    const token = extractFinanceToken(req.headers, body);
    const auth = await resolveFinancePartner(supabase, token);
    if (auth.error) return json({ error: auth.error }, auth.status);
    const portalUser = auth.portalUser!;

    let assignments: any[] = [];
    async function loadAssignments(): Promise<Response | null> {
      const { data, error } = await supabase
        .from('finance_portal_client_assignments')
        .select('client_id, purchase_file_id, permissions')
        .eq('finance_user_id', portalUser.id);
      if (error) return json({ error: error.message }, 500);
      assignments = data ?? [];
      return null;
    }

    const canAccessClient = (clientId: string) =>
      assignments.some((assignment: any) => assignment.client_id === clientId);

    const canViewPurchaseFile = (file: { id: string; client_id: string } | null) =>
      !!file && assignments.some((assignment: any) =>
        assignment.client_id === file.client_id
        && (!assignment.purchase_file_id || assignment.purchase_file_id === file.id)
        && hasFinancePortalPermission(
          portalUser.global_permissions,
          assignment.permissions,
          'purchase_files',
          'view',
          true,
        ));

    if (operation === 'list') {
      const assignmentsError = await loadAssignments();
      if (assignmentsError) return assignmentsError;
      const includeCleared = !!body.include_cleared;
      let q = supabase
        .from('finance_partner_snoozes')
        .select('*, purchase_files:purchase_file_id(id, title, property_address, client_id)')
        .eq('finance_contact_id', portalUser.id)
        .order('snooze_until', { ascending: true });
      if (!includeCleared) q = q.is('cleared_at', null);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      const authorizedSnoozes = (data ?? []).filter((snooze: any) => {
        if (snooze.scope === 'general') return true;
        if (snooze.scope === 'client') return !!snooze.client_id && canAccessClient(snooze.client_id);
        return canViewPurchaseFile(snooze.purchase_files);
      });
      return json({ snoozes: authorizedSnoozes });
    }

    if (operation === 'create') {
      const assignmentsError = await loadAssignments();
      if (assignmentsError) return assignmentsError;
      const payload = body.payload || {};
      let until: Date | null = null;
      if (payload.snooze_until) {
        const d = new Date(payload.snooze_until);
        if (!isNaN(d.getTime())) until = d;
      }
      if (!until && payload.raw_input) {
        until = parseNaturalDate(payload.raw_input);
      }
      if (!until || isNaN(until.getTime())) {
        return json({ error: "Could not understand the time — try 'tomorrow 9am', 'in 3 days', 'next Monday'" }, 400);
      }
      if (until.getTime() < Date.now() - 60_000) {
        return json({ error: 'Snooze time must be in the future' }, 400);
      }

      const scope = ['purchase_file', 'client', 'general'].includes(payload.scope) ? payload.scope : 'purchase_file';
      const ids: any = {};
      if (scope === 'purchase_file') {
        if (!payload.purchase_file_id) return json({ error: 'purchase_file_id required' }, 400);
        const { data: purchaseFile, error: purchaseFileError } = await supabase
          .from('purchase_files')
          .select('id, client_id')
          .eq('id', payload.purchase_file_id)
          .maybeSingle();
        if (purchaseFileError) return json({ error: purchaseFileError.message }, 500);
        if (!canViewPurchaseFile(purchaseFile)) return json({ error: 'Purchase file not found' }, 404);
        ids.purchase_file_id = purchaseFile.id;
      }
      if (scope === 'client') {
        if (!payload.client_id) return json({ error: 'client_id required' }, 400);
        if (!canAccessClient(payload.client_id)) return json({ error: 'Client not found' }, 404);
        ids.client_id = payload.client_id;
      }

      const { data, error } = await supabase
        .from('finance_partner_snoozes')
        .insert({
          finance_contact_id: portalUser.id,
          scope,
          snooze_until: until.toISOString(),
          reason: (payload.reason || '').toString().slice(0, 500) || null,
          raw_input: (payload.raw_input || '').toString().slice(0, 200) || null,
          ...ids,
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ snooze: data });
    }

    if (operation === 'clear') {
      const id = body.id;
      if (!id) return json({ error: 'id required' }, 400);
      const { error } = await supabase
        .from('finance_partner_snoozes')
        .update({ cleared_at: new Date().toISOString() })
        .eq('id', id)
        .eq('finance_contact_id', portalUser.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (operation === 'parse') {
      const d = parseNaturalDate(body.input || '');
      if (!d) return json({ error: 'Could not parse' }, 400);
      return json({ parsed: d.toISOString() });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (e: any) {
    console.error('[finance-portal-snoozes] error', e);
    return json({ ...internalError(e, 'finance-portal-snoozes') }, 500);
  }
});
