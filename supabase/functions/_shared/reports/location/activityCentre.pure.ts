/**
 * ME-5 item 9 — which centre a property's access should be measured to.
 *
 * The stored corpus measured every property's commute to its STATE CAPITAL,
 * and where no state was supplied, to Sydney. Both are wrong, in different
 * ways, and only the second is a bug:
 *
 *   * Bentley WA, 8 km from Perth, stored 82.1 hours (to Sydney). A defect.
 *   * Moranbah QLD stored 1,487 minutes to Brisbane. Not a defect — the
 *     Distance Matrix answered correctly. It is the QUESTION that is wrong:
 *     nobody in Moranbah commutes to Brisbane, and a report that grades the
 *     property on how long that takes is grading it on being regional.
 *
 * ## The rule
 *
 * **A property's access is measured to the centre of the labour market it is
 * actually in.** That is a question the ABS has already answered, from
 * journey-to-work data, and this module reads its answer rather than inventing
 * one.
 *
 * Three tiers, most specific first:
 *
 * 1. **A Greater Capital City Statistical Area** is *defined* as a capital's
 *    functional labour market — it is built from where people commute, not
 *    from the built-up area. A property in one belongs to that capital's CBD.
 * 2. **A Significant Urban Area** aggregates adjacent urban centres into a
 *    functional town or city of 10,000 or more. Outside a capital, this is the
 *    centre a property's residents work and shop in: Toowoomba, Bundaberg,
 *    the Gold Coast.
 * 3. **An Urban Centre or Locality** is a built-up area of 200 or more people.
 *    It is the town itself, and it is offered LAST and labelled as a local
 *    centre rather than an employment centre — the brief's caution that a UCL
 *    is not automatically the right activity centre is exactly right, because
 *    a dormitory town's UCL says nothing about where its jobs are.
 *
 * Where none resolves, there is no centre, and access is **not measured**.
 *
 * ## What this module deliberately does not do
 *
 * **It never compares across tiers.** "18 minutes to the Perth CBD" and
 * "4 minutes to the Moranbah town centre" are not the same quantity, and a
 * score that ranks them against one shared band is the metro bias this whole
 * item exists to remove. The tier travels with the answer so a scorer must
 * either band within a tier or decline; `ActivityCentre.tier` is not
 * decoration.
 *
 * **It picks no coordinate for tiers 2 and 3.** The ABS publishes the
 * boundary, not the centre, and taking a polygon's centroid as "the town
 * centre" would be an invention of exactly the kind this programme keeps
 * removing. Resolving a real centre point for an SUA or UCL is a separate
 * piece of acquisition; until then those tiers resolve a NAMED centre with a
 * null coordinate, and the caller reports access as not yet measurable rather
 * than measuring to a guess.
 */

import { resolveCbdDestination, type CbdDestination } from './cbdDestination.pure.ts';

export type CentreTier =
  /** A capital CBD, reached because the property is in that capital's GCCSA. */
  | 'capital_labour_market'
  /** A significant urban area's own centre. */
  | 'significant_urban_area'
  /** The urban centre or locality the property sits in. */
  | 'local_centre'
  /** No centre resolves: bounded rural, or the geography is unresolved. */
  | 'none';

export interface ActivityCentre {
  tier: CentreTier;
  /** What the centre is called, for a report to print. Null for `none`. */
  name: string | null;
  /**
   * Where it is, when we hold a real coordinate for it. Null for tiers 2 and 3
   * — the ABS publishes boundaries, not centres, and a centroid is a guess.
   */
  destination: CbdDestination | null;
  /** True only when a distance or duration may actually be measured. */
  measurable: boolean;
  /** Why this centre, in one sentence a report can print. */
  reason: string;
}

/** The ASGS attributes this decision reads. All come from `report_geography`. */
export interface GeographyForCentre {
  /** e.g. "Greater Perth", "Rest of Qld". */
  gccsaName: string | null;
  significantUrbanArea: string | null;
  urbanCentre: string | null;
  /** The ASGS state, used only to name the capital a GCCSA belongs to. */
  state: string | null;
}

