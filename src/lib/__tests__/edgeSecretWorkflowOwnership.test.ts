/**
 * THE WORKFLOW THAT WRITES AN EDGE SECRET, AND WHO MAY RUN IT.
 *
 * Writing a Supabase Edge secret from CI needs a Supabase management
 * credential. This repository is the only one in the fleet that holds one: a
 * clone's Edge secrets are written by Aurixa Mission Control, whose
 * `PRIME_ONLY_SECRETS` refuses to forward `SUPABASE_ACCESS_TOKEN` by name,
 * because a classic personal access token carries every project in the account
 * including ones created after it was issued.
 *
 * The workflow travels. A mirror clone receives the whole tree, so a
 * byte-identical copy sits in every clone repository today, where it can only
 * reach its own "check the credential this job needs" step and fail. That is
 * not harmless: a job that fails naming a missing setting is an invitation to
 * go and set it, and the remedy those messages invite is exactly the one the
 * architecture forbids.
 *
 * There used to be three of these. The two Builder Stock ones
 * (`set-builder-stock-link-secrets.yml`, `set-builder-stock-pdf-worker-secrets.yml`)
 * left with the Builder Portal (network extraction Phase 7): the functions and
 * Cloudflare workers they configured are deleted, so a workflow that could
 * only write secrets nothing reads was deleted rather than left dormant —
 * dormant, it is one dispatch away from writing a dead name into a live
 * project and reporting success.
 *
 * These tests EXECUTE the guard rather than reading it, which is also why each
 * guard compares in the shell instead of in a step `if:` expression: an
 * expression can only be asserted about, and a guard nobody has run is a guard
 * nobody has tested.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

/** The repository that holds the fleet's one Supabase management credential. */
const OWNER = 'Naidu-Group-Pty-Ltd/npc-property-dashbord';

const WORKFLOWS = [
  '.github/workflows/rotate-internal-edge-secret.yml',
];

const GUARD_STEP = '      - name: Refuse in a repository that does not own this configuration';

const read = (path: string) => readFileSync(path, 'utf8');

/**
 * The guard's own shell body, lifted out of the workflow.
 *
 * Taken from the file rather than restated here, so these tests cannot pass
 * against a script the runner would never execute.
 */
function guardScript(yaml: string): string {
  const step = yaml.indexOf(GUARD_STEP);
  expect(step, 'the ownership guard step is missing').toBeGreaterThan(-1);
  const runAt = yaml.indexOf('run: |', step);
  expect(runAt, 'the ownership guard has no run body').toBeGreaterThan(-1);

  const body: string[] = [];
  for (const line of yaml.slice(runAt).split('\n').slice(1)) {
    if (!line.startsWith('          ')) break;
    body.push(line.slice(10));
  }
  expect(body.length, 'the ownership guard body is empty').toBeGreaterThan(3);
  return body.join('\n');
}

type GuardRun = { code: number; output: string };

function runGuard(script: string, here: string, owner: string | null): GuardRun {
  const env: NodeJS.ProcessEnv = { ...process.env, HERE: here };
  if (owner === null) delete env.EDGE_SECRET_OWNER_REPO;
  else env.EDGE_SECRET_OWNER_REPO = owner;

  const r = spawnSync('bash', ['-c', script], { env, encoding: 'utf8' });
  return { code: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe.each(WORKFLOWS)('%s declares the deployment it configures', (path) => {
  const yaml = read(path);

  it('names the owning repository once, at workflow level', () => {
    // Once, so there is no second copy to drift from; at workflow level, so
    // every `run` step inherits it with no expression having to resolve.
    const declared = [...yaml.matchAll(/^ {2}EDGE_SECRET_OWNER_REPO: (\S+)$/gm)];
    expect(declared).toHaveLength(1);
    expect(declared[0][1]).toBe(OWNER);
    expect(yaml.indexOf('\nenv:\n')).toBeLessThan(yaml.indexOf('\njobs:\n'));
  });

  it('asks the ownership question before it asks for a confirmation', () => {
    // Being in the wrong repository is the more fundamental refusal, and
    // nobody should have to type the confirmation word to discover it.
    const guard = yaml.indexOf(GUARD_STEP);
    const confirm = yaml.indexOf('      - name: Refuse without an explicit confirmation');
    expect(guard).toBeGreaterThan(-1);
    expect(confirm).toBeGreaterThan(guard);
  });

  it('still reaches for the management credential it cannot do without', () => {
    // The guard narrows who may run this; it must not have replaced the
    // credential check, which is what makes an unconfigured owner fail loudly.
    expect(yaml).toContain('SUPABASE_ACCESS_TOKEN');
  });
});

describe.each(WORKFLOWS)('%s — the guard, executed', (path) => {
  const script = guardScript(read(path));

  it('lets the owning repository through', () => {
    const { code, output } = runGuard(script, OWNER, OWNER);
    expect(code).toBe(0);
    expect(output).toContain(OWNER);
  });

  it('refuses a clone, and sends it to Mission Control rather than to a credential', () => {
    const clone = 'Naidu-Group-Pty-Ltd/npc-client-dashboard';
    const { code, output } = runGuard(script, clone, OWNER);
    expect(code).toBe(1);
    expect(output).toContain('::error');
    expect(output).toContain(clone);
    expect(output).toContain(OWNER);
    // The whole point of the wording: it must not read as "go and set it".
    expect(output).toContain('Mission Control');
  });

  it('refuses a fork under another account', () => {
    // `github.repository` carries the account, so a fork is a different string
    // even where the repository name is identical.
    expect(runGuard(script, `someone-else/${OWNER.split('/')[1]}`, OWNER).code).toBe(1);
  });

  it('refuses when the owning repository is not declared at all', () => {
    // A renamed or deleted variable stops the job rather than waving it
    // through. This is the direction a guard is allowed to be wrong in.
    expect(runGuard(script, OWNER, null).code).toBe(1);
  });
});

describe('the deleted Builder Stock secrets workflows stay deleted', () => {
  // Phase 7 deleted the two workflows this file used to pin alongside the
  // rotation. Their targets are gone (`builder-stock-link-callback`, both
  // Cloudflare workers), so a restored copy could only write secrets nothing
  // reads — and its Cloudflare half named one shared worker on one account,
  // which every clone's byte-identical copy could rotate for everyone.
  it.each([
    '.github/workflows/set-builder-stock-link-secrets.yml',
    '.github/workflows/set-builder-stock-pdf-worker-secrets.yml',
  ])('%s does not exist', (path) => {
    expect(() => readFileSync(path)).toThrow();
  });
});
