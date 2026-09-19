#!/usr/bin/env node
/**
 * Static security rules for Edge Functions (Phase 12 / CI-001, section 17.2).
 *
 * Blocks reintroduction of the audited vulnerability classes:
 *  R1: JSON.parse(atob(...)) JWT-payload parsing used for authentication
 *      decisions (decoded-claim trust — finding F-01).
 *  R2: Math.random() in login/reset/invite/token code paths (weak
 *      credentials — finding F-06).
 *  R3: wildcard Access-Control-Allow-Origin in a function that also sets or
 *      reads session cookies (credentialed wildcard CORS).
 *  R4: a service/trust decision derived from a request-body field
 *      (body.source etc.) — body fields are attacker-controlled and must never
 *      confer service identity (Criticals 5/6, second-round audit).
 *  R5: getPublicUrl() on the sensitive email-attachments bucket — persisting a
 *      permanent public URL for private content (EC-5). Use signed URLs.
 *  R7: global PDF recovery exposed without an internal-service or superadmin
 *      authorization gate.
 *  R8: finance portal messaging staff access backed by the service-role client
 *      without a deny-by-default finance module permission gate.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FUNC_DIR = join(root, 'supabase', 'functions');

// Files where decoded-claim parsing is acceptable (diagnostics / logging only,
// never authorization). Keep this list short and justified.
const R1_ALLOWLIST = new Set([
  '_shared/jwt.ts',             // extractUserIdFromJWT: logging helper, never authorizes
  '_shared/ghl-account.ts',     // decodes GHL provider token for format diagnostics only
  'ghl-calendar-test/index.ts'  // decodes a GHL API key for diagnostics output
]);

// R6 (AUTH-002 / AUTH-004): inter-function calls must authenticate with the
// dedicated INTERNAL_EDGE_SECRET (x-internal-edge-secret) — see
// _shared/internalCall.ts — never the crown-jewel service-role key. The Phase 2
// migration + the AUTH-004 fallback retirement removed every service-role Bearer
// from inter-function calls, so the allowlist is now EMPTY: any new occurrence
// (including a `secret ? anon : serviceKey` ternary fallback) fails the gate.
const R6_SERVICE_KEY_CALLER_ALLOWLIST = new Set([]);

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js)$/.test(name)) files.push(p);
  }
})(FUNC_DIR);

const errors = [];

for (const file of files) {
  const rel = relative(FUNC_DIR, file).replace(/\\/g, '/');
  const src = readFileSync(file, 'utf8');

  // R1: decoded JWT payload trust
  if (/JSON\.parse\(\s*atob\(/.test(src) && !R1_ALLOWLIST.has(rel)) {
    errors.push(`[R1] ${rel}: JSON.parse(atob(...)) — JWT/base64 payload decoding in a function. ` +
      `Claims must be cryptographically verified (use _shared/jwt.ts verifySupabaseJWT or _shared/auth_v2.ts). ` +
      `If this is diagnostics-only, add the file to R1_ALLOWLIST with a justification.`);
  }

  // R2: weak randomness in credential paths
  if (/(login|reset|invite|token|otp|password)/i.test(rel) && /Math\.random\(\)/.test(src)) {
    errors.push(`[R2] ${rel}: Math.random() in an auth/credential code path — use crypto.getRandomValues (see _shared/resetTokens.ts).`);
  }

  // R3: wildcard CORS + cookies in the same function. _shared/auth.ts is
  // excluded: it defines BOTH the cookie helpers and the token-only wildcard
  // CORS helper; the dangerous combination is a single function using both.
  if (!rel.startsWith('_shared/') && /['"]Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/.test(src) && /Set-Cookie|session_token=/.test(src)) {
    errors.push(`[R3] ${rel}: wildcard Access-Control-Allow-Origin combined with session cookies — use the origin allowlist (createCorsHeaders).`);
  }

  // R4: service/trust decision derived from a request-body field. Matches a
  // trust-intent variable (isService/isInternal/isScheduled/trusted/...)
  // assigned from body.source (or body.<x>). A plain `const source = body.source`
  // label is NOT flagged — only trust-named sinks.
  if (/\b(is[A-Z]\w*|trusted|authorized|isServiceCall|isScheduled|isInternal|isAdmin)\s*=\s*[^;\n]*\bbody\.(source|user_id|role|is_admin|scheduled)\b/.test(src)) {
    errors.push(`[R4] ${rel}: a trust/service decision is derived from a request-body field. Body fields are attacker-controlled — derive service identity from verifyInternal()/verified auth method, never from body.`);
  }

  // R5: permanent public URL for private email attachments. secure-storage is
  // the central proxy: its publicUrl op is policy-gated and email-attachments
  // is NOT an allowPublicUrl bucket, so its generic getPublicUrl is safe.
  if (rel !== 'secure-storage/index.ts' && /getPublicUrl\s*\(/.test(src) && /['"]email-attachments['"]/.test(src)) {
    errors.push(`[R5] ${rel}: getPublicUrl() on the email-attachments bucket persists a permanent public URL for private content. Store the object path and issue short-lived signed URLs (see EC-5).`);
  }

  // R6: inter-function call authenticating with the service-role key as Bearer.
  if (/functions\/v1\//.test(src)
      && /Bearer\s*\$\{[^}]*(serviceRoleKey|SERVICE_ROLE_KEY|supabaseServiceKey|serviceKey|SUPABASE_SERVICE)[^}]*\}/.test(src)
      && !R6_SERVICE_KEY_CALLER_ALLOWLIST.has(rel)) {
    errors.push(`[R6] ${rel}: inter-function call authenticates with the service-role key. Use the dedicated INTERNAL_EDGE_SECRET (callInternalFunction / x-internal-edge-secret) so a leak can't grant full DB access.`);
  }

  if (rel === 'pdf-parse-dispatch/index.ts') {
    const statusBranch = src.match(/if \(operation === 'status'\) \{([\s\S]*?)if \(operation === 'download'\)/)?.[1] ?? '';
    const statusIsOwnerScoped = /\.select\(STATUS_SAFE_FIELDS\)/.test(statusBranch)
      && /\.eq\('user_id', userId\)/.test(statusBranch)
      && !/\.select\('\*'\)/.test(statusBranch);
    if (!statusIsOwnerScoped) {
      errors.push('[R7] pdf-parse-dispatch/index.ts: status reads must select only safe fields and scope the service-role query to the authenticated job owner.');
    }
    if (/return `url:\$\{body\.source_url\}`/.test(src) || /source = \{ kind: 'url', url: body\.source_url/.test(src)) {
      errors.push('[R7] pdf-parse-dispatch/index.ts: pre-signed source URLs must not be persisted in job metadata.');
    }

    const recoveryBranch = src.match(/if \(operation === 'recover'\) \{([\s\S]*?)recoverStuckJobs\(admin\)/)?.[1] ?? '';
    const hasPrivilegedGate = /auth\.userId !== 'service_role'/.test(recoveryBranch)
      && /\.from\('user_roles'\)/.test(recoveryBranch)
      && /row\.role === 'superadmin'/.test(recoveryBranch)
      && /createForbiddenResponse/.test(recoveryBranch);
    if (!hasPrivilegedGate) {
      errors.push('[R7] pdf-parse-dispatch/index.ts: global stuck-job recovery must require a verified internal service caller or a superadmin role before using the service-role client.');
    }
  }

  if (rel === 'finance-portal-messages/index.ts') {
    const gatePosition = src.indexOf("requireModulePermission(");
    const operationPosition = src.indexOf("if (operation === 'list_threads')");
    const hasStaffModuleGate = gatePosition !== -1
      && operationPosition !== -1
      && gatePosition < operationPosition
      && src.includes("if (actor.type === 'staff')")
      && src.includes("'finance_portal_admin'")
      && src.includes('requiredPermission');
    if (!hasStaffModuleGate) {
      errors.push('[R8] finance-portal-messages/index.ts: service-role-backed staff operations must pass the deny-by-default finance_portal_admin permission gate before accessing messages.');
    }
  }
}

if (errors.length) {
  console.error('Static auth-pattern scan FAILED:\n');
  for (const e of errors) console.error(' - ' + e);
  process.exit(1);
}
console.log(`Static auth-pattern scan passed (${files.length} files).`);
