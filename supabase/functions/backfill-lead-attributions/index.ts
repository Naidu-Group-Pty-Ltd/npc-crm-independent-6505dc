import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const GHL_API_BASE = 'https://services.leadconnectorhq.com';

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
    const apiKey = Deno.env.get('GOHIGHLEVEL_API_KEY');
    const locationId = Deno.env.get('GOHIGHLEVEL_LOCATION_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!apiKey || !locationId) {
      return new Response(JSON.stringify({ error: 'GHL credentials not configured', success: false }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl!, supabaseKey!);
    const body = await req.json().catch(() => ({}));

    // Verify auth - admin only
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .in('role', ['superadmin', 'admin'])
      .single();

    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Admin access required', success: false }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { batchSize = 50, offset = 0, mode = 'new' } = body;
    // mode: 'new' = only create new records, 'update' = re-fetch and update incomplete existing records

    console.log(`[backfill] Starting attribution backfill. Mode: ${mode}, Offset: ${offset}, Batch: ${batchSize}`);

    const ghlHeaders = {
      'Authorization': `Bearer ${apiKey}`,
      'Version': '2021-04-15',
      'Content-Type': 'application/json',
    };

    if (mode === 'update') {
      // RE-BACKFILL MODE: Find existing attribution records that are incomplete (missing campaign data)
      const { data: incompleteRecords, error: fetchError } = await supabase
        .from('lead_source_attributions')
        .select('id, client_id, ghl_contact_id')
        .is('meta_campaign_name', null)
        .not('ghl_contact_id', 'is', null)
        .order('attributed_at', { ascending: false })
        .range(offset, offset + batchSize - 1);

      if (fetchError) throw new Error(`Failed to fetch incomplete records: ${fetchError.message}`);

      if (!incompleteRecords || incompleteRecords.length === 0) {
        return new Response(JSON.stringify({
          success: true,
          message: 'No more incomplete records to update',
          stats: { processed: 0, updated: 0, skipped: 0, errors: 0 },
          hasMore: false,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      let updated = 0, skipped = 0, errors = 0;
      const errorDetails: string[] = [];

      for (const record of incompleteRecords) {
        try {
          const response = await fetch(`${GHL_API_BASE}/contacts/${record.ghl_contact_id}`, {
            headers: ghlHeaders,
          });

          if (!response.ok) {
            if (response.status === 404) { skipped++; continue; }
            throw new Error(`GHL API ${response.status}`);
          }

          const data = await response.json();
          const contact = data.contact || data;
          const attrObj = contact.attributionSource && typeof contact.attributionSource === 'object' 
            ? contact.attributionSource : null;

          if (!attrObj || !attrObj.campaignId) {
            skipped++;
            continue;
          }

          const updateData: Record<string, any> = {
            utm_source: attrObj.utmSource || attrObj.source || contact.source || null,
            utm_medium: attrObj.utmMedium || null,
            utm_campaign: attrObj.utmCampaign || attrObj.campaign || null,
            utm_content: attrObj.utmContent || null,
            meta_campaign_id: attrObj.campaignId || null,
            meta_campaign_name: attrObj.campaign || null,
            meta_adset_id: attrObj.adSetId || null,
            meta_adset_name: attrObj.utmMedium || null,
            meta_ad_id: (attrObj.adId && attrObj.adId !== 'null') ? attrObj.adId : null,
            meta_ad_name: attrObj.utmContent || null,
            ghl_attribution_source: JSON.stringify(attrObj),
            enrichment_status: 'enriched',
          };

          // Also extract from lastAttributionSource for additional data
          const lastAttr = contact.lastAttributionSource && typeof contact.lastAttributionSource === 'object'
            ? contact.lastAttributionSource : null;
          if (lastAttr) {
            updateData.ghl_last_attribution_source = JSON.stringify(lastAttr);
            // Extract device/location/landing page from last attribution
            if (lastAttr.userAgent) {
              const ua = lastAttr.userAgent.toLowerCase();
              if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
                updateData.device_type = 'Mobile';
              } else if (ua.includes('tablet') || ua.includes('ipad')) {
                updateData.device_type = 'Tablet';
              } else {
                updateData.device_type = 'Desktop';
              }
            }
            if (lastAttr.ip) updateData.geo_location = lastAttr.ip;
            if (lastAttr.url) updateData.landing_page_url = lastAttr.url;
            if (lastAttr.fbc) updateData.fbclid = lastAttr.fbc;
            if (lastAttr.gclid) updateData.gclid = lastAttr.gclid;
          }

          // Extract custom fields for any extra data
          const customFields = contact.customFields || [];
          const getField = (keys: string[]) => {
            for (const key of keys) {
              const field = customFields.find((f: any) => f.key === key || f.id === key || f.fieldKey === key);
              if (field?.value) return field.value;
            }
            return null;
          };
          if (!updateData.fbclid) updateData.fbclid = getField(['fbclid', 'fb_click_id']);
          if (!updateData.gclid) updateData.gclid = getField(['gclid', 'google_click_id']);
          if (!updateData.landing_page_url) updateData.landing_page_url = getField(['landing_page', 'landing_page_url', 'page_url']);

          const { error: updateError } = await supabase
            .from('lead_source_attributions')
            .update(updateData)
            .eq('id', record.id);

          if (updateError) {
            errors++;
            errorDetails.push(`${record.ghl_contact_id}: ${updateError.message}`);
          } else {
            updated++;
            console.log(`[backfill-update] Updated ${record.ghl_contact_id}: campaign=${updateData.meta_campaign_name}`);
          }

          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err) {
          errors++;
          errorDetails.push(`${record.ghl_contact_id}: ${err.message}`);
        }
      }

      const hasMore = incompleteRecords.length === batchSize;
      console.log(`[backfill-update] Batch complete. Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);

      return new Response(JSON.stringify({
        success: true,
        message: `Updated ${updated} records, skipped ${skipped}, ${errors} errors.`,
        stats: { processed: incompleteRecords.length, updated, skipped, errors },
        hasMore,
        nextOffset: offset + batchSize,
        errors: errorDetails.length > 0 ? errorDetails.slice(0, 10) : undefined,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ========= ORIGINAL NEW MODE =========
    // Fetch clients that have a ghl_contact_id
    const { data: clients, error: fetchError } = await supabase
      .from('clients')
      .select('id, ghl_contact_id, primary_first_name, primary_surname')
      .not('ghl_contact_id', 'is', null)
      .order('created_at', { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (fetchError) throw new Error(`Failed to fetch clients: ${fetchError.message}`);

    if (!clients || clients.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No more clients to process',
        stats: { processed: 0, attributed: 0, skipped: 0, errors: 0 },
        hasMore: false,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const clientIds = clients.map((c: any) => c.id);
    const { data: existingAttributions } = await supabase
      .from('lead_source_attributions')
      .select('client_id')
      .in('client_id', clientIds);

    const existingSet = new Set((existingAttributions || []).map((a: any) => a.client_id));

    let attributed = 0, skipped = 0, errors = 0;
    const errorDetails: string[] = [];

    for (const client of clients) {
      if (existingSet.has(client.id)) {
        skipped++;
        continue;
      }

      try {
        const response = await fetch(`${GHL_API_BASE}/contacts/${client.ghl_contact_id}`, {
          headers: ghlHeaders,
        });

        if (!response.ok) {
          if (response.status === 404) { skipped++; continue; }
          throw new Error(`GHL API ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        const contact = data.contact || data;

        const customFields = contact.customFields || [];
        const getField = (keys: string[]) => {
          for (const key of keys) {
            const field = customFields.find((f: any) => f.key === key || f.id === key || f.fieldKey === key);
            if (field?.value) return field.value;
          }
          return null;
        };

        const ghlAttrRaw = contact.attributionSource || null;
        const ghlLastAttrRaw = contact.lastAttributionSource || null;
        const attrObj = typeof ghlAttrRaw === 'object' ? ghlAttrRaw : null;

        const utmSource = attrObj?.utmSource || attrObj?.source || getField(['utm_source', 'utmSource']) || contact.source || null;
        const utmMedium = attrObj?.utmMedium || getField(['utm_medium', 'utmMedium']);
        const utmCampaign = attrObj?.utmCampaign || attrObj?.campaign || getField(['utm_campaign', 'utmCampaign']);
        const utmContent = attrObj?.utmContent || getField(['utm_content', 'utmContent']);
        const utmTerm = getField(['utm_term', 'utmTerm']);
        const metaCampaignId = attrObj?.campaignId || getField(['meta_campaign_id', 'fb_campaign_id']);
        const metaAdsetId = attrObj?.adSetId || getField(['meta_adset_id', 'fb_adset_id']);
        const metaAdId = (attrObj?.adId && attrObj.adId !== null && attrObj.adId !== 'null') ? attrObj.adId : getField(['meta_ad_id', 'fb_ad_id']);
        const metaCampaignName = attrObj?.campaign || null;
        const metaAdsetName = attrObj?.utmMedium || null;
        const metaAdName = attrObj?.utmContent || null;

        // Extract device type from lastAttributionSource user agent
        let deviceType = getField(['device', 'device_type']);
        const lastAttrObj = typeof ghlLastAttrRaw === 'object' ? ghlLastAttrRaw : null;
        if (!deviceType && lastAttrObj?.userAgent) {
          const ua = lastAttrObj.userAgent.toLowerCase();
          if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) deviceType = 'Mobile';
          else if (ua.includes('tablet') || ua.includes('ipad')) deviceType = 'Tablet';
          else deviceType = 'Desktop';
        }

        const landingPage = lastAttrObj?.url || getField(['landing_page', 'landing_page_url']);
        const fbclid = lastAttrObj?.fbc || getField(['fbclid', 'fb_click_id']);
        const gclid = lastAttrObj?.gclid || getField(['gclid', 'google_click_id']);
        const geoLocation = lastAttrObj?.ip || getField(['geo_location', 'location']);
        const conversionPage = getField(['conversion_page', 'form_url']);

        const ghlAttrSource = ghlAttrRaw ? (typeof ghlAttrRaw === 'string' ? ghlAttrRaw : JSON.stringify(ghlAttrRaw)) : null;
        const ghlLastAttrSource = ghlLastAttrRaw ? (typeof ghlLastAttrRaw === 'string' ? ghlLastAttrRaw : JSON.stringify(ghlLastAttrRaw)) : null;

        const hasData = utmSource || utmMedium || utmCampaign || metaCampaignId || fbclid || gclid || contact.source || ghlAttrSource;

        if (!hasData) {
          skipped++;
          continue;
        }

        const { error: insertError } = await supabase
          .from('lead_source_attributions')
          .insert({
            client_id: client.id,
            utm_source: utmSource,
            utm_medium: utmMedium,
            utm_campaign: utmCampaign,
            utm_content: utmContent,
            utm_term: utmTerm,
            meta_campaign_id: metaCampaignId,
            meta_campaign_name: metaCampaignName,
            meta_adset_id: metaAdsetId,
            meta_adset_name: metaAdsetName,
            meta_ad_id: metaAdId,
            meta_ad_name: metaAdName,
            landing_page_url: landingPage,
            fbclid,
            gclid,
            device_type: deviceType,
            geo_location: geoLocation,
            conversion_page_url: conversionPage,
            ghl_attribution_source: ghlAttrSource,
            ghl_last_attribution_source: ghlLastAttrSource,
            source_type: 'backfill',
            ghl_contact_id: client.ghl_contact_id,
            attributed_at: contact.dateAdded || new Date().toISOString(),
            enrichment_status: metaCampaignId ? 'enriched' : 'not_applicable',
          });

        if (insertError) {
          errors++;
          errorDetails.push(`${client.primary_first_name} ${client.primary_surname}: ${insertError.message}`);
        } else {
          attributed++;
          console.log(`[backfill] Attributed ${client.primary_first_name} ${client.primary_surname}: source=${utmSource}, campaign=${utmCampaign}`);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        errors++;
        errorDetails.push(`${client.primary_first_name} ${client.primary_surname}: ${err.message}`);
      }
    }

    const hasMore = clients.length === batchSize;
    console.log(`[backfill] Batch complete. Attributed: ${attributed}, Skipped: ${skipped}, Errors: ${errors}`);

    return new Response(JSON.stringify({
      success: true,
      message: hasMore
        ? `Processed ${clients.length} clients. ${attributed} attributed, ${skipped} skipped, ${errors} errors.`
        : `Backfill complete! ${attributed} attributed, ${skipped} skipped, ${errors} errors.`,
      stats: { processed: clients.length, attributed, skipped, errors },
      hasMore,
      nextOffset: offset + batchSize,
      errors: errorDetails.length > 0 ? errorDetails.slice(0, 10) : undefined,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('[backfill] Error:', error);
    return new Response(JSON.stringify({ ...internalError(error, 'backfill-lead-attributions'), success: false }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
