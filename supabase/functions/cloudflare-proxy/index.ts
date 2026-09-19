import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse, createForbiddenResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

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

    const readOnlyServiceActions = new Set(['analytics_dashboard', 'analytics_dns', 'cache_settings', 'list_workers', 'list_pages', 'worker_details', 'list_firewall_rules', 'zone_details']);
    const requestedAction = body?.action;
    const internalServiceKey = req.headers.get('x-internal-service-key') || body?.internal_service_key;
    const isInternalReadOnlyCall = Boolean(
      internalServiceKey &&
      internalServiceKey === supabaseKey &&
      readOnlyServiceActions.has(requestedAction)
    );

    // Verify auth + superadmin. Internal edge-to-edge calls from the agent use
    // the anon JWT for the Supabase gateway (this function has verify_jwt=true)
    // plus x-internal-service-key for read-only proxy actions only.
    if (!isInternalReadOnlyCall) {
      const authResult = await verifyAuth(supabase, req.headers, body);
      if (authResult.error) {
        return createUnauthorizedResponse(authResult.error, corsHeaders);
      }

      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', authResult.userId)
        .eq('role', 'superadmin')
        .single();

      if (!roleData) {
        return createForbiddenResponse('Superadmin access required', corsHeaders);
      }
    }

    // Get Cloudflare credentials
    const apiToken = Deno.env.get('CLOUDFLARE_API_TOKEN');
    const zoneId = Deno.env.get('CLOUDFLARE_ZONE_ID');
    const accountId = Deno.env.get('CLOUDFLARE_ACCOUNT_ID');

    const { action, params } = body;
    const accountActions = new Set(['list_workers', 'list_pages', 'worker_details']);

    if (!apiToken || !zoneId || (accountActions.has(action) && !accountId)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Cloudflare credentials not configured',
          missingSecrets: true,
          missing: {
            apiToken: !apiToken,
            zoneId: !zoneId,
            accountId: accountActions.has(action) && !accountId,
          },
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cfHeaders = {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    };

    let result: any;

    switch (action) {
      // ===== ANALYTICS =====
      case 'analytics_dashboard': {
        const since = params?.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const until = params?.until || new Date().toISOString();
        const res = await fetch(
          `${CF_API_BASE}/zones/${zoneId}/analytics/dashboard?since=${since}&until=${until}`,
          { headers: cfHeaders }
        );
        result = await res.json();
        break;
      }

      case 'analytics_dns': {
        // GraphQL analytics for DNS queries
        const dimensions = params?.dimensions || 'queryName';
        const since = params?.since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const until = params?.until || new Date().toISOString().split('T')[0];
        const query = `
          query {
            viewer {
              zones(filter: {zoneTag: "${zoneId}"}) {
                httpRequests1dGroups(
                  limit: 100,
                  filter: { date_geq: "${since}", date_leq: "${until}" }
                ) {
                  sum {
                    requests
                    bytes
                    threats
                    pageViews
                    cachedRequests
                    cachedBytes
                  }
                  dimensions {
                    date
                  }
                }
              }
            }
          }
        `;
        const gqlRes = await fetch('https://api.cloudflare.com/client/v4/graphql', {
          method: 'POST',
          headers: cfHeaders,
          body: JSON.stringify({ query }),
        });
        result = await gqlRes.json();
        break;
      }

      // ===== CDN & CACHING =====
      case 'purge_cache_all': {
        const res = await fetch(
          `${CF_API_BASE}/zones/${zoneId}/purge_cache`,
          {
            method: 'POST',
            headers: cfHeaders,
            body: JSON.stringify({ purge_everything: true }),
          }
        );
        result = await res.json();
        break;
      }

      case 'purge_cache_urls': {
        const urls = params?.urls;
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'URLs array required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const res = await fetch(
          `${CF_API_BASE}/zones/${zoneId}/purge_cache`,
          {
            method: 'POST',
            headers: cfHeaders,
            body: JSON.stringify({ files: urls }),
          }
        );
        result = await res.json();
        break;
      }

      case 'cache_settings': {
        const res = await fetch(
          `${CF_API_BASE}/zones/${zoneId}/settings`,
          { headers: cfHeaders }
        );
        const allSettings = await res.json();
        // Filter to caching-related settings
        const cacheKeys = ['browser_cache_ttl', 'cache_level', 'always_online', 'development_mode', 'minify'];
        result = {
          success: allSettings.success,
          result: allSettings.result?.filter((s: any) => cacheKeys.includes(s.id)) || [],
        };
        break;
      }

      // ===== WORKERS & PAGES =====
      case 'list_workers': {
        const res = await fetch(
          `${CF_API_BASE}/accounts/${accountId}/workers/scripts`,
          { headers: cfHeaders }
        );
        result = await res.json();
        break;
      }

      case 'list_pages': {
        const res = await fetch(
          `${CF_API_BASE}/accounts/${accountId}/pages/projects`,
          { headers: cfHeaders }
        );
        result = await res.json();
        break;
      }

      case 'worker_details': {
        const scriptName = params?.scriptName;
        if (!scriptName) {
          return new Response(
            JSON.stringify({ success: false, error: 'scriptName required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const res = await fetch(
          `${CF_API_BASE}/accounts/${accountId}/workers/scripts/${scriptName}`,
          { headers: cfHeaders }
        );
        // Worker script response is not JSON by default
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          result = await res.json();
        } else {
          result = { success: true, result: { name: scriptName, status: res.ok ? 'deployed' : 'error' } };
        }
        break;
      }

      // ===== FIREWALL / WAF =====
      case 'list_firewall_rules': {
        const res = await fetch(
          `${CF_API_BASE}/zones/${zoneId}/firewall/rules`,
          { headers: cfHeaders }
        );
        result = await res.json();
        break;
      }

      case 'create_firewall_rule': {
        const { expression, action: fwAction, description } = params || {};
        if (!expression || !fwAction) {
          return new Response(
            JSON.stringify({ success: false, error: 'expression and action required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // First create the filter
        const filterRes = await fetch(
          `${CF_API_BASE}/zones/${zoneId}/filters`,
          {
            method: 'POST',
            headers: cfHeaders,
            body: JSON.stringify([{ expression }]),
          }
        );
        const filterData = await filterRes.json();

        if (!filterData.success || !filterData.result?.[0]?.id) {
          result = { success: false, error: 'Failed to create filter', details: filterData };
          break;
        }

        // Then create the firewall rule
        const ruleRes = await fetch(
          `${CF_API_BASE}/zones/${zoneId}/firewall/rules`,
          {
            method: 'POST',
            headers: cfHeaders,
            body: JSON.stringify([{
              filter: { id: filterData.result[0].id },
              action: fwAction,
              description: description || 'Created from dashboard',
            }]),
          }
        );
        result = await ruleRes.json();
        break;
      }

      case 'delete_firewall_rule': {
        const ruleId = params?.ruleId;
        if (!ruleId) {
          return new Response(
            JSON.stringify({ success: false, error: 'ruleId required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        const res = await fetch(
          `${CF_API_BASE}/zones/${zoneId}/firewall/rules/${ruleId}`,
          { method: 'DELETE', headers: cfHeaders }
        );
        result = await res.json();
        break;
      }

      // ===== ZONE OVERVIEW =====
      case 'zone_details': {
        const res = await fetch(
          `${CF_API_BASE}/zones/${zoneId}`,
          { headers: cfHeaders }
        );
        result = await res.json();
        break;
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Cloudflare proxy error:', error);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...createCorsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' } }
    );
  }
});
