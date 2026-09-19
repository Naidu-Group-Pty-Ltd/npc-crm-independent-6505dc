import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { geocodeAddress } from '../_shared/geocode/geocoder.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { logApiUsage, extractOpenAIUsage } from '../_shared/logApiUsage.ts';
import { internalError } from '../_shared/errorResponse.ts';
import {
  mergeExtractedData,
  parseVisionResponse,
  populatedFieldCount,
  processToStructuredPayload,
  escapeRegExp,
  type ExtractedPropertyData,
  type StructuredPropertyPayload,
} from '../_shared/propertyExtraction.pure.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface PageImage {
  pageNumber: number;
  base64: string;
  width: number;
  height: number;
}

// ============= VISION EXTRACTION CONFIG =============

/**
 * Max images per single API call. GPT-4o can handle ~20 images but
 * we keep it at 10 to balance coverage, token limits and reliability.
 */
const VISION_BATCH_SIZE = 10;

/**
 * Max concurrent batch calls. We run 4 batches in parallel to keep large
 * documents under the edge-function wall clock while staying within rate limits.
 */
const MAX_PARALLEL_BATCHES = 4;

// ============= SYSTEM PROMPT =============

const EXTRACTION_SYSTEM_PROMPT = `You are an expert Australian property document analyst handling RESIDENTIAL, COMMERCIAL and INDUSTRIAL brochures, Information Memoranda (IMs), contract attachments, rent rolls, lease schedules, and listing flyers.

============= MANDATORY 2-STEP PROCESS =============
STEP 1 — DETECT ASSET CLASS:
  Determine detectedAssetClass ∈ {residential, commercial, industrial} from visual + textual signals across ALL pages:
    • Residential: floor plans with bedrooms/bathrooms, "house & land" branding, suburban photography, builder logos, weekly rent quotes.
    • Commercial: NLA, "office floors", "retail tenancy", "going concern", "WALE", cap rate quoted, named tenants, outgoings schedule, IM cover.
    • Industrial: GLA, hardstand, clearance/eaves height, dock doors, kVA, racking, "warehouse", "logistics estate", zoning codes IN1/IN2/IN3, three-phase power, container access.
  Output detectedAssetClass + detectedAssetConfidence (0–1).

STEP 2 — STRICT EXTRACTION:
  Only extract values explicitly stated in the document. NEVER fabricate. NEVER carry over examples. Return null/omit any field not present.
  Numbers: raw integers/decimals (no $, %, commas). Convert sqft→sqm (×0.0929), ha→sqm (×10000), kW→kVA (×1.25 typical), amps×voltage÷1000→kVA.

============= UNIVERSAL FIELDS =============
- Full street address (incl. lot numbers like "Lot 123"), suburb, state (NSW/VIC/QLD/WA/SA/TAS/ACT/NT), 4-digit postcode.
- Property/package price (total).
- Property type: residential => house/apartment/townhouse/land/house_and_land. Commercial/industrial => office/retail/warehouse/logistics/manufacturing/mixed_use/medical/childcare/hospitality/other.
- Year built, agent/agency, key features, condition rating (A/B/C/D only if graded).

============= RESIDENTIAL ONLY =============
- Bedrooms, bathrooms, car spaces; land size and building size (sqm).
- Weekly rent estimate, council/water/strata, insurance, PM%.
- House & land split: landPrice, buildPrice. isNewBuild = true only if "brand new"/"off the plan"/"house and land"/named builder.
- Stamp duty, agent/buyer's agent fee if calculated.

============= COMMERCIAL & INDUSTRIAL — STRUCTURE =============
- assetClass, assetSubType (e.g. "A-Grade Office", "Distribution Warehouse", "Neighbourhood Childcare"), tenure, zoning, propertyName (estate/building).
- Areas: gfaSqm (Gross Floor Area), nlaSqm (Net Lettable Area — offices/retail), glaSqm (Gross Lettable Area — industrial), siteAreaSqm, hardstandSqm, siteCoverPct, officePct, parkingBays.

============= COMMERCIAL & INDUSTRIAL — INCOME (CRITICAL) =============
Pull these ONLY when the document explicitly states them in financial summaries, rent rolls, vendor advices, or cap-rate panels:
- passingNoiPa: net operating income p.a. as written.
- marketNoiPa: "market" / "fully leased" NOI estimate.
- passingCapRatePct & marketCapRatePct: as percent numbers (e.g. 6.25).
- vendorAdvisedRentPa: gross or net rent p.a. as advised.
- vendorAdvisedOutgoingsPa, outgoingsTotalPa, outgoingsRecoverablePa.
- vendorAdvisedYieldPct: vendor-quoted yield as percent.
- gstTreatment: going_concern | margin_scheme | standard | input_taxed.

============= COMMERCIAL & INDUSTRIAL — LEASE =============
- leaseType: gross | net | semi_gross | triple_net.
- leaseExpiryDate: yyyy-mm-dd.
- leaseOptions: e.g. "3 + 3 + 3 years".
- waleYears: weighted average lease expiry (numeric).
- tenantNames: array of named tenants (max 5).

============= INDUSTRIAL SPECS =============
- clearanceMetres (eaves / internal clearance height).
- powerKva (from kVA, or derive from amps × voltage ÷ 1000 if voltage stated).
- dockDoors (recessed loading docks + roller shutters, summed).
- groundFloorLoadKpa.
- truckAccess: poor | average | good | excellent (only if explicitly characterised).

============= FOCUS AREAS BY PAGE =============
- Hero / cover: address, key headline metrics, asset class hints.
- Floor / lease plans: dimensions, GFA/NLA/GLA, dock doors, office%.
- Financial summary or "Investment Highlights": NOI, cap rate, WALE, yield.
- Rent roll / tenancy schedule: tenant names, lease expiry, options.
- Outgoings schedule: total + recoverable split.
- Vendor advice / disclaimers: GST treatment, going concern statements.

Return ONLY valid JSON with the fields requested (use null for values not found).`;

