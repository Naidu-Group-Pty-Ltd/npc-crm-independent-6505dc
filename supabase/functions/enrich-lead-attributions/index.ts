import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { verifyInternal } from '../_shared/auth_v2.ts';
import { internalError } from '../_shared/errorResponse.ts';

const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

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
    const rawBody = await req.text().catch(() => '');
    const body = (() => { try { return rawBody ? JSON.parse(rawBody) : {}; } catch { return {}; } })();

    // AUTH: accept EITHER a verified staff human OR a verified internal/service
    // call (service-role key / HMAC — the pg_cron pattern). The previous check
    // treated a caller-supplied `body.source === 'scheduled'` as a full auth
    // bypass, so anyone could drive the paid Meta Ads enrichment. Body fields
    // are never a trust signal.
    const human = await verifyAuth(supabase, req.headers, body);
    if (human.error || !human.userId) {
      const internal = await verifyInternal(supabase, req, rawBody, { strict: true, allowedCallers: ['pg_cron'] });
      if (!internal.ok) {
        return createUnauthorizedResponse(human.error || 'Authentication required', corsHeaders);
      }
      console.log('[enrich] Verified internal/scheduled invocation');
    }

    const accessToken = Deno.env.get('META_ADS_ACCESS_TOKEN');
    if (!accessToken) {
      return new Response(JSON.stringify({ success: false, error: 'META_ADS_ACCESS_TOKEN not configured' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const batchSize = body.batchSize || 20;

    // Fetch attributions that have Meta IDs but haven't been enriched yet
    const { data: pending, error: fetchErr } = await supabase
      .from('lead_source_attributions')
      .select('id, meta_campaign_id, meta_adset_id, meta_ad_id')
      .eq('enrichment_status', 'pending')
      .not('meta_campaign_id', 'is', null)
      .limit(batchSize);

    if (fetchErr) throw new Error(`Fetch error: ${fetchErr.message}`);
    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({ success: true, enriched: 0, message: 'No pending enrichments' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[enrich] Processing ${pending.length} attributions`);

    // Collect unique Meta IDs to batch-fetch
    const campaignIds = new Set<string>();
    const adsetIds = new Set<string>();
    const adIds = new Set<string>();

    for (const attr of pending) {
      if (attr.meta_campaign_id) campaignIds.add(attr.meta_campaign_id);
      if (attr.meta_adset_id) adsetIds.add(attr.meta_adset_id);
      if (attr.meta_ad_id) adIds.add(attr.meta_ad_id);
    }

    // Fetch campaign details
    const campaignNames = new Map<string, { name: string; objective: string }>();
    for (const cid of campaignIds) {
      try {
        const res = await fetch(`${META_BASE_URL}/${cid}?fields=name,objective,status&access_token=${accessToken}`);
        if (res.ok) {
          const d = await res.json();
          campaignNames.set(cid, { name: d.name || cid, objective: d.objective || '' });
        }
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.warn(`[enrich] Campaign ${cid} fetch failed:`, e.message);
      }
    }

    // Fetch adset details
    const adsetNames = new Map<string, string>();
    for (const aid of adsetIds) {
      try {
        const res = await fetch(`${META_BASE_URL}/${aid}?fields=name&access_token=${accessToken}`);
        if (res.ok) {
          const d = await res.json();
          adsetNames.set(aid, d.name || aid);
        }
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.warn(`[enrich] Adset ${aid} fetch failed:`, e.message);
      }
    }

    // Fetch ad details (name + creative thumbnail)
    const adDetails = new Map<string, { name: string; creativeUrl: string | null }>();
    for (const adId of adIds) {
      try {
        const res = await fetch(`${META_BASE_URL}/${adId}?fields=name,creative{thumbnail_url,image_url}&access_token=${accessToken}`);
        if (res.ok) {
          const d = await res.json();
          const creativeUrl = d.creative?.image_url || d.creative?.thumbnail_url || null;
          adDetails.set(adId, { name: d.name || adId, creativeUrl });
        }
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        console.warn(`[enrich] Ad ${adId} fetch failed:`, e.message);
      }
    }

    // Update each attribution with enriched data
    let enriched = 0;
    let errors = 0;

    for (const attr of pending) {
      const campaign = attr.meta_campaign_id ? campaignNames.get(attr.meta_campaign_id) : null;
      const adsetName = attr.meta_adset_id ? adsetNames.get(attr.meta_adset_id) : null;
      const ad = attr.meta_ad_id ? adDetails.get(attr.meta_ad_id) : null;

      const update: Record<string, any> = {
        enrichment_status: 'enriched',
        enriched_at: new Date().toISOString(),
      };

      if (campaign) {
        update.meta_campaign_name = campaign.name;
        update.meta_campaign_objective = campaign.objective;
      }
      if (adsetName) update.meta_adset_name = adsetName;
      if (ad) {
        update.meta_ad_name = ad.name;
        if (ad.creativeUrl) update.meta_ad_creative_url = ad.creativeUrl;
      }

      // If no Meta data resolved at all, mark as no_meta_data
      if (!campaign && !adsetName && !ad) {
        update.enrichment_status = 'no_meta_data';
      }

      const { error: updateErr } = await supabase
        .from('lead_source_attributions')
        .update(update)
        .eq('id', attr.id);

      if (updateErr) {
        console.error(`[enrich] Update failed for ${attr.id}:`, updateErr.message);
        errors++;
      } else {
        enriched++;
      }
    }

    console.log(`[enrich] Done. Enriched: ${enriched}, Errors: ${errors}`);

    return new Response(JSON.stringify({
      success: true,
      enriched,
      errors,
      total: pending.length,
      hasMore: pending.length === batchSize,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[enrich] Error:', error);
    return new Response(JSON.stringify({ ...internalError(error, 'enrich-lead-attributions'), success: false }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
