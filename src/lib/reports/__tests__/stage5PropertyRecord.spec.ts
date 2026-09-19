/**
 * Stage 5 — the record must hold what the document asserts.
 *
 * Stage 5 asks whether the pipeline is right across the range of properties
 * the business actually sees. The first thing that measurement found is that
 * the range has collapsed: **every one of the 68 reports generated since June
 * 2026 carries `property_specs.property_type = 'Residential Property'` and
 * null in every other spec field** — a hardcoded literal and eight nulls,
 * on a record whose `manual_overrides` hold the real answers.
 *
 * `6 Acer Court` is the worked example. Its overrides carry
 * `propertyType: "house"`, `landSizeSqm: 1922`, `buildSizeSqm: 253`,
 * `carSpaces: 2`; its spec block carries the literal and eight nulls.
 * `1/27D Mitchell Street` is unmistakably a unit and its record says nothing.
 *
 * Measured across the completed corpus on 2026-09-08:
 *
 * | the operator supplied | the spec column stored |
 * | --- | ---: |
 * | `landSizeSqm` | null on **127** |
 * | `buildSizeSqm` | null on **122** |
 * | `carSpaces` | null on **144** |
 * | `propertyType` | the literal on **84** |
 *
 * The generator resolves all of it correctly — `effectiveLandSizeSqm` and
 * friends merge the overrides over the listing — and then persists the
 * un-merged half. The answer is computed, used to build the prompt and the
 * duty assessment, and discarded at the moment of writing it down.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PHANTOM_SPEC_KEYS,
  PROPERTY_SPEC_KEYS,
  composePropertySpecs,
  meaningfulPropertyType,
  readPropertyFacts,
} from '../investment/propertyRecord.pure';

const REPO = resolve(__dirname, '../../../..');

/**
 * Source with its comments removed.
 *
 * These are contract tests about what the code DOES, and the modules under
 * test document the very placeholders they must no longer emit — so a raw
 * `toContain` over the file matches the explanation of the defect and fails on
 * a correct fix. Stripping comments also makes the guard stronger: a
 * placeholder cannot be smuggled back past it by sitting in a comment.
 */
