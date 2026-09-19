/**
 * The Cash Flow Comparison must have exactly one implementation.
 *
 * The same guard the four formats before it carry, with one deliberate
 * relaxation: a module here may import `../cashFlow/*.pure.ts` as well as its
 * own siblings.
 *
 * That is not a loophole, it is the design. This format's payload is N of the
 * 10 Year Cash Flow's payload — a `ComparedProperty` holds a
 * `CashFlowProjection` and the normaliser calls `buildProjection` once per
 * property. Declaring a second, comparison-flavoured projected year would create
 * two answers to "what is a projected year", and the two would drift on the
 * first field either side added.
 *
 * The rule the original states — "Edge Functions cannot resolve it" — does not
 * bite: `../cashFlow/` is inside `_shared`, so the edge runtime resolves it the
 * same way it resolves a sibling. The allowance is exactly that one directory,
 * asserted below, so it cannot quietly become "any other format".
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../../..');
const CANONICAL_DIR = resolve(REPO, 'supabase/functions/_shared/reports/cashFlowComparison');
const BRIDGE_DIR = resolve(REPO, 'src/lib/reports/cashFlowComparison');

const pureModules = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith('.pure.ts')).sort();

/** An optional block comment, then exactly one `export * from '…'`. */
const BRIDGE_SHAPE =
  /^(?:\/\*\*[\s\S]*?\*\/\s*)?export \* from '\.\.\/\.\.\/\.\.\/\.\.\/supabase\/functions\/_shared\/reports\/cashFlowComparison\/([\w.]+)\.pure\.ts';\s*$/;

/**
 * Siblings, the design system next door, the format this one is N of, and the
 * shared text helpers.
 *
 * `../text.pure.ts` is not another format — it is `_shared/reports/text.pure.ts`,
 * where `neutraliseUrls` moved when the Report Q&A export became the second
 * caller. A file, not a directory, which is what stops this reading as "the
 * parent directory is open now".
 *
 * `../reportDate.pure.ts` is the shared date reader, a file in the parent
 * like the others here — eleven routes each carried a private copy.
 */
const ALLOWED_IMPORT =
  /^(?:\.\/[\w.]+\.pure\.ts|\.\.\/\.\.\/reportDesign\/[\w.]+\.(?:pure|generated)\.ts|\.\.\/cashFlow\/[\w.]+\.pure\.ts|\.\.\/text\.pure\.ts|\.\.\/reportDate\.pure\.ts)$/;

describe('cash flow comparison — single source of truth', () => {
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

    it('imports only siblings, the design system, or the cash flow format', () => {
      // Specifiers only. The four specs this was copied from match `from '…'`
      // anywhere in the file, which also matches *prose* — a doc comment whose
      // line happens to end "…are calculated from '" reads as an import of a
      // newline. Found by writing one. A module path has no whitespace in it,
      // which is enough to tell the two apart.
      const imports = [...source.matchAll(/from '([^']+)'/g)]
        .map((m) => m[1])
        .filter((spec) => !/\s/.test(spec));
      for (const spec of imports) {
        expect(
          spec,
          `${file} imports "${spec}" — a module here may import its siblings, `
            + '`../../reportDesign/*.pure.ts` and `../cashFlow/*.pure.ts`, and nothing else',
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

  /**
   * The relaxation is narrow, and this is what keeps it narrow.
   *
   * Without it, `ALLOWED_IMPORT` could be widened to `../<anything>/` by someone
   * reading it as "other formats are fine now" — which would make every format's
   * payload reachable from every other and undo the reason the rule exists.
   */
  it('permits exactly one other format, by name', () => {
    const spec = readFileSync(resolve(__dirname, 'cashFlowComparisonSourceOfTruth.spec.ts'), 'utf8');
    const pattern = /const ALLOWED_IMPORT =\s*([\s\S]*?);/.exec(spec)?.[1] ?? '';
    expect(pattern).toContain('cashFlow');
    for (const other of ['portfolio', 'propertyComparison', 'borrowingCapacity']) {
      expect(pattern, `the import rule now admits ${other}`).not.toContain(other);
    }
  });
});
