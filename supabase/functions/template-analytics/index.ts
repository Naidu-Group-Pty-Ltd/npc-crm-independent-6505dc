/**
 * template-analytics — Phase 14
 *
 * Aggregates `template_events` for the report-template builder.
 *
 * Auth: x-session-token (custom auth) + a gateway-verified Bearer JWT.
 *       The service_role table is only accessible with a valid staff session.
 *
 * Ops:
 *   log       { templateId, eventType, templateVersion?, pageId?, blockId?,
 *               shareToken?, metadata? }
 *               → inserts a single event for an authenticated staff session.
 *   summary   { templateId, days? }      → counts by event_type + KPI cards
 *   timeline  { templateId, days? }      → daily rollup [{date, edits, renders, views}]
 *   heatmap   { templateId, days? }      → per-page edit counts + top blocks
 *   shareViews{ templateId, days? }      → views per share-link token
 *   recent    { templateId, limit? }     → latest events (event log)
 */
import { createClient } from 'npm:@supabase/supabase-js@2.55.0';
import { verifySession } from '../_shared/auth.ts';
import { enforceIpQuota, enforceKeyQuota, getClientIp } from '../_shared/publicAbuseControls.ts';
import { withRequestOrigin } from "../_shared/corsOrigin.ts";

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_METADATA_BYTES = 4 * 1024;
const VALID_SHARE_TOKEN = /^[A-Za-z0-9_-]{12,128}$/;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function sinceISO(days: number): string {
  return new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return json({ error: 'request too large' }, 413);
  }
  const body = (() => {
    try { return JSON.parse(rawBody); } catch { return null; }
  })();
  if (!body || typeof body !== 'object') return json({ error: 'invalid json' }, 400);

  const op = String(body.op || body.operation || '').trim();
  const templateId = body.templateId ? String(body.templateId) : null;
  if (!op) return json({ error: 'op is required' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── log: require an authenticated staff session ─────────────────────────
  if (op === 'log') {
    const eventType = String(body.eventType || '').slice(0, 60);
    if (!templateId || !eventType) return json({ error: 'templateId + eventType required' }, 400);

    const sessionToken = req.headers.get('x-session-token') || body.session_token || null;
    if (sessionToken) {
      const v = await verifySession(supabase, sessionToken);
      if (!v.error) {
        actorId = v.userId;
        actorName = v.username;
      }
    }

    const shareToken = body.shareToken ? String(body.shareToken).trim() : '';
    if (!actorId) {
      // Public callers may record only a view of the exact, currently-live share
      // link they possess. All other event types require a staff session.
      if (eventType !== 'share_view' || !VALID_SHARE_TOKEN.test(shareToken)) {
        return json({ error: 'authentication required' }, 401);
      }
      const { data: link, error: linkError } = await supabase
        .from('template_share_links')
        .select('template_id, expires_at, revoked_at')
        .eq('token', shareToken)
        .eq('template_id', templateId)
        .maybeSingle();
      if (linkError || !link || link.revoked_at ||
          (link.expires_at && new Date(link.expires_at).getTime() < Date.now())) {
        return json({ error: 'share link unavailable' }, 403);
      }

      const ip = getClientIp(req);
      if (!(await enforceIpQuota(supabase, ip, 'template_analytics_log', { limit: 60, windowMs: 60_000 })).ok ||
          !(await enforceKeyQuota(supabase, shareToken, 'template_analytics_share', { limit: 300, windowMs: 60 * 60_000 })).ok) {
        return json({ error: 'rate_limited' }, 429);
      }
    }

    const metadata = (body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata))
      ? body.metadata
      : {};
    if (new TextEncoder().encode(JSON.stringify(metadata)).byteLength > MAX_METADATA_BYTES) {
      return json({ error: 'metadata too large' }, 413);
    }

    const row = {
      template_id: templateId,
      event_type: eventType,
      template_version: Number.isFinite(body.templateVersion) ? Number(body.templateVersion) : null,
      page_id: body.pageId ? String(body.pageId).slice(0, 200) : null,
      block_id: body.blockId ? String(body.blockId).slice(0, 200) : null,
      share_token: shareToken ? shareToken.slice(0, 200) : null,
      actor_id: actorId,
      actor_name: actorName,
      metadata,
    };
    const { error } = await supabase.from('template_events').insert(row);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // All read ops require an authenticated staff session.
  const sessionToken = req.headers.get('x-session-token') || body.session_token || null;
  const v = await verifySession(supabase, sessionToken);
  if (v.error) return json({ error: v.error }, 401);

  if (!templateId) return json({ error: 'templateId is required' }, 400);
  const days = Math.max(1, Math.min(365, Number(body.days) || 30));
  const since = sinceISO(days);

  try {
    if (op === 'summary') {
      const { data: rows, error } = await supabase
        .from('template_events')
        .select('event_type, actor_id, created_at')
        .eq('template_id', templateId)
        .gte('created_at', since);
      if (error) throw error;
      const byType: Record<string, number> = {};
      const actors = new Set<string>();
      let last: string | null = null;
      (rows || []).forEach((r: any) => {
        byType[r.event_type] = (byType[r.event_type] || 0) + 1;
        if (r.actor_id) actors.add(r.actor_id);
        if (!last || r.created_at > last) last = r.created_at;
      });
      return json({
        days,
        total: rows?.length ?? 0,
        byType,
        uniqueActors: actors.size,
        lastEventAt: last,
      });
    }

    if (op === 'timeline') {
      const { data: rows, error } = await supabase
        .from('template_events')
        .select('event_type, created_at')
        .eq('template_id', templateId)
        .gte('created_at', since);
      if (error) throw error;
      const buckets: Record<string, { date: string; edits: number; renders: number; views: number; other: number }> = {};
      // pre-seed dates
      for (let i = days - 1; i >= 0; i -= 1) {
        const d = fmtDate(new Date(Date.now() - i * 86400000).toISOString());
        buckets[d] = { date: d, edits: 0, renders: 0, views: 0, other: 0 };
      }
      (rows || []).forEach((r: any) => {
        const d = fmtDate(r.created_at);
        const b = buckets[d] || (buckets[d] = { date: d, edits: 0, renders: 0, views: 0, other: 0 });
        if (r.event_type.startsWith('edit')) b.edits += 1;
        else if (r.event_type.startsWith('render')) b.renders += 1;
        else if (r.event_type === 'share_view' || r.event_type === 'preview_open') b.views += 1;
        else b.other += 1;
      });
      return json({ days, timeline: Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date)) });
    }

    if (op === 'heatmap') {
      const { data: rows, error } = await supabase
        .from('template_events')
        .select('page_id, block_id, event_type')
        .eq('template_id', templateId)
        .gte('created_at', since)
        .like('event_type', 'edit%');
      if (error) throw error;
      const pageMap: Record<string, number> = {};
      const blockMap: Record<string, { id: string; pageId: string | null; count: number }> = {};
      (rows || []).forEach((r: any) => {
        if (r.page_id) pageMap[r.page_id] = (pageMap[r.page_id] || 0) + 1;
        if (r.block_id) {
          const key = `${r.page_id || '_'}::${r.block_id}`;
          const cur = blockMap[key] || { id: r.block_id, pageId: r.page_id ?? null, count: 0 };
          cur.count += 1;
          blockMap[key] = cur;
        }
      });
      const pages = Object.entries(pageMap)
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count);
      const blocks = Object.values(blockMap).sort((a, b) => b.count - a.count).slice(0, 20);
      return json({ days, pages, blocks });
    }

    if (op === 'shareViews') {
      const { data: rows, error } = await supabase
        .from('template_events')
        .select('share_token, metadata, created_at')
        .eq('template_id', templateId)
        .eq('event_type', 'share_view')
        .gte('created_at', since);
      if (error) throw error;
      const map: Record<string, { token: string; count: number; lastAt: string | null }> = {};
      (rows || []).forEach((r: any) => {
        const tok = r.share_token || 'unknown';
        const cur = map[tok] || { token: tok, count: 0, lastAt: null };
        cur.count += 1;
        if (!cur.lastAt || r.created_at > cur.lastAt) cur.lastAt = r.created_at;
        map[tok] = cur;
      });
      const tokens = Object.values(map).sort((a, b) => b.count - a.count);
      // Enrich with labels from template_share_links
      if (tokens.length > 0) {
        const { data: links } = await supabase
          .from('template_share_links')
          .select('token, label, mode, expires_at, revoked_at')
          .in('token', tokens.map((t) => t.token));
        const byTok = new Map((links || []).map((l: any) => [l.token, l]));
        tokens.forEach((t) => {
          const meta = byTok.get(t.token);
          if (meta) Object.assign(t, meta);
        });
      }
      return json({ days, tokens, total: rows?.length ?? 0 });
    }

    if (op === 'recent') {
      const limit = Math.max(1, Math.min(200, Number(body.limit) || 50));
      const { data: rows, error } = await supabase
        .from('template_events')
        .select('id, event_type, page_id, block_id, share_token, actor_id, actor_name, metadata, created_at, template_version')
        .eq('template_id', templateId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return json({ events: rows || [] });
    }

    return json({ error: `unknown op: ${op}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[template-analytics]', op, msg);
    return json({ error: msg }, 500);
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
