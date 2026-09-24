#!/usr/bin/env node
/**
 * A gate that can stand itself down must be handed the value that arms it.
 *
 * ## Why this exists
 *
 * `scripts/build-migration-object-index.mjs --check` asserts the committed
 * object index matches the migrations on disk. On a CLONE that assertion can
 * never pass: the v13 and v14 template-library seeds are 39.7 MB each, over
 * the 8 MB a cascade will carry in one file, so they are permanently absent
 * there while the cascaded index still counts them. `indexIsCarriedNotAuthored`
 * was written for exactly that — it stands the check down where Mission
 * Control owns the backend, reading `process.env.BACKEND_DEPLOYED_BY`, and it
 * FAILS CLOSED so a repository that authors its own backend is still held to
 * its own index.
 *
 * The logic shipped. The wiring did not. `vars.BACKEND_DEPLOYED_BY` is a
 * repository variable, and a repository variable is NOT a process environment
 * variable until a step maps it — `deploy-supabase-functions.yml` maps it
 * (`DEPLOYER: ${{ vars.BACKEND_DEPLOYED_BY }}`), `ci.yml` did not. So the
 * stand-down read `undefined` on every clone, failed closed exactly as
 * designed, and asserted a claim no clone can satisfy.
 *
 * Measured: from 2026-09-17 03:25 the `security` job failed on that one step
 * on npc-client-dashboard, npc-test-76b3b3 and preflight-property-group at
 * once. Every other gate in the job passed. The cascade pull requests are
 * written "auto-merge: this lands on green and waits otherwise", so all three
 * waited — a fleet-wide delivery stop, on a file nothing on that side reads,
 * caused by a missing two-line `env:` block.
 *
 * `check-gates-wired.mjs` could not see it: that gate asks whether a check is
 * REACHABLE from CI, and this one was. It ran. It was starved.
 *
 * ## What this checks
 *
 * For every contract below, both directions:
 *
 *   1. the script really reads the variable it declares — so a stand-down that
 *      is removed or renamed cannot leave a stale contract vouching for it;
 *   2. every workflow step that runs the script maps the variable into the
 *      step's environment (directly, or from the job's or the workflow's
 *      `env:`) — so the wiring cannot go missing again;
 *   3. at least one step runs it at all, because a contract that matches
 *      nothing is testing nothing.
 *
 * Adding a stand-down to a gate means adding a row here. That is the whole
 * maintenance cost, and it is the cost of the variable meaning anything.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Resolve from the process cwd, NOT from `import.meta.url` — the negative-test
// harness runs each gate against a symlinked mirror of the tree with one file
// mutated, and a gate that resolves relative to its own location reads the
// REAL repository and passes on mutated source.
const root = resolve(process.cwd());
const WORKFLOW_DIR = join(root, '.github', 'workflows');

/**
 * Each entry: a script that decides whether to assert from the environment,
 * the variables it needs, and the reason the stand-down exists.
 */
const CONTRACTS = [
  {
    // `npm run migrations:index:check` → scripts/build-migration-object-index.mjs
    runMatch: 'migrations:index:check',
    source: 'scripts/build-migration-object-index.mjs',
    env: ['BACKEND_DEPLOYED_BY'],
    why:
      'indexIsCarriedNotAuthored stands the object-index check down where Mission '
      + 'Control owns the backend. Unset it fails closed and asserts a claim no clone '
      + 'can satisfy, which stopped every cascade pull request on all three clones at '
      + 'once from 2026-09-17 over a file nothing on that side reads.',
  },
  {
    // `npm run migrations:seed-skeletons:check` → scripts/build-migration-seed-skeletons.mjs
    runMatch: 'migrations:seed-skeletons:check',
    source: 'scripts/build-migration-seed-skeletons.mjs',
    env: ['BACKEND_DEPLOYED_BY'],
    why:
      'skeletonsAreCarriedNotAuthored stands the seed-skeleton check down where Mission '
      + 'Control owns the backend, on the object index\'s marker and for its reason: a clone '
      + 'cannot hold the seeds the manifest describes. Unset it fails closed and asserts a '
      + 'claim no clone can satisfy.',
  },
  {
    // `npm run templates:library:seed:check` → scripts/template-library/buildSeedCatalogue.ts
    runMatch: 'templates:library:seed:check',
    source: 'scripts/template-library/buildSeedCatalogue.ts',
    env: ['BACKEND_DEPLOYED_BY'],
    why:
      'seedIsCarriedNotAuthored stands the seed-currency comparison down where Mission '
      + 'Control owns the backend, on the same marker: a seed past what a cascade carries in '
      + 'one file never reaches a clone. Unset it fails closed and holds every cascade pull '
      + 'request on a check no delivery can clear, because Mission Control merges none with '
      + 'a red check.',
  },
];