function buildUserPrompt(imageCount: number, fileName: string, propertyCategory = 'auto', batchInfo?: string): string {
  const batchNote = batchInfo ? `\n${batchInfo}` : '';
  return `Extract all ${propertyCategory} property details from these ${imageCount} page(s) of the document "${fileName}".${batchNote}

Return JSON format:
{
  "address": "full street address including lot number",
  "suburb": "suburb name only",
  "state": "state abbreviation (NSW/VIC/QLD/WA/SA/TAS/ACT/NT)",
  "postcode": "4-digit postcode",
  "price": numeric total price (no $ or commas),
  "weeklyRent": numeric weekly rent,
  "bedrooms": number,
  "bathrooms": number,
  "carSpaces": number,
  "landSize": numeric land size in sqm,
  "buildSize": numeric building size in sqm,
  "propertyType": "house" or "apartment" or "townhouse" or "land" or "house_and_land",
  "landPrice": numeric land component price,
  "buildPrice": numeric build component price,
  "isNewBuild": true if new build or house and land package,
  "councilRates": numeric annual council rates,
  "waterRates": numeric annual water rates,
  "strataFees": numeric annual strata/body corp fees,
  "insuranceEstimate": numeric annual insurance,
  "propertyManagementPercent": numeric percentage (e.g., 8 for 8%),
  "yearBuilt": numeric year of construction,
  "stampDuty": numeric stamp duty amount,
  "agentFee": numeric agent/buyer's agent fee,
  "assetClass": "office/retail/industrial/mixed_use/medical/childcare/hospitality/other",
  "assetSubType": "warehouse/logistics/manufacturing/cold_storage/flex/data_centre/transport_yard/other or listing sub-type",
  "tenure": "freehold/leasehold/strata",
  "zoning": "planning or industrial zoning",
  "gfaSqm": numeric gross floor area,
  "nlaSqm": numeric net lettable area,
  "glaSqm": numeric gross lettable area,
  "siteAreaSqm": numeric site area,
  "parkingBays": numeric parking spaces/bays,
  "currentValuation": numeric valuation if shown,
  "propertyName": "building/estate name",
  "siteCoverPct": numeric site cover percentage,
  "officePct": numeric office percentage,
  "hardstandSqm": numeric hardstand area,
  "clearanceMetres": numeric warehouse clearance height,
  "powerKva": numeric power capacity in kVA,
  "dockDoors": numeric dock doors,
  "groundFloorLoadKpa": numeric floor load in kPa,
  "conditionRating": "A/B/C/D if stated or infer only if explicitly graded",
  "detectedAssetClass": "residential | commercial | industrial (auto-detect from content)",
  "detectedAssetConfidence": numeric 0-1,
  "passingNoiPa": numeric passing NOI p.a.,
  "marketNoiPa": numeric market/stabilised NOI p.a.,
  "passingCapRatePct": numeric passing cap rate as percent (e.g. 6.25),
  "marketCapRatePct": numeric market cap rate as percent,
  "vendorAdvisedRentPa": numeric vendor-quoted rent p.a.,
  "vendorAdvisedOutgoingsPa": numeric vendor-quoted outgoings p.a.,
  "outgoingsTotalPa": numeric total outgoings p.a.,
  "outgoingsRecoverablePa": numeric recoverable outgoings p.a.,
  "vendorAdvisedYieldPct": numeric vendor-quoted yield as percent,
  "gstTreatment": "going_concern | margin_scheme | standard | input_taxed",
  "leaseType": "gross | net | semi_gross | triple_net",
  "leaseExpiryDate": "yyyy-mm-dd",
  "leaseOptions": "e.g. 3 + 3 + 3 years",
  "waleYears": numeric weighted average lease expiry,
  "tenantNames": ["array of named tenants, max 5"],
  "truckAccess": "poor | average | good | excellent"
}`;
}

