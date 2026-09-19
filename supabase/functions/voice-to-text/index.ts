import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logApiUsage } from '../_shared/logApiUsage.ts';
import { verifyAuth, createUnauthorizedResponse } from '../_shared/auth.ts';

import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { withRequestOrigin } from "../_shared/corsOrigin.ts";
import { internalError } from '../_shared/errorResponse.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-finance-session-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
};

// Hard ceiling on the base64 payload BEFORE we decode it. OpenAI Whisper's own
// limit is 25 MB of audio; base64 inflates by ~4/3, so ~34 MB of base64 maps to
// ~25 MB decoded. Rejecting oversize input up front is the cost/DoS control:
// without it an unauthenticated-sized body could be decoded into memory and
// shipped to a paid API. (Critical 4 / Phase 9 remediation.)
const MAX_BASE64_CHARS = 34 * 1024 * 1024;

/**
 * Decode base64 to Uint8Array - simple and reliable approach
 * Uses atob for the full string (works fine for audio files up to ~50MB)
 */
function decodeBase64ToUint8Array(base64String: string): Uint8Array {
  // Clean up the base64 string - remove any whitespace or newlines
  const cleanBase64 = base64String.replace(/\s/g, '');
  
  // Decode base64 to binary string
  const binaryString = atob(cleanBase64);
  
  // Convert binary string to Uint8Array
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  return bytes;
}

const __corsWrappedHandler = (async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const body = await req.json();
    const { audio, mimeType, fileName } = body;

    // AUTH (Critical 4): this endpoint spends OpenAI credits. It must never be
    // callable anonymously. All callers go through invokeSecureFunction, which
    // presents the staff JWT / session token, so require a verified human.
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const auth = await verifyAuth(supabase, req.headers, body);
    if (auth.error || !auth.userId) {
      return createUnauthorizedResponse(auth.error || 'Authentication required', corsHeaders);
    }

    if (!audio) {
      console.error('[Voice to Text] No audio data provided');
      throw new Error('No audio data provided');
    }

    if (typeof audio !== 'string') {
      throw new Error('Invalid audio data format');
    }

    if (audio.length > MAX_BASE64_CHARS) {
      console.warn('[Voice to Text] Rejected oversize payload:', audio.length);
      return new Response(
        JSON.stringify({ error: 'Audio payload too large' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[Voice to Text] Processing audio, base64 length:', audio.length);

    // Strip data URL prefix if present (e.g., "data:audio/webm;base64,...")
    let base64Data = audio;
    if (audio.includes(',')) {
      base64Data = audio.split(',')[1];
      console.log('[Voice to Text] Stripped data URL prefix, new length:', base64Data.length);
    }

    // Decode base64 to binary using simple atob approach
    let binaryAudio: Uint8Array;
    try {
      binaryAudio = decodeBase64ToUint8Array(base64Data);
      console.log('[Voice to Text] Decoded audio size:', binaryAudio.length, 'bytes');
    } catch (decodeError) {
      console.error('[Voice to Text] Base64 decode error:', decodeError);
      throw new Error('Invalid audio data format');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      console.error('[Voice to Text] OPENAI_API_KEY not configured');
      throw new Error('OPENAI_API_KEY not configured');
    }

    // Prepare form data
    const contentType = (typeof mimeType === 'string' && mimeType.trim()) ? mimeType.trim() : 'audio/webm';
    const resolvedFileName = (typeof fileName === 'string' && fileName.trim())
      ? fileName.trim()
      : (contentType.includes('mp4') ? 'audio.mp4' : (contentType.includes('ogg') ? 'audio.ogg' : 'audio.webm'));

    const formData = new FormData();
    const blob = new Blob([binaryAudio], { type: contentType });
    formData.append('file', blob, resolvedFileName);
    formData.append('model', 'whisper-1');

    console.log('[Voice to Text] Sending to OpenAI Whisper API...');

    // Send to OpenAI
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Voice to Text] OpenAI error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('[Voice to Text] Transcription complete, text length:', result.text?.length || 0);

    // Log API usage
    await logApiUsage(supabase, {
      service_name: 'openai',
      endpoint: '/v1/audio/transcriptions',
      model_used: 'whisper-1',
      status: 'success',
      metadata: { function: 'voice-to-text', audioSize: binaryAudio.length, actor: auth.userId },
    });

    return new Response(
      JSON.stringify({ text: result.text }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Voice to Text] Error:', error);
    return new Response(
      JSON.stringify(internalError(error, 'voice-to-text')),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));
