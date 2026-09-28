/**
 * A LANE ON A CLONE'S REPOSITORY IS ABOUT THAT CLONE'S PROJECT.
 *
 * `.github/scripts/**` reaches every clone's repository as the prime wrote it,
 * so a project ref typed into one of those scripts names the prime there.
 * Three lanes fell back to the prime's ref: `builder-network-sync-state`,
 * `builder-stock-mirror-state` and `builder-network-connection-remap`. Their
 * workflows pass no ref. On a clone, a dispatch with an access token read the
 * prime's database, and the remap lane, which writes, re-pointed the prime's
 * connection.
 *
 * `scripts/lib/projectRef.mjs` reads this checkout's own
 * `supabase/config.toml`, which is per deployment. This spec holds three
 * things: the reader's rules, the fact that this checkout names a project,
 * and the rule that no lane carries a literal.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { preambleProjectId, projectRef } from '../../../../scripts/lib/projectRef.mjs';

const A = 'abcdefghijklmnopqrst';
const B = 'tsrqponmlkjihgfedcba';

describe("the project a script is about", () => {
  it("reads project_id from the preamble", () => {
    expect(preambleProjectId(`# a comment\nproject_id = "${A}"\n\n[api]\nport = 54321\n`)).toBe(A);
    expect(preambleProjectId(`  project_id="${A}"`)).toBe(A);
  });

  it("never reads one from inside a section", () => {
    expect(preambleProjectId(`[functions.x]\nproject_id = "${A}"\n`)).toBeNull();
  });

  it("ignores a commented-out declaration", () => {
    expect(preambleProjectId(`# project_id = "${A}"\n[api]\n`)).toBeNull();
  });

  it("treats a value that is not a project ref as absent", () => {
    for (const bad of ['', 'short', A.toUpperCase(), `${A}x`, 'abcdefghij.lmnopqrst']) {
      expect(preambleProjectId(`project_id = "${bad}"\n`)).toBeNull();
    }
  });

  it("takes the environment first, SUPABASE_PROJECT_REF before PROJECT_REF", () => {
    const config = () => `project_id = "${A}"\n`;
    expect(projectRef({ PROJECT_REF: B }, config)).toBe(B);
    expect(projectRef({ SUPABASE_PROJECT_REF: B, PROJECT_REF: A }, config)).toBe(B);
  });

  it("refuses a given value that is not a ref, rather than falling back past it", () => {
    expect(projectRef({ PROJECT_REF: 'not a ref' }, () => `project_id = "${A}"\n`)).toBeNull();
  });

  it("falls back to this checkout's config, and to null when there is none", () => {
    expect(projectRef({}, () => `project_id = "${A}"\n`)).toBe(A);
    expect(projectRef({ PROJECT_REF: '  ' }, () => `project_id = "${A}"\n`)).toBe(A);
    expect(projectRef({}, () => { throw new Error('ENOENT'); })).toBeNull();
    expect(projectRef({}, () => '[api]\n')).toBeNull();
  });

  it("finds this checkout's own project", () => {
    const ref = projectRef({});
    expect(ref).toMatch(/^[a-z]{20}$/);
    expect(ref).toBe(preambleProjectId(readFileSync('supabase/config.toml', 'utf8')));
  });
});

describe("the lanes under .github/scripts", () => {
  const lanes = readdirSync('.github/scripts')
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => ({ name, source: readFileSync(`.github/scripts/${name}`, 'utf8') }));

  it("are read at all", () => {
    expect(lanes.length).toBeGreaterThan(0);
  });

  it("carry no project ref as a literal", () => {
    const offenders = lanes
      .filter(({ source }) => /['"`][a-z]{20}['"`]/.test(source))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  it("read the project through the shared reader where they name one", () => {
    for (const name of [
      'builder-network-connection-remap.mjs',
      'builder-network-sync-state.mjs',
      'builder-stock-mirror-state.mjs',
    ]) {
      const lane = lanes.find((l) => l.name === name);
      expect(lane, name).toBeDefined();
      expect(lane!.source, name).toContain("from '../../scripts/lib/projectRef.mjs'");
      expect(lane!.source, name).toMatch(/const REF = projectRef\(process\.env\);\s*if \(!REF\)/);
    }
  });
});
