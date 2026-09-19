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
const CANONICAL_DIR = resolve(REPO, 'supabase/functions/_shared/reports/clientDetails');
const BRIDGE_DIR = resolve(REPO, 'src/lib/reports/clientDetails');

const pureModules = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith('.pure.ts')).sort();

/** An optional block comment, then exactly one `export * from '…'`. */
const BRIDGE_SHAPE =
  /^(?:\/\*\*[\s\S]*?\*\/\s*)?export \* from '\.\.\/\.\.\/\.\.\/\.\.\/supabase\/functions\/_shared\/reports\/clientDetails\/([\w.]+)\.pure\.ts';\s*$/;

/**
 * Siblings, the design system next door, or `_shared/clientName.ts`. Nothing
 * else.
 *
 * The third is named one file at a time rather than as `../../*.ts`, for the
 * reason the cash flow allowance is named one directory at a time: an
 * allowance that cannot be enumerated stops being a boundary.
 *
 * It earns its place on this rule's own logic. The constraint is that the edge
 * runtime must resolve every import, and `clientName.ts` is inside `_shared`
 * exactly as `reportDesign/` is — the render routes already import it there.
 * What it holds is the repo's one casing rule for a person's name, which
 * exists because two report routes each invented their own spelling of these
 * columns and one of them 404'd for every client in the database. This format
 * printing "sachin mathew" while the legacy generator printed "Sachin Mathew"
 * was the same class of divergence, and the fix is to share that function
 * rather than to restate it here.
 *
 * `../reportDate.pure.ts` is the shared date reader, a file in the parent
 * like the others here — eleven routes each carried a private copy.
 */
const ALLOWED_IMPORT =
  /^(?:\.\/[\w.]+\.pure\.ts|\.\.\/\.\.\/reportDesign\/[\w.]+\.(?:pure|generated)\.ts|\.\.\/\.\.\/clientName\.ts|\.\.\/reportDate\.pure\.ts)$/;

describe('client details — single source of truth', () => {
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

    it('imports only siblings, the design system, or the shared name rule', () => {
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
            + '`../../reportDesign/*.pure.ts` and `../../clientName.ts`, and nothing else',
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
   * `finance.pure.ts` is a body-move out of `src/utils/householdFinance.ts`, and
   * this is what stops a second copy reappearing there.
   *
   * The browser file may bind the HECS estimator — a pure module cannot reach
   * the policy engine — but it may not compute income, servicing or property
   * expenditure of its own. Those three had two implementations once already,
   * one of which quietly omitted LMI; that is the defect this move removes.
   */
  it('the browser file binds the finance engine rather than reimplementing it', () => {
    const browser = readFileSync(resolve(REPO, 'src/utils/householdFinance.ts'), 'utf8');
    expect(browser).toContain("from '@/lib/reports/clientDetails/finance.pure'");
    const code = browser.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // The one binding it is allowed to add, and nothing else.
    expect(code).toContain('hecsMonthlyFor: getHecsRepayment');
    for (const owned of ['byContact', 'ASSUMED_TERMS', 'estimatePIRepayment', 'sumTrueHolding']) {
      expect(code, `householdFinance.ts has taken back ${owned}`).not.toContain(owned);
    }
  });
});
