// Proxy that returns a freshly-signed Vapi recording URL for a given call log.
// Vapi migrated recordings to Cloudflare R2 which requires signed URLs that
// expire, so the recording_url stored at webhook time will start returning
// 400/403 once the signature ages out. Fetching /call/{vapi_call_id} on demand
// returns a new signed URL every time.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createUnauthorizedResponse, createForbiddenResponse, createCorsHeaders } from "../_shared/auth.ts";
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { checkModuleView } from "../_shared/permissions.ts";
import { assertSafeRecordingUrl } from "./recordingUrlPolicy.ts";
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { internalError } from '../_shared/errorResponse.ts';

const MAX_RECORDING_REDIRECTS = 3;

async function fetchRecording(value: string): Promise<Response> {
  let url = await assertSafeRecordingUrl(value, Deno.resolveDns);
  for (let redirects = 0; redirects <= MAX_RECORDING_REDIRECTS; redirects++) {
    const response = await fetch(url, { redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirects === MAX_RECORDING_REDIRECTS) throw new Error('Too many recording redirects');
    const location = response.headers.get('location');
    if (!location) throw new Error('Recording redirect omitted its location');
    url = await assertSafeRecordingUrl(location, Deno.resolveDns, url.toString());
  }
  throw new Error('Too many recording redirects');
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const csrf = enforceCsrf(req);
  if (!csrf.ok) return csrfDenied(corsHeaders, csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let body: any = {};
    try { body = await req.json(); } catch { /* ignore */ }

    const { error: authError, userId, username, authMethod } = await verifyAuth(supabase, req.headers, body);
    if (authError) return createUnauthorizedResponse(authError, corsHeaders);

    const permission = await checkModuleView(supabase, userId!, 'call_logs', authMethod, true);
    if (!permission.allowed) {
      return createForbiddenResponse(permission.reason || 'Call logs view permission required', corsHeaders);
    }

    const callLogId: string | undefined = body.callLogId || body.id;
    const mode: 'url' | 'stream' = body.mode === 'stream' ? 'stream' : 'url';
    if (!callLogId) {
      return new Response(JSON.stringify({ error: 'callLogId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: row, error: dbErr } = await supabase
      .from('vapi_call_logs')
      .select('id, vapi_call_id, recording_url')
      .eq('id', callLogId)
      .maybeSingle();

    if (dbErr || !row) {
      return new Response(JSON.stringify({ error: 'Call log not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Try to fetch a fresh signed URL from Vapi.
    const vapiApiKey = Deno.env.get('VAPI_API_KEY');
    let freshUrl: string | null = null;

    if (vapiApiKey && row.vapi_call_id) {
      try {
        const r = await meteredFetch(`https://api.vapi.ai/call/${row.vapi_call_id}`, {
          headers: { 'Authorization': `Bearer ${vapiApiKey}` },
        });
        if (r.ok) {
          const data = await r.json();
          freshUrl = data.recordingUrl || data.artifact?.recordingUrl || data.artifact?.stereoRecordingUrl || null;
        } else {
          console.log('[get-call-recording] Vapi call fetch failed:', r.status, row.vapi_call_id);
        }
      } catch (e) {
        console.error('[get-call-recording] Vapi fetch error:', e);
      }
    }

    const candidateUrl = freshUrl || row.recording_url;
    if (!candidateUrl) {
      return new Response(JSON.stringify({ error: 'No recording available' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let url: string;
    try {
      url = (await assertSafeRecordingUrl(candidateUrl, Deno.resolveDns)).toString();
    } catch (error) {
      console.warn('[get-call-recording] Rejected unsafe recording URL:', error);
      return new Response(JSON.stringify({ error: 'Recording URL is not permitted' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Persist the freshest URL for cheap subsequent access.
    if (freshUrl && freshUrl !== row.recording_url) {
      supabase.from('vapi_call_logs').update({ recording_url: url }).eq('id', row.id)
        .then(() => {}, (e: unknown) => console.error('[get-call-recording] persist failed', e));
    }

    if (mode === 'stream') {
      // Server-side fetch of the signed URL and stream bytes back with CORS.
      const upstream = await fetchRecording(url);
      if (!upstream.ok || !upstream.body) {
        return new Response(JSON.stringify({ error: `Upstream ${upstream.status}` }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const contentType = upstream.headers.get('content-type') || 'audio/wav';
      return new Response(upstream.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': contentType,
          'Cache-Control': 'private, max-age=300',
        },
      });
    }

    console.log(`[get-call-recording] Served fresh URL for ${callLogId} to ${username} (${userId})`);
    return new Response(JSON.stringify({ url, refreshed: !!freshUrl }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[get-call-recording] error', e);
    return new Response(JSON.stringify(internalError(e, 'get-call-recording')), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
