import { describe, expect, it } from 'vitest';

import {
  assessesOnLand,
  defaultDutiableValue,
  defaultPropertyCategory,
  dutiableValueBases,
} from '../dutiableValueBasis';
import { calculateStampDuty } from '@/utils/stampDutyCalculator';

const PACKAGE = 683_700;
const LAND = 325_000;

describe('defaultDutiableValue', () => {
  it('opens a new build on the land price, not the package price', () => {
    // The reason this exists: duty on a house-and-land package falls on the land
    // contract, so defaulting to the package price meant correcting the figure by
    // hand on every new-build report.
    expect(defaultDutiableValue({ buildType: 'new_build', purchasePrice: PACKAGE, landPrice: LAND }))
      .toBe(LAND);
  });

  it('opens a land-only purchase on the land price', () => {
    expect(defaultDutiableValue({ buildType: 'land_only', purchasePrice: LAND, landPrice: LAND }))
      .toBe(LAND);
  });

  it('opens an existing property on the purchase price', () => {
    expect(defaultDutiableValue({ buildType: 'existing_property', purchasePrice: PACKAGE, landPrice: 0 }))
      .toBe(PACKAGE);
  });

  it('falls back to the purchase price when a new build has no land price recorded', () => {
    // A single contract for a completed new home is assessed on the whole thing,
    // and so is a report where nobody has filled the land price in yet.
    expect(defaultDutiableValue({ buildType: 'new_build', purchasePrice: PACKAGE, landPrice: 0 }))
      .toBe(PACKAGE);
  });

  it('ignores a land price on an existing property', () => {
    expect(defaultDutiableValue({ buildType: 'existing_property', purchasePrice: PACKAGE, landPrice: LAND }))
      .toBe(PACKAGE);
  });
});

describe('assessesOnLand', () => {
  it.each([
    ['new_build', LAND, true],
    ['land_only', LAND, true],
    ['new_build', 0, false],
    ['existing_property', LAND, false],
  ] as const)('%s with land %s → %s', (buildType, landPrice, expected) => {
    expect(assessesOnLand({ buildType, purchasePrice: PACKAGE, landPrice })).toBe(expected);
  });
});

describe('defaultPropertyCategory', () => {
  it('pairs the land basis with vacant land', () => {
    expect(defaultPropertyCategory({ buildType: 'new_build', purchasePrice: PACKAGE, landPrice: LAND }))
      .toBe('vacant_land');
    expect(defaultPropertyCategory({ buildType: 'land_only', purchasePrice: LAND, landPrice: LAND }))
      .toBe('vacant_land');
  });

  it('pairs a new build with no land price with the new home category', () => {
    expect(defaultPropertyCategory({ buildType: 'new_build', purchasePrice: PACKAGE, landPrice: 0 }))
      .toBe('new');
  });

  it('pairs an existing property with the established category', () => {
    expect(defaultPropertyCategory({ buildType: 'existing_property', purchasePrice: PACKAGE, landPrice: 0 }))
      .toBe('established');
  });

  it('never opens on a category that contradicts the default value', () => {
    // The pairing is the point. A land price assessed as a home is tested
    // against the wrong first-home thresholds, and nothing on screen would say so.
    const cases = [
      { buildType: 'new_build', purchasePrice: PACKAGE, landPrice: LAND },
      { buildType: 'new_build', purchasePrice: PACKAGE, landPrice: 0 },
      { buildType: 'land_only', purchasePrice: LAND, landPrice: LAND },
      { buildType: 'existing_property', purchasePrice: PACKAGE, landPrice: 0 },
    ] as const;

    for (const inputs of cases) {
      const value = defaultDutiableValue(inputs);
      const category = defaultPropertyCategory(inputs);
      const matchingBasis = dutiableValueBases(inputs).find((b) => b.value === value);
      if (matchingBasis?.impliesCategory) {
        expect(matchingBasis.impliesCategory, JSON.stringify(inputs)).toBe(category);
      }
    }
  });
});

describe('dutiableValueBases', () => {
  it('offers land and package prices for a house-and-land purchase', () => {
    const bases = dutiableValueBases({ buildType: 'new_build', purchasePrice: PACKAGE, landPrice: LAND });
    expect(bases.map((b) => b.id)).toEqual(['land', 'purchase']);
    expect(bases[0]).toMatchObject({ value: LAND, impliesCategory: 'vacant_land' });
    expect(bases[1]).toMatchObject({ value: PACKAGE, impliesCategory: 'new' });
  });

  it('offers only the purchase price when no land price is recorded', () => {
    const bases = dutiableValueBases({ buildType: 'existing_property', purchasePrice: PACKAGE, landPrice: 0 });
    expect(bases.map((b) => b.id)).toEqual(['purchase']);
  });

  it('does not offer the same amount twice on a land-only purchase', () => {
    const bases = dutiableValueBases({ buildType: 'land_only', purchasePrice: LAND, landPrice: LAND });
    expect(bases.map((b) => b.id)).toEqual(['land']);
  });

  it('returns nothing to offer when the report has no prices yet', () => {
    expect(dutiableValueBases({ buildType: 'new_build', purchasePrice: 0, landPrice: 0 })).toEqual([]);
  });
});

describe('what the default is worth', () => {
  it('materially changes the duty quoted on a house-and-land report', () => {
    // NSW investor: the package price attracts roughly three times the duty of
    // the land contract that is actually dutiable. Quoting the wrong one is not
    // a rounding difference.
    const onPackage = calculateStampDuty({
      propertyValue: PACKAGE, state: 'NSW', intent: 'investor', category: 'new',
    }).totalDuty;
    const onLand = calculateStampDuty({
      propertyValue: LAND, state: 'NSW', intent: 'investor', category: 'vacant_land',
    }).totalDuty;

    expect(onPackage).toBeGreaterThan(onLand * 2);
  });

  it('changes first home relief as well as the amount', () => {
    // A first home buyer on a $325k land contract pays nothing in NSW (under the
    // $350k vacant land threshold). Assessed on the $683,700 package under the
    // home thresholds they would also pay nothing — but at $850k of land they
    // would not, and the categories diverge sharply either side of the caps.
    const landFhb = calculateStampDuty({
      propertyValue: LAND, state: 'NSW', intent: 'owner_occupier',
      category: 'vacant_land', isFirstHomeBuyer: true,
    });
    expect(landFhb.totalDuty).toBe(0);

    const landAsHome = calculateStampDuty({
      propertyValue: 420_000, state: 'NSW', intent: 'owner_occupier',
      category: 'established', isFirstHomeBuyer: true,
    });
    const landAsLand = calculateStampDuty({
      propertyValue: 420_000, state: 'NSW', intent: 'owner_occupier',
      category: 'vacant_land', isFirstHomeBuyer: true,
    });
    expect(landAsHome.totalDuty).toBe(0);
    expect(landAsLand.totalDuty).toBeGreaterThan(0);
  });
});
