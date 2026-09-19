import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { enforceCsrf } from '../_shared/csrfGuard';

const functionSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

describe('solicitor portal compliance CSRF protection', () => {
  it('rejects cross-site cookie-authenticated mutations before processing them', () => {
    const request = new Request('https://example.test/solicitor-portal-compliance', {
      method: 'POST',
      headers: {
        cookie: '__Host-solicitor_session_token=server-valid-token',
        origin: 'https://evil.example',
        'content-type': 'text/plain',
      },
      body: JSON.stringify({ operation: 'matter_close', matter_id: 'matter-1' }),
    });

    expect(enforceCsrf(request)).toMatchObject({ ok: false, reason: 'origin_not_allowed' });
    expect(functionSource.indexOf('enforceCsrf(req)'))
      .toBeLessThan(functionSource.indexOf('await req.json()'));
  });
});
