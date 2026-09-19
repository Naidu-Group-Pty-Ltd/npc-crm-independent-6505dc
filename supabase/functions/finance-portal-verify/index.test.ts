import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { enforceCsrf } from '../_shared/csrfGuard';
import { extractFinanceSessionToken } from '../_shared/financeSessionToken';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('finance portal session token extraction', () => {
  it('restores a session from the finance portal HttpOnly cookie', () => {
    const headers = new Headers({ cookie: '__Host-finance_session_token=finance%2Ftoken; theme=dark' });

    expect(extractFinanceSessionToken(headers)).toBe('finance/token');
  });

  /**
   * The extractor used to fall back to `__Host-session_token` — the COMMAND
   * CENTRE's cookie. It was propping up `finance-portal-accept-invite`, which
   * was writing finance sessions into the staff cookie name; both are fixed at
   * the source. A staff cookie must never be offered as a finance credential:
   * a signed-in staff member visiting the Finance Portal would otherwise have
   * their Command Centre token presented to finance session lookups.
   */
  it('ignores the Command Centre cookie entirely', () => {
    const headers = new Headers({ cookie: '__Host-session_token=staff-token; theme=dark' });

    expect(extractFinanceSessionToken(headers)).toBeNull();
  });

  it('preserves explicit finance header precedence', () => {
    const headers = new Headers({
      cookie: '__Host-finance_session_token=cookie-token',
      'x-finance-session-token': 'header-token',
    });

    expect(extractFinanceSessionToken(headers)).toBe('header-token');
  });

  it('does not expose a session token from the verify response', () => {
    expect(functionSource).not.toMatch(/session_token:\s*sessionToken/);
  });

  it('guards cookie-authenticated mutations against cross-site requests', () => {
    const request = new Request('https://example.test/finance-portal-verify', {
      method: 'POST',
      headers: {
        cookie: '__Host-finance_session_token=server-valid-token',
        origin: 'https://evil.example',
      },
    });

    expect(enforceCsrf(request)).toMatchObject({ ok: false, reason: 'origin_not_allowed' });
    expect(functionSource).toContain("if (action === 'accept_terms' || action === 'complete_onboarding')");
    expect(functionSource).toContain('if (!csrf.ok) return csrfDenied(corsHeaders, csrf);');
  });
});
