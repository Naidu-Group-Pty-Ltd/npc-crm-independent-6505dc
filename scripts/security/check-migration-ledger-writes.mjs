#!/usr/bin/env node
/**
 * A migration never writes the migration ledger.
 *
 * ## Why this exists
 *
 * `supabase_migrations.schema_migrations` is the record every reader of "has
 * this file run here?" consults: the apply workflow's re-check, the drift
 * report's first filter, and Mission Control, which reads the prime's ledger
 * to decide what a clone may be sent and writes each clone's ledger as it
 * delivers. It is written by whatever APPLIES a migration, and by nothing else.
 *
 * `20260921100000_withdraw_builder_aml_partner_portal_changes.sql` broke that
 * rule for a good reason, and the rule is still right. It dropped objects that
 * five files had created that morning and then deleted those five versions'
 * ledger rows, so that the prime's record matched the prime's database. On the
 * prime that was true. But a migration runs wherever it is delivered, and on a
 * clone the same DELETE removes rows the clone's own deliveries wrote, for
 * files whose state there nobody had measured. After it, the five databases
 * disagreed about `finance_portal_documents` by delivery order rather than by
 * any decision (measured 23 Sep 2026: two clones carried the Quick Send
 * columns and two did not), and `20261219040000` exists to repair that.
 *
 * The remedy it reached for has a proper home now. A file whose effect is
 * deliberately absent is declared in `MIGRATION_WITHDRAWN.json`, which every
 * reader understands and no database has to be edited to express.
 *
 * ## What this checks
 *
 * Every migration, the whole corpus. A statement that inserts, updates,
 * deletes, truncates, merges into, copies into, alters or drops anything in
 * the `supabase_migrations` schema, including inside a string handed to
 * `EXECUTE`, fails the gate. Reads are allowed; a migration may ask the ledger
 * a question.
 *
 * It reads text, so it sees a write that is spelt out. A statement assembled
 * from parts at run time, such as a schema name passed through `format('%I')`,
 * is invisible to it, as it would be to any scan. That shape has never been
 * written here, and review is the guard against it.
 *
 * The one applied file that already does it is frozen below by name. An
 * applied migration's bytes cannot change (`applied-body-digests.txt`), so a
 * name here cannot come to cover anything new, and the freeze fails if the
 * named file stops writing the ledger or leaves the tree.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Resolve from the process cwd, NOT from `import.meta.url`. The negative-test
// harness (check-security-gate-negatives.mjs) runs each gate against a symlinked
// mirror of the tree with one file mutated; a gate that resolves relative to its
// own location reads the REAL repository instead and passes on mutated source.
const root = resolve(process.cwd());
const MIGRATIONS = join(root, 'supabase', 'migrations');

/** Applied before this gate existed; frozen as history, never extended. */
const FROZEN = new Map([
  [
    '20260921100000_withdraw_builder_aml_partner_portal_changes.sql',
    'Deleted five ledger rows on 21 Sep 2026. Applied, so its bytes are fixed; '
      + 'the declaration it stood in for is MIGRATION_WITHDRAWN.json.',
  ],
]);

/** Comments hold example SQL and prose. Strip them first; strings stay. */
function stripComments(sql) {
  return String(sql ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

const SCHEMA = String.raw`"?supabase_migrations"?`;
const WRITES = [
  new RegExp(String.raw`\binsert\s+into\s+${SCHEMA}\s*\.`, 'i'),
  new RegExp(String.raw`\bupdate\s+(?:only\s+)?${SCHEMA}\s*\.`, 'i'),
  new RegExp(String.raw`\bdelete\s+from\s+(?:only\s+)?${SCHEMA}\s*\.`, 'i'),
  new RegExp(String.raw`\btruncate\s+(?:table\s+)?(?:only\s+)?${SCHEMA}\s*\.`, 'i'),
  new RegExp(String.raw`\bmerge\s+into\s+${SCHEMA}\s*\.`, 'i'),
  new RegExp(String.raw`\bcopy\s+${SCHEMA}\s*\.`, 'i'),
  new RegExp(String.raw`\b(?:alter|drop)\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${SCHEMA}\s*\.`, 'i'),
  new RegExp(String.raw`\b(?:alter|drop)\s+schema\s+(?:if\s+exists\s+)?${SCHEMA}\b`, 'i'),
];

/** The first statement shape in `sql` that writes the ledger, or null. */
function ledgerWriteIn(sql) {
  const code = stripComments(sql);
  for (const re of WRITES) {
    const m = re.exec(code);
    if (m) return m[0].replace(/\s+/g, ' ').trim();
  }
  return null;
}

{
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  const errors = [];
  const writers = new Set();

  for (const file of files) {
    const hit = ledgerWriteIn(readFileSync(join(MIGRATIONS, file), 'utf8'));
    if (!hit) continue;
    writers.add(file);
    if (FROZEN.has(file)) continue;
    errors.push(
      `${file}: writes the migration ledger (\`${hit} …\`). The ledger is written by whatever `
      + 'applies a migration and by nothing else: a migration runs on every database it is '
      + 'delivered to, and there it edits rows it does not own. To declare a file\'s effect '
      + 'deliberately absent, add it to supabase/migrations/MIGRATION_WITHDRAWN.json instead.');
  }

  for (const file of FROZEN.keys()) {
    if (!files.includes(file)) {
      errors.push(`${file} is frozen here but is not in the tree. Remove the entry.`);
    } else if (!writers.has(file)) {
      errors.push(`${file} is frozen here but no longer writes the ledger. Remove the entry — `
        + 'a stale exemption is the same failure wearing a note.');
    }
  }

  if (errors.length) {
    console.error('Migration ledger check FAILED:\n');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`Migration ledger check passed (${files.length} migration(s); `
    + `${FROZEN.size} frozen as history, 0 new).`);
}
