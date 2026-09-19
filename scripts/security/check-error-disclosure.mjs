#!/usr/bin/env node
/**
 * WP-18 — a 5xx must not hand the caller the exception.
 *
 * ## Why
 *
 * 329 catch blocks across 275 edge functions returned the caught error verbatim
 * — `error.message`, `String(err)`, in one place `err.stack`.
 *
 * A Postgres error message is not prose, it is schema. `null value in column
 * "password_hash" of relation "custom_users" violates not-null constraint` names
 * a table, a column and a constraint. `permission denied for table
 * client_income_sources` confirms both that the table exists and that it is
 * guarded. Across a few hundred endpoints that is a readable map of the
 * database, and provoking a 500 is usually just a malformed body. Fetch failures
 * name internal hosts; stack traces name file paths.
 *
 * `_shared/errorResponse.ts` moves the detail to the logs and returns a
 * correlation id, so support can still join the two.
 *
 * ## Scope
 *
 * Only **5xx** responses built inside a **catch block**, and only where the body
 * is going to the client (the argument of `JSON.stringify` or one of the local
 * `json`/`jsonResponse` helpers).
 *
 * Deliberately NOT in scope:
 *
 *   - `console.error(...)` — the log is exactly where the detail belongs;
 *   - internal result objects a `_shared` module returns to its caller;
 *   - 4xx a user is meant to act on. "Your password has been in a breach",
 *     "that file is too large", a validation message — those are answers, not
 *     leaks, and `securityJsonError` already covers deliberate denials.
 *
 * Non-5xx sites that still echo a caught error are listed in
 * ERROR_DISCLOSURE_EXEMPTIONS with a reason each; the rule for adding one is
 * that the message must be something the person reading it can act on.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Resolve from the process cwd, NOT `import.meta.url` — see
// check-admin-authorization-server-side.mjs for why the negative-test harness
// requires it.
const root = resolve(process.cwd());
const FUNC_DIR = join(root, 'supabase', 'functions');

/**
 * Non-5xx responses that echo a caught error on purpose. Keyed by
 * `<function>:<snippet>` so an exemption cannot silently widen to a whole file.
 */
const ERROR_DISCLOSURE_EXEMPTIONS = new Map([
  ['manage-agency-agreements', 'DocuSign auth failures are surfaced to staff at 4xx so the operator can see which credential expired; the message is the vendor\'s, not ours, and it is what makes the failure actionable.'],
  ['manage-lead-magnets', 'GHL fetch failures are surfaced to staff at 4xx alongside empty pipelines/stages so the panel can say why it is empty.'],
  ['aml-provider-webhook', 'Provider webhook ack at 200 carries the parse failure back to the provider, which is the only channel that can tell them the payload was malformed.'],
  ['outlook-email-webhook', 'Microsoft Graph notification ack at 200; the body is read by Graph, not by a user, and a silent 200 would hide a sync failure.'],
  ['aml-verification', 'Provider resolution errors are shown to the AML operator at 4xx with the internal prefix stripped — an unactionable AML failure stalls a case.'],
  ['mission-control-handoff', 'Handoff URL resolution failure is reported to the Command Centre operator so they can tell a tenant why billing is unreachable.'],
  ['location-intelligence-service', 'Source-unavailable envelope at 200 (mock data is gone); the message carries the upstream failure so an operator can see why the location section is absent.'],
  ['manage-templates', 'Schema version mismatch at 4xx names the unsupported version, which is what tells the author what to change.'],
  ['import-from-url', 'Fetch failure at 4xx tells the user their URL could not be read — the whole operation is "read this URL".'],
  ['domain-data-service', 'Upstream Domain API failure surfaced at 4xx so staff can distinguish a quota exhaustion from a bad address.'],
  ['estimate-commercial-noi', 'Validation failure at 4xx; the message names the field that failed.'],
  ['manage-agent-models', 'Model probe result at 200 reports the provider error per attempt — that IS the probe result.'],
  ['_shared/reportMetering.ts', 'Structured insufficient_funds body at 4xx; the code and the shortfall are what the caller acts on.'],
  ['_shared/llmRouter.ts', 'Not an HTTP body. The router returns a Response-SHAPED object (`{ ok, status, json(), text() }`) to callers inside the same edge function, so the provider error stays in-process; whichever function receives it decides what, if anything, reaches the client.'],
  ['ai-dashboard-agent', 'Not an HTTP body. The value is a tool-result `content` string fed back to the model on the next turn — a tool that failed silently would have the model report success. What the agent then returns to the browser goes through the ordinary 5xx path.'],
  ['render-source', 'Fetchability failure at 400 from assertFetchable(): the whole operation is "render this URL", so "that URL could not be read" is the answer, not a leak. The SSRF denials it sits beside deliberately say only `ssrf_denied`.'],
]);

const LEAK_KEYS = new Set(['error', 'message', 'details', 'detail', 'stack',
  'errorMessage', 'error_message', 'reason', 'errors']);
const HELPERS = new Set(['JSON.stringify', 'json', 'jsonResponse', 'jr', 'jsonError',
  'fail', 'jsonErr', 'response', 'errorResponse']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Brace-matched catch bodies: [caughtVar, bodyStart, bodyEnd]. */
function* catchBlocks(src) {
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*(?::[^)]*)?\)\s*\{/g)) {
    let depth = 0;
    for (let j = m.index + m[0].length - 1; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) {
        yield [m[1], m.index + m[0].length, j];
        break;
      }
    }
  }
}

