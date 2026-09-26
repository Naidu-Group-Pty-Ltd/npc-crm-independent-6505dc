/**
 * The investment document must have exactly one implementation.
 *
 * The guard matters more here than anywhere else in the programme. The route
 * this format replaces carried **two** chart engines, both of them
 * function-for-function duplicates of `reportDesign/charts.pure.ts` —
 * `renderGaugeSvg`, `renderWaterfallSvg`, `renderHeatmapSvg`,
 * `renderScoreWheelSvg`, `renderBulletSvg`, `renderMarimekkoSvg`,
 * `renderMicroMapSvg`, `renderQuadrantSvg`, `renderPictographSvg`,
 * `renderDonutSvg`, `renderTilesSvg` — plus its own 24-value palette and its
 * own Markdown parser off a CDN. Duplication at that scale is what this rule
 * exists to prevent, and this is the format that proves the point.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../../../..');
const CANONICAL_DIR = resolve(REPO, 'supabase/functions/_shared/reports/investment');
const BRIDGE_DIR = resolve(REPO, 'src/lib/reports/investment');

const pureModules = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith('.pure.ts')).sort();

const BRIDGE_SHAPE =
  /^(?:\/\*\*[\s\S]*?\*\/\s*)?export \* from '\.\.\/\.\.\/\.\.\/\.\.\/supabase\/functions\/_shared\/reports\/investment\/([\w.]+)\.pure\.ts';\s*$/;

/**
 * Siblings, the design system next door, or the shared report helpers.
 *
 * `vizDirectives`/`vizFigures` joined `text`/`markdown` when the model's own
 * `{{bars: …}}` vocabulary turned out to be shared: it is written into the
 * investment corpus, but the parser and the router sit at the root of
 * `_shared/reports/` because nothing about them is investment-specific.
 *
 * `../reportDate.pure.ts` is the shared date reader, a file in the parent
 * like the others here — eleven routes each carried a private copy.
 *
 * `../issuerIdentity.pure.ts` is who a report is issued by, for every format.
 * The standard cover's NPC-artwork rule and the issuer's own rule have to
 * name the same business, so the cover reads the one list rather than keeping
 * a second copy of it.
 *
 * `../../reportPhotographs.pure.ts` names the folders a report's photographs
 * and floor plans are written to. What deleting a report removes
 * (`reportStorage.pure.ts`) has to be exactly those folders, so it reads the
 * one definition rather than restating the paths.
 */
const ALLOWED_IMPORT =
  /^(?:\.\/[\w.]+\.pure\.ts|\.\.\/\.\.\/reportDesign\/[\w.]+\.(?:pure|generated)\.ts|\.\.\/(?:text|markdown|vizDirectives|vizFigures|reportDate|issuerIdentity)\.pure\.ts|\.\.\/market\/(?:marketFactBlocks|marketEvidence|scoreAssessmentReading)\.pure\.ts|\.\.\/\.\.\/(?:reportSplitRegistry|compassPostProcessor)\.ts|\.\.\/\.\.\/reportPhotographs\.pure\.ts)$/;

/**
 * The two market modules a canonical investment module may name, and they may
 * be named only for their TYPES.
 *
 * `strategyPositions.pure.ts` composes the SWOT, the suitability profile and
 * the rest from the market evidence table the report already carries, so it
 * has to know that table's row shape and the key union that indexes it. The
 * alternative was a local copy of both, which is how two shapes come to
 * disagree — and the key union is exactly what caught four misspelled measure
 * names on the first render.
 *
 * Named individually rather than as `../market/*`, for the reason the note
 * below gives about `../../*.ts`, and held to `import type` so the dependency
 * is erased at build time and no runtime edge is created between the two
 * domains.
 */
const TYPE_ONLY_IMPORTS = /^\.\.\/market\/(?!scoreAssessmentReading\.pure\.ts$)/;

/**
 * The one market module admitted for a VALUE, and why the rule above bends
 * exactly once.
 *
 * `scoreAssessmentReading.pure.ts` exports `readScoreAssessment`, and
 * `CLAUDE.md` § S5_CORRECTIONS §3a records the decision it serves: **the
 * assessment is DERIVED where the record is read, never passed in, because a
 * parameter a caller forgets takes the whole grade rationale off the page with
 * nothing reporting it.** Holding it to `import type` would force the opposite
 * of a decision made deliberately after that failure.
 *
 * The distinction against `StrategyRowOptions.measuredAt`, which IS passed in,
 * is the failure mode rather than the direction of travel: a forgotten
 * assessment loses the reason a grade was given and says nothing; a forgotten
 * measurement date degrades to a sentence that states the date is not
 * recorded. One is silent, the other is visible and honest.
 */

