/**
 * GHL Legacy Account Wipe — Worker
 *
 * Processes one job from `legacy_wipe_jobs`. Iterates resources in dependency
 * order, paginating through each, and (for live runs) DELETEing every record
 * in the LEGACY GHL location. On success, calls finalize_ghl_cutover() so the
 * resolver flips the default account to 'new'.
 *
 * Resumable: works against a soft 110s time budget. If it can't finish in one
 * leg, it releases the lock and self-redispatches.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
import {
  getGhlCredentials,
  buildGhlHeaders,
  resolveGhlAccessTokenForLocation,
} from '../_shared/ghl-account.ts';

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const TIME_BUDGET_MS = 110_000;
const PAGE_LIMIT = 100;

// Resource order: things that depend on contacts deleted FIRST so contacts
// (the heaviest list) come last and the cascade isn't fighting us.
const RESOURCE_ORDER = [
  'opportunities',
  'workflows',          // best-effort — may have no DELETE endpoint
  'forms',              // best-effort
  'appointments',       // events / bookings (per calendar)
  'calendars',
  'calendar_groups',
  'tags',
  'custom_fields',
  'custom_values',
  'pipelines',          // delete pipelines (also drops stages)
  'contacts',           // LAST
] as const;

type Resource = typeof RESOURCE_ORDER[number];

interface ResourceProgress {
  found: number;
  deleted: number;
  failed: number;
  skipped_no_endpoint: boolean;
  done: boolean;
  errors: string[]; // capped sample
  cursor?: any;
}

interface JobProgress {
  [r: string]: ResourceProgress;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  const startTs = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let jobId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError || !userId) {
      return createUnauthorizedResponse(authError || 'Auth required', corsHeaders);
    }
    // Worker only accepts service-role-authenticated calls
    if (userId !== 'service_role') {
      return new Response(JSON.stringify({ error: 'Worker is internal-only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    jobId = body.job_id;
    if (!jobId) throw new Error('Missing job_id');

    const { data: job, error: jobErr } = await supabase
      .from('legacy_wipe_jobs').select('*').eq('id', jobId).single();
    if (jobErr || !job) throw new Error(`Job not found: ${jobErr?.message || 'no row'}`);

    if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
      console.log(`[legacy-wipe-worker] job ${jobId} already ${job.status} — exiting`);
      return ok(corsHeaders, { skipped: true, status: job.status });
    }

    const dryRun = !!job.dry_run;
    const progress: JobProgress = (job.progress as JobProgress) || {};
    const completed = new Set<string>(job.resources_completed || []);

    // Resolve legacy creds + token (with optional sub-account exchange)
    const creds = getGhlCredentials('legacy');
    if (!creds.apiKey || !creds.locationId) {
      throw new Error('Legacy GHL credentials missing');
    }
    const resolved = await resolveGhlAccessTokenForLocation(creds);
    const headers = buildGhlHeaders(resolved.accessToken);
    const locationId = creds.locationId;

    let totalDeleted = job.total_deleted || 0;
    let totalFailed = job.total_failed || 0;

    for (const resource of RESOURCE_ORDER) {
      if (completed.has(resource)) continue;
      if (Date.now() - startTs > TIME_BUDGET_MS) break;

      await supabase.from('legacy_wipe_jobs').update({
        current_resource: resource,
        worker_lock_until: new Date(Date.now() + 180_000).toISOString(),
      }).eq('id', jobId);

      const rp: ResourceProgress = progress[resource] || {
        found: 0, deleted: 0, failed: 0, skipped_no_endpoint: false, done: false, errors: [],
      };

      try {
        await processResource({
          resource, headers, locationId, dryRun, rp, deadline: startTs + TIME_BUDGET_MS,
        });
      } catch (e: any) {
        rp.errors.push(`fatal: ${String(e.message || e).substring(0, 240)}`);
        rp.errors = rp.errors.slice(-10);
      }

      progress[resource] = rp;
      if (rp.done) completed.add(resource);
      totalDeleted += 0; // recomputed below

      // Recompute totals from progress
      totalDeleted = Object.values(progress).reduce((s, p) => s + (p.deleted || 0), 0);
      totalFailed = Object.values(progress).reduce((s, p) => s + (p.failed || 0), 0);

      await supabase.from('legacy_wipe_jobs').update({
        progress, resources_completed: Array.from(completed),
        total_deleted: totalDeleted, total_failed: totalFailed,
        worker_lock_until: new Date(Date.now() + 180_000).toISOString(),
      }).eq('id', jobId);

      if (Date.now() - startTs > TIME_BUDGET_MS) break;
    }

    const allDone = RESOURCE_ORDER.every((r) => completed.has(r));

    if (allDone) {
      await supabase.from('legacy_wipe_jobs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        current_resource: null,
        worker_lock_until: null,
      }).eq('id', jobId);

      // Finalise cutover for live runs only
      if (!dryRun) {
        const { data: cutover, error: cutoverErr } = await supabase.rpc('finalize_ghl_cutover', { p_job_id: jobId });
        if (cutoverErr) {
          console.error(`[legacy-wipe-worker] finalize_ghl_cutover failed: ${cutoverErr.message}`);
        } else {
          console.log(`[legacy-wipe-worker] cutover finalised:`, cutover);
        }
      }

      return ok(corsHeaders, { done: true, totalDeleted, totalFailed, dryRun });
    }

    // Not done — release the lease and self-redispatch
    await supabase.from('legacy_wipe_jobs').update({
      worker_lock_until: null,
      dispatch_count: (job.dispatch_count || 0) + 1,
    }).eq('id', jobId);

    const _anon = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
    const _internalSecret = (Deno.env.get('INTERNAL_EDGE_SECRET') || '').trim();
    const dispatch = fetch(`${supabaseUrl}/functions/v1/ghl-legacy-wipe-worker`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // AUTH-002: internal secret, not the service-role key.
        Authorization: `Bearer ${_anon}`,
        ...(_internalSecret ? { 'x-internal-edge-secret': _internalSecret } : {}),
        'x-internal-call': 'true',
      },
      body: JSON.stringify({ job_id: jobId }),
    }).catch((e) => console.error(`[legacy-wipe-worker] re-dispatch threw:`, e.message));

    // @ts-ignore
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(dispatch);
    }

    return ok(corsHeaders, { done: false, redispatched: true, totalDeleted, totalFailed });
  } catch (err: any) {
    console.error('[legacy-wipe-worker] fatal error:', err);
    if (jobId) {
      await supabase.from('legacy_wipe_jobs').update({
        status: 'failed',
        last_error: String(err.message || err).substring(0, 1000),
        completed_at: new Date().toISOString(),
        worker_lock_until: null,
      }).eq('id', jobId);
    }
    return new Response(JSON.stringify({ ...internalError(err, 'ghl-legacy-wipe-worker'), success: false }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function ok(corsHeaders: Record<string, string>, payload: any) {
  return new Response(JSON.stringify({ success: true, ...payload }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── Per-resource processors ─────────────────────────────────────────────

interface ProcessCtx {
  resource: Resource;
  headers: Record<string, string>;
  locationId: string;
  dryRun: boolean;
  rp: ResourceProgress;
  deadline: number;
}

async function processResource(ctx: ProcessCtx) {
  switch (ctx.resource) {
    case 'opportunities': return wipeOpportunities(ctx);
    case 'workflows':     return wipeWorkflows(ctx);
    case 'forms':         return wipeForms(ctx);
    case 'appointments':  return wipeAppointments(ctx);
    case 'calendars':     return wipeCalendars(ctx);
    case 'calendar_groups': return wipeCalendarGroups(ctx);
    case 'tags':          return wipeTags(ctx);
    case 'custom_fields': return wipeCustomFields(ctx);
    case 'custom_values': return wipeCustomValues(ctx);
    case 'pipelines':     return wipePipelines(ctx);
    case 'contacts':      return wipeContacts(ctx);
  }
}

async function paginatedDelete(opts: {
  ctx: ProcessCtx;
  listUrl: (cursor: any) => string;
  itemsKey: string;        // JSON path to array (top-level key)
  idKey?: string;          // default 'id'
  nextCursor?: (resp: any, items: any[]) => any | null;
  deleteUrl: (id: string) => string;
}) {
  const { ctx } = opts;
  const idKey = opts.idKey || 'id';
  let cursor = ctx.rp.cursor ?? null;

  while (Date.now() < ctx.deadline) {
    const url = opts.listUrl(cursor);
    const listRes = await fetch(url, { headers: ctx.headers });
    if (!listRes.ok) {
      const t = await listRes.text();
      throw new Error(`LIST ${ctx.resource} failed ${listRes.status}: ${t.substring(0, 200)}`);
    }
    const data = await listRes.json();
    const items: any[] = Array.isArray(data?.[opts.itemsKey]) ? data[opts.itemsKey] : [];
    ctx.rp.found += items.length;

    if (items.length === 0) {
      ctx.rp.done = true;
      ctx.rp.cursor = null;
      return;
    }

    if (ctx.dryRun) {
      // dry-run: count only, then advance
      cursor = opts.nextCursor ? opts.nextCursor(data, items) : null;
      ctx.rp.cursor = cursor;
      if (!cursor) { ctx.rp.done = true; return; }
      continue;
    }

    for (const it of items) {
      if (Date.now() >= ctx.deadline) break;
      const id = it?.[idKey];
      if (!id) { ctx.rp.failed++; continue; }
      try {
        const delRes = await fetch(opts.deleteUrl(id), { method: 'DELETE', headers: ctx.headers });
        if (delRes.ok || delRes.status === 404) {
          ctx.rp.deleted++;
        } else {
          ctx.rp.failed++;
          if (ctx.rp.errors.length < 10) {
            const t = await delRes.text();
            ctx.rp.errors.push(`${id}: ${delRes.status} ${t.substring(0, 120)}`);
          }
        }
      } catch (e: any) {
        ctx.rp.failed++;
        if (ctx.rp.errors.length < 10) ctx.rp.errors.push(`${id}: ${String(e.message).substring(0, 120)}`);
      }
    }

    // After deleting a page we usually want to re-fetch page 0 (since records
    // are gone). For cursor-paginated APIs use nextCursor.
    cursor = opts.nextCursor ? opts.nextCursor(data, items) : null;
    ctx.rp.cursor = cursor;
    if (!cursor) {
      // Re-list once more to confirm zero remaining
      const verifyRes = await fetch(opts.listUrl(null), { headers: ctx.headers });
      if (verifyRes.ok) {
        const v = await verifyRes.json();
        const remaining: any[] = Array.isArray(v?.[opts.itemsKey]) ? v[opts.itemsKey] : [];
        if (remaining.length === 0) { ctx.rp.done = true; return; }
      } else {
        ctx.rp.done = true;
        return;
      }
    }
  }
}

// ─── Concrete resource implementations ──────────────────────────────────

async function wipeOpportunities(ctx: ProcessCtx) {
  await paginatedDelete({
    ctx,
    listUrl: (cur) => {
      const u = new URL(`${GHL_API_BASE}/opportunities/search`);
      u.searchParams.set('location_id', ctx.locationId);
      u.searchParams.set('limit', String(PAGE_LIMIT));
      if (cur) u.searchParams.set('startAfterId', String(cur));
      return u.toString();
    },
    itemsKey: 'opportunities',
    nextCursor: (_resp, items) => items.length === PAGE_LIMIT ? items[items.length - 1]?.id : null,
    deleteUrl: (id) => `${GHL_API_BASE}/opportunities/${id}`,
  });
}

async function wipeContacts(ctx: ProcessCtx) {
  await paginatedDelete({
    ctx,
    listUrl: (_cur) => `${GHL_API_BASE}/contacts/?locationId=${ctx.locationId}&limit=${PAGE_LIMIT}`,
    itemsKey: 'contacts',
    nextCursor: (_resp, items) => items.length === PAGE_LIMIT ? 'next' : null,
    deleteUrl: (id) => `${GHL_API_BASE}/contacts/${id}`,
  });
}

async function wipePipelines(ctx: ProcessCtx) {
  // GHL pipelines list
  const listRes = await fetch(`${GHL_API_BASE}/opportunities/pipelines?locationId=${ctx.locationId}`, { headers: ctx.headers });
  if (!listRes.ok) {
    if (listRes.status === 404 || listRes.status === 405) { ctx.rp.skipped_no_endpoint = true; ctx.rp.done = true; return; }
    throw new Error(`pipelines list ${listRes.status}`);
  }
  const data = await listRes.json();
  const items: any[] = data?.pipelines || [];
  ctx.rp.found = items.length;
  if (ctx.dryRun) { ctx.rp.done = true; return; }
  for (const p of items) {
    if (Date.now() >= ctx.deadline) return;
    const id = p?.id; if (!id) continue;
    try {
      const r = await fetch(`${GHL_API_BASE}/opportunities/pipelines/${id}?locationId=${ctx.locationId}`, { method: 'DELETE', headers: ctx.headers });
      if (r.ok || r.status === 404) ctx.rp.deleted++;
      else { ctx.rp.failed++; if (ctx.rp.errors.length < 10) ctx.rp.errors.push(`${id}: ${r.status}`); }
    } catch (e: any) { ctx.rp.failed++; }
  }
  ctx.rp.done = true;
}

async function wipeCalendarGroups(ctx: ProcessCtx) {
  const listRes = await fetch(`${GHL_API_BASE}/calendars/groups?locationId=${ctx.locationId}`, { headers: ctx.headers });
  if (!listRes.ok) {
    if (listRes.status === 404) { ctx.rp.skipped_no_endpoint = true; ctx.rp.done = true; return; }
    throw new Error(`calendar groups list ${listRes.status}`);
  }
  const data = await listRes.json();
  const items: any[] = data?.groups || [];
  ctx.rp.found = items.length;
  if (ctx.dryRun) { ctx.rp.done = true; return; }
  for (const g of items) {
    if (Date.now() >= ctx.deadline) return;
    const id = g?.id; if (!id) continue;
    const r = await fetch(`${GHL_API_BASE}/calendars/groups/${id}`, { method: 'DELETE', headers: ctx.headers });
    if (r.ok || r.status === 404) ctx.rp.deleted++;
    else { ctx.rp.failed++; if (ctx.rp.errors.length < 10) ctx.rp.errors.push(`${id}: ${r.status}`); }
  }
  ctx.rp.done = true;
}

async function wipeCalendars(ctx: ProcessCtx) {
  const listRes = await fetch(`${GHL_API_BASE}/calendars/?locationId=${ctx.locationId}`, { headers: ctx.headers });
  if (!listRes.ok) {
    if (listRes.status === 404) { ctx.rp.skipped_no_endpoint = true; ctx.rp.done = true; return; }
    throw new Error(`calendars list ${listRes.status}`);
  }
  const data = await listRes.json();
  const items: any[] = data?.calendars || [];
  ctx.rp.found = items.length;
  if (ctx.dryRun) { ctx.rp.done = true; return; }
  for (const c of items) {
    if (Date.now() >= ctx.deadline) return;
    const id = c?.id; if (!id) continue;
    const r = await fetch(`${GHL_API_BASE}/calendars/${id}`, { method: 'DELETE', headers: ctx.headers });
    if (r.ok || r.status === 404) ctx.rp.deleted++;
    else { ctx.rp.failed++; if (ctx.rp.errors.length < 10) ctx.rp.errors.push(`${id}: ${r.status}`); }
  }
  ctx.rp.done = true;
}

async function wipeAppointments(ctx: ProcessCtx) {
  // Per-calendar enumeration of appointments. If calendars already wiped, this is a no-op.
  const calRes = await fetch(`${GHL_API_BASE}/calendars/?locationId=${ctx.locationId}`, { headers: ctx.headers });
  if (!calRes.ok) { ctx.rp.skipped_no_endpoint = true; ctx.rp.done = true; return; }
  const calData = await calRes.json();
  const calendars: any[] = calData?.calendars || [];
  if (calendars.length === 0) { ctx.rp.done = true; return; }

  const now = Date.now();
  const startTime = now - 5 * 365 * 86400_000; // last 5 years
  const endTime = now + 2 * 365 * 86400_000;   // next 2 years

  for (const cal of calendars) {
    if (Date.now() >= ctx.deadline) return;
    const calId = cal?.id; if (!calId) continue;
    const u = `${GHL_API_BASE}/calendars/events?locationId=${ctx.locationId}&calendarId=${calId}&startTime=${startTime}&endTime=${endTime}`;
    const evRes = await fetch(u, { headers: ctx.headers });
    if (!evRes.ok) continue;
    const evData = await evRes.json();
    const events: any[] = evData?.events || [];
    ctx.rp.found += events.length;
    if (ctx.dryRun) continue;
    for (const ev of events) {
      if (Date.now() >= ctx.deadline) return;
      const id = ev?.id; if (!id) continue;
      const r = await fetch(`${GHL_API_BASE}/calendars/events/${id}`, { method: 'DELETE', headers: ctx.headers });
      if (r.ok || r.status === 404) ctx.rp.deleted++;
      else { ctx.rp.failed++; if (ctx.rp.errors.length < 10) ctx.rp.errors.push(`${id}: ${r.status}`); }
    }
  }
  ctx.rp.done = true;
}

async function wipeWorkflows(ctx: ProcessCtx) {
  // GHL public API does not expose workflow DELETE. Mark skipped + flag
  // for manual cleanup in the GHL UI.
  const listRes = await fetch(`${GHL_API_BASE}/workflows/?locationId=${ctx.locationId}`, { headers: ctx.headers });
  if (listRes.ok) {
    const data = await listRes.json();
    ctx.rp.found = (data?.workflows || []).length;
  }
  ctx.rp.skipped_no_endpoint = true;
  ctx.rp.done = true;
}

async function wipeForms(ctx: ProcessCtx) {
  const listRes = await fetch(`${GHL_API_BASE}/forms/?locationId=${ctx.locationId}`, { headers: ctx.headers });
  if (listRes.ok) {
    const data = await listRes.json();
    ctx.rp.found = (data?.forms || []).length;
  }
  // No public DELETE endpoint for forms — mark skipped.
  ctx.rp.skipped_no_endpoint = true;
  ctx.rp.done = true;
}

async function wipeTags(ctx: ProcessCtx) {
  const listRes = await fetch(`${GHL_API_BASE}/locations/${ctx.locationId}/tags`, { headers: ctx.headers });
  if (!listRes.ok) {
    if (listRes.status === 404) { ctx.rp.skipped_no_endpoint = true; ctx.rp.done = true; return; }
    throw new Error(`tags list ${listRes.status}`);
  }
  const data = await listRes.json();
  const items: any[] = data?.tags || [];
  ctx.rp.found = items.length;
  if (ctx.dryRun) { ctx.rp.done = true; return; }
  for (const t of items) {
    if (Date.now() >= ctx.deadline) return;
    const id = t?.id; if (!id) continue;
    const r = await fetch(`${GHL_API_BASE}/locations/${ctx.locationId}/tags/${id}`, { method: 'DELETE', headers: ctx.headers });
    if (r.ok || r.status === 404) ctx.rp.deleted++;
    else { ctx.rp.failed++; if (ctx.rp.errors.length < 10) ctx.rp.errors.push(`${id}: ${r.status}`); }
  }
  ctx.rp.done = true;
}

async function wipeCustomFields(ctx: ProcessCtx) {
  const listRes = await fetch(`${GHL_API_BASE}/locations/${ctx.locationId}/customFields`, { headers: ctx.headers });
  if (!listRes.ok) {
    if (listRes.status === 404) { ctx.rp.skipped_no_endpoint = true; ctx.rp.done = true; return; }
    throw new Error(`custom fields list ${listRes.status}`);
  }
  const data = await listRes.json();
  const items: any[] = data?.customFields || [];
  ctx.rp.found = items.length;
  if (ctx.dryRun) { ctx.rp.done = true; return; }
  for (const f of items) {
    if (Date.now() >= ctx.deadline) return;
    const id = f?.id; if (!id) continue;
    const r = await fetch(`${GHL_API_BASE}/locations/${ctx.locationId}/customFields/${id}`, { method: 'DELETE', headers: ctx.headers });
    if (r.ok || r.status === 404) ctx.rp.deleted++;
    else { ctx.rp.failed++; if (ctx.rp.errors.length < 10) ctx.rp.errors.push(`${id}: ${r.status}`); }
  }
  ctx.rp.done = true;
}

async function wipeCustomValues(ctx: ProcessCtx) {
  const listRes = await fetch(`${GHL_API_BASE}/locations/${ctx.locationId}/customValues`, { headers: ctx.headers });
  if (!listRes.ok) {
    if (listRes.status === 404) { ctx.rp.skipped_no_endpoint = true; ctx.rp.done = true; return; }
    throw new Error(`custom values list ${listRes.status}`);
  }
  const data = await listRes.json();
  const items: any[] = data?.customValues || [];
  ctx.rp.found = items.length;
  if (ctx.dryRun) { ctx.rp.done = true; return; }
  for (const v of items) {
    if (Date.now() >= ctx.deadline) return;
    const id = v?.id; if (!id) continue;
    const r = await fetch(`${GHL_API_BASE}/locations/${ctx.locationId}/customValues/${id}`, { method: 'DELETE', headers: ctx.headers });
    if (r.ok || r.status === 404) ctx.rp.deleted++;
    else { ctx.rp.failed++; if (ctx.rp.errors.length < 10) ctx.rp.errors.push(`${id}: ${r.status}`); }
  }
  ctx.rp.done = true;
}
