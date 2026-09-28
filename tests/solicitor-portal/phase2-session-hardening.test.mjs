import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs'; import test from 'node:test';
const read = p => readFileSync(p,'utf8');
const client=read('src/lib/solicitorPortal.ts'), sessions=read('supabase/functions/_shared/solicitorSessions.ts'), auth=read('supabase/functions/_shared/solicitorPortalAuth.ts');
const functions=['login','accept-invite','verify','logout','change-password','reset-password','forgot-password'];
test('browser transport is cookie-only and JavaScript cannot read a session token',()=>{ assert.match(client,/credentials: 'include'/); assert.match(client,/'X-Portal-Request': 'solicitor-portal'/); assert.doesNotMatch(client,/localStorage|sessionStorage|x-solicitor-session-token|solicitor_session_token/); });
test('issuance stores only HMAC token_hash and returns raw token only in memory',()=>{ assert.match(sessions,/hashSessionToken\(token\)/); assert.match(sessions,/from\('solicitor_portal_sessions'\)\.insert/); assert.doesNotMatch(sessions,/session_token\s*:/); });
test('sessions enforce absolute and sliding idle expiry',()=>{ assert.match(sessions,/absolute_expires_at/); assert.match(sessions,/idle_expires_at/); assert.match(sessions,/computeIdleExpiry/); assert.match(sessions,/idleExpiresAt.*absolute_expires_at/); });
test('resolver prefers hash-only sessions and limits plaintext fallback to legacy non-cookie credentials',()=>{ assert.match(auth,/resolveHashedSolicitorSession/); assert.match(auth,/credential\.source !== 'cookie'/); assert.match(auth,/legacy_token/); });
test('login and invite never issue plaintext user-row sessions or response tokens',()=>{ for(const name of ['login','accept-invite']){ const source=read(`supabase/functions/solicitor-portal-${name}/index.ts`); assert.match(source,/issueSolicitorSession/); assert.doesNotMatch(source,/session_token:\s*(?:sessionToken|issued\.token)/); assert.match(source,/session:\s*\{ id: issued\.id/); } });
test('password change and reset revoke all sessions and clear legacy credentials',()=>{ for(const name of ['change-password','reset-password']) { const source=read(`supabase/functions/solicitor-portal-${name}/index.ts`); assert.match(source,/revokeAllSolicitorSessions/); assert.match(source,/session_token: null/); } });
test('firm deactivation revokes hashed sessions',()=>{ const source=read('supabase/functions/solicitor-portal-admin/index.ts'); assert.match(source,/from\('solicitor_portal_sessions'\)/); assert.match(source,/firm_deactivated/); });
test('identity and permission changes revoke existing sessions',()=>{ const source=read('supabase/functions/solicitor-portal-admin/index.ts'); for(const reason of ['portal_identity_changed','matter_access_changed','global_permissions_changed','user_deactivated']) assert.ok(source.includes(reason)); });
test('authentication entry points enforce the custom request/origin contract',()=>{ for(const name of functions){ const source=read(`supabase/functions/solicitor-portal-${name}/index.ts`); assert.ok(source.includes('validateSolicitorPortalRequest')||source.includes('resolveSolicitorSession'), `${name} missing request validation`); } });
// The throttles moved onto `_shared/authRateLimit.ts`, which keys the address
// from the platform's unforgeable header rather than `x-forwarded-for` and names
// its buckets `<scope>_ip:` and `<scope>_id:`. The old literals `:ip:` and
// `:email:` belonged to the inline limiters it replaced, so this asserts the
// property instead: an address budget and an identity budget, both consumed
// BEFORE the account is looked up at login, and at recovery the address budget
// first and the account budget only once the account is known (ABUSE-003), so
// a caller over their address ceiling cannot mint a limiter row per address typed.
test('login and recovery have per-IP and per-account rate limits',()=>{
  const limiter=read('supabase/functions/_shared/authRateLimit.ts');
  assert.match(limiter,/`\$\{scope\}_ip:/); assert.match(limiter,/`\$\{scope\}_id:/);
  const login=read('supabase/functions/solicitor-portal-login/index.ts');
  const gate=login.indexOf('enforceAuthRateLimit(supabase, req, {');
  assert.ok(gate>-1,'login has no auth rate limit');
  assert.match(login.slice(gate,gate+300),/ip: LOGIN_IP_BUDGET/);
  assert.match(login.slice(gate,gate+300),/identifier: normalizedEmail/);
  assert.match(login.slice(gate,gate+300),/identifierBudget: LOGIN_IDENTIFIER_BUDGET/);
  assert.ok(gate<login.indexOf(".from('solicitor_portal_users')"),'login throttles after the account lookup');
  const forgot=read('supabase/functions/solicitor-portal-forgot-password/index.ts');
  const ipGate=forgot.indexOf('beginAuthRateLimit(supabase, req, {');
  const lookup=forgot.indexOf(".from('solicitor_portal_users')");
  const accountGate=forgot.indexOf('gate.consumeIdentifier(user.id');
  assert.ok(ipGate>-1&&lookup>-1&&accountGate>-1,'recovery is missing its address or account budget');
  assert.ok(ipGate<lookup,'recovery throttles the address after the account lookup');
  assert.ok(lookup<accountGate,'recovery spends an account budget before the account is known');
});
test('device sessions are individually revocable without exposing hashes',()=>{ const verify=read('supabase/functions/solicitor-portal-verify/index.ts'); assert.match(verify,/action === 'list_sessions'/); assert.match(verify,/action === 'revoke_session'/); assert.doesNotMatch(verify,/select\([^)]*token_hash/); });
