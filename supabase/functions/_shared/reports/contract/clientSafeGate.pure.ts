/**
 * RF-7.2B — the Client-Safe Data Gate.
 *
 * One place that answers: **may this fact reach a client?**
 *
 * RF-7.2A classified 84 material facts and found 13 that are not client safe —
 * demographics generated under an ABS Census label, a hardcoded RBA cash rate,
 * and the Location trio the scoring programme already disowned. Those findings
 * were a document. This is the same findings as a function, placed where a fact
 * must pass through it:
 *
 * ```
 * AUTHORITATIVE SOURCE → NORMALISATION → REPORT FACT CONTRACT
 *   → CLIENT-SAFE DATA GATE            ← here
 *   → presentation / narrative / template / viewer / PDF
 * ```
 *
 * ## The six classes, and what each permits
 *
 * | class | verdict | rule |
 * | --- | --- | --- |
 * | `authoritative` | allow | observed, owned, trusted |
 * | `derived` | allow **with its basis** | a ratio with no basis is a different number |
 * | `contextual` | allow **with grain + period** | a postcode median is not a suburb median |
 * | `not_client_safe` | **block** | the label does not describe the value |
 * | `unavailable` | unavailable | no evidence held |
 * | `future_source` | unavailable | planned, not held |
 *
 * ## Three rules this file exists to enforce
 *
 * **A classification is never silently promoted.** `contextual` does not become
 * `authoritative` because the metadata happens to be missing — it becomes
 * `unavailable`, which is a refusal rather than a downgrade. The only way to
 * change a class is to edit `FACT_SAFETY` and say why.
 *
 * **Blocking is by SOURCE as well as by field.** A demographic fact is not
 * unsafe because of its name; it is unsafe because of where the value came
 * from. `abs_census_poa` is trusted and a generator labelled "ABS Census 2021
 * estimates" is not, and both arrive as `population`. So the gate reads the
 * provenance, not the key.
 *
 * **Absence has two kinds.** An optional field that is absent should vanish;
 * a material one must be explained. Collapsing them is how a report becomes
 * either a catalogue of "Not available" rows or a document that quietly omits
 * the thing a reader most needed to know.
 *
 * ## Purity
 *
 * Deterministic, side-effect free, no database, no network, no clock, no LLM.
 * It receives facts and returns a verdict.
 *
 * Nothing in production consumes this yet beyond the forward-safe projection it
 * was written for; historical reports are untouched and are never re-gated.
 */

export const CLIENT_SAFE_GATE_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export type SafetyClass =
  | 'authoritative'
  | 'derived'
  | 'contextual'
  | 'not_client_safe'
  | 'unavailable'
  | 'future_source';

export type GateVerdict =
  | 'allow'
  | 'allow_with_basis'
  | 'allow_with_context'
  | 'block'
  | 'unavailable';

/** The grain a statistic is actually measured at. Never inferred. */
export type GeographyGrain =
  | 'property' | 'suburb' | 'postcode' | 'sa1' | 'sa2' | 'sa3' | 'sa4'
  | 'lga' | 'state' | 'national' | 'other';

/**
 * What a grain is called in front of a client.
 *
 * `postcode` is deliberately not "suburb": a postcode routinely spans several
 * suburbs of very different character, and RF-7.2A §5 records that presenting
 * one as the other is the single most common grain mismatch in this report.
 */
export const GRAIN_LABEL: Readonly<Record<GeographyGrain, string>> = {
  property: 'this property',
  suburb: 'suburb',
  postcode: 'postcode area',
  sa1: 'ABS SA1 area',
  sa2: 'ABS SA2 area',
  sa3: 'ABS SA3 region',
  sa4: 'ABS SA4 region',
  lga: 'local government area',
  state: 'state',
  national: 'Australia',
  other: 'the surrounding area',
};

// ---------------------------------------------------------------------------
// The register, in code
// ---------------------------------------------------------------------------

/**
 * Facts that may never reach a client, and the measurement that says so.
 *
 * Keyed by the contract's own leaf name where one exists, and by the stored
 * path otherwise. Every entry carries its evidence so a future reader can see
 * what would have to change for the entry to be removed.
 */
