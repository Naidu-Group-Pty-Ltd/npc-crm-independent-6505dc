#!/usr/bin/env node
/**
 * WP-24 — an endpoint that needs no credentials must bound and check its body.
 *
 * ## Why this class and not all 419
 *
 * `zod` had been a production dependency for a long time and appeared in **2 of
 * 419** edge functions. Fixing that everywhere is per-function work and mostly
 * not urgent: a `portal-authenticated` endpoint sits behind a session, a CSRF
 * guard and `enforceJsonBodyLimit`, so an unvalidated field there is a
 * robustness problem.
 *
 * The nine functions classified `public` in `SECURITY_REGISTRY.json` are
 * different in kind. No session, no cookie, no rate-limited login in front of
 * them — anyone on the internet with the publishable key can post to them. Five
 * of them read their body with a bare `await req.json()` and a TypeScript type
 * *assertion*:
 *
 *     const { suburb, state, postcode } = await req.json();
 *
 * A type assertion checks nothing at runtime. That left three problems, and the
 * third is why this gate exists rather than a code comment:
 *
 *   1. a non-JSON body throws inside the try and answers 500;
 *   2. `{"state": {"$ne": null}}` reaches the handler as an object;
 *   3. **there is no size bound at all** — `req.json()` reads whatever is sent,
 *      on an endpoint with nothing in front of it.
 *
 * ## The rule
 *
 * A `public` function that reads a request body must do it through a bounded,
 * checked parse — `parseJsonBody` (`_shared/validate.ts`), or
 * `enforceJsonBodyLimit`/`enforceRawBodyLimit` (`_shared/requestSecurity.ts`) if
 * it genuinely has no shape to check.
 *
 * A bare `await req.json()` in this class is an error. Functions that read no
 * body are fine and are not required to import anything.
 */
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readEntrypointSource } from './lib/entrypointSource.mjs';

// cwd, not import.meta.url — the negative-test harness mutates a mirror.
const root = resolve(process.cwd());
const FUNC_DIR = join(root, 'supabase', 'functions');
const REGISTRY = join(root, 'supabase', 'functions-registry', 'SECURITY_REGISTRY.json');

/**
 * Classes reachable without any credential.
 *
 * `public-auth` joined in WP-27. Those 31 are the pre-session endpoints — login,
 * forgot-password, reset-password, accept-invite, verify, across four portals
 * and the staff console — and they are reachable exactly as anonymously as the
 * `public` nine. The measured state when the class was added: **all 27 that read
 * a body read it with a bare `await req.json()`**, three times as many as the
 * class this gate was written for.
 *
 * They are not lower-risk for being auth endpoints. They are the endpoints an
 * attacker reaches first, by design, and the only thing in front of them is the
 * rate limiter — which is itself keyed off values taken from the body.
 */
const UNAUTHENTICATED = new Set(['public', 'public-auth']);

/**
 * Reviewed exceptions. `public` functions that read a body but cannot use the
 * shared parser, each with the reason.
 */
const EXEMPT = new Map([
  ['finance-email-track-pixel', 'A tracking pixel: the request is a GET for an image and carries no JSON body at all.'],
  ['get-vapid-public-key', 'Returns a constant public key and never reads the request body.'],
]);

const errors = [];

let registry;
try {
  registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
} catch {
  console.error(`Public-validation check could not read ${REGISTRY}.`);
  process.exit(1);
}
const entries = registry.functions ?? registry;

const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

let checked = 0;
for (const [name, meta] of Object.entries(entries)) {
  if (!UNAUTHENTICATED.has(meta?.exposure_class)) continue;
  const path = join(FUNC_DIR, name, 'index.ts');
  try { statSync(path); } catch { continue; }

  // The entrypoint AND the handler it serves. Both `custom-auth-login` and
  // `-v2` are one-line shims onto `_shared/customAuth/login.ts` (WP-28), and
  // reading the shim alone found no body read — so the gate skipped them and
  // said nothing. That is the failure mode worth guarding against here: the
  // rate-limit gate broke loudly on the same refactor and was fixed in minutes;
  // this one would have gone on reporting a passing count that had quietly
  // stopped including two unauthenticated login endpoints.
  const src = stripComments(readEntrypointSource(root, name));
  checked++;

  const readsBody = /\breq\.json\s*\(|\breq\.text\s*\(|\breq\.arrayBuffer\s*\(|\breq\.formData\s*\(|enforceJsonBodyLimit|enforceRawBodyLimit|parseJsonBody/.test(src);
  if (!readsBody) continue;

  // The call may carry a generic argument list, and the real call sites read
  // `enforceJsonBodyLimit<Record<string, unknown>>(req, …)` — a NESTED one. A
  // plain `name\s*\(` matched only the import; `<[^>]*>` stopped at the inner
  // `>` and still missed the call. `[^()]*` spans the whole type argument.
  const bounded = /(?:parseJsonBody|enforceJsonBodyLimit|enforceRawBodyLimit|enforceBase64Limit)\s*(?:<[^()]*>)?\s*\(/.test(src);
  if (bounded) {
    // Bounded, but is the shape checked? Only `parseJsonBody` does both. A
    // function that bounds and does not check is acceptable — the size problem
    // is the one that cannot be mitigated downstream — so this is a note, not
    // an error, and it is deliberately not enforced.
    continue;
  }

  if (EXEMPT.has(name)) continue;

  errors.push(
    `${name}: exposure class \`${meta.exposure_class}\` means anyone on the internet can post to `
    + `this, and it reads the request body without a bounded parse. \`await req.json()\` has no size `
    + `limit and a TypeScript type assertion checks nothing at runtime. Use \`parseJsonBody(req, `
    + `Schema, corsHeaders, MAX)\` from _shared/validate.ts — see supabase/functions/`
    + `abs-employment-service/index.ts — or \`enforceJsonBodyLimit\` if there is genuinely no shape `
    + `to check. If it reads no body, this gate will not ask.`);
}

// A stale exemption is the same failure wearing a note.
for (const [name, reason] of EXEMPT) {
  if (!Object.prototype.hasOwnProperty.call(entries, name)) {
    errors.push(`EXEMPT names \`${name}\` ("${reason}") but the registry has no such function. Remove the entry.`);
  }
}

if (errors.length) {
  console.error('Public-endpoint validation check FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `Public-endpoint validation check passed (${checked} unauthenticated function(s); `
  + `every one that reads a body bounds it; ${EXEMPT.size} reviewed exemption(s)).`,
);
