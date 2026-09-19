#!/usr/bin/env node
// CORS request/response header contract gate.
//
// A browser preflight only succeeds when EVERY header the client puts in
// `Access-Control-Request-Headers` is echoed back in `Access-Control-Allow-Headers`.
// When one is missing the real request is never dispatched and `fetch()` rejects
// with an opaque `TypeError: Failed to fetch` — which the app surfaces as
// "Network/CORS error calling <fn>", indistinguishable from the function being
// down. Adding a header on the client without widening the edge-function
// allowlist therefore breaks every page at once (this is exactly how
// `x-correlation-id` took the dashboard down).
//
// Symmetrically, a cross-origin response only reveals the CORS-safelisted
// response headers to JS. Custom headers the client reads back must be named in
// `Access-Control-Expose-Headers` or they silently read as `null`.
//
// This gate asserts:
//   1. every custom request header the frontend sends to an edge function is in
//      the canonical allowlist in `_shared/auth.ts`;
//   2. every custom response header the frontend reads is in the canonical
//      expose list;
//   3. every hand-rolled CORS object in `supabase/functions/` is a superset of
//      the client-required request headers and expose headers.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const FUNC_DIR = 'supabase/functions';
const AUTH_TS = `${FUNC_DIR}/_shared/auth.ts`;
const SRC_DIR = 'src';

const errors = [];

// ── Canonical lists (source of truth: _shared/auth.ts) ──────────────────────
const authSrc = readFileSync(AUTH_TS, 'utf8');
function parseConst(name) {
  const m = authSrc.match(new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\.join`));
  if (!m) {
    errors.push(`${AUTH_TS}: could not parse \`export const ${name}\` — the CORS contract gate depends on it.`);
    return new Set();
  }
  return new Set(
    [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1].toLowerCase()),
  );
}
const ALLOWED = parseConst('CORS_ALLOWED_REQUEST_HEADERS');
const EXPOSED = parseConst('CORS_EXPOSED_RESPONSE_HEADERS');

// ── What the frontend actually sends / reads ────────────────────────────────
function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Source with comments removed, so a rule that asks "is this CALLED?" cannot
 * be answered by prose. Strings are left alone: a `//` inside one is rare in
 * these files and dropping the rest of such a line only ever makes a rule
 * quieter, never louder.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const sent = new Map();  // header -> file
const read = new Map();  // header -> file

