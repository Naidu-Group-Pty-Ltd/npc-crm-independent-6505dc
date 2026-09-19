import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.55.0';
import { verifyAuth, createUnauthorizedResponse, createCorsHeaders } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { logApiUsage } from '../_shared/logApiUsage.ts';
import { internalError } from '../_shared/errorResponse.ts';

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  // Handle CORS preflight requests
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
    
    // SECURITY: Verify authentication
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('Auth failed for estimate-property-expenses:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    console.log(`Authenticated user ${userId} requesting property expense estimates`);

    const { propertyAddress, purchasePrice, weeklyRent, propertyType } = body;
    
    console.log('📊 Estimating property expenses for:', propertyAddress);
    console.log('Purchase Price:', purchasePrice, 'Weekly Rent:', weeklyRent);

    const perplexityApiKey = Deno.env.get('PERPLEXITY_API_KEY');
    if (!perplexityApiKey) {
      throw new Error('PERPLEXITY_API_KEY is not configured');
    }

    const userPrompt = `I need accurate, current Australian property expense estimates for this investment property:

Property Address: ${propertyAddress}
Purchase Price: $${purchasePrice?.toLocaleString() || 'Unknown'}
Weekly Rent: $${weeklyRent?.toLocaleString() || 'Unknown'}
Property Type: ${propertyType || 'Unknown'}

Please search for and provide realistic current estimates for the following annual expenses in AUD. Use current 2024-2025 rates specific to this property's location:

1. Body Corporate / Strata Fees (annual) - $0 if it's a house, otherwise typical strata fees for the area
2. Land Tax (annual) - based on current state thresholds and land value
3. Council Rates (annual) - search for typical rates in this council area
4. Water Rates (annual) - typical for this area
5. Solicitor/Conveyancing Fees (one-off purchase cost)
6. Building & Landlord Insurance (annual)
7. Property Management Fee Percentage - JUST the percentage number (typically 7-9), NOT a dollar amount. For example: 8 means 8%
8. Repairs & Maintenance allowance (annual)

IMPORTANT: For propertyManagementFeePercent, return ONLY the percentage number (e.g., 7, 8, or 9), NOT a dollar amount!

Respond with ONLY a valid JSON object in this exact format, no other text:
{
  "bodyCorporateFees": number (annual $ amount),
  "landTax": number (annual $ amount),
  "councilRates": number (annual $ amount),
  "waterRates": number (annual $ amount),
  "solicitorFees": number ($ amount),
  "buildingLandlordInsurance": number (annual $ amount),
  "propertyManagementFeePercent": number (PERCENTAGE ONLY, e.g. 8 for 8%),
  "repairsMaintenance": number (annual $ amount)
}`;

    const { callLLMRaw } = await import('../_shared/llmRouter.ts');
    const response = await callLLMRaw({
      agentKey: 'expense_estimation',
      // This function already writes its own api_usage_log row for this call;
      // letting the router log it too would bill the tenant twice.
      meterUsage: false,
      messages: [
        {
          role: 'system',
          content: 'You are an Australian property investment expense estimator. Search for current, accurate expense data for the specific property location. Always respond with ONLY valid JSON, no markdown or explanation.',
        },
        { role: 'user', content: userPrompt },
      ],
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Perplexity API error:', response.status, errorText);
      throw new Error(`Perplexity API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    const citations = data.citations || [];

    // Log Perplexity API usage
    const pUsage = data.usage;
    await logApiUsage(supabase, {
      service_name: 'perplexity',
      endpoint: '/chat/completions',
      model_used: 'sonar',
      prompt_tokens: pUsage?.prompt_tokens || 0,
      completion_tokens: pUsage?.completion_tokens || 0,
      tokens_used: pUsage?.total_tokens || 0,
      status: 'success',
      user_id: userId || undefined,
      metadata: { function: 'estimate-property-expenses', propertyAddress },
    });
    
    if (!content) {
      throw new Error('No response from Perplexity');
    }

    console.log('Perplexity Response:', content);
    console.log('Citations:', citations);

    // Parse JSON from response (handle potential markdown wrapping)
    let estimates;
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      estimates = JSON.parse(jsonStr.trim());
    } catch (parseError) {
      console.error('Failed to parse Perplexity response:', parseError);
      console.error('Raw content:', content);
      throw new Error('Failed to parse expense estimates');
    }

    // Validate and sanitize the response
    // Handle both old field name (propertyManagementFees) and new (propertyManagementFeePercent)
    let pmPercent = Number(estimates.propertyManagementFeePercent) || Number(estimates.propertyManagementFees) || 8;
    
    // If the value looks like a dollar amount (>20), it's likely an error - use default
    if (pmPercent > 20) {
      console.warn('Property management value looks like a dollar amount, using default 8%:', pmPercent);
      pmPercent = 8;
    }
    
    const validatedEstimates = {
      bodyCorporateFees: Math.round(Number(estimates.bodyCorporateFees) || 0),
      landTax: Math.round(Number(estimates.landTax) || 0),
      councilRates: Math.round(Number(estimates.councilRates) || 2500),
      waterRates: Math.round(Number(estimates.waterRates) || 1000),
      solicitorFees: Math.round(Number(estimates.solicitorFees) || 2000),
      buildingLandlordInsurance: Math.round(Number(estimates.buildingLandlordInsurance) || 1800),
      propertyManagementFees: pmPercent, // This is a PERCENTAGE value (e.g., 8 for 8%)
      repairsMaintenance: Math.round(Number(estimates.repairsMaintenance) || 3000),
    };

    console.log('Validated estimates:', validatedEstimates);

    return new Response(JSON.stringify({
      success: true,
      estimates: validatedEstimates,
      propertyAddress,
      citations, // Include sources for transparency
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error estimating property expenses:', error);
    const origin = req.headers.get('origin');
    const corsHeaders = createCorsHeaders(origin);
    return new Response(JSON.stringify({
      ...internalError(error, 'estimate-property-expenses'),
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
