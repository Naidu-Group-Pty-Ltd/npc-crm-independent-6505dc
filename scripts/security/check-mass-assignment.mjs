#!/usr/bin/env node
/**
 * WP-20 — a request body may not choose which columns get written.
 *
 * ## The shape of it
 *
 * Several operations took a sub-object off the request and wrote it straight to
 * a table:
 *
 *     const a = body.alert ?? {};
 *     aml.from('alerts').update(a).eq('id', a.id)
 *
 * Every column the caller named got written, including ones no UI exposes. In
 * `aml.alerts` that reached `resolved_by` and `resolved_at` — the record of who
 * closed an alert and when. These sit behind `requireWrite()`/MLRO gates, so it
 * is not an anonymous hole; it is an authorised user reaching past the workflow,
 * and in an AML file that is a compliance problem rather than a data-quality
 * one.
 *
 * The fix is a field allowlist at the write — `pickAllowed` from
 * `_shared/wp09Guards.ts`, with the columns declared in a module next to the
 * function. Not a denylist: `delete payload.id; delete payload.user_id` leaves
 * every column nobody thought of writable, and the set of columns nobody thought
 * of grows every migration.
 *
 * ## Why this ratchets
 *
 * 90 write sites derive from a request body. Most were already laundered through
 * `pickAllowed`, `pickKnownColumns`, `buildMatterPayload` and friends; the
 * remainder needed a per-table decision about which columns are legitimately
 * writable, which is product knowledge and not one change. So the set was frozen
 * in `supabase/functions-registry/mass-assignment-baseline.json` and the gate
 * failed on anything NEW — the same ratchet `edge-typecheck-baseline.json` uses.
 *
 * **The backlog is now zero** (WP-25), so the ratchet has become a zero-tolerance
 * gate without needing to be rewritten as one: the baseline holds `0`, and any
 * new unallowlisted write is a regression against it. The mechanism stays a
 * ratchet because a future refactor may legitimately need to land debt before
 * paying it, and a gate that cannot express "not yet" gets disabled instead.
 *
 * `--list` prints the sites; `--update` re-freezes. The committed baseline is
 * the record of the backlog shrinking — 15 → 0.
 *
 *   node scripts/security/check-mass-assignment.mjs           # check
 *   node scripts/security/check-mass-assignment.mjs --list    # where
 *   node scripts/security/check-mass-assignment.mjs --update  # re-freeze
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// cwd, not import.meta.url — the negative-test harness mutates a mirror.
const root = resolve(process.cwd());
const FUNC_DIR = join(root, 'supabase', 'functions');
const BASELINE = join(root, 'supabase', 'functions-registry', 'mass-assignment-baseline.json');
const update = process.argv.includes('--update');
// `--list` prints every site with its line number. The count alone tells you a
// file still has work in it but not where, and the detection is subtle enough
// (nearest-definition-above, alias-following, spread-resolution) that guessing
// from a grep finds the wrong line as often as the right one.
const list = process.argv.includes('--list');
const sites = [];

/**
 * Helpers that return an allowlisted object. A write fed by one is fine.
 *
 * `pick(` is here alongside the longer names because three finance-portal
 * functions define a local `pick(payload, X_COLS)` rather than importing
 * `pickAllowed`. That duplication is worth removing on its own, but it is
 * genuinely an allowlist and the gate must not claim otherwise.
 */
