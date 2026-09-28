import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

/** Code only: the header comment names the calls it describes. */
const code = functionSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('solicitor portal logout request security', () => {
  it('restricts session invalidation to POST requests', () => {
    expect(code).toContain("if (req.method !== 'POST')");
    expect(code).toContain("'Allow': 'POST'");
  });

  it('refuses the method before it checks the origin', () => {
    const methodCheck = code.indexOf("if (req.method !== 'POST')");
    const csrfCheck = code.indexOf('enforceCsrf(req)');

    expect(methodCheck).toBeGreaterThan(-1);
    expect(csrfCheck).toBeGreaterThan(methodCheck);
  });

  it('enforces CSRF protection before it resolves, revokes or clears the session', () => {
    const csrfCheck = code.indexOf('enforceCsrf(req)');
    const refusal = code.indexOf('if (!csrf.ok) return csrfDenied(corsHeaders, csrf)');
    const resolution = code.indexOf('resolveSolicitorSession(supabase, req.headers, body)');
    const revocation = code.indexOf('revokeSolicitorSession(');
    const clearing = code.indexOf('createClearSolicitorSessionCookie()');

    expect(csrfCheck).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(csrfCheck);
    // A refusal answers without the header that clears the cookie, or a
    // hostile page could still sign a solicitor out by being refused.
    expect(clearing).toBeGreaterThan(refusal);
    expect(resolution).toBeGreaterThan(refusal);
    expect(revocation).toBeGreaterThan(resolution);
  });
});
