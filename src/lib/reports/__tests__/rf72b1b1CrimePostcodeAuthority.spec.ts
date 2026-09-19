import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRIME_EVIDENCE_WITHHELD_NOTE,
  isTrustedProvenance,
  postcodeMatchesState,
  resolveCrimePostcodeAuthority,
} from '../../../../supabase/functions/_shared/reports/location/crimePostcodeAuthority.pure.ts';
import {
  admitPopulationForArea,
} from '../../../../supabase/functions/_shared/crimePopulationAdmission.pure.ts';

/**
 * RF-7.2B.1B1 — which postcode may select client-facing crime evidence.
 *
 * The generator derived it from `propertyAddress.match(/\b(\d{4})\b/)`: the
 * FIRST four-digit token in a free-text string. Measured over the production
 * corpus on 2026-09-12 — 418 addresses carry a four-digit token, 30 parse the
 * wrong one, and 17 of those land on a number that is a real postcode:
 *
 *   "Lot 2267 Hunza Road, Truganina, VIC 3029"   → 2267, a NSW postcode
 *   "Lot 2325 Ned Street, Mambourin, VIC 3024"   → 2325, a NSW postcode
 *
 * Those are builder-stock LOT numbers — the same trap `builderStockAddress`
 * already records for the address line. Nothing was ever served wrong, and only
 * because `crime-statistics-service` also filters `.eq('state', …)` and no
 * Victorian postcode register is loaded. Exactly one corpus row would have
 * returned data, and it is `"Properties in Armidale NSW 2350, 2351"`, where
 * taking the first of two postcodes is legitimate.
 *
 * The containment is therefore accidental. These tests pin the designed one.
 *
 * §12's eight requirements, in order.
 */
const REPO = resolve(__dirname, '../../../..');
const generator = readFileSync(
  resolve(REPO, 'supabase/functions/generate-investment-report/index.ts'), 'utf8',
);
const crimeService = readFileSync(
  resolve(REPO, 'supabase/functions/crime-statistics-service/index.ts'), 'utf8',
);

describe('1 — a canonical resolved postcode permits crime evidence', () => {
  it('the ABS POA is authoritative and outranks everything', () => {
    const a = resolveCrimePostcodeAuthority({
      geographyPostcode: '2794',
      structuredPostcode: '2795',
      freeTextPostcode: '2796',
      state: 'NSW',
    });
    expect(a.postcode).toBe('2794');
    expect(a.provenance).toBe('resolved_geography');
    expect(a.trusted).toBe(true);
  });

  it('it wins even when it is the only source', () => {
    const a = resolveCrimePostcodeAuthority({ geographyPostcode: '2794', state: 'NSW' });
    expect(a.trusted).toBe(true);
    expect(a.note).toContain('point-in-polygon');
  });
});

describe('2 — a structured subject postcode is NOT trusted, because it is not structured', () => {
  // The first cut trusted `propertyDetails.postcode`. Tracing every production
  // origin refuted it: `auto-report-webhook` builds `detectedPostcode` from a
  // cascade ending in `extractPostcodeFromText(listing.address)`, a
  // `schools_directory` suburb lookup, and a hardcoded SUBURB_LOOKUP table
  // where BRISBANE resolves to 4000 — the CBD, for a property anywhere in
  // Brisbane. No frontend caller sets the field at all, `bulkReportWorker`
  // sends a different key, and the Airtable route can be model-rewritten.
  // There is no origin metadata to tell them apart at the point of use.
  it('it is refused, and refused as its OWN reading', () => {
    const a = resolveCrimePostcodeAuthority({
      structuredPostcode: '2794', freeTextPostcode: '9999', state: 'NSW',
    });
    expect(a.postcode).toBeNull();
    expect(a.trusted).toBe(false);
    // Not collapsed into the free-text reading: the remedy differs.
    expect(a.provenance).toBe('structured_subject');
    expect(a.note).toContain('suburb-name lookup');
  });

  it('only the resolved POA is trusted, asserted from the one definition', () => {
    expect(isTrustedProvenance('resolved_geography')).toBe(true);
    for (const p of ['structured_subject', 'free_text_parse', 'none'] as const) {
      expect(isTrustedProvenance(p)).toBe(false);
    }
  });

  it('the traced origins are still in the code, so the trace can be re-checked', () => {
    const webhook = readFileSync(
      resolve(REPO, 'supabase/functions/auto-report-webhook/index.ts'), 'utf8',
    );
    expect(webhook).toContain('extractPostcodeFromText(listing.address)');
    expect(webhook).toContain('lookupSuburbStatic(listing.suburb)');
    expect(webhook).toMatch(/'BRISBANE':\s*\{\s*state:\s*'QLD',\s*postcode:\s*'4000'\s*\}/);
    // ...and it reaches propertyDetails.postcode.
    expect(webhook).toContain('postcode: detectedPostcode || null');
  });

  it('the generator still passes the field, so the refusal is explicit not accidental', () => {
    expect(generator).toContain('structuredPostcode: propertyDetails?.postcode');
  });

  it('a malformed value is refused too', () => {
    for (const bad of ['27941', '279', 'NSW', '', null, undefined, 2794, {}]) {
      expect(resolveCrimePostcodeAuthority({ structuredPostcode: bad, state: 'NSW' }).trusted)
        .toBe(false);
    }
  });
});