export const BLOCKED_FACTS: Readonly<Record<string, string>> = {
  'market.walkScore':
    'Reproduces a per-state constant on 1,109 of 1,114 stored reports, so it '
    + 'describes the state rather than the address.',
  'market.commuteDurationMinutes':
    'Fabricated: a mean of 10,125 minutes, with 494 non-NSW reports routed to '
    + 'Sydney.',
  'market.schoolsWithin3km':
    'Sits at its ceiling on 851 of 1,114 stored reports, so it distinguishes '
    + 'nothing.',
  'market.transportQualityScore':
    'An invented score. The current transport service deliberately returns no '
    + 'score and no mode, because this figure is what corrupted the walk score.',
  'market.generatedDemographics':
    'Labelled "ABS Census 2021" and generated: 0 exact matches against the real '
    + 'ABS table on 616 comparable reports, correlation r = 0.04, and 87 of 206 '
    + 'postcodes carry more than one value.',
  'market.hardcodedCashRate':
    'A hardcoded 4.35 labelled "RBA Official Cash Rate". It overstated the '
    + 'target by 75 basis points on 1,035 reports and is only accidentally '
    + 'correct today.',
  'market.llmSourcedCashRate':
    'Sourced from an LLM web search and labelled as RBA authority. A model is '
    + 'not a statistical agency.',
};

/**
 * Source strings that mark a value as generated rather than retrieved.
 *
 * Matched case-insensitively as substrings, because the corpus carries several
 * spellings of each ("ABS Census Estimates", "ABS Census 2021 estimates",
 * "ABS Census 2021 (estimated)").
 */
export const UNTRUSTED_SOURCE_MARKERS: readonly string[] = [
  'estimates',
  'estimated',
  'perplexity',
  'real-time search',
  'approximation',
  'synthesised',
  'synthesized',
];

/** Sources that ARE the authority, named rather than inferred. */
export const TRUSTED_SOURCE_TABLES: readonly string[] = [
  'abs_census_poa',
  'abs_seifa_poa',
  'rba_observations',
  'report_geography',
  'transport_stops',
  'crime_reference',
];

/**
 * Is this provenance string a retrieval from a named authority?
 *
 * The test is deliberately asymmetric. A source must be RECOGNISED to pass;
 * an unrecognised one fails. "Not on the block-list" is not the same as
 * "trusted", and treating it that way is how a new generator would be admitted
 * by default.
 */
export function isTrustedSource(source: unknown): boolean {
  if (typeof source !== 'string') return false;
  const s = source.trim().toLowerCase();
  if (s.length === 0) return false;
  if (UNTRUSTED_SOURCE_MARKERS.some((m) => s.includes(m))) return false;
  return TRUSTED_SOURCE_TABLES.some((t) => s.includes(t));
}

/** Does this provenance string mark the value as generated? */
export function isGeneratedSource(source: unknown): boolean {
  if (typeof source !== 'string') return false;
  const s = source.trim().toLowerCase();
  return UNTRUSTED_SOURCE_MARKERS.some((m) => s.includes(m));
}

// ---------------------------------------------------------------------------
// The gated fact
// ---------------------------------------------------------------------------

/** Why a fact is absent, and whether a reader needs to be told. */
export interface SafeAbsence {
  readonly reason: string;
  /**
   * `optional` — suppress the field, the label and the row entirely.
   * `material` — absence changes the reader's understanding; say so deliberately.
   */
  readonly kind: 'optional' | 'material';
}

export interface FactContext {
  readonly grain: GeographyGrain;
  /** What the source itself calls the period, e.g. "2021 Census", "August 2026". */
  readonly referencePeriod: string | null;
  /** The dataset and version, where the source publishes one. */
  readonly dataset: string | null;
  /** When the value was observed or published. */
  readonly asOf: string | null;
}

export interface SafeFact<T> {
  readonly name: string;
  readonly status: 'present' | 'absent';
  readonly value: T | null;
  readonly safety: SafetyClass;
  readonly verdict: GateVerdict;
  readonly source: string | null;
  /** Required and non-null when `verdict` is `allow_with_basis`. */
  readonly basis: string | null;
  /** Required and non-null when `verdict` is `allow_with_context`. */
  readonly context: FactContext | null;
  readonly absence: SafeAbsence | null;
  /** One sentence naming why the gate ruled as it did. */
  readonly ruling: string;
}

export interface GateInput<T> {
  readonly name: string;
  readonly value: T | null;
  readonly safety: SafetyClass;
  readonly source?: string | null;
  readonly basis?: string | null;
  readonly context?: FactContext | null;
  /** Absence of a material fact is explained rather than suppressed. */
  readonly material?: boolean;
  /** Why it is absent, when the caller knows. */
  readonly absenceReason?: string;
}

