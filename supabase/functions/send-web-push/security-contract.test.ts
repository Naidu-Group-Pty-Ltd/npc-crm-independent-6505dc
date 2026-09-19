import { assert, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));

// WP-12: this receiver used to try a raw `x-internal-edge-secret` compare and
// only fall back to the signed envelope. The static path is removed; every
// caller already sends the envelope via
// `public.cron_signed_internal_headers(...)`.
Deno.test('web push authenticates with the signed internal envelope only', () => {
  assertStringIncludes(source, 'verifySignedInternal(');
  assert(
    !/headers?\.get\(\s*['"]x-internal-edge-secret['"]/.test(source),
    'x-internal-edge-secret must no longer be read directly',
  );
  assert(!source.includes('verifyRequiredCronSecret('),
    'the static cron-secret helper must no longer gate this function');
});

Deno.test('auth fails closed before any push is sent', () => {
  // The unauthorized return must precede VAPID setup and delivery.
  const authIdx = source.indexOf("securityJsonError(401, 'unauthorized')");
  const vapidIdx = source.indexOf("Deno.env.get('VAPID_PUBLIC_KEY')");
  assert(authIdx > 0, 'a 401 path must exist');
  assert(vapidIdx > authIdx, 'auth must be decided before VAPID/delivery work');
});

Deno.test('the declared caller is restricted', () => {
  assertStringIncludes(source, "'notifications_trigger'");
  assertStringIncludes(source, "'pg_cron'");
});

Deno.test('the signature is verified over the exact request bytes', () => {
  assertStringIncludes(source, 'const rawBody = await req.text()');
  assertStringIncludes(source, 'verifySignedInternal(authClient, req, rawBody,');
});

Deno.test('no secret is echoed to the caller or the log', () => {
  assert(!/console\.(log|warn|error)\([^)]*INTERNAL_EDGE_SECRET/.test(source),
    'the internal secret must never be logged');
  assert(!source.includes("'x-internal-edge-secret':"),
    'the secret must not be re-sent by this function');
});

Deno.test('the CORS allow-list no longer advertises the retired header', () => {
  const corsBlock = source.slice(0, source.indexOf('Deno.serve'));
  assert(!corsBlock.includes('x-internal-edge-secret'),
    'a header we refuse to honour must not be advertised as allowed');
});
