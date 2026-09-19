import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { meteredFetch } from "../_shared/meteredFetch.ts";
const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

interface ChartData {
  type: 'bar' | 'pie' | 'line';
  title: string;
  data: Array<{ label: string; value: number; color?: string }>;
  width?: number;
  height?: number;
}

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
    // SECURITY: Verify authentication
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    const body = await req.json();
    const { charts }: { charts: ChartData[] } = body;
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[generate-chart-images] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[generate-chart-images] Authenticated user: ${userId}`);

    if (!openAIApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const chartImages: Record<string, string> = {};

    // Generate each chart image using OpenAI with retry logic
    for (const chart of charts) {
      console.log(`Generating chart: ${chart.title}`);
      
      const prompt = `Create a clean, professional ${chart.type} chart for business reports:
Title: "${chart.title}"
Data: ${JSON.stringify(chart.data)}
Style: Modern business chart with clear labels, readable fonts, and professional color scheme
Background: White background
${chart.type === 'pie' ? 'Show percentages on segments with clear labels' : ''}
${chart.type === 'bar' ? 'Include value labels on top of bars' : ''}
${chart.type === 'line' ? 'Include data point markers and grid lines' : ''}`;

      let retryCount = 0;
      const maxRetries = 3;
      let response;
      
      while (retryCount < maxRetries) {
        try {
          console.log(`Attempt ${retryCount + 1} for chart: ${chart.title}`);
          
          response = await meteredFetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openAIApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'dall-e-3',
              prompt: prompt,
              n: 1,
              size: '1024x1024',
              quality: 'standard',
              style: 'natural'
            }),
          });
          
          if (response.ok) {
            break;
          } else {
            console.error(`Attempt ${retryCount + 1} failed with status: ${response.status}`);
            retryCount++;
            if (retryCount < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
            }
          }
        } catch (error) {
          console.error(`Attempt ${retryCount + 1} failed with error:`, error);
          retryCount++;
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
          }
        }
      }

      if (!response || !response.ok) {
        console.error(`Failed to generate chart "${chart.title}" after ${maxRetries} attempts`);
        // Create a fallback simple chart text image
        const fallbackText = `Chart: ${chart.title}\nData points: ${chart.data.length}\nType: ${chart.type}`;
        const encodedFallback = btoa(fallbackText);
        const chartKey = chart.title.toLowerCase().replace(/[^a-z0-9]/g, '_');
        chartImages[chartKey] = `data:text/plain;base64,${encodedFallback}`;
        continue;
      }

      const data = await response.json();
      console.log(`OpenAI response for "${chart.title}":`, JSON.stringify(data, null, 2));
      
      // Handle different response formats from OpenAI
      let base64Image;
      try {
        if (data.data && data.data[0]) {
          if (data.data[0].b64_json) {
            // Direct base64 response
            base64Image = data.data[0].b64_json;
          } else if (data.data[0].url) {
            // URL response - need to fetch and convert
            console.log(`Fetching image from URL for chart: ${chart.title}`);
            const imageResponse = await fetch(data.data[0].url);
            if (!imageResponse.ok) {
              throw new Error(`Failed to fetch image from URL: ${imageResponse.status}`);
            }
            const imageBuffer = await imageResponse.arrayBuffer();
            base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
          } else {
            throw new Error('No valid image data in OpenAI response');
          }
        } else {
          throw new Error('Invalid OpenAI API response structure');
        }
        
        // Validate base64 image
        if (!base64Image || base64Image.length < 100) {
          throw new Error('Invalid or empty base64 image data');
        }
      } catch (imageError) {
        console.error(`Error processing image for chart "${chart.title}":`, imageError);
        // Create fallback
        const errorMsg = imageError instanceof Error ? imageError.message : 'Unknown error';
        const fallbackText = `Chart: ${chart.title}\nError: ${errorMsg}`;
        const encodedFallback = btoa(fallbackText);
        const chartKey = chart.title.toLowerCase().replace(/[^a-z0-9]/g, '_');
        chartImages[chartKey] = `data:text/plain;base64,${encodedFallback}`;
        continue;
      }
      
      // Store with a clean key (remove spaces and special characters)
      const chartKey = chart.title.toLowerCase().replace(/[^a-z0-9]/g, '_');
      chartImages[chartKey] = `data:image/png;base64,${base64Image}`;
      
      console.log(`Generated chart: ${chartKey}`);
    }

    console.log(`Returning ${Object.keys(chartImages).length} chart images`);
    
    return new Response(JSON.stringify({ chartImages }), {
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
    });

  } catch (error) {
    console.error('Error in generate-chart-images function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      error: errorMessage,
      details: 'Failed to generate chart images'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});