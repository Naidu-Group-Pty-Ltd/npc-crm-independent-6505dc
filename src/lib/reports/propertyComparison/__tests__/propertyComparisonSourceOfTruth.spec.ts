/**
 * The Portfolio Performance Review must have exactly one implementation.
 *
 * The same guard the Snapshot and the Cash Flow projection carry, on the third
 * format. The reason here is the one this repo has already paid for: the
 * section registry was mirrored by hand into `src/lib/reports/` and drifted from
 * 672 lines to 174, and the Portfolio format is the largest of the three — nine
 * sections, two source tables, a normaliser that reads forty-odd fields
 * defensively. A hand-kept second copy of that would not drift eventually.
 *
 * The purity clause matters as much as the single-copy clause. These modules run
 * inside an Edge Function, so a `new Date()` anywhere in them would date a
 * client's report by the server's clock at render time rather than by the row's
 * own timestamps, and nothing about the resulting document would look wrong.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../../..');
const CANONICAL_DIR = resolve(REPO, 'supabase/functions/_shared/reports/propertyComparison');
const BRIDGE_DIR = resolve(REPO, 'src/lib/reports/propertyComparison');

const pureModules = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith('.pure.ts')).sort();

/** An optional block comment, then exactly one `export * from '…'`. */
const BRIDGE_SHAPE =
  /^(?:\/\*\*[\s\S]*?\*\/\s*)?export \* from '\.\.\/\.\.\/\.\.\/\.\.\/supabase\/functions\/_shared\/reports\/propertyComparison\/([\w.]+)\.pure\.ts';\s*$/;

/** Siblings, or the design system next door. Nothing else. *
 * `../reportDate.pure.ts` is the shared date reader, a file in the parent
 * like the others here — eleven routes each carried a private copy.
 */
const ALLOWED_IMPORT = /^(?:\.\/[\w.]+\.pure\.ts|\.\.\/\.\.\/reportDesign\/[\w.]+\.(?:pure|generated)\.ts|\.\.\/reportDate\.pure\.ts)$/;

describe('property comparison — single source of truth', () => {
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
