/**
 * A step-up refusal must be readable by the browser it refuses.
 *
 * Both shared step-up helpers used to build their 401 from a module-level
 * `Access-Control-Allow-Origin: *`. Every call from this product is sent with
 * `credentials: 'include'`, and a wildcard ACAO is invalid for a credentialed
 * request — so the browser discards the response, `fetch` rejects with
 * `Failed to fetch`, and `secureInvoke` reports:
 *
 *     "Network/CORS error calling update-integration-secret. Please check the
 *      function deployment and auth/CORS configuration."
 *
 * Both of those claims were false. Measured 16 Sep 2026: the function was
 * ACTIVE v354, CORS was correct, and `public.security_events` held the real
 * answer — `step_up.blocked / missing / secrets.update / enforced:true` — while
 * the operator was sent to diagnose a healthy deployment. The Integrations page
 * had never saved a secret on that deployment: 0 of 20 rows filled.
 *
 * The rule: a shared refusal helper never invents CORS headers. It takes the
 * caller's, or derives them per-origin from the request it was handed — the
 * same contract `csrfDenied`, `createUnauthorizedResponse` and
 * `createForbiddenResponse` have always honoured.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const PUBLIC_STEP_UP = 'supabase/functions/_shared/stepUp.ts';
const AML_STEP_UP = 'supabase/functions/_shared/aml/step-up.ts';

/** `Access-Control-Allow-Origin` set to a literal `*`, in either quote style. */
const WILDCARD_ACAO = /["']Access-Control-Allow-Origin["']\s*:\s*["']\*["']/;

describe('a step-up refusal carries per-origin CORS, never a wildcard', () => {
  for (const rel of [PUBLIC_STEP_UP, AML_STEP_UP]) {
    it(`${rel} declares no wildcard Allow-Origin`, () => {
      expect(read(rel)).not.toMatch(WILDCARD_ACAO);
    });

    it(`${rel} resolves headers from the caller or the request`, () => {
      const src = read(rel);
      expect(src).toMatch(/createCorsHeaders/);
      // Either the caller's headers, or ones derived from the request's Origin.
      expect(src).toMatch(/args\.cors\s*\?\?\s*createCorsHeaders\(/);
    });

    it(`${rel} lets a caller pass its own headers`, () => {
      expect(read(rel)).toMatch(/cors\?:\s*Record<string,\s*string>/);
    });
  }

  it('the refusal in the public helper uses the resolved headers', () => {
    const src = read(PUBLIC_STEP_UP);
    // The 401 spreads a resolved variable, not an invented literal.
    expect(src).toMatch(/status:\s*401,\s*headers:\s*\{\s*\.\.\.cors,/);
    expect(src).toContain('step_up_required');
  });

  it('update-integration-secret keeps no shadowed wildcard block', () => {
    // It carried a dead module-level wildcard that was one moved `return` away
    // from being live.
    const src = read('supabase/functions/update-integration-secret/index.ts');
    expect(src).not.toMatch(WILDCARD_ACAO);
    expect(src).toContain('const corsHeaders = createCorsHeaders(origin)');
  });
});
