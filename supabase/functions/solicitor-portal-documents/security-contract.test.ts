import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('solicitor portal documents CSRF contract', () => {
  it('rejects unsafe cookie-authenticated requests before parsing or authentication', () => {
    const csrfCheck = source.indexOf('const csrf = enforceCsrf(req)');
    const bodyParsing = source.indexOf('await req.json()');
    const sessionResolution = source.indexOf('await resolveSolicitorSession');

    expect(source).toContain('if (!csrf.ok) return csrfDenied(corsHeaders, csrf)');
    expect(csrfCheck).toBeGreaterThan(-1);
    expect(csrfCheck).toBeLessThan(bodyParsing);
    expect(csrfCheck).toBeLessThan(sessionResolution);
  });
});
