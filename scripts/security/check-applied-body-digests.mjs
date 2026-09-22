#!/usr/bin/env node
// A migration this deployment has already RUN must not change in the repository.
//
// ## What "already run" means here, and why it is not the version
//
// `supabase_migrations.schema_migrations` records a VERSION and the SQL. In
// this project the two do not line up: measured 22 Sep 2026, 1,002 files in
// `supabase/migrations/` against 1,019 ledger rows, and only 176 versions in
// common. Lovable stamps the ledger with the moment it APPLIED a file, not the
// version in the filename, so the repo's `20250831091525` is the ledger's
// `…091523` — two seconds, byte-identical bodies, no version match.
//
// So this guard is keyed on the BYTES. The manifest records, for each file,
// a sha256 the ledger holds and which that file produced. **690 of 1,002
// files** are covered that way, against 83 that a version key could reach.
//
// ## Why editing one of these files is not a small thing
//
// Aurixa Mission Control decides what a clone may be sent by asking whether
// the prime's ledger holds the file's bytes. A file whose bytes the ledger no
// longer holds is withheld from every clone — and `partitionByDependency`
// treats a withheld version as a barrier, so one hole orphans everything
// behind it. Editing an applied migration does not change this database, which
// already ran what it ran; it removes the file from what any clone can be
// shown to have run.
//
// ## Why this check is offline
//
// The ledger lives in the Supabase project, which a pull request cannot reach
// without `SUPABASE_DB_URL` — a credential that reaches the whole database.
// Putting it into `ci.yml`, which runs on every pull request including forks,
// to power a read-only comparison would widen what a CI run can do far past
// what the check is worth. The digests travel as a committed manifest instead
// and this check is pure: no network, no credential.
//
// The manifest cannot become fiction unnoticed: `apply-migration.yml` already
// holds the credential and re-checks every recorded digest against the live
// ledger each time a migration is applied.
//
// ## The manifest is sticky, and that is the whole point
//
// `build-applied-body-digests.mjs` never DROPS an entry. If it did, an edit
// could be laundered by regenerating — the file stops matching, its line
// disappears, the check passes, and the guard has no teeth. An entry leaves
// only by hand, with the reason written into the baseline.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formIndexFor, bodyFormLabel } from "./appliedBodyIdentity.mjs";

const MIGRATIONS = "supabase/migrations";
const MANIFEST = "scripts/security/applied-body-digests.txt";
const BASELINE = "scripts/security/applied-body-digest-baseline.txt";

