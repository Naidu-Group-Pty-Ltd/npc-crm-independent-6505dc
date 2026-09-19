#!/usr/bin/env node
/**
 * WP-17 — the database layer has to hold its own hardening.
 *
 * ## Why this exists
 *
 * `docs/security/REMEDIATION_FINAL_STATUS_2026-07-21.md` closed the backend
 * remediation with three numbers:
 *
 *     security_definer_view                        3 -> 0
 *     *_security_definer_function_executable     116 -> 9
 *     function_search_path_mutable                 8 -> 0
 *
 * Three weeks later the live advisor read **2 / 96 / 5**.
 *
 * Nothing undid those fixes. They were one-off migrations rather than
 * invariants, and 323 migrations landed after them — 136 creating or altering
 * SECURITY DEFINER objects. Postgres grants EXECUTE to PUBLIC at CREATE time and
 * `anon` inherits PUBLIC, so every new SECURITY DEFINER function starts
 * reachable by the publishable key that ships in the browser bundle, and every
 * new view starts reading its base tables with the owner's rights. Nothing in
 * `.github/workflows/` reads `supabase/migrations/**` at all, so the decay was
 * invisible between advisor runs.
 *
 * Every other layer here has a gate. This is the database's.
 *
 * ## Rules
 *
 *   secdef_search_path    CREATE FUNCTION ... SECURITY DEFINER must SET search_path.
 *   secdef_execute        A new SECURITY DEFINER function must REVOKE EXECUTE
 *                         from PUBLIC **and** `anon` **and** `authenticated`.
 *                         Both halves are a lesson paid for: revoking from
 *                         `anon` alone is a no-op because the grant is PUBLIC's
 *                         (RLS-W5, 20260725096000), and revoking from PUBLIC
 *                         alone is a no-op for `anon` because this project's
 *                         default privileges grant it DIRECTLY (20261129090000).
 *   view_security_invoker CREATE VIEW must set security_invoker = true.
 *   table_rls             CREATE TABLE in public/aml must ENABLE ROW LEVEL SECURITY.
 *
 * ## Grandfathering
 *
 * Only migrations at or after BASELINE are checked, the same ratchet
 * `edge-typecheck-baseline.json` and `needs-review-baseline.json` use. The
 * existing corpus is 900+ files and belongs to other programmes; WP-17's own
 * sweep migration cleans up what it left behind. New debt cannot land.
 *
 * Exemptions live in supabase/migrations/MIGRATION_SECURITY_KEEPLIST.json, keyed
 * by OBJECT and never by file — exempting a file exempts everything anyone adds
 * to it later.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Resolve from the process cwd, NOT from `import.meta.url`. The negative-test
// harness (check-security-gate-negatives.mjs) runs each gate against a symlinked
// mirror of the tree with one file mutated; a gate that resolves relative to its
// own location reads the REAL repository instead and passes on mutated source —
// which is precisely the "gate that is not a gate" this suite exists to catch.
const root = resolve(process.cwd());
const MIGRATIONS = join(root, 'supabase', 'migrations');
const KEEPLIST = join(MIGRATIONS, 'MIGRATION_SECURITY_KEEPLIST.json');

/**
 * Migrations from this timestamp on are checked. This is WP-17's own sweep, so
 * the gate holds itself to its rules too. Never move this forward to make a
 * failure go away — that silently un-checks everything in between.
 */
const BASELINE = '20260909000000';

const keeplist = JSON.parse(readFileSync(KEEPLIST, 'utf8'));
const exempt = new Set((keeplist.exemptions ?? []).map((e) => `${e.rule}:${e.object.toLowerCase()}`));
const isExempt = (rule, object) => exempt.has(`${rule}:${String(object).toLowerCase()}`);

/** Comments hide keywords and, worse, contain example SQL. Strip them first. */
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[^\S\n]*--.*$/gm, ' ')
    .replace(/\s--.*$/gm, ' ');
}