const read = (p: string) =>
  readFileSync(resolve(REPO, p), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');

/** Verbatim from `6 Acer Court` (2026-09-02). */
const ACER_OVERRIDES = {
  propertyType: 'house',
  landSizeSqm: 1922,
  buildSizeSqm: 253,
  carSpaces: 2,
  buildType: 'existing_property',
  purchasePrice: 1795000,
};
/** Verbatim from the same row's `property_specs`. */
const ACER_STORED_SPECS = {
  zoning: null, parking: null, bedrooms: null, bathrooms: null, year_built: null,
  council_area: null, land_size_sqm: null, building_size_sqm: null,
  property_type: 'Residential Property',
};

describe('a placeholder is not a property type', () => {
  it('refuses the generator\'s own literal', () => {
    // `standardizedPropertyType || propertyDetails?.propertyType ||
    // 'Residential Property'` — a hardcoded string presented as a measurement.
    expect(meaningfulPropertyType('Residential Property')).toBeNull();
  });

  it('refuses the other ways a caller says nothing', () => {
    for (const v of ['Property', 'Unknown', 'N/A', 'Other', '', '  ', null, undefined, 7]) {
      expect(meaningfulPropertyType(v), String(v)).toBeNull();
    }
  });

  it('keeps a real type exactly as recorded', () => {
    for (const v of ['house', 'Apartment', 'Townhouse', 'Duplex', 'Villa', 'Land']) {
      expect(meaningfulPropertyType(v), v).toBe(v);
    }
  });
});

describe('composePropertySpecs persists what the request resolved', () => {
  it('stores the merged facts rather than the listing\'s half', () => {
    const specs = composePropertySpecs({
      propertyType: 'house',
      landSizeSqm: 1922,
      buildSizeSqm: 253,
      carSpaces: 2,
    });
    expect(specs.property_type).toBe('house');
    expect(specs.land_size_sqm).toBe(1922);
    expect(specs.building_size_sqm).toBe(253);
    expect(specs.parking).toBe(2);
  });

  it('writes null where nothing is known — never a placeholder', () => {
    const specs = composePropertySpecs({});
    expect(specs).toEqual({
      property_type: null, land_size_sqm: null, building_size_sqm: null,
      bedrooms: null, bathrooms: null, parking: null, year_built: null,
      zoning: null, council_area: null,
    });
  });

  it('emits exactly the keys the column has always had', () => {
    expect(Object.keys(composePropertySpecs({})).sort())
      .toEqual([...PROPERTY_SPEC_KEYS].sort());
  });

  it('treats a zero or negative measurement as absent', () => {
    // A 0 m² block is not a measurement; it is the shape an unparsed value
    // takes, and the same trap the 0.00% yield came from.
    const specs = composePropertySpecs({ landSizeSqm: 0, buildSizeSqm: -1, beds: 0 });
    expect(specs.land_size_sqm).toBeNull();
    expect(specs.building_size_sqm).toBeNull();
    expect(specs.bedrooms).toBeNull();
  });
});

describe('reading heals the stored rows', () => {
  it('recovers every Acer fact the spec column lost', () => {
    // The point of the read-path repair: all 1,180 stored reports carry an
    // empty spec block and the facts are still in `manual_overrides` on every
    // one. No migration, no stored byte overwritten — the same asymmetry
    // `healFinanceIdentity` settled on.
    const facts = readPropertyFacts(ACER_STORED_SPECS, ACER_OVERRIDES);
    expect(facts.propertyType).toBe('house');
    expect(facts.normalisedType).toBe('house');
    expect(facts.landSizeSqm).toBe(1922);
    expect(facts.buildSizeSqm).toBe(253);
    expect(facts.carSpaces).toBe(2);
  });

  it('prefers a persisted spec over an override when both are real', () => {
    const facts = readPropertyFacts({ land_size_sqm: 500, property_type: 'unit' }, ACER_OVERRIDES);
    expect(facts.landSizeSqm).toBe(500);
    expect(facts.propertyType).toBe('unit');
  });

  it('does not let the placeholder beat the operator', () => {
    // The exact precedence bug: `property_specs.property_type` is truthy, so
    // `||` took it and the operator's own answer was never reached.
    expect(readPropertyFacts({ property_type: 'Residential Property' }, { propertyType: 'unit' }).propertyType)
      .toBe('unit');
  });

  it('leaves the engine vocabulary undefined rather than guessing', () => {
    // `?? raw`, never `?? 'house'`: defaulting awards the scorer's +3 to a
    // property nobody has classified.
    expect(readPropertyFacts({}, {}).normalisedType).toBeUndefined();
    expect(readPropertyFacts({ property_type: 'Residential Property' }, {}).normalisedType).toBeUndefined();
    // And it does normalise the aliases the engine understands.
    expect(readPropertyFacts({}, { propertyType: 'apartment' }).normalisedType).toBe('unit');
    expect(readPropertyFacts({}, { propertyType: 'villa' }).normalisedType).toBe('townhouse');
  });

  it('survives junk on either side', () => {
    for (const [s, o] of [[null, null], ['x', 3], [[], []], [undefined, { propertyType: 1 }]] as const) {
      expect(() => readPropertyFacts(s, o)).not.toThrow();
    }
    expect(readPropertyFacts(null, null).landSizeSqm).toBeNull();
  });
});

describe('the fork stops naming keys nothing writes', () => {
  const FORK = read('supabase/functions/fork-investment-report/index.ts');

  it('reads no phantom key off property_specs', () => {
    // `price`, `weeklyRent` and `state` were read here and have never been
    // written by any writer; `propertyType` is the writer's `property_type`
    // misspelled. JSONB does not error, so `Number(undefined)` became NaN and
    // the `||` chain silently took the next rung — the `aml.cases.tenant_id`
    // class with nothing to report it.
    for (const key of PHANTOM_SPEC_KEYS) {
      expect(FORK, key).not.toContain(`property_specs?.${key}`);
    }
  });

  it('resolves the property type through the healing reader', () => {
    expect(FORK).toContain('readPropertyFacts(parent.property_specs, overrides).normalisedType');
  });

  it('changes the score input ONLY where the operator recorded a real type', () => {
    // Scoring is a separate, open decision, so this PR must not move a score
    // it is not about. `investmentScoreEngine` reads
    // `property.propertyType || 'house'`, so handing it `undefined` for an
    // unclassified record would DEFAULT to a house and award `dRisk`'s +3 —
    // where the old expression passed the truthy `'Residential Property'`
    // placeholder and got a neutral. The two extra rungs preserve that.
    const oldWay = (specs: Record<string, unknown> | null) =>
      (specs?.propertyType as string) || (specs?.property_type as string) || 'house';
    const newWay = (specs: Record<string, unknown> | null, ovr: Record<string, unknown>) =>
      readPropertyFacts(specs, ovr).normalisedType
        ?? (specs?.property_type as string | undefined)
        ?? 'house';

    const PLACEHOLDER = { property_type: 'Residential Property' };
    // Unchanged: an empty record, a bare placeholder, and a real type already
    // in the spec column all resolve exactly as they did.
    for (const [specs, ovr] of [
      [null, {}],
      [PLACEHOLDER, {}],
      [{ property_type: 'house' }, {}],
    ] as const) {
      expect(newWay(specs, ovr)).toBe(oldWay(specs));
    }
    // Changed, and this is the whole point: the operator's recorded type now
    // reaches the engine instead of being discarded by the placeholder.
    expect(oldWay(PLACEHOLDER)).toBe('Residential Property');
    expect(newWay(PLACEHOLDER, { propertyType: 'apartment' })).toBe('unit');
    expect(newWay(PLACEHOLDER, { propertyType: 'house' })).toBe('house');
  });
});

describe('the generator persists the merged facts', () => {
  const GEN = read('supabase/functions/generate-investment-report/index.ts');

  it('composes the spec block rather than re-listing propertyDetails', () => {
    expect(GEN).toContain('const propertySpecs = composePropertySpecs({');
    expect(GEN).not.toContain("property_type: standardizedPropertyType || propertyDetails?.propertyType || 'Residential Property'");
  });

  it('feeds it the effective values, not the listing half', () => {
    const block = GEN.slice(GEN.indexOf('const propertySpecs = composePropertySpecs({'));
    const call = block.slice(0, block.indexOf('});') + 3);
    for (const v of ['effectiveLandSizeSqm', 'effectiveBuildSizeSqm', 'effectiveBeds', 'effectiveBaths']) {
      expect(call, v).toContain(v);
    }
  });
});

describe('the specification table states facts or omits the row', () => {
  const GEN = read('supabase/functions/generate-investment-report/index.ts');

  it('carries no instruction to estimate an attribute', () => {
    // Each of these was a prompt placeholder the model expanded into a
    // plausible figure. 169 stored documents print an "Estimated N–N m²" land
    // size; 201 assert a condition nobody inspected. On three, the invented
    // land size is roughly double the recorded one and the council rates,
    // land tax and rent comparables are reasoned from it.
    for (const placeholder of [
      'Estimated XXX-XXX m² (typical for suburb)',
      'X (typical for property type)',
      'X-X (typical modern standard)',
      "'X-X spaces'",
      "'Estimated XXXX-XXXX'",
      "'Good to excellent'",
    ]) {
      expect(GEN, placeholder).not.toContain(placeholder);
    }
  });

  it('states the permitted action beside the prohibition', () => {
    // Prose in a template literal wraps, so this matches on collapsed
    // whitespace rather than on where the source happens to break the line.
    // A prohibition with no permitted action is one a model routes around —
    // the rule the rent work established. The model may say an attribute is
    // not recorded, and may discuss the suburb's stock without attributing it.
    const prose = GEN.replace(/\s+/g, ' ');
    expect(prose).toContain('you may say it is not recorded');
    expect(prose).toContain('do not attribute any of it to this property');
  });
});