const stripComment = (l) => l.replace(/#.*$/, "").trim();

if (!existsSync(MANIFEST)) {
  console.error(
    `\n✗ ${MANIFEST} is missing.\n\n` +
      `  It records the SQL each applied migration actually ran, by digest.\n` +
      `  Regenerate it with \`npm run migrations:body-digests\`.\n`,
  );
  process.exit(1);
}

const entries = [];
const malformed = [];
for (const raw of readFileSync(MANIFEST, "utf8").split("\n")) {
  const line = stripComment(raw);
  if (!line) continue;
  const m = /^([0-9a-f]{64})\s+(\S.*)$/.exec(line);
  if (!m) {
    malformed.push(raw.trim());
    continue;
  }
  entries.push({ sha256: m[1], name: m[2].trim() });
}

// A line this cannot parse is a hard failure rather than a skip. A manifest
// that silently drops what it cannot read reports coverage it does not have,
// which is the shape of every guard in this repository that had to be fixed
// twice.
if (malformed.length > 0) {
  console.error(`\n✗ ${MANIFEST} has ${malformed.length} line(s) this cannot read:\n`);
  for (const l of malformed.slice(0, 10)) console.error(`  • ${l}`);
  console.error(`\n  Expected \`<64-hex sha256>  <filename>\`.`);
  console.error(`  It is generated — regenerate with \`npm run migrations:body-digests\`.\n`);
  process.exit(1);
}

const duplicates = entries
  .map((e) => e.name)
  .filter((n, i, all) => all.indexOf(n) !== i)
  .filter((n, i, all) => all.indexOf(n) === i);
if (duplicates.length > 0) {
  console.error(`\n✗ ${MANIFEST} names ${duplicates.length} file(s) more than once:\n`);
  for (const n of duplicates.slice(0, 10)) console.error(`  • ${n}`);
  console.error(`\n  One file, one recorded digest. Regenerate the manifest.\n`);
  process.exit(1);
}

const baseline = new Set();
if (existsSync(BASELINE)) {
  for (const raw of readFileSync(BASELINE, "utf8").split("\n")) {
    const v = stripComment(raw);
    if (v) baseline.add(v);
  }
}

const drifted = [];
const absent = [];
const staleBaseline = [];
// An exemption for a file the manifest does not record exempts nothing, and
// nothing else here would ever look at it. A dead entry in a frozen list is
// how the list stops meaning what its header says.
const unreachableBaseline = [...baseline].filter((n) => !entries.some((e) => e.name === n));
const rungs = [0, 0, 0];
let matched = 0;

for (const e of entries) {
  const path = join(MIGRATIONS, e.name);
  if (!existsSync(path)) {
    // A migration that RAN and whose file is gone. Not drift — the repository
    // no longer describes that schema change at all.
    absent.push(e);
    continue;
  }
  const rung = formIndexFor(readFileSync(path, "utf8"), e.sha256);
  if (rung >= 0) {
    matched += 1;
    if (rung < rungs.length) rungs[rung] += 1;
    // An exemption for a file that matches again is spent, and leaving it
    // would silently re-arm for the next edit of that same file.
    if (baseline.has(e.name)) staleBaseline.push(e);
  } else if (!baseline.has(e.name)) {
    drifted.push(e);
  }
}

let failed = false;

if (drifted.length > 0) {
  failed = true;
  console.error(`\n✗ ${drifted.length} migration(s) changed after they were applied:\n`);
  for (const d of drifted) {
    console.error(`  • ${MIGRATIONS}/${d.name}`);
    console.error(`      ran  ${d.sha256}`);
  }
  console.error(
    `\n  This database is unaffected — it already ran what it ran. What is lost is\n` +
      `  every clone's claim to have run it: Mission Control matches on these bytes,\n` +
      `  so the file is now withheld from the fleet, and so is everything the\n` +
      `  dependency order puts behind it.\n\n` +
      `  Put the file back to what ran, or carry the change in a NEW migration.\n` +
      `  Never rewrite the ledger, which is history.\n`,
  );
}

if (absent.length > 0) {
  failed = true;
  console.error(`\n✗ ${absent.length} migration(s) ran here but no longer exist in the repo:\n`);
  for (const a of absent) console.error(`  • ${MIGRATIONS}/${a.name}`);
  console.error(
    `\n  A deleted migration cannot be un-applied, and a clone that never ran it\n` +
      `  now has no way to. Restore the file; the record of what ran is not the\n` +
      `  repository's to discard.\n`,
  );
}

if (unreachableBaseline.length > 0) {
  failed = true;
  console.error(
    `\n✗ ${unreachableBaseline.length} baseline entr(y/ies) name a file the manifest does not record:\n`,
  );
  for (const n of unreachableBaseline) console.error(`  • ${n}`);
  console.error(
    `\n  An exemption for a file nothing judges exempts nothing. Remove them from\n` +
      `  ${BASELINE}.\n`,
  );
}

if (staleBaseline.length > 0) {
  failed = true;
  console.error(`\n✗ ${staleBaseline.length} baseline entr(y/ies) no longer needed:\n`);
  for (const s of staleBaseline) console.error(`  • ${s.name}  (matches again)`);
  console.error(
    `\n  Remove them from ${BASELINE}. An exemption left on a file that matches\n` +
      `  re-arms silently the next time that file is edited.\n`,
  );
}

if (failed) process.exit(1);

const exempt = entries.filter((e) => baseline.has(e.name)).length;
const rungNote = rungs
  .map((n, i) => (n > 0 ? `${n} ${bodyFormLabel(i)}` : null))
  .filter(Boolean)
  .join(", ");
console.log(
  `check:applied-body-digests — ${matched} of ${entries.length} applied migration(s) still ` +
    `carry the SQL that ran${exempt > 0 ? `, ${exempt} baselined` : ""}` +
    `${rungNote ? ` (${rungNote})` : ""}.`,
);
