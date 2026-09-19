#!/usr/bin/env node
/**
 * Type-check every Edge Function entry point (WP-14).
 *
 * ## This gate was passing by not running
 *
 * `deno check` was failing before it type-checked anything:
 *
 *     error: Could not find "@supabase/supabase-js" in a node_modules folder.
 *            Deno expects the node_modules/ directory to be up to date.
 *         at supabase/functions/agent-insights-runner/index.ts:6:30
 *
 * Nothing was wrong with that function. `npm ci` creates `node_modules`, and
 * Deno then switches to "bring your own node_modules" resolution, where a
 * versioned `npm:` specifier has to agree with `package.json`. **49 functions
 * use versioned specifiers**, including `npm:@supabase/supabase-js@2.45.0`
 * against a `package.json` declaring `^2.55.0`. Edge functions do not deploy
 * against `node_modules` at all — they run on Deno Deploy, which resolves
 * `npm:` from the registry — so the frontend's install directory has no
 * business in this check.
 *
 * `DENO_NO_PACKAGE_JSON=1` takes `package.json` out of scope, which is both the
 * fix and an accurate description of the deployment target.
 *
 * That failure has been masking the gate for a long time — the job it lives in
 * failed at an earlier step for months, so nobody saw this one fail either.
 *
 * ## Why a baseline
 *
 * With resolution fixed, the check reports **430 pre-existing type errors
 * across 410 files** — years of accumulated drift in code nobody was being told
 * about. Fixing them is not one change, and most of them belong to other
 * programmes.
 *
 * So this ratchets rather than blocks, the same way
 * `scripts/audit-style-tokens.cjs` does for hardcoded styles and
 * `needs-review-baseline.json` does for the security registry: the current
 * count per file is frozen in `edge-typecheck-baseline.json`, and the gate
 * fails when a file gains an error or a clean file acquires one. Existing debt
 * is visible and capped; new debt cannot land.
 *
 * Lower a number whenever you fix something — `--update` rewrites the baseline,
 * and the committed file is the record of the backlog shrinking.
 *
 * ## What the baseline may not absorb
 *
 * Five diagnostics mean the module is unloadable rather than merely
 * mistyped, so the function answers `BOOT_ERROR` to every request. Those are
 * reported whatever the baseline says and `--update` refuses to bank them —
 * see `LOAD_FATAL` below for the four production functions that were shipped
 * in exactly that state and stayed there because their counts were baselined.
 *
 *   node scripts/security/check-edge-functions.mjs            # check
 *   node scripts/security/check-edge-functions.mjs --update   # rewrite baseline
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const functionsDir = join(root, 'supabase', 'functions');
const BASELINE_PATH = join(root, 'supabase', 'functions-registry', 'edge-typecheck-baseline.json');
const KNOWN_MISSING_PATH = join(root, 'supabase', 'functions-registry', 'edge-missing-names.txt');

/**
 * A type-check-only import map, repairing one broken upstream declaration.
 *
 * `deno check` follows `x-typescript-types`, and `@supabase/supabase-js@2.55.0`
 * — imported by 184 of these entry points — declares
 *
 *     import { StorageClientOptions } from '@supabase/storage-js/dist/module/StorageClient'
 *
 * a deep import into a subpath of a dependency it pins only as `^2.10.4`.
 * storage-js has since been restructured to a flat bundle, so the subpath does
 * not exist in the version that range now resolves to, and esm.sh's build
 * service **hangs** on the missing file rather than 404ing: every request
 * answers `408 Request Timeout`, indefinitely.
 *
 * That looked exactly like a registry outage, and it is not one — no amount of
 * retrying, caching or waiting resolves a subpath that does not exist. See the
 * config file's own header for the full account and the condition for deleting
 * it. The mapping points at the same package at the same version's real
 * declarations, so nothing is stubbed and nothing is relaxed.
 */
const TYPECHECK_CONFIG = join(root, 'scripts', 'security', 'edge-typecheck.deno.json');
const update = process.argv.includes('--update');

const entries = readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) => {
    const index = join(functionsDir, entry.name, 'index.ts');
    try { return statSync(index).isFile() ? [index] : []; } catch { return []; }
  }).sort();

const runCheck = () => spawnSync('deno', ['check', '--config', TYPECHECK_CONFIG, ...entries], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
  // See the header: the frontend's node_modules must not be in scope.
  env: { ...process.env, DENO_NO_PACKAGE_JSON: '1' },
});

