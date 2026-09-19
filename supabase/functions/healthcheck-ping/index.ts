/**
 * Liveness probe.
 *
 * It answers the same CORS policy every other browser-reachable function does,
 * and that is the whole point of it: a probe that is exempt from the contract
 * it is probing cannot tell you the contract holds.
 *
 * It used to *call* `createCorsHeaders(origin)` only to discard the result and
 * hardcode `Access-Control-Allow-Origin: *` on the response, with no OPTIONS
 * handler at all. So it reported `cors: true` — meaning "the helper returned
 * something" — while answering a policy the browser rejects for any credentialed
 * request. The deploy gate greps for `createCorsHeaders(`, found it, probed the
 * deployed function, and failed the release. It was right to.
 */
import { createCorsHeaders } from "../_shared/auth.ts";

Deno.serve((req) => {
  const corsHeaders = createCorsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  return new Response(
    JSON.stringify({ ok: true }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
