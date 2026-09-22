/**
 * What this report may say about forward demand, and who publishes it.
 *
 * ── The split, and why it is two modules ─────────────────────────────────
 *
 * `absPopulationProjections.pure.ts` is a READER: it answers what the
 * Australian Bureau of Statistics publishes and at what grain, by measuring
 * the Bureau's own codelists. This module is the POLICY: it answers what a
 * report may state when that reading is coarse, absent or not loaded, and who
 * a reader should go to instead.
 *
 * They are not two answers to one question — which is the fault
 * `assessEnrichmentReuse` and `locationIntelligence` were separated to avoid.
 * One is a fact about a publisher; the other is a sentence about this
 * deployment.
 *
 * ── W3.3's word is "everywhere" ──────────────────────────────────────────
 *
 * The acceptance is that *"no forward projection"* is replaced **everywhere
 * rather than in one state**. That word is what makes the obvious
 * implementation wrong. Loading one jurisdiction's projections — Victoria in
 * Future, say — replaces the sentence for Victorian properties and leaves it
 * standing for the other seven, which is the failure the criterion names in
 * advance.
 *
 * So `FORWARD_DEMAND_PUBLISHERS` names, for every state and territory, the
 * body that publishes forward population projections for that jurisdiction,
 * and `forwardDemandCoverageNote` composes one sentence from it. A reader in
 * any jurisdiction gets a named publisher and a route to the figure on day
 * one, before any per-jurisdiction ingest exists — which is W3.4's work.
 *
 * `PROGRAMME_PUBLISHERS` in `investmentProgramme.pure.ts` is the precedent
 * and the shape: §4's rule there is that *"No equivalent structured dataset
 * found" must not become "NSW has no relevant programme."* It must not, and
 * it does not here either.
 *
 * ── What is deliberately NOT stated ──────────────────────────────────────
 *
 * **No grain.** An earlier draft carried the finest grain each jurisdiction
 * publishes at, and it was removed rather than softened: this deployment
 * cannot reach any of these publishers to check it — the development egress
 * answers 403 to CONNECT and the production egress has never asked — so a
 * grain here would be a claim about somebody else's product that nothing in
 * this repository could verify. The sentence is just as useful without it,
 * and `describesTheArea` is the rule that applies once a register is
 * actually read.
 *
 * **No figure, ever.** Nothing in this module states a population, a rate, a
 * base year or a horizon. `planningControlGuide.pure.ts` answers to the same
 * rule for the same reason: a guide that carries no figure can be written in
 * advance and still be true, and a spec rejects any that creeps in.
 *
 * **Nothing is `ingested: true`.** Every entry is false, truthfully, and a
 * test asserts it — so the day one is loaded, the flag and the sentence
 * change together rather than one of them being forgotten.
 *
 * Deno-compatible: no `@/` aliases, explicit `.ts` extensions.
 */
import {
  A_PROJECTION_IS_NOT_A_MEASUREMENT,
  describesTheArea,
  PROJECTION_GRAIN_LABEL,
  type ProjectionGrain,
} from './absPopulationProjections.pure.ts';

/** A jurisdiction's own forward projection, and what form it takes. */
export interface ForwardDemandPublisher {
  /** The body that publishes it. */
  publisher: string;
  /** The product's own name. */
  product: string;
  /**
   * `structured` — a machine-readable feed this platform could read.
   * `publication` — tables, workbooks or an interactive: real, official and
   * current, but not a feed.
   *
   * Declared rather than measured, for the reason the header gives, and the
   * conservative value is `publication`.
   */
  form: 'structured' | 'publication';
  /** Whether this platform reads it today. */
  ingested: boolean;
  /** Where a reader goes to see it themselves. */
  url: string;
}

/**
 * Every state and territory, named.
 *
 * Nothing here says a jurisdiction publishes no projection, because every one
 * of them does. What differs is whether this platform reads it, and that is a
 * fact about this platform.
 */
