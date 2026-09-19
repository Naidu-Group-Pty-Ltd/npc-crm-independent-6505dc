/**
 * Choosing what stamp duty is assessed on.
 *
 * On a house-and-land package the land and the build are separate contracts and
 * duty falls on the land transfer alone, so the figure that belongs in the
 * calculator is the land price rather than the package price. That is ordinary
 * practice on every new build NPC reports on.
 *
 * This lives apart from the components because both the pre-generation
 * overrides tab and the manual override modal need the same answer, and because
 * the interesting part — which basis, and which category it implies — is worth
 * testing without mounting a form.
 *
 * The category matters as much as the amount. A land transfer assessed under
 * "new home" would be tested against the wrong first-home thresholds: NSW
 * exempts a home to $800,000 but land only to $350,000, and WA $600,000 against
 * $450,000. Same dollars, different answer.
 */

import type { BuildType } from '@/types/overrideFields';
import type { PropertyCategory } from '@/utils/stampDutyCalculator';
import type { DutiableValueBasis } from './StampDutyCalculatorPanel';

export interface DutiableValueInputs {
  buildType: BuildType;
  /** Whole transaction price. */
  purchasePrice: number;
  /** Land component, where the report records one. */
  landPrice: number;
}

/** True for the build types where land is bought under its own contract. */
export function assessesOnLand({ buildType, landPrice }: DutiableValueInputs): boolean {
  return (buildType === 'new_build' || buildType === 'land_only') && landPrice > 0;
}

/**
 * What the calculator should open on.
 *
 * A new build with a known land price opens on the land price; everything else
 * opens on the purchase price. Callers hold an override alongside this so an
 * explicit edit survives re-renders and price changes.
 */
export function defaultDutiableValue(inputs: DutiableValueInputs): number {
  return assessesOnLand(inputs) ? inputs.landPrice : inputs.purchasePrice;
}

/** The purchase category that goes with the default basis. */
export function defaultPropertyCategory(inputs: DutiableValueInputs): PropertyCategory {
  if (inputs.buildType === 'land_only') return 'vacant_land';
  if (inputs.buildType === 'new_build') return assessesOnLand(inputs) ? 'vacant_land' : 'new';
  return 'established';
}

/**
 * One-click bases to offer beneath the amount.
 *
 * Only what the report actually holds — an empty list is the right answer for a
 * report with no land price, and the field stays free-typed either way.
 */
export function dutiableValueBases(inputs: DutiableValueInputs): DutiableValueBasis[] {
  const { buildType, purchasePrice, landPrice } = inputs;
  const bases: DutiableValueBasis[] = [];

  if (landPrice > 0) {
    bases.push({
      id: 'land',
      label: 'Land price',
      value: landPrice,
      hint: 'house & land — duty on the land contract',
      impliesCategory: 'vacant_land',
    });
  }

  // Suppressed when the two are the same figure, which is the land-only case:
  // offering the identical amount twice under two labels invites the reader to
  // think one of them means something different.
  if (purchasePrice > 0 && Math.round(purchasePrice) !== Math.round(landPrice)) {
    bases.push({
      id: 'purchase',
      label: 'Full purchase price',
      value: purchasePrice,
      hint: buildType === 'new_build' ? 'single contract for a completed home' : 'the whole transaction',
      impliesCategory: buildType === 'new_build' ? 'new' : 'established',
    });
  }

  return bases;
}