const LAUNDERERS = /\bpick\w*\(|pickAllowed|pickKnownColumns|pickEditable|sanitize[A-Z]|normalise[A-Z]\w*Payload|build[A-Z]\w*Payload|mapPayload|WRITABLE|_COLUMNS\b|_COLS\b|_FIELDS\b/;

/**
 * Does this expression carry the CALLER's object?
 *
 * `.data` needs a root. It is here to catch `body.data` and the `{ ok, data }`
 * that `_shared/validate.ts` and zod's `safeParse` return — all genuinely the
 * request. As a bare `\.data\b` it also matched `inserted.data`, which is a row
 * this process just wrote and read back, and reported a hand-built four-column
 * literal in `quantitative-report-pipeline` as mass assignment.
 *
 * That direction of error is the expensive one. A gate that names correct code
 * gets read as noise, and then the site it is right about gets read as noise
 * too.
 */
const REQUEST_DERIVED =
  /\bbody\b|req\.json\(\)|\bpayload\b|\b(?:body|payload|parsed|validated|input|req|request|args)\s*\.\s*data\b/;

/**
 * An object literal whose keys are written out is an allowlist by construction —
 * `{ subject: payload.subject, body: payload.body }` can only ever write those
 * two columns, however much the caller sends. It only stops being one when a
 * request-derived object is spread into it, which is the thing being looked for.
 *
 * Without this the gate reported every hand-built row as mass assignment, which
 * is both wrong and the fastest way to teach people the gate is noise.
 */
function isExplicitLiteral(rhs) {
  if (!rhs.includes('{')) return false;
  // Remove every balanced `{...}` group. What is left is the plumbing around the
  // literals — a ternary condition, a `??`, nothing. If none of THAT is
  // request-derived, the only things that can reach the table are the named keys.
  //
  // Written this way because `const update = unverify ? {a: 1} : {b: 2}` spans
  // lines and starts with an identifier, so a "starts with {" test called it mass
  // assignment and then followed `unverify` back to `!!body.unverify` — flagging
  // an operation that can only ever write three hardcoded columns.
  let outside = rhs;
  for (let pass = 0; pass < 6; pass++) {
    const next = outside.replace(/\{[^{}]*\}/g, ' ');
    if (next === outside) break;
    outside = next;
  }
  // A spread only breaks the guarantee when what is spread is REQUEST-derived.
  // `{ ...defaults, name: body.name }` is still an allowlist — `defaults` is the
  // author's object. `{ ...body.alert }` is not. Treating every `...` as
  // disqualifying reported five hand-built rows that merely happened to spread a
  // local default deep inside a 500-character literal.
  if (/\.\.\.\s*(?:body|payload|data|req\.json)\b/.test(rhs)) return false;
  return !REQUEST_DERIVED.test(outside);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.pure.ts')) out.push(p);
  }
  return out;
}

const found = new Map(); // relative path -> count

