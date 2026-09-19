/**
 * GHL Marketing Raw Dump — ENRICHED
 *
 * Aggressively pulls every byte of data we can from GHL's REST surface
 * (v1 + v2 LeadConnector endpoints) for forms, surveys/quizzes, funnels,
 * funnel pages and workflows — then enriches with:
 *   - Submissions sample (forms / surveys)
 *   - Workflow versions, triggers, actions, enrollment counts
 *   - Funnel domains, redirects, custom CSS/JS
 *   - Live page rendering via Firecrawl (markdown + html + screenshot + links + metadata)
 *     with a plain `fetch` fallback when Firecrawl is unavailable.
 *
 * Stores into `ghl_marketing_raw_dumps` with columns:
 *   raw_payload, html_content, raw_html_content, markdown_content,
 *   css_content, embed_code, screenshot_url, links, metadata,
 *   submissions_sample, enrichment_sources, full_url, fetch_status.
 *
 * Auth: superadmin only (verifyAuth + role check). Service role bypass.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import {
  verifyAuth,
  createCorsHeaders,
  createUnauthorizedResponse,
  createForbiddenResponse,
} from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { getGhlCredentials, validateGhlCredentials, buildGhlHeaders, type GhlAccount } from '../_shared/ghl-account.ts';
import { internalError } from '../_shared/errorResponse.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v2';

interface EndpointTrace { url: string; status: number; ok: boolean; bytes?: number }

interface DumpRow {
  resource_type: 'form' | 'survey' | 'quiz' | 'funnel' | 'funnel_page' | 'workflow';
  ghl_id: string;
  location_id: string;
  name: string | null;
  parent_ghl_id: string | null;
  raw_payload: any;
  html_content: string | null;
  raw_html_content: string | null;
  markdown_content: string | null;
  css_content: string | null;
  embed_code: string | null;
  screenshot_url: string | null;
  links: any | null;
  metadata: any | null;
  submissions_sample: any | null;
  enrichment_sources: any;
  full_url: string | null;
  fetch_status: 'ok' | 'partial' | 'error';
  fetch_error: string | null;
  endpoints_tried: EndpointTrace[];
}

async function ghlGet(path: string, headers: Record<string, string>): Promise<{ url: string; status: number; ok: boolean; body: any; bytes: number }> {
  const url = `${GHL_API_BASE}${path}`;
  try {
    const res = await fetch(url, { method: 'GET', headers });
    const text = await res.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch { /* keep as string */ }
    return { url, status: res.status, ok: res.ok, body, bytes: text.length };
  } catch (e: any) {
    return { url, status: 0, ok: false, body: { error: e.message }, bytes: 0 };
  }
}

/** Try multiple endpoints; collect ALL successful payloads (merged) and all traces. */
async function harvest(paths: string[], headers: Record<string, string>) {
  const tried: EndpointTrace[] = [];
  const successes: any[] = [];
  for (const p of paths) {
    const r = await ghlGet(p, headers);
    tried.push({ url: r.url, status: r.status, ok: r.ok, bytes: r.bytes });
    if (r.ok && r.body && typeof r.body === 'object') successes.push(r.body);
  }
  // Deep-merge keys (last wins) so we accumulate fields from every endpoint
  const merged = successes.reduce((acc, b) => ({ ...acc, ...b }), {});
  return { merged, successes, tried };
}

function pickHtmlCss(payload: any): { html: string | null; css: string | null; embed: string | null } {
  if (!payload || typeof payload !== 'object') return { html: null, css: null, embed: null };
  const html =
    payload.html ?? payload.htmlContent ?? payload.pageHtml ?? payload.body ?? payload.content ??
    payload?.page?.html ?? payload?.data?.html ?? payload?.builder?.html ?? null;
  const css =
    payload.css ?? payload.cssContent ?? payload.styles ?? payload.stylesheet ?? payload.customCss ??
    payload?.page?.css ?? payload?.data?.css ?? payload?.builder?.css ?? null;
  const embed =
    payload.embedCode ?? payload.embed_code ?? payload.embed ?? payload.iframeCode ??
    payload.embedUrl ?? payload.embed_url ?? payload.embedScript ?? null;
  return {
    html: typeof html === 'string' ? html : html ? JSON.stringify(html) : null,
    css: typeof css === 'string' ? css : css ? JSON.stringify(css) : null,
    embed: typeof embed === 'string' ? embed : embed ? JSON.stringify(embed) : null,
  };
}

