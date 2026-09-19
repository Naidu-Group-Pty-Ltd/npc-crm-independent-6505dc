/**
 * The Report Q&A export must have exactly one implementation.
 *
 * The same guard the six formats before it carry, with one relaxation: the
 * shared `../text.pure.ts` and `../markdown.pure.ts`, where `neutraliseUrls` and
 * the Markdown parser live now that two formats each need them. Those are
 * **files** and not a directory, which is what stops it reading as "the parent
 * directory is open now" — the assertion at the bottom pins it.
 *
 * The guard matters more here than anywhere else in the programme. This format
 * has four legacy implementations across three libraries, two of them near-
 * verbatim copies of a third that have since drifted apart — one uses a fixed
 * `rowHeight` where the other measures, so multi-line table cells overlap in one
 * and not the other. Four copies is how that happens, and one is how it stops.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../../..');
const CANONICAL_DIR = resolve(REPO, 'supabase/functions/_shared/reports/reportQa');
const BRIDGE_DIR = resolve(REPO, 'src/lib/reports/reportQa');

const pureModules = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith('.pure.ts')).sort();

/** An optional block comment, then exactly one `export * from '…'`. */
const BRIDGE_SHAPE =
  /^(?:\/\*\*[\s\S]*?\*\/\s*)?export \* from '\.\.\/\.\.\/\.\.\/\.\.\/supabase\/functions\/_shared\/reports\/reportQa\/([\w.]+)\.pure\.ts';\s*$/;

/**
 * Siblings, the design system next door, or the shared helpers.
 *
 * `../text.pure.ts` and `../markdown.pure.ts` are not other formats — they are
 * `_shared/reports/*.pure.ts`, where `neutraliseUrls` and the Markdown parser
 * live now that two formats each need them. Named files, not a directory, which
 * is what stops this reading as "the parent directory is open now".
 *
 * `../reportDate.pure.ts` is the shared date reader, a file in the parent
 * like the others here — eleven routes each carried a private copy.
 */
const ALLOWED_IMPORT =
  /^(?:\.\/[\w.]+\.pure\.ts|\.\.\/\.\.\/reportDesign\/[\w.]+\.(?:pure|generated)\.ts|\.\.\/(?:text|markdown|reportDate)\.pure\.ts)$/;

describe('report Q&A — single source of truth', () => {
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

    it('imports only siblings, the design system, or the shared text helpers', () => {
      // Specifiers only. The specs this was copied from match `from '…'`
      // anywhere in the file, which also matches *prose* — a doc comment whose
      // line happens to end "…are calculated from '" reads as an import of a
      // newline. A module path has no whitespace in it, which is enough to tell
      // the two apart.
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

    it('draws no PDF of its own', () => {
      // The whole point. Four legacy implementations reach for jsPDF, pdf-lib
      // and html2canvas; a canonical module here builds HTML and nothing else.
      //
      // Comments are stripped first, and that is not a detail. These modules'
      // doc comments *name* all three libraries, because naming what they
      // replace is how the reasoning survives — the first version of this
      // assertion read the prose and failed on three files that contain no code
      // at all. The same mistake the copied import check makes when a doc
      // comment ends in "from '".
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
  it('permits the shared text helpers and no other format', () => {
    const spec = readFileSync(resolve(__dirname, 'reportQaSourceOfTruth.spec.ts'), 'utf8');
    const pattern = /const ALLOWED_IMPORT =\s*([\s\S]*?);/.exec(spec)?.[1] ?? '';
    // The names, inside the alternation. Matching `text\.pure\.ts` as one
    // substring stopped working the moment the rule became `(?:text|markdown)`,
    // which is the point: this assertion is about which names are admitted, not
    // about how the pattern happens to be spelled.
    expect(pattern).toMatch(/\btext\b/);
    expect(pattern).toMatch(/\bmarkdown\b/);
    expect(pattern).toMatch(/pure\\?\.ts/);
    for (const other of ['cashFlow', 'portfolio', 'propertyComparison', 'borrowingCapacity', 'clientDetails']) {
      expect(pattern, `the import rule now admits ${other}`).not.toContain(other);
    }
  });
});
