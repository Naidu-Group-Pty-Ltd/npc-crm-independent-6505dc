#!/usr/bin/env node
// Write `applied-body-digests.txt` from the ledger this deployment actually has.
//
//   node scripts/security/build-applied-body-digests.mjs            # read the ledger over psql
//   node scripts/security/build-applied-body-digests.mjs --digests f  # …or from a file of sha256 lines
//   node scripts/security/build-applied-body-digests.mjs --verify      # do not write; check the manifest
//
// `--digests` exists because the ledger is reachable from more than one place —
// `SUPABASE_DB_URL` here, Mission Control's Management API elsewhere — and the
// merge must not care which produced the digests. The manifest header records
// the route that wrote it.
//
// ## It never drops an entry
//
// The one rule that gives the guard teeth. If a recorded file stops matching,
// its line STAYS and `check-applied-body-digests.mjs` fails. Dropping it would
// let an edit be laundered by regenerating: file stops matching, line vanishes,
// check passes, nothing was guarded. An entry leaves only by hand, with the
// reason written into the baseline.
//
// ## What it does not cover, and says so
//
// Files past `MAX_DIGEST_BYTES` are not digested. Mission Control applies the
// same ceiling when it reads bodies for the cascade, so a file this skips is a
// file the cascade clears by version or not at all. Measured on this corpus:
// 16 files, all of them successive generations of the seeded template
// catalogue, and every one already version-matched.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMPTY_BODY_SHA256,
  LEDGER_BODY_DIGEST_SQL,
  bodyDigests,
  bodyFormLabel,
} from "./appliedBodyIdentity.mjs";

const MIGRATIONS = "supabase/migrations";
const MANIFEST = "scripts/security/applied-body-digests.txt";

/**
 * Bodies past this are not digested. 256 KB rather than the 8 MB a single
 * apply permits: this walks the whole corpus at once, and an accidental
 * 8 MB × 900 would be a different program.
 */
const MAX_DIGEST_BYTES = 256 * 1024;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const LEDGER_QUERY =
  `select distinct ${LEDGER_BODY_DIGEST_SQL} from supabase_migrations.schema_migrations ` +
  `where statements is not null and array_length(statements, 1) > 0`;

function readLedgerDigests() {
  const file = value("--digests");
  if (file) {
    // The PATH is deliberately not recorded: it is where one operator happened
    // to put a scratch file, and a manifest header that names it reads as
    // provenance while carrying none.
    return { route: "--digests: a ledger read taken elsewhere", digests: parseDigests(readFileSync(file, "utf8")) };
  }
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error(
      `\n✗ No route to the ledger.\n\n` +
        `  Set SUPABASE_DB_URL to this deployment's own database, or pass\n` +
        `  \`--digests <file>\` holding one sha256 per line read from\n` +
        `  supabase_migrations.schema_migrations elsewhere.\n`,
    );
    process.exit(1);
  }
  const out = execFileSync("psql", [url, "-At", "-c", LEDGER_QUERY], { encoding: "utf8" });
  return { route: "psql $SUPABASE_DB_URL", digests: parseDigests(out) };
}

function parseDigests(text) {
  const set = new Set();
  for (const raw of text.split("\n")) {
    const line = raw.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(line)) continue;
    // An empty body is never evidence that anything ran: a ledger row with no
    // SQL and a repo file that is nothing but comments hash to the same thing.
    if (line === EMPTY_BODY_SHA256) continue;
    set.add(line);
  }
  return set;
}

function readManifest() {
  const recorded = new Map();
  if (!existsSync(MANIFEST)) return recorded;
  for (const raw of readFileSync(MANIFEST, "utf8").split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([0-9a-f]{64})\s+(\S.*)$/.exec(line);
    if (m) recorded.set(m[2].trim(), m[1]);
  }
  return recorded;
}

const { route, digests } = readLedgerDigests();
if (digests.size === 0) {
  // A read that FAILED is not a ledger that is EMPTY. Writing a manifest from
  // nothing would delete every entry's evidence in one commit.
  console.error(
    `\n✗ The ledger returned no bodies.\n\n` +
      `  That is either an empty database or a read that did not work, and this\n` +
      `  cannot tell them apart — so it writes nothing.\n`,
  );
  process.exit(1);
}

