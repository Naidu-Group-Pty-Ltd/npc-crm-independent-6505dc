/**
 * Forward demand — what a population is PROJECTED to do, not what it did.
 *
 * ── The claim this closes, and the one it must never make ────────────────
 *
 * W3.3 asks that *"no forward projection"* be replaced **everywhere** rather
 * than in one state. Two things have to be true for that to be honest, and
 * they pull in opposite directions:
 *
 * 1. A forward reading has to exist for a property in any jurisdiction.
 * 2. A forward reading may never be manufactured from a backward one.
 *
 * The second is the live risk here, because this platform **already holds the
 * backward one**. `abs_sa2_population` carries the ABS estimated resident
 * population by SA2 — 61,335 rows — and `populationGrowthEvidence.pure.ts`
 * turns it into a compound annual growth rate labelled *"Population growth"*.
 * That is a MEASUREMENT of the past. Presenting it, or anything derived from
 * it, as a statement about the future is the same class of fault as
 * `daActivityLine`'s partial walk and `rentalEvidence`'s absent-as-zero: a
 * real number carrying a claim nobody made.
 *
 * So `ESTIMATE_NAME_PATTERN` exists to REFUSE, not to match. A flow the ABS
 * names as an estimate or a regional population is named in the survey as
 * *already read and not a projection*, and can never be selected here.
 *
 * ── A projection is not an `EvidencePoint`, and that is a type decision ──
 *
 * `EvidencePoint.value`'s own documentation is *"The measurement. A zero here
 * is a measured zero."* Every consumer of that type feeds the scorer, and
 * `EvidenceProvider` is a closed union of measurement providers. Handing a
 * modelled forecast that type is precisely how a forecast comes to be scored
 * as a measurement, so `PopulationOutlook` is its own type and deliberately
 * cannot be passed anywhere an `EvidencePoint` is expected.
 *
 * It follows that **nothing here scores**. `demandScoring.pure.ts` §19's rule
 * is that a dimension is scored only where something measured it directly,
 * and `populationDriver` — a measurement of the past — is already capped as a
 * DRIVER that may not carry the dimension. A projection is weaker evidence
 * than that driver, not stronger. W3.3's deliverable is a SENTENCE the prose
 * can cite with its provenance, not a number on the grade; re-anchoring a
 * calibrated scale to raise a figure is the one thing this programme must not
 * do.
 *
 * ── The grain is read from the publisher's own codelist, never its name ──
 *
 * `ABS_BA_GRAIN_LADDER` reads a flow's NAME for its grain, which is right for
 * building approvals because the Bureau names the grain there. For
 * projections the name cannot be trusted to say it, and the question — *does
 * the ABS publish this at SA2?* — is the whole of W3.3's premise. So
 * `classifyRegionCodes` counts the flow's actual region CODES by their shape
 * and `finestPublishedGrain` answers from that.
 *
 * This matters because the premise may be false. Two premises have already
 * been wrong in this programme by exactly this route — *"no integrated layer
 * publishes overlays at a point"* (wrong for four jurisdictions) and
 * *"Queensland publishes no median sale price"* (it publishes it under a
 * different product) — and both were wrong because nobody asked the
 * publisher. A measured `state` answer here is a finding, not a failure.
 *
 * ── A projection carries an ASSUMPTION, and picking one silently is a lie ──
 *
 * The ABS publishes more than one projection series (high, medium, low
 * assumption sets about fertility, mortality and migration). They are not
 * error bars around a best guess — they are different scenarios. So:
 *
 * - the series is identified by the publisher's own NAME and never by
 *   position in a codelist,
 * - the reading NAMES which series it carries, and
 * - where the publisher offers a spread, the reading carries the spread too,
 *   because a single number from a chosen scenario reads as a forecast and
 *   the spread is what makes it a projection.
 *
 * Deno-compatible: no `@/` aliases, explicit `.ts` extensions.
 */
import type { DataflowEntry } from './absBuildingApprovals.pure.ts';
import type { DataStructure, StructureCode, StructureDimension } from './absDataStructure.pure.ts';