/** Use Firecrawl to render a live URL with maximum extraction. Falls back to plain fetch. */
async function renderLive(url: string): Promise<{
  html: string | null;
  rawHtml: string | null;
  markdown: string | null;
  screenshot: string | null;
  links: any | null;
  metadata: any | null;
  source: 'firecrawl' | 'fetch' | 'none';
  trace: EndpointTrace;
}> {
  const fcKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (fcKey) {
    try {
      const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${fcKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          formats: ['markdown', 'html', 'rawHtml', 'links', 'screenshot'],
          onlyMainContent: false,
          waitFor: 1500,
        }),
      });
      const text = await res.text();
      let body: any = null;
      try { body = JSON.parse(text); } catch { /* */ }
      const trace: EndpointTrace = { url: `firecrawl:${url}`, status: res.status, ok: res.ok, bytes: text.length };
      if (res.ok && body) {
        const d = body.data || body;
        return {
          html: d.html ?? null,
          rawHtml: d.rawHtml ?? null,
          markdown: d.markdown ?? null,
          screenshot: d.screenshot ?? null,
          links: d.links ?? null,
          metadata: d.metadata ?? null,
          source: 'firecrawl',
          trace,
        };
      }
    } catch (e: any) {
      console.warn(`[raw-dump] firecrawl failed for ${url}: ${e.message}`);
    }
  }
  // fallback — plain fetch
  try {
    const r = await fetch(url, { redirect: 'follow' });
    const t = await r.text();
    return {
      html: r.ok ? t : null,
      rawHtml: r.ok ? t : null,
      markdown: null,
      screenshot: null,
      links: null,
      metadata: null,
      source: r.ok ? 'fetch' : 'none',
      trace: { url: `fetch:${url}`, status: r.status, ok: r.ok, bytes: t.length },
    };
  } catch (e: any) {
    return {
      html: null, rawHtml: null, markdown: null, screenshot: null, links: null, metadata: null,
      source: 'none',
      trace: { url: `fetch:${url}`, status: 0, ok: false },
    };
  }
}

