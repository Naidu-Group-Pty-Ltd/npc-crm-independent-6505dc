#!/usr/bin/env node
/**
 * Check a dispatch of "Apply a migration" before anything is applied.
 *
 *   FILE='<list>' REAPPLY=false SUPABASE_DB_URL=... node .github/scripts/apply-preflight.mjs
 *
 * The rules live in `scripts/ops/applyPreflight.pure.mjs`. This file gathers
 * what they judge, reading the ledger through `scripts/lib/ledgerQuery.mjs`
 * (the reader the ledger record and the applied-body re-check use), and hands
 * both apply steps the file list it approved, as the step output `files`.
 * Neither apply step parses the dispatch input itself, so there is one parse,
 * and one place a path is judged.
 */
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { describeLedgerRoute, ledgerQuery, ledgerRoute } from '../../scripts/lib/ledgerQuery.mjs';
import { assessApplyRequest, parseFileList } from '../../scripts/ops/applyPreflight.pure.mjs';
import { WITHDRAWALS_PATH, parseWithdrawals, withdrawalsByFile } from '../../scripts/ops/migrationWithdrawals.pure.mjs';
import { LEDGER_BODY_DIGEST_SQL, bodyDigests } from '../../scripts/security/appliedBodyIdentity.mjs';

const summary = (text) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
};
const fail = (title, lines) => {
  for (const line of lines) console.error(`::error title=${title}::${line}`);
  summary([`### Refused: ${title}`, '', ...lines.map((l) => `- ${l}`), ''].join('\n'));
  process.exit(1);
};

const requested = parseFileList(process.env.FILE);
const reapply = String(process.env.REAPPLY ?? 'false') === 'true';
const corpus = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();

// A manifest that cannot be read is not a manifest with no entries: refusing
// every apply until it is fixed is the side a withdrawal is on.
const parsed = existsSync(WITHDRAWALS_PATH)
  ? parseWithdrawals(readFileSync(WITHDRAWALS_PATH, 'utf8'))
  : { entries: [], errors: [] };
if (parsed.errors.length > 0) {
  fail('Unreadable withdrawals manifest', parsed.errors.map((e) => `${WITHDRAWALS_PATH}: ${e}`));
}
const withdrawn = withdrawalsByFile(parsed.entries);

const base = { requested, exists: existsSync, corpus, withdrawn, reapply };
const offline = assessApplyRequest({ ...base, ledger: null });
if (offline.refusals.length > 0) {
  fail('Nothing applied', offline.refusals.map((r) => r.message));
}

const route = ledgerRoute(process.env);
if (!route) {
  fail('No route to the ledger', ['Neither SUPABASE_DB_URL nor SUPABASE_ACCESS_TOKEN with a project ref is set.']);
}
const q = ledgerQuery(route);

const rungs = new Map(requested.map((f) => [f, bodyDigests(readFileSync(f, 'utf8'))]));
const versions = requested.map((f) => /\/(\d{14})_/.exec(f)[1]);
const digests = [...new Set([...rungs.values()].flat())];
// Every value spliced below was produced here: fourteen digits, or sha256 hex.
const list = (xs) => xs.map((x) => `'${x}'`).join(', ');
const BODY = `case when statements is not null and array_length(statements, 1) > 0 then ${LEDGER_BODY_DIGEST_SQL} else '-' end`;

let total;
let recordedRows;
let bodyRows;
try {
  total = Number((await q('select count(*) from supabase_migrations.schema_migrations'))[0] ?? 0);
  recordedRows = await q(
    `select version || ' ' || ${BODY} from supabase_migrations.schema_migrations where version in (${list(versions)})`,
  );
  bodyRows = await q(
    `select version || ' ' || ${LEDGER_BODY_DIGEST_SQL} from supabase_migrations.schema_migrations ` +
      `where statements is not null and array_length(statements, 1) > 0 and ${LEDGER_BODY_DIGEST_SQL} in (${list(digests)})`,
  );
} catch (err) {
  fail('Ledger unreadable', [`Reading the ledger over ${describeLedgerRoute(route)} failed: ${err.message}`]);
}
// An empty ledger and a read that did not work look the same, and every
// provisioned database has rows. Applying against "nothing recorded" would
// wave every re-run through.
if (!(total > 0)) {
  fail('Ledger unreadable', [`The ledger read over ${describeLedgerRoute(route)} returned no rows.`]);
}

const recorded = new Map();
for (const row of recordedRows) {
  const [version, digest] = row.split(' ');
  recorded.set(version, digest === '-' ? null : digest);
}
const bodies = new Map();
for (const row of bodyRows) {
  const [version, digest] = row.split(' ');
  bodies.set(digest, [...(bodies.get(digest) ?? []), version]);
}

const verdict = assessApplyRequest({
  ...base,
  ledger: { recorded, bodies },
  rungsOf: (f) => rungs.get(f) ?? [],
});
if (verdict.refusals.length > 0) {
  fail('Nothing applied', verdict.refusals.map((r) => r.message));
}
for (const r of verdict.reapplied) console.log(`::warning title=Re-applying (reapply: true)::${r.message}`);

const delimiter = `FILES_${randomBytes(12).toString('hex')}`;
appendFileSync(process.env.GITHUB_OUTPUT ?? '/dev/stdout', `files<<${delimiter}\n${verdict.files.join('\n')}\n${delimiter}\n`);
summary(
  [
    `### Preflight: ${verdict.files.length} file(s), in the order given`,
    '',
    `Ledger read over ${describeLedgerRoute(route)}: ${total} row(s).`,
    '',
    ...verdict.files.map((f) => `- \`${f}\``),
    ...(verdict.reapplied.length ? ['', '**Re-applied, as the dispatch asked (`reapply: true`):**', ...verdict.reapplied.map((r) => `- ${r.message}`)] : []),
    '',
  ].join('\n'),
);
console.log(`Preflight passed for ${verdict.files.length} file(s) over ${describeLedgerRoute(route)}.`);
