#!/usr/bin/env node
/**
 * A migration version must name exactly one file.
 *
 * ## Why this exists
 *
 * `supabase_migrations.schema_migrations` has `version` as its PRIMARY KEY. Two
 * files that share a 14-digit prefix therefore compete for one row: whichever is
 * recorded first wins the `name` column, and the other becomes invisible to
 * everything that reads the ledger to answer "has this been applied?".
 *
 * That is not hypothetical. Measured 2026-09-06 on the prime:
 *
 *     20261112000000_seed_template_library_v12_guarded_verdict_line.sql
 *     20261112000000_client_deals_agent_fee_receipt.sql
 *
 * The catalogue seed was applied and recorded. The second file had never run —
 * `client_deals.commission_received` and `commission_received_date` did not
 * exist — and its own header records that two consecutive audits had already
 * reported "there is currently no agent fee/commission tracking". Nothing was
 * broken enough to notice: the ledger said the version was applied, because for
 * one of its two files it was.
 *
 * The fleet makes it worse rather than better. Mission Control's migration lane
 * decides what a clone still owes BY VERSION, so a collision marks every file in
 * the group applied on every clone the moment one of them lands.
 *
 * ## What this checks
 *
 * Every `supabase/migrations/*.sql` must start with a 14-digit version and an
 * underscore, no two may share that version, and that version must be a real
 * INSTANT — except for the groups and files already frozen in
 * MIGRATION_VERSION_COLLISIONS.json.
 *
 * The baseline is an inventory, not an exemption: it fails when a listed group's
 * file set CHANGES (a third file joining an existing collision is new debt), and
 * it fails when a listed group no longer collides, because a stale entry is the
 * same failure wearing a note. Shrinking that file to nothing is the goal.
 *
 * Renaming an existing colliding file is safe only when nothing has recorded it
 * under its own version — which, for every group in there, is exactly the
 * situation, since the version was already taken. It is still a fleet-wide file
 * move, so it is a deliberate act rather than something this gate demands.
 *
 * ## And the version has to be a time
 *
 * Fourteen digits is a shape, not an instant. Measured 2026-09-22, ten files
 * here carry a version no calendar can hold: `20260725096000` is minute 96 of
 * an hour, and `20260730240000` through `…300000` are hours 24 to 30.
 *
 * Postgres does not care — `version` is `text` — so nothing breaks, and that is
 * the problem: every reading that treats the version as a time answers `null`
 * about these and can say nothing at all. Mission Control's
 * `migrationEpochSeconds` is one, and it is deliberately null rather than a
 * guess, because an unparsed id defaulting to 0 would sit fourteen hundred
 * years from every ledger entry.
 *
 * The ten are frozen rather than renamed. Renaming them is a fleet-wide file
 * move that would also touch seven CI check scripts, seven test files, a
 * security keeplist, an order list, five documents and two APPLIED migrations
 * that name one of them in a comment — and an applied migration's bytes are
 * not something to edit for a comment. This gate stops the eleventh, which is
 * the part that compounds.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Resolve from the process cwd, NOT from `import.meta.url`. The negative-test
// harness (check-security-gate-negatives.mjs) runs each gate against a symlinked
// mirror of the tree with one file mutated; a gate that resolves relative to its
// own location reads the REAL repository instead and passes on mutated source.
const root = resolve(process.cwd());
const MIGRATIONS = join(root, 'supabase', 'migrations');
const BASELINE = join(MIGRATIONS, 'MIGRATION_VERSION_COLLISIONS.json');

const VERSIONED = /^(\d{14})_.+\.sql$/;

/**
 * Is a 14-digit version a moment that exists?
 *
 * Deliberately calendar-exact rather than range-checked on each field: 31
 * February is four valid fields and not a day, and a version that round-trips
 * through `Date.UTC` is one every reader can place on a line.
 */
