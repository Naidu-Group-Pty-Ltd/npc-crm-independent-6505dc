/**
 * The Commercial Capacity payload must have exactly one implementation.
 *
 * The same guard `borrowingCapacitySourceOfTruth.spec.ts` puts on the Snapshot,
 * applied here from the first day rather than after the fifth copy. That format
 * reached five implementations of one document precisely because each new
 * surface started with "just the frontend's version of the payload".
 *
 * A format module may import the design system, because the renderer needs it.
 * It may not import anything else: Edge Functions resolve relative `.ts` paths
 * and nothing more, so an `@/` import here is a module that type-checks in the
 * app and fails to boot in Deno.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../../..');
const CANONICAL_DIR = resolve(REPO, 'supabase/functions/_shared/reports/commercialCapacity');
const BRIDGE_DIR = resolve(REPO, 'src/lib/reports/commercialCapacity');

const pureModules = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith('.pure.ts')).sort();

/** An optional block comment, then exactly one `export * from '…'`. */
const BRIDGE_SHAPE =
  /^(?:\/\*\*[\s\S]*?\*\/\s*)?export \* from '\.\.\/\.\.\/\.\.\/\.\.\/supabase\/functions\/_shared\/reports\/commercialCapacity\/([\w.]+)\.pure\.ts';\s*$/;

/** Siblings, or the design system next door. Nothing else. *
 * `../reportDate.pure.ts` is the shared date reader, a file in the parent
 * like the others here — eleven routes each carried a private copy.
 */
const ALLOWED_IMPORT = /^(?:\.\/[\w.]+\.pure\.ts|\.\.\/\.\.\/reportDesign\/[\w.]+\.(?:pure|generated)\.ts|\.\.\/reportDate\.pure\.ts)$/;

describe('commercial capacity payload — single source of truth', () => {
  it('has at least one canonical module', () => {
    expect(pureModules(CANONICAL_DIR).length).toBeGreaterThan(0);
  });

  it('exposes exactly one bridge per canonical module, and no extras', () => {
    expect(pureModules(BRIDGE_DIR)).toEqual(pureModules(CANONICAL_DIR));
  });

  describe.each(pureModules(BRIDGE_DIR))('bridge %s', (file) => {
    const source = readFileSync(resolve(BRIDGE_DIR, file), 'utf8');

    it('is only a re-export of its canonical module', () => {
      const match = source.match(BRIDGE_SHAPE);
      expect(
        match,
        `${file} must contain nothing but a doc comment and one \`export *\` of its canonical module`,
      ).not.toBeNull();
      expect(`${match![1]}.pure.ts`).toBe(file);
    });

    it('declares no logic of its own', () => {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(/export (?:const|function|class|interface|type|default)\b/);
      expect(code).not.toMatch(/^\s*import\b/m);
    });
  });

  describe.each(pureModules(CANONICAL_DIR))('canonical %s', (file) => {
    const source = readFileSync(resolve(CANONICAL_DIR, file), 'utf8');

    it('imports only sibling .pure modules or the design system', () => {
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(
          spec,
          `${file} imports "${spec}" — a format module may import its siblings and `
            + '`../../reportDesign/*.pure.ts`, and nothing else (Edge Functions cannot resolve it)',
        ).toMatch(ALLOWED_IMPORT);
      }
    });

    it('is pure — no clock, no randomness, no I/O', () => {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const forbidden of ['Date.now(', 'new Date(', 'Math.random(', 'fetch(', 'localStorage']) {
        expect(code, `${file} uses ${forbidden} — pass it in as an argument instead`).not.toContain(forbidden);
      }
    });
  });
});
