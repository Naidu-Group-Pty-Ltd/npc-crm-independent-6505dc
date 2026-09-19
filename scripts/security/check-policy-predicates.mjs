#!/usr/bin/env node
/**
 * A POLICY PREDICATE NEUTRALISED BY A DISJUNCTIVE LITERAL `true`.
 *
 * Found by a live audit on 12 September 2026.
 * `tpl_comments_update_own_or_resolve` read
 *
 *     USING ((author_id IS NULL) OR (author_id = auth.uid()) OR true)
 *
 * The trailing disjunct makes every test before it unreachable, so a policy
 * named for ownership granted UPDATE on every row of `template_comments` to
 * every authenticated principal. It reads as a restrictive policy in a diff,
 * and it is not one — which is exactly why a machine should read it instead.
 *
 * WHY THIS IS THE ONLY RULE HERE.
 *
 * A second rule was written alongside it — "a table created in `public` with no
 * ALTER TABLE … ENABLE ROW LEVEL SECURITY anywhere in the corpus" — to catch
 * the other audit finding, `_report_templates_backup_20260906`, which shipped
 * without RLS and was readable and writable by the anon key. It was then
 * measured against the live catalogue and DELETED, because it does not work:
 * it reported 58 tables where the database has exactly ONE. RLS is turned on by
 * routes a regex over 1,035 migrations cannot follow — inside DO blocks, in
 * later consolidating migrations, on tables created under a different name.
 *
 * A check that is 98% false positives is worse than no check. Frozen behind a
 * baseline to make it pass, it would have contributed nothing except noise
 * around the one rule that does work.
 *
 * That class is already covered, accurately and authoritatively, by the
 * platform's own linter: `rls_disabled_in_public` is what found the backup
 * table, and it reads the live database rather than guessing from SQL text.
 * The right home for it is a scheduled advisor check against production, not
 * a static scan in CI.
 *
 * WHY A BASELINE. 1,035 migrations are history and cannot be rewritten — the
 * migration that introduced the defect above still contains it, correctly, as
 * a record of what was applied. `policy-predicate-baseline.json` freezes what
 * existed when this check was written, keyed by policy name rather than by
 * line number so an unrelated edit does not churn it. Anything NEW fails. It
 * is a ratchet: entries may be removed as debt is paid, never added.
 *
 * The same shape as `edge-missing-names.txt`, for the same reason.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', '..', 'supabase', 'migrations');
const BASELINE = join(HERE, 'policy-predicate-baseline.json');

/** Strip comments so prose quoting the defect never trips the rule. */
const stripComments = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/--.*$/gm, ' ');

/**
 * Disjunctive literal `true` inside a CREATE POLICY body.
 *
 * Scoped to the policy statement rather than the whole file: an ordinary
 * `WHERE x OR true` in a data migration grants nobody anything and is not an
 * authorisation defect.
 */
function neutralisedPredicates(sql, file) {
  const out = [];
  for (const m of sql.matchAll(/CREATE\s+POLICY\s+([A-Za-z0-9_"]+)[\s\S]*?(?=;)/gi)) {
    if (!/\bOR\s*\(?\s*true\b/i.test(m[0])) continue;
    out.push({ policy: m[1].replace(/"/g, ''), file });
  }
  return out;
}

const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql') && !f.startsWith('TEMPLATE_'))
  .sort();

const findings = files.flatMap((file) =>
  neutralisedPredicates(stripComments(readFileSync(join(MIGRATIONS, file), 'utf8')), file));

const baseline = existsSync(BASELINE)
  ? new Set(JSON.parse(readFileSync(BASELINE, 'utf8')).frozen)
  : new Set();

if (process.argv.includes('--write-baseline')) {
  const frozen = [...new Set(findings.map((f) => f.policy))].sort();
  writeFileSync(BASELINE, `${JSON.stringify({
    note: 'Policies whose predicate is neutralised by a disjunctive literal '
      + 'true, frozen at the date below. A RATCHET: entries may be REMOVED as '
      + 'the debt is paid, never added. Regenerating this file to silence a new '
      + 'finding defeats the check. A frozen entry means the historical '
      + 'migration text still contains it — not that the live policy is still '
      + 'wrong.',
    generated: new Date().toISOString().slice(0, 10),
    frozen,
  }, null, 2)}\n`);
  console.log(`Wrote baseline with ${frozen.length} frozen finding(s).`);
  process.exit(0);
}

const fresh = findings.filter((f) => !baseline.has(f.policy));
if (fresh.length) {
  console.error(`\nPolicy-predicate check FAILED — ${fresh.length} new finding(s):\n`);
  for (const f of fresh) {
    console.error(`  ${f.policy}`);
    console.error(`      ${f.file}`);
    console.error('      predicate contains a disjunctive literal `true`, which makes');
    console.error('      every test before it unreachable\n');
  }
  console.error('Fix the predicate rather than regenerating the baseline — it is a\n'
    + 'ratchet, not a snapshot. If the open row predicate is deliberate, confine\n'
    + 'the write with a column-level GRANT and say so in the policy comment.\n');
  process.exit(1);
}

console.log(`Policy-predicate check passed (${files.length} migrations scanned; `
  + `${baseline.size} historical finding(s) frozen, 0 new).`);
