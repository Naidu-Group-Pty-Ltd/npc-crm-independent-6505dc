/**
 * The gate in `testSupport/primeTree.ts` decides whether the assertions about
 * the prime's own files run at all, so it must never close quietly where they
 * belong. A gate that could go shut on the prime would turn those assertions
 * into skips and report the run green.
 *
 * The other half is that a spec which needs the gate must use it. The last
 * describe below holds every spec in the suite to that for the one class of
 * file measured so far: a template-library seed too large for the cascade.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CASCADE_FILE_LIMIT_BYTES,
  TREE_IS_PRIME,
  declaredProjectRef,
} from '../../testSupport/primeTree';

const REPO = resolve(__dirname, '../../../..');
const MIGRATIONS = resolve(REPO, 'supabase/migrations');

/** Every file the suite runs: vitest includes `src/**` + `/*.{test,spec}.{ts,tsx}`. */
function specFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return specFiles(path);
    return /\.(test|spec)\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** The source without whole-line comments: a comment that names a seed reads nothing. */
function codeOf(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

/**
 * Whether code picks a seed by its version number. The newest seed a clone
 * holds is never the prime's newest: every seed from v20 on is over the
 * cascade's limit, so on a clone "the newest" is v19.
 */
const picksSeedByVersion = (code: string) => /seed_template_library_v[(\\[]/.test(code);

/** The seed files code names, `.sql` and all. A release name alone is an identifier, not a read. */
const seedFilesNamed = (code: string) =>
  [...code.matchAll(/\b(\d{14}_seed_template_library_v\d+_[a-z0-9_]+\.sql)\b/g)].map((m) => m[1]);

/** Whether the cascade carries a migration file: present here, and no larger than it can write. */
function carried(file: string): boolean {
  try {
    return statSync(join(MIGRATIONS, file)).size <= CASCADE_FILE_LIMIT_BYTES;
  } catch {
    // Absent from this tree, which on a clone is exactly what an uncarried file is.
    return false;
  }
}

const gated = (code: string) => /\.runIf\(\s*TREE_IS_PRIME\s*\)/.test(code);

describe('the prime-tree gate', () => {
  it('reads the project a config declares, and refuses a config that declares none', () => {
    expect(declaredProjectRef('project_id = "abcdefghijklmnopqrst"\n\n[api]\nport = 54321\n')).toBe(
      'abcdefghijklmnopqrst',
    );
    expect(() => declaredProjectRef('[api]\nport = 54321\n')).toThrow(/declares no project_id/);
  });

  // GitHub sets GITHUB_REPOSITORY on every Actions run. On the prime's own runs
  // the gate must be open; on a clone's runs, and locally, this says nothing.
  it.runIf(process.env.GITHUB_REPOSITORY?.toLowerCase() === 'naidu-group-pty-ltd/npc-property-dashbord')(
    "is open on the prime's own CI, so the assertions it gates run there",
    () => {
      expect(TREE_IS_PRIME).toBe(true);
    },
  );
});

/*
 * A spec that reads a seed the cascade cannot carry is a statement about the
 * prime's tree. On 26 Sep 2026 one picked "the newest seed" by version number,
 * read v19 on the clone that received it and asserted v23. That failed the
 * cascade pull request into npc-client-dashboard (#264), which held back the
 * two clones queued behind it. Two specs were already gated for exactly this
 * (`seedMigrationEffect.spec.ts`, `migrationSeedSkeletons.spec.ts`), and
 * nothing asked the next one to be.
 *
 * What this can see: a spec that picks a seed by its version number, and a
 * spec that names a seed file the cascade does not carry. A seed name built at
 * run time from a generator's declaration (`seedMigrationEffect.spec.ts`) is
 * beyond it, and that spec is gated by hand.
 */
describe('a spec that reads a seed a clone never holds', () => {
  it('stands down outside the prime', () => {
    const offenders = specFiles(resolve(REPO, 'src'))
      // This file names the patterns it looks for.
      .filter((file) => resolve(file) !== resolve(__filename))
      .flatMap((file) => {
        const code = codeOf(readFileSync(file, 'utf8'));
        const reasons = [
          ...(picksSeedByVersion(code) ? ['picks a seed by its version number'] : []),
          ...seedFilesNamed(code)
            .filter((seed) => !carried(seed))
            .map((seed) => `names ${seed}, which the cascade does not carry`),
        ];
        return reasons.length > 0 && !gated(code)
          ? [`${relative(REPO, file)}: ${reasons.join('; ')}`]
          : [];
      });
    expect(offenders).toEqual([]);
  });

  it('sees the spec that failed the npc-client-dashboard cascade, as it stood before it was gated', () => {
    const before = `
      it('is what the newest seed carries too', () => {
        const newest = readdirSync(dir)
          .map((f) => ({ f, v: Number(/_seed_template_library_v(\\d+)_/.exec(f)?.[1] ?? NaN) }))
          .sort((a, b) => b.v - a.v)[0];
        expect(newest.v).toBeGreaterThanOrEqual(23);
      });`;
    expect(picksSeedByVersion(codeOf(before))).toBe(true);
    expect(gated(before)).toBe(false);
    expect(gated(before.replace("it('is", "it.runIf(TREE_IS_PRIME)('is"))).toBe(true);
  });

  it('reads the cascade limit off the seeds it was measured on', () => {
    // v19 is carried and v20 is not. Both hold on either tree: on the prime v20
    // is present and over the limit, and on a clone it is absent.
    expect(carried('20261212000000_seed_template_library_v19_placeholder_words.sql')).toBe(true);
    expect(carried('20261219060000_seed_template_library_v20_continuous_front_matter.sql')).toBe(false);
    // A comment naming a seed reads nothing; code naming one does.
    expect(seedFilesNamed(codeOf('// 20261219060000_seed_template_library_v20_continuous_front_matter.sql'))).toEqual([]);
    expect(
      seedFilesNamed("read('supabase/migrations/20261219060000_seed_template_library_v20_continuous_front_matter.sql')"),
    ).toEqual(['20261219060000_seed_template_library_v20_continuous_front_matter.sql']);
  });
});
