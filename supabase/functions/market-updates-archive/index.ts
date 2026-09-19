// Archived News read + restore contract.
//
// Why this function exists rather than reusing `market-updates-status`:
// the archive surface repeatedly rendered empty because the shared, heavily
// multiplexed status function ships stale in cached bundles (the same failure
// mode that forced `notifications-feed-v2`). This is a small, single-purpose
// function with a self-contained CSRF allowlist so the archive page has an
// authoritative endpoint of its own.
//
// Actions:
//   list              { page?, pageSize?, search?, sort?, source?, category?, impact?, geography?, audience? }
//   set_archive_state { updateId: UUID, archived: boolean }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { createCorsHeaders, verifyAuth } from '../_shared/auth.ts';
import { enforceCsrf } from '../_shared/csrfGuard.ts';
import { requireModulePermission } from '../_shared/authz.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';

const ARCHIVE_COLUMNS = 'id,correlation_id,source_id,source_name,source_url,canonical_url,original_url,source_authority,source_perspective,author,public_excerpt,source_published_at,ingested_at,title,slug,category,segments,freshness_tier,geography,impact_level,audience_tags,ai_summary,key_points,why_it_matters,property_implications,finance_implications,policy_implications,risk_flags,lending_criteria_tags,legal_topics,economic_topics,legal_status,effective_date,citation_urls,status,publication_reason,ai_status,dedupe_hash,visibility,created_at,updated_at,archived_at,archived_by,pre_archive_status';

const LOVABLE_PROJECT_ID = '7976d60b-c277-4851-889b-c170285f4be2';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

