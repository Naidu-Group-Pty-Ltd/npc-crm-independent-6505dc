#!/usr/bin/env node
/**
 * Creates placeholder Supabase Edge Function secrets for every credential the Integrations
 * page knows about, skipping any that already exist.
 *
 * This is deliberately a local script rather than something the app does: it needs a Supabase
 * *personal access token* with management rights, which does not belong in the project's own
 * secrets or in an edge function.
 *
 *   export SUPABASE_ACCESS_TOKEN=sbp_...            # https://supabase.com/dashboard/account/tokens
 *   export SUPABASE_PROJECT_REF=dduzbchuswwbefdunfct
 *
 *   node scripts/create-integration-secrets.mjs             # dry run — prints the plan, writes nothing
 *   node scripts/create-integration-secrets.mjs --apply     # actually create them
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────
 * READ BEFORE USING --apply
 *
 * An empty secret is a SET environment variable, not an absent one. Code written as
 *
 *     const url = Deno.env.get('SOME_URL') ?? DEFAULT_URL;
 *
 * currently falls back to DEFAULT_URL, but once SOME_URL exists as '' it resolves to ''
 * instead — `??` only catches null/undefined. Anything guarding on `if (!x)` or
 * `x?.trim()` is fine; anything using `??` or `||=` against a bare `Deno.env.get` is not.
 *
 * `check-integration-secrets` treats '' as missing, so the Integrations page's status badges
 * stay accurate either way. The risk is entirely in other functions' fallback logic.
 *
 * Run with --audit-fallbacks to list the `??` sites that would change meaning.
 * ─────────────────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERATED = resolve(root, 'supabase/functions/_shared/integrationSecrets.ts');
const FUNCTIONS_DIR = resolve(root, 'supabase/functions');

const API = 'https://api.supabase.com';

/** Supabase reserves this prefix for its own injected variables and rejects writes to it. */
const RESERVED_PREFIX = 'SUPABASE_';

function registrySecretNames() {
  const source = readFileSync(GENERATED, 'utf8');
  const body = source.slice(
    source.indexOf('ALLOWED_INTEGRATION_SECRETS'),
    source.indexOf('INTEGRATION_SECRET_MAP'),
  );
  const names = [...body.matchAll(/^ {2}'([A-Z0-9_]+)',$/gm)].map((m) => m[1]);
  if (names.length === 0) {
    throw new Error('No secret names found. Run: npm run integrations:secrets:generate');
  }
  return names;
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
  });
}

/**
 * Finds `Deno.env.get('X') ?? fallback` sites that an empty-string secret would silently change.
 *
 * `?? ''` is harmless — the variable resolves to '' either way. What matters is a fallback to a
 * real value: a default URL, a numeric cap, or a second env var. Those stop being reached the
 * moment the secret exists as '', which is the whole hazard of seeding empty secrets.
 *
 * `||` is never a risk here: '' is falsy, so the fallback still fires.
 */
function auditFallbacks(names) {
  const wanted = new Set(names);
  const hits = [];
  for (const file of walk(FUNCTIONS_DIR)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const match = line.match(/Deno\.env\.get\(\s*['"]([A-Z0-9_]+)['"]\s*\)\s*\?\?\s*(.+)$/);
      if (!match || !wanted.has(match[1])) return;
      const rest = match[2];
      // Only the token immediately after `??` is the fallback. Anything chained onto it —
      // `(… ?? "").replace(…)` — applies to the result and does not change the empty case.
      const benign = /^(''|"")/.test(rest);
      const fallback = benign ? "''" : rest.replace(/[;,\s]+$/, '');
      hits.push({
        file: relative(root, file),
        line: i + 1,
        secret: match[1],
        fallback,
        breaking: !benign,
        code: line.trim(),
      });
    });
  }
  return hits;
}

async function api(path, token, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${res.statusText}\n${await res.text()}`);
  }
  return res.json();
}

const apply = process.argv.includes('--apply');
const names = registrySecretNames();

const report = (hits) => {
  const breaking = hits.filter((h) => h.breaking);
  const benign = hits.filter((h) => !h.breaking);

  if (breaking.length === 0) {
    console.log("No fallback site would change meaning. Seeding these as '' is safe.");
  } else {
    console.log(`${breaking.length} site(s) BREAK if the secret exists as '':\n`);
    for (const h of breaking) {
      console.log(`  ${h.file}:${h.line}\n    ${h.secret} would resolve to '' instead of ${h.fallback}`);
      console.log(`    ${h.code}\n`);
    }
  }
  if (benign.length) {
    console.log(`(${benign.length} further site(s) fall back to '' and are unaffected.)`);
  }
  return breaking;
};

if (process.argv.includes('--audit-fallbacks')) {
  report(auditFallbacks(names));
  process.exit(0);
}

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
if (!token || !ref) {
  console.error('Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF. See the header of this file.');
  process.exit(1);
}

const existing = new Set((await api(`/v1/projects/${ref}/secrets`, token)).map((s) => s.name));

const reserved = names.filter((n) => n.startsWith(RESERVED_PREFIX));
const candidates = names.filter((n) => !n.startsWith(RESERVED_PREFIX));
const alreadySet = candidates.filter((n) => existing.has(n));
const missing = candidates.filter((n) => !existing.has(n));

console.log(`Registry:        ${names.length} secret names`);
console.log(`Already in ${ref}: ${alreadySet.length}`);
console.log(`To create:       ${missing.length}`);
if (reserved.length) {
  console.log(
    `Skipped (reserved '${RESERVED_PREFIX}' prefix): ${reserved.join(', ')}\n` +
      "  → Supabase injects these itself and rejects writes. This project reads the management\n" +
      '    token from SB_MANAGEMENT_ACCESS_TOKEN instead; set that one by hand if you need it.',
  );
}

if (missing.length === 0) {
  console.log('\nNothing to do.');
  process.exit(0);
}

// Secrets whose absence is load-bearing somewhere are held back by default: creating them
// empty would silently disable a fallback that production currently depends on.
const breaking = auditFallbacks(missing).filter((h) => h.breaking);
const unsafe = new Set(breaking.map((h) => h.secret));
const force = process.argv.includes('--force');
const safe = force ? missing : missing.filter((n) => !unsafe.has(n));

if (unsafe.size) {
  console.log(`\n⚠  ${unsafe.size} secret(s) have a load-bearing fallback:\n`);
  for (const h of breaking) {
    console.log(`  ${h.secret}  →  ${h.file}:${h.line} falls back to ${h.fallback}`);
  }
  console.log(
    force
      ? '\n  --force given: creating them anyway.'
      : '\n  Held back. Set these to a real value by hand, or pass --force to seed them empty.',
  );
}

if (safe.length === 0) {
  console.log('\nNothing left to create.');
  process.exit(0);
}

if (!apply) {
  console.log(`\nDry run. Would create ${safe.length}:\n${safe.map((n) => `  ${n}`).join('\n')}`);
  console.log('\nRe-run with --apply to create them.');
  process.exit(0);
}

await api(`/v1/projects/${ref}/secrets`, token, {
  method: 'POST',
  body: JSON.stringify(safe.map((name) => ({ name, value: '' }))),
});
console.log(`\nCreated ${safe.length} empty secret(s) in ${ref}.`);