export const ABS_PROJECTION_AGENCY = 'ABS';

export const ABS_PROJECTION_SOURCE_LABEL =
  'Australian Bureau of Statistics, Population Projections';
export const ABS_PROJECTION_LICENCE = 'Creative Commons Attribution 4.0 International';
export const ABS_PROJECTION_LICENCE_URL =
  'https://www.abs.gov.au/privacy-and-legals/copyright';

/**
 * Said wherever a projected figure is quoted.
 *
 * The companion to `APPROVALS_ARE_NOT_COMPLETIONS`, and load-bearing for the
 * same reason: the sentence travels with the figure rather than living in a
 * methodology note a reader never reaches.
 */
export const A_PROJECTION_IS_NOT_A_MEASUREMENT =
  'A projection is the result of an assumption set applied to a base '
  + 'population, not a measurement of anything that has happened. It is not a '
  + 'forecast of what will occur, and the publisher does not present it as one.';

/** The subject pattern. A projection, and nothing that merely counts people. */
export const PROJECTION_NAME_PATTERN = /population\s+projection/i;

/**
 * What this module must REFUSE, named rather than left to fall off a list.
 *
 * These are estimates of the past. `abs_sa2_population` already holds one and
 * the report already cites it. Selecting one here would print a historical
 * series under a forward heading, which is the single worst thing this module
 * could do — and an omission from the allow-list would do it silently, so the
 * refusal is explicit and the survey reports it by name.
 */
export const ESTIMATE_NAME_PATTERN =
  /estimated\s+resident|regional\s+population|\bERP\b|national,?\s+state\s+and\s+territory\s+population/i;

/** The grain a set of region codes works at, finest first. */
export type ProjectionGrain = 'sa2' | 'sa3' | 'sa4' | 'gccsa' | 'lga' | 'state' | 'national';

/**
 * Finest first. The order a reading is preferred in, and the order
 * `finestPublishedGrain` walks.
 */
export const PROJECTION_GRAIN_ORDER: readonly ProjectionGrain[] = [
  'sa2', 'sa3', 'sa4', 'gccsa', 'lga', 'state', 'national',
];

/**
 * How coarse each grain is, for a reading that has to say so.
 *
 * Deliberately NOT a score. `openDataSalesEvidence`'s geography factor prices
 * a MEASUREMENT's grain for the scorer; nothing here reaches the scorer, so a
 * number that looks like one would invite exactly that wiring. This is prose.
 */
export const PROJECTION_GRAIN_LABEL: Readonly<Record<ProjectionGrain, string>> = {
  sa2: 'Statistical Area Level 2 — about the size of a suburb',
  sa3: 'Statistical Area Level 3 — a group of suburbs',
  sa4: 'Statistical Area Level 4 — a large region',
  gccsa: 'a whole capital city, or all of a state outside its capital',
  lga: 'local government area',
  state: 'state or territory',
  national: 'Australia',
};

/**
 * The shape of a region code, by grain.
 *
 * ASGS codes are fixed-width by level, which is what makes this readable
 * without a lookup: SA2 is 9 digits, SA3 is 5, SA4 is 3, a state is 1, and
 * `AUS` is the country. An LGA is 5 digits too, so the two are told apart by
 * the dimension's own id rather than by the code — `lgaDimension` below.
 *
 * `Number('')` is 0, which is why every rule here tests the STRING and never
 * a parsed value: a blank code would otherwise classify as a state.
 */