function isInstant(version) {
  const [y, mo, d, h, mi, s] = [0, 4, 6, 8, 10, 12].map((i, n) =>
    Number(version.slice(i, [4, 6, 8, 10, 12, 14][n])));
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return false;
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Which field is impossible, so the message names the fault rather than the rule. */
function describeNonInstant(version) {
  const mo = Number(version.slice(4, 6));
  const d = Number(version.slice(6, 8));
  const h = Number(version.slice(8, 10));
  const mi = Number(version.slice(10, 12));
  const s = Number(version.slice(12, 14));
  if (mo < 1 || mo > 12) return `month ${mo}`;
  if (h > 23) return `hour ${h}`;
  if (mi > 59) return `minute ${mi}`;
  if (s > 59) return `second ${s}`;
  return `${version.slice(0, 4)}-${version.slice(4, 6)} has no day ${d}`;
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch (e) {
  console.error(`Migration version check FAILED: cannot read ${BASELINE}: ${e.message}`);
  process.exit(1);
}

const notAMigration = new Set(baseline.not_a_migration ?? []);
/** Versions that are 14 digits but not an instant, frozen as they stand. */
const notAnInstant = new Set(baseline.not_an_instant ?? []);
/** version -> sorted file list, as the baseline froze it. */
const frozen = new Map(
  (baseline.collisions ?? []).map((c) => [c.version, [...(c.files ?? [])].sort()]),
);

const files = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort();

const errors = [];
const byVersion = new Map();

for (const name of files) {
  const m = VERSIONED.exec(name);
  if (!m) {
    // A file with no version is either a deliberate non-migration (a template)
    // or a real migration whose prefix is mistyped — and the second one is
    // silent, because the CLI simply does not see it.
    if (!notAMigration.has(name)) {
      errors.push(
        `${name}: does not start with a 14-digit version and an underscore, and is not `
        + `listed in "not_a_migration". A file the migration runner cannot see is not a migration.`);
    }
    continue;
  }
  const version = m[1];
  if (!isInstant(version) && !notAnInstant.has(version)) {
    errors.push(
      `${name}: ${version} is fourteen digits but not a real instant `
      + `(${describeNonInstant(version)}). Postgres stores the version as text, so nothing `
      + `refuses it — and every reading that treats it as a time then answers "unknown" about `
      + `this file for ever. Use an instant that keeps the file's place in the sort.`);
  }
  if (!byVersion.has(version)) byVersion.set(version, []);
  byVersion.get(version).push(name);
}

for (const version of notAnInstant) {
  if (!byVersion.has(version)) {
    errors.push(
      `${version} is frozen in "not_an_instant" but no file carries it. Remove the entry — `
      + `a stale exemption is the same failure wearing a note.`);
  }
}

const live = new Map(
  [...byVersion.entries()].filter(([, group]) => group.length > 1).map(([v, g]) => [v, g.sort()]),
);

for (const [version, group] of live) {
  const known = frozen.get(version);
  if (!known) {
    errors.push(
      `${version} is carried by ${group.length} files and is not in the baseline:\n`
      + group.map((f) => `        ${f}`).join('\n')
      + `\n      One version records one ledger row, so the others can never be told apart from `
      + `applied. Give each file its own version.`);
    continue;
  }
  const added = group.filter((f) => !known.includes(f));
  const removed = known.filter((f) => !group.includes(f));
  if (added.length || removed.length) {
    errors.push(
      `${version}: the frozen collision has changed`
      + (added.length ? `\n      added:   ${added.join(', ')}` : '')
      + (removed.length ? `\n      removed: ${removed.join(', ')}` : '')
      + `\n      Joining an existing collision is new debt of exactly the same kind. `
      + `Give the new file its own version; update the baseline only when one leaves.`);
  }
}

for (const version of frozen.keys()) {
  if (!live.has(version)) {
    errors.push(
      `${version} is in the baseline but no longer collides. Remove the entry — `
      + `a stale exemption is the same failure wearing a note.`);
  }
}

if (errors.length) {
  console.error('Migration version check FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\nChecked ${files.length} migration file(s).`);
  process.exit(1);
}

const grandfathered = [...live.values()].reduce((n, g) => n + g.length, 0);
console.log(
  `Migration version check passed (${files.length} file(s); `
  + `${live.size} frozen collision(s) over ${grandfathered} files, 0 new; `
  + `${notAnInstant.size} frozen non-instant version(s), 0 new).`,
);
