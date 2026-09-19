import { assert, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));

// WP-12: the cron path authenticates with the signed internal envelope, not a
// bare shared secret in a header. This test used to assert the opposite, so it
// is updated to the new contract rather than deleted — the guarantee it protects
// (the public anon key must never authorise a dispatch) is retained below.
Deno.test('marketing report cron dispatch requires a signed internal envelope', () => {
  assertStringIncludes(source, 'verifySignedInternal(');
  assertStringIncludes(source, 'INTERNAL_DISPATCH_CALLERS');
  // The replayable header credential must be gone from the auth path.
  assert(
    !/headers?\.get\(\s*['"]x-internal-edge-secret['"]/.test(source),
    'x-internal-edge-secret must no longer be read directly',
  );
  assert(!source.includes('verifyRequiredCronSecret('),
    'the static cron-secret helper must no longer gate dispatch');
  // The public anon key must never bypass staff auth.
  assert(!source.includes('bearerToken === supabaseAnonKey'));
});

Deno.test('only dispatch may be reached by an internal caller', () => {
  // The internal check is scoped to `dispatch`; every other operation falls
  // through to the staff/admin path.
  assertStringIncludes(source, "body.operation === 'dispatch'");
  assertStringIncludes(source, 'const isCronCall = internalAuth?.ok === true');
  assertStringIncludes(source, "'Admin access required'");
});

Deno.test('the signed check verifies the HMAC over the exact request bytes', () => {
  // Reading the body with req.json() first would break signature verification.
  assertStringIncludes(source, 'const rawBody = await req.text()');
  assertStringIncludes(source, 'verifySignedInternal(supabase, req, rawBody,');
  assert(!source.includes('await req.json()'),
    'the body must be read once as text so the signature can be verified');
});

Deno.test('marketing report dispatch initializes its downstream anon credential', () => {
  assertStringIncludes(source, "const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!");
  assertStringIncludes(source, 'processScheduleDispatch(supabase, supabaseUrl, supabaseServiceKey, supabaseAnonKey,');
});
