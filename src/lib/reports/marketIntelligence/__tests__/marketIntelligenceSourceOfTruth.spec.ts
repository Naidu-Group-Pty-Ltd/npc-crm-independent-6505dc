/**
 * The Market Intelligence export must have exactly one implementation.
 *
 * The same guard the seven formats before it carry. The relaxation is the
 * shared `../markdown.pure.ts` and `../text.pure.ts` — files, not a directory,
 * which is what stops it reading as "the parent directory is open now". The
 * assertion at the bottom pins that.
 *
 * `../../reportDesign/measure.pure.ts` is in the allow-list for the same reason
 * it is everywhere else: the renderer groups thousands with `formatMeasure`
 * rather than `toLocaleString`, because Deno and Node do not have to agree on
 * ICU grouping and the string is asserted in a test.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../../..');
const CANONICAL_DIR = resolve(REPO, 'supabase/functions/_shared/reports/marketIntelligence');
const BRIDGE_DIR = resolve(REPO, 'src/lib/reports/marketIntelligence');

const pureModules = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith('.pure.ts')).sort();

/** An optional block comment, then exactly one `export * from '…'`. */
const BRIDGE_SHAPE =
  /^(?:\/\*\*[\s\S]*?\*\/\s*)?export \* from '\.\.\/\.\.\/\.\.\/\.\.\/supabase\/functions\/_shared\/reports\/marketIntelligence\/([\w.]+)\.pure\.ts';\s*$/;

/** Siblings, the design system next door, or the two shared helpers. *
 * `../reportDate.pure.ts` is the shared date reader, a file in the parent
 * like the others here — eleven routes each carried a private copy.
 */
const ALLOWED_IMPORT =
  /^(?:\.\/[\w.]+\.pure\.ts|\.\.\/\.\.\/reportDesign\/[\w.]+\.(?:pure|generated)\.ts|\.\.\/(?:text|markdown|reportDate)\.pure\.ts)$/;

describe('market intelligence — single source of truth', () => {
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

    it('imports only siblings, the design system, or the shared helpers', () => {
      // Specifiers only. Matching `from '…'` anywhere in the file also matches
      // *prose* — a doc comment whose line happens to end "…carried verbatim
      // from '" reads as an import of a newline. A module path has no
      // whitespace in it, which is enough to tell the two apart.
      const imports = [...source.matchAll(/from '([^']+)'/g)]
        .map((m) => m[1])
        .filter((spec) => !/\s/.test(spec));
      for (const spec of imports) {
        expect(
          spec,
          `${file} imports "${spec}" — a module here may import its siblings, `
            + '`../../reportDesign/*.pure.ts` and the shared `../text|markdown.pure.ts`, and nothing else',
        ).toMatch(ALLOWED_IMPORT);
      }
    });

    it('is pure — no clock, no randomness, no I/O', () => {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const forbidden of ['Date.now(', 'new Date(', 'Math.random(', 'fetch(', 'localStorage', 'Deno.']) {
        expect(code, `${file} uses ${forbidden} — pass it in as an argument instead`).not.toContain(forbidden);
      }
    });

    it('formats numbers without the runtime locale', () => {
      // `measure.pure.ts:121` records why: the same payload is formatted in Deno
      // and in Node, their ICU builds do not have to agree, and a golden that
      // depends on the runtime's locale data fails on someone else's machine.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, `${file} uses toLocaleString — use formatMeasure(count(…))`)
        .not.toContain('toLocaleString');
    });

    it('draws no PDF of its own', () => {
      // Comments are stripped first, and that is not a detail. These modules'
      // doc comments *name* the library they replace, because naming what they
      // replace is how the reasoning survives.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const library of ['jspdf', 'jsPDF', 'pdf-lib', 'html2canvas', 'PDFDocument']) {
        expect(code, `${file} references ${library}`).not.toContain(library);
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
  it('permits the shared helpers and no other format', () => {
    const spec = readFileSync(resolve(__dirname, 'marketIntelligenceSourceOfTruth.spec.ts'), 'utf8');
    const pattern = /const ALLOWED_IMPORT =\s*([\s\S]*?);/.exec(spec)?.[1] ?? '';
    expect(pattern).toMatch(/\btext\b/);
    expect(pattern).toMatch(/\bmarkdown\b/);
    expect(pattern).toMatch(/pure\\?\.ts/);
    for (const other of ['cashFlow', 'portfolio', 'propertyComparison', 'borrowingCapacity', 'clientDetails', 'reportQa']) {
      expect(pattern, `the import rule now admits ${other}`).not.toContain(other);
    }
  });
});
