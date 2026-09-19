/**
 * The sanctions loader's write path, pinned where production disagreed with it.
 *
 * The parsers have their own tests and no I/O. This file guards the two lines
 * of the loader that talk to PostgREST, because both were wrong in a way no
 * unit test could see: the statements are well-formed, the table is correct,
 * and the server refuses them anyway.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const loader = readFileSync(join(repo, 'scripts/aml/load-sanctions-lists.mjs'), 'utf8');

/** The prune statement, from `.delete()` to the end of its chain. */
function pruneStatement(src) {
  const start = src.indexOf(".delete().eq('list_code', list)");
  assert.notEqual(start, -1, 'the prune delete could not be located');
  return src.slice(start, src.indexOf(';', start));
}

test('the prune names sync_id in its returning projection', () => {
  /*
   * On a MUTATION, PostgREST resolves the columns inside a logical `or=(…)`
   * against the RETURNING projection rather than against the table. So
   *
   *     .delete().or('sync_id.is.null,sync_id.neq.…').select('id')
   *
   * answers `42703 column sanctions_entries.sync_id does not exist` on a
   * table that has the column — while the identical filter on a GET, and the
   * same `.neq` outside an `or()`, both succeed. Measured against production
   * on 2026-08-19.
   *
   * The cost is not a failed prune. The loader records the whole run as
   * FAILED, and the screening provider fails closed on a required list whose
   * latest attempt failed — so a complete, current DFAT list sat in the table
   * while every screening refused to run.
   */
  const stmt = pruneStatement(loader);
  assert.match(stmt, /\.or\(`sync_id\.is\.null,sync_id\.neq\./,
    'the NULL sync_id case must still be pruned');
  assert.match(stmt, /\.select\('id, sync_id'\)/,
    'every column named inside the or() must appear in the returning projection');
});

test('the prune still cannot be narrowed to neq alone', () => {
  /*
   * `neq` on its own never matches a NULL sync_id — SQL inequality against
   * NULL is NULL, not true — so rows predating sync tracking would match
   * forever and never be prunable. Fixing the 42703 by dropping the or() is
   * the tempting wrong answer, and it is silent.
   */
  const stmt = pruneStatement(loader);
  assert.doesNotMatch(stmt, /\.neq\('sync_id'/,
    'a bare .neq would leave NULL sync_id rows unprunable');
});

test('a zero-entry publish is refused before anything is written', () => {
  // A list that parsed to nothing is a broken download, not a delisting of
  // everybody. Screening against an empty list clears every customer.
  assert.match(loader, /parsed\.length === 0\) throw new Error\('parser produced 0 entries/);
});

test('the loader exits non-zero when any list fails', () => {
  // The scheduled run IS the alert. A stale list that reports success is the
  // one outcome with no signal anywhere.
  assert.match(loader, /process\.exitCode = 1/);
});