const indentOf = (text) => text.match(/^ */)[0].length;

/** Lines that carry structure: blanks and whole-line comments carry none. */
function significantLines(text) {
  return text
    .split(/\r?\n/)
    .map((text, line) => ({ text, line: line + 1 }))
    .filter((l) => l.text.trim() !== '' && !/^\s*#/.test(l.text));
}

/** Every line nested under `lines[idx]`, i.e. indented further than it. */
function nestedUnder(lines, idx) {
  const base = indentOf(lines[idx].text);
  const out = [];
  for (let j = idx + 1; j < lines.length; j++) {
    if (indentOf(lines[j].text) <= base) break;
    out.push(lines[j]);
  }
  return out;
}

/** The mapping keys declared directly in a block, ignoring deeper nesting. */
function directKeys(blockLines) {
  const keys = new Set();
  if (blockLines.length === 0) return keys;
  const top = Math.min(...blockLines.map((l) => indentOf(l.text)));
  for (const l of blockLines) {
    if (indentOf(l.text) !== top) continue;
    const m = l.text.trim().match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*:/);
    if (m) keys.add(m[1]);
  }
  return keys;
}

/** The env keys declared by an `env:` mapping directly inside `blockLines`. */
function envKeysIn(blockLines) {
  if (blockLines.length === 0) return new Set();
  const top = Math.min(...blockLines.map((l) => indentOf(l.text)));
  for (let i = 0; i < blockLines.length; i++) {
    const l = blockLines[i];
    if (indentOf(l.text) !== top) continue;
    if (!/^env\s*:/.test(l.text.trim())) continue;
    return directKeys(nestedUnder(blockLines, i));
  }
  return new Set();
}

/**
 * Split a `steps:` block into one chunk per step, each re-indented so the
 * step's properties form an ordinary mapping (`- name: x` becomes `  name: x`).
 */
function stepsIn(stepsBlock) {
  if (stepsBlock.length === 0) return [];
  const itemIndent = Math.min(...stepsBlock.map((l) => indentOf(l.text)));
  const starts = [];
  for (let i = 0; i < stepsBlock.length; i++) {
    const l = stepsBlock[i];
    if (indentOf(l.text) === itemIndent && /^-\s/.test(l.text.trim())) starts.push(i);
  }
  return starts.map((start, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : stepsBlock.length;
    const chunk = stepsBlock.slice(start, end).map((l, k) =>
      // The `- ` marker occupies the two columns the properties are indented by.
      k === 0 ? { ...l, text: l.text.replace(/^(\s*)-\s/, '$1  ') } : l,
    );
    return chunk;
  });
}

/** Everything a step's `run:` executes, inline value and block scalar alike. */
function runTextOf(stepChunk) {
  const top = Math.min(...stepChunk.map((l) => indentOf(l.text)));
  for (let i = 0; i < stepChunk.length; i++) {
    const l = stepChunk[i];
    if (indentOf(l.text) !== top) continue;
    const m = l.text.trim().match(/^run\s*:(.*)$/);
    if (!m) continue;
    const inline = m[1].replace(/^\s*[|>][-+]?\s*$/, '').trim();
    const body = nestedUnder(stepChunk, i).map((b) => b.text).join('\n');
    return `${inline}\n${body}`;
  }
  return null;
}

const errors = [];

// ── Direction 1: the contract describes the script as it is written now ─────
for (const contract of CONTRACTS) {
  let src;
  try {
    src = readFileSync(join(root, contract.source), 'utf8');
  } catch {
    errors.push(
      `${contract.source}: named by a gate-env contract and not present. Either the `
      + 'script moved and the contract did not, or the contract is stale — a contract '
      + 'that points at nothing vouches for nothing.',
    );
    continue;
  }
  for (const name of contract.env) {
    if (!src.includes(name)) {
      errors.push(
        `${contract.source}: the contract says this script stands down on \`${name}\`, `
        + 'and the source never names it. Remove the contract, or restore the stand-down '
        + '— a variable wired into a step that ignores it is wiring nobody can rely on.',
      );
    }
  }
}

