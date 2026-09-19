// Returns the public VAPID key so the browser can subscribe to push notifications.
import { withRequestOrigin } from '../_shared/corsOrigin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token',
  'Access-Control-Expose-Headers': 'x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const __corsWrappedHandler = (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  const key = Deno.env.get('VAPID_PUBLIC_KEY') || '';
  return new Response(JSON.stringify({ publicKey: key }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
};

// CORS-CREDENTIALS: rewrite the wildcard origin above into an allowlisted,
// credential-compatible one. This function is reached by invokeSecureFunction,
// which sends `credentials: 'include'` — and the Fetch spec makes the browser
// reject a credentialed response carrying `Access-Control-Allow-Origin: *`,
// opaquely, as "Failed to fetch". See _shared/corsOrigin.ts.
Deno.serve((req: Request) => withRequestOrigin(req, __corsWrappedHandler(req)));
