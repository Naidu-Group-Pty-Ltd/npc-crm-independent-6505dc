/**
 * The rules that made the design system worth building, asserted against its
 * own source.
 *
 * Both of these have already been broken in this repo, which is why they are
 * tests rather than conventions:
 *
 *  1. **No colour literals outside the generated token file.** The repo carries
 *     eight brand golds because every fix-by-eye added one. A literal here is
 *     the ninth.
 *  2. **No hardcoded company identity.** `report.html.ts:47` printed
 *     `"NPC · Investment Intelligence"` on the cover of every white-label
 *     tenant's report, and `report.css.ts:33` printed it on all forty pages.
 *     Identity comes from the brand snapshot or it does not appear.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CANONICAL_DIR = resolve(__dirname, '../../../../supabase/functions/_shared/reportDesign');

/**
 * The two modules a literal is legitimate in, and why.
 *
 *  - `tokens.pure.ts` is generated from `src/styles/tokens.css` and *is* the
 *    definition — every other module references a role that resolves to one of
 *    these.
 *  - `color.pure.ts` sits below the palette: it converts and measures colour and
 *    has nothing to reference. Its only literal is the fallback an unparseable
 *    HSL string degrades to, which must be a colour and cannot be a role.
 *
 * Nothing else. A literal in a *design* module is the ninth brand gold.
 */
const TOKEN_FILE = 'tokens.pure.ts';
const LITERAL_EXEMPT = new Set([TOKEN_FILE, 'color.pure.ts']);

const modules = readdirSync(CANONICAL_DIR)
  .filter((f) => f.endsWith('.pure.ts'))
  .sort();

/** Strip comments — prose legitimately quotes the hexes it is explaining. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('report design system — source hygiene', () => {
  describe.each(modules)('%s', (file) => {
    const code = codeOnly(readFileSync(resolve(CANONICAL_DIR, file), 'utf8'));

    it.skipIf(LITERAL_EXEMPT.has(file))('contains no colour literal', () => {
      const hex = code.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? [];
      const fn = code.match(/\b(?:rgb|rgba|hsl|hsla)\(\s*\d/g) ?? [];
      expect(
        [...hex, ...fn],
        `${file} must take colour from a palette role, never a literal — `
          + `see docs/reports/DESIGN_SYSTEM.md`,
      ).toEqual([]);
    });

    it('hardcodes no company identity', () => {
      // Word-boundary match so `NPC_` or a longer word does not trip it, and
      // case-sensitive so ordinary prose is unaffected.
      expect(code, `${file} names a company in code`).not.toMatch(/\bNPC\b/);
      expect(code, `${file} names the render engine in output`).not.toMatch(/WeasyPrint/i);
    });
  });

  it('no design module embeds a house asset', () => {
    // `defaultAssets.generated.ts` carries NPC's monogram and a cover with our
    // company name in its pixels. A design module that imports it hands every
    // white-label tenant our identity — the same defect as the hardcoded
    // masthead, in a form that is harder to see.
    for (const file of modules) {
      const code = codeOnly(readFileSync(resolve(CANONICAL_DIR, file), 'utf8'));
      expect(code, `${file} imports a house asset`).not.toMatch(/defaultAssets\.generated/);
    }
  });

  it('tokens.pure.ts is the only module holding literals', () => {
    const tokens = codeOnly(readFileSync(resolve(CANONICAL_DIR, TOKEN_FILE), 'utf8'));
    expect((tokens.match(/#[0-9A-Fa-f]{6}\b/g) ?? []).length).toBeGreaterThan(0);
  });
});
