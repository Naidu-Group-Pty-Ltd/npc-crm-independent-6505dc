// Phase 6 — Aurixa Agent long-horizon planner.
// Actions: draft-plan, list-plans, get-plan, update-plan, approve-step,
// approve-all, execute-next-step, pause-plan, resume-plan, cancel-plan,
// delete-plan.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyAuth } from '../_shared/auth.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { verifyRequiredCronSecret } from '../_shared/requestSecurity.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-portal-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const PLANNER_MODEL = 'google/gemini-2.5-pro';
const CRON_SECRET = Deno.env.get('MARKET_INGESTION_CRON_SECRET') ?? '';

// Minimal cron parser — only supports common patterns.
// Returns the next fire time strictly after `from`.
function nextFromCron(expr: string, from = new Date()): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [mn, hr, dom, mon, dow] = parts;
  const anyStar = (v: string) => v === '*';
  // Support forms: "* * * * *", "M * * * *", "M H * * *", "M H * * D", "*/N * * * *"
  if (!anyStar(dom) || !anyStar(mon)) return null; // keep it simple
  const stepMatch = /^\*\/(\d+)$/.exec(mn);
  const stepMin = stepMatch ? Number(stepMatch[1]) : null;
  const parseFixed = (value: string, max: number): number | null | undefined => {
    if (anyStar(value)) return null;
    if (!/^\d+$/.test(value)) return undefined;
    const parsed = Number(value);
    return parsed <= max ? parsed : undefined;
  };
  const fixedMin = stepMatch ? null : parseFixed(mn, 59);
  const fixedHr = parseFixed(hr, 23);
  const fixedDow = parseFixed(dow, 6);
  if (stepMin !== null && (stepMin < 1 || stepMin > 59)) return null;
  if (fixedMin === undefined || fixedHr === undefined || fixedDow === undefined) return null;
  const d = new Date(from.getTime() + 60_000);
  d.setUTCSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 8; i++) {
    const okMin = stepMin ? (d.getUTCMinutes() % stepMin === 0) : (fixedMin === null ? true : d.getUTCMinutes() === fixedMin);
    const okHr = fixedHr === null ? true : d.getUTCHours() === fixedHr;
    const okDow = fixedDow === null ? true : d.getUTCDay() === fixedDow;
    if (okMin && okHr && okDow) return d;
    d.setUTCMinutes(d.getUTCMinutes() + 1);
  }
  return null;
}

function validateCron(expr: string): { ok: boolean; error?: string; next?: Date } {
  const next = nextFromCron(expr);
  if (!next) return { ok: false, error: 'Unsupported cron expression' };
  // Enforce >= 5-min cadence
  const parts = expr.trim().split(/\s+/);
  if (parts[0] === '*') return { ok: false, error: 'Every-minute cadence not allowed' };
  if (parts[0].startsWith('*/') && Number(parts[0].slice(2)) < 5) return { ok: false, error: 'Minimum cadence is 5 minutes' };
  return { ok: true, next };
}

const PLANNER_SYSTEM = `You are the Aurixa Agent Planner. Given a user goal, decompose it into 3 to 8 concrete, verifiable steps a downstream execution agent can perform, in order.
Each step must have:
- title: short imperative label
- description: one paragraph explaining what to do and why
- expected_output: what a successful step produces
- tool_hint: optional short hint about which agent tool is likely relevant (e.g. "list-deals", "reminder-create", "chat"). Omit if unclear.
Return strictly JSON of shape: {"steps":[{...}]}
Rules:
- No more than 8 steps.
- Do not include steps that require secrets, payments, or destructive actions unless the user explicitly asked.
- Do not invent data. Assume the executor will retrieve real data via its tools.`;

