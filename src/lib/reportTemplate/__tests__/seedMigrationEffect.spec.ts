/**
 * The seed migration's drift guard is EMITTED, not hand-added.
 *
 * The seed migration — whichever release `RELEASE_ID` currently names — opens
 * with an `@effect:` probe — a lone SELECT stating what is true once the migration has run.
 * `scripts/ops/migration-drift.mjs` needs it because this migration **creates
 * no object**, so there is nothing for drift detection to count and it would
 * be reported as unverifiable. Its own comment records the cost of that:
 * *"which is exactly how seed v18 merged to main, never landed, and left every
 * report printing the heading it was written to fix."*
 *
 * **The generator did not emit it.** So the first thing the documented
 * workflow does — `CLAUDE.md`: *"never hand-edit the generated migration —
 * edit the source and run `npm run templates:library:seed`"* — was silently
 * delete the guard that exists because a seed once merged without landing.
 * Measured: a seed run on an unchanged tree produced an 8-line deletion and
 * nothing else, and produces none now.
 *
 * These assertions are over the committed FILE and the generator SOURCE
 * together, because either one alone can be right while the pair disagrees —
 * which is the state this closes. Regenerating is the real guarantee and is
 * too slow for a unit test (543 templates, 40 MB); these two catch the
 * deletion by any route.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationNames, migrationText } from '../../testSupport/migrationCorpus';
import { TREE_IS_PRIME } from '../../testSupport/primeTree';

const REPO = resolve(__dirname, '../../../..');
const MIGRATIONS = resolve(REPO, 'supabase/migrations');
const GENERATOR = resolve(REPO, 'scripts/template-library/buildSeedCatalogue.ts');

const generatorSource = readFileSync(GENERATOR, 'utf8');

/** The release the generator declares, read from its own constant. */
const releaseId = (() => {
  const m = /const RELEASE_ID = '([^']+)'/.exec(generatorSource);
  if (!m) throw new Error('buildSeedCatalogue.ts no longer declares RELEASE_ID');
  return m[1];
})();

const seedFile = `${releaseId}.sql`;

// The committed seed is the prime's alone. Seed v20 is 42.2 MB and GitHub
// refuses the cascade's write of it, so a clone holds the generator this reads
// and never the file (see `testSupport/primeTree.ts`). The generator half below
// holds wherever it is carried.
describe.runIf(TREE_IS_PRIME)('the seed migration declares what it did', () => {
  it('is named for the release the generator declares', () => {
    expect(migrationNames()).toContain(seedFile);
  });

  it('opens with an @effect probe naming that release', () => {
    const first = migrationText(seedFile).split('\n')[0];
    expect(first).toMatch(/^-- @effect: select 1 from /);
    expect(first).toContain(releaseId);
  });

  it('the probe is a lone SELECT, which is all the runner will execute', () => {
    const first = migrationText(seedFile).split('\n')[0];
    const probe = first.replace(/^-- @effect:\s*/, '');
    expect(probe.toLowerCase().startsWith('select ')).toBe(true);
    expect(probe).not.toMatch(/;|\binsert\b|\bupdate\b|\bdelete\b|\bdrop\b|\balter\b/i);
  });

  it('asserts the table the migration actually writes', () => {
    const sql = migrationText(seedFile);
    const probe = sql.split('\n')[0];
    const m = /from\s+([a-z_.]+)/i.exec(probe);
    expect(m, 'the probe names no table').not.toBeNull();
    // The migration must INSERT into whatever the probe SELECTs from, or the
    // probe asserts something this file does not do.
    expect(sql).toMatch(new RegExp(`INSERT INTO ${m![1].replace(/\./g, '\\.')}\\b`, 'i'));
  });
});

describe('the generator emits it, so regenerating cannot drop it', () => {
  it('writes the @effect line into the SQL it produces', () => {
    expect(generatorSource).toMatch(/-- @effect: select 1 from [a-z_.]+ where release = '\$\{RELEASE_ID\}'/);
  });

  it('derives the release from RELEASE_ID rather than restating it', () => {
    // A second literal is how the probe and the rows it asserts about come to
    // name different releases.
    const emitted = generatorSource.match(/-- @effect: select 1 from [^\n]*/g) ?? [];
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toContain('${RELEASE_ID}');
    expect(emitted[0]).not.toContain(releaseId);
  });

  it('still tells a reader never to hand-edit the generated file', () => {
    expect(generatorSource).toMatch(/Do not hand-edit/i);
  });
});
