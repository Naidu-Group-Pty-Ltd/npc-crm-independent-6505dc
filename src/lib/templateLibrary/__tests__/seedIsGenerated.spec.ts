/**
 * The seeded catalogue is generated, and something has to say so out loud.
 *
 * `buildSeedCatalogue.ts` writes a 40 MB migration from the template
 * definitions, and until 22 September 2026 **nothing compared the two**. The
 * generator could be run or not run and the repository looked identical either
 * way — so seed v19 was written, four commits changed what the definitions
 * produce, and the migration still carried the old geometry for 301 of its 543
 * templates. The migration is what a deployment applies, so a fix that reaches
 * only the definitions reaches no document at all.
 *
 * `npm run templates:library:seed:check` is the comparison. This file asserts
 * that the comparison EXISTS and that CI runs it, which is the rule
 * `builderPortalUiMounted.spec.ts` was written for: a check nothing invokes is
 * dead code that typechecks, lints and ships.
 *
 * It deliberately does not run the generator — that is a minute of work and
 * 40 MB of output, and it is the CI step's job. What is asserted here is the
 * wiring, because the wiring is what went missing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = resolve(__dirname, '../../../..');
const read = (p: string) => readFileSync(resolve(REPO, p), 'utf-8');

describe('the seeded catalogue is compared to what generates it', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

  it('offers a check mode beside the write mode', () => {
    expect(pkg.scripts['templates:library:seed']).toBeTruthy();
    const check = pkg.scripts['templates:library:seed:check'];
    expect(check).toBeTruthy();
    // The same builder, so the two can never derive the SQL differently —
    // a second implementation is how two ends drift.
    expect(check).toContain('scripts/template-library/buildSeedCatalogue.ts');
    expect(check).toContain('--check');
  });

  it('is run by CI, in the job that already renders the masters', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('npm run templates:library:seed:check');

    // In `template-geometry`: that job renders the DEFINITIONS, and this asks
    // whether the migration says the same thing. The two questions belong
    // together and the job already has Node and the dependencies installed.
    const job = ci.slice(ci.indexOf('\n  template-geometry:'));
    const nextJob = job.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
    const body = nextJob === -1 ? job : job.slice(0, nextJob + 1);
    expect(body).toContain('npm run templates:library:seed:check');
  });

  it('reports a stale seed even when the render gate has already failed', () => {
    const ci = read('.github/workflows/ci.yml');
    const at = ci.indexOf('npm run templates:library:seed:check');
    expect(at).toBeGreaterThan(-1);
    // `always()` so a stale seed and a geometry failure are both reported by
    // one run rather than the first hiding the second.
    const preamble = ci.slice(Math.max(0, at - 400), at);
    expect(preamble).toContain('if: always()');
  });

  it('compares the artefact rather than a count', () => {
    const builder = read('scripts/template-library/buildSeedCatalogue.ts');
    // A count baseline absorbs a change — one master gains a block while
    // another loses one and the number holds. This is the lesson
    // `check-edge-functions.mjs` paid for, so the check reads the file and
    // compares it to the SQL it just built.
    expect(builder).toContain('readFileSync(MIGRATION');
    expect(builder).toMatch(/onDisk === fresh/);
    // And a difference names templates, because a 40 MB diff sends nobody to
    // a remedy.
    expect(builder).toContain('npm run templates:library:seed');
    expect(builder).toMatch(/templates differ/);
  });

  it('treats a migration that was never written as drift, not as a pass', () => {
    const builder = read('scripts/template-library/buildSeedCatalogue.ts');
    expect(builder).toMatch(/existsSync\(MIGRATION\)/);
    expect(builder).toMatch(/has never been written/);
  });

  it('refuses rather than warns', () => {
    const builder = read('scripts/template-library/buildSeedCatalogue.ts');
    // Two exits, measured before this was trusted: 1 on the stale file, 0 on
    // the fresh one. A check that cannot fail a build is a comment.
    const drift = builder.slice(builder.indexOf('function reportDrift'));
    expect(drift.slice(0, drift.indexOf('\nfunction main'))).toContain('process.exit(1)');
  });

  it('stands only the currency comparison down where the seed is carried, not authored', () => {
    const builder = read('scripts/template-library/buildSeedCatalogue.ts');
    // The marker the object index and the seed skeletons stand down on. A seed
    // past what a cascade carries in one file never reaches a clone, so this
    // comparison said "never written" about a seed the prime wrote — the one
    // red check on npc-client-dashboard#245 on 24 Sep 2026, and Mission
    // Control merges no cascade pull request with a red check. It FAILS
    // CLOSED: an equality on the one value, so unset means assert.
    expect(builder).toContain("env.BACKEND_DEPLOYED_BY === 'mission-control'");

    // The templates are still validated on every repository: the refusal on
    // a problem comes before the stand-down, and the stand-down comes before
    // the comparison it skips.
    const main = builder.slice(builder.indexOf('\nfunction main'));
    const refusal = main.indexOf('problems.length > 0');
    const standDown = main.indexOf('seedIsCarriedNotAuthored()');
    const comparison = main.indexOf('reportDrift(sql)');
    expect(refusal).toBeGreaterThan(-1);
    expect(standDown).toBeGreaterThan(refusal);
    expect(comparison).toBeGreaterThan(standDown);

    // And the step hands it the value, or it reads `undefined` and fails
    // closed on every clone — the starvation the object index shipped with.
    // `check-gate-env-wiring.mjs` holds the same line from the security job.
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain(
      'BACKEND_DEPLOYED_BY: ${{ vars.BACKEND_DEPLOYED_BY }}\n'
      + '        run: npm run templates:library:seed:check',
    );
  });
});