/**
 * A registry that times out is not a verdict — in either direction.
 *
 * These entry points import from `esm.sh` and `deno.land`, and when one of those
 * is briefly unhealthy Deno reports
 *
 *     error: Import 'https://esm.sh/...' failed: 408 Request Timeout
 *
 * Before the guard below existed that was read as "0 type errors" and the gate
 * passed. With the guard it fails, correctly — but failing a whole build on
 * somebody else's blip is the other wrong answer, and a red build nobody can act
 * on is how a gate earns a reputation for noise. Both happened within an hour.
 *
 * So: retry with backoff. Deno caches what it already fetched, so a later
 * attempt needs less. If every attempt still fails the gate fails closed — this
 * shortens the window, it does not reopen it.
 *
 * **A permanent fault can wear this costume.** The 408 above was not an outage
 * at all: esm.sh hangs, rather than 404ing, on a subpath that does not exist,
 * and supabase-js's declarations ask for one. It answered 408 forever, and
 * "transient" was the wrong word for it three commits running. If a retry
 * exhausts on the same specifier run after run, stop shortening the window and
 * go and read what is actually being fetched — see edge-typecheck.deno.json.
 */
const TRANSIENT = /Import '[^']*' failed: (408|429|5\d\d)|error sending request|connection closed|dns error|timed out/i;
const ATTEMPTS = 3;
let result;
let plain = '';
for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  result = runCheck();
  if (result.error) {
    console.error(`Edge Function check could not start: ${result.error.message}`);
    process.exit(1);
  }
  // Deno prints colour codes even when piped; strip them before matching.
  plain = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replace(/\[[0-9;]*m/g, '');
  if (result.status === 0 || !TRANSIENT.test(plain)) break;
  if (attempt < ATTEMPTS) {
    const waitMs = attempt * 5000;
    console.error(
      `Edge Function check: a module registry failed transiently (attempt ${attempt}/${ATTEMPTS}). `
      + `Retrying in ${waitMs / 1000}s.`,
    );
    // Synchronous sleep: this is a sequential gate, not a server.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
  }
}

/**
 * What Deno said, with enough of it to act on.
 *
 * This used to print only the lines beginning `error:`, which is fine for a
 * resolution failure — those name the specifier — and useless for a syntax
 * error, where every word that matters is on the *indented* lines Deno prints
 * under it:
 *
 *     error: SyntaxError: Expected ',', got '{'
 *        |
 *     42 | import { internalError } from '../_shared/errorResponse.ts';
 *        |        ~
 *         at file:///…/update-stamp-duty-rates/index.ts:42:8
 *
 * Filtered to `error:` lines that is a message with no file, no line and no
 * offending token — for a fault in a tree of 421 entry points. Keep the block.
 */
const errorExcerpt = (text) => {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith('error:'));
  if (start === -1) return text.split('\n').slice(0, 12).join('\n');
  const end = lines.findIndex((line, i) => i > start && /^Stack backtrace:/.test(line));
  return lines.slice(start, end === -1 ? start + 12 : end).join('\n').trimEnd();
};

/**
 * A resolution failure is not a type error and must never be baselined — it
 * means the check did not run, which is exactly the state this file was in.
 */
const RESOLUTION_FAILURE =
  /^error: (Could not find|Failed resolving types|Relative import path|Module not found|Import '[^']*' failed)/m;
if (RESOLUTION_FAILURE.test(plain)) {
  console.error('Edge Function check could not resolve its dependencies — it did not type-check anything:\n');
  console.error(errorExcerpt(plain));
  process.exit(1);
}

