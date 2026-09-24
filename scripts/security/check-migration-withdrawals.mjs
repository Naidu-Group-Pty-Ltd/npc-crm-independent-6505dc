#!/usr/bin/env node
/**
 * A migration declared withdrawn must say exactly what stays absent, and why.
 *
 * ## Why this exists
 *
 * `supabase/migrations/MIGRATION_WITHDRAWN.json` lists files that stay in the
 * tree as history while their effect is deliberately absent from every
 * database. Three readers act on it, and each acts on it differently:
 *
 *   * `migration-drift` reports a listed file as WITHDRAWN instead of NOT
 *     APPLIED, and fails when an object the entry names as absent exists.
 *   * `apply-migration.yml` refuses to apply a listed file.
 *   * Mission Control reads the file from the prime, never sends a listed file
 *     to a clone, and never counts it as a hole that holds back later files.
 *
 * An entry is therefore a strong statement, and a careless one does damage in
 * all three places at once. An entry naming a file that does not exist hides
 * nothing and misleads the reader. An entry whose `absent` list is empty can
 * never be shown false, so drift would stop watching the file for good. And an
 * `absent` object the file does not create is a claim nothing can check, since
 * drift compares the database against what the FILE would make.
 *
 * ## What this checks
 *
 * Through `scripts/ops/migrationWithdrawals.pure.mjs`, the same module the
 * drift report reads, so the gate and the report cannot hold two standards:
 *
 *   * the manifest parses, at a schema version this reader knows;
 *   * every entry names an existing versioned migration, once, in file order;
 *   * `absent` is non-empty, and every object in it is one the file creates,
 *     in the drift report's own spelling (comment-free SQL through
 *     `objectsCreatedIn`);
 *   * `decided` is a date and `reason` is a sentence;
 *   * a named `withdrawn_by` / `superseded_by` exists and runs later.
 *
 * It does not check the database. Whether the declared objects really are
 * absent is `migration-drift`'s question, asked on every run against the
 * catalogue itself.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { objectsCreatedIn } from '../build-migration-object-index.mjs';
import { sqlWithoutComments, withoutUnnameableCreates } from '../ops/migration-drift.mjs';
import { parseWithdrawals, validateWithdrawals } from '../ops/migrationWithdrawals.pure.mjs';

// Resolve from the process cwd, NOT from `import.meta.url`. The negative-test
// harness (check-security-gate-negatives.mjs) runs each gate against a symlinked
// mirror of the tree with one file mutated; a gate that resolves relative to its
// own location reads the REAL repository instead and passes on mutated source.
const root = resolve(process.cwd());
const MIGRATIONS = join(root, 'supabase', 'migrations');
const MANIFEST = join(MIGRATIONS, 'MIGRATION_WITHDRAWN.json');

const VERSIONED = /^\d{14}_.+\.sql$/;

let text;
try {
  text = readFileSync(MANIFEST, 'utf8');
} catch (e) {
  console.error(`Migration withdrawal check FAILED: cannot read ${MANIFEST}: ${e.message}`);
  process.exit(1);
}

const { entries, errors: parseErrors } = parseWithdrawals(text);
if (parseErrors.length) {
  console.error('Migration withdrawal check FAILED:\n');
  for (const e of parseErrors) console.error(`  - MIGRATION_WITHDRAWN.json: ${e}`);
  process.exit(1);
}

const files = new Set(readdirSync(MIGRATIONS).filter((n) => VERSIONED.test(n)));

/** The objects a file creates, spelt exactly as the drift report spells them. */
function objectsOf(file) {
  const src = readFileSync(join(MIGRATIONS, file), 'utf8');
  return objectsCreatedIn(withoutUnnameableCreates(sqlWithoutComments(src)));
}

const errors = validateWithdrawals(entries, { files, objectsOf });

if (errors.length) {
  console.error('Migration withdrawal check FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\nChecked ${entries.length} withdrawal(s) against ${files.size} migration file(s).`);
  process.exit(1);
}

console.log(`Migration withdrawal check passed: ${entries.length} withdrawal(s), each naming what stays absent.`);
