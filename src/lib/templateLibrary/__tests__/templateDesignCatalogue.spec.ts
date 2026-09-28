/**
 * The design catalogue the standard documents read is the approved catalogue,
 * byte for byte.
 *
 * `templateDesignCatalogue.generated.pure.ts` is emitted from the same three sources
 * every master is built from — the approved families, the measured type table
 * and the manifest resolvers — because an edge function cannot import those
 * directly. A generated file is only as good as the check that it is still what
 * its generator produces: this is `investmentCompassSource.spec.ts`' rule one
 * layer out, and `seedIsGenerated.spec.ts`' rule for the seed. It compares the
 * BYTES, never a count, so a hand-edit to one design fails here rather than
 * printing a different design from the one somebody chose.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildCatalogueDesignRows,
  DESIGN_CATALOGUE_PATH,
  renderCatalogueModule,
} from '../../../../scripts/template-library/investmentCompass/designCatalogue';
import { DESIGN_FAMILIES } from '../../../../scripts/template-library/investmentCompass/family';
import { CATALOGUE_VARIANT_DESIGNS } from '../../../../supabase/functions/_shared/reportDesign/templateDesignCatalogue.generated.pure';
import { colourwaysForFamily } from '../../../../supabase/functions/_shared/templateColourways.pure';

describe('the design catalogue module', () => {
  it('is exactly what the approved families produce (npm run templates:design:generate)', () => {
    const expected = renderCatalogueModule(buildCatalogueDesignRows());
    const actual = readFileSync(DESIGN_CATALOGUE_PATH, 'utf8');
    expect(actual === expected, 'templateDesignCatalogue.generated.pure.ts is stale or hand-edited').toBe(true);
  });

  it('carries every variant of every family, once, in catalogue order', () => {
    const codes = DESIGN_FAMILIES.flatMap((f) => f.variants.map((v) => v.code));
    expect(CATALOGUE_VARIANT_DESIGNS.map((d) => d.code)).toEqual(codes);
    expect(new Set(codes).size).toBe(50);
  });

  it("names each family's own default colourway", () => {
    for (const d of CATALOGUE_VARIANT_DESIGNS) {
      expect(colourwaysForFamily(d.familyKey)[0]?.id, d.code).toBe(d.defaultColourway);
    }
  });

  it('is pure data: no import can reach an edge function through it', () => {
    const text = readFileSync(DESIGN_CATALOGUE_PATH, 'utf8');
    expect(text).not.toMatch(/^\s*import\s/m);
  });
});
