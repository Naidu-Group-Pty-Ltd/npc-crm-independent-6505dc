#!/usr/bin/env node
/**
 * Generate `supabase/migration-seed-skeletons.json` — the executable skeleton
 * of every migration too large for Mission Control to read, pinned to the
 * exact bytes it describes.
 *
 * ## What it is for
 *
 * Mission Control decides what each clone may be sent from two facts per
 * migration — what it CREATES and what it REQUIRES — and from the migration
 * versions it NAMES. It reads those from the body, and it reads bodies only
 * under 256 KiB: the pass runs over the whole corpus on every fleet tick, and
 * the template-library seeds are ~40 MB each. So for every seed it knew
 * nothing, and the rule for a migration nobody could read is the safe one: it
 * may create anything. Measured 23 Sep 2026 on the four clones' real ledgers,
 * that held the v19 seed behind the five urban-centre versions the prime's
 * ledger does not record, and then held everything after the seed on all
 * three mirrors — the population projections, and every restatement written
 * to reach them — and on the CRM clone held the v15 seed and everything after
 * it.
 *
 * Almost none of a seed is SQL anybody needs to read for that. The rows are
 * data; the statements they are poured into are a few tens of kilobytes. This
 * publishes those statements — `scripts/lib/seedSkeleton.mjs`, which is Mission
 * Control's own reader ported — so Mission Control can take a seed's facts
 * from them. With them read, the same ledgers send 11, 13, 13 and 31 versions
 * where they sent 1, 3, 3 and 1, and no refresh ahead of its seed.
 *
 * ## Why a skeleton, and not the facts
 *
 * Mission Control reads the facts out of the skeleton with its own extractor.
 * Publishing the facts would make this repository's extractor the authority on
 * what Mission Control believes, and two extractors are how two answers come
 * to disagree; publishing the text leaves one reader deciding.
 *
 * ## Why it cannot be wrong about the wrong file
 *
 * Every entry carries the git blob id of the file it was read from, computed
 * here from the bytes. Mission Control uses an entry only where that id is the
 * one its own listing of the same commit reports for the file, so a seed that
 * changes without this being regenerated simply has no skeleton — it is read
 * as unread again, which is the behaviour it had before this existed. CI fails
 * when the committed file is stale; the pin is what makes a stale file harmless
 * where CI was not asked.
 *
 * A file over the threshold that is not the seed shape is listed under
 * `refused` with the reason, rather than left out, so what Mission Control
 * still cannot see is written down.
 *
 * Regenerate with `npm run migrations:seed-skeletons`;
 * `npm run migrations:seed-skeletons:check` fails when the committed file is
 * stale. Never hand-edit it.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readSeedShape, seedSkeleton } from "./lib/seedSkeleton.mjs";

const MIGRATIONS_DIR = "supabase/migrations";
const OUT = "supabase/migration-seed-skeletons.json";

/**
 * Mission Control's `MAX_DIGEST_BYTES` (`primeBodyDigests.server.ts`): the
 * largest body it reads for facts. Every file past it is described here. If the
 * two ever drift, a file between them is simply not narrowed — it keeps the
 * rule for a body nobody read, which is the behaviour it has without this.
 */
export const MIN_SKELETON_BYTES = 256 * 1024;

/** The id git gives these bytes: the one a tree listing reports for the file. */
export function gitBlobSha(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/** Every migration file past the threshold, its skeleton or why there is none. */
export async function buildSeedSkeletons(dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir)
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .sort();

  const skeletons = [];
  const refused = [];
  for (const file of files) {
    const path = `${dir}/${file}`;
    const bytes = readFileSync(join(dir, file));
    if (bytes.length <= MIN_SKELETON_BYTES) continue;
    const blob = gitBlobSha(bytes);
    try {
      const shape = await readSeedShape(createReadStream(join(dir, file), { encoding: "utf8" }));
      skeletons.push({
        path,
        blob,
        bytes: bytes.length,
        tuples: shape.tupleCount,
        skeleton: seedSkeleton(shape),
      });
    } catch (e) {
      refused.push({
        path,
        blob,
        bytes: bytes.length,
        why: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    // A version, so a reader can tell a manifest it understands from one it
    // does not — and refuse the second rather than half-read it.
    schema_version: 1,
    generated_by: "scripts/build-migration-seed-skeletons.mjs",
    min_bytes: MIN_SKELETON_BYTES,
    skeletons,
    refused,
  };
}

/**
 * Is this repository the one that PUBLISHES the skeletons, or one that CARRIES
 * them?
 *
 * The same question, and the same marker, as `indexIsCarriedNotAuthored` in
 * `build-migration-object-index.mjs`, for the same reason: Mission Control
 * reads the PRIME's copy, and a clone cannot hold the files this describes —
 * the seeds are past what a cascade carries in one file, so they are absent on
 * every clone while the copied manifest still names them. Asserted there it
 * could never pass. It FAILS CLOSED: an unset or unrecognised value asserts,
 * so a repository that authors its own backend is held to its own manifest.
 */
export function skeletonsAreCarriedNotAuthored(env = process.env) {
  return env.BACKEND_DEPLOYED_BY === "mission-control";
}

async function main() {
  const check = process.argv.includes("--check");
  const manifest = await buildSeedSkeletons();
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  const summary =
    `${manifest.skeletons.length} seed skeleton(s), ${manifest.refused.length} refused, ` +
    `of the migrations over ${MIN_SKELETON_BYTES / 1024} KiB`;

  if (check) {
    if (skeletonsAreCarriedNotAuthored()) {
      console.log(
        `${OUT} is carried here, not authored: Mission Control owns this ` +
          "repository's backend and reads the prime's copy, and the seeds it " +
          "describes are files no cascade can deliver, so its currency is not " +
          "this repository's to assert.",
      );
      return;
    }
    if (!existsSync(OUT)) {
      console.error(`${OUT} is missing. Run \`npm run migrations:seed-skeletons\`.`);
      process.exit(1);
    }
    if (readFileSync(OUT, "utf8") !== json) {
      console.error(
        `${OUT} is stale — a migration over ${MIN_SKELETON_BYTES / 1024} KiB has ` +
          "moved since it was generated.\n" +
          "Run `npm run migrations:seed-skeletons` and commit the result.",
      );
      process.exit(1);
    }
    console.log(`migration-seed-skeletons: current — ${summary}.`);
    return;
  }

  writeFileSync(OUT, json);
  console.log(`Wrote ${OUT} — ${summary}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
