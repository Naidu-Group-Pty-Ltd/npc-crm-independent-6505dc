import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('solicitor portal logout request security', () => {
  it('restricts session invalidation to POST requests', () => {
    expect(functionSource).toContain("if (req.method !== 'POST')");
    expect(functionSource).toContain("'Allow': 'POST'");
  });

  it('enforces CSRF protection before extracting the session token', () => {
    const csrfCheck = functionSource.indexOf('enforceCsrf(req)');
    const tokenExtraction = functionSource.indexOf('extractSolicitorSessionToken(req.headers, body)');

    expect(csrfCheck).toBeGreaterThan(-1);
    expect(tokenExtraction).toBeGreaterThan(csrfCheck);
  });
});
