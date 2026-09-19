import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractFinanceSessionToken } from '../_shared/financeSessionToken';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('finance portal logout session termination', () => {
  it('extracts the session token from the finance HttpOnly cookie after reload', () => {
    const headers = new Headers({ cookie: '__Host-finance_session_token=finance%2Ftoken' });

    expect(extractFinanceSessionToken(headers)).toBe('finance/token');
  });

  it('uses the shared cookie-aware extractor and clears the finance cookie', () => {
    expect(functionSource).toContain('extractFinanceSessionToken(req.headers, body)');
    expect(functionSource).toContain("headers.append('Set-Cookie', createClearFinanceSessionCookie())");
  });

  it('only accepts POST requests and enforces CSRF protection', () => {
    expect(functionSource).toContain("if (req.method !== 'POST')");
    expect(functionSource).toContain('const csrf = enforceCsrf(req)');
    expect(functionSource).toContain('if (!csrf.ok) return csrfDenied(corsHeaders, csrf)');
  });
});
