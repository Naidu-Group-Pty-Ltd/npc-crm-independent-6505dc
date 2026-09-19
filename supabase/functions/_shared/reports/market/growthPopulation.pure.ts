/**
 * ME-6 closure — the ONE definition of "Growth-addressable".
 *
 * ME-6 reported two denominators for the same idea, 641 and 663, and an
 * ambiguous denominator makes every coverage percentage that follows
 * unfalsifiable. This module is the single answer, and the reconciliation is
 * arithmetic rather than opinion.
 *
 * ## Why the two numbers differed — measured, not inferred
 *
 * Both were computed over the same 867 trusted-geography reports.
 *
 * | step | count |
 * | --- | ---: |
 * | trusted geography (suburb AND state present) | 867 |
 * | `property_specs.property_type` present and not a placeholder | **663** |
 * | less `land` (26) | **637** |
 * | plus §62.4's sibling recovery (4) | **641** |
 *
 * So they are the same predicate with and without the land exclusion, and
 * neither is wrong about what it measured — they measured different things
 * while both being called "Growth-addressable".
 *
 * **663 was too loose**: it counted 26 vacant-land reports. A land parcel has
 * no dwelling, so no house/unit median series describes it — Domain segments
 * `suburbPerformanceStatistics` by house and unit, and PropTrack's sale
 * insights do the same. Counting land inflates the denominator with rows no
 * provider can ever answer for.
 *
 * **641 was too narrow**: it read one field. Two further deterministic routes
 * to the same fact were already in the record and unused (below).
 *
 * ## The canonical answer is 665, and it is not "the bigger one"
 *
 * It is simultaneously **stricter** than 663 (land excluded) and **more
 * complete** than 641 (three resolution routes instead of one). That it lands
 * two above 663 is a coincidence of two independent corrections, not a
 * preference for a larger number:
 *
 * | route | reports |
 * | --- | ---: |
 * | `property_specs.property_type` | 663 |
 * | `financial_calculations.propertySpecs.propertyType` | +15 |
 * | unambiguous sibling on the same `canonical_property_key` | +13 |
 * | any type resolved | 691 |
 * | less `land` | −26 |
 * | **canonical Growth-ready** | **665** |
 *
 * The 15 the financial block adds are **all `house`** — specific, and stated
 * by the operator rather than derived: `historicalFactAuthority.pure.ts`
 * establishes `manual_overrides`/`financial_calculations.propertySpecs` as the
 * calculator's INPUT record, which is why this is a reading of the record and
 * not a guess. The sibling route yields 13 here against §62.4's 4 because its
 * pool is enriched by the financial route, which §62.4 did not consult.
 *
 * ## Sibling recovery is a ROUTE, never a REQUIREMENT
 *
 * §62.4 introduced it while measuring what could be recovered, and the brief
 * asked whether it belongs in the definition. It does — as one of three ways
 * the dwelling type may be resolved, not as a condition a report must satisfy.
 * A report whose own `property_specs` names its type is Growth-ready without
 * any sibling, and requiring one would exclude 663 reports to gain 13.
 *
 * ## What Growth readiness does NOT require
 *
 * Deliberately absent, because none of them is an input to a suburb median
 * series: **LVR**, **cash flow**, **rent**, **Risk**, **composite scoring
 * readiness**. Growth readiness is a question about geography and dwelling
 * type alone.
 *
 * **Postcode is not required either.** Measured: 0 of the 663 lack one, so it
 * discriminates nothing today; and Domain's route is
 * `/{state}/{suburb}` with postcode an optional refinement. Requiring it would
 * add a condition that changes no count now and could exclude a legitimate
 * report later.
 *
 * ## The rule this exists to enforce
 *
 * **No second component may define this.** A coverage figure is a fraction,
 * and two components with two denominators produce two different answers to
 * one question — which is exactly how 641 and 663 came to coexist.
 */

/** Bump when the predicate changes. A manifest records the version it was sealed under. */
export const GROWTH_POPULATION_VERSION = 'me7.pop.1';

/**
 * The dwelling classes a suburb Growth series is segmented by.
 *
 * Two, because that is what providers publish. Domain splits house and unit;
 * PropTrack splits house and unit. A third class here would be a class no
 * source can answer for.
 */
export type GrowthDwellingClass = 'house' | 'attached';

/** How the dwelling type was established. Recorded so a manifest is auditable. */
export type DwellingResolutionRoute =
  | 'property_specs'
  | 'financial_calculations'
  | 'sibling_canonical_key';

/** Why a report is not in the population. Every exclusion names one. */
export type GrowthExclusionReason =
  | 'geography_absent'          // no suburb and/or no state
  | 'dwelling_type_unresolved'  // none of the three routes yields a specific type
  | 'dwelling_type_not_segmentable'; // resolved, but no provider series segments it (land)

/**
 * Stored values that are not a dwelling type.
 *
 * `Residential Property` is the one that matters: the generator wrote it as a
 * literal whenever nothing was known (§62.5), so it is indistinguishable from
 * a type somebody established — which is why it must resolve to absent rather
 * than to a default.
 */
const PLACEHOLDER_TYPES = new Set([
  'residential property', 'other', 'unknown', 'n/a', '',
]);

