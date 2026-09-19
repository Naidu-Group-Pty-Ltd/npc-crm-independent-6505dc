import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
const META_API_VERSION = 'v21.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

interface Phase5Request {
  action: 'creatives' | 'funnel' | 'true_roi';
  datePreset?: string;
  timeRange?: { since: string; until: string };
  insights?: any[];
  campaigns?: any[];
  limit?: number;
}

function pickFirstTextAsset(assets: any): string | null {
  if (!Array.isArray(assets) || assets.length === 0) return null;
  const first = assets.find((entry: any) => entry?.text) || assets[0];
  return first?.text || null;
}

function extractCreativeMediaData(creative: any) {
  const storySpec = creative?.object_story_spec || {};
  const linkData = storySpec?.link_data || {};
  const videoData = storySpec?.video_data || {};
  const photoData = storySpec?.photo_data || {};
  const assetFeed = creative?.asset_feed_spec || {};

  const assetFeedImages = Array.isArray(assetFeed.images) ? assetFeed.images : [];
  const assetFeedVideos = Array.isArray(assetFeed.videos) ? assetFeed.videos : [];

  const firstImageAsset = assetFeedImages.find((img: any) => img?.hash || img?.image_hash || img?.url || img?.url_128) || null;
  const firstVideoAsset = assetFeedVideos.find((video: any) => video?.video_id || video?.id) || null;

  const videoId = videoData.video_id || linkData.video_id || firstVideoAsset?.video_id || firstVideoAsset?.id || null;
  const imageHash = creative?.image_hash || linkData.image_hash || videoData.image_hash || photoData.image_hash || firstImageAsset?.hash || firstImageAsset?.image_hash || null;
  const imageUrl = creative?.image_url || linkData.picture || photoData.url || firstImageAsset?.url || firstImageAsset?.url_128 || null;
  const width = Number(firstImageAsset?.width || firstImageAsset?.original_width || 0) || null;
  const height = Number(firstImageAsset?.height || firstImageAsset?.original_height || 0) || null;
  const title = creative?.title || linkData.name || videoData.title || pickFirstTextAsset(assetFeed.titles);
  const body = creative?.body || linkData.message || videoData.message || pickFirstTextAsset(assetFeed.bodies);

  return { videoId, imageHash, imageUrl, width, height, title, body };
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

    const body: Phase5Request = await req.json().catch(() => ({ action: 'creatives' }));

    const authResult = await verifyAuth(supabase, req.headers, body as any);
    if (authResult.error) {
      return createUnauthorizedResponse(authResult.error, corsHeaders);
    }

    const action = body.action || 'creatives';

    // ─── ACTION: CREATIVES ───
    if (action === 'creatives') {
      const accessToken = Deno.env.get('META_ADS_ACCESS_TOKEN');
      const adAccountId = Deno.env.get('META_ADS_AD_ACCOUNT_ID');

      if (!accessToken || !adAccountId) {
        return new Response(
          JSON.stringify({ success: false, error: 'Meta Ads credentials not configured.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const accountId = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
      const limit = Math.min(body.limit || 20, 50);

      // The insights window: a custom range travels as timeRange, and the
      // preset is validated — the picker sets datePreset to the literal
      // string 'custom', which interpolated into date_preset(...) made the
      // Graph API answer 400 for every creatives request on a custom range.
      const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
      const VALID_PRESETS = new Set([
        'today', 'yesterday', 'this_month', 'last_month', 'this_quarter',
        'maximum', 'data_maximum', 'last_3d', 'last_7d', 'last_14d',
        'last_28d', 'last_30d', 'last_90d', 'last_week_mon_sun',
        'last_week_sun_sat', 'last_quarter', 'last_year', 'this_week_mon_today',
        'this_week_sun_today', 'this_year',
      ]);
      const insightsClause = body.timeRange && DATE_RE.test(body.timeRange.since || '') && DATE_RE.test(body.timeRange.until || '')
        ? `insights.time_range(${encodeURIComponent(JSON.stringify({ since: body.timeRange.since, until: body.timeRange.until }))})`
        : `insights.date_preset(${VALID_PRESETS.has(body.datePreset || '') ? body.datePreset : 'last_30d'})`;

      // Fetch ads with creative fields including video and image dimensions
      const adsUrl = `${META_BASE_URL}/${accountId}/ads?access_token=${accessToken}&fields=id,name,status,creative{id,thumbnail_url,image_url,image_hash,title,body,call_to_action_type,object_story_spec,asset_feed_spec,effective_object_story_id,object_type},${insightsClause}{spend,impressions,clicks,ctr,cpc,actions,cost_per_action_type,reach}&limit=${limit}`;

      console.log(`[meta-ads-phase5] Fetching creatives for ${accountId}`);

      const metaResponse = await fetch(adsUrl);
      const metaData = await metaResponse.json();

      if (!metaResponse.ok) {
        console.error('[meta-ads-phase5] Meta API error:', JSON.stringify(metaData));
        return new Response(
          JSON.stringify({ success: false, error: metaData?.error?.message || 'Meta API error' }),
          { status: metaResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Process ads into creative cards
      const rawCreatives = (metaData.data || []).map((ad: any) => {
        const creative = ad.creative || {};
        const insightsData = ad.insights?.data?.[0] || {};
        const leads = (insightsData.actions || []).find((a: any) => a.action_type === 'lead');
        const leadCount = leads ? Number(leads.value) : 0;
        const spend = Number(insightsData.spend || 0);
        const cpl = leadCount > 0 ? spend / leadCount : 0;

        const media = extractCreativeMediaData(creative);
        const hasVideoAssets = Array.isArray(creative?.asset_feed_spec?.videos) && creative.asset_feed_spec.videos.length > 0;
        const isVideo = !!media.videoId || hasVideoAssets || creative?.object_type === 'VIDEO';
        const storyKeys = creative?.object_story_spec ? Object.keys(creative.object_story_spec) : [];
        const assetFeedKeys = creative?.asset_feed_spec ? Object.keys(creative.asset_feed_spec) : [];

        console.log(
          `[meta-ads-phase5] Ad ${ad.id} (${ad.name}): isVideo=${isVideo}, imageHash=${media.imageHash}, hasImageUrl=${!!media.imageUrl}, videoId=${media.videoId}, storyKeys=${storyKeys.join('|') || 'none'}, assetFeedKeys=${assetFeedKeys.join('|') || 'none'}`
        );

        return {
          ad_id: ad.id,
          creative_id: creative.id || null,
          ad_name: ad.name,
          status: ad.status,
          thumbnail_url: creative.thumbnail_url || null,
          image_url: media.imageUrl,
          image_hash: media.imageHash,
          title: media.title,
          body: media.body,
          cta_type: creative.call_to_action_type || null,
          is_video: isVideo,
          video_id: media.videoId,
          video_url: null as string | null,
          preview_url: null as string | null,
          width: media.width,
          height: media.height,
          spend: spend,
          impressions: Number(insightsData.impressions || 0),
          clicks: Number(insightsData.clicks || 0),
          ctr: Number(insightsData.ctr || 0),
          cpc: Number(insightsData.cpc || 0),
          reach: Number(insightsData.reach || 0),
          leads: leadCount,
          cpl: cpl,
        };
      }).filter((c: any) => c.spend > 0)
        .sort((a: any, b: any) => b.spend - a.spend);

      // Deep fallback: resolve missing media via direct creative lookup (covers dynamic creatives and banners)
      const unresolvedCreatives = rawCreatives.filter((c: any) => c.creative_id && ((c.is_video && !c.video_id) || (!c.video_id && !c.image_hash && !c.image_url)));
      if (unresolvedCreatives.length > 0) {
        await Promise.all(unresolvedCreatives.map(async (c: any) => {
          try {
            const creativeRes = await fetch(
              `${META_BASE_URL}/${c.creative_id}?fields=id,image_url,image_hash,title,body,thumbnail_url,object_type,object_story_spec,asset_feed_spec,effective_object_story_id&access_token=${accessToken}`
            );
            const creativeJson = await creativeRes.json();

            if (!creativeRes.ok) {
              console.warn(`[meta-ads-phase5] Creative fallback fetch failed for ${c.creative_id}:`, creativeJson?.error?.message || 'unknown');
              return;
            }

            const media = extractCreativeMediaData(creativeJson);
            if (!c.video_id && media.videoId) c.video_id = media.videoId;
            if (!c.image_hash && media.imageHash) c.image_hash = media.imageHash;
            if (!c.image_url && media.imageUrl) c.image_url = media.imageUrl;
            if (!c.title && media.title) c.title = media.title;
            if (!c.body && media.body) c.body = media.body;
            if (!c.width && media.width) c.width = media.width;
            if (!c.height && media.height) c.height = media.height;
            if (!c.thumbnail_url && creativeJson.thumbnail_url) c.thumbnail_url = creativeJson.thumbnail_url;

            const hasFallbackVideoAssets = Array.isArray(creativeJson?.asset_feed_spec?.videos) && creativeJson.asset_feed_spec.videos.length > 0;
            if (!c.is_video && (media.videoId || hasFallbackVideoAssets || creativeJson?.object_type === 'VIDEO')) {
              c.is_video = true;
            }

            console.log(`[meta-ads-phase5] Fallback creative ${c.creative_id}: videoId=${c.video_id}, imageHash=${c.image_hash}, hasImageUrl=${!!c.image_url}`);
          } catch (e) {
            console.warn(`[meta-ads-phase5] Failed creative fallback for ${c.creative_id}:`, e);
          }
        }));
      }

      // Fetch video source URLs and image dimensions in parallel
      const videoCreatives = rawCreatives.filter((c: any) => c.video_id);
      const imageCreatives = rawCreatives.filter((c: any) => !c.video_id && c.image_hash);
      
      const allFetches: Promise<void>[] = [];
      const videoMetaCache = new Map<string, { video_url: string | null; image_url: string | null; width: number | null; height: number | null }>();
      const imageMetaCache = new Map<string, { image_url: string | null; width: number | null; height: number | null }>();
      
      // Video fetches - get source URL, hi-res picture, dimensions
      for (const c of videoCreatives) {
        allFetches.push((async () => {
          try {
            if (videoMetaCache.has(c.video_id)) {
              const cached = videoMetaCache.get(c.video_id)!;
              if (cached.video_url) c.video_url = cached.video_url;
              if (cached.image_url) c.image_url = cached.image_url;
              if (cached.width) c.width = cached.width;
              if (cached.height) c.height = cached.height;
              return;
            }

            // 'picture' gives a high-res thumbnail (720p+), 'source' gives the playable URL
            const videoRes = await fetch(`${META_BASE_URL}/${c.video_id}?fields=source,picture,format{width,height}&access_token=${accessToken}`);
            const videoJson = await videoRes.json();

            console.log(`[meta-ads-phase5] Video ${c.video_id} response keys:`, Object.keys(videoJson));

            // If direct video fetch fails (common for asset_feed_spec / dynamic creative videos),
            // try fetching via the ad's creative ID with video_id + thumbnails fields
            if (videoJson.error) {
              console.warn(`[meta-ads-phase5] Video ${c.video_id} direct fetch error: ${videoJson.error?.message || 'unknown'}. Trying fallbacks...`);

              // Fallback 1: Use account-level /advideos endpoint with properly URL-encoded filtering
              try {
                const filterJson = JSON.stringify([{field: "id", operator: "IN", value: [c.video_id]}]);
                const adVideosParams = new URLSearchParams({
                  filtering: filterJson,
                  fields: 'id,source,picture,thumbnails,length,title',
                  access_token: accessToken,
                });
                const adVideosUrl = `${META_BASE_URL}/${accountId}/advideos?${adVideosParams.toString()}`;
                const adVideosRes = await fetch(adVideosUrl);
                const adVideosJson = await adVideosRes.json();

                console.log(`[meta-ads-phase5] advideos fallback for ${c.video_id}: ok=${adVideosRes.ok}, hasData=${!!adVideosJson.data}, count=${adVideosJson.data?.length || 0}, error=${adVideosJson.error?.message || 'none'}`);

                if (adVideosRes.ok && adVideosJson.data?.length > 0) {
                  const vid = adVideosJson.data[0];
                  if (vid.source) c.video_url = vid.source;
                  if (vid.picture) c.image_url = vid.picture;
                  if (vid.thumbnails?.data?.length > 0) {
                    const best = vid.thumbnails.data.reduce((b: any, t: any) => (t.width > (b?.width || 0)) ? t : b, vid.thumbnails.data[0]);
                    if (best.width && best.height) {
                      c.width = best.width;
                      c.height = best.height;
                    }
                    if (!c.image_url && best.uri) c.image_url = best.uri;
                  }
                  console.log(`[meta-ads-phase5] advideos fallback SUCCESS for ${c.video_id}: hasVideoUrl=${!!c.video_url}, hasImageUrl=${!!c.image_url}`);
                } else {
                  console.warn(`[meta-ads-phase5] advideos fallback returned no data for ${c.video_id}`);
                }
              } catch (advErr) {
                console.warn(`[meta-ads-phase5] advideos fallback failed for ${c.video_id}:`, advErr);
              }

              // Fallback 2: Fetch the creative object itself for effective_object_story_id
              if (!c.video_url && c.creative_id) {
                try {
                  const creativeFallbackRes = await fetch(
                    `${META_BASE_URL}/${c.creative_id}?fields=effective_object_story_id,thumbnail_url,image_url,object_story_spec&access_token=${accessToken}`
                  );
                  const creativeFallbackJson = await creativeFallbackRes.json();

                  if (creativeFallbackRes.ok && !creativeFallbackJson.error) {
                    const storyId = creativeFallbackJson.effective_object_story_id;
                    if (storyId) {
                      try {
                        const postRes = await fetch(
                          `${META_BASE_URL}/${storyId}?fields=source,picture,full_picture,permalink_url,attachments{media{source,image{src,width,height}}}&access_token=${accessToken}`
                        );
                        const postJson = await postRes.json();

                        console.log(`[meta-ads-phase5] Post ${storyId} response keys:`, Object.keys(postJson), postJson.error ? `error: ${postJson.error.message}` : '');

                        if (postRes.ok && !postJson.error) {
                          if (postJson.source) c.video_url = postJson.source;
                          const attachment = postJson.attachments?.data?.[0];
                          if (!c.video_url && attachment?.media?.source) c.video_url = attachment.media.source;
                          if (postJson.full_picture) c.image_url = postJson.full_picture;
                          else if (attachment?.media?.image?.src) c.image_url = attachment.media.image.src;
                          if (attachment?.media?.image?.width && attachment?.media?.image?.height) {
                            c.width = attachment.media.image.width;
                            c.height = attachment.media.image.height;
                          }
                          console.log(`[meta-ads-phase5] Post fallback for video ${c.video_id}: hasVideoUrl=${!!c.video_url}, hasImageUrl=${!!c.image_url}`);
                        }
                      } catch (postErr) {
                        console.warn(`[meta-ads-phase5] Post fetch failed for ${storyId}:`, postErr);
                      }
                    }

                    if (!c.image_url && creativeFallbackJson.image_url) c.image_url = creativeFallbackJson.image_url;
                    if (!c.image_url && creativeFallbackJson.thumbnail_url) c.image_url = creativeFallbackJson.thumbnail_url;
                  }
                } catch (cfErr) {
                  console.warn(`[meta-ads-phase5] Creative fallback fetch failed for ${c.creative_id}:`, cfErr);
                }
              }

              // Fallback 3: Get preview iframe URL for embedding
              if (!c.video_url) {
                try {
                  const previewRes = await fetch(
                    `${META_BASE_URL}/${c.ad_id}/previews?ad_format=DESKTOP_FEED_STANDARD&access_token=${accessToken}`
                  );
                  const previewJson = await previewRes.json();
                  const previewBody = previewJson?.data?.[0]?.body || '';

                  // Decode HTML entities
                  const decoded = previewBody.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x3D;/g, '=').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

                  // Extract iframe src as the preview URL for embedding
                  const iframeMatch = decoded.match(/<iframe[^>]+src="([^"]+)"/i);
                  if (iframeMatch?.[1]) {
                    let iframeUrl = iframeMatch[1].replace(/&amp;/g, '&');
                    if (iframeUrl.startsWith('//')) iframeUrl = `https:${iframeUrl}`;
                    c.preview_url = iframeUrl;
                    console.log(`[meta-ads-phase5] Got preview iframe URL for ${c.ad_id}`);
                  }

                  // Also try to extract a high-res image from the preview if we don't have one
                  if (!c.image_url) {
                    const imgMatch = decoded.match(/src="(https:\/\/scontent[^"]+)"/);
                    if (imgMatch?.[1]) {
                      c.image_url = imgMatch[1];
                    }
                  }
                } catch (prevErr) {
                  console.warn(`[meta-ads-phase5] Preview fallback failed for ${c.ad_id}:`, prevErr);
                }
              }

              // Fallback 4: Last resort - fetch the ad itself asking for video fields directly
              if (!c.video_url) {
                try {
                  const adDirectRes = await fetch(
                    `${META_BASE_URL}/${c.ad_id}?fields=creative{video_id,effective_object_story_id,object_story_spec{video_data{video_id}}}&access_token=${accessToken}`
                  );
                  const adDirectJson = await adDirectRes.json();
                  const directVideoId = adDirectJson?.creative?.video_id || adDirectJson?.creative?.object_story_spec?.video_data?.video_id;
                  
                  if (directVideoId && directVideoId !== c.video_id) {
                    console.log(`[meta-ads-phase5] Found alternative video ID ${directVideoId} for ad ${c.ad_id}`);
                    // Try fetching this alternative video ID directly
                    const altVideoRes = await fetch(`${META_BASE_URL}/${directVideoId}?fields=source,picture,format{width,height}&access_token=${accessToken}`);
                    const altVideoJson = await altVideoRes.json();
                    if (altVideoRes.ok && !altVideoJson.error && altVideoJson.source) {
                      c.video_url = altVideoJson.source;
                      if (altVideoJson.picture) c.image_url = altVideoJson.picture;
                      if (altVideoJson.format?.length > 0) {
                        const best = altVideoJson.format.reduce((b: any, f: any) => (f.width > (b?.width || 0)) ? f : b, altVideoJson.format[0]);
                        c.width = best.width;
                        c.height = best.height;
                      }
                      console.log(`[meta-ads-phase5] Alt video ID ${directVideoId} fetch SUCCESS for ad ${c.ad_id}`);
                    }
                  }
                } catch (adErr) {
                  console.warn(`[meta-ads-phase5] Ad direct video fetch failed for ${c.ad_id}:`, adErr);
                }
              }

              console.log(`[meta-ads-phase5] FINAL result for video ${c.video_id} (ad ${c.ad_id}): hasVideoUrl=${!!c.video_url}, hasImageUrl=${!!c.image_url}, width=${c.width}, height=${c.height}`);

              // Cache whatever we got (even if partial)
              videoMetaCache.set(c.video_id, {
                video_url: c.video_url,
                image_url: c.image_url,
                width: c.width,
                height: c.height,
              });
              return;
            }

            // Direct fetch succeeded
            const cachedVideo = {
              video_url: videoJson.source || null,
              image_url: videoJson.picture || null,
              width: null as number | null,
              height: null as number | null,
            };

            // Get video dimensions from format
            const formats = videoJson.format;
            if (formats && formats.length > 0) {
              const bestFormat = formats.reduce((best: any, f: any) => (f.width > (best?.width || 0)) ? f : best, formats[0]);
              cachedVideo.width = bestFormat.width;
              cachedVideo.height = bestFormat.height;
              console.log(`[meta-ads-phase5] Video ${c.video_id} dimensions: ${cachedVideo.width}x${cachedVideo.height}`);
            }

            videoMetaCache.set(c.video_id, cachedVideo);

            if (cachedVideo.video_url) c.video_url = cachedVideo.video_url;
            if (cachedVideo.image_url) c.image_url = cachedVideo.image_url;
            if (cachedVideo.width) c.width = cachedVideo.width;
            if (cachedVideo.height) c.height = cachedVideo.height;
          } catch (e) {
            console.warn(`[meta-ads-phase5] Failed to fetch video ${c.video_id}:`, e);
          }
        })());
      }
      
      // Image fetches - get full-size image URL and dimensions via image_hash
      for (const c of imageCreatives) {
        allFetches.push((async () => {
          try {
            if (imageMetaCache.has(c.image_hash)) {
              const cached = imageMetaCache.get(c.image_hash)!;
              if (cached.image_url) c.image_url = cached.image_url;
              if (cached.width) c.width = cached.width;
              if (cached.height) c.height = cached.height;
              return;
            }

            const imgRes = await fetch(`${META_BASE_URL}/${accountId}/adimages?hashes[]=${c.image_hash}&fields=url,url_128,width,height,hash&access_token=${accessToken}`);
            const imgJson = await imgRes.json();

            if (!imgRes.ok) {
              console.warn(`[meta-ads-phase5] Failed image lookup for hash ${c.image_hash}:`, imgJson?.error?.message || 'unknown');
              return;
            }

            console.log(`[meta-ads-phase5] Image hash ${c.image_hash} response keys:`, Object.keys(imgJson));

            // The adimages endpoint returns { data: [ { hash, url, width, height, ... } ] }
            // Try data array first, then images object keyed by hash
            let imgData = null;
            if (imgJson.data && Array.isArray(imgJson.data) && imgJson.data.length > 0) {
              imgData = imgJson.data[0];
            } else if (imgJson.images && imgJson.images[c.image_hash]) {
              imgData = imgJson.images[c.image_hash];
            }

            if (imgData) {
              const cachedImage = {
                image_url: imgData.url || imgData.url_128 || null,
                width: Number(imgData.width || 0) || null,
                height: Number(imgData.height || 0) || null,
              };

              imageMetaCache.set(c.image_hash, cachedImage);

              if (cachedImage.image_url) {
                c.image_url = cachedImage.image_url;
                console.log(`[meta-ads-phase5] Got full-res image URL for hash ${c.image_hash}`);
              }
              if (cachedImage.width) c.width = cachedImage.width;
              if (cachedImage.height) c.height = cachedImage.height;
              console.log(`[meta-ads-phase5] Image ${c.image_hash} dimensions: ${c.width}x${c.height}`);
            } else {
              console.warn(`[meta-ads-phase5] No image data found for hash ${c.image_hash}, response:`, JSON.stringify(imgJson).slice(0, 200));
            }
          } catch (e) {
            console.warn(`[meta-ads-phase5] Failed to fetch image dims for hash ${c.image_hash}:`, e);
          }
        })());
      }
      
      await Promise.all(allFetches);

      const creatives = rawCreatives;

      // Log API usage
      await supabase.from('api_usage_log').insert({
        service_name: 'meta_ads',
        endpoint: 'creatives',
        status: 'success',
        request_count: 1,
        user_id: null,
        metadata: { action: 'creatives', userId: authResult.userId },
      });

      return new Response(
        JSON.stringify({ success: true, creatives }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── ACTION: FUNNEL ───
    if (action === 'funnel') {
      // Get lead attributions with deal info
      const { data: attributions, error: attrError } = await supabase
        .from('lead_source_attributions')
        .select('id, client_id, deal_id, meta_campaign_id, meta_campaign_name, meta_ad_id, meta_ad_name, meta_adset_id, meta_adset_name, attributed_at, source_type')
        .not('meta_campaign_id', 'is', null)
        .order('attributed_at', { ascending: false })
        .limit(500);

      if (attrError) {
        console.error('[meta-ads-phase5] Attribution query error:', attrError);
      }

      // Get deals for these leads
      const dealIds = (attributions || []).filter((a: any) => a.deal_id).map((a: any) => a.deal_id);
      let deals: any[] = [];
      if (dealIds.length > 0) {
        const { data: dealData } = await supabase
          .from('client_deals')
          .select('id, current_stage, current_stage_number, deal_type, total_contract_price, commission_estimate, settlement_date, created_at')
          .in('id', dealIds);
        deals = dealData || [];
      }

      // Get total client count (all leads, not just attributed)
      const { count: totalClients } = await supabase
        .from('clients')
        .select('id', { count: 'exact', head: true });

      // Build funnel stages
      const totalLeads = attributions?.length || 0;
      const leadsWithDeals = (attributions || []).filter((a: any) => a.deal_id).length;
      
      // Classify deal stages
      const qualifiedDeals = deals.filter(d => d.current_stage_number >= 2).length;
      const approvedDeals = deals.filter(d => d.current_stage_number >= 4).length;
      const settledDeals = deals.filter(d => d.current_stage_number >= 6 || d.settlement_date).length;

      // Build by-campaign breakdown
      const campaignMap: Record<string, any> = {};
      for (const attr of (attributions || [])) {
        const cid = attr.meta_campaign_id || 'unknown';
        if (!campaignMap[cid]) {
          campaignMap[cid] = {
            campaign_id: cid,
            campaign_name: attr.meta_campaign_name || 'Unknown',
            leads: 0,
            deals: 0,
            qualified: 0,
            approved: 0,
            settled: 0,
          };
        }
        campaignMap[cid].leads++;
        if (attr.deal_id) {
          campaignMap[cid].deals++;
          const deal = deals.find(d => d.id === attr.deal_id);
          if (deal) {
            if (deal.current_stage_number >= 2) campaignMap[cid].qualified++;
            if (deal.current_stage_number >= 4) campaignMap[cid].approved++;
            if (deal.current_stage_number >= 6 || deal.settlement_date) campaignMap[cid].settled++;
          }
        }
      }

      const funnel = {
        stages: [
          { name: 'Meta Leads (Attributed)', value: totalLeads, color: 'hsl(var(--primary))' },
          { name: 'Deals Created', value: leadsWithDeals, color: 'hsl(220, 70%, 55%)' },
          { name: 'Qualified', value: qualifiedDeals, color: 'hsl(160, 60%, 45%)' },
          { name: 'Approved', value: approvedDeals, color: 'hsl(30, 80%, 55%)' },
          { name: 'Settled / Won', value: settledDeals, color: 'hsl(142, 71%, 45%)' },
        ],
        byCampaign: Object.values(campaignMap).sort((a: any, b: any) => b.leads - a.leads),
        totalClients: totalClients || 0,
      };

      return new Response(
        JSON.stringify({ success: true, funnel }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── ACTION: TRUE ROI ───
    if (action === 'true_roi') {
      const metaInsights = body.insights || [];
      
      // Get attributions with deals
      const { data: attributions } = await supabase
        .from('lead_source_attributions')
        .select('id, client_id, deal_id, meta_campaign_id, meta_campaign_name, attributed_at')
        .not('meta_campaign_id', 'is', null)
        .limit(500);

      const dealIds = (attributions || []).filter((a: any) => a.deal_id).map((a: any) => a.deal_id);
      let deals: any[] = [];
      if (dealIds.length > 0) {
        const { data: dealData } = await supabase
          .from('client_deals')
          .select('id, current_stage, current_stage_number, total_contract_price, commission_estimate, settlement_date, deal_type')
          .in('id', dealIds);
        deals = dealData || [];
      }

      // Calculate per-campaign ROI
      const campaignROI: Record<string, any> = {};
      
      // Aggregate Meta spend by campaign
      for (const row of metaInsights) {
        const cid = row.campaign_id;
        if (!cid) continue;
        if (!campaignROI[cid]) {
          campaignROI[cid] = {
            campaign_id: cid,
            campaign_name: row.campaign_name || 'Unknown',
            meta_spend: 0,
            meta_leads: 0,
            meta_clicks: 0,
            attributed_leads: 0,
            deals_created: 0,
            deals_settled: 0,
            total_deal_value: 0,
            total_commission: 0,
            meta_cpl: 0,
            true_cpl: 0,
            cost_per_deal: 0,
            roas: 0,
          };
        }
        campaignROI[cid].meta_spend += Number(row.spend || 0);
        campaignROI[cid].meta_clicks += Number(row.clicks || 0);
        const leadAction = (row.actions || []).find((a: any) => a.action_type === 'lead');
        campaignROI[cid].meta_leads += leadAction ? Number(leadAction.value) : 0;
      }

      // Enrich with CRM data
      for (const attr of (attributions || [])) {
        const cid = attr.meta_campaign_id;
        if (!cid || !campaignROI[cid]) continue;
        campaignROI[cid].attributed_leads++;
        if (attr.deal_id) {
          campaignROI[cid].deals_created++;
          const deal = deals.find(d => d.id === attr.deal_id);
          if (deal) {
            if (deal.current_stage_number >= 6 || deal.settlement_date) {
              campaignROI[cid].deals_settled++;
              campaignROI[cid].total_deal_value += Number(deal.total_contract_price || 0);
              campaignROI[cid].total_commission += Number(deal.commission_estimate || 0);
            }
          }
        }
      }

      // Calculate derived metrics
      const results = Object.values(campaignROI).map((c: any) => {
        c.meta_cpl = c.meta_leads > 0 ? c.meta_spend / c.meta_leads : 0;
        c.true_cpl = c.attributed_leads > 0 ? c.meta_spend / c.attributed_leads : 0;
        c.cost_per_deal = c.deals_created > 0 ? c.meta_spend / c.deals_created : 0;
        c.cost_per_settled = c.deals_settled > 0 ? c.meta_spend / c.deals_settled : 0;
        c.roas = c.meta_spend > 0 ? c.total_commission / c.meta_spend : 0;
        return c;
      }).sort((a: any, b: any) => b.meta_spend - a.meta_spend);

      // Totals
      const totals = results.reduce((acc: any, r: any) => {
        acc.meta_spend += r.meta_spend;
        acc.meta_leads += r.meta_leads;
        acc.attributed_leads += r.attributed_leads;
        acc.deals_created += r.deals_created;
        acc.deals_settled += r.deals_settled;
        acc.total_deal_value += r.total_deal_value;
        acc.total_commission += r.total_commission;
        return acc;
      }, { meta_spend: 0, meta_leads: 0, attributed_leads: 0, deals_created: 0, deals_settled: 0, total_deal_value: 0, total_commission: 0 });

      totals.meta_cpl = totals.meta_leads > 0 ? totals.meta_spend / totals.meta_leads : 0;
      totals.true_cpl = totals.attributed_leads > 0 ? totals.meta_spend / totals.attributed_leads : 0;
      totals.cost_per_deal = totals.deals_created > 0 ? totals.meta_spend / totals.deals_created : 0;
      totals.cost_per_settled = totals.deals_settled > 0 ? totals.meta_spend / totals.deals_settled : 0;
      totals.roas = totals.meta_spend > 0 ? totals.total_commission / totals.meta_spend : 0;

      return new Response(
        JSON.stringify({ success: true, campaigns: results, totals }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[meta-ads-phase5] Error:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'analyze-meta-ads-phase5'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
