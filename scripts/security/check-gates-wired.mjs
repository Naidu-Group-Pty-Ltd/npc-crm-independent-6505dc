#!/usr/bin/env node
/**
 * Every security gate must actually run somewhere.
 *
 * ## Why this exists
 *
 * `scripts/security/` had grown to 47 gates. Twelve of them were referenced by
 * nothing — not `ci.yml`, not `package.json`, not another script. They had been
 * written, reviewed and merged, and then never executed again.
 *
 * That is worse than not having written them. A gate nobody runs still reads as
 * coverage: the file exists, the concern looks handled, and the next person
 * greps for "cors" or "authz", finds a check, and moves on. Meanwhile the thing
 * it guards drifts freely.
 *
 * When they were finally run by hand, four failed — and two of those four were
 * live defects rather than gate drift:
 *
 *   - three push endpoints answered `Access-Control-Allow-Origin: *` while
 *     being called with credentials, which the browser rejects outright, so
 *     every call had been failing as an opaque "Failed to fetch";
 *   - `solicitor-portal-intelligence` resolved matter access without also
 *     resolving the per-client permission matrix, leaving the legacy
 *     `SOLICITOR_MATTER_ACCESS_V1=false` path able to return a whole portfolio
 *     to a solicitor denied `matters.view`.
 *
 * Neither would have survived a single CI run. Both survived months.
 *
 * ## What this checks
 *
 * Every `scripts/security/check-*.mjs`, plus the per-portal security checks,
 * must be named by a GitHub workflow or by a `package.json` script that a
 * workflow runs. Naming it in `package.json` alone is not enough — an npm
 * script nobody invokes is exactly the failure mode above — so the reachable
 * set is computed transitively from the workflows.
 *
 * A gate that is deliberately not wired (a one-off forensic tool, say) belongs
 * in UNWIRED_BY_DESIGN below, with a reason. An empty list is the goal.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Resolve from the process cwd, NOT from `import.meta.url`. The negative-test
// harness (check-security-gate-negatives.mjs) runs each gate against a symlinked
// mirror of the tree with one file mutated; a gate that resolves relative to its
// own location reads the REAL repository instead and passes on mutated source —
// which is precisely the "gate that is not a gate" this suite exists to catch.
const root = resolve(process.cwd());
const WORKFLOW_DIR = join(root, '.github', 'workflows');

/** Gates intentionally not run by CI. Each entry needs a written reason. */
const UNWIRED_BY_DESIGN = new Map([
  // e.g. ['check-something.mjs', 'forensic one-off; needs production credentials'],
]);

/** Checks that live outside scripts/security/ but are security gates all the same. */
const EXTRA_GATES = [
  'scripts/solicitor-portal/security-check.mjs',
];

const errors = [];

// ── What the workflows run ─────────────────────────────────────────────────
let workflowText = '';
try {
  for (const name of readdirSync(WORKFLOW_DIR)) {
    if (/\.ya?ml$/.test(name)) workflowText += readFileSync(join(WORKFLOW_DIR, name), 'utf8');
  }
} catch {
  errors.push(`${relative(root, WORKFLOW_DIR)}: no workflow directory — this gate cannot verify anything.`);
}

// ── npm scripts a workflow invokes, expanded transitively ──────────────────
// `npm run security:test` chains other scripts; a gate named only by such a
// chain is genuinely reached, so resolve the chain rather than the literal.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const scripts = pkg.scripts ?? {};

const reachableScripts = new Set(
  Object.keys(scripts).filter((name) => new RegExp(`npm run ${name}(?![\\w:-])`).test(workflowText)),
);
for (let changed = true; changed; ) {
  changed = false;
  for (const name of [...reachableScripts]) {
    for (const m of (scripts[name] ?? '').matchAll(/npm run ([\w:-]+)/g)) {
      if (scripts[m[1]] && !reachableScripts.has(m[1])) {
        reachableScripts.add(m[1]);
        changed = true;
      }
    }
  }
}

/** Everything CI effectively executes: workflow bodies + reachable npm scripts. */
const executed = workflowText + '\n' + [...reachableScripts].map((n) => scripts[n]).join('\n');

// ── Every gate must appear in it ───────────────────────────────────────────
const securityDir = join(root, 'scripts', 'security');
const gates = readdirSync(securityDir)
  .filter((n) => n.startsWith('check-') && n.endsWith('.mjs') && !n.endsWith('.test.mjs'))
  .map((n) => `scripts/security/${n}`)
  .concat(EXTRA_GATES.filter((p) => { try { return statSync(join(root, p)).isFile(); } catch { return false; } }))
  .sort();

for (const gate of gates) {
  const base = gate.split('/').pop();
  if (UNWIRED_BY_DESIGN.has(base)) continue;
  if (executed.includes(gate)) continue;
  errors.push(
    `${gate}: written but never run — no workflow and no CI-reachable npm script names it. `
    + `Add it to the security job in .github/workflows/ci.yml (or to an npm script that job runs). `
    + `A gate nobody executes reads as coverage while guarding nothing.`,
  );
}

// A stale exemption is the same failure wearing a note, so expire them too.
for (const [base, reason] of UNWIRED_BY_DESIGN) {
  if (!gates.some((g) => g.endsWith(`/${base}`))) {
    errors.push(`UNWIRED_BY_DESIGN names \`${base}\` ("${reason}") but no such gate exists. Remove the entry.`);
  }
}

if (errors.length) {
  console.error('Security gate wiring check FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `Security gate wiring check passed (${gates.length} gates, all reachable from CI; `
  + `${UNWIRED_BY_DESIGN.size} exempt by design).`,
);
