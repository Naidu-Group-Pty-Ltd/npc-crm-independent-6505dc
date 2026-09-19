/**
 * Phase 7.3 — Nudge sequences for the Finance Portal.
 *
 * Operations:
 *   - list_templates        → returns workspace + this partner's templates
 *   - upsert_template       → create or update a partner-owned template
 *   - delete_template       → soft delete (is_active = false) for partner templates
 *   - list_sequences        → by client_id OR purchase_file_id
 *   - start_sequence        → start a template for a (pf, client) pair
 *   - pause_sequence        → manual pause
 *   - resume_sequence       → resume from current_step
 *   - cancel_sequence       → terminal
 *   - runner_tick           → cron-only; sends due step messages, advances sequences
 *
 * Auth: finance partner session token. runner_tick uses x-automation-secret.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.55.0';

import { createCorsHeaders as __createCorsHeaders } from "../_shared/auth.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { extractFinanceSessionToken } from '../_shared/financeSessionToken.ts';
// Dynamic per-request CORS — frontend uses `credentials: 'include'`, so ACAO must
// echo the request Origin (never `*`) with `Allow-Credentials: true`.
const corsHeaderDefaults: Record<string, string> = {
  ...__createCorsHeaders(null),
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-finance-session-token, x-session-token, x-automation-secret',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

function jsonWithHeaders(data: unknown, responseCorsHeaders: Record<string, string>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...responseCorsHeaders, 'Content-Type': 'application/json' },
  });
}

// Delegates to the ONE cookie-aware reader. The local body used to read only
// the header and the request body, so a portal whose session lives in the
// HttpOnly `__Host-finance_session_token` cookie (WP-11B/C) got a 401 on
// every call once its in-memory token was lost to a page load.
function extractToken(req: Request, body: any): string | null {
  return extractFinanceSessionToken(req.headers, body as Record<string, unknown> | undefined);
}

interface StepShape {
  day_offset: number;
  channel: string;
  subject?: string;
  body: string;
}

function substitute(text: string, vars: Record<string, string>): string {
  return (text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}

Deno.serve(async (req) => {
  const corsHeaders = { ...__createCorsHeaders(req.headers.get('origin')), 'Access-Control-Allow-Headers': corsHeaderDefaults['Access-Control-Allow-Headers'], 'Access-Control-Expose-Headers': corsHeaderDefaults['Access-Control-Expose-Headers'] };
  const json = (data: any, status = 200) => jsonWithHeaders(data, corsHeaders, status);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const { operation } = body || {};
    if (!operation) return json({ error: 'operation required' }, 400);

    // -------- runner_tick (cron) --------
    if (operation === 'runner_tick') {
      const expected = Deno.env.get('AUTOMATION_RUNNER_SECRET');
      const provided =
        req.headers.get('x-automation-secret') || new URL(req.url).searchParams.get('secret');
      if (expected && provided !== expected) return json({ error: 'Forbidden' }, 403);

      // Pull all active sequences whose next_run_at is null or due
      const nowIso = new Date().toISOString();
      const { data: seqs } = await supabase
        .from('finance_portal_nudge_sequences')
        .select('id, purchase_file_id, client_id, template_id, current_step, started_at, last_step_sent_at, status, started_by_finance_user_id')
        .eq('status', 'active')
        .or(`next_run_at.is.null,next_run_at.lte.${nowIso}`)
        .limit(200);

      let sent = 0;
      let completed = 0;
      for (const seq of (seqs as any[]) || []) {
        const { data: tpl } = await supabase
          .from('finance_portal_nudge_templates')
          .select('steps')
          .eq('id', seq.template_id)
          .maybeSingle();
        const steps: StepShape[] = (tpl?.steps as any) || [];
        const stepIdx = seq.current_step;
        if (stepIdx >= steps.length) {
          await supabase
            .from('finance_portal_nudge_sequences')
            .update({ status: 'completed', completed_at: nowIso })
            .eq('id', seq.id);
          completed++;
          continue;
        }
        const step = steps[stepIdx];
        // Compute target send time from start + day_offset; skip if not yet
        const target = new Date(new Date(seq.started_at).getTime() + (step.day_offset || 0) * 86_400_000);
        if (target.getTime() > Date.now()) {
          await supabase
            .from('finance_portal_nudge_sequences')
            .update({ next_run_at: target.toISOString() })
            .eq('id', seq.id);
          continue;
        }

        // Resolve client info for substitution
        const { data: client } = await supabase
          .from('clients')
          .select('id, primary_first_name')
          .eq('id', seq.client_id)
          .maybeSingle();
        const first = (client?.primary_first_name || 'there').trim().split(' ')[0] || 'there';
        const vars = { first_name: first };

        const messageBody = substitute(step.body || '', vars);

        let messageId: string | null = null;
        let errText: string | null = null;
        try {
          // Resolve a partner name for sender_name
          let senderName = 'Your finance partner';
          if (seq.started_by_finance_user_id) {
            const { data: u } = await supabase
              .from('finance_portal_users')
              .select('email, finance_contact_id')
              .eq('id', seq.started_by_finance_user_id)
              .maybeSingle();
            if (u) {
              if (u.finance_contact_id) {
                const { data: fc } = await supabase
                  .from('finance_agent_contacts')
                  .select('name')
                  .eq('id', u.finance_contact_id)
                  .maybeSingle();
                if (fc?.name) senderName = fc.name;
                else if (u.email) senderName = u.email;
              } else if (u.email) {
                senderName = u.email;
              }
            }
          }

          const { data: msg, error: msgErr } = await supabase
            .from('client_portal_messages')
            .insert({
              client_id: seq.client_id,
              sender_type: 'advisor',
              sender_name: senderName,
              message: messageBody,
              visibility_scope: 'command_client_private',
              thread_type: 'command_client',
              allocation_status: 'none',
              finance_allocated: false,
              permission_status: { command_centre: 'full', client_portal: 'granted', finance_portal: 'blocked' },
            })
            .select('id')
            .single();
          if (msgErr) throw msgErr;
          messageId = msg.id;
          sent++;
        } catch (e: any) {
          errText = e?.message || String(e);
        }

        await supabase.from('finance_portal_nudge_sends').insert({
          sequence_id: seq.id,
          step_index: stepIdx,
          channel: step.channel || 'portal_message',
          message_id: messageId,
          error: errText,
        });

        const nextIdx = stepIdx + 1;
        const isLast = nextIdx >= steps.length;
        const nextTarget = isLast
          ? null
          : new Date(
              new Date(seq.started_at).getTime() + (steps[nextIdx].day_offset || 0) * 86_400_000,
            ).toISOString();

        await supabase
          .from('finance_portal_nudge_sequences')
          .update({
            current_step: nextIdx,
            last_step_sent_at: nowIso,
            next_run_at: nextTarget,
            status: isLast ? 'completed' : 'active',
            completed_at: isLast ? nowIso : null,
          })
          .eq('id', seq.id);
        if (isLast) completed++;
      }

      return json({ success: true, sent, completed, scanned: seqs?.length || 0 });
    }

    // -------- Partner-authenticated operations --------
    const token = extractToken(req, body);
    if (!token) return json({ error: 'Session token required' }, 401);
    const { data: portalUser } = await supabase
      .from('finance_portal_users')
      .select('id, is_active, revoked_at, session_expires_at, email')
      .eq('session_token', token)
      .maybeSingle();
    if (!portalUser || !portalUser.is_active || portalUser.revoked_at) {
      return json({ error: 'Invalid session' }, 401);
    }
    if (!portalUser.session_expires_at || new Date(portalUser.session_expires_at) < new Date()) {
      return json({ error: 'Session expired' }, 401);
    }

    async function ensureAssigned(client_id: string) {
      const { data } = await supabase
        .from('finance_portal_client_assignments')
        .select('id')
        .eq('finance_user_id', portalUser!.id)
        .eq('client_id', client_id)
        .maybeSingle();
      return !!data;
    }

    // ---- list_templates ----
    if (operation === 'list_templates') {
      const { data } = await supabase
        .from('finance_portal_nudge_templates')
        .select('*')
        .eq('is_active', true)
        .or(`finance_user_id.is.null,finance_user_id.eq.${portalUser.id}`)
        .order('finance_user_id', { nullsFirst: true })
        .order('name');
      return json({ success: true, templates: data || [] });
    }

    // ---- upsert_template ----
    if (operation === 'upsert_template') {
      const { id, name, kind = 'custom', description, steps } = body;
      if (!name || !Array.isArray(steps)) return json({ error: 'name + steps required' }, 400);
      const payload: any = {
        finance_user_id: portalUser.id,
        name: String(name).slice(0, 200),
        kind: String(kind).slice(0, 50),
        description: description ? String(description).slice(0, 2000) : null,
        steps,
        is_active: true,
      };
      if (id) {
        // Ensure ownership
        const { data: existing } = await supabase
          .from('finance_portal_nudge_templates')
          .select('finance_user_id')
          .eq('id', id)
          .maybeSingle();
        if (!existing || existing.finance_user_id !== portalUser.id) {
          return json({ error: 'Cannot edit this template' }, 403);
        }
        const { data, error } = await supabase
          .from('finance_portal_nudge_templates')
          .update(payload)
          .eq('id', id)
          .select()
          .single();
        if (error) throw error;
        return json({ success: true, template: data });
      }
      const { data, error } = await supabase
        .from('finance_portal_nudge_templates')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return json({ success: true, template: data });
    }

    // ---- delete_template ----
    if (operation === 'delete_template') {
      const { id } = body;
      if (!id) return json({ error: 'id required' }, 400);
      const { data: existing } = await supabase
        .from('finance_portal_nudge_templates')
        .select('finance_user_id')
        .eq('id', id)
        .maybeSingle();
      if (!existing || existing.finance_user_id !== portalUser.id) {
        return json({ error: 'Cannot delete this template' }, 403);
      }
      await supabase
        .from('finance_portal_nudge_templates')
        .update({ is_active: false })
        .eq('id', id);
      return json({ success: true });
    }

    // ---- list_sequences ----
    if (operation === 'list_sequences') {
      const { purchase_file_id, client_id } = body;
      if (!purchase_file_id && !client_id) {
        return json({ error: 'purchase_file_id or client_id required' }, 400);
      }
      let q = supabase
        .from('finance_portal_nudge_sequences')
        .select(
          'id, purchase_file_id, client_id, template_id, status, current_step, pause_reason, last_step_sent_at, next_run_at, started_at, completed_at, finance_portal_nudge_templates(name, kind, steps)',
        );
      if (purchase_file_id) q = q.eq('purchase_file_id', purchase_file_id);
      if (client_id) q = q.eq('client_id', client_id);
      const { data, error } = await q.order('started_at', { ascending: false });
      if (error) throw error;
      return json({ success: true, sequences: data || [] });
    }

    // ---- start_sequence ----
    if (operation === 'start_sequence') {
      const { purchase_file_id, client_id, template_id } = body;
      if (!purchase_file_id || !client_id || !template_id) {
        return json({ error: 'purchase_file_id, client_id, template_id required' }, 400);
      }
      if (!(await ensureAssigned(client_id))) return json({ error: 'Not assigned' }, 403);

      const { data: tpl } = await supabase
        .from('finance_portal_nudge_templates')
        .select('id, steps, is_active')
        .eq('id', template_id)
        .maybeSingle();
      if (!tpl || !tpl.is_active) return json({ error: 'Template not available' }, 404);

      // Pause any existing active sequence for this PF+client
      await supabase
        .from('finance_portal_nudge_sequences')
        .update({ status: 'cancelled', pause_reason: 'superseded' })
        .eq('client_id', client_id)
        .eq('purchase_file_id', purchase_file_id)
        .eq('status', 'active');

      const startAt = new Date();
      const firstStepOffset = ((tpl.steps as any[])[0]?.day_offset || 0);
      const nextRun = new Date(startAt.getTime() + firstStepOffset * 86_400_000).toISOString();
      const { data: seq, error } = await supabase
        .from('finance_portal_nudge_sequences')
        .insert({
          purchase_file_id,
          client_id,
          template_id,
          started_by_finance_user_id: portalUser.id,
          status: 'active',
          current_step: 0,
          next_run_at: nextRun,
        })
        .select()
        .single();
      if (error) throw error;
      return json({ success: true, sequence: seq });
    }

    // ---- pause / resume / cancel ----
    if (['pause_sequence', 'resume_sequence', 'cancel_sequence'].includes(operation)) {
      const { id } = body;
      if (!id) return json({ error: 'id required' }, 400);
      const { data: seq } = await supabase
        .from('finance_portal_nudge_sequences')
        .select('id, client_id, status, current_step, started_at, finance_portal_nudge_templates(steps)')
        .eq('id', id)
        .maybeSingle();
      if (!seq) return json({ error: 'Not found' }, 404);
      if (!(await ensureAssigned(seq.client_id))) return json({ error: 'Not assigned' }, 403);

      const update: any = { updated_at: new Date().toISOString() };
      if (operation === 'pause_sequence') {
        update.status = 'paused';
        update.pause_reason = 'manual';
      } else if (operation === 'cancel_sequence') {
        update.status = 'cancelled';
        update.completed_at = new Date().toISOString();
      } else if (operation === 'resume_sequence') {
        update.status = 'active';
        update.pause_reason = null;
        const steps: any[] = (seq as any).finance_portal_nudge_templates?.steps || [];
        const step = steps[seq.current_step];
        if (step) {
          update.next_run_at = new Date(
            new Date(seq.started_at).getTime() + (step.day_offset || 0) * 86_400_000,
          ).toISOString();
        }
      }
      const { data, error } = await supabase
        .from('finance_portal_nudge_sequences')
        .update(update)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return json({ success: true, sequence: data });
    }

    return json({ error: `Unknown operation: ${operation}` }, 400);
  } catch (err: any) {
    console.error('[finance-portal-nudges]', err);
    return json({ ...internalError(err, 'finance-portal-nudges') }, 500);
  }
});