/** `public.foo` / `"public"."foo"` / `foo` -> `public.foo`, lowercased. */
function qualify(raw) {
  const parts = String(raw).split('.').map((p) => p.replace(/["`]/g, '').trim().toLowerCase());
  return parts.length > 1 ? `${parts[0]}.${parts[1]}` : `public.${parts[0]}`;
}

const errors = [];
const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql') && /^\d{14}_/.test(f))
  .filter((f) => f.slice(0, 14) >= BASELINE)
  .sort();

/*
 * ── WHICH FUNCTIONS HAVE EVER HAD `PUBLIC` REVOKED ──────────────────────────
 *
 * The `secdef_execute` rule below already carries the sentence "Revoking from
 * `anon` alone is a no-op", but only enforces it for functions a migration
 * also CREATES. That gap shipped. 20261119140000 revoked EXECUTE on two
 * trigger bodies `FROM anon, authenticated` and created neither, so nothing
 * checked them. Measured on the live catalogue after it applied:
 * `enforce_step_up_session_owner` closed (it carried no PUBLIC grant) and
 * `validate_property_comparison_report_types` did NOT — it is SECURITY
 * DEFINER, still held `=X/postgres`, and remained executable by `anon` after
 * a migration whose whole purpose was to close it. A no-op revoke succeeds,
 * so nothing reported anything.
 *
 * WHY THIS IS A CORPUS-WIDE PASS AND NOT A BASELINE.
 *
 * The question worth asking is not "does this file contain the mistake" — an
 * applied migration is immutable history and its text is a correct record of
 * what ran. It is "was this revoke a no-op that nothing since has FIXED". So
 * the whole corpus is read first for every function PUBLIC has been revoked
 * on, and a finding is raised only where no migration anywhere does it. The
 * rule therefore needs no frozen baseline, no start date and no keeplist
 * entry, and it clears itself the moment a follow-up migration lands — which
 * is what 20261119150000 does for both functions above.
 */
const REVOKE_FN =
  /REVOKE\s+(?:ALL|EXECUTE)(?:\s+PRIVILEGES)?\s+ON\s+FUNCTION\s+([\w".]+)\s*\([^)]*\)([^;]*);/gi;

/**
 * The three roles a SECURITY DEFINER function in `public` has to be closed to,
 * and why each one is load-bearing rather than belt-and-braces:
 *
 *   PUBLIC         `CREATE FUNCTION` grants EXECUTE to PUBLIC and every role
 *                  inherits it, so revoking a role individually removes a grant
 *                  it never had (RLS-W5, 20260725096000).
 *   anon           This project also carries DEFAULT PRIVILEGES granting EXECUTE
 *   authenticated  on new functions in `public` DIRECTLY to both, so revoking
 *                  PUBLIC does not touch them (20261129090000).
 *
 * Both halves were paid for in production and both no-op revokes SUCCEED, so
 * neither reports anything on its own.
 */
const EXECUTE_ROLES = ['PUBLIC', 'anon', 'authenticated'];

/** Qualified function name -> the roles SOME migration revokes EXECUTE on it from. */
const revokedRoles = new Map();
for (const file of files) {
  const sql = stripComments(readFileSync(join(MIGRATIONS, file), 'utf8'));
  for (const m of sql.matchAll(REVOKE_FN)) {
    const fn = qualify(m[1]);
    const seen = revokedRoles.get(fn) ?? new Set();
    for (const role of EXECUTE_ROLES) {
      if (new RegExp(`\\b${role}\\b`, 'i').test(m[2])) seen.add(role);
    }
    revokedRoles.set(fn, seen);
  }
}
const rolesRevokedOn = (fn) => revokedRoles.get(fn) ?? new Set();
const publicRevoked = new Set(
  [...revokedRoles.keys()].filter((fn) => rolesRevokedOn(fn).has('PUBLIC')),
);

for (const file of files) {
  const sql = stripComments(readFileSync(join(MIGRATIONS, file), 'utf8'));
  const at = (rule, object, message) => {
    if (!isExempt(rule, object)) errors.push(`[${rule}] ${file}: ${message}`);
  };

  // ── Functions ────────────────────────────────────────────────────────────
  // Body-delimited so a `$$ ... $$` block that merely mentions SECURITY DEFINER
  // (WP-17's own catalogue sweep does) is not mistaken for a definition.
  const FUNC = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w".]+)\s*\(([\s\S]*?)\)\s*(RETURNS[\s\S]*?)(?=\bAS\b\s*(?:\$[\w]*\$|')|\bBEGIN\s+ATOMIC\b)/gi;
  for (const m of sql.matchAll(FUNC)) {
    const name = qualify(m[1]);
    const header = m[3];
    if (!/SECURITY\s+DEFINER/i.test(header)) continue;

    if (!/SET\s+search_path\s*(?:=|TO)/i.test(header)) {
      at('secdef_search_path', name,
        `\`${name}\` is SECURITY DEFINER with no \`SET search_path\`. It runs with the definer's `
        + `privileges while the caller decides how unqualified names resolve. Add `
        + `\`SET search_path = public\` (or \`aml, public\`) to the function header.`);
    }

    // Named revoke, scoped to this function. Every role its FROM clauses name
    // is collected across all of them, because one migration may revoke in two
    // statements — and ALL THREE of PUBLIC, `anon` and `authenticated` have to
    // appear.
    //
    // Requiring all three is not belt-and-braces; each is load-bearing here and
    // each half was learned from a shipped defect:
    //
    //   • PUBLIC — `CREATE FUNCTION` grants EXECUTE to PUBLIC and every role
    //     inherits it, so a revoke naming only `anon` removes a grant it never
    //     had (RLS-W5, 20260725096000; the `revoke_without_public` rule below).
    //   • anon / authenticated — this project also carries DEFAULT PRIVILEGES
    //     granting EXECUTE on new functions in `public` directly to both, so a
    //     revoke naming only PUBLIC leaves those grants standing. Measured on
    //     the live catalogue 2026-09-16: `geocode_cache_touch` and
    //     `market_sales_refresh` each read
    //     `postgres=X | anon=X | authenticated=X | service_role=X` with no
    //     PUBLIC entry — the PUBLIC revoke had worked and the functions were
    //     still reachable by the publishable key. 20261129090000 closes them.
    //
    // A no-op revoke succeeds, so neither half reports anything on its own.
    // Read from the CORPUS, not from this file, for the reason
    // `revoke_without_public` already states: an applied migration is immutable
    // history and its text is a correct record of what ran. The question is not
    // "does this file close the function" but "does anything close it" — so a
    // follow-up migration clears the finding, which is how 20261129090000 clears
    // the two it was written for, and no frozen baseline is needed.
    const revokedFrom = rolesRevokedOn(name);
    const missingRoles = EXECUTE_ROLES.filter((r) => !revokedFrom.has(r));
    const namedRevoke = missingRoles.length === 0;

    // Catalogue sweep: a DO block that loops pg_proc on prosecdef and revokes
    // covers functions it never names. Accepted only when all three parts are
    // present, so "mentions PUBLIC somewhere" cannot pass — and the revoke it
    // performs has to close `anon` too, for the reason above.
    const catalogueSweep = /\bpg_proc\b/i.test(sql)
      && /\bprosecdef\b/i.test(sql)
      && /REVOKE\s+EXECUTE[^']*?FROM\s+PUBLIC/i.test(sql)
      && /REVOKE\s+EXECUTE[^']*?\banon\b/i.test(sql);

    if (!namedRevoke && !catalogueSweep) {
      at('secdef_execute', name,
        `\`${name}\` is SECURITY DEFINER and this migration `
        + (revokedFrom.size === 0
          ? 'no migration revokes EXECUTE on it. '
          : `is revoked from ${[...revokedFrom].join(', ')} but from nothing that closes `
            + `${missingRoles.join(', ')}. `)
        + `CREATE grants EXECUTE to PUBLIC and every role inherits it, AND this project's default `
        + `privileges grant EXECUTE on new functions in \`public\` directly to \`anon\` and `
        + `\`authenticated\` — so closing one and not the others leaves the function reachable by `
        + `the publishable key in the browser bundle, and the revoke that missed still succeeds. `
        + `Write \`REVOKE EXECUTE ON FUNCTION ${name}(...) FROM PUBLIC, anon, authenticated;\` and `
        + `grant back only the roles that need it. `
        + `If it must stay client-callable (an RLS predicate, say), add it to `
        + `MIGRATION_SECURITY_KEEPLIST.json with a reason.`);
    }
  }

  // ── A revoke naming `anon` but not `PUBLIC` removes a grant it never had ──
  for (const m of sql.matchAll(REVOKE_FN)) {
    const fn = qualify(m[1]);
    if (!/\b(?:anon|authenticated)\b/i.test(m[2])) continue;
    if (publicRevoked.has(fn)) continue;
    at('revoke_without_public', fn,
      `this revokes EXECUTE on \`${fn}\` from \`anon\`/\`authenticated\` and no migration in `
      + `the repository ever revokes it from \`PUBLIC\`. Postgres grants EXECUTE to PUBLIC on `
      + `CREATE and every role inherits it, so revoking a role individually removes a grant it `
      + `was never given and the function stays executable — the revoke succeeds and changes `
      + `nothing. Write \`REVOKE EXECUTE ON FUNCTION ${fn}(...) FROM PUBLIC, anon, authenticated;\`, `
      + `here or in a follow-up migration.`);
  }

  // ── Views ────────────────────────────────────────────────────────────────
  for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)([\s\S]{0,300}?)\bAS\b/gi)) {
    const name = qualify(m[1]);
    if (/MATERIALIZED/i.test(m[0])) continue; // materialized views take no security_invoker
    if (/security_invoker\s*=\s*(?:true|on)/i.test(m[2])) continue;
    const alteredLater = new RegExp(
      `ALTER\\s+VIEW\\s+[\\w".]*${name.split('.')[1]}\\b[\\s\\S]{0,120}?security_invoker\\s*=\\s*(?:true|on)`, 'i',
    ).test(sql);
    if (alteredLater) continue;
    at('view_security_invoker', name,
      `\`${name}\` is created without \`security_invoker = true\`, so it reads its base tables with `
      + `the owner's rights and their RLS never applies to whoever can select the view. Add `
      + `\`WITH (security_invoker = true)\`.`);
  }

  // ── Tables ───────────────────────────────────────────────────────────────
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w".]+)/gi)) {
    const name = qualify(m[1]);
    const [schema, bare] = name.split('.');
    if (!['public', 'aml'].includes(schema)) continue;
    const enabled = new RegExp(
      `ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?[\\w".]*\\b${bare}\\b[\\s\\S]{0,120}?ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i',
    ).test(sql) || dynamicallyRlsEnabled(sql).has(bare.toLowerCase());
    if (!enabled) {
      at('table_rls', name,
        `\`${name}\` is created without \`ENABLE ROW LEVEL SECURITY\` in the same migration. `
        + `PostgREST exposes it, so any role holding a table grant can read and write every row. `
        + `Enable RLS and add policies — or, if it is service-role-only (the dominant convention `
        + `here), enable RLS and add none, which denies every other role.`);
    }
  }
}

/**
 * Tables whose RLS is enabled by DYNAMIC DDL, which the literal scan cannot see.
 *
 * The idiomatic way to apply the same policy to a family of tables here is a
 * loop:
 *
 *     DO $$ DECLARE t text; BEGIN
 *       FOREACH t IN ARRAY ARRAY['a','b','c','d'] LOOP
 *         EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
 *         ...
 *       END LOOP;
 *     END $$;
 *
 * The literal regex below cannot read that, and it failed in the worst possible
 * way: it looks for the table name within 120 characters of
 * `ENABLE ROW LEVEL SECURITY`, so the two tables named EARLY in the array
 * matched — by accident, against the array literal rather than against any
 * statement — and the two named late did not. Half a file passing for a reason
 * unrelated to what it is checking is worse than the file failing.
 *
 * That is what `20260915000000_builder_stock_list_marketplace.sql` hit. It
 * enables RLS on all four of its tables, adds a service-role-only policy to
 * each, and revokes every grant from `anon` and `authenticated` — verified
 * against production, where all four carry `relrowsecurity = true`, one policy,
 * and no grant for either role. The gate reported two of them as unprotected
 * and turned the `security` job red for every branch.
 *
 * Deliberately narrow. Only a literal `ARRAY[...]` of quoted names inside a
 * block that dynamically enables RLS counts. A name built at runtime, read from
 * a catalog query, or passed in as a parameter is still unreadable, and the
 * table still has to be enabled literally — which is the right answer, because
 * a gate cannot verify what it cannot enumerate.
 */
function dynamicallyRlsEnabled(sql) {
  const enabled = new Set();
  for (const block of sql.match(/DO\s+\$\$[\s\S]*?\$\$/gi) ?? []) {
    if (!/EXECUTE\s+format\s*\([^)]*ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(block)) continue;
    for (const arr of block.match(/ARRAY\s*\[[^\]]*\]/gi) ?? []) {
      for (const [, name] of arr.matchAll(/'([A-Za-z_][\w$]*)'/g)) enabled.add(name.toLowerCase());
    }
  }
  return enabled;
}

// A stale exemption is the same failure wearing a note.
const today = new Date().toISOString().slice(0, 10);
for (const e of keeplist.exemptions ?? []) {
  if (e.review_by && e.review_by < today) {
    errors.push(
      `[keeplist] ${e.object}: exemption for \`${e.rule}\` passed its review_by (${e.review_by}). `
      + `Re-confirm the reason and move the date, or remove the entry.`);
  }
  if (!e.reason || e.reason.length < 20) {
    errors.push(`[keeplist] ${e.object}: exemption for \`${e.rule}\` has no usable reason.`);
  }
}

if (errors.length) {
  console.error('Migration security check FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\nChecked ${files.length} migration(s) at or after ${BASELINE}.`);
  process.exit(1);
}
console.log(
  `Migration security check passed (${files.length} migration(s) at or after ${BASELINE}; `
  + `${exempt.size} reviewed exemption(s)).`,
);
