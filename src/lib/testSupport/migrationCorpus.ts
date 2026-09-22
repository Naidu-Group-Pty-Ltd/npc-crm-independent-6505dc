/**
 * The migration directory, read once per process and never decoded whole.
 *
 * ## The finding
 *
 * `supabase/migrations` is **620 MB**, and 24 spec files walk it. Fourteen of
 * those megabytes are hand-written schema; the rest is the generated template
 * library — five seed releases at ~41.7 MB each, plus their siblings — and a
 * generated artefact is exactly the kind of file every one of those scans
 * wants to skip and none of them could.
 *
 * `rbaTableCodes.spec.ts` is what surfaced it. It reads every `.sql` into a
 * JavaScript string looking for one CHECK constraint, and it called that scan
 * once per test: three passes, ~1.9 GB of UTF-8 decoding, 10.9 seconds alone
 * and a TIMEOUT under the parallel suite. It passed in isolation and failed in
 * the suite, which is the shape that gets a test quarantined rather than
 * understood.
 *
 * ## Two rules
 *
 * **The gate is on BYTES, never on a filename.** Reading the file as a Buffer
 * and asking `Buffer.includes` is a byte scan with no decode, so a 41.7 MB
 * seed costs a memchr rather than a string allocation. The alternative —
 * skipping files whose NAME looks generated — is a rule about naming
 * conventions masquerading as a rule about content, and the first migration
 * that breaks the convention silently leaves the corpus.
 *
 * **Every file is still offered.** Nothing here filters the corpus: a caller
 * that asks for all of them gets all of them, decoded lazily. What changes is
 * that a caller looking for one identifier pays for the files that contain it
 * and not for the files that do not.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations');

let namesCache: string[] | null = null;
const bufferCache = new Map<string, Buffer>();
const textCache = new Map<string, string>();

/** Every `.sql` migration, in apply order. */
export function migrationNames(): string[] {
  if (namesCache === null) {
    namesCache = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  }
  return namesCache;
}

function bufferOf(name: string): Buffer {
  let buf = bufferCache.get(name);
  if (!buf) {
    buf = readFileSync(resolve(MIGRATIONS_DIR, name));
    bufferCache.set(name, buf);
  }
  return buf;
}

/** One migration's SQL. Decoded at most once per process. */
export function migrationText(name: string): string {
  let text = textCache.get(name);
  if (text === undefined) {
    text = bufferOf(name).toString('utf-8');
    textCache.set(name, text);
  }
  return text;
}

/**
 * The migrations whose bytes satisfy every one of `needles`, in apply order.
 *
 * A needle is a literal, or an ARRAY of literals meaning "any of these" —
 * which is what makes the gate safe in front of a case-insensitive regex. A
 * byte scan cannot be case-folded without decoding, so a caller whose own
 * match is `/i` passes the casings SQL is actually written in rather than one
 * of them; a gate narrower than the match it guards silently drops rows, and
 * a dropped row here is a defect this suite then reports as absent.
 *
 * Nothing is filtered by FILENAME. A rule about naming conventions dressed as
 * a rule about content is how the first migration that breaks the convention
 * leaves the corpus without anything saying so.
 *
 * **Gate on the phrase, never on a word.** Measured over all 1,014
 * migrations: `POLICY` selects 425 files and 590 MB, because the word occurs
 * in the generated template library's seeded prose; `CREATE POLICY` selects
 * 371 and 2 MB, and misses none of the 344 the caller's regex matches. On a
 * corpus that is 95% generated content, a single common word is no gate.
 */
export function migrationsContaining(...needles: Array<string | string[]>): string[] {
  return migrationNames().filter((name) => {
    const buf = bufferOf(name);
    return needles.every((needle) => (Array.isArray(needle) ? needle : [needle])
      .some((literal) => buf.includes(literal)));
  });
}

/** For a suite that genuinely needs the whole corpus decoded. */
export function allMigrations(): Array<{ name: string; sql: string }> {
  return migrationNames().map((name) => ({ name, sql: migrationText(name) }));
}