/** Brace-matched `{...}` spans inside [a,b). */
function objectLiterals(src, a, b) {
  const out = [];
  for (let i = a; i < b; i++) {
    if (src[i] !== '{') continue;
    let depth = 0;
    for (let j = i; j < b; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) { out.push([i, j + 1]); break; }
    }
  }
  return out;
}

function splitTopLevel(inner) {
  const parts = []; let depth = 0, cur = '', str = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (str) {
      cur += c;
      if (c === '\\') { cur += inner[++i] ?? ''; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { str = c; cur += c; continue; }
    if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c)) depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** Identifier of the call this literal is the argument of, if any. */
function precedingCall(src, s) {
  let k = s - 1;
  while (k >= 0 && ' \t\n'.includes(src[k])) k--;
  if (src[k] !== '(') return null;
  k--;
  while (k >= 0 && ' \t\n'.includes(src[k])) k--;
  const e = k + 1;
  while (k >= 0 && (/[\w$.]/.test(src[k]))) k--;
  return src.slice(k + 1, e) || null;
}

/** true = 5xx, false = other, null = undetermined. */
function statusAfter(src, e) {
  const tail = src.slice(e, e + 400);
  const init = tail.match(/status:\s*(\d{3})/);
  if (init) return init[1].startsWith('5');
  let depth = 0, rest = null;
  for (let j = e; j < Math.min(src.length, e + 600); j++) {
    const c = src[j];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) { rest = src.slice(e, j); break; }
      depth--;
    }
  }
  if (rest === null) return null;
  for (const arg of splitTopLevel(rest.replace(/^[\s,]+/, ''))) {
    if (/^\d{3}$/.test(arg.trim())) return arg.trim().startsWith('5');
  }
  return null;
}

const errors = [];
let scanned = 0;

for (const file of walk(FUNC_DIR)) {
  const rel = relative(root, file).replace(/\\/g, '/');
  if (rel.endsWith('_shared/errorResponse.ts')) continue;
  const src = readFileSync(file, 'utf8');
  scanned++;
  const fnName = rel.split('/')[2] === undefined ? rel : rel.split('/')[2];
  const exemptKey = rel.includes('/_shared/') ? rel.slice(rel.indexOf('_shared/')) : fnName;

  for (const [v, a, b] of catchBlocks(src)) {
    const leak = new RegExp(
      `(?:\\b${v}\\b\\s*(?:as\\s+[\\w<>\\[\\]| ]+)?\\s*\\)?\\s*\\??\\.(?:message|stack)`
      + `|String\\(\\s*${v}\\b)`,
    );
    for (const [s, e] of objectLiterals(src, a, b)) {
      const call = precedingCall(src, s);
      if (!HELPERS.has(call)) continue;
      if (call === 'JSON.stringify') {
        /* A structured log line, not a response body — the header's own scope
           note says `console.*` is deliberately out of scope, and Supabase's
           log viewer needs one JSON object per line to be searchable.
           A leading string LITERAL message is allowed before it, because
           `console.warn('[fn] what happened', JSON.stringify({ … }))` is the
           shape every such log in this repo actually takes and the one-argument
           form alone missed all of them. Only a literal: an expression there
           could itself carry the leak this gate exists to catch. The window is
           long enough to hold a real prefix — 60 characters could not, which is
           the second half of why this carve-out never fired. */
        const before = src.slice(Math.max(0, s - 200), s);
        const LOGGED = new RegExp(
          String.raw`console\.(?:error|warn|log|info|debug)\s*\(\s*`
          + String.raw`(?:(?:'[^'\n]*'|"[^"\n]*"|\`[^\`\n]*\`)\s*,\s*)?`
          + String.raw`JSON\.stringify\s*\(\s*$`,
        );
        if (LOGGED.test(before)) continue;
      }
      const inner = src.slice(s + 1, e - 1);
      if (!inner.trim()) continue;
      const offending = splitTopLevel(inner).some((p) => {
        const km = p.match(/^\s*(?:(["']?)([\w$]+)\1\s*:)/);
        return km && LEAK_KEYS.has(km[2]) && leak.test(p);
      });
      if (!offending) continue;

      const is5xx = statusAfter(src, e);
      if (is5xx === false || is5xx === null) {
        if (ERROR_DISCLOSURE_EXEMPTIONS.has(exemptKey)) continue;
        errors.push(
          `${rel}: a non-5xx response inside a catch block echoes the caught error `
          + `(\`${src.slice(s, e).replace(/\s+/g, ' ').slice(0, 80)}…\`). If the message is something the `
          + `reader can act on, add \`${exemptKey}\` to ERROR_DISCLOSURE_EXEMPTIONS with a reason. `
          + `If it is not, route it through internalError().`);
        continue;
      }
      errors.push(
        `${rel}: a 500 response returns the caught error to the caller `
        + `(\`${src.slice(s, e).replace(/\s+/g, ' ').slice(0, 80)}…\`). Postgres messages carry table, `
        + `column and constraint names. Use \`internalError(${v}, '<context>')\` from `
        + `_shared/errorResponse.ts — it logs the detail and returns a correlation id.`);
    }
  }
}

if (errors.length) {
  console.error('Error-disclosure check FAILED:\n');
  for (const e of [...new Set(errors)].sort()) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `Error-disclosure check passed (${scanned} files; no caught error reaches a client 5xx; `
  + `${ERROR_DISCLOSURE_EXEMPTIONS.size} reviewed non-5xx exemption(s)).`,
);