export function grainOfRegionCode(code: string, lgaDimension = false): ProjectionGrain | null {
  const c = code.trim();
  if (c === '') return null;
  if (/^(AUS|AU|0)$/i.test(c)) return 'national';
  if (/^\d{9}$/.test(c)) return 'sa2';
  if (/^\d{5}$/.test(c)) return lgaDimension ? 'lga' : 'sa3';
  if (/^\d{3}$/.test(c)) return 'sa4';
  /*
   * A two-digit code is the capital-city / rest-of-state level, and that was
   * MEASURED rather than inferred. The first live read of the Bureau's
   * projection structures reported 14 codes this rule could not place, so the
   * census was changed to carry their published NAMES and the next run
   * answered:
   *
   *     61  Hobart        62  Rest of Tas
   *     71  Darwin        72  Rest of NT
   *
   * Seven states split two ways plus an unsplit ACT is exactly 14, which is
   * what the census counted. So `11` is Greater Sydney and `12` is Rest of
   * NSW, and refusing both was understating the finest grain the Bureau
   * publishes by one level.
   *
   * The conclusion is unchanged — neither a capital city nor everything
   * outside one is this property's area — but an understated grain is an
   * understated register.
   */
  if (/^[1-8][12]$/.test(c)) return 'gccsa';
  /* The alphanumeric spelling other ASGS editions use for the same level. */
  if (/^[1-8]?(GSYD|GMEL|GBRI|GADE|GPER|GHOB|GDAR|ACTE|RNSW|RVIC|RQLD|RSAU|RWAU|RTAS|RNTE)$/i.test(c)) return 'gccsa';
  if (/^[1-8]$/.test(c)) return 'state';
  return null;
}

/** Which dimension of a structure carries the geography, if any. */
export const REGION_DIMENSION_PATTERN =
  /^(REGION|REGION_TYPE|ASGS_2016|ASGS_2021|ASGS_2026|LGA|SA2|SA3|SA4|STATE|GCCSA|REGION_LGA)$/i;

/**
 * Which dimension carries the publisher's assumption set, if any.
 *
 * Kept because another publisher may model it that way, and measured to be
 * the WRONG shape for the ABS — see `ASSUMPTION_DIMENSIONS` below.
 */
export const SERIES_DIMENSION_PATTERN = /^(PROJECTION_SERIES|SERIES|SCENARIO|ASSUMPTION|VARIANT)$/i;

/**
 * The ABS's assumption set is a CROSS-PRODUCT, and that was measured.
 *
 * Every one of the Bureau's four projection flows carries no series dimension
 * at all. It carries four independent assumption dimensions instead —
 * measured 22 Sep 2026 from CI:
 *
 *     4. FERTILITY    3 codes
 *     5. MORTALITY    2 codes
 *     6. NOM          4 codes   (net overseas migration)
 *     7. NIM          3 codes   (net interstate migration)
 *
 * That is **72 combinations**, not three named series, and it makes the first
 * draft of this module wrong in SHAPE rather than in pattern:
 * `CENTRAL_SERIES_PATTERN` had nothing to match and correctly reported
 * `UNMATCHED`, which read as a gap in the publisher's metadata when it was a
 * gap in my model of it.
 *
 * Two rules follow, and the second is the one that matters.
 *
 * **A reading names every assumption it rests on**, not one label. A figure
 * from (medium fertility, medium mortality, NOM 3, NIM 2) is a different
 * figure from the same flow under another combination, and printing either
 * as "the projection" is asserting a scenario nobody chose — which is what a
 * single `series` field would have invited.
 *
 * **There is no central combination to default to**, and the measured choice
 * names show how badly a default would fail. The Bureau publishes:
 *
 *     FERTILITY   High fertility · Medium fertility · Low fertility
 *     MORTALITY   High life expectancy · Medium life expectancy
 *     NOM         High NOM · Medium NOM · Low NOM · **Zero NOM**
 *     NIM         Large interstate flows · Medium · Small interstate flows
 *
 * `Zero NOM` is a sensitivity case — net overseas migration of nothing at all
 * — which nobody would call a forecast. And taking `choices[0]` from each,
 * the obvious default, yields *High fertility, High life expectancy, High
 * NOM, Large interstate flows*: the maximum-growth corner of a 72-cell space,
 * printed as "the projection".
 *
 * So `assumptions` is REPORTED and a caller that wants a figure must be
 * handed a combination explicitly. `choices[0]` is forbidden by a spec.
 */
export const ASSUMPTION_DIMENSIONS = /^(FERTILITY|MORTALITY|NOM|NIM|MIGRATION|LIFE_EXPECTANCY)$/i;

