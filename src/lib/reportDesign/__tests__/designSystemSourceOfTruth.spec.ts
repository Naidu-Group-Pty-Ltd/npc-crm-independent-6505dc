/**
 * The report design system must have exactly one implementation.
 *
 * Two failure modes this guards against, both of which have already happened in
 * this repo:
 *
 *  1. **A bridge grows logic.** `src/lib/reportDesign/*.pure.ts` must be nothing
 *     but a re-export. The moment one gains a helper "just for the frontend",
 *     the app and the Edge Functions disagree about what a colour is.
 *  2. **The two directories drift apart.** `compassSectionRegistry.ts` is
 *     mirrored by hand into `src/lib/reports/` and `_shared/`, and
 *     `docs/COMPASS_40_PAGE_ARCHITECTURE.md` states they "must stay in sync" —
 *     they are now 672 lines against 174. Nothing enforced it.
 *
 * Structural assertions, not snapshots, so this guards from the first run.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../..');
const CANONICAL_DIR = resolve(REPO, 'supabase/functions/_shared/reportDesign');
const BRIDGE_DIR = resolve(REPO, 'src/lib/reportDesign');

const pureModules = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith('.pure.ts')).sort();

/** An optional block comment, then exactly one `export * from '…'`. */
const BRIDGE_SHAPE =
  /^(?:\/\*\*[\s\S]*?\*\/\s*)?export \* from '\.\.\/\.\.\/\.\.\/supabase\/functions\/_shared\/reportDesign\/([\w.]+)\.pure\.ts';\s*$/;

describe('report design system — single source of truth', () => {
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
        `${file} must contain nothing but a doc comment and one `
          + `\`export * from '../../../supabase/functions/_shared/reportDesign/<name>.pure.ts';\``,
      ).not.toBeNull();
      expect(`${match![1]}.pure.ts`).toBe(file);
    });

    it('declares no logic of its own', () => {
      // Assert on code, not prose — the doc comment legitimately contains the
      // words "import" and "export" while explaining why the bridge exists.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // `export *` is the only export form allowed; anything else is an
      // implementation living in the wrong place.
      expect(code).not.toMatch(/export (?:const|function|class|interface|type|default)\b/);
      expect(code).not.toMatch(/^\s*import\b/m);
    });
  });

  describe.each(pureModules(CANONICAL_DIR))('canonical %s', (file) => {
    const source = readFileSync(resolve(CANONICAL_DIR, file), 'utf8');

    /**
     * Anchored to the start of a line and to an `import`/`export` keyword.
     *
     * `/from '([^']+)'/` on its own matches ordinary prose: a comment whose
     * line happens to end on the word "from" pairs with the opening quote of
     * the next concatenated string, and the guard reports that a canonical
     * module imports `\n      + `. It happened, on a sentence about
     * hyphenation.
     */
    const importSpecs = (code: string): string[] =>
      [...code.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom '([^']+)'/gm)].map((m) => m[1]);

    /*
     * The rule is that a canonical module imports only a RELATIVE `.pure.ts`
     * path — no `@/` alias, no npm package, no module with side effects — so
     * Deno and Vite both resolve it.
     *
     * It used to require a SIBLING (`^\./`), on the stated reason that "Edge
     * Functions cannot resolve anything else", and that reason is not true: a
     * relative path into another `_shared` directory resolves in Deno exactly
     * as a sibling does, which `check-edge-functions.mjs` confirms by type-
     * checking all 413 entry points. The sibling form was blocking
     * `companyBlock.pure.ts` from asking `issuerIdentity.pure.ts` who the
     * issuer is — and the cost of not asking was two answers in one document:
     * "Aurixa Systems" on the issuer line and "Property Consulting", a name
     * that module lists as the ABSENCE of a brand, in the running foot of
     * every page.
     *
     * The replacement is stricter, not looser: the path must still be
     * relative, must still end `.pure.ts`, and must now RESOLVE ON DISK, which
     * the sibling pattern never checked.
     */
    it('imports only relative .pure modules, and every one of them exists', () => {
      const imports = importSpecs(source);
      for (const spec of imports) {
        expect(
          spec,
          `${file} imports "${spec}" — canonical modules may only import `
            + 'relative .pure.ts modules (an alias or a package is not resolvable from an Edge Function)',
        ).toMatch(/^\.{1,2}\/(?:[\w.-]+\/)*[\w.-]+\.pure\.ts$/);
        expect(
          existsSync(resolve(CANONICAL_DIR, spec)),
          `${file} imports "${spec}", which does not exist`,
        ).toBe(true);
      }
    });

    it('uses explicit .ts extensions on relative imports (Deno requires them)', () => {
      const relative = importSpecs(source).filter((spec) => spec.startsWith('.'));
      for (const spec of relative) expect(spec.endsWith('.ts')).toBe(true);
    });
  });
});