describe('3 — a free-text-only postcode cannot authorise evidence on its own', () => {
  it('the parse is recorded and refused', () => {
    const a = resolveCrimePostcodeAuthority({ freeTextPostcode: '2794', state: 'NSW' });
    expect(a.postcode).toBeNull();
    expect(a.provenance).toBe('free_text_parse');
    expect(a.trusted).toBe(false);
    expect(a.note).toContain('lot number');
  });

  it('no source at all is refused too, and says something different', () => {
    const a = resolveCrimePostcodeAuthority({ state: 'NSW' });
    expect(a.trusted).toBe(false);
    expect(a.provenance).toBe('none');
  });

  it('the generator does not call the crime service without a trusted postcode', () => {
    expect(generator).toContain('crimePostcodeAtIntake.trusted');
    // Scoped to the crime block. `abs-employment-service` legitimately still
    // keys on the free-text postcode: it is governed by the Client-Safe Gate
    // and re-queried on the trusted POA at the geography step, which is a
    // different contract from selecting a statistical area to publish.
    const block = generator.slice(
      generator.indexOf('// 5. Crime statistics'),
      generator.indexOf('// 6. Employment data'),
    );
    expect(block.length).toBeGreaterThan(200);
    expect(block).toContain('postcode: crimePostcodeAtIntake.postcode');
    // The old unguarded call keyed on the free-text parse is gone from it.
    expect(block).not.toContain('JSON.stringify({ suburb, state, postcode })');
  });
});

describe('4 — a wrong parsed postcode cannot select client-facing crime data', () => {
  // The two measured builder-stock cases, verbatim from the corpus.
  const MEASURED = [
    { address: 'Lot 2267 Hunza Road, Truganina, VIC 3029', parsed: '2267', state: 'VIC' },
    { address: 'Lot 2325 Ned Street, Mambourin, Victoria, 3024', parsed: '2325', state: 'VIC' },
  ];

  it('the lot number is refused on provenance alone', () => {
    for (const c of MEASURED) {
      const a = resolveCrimePostcodeAuthority({ freeTextPostcode: c.parsed, state: c.state });
      expect(a.postcode).toBeNull();
      expect(a.trusted).toBe(false);
    }
  });

  it('and refused AGAIN by the state range, so neither guard carries it alone', () => {
    // 2267 is inside NSW's allocation and nowhere near Victoria's. This is what
    // stops relying on Victoria's register simply being absent.
    for (const c of MEASURED) {
      expect(postcodeMatchesState(c.parsed, c.state)).toBe(false);
    }
    // Even promoted to the highest authority it is refused.
    for (const c of MEASURED) {
      const a = resolveCrimePostcodeAuthority({ geographyPostcode: c.parsed, state: c.state });
      expect(a.trusted).toBe(false);
      expect(a.postcode).toBeNull();
    }
  });

  it('the real postcodes of those properties are accepted', () => {
    expect(postcodeMatchesState('3029', 'VIC')).toBe(true);
    expect(postcodeMatchesState('3024', 'VIC')).toBe(true);
    expect(resolveCrimePostcodeAuthority({ geographyPostcode: '3029', state: 'VIC' }).trusted).toBe(true);
  });

  it('every state\'s own allocation is accepted and its neighbours\' refused', () => {
    const cases: Array<[string, string]> = [
      ['2794', 'NSW'], ['3029', 'VIC'], ['4744', 'QLD'], ['5000', 'SA'],
      ['6000', 'WA'], ['7000', 'TAS'], ['0800', 'NT'], ['2600', 'ACT'],
    ];
    for (const [pc, st] of cases) expect(postcodeMatchesState(pc, st)).toBe(true);
    expect(postcodeMatchesState('2794', 'VIC')).toBe(false);
    expect(postcodeMatchesState('3029', 'NSW')).toBe(false);
    expect(postcodeMatchesState('4744', 'SA')).toBe(false);
  });

  it('an unknown state never refuses — that is not evidence about the postcode', () => {
    expect(postcodeMatchesState('2794', undefined)).toBe(true);
    expect(postcodeMatchesState('2794', 'ZZZ')).toBe(true);
  });
});