/**
 * Dimensions that describe the POPULATION rather than the scenario.
 *
 * `SEX_ABS` and `AGE` slice a projection; they are not assumptions about the
 * future. Told apart because a reading has to say which assumptions it rests
 * on, and listing 194 age codes among them would drown the four that matter.
 */
export const SLICE_DIMENSIONS = /^(SEX|SEX_ABS|AGE|AGE_GROUP|MEASURE|FREQUENCY|FREQ|TSEST)$/i;

export interface RegionCensus {
  /** How many codes of each grain the flow's own codelist holds. */
  counts: Readonly<Partial<Record<ProjectionGrain, number>>>;
  /**
   * Codes the shape rules could not place — **with their published names.**
   *
   * The names are the point. The first live run reported 14 unplaced codes as
   * bare ids (`11, 12, 21, 22, 31, 32, 41, 42, …`) and `finest grain: state`,
   * and two-digit ASGS codes are almost certainly a capital-city and
   * rest-of-state split — a grain FINER than state, refused and therefore
   * understating the answer.
   *
   * "Almost certainly" is not a measurement, which is why this carries the
   * name: the next run says what the Bureau calls code `11` and the rule is
   * written from that rather than from an inference. Printing the ids alone
   * is what made the gap visible; printing the names is what closes it.
   */
  unplaced: StructureCode[];
  /** The dimension the census was taken from. */
  dimensionId: string;
}

/**
 * Count a region codelist by grain.
 *
 * The census is what answers W3.3's premise. A codelist holding only single
 * digits and `AUS` is a state-and-national flow however its title reads, and
 * saying so is a measurement rather than an opinion.
 */
export function classifyRegionCodes(
  dimension: StructureDimension,
): RegionCensus {
  const lgaDimension = /LGA/i.test(dimension.id);
  const counts: Partial<Record<ProjectionGrain, number>> = {};
  const unplaced: StructureCode[] = [];
  for (const code of dimension.codes) {
    const grain = grainOfRegionCode(code.id, lgaDimension);
    if (grain === null) { unplaced.push(code); continue; }
    counts[grain] = (counts[grain] ?? 0) + 1;
  }
  return { counts, unplaced, dimensionId: dimension.id };
}

/**
 * The minimum number of codes a grain needs before it counts as published.
 *
 * One SA2 code in a state-level flow is a rounding artefact of somebody's
 * codelist, not SA2 coverage — and reading it as coverage would answer W3.3's
 * premise `yes` off a single row. Australia has ~2,500 SA2s, ~340 SA3s, ~90
 * SA4s and 8 states, so a floor of eight is under every real level and over
 * every stray.
 */
export const GRAIN_PRESENCE_FLOOR = 8;

/** The finest grain the flow genuinely publishes, or null. */
export function finestPublishedGrain(census: RegionCensus): ProjectionGrain | null {
  for (const grain of PROJECTION_GRAIN_ORDER) {
    if ((census.counts[grain] ?? 0) >= GRAIN_PRESENCE_FLOOR) return grain;
  }
  return null;
}

export interface SurveyedProjectionFlow {
  entry: DataflowEntry;
  /** `projection` — admissible. `estimate` — refused, and named. */
  kind: 'projection' | 'estimate';
}

/**
 * Every population flow the catalogue holds, split by what it measures.
 *
 * Both kinds are returned. An estimate is reported rather than filtered away,
 * because "the ABS publishes no projection" and "the ABS publishes estimates
 * this platform mistook for projections" are different findings and the log
 * has to be able to tell them apart.
 */
export function surveyPopulationFlows(
  entries: readonly DataflowEntry[],
): SurveyedProjectionFlow[] {
  const out: SurveyedProjectionFlow[] = [];
  for (const entry of entries) {
    const name = entry.name ?? '';
    const isEstimate = ESTIMATE_NAME_PATTERN.test(name);
    const isProjection = PROJECTION_NAME_PATTERN.test(name);
    if (!isEstimate && !isProjection) continue;
    /*
     * An estimate wins the tie. A flow named "Population Projections,
     * Estimated Resident Population" would otherwise be admitted by the
     * projection half of its own title, and the conservative reading is the
     * one that cannot print history under a forward heading.
     */
    out.push({ entry, kind: isEstimate ? 'estimate' : 'projection' });
  }
  return out;
}

