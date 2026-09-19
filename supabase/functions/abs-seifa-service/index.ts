import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { internalError } from '../_shared/errorResponse.ts';
import { sourceUnavailable } from '../_shared/sourceUnavailable.pure.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  console.log('ABS SEIFA service invoked');
  
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
    const { postcode, state } = body;
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[abs-seifa-service] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[abs-seifa-service] Authenticated user: ${userId}`);
    console.log('Fetching SEIFA data for postcode:', postcode, 'state:', state);

    if (!postcode) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Postcode is required' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The loaded SEIFA 2021 POA table is the source — the ABS's own index
    // values, ingested from the published workbook by `abs-poa-ingest`. The
    // two live-API attempts this replaces never verifiably answered (one
    // walked the whole country's SDMX inside a 5-second timeout by
    // construction), and `generateSEIFAEstimate` before them assigned
    // deciles from postcode folklore. A ranking of a neighbourhood's
    // disadvantage is not something this platform may invent or fetch on a
    // hope: it is read from the loaded register or it is unavailable.
    const poa = String(postcode ?? '').trim();
    const { data: row, error: seifaReadError } = await supabase
      .from('abs_seifa_poa')
      .select('*')
      .eq('poa', poa)
      .maybeSingle();

    if (seifaReadError) {
      console.error('abs_seifa_poa read failed:', seifaReadError);
      return new Response(JSON.stringify(sourceUnavailable(
        'abs-seifa',
        'provider_error',
        'The SEIFA reference table could not be read — socio-economic figures are unavailable for this request.',
      )), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!row) {
      return new Response(JSON.stringify(sourceUnavailable(
        'abs-seifa',
        'no_data_for_location',
        `SEIFA ${'2021'} publishes no indexes for postal area "${poa}" — socio-economic figures are unavailable rather than estimated.`,
      )), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const seifaData = {
      postcode: row.poa,
      state: state || 'Unknown',
      irsad: { score: row.irsad_score, decile: row.irsad_decile, description: getSEIFADescription(row.irsad_decile) },
      irsd: { score: row.irsd_score, decile: row.irsd_decile, description: 'Index of Relative Socio-economic Disadvantage' },
      ier: { score: row.ier_score, decile: row.ier_decile, description: 'Index of Economic Resources' },
      ieo: { score: row.ieo_score, decile: row.ieo_decile, description: 'Index of Education and Occupation' },
      summary: getSEIFASummary(row.irsad_decile),
      usualResidentPopulation: row.usual_resident_population,
      caution: row.caution,
      dataSource: `ABS SEIFA ${row.reference_period} (POA ${row.poa})`,
      dataQuality: 'census',
      referencePeriod: row.reference_period,
      lastUpdated: row.reference_period,
      note: 'SEIFA indexes rank areas based on socio-economic advantage and disadvantage. Decile 10 = most advantaged, Decile 1 = most disadvantaged.'
    };

    return new Response(JSON.stringify({ 
      success: true, 
      data: seifaData 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in ABS SEIFA service:', error);
    return new Response(JSON.stringify({
      ...internalError(error, 'abs-seifa-service'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function getSEIFADescription(decile: number | null): string {
  if (!decile) return 'Unknown';
  
  if (decile >= 9) return 'Very High Advantage';
  if (decile >= 7) return 'High Advantage';
  if (decile >= 5) return 'Moderate Advantage';
  if (decile >= 3) return 'Low Advantage';
  return 'Disadvantaged';
}

function getSEIFASummary(decile: number | null): string {
  if (!decile) return 'Socioeconomic data unavailable';
  
  if (decile >= 9) {
    return 'This area ranks in the top 20% of Australian postcodes for socioeconomic advantage. Residents typically have higher incomes, education levels, and skilled occupations.';
  } else if (decile >= 7) {
    return 'This area ranks above average for socioeconomic advantage. The area has good income levels, education, and employment opportunities.';
  } else if (decile >= 5) {
    return 'This area has moderate socioeconomic characteristics, sitting around the Australian median for income, education, and occupation.';
  } else if (decile >= 3) {
    return 'This area ranks below average for socioeconomic advantage. May have lower median incomes and higher unemployment rates.';
  } else {
    return 'This area ranks in the bottom 20% for socioeconomic advantage. May face challenges with lower incomes, education levels, and employment rates.';
  }
}
