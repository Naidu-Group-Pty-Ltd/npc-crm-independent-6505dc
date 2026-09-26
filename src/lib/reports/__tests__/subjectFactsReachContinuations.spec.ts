/**
 * A listing's facts reach every section, and a unit number is not a postcode.
 *
 * Both measured on the 24 Sep 2026 regeneration test, from production logs:
 *
 *  - Report 79d677d6 (93 Schofields Farm Road, from a realestate.com.au
 *    listing): the first invocation received 4 bedrooms, 2 bathrooms, 401 m²
 *    and `house`; the eleven continuations received none, because the facts
 *    were written to `manual_overrides` only by the FINAL write, which is
 *    itself a continuation. Sections 6-16 said the counts were not held, the
 *    scoring service was sent the default 3 bedrooms, and Compass QA failed
 *    the document with two `attribute-asserted-and-withheld` errors.
 *  - Report de783a4b (1408/5 SECOND AVE, Blacktown NSW 2148): the intake parse
 *    took the FIRST four-digit token, so the postcode was the unit number
 *    1408, and the school, risk and rent lookups ran on it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  extractedSubjectOverrides,
  overridesWithSubjectFacts,
} from '../../../../supabase/functions/_shared/reports/investment/subjectFacts.pure';

const GENERATOR = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'functions', 'generate-investment-report', 'index.ts'),
  'utf8',
);

// The propertyDetails the Schofields listing produced, as logged at intake.
const SCHOFIELDS = { price: 1280000, weeklyRent: 870, propertyType: 'house', beds: 4, baths: 2, carSpaces: 2, landSizeSqm: 401, buildSizeSqm: 171 };

describe('extractedSubjectOverrides', () => {
  it('names every fact the listing supplied, including the property type the final write never carried', () => {
    expect(extractedSubjectOverrides(SCHOFIELDS)).toEqual({
      purchasePrice: 1280000, weeklyRent: 870, propertyType: 'house', bedrooms: 4, bathrooms: 2,
      carSpaces: 2, landSizeSqm: 401, buildSizeSqm: 171,
    });
    expect(extractedSubjectOverrides({ propertyType: 'apartment', beds: 1, baths: 1 }))
      .toEqual({ propertyType: 'apartment', bedrooms: 1, bathrooms: 1 });
  });

  it('carries nothing for a continuation, which supplies no facts', () => {
    expect(extractedSubjectOverrides(undefined)).toEqual({});
    expect(extractedSubjectOverrides({ beds: undefined, baths: null, propertyType: '  ' })).toEqual({});
  });
});

describe('overridesWithSubjectFacts', () => {
  it('writes the listing facts under whatever the row and the operator already hold', () => {
    const written = overridesWithSubjectFacts(extractedSubjectOverrides(SCHOFIELDS), { purchasePrice: 1250000, loanToValueRatio: 80 });
    expect(written).toMatchObject({ bedrooms: 4, bathrooms: 2, propertyType: 'house', landSizeSqm: 401 });
    // The operator's price wins over the listing's.
    expect(written!.purchasePrice).toBe(1250000);
    expect(written!.loanToValueRatio).toBe(80);
  });

  it('writes nothing where the row already holds every fact', () => {
    const held = { ...extractedSubjectOverrides(SCHOFIELDS) };
    expect(overridesWithSubjectFacts(extractedSubjectOverrides(SCHOFIELDS), held)).toBeNull();
    expect(overridesWithSubjectFacts({}, { bedrooms: 3 })).toBeNull();
  });
});

describe('the generator banks the facts before the first section', () => {
  it('writes them in the early persistence, which runs before any section is generated', () => {
    const early = GENERATOR.indexOf('overridesWithSubjectFacts(extractedSubjectOverrides(propertyDetails), mergedOverrides)');
    // The section loop's own log line — the early persistence is logged after
    // the MULTI-SECTION banner and before this, which is the order production
    // logs show on every run.
    const firstSection = GENERATOR.indexOf('📄 Generating section ${i + 1}/');
    expect(early).toBeGreaterThan(0);
    expect(firstSection).toBeGreaterThan(0);
    expect(early).toBeLessThan(firstSection);
    expect(GENERATOR).toMatch(/if \(subjectOverrides\) \{\s*earlyUpdate\.manual_overrides = subjectOverrides;/);
  });

  it('builds the final write from the same definition', () => {
    expect(GENERATOR).toContain('const extractedOverrides: any = extractedSubjectOverrides(propertyDetails);');
    // The inline list it replaced is gone, so the two cannot drift.
    expect(GENERATOR).not.toMatch(/if \(propertyDetails\?\.beds\) extractedOverrides\.bedrooms/);
  });
});

describe('the intake postcode is the address postcode', () => {
  it('reads the postcode by the shared rule, never the first four-digit token', () => {
    expect(GENERATOR).toContain('const parsedAddress = parseAddressText(propertyAddress);');
    expect(GENERATOR).toContain('detectedPostcode = parsedAddress.postcode;');
    expect(GENERATOR).toContain('postcode = parseAddressText(formattedInput).postcode;');
    // The first-token parse survives only for the postcode-only mode.
    expect(GENERATOR).not.toMatch(/detectedPostcode = postcodeMatch\[1\]/);
    expect(GENERATOR).not.toMatch(/const postcodeMatch = formattedInput\.match/);
  });

  it('reads the state from the locality position, never the first state name anywhere', () => {
    expect(GENERATOR).toContain('const parsedAddress = parseAddressText(propertyAddress);');
    expect(GENERATOR).toContain('detectedState = parsedAddress.state;');
    expect(GENERATOR).toContain('const parsedState = parseAddressText(formattedInput).state;');
    expect(GENERATOR).not.toMatch(/const stateMatch = (?:propertyAddress|formattedInput)\.match/);
  });
});
