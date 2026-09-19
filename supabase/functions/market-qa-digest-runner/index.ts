// Phase 8 — Market Q&A Digest Runner.
// Cron-invoked hourly. Groups due subscriptions by (user_id, digest_group, cadence),
// re-asks each question through market-updates-qa, synthesises a single markdown
// digest via Lovable AI, writes market_qa_digests, and drops a notification.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { enforceRawBodyLimit, verifyRequiredCronSecret, verifySignedInternal } from '../_shared/requestSecurity.ts';
import { callInternalFunction } from '../_shared/internalCall.ts';
import { enforceCsrf, csrfDenied } from '../_shared/csrfGuard.ts';
import { meteredFetch } from "../_shared/meteredFetch.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')!;
const CRON_SECRET = Deno.env.get('MARKET_INGESTION_CRON_SECRET') ?? '';
const DIGEST_MODEL = 'google/gemini-2.5-flash';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-cron-secret, x-session-token, x-command-centre-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

function nextRunAt(cadence: string, from = new Date()): string {
  const d = new Date(from);
  if (cadence === 'daily') d.setUTCDate(d.getUTCDate() + 1);
  else d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString();
}

async function askQA(question: string, targetUserId: string): Promise<{ answer: string; question_id: string | null; citations: string[] }> {
  const r = await callInternalFunction('market-updates-qa', { question, internal_action: 'scheduled_qa', target_user_id: targetUserId }, 'market-qa-digest-runner');
  if (!r.ok) return { answer: '', question_id: null, citations: [] };
  const j: any = r.data ?? {};
  return { answer: j?.answer ?? '', question_id: j?.question_id ?? null, citations: j?.citations ?? [] };
}