// PostgREST `or` expressions treat comma/parentheses as syntax and ilike uses
// percent/underscore as wildcards. Archive search is literal and bounded.
function archiveSearch(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 120).replace(/[,%_()\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

Deno.serve(async (req) => {
  const cors = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  let correlationId = crypto.randomUUID();
  const json = (payload: unknown, status = 200) => new Response(
    JSON.stringify(payload),
    { status, headers: { ...cors, 'Content-Type': 'application/json', 'cache-control': 'private, no-store', 'x-correlation-id':correlationId } },
  );

  const csrf = csrfCheck(req);
  if (!csrf.ok) return json({ error: 'CSRF check failed', code: 'csrf_denied', reason: csrf.reason, origin: csrf.origin ?? null }, 403);
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if(typeof body.correlation_id==='string'&&UUID.test(body.correlation_id))correlationId=body.correlation_id;
    const sb = admin();

    let auth = await verifyAuth(sb, req.headers, {});
    if (auth.error || !auth.userId) auth = await verifyAuth(sb, req.headers, body as { session_token?: string });
    if (auth.error || !auth.userId || auth.userId === 'service_role') return json({ok:false,error:{code:'AUTHENTICATION_REQUIRED',message:'Authentication is required.'},correlationId},401);

    // Market News Feed is a Scale-or-add-on capability — enforced server-side.
    const entitlement = await requireWorkspaceCapability(sb, auth, 'market-updates');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, cors);

    const view = await requireModulePermission(sb, { userId: auth.userId, authMethod: auth.authMethod }, 'market_updates', 'can_view');
    if (!view.ok) return json({ok:false,error:{code:'MARKET_UPDATES_VIEW_REQUIRED',message:'Market News Feed view permission is required.'},correlationId},403);

    const action = String(body.action ?? 'list');

    if (action === 'set_archive_state') {
      const id = typeof body.updateId==='string'?body.updateId:'';
      if (!UUID.test(id)) return json({ok:false,error:{code:'INVALID_UPDATE_ID',message:'A valid market news update ID is required.'},correlationId},400);
      if(typeof body.archived!=='boolean')return json({ok:false,error:{code:'INVALID_ARCHIVE_STATE',message:'An archive state is required.'},correlationId},400);
      const edit = await requireModulePermission(sb, { userId: auth.userId, authMethod: auth.authMethod }, 'market_updates', 'can_edit');
      if (!edit.ok) return json({ok:false,error:{code:'MARKET_UPDATES_EDIT_REQUIRED',message:'Market News Feed edit permission is required.'},correlationId},403);
      const { data: row, error: readError } = await sb.from('market_updates').select('id,status,archived_at,pre_archive_status').eq('id', id).maybeSingle();
      if (readError) {
        console.error(JSON.stringify({function:'market-updates-archive',stage:'read',operation:body.archived?'archive':'restore',update_id:id,correlation_id:correlationId,error_class:'database_read_failed'}));
        return json({ok:false,error:{code:'MARKET_NEWS_READ_FAILED',message:'The market news item could not be loaded.'},correlationId},500);
      }
      if (!row) return json({ok:false,error:{code:'MARKET_NEWS_NOT_FOUND',message:'The market news item was not found.'},correlationId},404);
      const now = new Date().toISOString();
      const wantsArchived=body.archived;
      if(wantsArchived===Boolean(row.archived_at)){
        const outcome=wantsArchived?'already_archived':'already_restored';
        return json({ok:true,data:{id,isArchived:wantsArchived,archivedAt:row.archived_at,outcome},correlationId},200);
      }
      const restoredStatus=row.pre_archive_status??row.status??'published';
      let update=sb.from('market_updates').update(wantsArchived
        ?{archived_at:now,archived_by:auth.userId,pre_archive_status:row.status,decisioned_at:now,updated_at:now}
        :{archived_at:null,archived_by:null,pre_archive_status:null,status:restoredStatus,decisioned_at:now,updated_at:now})
        .eq('id',id);
      update=wantsArchived?update.is('archived_at',null):update.not('archived_at','is',null);
      const {data:updated,error:updateError}=await update.select('id,archived_at').maybeSingle();
      if(updateError){
        console.error(JSON.stringify({function:'market-updates-archive',stage:'write',operation:wantsArchived?'archive':'restore',update_id:id,correlation_id:correlationId,error_class:'database_update_failed'}));
        return json({ok:false,error:{code:'MARKET_NEWS_WRITE_FAILED',message:'The archive state could not be updated.'},correlationId},500);
      }
      if(!updated)return json({ok:false,error:{code:'ARCHIVE_STATE_CHANGED',message:'The market news item changed before the operation completed.'},correlationId},409);
      const outcome=wantsArchived?'archived':'restored';
      return json({ok:true,data:{id,isArchived:wantsArchived,archivedAt:updated.archived_at,outcome},correlationId},200);
    }

    if (action !== 'list') return json({ error: 'Unknown action', code: 'invalid_request' }, 400);


    const page = Math.max(1, Math.floor(Number(body.page) || 1));
    const pageSize = Math.max(10, Math.min(50, Math.floor(Number(body.pageSize) || 20)));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const search = archiveSearch(body.search);
    const sort = body.sort === 'published_desc' ? 'published_desc' : 'archived_desc';

    let query = sb.from('market_updates').select(ARCHIVE_COLUMNS, { count: 'exact' }).not('archived_at', 'is', null);
    if (search) query = query.or(`title.ilike.%${search}%,source_name.ilike.%${search}%,ai_summary.ilike.%${search}%`);
    if (typeof body.source === 'string' && body.source !== 'all') query = query.eq('source_name', body.source);
    if (typeof body.category === 'string' && body.category !== 'all') query = query.eq('category', body.category);
    if (typeof body.impact === 'string' && body.impact !== 'all') query = query.eq('impact_level', body.impact);
    if (typeof body.geography === 'string' && body.geography !== 'all') query = query.contains('geography', [body.geography]);
    if (typeof body.audience === 'string' && body.audience !== 'all') query = query.contains('audience_tags', [body.audience]);
    query = query
      .order(sort === 'published_desc' ? 'source_published_at' : 'archived_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: false })
      .range(from, to);

    const { data, count, error } = await query;
    if (error) {
      console.error(JSON.stringify({ function: 'market-updates-archive', stage: 'list', error: error.message }));
      return json({ error: 'Archived News could not be loaded.', code: 'market_updates_read_failed', retryable: true }, 500);
    }

    const items = data ?? [];
    return json({
      archive: { items, count: count ?? 0, page, pageSize, hasMore: to + 1 < (count ?? 0) },
    }, 200);
  } catch (error) {
    console.error(JSON.stringify({ function: 'market-updates-archive', error: String((error as Error)?.message ?? error) }));
    return json({ error: 'Archived News could not be loaded.', code: 'market_updates_read_failed', retryable: true }, 500);
  }
});
