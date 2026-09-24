/**
 * What "Apply a migration" checks before it runs anything.
 *
 * The workflow applies the files a person names, in the order named, and does
 * not decide which files to apply. Until this check it accepted anything the
 * checkout held, as long as the file existed: a path outside
 * `supabase/migrations/`, a version already in the ledger, a file whose
 * version another file shares, or a file `MIGRATION_WITHDRAWN.json` declares
 * withdrawn. What that cost, measured:
 *
 * - Twelve dispatches (#78 to #91) ran from a feature branch. That branch
 *   recorded three versions no commit on `main` carries, and a later migration
 *   had to delete those rows.
 * - Run #78 applied `20260724000000_prevent_duplicate_portfolio_publications`,
 *   whose version another file shares. It failed 23505, and the file is now
 *   declared withdrawn.
 * - On 22 Sep 2026 a file withdrawn the day before (20260719000000) was
 *   re-applied, twelve minutes after the drift report listed it as not
 *   applied. The withdrawal had deleted its ledger row and declared nothing,
 *   so nothing could tell. Declarations now live in
 *   `MIGRATION_WITHDRAWN.json`, which this reads.
 *
 * ## Two kinds of refusal
 *
 * Some requests are refused whatever the dispatcher says, because running them
 * is wrong:
 * - a path that is not a migration, a missing file, or a file named twice;
 * - a withdrawn file;
 * - a file that shares its version;
 * - a file whose recorded body matches no form of it. That file was edited
 *   after it applied, which `docs/security/APPLIED_MIGRATION_BODIES.md`
 *   forbids.
 *
 * Others are refused unless the dispatch sets `reapply: true`, because running
 * them is sometimes right:
 * - a version already recorded here;
 * - a body this ledger already holds under another version. Lovable stamps
 *   the moment it applied a file rather than the file's version, so this is
 *   how an applied file looks when its own version is absent.
 *
 * `20261214000000_market_building_approvals_first_ingest.sql` says it is
 * "re-applied once `market-sales-ingest` ships". A guard that blocked that
 * outright would be switched off the first time it was in the way.
 *
 * ## What it cannot see
 *
 * - A row with no body is judged by its version alone. Until this workflow
 *   began storing bodies, every row it wrote was one of those.
 * - An apply dispatched with `record_version: false` leaves nothing in the
 *   ledger, so a later dispatch cannot know it happened. Read-back files are
 *   dispatched that way on purpose and pass untouched.
 */

/** A path this workflow may apply: a versioned file directly under supabase/migrations/. */
export const MIGRATION_FILE = /^supabase\/migrations\/(\d{14})_[^/]+\.sql$/;

const VERSION_OF_NAME = /^(\d{14})_.+\.sql$/;

