// Phase 7 — Market Q&A subscriptions: CRUD + cron-driven run-due.
// Users subscribe to a natural-language question; the system re-asks it on a
// cadence and drops the fresh answer into notifications.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyAuth } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { verifyRequiredCronSecret } from '../_shared/requestSecurity.ts';
import { callInternalFunction } from '../_shared/internalCall.ts';
import { internalError } from '../_shared/errorResponse.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('MARKET_INGESTION_CRON_SECRET') ?? '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-cron-secret',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const MAX_PER_USER = 20;

function nextRunAt(cadence: string, from = new Date()): string {
  const d = new Date(from);
  if (cadence === 'daily') d.setUTCDate(d.getUTCDate() + 1);
  else d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: any = {};
  try { body = await req.json(); } catch {}
  const action = body?.action ?? 'list';

  // Cron-only action
  if (action === 'run-due') {
    // Cron-triggered — accept either matching cron secret, or fall back to public
    // (align with existing market-* cron functions which are public).
    const secret = req.headers.get('x-cron-secret');
    if (!verifyRequiredCronSecret(CRON_SECRET, secret)) return json({ error: 'unauthorized' }, 401);
    return await runDue(sb);
  }

  const auth = await verifyAuth(sb, req.headers, body);
  if (auth.error || !auth.userId) return json({ error: 'unauthorized' }, 401);
  const userId = auth.userId as string;

  try {
    if (action === 'list') {
      const { data: subs, error } = await sb
        .from('market_qa_subscriptions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 500);
      const ids = (subs ?? []).map((s: any) => s.id);
      const { data: runs } = ids.length
        ? await sb.from('market_qa_subscription_runs')
            .select('id, subscription_id, question_id, status, error, created_at')
            .in('subscription_id', ids)
            .order('created_at', { ascending: false })
            .limit(200)
        : { data: [] as any[] };
      return json({ subscriptions: subs ?? [], runs: runs ?? [] });
    }

    if (action === 'create') {
      const question_template = String(body?.question_template ?? '').trim();
      const cadence = body?.cadence === 'daily' ? 'daily' : 'weekly';
      const channels: string[] = Array.isArray(body?.channels) && body.channels.length
        ? body.channels.filter((c: any) => ['in_app', 'email'].includes(c))
        : ['in_app'];
      if (question_template.length < 6) return json({ error: 'question too short' }, 400);

      const { count } = await sb
        .from('market_qa_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_active', true);
      if ((count ?? 0) >= MAX_PER_USER) return json({ error: `Limit ${MAX_PER_USER} active subscriptions` }, 400);

      const { data, error } = await sb
        .from('market_qa_subscriptions')
        .insert({
          user_id: userId,
          question_template,
          cadence,
          channels,
          digest_group: body?.digest_group ? String(body.digest_group).slice(0, 64) : null,
          next_run_at: nextRunAt(cadence),
        })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ subscription: data });
    }

    if (action === 'update') {
      const id = String(body?.id ?? '');
      const patch: any = {};
      if (body?.is_active !== undefined) patch.is_active = Boolean(body.is_active);
      if (body?.cadence && ['daily', 'weekly'].includes(body.cadence)) {
        patch.cadence = body.cadence;
        patch.next_run_at = nextRunAt(body.cadence);
      }
      if (Array.isArray(body?.channels)) {
        patch.channels = body.channels.filter((c: any) => ['in_app', 'email'].includes(c));
      }
      if (body?.digest_group !== undefined) {
        patch.digest_group = body.digest_group ? String(body.digest_group).slice(0, 64) : null;
      }
      const { data, error } = await sb
        .from('market_qa_subscriptions')
        .update(patch)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      return json({ subscription: data });
    }

    if (action === 'delete') {
      const id = String(body?.id ?? '');
      const { error } = await sb.from('market_qa_subscriptions').delete().eq('id', id).eq('user_id', userId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === 'run-now') {
      const id = String(body?.id ?? '');
      const { data: sub } = await sb
        .from('market_qa_subscriptions')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (!sub) return json({ error: 'not_found' }, 404);
      const result = await runOne(sb, sub);
      return json(result);
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (err) {
    return json({ ...internalError(err, 'market-qa-subscriptions') }, 500);
  }
});

async function runDue(sb: any) {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await sb
    .from('market_qa_subscriptions')
    .select('*')
    .eq('is_active', true)
    .lte('next_run_at', nowIso)
    .limit(50);
  if (error) return json({ error: error.message }, 500);
  let ok = 0, failed = 0;
  for (const sub of due ?? []) {
    try {
      const r = await runOne(sb, sub);
      if (r?.error) failed++; else ok++;
    } catch {
      failed++;
    }
  }
  return json({ processed: due?.length ?? 0, ok, failed });
}

async function runOne(sb: any, sub: any): Promise<{ question_id: string | null; error?: string }> {
  try {
    const resp = await callInternalFunction('market-updates-qa', {
      question: sub.question_template, internal_action: 'scheduled_qa', target_user_id: sub.user_id,
    }, 'market-qa-subscriptions');
    const j: any = resp.data ?? {};
    const questionId: string | null = j?.question_id ?? null;
    const status = resp.ok ? 'ok' : 'failed';
    const errMsg = resp.ok ? null : (j?.error ?? `qa ${resp.status}`);

    await sb.from('market_qa_subscription_runs').insert({
      subscription_id: sub.id,
      question_id: questionId,
      status,
      error: errMsg,
    });

    await sb.from('market_qa_subscriptions').update({
      last_run_at: new Date().toISOString(),
      next_run_at: nextRunAt(sub.cadence),
    }).eq('id', sub.id);

    if (status === 'ok' && (sub.channels ?? []).includes('in_app')) {
      const preview = String(j?.answer ?? '').slice(0, 180);
      await sb.from('notifications').insert({
        target_user_id: sub.user_id,
        type: 'market_qa_subscription',
        title: 'New answer for your subscribed question',
        message: preview || sub.question_template,
        metadata: { subscription_id: sub.id, question_id: questionId },
        read: false,
      });
    }

    return { question_id: questionId, error: errMsg ?? undefined };
  } catch (err) {
    const msg = String((err as Error).message);
    await sb.from('market_qa_subscription_runs').insert({
      subscription_id: sub.id, question_id: null, status: 'failed', error: msg,
    });
    return { question_id: null, error: msg };
  }
}