// ============= GPT-4o VISION EXTRACTION =============

async function extractWithVision(
  images: PageImage[], 
  openaiKey: string, 
  fileName: string,
  propertyCategory = 'auto'
): Promise<ExtractedPropertyData> {
  console.log(`🔍 Analyzing ${images.length} page images with GPT-4o Vision...`);
  
  if (images.length <= VISION_BATCH_SIZE) {
    return await extractWithVisionSingle(images, openaiKey, fileName, propertyCategory);
  }
  
  return await extractWithVisionBatched(images, openaiKey, fileName, propertyCategory);
}

async function extractWithVisionSingle(
  images: PageImage[], 
  openaiKey: string, 
  fileName: string,
  propertyCategory = 'auto',
  batchInfo?: string
): Promise<ExtractedPropertyData> {
  const userContent: any[] = [
    {
      type: "text",
      text: buildUserPrompt(images.length, fileName, propertyCategory, batchInfo),
    }
  ];

  for (const image of images) {
    // Detect format from base64 header or default to jpeg for compressed images
    const mimeType = image.base64.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
    userContent.push({
      type: "image_url",
      image_url: {
        url: `data:${mimeType};base64,${image.base64}`,
        detail: "high"
      }
    });
  }

  try {
    const { callLLMRaw } = await import('../_shared/llmRouter.ts');
    const response = await callLLMRaw({
      agentKey: 'pdf_property_extraction',
      // This function already writes its own api_usage_log row for this call;
      // letting the router log it too would bill the tenant twice.
      meterUsage: false,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: userContent as any },
      ],
      temperature: 0.1,
      maxTokens: 4500,
      responseFormat: { type: 'json_object' },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ OpenAI Vision API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Log API usage
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const visionUsage = extractOpenAIUsage(data);
    await logApiUsage(supabase, {
      service_name: 'openai',
      endpoint: '/v1/chat/completions',
      model_used: 'gpt-4o',
      prompt_tokens: visionUsage.prompt_tokens,
      completion_tokens: visionUsage.completion_tokens,
      tokens_used: visionUsage.total_tokens,
      status: 'success',
      metadata: { function: 'parse-property-pdf', action: 'vision-extract', pages: images.length },
    });

    console.log(`📝 GPT-4o Vision response (${images.length} pages):`, content.substring(0, 200));

    const extracted = parseVisionResponse(content);
    if (!extracted) {
      throw new Error('The extraction model returned a response that could not be read as JSON.');
    }
    console.log(`📊 Recovered ${populatedFieldCount(extracted)} fields from ${images.length} page(s)`);
    return extracted;

  } catch (error) {
    console.error('❌ Vision extraction error:', error);
    throw error;
  }
}

