import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

interface RentData {
  bedrooms: number;
  medianRent: number | null;
  vacancyRate: number | null;
  stockOnMarket: number | null;
}

interface ScrapeResult {
  propertyType: string;
  rentData: RentData[];
  sourceUrl: string;
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
    // SECURITY: Verify authentication
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json();
    const { suburb, state, postcode, propertyType, bedrooms, forceRefresh } = body;
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[sqm-rent-service] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[sqm-rent-service] Authenticated user: ${userId}`);

    if (!suburb || !state) {
      return new Response(
        JSON.stringify({ success: false, error: 'Suburb and state are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // The client is the one created above, before authentication. A second
    // `const supabase` (with its own `supabaseUrl`/`supabaseKey`) stood here —
    // a redeclaration in the same block scope, which is a parse-time
    // SyntaxError, so this module never loaded and every invocation answered
    // BOOT_ERROR rather than running a single line of this function.
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');

    // Normalize inputs
    const normalizedSuburb = suburb.toUpperCase().trim();
    const normalizedState = state.toUpperCase().trim();
    const normalizedPostcode = postcode?.trim() || '';
    const targetPropertyType = propertyType?.toLowerCase() || 'house';
    const targetBedrooms = bedrooms || 3;

    console.log(`Looking up rent for: ${normalizedSuburb}, ${normalizedState} ${normalizedPostcode} - ${targetPropertyType} ${targetBedrooms}br`);

    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const { data: cachedData, error: cacheError } = await supabase
        .from('median_rent_cache')
        .select('*')
        .ilike('suburb', normalizedSuburb)
        .eq('state', normalizedState)
        .eq('property_type', targetPropertyType)
        .eq('bedrooms', targetBedrooms)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (cachedData && !cacheError) {
        console.log('Cache hit - returning cached data');
        return new Response(
          JSON.stringify({
            success: true,
            source: 'cache',
            data: {
              suburb: cachedData.suburb,
              state: cachedData.state,
              postcode: cachedData.postcode,
              propertyType: cachedData.property_type,
              bedrooms: cachedData.bedrooms,
              medianWeeklyRent: cachedData.median_weekly_rent,
              vacancyRate: cachedData.vacancy_rate,
              stockOnMarket: cachedData.stock_on_market,
              fetchedAt: cachedData.fetched_at,
              expiresAt: cachedData.expires_at,
            }
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // No cache or expired - need to scrape
    if (!firecrawlKey) {
      console.error('FIRECRAWL_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl not configured', source: 'error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Map property type to SQM Research type parameter
    const typeMap: Record<string, string> = {
      'house': '1',
      'unit': '2',
      'townhouse': '3',
    };
    const sqmType = typeMap[targetPropertyType] || '1';

    // Format suburb for URL (Title Case with + for spaces)
    const formattedSuburb = normalizedSuburb
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('+');

    const sqmUrl = `https://sqmresearch.com.au/weekly-rents.php?region=${normalizedState}::${formattedSuburb}&t=${sqmType}`;
    console.log('Scraping SQM Research:', sqmUrl);

