/**
 * The year a Compass may print as "Year Built" — pinned before the 60 Lawley
 * Street regeneration from a listing (25 Sep 2026).
 *
 * The generator hands the model a table of the property's recorded physical
 * attributes, tells it the table holds every one on record, and forbids a
 * year built the table does not carry. The row read `yearBuilt` (the override
 * screen's Property tab) and nothing else. A listing or PDF extraction on the
 * New Report form files the year a listing states under `constructionYear`,
 * which `property_specs.year_built` already reads — so an existing property's
 * stored record held the year while its document was forbidden to state it.
 *
 * The owner's bounds: the New Build side's construction year and its
 * construction breakdown belong to the 10 Year Cash Flow and must not be
 * affected, and a year the row printed before is printed unchanged.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  attributeTableYearBuilt,
  composePropertySpecs,
} from '../../../../supabase/functions/_shared/reports/investment/propertyRecord.pure';

describe('attributeTableYearBuilt', () => {
  it('prints the stored year for an existing property whose year came from a listing', () => {
    // The New Report form: `extractedYearBuilt` → `constructionYear`, and the
    // stored spec resolves it.
    const overrides = { buildType: 'existing_property', constructionYear: 1979 };
    const stored = composePropertySpecs({ yearBuilt: overrides.constructionYear }).year_built;
    expect(stored).toBe(1979);
    expect(attributeTableYearBuilt({ buildType: 'existing_property', overrides, storedYearBuilt: stored })).toBe(1979);
  });

  it('never prints a new build\'s construction year, or a land lot\'s', () => {
    for (const buildType of ['new_build', 'land_only']) {
      const overrides = { buildType, constructionYear: 2027 };
      expect(attributeTableYearBuilt({ buildType, overrides, storedYearBuilt: 2027 }), buildType).toBeNull();
    }
  });

  it('prints what the row printed before, unchanged, on every build type', () => {
    for (const buildType of ['existing_property', 'new_build', 'land_only', undefined]) {
      // The Property tab's own field.
      expect(attributeTableYearBuilt({ buildType, overrides: { yearBuilt: 1985 }, storedYearBuilt: 1979 })).toBe(1985);
      // A caller's `yearBuilt`, where the overrides hold none.
      expect(attributeTableYearBuilt({ buildType, overrides: {}, details: { yearBuilt: '1990' }, storedYearBuilt: 1979 })).toBe('1990');
    }
  });

  it('prints nothing where nothing is recorded', () => {
    expect(attributeTableYearBuilt({ buildType: 'existing_property', overrides: {}, storedYearBuilt: null })).toBeNull();
    expect(attributeTableYearBuilt({ buildType: 'existing_property', overrides: null, storedYearBuilt: null })).toBeNull();
    // A cleared field is not a year.
    expect(attributeTableYearBuilt({ buildType: 'existing_property', overrides: { yearBuilt: '' }, storedYearBuilt: null })).toBeNull();
  });
});

describe('the generator', () => {
  const ROOT = join(__dirname, '..', '..', '..', '..');
  const generator = readFileSync(join(ROOT, 'supabase/functions/generate-investment-report/index.ts'), 'utf8');

  it('draws the Year Built row through the rule, for the resolved build type and the stored year', () => {
    expect(generator).toMatch(
      /\['Year Built', attributeTableYearBuilt\(\{\s*buildType: effectiveBuildType,\s*overrides: mergedOverrides,\s*details: propertyDetails,\s*storedYearBuilt: propertySpecs\.year_built,\s*\}\)\]/,
    );
    expect(generator).not.toContain("['Year Built', mergedOverrides.yearBuilt ?? propertyDetails?.yearBuilt ?? null]");
  });

  it('leaves the stored year, and every construction-side read of constructionYear, as it was', () => {
    // The stored spec's order is unchanged: the construction year first.
    expect(generator).toMatch(
      /yearBuilt: mergedOverrides\.constructionYear\s*\?\? mergedOverrides\.yearBuilt\s*\?\? propertyDetails\?\.constructionYear\s*\?\? propertyDetails\?\.yearBuilt,/,
    );
    // The construction year still reaches the model as the override it is.
    expect(generator).toContain('if (manualOverrides.constructionYear) overrideLines.push(`Construction Year: ${manualOverrides.constructionYear}`);');
  });
});