const blocked = <T>(input: GateInput<T>, ruling: string): SafeFact<T> => ({
  name: input.name,
  status: 'absent',
  value: null,
  safety: 'not_client_safe',
  verdict: 'block',
  source: input.source ?? null,
  basis: null,
  context: null,
  absence: {
    reason: ruling,
    kind: input.material === true ? 'material' : 'optional',
  },
  ruling,
});

const unavailable = <T>(input: GateInput<T>, ruling: string): SafeFact<T> => ({
  name: input.name,
  status: 'absent',
  value: null,
  safety: input.safety === 'future_source' ? 'future_source' : 'unavailable',
  verdict: 'unavailable',
  source: input.source ?? null,
  basis: null,
  context: null,
  absence: {
    reason: input.absenceReason ?? ruling,
    kind: input.material === true ? 'material' : 'optional',
  },
  ruling,
});

/**
 * Rule on one fact.
 *
 * The order matters and is the whole design: **class first, then evidence**.
 * A fact the register calls unsafe is blocked however good its value looks, and
 * a fact whose required metadata is missing becomes unavailable rather than
 * being admitted without it.
 */
export function gateFact<T>(input: GateInput<T>): SafeFact<T> {
  // 1. The register's own refusals, before anything is inspected.
  if (input.safety === 'not_client_safe') {
    return blocked(input, BLOCKED_FACTS[input.name]
      ?? 'This value is not client safe: its label does not describe what it measures.');
  }
  if (input.safety === 'future_source') {
    return unavailable(input,
      'No source for this is held yet. It is a planned integration, not an omission.');
  }
  if (input.safety === 'unavailable') {
    return unavailable(input, input.absenceReason ?? 'No evidence is held for this.');
  }

  // 2. A generated value is refused whatever class it was declared under.
  //    This is the trapdoor RF-7.2A found: the demographics were declared as
  //    ordinary market facts and were generated.
  if (isGeneratedSource(input.source)) {
    return blocked({ ...input, safety: 'not_client_safe' },
      `The source "${String(input.source)}" marks this value as generated rather than `
      + 'retrieved, so it cannot be presented as evidence.');
  }

  // 3. Absent is absent — and never promoted to a value by the gate.
  if (input.value === null || input.value === undefined) {
    return unavailable(input, input.absenceReason ?? 'No value is recorded.');
  }

  // 4. The class's own requirement.
  if (input.safety === 'derived') {
    if (!input.basis) {
      return unavailable(input,
        'A derived figure may not be published without the basis it was measured on, '
        + 'because the same number on a different basis is a different fact.');
    }
    return {
      name: input.name, status: 'present', value: input.value, safety: 'derived',
      verdict: 'allow_with_basis', source: input.source ?? null, basis: input.basis,
      context: input.context ?? null, absence: null,
      ruling: 'Derived by a canonical owner and published with its basis.',
    };
  }

  if (input.safety === 'contextual') {
    const c = input.context;
    if (!c || !c.referencePeriod) {
      return unavailable(input,
        'Contextual evidence may not be published without the geography grain and '
        + 'reference period it was measured at — without them it reads as a fact '
        + 'about this property.');
    }
    return {
      name: input.name, status: 'present', value: input.value, safety: 'contextual',
      verdict: 'allow_with_context', source: input.source ?? null,
      basis: input.basis ?? null, context: c, absence: null,
      ruling: `Published as ${GRAIN_LABEL[c.grain]} evidence for ${c.referencePeriod}.`,
    };
  }

  // 5. Authoritative — and it must still name a source it came from.
  return {
    name: input.name, status: 'present', value: input.value, safety: 'authoritative',
    verdict: 'allow', source: input.source ?? null, basis: input.basis ?? null,
    context: input.context ?? null, absence: null,
    ruling: 'Observed and owned; published as stated.',
  };
}

/** Rule on many, keeping the caller's order. */
export function gateFacts(inputs: readonly GateInput<unknown>[]): SafeFact<unknown>[] {
  return inputs.map((i) => gateFact(i));
}

/** Everything a client may see. */
export function allowed(facts: readonly SafeFact<unknown>[]): SafeFact<unknown>[] {
  return facts.filter((f) => f.status === 'present');
}

/** Everything the gate refused, for the operator's diagnostics — never a client's page. */
export function refused(facts: readonly SafeFact<unknown>[]): SafeFact<unknown>[] {
  return facts.filter((f) => f.verdict === 'block');
}

/**
 * The bundle a narrative may be written from.
 *
 * Deliberately values-and-labels only: no provenance strings, no ruling
 * sentences, no blocked entries, nothing a model could quote as though it were
 * a finding. A model that cannot see a refused fact cannot describe one.
 */