for (const file of walkFiles(SRC_DIR)) {
  const src = readFileSync(file, 'utf8');
  // Only files that actually talk to an edge function can trigger a preflight.
  // (Keeps unrelated `x-*` string keys — e.g. brand slugs — out of the gate.)
  const callsEdgeFunction = /functions\/v1\//.test(src) || /invokeSecureFunction/.test(src);
  if (callsEdgeFunction) {
    for (const m of src.matchAll(/['"](x-[a-z0-9-]+)['"]\s*:/gi)) {
      sent.set(m[1].toLowerCase(), file);
    }
  }
  for (const m of src.matchAll(/headers\.get\(\s*['"](x-[a-z0-9-]+)['"]/gi)) {
    read.set(m[1].toLowerCase(), file);
  }
}

for (const [h, file] of sent) {
  if (!ALLOWED.has(h)) {
    errors.push(`${file}: sends request header \`${h}\` but it is NOT in CORS_ALLOWED_REQUEST_HEADERS (${AUTH_TS}). Every preflight carrying it will fail.`);
  }
}
for (const [h, file] of read) {
  if (!EXPOSED.has(h)) {
    errors.push(`${file}: reads response header \`${h}\` but it is NOT in CORS_EXPOSED_RESPONSE_HEADERS (${AUTH_TS}). It will read back as null cross-origin.`);
  }
}

// ── The shared transport must not add custom request headers ────────────────
// This is the rule that matters most in practice. The frontend ships as one
// bundle; each of the ~300 edge functions carries its own bundled copy of
// `_shared/auth.ts` and is redeployed individually. A custom header added to
// the shared transport only works once EVERY function it can reach has been
// redeployed — until then the preflight fails and the entire app goes dark.
// Body fields carry the same data with no preflight requirement.
const SHARED_TRANSPORT = 'src/lib/secureInvoke.ts';
// Line-based scan: an `'x-…':` object key on its own line is a header entry.
// (Block matching is unreliable here — a `${...}` template inside a header
// value closes a naive brace match early and hides everything after it.)
const transportSrcRaw = readFileSync(SHARED_TRANSPORT, 'utf8');
for (const rawLine of transportSrcRaw.split('\n')) {
  const line = rawLine.trim();
  if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
  const m = line.match(/['"](x-[a-z0-9-]+)['"]\s*:/i);
  if (!m) continue;
  errors.push(`${SHARED_TRANSPORT}: adds custom request header \`${m[1].toLowerCase()}\` on the shared edge-function transport. It reaches ~300 independently-deployed functions and fails the preflight on every one not yet redeployed with it allow-listed — taking the whole app down. Send it as a body field instead.`);
}

// ── Credentialed callers must not reach a wildcard-origin function ──────────
// `invokeSecureFunction` sends `credentials: 'include'` so the HttpOnly
// `__Host-session_token` cookie reaches the function. The Fetch spec requires
// the browser to REJECT a credentialed response whose
// `Access-Control-Allow-Origin` is `*` — opaquely, as `Failed to fetch`. So a
// function on that transport may never answer with a wildcard origin; it needs
// the exact-origin allowlist (`createCorsHeaders`, or the `withRequestOrigin`
// wrapper in `_shared/corsOrigin.ts`). This is what broke the AML/CTF surface.
//
// There is no longer an exemption list. `TOKEN_AUTH_FUNCTIONS` used to name the
// five import/render functions that answered `*` and were therefore called with
// `credentials: 'omit'` — which stripped the HttpOnly session cookie, the only
// carrier `extractSessionToken` reads since WP-11B/C Phase 4, and left them
// depending on an access-token JWT the ES256 remediation made unobtainable.
// Every PDF template import 401'd. They now answer an allowlisted origin
// exactly, via `createTokenAuthCorsHeaders(origin)`, so they are held to the
// same rule as everything else.
const TOKEN_AUTH = new Set();

// `invokeSecureFunction` is not the only transport. The Finance, Solicitor and
// Builder portals each post to edge functions through their own wrapper, and
// two of those attach a custom request header (`X-Portal-Request`) on every
// call. Checking only `secureInvoke` left those surfaces — several hundred
// invocations — entirely outside this gate, so each entry below names the
// module that defines the transport and the headers it attaches are read from
// that source rather than restated here (a restated list goes stale in exactly
// the way the edge-function header copies did).
const TRANSPORTS = [
  { name: 'invokeSecureFunction', module: 'src/lib/secureInvoke.ts' },
  { name: 'invokeAmlFunction', module: 'src/lib/aml/invokeAmlFunction.ts' },
  { name: 'streamSecureFunction', module: 'src/lib/streamSecureFunction.ts' },
  { name: 'invokeSolicitorFunction', module: 'src/lib/solicitorPortal.ts' },
  // invokeBuilderFunction left with the Builder Portal (network extraction
  // Phase 7) — /builder/* is one redirect and no builder transport remains.
  { name: 'invokeFinanceFunction', module: 'src/hooks/useFinancePortalAuth.tsx' },
];

for (const t of TRANSPORTS) {
  let modSrc;
  try {
    modSrc = readFileSync(t.module, 'utf8');
  } catch {
    errors.push(`${t.module}: transport module defining \`${t.name}\` not found — the credentialed-CORS gate depends on it. Update TRANSPORTS in this script if the module moved.`);
    t.headers = [];
    t.credentialed = false;
    continue;
  }
  t.credentialed = /credentials:\s*['"]include['"]/.test(modSrc);
  t.headers = [...new Set(
    [...modSrc.matchAll(/['"](x-[a-z0-9-]+)['"]\s*:/gi)].map((m) => m[1].toLowerCase()),
  )];
  for (const h of t.headers) {
    if (!ALLOWED.has(h)) {
      errors.push(`${t.module}: transport \`${t.name}\` attaches request header \`${h}\`, which is NOT in CORS_ALLOWED_REQUEST_HEADERS (${AUTH_TS}). Every preflight it triggers will fail.`);
    }
  }
}
const transportByName = new Map(TRANSPORTS.map((t) => [t.name, t]));

// Functions each transport reaches. Literal names, plus the `const FN = '…'`
// indirection the hooks in this repo consistently use.
const reachedBy = new Map(); // function name -> Set(transport names)
for (const file of walkFiles(SRC_DIR)) {
  if (/\.test\.tsx?$/.test(file)) continue;
  const src = readFileSync(file, 'utf8');
  const consts = [...src.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=\s*['"]([a-z0-9-]+)['"]/g)];
  for (const t of TRANSPORTS) {
    const record = (fn) => {
      if (!reachedBy.has(fn)) reachedBy.set(fn, new Set());
      reachedBy.get(fn).add(t.name);
    };
    for (const m of src.matchAll(new RegExp(`${t.name}(?:<[^>]*>)?\\(\\s*["'\`]([a-zA-Z0-9_-]+)["'\`]`, 'g'))) record(m[1]);
    for (const [, ident, value] of consts) {
      if (new RegExp(`${t.name}(?:<[^>]*>)?\\(\\s*${ident}\\b`).test(src)) record(value);
    }
  }
}

for (const [fn, vias] of [...reachedBy].sort((a, b) => a[0].localeCompare(b[0]))) {
  const path = `${FUNC_DIR}/${fn}/index.ts`;
  let src;
  try { src = readFileSync(path, 'utf8'); } catch { continue; } // deployed-only, not in repo

  // A comment-free view, for the rules below that ask whether a helper is
  // CALLED with no argument. A call never lives in a comment, and prose
  // explaining the wrong form — which is exactly what a fixed site grows —
  // must not read as the wrong form. Without this, documenting the defect
  // re-raises it.
  const codeSrc = stripComments(src);

  // Several functions keep a now-dead wildcard literal but actually build their
  // real headers with createCorsHeaders(origin), or have the origin rewritten
  // per request by withRequestOrigin — those answer an exact origin.
  // `createTokenAuthCorsHeaders(origin)` counts too, but ONLY when it is passed
  // an origin: the no-argument form still answers `*` to everyone.
  // Each form must be CALLED, not merely imported. `withRequestOrigin` used to
  // be matched as a bare identifier, so unwrapping the handler and leaving the
  // now-unused import behind still satisfied this — the negative test for this
  // rule caught it.
  const usesSharedOrigin = /createCorsHeaders\s*\(/.test(src)
    || /withRequestOrigin\s*\(/.test(src)
    || /createTokenAuthCorsHeaders\s*\(\s*[^)\s]/.test(src);

  // (a) A credentialed request whose response carries a wildcard origin is
  //     rejected by the browser itself, opaquely, as "Failed to fetch".
  const credentialedVias = [...vias].filter(
    (v) => transportByName.get(v)?.credentialed && !(v === 'invokeSecureFunction' && TOKEN_AUTH.has(fn)),
  );
  if (
    credentialedVias.length
    && !usesSharedOrigin
    && /["']Access-Control-Allow-Origin["']\s*:\s*["']\*["']/.test(src)
  ) {
    errors.push(`${path}: answers \`Access-Control-Allow-Origin: *\` but is called with credentials through ${credentialedVias.join(', ')}. Browsers reject a credentialed response with a wildcard origin, so every call fails as "Failed to fetch". Use createCorsHeaders(origin), or wrap the handler with withRequestOrigin (_shared/corsOrigin.ts).`);
  }

  // (a2) Same failure, one level of indirection away: the shared token-auth
  //      helper answers `*` unless it is given the request origin. A function
  //      reached by a credentialed transport must pass it — unless the handler
  //      is wrapped in `withRequestOrigin`, which rewrites the origin on the
  //      way out and makes the helper's own answer irrelevant.
  if (
    credentialedVias.length
    && !/withRequestOrigin/.test(src)
    && /createTokenAuthCorsHeaders\s*\(\s*\)/.test(codeSrc)
  ) {
    errors.push(`${path}: calls \`createTokenAuthCorsHeaders()\` with no origin, which answers \`Access-Control-Allow-Origin: *\`, but is called with credentials through ${credentialedVias.join(', ')}. Browsers reject a credentialed response with a wildcard origin. Pass the request origin: \`createTokenAuthCorsHeaders(req.headers.get('origin'))\`.`);
  }

  // (a4) The same failure again, with no wildcard anywhere to see it by.
  //
  //      `createCorsHeaders()` with no origin does not answer `*` — it answers
  //      `allowedOrigins[0]`, a FIXED origin chosen at import time that has
  //      nothing to do with who called. Paired with
  //      `Access-Control-Allow-Credentials: true`, the browser releases the
  //      response to JS only when the ACAO exactly equals the request's
  //      Origin. So such a function works from precisely ONE of the origins
  //      the deployment trusts and fails the preflight from every other, and
  //      `fetch` rejects opaquely as "Failed to fetch" — which the client
  //      renders as "Network/CORS error calling <fn>. Please check the
  //      function deployment and auth/CORS configuration", advice that sends
  //      the reader to a deployment that is perfectly healthy.
  //
  //      Rule (a2) already says exactly this about the sibling helper
  //      `createTokenAuthCorsHeaders`. It was never said about
  //      `createCorsHeaders`, and `usesSharedOrigin` above matches
  //      `createCorsHeaders\s*\(` — the no-argument form included — so calling
  //      it wrongly SATISFIED the gate. Four browser-reachable functions were
  //      in that state: `generate-market-intelligence-report` (Audit 4 item
  //      12, reported as exactly that error message),
  //      `analyze-meta-ads-phase4`, `security-step-up` (which gates AUSTRAC
  //      lodgement and AML configuration) and `parse-formara-pdf`.
  //
  //      `builder-stock-image-settler` also calls the no-argument form and is
  //      correct to: pg_cron invokes it, no browser does, so it is not reached
  //      by any credentialed transport and never enters this loop.
  if (
    credentialedVias.length
    && !/withRequestOrigin/.test(src)
    && /(?<!TokenAuth)createCorsHeaders\s*\(\s*\)/.test(codeSrc)
  ) {
    errors.push(`${path}: calls \`createCorsHeaders()\` with no origin, which answers a FIXED \`Access-Control-Allow-Origin\` (the first allow-listed origin) rather than the caller's, but is called with credentials through ${credentialedVias.join(', ')}. Browsers release a credentialed response only when the origin matches exactly, so every call from any other allow-listed origin fails opaquely as "Failed to fetch". Pass the request origin: \`createCorsHeaders(req.headers.get('origin'))\`.`);
  }

  // (a3) Accepting the session cookie means accepting ambient authority, which
  //      is exactly what CSRF exploits. Every cookie-reachable function must
  //      run the shared guard (it no-ops when no cookie is present).
  if (credentialedVias.length && /createTokenAuthCorsHeaders\s*\(/.test(src) && !/enforceCsrf\s*\(/.test(src)) {
    errors.push(`${path}: answers an exact origin with credentials (so the HttpOnly session cookie reaches it) but never calls \`enforceCsrf(req)\` from _shared/csrfGuard.ts. Cookie authority is ambient — add the guard.`);
  }

  // (b) Every custom header its callers attach must survive its preflight.
  const required = [...new Set([...vias].flatMap((v) => transportByName.get(v)?.headers ?? []))];
  if (required.length === 0) continue;
  for (const m of src.matchAll(/(['"])Access-Control-Allow-Headers\1\s*:\s*(?:\r?\n\s*)?(['"])([^'"]*)\2/g)) {
    const value = m[3].trim();
    if (value === '*') continue;
    const have = new Set(value.split(',').map((s) => s.trim().toLowerCase()));
    const missing = required.filter((h) => !have.has(h));
    if (missing.length) {
      errors.push(`${path}: reached by ${[...vias].join(', ')}, which ${vias.size > 1 ? 'attach' : 'attaches'} ${missing.map((h) => `\`${h}\``).join(', ')}, but its Access-Control-Allow-Headers omits ${missing.length > 1 ? 'them' : 'it'}. The preflight fails and every call surfaces as "Failed to fetch".`);
    }
  }
}

// ── WP-19: a browser-reachable function may not hardcode a wildcard ────────
//
// The rule above only fires when the gate can *prove* a credentialed transport
// reaches the function, by tracing `invokeSecureFunction('name')` call sites
// through `src/`. That misses every function reached indirectly — a name held in
// a variable, a portal wrapper, a call added later — and 39 functions were
// answering `Access-Control-Allow-Origin: *` without ever calling a shared-origin
// helper.
//
// So the same question is asked from the other side, using the exposure class the
// registry already records. A class that means "a browser talks to this while
// logged in" may not answer a wildcard: the Fetch spec makes the browser reject a
// credentialed response that carries one, opaquely, as "Failed to fetch".
//
// The classes NOT listed here are the ones no browser session reaches — `public`
// (deliberately open data, no credentials), `cron-worker`, `internal-service` and
// the webhook classes (server-to-server; CORS is not evaluated at all). A
// wildcard there is inert, and rewriting ~29 of them would be churn with a
// regression surface and no security gain.
const BROWSER_SESSION_CLASSES = new Set([
  'human-authenticated',
  'portal-authenticated',
  'public-auth',
  'authenticated-staff',
  'authenticated-or-service',
  'module-gated',
  'superadmin-only',
]);

let registry;
try {
  registry = JSON.parse(readFileSync(`${FUNC_DIR}-registry/SECURITY_REGISTRY.json`, 'utf8'));
} catch {
  errors.push('supabase/functions-registry/SECURITY_REGISTRY.json could not be read — the exposure-class CORS rule cannot run.');
  registry = {};
}
const registryEntries = registry.functions ?? registry;

for (const name of readdirSync(FUNC_DIR)) {
  if (name.startsWith('_')) continue;
  const path = `${FUNC_DIR}/${name}/index.ts`;
  let src;
  try { src = readFileSync(path, 'utf8'); } catch { continue; }

  const exposure = registryEntries?.[name]?.exposure_class;
  if (!BROWSER_SESSION_CLASSES.has(exposure)) continue;
  if (!/["']Access-Control-Allow-Origin["']\s*:\s*["']\*["']/.test(src)) continue;
  // A dead wildcard literal is fine as long as the answer is built by a helper.
  if (/createCorsHeaders\s*\(|withRequestOrigin\s*\(|createTokenAuthCorsHeaders\s*\(\s*[^)\s]/.test(src)) continue;

  errors.push(
    `${path}: exposure class \`${exposure}\` means a logged-in browser calls this, but it answers a `
    + `hardcoded \`Access-Control-Allow-Origin: *\` and never builds its headers with a shared-origin `
    + `helper. Browsers reject a credentialed response carrying a wildcard, so every call fails as an `
    + `opaque "Failed to fetch". Wrap the handler with \`withRequestOrigin\` (_shared/corsOrigin.ts) or `
    + `build the headers with \`createCorsHeaders(req.headers.get('origin'))\`.`);
}

// ── Hand-rolled CORS objects must be supersets of what the client needs ─────
// Session/portal carriers are per-surface, so only the headers the shared
// client attaches to *every* call are required everywhere.
const REQUIRED_EVERYWHERE = ['x-correlation-id', 'x-step-up-token'];

function walkFunctions(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkFunctions(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

// ── A CORS helper may not be RE-DEFINED, only imported ─────────────────────
//
// Every rule above that asks "does this function answer an exact origin?"
// answers it by matching the NAME `createCorsHeaders(` in the source. A
// function that declares its own `function createCorsHeaders(origin)` therefore
// satisfies all of them while sharing nothing with `_shared/auth.ts` — not the
// allowlist, not the request-header list, not the expose list.
//
// `manage-investment-reports` was in exactly that state and it was the only
// one. Its private copy trusted five hostnames compiled into the source
// (`command-centre.npcservices.com.au`, `*.npcservices.com.au`,
// `*.lovable.app`, `*.lovableproject.com`, localhost) and never read
// `ALLOWED_ORIGINS`, the variable each deployment is actually configured
// through. A clone served from its own domain got the mismatched fallback, the
// browser refused the response, and `fetch` rejected opaquely — which the
// Reports page renders as "Network/CORS error calling
// manage-investment-reports. Please check the function deployment and
// auth/CORS configuration", sending the reader to a deployment that is fine.
// The 19 Sep 2026 clone audit filed that twice, as two separate defects.
//
// The allowlist is deployment configuration. A function that compiles one in
// works on exactly the deployments whose hostname someone happened to type.
const SHARED_CORS_HELPERS = ['createCorsHeaders', 'createTokenAuthCorsHeaders'];
for (const file of walkFunctions(FUNC_DIR)) {
  if (file === AUTH_TS) continue;
  const src = readFileSync(file, 'utf8');
  const code = stripComments(src);
  for (const helper of SHARED_CORS_HELPERS) {
    const declares = new RegExp(
      String.raw`(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function\s+${helper}\s*\(|const\s+${helper}\s*=)`,
    ).test(code);
    if (!declares) continue;
    errors.push(`${file}: declares its own \`${helper}\`. Every CORS rule in this gate matches the helper by NAME, so a private copy passes all of them while sharing nothing with ${AUTH_TS} — not the origin allowlist, not the request-header list, not the expose list. A compiled-in allowlist also ignores \`ALLOWED_ORIGINS\`, so the function works only on the deployments whose hostname is written into it and answers every other one with a mismatched origin the browser refuses. Import it from ../_shared/auth.ts instead.`);
  }
}

// ── createCorsHeaders() must not be overridden ─────────────────────────────
// Spreading the shared helper and then restating Allow-/Expose-Headers pins the
// function to a snapshot of the canonical lists taken on the day it was
// written. Because the literal comes *after* the spread it wins, so the copy
// can only ever narrow the allowlist — never extend it. Every instance of this
// in the repo had already gone stale: six functions were silently dropping
// headers the canonical list had since gained (`x-step-up-token`,
// `x-portal-request`, the portal session carriers), which fails the browser
// preflight and surfaces as an opaque "Failed to fetch".
//
// Paren-aware so `createCorsHeaders(req.headers.get('origin'))` is matched too.
const SPREAD_OVERRIDE = /\.\.\.\s*createCorsHeaders\s*\((?:[^()]|\([^()]*\))*\)\s*,([\s\S]{0,600}?)\}/g;
for (const file of walkFunctions(FUNC_DIR)) {
  if (file === AUTH_TS) continue;
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(SPREAD_OVERRIDE)) {
    for (const key of ['Access-Control-Allow-Headers', 'Access-Control-Expose-Headers']) {
      if (new RegExp(`(['"])${key}\\1\\s*:`).test(m[1])) {
        errors.push(`${file}: overrides \`${key}\` after spreading createCorsHeaders(). The override wins over the spread, so it can only narrow the canonical list and will go stale the next time a header is added. Delete the override; if the function genuinely needs an extra header, add it to the canonical list in ${AUTH_TS}.`);
      }
    }
  }
}

for (const file of walkFunctions(FUNC_DIR)) {
  if (file === AUTH_TS) continue; // uses the named constants
  const src = readFileSync(file, 'utf8');
  const matches = [...src.matchAll(
    /(['"])Access-Control-Allow-Headers\1\s*:\s*(?:\r?\n\s*)?(['"])([^'"]*)\2/g,
  )];
  if (matches.length === 0) continue;

  for (const m of matches) {
    const value = m[3].trim();
    if (value === '*') continue; // wildcard permits everything (non-credentialed only)
    const have = new Set(value.split(',').map((s) => s.trim().toLowerCase()));
    const missing = REQUIRED_EVERYWHERE.filter((h) => !have.has(h));
    if (missing.length) {
      errors.push(`${file}: Access-Control-Allow-Headers is missing ${missing.map((h) => `\`${h}\``).join(', ')}.`);
    }
  }

  // The object declaring Allow-Headers should also expose what the client reads.
  if (!/Access-Control-Expose-Headers/.test(src)) {
    errors.push(`${file}: declares Access-Control-Allow-Headers but no Access-Control-Expose-Headers — custom response headers will read back as null.`);
  }
}

if (errors.length) {
  console.error('CORS contract check FAILED:\n');
  // A file can trip the same rule at more than one CORS object; report it once.
  for (const e of [...new Set(errors)].sort()) console.error(`  - ${e}`);
  console.error(`\nFix by adding the header to the canonical lists in ${AUTH_TS} and to any`);
  console.error('hand-rolled CORS object in supabase/functions/. A client header that is not');
  console.error('allow-listed fails the browser preflight and breaks every page that calls the function.');
  process.exit(1);
}
console.log(`CORS contract check passed (${sent.size} client request header(s), ${read.size} read response header(s), all edge-function CORS objects conform).`);