/**
 * The diagnostics that are not type debt, because the module never loads.
 *
 * The baseline below exists because 430 pre-existing type errors cannot be
 * fixed in one change, and nearly all of them are harmless at runtime: Deno
 * strips types and runs the JavaScript underneath, so a bad cast or an
 * unchecked null is a latent bug rather than an immediate one.
 *
 * These five are different in kind. Each one means the *JavaScript* is
 * unloadable, so the function does not run at all — it answers
 *
 *     {"code":"BOOT_ERROR","message":"Function failed to start (please check logs)"}
 *
 * to every request that ever reaches it. Counting them alongside the debt is
 * how four functions came to be shipped in that state and stay there:
 *
 *   - `import-schools-data` and `sqm-rent-service` each declared
 *     `supabaseUrl`/`supabaseKey`/`supabase` twice in one block scope (TS2451),
 *     which is a parse-time SyntaxError;
 *   - `legal-matters-admin` imported `mirrorToFinancePortal` from
 *     `_shared/legalComms.ts`, which has never exported it and which nothing in
 *     this repo defines;
 *   - `pdf-parse-chunk-callback` imported `PAGE_ARTIFACT_CONTRACT_VERSION` from
 *     `pageArtifactContractV3.pure.ts`, which imports that constant for its own
 *     use and does not re-export it.
 *
 * All four were inside their baselined counts — 6, 6, 3 and 10 — so the gate
 * read them as backlog and passed. They were invisible from the outside too,
 * because three of them are called from the browser and the gateway's JWT check
 * refused the CORS preflight *before* the runtime tried to load the module: the
 * caller saw an opaque "Network/CORS error", and the boot failure underneath it
 * only surfaced once the preflight was fixed.
 *
 * So these are reported whatever the baseline says, and `--update` refuses to
 * bank them. A missing export used only as a type is elided by Deno and would
 * run — it is still a broken import, and fixing one costs a line, which is much
 * less than the chance of being wrong about which of the two it is.
 */
const LOAD_FATAL = new Map([
  ['TS2300', 'duplicate identifier — the module is not valid JavaScript'],
  ['TS2305', 'imported name is not exported by that module — SyntaxError at load'],
  ['TS2307', 'module cannot be resolved — nothing to load'],
  ['TS2451', 'block-scoped redeclaration — SyntaxError at parse'],
  ['TS2459', 'name is declared locally by that module but not exported — SyntaxError at load'],
  /*
   * A name that does not exist is a ReferenceError the moment the line runs.
   *
   * The module LOADS, so this is not a boot failure — which is exactly what
   * makes it worse than one. A boot failure is total and obvious; this ships
   * a function that serves every other operation perfectly and throws a 500
   * on one branch, and only when somebody exercises that branch.
   *
   * It is here because it happened. `defer_pep_determination` called
   * `appendCaseEvent`; the function in that file is `appendEvent`. It reached
   * production, and the operator saw "the server refused it" with nothing to
   * act on. A count-based baseline can absorb that — the file simply gains an
   * error — so the class is excluded from banking rather than trusted to a
   * number.
   *
   * These are never legitimate debt. There is no such thing as a
   * deliberately-undefined identifier on a live code path.
   */
  ['TS2304', 'name does not exist — ReferenceError the moment that line runs'],
  ['TS2552', 'name does not exist — ReferenceError the moment that line runs'],
]);

/**
 * Undefined identifiers that already existed when this class was promoted to
 * fatal, frozen so that existing debt stays visible without blocking, and a
 * NEW one cannot land.
 *
 * The same ratchet the count baseline uses, keyed differently: a count can
 * absorb a swapped-in defect (one goes, one arrives, the number holds), and
 * for this class that means shipping a guaranteed 500. So each occurrence is
 * named.
 *
 * Every entry here is a live defect on some code path — several of them in
 * authorisation helpers — and each belongs to the programme that owns that
 * function. Shortening this list is always an improvement.
 *
 * `EdgeRuntime` is the exception and is NOT debt: it is a real global the
 * Supabase Edge Runtime provides and Deno's type declarations do not know
 * about, so it is listed here rather than "fixed".
 */
const KNOWN_MISSING_NAMES = new Set(readFileSync(KNOWN_MISSING_PATH, 'utf8')
  .split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean));

/** `at file:///…/supabase/functions/<name>/…` — the file an error was reported in. */
const AT_FILE = /at file:\/\/(\S+?):\d+:\d+/g;
const counts = new Map();
const fatal = [];
for (const block of plain.split(/(?=^TS\d+ \[ERROR\])/m)) {
  if (!/^TS\d+ \[ERROR\]/.test(block)) continue;
  const at = [...block.matchAll(AT_FILE)][0];
  if (!at) continue;
  const file = relative(root, at[1]).replace(/\\/g, '/');
  counts.set(file, (counts.get(file) ?? 0) + 1);
  const code = block.match(/^(TS\d+) \[ERROR\]/)[1];
  if (LOAD_FATAL.has(code)) {
    const message = block.split('\n')[0].replace(/^TS\d+ \[ERROR\]:\s*/, '').trim();
    // Keyed by FILE and IDENTIFIER, never by line: a line number moves with
    // every edit above it, so a positional key would either churn constantly
    // or, worse, silently start covering a different defect.
    const name = message.match(/Cannot find name '([^']+)'/)?.[1] ?? null;
    const key = name ? `${file}::${name}` : null;
    if (key && KNOWN_MISSING_NAMES.has(key)) continue;
    fatal.push({
      code,
      where: `${file}:${at[0].match(/:(\d+:\d+)$/)[1]}`,
      message,
    });
  }
}

