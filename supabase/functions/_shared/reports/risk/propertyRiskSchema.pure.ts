/**
 * ME-5.1 items 1–3 — property type SELECTS the risk questions; it never answers
 * them.
 *
 * ## The contradiction this corrects
 *
 * ME-5 §58.6 concluded, with evidence, that **asset type is a classifier, not a
 * score**: the numbers are unevidenced, 70.4% of resolvable reports receive the
 * identical 82, two real stored types resolve to nothing, and vacant land is a
 * different asset class rather than a worse house.
 *
 * It then recommended Model B, which weights `assetType` at **0.67** — more
 * than triple the 0.20 the live model gives it. The recommendation contradicted
 * the finding, and the invariance test did not catch it because invariance is
 * the wrong instrument: it asserts that the SAME property scores the same
 * across reports, and says nothing about whether a house and a unit are
 * compared fairly. A model can be perfectly invariant and still hand every
 * house 82 and every unit 55 for no evidenced reason.
 *
 * ## What replaces it
 *
 *   propertyType → selects the applicable risk QUESTIONS
 *                → genuine property-specific evidence answers them
 *                → Risk exists only where enough of it does
 *
 * The asset class contributes **zero points**. It decides which questions are
 * worth asking of a dwelling of that kind, which is a classification job and
 * the only thing the stored type is competent to do.
 *
 * ## What this deployment can actually answer, measured
 *
 * Every question below is declared with the evidence that would answer it and
 * whether the platform holds it. Measured on 8 September 2026:
 *
 * | candidate source | rows | grain | property-level? |
 * | --- | ---: | --- | --- |
 * | `crime_reference` / `crime_month_counts` | 54,001 | postcode, LGA, SA2 — NSW, QLD, SA, NT only | no |
 * | `abs_seifa_poa` + `abs_census_poa` | 5,270 | postcode | no |
 * | `climate_data_cache` | 1,237 | area | no |
 * | `planning_data_cache` | **2** | — | effectively empty |
 * | flood / bushfire hazard | **none** | — | not held |
 * | strata / body corporate | **none** | — | not held |
 * | condition / inspection / defects | **none** | — | not held |
 *
 * So the honest answer is that **Aurixa holds no property-level risk evidence
 * at all.** What it holds is area context that other dimensions already own —
 * crime and SEIFA are Location's, and scoring them here would double-count the
 * same signal under a second name.
 *
 * That is why every question resolves `unavailable` today and Risk is null.
 * The brief anticipated this: *"Do not manufacture Risk merely because its
 * nominal composite weight is 5%."* A schema that names what is missing is
 * worth more than a score that invents it, because it is also the acquisition
 * list.
 *
 * ## What changed upstream, and why it still does not score (18 Sep 2026)
 *
 * Two of the rows above have gone stale in the direction that matters. The
 * planning programme closed the retrieval gap: `planning-data-service` reads
 * the jurisdiction's own layers at the verified coordinate, and
 * `PLANNING_CONTROLS_IN_THE_REPORT.md` §8 records the probe — NSW answers the
 * LEP, the zone, heritage, bushfire, flood, landslide and acid sulfate soils,
 * each with the clause that creates it and its own currency date; Victoria's
 * overlays sit on the same endpoint as its zones; Queensland answers flood
 * hazard and 26 MSES layers; Tasmania answers both overlay registers. On
 * report `9bd41c05` that is a real reading — `R2 — Low Density Residential`
 * from the NSW Planning Portal's Principal Planning Layers, CC BY 4.0,
 * effective 2026-08-07, retrieved 2026-09-17T08:58:23.845Z. So
 * `site_hazard_exposure` and `planning_constraints` ARE held at parcel grain.
 *
 * They still cannot answer their questions — but the reason recorded here
 * first was WRONG, and it is corrected rather than quietly dropped.
 *
 * It read: *"a 0-100 safety score is a rating, and no publisher issues one"*,
 * concluding that what was outstanding was a published scale. That is not the
 * bar. **An internal methodology does not need a government publisher to
 * supply a ready-made score; it needs a defensible, documented and versioned
 * basis.** The platform writes such bases routinely — `OVERHEATING_ANCHORS`
 * below is one, `SEVERITY_DEDUCTION` in `conditionRecord.pure.ts` is another.
 * Saying otherwise put a whole class of evidence permanently out of reach on a
 * premise nobody had tested, and it is the reason this dimension was reported
 * as a methodology limit when it is an evidence gap.
 *
 * The real reason is narrower and survives the correction:
 *
 *   **The retrieval is an identify at a single COORDINATE, and an
 *   address-point query is never clearance for a parcel.** A layer that misses
 *   the point may still cross the lot, so `answered, no intersection` cannot
 *   become a reading — and a hazard the publisher has not mapped is not a
 *   hazard the parcel lacks. Scoring the absence would be §9's defect exactly
 *   ("an absence may not be RATED"). `assessPepEvidence`'s asymmetry is the
 *   same rule: a HIT is a signal, a MISS is not a clearance.
 *
 * That is a defect of the QUERY rather than of the evidence class, and the
 * first step is now BUILT: `parcelGeometry.pure.ts` resolves a parcel
 * CANDIDATE from the cadastre and re-asks the registers with the lot polygon
 * (`docs/reports/evidence/PARCEL_PROBE_2026-09-18.json` — QLD layer 4
 * answers the polygon in ~240 ms and FloodCheck accepts it as the query
 * geometry). Two measured cautions travel with it: two geocodes of one
 * address resolved two DIFFERENT lots, so a coordinate-selected parcel is a
 * candidate until a person confirms the lot/plan; and NSW's cadastre now
 * answers its query in ~420 ms while the stored NSW subject coordinate lies
 * on no lot at all (`no_lot_at_point` — a fact about the coordinate). A
 * completed negative exists only at parcel grain over a complete sweep, and
 * no conversion turns any of it into a score.
 *
 * They therefore stay {@link EvidenceAvailability} `held_but_unscoreable` —
 * named on the page as evidence and contributing nothing — and
 * `unscoreableHoldings()` is that second list. What is outstanding for them is
 * a parcel-grain query, not a published scale.
 *
 * And even with the parcel query done, Risk would not score for an established
 * house on the strength of these two alone: hazard and planning are ONE
 * independent category (`site`) in `riskModelD.pure.ts`,
 * `MINIMUM_INDEPENDENT_CATEGORIES` is 2, and the only other category a house's
 * schema offers is `building` — `condition_and_maintenance`. **Every route to
 * a fifth scored dimension therefore runs through a condition record**, which
 * is why `conditionRecord.pure.ts` is the recommended method rather than a
 * preference among several.
 *
 * That grouping stays, and its stated reason is corrected too. It read: *"two
 * readings that are present or absent together — if the state's portal
 * answers, both answer"*. The probe disproves that as a fact — on 18 Sep 2026
 * NSW's Principal Planning Layers answered WITH an intersection while its
 * Hazard and Protection services answered with none, from three separate
 * endpoints that fail independently. The grouping is right for a different
 * reason, and it is the reason `QUESTION_CATEGORY` gives: both readings
 * describe **the same site**, so they are two facts about one thing rather
 * than two independent observations. Common availability was never the test;
 * common subject is.
 */