function json(payload: any, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function planWithLLM(goal: string, skillPrompt?: string): Promise<Array<{ title: string; description?: string; expected_output?: string; tool_hint?: string }>> {
  const messages = [
    { role: 'system', content: PLANNER_SYSTEM + (skillPrompt ? `\n\n===== ACTIVE SKILL =====\n${skillPrompt}` : '') },
    { role: 'user', content: `Goal:\n${goal}\n\nReturn ONLY JSON.` },
  ];
  const res = await meteredFetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Lovable-API-Key': LOVABLE_API_KEY },
    body: JSON.stringify({ model: PLANNER_MODEL, messages, response_format: { type: 'json_object' } }),
  });
  if (!res.ok) throw new Error(`planner ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const raw = j?.choices?.[0]?.message?.content ?? '{}';
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }
  const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
  return steps.slice(0, 8).map((s: any) => ({
    title: String(s?.title ?? '').slice(0, 200) || 'Step',
    description: s?.description ? String(s.description).slice(0, 2000) : undefined,
    expected_output: s?.expected_output ? String(s.expected_output).slice(0, 1000) : undefined,
    tool_hint: s?.tool_hint ? String(s.tool_hint).slice(0, 80) : undefined,
  }));
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: any = {};
  try { body = await req.json(); } catch {}
  const action = body?.action ?? 'list-plans';

  // Cron path authenticates with the configured secret instead of user credentials.
  if (action === 'run-scheduled') {
    const secret = req.headers.get('x-cron-secret');
    if (!CRON_SECRET || secret !== CRON_SECRET) return json({ error: 'unauthorized' }, 401);
    return await runScheduled(sb);
  }

  const auth = await verifyAuth(sb, req.headers, body);
  if (auth.error || !auth.userId) return json({ error: 'unauthorized' }, 401);
  const userId = auth.userId as string;

  // The planner is part of the Aurixa Agent, which is a separately-licensed
  // module (`agent` → the priced `aurixa-agent`). ai-dashboard-agent gates every
  // action on it precisely so the agent is not "a backdoor around the workspace
  // model", but this function only authenticated: any signed-in user could draft
  // and auto-execute long-horizon plans whether or not their workspace has the
  // module. That also spends paid LLM tokens (planWithLLM) outside any
  // entitlement. Reads need can_view; anything that creates, mutates or runs a
  // plan needs can_edit. Deletion is the one can_delete action.
  //
  // Placed after the cron branch on purpose: run-scheduled authenticates with
  // the cron secret and has no user to authorize.
  const plannerPerm: 'can_view' | 'can_edit' | 'can_delete' =
    action === 'delete-plan' ? 'can_delete'
    : /^(list-|get-)/.test(String(action)) ? 'can_view'
    : 'can_edit';
  const plannerGate = await requireModulePermission(
    sb,
    { userId, authMethod: auth.authMethod ?? 'human' },
    'agent',
    plannerPerm,
  );
  if (!plannerGate.ok) return json({ error: 'forbidden' }, 403);

  try {
    if (action === 'draft-plan') {
      const goal = String(body?.goal ?? '').trim();
      const title = String(body?.title ?? goal.slice(0, 80)).trim() || 'Untitled plan';
      const skillSlug = body?.skill_slug ?? null;
      const requiresApproval = body?.requires_approval !== false;
      if (!goal) return json({ error: 'goal required' }, 400);

      let skillPrompt: string | undefined;
      if (skillSlug) {
        const { data: skill } = await sb.from('agent_skills').select('system_prompt').eq('slug', skillSlug).maybeSingle();
        skillPrompt = skill?.system_prompt ?? undefined;
      }

      const steps = await planWithLLM(goal, skillPrompt);

      const { data: plan, error: planErr } = await sb.from('agent_plans').insert({
        user_id: userId, title, goal, status: requiresApproval ? 'awaiting_approval' : 'approved',
        skill_slug: skillSlug, requires_approval: requiresApproval, planner_model: PLANNER_MODEL,
        total_steps: steps.length,
      }).select().single();
      if (planErr) return json({ error: planErr.message }, 500);

      if (steps.length) {
        const stepRows = steps.map((s, idx) => ({
          plan_id: plan.id, seq: idx + 1,
          title: s.title, description: s.description ?? null,
          expected_output: s.expected_output ?? null, tool_hint: s.tool_hint ?? null,
          status: 'pending',
        }));
        const { error: stepsErr } = await sb.from('agent_plan_steps').insert(stepRows);
        if (stepsErr) return json({ error: stepsErr.message }, 500);
      }
      return json({ plan, steps });
    }

    if (action === 'list-plans') {
      const status = body?.status ? String(body.status) : null;
      let q = sb.from('agent_plans').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      return json({ plans: data ?? [] });
    }

    if (action === 'get-plan') {
      const planId = String(body?.plan_id ?? '');
      const { data: plan, error } = await sb.from('agent_plans').select('*').eq('id', planId).eq('user_id', userId).maybeSingle();
      if (error || !plan) return json({ error: 'not_found' }, 404);
      const { data: steps } = await sb.from('agent_plan_steps').select('*').eq('plan_id', planId).order('seq');
      return json({ plan, steps: steps ?? [] });
    }

    if (action === 'update-plan') {
      const planId = String(body?.plan_id ?? '');
      const patch: any = {};
      for (const k of ['title', 'goal', 'requires_approval', 'skill_slug', 'context']) if (body[k] !== undefined) patch[k] = body[k];
      const { data, error } = await sb.from('agent_plans').update(patch).eq('id', planId).eq('user_id', userId).select().maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ plan: data });
    }

    if (action === 'approve-step' || action === 'skip-step') {
      const stepId = String(body?.step_id ?? '');
      // ownership check via join
      const { data: step } = await sb.from('agent_plan_steps').select('id, plan_id, status').eq('id', stepId).maybeSingle();
      if (!step) return json({ error: 'not_found' }, 404);
      const { data: plan } = await sb.from('agent_plans').select('user_id').eq('id', step.plan_id).maybeSingle();
      if (!plan || plan.user_id !== userId) return json({ error: 'forbidden' }, 403);
      const status = action === 'skip-step' ? 'skipped' : 'approved';
      const { error } = await sb.from('agent_plan_steps').update({ status }).eq('id', stepId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === 'approve-all') {
      const planId = String(body?.plan_id ?? '');
      const { data: plan } = await sb.from('agent_plans').select('user_id').eq('id', planId).maybeSingle();
      if (!plan || plan.user_id !== userId) return json({ error: 'forbidden' }, 403);
      await sb.from('agent_plan_steps').update({ status: 'approved' }).eq('plan_id', planId).eq('status', 'pending');
      await sb.from('agent_plans').update({ status: 'approved' }).eq('id', planId);
      return json({ ok: true });
    }

    if (action === 'execute-next-step') {
      const planId = String(body?.plan_id ?? '');
      const { data: plan } = await sb.from('agent_plans').select('*').eq('id', planId).eq('user_id', userId).maybeSingle();
      if (!plan) return json({ error: 'not_found' }, 404);
      if (plan.status === 'paused' || plan.status === 'cancelled' || plan.status === 'completed') {
        return json({ error: `plan_${plan.status}` }, 400);
      }
      // Find next approved (or, if not requires_approval, next pending) step
      const target = plan.requires_approval ? 'approved' : 'pending';
      const { data: steps } = await sb.from('agent_plan_steps').select('*').eq('plan_id', planId).eq('status', target).order('seq').limit(1);
      const step = steps?.[0];
      if (!step) {
        // Mark completed if all done
        const { data: remaining } = await sb.from('agent_plan_steps').select('id').eq('plan_id', planId).in('status', ['pending', 'approved', 'running']);
        if (!remaining || remaining.length === 0) {
          await sb.from('agent_plans').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', planId);
        }
        return json({ done: true });
      }

      await sb.from('agent_plan_steps').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', step.id);
      await sb.from('agent_plans').update({ status: 'running' }).eq('id', planId);

      // Delegate execution to ai-dashboard-agent chat
      const prompt = `Plan step ${step.seq} of ${plan.total_steps}: ${step.title}\n\nDescription: ${step.description ?? ''}\nExpected output: ${step.expected_output ?? ''}\nTool hint: ${step.tool_hint ?? 'none'}\n\nOverall goal: ${plan.goal}\n\nExecute this step now. Return a concise summary of what you did and any citations.`;
      let result: any = null; let errMsg: string | null = null;
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/ai-dashboard-agent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'x-effective-user-id': userId },
          body: JSON.stringify({ action: 'chat', messages: [{ role: 'user', content: prompt }], skill_slug: plan.skill_slug, plan_id: planId, step_id: step.id }),
        });
        result = await resp.json();
        if (!resp.ok) errMsg = result?.error ?? `agent ${resp.status}`;
      } catch (err) {
        errMsg = String((err as Error).message);
      }

      const patch: any = {
        status: errMsg ? 'failed' : 'done',
        completed_at: new Date().toISOString(),
        result: result ?? null,
        error: errMsg,
        tool_calls: result?.tool_calls ?? [],
      };
      await sb.from('agent_plan_steps').update(patch).eq('id', step.id);

      // Update plan counters and status
      const { count: doneCount } = await sb.from('agent_plan_steps').select('id', { count: 'exact', head: true }).eq('plan_id', planId).eq('status', 'done');
      if (typeof doneCount === 'number') await sb.from('agent_plans').update({ completed_steps: doneCount }).eq('id', planId);

      if (errMsg) {
        await sb.from('agent_plans').update({ status: 'failed' }).eq('id', planId);
      }
      return json({ step_id: step.id, status: patch.status, error: errMsg, result });
    }

    if (action === 'pause-plan' || action === 'resume-plan' || action === 'cancel-plan') {
      const planId = String(body?.plan_id ?? '');
      const status = action === 'pause-plan' ? 'paused' : action === 'resume-plan' ? 'approved' : 'cancelled';
      const { error } = await sb.from('agent_plans').update({ status }).eq('id', planId).eq('user_id', userId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === 'delete-plan') {
      const planId = String(body?.plan_id ?? '');
      const { error } = await sb.from('agent_plans').delete().eq('id', planId).eq('user_id', userId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === 'list-runs') {
      const planId = String(body?.plan_id ?? '');
      const { data, error } = await sb.from('agent_plan_runs').select('*')
        .eq('plan_id', planId).eq('user_id', userId).order('started_at', { ascending: false }).limit(50);
      if (error) return json({ error: error.message }, 500);
      return json({ runs: data ?? [] });
    }

    if (action === 'schedule-plan') {
      const planId = String(body?.plan_id ?? '');
      const cron = String(body?.schedule_cron ?? '').trim();
      const autoExecute = Boolean(body?.auto_execute);
      const v = validateCron(cron);
      if (!v.ok) return json({ error: v.error }, 400);
      // Per-user cap (10 scheduled)
      const { count } = await sb.from('agent_plans').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).not('schedule_cron', 'is', null);
      if ((count ?? 0) >= 10) {
        const { data: existing } = await sb.from('agent_plans').select('schedule_cron').eq('id', planId).eq('user_id', userId).maybeSingle();
        if (!existing?.schedule_cron) return json({ error: 'Scheduled-plan limit reached (10 per user)' }, 400);
      }
      const { data, error } = await sb.from('agent_plans').update({
        schedule_cron: cron,
        auto_execute: autoExecute,
        next_run_at: v.next!.toISOString(),
      }).eq('id', planId).eq('user_id', userId).select().maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ plan: data });
    }

    if (action === 'unschedule-plan') {
      const planId = String(body?.plan_id ?? '');
      const { data, error } = await sb.from('agent_plans').update({
        schedule_cron: null, next_run_at: null, auto_execute: false,
      }).eq('id', planId).eq('user_id', userId).select().maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ plan: data });
    }

    if (action === 'propose-subscription') {
      // Agent-authored draft. Records into agent_insights_feed so the user can approve
      // (via the "Approve subscription" card in the chat) before we actually create it.
      const question_template = String(body?.question_template ?? '').trim();
      const cadence = body?.cadence === 'daily' ? 'daily' : 'weekly';
      const digest_group = body?.digest_group ? String(body.digest_group).slice(0, 64) : null;
      const rationale = String(body?.rationale ?? '').slice(0, 500);
      if (question_template.length < 6) return json({ error: 'question too short' }, 400);
      const payload = { question_template, cadence, digest_group, rationale };
      const { data, error } = await sb.from('agent_insights_feed').insert({
        user_id: userId,
        kind: 'proposed_subscription',
        title: `Subscribe to: "${question_template.slice(0, 80)}"?`,
        summary: rationale || `The agent recommends a ${cadence} subscription.`,
        body_markdown: rationale ? `**Why:** ${rationale}\n\n**Question:** ${question_template}\n\n**Cadence:** ${cadence}` : null,
        severity: 'info',
        source: 'agent-planner',
        payload,
      }).select().single();
      if (error) return json({ error: error.message }, 500);
      return json({ proposal: data });
    }

    if (action === 'approve-subscription') {
      // Called from AgentChatWidget's approval card. Creates the subscription and
      // marks the insight as acted-on atomically with quota enforcement.
      const insightId = String(body?.insight_id ?? '');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(insightId)) {
        return json({ error: 'valid insight_id required' }, 400);
      }
      const { data, error } = await sb.rpc('approve_agent_subscription', {
        p_user_id: userId,
        p_insight_id: insightId,
      });
      if (error) return json({ error: error.message }, 500);
      if (data?.error === 'subscription_limit_reached') {
        return json({ error: 'Limit 20 active subscriptions' }, 400);
      }
      if (data?.error) return json({ error: data.error }, 409);
      return json({ subscription: data.subscription });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (err) {
    return json({ ...internalError(err, 'agent-planner') }, 500);
  }
});

async function runScheduled(sb: any) {
  const nowIso = new Date().toISOString();
  const { data: due } = await sb.from('agent_plans').select('*')
    .not('schedule_cron', 'is', null)
    .lte('next_run_at', nowIso)
    .in('status', ['approved', 'awaiting_approval', 'running', 'paused'])
    .limit(20);
  let launched = 0;
  for (const plan of due ?? []) {
    try {
      const { data: run } = await sb.from('agent_plan_runs').insert({
        plan_id: plan.id, user_id: plan.user_id, status: 'running', triggered_by: 'cron',
      }).select().single();

      if (plan.auto_execute) {
        let steps = 0, failed = 0;
        for (let i = 0; i < 6; i++) {
          const r = await fetch(`${SUPABASE_URL}/functions/v1/agent-planner`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'x-effective-user-id': plan.user_id },
            body: JSON.stringify({ action: 'execute-next-step', plan_id: plan.id }),
          });
          const j = await r.json();
          if (j?.done) break;
          if (j?.error) { failed++; break; }
          steps++;
        }
        await sb.from('agent_plan_runs').update({
          status: failed ? 'failed' : 'completed',
          steps_executed: steps, steps_failed: failed,
          finished_at: new Date().toISOString(),
        }).eq('id', run!.id);
      } else {
        await sb.from('notifications').insert({
          target_user_id: plan.user_id, type: 'agent_plan_scheduled',
          title: 'Scheduled plan is ready',
          message: `${plan.title} is awaiting your approval.`,
          metadata: { plan_id: plan.id, run_id: run?.id },
          // `read`, not `is_read` — naming the wrong column made Postgres
          // reject the whole insert, so this notification never arrived.
          read: false,
        });
        await sb.from('agent_plan_runs').update({
          status: 'awaiting_approval', finished_at: new Date().toISOString(),
        }).eq('id', run!.id);
      }

      const nxt = nextFromCron(plan.schedule_cron);
      await sb.from('agent_plans').update({
        last_run_at: new Date().toISOString(),
        next_run_at: nxt ? nxt.toISOString() : null,
      }).eq('id', plan.id);
      launched++;
    } catch (err) {
      console.warn('run-scheduled err', (err as Error).message);
    }
  }
  return json({ launched });
}

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