// ── Direction 2: every step that runs it hands it the variable ──────────────
let workflowFiles = [];
try {
  workflowFiles = readdirSync(WORKFLOW_DIR).filter((n) => /\.ya?ml$/.test(n));
} catch {
  errors.push(
    `${relative(root, WORKFLOW_DIR)}: no workflow directory — this gate cannot verify anything.`,
  );
}

const matched = new Map(CONTRACTS.map((c) => [c.runMatch, 0]));

for (const name of workflowFiles) {
  const rel = `.github/workflows/${name}`;
  const lines = significantLines(readFileSync(join(WORKFLOW_DIR, name), 'utf8'));

  // Workflow-level env, then each job's env, then each step's own.
  const workflowEnv = envKeysIn(topLevelBlock(lines));

  const jobsIdx = lines.findIndex((l) => indentOf(l.text) === 0 && /^jobs\s*:/.test(l.text.trim()));
  if (jobsIdx === -1) continue;
  const jobsBlock = nestedUnder(lines, jobsIdx);
  if (jobsBlock.length === 0) continue;
  const jobIndent = Math.min(...jobsBlock.map((l) => indentOf(l.text)));

  for (let i = 0; i < jobsBlock.length; i++) {
    if (indentOf(jobsBlock[i].text) !== jobIndent) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(jobsBlock[i].text.trim())) continue;
    const jobName = jobsBlock[i].text.trim().replace(/\s*:.*$/, '');
    const jobBlock = nestedUnder(jobsBlock, i);
    const jobEnv = envKeysIn(jobBlock);

    const jobTop = jobBlock.length ? Math.min(...jobBlock.map((l) => indentOf(l.text))) : 0;
    const stepsIdx = jobBlock.findIndex(
      (l) => indentOf(l.text) === jobTop && /^steps\s*:/.test(l.text.trim()),
    );
    if (stepsIdx === -1) continue;

    for (const stepChunk of stepsIn(nestedUnder(jobBlock, stepsIdx))) {
      const run = runTextOf(stepChunk);
      if (run === null) continue;
      const stepEnv = envKeysIn(stepChunk);
      const available = new Set([...workflowEnv, ...jobEnv, ...stepEnv]);

      for (const contract of CONTRACTS) {
        if (!run.includes(contract.runMatch)) continue;
        matched.set(contract.runMatch, matched.get(contract.runMatch) + 1);
        for (const varName of contract.env) {
          if (available.has(varName)) continue;
          errors.push(
            `${rel} (job \`${jobName}\`, line ${stepChunk[0].line}): runs `
            + `\`${contract.runMatch}\` without \`${varName}\` in its environment.\n`
            + `    ${contract.why}\n`
            + '    A repository variable is not a process environment variable until a step '
            + 'maps it. Add:\n'
            + `        env:\n          ${varName}: \${{ vars.${varName} }}`,
          );
        }
      }
    }
  }
}

// ── Direction 3: a contract that matches no step is testing nothing ─────────
for (const contract of CONTRACTS) {
  if (workflowFiles.length === 0) break;
  if (matched.get(contract.runMatch) === 0) {
    errors.push(
      `No workflow step runs \`${contract.runMatch}\`, which a gate-env contract claims `
      + 'needs an environment. Either the step was removed and the contract outlived it, '
      + 'or the invocation was renamed — either way nothing here is being checked.',
    );
  }
}

/** The workflow's own top-level `env:`, if it declares one. */
function topLevelBlock(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (indentOf(lines[i].text) !== 0) continue;
    if (!/^env\s*:/.test(lines[i].text.trim())) continue;
    return [lines[i], ...nestedUnder(lines, i)];
  }
  return [];
}

if (errors.length) {
  console.error(`Gate environment wiring FAILED:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}

const steps = [...matched.values()].reduce((a, b) => a + b, 0);
console.log(
  `Gate environment wiring passed (${CONTRACTS.length} contract(s), `
  + `${steps} invoking step(s), every stand-down variable reaches the process).`,
);
