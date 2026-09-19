import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { requireWorkspaceCapability, entitlementDeniedResponse } from '../_shared/entitlements.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

interface MetaAdsRequest {
  level?: 'account' | 'campaign' | 'adset' | 'ad';
  datePreset?: string;
  timeRange?: { since: string; until: string };
  fields?: string[];
  limit?: number;
  campaignId?: string;
  adsetId?: string;
}

const DEFAULT_FIELDS = [
  'campaign_name', 'campaign_id',
  'adset_name', 'adset_id',
  'ad_name', 'ad_id',
  'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm',
  'reach', 'frequency',
  'actions', 'cost_per_action_type',
  'conversions', 'cost_per_conversion',
  'purchase_roas',
];

const ACCOUNT_FIELDS = [
  'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm',
  'reach', 'frequency',
  'actions', 'cost_per_action_type',
  'purchase_roas',
];

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

    const body: MetaAdsRequest = await req.json().catch(() => ({}));

    const authResult = await verifyAuth(supabase, req.headers, body as any);
    if (authResult.error) {
      return createUnauthorizedResponse(authResult.error, corsHeaders);
    }

    // Marketing is a Scale-or-add-on capability — enforced server-side.
    const entitlement = await requireWorkspaceCapability(supabase, authResult, 'marketing');
    if (!entitlement.ok) return entitlementDeniedResponse(entitlement, corsHeaders);

    const accessToken = Deno.env.get('META_ADS_ACCESS_TOKEN');
    const adAccountId = Deno.env.get('META_ADS_AD_ACCOUNT_ID');

    if (!accessToken || !adAccountId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Meta Ads credentials not configured. Add META_ADS_ACCESS_TOKEN and META_ADS_AD_ACCOUNT_ID.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Ensure ad account ID has act_ prefix
    const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
    const level = body.level || 'campaign';
    const datePreset = body.datePreset || 'last_30d';
    const limit = Math.min(body.limit || 50, 100);

    // Build the insights URL
    let insightsUrl: string;
    const fieldsParam = level === 'account'
      ? ACCOUNT_FIELDS.join(',')
      : (body.fields || DEFAULT_FIELDS).join(',');

    const params = new URLSearchParams({
      access_token: accessToken,
      fields: fieldsParam,
      limit: String(limit),
    });

    if (level !== 'account') {
      params.set('level', level);
    }

    // Time range
    if (body.timeRange?.since && body.timeRange?.until) {
      params.set('time_range', JSON.stringify({ since: body.timeRange.since, until: body.timeRange.until }));
    } else {
      params.set('date_preset', datePreset);
    }

    // Determine endpoint
    if (body.campaignId && (level === 'adset' || level === 'ad')) {
      insightsUrl = `${META_BASE_URL}/${body.campaignId}/insights?${params}`;
    } else if (body.adsetId && level === 'ad') {
      insightsUrl = `${META_BASE_URL}/${body.adsetId}/insights?${params}`;
    } else {
      insightsUrl = `${META_BASE_URL}/${accountId}/insights?${params}`;
    }

    console.log(`[fetch-meta-ads] Fetching ${level} insights for ${accountId}`);

    const metaResponse = await fetch(insightsUrl);
    const metaData = await metaResponse.json();

    if (!metaResponse.ok) {
      console.error('[fetch-meta-ads] Meta API error:', JSON.stringify(metaData));
      const errorMsg = metaData?.error?.message || 'Meta API request failed';
      return new Response(
        JSON.stringify({ success: false, error: errorMsg, details: metaData?.error }),
        { status: metaResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Also fetch campaign list if at campaign level for names/status
    let campaigns = null;
    if (level === 'campaign' || level === 'account') {
      const campaignsUrl = `${META_BASE_URL}/${accountId}/campaigns?access_token=${accessToken}&fields=id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time&limit=${limit}`;
      const campaignsRes = await fetch(campaignsUrl);
      const campaignsData = await campaignsRes.json();
      if (campaignsRes.ok) {
        campaigns = campaignsData.data;
      }
    }

    // Log API usage
    await supabase.from('api_usage_log').insert({
      service_name: 'meta_ads',
      endpoint: `insights/${level}`,
      status: 'success',
      request_count: 1,
      user_id: null,
      metadata: { level, datePreset, userId: authResult.userId },
    });

    return new Response(
      JSON.stringify({
        success: true,
        insights: metaData.data || [],
        campaigns,
        paging: metaData.paging || null,
        level,
        datePreset,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[fetch-meta-ads] Error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'fetch-meta-ads'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