// Before `--update`, so a fatal error can never be banked as backlog.
if (fatal.length) {
  console.error(
    `\nEdge Function type-check FAILED — ${fatal.length} diagnostic(s) that break a function at runtime.\n`
    + 'These are not type debt and are never baselined: the module either cannot load at all,\n'
    + 'or names an identifier that does not exist and throws the moment that line runs.\n',
  );
  for (const { code, where, message } of fatal) {
    console.error(` - ${where}\n     ${code}: ${message}\n     why fatal: ${LOAD_FATAL.get(code)}`);
  }
  console.error('\nFix them. --update will not bank them.\n');
  process.exit(1);
}

const observed = Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
const total = Object.values(observed).reduce((sum, n) => sum + n, 0);

/**
 * Deno failed, and produced no type errors while doing it. That is not a clean
 * tree — it is a check that never ran.
 *
 * The named-pattern guard above has to predict how Deno phrases each failure,
 * and it did not predict this one:
 *
 *     error: Import 'https://esm.sh/...' failed: 408 Request Timeout
 *
 * A transient registry blip therefore reported **0 errors across 421 entry
 * points** and passed. Worse, `--update` would have banked that zero, freezing
 * a gate that checks nothing into the repository as a perfect score. That was
 * one command away from happening.
 *
 * This guard needs no such prediction. When there are real type errors Deno
 * also exits non-zero, so the two cases are separated by whether anything was
 * parsed out — not by the wording of the message.
 */
if (result.status !== 0 && total === 0) {
  console.error(
    `Edge Function check did not run: deno exited ${result.status} and reported no type errors.\n`
    + 'That is a failure to type-check, not a clean tree — refusing to report (or bank) zero.\n',
  );
  console.error(errorExcerpt(plain));
  process.exit(1);
}

if (update) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify({
    $comment:
      'WP-14: per-file type-error counts for supabase/functions entry points, frozen so new '
      + 'errors fail CI while the existing backlog is worked down. Regenerate with '
      + '`node scripts/security/check-edge-functions.mjs --update`. Numbers may only go down.',
    generated_total: total,
    files: observed,
  }, null, 2)}\n`);
  console.log(`Wrote baseline: ${Object.keys(observed).length} files, ${total} errors.`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch {
  console.error(`Missing or unreadable baseline at ${relative(root, BASELINE_PATH)}. Run with --update.`);
  process.exit(1);
}
const allowed = baseline.files ?? {};
const baselineTotal = Object.values(allowed).reduce((sum, n) => sum + Number(n || 0), 0);

const regressions = [];
for (const [file, count] of Object.entries(observed)) {
  const permitted = Number(allowed[file] ?? 0);
  if (count > permitted) regressions.push({ file, count, permitted });
}
const improvements = Object.entries(allowed)
  .filter(([file, permitted]) => (observed[file] ?? 0) < Number(permitted))
  .map(([file, permitted]) => ({ file, count: observed[file] ?? 0, permitted }));

console.log(
  `Edge Function type-check: ${entries.length} entry points, ${total} errors `
  + `(baseline ${baselineTotal}).`,
);

if (regressions.length) {
  console.error('\nEdge Function type-check FAILED — new type errors:\n');
  for (const { file, count, permitted } of regressions) {
    console.error(` - ${file}: ${permitted} → ${count}`);
  }
  console.error(
    '\nFix them, or if a file was legitimately rewritten, re-run with --update and '
    + 'explain the new number in the commit.',
  );
  process.exit(1);
}

if (improvements.length) {
  console.log(`\n${improvements.length} file(s) improved on the baseline:`);
  for (const { file, count, permitted } of improvements.slice(0, 20)) {
    console.log(` - ${file}: ${permitted} → ${count}`);
  }
  console.log('\nRun with --update to bank the improvement.');
}

console.log('Edge Function type-check passed (no new errors).');
process.exit(0);
