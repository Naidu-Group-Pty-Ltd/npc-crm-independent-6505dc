import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { enforceCsrf } from '../_shared/csrfGuard';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('solicitor portal verification CSRF protection', () => {
  it('rejects a cross-site cookie-authenticated verification request', () => {
    const request = new Request('https://example.test/solicitor-portal-verify', {
      method: 'POST',
      headers: {
        cookie: '__Host-solicitor_session_token=server-valid-token',
        origin: 'https://evil.example',
      },
    });

    expect(enforceCsrf(request)).toMatchObject({ ok: false, reason: 'origin_not_allowed' });
  });

  it('guards the default last-seen mutation before resolving the session', () => {
    const csrfCheck = functionSource.indexOf('const csrf = enforceCsrf(req);');
    const sessionResolution = functionSource.indexOf('const session = await resolveSolicitorSession');
    const lastSeenUpdate = functionSource.indexOf(".update({ last_seen_at: new Date().toISOString() })");

    expect(csrfCheck).toBeGreaterThan(-1);
    expect(csrfCheck).toBeLessThan(sessionResolution);
    expect(sessionResolution).toBeLessThan(lastSeenUpdate);
    expect(functionSource).toContain('if (!csrf.ok) return csrfDenied(corsHeaders, csrf);');
  });
});
