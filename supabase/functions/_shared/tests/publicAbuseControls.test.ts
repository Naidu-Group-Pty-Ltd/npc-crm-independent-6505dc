import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { verifyTurnstile } from '../publicAbuseControls.ts';

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) Deno.env.delete(name);
  else Deno.env.set(name, value);
}

Deno.test('Turnstile permits a missing token when verification is optional', async () => {
  const previousSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
  const previousRequired = Deno.env.get('REQUIRE_TURNSTILE');

  try {
    Deno.env.set('TURNSTILE_SECRET_KEY', 'configured-secret');
    Deno.env.delete('REQUIRE_TURNSTILE');

    assertEquals(await verifyTurnstile(null, '203.0.113.1'), {
      ok: true,
      failClosed: false,
    });
  } finally {
    restoreEnv('TURNSTILE_SECRET_KEY', previousSecret);
    restoreEnv('REQUIRE_TURNSTILE', previousRequired);
  }
});

Deno.test('Turnstile rejects a missing token when verification is required', async () => {
  const previousSecret = Deno.env.get('TURNSTILE_SECRET_KEY');
  const previousRequired = Deno.env.get('REQUIRE_TURNSTILE');

  try {
    Deno.env.set('TURNSTILE_SECRET_KEY', 'configured-secret');
    Deno.env.set('REQUIRE_TURNSTILE', 'true');

    assertEquals(await verifyTurnstile(null, '203.0.113.1'), {
      ok: false,
      failClosed: true,
      reason: 'turnstile_missing',
    });
  } finally {
    restoreEnv('TURNSTILE_SECRET_KEY', previousSecret);
    restoreEnv('REQUIRE_TURNSTILE', previousRequired);
  }
});