const recorded = readManifest();
const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const fresh = new Map();
const rungOf = new Map();
const oversize = [];
for (const name of files) {
  const path = join(MIGRATIONS, name);
  if (statSync(path).size > MAX_DIGEST_BYTES) {
    oversize.push(name);
    continue;
  }
  const forms = bodyDigests(readFileSync(path, "utf8"));
  const i = forms.findIndex((d) => digests.has(d));
  if (i >= 0) {
    fresh.set(name, forms[i]);
    rungOf.set(name, i);
  }
}

// Kept: recorded, and either still matching or drifted. Never dropped.
const kept = new Map(recorded);
const added = [];
for (const [name, digest] of fresh) {
  if (!kept.has(name)) {
    kept.set(name, digest);
    added.push(name);
  }
}
const drifted = [...kept.keys()].filter((n) => !fresh.has(n));
const gone = drifted.filter((n) => !existsSync(join(MIGRATIONS, n)));

if (flag("--verify")) {
  // The manifest must never claim a digest the ledger does not hold. This is
  // the half a pull request cannot check, because it needs the database.
  const unbacked = [...kept.entries()].filter(([, d]) => !digests.has(d));
  if (unbacked.length > 0) {
    console.error(`\n✗ ${unbacked.length} manifest entr(y/ies) name SQL this ledger never ran:\n`);
    for (const [n, d] of unbacked.slice(0, 20)) console.error(`  • ${n}\n      ${d}`);
    console.error(
      `\n  The manifest is generated; a line the ledger cannot back was written by\n` +
        `  hand. Regenerate it with \`npm run migrations:body-digests\`.\n`,
    );
    process.exit(1);
  }
  console.log(
    `applied-body-digests --verify — all ${kept.size} recorded digest(s) are in this ledger ` +
      `(${digests.size} bodies), read over ${route}.`,
  );
  if (added.length > 0) {
    console.log(
      `  ${added.length} file(s) now match and are not recorded yet — ` +
        `run \`npm run migrations:body-digests\` to add them.`,
    );
  }
  process.exit(0);
}

const rungs = [0, 0, 0];
for (const name of kept.keys()) {
  const r = rungOf.get(name);
  if (r !== undefined && r < rungs.length) rungs[r] += 1;
}

const lines = [...kept.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const header = [
  "# What this deployment's database actually RAN, by digest.",
  "#",
  "# GENERATED — do not edit by hand. Refresh with:",
  "#     npm run migrations:body-digests",
  `# which reads \`supabase_migrations.schema_migrations\` — ${route} — and matches`,
  "# each body against the repository file that produced it.",
  "#",
  "# Each line says: this deployment ran a body whose sha256 is <digest>, and",
  "# <file> produced that digest. Editing such a file does not change this",
  "# database — it already ran what it ran. It removes the file from what any",
  "# clone can be shown to have run, which withholds it from the whole fleet.",
  "#",
  "# Entries are never removed by the generator. A file that stops matching",
  "# keeps its line and fails `npm run check:applied-body-digests`, because a",
  "# guard you can clear by regenerating is not a guard.",
  "#",
  "# Format: <64-hex sha256>  <filename>",
  "#",
  `# ${lines.length} file(s) recorded of ${files.length} in the corpus; ` +
    `${digests.size} distinct bodies in the ledger.`,
  `# Matched ${rungs.map((n, i) => `${n} ${bodyFormLabel(i)}`).join(", ")}.`,
  `# ${oversize.length} file(s) past ${MAX_DIGEST_BYTES} bytes were not digested.`,
  "",
];
writeFileSync(MANIFEST, header.join("\n") + lines.map(([n, d]) => `${d}  ${n}`).join("\n") + "\n");

console.log(`Wrote ${MANIFEST}: ${lines.length} entr(ies).`);
console.log(`  ledger bodies        : ${digests.size}   (read over ${route})`);
console.log(`  newly recorded       : ${added.length}`);
console.log(`  recorded but drifted : ${drifted.length}${gone.length ? ` (${gone.length} file(s) gone)` : ""}`);
for (const n of drifted.slice(0, 20)) console.log(`      • ${n}`);
console.log(`  not digested (size)  : ${oversize.length}`);
if (drifted.length > 0) {
  console.log(
    `\n  Those lines were kept. \`npm run check:applied-body-digests\` will fail\n` +
      `  until each file is put back to what ran, or the reason is written into\n` +
      `  scripts/security/applied-body-digest-baseline.txt.`,
  );
}