    // Scrape with Firecrawl
    const scrapeResponse = await meteredFetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: sqmUrl,
        formats: ['markdown'],
        onlyMainContent: true,
        waitFor: 2000,
      }),
    });

    if (!scrapeResponse.ok) {
      const errorText = await scrapeResponse.text();
      console.error('Firecrawl error:', errorText);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to scrape SQM Research', source: 'error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const scrapeData = await scrapeResponse.json();
    const markdown = scrapeData.data?.markdown || scrapeData.markdown || '';

    console.log('Scraped content length:', markdown.length);

    // Parse the markdown to extract rent data
    const parsedData = parseRentData(markdown, targetPropertyType);
    console.log('Parsed rent data:', JSON.stringify(parsedData));

    // Store all bedroom data in cache
    const cachePromises = parsedData.map(async (item) => {
      const { error } = await supabase
        .from('median_rent_cache')
        .upsert({
          suburb: normalizedSuburb,
          state: normalizedState,
          postcode: normalizedPostcode,
          property_type: targetPropertyType,
          bedrooms: item.bedrooms,
          median_weekly_rent: item.medianRent,
          vacancy_rate: item.vacancyRate,
          stock_on_market: item.stockOnMarket,
          data_quality: item.medianRent ? 'live' : 'no_data',
          source_url: sqmUrl,
          fetched_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'suburb,state,postcode,property_type,bedrooms',
        });

      if (error) {
        console.error('Cache insert error:', error);
      }
    });

    await Promise.all(cachePromises);

    // Find the specific bedroom data requested
    const targetData = parsedData.find(d => d.bedrooms === targetBedrooms) || 
                       parsedData.find(d => d.bedrooms === 3) || 
                       parsedData[0];

    return new Response(
      JSON.stringify({
        success: true,
        source: 'scrape',
        data: {
          suburb: normalizedSuburb,
          state: normalizedState,
          postcode: normalizedPostcode,
          propertyType: targetPropertyType,
          bedrooms: targetData?.bedrooms || targetBedrooms,
          medianWeeklyRent: targetData?.medianRent || null,
          vacancyRate: targetData?.vacancyRate || null,
          stockOnMarket: targetData?.stockOnMarket || null,
          fetchedAt: new Date().toISOString(),
          allData: parsedData,
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in sqm-rent-service:', error);
    return new Response(
      JSON.stringify({ ...internalError(error, 'sqm-rent-service'), success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function parseRentData(markdown: string, propertyType: string): RentData[] {
  const results: RentData[] = [];
  
  // SQM Research typically shows data in table format
  // Look for patterns like "1 Bed | $XXX" or tabular rent data
  
  // Common patterns in SQM markdown:
  // "1 Bedroom" or "1 Bed" followed by rent value
  // Table rows with bedroom counts and weekly rents
  
  const bedroomPatterns = [
    { beds: 1, patterns: [/1\s*bed(?:room)?s?\s*[:\|]?\s*\$?([\d,]+)/gi, /\b1\s*br?\b.*?\$?([\d,]+)/gi] },
    { beds: 2, patterns: [/2\s*bed(?:room)?s?\s*[:\|]?\s*\$?([\d,]+)/gi, /\b2\s*br?\b.*?\$?([\d,]+)/gi] },
    { beds: 3, patterns: [/3\s*bed(?:room)?s?\s*[:\|]?\s*\$?([\d,]+)/gi, /\b3\s*br?\b.*?\$?([\d,]+)/gi] },
    { beds: 4, patterns: [/4\+?\s*bed(?:room)?s?\s*[:\|]?\s*\$?([\d,]+)/gi, /\b4\+?\s*br?\b.*?\$?([\d,]+)/gi] },
  ];

  for (const { beds, patterns } of bedroomPatterns) {
    let rent: number | null = null;
    
    for (const pattern of patterns) {
      const matches = [...markdown.matchAll(pattern)];
      if (matches.length > 0) {
        // Take the first match (usually the median)
        const rentStr = matches[0][1].replace(/,/g, '');
        const parsed = parseInt(rentStr, 10);
        if (!isNaN(parsed) && parsed > 50 && parsed < 5000) {
          rent = parsed;
          break;
        }
      }
    }

    results.push({
      bedrooms: beds,
      medianRent: rent,
      vacancyRate: null,
      stockOnMarket: null,
    });
  }

  // Try to extract vacancy rate
  const vacancyMatch = markdown.match(/vacancy\s*(?:rate)?\s*[:\|]?\s*([\d.]+)\s*%/i);
  if (vacancyMatch) {
    const vacancyRate = parseFloat(vacancyMatch[1]);
    results.forEach(r => r.vacancyRate = vacancyRate);
  }

  // Try to extract stock on market
  const stockMatch = markdown.match(/stock\s*(?:on\s*market)?\s*[:\|]?\s*([\d,]+)/i);
  if (stockMatch) {
    const stock = parseInt(stockMatch[1].replace(/,/g, ''), 10);
    results.forEach(r => r.stockOnMarket = stock);
  }

  return results;
}
