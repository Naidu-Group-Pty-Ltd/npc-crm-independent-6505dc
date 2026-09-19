import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireModulePermission } from '../_shared/authz.ts';
import { verifyHuman } from '../_shared/auth_v2.ts';
import { consumeRateLimit, enforceBase64Limit, enforceJsonBodyLimit, getTrustedClientIp, securityJsonError } from '../_shared/requestSecurity.ts';
import { meteredFetch } from "../_shared/meteredFetch.ts";
import { withRequestOrigin } from '../_shared/corsOrigin.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token, x-session-token, x-command-centre-session-token', 'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const MIME_TO_EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg' };
const MAX_REQUEST_BYTES = 6_000_000;
const MAX_AUDIO_BYTES = 4_000_000;
const MAX_AUDIO_CHARS = 5_400_000;
const MAX_ATTEMPTS = 2;
const jsonError = (status: 400 | 401 | 403 | 413 | 429 | 503, code: string, correlationId?: string) => {
  const response = securityJsonError(status, code, correlationId);
  return new Response(response.body, { status: response.status, headers: { ...corsHeaders, ...Object.fromEntries(response.headers) } });
};

const __corsWrappedHandler = async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonError(400, 'invalid_request');
  const parsed = await enforceJsonBodyLimit<{ audio_base64?: unknown; mime_type?: unknown }>(req, MAX_REQUEST_BYTES);
  if (!parsed.ok) return jsonError(parsed.error.status as 400 | 413, 'invalid_request');
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const auth = await verifyHuman(sb, req, parsed.value);
  if (!auth.ok || !auth.actorId) return jsonError(401, 'authentication_required', auth.correlationId);
  const permission = await requireModulePermission(sb, { userId: auth.actorId, authMethod: auth.method }, 'market_updates', 'can_view');
  if (!permission.ok) return jsonError(403, 'market_access_denied', auth.correlationId);
  const audio = enforceBase64Limit(parsed.value.audio_base64, MAX_AUDIO_CHARS, MAX_AUDIO_BYTES);
  if (!audio.ok) return jsonError(audio.error.status as 400 | 413, 'invalid_audio', auth.correlationId);
  if (audio.decodedBytes < 512) return jsonError(400, 'invalid_audio', auth.correlationId);
  const mimeType = typeof parsed.value.mime_type === 'string' ? parsed.value.mime_type.toLowerCase().split(';')[0] : 'audio/webm';
  const ext = MIME_TO_EXT[mimeType];
  if (!ext) return jsonError(400, 'unsupported_audio', auth.correlationId);
  const ip = getTrustedClientIp(req.headers);
  try {
    const limits = await Promise.all([consumeRateLimit(sb, `marketvoice:user:${auth.actorId}`, 10, 3600), ...(ip ? [consumeRateLimit(sb, `marketvoice:ip:${ip}`, 20, 3600)] : [])]);
    if (limits.some((limit) => !limit.allowed)) return jsonError(429, 'rate_limited', auth.correlationId);
  } catch { return jsonError(503, 'metering_unavailable', auth.correlationId); }
  const key = Deno.env.get('LOVABLE_API_KEY');
  if (!key) return jsonError(503, 'provider_unavailable', auth.correlationId);
  const bytes = Uint8Array.from(atob(audio.normalized), (char) => char.charCodeAt(0));
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    for (const model of ['openai/gpt-4o-mini-transcribe', 'openai/gpt-4o-transcribe'].slice(0, MAX_ATTEMPTS)) {
      const form = new FormData(); form.append('model', model); form.append('file', new Blob([bytes], { type: mimeType }), `recording.${ext}`);
      const upstream = await meteredFetch('https://ai.gateway.lovable.dev/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: controller.signal });
      if (upstream.ok) { const data = await upstream.json().catch(() => ({})); return new Response(JSON.stringify({ transcript: String(data?.text ?? '').trim() }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
      console.warn('[market-voice] provider rejected request', { status: upstream.status, correlationId: auth.correlationId, model });
      if (![400, 404, 422].includes(upstream.status)) break;
    }
    return jsonError(503, 'transcription_unavailable', auth.correlationId);
  } catch (error) { console.warn('[market-voice] provider failure', { correlationId: auth.correlationId, error: error instanceof Error ? error.name : 'unknown' }); return jsonError(503, 'transcription_unavailable', auth.correlationId); }
  finally { clearTimeout(timeout); }
};

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. This function is browser-reachable and its callers
// send `credentials: 'include'`, and the Fetch spec makes the browser reject a
// credentialed response carrying `Access-Control-Allow-Origin: *` — opaquely,
// as "Failed to fetch". See _shared/corsOrigin.ts.
Deno.serve(async (req: Request) => withRequestOrigin(req, await __corsWrappedHandler(req)));