async function synthesise(userLabel: string, cadence: string, items: Array<{ q: string; a: string; citations: string[] }>): Promise<string> {
  const prompt = [
    `You are compiling a ${cadence} market intelligence digest for an Australian property finance professional.`,
    `Below are ${items.length} freshly researched Q&A pairs. Produce a single cohesive markdown digest.`,
    `Rules:`,
    `- Start with a 2-sentence executive summary.`,
    `- Then a section per topic (### heading = a compressed version of the question).`,
    `- Preserve numeric figures and citations verbatim; do not invent facts.`,
    `- Keep total length under 800 words.`,
    `- Do NOT include the words "digest" or "briefing" in the summary.`,
    ``,
    items.map((it, i) => `## Topic ${i + 1}\n**Q:** ${it.q}\n\n**A:** ${it.a}\n\nCitations: ${it.citations.join(', ') || 'none'}`).join('\n\n---\n\n'),
  ].join('\n');
  try {
    const r = await meteredFetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Lovable-API-Key': LOVABLE_API_KEY },
      body: JSON.stringify({ model: DIGEST_MODEL, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!r.ok) throw new Error(`digest model ${r.status}`);
    const j = await r.json();
    return j?.choices?.[0]?.message?.content ?? items.map((it) => `### ${it.q}\n\n${it.a}`).join('\n\n');
  } catch (err) {
    console.warn('[digest] synthesise fallback:', (err as Error).message);
    return items.map((it) => `### ${it.q}\n\n${it.a}`).join('\n\n');
  }
}

async function runDue(sb: any) {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await sb
    .from('market_qa_subscriptions')
    .select('*')
    .eq('is_active', true)
    .not('digest_group', 'is', null)
    .lte('next_run_at', nowIso)
    .limit(200);
  if (error) return json({ error: error.message }, 500);

  // Group by (user_id, digest_group, cadence)
  const groups = new Map<string, any[]>();
  for (const sub of due ?? []) {
    const key = `${sub.user_id}::${sub.digest_group}::${sub.cadence}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(sub);
  }

  let digestsWritten = 0;
  for (const [key, subs] of groups) {
    const [user_id, digest_group, cadence] = key.split('::');
    try {
      const items: Array<{ q: string; a: string; citations: string[]; question_id: string | null }> = [];
      for (const sub of subs) {
        const r = await askQA(sub.question_template, user_id);
        items.push({ q: sub.question_template, a: r.answer, citations: r.citations, question_id: r.question_id });
      }
      const summary_md = await synthesise(digest_group, cadence, items);
      const { data: digest } = await sb.from('market_qa_digests').insert({
        user_id,
        cadence,
        digest_group,
        question_ids: items.map((it) => it.question_id).filter(Boolean),
        summary_md,
        delivery_channels: ['in_app'],
        metadata: { subscription_ids: subs.map((s: any) => s.id), item_count: items.length },
      }).select().single();

      await sb.from('notifications').insert({
        target_user_id: user_id,
        type: 'market_qa_digest',
        title: `Your ${cadence} ${digest_group} digest is ready`,
        message: `${items.length} question${items.length === 1 ? '' : 's'} refreshed`,
        metadata: { digest_id: digest?.id, digest_group },
        read: false,
      });

      const nextIso = nextRunAt(cadence);
      const nowIso2 = new Date().toISOString();
      for (const sub of subs) {
        await sb.from('market_qa_subscriptions').update({
          last_run_at: nowIso2,
          next_run_at: nextIso,
        }).eq('id', sub.id);
        await sb.from('market_qa_subscription_runs').insert({
          subscription_id: sub.id,
          question_id: items.find((it) => it.q === sub.question_template)?.question_id ?? null,
          status: 'ok',
          error: null,
        });
      }
      digestsWritten++;
    } catch (err) {
      console.warn('[digest] group failed', key, (err as Error).message);
    }
  }
  return json({ groups: groups.size, digests_written: digestsWritten });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const __csrf = enforceCsrf(req); if (!__csrf.ok) return csrfDenied(cors, __csrf); // SEC5-CSRF (no-op for cron/no-cookie)
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  // The signature covers a hash of the raw bytes, so the body is read once as
  // text and parsed from that — `req.json()` consumes the stream and leaves
  // nothing for `verifySignedInternal` to hash.
  const bounded = await enforceRawBodyLimit(req, 8192);
  if (!bounded.ok) return bounded.error;
  let body: any = {};
  try { body = bounded.raw ? JSON.parse(bounded.raw) : {}; } catch {}
  const action = body?.action ?? 'run-due';

  if (action === 'run-due') {
    /**
     * The hourly job could never satisfy this, and `market_qa_digests` is empty.
     *
     * `market-qa-digest-runner-hourly` (`35 * * * *`) invokes this through
     * `cron_invoke_signed_function`, and `cron_signed_internal_headers` sends
     * `X-Internal-{Timestamp,Nonce,Caller,Key-Id,Signature}` and NO
     * `x-cron-secret` — so the only credential this branch accepted was one the
     * caller does not send. Every run since it was scheduled answered 401
     * (measured in `net._http_response`) while pg_cron reported success,
     * because pg_cron reports on the SQL that queued the call and never on the
     * call. Not one digest has ever been written.
     *
     * The signed path is added rather than swapping the secret in, exactly as
     * `market-updates-embed-backfill` does it — same family, same pairing, and
     * a manual `x-cron-secret` invocation keeps working.
     */
    const secret = req.headers.get('x-cron-secret');
    const authorised = verifyRequiredCronSecret(CRON_SECRET, secret) ||
      (await verifySignedInternal(sb, req, bounded.raw, ['pg_cron'])).ok;
    if (!authorised) return json({ error: 'unauthorized' }, 401);
    return await runDue(sb);
  }

  if (action === 'list') {
    const { verifyAuth } = await import('../_shared/auth.ts');
    const auth = await verifyAuth(sb, req.headers, {});
    if (auth.error || !auth.userId) return json({ error: 'unauthorized' }, 401);
    const query = sb.from('market_qa_digests')
      .select('*').order('sent_at', { ascending: false }).limit(100);
    // Scope to owner unless service_role
    const { data, error } = auth.userId === 'service_role'
      ? await query
      : await query.eq('user_id', auth.userId);
    if (error) return json({ error: error.message }, 500);
    return json({ digests: data ?? [] });
  }

  return json({ error: 'unknown_action' }, 400);
});