/** The classes a stored property type maps onto. Selection only. */
export type AssetClass =
  | 'established_house'
  | 'strata_dwelling'
  | 'medium_density'
  | 'land_or_new_build';

/**
 * Stored type → class.
 *
 * Returns null for a placeholder or an unrecognised value: selecting the wrong
 * question set is a smaller harm than scoring, but it is still a harm, and the
 * corpus carries 311 rows of `residential property`, `other` and empty string.
 */
export function resolveAssetClass(raw: unknown): AssetClass | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  switch (key) {
    case 'house': return 'established_house';
    case 'apartment':
    case 'unit': return 'strata_dwelling';
    case 'townhouse':
    case 'duplex':
    // A villa is single-storey medium density; whether it is strata or Torrens
    // varies by title and the stored value does not say. Medium density is the
    // classification whose questions overlap both, and the ambiguity is
    // recorded rather than resolved by guess.
    case 'villa': return 'medium_density';
    case 'land':
    case 'house_and_land': return 'land_or_new_build';
    default: return null;
  }
}

/** Stored values that are a placeholder rather than a type. */
export const PLACEHOLDER_TYPES: readonly string[] = [
  'residential property', 'other', 'unknown', 'n/a', '',
];

/** Where a question's answer would have to come from. */
export type EvidenceAvailability =
  /** The platform holds this at property grain. */
  | 'held_property_level'
  /** Held, but at an area grain that cannot speak about one property. */
  | 'held_area_level_only'
  /**
   * Held at property grain as a NAMED FACT, and still unable to answer this
   * question, because no publisher issues a scale that converts the fact into
   * a risk score. It reaches the reader as evidence — the planning and hazard
   * sections print the control, its instrument and its currency date — and it
   * contributes nothing here. What is outstanding is a published scale, not a
   * retrieval, so it is not on the acquisition backlog.
   */
  | 'held_but_unscoreable'
  /** Another dimension already owns this signal; scoring it here double-counts. */
  | 'owned_by_another_dimension'
  /** Not held by this deployment in any form. */
  | 'not_held';

