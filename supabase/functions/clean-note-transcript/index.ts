import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { logApiUsage, extractOpenAIUsage } from '../_shared/logApiUsage.ts';
import { internalError } from '../_shared/errorResponse.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);
  
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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
    const { transcript, noteType } = body;
    
    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[clean-note-transcript] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }
    console.log(`[clean-note-transcript] Authenticated user: ${userId}`);
    
    if (!transcript) {
      throw new Error('No transcript provided');
    }

    console.log('[Clean Note Transcript] Processing transcript for note type:', noteType);

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    const systemPrompt = `You are a professional note-taking assistant. Your job is to clean up voice transcripts into polished, professional client notes.

Rules:
1. Fix grammar, punctuation, and sentence structure
2. Remove filler words (um, uh, like, you know, etc.)
3. Organize the content into clear, coherent sentences
4. Keep the original meaning and intent intact
5. Format as a professional note suitable for a CRM system
6. Keep it concise but comprehensive
7. If the transcript mentions specific dates, times, amounts, or names, preserve them exactly
8. Do not add information that wasn't in the original transcript
9. Return only the cleaned note text, no additional commentary

Note type context: ${noteType || 'general'}`;

    const { callLLMRaw } = await import('../_shared/llmRouter.ts');
    const response = await callLLMRaw({
      agentKey: 'transcript_cleaning',
      // This function already writes its own api_usage_log row for this call;
      // letting the router log it too would bill the tenant twice.
      meterUsage: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Please clean up this voice transcript into a professional note:\n\n"${transcript}"` },
      ],
      temperature: 0.3,
      maxTokens: 500,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Clean Note Transcript] OpenAI error:', errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const result = await response.json();
    const cleanedNote = result.choices?.[0]?.message?.content?.trim() || transcript;
    
    // Log API usage
    const usage = extractOpenAIUsage(result);
    await logApiUsage(supabase, {
      service_name: 'openai',
      endpoint: '/v1/chat/completions',
      model_used: 'gpt-4o-mini',
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      tokens_used: usage.total_tokens,
      response_time_ms: undefined,
      status: 'success',
      user_id: userId || undefined,
      metadata: { function: 'clean-note-transcript', noteType },
    });
    
    console.log('[Clean Note Transcript] Successfully cleaned transcript');

    return new Response(
      JSON.stringify({ cleanedNote }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Clean Note Transcript] Error:', error);
    return new Response(
      JSON.stringify(internalError(error, 'clean-note-transcript')),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