/**
 * Comments out, before anything is matched.
 *
 * This gate flagged `_shared/amlWritableColumns.ts` — the module whose entire
 * purpose is to hold the allowlists — because its header quotes the bug it
 * exists to prevent: `aml.from('alerts').update(a)`. Same class of fault as the
 * comment that satisfied `check-client-portfolio-authz` by restating the call it
 * asserts on. A gate that reads prose as code is wrong in both directions: it
 * invents findings, and it can be silenced by a well-placed sentence.
 *
 * Replaced with spaces rather than removed so byte offsets, and therefore line
 * numbers in any future message, stay true.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

for (const file of walk(FUNC_DIR)) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const src = stripComments(readFileSync(file, 'utf8'));
  let count = 0;

  for (const m of src.matchAll(
    /\.(?:insert|update|upsert)\(\s*(?:\{\s*\.\.\.\s*([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*[,)])/g,
  )) {
    const varName = m[1] || m[2];
    if (!varName) continue;

    // How is it defined? Follow bare-identifier aliases, because
    // `const alertRow = a;` where `a = body.alert` is still the caller's object
    // — the first version of this gate stopped at the alias and its own
    // negative test walked straight through it.
    //
    // Take the definition NEAREST ABOVE the write, not the first in the file.
    // These handlers multiplex a dozen operations and reuse short names, so
    // `patch` is declared five times in `aml-risk` alone; matching the first one
    // reported an operation that builds its object field-by-field — already an
    // allowlist — as if it spread a request body.
    const writeAt = m.index;
    // The whole initialiser, across newlines, up to the statement terminator —
    // not just the remainder of the declaring line. A ternary between two object
    // literals is the common multi-line form here, and stopping at the newline
    // captured only its condition.
    const define = (name) => {
      const re = new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*(?::[^=\\n]*)?=\\s*`, 'g');
      let best = '';
      for (const d of src.matchAll(re)) {
        if (d.index > writeAt) break;
        let depth = 0;
        let end = d.index + d[0].length;
        // Generous: these initialisers are object literals and several run past a
        // thousand characters. Truncating mid-literal leaves unbalanced braces,
        // which made the explicit-literal test fail and reported five hand-built
        // rows as mass assignment.
        for (; end < src.length && end - d.index < 8000; end++) {
          const c = src[end];
          if ('([{'.includes(c)) depth++;
          else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
          else if (c === ';' && depth === 0) break;
        }
        best = src.slice(d.index + d[0].length, end);
      }
      return best;
    };

    let rhs = define(varName);
    const seen = new Set([varName]);
    for (let hop = 0; hop < 4; hop++) {
      const alias = rhs.trim().match(/^([A-Za-z_$][\w$]*)$/);
      if (!alias || seen.has(alias[1])) break;
      seen.add(alias[1]);
      rhs = define(alias[1]);
    }

    // Only request-derived values are in scope. A locally-built object
    // (`const patch = { status: 'processing' }`) is the author's, not the
    // caller's.
    const bodyDerived = REQUEST_DERIVED.test(rhs)
      || ['body', 'payload'].includes(varName);
    if (!bodyDerived) continue;

    // Laundered at definition, by a helper named on the write itself, or by
    // being an explicitly-keyed literal in the first place.
    if (LAUNDERERS.test(rhs) || LAUNDERERS.test(m[0]) || isExplicitLiteral(rhs)) continue;

    // `const insert = { ...payload, client_id: body.client_id }` where
    // `payload = buildMatterPayload(body, …)`. The spread is of an already
    // allowlisted object, but the alias-follow above only chases a BARE
    // identifier, so it never reached the helper. Resolve what is spread and ask
    // the same question of it.
    const spreadOf = rhs.match(/\{\s*\.\.\.\s*([A-Za-z_$][\w$]*)\b/);
    if (spreadOf && !seen.has(spreadOf[1])) {
      const inner = define(spreadOf[1]);
      if (LAUNDERERS.test(inner) || isExplicitLiteral(inner)) continue;
    }

    // Laundered on the way in — `const row = pickAllowed(rule, X)` two lines up
    // then `insert(row)` — is covered by the rhs test above. What is NOT covered
    // is a write of the raw variable when a *different* variable was laundered,
    // which is the bug this is looking for.
    count++;
    if (list) {
      sites.push(`${rel}:${src.slice(0, writeAt).split('\n').length}  ${varName}  ${m[0].trim()}`);
    }
  }
  if (count) found.set(rel, count);
}

if (list) {
  for (const s of sites) console.log(s);
  console.log(`\n${sites.length} site(s).`);
  process.exit(0);
}

const total = [...found.values()].reduce((a, b) => a + b, 0);

if (update) {
  writeFileSync(BASELINE, `${JSON.stringify({
    $comment: 'WP-20: per-file count of writes fed by an unallowlisted request body. '
      + 'Frozen so new mass-assignment cannot land while the existing backlog is worked down. '
      + 'Regenerate with `node scripts/security/check-mass-assignment.mjs --update`. Numbers may only go down.',
    generated_total: total,
    files: Object.fromEntries([...found].sort(([a], [b]) => a.localeCompare(b))),
  }, null, 2)}\n`);
  console.log(`Wrote baseline: ${found.size} files, ${total} sites.`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch {
  console.error(`Mass-assignment check could not read ${relative(root, BASELINE)}. Run with --update to create it.`);
  process.exit(1);
}

const previous = baseline.files ?? {};
const regressions = [];
const improvements = [];
for (const [file, count] of found) {
  const was = previous[file] ?? 0;
  if (count > was) regressions.push(`${file}: ${was} → ${count}`);
}
for (const [file, was] of Object.entries(previous)) {
  const now = found.get(file) ?? 0;
  if (now < was) improvements.push(`${file}: ${was} → ${now}`);
}

console.log(`Mass-assignment: ${total} request-derived write(s) without a field allowlist (baseline ${baseline.generated_total}).`);

if (regressions.length) {
  console.error('\nMass-assignment check FAILED — new unallowlisted writes:\n');
  for (const r of regressions) console.error(`  - ${r}`);
  console.error(
    '\nA request body must not choose which columns get written. Filter it with '
    + '`pickAllowed(input, COLUMNS)` from _shared/wp09Guards.ts and declare the columns '
    + '(see _shared/amlWritableColumns.ts). A denylist is not equivalent: it leaves every '
    + 'column nobody thought of writable, and that set grows every migration.',
  );
  process.exit(1);
}

if (improvements.length) {
  console.log(`\n${improvements.length} file(s) improved on the baseline:`);
  for (const i of improvements) console.log(`  - ${i}`);
  console.log('\nRun with --update to bank the improvement.');
}
console.log('Mass-assignment check passed (no new unallowlisted writes).');