async function dumpAll(supabase: any, account: GhlAccount, opts: { useFirecrawl: boolean }): Promise<{
  inserted: number;
  errors: string[];
  breakdown: Record<string, number>;
}> {
  const creds = getGhlCredentials(account);
  const credErr = validateGhlCredentials(creds);
  if (credErr) throw new Error(credErr);

  const headers = buildGhlHeaders(creds.apiKey!);
  const locationId = creds.locationId!;
  const errors: string[] = [];
  const breakdown: Record<string, number> = { form: 0, survey: 0, quiz: 0, funnel: 0, funnel_page: 0, workflow: 0 };
  const rows: DumpRow[] = [];

  // ── FORMS ──
  try {
    const list = await ghlGet(`/forms/?locationId=${locationId}&limit=500`, headers);
    const items: any[] = list.body?.forms || list.body?.data || [];
    for (const f of items) {
      const id = f.id || f._id;
      const detail = await harvest([
        `/forms/${id}?locationId=${locationId}`,
        `/forms/${id}`,
        `/forms/${id}/fields?locationId=${locationId}`,
        `/forms/builder/${id}?locationId=${locationId}`,
      ], headers);
      // Submissions sample (last 25)
      const subs = await ghlGet(`/forms/submissions?locationId=${locationId}&formId=${id}&limit=25`, headers);
      const submissions = subs.ok ? (subs.body?.submissions || subs.body?.data || subs.body) : null;
      const merged = { ...f, ...detail.merged };
      const { html, css, embed } = pickHtmlCss(merged);
      const fullUrl = merged.url || merged.publicUrl || merged.formUrl || null;

      let live = null as any;
      if (opts.useFirecrawl && fullUrl) live = await renderLive(fullUrl);

      rows.push({
        resource_type: 'form',
        ghl_id: id, location_id: locationId, name: merged.name || null, parent_ghl_id: null,
        raw_payload: merged,
        html_content: html || live?.html || null,
        raw_html_content: live?.rawHtml || null,
        markdown_content: live?.markdown || null,
        css_content: css,
        embed_code: embed,
        screenshot_url: live?.screenshot || null,
        links: live?.links || null,
        metadata: live?.metadata || null,
        submissions_sample: submissions,
        enrichment_sources: { detail_endpoints_ok: detail.successes.length, submissions_ok: subs.ok, live_render: live?.source || 'skipped' },
        full_url: fullUrl,
        fetch_status: detail.successes.length || live?.html ? 'ok' : 'partial',
        fetch_error: null,
        endpoints_tried: [...detail.tried, { url: subs.url, status: subs.status, ok: subs.ok, bytes: subs.bytes }, ...(live ? [live.trace] : [])],
      });
      breakdown.form++;
    }
  } catch (e: any) { errors.push(`forms: ${e.message}`); }

  // ── SURVEYS / QUIZZES ──
  try {
    const list = await ghlGet(`/surveys/?locationId=${locationId}&limit=500`, headers);
    const items: any[] = list.body?.surveys || list.body?.data || [];
    for (const s of items) {
      const id = s.id || s._id;
      const isQuiz = s.isQuiz === true || s.type === 'quiz';
      const detail = await harvest([
        `/surveys/${id}?locationId=${locationId}`,
        `/surveys/${id}`,
        `/surveys/${id}/questions?locationId=${locationId}`,
      ], headers);
      const subs = await ghlGet(`/surveys/submissions?locationId=${locationId}&surveyId=${id}&limit=25`, headers);
      const submissions = subs.ok ? (subs.body?.submissions || subs.body?.data || subs.body) : null;
      const merged = { ...s, ...detail.merged };
      const { html, css, embed } = pickHtmlCss(merged);
      const fullUrl = merged.url || merged.publicUrl || null;
      let live = null as any;
      if (opts.useFirecrawl && fullUrl) live = await renderLive(fullUrl);

      rows.push({
        resource_type: isQuiz ? 'quiz' : 'survey',
        ghl_id: id, location_id: locationId, name: merged.name || null, parent_ghl_id: null,
        raw_payload: merged,
        html_content: html || live?.html || null,
        raw_html_content: live?.rawHtml || null,
        markdown_content: live?.markdown || null,
        css_content: css, embed_code: embed,
        screenshot_url: live?.screenshot || null,
        links: live?.links || null, metadata: live?.metadata || null,
        submissions_sample: submissions,
        enrichment_sources: { detail_endpoints_ok: detail.successes.length, submissions_ok: subs.ok, live_render: live?.source || 'skipped' },
        full_url: fullUrl,
        fetch_status: detail.successes.length || live?.html ? 'ok' : 'partial',
        fetch_error: null,
        endpoints_tried: [...detail.tried, { url: subs.url, status: subs.status, ok: subs.ok, bytes: subs.bytes }, ...(live ? [live.trace] : [])],
      });
      breakdown[isQuiz ? 'quiz' : 'survey']++;
    }
  } catch (e: any) { errors.push(`surveys: ${e.message}`); }

  // ── FUNNELS + PAGES ──
  try {
    const list = await ghlGet(`/funnels/funnel/list?locationId=${locationId}`, headers);
    const funnels: any[] = list.body?.funnels || list.body?.data || [];
    for (const fn of funnels) {
      const fid = fn._id || fn.id;
      const detail = await harvest([
        `/funnels/funnel/${fid}?locationId=${locationId}`,
        `/funnels/${fid}`,
        `/funnels/funnel/${fid}/redirect/list?locationId=${locationId}`,
      ], headers);
      const fullFn = { ...fn, ...detail.merged };

      rows.push({
        resource_type: 'funnel',
        ghl_id: fid, location_id: locationId, name: fullFn.name || null, parent_ghl_id: null,
        raw_payload: fullFn,
        html_content: null, raw_html_content: null, markdown_content: null,
        css_content: fullFn.customCss || null, embed_code: null,
        screenshot_url: null, links: null, metadata: null, submissions_sample: null,
        enrichment_sources: { detail_endpoints_ok: detail.successes.length },
        full_url: fullFn.domain ? `https://${fullFn.domain}` : null,
        fetch_status: detail.successes.length ? 'ok' : 'partial',
        fetch_error: null,
        endpoints_tried: detail.tried,
      });
      breakdown.funnel++;

      const pages: any[] = fullFn.steps || fullFn.pages || [];
      for (let i = 0; i < pages.length; i++) {
        const pg = pages[i];
        const pid = pg._id || pg.id;
        if (!pid) continue;
        const pgDetail = await harvest([
          `/funnels/page/${pid}?locationId=${locationId}`,
          `/funnels/page/${pid}`,
          `/funnels/funnel/${fid}/page/${pid}?locationId=${locationId}`,
          `/funnels/page/${pid}/builder?locationId=${locationId}`,
          `/funnels/lookup/redirect?locationId=${locationId}&id=${pid}`,
        ], headers);
        const fullPg = { ...pg, ...pgDetail.merged };
        const { html, css, embed } = pickHtmlCss(fullPg);
        const slug = fullPg.path || fullPg.slug || fullPg.url || null;
        const pageUrl = fullPg.fullUrl || (fullFn.domain && slug ? `https://${fullFn.domain}/${slug}` : null);

        let live = null as any;
        if (opts.useFirecrawl && pageUrl) live = await renderLive(pageUrl);

        rows.push({
          resource_type: 'funnel_page',
          ghl_id: pid, location_id: locationId,
          name: fullPg.name || fullPg.stepName || `Page ${i + 1}`,
          parent_ghl_id: fid,
          raw_payload: fullPg,
          html_content: html || live?.html || null,
          raw_html_content: live?.rawHtml || null,
          markdown_content: live?.markdown || null,
          css_content: css,
          embed_code: embed,
          screenshot_url: live?.screenshot || null,
          links: live?.links || null,
          metadata: live?.metadata || null,
          submissions_sample: null,
          enrichment_sources: { detail_endpoints_ok: pgDetail.successes.length, live_render: live?.source || 'skipped' },
          full_url: pageUrl,
          fetch_status: (html || live?.html || pgDetail.successes.length) ? 'ok' : 'partial',
          fetch_error: null,
          endpoints_tried: [...pgDetail.tried, ...(live ? [live.trace] : [])],
        });
        breakdown.funnel_page++;
      }
    }
  } catch (e: any) { errors.push(`funnels: ${e.message}`); }

  // ── WORKFLOWS (enriched) ──
  try {
    const list = await ghlGet(`/workflows/?locationId=${locationId}`, headers);
    const items: any[] = list.body?.workflows || list.body?.data || [];
    for (const wf of items) {
      const wfid = wf.id || wf._id;
      // Try a much wider set of endpoints — many are undocumented but the
      // LeadConnector UI hits them; if they 404 we just record the trace.
      const detail = await harvest([
        `/workflows/${wfid}?locationId=${locationId}`,
        `/workflows/${wfid}`,
        `/workflows/${wfid}/versions?locationId=${locationId}`,
        `/workflows/${wfid}/triggers?locationId=${locationId}`,
        `/workflows/${wfid}/actions?locationId=${locationId}`,
        `/workflows/${wfid}/steps?locationId=${locationId}`,
        `/workflows/${wfid}/enrollments?locationId=${locationId}&limit=25`,
        `/workflows/${wfid}/stats?locationId=${locationId}`,
      ], headers);
      const merged = { ...wf, ...detail.merged };
      const status = detail.successes.length > 0 ? 'ok' : 'partial';
      rows.push({
        resource_type: 'workflow',
        ghl_id: wfid, location_id: locationId, name: merged.name || null, parent_ghl_id: null,
        raw_payload: merged,
        html_content: null, raw_html_content: null, markdown_content: null,
        css_content: null, embed_code: null, screenshot_url: null,
        links: null, metadata: null, submissions_sample: null,
        enrichment_sources: { detail_endpoints_ok: detail.successes.length, note: 'GHL public API limits workflow internals — only what came back is stored' },
        full_url: null,
        fetch_status: status,
        fetch_error: status === 'partial' ? 'GHL public API returned only metadata; deeper endpoints 404/403' : null,
        endpoints_tried: detail.tried,
      });
      breakdown.workflow++;
    }
  } catch (e: any) { errors.push(`workflows: ${e.message}`); }

  // Upsert in batches
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 25) {
    const batch = rows.slice(i, i + 25).map((r) => ({ ...r, last_fetched_at: new Date().toISOString() }));
    const { error } = await supabase
      .from('ghl_marketing_raw_dumps')
      .upsert(batch, { onConflict: 'resource_type,ghl_id' });
    if (error) errors.push(`upsert batch ${i}: ${error.message}`);
    else inserted += batch.length;
  }

  return { inserted, errors, breakdown };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = await req.json().catch(() => ({}));

    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) return createUnauthorizedResponse(authError || 'Auth required', corsHeaders);

    if (userId !== 'service_role') {
      const { data: roles } = await supabase.from('user_roles').select('role').eq('user_id', userId);
      const isSuper = (roles || []).some((r: any) => r.role === 'superadmin');
      if (!isSuper) return createForbiddenResponse('Superadmin access required', corsHeaders);
    }

    const action = body.action || 'list';
    const account: GhlAccount = body.account === 'new' ? 'new' : 'legacy';
    const useFirecrawl = body.use_firecrawl !== false; // default ON

    if (action === 'job_status') {
      const jobId = body.job_id;
      if (!jobId) throw new Error('job_id required');
      const { data, error } = await supabase
        .from('ghl_marketing_dump_jobs')
        .select('id,status,account,total_assets,processed_assets,failed_assets,current_label,started_at,finished_at,error_log,requested_resources,use_firecrawl,download_assets,created_at')
        .eq('id', jobId).single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, job: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'recent_jobs') {
      const { data, error } = await supabase
        .from('ghl_marketing_dump_jobs')
        .select('id,status,total_assets,processed_assets,failed_assets,started_at,finished_at,created_at,current_label')
        .order('created_at', { ascending: false }).limit(10);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, jobs: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'workflow_bridge_list') {
      const { data, error } = await supabase
        .from('ghl_workflow_snapshot_bridge')
        .select('*').order('legacy_name', { ascending: true });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, rows: data || [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'workflow_bridge_update') {
      const { id, new_workflow_id, status, notes } = body;
      if (!id) throw new Error('id required');
      const upd: any = {};
      if (new_workflow_id !== undefined) upd.new_workflow_id = new_workflow_id;
      if (status !== undefined) upd.status = status;
      if (notes !== undefined) upd.notes = notes;
      const { error } = await supabase.from('ghl_workflow_snapshot_bridge').update(upd).eq('id', id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'asset_signed_url') {
      const path: string = body.path;
      if (!path) throw new Error('path required');
      const { data, error } = await supabase.storage.from('ghl-marketing-dump').createSignedUrl(path, 60 * 60);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, url: data.signedUrl }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'detail') {
      const { id } = body;
      if (!id) throw new Error('id required');
      const { data, error } = await supabase.from('ghl_marketing_raw_dumps').select('*').eq('id', id).single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, row: data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'dump') {
      const result = await dumpAll(supabase, account, { useFirecrawl });
      return new Response(JSON.stringify({ success: true, account, firecrawl: useFirecrawl && !!Deno.env.get('FIRECRAWL_API_KEY'), ...result }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'export') {
      const { data, error } = await supabase
        .from('ghl_marketing_raw_dumps')
        .select('*')
        .order('resource_type', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, count: data?.length || 0, rows: data }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // default: list (summary)
    const { data, error } = await supabase
      .from('ghl_marketing_raw_dumps')
      .select('id,resource_type,ghl_id,name,parent_ghl_id,full_url,fetch_status,fetch_error,last_fetched_at,html_content,raw_html_content,markdown_content,css_content,embed_code,screenshot_url,links,metadata,submissions_sample,enrichment_sources,portable_html_path,inlined_css,asset_count,asset_bytes,asset_manifest')
      .order('resource_type', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw error;
    const summary = (data || []).map((r: any) => ({
      id: r.id,
      resource_type: r.resource_type,
      ghl_id: r.ghl_id,
      name: r.name,
      parent_ghl_id: r.parent_ghl_id,
      full_url: r.full_url,
      fetch_status: r.fetch_status,
      fetch_error: r.fetch_error,
      last_fetched_at: r.last_fetched_at,
      enrichment_sources: r.enrichment_sources,
      has_html: !!r.html_content,
      has_raw_html: !!r.raw_html_content,
      has_markdown: !!r.markdown_content,
      has_css: !!r.css_content,
      has_inlined_css: !!r.inlined_css,
      has_embed: !!r.embed_code,
      has_screenshot: !!r.screenshot_url,
      has_links: !!r.links,
      has_metadata: !!r.metadata,
      has_submissions: !!r.submissions_sample,
      has_portable: !!r.portable_html_path,
      asset_count: r.asset_count || 0,
      asset_bytes: r.asset_bytes || 0,
    }));
    const counts: Record<string, number> = {};
    for (const r of summary) counts[r.resource_type] = (counts[r.resource_type] || 0) + 1;
    return new Response(JSON.stringify({ success: true, counts, rows: summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[ghl-marketing-raw-dump] error:', e);
    return new Response(JSON.stringify({ ...internalError(e, 'ghl-marketing-raw-dump'), success: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
