// Phase 6 — Public share links for market Q&A answers.
// WP-10 hardening:
//   * `create` verifies caller owns the question (or is superadmin).
//   * `resolve` rate-limited by IP + slug and returns minimal public projection.
//   * View-count update is fired async without leaking outcome.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyAuth } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from '../_shared/corsOrigin.ts';
import {
  enforceIpQuota,
  enforceKeyQuota,
  getClientIp,
  redactError,
  sanitizeShortText,
} from '../_shared/publicAbuseControls.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-portal-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

function makeSlug(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '').slice(0, 12);
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function isSuperadmin(sb: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  const { data } = await sb.from('user_roles').select('role').eq('user_id', userId);
  return Array.isArray(data) && data.some((r: { role?: string }) => r.role === 'superadmin');
}

const __corsWrappedHandler = async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body?.action ?? 'resolve');

    // ---------------- Public resolve — no auth, rate-limited, minimal projection.
    if (action === 'resolve') {
      const slug = sanitizeShortText(body?.slug, 32);
      if (!slug) return json({ error: 'slug required' }, 400);

      const ip = getClientIp(req);
      if (!(await enforceIpQuota(sb, ip, 'market_qa_resolve', { limit: 60, windowMs: 60_000 })).ok) return json({ error: 'rate_limited' }, 429);
      if (!(await enforceKeyQuota(sb, slug, 'market_qa_resolve_slug', { limit: 300, windowMs: 60 * 60_000 })).ok) return json({ error: 'rate_limited' }, 429);

      const { data: share, error } = await sb
        .from('market_update_qa_shares')
        .select('id, question_id, expires_at, is_revoked, view_count, created_at')
        .eq('slug', slug)
        .maybeSingle();
      if (error || !share) return json({ error: 'not_found' }, 404);
      if (share.is_revoked) return json({ error: 'revoked' }, 410);
      if (share.expires_at && new Date(share.expires_at) < new Date()) return json({ error: 'expired' }, 410);

      const { data: question } = await sb
        .from('market_update_questions')
        .select('id, question, answer, source_update_ids, confidence_score, model_used, created_at, metadata')
        .eq('id', share.question_id)
        .maybeSingle();
      if (!question) return json({ error: 'not_found' }, 404);

      const ids: string[] = (question.source_update_ids ?? []) as string[];
      const { data: sources } = ids.length
        ? await sb.from('market_updates').select('id, title, ai_summary, source_url, source_name, source_published_at, impact_level').in('id', ids).is('archived_at', null)
        : { data: [] as unknown[] };

      // Fire-and-forget view-count bump.
      sb.from('market_update_qa_shares').update({
        view_count: (share.view_count ?? 0) + 1,
        last_viewed_at: new Date().toISOString(),
      }).eq('id', share.id).then(() => {}, () => {});

      // Minimal public projection — never expose creator/owner fields.
      return json({
        share: {
          id: share.id,
          question_id: share.question_id,
          expires_at: share.expires_at,
          created_at: share.created_at,
        },
        question,
        sources: sources ?? [],
      });
    }

    // ---------------- Authed actions
    const auth = await verifyAuth(sb, req.headers, body);
    if (auth.error || !auth.userId) return json({ error: 'unauthorized' }, 401);
    const userId = auth.userId as string;

    if (action === 'create') {
      const questionId = sanitizeShortText(body?.question_id, 64);
      if (!questionId) return json({ error: 'question_id required' }, 400);
      const expiresAt = body?.expires_at ? String(body.expires_at) : null;

      // Verify caller owns the source question (or is superadmin).
      const { data: question, error: qErr } = await sb
        .from('market_update_questions')
        .select('id, created_by')
        .eq('id', questionId)
        .maybeSingle();
      if (qErr || !question) return json({ error: 'question_not_found' }, 404);
      const ownerId = (question as { created_by?: string | null }).created_by ?? null;
      const superadmin = await isSuperadmin(sb, userId);
      // Fail closed for historical/imported rows without a recorded owner.
      if (!superadmin && ownerId !== userId) return json({ error: 'forbidden' }, 403);

      let slug = makeSlug();
      for (let i = 0; i < 3; i += 1) {
        const { data, error } = await sb
          .from('market_update_qa_shares')
          .insert({ question_id: questionId, slug, created_by: userId, expires_at: expiresAt })
          .select()
          .maybeSingle();
        if (!error && data) return json({ share: data });
        slug = makeSlug();
      }
      return json({ error: 'slug_collision' }, 500);
    }

    if (action === 'list-mine') {
      const { data, error } = await sb
        .from('market_update_qa_shares')
        .select('*')
        .eq('created_by', userId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) return json({ error: error.message }, 500);
      return json({ shares: data ?? [] });
    }

    if (action === 'revoke') {
      const id = sanitizeShortText(body?.id, 64);
      const { error } = await sb.from('market_update_qa_shares').update({ is_revoked: true }).eq('id', id).eq('created_by', userId);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: 'unknown_action' }, 400);
  } catch (err) {
    return json({ error: redactError(err) }, 500);
  }
};

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. This function is browser-reachable and its callers
// send `credentials: 'include'`, and the Fetch spec makes the browser reject a
// credentialed response carrying `Access-Control-Allow-Origin: *` — opaquely,
// as "Failed to fetch". See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));