/** The dispatch input as the workflow receives it: commas or newlines, blanks dropped. */
export function parseFileList(input) {
  return String(input ?? '')
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Versions carried by more than one file in the corpus, with their files.
 * The same grouping `check-migration-version-collisions.mjs` makes.
 *
 * @param {ReadonlyArray<string>} names every `*.sql` basename in supabase/migrations/
 * @returns {Map<string, string[]>}
 */
export function sharedVersions(names) {
  const byVersion = new Map();
  for (const name of names) {
    const m = VERSION_OF_NAME.exec(name);
    if (!m) continue;
    const list = byVersion.get(m[1]) ?? [];
    list.push(name);
    byVersion.set(m[1], list);
  }
  return new Map([...byVersion].filter(([, files]) => files.length > 1).map(([v, f]) => [v, f.sort()]));
}

const basename = (path) => path.slice(path.lastIndexOf('/') + 1);
const firstSentence = (text) => {
  const t = String(text ?? '').trim();
  const end = t.search(/\.(\s|$)/);
  return end >= 0 ? t.slice(0, end + 1) : t;
};
const short = (digest) => `${digest.slice(0, 12)}…`;

/**
 * Judge one dispatch.
 *
 * Call it once with `ledger: null` for the rules that need no database, and
 * again with the ledger read only when that pass refused nothing. A request
 * that fails on its own terms should not need a credential to say so.
 *
 * @param {object} req
 * @param {ReadonlyArray<string>} req.requested the parsed file list, in order
 * @param {(path: string) => boolean} req.exists
 * @param {ReadonlyArray<string>} req.corpus every `*.sql` basename in supabase/migrations/
 * @param {ReadonlyMap<string, {decided?: string, reason?: string}>} req.withdrawn keyed by basename
 * @param {boolean} req.reapply
 * @param {null | {
 *   recorded: ReadonlyMap<string, string | null>,
 *   bodies: ReadonlyMap<string, ReadonlyArray<string>>,
 * }} req.ledger `recorded`: requested version → the body digest its row holds,
 *   or null for a row with no body. `bodies`: body digest → versions holding it,
 *   for the digests of the requested files.
 * @param {(path: string) => ReadonlyArray<string>} [req.rungsOf] the file's body digests,
 *   most literal first (`bodyDigests`). Needed only with a ledger.
 * @returns {{ files: string[], refusals: Array<{file: string, rule: string, message: string}>,
 *   reapplied: Array<{file: string, rule: string, message: string}> }}
 */
export function assessApplyRequest({ requested, exists, corpus, withdrawn, reapply, ledger, rungsOf }) {
  const refusals = [];
  const reapplied = [];
  const refuse = (file, rule, message) => refusals.push({ file, rule, message });
  // A request that is refused only because it re-runs something can go ahead
  // when the dispatcher asked for exactly that. The words stay the same.
  const unlessReapply = (file, rule, message) =>
    (reapply ? reapplied : refusals).push({ file, rule, message });

  if (requested.length === 0) {
    refuse('', 'no_file', 'No file was named. Name one or more files under supabase/migrations/.');
    return { files: [], refusals, reapplied };
  }

  const shared = sharedVersions(corpus);
  const seen = new Set();
  for (const file of requested) {
    const m = MIGRATION_FILE.exec(file);
    if (!m) {
      refuse(
        file,
        'not_a_migration_path',
        `${file} is not a file directly under supabase/migrations/ named <14-digit version>_<name>.sql. ` +
          'This workflow applies migrations and nothing else.',
      );
      continue;
    }
    if (seen.has(file)) {
      refuse(file, 'listed_twice', `${file} is named more than once. Each file is applied once per dispatch.`);
      continue;
    }
    seen.add(file);
    if (!exists(file)) {
      refuse(file, 'missing', `${file} does not exist in this checkout.`);
      continue;
    }
    const name = basename(file);
    const entry = withdrawn.get(name);
    if (entry) {
      refuse(
        file,
        'withdrawn',
        `${file} is declared withdrawn in supabase/migrations/MIGRATION_WITHDRAWN.json` +
          `${entry.decided ? ` (decided ${entry.decided})` : ''}: ${firstSentence(entry.reason)} ` +
          'Its effect is meant to be absent. To reverse a withdrawal, remove its entry in the pull request ' +
          'that records the decision, then apply the file.',
      );
      continue;
    }
    const version = m[1];
    const siblings = (shared.get(version) ?? []).filter((f) => f !== name);
    if (siblings.length > 0) {
      refuse(
        file,
        'shared_version',
        `${file} shares version ${version} with ${siblings.join(', ')}. One version records one ledger row, ` +
          "so this file's apply would be recorded as its sibling's (or not at all), and drift would read an " +
          'unapplied sibling as applied. Restate the change under a new, unique version after the newest ' +
          'migration, or give a sibling that is in neither the ledger nor applied-body-digests.txt a version ' +
          'of its own.',
      );
    }
  }
  if (refusals.length > 0 || !ledger) return { files: [...seen], refusals, reapplied };

  for (const file of requested) {
    const version = MIGRATION_FILE.exec(file)[1];
    const rungs = rungsOf ? rungsOf(file) : [];
    if (ledger.recorded.has(version)) {
      const stored = ledger.recorded.get(version);
      if (stored && !rungs.includes(stored)) {
        refuse(
          file,
          'edited_after_apply',
          `${file}: the ledger's row for ${version} holds a body (sha256 ${short(stored)}) that matches no form ` +
            'of this file. The file was edited after it applied, which docs/security/APPLIED_MIGRATION_BODIES.md ' +
            'forbids. Applying it would run bytes this database never ran, under a version that says it did. ' +
            'Restore the applied bytes and put the change in a new migration.',
        );
        continue;
      }
      unlessReapply(
        file,
        'already_recorded',
        `${file}: version ${version} is already recorded in this ledger, so this runs the file a second time. ` +
          'Only an idempotent file is safe to re-run. Dispatch with reapply: true if that is intended.',
      );
      continue;
    }
    const elsewhere = [
      ...new Set(rungs.flatMap((d) => [...(ledger.bodies.get(d) ?? [])]).filter((v) => v !== version)),
    ].sort();
    if (elsewhere.length > 0) {
      unlessReapply(
        file,
        'already_ran_by_body',
        `${file}: this ledger already holds its body, recorded under ${elsewhere.join(', ')}. ` +
          'Lovable records the moment it applied a file rather than the file\'s own version, so this is how an ' +
          'applied file looks when its version is absent. Dispatch with reapply: true if running it again is intended.',
      );
    }
  }
  return { files: [...seen], refusals, reapplied };
}