export const FORWARD_DEMAND_PUBLISHERS: Readonly<Record<string, ForwardDemandPublisher>> = {
  NSW: {
    publisher: 'the NSW Department of Planning, Housing and Infrastructure',
    product: 'the NSW population projections',
    form: 'publication',
    ingested: false,
    url: 'https://www.planning.nsw.gov.au/research-and-demography/population-projections',
  },
  VIC: {
    publisher: 'the Victorian Department of Transport and Planning',
    product: 'Victoria in Future',
    form: 'publication',
    ingested: false,
    url: 'https://www.planning.vic.gov.au/guides-and-resources/data-and-insights/victoria-in-future',
  },
  QLD: {
    publisher: 'the Queensland Government Statistician’s Office',
    product: 'the Queensland Government population projections',
    form: 'publication',
    ingested: false,
    url: 'https://www.qgso.qld.gov.au/statistics/theme/population/population-projections',
  },
  SA: {
    publisher: 'the South Australian Department for Housing and Urban Development',
    product: 'the South Australian population projections',
    form: 'publication',
    ingested: false,
    url: 'https://plan.sa.gov.au/',
  },
  WA: {
    publisher: 'the Western Australian Planning Commission',
    product: 'WA Tomorrow',
    form: 'publication',
    ingested: false,
    url: 'https://www.wa.gov.au/organisation/department-of-planning-lands-and-heritage',
  },
  TAS: {
    publisher: 'the Tasmanian Department of Treasury and Finance',
    product: 'the Tasmanian population projections',
    form: 'publication',
    ingested: false,
    url: 'https://www.treasury.tas.gov.au/economy/population',
  },
  ACT: {
    publisher: 'the ACT Chief Minister, Treasury and Economic Development Directorate',
    product: 'the ACT population projections',
    form: 'publication',
    ingested: false,
    url: 'https://www.treasury.act.gov.au/',
  },
  NT: {
    publisher: 'the Northern Territory Department of Treasury and Finance',
    product: 'the Northern Territory population projections',
    form: 'publication',
    ingested: false,
    url: 'https://treasury.nt.gov.au/',
  },
};

/**
 * What this deployment can say about forward demand for one property, and why.
 *
 * Five readings, and they are five different sentences for the reason
 * `SUPPLY_EVIDENCE.md` and `NATIONAL_PIPELINE_EVIDENCE.md` both record: an
 * absence that cannot say which kind it is sends a reader — or an operator —
 * to the wrong conclusion. Here the two that would otherwise collapse are
 * `coarser_than_area` (we hold a projection, and it is about a region rather
 * than this suburb) and `grain_not_published` (the publisher does not offer
 * one for an area this size at all): the first is a caveat on a figure that
 * IS printed, the second is the absence of any figure.
 */
export type ForwardDemandAvailability =
  /** Held at a grain that describes the property's own area. */
  | { kind: 'projected'; grain: ProjectionGrain }
  /** Held, and about a region the property sits in rather than the area. */
  | { kind: 'coarser_than_area'; grain: ProjectionGrain }
  /** The publisher projects, and not for an area this size. */
  | { kind: 'grain_not_published'; finest: ProjectionGrain | null }
  /** The register exists and this deployment has never loaded it. */
  | { kind: 'not_loaded' }
  /** The retrieval failed. Ours, or theirs — never the area's. */
  | { kind: 'unavailable'; reason: string };

/**
 * Resolve the availability from what was actually read.
 *
 * `grain` null means nothing was held. The split between the two "held"
 * readings is `describesTheArea`, which is
 * `MARKET_FIGURES_IN_THE_REPORT.md`'s benchmark rule applied to a forecast.
 */
