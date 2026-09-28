#!/usr/bin/env node
/**
 * Record one applied migration in this deployment's ledger, then prove the row.
 *
 *   FILE=supabase/migrations/<version>_<name>.sql SUPABASE_DB_URL=... \
 *     node .github/scripts/record-migration.mjs
 *
 * The psql route of `apply-migration.yml` runs this after `psql -f` succeeds.
 * The Management API route records from `apply-migration.mjs` with the same
 * function. Both routes therefore write the same row and report it the same
 * way. See `scripts/security/ledgerRecord.mjs` for what the row holds and why.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { describeLedgerRoute, ledgerQuery, ledgerRoute } from '../../scripts/lib/ledgerQuery.mjs';
import { recordAppliedMigration } from '../../scripts/security/ledgerRecord.mjs';

const FILE = String(process.env.FILE ?? '').trim();
const route = ledgerRoute(process.env);
if (!FILE) {
  console.error('::error title=No file::FILE is not set.');
  process.exit(1);
}
if (!route) {
  console.error('::error title=No route to the ledger::Neither SUPABASE_DB_URL nor SUPABASE_ACCESS_TOKEN with a project ref is set.');
  process.exit(1);
}

try {
  const result = await recordAppliedMigration({ path: FILE, bytes: readFileSync(FILE), q: ledgerQuery(route) });
  const line = result.recorded
    ? `Recorded ${result.version} in schema_migrations${result.bodyStored ? ', with its body' : ` without its body: ${result.reason}`}.`
    : `${result.version} was already recorded; the ledger keeps its first row and nothing was written.`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`);
} catch (err) {
  console.error(`::error title=Ledger record failed::${FILE} over ${describeLedgerRoute(route)}: ${err.message}`);
  process.exit(1);
}