describe('5 — a postcode change invalidates the prior lookup', () => {
  it('the authority follows the new postcode', () => {
    const before = resolveCrimePostcodeAuthority({ geographyPostcode: '2794', state: 'NSW' });
    const after = resolveCrimePostcodeAuthority({ geographyPostcode: '2795', state: 'NSW' });
    expect(before.postcode).not.toBe(after.postcode);
  });

  it('the generator re-keys when the trusted POA differs from intake', () => {
    expect(generator).toContain('crimeAuthority.postcode !== crimePostcodeAtIntake.postcode');
  });

  it('and withholds what it already holds when nothing is trusted', () => {
    expect(generator).toContain('crimeStatistics: undefined');
  });
});

describe('6 — raw counts keep their BOCSAR provenance', () => {
  it('nothing here touches the register, its source string or its counts', () => {
    expect(crimeService).toContain('crime_reference');
    // The service still filters on state as well as area — the second guard.
    expect(crimeService).toMatch(/\.eq\('state', st\)\.eq\('area_kind', kind\)/);
  });

  it('the withheld note is about the RECORD, never about the area', () => {
    expect(CRIME_EVIDENCE_WITHHELD_NOTE).toContain('limitation of the available location data');
    expect(CRIME_EVIDENCE_WITHHELD_NOTE).toContain('no substitute figures');
    // It must not read as "this area has no crime".
    expect(CRIME_EVIDENCE_WITHHELD_NOTE).not.toMatch(/\bno (recorded )?(crime|offences)\b/i);
  });
});

describe('7 — F4\'s denominator architecture is untouched', () => {
  it('admission still refuses everything it refused before', () => {
    expect(admitPopulationForArea(null, 'postcode', '2794').refusedBecause).toBe('not_admitted');
    expect(admitPopulationForArea(
      { value: 10504, source: 'abs_census_poa', geography: '2794', grain: 'lga', vintage: '2021' },
      'postcode', '2794',
    ).refusedBecause).toBe('grain_mismatch');
    expect(admitPopulationForArea(
      { value: 10504, source: 'abs_census_poa', geography: '2795', grain: 'postcode', vintage: '2021' },
      'postcode', '2794',
    ).refusedBecause).toBe('geography_mismatch');
    expect(admitPopulationForArea(
      { value: 10504, source: 'abs_census_poa', geography: '2794', grain: 'postcode', vintage: '2021' },
      'postcode', '2794',
    ).value).toBe(10504);
  });

  it('the rate still needs BOTH a trusted POA and an admitted population', () => {
    expect(generator).toContain('if (crimePoa && admittedPopValue && (state === \'NSW\' || state === \'SA\'))');
  });

  it('this module decides the AREA and never the denominator', () => {
    const src = readFileSync(
      resolve(REPO, 'supabase/functions/_shared/reports/location/crimePostcodeAuthority.pure.ts'),
      'utf8',
    );
    for (const forbidden of ['population', 'per_100k', 'rate_per', 'denominator']) {
      // Prose may mention them; no identifier may compute with them.
      expect(src).not.toMatch(new RegExp(`(const|let|function)\\s+\\w*${forbidden}`, 'i'));
    }
  });
});

describe('8 — no cross-grain substitution', () => {
  it('a refusal yields null, never a coarser area', () => {
    for (const inputs of [
      { freeTextPostcode: '2794', state: 'NSW' },
      { state: 'NSW' },
      { geographyPostcode: '2267', state: 'VIC' },
    ]) {
      const a = resolveCrimePostcodeAuthority(inputs);
      expect(a.postcode).toBeNull();
    }
  });

  it('nothing in the module can name an LGA, SA2 or state fallback', () => {
    const src = readFileSync(
      resolve(REPO, 'supabase/functions/_shared/reports/location/crimePostcodeAuthority.pure.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/\b(lga|sa2|sa3|sa4|gccsa)\b/i);
  });

  it('the withheld note promises no substitute', () => {
    expect(CRIME_EVIDENCE_WITHHELD_NOTE).toContain('no substitute figures have been used');
  });
});