/**
 * Stored vocabulary → provider segmentation.
 *
 * Explicit and provider-neutral: an unmapped value resolves to `null` and the
 * report is excluded with a reason, rather than being silently folded into
 * `house` — guessing here would attribute a unit's growth to a house.
 */
const DWELLING_CLASS: Readonly<Record<string, GrowthDwellingClass | 'land'>> = {
  house: 'house',
  house_and_land: 'house',   // a build; the completed asset is a house
  apartment: 'attached',
  unit: 'attached',
  townhouse: 'attached',
  villa: 'attached',
  duplex: 'attached',
  land: 'land',              // no dwelling ⇒ no dwelling-type series
};

/** Everything the predicate may read. Nothing else is consulted. */
export interface GrowthCandidate {
  reportId: string;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  /** `property_specs.property_type`. */
  propertySpecsType: string | null;
  /** `financial_calculations.propertySpecs.propertyType`. */
  financialCalcsType: string | null;
  /**
   * The unambiguous dwelling type held by OTHER reports sharing this report's
   * `canonical_property_key`. Null where there is no key, no sibling, or the
   * siblings disagree — ambiguity is never resolved by picking one.
   */
  siblingType: string | null;
}

export interface GrowthReadiness {
  reportId: string;
  ready: boolean;
  /** The segmentation a provider must be asked for. Null when not ready. */
  dwellingClass: GrowthDwellingClass | null;
  /** The stored value the class came from, lower-cased. Null when unresolved. */
  dwellingType: string | null;
  route: DwellingResolutionRoute | null;
  exclusionReason: GrowthExclusionReason | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
}

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t ? t : null;
};

const specific = (v: string | null | undefined): string | null => {
  const t = clean(v)?.toLowerCase() ?? null;
  return t && !PLACEHOLDER_TYPES.has(t) ? t : null;
};

/**
 * Resolve the dwelling type by the three routes, in precedence order.
 *
 * `property_specs` first because it is the property record's own field;
 * the financial block second because it is the operator's stated parameter;
 * a sibling last because it is a fact about a DIFFERENT report that happens to
 * describe the same property.
 */
export function resolveDwellingType(
  c: Pick<GrowthCandidate, 'propertySpecsType' | 'financialCalcsType' | 'siblingType'>,
): { value: string; route: DwellingResolutionRoute } | null {
  const ps = specific(c.propertySpecsType);
  if (ps) return { value: ps, route: 'property_specs' };
  const fc = specific(c.financialCalcsType);
  if (fc) return { value: fc, route: 'financial_calculations' };
  const sib = specific(c.siblingType);
  if (sib) return { value: sib, route: 'sibling_canonical_key' };
  return null;
}

/**
 * The one predicate. Everything that needs a Growth denominator calls this.
 */
export function isGrowthBacktestReady(c: GrowthCandidate): GrowthReadiness {
  const suburb = clean(c.suburb);
  const state = clean(c.state)?.toUpperCase() ?? null;
  const postcode = clean(c.postcode);
  const base = { reportId: c.reportId, suburb, state, postcode };

  if (!suburb || !state) {
    return {
      ...base, ready: false, dwellingClass: null, dwellingType: null,
      route: null, exclusionReason: 'geography_absent',
    };
  }

  const resolved = resolveDwellingType(c);
  if (!resolved) {
    return {
      ...base, ready: false, dwellingClass: null, dwellingType: null,
      route: null, exclusionReason: 'dwelling_type_unresolved',
    };
  }

  const mapped = DWELLING_CLASS[resolved.value];
  if (mapped === undefined || mapped === 'land') {
    return {
      ...base, ready: false, dwellingClass: null,
      dwellingType: resolved.value, route: resolved.route,
      exclusionReason: 'dwelling_type_not_segmentable',
    };
  }

  return {
    ...base, ready: true, dwellingClass: mapped,
    dwellingType: resolved.value, route: resolved.route, exclusionReason: null,
  };
}

/** Counts over a population, for a manifest header or an audit line. */
export interface GrowthPopulationTally {
  considered: number;
  ready: number;
  byState: Record<string, number>;
  byClass: Record<GrowthDwellingClass, number>;
  byRoute: Record<DwellingResolutionRoute, number>;
  excluded: Record<GrowthExclusionReason, number>;
}

export function tallyGrowthPopulation(rows: readonly GrowthReadiness[]): GrowthPopulationTally {
  const t: GrowthPopulationTally = {
    considered: rows.length,
    ready: 0,
    byState: {},
    byClass: { house: 0, attached: 0 },
    byRoute: { property_specs: 0, financial_calculations: 0, sibling_canonical_key: 0 },
    excluded: {
      geography_absent: 0, dwelling_type_unresolved: 0, dwelling_type_not_segmentable: 0,
    },
  };
  for (const r of rows) {
    if (r.ready && r.dwellingClass && r.state) {
      t.ready += 1;
      t.byState[r.state] = (t.byState[r.state] ?? 0) + 1;
      t.byClass[r.dwellingClass] += 1;
      if (r.route) t.byRoute[r.route] += 1;
    } else if (r.exclusionReason) {
      t.excluded[r.exclusionReason] += 1;
    }
  }
  return t;
}
