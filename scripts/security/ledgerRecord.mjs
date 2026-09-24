/**
 * The row `apply-migration.yml` writes to `supabase_migrations.schema_migrations`
 * once a file has applied, and the proof that the row says what ran.
 *
 * ## Why the body is stored now
 *
 * The workflow used to record `(version, name)` and nothing else, so every row
 * it wrote had no `statements`. Measured 23 Sep 2026: 130 of the prime's 1,036
 * ledger rows are body-less, and every file this workflow applied is among
 * them. A body-less row says a version ran. It cannot say which BYTES ran. So
 * the applied-body manifest could never record those files, the re-check could
 * never see them, and Mission Control could clear them by version only.
 *
 * The Supabase CLI records `statements` as a one-element array holding the
 * whole file. This writes the same shape, so `LEDGER_BODY_DIGEST_SQL` over the
 * stored row gives `sha256(file)`, the first rung of `bodyDigests`. That is the
 * value every reader already compares against.
 *
 * ## What is never stored
 *
 * - A file past `MAX_DIGEST_BYTES`. The template seeds run to about 42 MB, and
 *   nothing reads a body that size: the digest builder and Mission Control both
 *   stop at the same ceiling. Their version is recorded; their body is covered
 *   by `templates:library:seed:check`.
 * - Bytes that do not survive UTF-8 decoding unchanged, and bytes with a NUL.
 *   Postgres `text` rejects NUL, and a body re-encoded differently from the
 *   file would record a digest that nothing in the repository produces. A row
 *   that claimed bytes which never ran would be worse than a body-less row.
 *
 * ## Nothing is spliced into SQL
 *
 * The body and the name travel as base64 and are decoded by Postgres. Base64
 * has no quote, no backslash and no `$`, so no file content can end the
 * literal it sits in. The version is checked to be fourteen digits before it
 * is written into the statement.
 *
 * ## "Recorded" means a row came back
 *
 * The insert keeps `where not exists`, so a version already in the ledger is
 * left as it is: the first row stands. It says `returning version`, and only a
 * returned row counts as recorded. The old workflow printed "Recorded" in both
 * cases, including for the second file of a shared version, whose row was
 * never written.
 */
import { createHash } from 'node:crypto';
import { LEDGER_BODY_DIGEST_SQL, MAX_DIGEST_BYTES } from './appliedBodyIdentity.mjs';

/** A migration path this workflow may apply, and the parts the ledger records. */
export const MIGRATION_PATH = /^supabase\/migrations\/(\d{14})_([^/]+)\.sql$/;

/**
 * @param {string} path repository-relative
 * @returns {{ version: string, name: string } | null}
 */
export function migrationIdentity(path) {
  const m = MIGRATION_PATH.exec(String(path ?? ''));
  return m ? { version: m[1], name: m[2] } : null;
}

/**
 * The file's text when it can be stored as its body, or why not.
 *
 * @param {Uint8Array} bytes the file as read from disk, undecoded
 * @returns {{ text: string } | { reason: 'oversize' | 'not_utf8' | 'nul' }}
 */
export function storableBody(bytes) {
  const buf = Buffer.from(bytes);
  if (buf.length > MAX_DIGEST_BYTES) return { reason: 'oversize' };
  if (buf.includes(0)) return { reason: 'nul' };
  const text = buf.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(buf)) return { reason: 'not_utf8' };
  return { text };
}

export const BODY_NOT_STORED = Object.freeze({
  oversize: `the file is past ${MAX_DIGEST_BYTES} bytes, which no reader digests`,
  not_utf8: 'the file is not valid UTF-8, so the stored text would not be its bytes',
  nul: 'the file holds a NUL byte, which Postgres text cannot store',
});

const b64 = (text) => Buffer.from(String(text), 'utf8').toString('base64');
const decoded = (text) => `convert_from(decode('${b64(text)}', 'base64'), 'UTF8')`;

function assertVersion(version) {
  if (!/^\d{14}$/.test(String(version ?? ''))) {
    throw new Error(`not a fourteen-digit migration version: ${JSON.stringify(version)}`);
  }
}

/**
 * The insert. It writes nothing when the version is already recorded, and it
 * returns the version only when it wrote a row.
 *
 * @param {{ version: string, name: string, body?: string | null }} row
 */
export function recordSql({ version, name, body = null }) {
  assertVersion(version);
  const columns = body == null ? 'version, name' : 'version, name, statements';
  const values =
    body == null
      ? `'${version}', ${decoded(name)}`
      : `'${version}', ${decoded(name)}, array[${decoded(body)}]`;
  return (
    `insert into supabase_migrations.schema_migrations (${columns}) ` +
    `select ${values} ` +
    `where not exists (select 1 from supabase_migrations.schema_migrations where version = '${version}') ` +
    `returning version`
  );
}

/** The digest of the body the ledger holds for one version, with the same expression every reader uses. */
export function recordedDigestSql(version) {
  assertVersion(version);
  return (
    `select ${LEDGER_BODY_DIGEST_SQL} from supabase_migrations.schema_migrations ` +
    `where version = '${version}' and statements is not null and array_length(statements, 1) > 0`
  );
}

/**
 * Record an applied file, then prove the record.
 *
 * Throws when the stored body does not read back as the file's digest. The
 * file has already applied by then, so the throw fails the run instead of
 * leaving a row that claims bytes which never ran.
 *
 * @param {{ path: string, bytes: Uint8Array, q: (sql: string) => Promise<string[]> }} args
 * @returns {Promise<{ version: string, recorded: boolean, bodyStored: boolean, reason?: string }>}
 */
export async function recordAppliedMigration({ path, bytes, q }) {
  const id = migrationIdentity(path);
  if (!id) throw new Error(`${path} is not a versioned file under supabase/migrations/`);
  const body = storableBody(bytes);
  const text = 'text' in body ? body.text : null;
  const returned = await q(recordSql({ version: id.version, name: id.name, body: text }));
  if (!returned.includes(id.version)) {
    return { version: id.version, recorded: false, bodyStored: false };
  }
  if (text == null) {
    return { version: id.version, recorded: true, bodyStored: false, reason: BODY_NOT_STORED[body.reason] };
  }
  const expected = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  const stored = await q(recordedDigestSql(id.version));
  if (stored.length !== 1 || stored[0] !== expected) {
    throw new Error(
      `${id.version} was recorded, but its stored body reads back as ${JSON.stringify(stored)}, ` +
        `not the file's sha256 ${expected}. The file HAS applied; the ledger row does not describe it.`,
    );
  }
  return { version: id.version, recorded: true, bodyStored: true };
}
