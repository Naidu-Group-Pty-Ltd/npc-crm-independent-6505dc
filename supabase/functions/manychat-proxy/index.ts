import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { checkModuleView } from '../_shared/permissions.ts';
import { isSuperadmin, rateLimit, redactUpstreamError } from '../_shared/wp08Guards.ts';
import { logApiUsage } from '../_shared/logApiUsage.ts';

const MANYCHAT_API_BASE = 'https://api.manychat.com/fb';

// WP-08 — action taxonomy. Metadata actions require `settings` module view;
// subscriber PII actions (find/get subscriber) require superadmin.
const METADATA_ACTIONS = new Set([
  'get_page_info', 'get_tags', 'get_custom_fields', 'get_widgets',
  'get_bot_fields', 'get_flows', 'get_overview',
]);
const PII_ACTIONS = new Set(['find_subscriber', 'get_subscriber', 'find_by_custom_field']);

function normalizeList(value: unknown, nestedKeys: string[] = []): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const key of nestedKeys) {
      const nestedValue = (value as Record<string, unknown>)[key];
      if (Array.isArray(nestedValue)) return nestedValue;
    }
  }
  return [];
}

function normalizeObject(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, any>;
}

async function upstream(url: string, init: RequestInit, service = 'ManyChat'): Promise<{ ok: true; data: any } | { ok: false; status: number; error: string }> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '');
    console.error(`${service} API error:`, resp.status, errorText);
    return { ok: false, status: resp.status, error: redactUpstreamError(resp.status, service) };
  }
  const data = await resp.json().catch(() => ({}));
  return { ok: true, data };
}

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
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json().catch(() => ({}));

    const authResult = await verifyAuth(supabase, req.headers, body);
    if (authResult.error || !authResult.userId) {
      return createUnauthorizedResponse(authResult.error || 'Authentication required', corsHeaders);
    }

    const { action } = body;
    if (!action || (typeof action !== 'string')) {
      return new Response(
        JSON.stringify({ success: false, error: 'action is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // WP-08 — capability gates.
    const superadmin = await isSuperadmin(supabase, authResult.userId, authResult.authMethod);
    if (PII_ACTIONS.has(action)) {
      if (!superadmin) {
        return new Response(
          JSON.stringify({ success: false, error: 'Subscriber lookups are restricted to superadmins.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (METADATA_ACTIONS.has(action)) {
      const perm = await checkModuleView(supabase, authResult.userId, 'settings', authResult.authMethod);
      if (!perm.allowed) {
        return new Response(
          JSON.stringify({ success: false, error: perm.reason || 'You do not have access to ManyChat metadata.' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      return new Response(
        JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // WP-08 — per-user rate limit (tighter for PII).
    const rl = rateLimit(`manychat:${authResult.userId}:${PII_ACTIONS.has(action) ? 'pii' : 'meta'}`,
      PII_ACTIONS.has(action) ? 30 : 120, 60_000);
    if (!rl.allowed) {
      return new Response(
        JSON.stringify({ success: false, error: 'Rate limit exceeded. Please slow down.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil((rl.retryAfterMs || 1000)/1000)) } }
      );
    }

    const MANYCHAT_API_KEY = Deno.env.get('MANYCHAT_API_KEY');
    if (!MANYCHAT_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: 'MANYCHAT_API_KEY is not configured. Add it in Integrations.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${MANYCHAT_API_KEY}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    let result: any = {};

    switch (action) {
      case 'get_page_info': {
        const r = await upstream(`${MANYCHAT_API_BASE}/page/getInfo`, { headers });
        if (!r.ok) return new Response(JSON.stringify({ success: false, error: r.error }), { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        result = { success: true, pageInfo: normalizeObject(r.data.data) };
        break;
      }
      case 'get_tags': {
        const r = await upstream(`${MANYCHAT_API_BASE}/page/getTags`, { headers });
        if (!r.ok) return new Response(JSON.stringify({ success: false, error: r.error }), { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        result = { success: true, tags: normalizeList(r.data.data, ['tags']) };
        break;
      }
      case 'get_custom_fields': {
        const r = await upstream(`${MANYCHAT_API_BASE}/page/getCustomFields`, { headers });
        if (!r.ok) return new Response(JSON.stringify({ success: false, error: r.error }), { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        result = { success: true, customFields: normalizeList(r.data.data, ['custom_fields', 'customFields']) };
        break;
      }
      case 'get_widgets': {
        const r = await upstream(`${MANYCHAT_API_BASE}/page/getGrowthTools`, { headers });
        if (!r.ok) return new Response(JSON.stringify({ success: false, error: r.error }), { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        result = { success: true, widgets: normalizeList(r.data.data, ['widgets', 'growth_tools']) };
        break;
      }
      case 'get_bot_fields': {
        const r = await upstream(`${MANYCHAT_API_BASE}/page/getBotFields`, { headers });
        if (!r.ok) return new Response(JSON.stringify({ success: false, error: r.error }), { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        result = { success: true, botFields: normalizeList(r.data.data, ['bot_fields', 'botFields']) };
        break;
      }
      case 'get_flows': {
        const resp = await fetch(`${MANYCHAT_API_BASE}/page/getFlows`, { headers });
        if (resp.status === 404) {
          result = { success: true, flows: [], note: 'Flows endpoint not available for this account type' };
          break;
        }
        if (!resp.ok) {
          const t = await resp.text().catch(() => '');
          console.error('ManyChat flows error', resp.status, t);
          return new Response(JSON.stringify({ success: false, error: redactUpstreamError(resp.status, 'ManyChat') }), { status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const data = await resp.json();
        result = { success: true, flows: normalizeList(data.data, ['flows']), folders: normalizeList(data.data, ['folders']) };
        break;
      }
      case 'find_subscriber': {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        if (name.length < 2 || name.length > 100) {
          return new Response(JSON.stringify({ success: false, error: 'Name must be between 2 and 100 characters' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const r = await upstream(`${MANYCHAT_API_BASE}/subscriber/findByName`, { method: 'POST', headers, body: JSON.stringify({ name }) });
        if (!r.ok) return new Response(JSON.stringify({ success: false, error: r.error }), { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        result = { success: true, subscribers: normalizeList(r.data.data, ['subscribers']) };
        break;
      }
      case 'get_subscriber': {
        const subscriberId = String(body.subscriberId || '').trim();
        if (!subscriberId || !/^[A-Za-z0-9_-]{1,64}$/.test(subscriberId)) {
          return new Response(JSON.stringify({ success: false, error: 'Valid subscriberId is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const r = await upstream(`${MANYCHAT_API_BASE}/subscriber/getInfo?subscriber_id=${encodeURIComponent(subscriberId)}`, { headers });
        if (!r.ok) return new Response(JSON.stringify({ success: false, error: r.error }), { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        result = { success: true, subscriber: normalizeObject(r.data.data) };
        break;
      }
      case 'find_by_custom_field': {
        const field_id = Number(body.field_id);
        const field_value = typeof body.field_value === 'string' ? body.field_value.slice(0, 256) : '';
        if (!Number.isFinite(field_id) || !field_value) {
          return new Response(JSON.stringify({ success: false, error: 'field_id and field_value are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const r = await upstream(`${MANYCHAT_API_BASE}/subscriber/findByCustomField`, { method: 'POST', headers, body: JSON.stringify({ field_id, field_value }) });
        if (!r.ok) return new Response(JSON.stringify({ success: false, error: r.error }), { status: r.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        result = { success: true, subscribers: normalizeList(r.data.data, ['subscribers']) };
        break;
      }
      case 'get_overview': {
        const [pageResp, tagsResp, widgetsResp, fieldsResp, botFieldsResp, flowsResp] = await Promise.all([
          fetch(`${MANYCHAT_API_BASE}/page/getInfo`, { headers }),
          fetch(`${MANYCHAT_API_BASE}/page/getTags`, { headers }),
          fetch(`${MANYCHAT_API_BASE}/page/getGrowthTools`, { headers }),
          fetch(`${MANYCHAT_API_BASE}/page/getCustomFields`, { headers }),
          fetch(`${MANYCHAT_API_BASE}/page/getBotFields`, { headers }),
          fetch(`${MANYCHAT_API_BASE}/page/getFlows`, { headers }),
        ]);
        if (!pageResp.ok) {
          console.error('ManyChat page info error', pageResp.status);
          return new Response(JSON.stringify({ success: false, error: redactUpstreamError(pageResp.status, 'ManyChat') }), { status: pageResp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const pageData = await pageResp.json();
        const tagsData = tagsResp.ok ? await tagsResp.json() : { data: [] };
        const widgetsData = widgetsResp.ok ? await widgetsResp.json() : { data: [] };
        const fieldsData = fieldsResp.ok ? await fieldsResp.json() : { data: [] };
        const botFieldsData = botFieldsResp.ok ? await botFieldsResp.json() : { data: [] };
        const flowsData = flowsResp.ok ? await flowsResp.json() : { data: [] };
        result = {
          success: true,
          pageInfo: normalizeObject(pageData.data),
          tags: normalizeList(tagsData.data, ['tags']),
          widgets: normalizeList(widgetsData.data, ['widgets', 'growth_tools']),
          customFields: normalizeList(fieldsData.data, ['custom_fields', 'customFields']),
          botFields: normalizeList(botFieldsData.data, ['bot_fields', 'botFields']),
          flows: normalizeList(flowsData.data, ['flows']),
        };
        break;
      }
    }

    await logApiUsage(supabase, {
      service_name: 'manychat',
      endpoint: `/action/${action}`,
      status: 'success',
      model_used: 'rest-api',
      user_id: authResult.userId,
      metadata: { action, pii: PII_ACTIONS.has(action) },
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('ManyChat proxy error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'ManyChat proxy failed.' }),
      { status: 500, headers: { ...createCorsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
    );
  }
});