/**
 * Process large documents in batches with controlled parallelism.
 * - Splits images into batches of VISION_BATCH_SIZE
 * - Runs up to MAX_PARALLEL_BATCHES concurrently
 * - Merges all results with priority to earlier pages (cover/specs)
 */
async function extractWithVisionBatched(
  images: PageImage[],
  openaiKey: string,
  fileName: string,
  propertyCategory = 'auto'
): Promise<ExtractedPropertyData> {
  // Create batches
  const batches: PageImage[][] = [];
  for (let i = 0; i < images.length; i += VISION_BATCH_SIZE) {
    batches.push(images.slice(i, i + VISION_BATCH_SIZE));
  }
  
  console.log(`📚 Large document: ${images.length} pages → ${batches.length} batches (batch size: ${VISION_BATCH_SIZE}, parallel: ${MAX_PARALLEL_BATCHES})`);
  
  let mergedResult: ExtractedPropertyData = {};
  const failedBatches: number[] = [];

  // Process batches with controlled parallelism
  for (let i = 0; i < batches.length; i += MAX_PARALLEL_BATCHES) {
    const parallelBatches = batches.slice(i, i + MAX_PARALLEL_BATCHES);
    
    const promises = parallelBatches.map((batch, offset) => {
      const batchIndex = i + offset;
      const pageRange = `${batch[0].pageNumber}-${batch[batch.length - 1].pageNumber}`;
      const batchInfo = `This is batch ${batchIndex + 1} of ${batches.length} (pages ${pageRange} of a ${images.length}-page document). Extract whatever property information is visible on these pages.`;
      
      console.log(`🔍 Starting batch ${batchIndex + 1}/${batches.length} (pages: ${pageRange})`);
      
      return extractWithVisionSingle(batch, openaiKey, fileName, propertyCategory, batchInfo)
        .then(result => ({ batchIndex, result, error: null as Error | null }))
        .catch(error => {
          console.error(`❌ Batch ${batchIndex + 1} failed:`, error);
          return { batchIndex, result: {} as ExtractedPropertyData, error };
        });
    });
    
    const results = await Promise.all(promises);
    
    for (const { batchIndex, result, error } of results) {
      if (error) {
        failedBatches.push(batchIndex + 1);
        continue;
      }
      mergedResult = mergeExtractedData(mergedResult, result);
      console.log(`✅ Batch ${batchIndex + 1} merged (${populatedFieldCount(mergedResult)} fields populated)`);
    }
  }

  // Losing every batch is a failure, not an empty document — say so instead of
  // returning `{}` and letting the caller save a blank property record.
  if (failedBatches.length === batches.length) {
    throw new Error(`All ${batches.length} extraction batches failed. The document could not be analysed.`);
  }
  if (failedBatches.length > 0) {
    console.warn(`⚠️ ${failedBatches.length}/${batches.length} batches failed (batches ${failedBatches.join(', ')}); the result is partial.`);
  }

  return mergedResult;
}

// ============= SINGLE IMAGE EXTRACTION =============

async function extractFromSingleImage(
  base64: string,
  mimeType: string,
  openaiKey: string,
  fileName: string,
  propertyCategory = 'auto'
): Promise<ExtractedPropertyData> {
  console.log(`🔍 Analyzing single image with GPT-4o Vision...`);
  
  const { callLLMRaw } = await import('../_shared/llmRouter.ts');
  const response = await callLLMRaw({
    agentKey: 'pdf_property_extraction',
    // This function already writes its own api_usage_log row for this call;
    // letting the router log it too would bill the tenant twice.
    meterUsage: false,
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: buildUserPrompt(1, fileName, propertyCategory) },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
        ] as any,
      },
    ],
    temperature: 0.1,
    maxTokens: 4500,
    responseFormat: { type: 'json_object' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ OpenAI Vision API error:', response.status, errorText);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  
  // Log API usage
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = createClient(supabaseUrl, supabaseKey);
  const singleUsage = extractOpenAIUsage(data);
  await logApiUsage(sb, {
    service_name: 'openai',
    endpoint: '/v1/chat/completions',
    model_used: 'gpt-4o',
    prompt_tokens: singleUsage.prompt_tokens,
    completion_tokens: singleUsage.completion_tokens,
    tokens_used: singleUsage.total_tokens,
    status: 'success',
    metadata: { function: 'parse-property-pdf', action: 'single-image-extract' },
  });

  console.log('📝 Single image Vision response:', content.substring(0, 200));

  const extracted = parseVisionResponse(content);
  if (!extracted) {
    throw new Error('The extraction model returned a response that could not be read as JSON.');
  }
  return extracted;
}