/**
 * The eight GCCSAs that ARE a capital's labour market.
 *
 * "Rest of Qld" and its siblings are the complement and are deliberately not
 * here: a Gold Coast property is in "Rest of Qld", and measuring it to Brisbane
 * is the same error as measuring Moranbah to Brisbane.
 */
export const CAPITAL_GCCSA: Readonly<Record<string, string>> = {
  'Greater Sydney': 'NSW',
  'Greater Melbourne': 'VIC',
  'Greater Brisbane': 'QLD',
  'Greater Perth': 'WA',
  'Greater Adelaide': 'SA',
  'Greater Hobart': 'TAS',
  'Greater Darwin': 'NT',
  'Australian Capital Territory': 'ACT',
};

/**
 * The ABS tiles the whole continent, so "no urban centre here" arrives as a
 * NAMED polygon: `Not in any Significant Urban Area (Qld)`. Measured on the
 * corpus, 131 of 931 resolved reports carry one — reading it as a place would
 * invent an SUA called "Not in any Significant Urban Area" for every rural
 * property and route their access to it.
 */
const ABS_ABSENCE_POLYGON = /^\s*(no usual address|migratory|off[- ]shore|not in any\b)/i;

/** An ABS name may carry a bracketed state qualifier: "Richmond (Vic.)". */
function bare(name: string | null): string | null {
  if (!name) return null;
  if (ABS_ABSENCE_POLYGON.test(name)) return null;
  const trimmed = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return trimmed || null;
}

/** Exported so a loader and a reader cannot disagree about what absence looks like. */
export function isAbsencePolygon(name: string | null | undefined): boolean {
  return typeof name === 'string' && ABS_ABSENCE_POLYGON.test(name);
}

/**
 * Resolve the centre a property's access should be measured to.
 *
 * Deterministic, and reads only ASGS attributes already stored. Nothing here
 * consults an address, a model or a provider.
 */
export function resolveActivityCentre(geography: GeographyForCentre): ActivityCentre {
  const gccsa = geography.gccsaName?.trim() ?? null;
  const capitalState = gccsa ? CAPITAL_GCCSA[gccsa] : undefined;

  if (capitalState) {
    const destination = resolveCbdDestination(capitalState);
    if (destination) {
      return {
        tier: 'capital_labour_market',
        name: destination.capital,
        destination,
        measurable: true,
        reason: `The property is inside ${gccsa}, which the ABS defines from journey-to-work `
          + `data as ${destination.capital}'s labour market, so the capital CBD is the centre `
          + 'its access is measured to.',
      };
    }
  }

  const sua = bare(geography.significantUrbanArea);
  if (sua) {
    return {
      tier: 'significant_urban_area',
      name: sua,
      destination: null,
      measurable: false,
      reason: `The property is in the ${sua} significant urban area, outside any capital's `
        + 'labour market. Access should be measured to that centre; no centre coordinate is '
        + 'held for it yet, so nothing is measured rather than measured to a guess.',
    };
  }

  const ucl = bare(geography.urbanCentre);
  if (ucl) {
    return {
      tier: 'local_centre',
      name: ucl,
      destination: null,
      measurable: false,
      reason: `The property is in the urban centre of ${ucl}, which is where it is rather `
        + 'than necessarily where its residents work. Access is a local measure here, not a '
        + 'commute, and no centre coordinate is held for it yet.',
    };
  }

  return {
    tier: 'none',
    name: null,
    destination: null,
    measurable: false,
    reason: 'The coordinate is in no urban centre the ABS names, so there is no centre to '
      + 'measure access to. Absent, not distant.',
  };
}

/**
 * May two properties' access figures be compared?
 *
 * Only within a tier. This exists as a function rather than a comment because
 * the metro bias it prevents is the whole point of the item: minutes to the
 * Perth CBD and minutes to a country town's main street are different
 * quantities, and one shared band would score every regional property as
 * having poor access to a city it has no relationship with.
 */
export function centresAreComparable(a: ActivityCentre, b: ActivityCentre): boolean {
  return a.tier === b.tier && a.tier !== 'none';
}