export interface RiskQuestion {
  id: string;
  /** What is being asked, in words an operator would use. */
  question: string;
  /** Why it bears on THIS asset class specifically. */
  rationale: string;
  /** What would have to be acquired or measured to answer it. */
  evidenceRequired: string;
  availability: EvidenceAvailability;
  /** Where it is owned, when `owned_by_another_dimension`. */
  ownedBy?: 'location' | 'growth' | 'demand' | 'yield';
}

const HAZARD: RiskQuestion = {
  id: 'site_hazard_exposure',
  question: 'Is the site exposed to flood, bushfire, coastal erosion or landslip?',
  rationale:
    'A hazard overlay attaches to the parcel rather than the suburb, changes insurability and '
    + 'financeability, and is the single largest property-specific downside risk in Australian '
    + 'residential property.',
  evidenceRequired:
    'RETRIEVED since the planning programme: the jurisdiction\'s own hazard layers at the verified '
    + 'coordinate — NSW bushfire-prone land, flood, landslide and acid sulfate soils; Queensland flood '
    + 'hazard; Victoria\'s and Tasmania\'s overlay registers — each with the instrument that creates it and '
    + 'its own currency date. What is outstanding is a published scale that turns a named designation into a '
    + 'risk score. There is none, and inventing one would rate an absence.',
  availability: 'held_but_unscoreable',
};

const PLANNING: RiskQuestion = {
  id: 'planning_constraints',
  question: 'Do zoning, heritage or overlay constraints limit what may be done with the site?',
  rationale:
    'Constraints bound the improvement and redevelopment options that underpin a long-hold '
    + 'thesis, and they are parcel-specific.',
  evidenceRequired:
    'RETRIEVED since the planning programme: state planning-portal zoning and overlay layers by '
    + 'coordinate, with publisher, licence and the instrument\'s own currency date. Report 9bd41c05 carries '
    + '`R2 — Low Density Residential` from the NSW Principal Planning Layers, CC BY 4.0, effective '
    + '2026-08-07. What is outstanding is a published scale, exactly as for site hazard.',
  availability: 'held_but_unscoreable',
};

const CONDITION: RiskQuestion = {
  id: 'condition_and_maintenance',
  question: 'What is the dwelling’s condition, age and deferred-maintenance exposure?',
  rationale:
    'Capital expenditure is a direct claim on an established dwelling’s net return, and it is '
    + 'specific to the building rather than the area.',
  evidenceRequired:
    'A CONDITION RECORD — a building inspection report, strata report, building certificate or '
    + 'vendor\'s statement, with its issuer, its date and what it examined. `conditionRecord.pure.ts` is '
    + 'the recommended method and holds the admissibility rules. Measured 18 September 2026 over all 1,230 '
    + 'stored reports, `property_specs` carries a construction year on 0: `year_built` is present as an '
    + 'explicit JSON null on 1,102 rows and holds a value on none, and `yearBuilt`, `buildYear`, '
    + '`constructionYear` and `yearOfConstruction` are absent entirely. The 32 years the platform does hold '
    + 'are operator-typed `manual_overrides.constructionYear`, none carrying a source or reason, and 31 of '
    + 'them a completion expectation rather than a build date — see `constructionAgeCandidate.pure.ts`. '
    + 'This is the only other independent category an established house\'s schema offers, which is why '
    + 'retrieving the two site controls above could not by itself make Risk scoreable.',
  availability: 'not_held',
};