// ============= GOOGLE MAPS GEOCODING =============

async function completeAddressThroughGeocoder(
  payload: StructuredPropertyPayload,
  originalExtractedAddress: string | null | undefined,
  // The geocoding chain's cache and allowances live in the database, because
  // a ceiling held in an isolate is not a ceiling under horizontal scaling.
  db: unknown,
): Promise<StructuredPropertyPayload> {
  const originalStreetAddress = originalExtractedAddress || payload.propertyAddress;
  
  if (payload.suburb && payload.state && payload.postcode) {
    console.log('✅ All address components present, skipping geocoding');
    payload.propertyAddress = buildFullAddress(originalStreetAddress, payload.suburb, payload.state, payload.postcode);
    return payload;
  }
  
  if (!payload.propertyAddress) {
    return payload;
  }
  
  if (/^Lot\s+\d+$/i.test(payload.propertyAddress.trim())) {
    console.log('⚠️ Address is just a lot number, skipping geocoding');
    return payload;
  }
  
  const parts: string[] = [payload.propertyAddress];
  if (!payload.propertyAddress.toLowerCase().includes('australia')) {
    parts.push('Australia');
  }
  
  const searchQuery = parts.join(', ');
  console.log('🗺️ Geocoding search query:', searchQuery);
  
  // The one geocoding chain (`_shared/geocode/geocoder.ts`): OpenStreetMap,
  // then Google only where an operator lists it — never the suburb centroid
  // here, because the point of this call is the suburb, state and postcode
  // the extraction did not read, and a centroid names only what it was
  // given. Each provider budgets itself. Refusal returns the payload
  // untouched, exactly what a failed lookup already did, so the address
  // keeps whatever the extraction genuinely read and nothing is filled in
  // from a guess.
  try {
    const outcome = await geocodeAddress(
      db,
      { address: searchQuery, suburb: payload.suburb, state: payload.state, postcode: payload.postcode },
      { allowLocalityFallback: false, feature: 'parse-property-pdf/geocode' },
    );
    if (!outcome.ok) {
      console.log(`No geocoding result (${outcome.reason}): ${outcome.detail}`);
      return payload;
    }
    const found = outcome.result;
    if (found.precision === 'locality' || found.precision === 'postcode') {
      console.log('⚠️ Geocoding result too generic, keeping original');
      return payload;
    }

    payload.suburb = payload.suburb || found.suburb || undefined;
    payload.state = payload.state || found.state || undefined;
    payload.postcode = payload.postcode || found.postcode || undefined;
    payload.propertyAddress = buildFullAddress(originalStreetAddress, payload.suburb, payload.state, payload.postcode);

    console.log('✅ Final composed address:', payload.propertyAddress);
  } catch (error) {
    console.error('Geocoding error:', error);
  }

  return payload;
}

/**
 * The full address, or NULL where there is nothing to compose one from.
 *
 * Never a worded absence: the caller decides how to say "no address was read",
 * and a sentence in this slot is truthy and travels as though it were one.
 */