export function narrativeBundle(
  facts: readonly SafeFact<unknown>[],
): Record<string, { value: unknown; label: string }> {
  const out: Record<string, { value: unknown; label: string }> = {};
  for (const f of facts) {
    if (f.status !== 'present' || f.value === null) continue;
    const label = f.verdict === 'allow_with_basis' && f.basis
      ? f.basis
      : f.verdict === 'allow_with_context' && f.context
        ? `${f.name} (${GRAIN_LABEL[f.context.grain]}, ${f.context.referencePeriod})`
        : f.name;
    out[f.name] = { value: f.value, label };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Market-claim reconciliation — meaning as well as number
// ---------------------------------------------------------------------------

/**
 * A claim a narrative makes about a market fact.
 *
 * Reconciling only the NUMBER is what let RF-7.2A's defects through: the prose
 * agreed perfectly with the injected value because both were wrong in the same
 * way. So this checks the value, the source it is attributed to, the geography
 * grain it is described at, and the period it is placed in — because a model
 * that turns "POA 3024 population, 2021 Census" into "the suburb's current
 * population" has changed every one of those except the number.
 */
export interface MarketClaim {
  readonly fact: string;
  readonly value: unknown;
  /** The grain the prose describes the figure at. */
  readonly claimedGrain: GeographyGrain;
  /** The period the prose places it in. */
  readonly claimedPeriod: string | null;
  /** The authority the prose attributes it to. */
  readonly claimedSource: string | null;
}

export type ClaimFaultKind =
  | 'value_mismatch' | 'grain_overstated' | 'period_mismatch'
  | 'source_misattributed' | 'not_client_safe';

export interface ClaimFault {
  readonly fact: string;
  readonly kind: ClaimFaultKind;
  readonly detail: string;
}

/**
 * Grains ordered from most specific to least.
 *
 * Claiming a FINER grain than the evidence has is the fault — a postcode
 * statistic described as this property's, or as the suburb's. Claiming a
 * coarser one is imprecise but not false, so it is not reported.
 */
const GRAIN_SPECIFICITY: readonly GeographyGrain[] = [
  'property', 'suburb', 'sa1', 'postcode', 'sa2', 'sa3', 'lga', 'sa4', 'state', 'national', 'other',
];

const finer = (a: GeographyGrain, b: GeographyGrain): boolean =>
  GRAIN_SPECIFICITY.indexOf(a) < GRAIN_SPECIFICITY.indexOf(b);

/** Check one claim against the gated fact it purports to describe. */
export function reconcileMarketClaim(
  claim: MarketClaim,
  fact: SafeFact<unknown> | undefined,
): ClaimFault[] {
  const faults: ClaimFault[] = [];

  if (fact === undefined || fact.status !== 'present') {
    faults.push({
      fact: claim.fact,
      kind: 'not_client_safe',
      detail: 'The narrative states a figure for which no client-safe fact was supplied.',
    });
    return faults;
  }

  if (claim.value !== fact.value) {
    faults.push({
      fact: claim.fact,
      kind: 'value_mismatch',
      detail: `The narrative says ${String(claim.value)}; the fact is ${String(fact.value)}.`,
    });
  }

  const ctx = fact.context;
  if (ctx) {
    if (finer(claim.claimedGrain, ctx.grain)) {
      faults.push({
        fact: claim.fact,
        kind: 'grain_overstated',
        detail: `Described as ${GRAIN_LABEL[claim.claimedGrain]} evidence, but it is `
          + `${GRAIN_LABEL[ctx.grain]} evidence.`,
      });
    }
    if (claim.claimedPeriod !== null && ctx.referencePeriod !== null
        && !ctx.referencePeriod.toLowerCase().includes(claim.claimedPeriod.toLowerCase())) {
      faults.push({
        fact: claim.fact,
        kind: 'period_mismatch',
        detail: `Placed in "${claim.claimedPeriod}"; the fact is for `
          + `"${ctx.referencePeriod}".`,
      });
    }
  }

  if (claim.claimedSource !== null && fact.source !== null
      && !claim.claimedSource.toLowerCase().includes(fact.source.toLowerCase())
      && !(ctx?.dataset ?? '').toLowerCase().includes(claim.claimedSource.toLowerCase())) {
    faults.push({
      fact: claim.fact,
      kind: 'source_misattributed',
      detail: `Attributed to "${claim.claimedSource}"; the fact came from "${fact.source}".`,
    });
  }

  return faults;
}
