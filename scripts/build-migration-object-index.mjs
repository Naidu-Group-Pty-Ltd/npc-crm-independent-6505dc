#!/usr/bin/env node
/**
 * Generate `supabase/migration-object-index.json` — every database object this
 * repository's migrations have ever CREATED, and every one they have DROPPED.
 *
 * ## What it is for
 *
 * A workspace provisioned from this repository is brought up by catalog
 * introspection, which creates and never drops. So an object this repository
 * DELETES survives on every existing tenant for ever, and every parity stage
 * reconciles on `clone >= prime` — containment, not equality — and reads that
 * as matching. Measured on one tenant, 3 Sep 2026: `public.builder_design_images`,
 * present there and in no schema of this project, against a tables stage
 * reporting reconciled.
 *
 * Naming that drift was the easy half. The hard half was that nobody could act
 * on it: a surplus object is either **this repository's leftover** or **the
 * tenant's own**, dropping the first is tidying and dropping the second
 * destroys their data, and the tenant's live schema cannot tell you which —
 * both are simply "a table that is here and not there".
 *
 * This repository's own history can. If these migrations created an object,
 * it was ours; if they never mention it, it never was. That is the same rule
 * the file cascade already applies — a path is removed only where this
 * repository's history shows it deleted — expressed for the database.
 *
 * ## What it is NOT
 *
 * It is not permission to drop anything, and nothing downstream drops on it.
 * It converts one unanswerable question ("537 tables against 536 — decide")
 * into a list of named objects each carrying the evidence for what it is.
 *
 * ## Reading the output
 *
 * `created` and `dropped` are `"<class>:<qualified name>"`, lowercased, quotes
 * stripped. A name is recorded from the statement's text alone — no SQL is
 * executed and no schema is consulted — so the index is a claim about this
 * repository's history and nothing else.
 *
 * Two deliberate imprecisions, both erring the same way:
 *
 *   * An unqualified name (`create table foo`) is stored unqualified. A
 *     consumer matches on the bare name as well as the qualified one, because
 *     the alternative is assuming `public` and being wrong about a schema.
 *   * A name that appears only in a comment or a string still counts as
 *     created. That pushes an object toward "ours", which is the side that
 *     gets REVIEWED rather than the side that gets dropped.
 *
 * Regenerate with `npm run migrations:index`; `npm run migrations:index:check`
 * fails when the committed file is stale. Never hand-edit it.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const OUT = "supabase/migration-object-index.json";

/** Object classes worth tracking — the ones parity reports a surplus for. */
const CLASSES = "table|view|function|index|trigger|sequence|type|schema|materialized view";

const CREATE_RE = new RegExp(
  String.raw`\bcreate\s+(?:or\s+replace\s+)?(?:unique\s+)?(?:materialized\s+)?(${CLASSES})\s+` +
    String.raw`(?:if\s+not\s+exists\s+)?((?:"[^"]+"|[A-Za-z0-9_$]+)(?:\.(?:"[^"]+"|[A-Za-z0-9_$]+))*)`,
  "gi",
);

const DROP_RE = new RegExp(
  String.raw`\bdrop\s+(?:materialized\s+)?(${CLASSES})\s+` +
    String.raw`(?:if\s+exists\s+)?((?:"[^"]+"|[A-Za-z0-9_$]+)(?:\.(?:"[^"]+"|[A-Za-z0-9_$]+))*)`,
  "gi",
);

const normalise = (cls, name) =>
  `${cls.toLowerCase().replace(/\s+/g, "_")}:${name.replace(/"/g, "").toLowerCase()}`;

export function buildIndex(dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const created = new Set();
  const dropped = new Set();

  for (const file of files) {
    const src = readFileSync(join(dir, file), "utf8");
    for (const m of src.matchAll(CREATE_RE)) created.add(normalise(m[1], m[2]));
    for (const m of src.matchAll(DROP_RE)) dropped.add(normalise(m[1], m[2]));
  }

  return {
    // A version, so a consumer that gains a class can tell an old index from a
    // complete one rather than reading absence as "never ours" — which is the
    // reading that would let a real leftover pass as the tenant's.
    schema_version: 1,
    migration_files: files.length,
    created: [...created].sort(),
    dropped: [...dropped].sort(),
  };
}

/**
 * Is this repository the one that PUBLISHES the index, or one that CARRIES it?
 *
 * Mission Control reads exactly one index — the prime's
 * (`fetchMigrationObjectIndex` resolves the prime source and never a clone's)
 * — so currency is a claim the publishing repository makes and the only place
 * it protects anything. A clone receives the file because the cascade mirrors
 * the whole tree, and it CANNOT hold the migration set the file counts: the
 * v13 and v14 template-library seeds are 39.7 MB each, over the 8 MB a cascade
 * will carry in one file, so they are permanently absent on every clone while
 * the copied index still counts them. A clone that lands a migration of its
 * own diverges the other way at the same time.
 *
 * So the assertion could never pass there, and it failed every cascade pull
 * request on all three clones at once — a fleet-wide delivery stop, on a file
 * nothing on that side reads. It stands down where Mission Control owns the
 * backend, which is the same marker `deploy-supabase-functions.yml` stands
 * down on, and it FAILS CLOSED: an unset or unrecognised value asserts, so a
 * repository that claims to author its own backend is held to its own index.
 */
export function indexIsCarriedNotAuthored(env = process.env) {
  return env.BACKEND_DEPLOYED_BY === "mission-control";
}

function main() {
  const check = process.argv.includes("--check");
  const index = buildIndex();
  const json = `${JSON.stringify(index, null, 2)}\n`;

  if (check) {
    if (indexIsCarriedNotAuthored()) {
      console.log(
        `${OUT} is carried here, not authored: Mission Control owns this ` +
          "repository's backend, and the index it holds is the prime's. " +
          "Nothing reads this copy and the migrations it counts include files " +
          "no cascade can deliver, so its currency is not this repository's " +
          "to assert.",
      );
      return;
    }
    if (!existsSync(OUT)) {
      console.error(`${OUT} is missing. Run \`npm run migrations:index\`.`);
      process.exit(1);
    }
    if (readFileSync(OUT, "utf8") !== json) {
      console.error(
        `${OUT} is stale — the migrations have moved since it was generated.\n` +
          "Run `npm run migrations:index` and commit the result.",
      );
      process.exit(1);
    }
    console.log(
      `migration-object-index: current — ${index.migration_files} migrations, ` +
        `${index.created.length} objects created, ${index.dropped.length} dropped.`,
    );
    return;
  }

  writeFileSync(OUT, json);
  console.log(
    `Wrote ${OUT} — ${index.migration_files} migrations, ` +
      `${index.created.length} objects created, ${index.dropped.length} dropped.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
