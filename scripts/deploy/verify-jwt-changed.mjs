#!/usr/bin/env node
/**
 * Print the functions whose deployed-behaviour declaration changed in the last
 * commit — `verify_jwt` or `request_timeout`.
 *
 * A declaration in `supabase/config.toml` only reaches production if the
 * function it describes is redeployed, and until 15 Aug 2026 nothing made that
 * happen. `config.toml` is in the deploy workflow's `on.push.paths`, so editing
 * it TRIGGERS the workflow — but the changed-function list was built entirely
 * from `supabase/functions/**` paths, so a config-only push produced an EMPTY
 * list and deployed nothing. The declaration then sat unapplied until that
 * function's source happened to change for an unrelated reason.
 *
 * That is the mechanism behind the whole drift class. `agreement-centre-render`
 * read `verify_jwt = true` in the file and was deployed `false`; 91 functions
 * had no block at all — which the CLI reads as `true` — while every one of them
 * ran with the check off.
 *
 * `request_timeout` is here for the same reason and was found the same way.
 * `compare-investment-reports` declared 120s against its own design ceiling of
 * 125s (`ANALYSIS_BUDGET_MS` + `RESPONSE_RESERVE_MS`), so the gateway cut the
 * connection before the function was allowed to answer. The browser reports a
 * severed request as `Failed to fetch`, which the client renders as a CORS
 * error — sending whoever reads it to check the one thing that is provably
 * fine. Raising the number fixes nothing on its own: without this, a
 * timeout-only edit deploys nothing at all.
 *
 * This diffs the DECLARATIONS rather than the file text. Diffing the text would
 * redeploy on a comment edit, and would miss a change made by deleting a block.
 *
 *   node scripts/deploy/verify-jwt-changed.mjs [beforeRev] [afterRev]
 *
 * Prints a space-separated list on one line; empty when nothing changed.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const [beforeRev = 'HEAD^', afterRev = 'HEAD'] = process.argv.slice(2);

/**
 * The keys whose value changes how a DEPLOYED function behaves, so a change to
 * one has to redeploy it. Anything the CLI applies at deploy time belongs here;
 * anything purely local does not.
 */
const DEPLOYED_KEYS = ['verify_jwt', 'request_timeout'];

/**
 * `[functions.NAME]` → a stable string of its deployed-behaviour declarations.
 *
 * Every key in the block is read, not just the first one found: scanning
 * stopped at `verify_jwt` before, which made any key written after it —
 * `request_timeout` is always written after it in this file — invisible.
 */
export function parseDeclarations(toml) {
  const declared = new Map();
  let current = null;
  for (const line of toml.split('\n')) {
    const trimmed = line.trim();
    const section = /^\[functions\.([A-Za-z0-9_-]+)\]$/.exec(trimmed);
    if (section) {
      current = section[1];
      if (!declared.has(current)) declared.set(current, new Map());
      continue;
    }
    if (trimmed.startsWith('[')) { current = null; continue; }
    if (!current) continue;
    for (const key of DEPLOYED_KEYS) {
      const value = new RegExp(`^${key}\\s*=\\s*([A-Za-z0-9_.-]+)`).exec(trimmed);
      if (value) declared.get(current).set(key, value[1]);
    }
  }
  // Collapse to a comparable string so an added, removed or edited key all read
  // as a difference.
  return new Map(
    [...declared].map(([fn, keys]) => [
      fn,
      DEPLOYED_KEYS.map((k) => `${k}=${keys.get(k) ?? ''}`).join(','),
    ]),
  );
}

function declarationsAt(rev) {
  try {
    return parseDeclarations(
      execFileSync('git', ['show', `${rev}:supabase/config.toml`], { encoding: 'utf8' }),
    );
  } catch {
    // No such revision (a first commit, a shallow clone without the parent) —
    // treat as "nothing declared" so the diff reports additions rather than
    // failing the deploy.
    return new Map();
  }
}

export function changedDeclarations(beforeRev, afterRev) {
  const before = declarationsAt(beforeRev);
  const after = declarationsAt(afterRev);
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((fn) => before.get(fn) !== after.get(fn))
    .sort();
}

// Only when run as the command. Importing this module — a test does — must not
// shell out to git or write to stdout.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.stdout.write(`${changedDeclarations(beforeRev, afterRev).join(' ')}\n`);
}
