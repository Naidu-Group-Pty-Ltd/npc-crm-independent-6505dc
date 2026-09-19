import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { enforceRawBodyLimit, verifySignedInternal } from '../_shared/requestSecurity.ts';
import { internalError } from '../_shared/errorResponse.ts';
/**
 * Sync GHL marketing assets (workflows, forms/quizzes/surveys, funnels & pages)
 * into Supabase as a stateful snapshot. Designed for re-ingestion into the new
 * GHL account — stores full raw payloads + structured columns + ID mappings.
 *
 * Triggers:
 *   - Manual: POST { resources?: ['workflows'|'forms'|'funnels'] }
 *   - Cron: every 6h (no body)
 *
 * Auth: Service-to-service (cron) OR authenticated admin call.
 */

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

interface SyncResult {
  resource: string;
  fetched: number;
  upserted: number;
  pages: number;
  errors: string[];
}

async function ghlFetch(path: string, apiKey: string): Promise<Response> {
  return fetch(`${GHL_API_BASE}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_API_VERSION,
      Accept: 'application/json',
    },
  });
}

// ─────────────────────── WORKFLOWS ───────────────────────
async function syncWorkflows(supabase: any, apiKey: string, locationId: string): Promise<SyncResult> {
  const result: SyncResult = { resource: 'workflows', fetched: 0, upserted: 0, pages: 1, errors: [] };
  try {
    const res = await ghlFetch(`/workflows/?locationId=${locationId}`, apiKey);
    if (!res.ok) {
      const txt = await res.text();
      result.errors.push(`HTTP ${res.status}: ${txt.slice(0, 300)}`);
      return result;
    }
    const data = await res.json();
    const workflows: any[] = data.workflows || data.data || [];
    result.fetched = workflows.length;

    for (const wf of workflows) {
      const triggers: any[] = wf.triggers || wf.workflowTriggers || [];
      const triggerSummary = triggers
        .map((t) => t?.type || t?.eventType || t?.name)
        .filter(Boolean)
        .slice(0, 5)
        .join(', ');

      const { error } = await supabase.from('ghl_workflows').upsert(
        {
          ghl_workflow_id: wf.id,
          location_id: locationId,
          name: wf.name || 'Unnamed workflow',
          status: wf.status || (wf.published === true ? 'published' : 'draft'),
          version: wf.version ?? null,
          trigger_summary: triggerSummary || null,
          step_count: Array.isArray(wf.steps) ? wf.steps.length : (wf.stepsCount ?? 0),
          raw_payload: wf,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: 'ghl_workflow_id' },
      );
      if (error) {
        result.errors.push(`workflow ${wf.id}: ${error.message}`);
      } else {
        result.upserted++;
        await supabase.from('ghl_id_mapping').upsert(
          { resource_type: 'workflow', old_ghl_id: wf.id, source_account_label: 'legacy_ghl' },
          { onConflict: 'resource_type,old_ghl_id', ignoreDuplicates: true },
        );
      }
    }
  } catch (e: any) {
    result.errors.push(`workflows fatal: ${e.message}`);
  }
  return result;
}

// ─────────────────────── FORMS / QUIZZES / SURVEYS ───────────────────────
async function syncFormsLike(
  supabase: any,
  apiKey: string,
  locationId: string,
  endpoint: 'forms' | 'surveys',
  formType: 'form' | 'quiz' | 'survey',
): Promise<SyncResult> {
  const result: SyncResult = { resource: `${endpoint} (${formType})`, fetched: 0, upserted: 0, pages: 0, errors: [] };
  let skip = 0;
  const limit = 100;

  try {
    while (true) {
      result.pages++;
      const res = await ghlFetch(`/${endpoint}/?locationId=${locationId}&limit=${limit}&skip=${skip}`, apiKey);
      if (!res.ok) {
        const txt = await res.text();
        result.errors.push(`page ${result.pages} HTTP ${res.status}: ${txt.slice(0, 300)}`);
        break;
      }
      const data = await res.json();
      const items: any[] = data[endpoint] || data.data || [];
      if (items.length === 0) break;
      result.fetched += items.length;

      for (const item of items) {
        // Quizzes are surveys with a quiz flag in many GHL accounts
        const detectedType =
          formType === 'survey' && (item.isQuiz === true || item.type === 'quiz') ? 'quiz' : formType;
        const fields = item.fields || item.questions || item.formFields || [];

        const { error } = await supabase.from('ghl_forms').upsert(
          {
            ghl_form_id: item.id,
            location_id: locationId,
            name: item.name || 'Untitled',
            form_type: detectedType,
            fields_count: Array.isArray(fields) ? fields.length : 0,
            submission_count: item.submissionCount ?? item.submissions ?? 0,
            raw_payload: item,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: 'ghl_form_id' },
        );
        if (error) {
          result.errors.push(`form ${item.id}: ${error.message}`);
        } else {
          result.upserted++;
          await supabase.from('ghl_id_mapping').upsert(
            { resource_type: detectedType, old_ghl_id: item.id, source_account_label: 'legacy_ghl' },
            { onConflict: 'resource_type,old_ghl_id', ignoreDuplicates: true },
          );
        }
      }

      if (items.length < limit) break;
      skip += items.length;
      if (skip > 5000) {
        result.errors.push('safety cap 5000 reached');
        break;
      }
    }
  } catch (e: any) {
    result.errors.push(`${endpoint} fatal: ${e.message}`);
  }
  return result;
}

// ─────────────────────── FUNNELS + PAGES ───────────────────────
async function syncFunnels(supabase: any, apiKey: string, locationId: string): Promise<SyncResult> {
  const result: SyncResult = { resource: 'funnels', fetched: 0, upserted: 0, pages: 1, errors: [] };
  try {
    const res = await ghlFetch(`/funnels/funnel/list?locationId=${locationId}`, apiKey);
    if (!res.ok) {
      const txt = await res.text();
      result.errors.push(`HTTP ${res.status}: ${txt.slice(0, 300)}`);
      return result;
    }
    const data = await res.json();
    const funnels: any[] = data.funnels || data.data || [];
    result.fetched = funnels.length;

    for (const fn of funnels) {
      const pages: any[] = fn.steps || fn.pages || [];
      const { data: upserted, error } = await supabase
        .from('ghl_funnels')
        .upsert(
          {
            ghl_funnel_id: fn._id || fn.id,
            location_id: locationId,
            name: fn.name || 'Untitled funnel',
            status: fn.status || (fn.deleted ? 'deleted' : 'active'),
            domain: fn.domain || fn.domainName || null,
            page_count: pages.length,
            raw_payload: fn,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: 'ghl_funnel_id' },
        )
        .select('id, ghl_funnel_id')
        .single();

      if (error) {
        result.errors.push(`funnel ${fn._id || fn.id}: ${error.message}`);
        continue;
      }
      result.upserted++;
      await supabase.from('ghl_id_mapping').upsert(
        { resource_type: 'funnel', old_ghl_id: upserted.ghl_funnel_id, source_account_label: 'legacy_ghl' },
        { onConflict: 'resource_type,old_ghl_id', ignoreDuplicates: true },
      );

      // Sync child pages
      for (let i = 0; i < pages.length; i++) {
        const pg = pages[i];
        const pageId = pg._id || pg.id;
        if (!pageId) continue;

        const slug = pg.path || pg.slug || pg.url || null;
        const fullUrl = pg.fullUrl || (upserted && fn.domain && slug ? `https://${fn.domain}/${slug}` : null);

        const { error: pgErr } = await supabase.from('ghl_funnel_pages').upsert(
          {
            ghl_page_id: pageId,
            ghl_funnel_id: upserted.ghl_funnel_id,
            funnel_uuid: upserted.id,
            name: pg.name || pg.stepName || `Page ${i + 1}`,
            slug,
            full_url: fullUrl,
            page_type: pg.type || pg.stepType || null,
            position: pg.position ?? i,
            raw_payload: pg,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: 'ghl_page_id' },
        );
        if (pgErr) {
          result.errors.push(`page ${pageId}: ${pgErr.message}`);
        } else {
          await supabase.from('ghl_id_mapping').upsert(
            { resource_type: 'funnel_page', old_ghl_id: pageId, source_account_label: 'legacy_ghl' },
            { onConflict: 'resource_type,old_ghl_id', ignoreDuplicates: true },
          );
        }
      }
    }
  } catch (e: any) {
    result.errors.push(`funnels fatal: ${e.message}`);
  }
  return result;
}