export function assessForwardDemand(args: {
  grainHeld: ProjectionGrain | null;
  finestPublished: ProjectionGrain | null;
  loaded: boolean;
  failure?: string | null;
}): ForwardDemandAvailability {
  if (args.failure) return { kind: 'unavailable', reason: args.failure };
  if (!args.loaded) return { kind: 'not_loaded' };
  if (args.grainHeld === null) return { kind: 'grain_not_published', finest: args.finestPublished };
  return describesTheArea(args.grainHeld)
    ? { kind: 'projected', grain: args.grainHeld }
    : { kind: 'coarser_than_area', grain: args.grainHeld };
}

/**
 * The sentence a report carries about forward demand.
 *
 * One implementation, so the section, the coverage list and the register's own
 * reading cannot state different things — `riskRegisterInstruction()`'s lesson
 * (three verbatim copies of one declaration, already diverged by four
 * paragraphs) paid in advance.
 *
 * Every branch is a statement about the RETRIEVAL or about a publisher. None
 * is a statement about whether the area will grow, which is §9's rule: an
 * absence may not be rated, and a presence may not be rated either — this
 * module prints no level and no direction.
 */
export function forwardDemandCoverageNote(
  availability: ForwardDemandAvailability,
  state: string | null,
): string {
  const key = (state ?? '').trim().toUpperCase();
  const pub = FORWARD_DEMAND_PUBLISHERS[key];
  /*
   * The jurisdiction's own route, stated on every branch that has one. A
   * reader who cannot get the figure from this report is entitled to know
   * where it is, which is the half `programmeCoverageNote` exists for.
   */
  const route = pub
    ? ` Forward projections for this jurisdiction are published by ${pub.publisher} as `
      + `${pub.product}, which this report does not read; they can be read at ${pub.url}.`
    : ' No forward projection publisher is named for this jurisdiction in this report, '
      + 'which is a limit of this report rather than a finding about the area.';

  switch (availability.kind) {
    case 'projected':
      return `A population projection is held for this area at ${PROJECTION_GRAIN_LABEL[availability.grain]}. `
        + A_PROJECTION_IS_NOT_A_MEASUREMENT;
    case 'coarser_than_area':
      return `The population projection held here describes ${PROJECTION_GRAIN_LABEL[availability.grain]}, `
        + `which is a region this property sits in rather than its own area, so it is drawn apart from `
        + `figures about the property. ${A_PROJECTION_IS_NOT_A_MEASUREMENT}${route}`;
    case 'grain_not_published':
      return 'No population projection is held for an area of this size. '
        + (availability.finest
          ? `The finest geography the national projection publishes is `
            + `${PROJECTION_GRAIN_LABEL[availability.finest]}.`
          : 'The national projection publishes no geography this report reads.')
        + route;
    case 'not_loaded':
      return 'No population projection has been loaded by this deployment, so this report '
        + 'states no projected figure for this area. That is a statement about this '
        + 'deployment rather than about the area.'
        + route;
    case 'unavailable':
      return 'The population projection could not be read for this report, so no projected '
        + 'figure appears above. That is a statement about the retrieval rather than about '
        + 'the area.'
        + route;
  }
}

/**
 * The only state that may select a forward-demand publisher.
 *
 * `crimePostcodeAuthority`'s rule applied to a jurisdiction: only a RESOLVED
 * geography may select evidence, and where nothing is trusted the reading is
 * withheld rather than risked.
 *
 * It matters here because the generator's own `state` variable is
 * `detectedState || 'NSW'` — it DEFAULTS to New South Wales — so reading it
 * would name the NSW publisher on every property whose state was never
 * resolved. That is a false statement about the jurisdiction, made silently,
 * on exactly the properties whose evidence is thinnest.
 *
 * Named here rather than written at each call site because there are two, and
 * two copies of one rule is how the two come to disagree.
 */
export function trustedStateForForwardDemand(
  geography: { state?: unknown } | null | undefined,
  abbreviate: (v: string | null) => string | null,
): string | null {
  const raw = geography?.state;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  return abbreviate(raw.trim());
}
