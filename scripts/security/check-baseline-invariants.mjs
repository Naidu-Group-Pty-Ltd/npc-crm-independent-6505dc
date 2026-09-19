#!/usr/bin/env node
/**
 * WP-24 — the four items that were already closed, and had nothing holding them.
 *
 * The 20-item review found items 6, 8, 9 and 13 in good shape and gated by
 * nothing. That is a specific and quiet kind of risk: a property that is true
 * because of how somebody wrote the code once, with no mechanism to notice when
 * the next person writes it differently. Every other item on that list has a
 * gate; these four had the reviewer's word.
 *
 * Each rule below asserts a property the codebase ALREADY satisfies, so this
 * fails only on a regression.
 *
 *   item 6  — no arbitrary-SQL execution path
 *   item 8  — user HTML is sanitised before it is injected
 *   item 9  — passwords are hashed, never stored or compared as plaintext
 *   item 13 — every portal keeps an email-verification flow
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// cwd, not import.meta.url — the negative-test harness mutates a mirror.
const root = resolve(process.cwd());
const FUNC_DIR = join(root, 'supabase', 'functions');
const SRC_DIR = join(root, 'src');
const MIGRATIONS = join(root, 'supabase', 'migrations');

const errors = [];

function walk(dir, exts, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const rel = (p) => relative(root, p).replace(/\\/g, '/');
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));

// ── Item 6: no arbitrary-SQL execution path ────────────────────────────────
//
// The reason this repo is not exposed to SQL injection is not that its queries
// are escaped — it is that there is nowhere to send SQL. Every one of the 400+
// database calls goes through PostgREST or a NAMED rpc with typed arguments.
// Introducing a generic `exec_sql(query text)` RPC, or an edge function that
// forwards a caller's string to one, would undo that in a single commit and
// look like a convenience while doing it.
{
  const DANGEROUS_RPC = /\.rpc\(\s*['"`](exec_sql|execute_sql|run_sql|raw_sql|sql)['"`]/;
  for (const file of [...walk(FUNC_DIR, ['.ts']), ...walk(SRC_DIR, ['.ts', '.tsx'])]) {
    const src = stripComments(readFileSync(file, 'utf8'));
    if (DANGEROUS_RPC.test(src)) {
      errors.push(
        `[item-6] ${rel(file)}: calls a generic SQL-execution RPC. This codebase has no `
        + `arbitrary-SQL path — every query is PostgREST or a named rpc with typed arguments — `
        + `and that is the whole of its SQL-injection defence.`);
    }
    // An `.rpc()` whose NAME is built from a variable is the same hole one step
    // removed: the caller chooses the procedure.
    for (const m of src.matchAll(/\.rpc\(\s*`([^`]*\$\{)/g)) {
      errors.push(
        `[item-6] ${rel(file)}: the RPC name is interpolated (\`${m[1]}…\`), so the caller can `
        + `choose which procedure runs. Name it literally.`);
    }
  }

  // The migration side: a SECURITY DEFINER function that EXECUTEs a string
  // argument is an arbitrary-SQL path with extra steps.
  for (const name of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql') && n >= '20260909')) {
    const sql = readFileSync(join(MIGRATIONS, name), 'utf8').replace(/^\s*--.*$/gm, ' ');
    if (/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION[\s\S]{0,400}?\(\s*[\w"]+\s+text[\s\S]{0,600}?EXECUTE\s+[\w"]+\s*;/i.test(sql)) {
      errors.push(
        `[item-6] supabase/migrations/${name}: defines a function that EXECUTEs a text argument. `
        + `That is an arbitrary-SQL path; use a named function with typed parameters.`);
    }
  }
}

// ── Item 8: user HTML is sanitised ─────────────────────────────────────────
//
// `dangerouslySetInnerHTML` is not wrong by itself; unsanitised input reaching it
// is. Two files use it today: one sanitises with DOMPurify and then strips inline
// handlers DOMPurify leaves behind, the other is shadcn's chart component
// injecting CSS variables from a typed config. A third would be a decision
// somebody should have to make deliberately.
{
  const KNOWN = new Map([
    ['src/components/email/SanitizedEmailHtml.tsx', 'DOMPurify.sanitize + a post-pass stripping inline handlers'],
    ['src/components/ui/chart.tsx', 'shadcn CSS-variable injection from a typed theme config, not user input'],
  ]);
  for (const file of walk(SRC_DIR, ['.ts', '.tsx'])) {
    const r = rel(file);
    const src = stripComments(readFileSync(file, 'utf8'));
    if (!/dangerouslySetInnerHTML/.test(src)) continue;
    if (KNOWN.has(r)) {
      // Still hold the sanitiser in place in the file that has one.
      if (r.endsWith('SanitizedEmailHtml.tsx') && !/DOMPurify\.sanitize\s*\(/.test(src)) {
        errors.push(
          `[item-8] ${r}: injects HTML but no longer calls DOMPurify.sanitize(). This component `
          + `renders mail from outside the organisation.`);
      }
      continue;
    }
    if (/DOMPurify\.sanitize\s*\(|sanitizeHtml\s*\(/.test(src)) continue;
    errors.push(
      `[item-8] ${r}: a new dangerouslySetInnerHTML with no visible sanitiser. Sanitise with `
      + `DOMPurify (see src/components/email/SanitizedEmailHtml.tsx), or add this file to the `
      + `reviewed list in this gate with the reason it is safe.`);
  }
}

// ── Item 9: passwords are hashed ───────────────────────────────────────────
//
// Staff and all four portals authenticate against custom credential tables
// rather than GoTrue, so nothing outside this repository guarantees that a
// password is hashed. `_shared/password.ts` is that guarantee.
{
  const passwordModule = join(FUNC_DIR, '_shared', 'password.ts');
  let mod = '';
  try { mod = readFileSync(passwordModule, 'utf8'); } catch {
    errors.push('[item-9] supabase/functions/_shared/password.ts is missing — it is the only place a password is hashed.');
  }
  if (mod && !/bcrypt|scrypt|argon|pbkdf2/i.test(mod)) {
    errors.push(
      '[item-9] _shared/password.ts no longer uses a recognised password hash '
      + '(bcrypt/scrypt/argon2/PBKDF2). A fast general-purpose digest is not a password hash.');
  }

  // Comparing a submitted secret directly against a STORED column is the shape
  // of a plaintext store, even when the column happens to hold a hash — it means
  // the comparison is not going through the hash verifier.
  //
  // Deliberately narrow. The first version flagged `new_password ===
  // current_password` in three change-password functions, which is a
  // don't-reuse-your-old-password check over two values the user just typed and
  // has nothing to do with storage. A gate that cries wolf about correct code is
  // how gates get ignored, so this now requires one side to be a record field.
  //
  // Same reason for TYPEOF_GUARD. `typeof row.password_hash === 'string'` is a
  // presence check — "does this partner have a credential at all" — and the
  // right-hand side is a type name, never a submitted secret. It read as a
  // violation for as long as `partnerAccess.pure.ts` has existed, which is long
  // enough that the whole security job was failing on it. Neutralise the shape
  // before testing rather than relax the rule: a real comparison is not written
  // `typeof x === 'literal'`, so nothing the gate should catch hides in here —
  // the negative-test mutation (`body.pw === user.password_hash`) still trips it.
  const TYPEOF_GUARD = /typeof\s+[\w.]+\s*===?\s*(['"])[a-z]+\1/gi;
  const PLAINTEXT_COMPARE = /===\s*\w+\.(?:password|password_hash)\b|\.(?:password|password_hash)\s*===/i;
  for (const file of walk(FUNC_DIR, ['.ts'])) {
    const src = stripComments(readFileSync(file, 'utf8')).replace(TYPEOF_GUARD, ' ');
    if (PLAINTEXT_COMPARE.test(src)) {
      errors.push(
        `[item-9] ${rel(file)}: compares a password by equality or queries a \`password\` column. `
        + `Verify through _shared/password.ts, which compares hashes in constant time.`);
    }
  }
}

// ── Item 13: every portal keeps an email-verification flow ─────────────────
//
// Four portals each ship a verify function. Deleting one would silently let
// unverified addresses through that portal only, which is exactly the kind of
// gap that is invisible until somebody uses it.
{
  // (builder-portal-verify left with the Builder Portal — network
  // extraction Phase 7; the Builders Network verifies its own addresses.)
  const REQUIRED = [
    'custom-auth-verify-v2',
    'client-portal-verify',
    'finance-portal-verify',
  ];
  for (const fn of REQUIRED) {
    try {
      statSync(join(FUNC_DIR, fn, 'index.ts'));
    } catch {
      errors.push(
        `[item-13] supabase/functions/${fn}/index.ts is missing. Each portal verifies its own `
        + `addresses; without this one that portal accepts unverified email.`);
    }
  }
}

if (errors.length) {
  console.error('Baseline security invariants FAILED:\n');
  for (const e of [...new Set(errors)].sort()) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('Baseline security invariants passed (items 6, 8, 9, 13 hold).');
