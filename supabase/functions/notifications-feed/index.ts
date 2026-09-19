// Notification bell feed.
//
// Why this function exists rather than the browser querying `notifications`
// directly through PostgREST:
//
// The Command Centre has two parallel credentials. The staff session lives in
// the HttpOnly `__Host-session_token` cookie and is what every edge function
// authenticates with. Separately, `custom-auth-*-v2` mints a Supabase-compatible
// JWT for the browser to use on direct PostgREST calls, and it is explicitly
// optional — when signing fails those functions still answer `valid: true` with
// `access_token: null`, and the client falls back to a plain anon-key client.
//
// That fallback is silent and total. `notifications` policies are all
// `TO authenticated`, but `anon` still holds a SELECT grant, so an anon-key
// request is not rejected — Postgres simply matches no policy and PostgREST
// answers `200 []`. The bell rendered "No notifications yet" while the same
// query as the signed-in user returned 50 unread rows, and `markAsRead` was a
// silent no-op: not one of the ~2,000 notifications written since 3 July was
// ever marked read.
//
// So the bell now reads and writes over the credential that demonstrably works.
// Every query is scoped server-side to the caller — broadcasts plus their own
// rows — exactly matching the RLS predicate it replaces.
//
// Actions:
//   list           { limit? }        → newest notifications visible to the caller
//   create         { ... }           → raise a notification (attributed to the caller)
//   mark_read      { id }            → mark one read
//   mark_all_read  {}                → mark every visible unread row read
//   clear          { id }            → delete one
//   clear_all      {}                → delete every visible row

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, createUnauthorizedResponse, verifyAuth } from '../_shared/auth.ts';
import { enforceCsrf } from '../_shared/csrfGuard.ts';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

// Self-contained CSRF allowlist (kept local: the shared module can ship stale in
// a cached bundle, which produced spurious `origin_not_allowed` denials).
const LOVABLE_PROJECT_ID = '7976d60b-c277-4851-889b-c170285f4be2';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXACT_ORIGINS = new Set([
  'https://command-centre.npcservices.com.au',
  'https://npc-property-dashbord.lovable.app',
  'http://localhost:5173',
  'http://localhost:8080',
  ...(Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((s) => s.trim()).filter(Boolean),
]);

function originAllowed(origin: string | null): boolean {
  if (!origin) return false;
  if (EXACT_ORIGINS.has(origin)) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    const firstParty = ['.lovable.app', '.lovableproject.com', '.lovable.dev'].some((s) => host.endsWith(s));
    return firstParty && host.includes(LOVABLE_PROJECT_ID);
  } catch {
    return false;
  }
}

function csrfCheck(req: Request): { ok: boolean; reason?: string; origin?: string | null } {
  // The shared guard is the floor: whatever it rejects is rejected here. The
  // local list below is then applied on top because it is deliberately
  // STRICTER than the shared one — it carries a smaller EXACT_ORIGINS set and
  // does not honour the CORS_ALLOW_LOVABLE_PREVIEW suffix widening. Delegating
  // outright would widen the accepted origins for this function, so the two
  // are composed rather than swapped.
  const shared = enforceCsrf(req);
  if (!shared.ok) return shared;
  if (SAFE_METHODS.has(req.method.toUpperCase())) return { ok: true };
  if (!req.headers.get('cookie')) return { ok: true };
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  let candidate: string | null = origin;
  if (!candidate && referer) {
    try { candidate = new URL(referer).origin; } catch { candidate = null; }
  }
  if (!candidate) return { ok: false, reason: 'origin_missing', origin: null };
  return originAllowed(candidate)
    ? { ok: true, origin: candidate }
    : { ok: false, reason: 'origin_not_allowed', origin: candidate };
}

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

Deno.serve(async (req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );

  const csrf = csrfCheck(req);
  if (!csrf.ok) {
    return json({ error: 'CSRF check failed', code: 'csrf_denied', reason: csrf.reason, origin: csrf.origin ?? null }, 403);
  }

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = String((body as { action?: unknown }).action ?? 'list');
    const sb = admin();

    const auth = await verifyAuth(sb, req.headers, body as { session_token?: string });
    if (auth.error || !auth.userId || auth.userId === 'service_role') {
      return createUnauthorizedResponse(auth.error ?? 'Authentication required', corsHeaders);
    }
    const me = auth.userId as string;

    // The RLS predicate this function stands in for, applied server-side:
    // a row is visible when it is a broadcast or addressed to the caller.
    const visible = <T>(q: T): T => (q as any).or(`target_user_id.is.null,target_user_id.eq.${me}`);

    if (action === 'list') {
      const requested = Number((body as { limit?: unknown }).limit ?? DEFAULT_LIMIT);
      const limit = Number.isFinite(requested)
        ? Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT)
        : DEFAULT_LIMIT;

      const { data, error } = await visible(
        sb.from('notifications').select('*').order('timestamp', { ascending: false }).limit(limit),
      );
      if (error) throw error;

      const rows = data ?? [];
      return json({
        success: true,
        notifications: rows,
        unread: rows.filter((n: { read?: boolean }) => !n.read).length,
      });
    }

    if (action === 'create') {
      const b = body as Record<string, unknown>;
      const text = (v: unknown, max: number) =>
        (typeof v === 'string' ? v : '').replace(CONTROL_CHARS, '').trim().slice(0, max);

      const type = text(b.type, 80);
      const title = text(b.title, 300);
      const message = text(b.message, 2000);
      if (!type || !title) return json({ success: false, error: 'type and title required' }, 400);

      const { error } = await sb.from('notifications').insert({
        type,
        title,
        message,
        report_id: text(b.report_id, 200) || null,
        entity_id: text(b.entity_id, 200) || null,
        // A null target is a BROADCAST to every staff member. Callers must ask
        // for that explicitly rather than getting it by omitting a field.
        target_user_id: b.broadcast === true ? null : (text(b.target_user_id, 64) || me),
        created_by: me,
        read: false,
      });
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'mark_read' || action === 'clear') {
      const id = String((body as { id?: unknown }).id ?? '');
      if (!id) return json({ success: false, error: 'id required' }, 400);

      const query = action === 'mark_read'
        ? sb.from('notifications').update({ read: true })
        : sb.from('notifications').delete();
      // `.eq('id')` narrows to the row; `visible()` still applies so a caller
      // cannot touch another user's notification by guessing its id.
      const { error } = await visible(query.eq('id', id));
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'mark_all_read') {
      const { error } = await visible(
        sb.from('notifications').update({ read: true }).eq('read', false),
      );
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'clear_all') {
      const { error } = await visible(sb.from('notifications').delete().gte('created_at', '1970-01-01'));
      if (error) throw error;
      return json({ success: true });
    }

    return json({ success: false, error: `unknown action: ${action}` }, 400);
  } catch (error) {
    console.error('[notifications-feed] error', error instanceof Error ? error.message : error);
    return json({ success: false, error: 'internal_error' }, 500);
  }
});