/**
 * Two modules next door that are not named `.pure.ts` and are admitted anyway.
 *
 * `forkSplit.pure.ts` composes the two fork documents, and it cannot do that
 * without the split registry (the routes, the titles, the lens preambles) or
 * the editorial-label stripper the hygiene pass runs. Neither is optional and
 * neither has a pure twin.
 *
 * The admission is CHECKED rather than asserted: the test below holds them to
 * the same purity rule as a canonical module, so this list can only grow to
 * things that would pass it. They are named individually — a pattern admitting
 * `../../*.ts` would admit the whole `_shared` tree.
 */
const ADMITTED_NEIGHBOURS = ['reportSplitRegistry.ts', 'compassPostProcessor.ts'];

describe('investment report — single source of truth', () => {
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
      expect(match, `${file} must contain nothing but a doc comment and one \`export *\``).not.toBeNull();
      expect(`${match![1]}.pure.ts`).toBe(file);
    });

    it('declares no logic of its own', () => {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(/export (?:const|function|class|interface|type|default)\b/);
      expect(code).not.toMatch(/^\s*import\b/m);
    });
  });

  describe.each(ADMITTED_NEIGHBOURS)('admitted neighbour %s', (file) => {
    it('is held to the same purity rule as a canonical module', () => {
      const source = readFileSync(resolve(CANONICAL_DIR, '..', '..', file), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const forbidden of ['Date.now(', 'new Date(', 'Math.random(', 'fetch(', 'localStorage', 'Deno.']) {
        expect(code, `${file} uses ${forbidden}`).not.toContain(forbidden);
      }
    });
  });

  describe.each(pureModules(CANONICAL_DIR))('canonical %s', (file) => {
    const source = readFileSync(resolve(CANONICAL_DIR, file), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    it('imports only siblings, the design system, or the shared helpers', () => {
      // Specifiers only — matching `from '…'` anywhere also matches prose.
      const imports = [...source.matchAll(/from '([^']+)'/g)]
        .map((m) => m[1])
        .filter((spec) => !/\s/.test(spec));
      for (const spec of imports) {
        expect(spec, `${file} imports "${spec}"`).toMatch(ALLOWED_IMPORT);
      }
    });

    it('imports the market domain for its types alone', () => {
      const statements = [...source.matchAll(/(?:^|\n)\s*import\s+(type\s+)?[^;]*?from '([^']+)'/g)];
      for (const [, typeOnly, spec] of statements) {
        if (!TYPE_ONLY_IMPORTS.test(spec)) continue;
        expect(typeOnly, `${file} imports "${spec}" for a value — market types only`).toBeTruthy();
      }
    });

    it('is pure — no clock, no randomness, no I/O', () => {
      for (const forbidden of ['Date.now(', 'new Date(', 'Math.random(', 'fetch(', 'localStorage', 'Deno.']) {
        expect(code, `${file} uses ${forbidden} — pass it in as an argument instead`).not.toContain(forbidden);
      }
    });

    it('draws no SVG of its own', () => {
      // The rule this format exists to restate. Charts are composed from
      // `reportDesign/charts.pure.ts`; a module here that opens an `<svg>` is a
      // third chart engine starting.
      //
      // `charts.pure.ts` is exempt for exactly two shapes it assembles by hand —
      // the SWOT grid, which is HTML rather than SVG, and the peer strip, whose
      // dual-axis geometry has no primitive. Both are named here so a third
      // never arrives quietly.
      if (file === 'charts.pure.ts') {
        const opens = (code.match(/<svg\b/g) || []).length;
        expect(opens, 'charts.pure.ts may hand-assemble the peer strip and nothing else')
          .toBeLessThanOrEqual(1);
        return;
      }
      expect(code, `${file} emits raw SVG`).not.toMatch(/<svg\b/);
    });

    it('draws no PDF of its own', () => {
      for (const library of ['jspdf', 'jsPDF', 'pdf-lib', 'html2canvas', 'PDFDocument', 'api2pdf', 'quickchart']) {
        expect(code, `${file} references ${library}`).not.toContain(library);
      }
    });

    it('hardcodes no colour', () => {
      // The route being replaced carried 24 hex literals in a `THEME` object,
      // none of them the tenant's brand. Every colour here comes from the
      // resolved palette.
      const hexes = code.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
      expect(hexes, `${file} hardcodes ${hexes.join(', ')}`).toEqual([]);
    });

    it('formats numbers without the runtime locale', () => {
      // `measure.pure.ts:121` records why — Deno and Node need not agree on ICU
      // grouping, and these strings are asserted in tests.
      expect(code, `${file} uses toLocaleString`).not.toContain('toLocaleString');
    });
  });
});