// ─────────────────────── HANDLER ───────────────────────
Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // The signature covers a hash of the raw bytes, so the body is read once
    // as text and parsed from that — `req.json()` consumes the stream and
    // leaves nothing for `verifySignedInternal` to hash.
    const bounded = await enforceRawBodyLimit(req, 8192);
    if (!bounded.ok) return bounded.error;
    let body: any = {};
    try { body = bounded.raw ? JSON.parse(bounded.raw) : {}; } catch { body = {}; }

    /*
     * THE CRON PATH USED TO BE A HARDCODED ANON KEY, AND IT REFUSED EVERY RUN.
     *
     * It compared the request's bearer against a literal anon key for the
     * PRIME's Supabase project (`ref: dduzbchuswwbefdunfct`), and treated a
     * match with no session token as the scheduled caller. Two things follow,
     * and both were measured on 13-14 Sep 2026.
     *
     * On a CLONE the comparison can never hold: `cron_signed_internal_headers`
     * sends that deployment's OWN anon key, which is a different string, so
     * the call fell through to `verifyAuth`, which has no user behind an anon
     * key, and answered 401. On the PRIME it answered 401 too — the vault's
     * `supabase_anon_key` and this literal are not the same value — so
     * `sync-ghl-marketing-assets-6h` had never once run anywhere.
     *
     * The comment called the literal "safe to hardcode", and as a PUBLISHED
     * value it is: an anon key is meant to be in every browser bundle. What is
     * not safe is AUTHENTICATING with it. It identifies a project, not a
     * caller, and the same rule this repo already applies to the Turnstile
     * site key applies here — a literal belonging to one deployment, inherited
     * verbatim by every clone, is wrong on all of them.
     *
     * The scheduled caller is now verified the way every other one is: a
     * signed envelope naming `pg_cron`, which is what the job already sends.
     * The human path below is untouched.
     */
    const internal = await verifySignedInternal(supabase, req, bounded.raw, ['pg_cron']);
    const isCronCall = internal.ok;

    if (!isCronCall) {
      const { error: authError, userId, authMethod } = await verifyAuth(supabase, req.headers, body);
      if (authError) {
        return createUnauthorizedResponse(authError, corsHeaders);
      }

      if (authMethod !== 'service_role') {
        const { data: roles } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', userId)
          .in('role', ['admin', 'superadmin']);
        if (!roles || roles.length === 0) {
          return new Response(JSON.stringify({ success: false, error: 'Admin access required' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    } else {
      console.log(`[sync-ghl-marketing-assets] Signed internal caller: ${internal.actorId}`);
    }

    const apiKey = Deno.env.get('GOHIGHLEVEL_API_KEY');
    const locationId = Deno.env.get('GOHIGHLEVEL_LOCATION_ID');
    if (!apiKey || !locationId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing GOHIGHLEVEL_API_KEY or GOHIGHLEVEL_LOCATION_ID' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const requested: string[] = Array.isArray(body?.resources) && body.resources.length > 0
      ? body.resources
      : ['workflows', 'forms', 'surveys', 'funnels'];

    const results: SyncResult[] = [];

    if (requested.includes('workflows')) {
      results.push(await syncWorkflows(supabase, apiKey, locationId));
    }
    if (requested.includes('forms')) {
      results.push(await syncFormsLike(supabase, apiKey, locationId, 'forms', 'form'));
    }
    if (requested.includes('surveys')) {
      results.push(await syncFormsLike(supabase, apiKey, locationId, 'surveys', 'survey'));
    }
    if (requested.includes('funnels')) {
      results.push(await syncFunnels(supabase, apiKey, locationId));
    }

    const totalUpserted = results.reduce((s, r) => s + r.upserted, 0);
    const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);

    console.log('[sync-ghl-marketing-assets] complete', {
      totalUpserted,
      totalErrors,
      breakdown: results.map((r) => `${r.resource}: ${r.upserted}/${r.fetched} (${r.errors.length} errs)`),
    });

    return new Response(
      JSON.stringify({
        success: true,
        synced_at: new Date().toISOString(),
        total_upserted: totalUpserted,
        total_errors: totalErrors,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e: any) {
    console.error('[sync-ghl-marketing-assets] fatal', e);
    return new Response(JSON.stringify({ ...internalError(e, 'sync-ghl-marketing-assets'), success: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