const STRATA: RiskQuestion = {
  id: 'strata_health',
  question: 'Is the owners corporation solvent, adequately funded and free of major defects?',
  rationale:
    'For a strata dwelling the body corporate is a liability the owner cannot exit: an underfunded '
    + 'sinking fund or an unresolved defect claim is a direct, property-specific downside.',
  evidenceRequired:
    'Strata search / body-corporate records: levy history, sinking-fund balance, defect and '
    + 'litigation disclosures. No strata table exists in this deployment.',
  availability: 'not_held',
};

const UNIT_SUPPLY: RiskQuestion = {
  id: 'local_unit_supply_concentration',
  question: 'How much comparable attached stock is being delivered into this immediate market?',
  rationale:
    'Concentrated new supply competes directly with an attached dwelling for the same tenant and '
    + 'the same resale buyer, in a way it does not for a detached house.',
  evidenceRequired:
    'Dwelling-approval or project-pipeline counts at SA2 grain or finer, by dwelling structure.',
  availability: 'not_held',
};

const CONSTRUCTION: RiskQuestion = {
  id: 'construction_and_completion',
  question: 'What is the completion, builder-solvency and holding-cost exposure before settlement?',
  rationale:
    'Land and house-and-land carry risks an established dwelling simply does not have — the asset '
    + 'does not exist yet, and the buyer holds cost and counterparty exposure until it does. '
    + 'Forcing these onto an established-dwelling scale is a category error.',
  evidenceRequired:
    'Builder identity and solvency signals, contract type, fixed-price status, construction '
    + 'programme and stage-payment schedule. The `builder_*` tables exist but hold no rows for '
    + 'these; they serve a separate portal.',
  availability: 'not_held',
};

const TITLE_TIMING: RiskQuestion = {
  id: 'title_and_registration_timing',
  question: 'When does title register, and what is the sunset-clause exposure?',
  rationale:
    'Registration timing governs when finance can settle and when a sunset clause could be '
    + 'exercised against the buyer. It applies to land and off-the-plan alone.',
  evidenceRequired: 'Contract terms and the developer’s registration programme.',
  availability: 'not_held',
};

/** Signals other dimensions own. Listed so the overlap is explicit, not silent. */
const AREA_CRIME: RiskQuestion = {
  id: 'area_crime',
  question: 'What is the recorded crime level in the surrounding area?',
  rationale:
    'Real and loaded for NSW, QLD, SA and NT — but it describes an area rather than a property, '
    + 'and it is an amenity characteristic of the location.',
  evidenceRequired: 'Already held: `crime_reference` at postcode, LGA or SA2 grain.',
  availability: 'owned_by_another_dimension',
  ownedBy: 'location',
};

const AREA_SOCIOECONOMIC: RiskQuestion = {
  id: 'area_socioeconomic',
  question: 'What is the socioeconomic profile of the surrounding area?',
  rationale:
    'SEIFA and Census are held at postcode grain and are a location characteristic. Scoring them '
    + 'here would count one signal twice under two names.',
  evidenceRequired: 'Already held: `abs_seifa_poa`, `abs_census_poa`.',
  availability: 'owned_by_another_dimension',
  ownedBy: 'location',
};

/**
 * The applicable questions per class.
 *
 * Deliberately overlapping where the risk genuinely overlaps, and deliberately
 * disjoint where it does not: a strata dwelling is asked about its owners
 * corporation and a house is not, and neither is asked about completion risk.
 */
export const SCHEMA_BY_ASSET_CLASS: Readonly<Record<AssetClass, readonly RiskQuestion[]>> = {
  established_house: [HAZARD, PLANNING, CONDITION, AREA_CRIME, AREA_SOCIOECONOMIC],
  strata_dwelling: [STRATA, UNIT_SUPPLY, HAZARD, CONDITION, AREA_CRIME, AREA_SOCIOECONOMIC],
  medium_density: [STRATA, UNIT_SUPPLY, HAZARD, PLANNING, CONDITION, AREA_CRIME, AREA_SOCIOECONOMIC],
  land_or_new_build: [CONSTRUCTION, TITLE_TIMING, HAZARD, PLANNING, AREA_CRIME, AREA_SOCIOECONOMIC],
};