/** One assumption a projection rests on, and the choices the publisher offers. */
export interface AssumptionDimension {
  id: string;
  /** Every choice, verbatim, so a reading can name the one it used. */
  choices: StructureCode[];
}

export interface ProjectionStructureReading {
  region: RegionCensus | null;
  finestGrain: ProjectionGrain | null;
  /**
   * A single series dimension, where a publisher models it that way. The ABS
   * does not — measured — and this is null on all four of its flows.
   */
  seriesDimensionId: string | null;
  /** The publisher's own series names, verbatim. Empty where there is none. */
  seriesNames: string[];
  /**
   * The assumption dimensions a figure from this flow rests on, and how many
   * combinations they make. `combinations` is the number a reading has to
   * choose from, and it is reported rather than resolved: nothing here may
   * pick a scenario.
   */
  assumptions: AssumptionDimension[];
  combinations: number;
  /** Every dimension, so a log can show what the key would have to cover. */
  dimensions: ReadonlyArray<{ id: string; position: number; codes: number; isTime: boolean }>;
}

/** Read a projection flow's structure for everything W3.3 has to decide. */
export function readProjectionStructure(structure: DataStructure): ProjectionStructureReading {
  const regionDim = structure.dimensions.find(
    (d) => !d.isTime && REGION_DIMENSION_PATTERN.test(d.id),
  ) ?? null;
  const seriesDim = structure.dimensions.find(
    (d) => !d.isTime && SERIES_DIMENSION_PATTERN.test(d.id),
  ) ?? null;
  const region = regionDim ? classifyRegionCodes(regionDim) : null;
  const seriesNames = seriesDim ? seriesDim.codes.map((c) => c.name) : [];
  /*
   * Every dimension that is neither the geography, nor time, nor a slice of
   * the population is an assumption about the future. Derived that way rather
   * than from a list of names, because a publisher that adds a fifth
   * assumption must not have it silently dropped from a reading's provenance.
   */
  const assumptions: AssumptionDimension[] = structure.dimensions
    .filter((d) => !d.isTime
      && d !== regionDim
      && !REGION_DIMENSION_PATTERN.test(d.id)
      && !SLICE_DIMENSIONS.test(d.id)
      && d.codes.length > 0)
    .map((d) => ({ id: d.id, choices: d.codes }));
  const combinations = assumptions.reduce((n, a) => n * Math.max(1, a.choices.length), 1);
  return {
    region,
    finestGrain: region ? finestPublishedGrain(region) : null,
    seriesDimensionId: seriesDim?.id ?? null,
    seriesNames,
    assumptions,
    combinations,
    dimensions: structure.dimensions.map((d) => ({
      id: d.id,
      position: d.position,
      codes: d.codes.length,
      isTime: d.isTime,
    })),
  };
}

/*
 * `ForwardDemandAvailability` deliberately does NOT live here. It is a
 * statement about what THIS DEPLOYMENT can say, which is policy, and it lives
 * in `forwardDemand.pure.ts` beside the publishers it names. This module
 * answers only what the Bureau publishes. Two modules deciding one question
 * is how they come to disagree — and a first draft of this work had the type
 * in both files.
 */

/**
 * The grain at or below which a projection describes the property's own area
 * rather than a region it happens to sit in.
 *
 * `MARKET_FIGURES_IN_THE_REPORT.md`'s rule — *a benchmark is drawn apart,
 * under a heading saying it describes a different geography, because a state
 * figure beside a suburb one reads as the suburb's* — applied to a forecast.
 * SA3 is the ceiling: a group of suburbs is still recognisably this area,
 * while an SA4 or a state is a region the property is IN.
 */
export const AREA_GRAINS: readonly ProjectionGrain[] = ['sa2', 'sa3'];

export function describesTheArea(grain: ProjectionGrain): boolean {
  return AREA_GRAINS.includes(grain);
}
