import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = process.cwd();
const clientSource = readFileSync(join(repo, 'src/lib/solicitorPortal.ts'), 'utf8');
const loginSource = readFileSync(
  join(repo, 'supabase/functions/solicitor-portal-login/index.ts'),
  'utf8',
);
const acceptInviteSource = readFileSync(
  join(repo, 'supabase/functions/solicitor-portal-accept-invite/index.ts'),
  'utf8',
);

describe('solicitor portal session transport', () => {
  it('uses the HttpOnly cookie without exposing or replaying its bearer token', () => {
    expect(clientSource).toContain("credentials: 'include'");
    expect(clientSource).not.toMatch(/(?:local|session)Storage/);
    expect(clientSource).not.toContain('x-solicitor-session-token');
    expect(clientSource).not.toContain('solicitor_session_token');
  });

  it('does not return raw session credentials in authentication responses', () => {
    // ZERO occurrences now, not one. WP-11A moved these to hash-only storage —
    // both functions write `session_token: null` and persist only the peppered
    // `token_hash`, so the raw token is neither returned to the caller NOR at
    // rest in the database. The assertion tightened with the code: it used to
    // allow the single occurrence that wrote the plaintext column.
    expect(loginSource).not.toMatch(/session_token:\s*sessionToken/);
    expect(acceptInviteSource).not.toMatch(/session_token:\s*sessionToken/);
    expect(loginSource).toMatch(/session_token:\s*null/);
    expect(acceptInviteSource).toMatch(/session_token:\s*null/);
    // Asserted on the invariant, not on the argument names: session issuance
    // moved into `_shared/solicitorSessions.ts`, so the token and expiry now
    // arrive as `issued.token` / `issued.absoluteExpiresAt`. Pinning the old
    // identifiers made a rename look like a missing cookie.
    expect(loginSource).toMatch(/'Set-Cookie':\s*createSolicitorSessionCookie\(/);
    expect(acceptInviteSource).toMatch(/'Set-Cookie':\s*createSolicitorSessionCookie\(/);
  });
});