/** Questions that could ever contribute to a PROPERTY risk score. */
export function scoreableQuestions(cls: AssetClass): readonly RiskQuestion[] {
  return SCHEMA_BY_ASSET_CLASS[cls].filter(
    (q) => q.availability !== 'owned_by_another_dimension',
  );
}

/** How many of a class's own questions this deployment can answer today. */
export function answerableCount(cls: AssetClass): number {
  return scoreableQuestions(cls).filter((q) => q.availability === 'held_property_level').length;
}

/**
 * What would actually make Risk scoreable for one asset class, in a sentence.
 *
 * Derived from the schema rather than restated beside it. The literal it
 * replaces read *"Answered property-risk questions from the per-class schema
 * (hazard, planning, condition, strata)"* — which names hazard and planning as
 * outstanding when the planning programme retrieves both, and names strata on
 * a house that is never asked about one. A remedy that misdescribes the
 * platform's own holdings sends an operator to buy what it already reads.
 */
export function riskRemedyFor(cls: AssetClass | null): string {
  if (!cls) {
    return 'A recorded property type, which selects the risk questions that apply. A placeholder '
      + 'selects none.';
  }
  const applicable = scoreableQuestions(cls);
  const name = (q: RiskQuestion) => q.id.replace(/_/g, ' ');
  // Semicolons rather than commas where the list is a run of question names:
  // three of them contain "and", and a comma list reads as two items where
  // there are three. A pair inside a noun phrase still takes "and".
  const list = (qs: readonly RiskQuestion[]) => qs.map(name).join('; ');
  const phrase = (qs: readonly RiskQuestion[]) =>
    qs.map(name).join(qs.length > 2 ? '; ' : ' and ');
  const unretrieved = applicable.filter((q) => q.availability === 'not_held');
  const retrieved = applicable.filter((q) => q.availability === 'held_but_unscoreable');
  const parts: string[] = [];
  if (unretrieved.length) {
    parts.push(
      `Evidence this deployment does not hold: ${list(unretrieved)}.`,
    );
  }
  if (retrieved.length) {
    const one = retrieved.length === 1;
    parts.push(
      `The ${phrase(retrieved)} control${one ? ' is' : 's are'} retrieved already, at a single coordinate; `
      + `what is outstanding for ${one ? 'it' : 'them'} is a query against the parcel rather than the address `
      + 'point. A layer that misses the point may still cross the lot, so nothing found at the point is not a '
      + 'finding about the property, and scoring it would rate an absence.',
    );
  }
  parts.push(
    'A score also needs observations spanning at least two independent categories — two readings of the same '
    + 'site are one observation, not two.',
  );
  return parts.join(' ');
}

/**
 * Held at parcel grain, and still not an answer — the SCALE backlog.
 *
 * Deliberately a separate list from {@link acquisitionBacklog}. Collapsing the
 * two would say these controls are not retrieved, which is no longer true and
 * would send somebody to buy a dataset the platform already reads.
 */
export function unscoreableHoldings(): readonly RiskQuestion[] {
  const seen = new Map<string, RiskQuestion>();
  for (const questions of Object.values(SCHEMA_BY_ASSET_CLASS)) {
    for (const q of questions) {
      if (q.availability === 'held_but_unscoreable' && !seen.has(q.id)) seen.set(q.id, q);
    }
  }
  return [...seen.values()];
}

/** Everything the schema would need, deduplicated — the acquisition list. */
export function acquisitionBacklog(): readonly RiskQuestion[] {
  const seen = new Map<string, RiskQuestion>();
  for (const questions of Object.values(SCHEMA_BY_ASSET_CLASS)) {
    for (const q of questions) {
      if (q.availability === 'not_held' && !seen.has(q.id)) seen.set(q.id, q);
    }
  }
  return [...seen.values()];
}