function buildFullAddress(
  streetAddress: string | null | undefined,
  suburb: string | undefined,
  state: string | undefined,
  postcode: string | undefined
): string | null {
  const parts: string[] = [];
  
  if (streetAddress) {
    let cleanStreet = streetAddress;
    // Escape the interpolated values: an unescaped suburb like "St. Kilda"
    // matched "St4 Kilda" too, and a metacharacter could throw outright.
    if (suburb) cleanStreet = cleanStreet.replace(new RegExp(`,?\\s*\\b${escapeRegExp(suburb)}\\b`, 'gi'), '');
    if (state) cleanStreet = cleanStreet.replace(new RegExp(`,?\\s*\\b${escapeRegExp(state)}\\b`, 'gi'), '');
    if (postcode) cleanStreet = cleanStreet.replace(new RegExp(`,?\\s*\\b${escapeRegExp(postcode)}\\b`, 'g'), '');
    cleanStreet = cleanStreet
      .replace(/,\s*Australia$/i, '')
      .replace(/,\s*,/g, ',')
      .replace(/\s{2,}/g, ' ')
      .replace(/^\s*,\s*/, '')
      .replace(/,\s*$/, '')
      .trim();
    if (cleanStreet) parts.push(cleanStreet);
  }
  
  if (suburb) parts.push(suburb);
  
  if (state && postcode) {
    parts.push(`${state} ${postcode}`);
  } else if (state) {
    parts.push(state);
  } else if (postcode) {
    parts.push(postcode);
  }
  
  return parts.join(', ') || null;
}

// ============= MAIN HANDLER =============

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  console.log('🏠 Parse property PDF function invoked');
  
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
    
    const body = await req.json();
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[parse-property-pdf] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[parse-property-pdf] Authenticated user: ${userId}`);
    
    const { 
      pageImages,
      singleImage,
      imageMimeType,
      fileName,
      base64Content,
      propertyCategory = 'auto',
    } = body;
    
    const fileNameToUse = fileName || 'document.pdf';
    console.log('📄 Processing:', fileNameToUse);
    
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    
    let extractedData: ExtractedPropertyData;
    let extractionMethod = 'unknown';
    
    // Method 1: Page images from client-side PDF rendering (PREFERRED)
    if (pageImages && Array.isArray(pageImages) && pageImages.length > 0) {
      console.log(`📚 Received ${pageImages.length} page images from client`);
      extractedData = await extractWithVision(pageImages, openaiKey, fileNameToUse, propertyCategory);
      extractionMethod = `gpt-4o-vision-pages-${pageImages.length}`;
    }
    // Method 2: Single image file
    else if (singleImage && imageMimeType) {
      console.log('🖼️ Processing single image file');
      extractedData = await extractFromSingleImage(singleImage, imageMimeType, openaiKey, fileNameToUse, propertyCategory);
      extractionMethod = 'gpt-4o-vision-image';
    }
    // Method 3: Legacy fallback
    else if (base64Content) {
      console.error('❌ Raw PDF base64 received - client must render pages to images first');
      return new Response(JSON.stringify({
        success: false,
        error: 'PDF must be converted to images on the client before sending.',
        hint: 'The client should use convertPdfToImages() to render PDF pages as PNG images before calling this function.',
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    else {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'No valid content provided.' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('📊 Extracted data:', JSON.stringify(extractedData, null, 2));
    
    const originalExtractedStreetAddress = extractedData.address;
    let structuredPayload = processToStructuredPayload(extractedData);
    
    const needsGeocoding = !structuredPayload.postcode || !structuredPayload.state || !structuredPayload.suburb;
    
    if (needsGeocoding && structuredPayload.propertyAddress) {
      // Through the geocoding chain, which needs no Google key.
      console.log('🗺️ Attempting to complete the address through the geocoding chain...');
      structuredPayload = await completeAddressThroughGeocoder(
        structuredPayload, originalExtractedStreetAddress, supabase,
      );
    } else if (structuredPayload.suburb && structuredPayload.state && structuredPayload.postcode) {
      structuredPayload.propertyAddress = buildFullAddress(originalExtractedStreetAddress, structuredPayload.suburb, structuredPayload.state, structuredPayload.postcode);
      console.log('✅ Built full address without geocoding:', structuredPayload.propertyAddress);
    }

    console.log('✅ Final structured payload:', JSON.stringify(structuredPayload, null, 2));

    return new Response(JSON.stringify({
      success: true,
      extractedData: {
        extractedAddress: structuredPayload.propertyAddress,
        extractedSuburb: structuredPayload.suburb,
        extractedState: structuredPayload.state,
        extractedPostcode: structuredPayload.postcode,
        extractedPrice: structuredPayload.purchasePrice,
        extractedRent: structuredPayload.weeklyRent,
        extractedWeeklyRent: structuredPayload.weeklyRent,
        extractedBedrooms: structuredPayload.bedrooms,
        extractedBathrooms: structuredPayload.bathrooms,
        extractedCarSpaces: structuredPayload.carSpaces,
        extractedLandSize: structuredPayload.landSize,
        extractedBuildSize: structuredPayload.buildSize,
        extractedPropertyType: structuredPayload.propertyType,
        extractedLandPrice: structuredPayload.landPrice,
        extractedBuildPrice: structuredPayload.buildPrice,
        // Asked of the model, coerced by `propertyExtraction.pure.ts` and
        // carried on the payload — and never published here, so the two reads
        // the report generator already had for them were always `undefined`.
        extractedStampDuty: structuredPayload.stampDuty,
        extractedAgentFee: structuredPayload.agentFee,
        extractedCouncilRates: structuredPayload.councilRates,
        extractedWaterRates: structuredPayload.waterRates,
        extractedStrataFees: structuredPayload.strataFees,
        extractedInsurance: structuredPayload.insuranceEstimate,
        extractedPropertyManagementPercent: structuredPayload.propertyManagementPercent,
        extractedYearBuilt: structuredPayload.yearBuilt,
        isNewBuild: structuredPayload.isNewBuild,
        extractedIsNewBuild: structuredPayload.isNewBuild,
        extractedAssetClass: structuredPayload.assetClass,
        extractedAssetSubType: structuredPayload.assetSubType,
        extractedTenure: structuredPayload.tenure,
        extractedZoning: structuredPayload.zoning,
        extractedGfaSqm: structuredPayload.gfaSqm,
        extractedNlaSqm: structuredPayload.nlaSqm,
        extractedGlaSqm: structuredPayload.glaSqm,
        extractedSiteAreaSqm: structuredPayload.siteAreaSqm,
        extractedParkingBays: structuredPayload.parkingBays,
        extractedValuation: structuredPayload.currentValuation,
        extractedPropertyName: structuredPayload.propertyName,
        extractedSiteCoverPct: structuredPayload.siteCoverPct,
        extractedOfficePct: structuredPayload.officePct,
        extractedHardstandSqm: structuredPayload.hardstandSqm,
        extractedClearanceMetres: structuredPayload.clearanceMetres,
        extractedPowerKva: structuredPayload.powerKva,
        extractedDockDoors: structuredPayload.dockDoors,
        extractedGroundFloorLoadKpa: structuredPayload.groundFloorLoadKpa,
        extractedConditionRating: structuredPayload.conditionRating,
        detectedAssetClass: structuredPayload.detectedAssetClass,
        detectedAssetConfidence: structuredPayload.detectedAssetConfidence,
        extractedPassingNoiPa: structuredPayload.passingNoiPa,
        extractedMarketNoiPa: structuredPayload.marketNoiPa,
        extractedPassingCapRatePct: structuredPayload.passingCapRatePct,
        extractedMarketCapRatePct: structuredPayload.marketCapRatePct,
        extractedVendorRentPa: structuredPayload.vendorAdvisedRentPa,
        extractedVendorOutgoingsPa: structuredPayload.vendorAdvisedOutgoingsPa,
        extractedOutgoingsTotalPa: structuredPayload.outgoingsTotalPa,
        extractedOutgoingsRecoverablePa: structuredPayload.outgoingsRecoverablePa,
        extractedVendorYieldPct: structuredPayload.vendorAdvisedYieldPct,
        extractedGstTreatment: structuredPayload.gstTreatment,
        extractedLeaseType: structuredPayload.leaseType,
        extractedLeaseExpiryDate: structuredPayload.leaseExpiryDate,
        extractedLeaseOptions: structuredPayload.leaseOptions,
        extractedWaleYears: structuredPayload.waleYears,
        extractedTenantNames: structuredPayload.tenantNames,
        extractedTruckAccess: structuredPayload.truckAccess,
      },
      structuredPayload,
      extractionMethod,
      metadata: {
        fileName: fileNameToUse,
        processedAt: new Date().toISOString(),
        pagesAnalyzed: pageImages?.length || (singleImage ? 1 : 0),
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Error in parse-property-pdf:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'parse-property-pdf'),
      success: false,
      details: 'If this error persists, try uploading a clearer image or a different PDF.',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
