/**
 * What a Property Comparison Analysis says, as a shape.
 *
 * ## Where the trust boundary is, and why it is further out than the other three
 *
 * Cash Flow does not trust the browser because the browser owns the arithmetic.
 * Borrowing Capacity does not let the browser decide the contents at all. The
 * Portfolio Review trusts its figures and distrusts its prose. Here **there are
 * no deterministic figures at all** — every field this document prints was
 * written by a model in one response and stored, so the whole payload is
 * optional structure.
 *
 * That has one consequence worth stating up front: this contract has almost no
 * `Measure`s. A comparison does not carry money or yields; it carries a ranking,
 * ten superlatives naming a winner apiece, and prose. The one number it does
 * carry — `finalScore` — arrives on **two different scales**, which is why it is
 * modelled as a value *and* its denominator rather than as a bare figure.
 *
 * ## Two storage shapes, one payload
 *
 * `property_comparisons` holds the same document in two states, both stamped
 * `structure_version = 1`:
 *
 *  - **`columns`** — the seven jsonb columns are populated. 23 of 50 rows.
 *  - **`salvaged`** — every jsonb column is NULL and the model's raw, *truncated*
 *    response sits in `executive_summary`. 27 of 50 rows.
 *
 * A salvaged row is not a degraded row. Six of its ten sections are recorded in
 * full; they are simply followed by a cut. `salvage.pure.ts` reads them back, and
 * this contract carries `provenance` so the document can say what happened —
 * because on a salvaged record `recommendations` is absent **every time**, and a
 * ranked comparison that silently omits "which should I buy" reads as a finished
 * document that forgot to answer its own question.
 *
 * ## `propertyNumber` is a pointer, and it is often null
 *
 * The superlatives do not embed a property; they name one by 1-based index into
 * `properties`. Of 92 winner pointers in the record, 74 name a property, 6 are
 * `0` and 12 are `null` — both meaning *nobody wins this axis*. So every pointer
 * is modelled as `PropertyRef | null` and resolved once, in the normaliser, so no
 * renderer ever computes `properties[n - 1]` and reads index `-1`.
 */
import type { Measure } from '../../reportDesign/measure.pure.ts';

// ── Provenance ──────────────────────────────────────────────────────────────

/** Where this payload's content came from. */
export type SourceShape =
  /** The seven jsonb columns were populated and were read directly. */
  | 'columns'
  /** The columns were empty; content was read back out of a truncated blob. */
  | 'salvaged';

/**
 * What the record held, and what it did not.
 *
 * Carried on the payload rather than left to the route because the *document*
 * has to say it. `missing` drives the placeholder sections, and the difference
 * between "not found" and "never written" is the whole message.
 */
export interface Provenance {
  shape: SourceShape;
  /** Section keys read back whole. Empty on the `columns` path. */
  recovered: readonly string[];
  /** Section keys the record does not hold. Drives the placeholder sections. */
  missing: readonly string[];
  /** True when the stored text was cut off mid-token. */
  truncated: boolean;
}

// ── The properties being compared ───────────────────────────────────────────

/**
 * One property in the comparison.
 *
 * `number` is the 1-based index the analysis uses to refer to it everywhere
 * else. The address is the analysis's own; `property_addresses[number - 1]`
 * agrees with it on every row checked, and the ranking's copy wins when they
 * differ, because that is the one the prose was written against.
 */
export interface PropertyRef {
  /** 1-based. The index every `propertyNumber` in the record points at. */
  number: number;
  address: string;
  /** Just the street line, for a chart label or a narrow column. */
  shortAddress: string;
  /** From `property_states[]`, when the record aligns one. */
  state: string;
}

// ── The ranking ─────────────────────────────────────────────────────────────

/**
 * A score together with the denominator it was recorded against.
 *
 * Not a bare `Measure`, and not normalised to a common scale. The record holds
 * `finalScore` on 0–100 in 17 comparisons and on 0–10 in six — including the most
 * recent comparison in the table — so a bare "8.5" beside a bare "88.5" in two of
 * a client's own reports is not comparable. Rescaling one into the other would
 * assert a number the model never wrote. So the denominator travels with the
 * value and is always printed.
 */
export interface ScaledScore {
  value: Measure;
  /** 10 or 100. Detected once per comparison from the maximum of the set. */
  outOf: number;
  /**
   * False when the set is too flat to tell the scales apart — every score at or
   * below 10 with almost no spread. The document asserts the scale in words when
   * this is false rather than leaning on the denominator alone.
   */
  confident: boolean;
}

/** One row of the ranking — the artefact every comparison has, in both shapes. */
export interface RankedProperty {
  property: PropertyRef;
  /**
   * As recorded. **Not unique** — a real row ranks two properties equal second —
   * so nothing may key off it.
   */
  rank: number | null;
  score: ScaledScore | null;
  strengths: readonly string[];
  concerns: readonly string[];
  /** The analysis's own words for who this property suits. */
  bestSuitedFor: string;
  /** From `riskComparison.riskLevels`, matched by property number. */
  risk: RiskVerdict | null;
}

// ── Risk ────────────────────────────────────────────────────────────────────

/**
 * Four bands, for colour and grouping only.
 *
 * The stored `riskLevel` is free text with ten distinct values across the record
 * — `Low-Moderate`, `Moderate`, `Moderate-Low`, `Moderate-High`, `Moderate to
 * High`, `High`, `High (Undetermined)`, `Very High`, `Critical`, `Extreme` —
 * three of them spellings of one idea and one of them (`High (Undetermined)`)
 * meaning "unknown, assume the worst" rather than a level at all. The band drives
 * a tone; the *words* on the page are always the source's own.
 */
export type RiskBand = 'low' | 'moderate' | 'high' | 'severe' | 'unrated';

export interface RiskVerdict {
  property: PropertyRef;
  /** The source's own wording. Printed verbatim. */
  level: string;
  band: RiskBand;
  specificRisks: readonly string[];
}

/** A concern flagged against one property, with the source's own severity word. */
export interface RedFlag {
  property: PropertyRef | null;
  severity: string;
  band: RiskBand;
  concerns: readonly string[];
}

// ── The superlatives ────────────────────────────────────────────────────────

/**
 * One "who wins this axis" verdict.
 *
 * `property` is null when the record named nobody — `propertyNumber` of `0` or
 * `null`, which happens on 18 of 92 pointers. That is a real answer ("no clear
 * winner"), not an absence, and the document prints it as one.
 */
export interface AxisWinner {
  /** `bestYield`, `bestSchools` — the stored key, for grouping and testing. */
  key: string;
  /** How the document names this axis. */
  label: string;
  property: PropertyRef | null;
  /** Some axes record a figure as text — `"6.2%"`, `"Data unavailable"`. */
  value: string;
  /** Why, in the source's own words. */
  reason: string;
  /**
   * Whether being named on this axis is good.
   *
   * `highestRisk` names the property that came off **worst**, and it sits in the
   * same block as `lowestRisk`. In a scorecard where a tick means "won this
   * category", a tick against *highest risk* asserts the opposite of what it
   * means — so the scorecard prints only the positive axes, and the negative one
   * keeps its own row in the risk section where the word "highest" is right
   * there beside it.
   */
  polarity: 'positive' | 'negative';
}

/** A named group of axes — the money ones, the location ones, the risk ones. */
export interface AxisGroup {
  id: string;
  title: string;
  winners: readonly AxisWinner[];
}

// ── Who each property suits ─────────────────────────────────────────────────

/** Never rendered by the legacy generator, which omits the field entirely. */
export interface InvestorMatch {
  property: PropertyRef | null;
  investorTypes: readonly string[];
  reasoning: string;
}

// ── What to do ──────────────────────────────────────────────────────────────

/** A property named with a reason — `bestOverall`, a runner-up, one to avoid. */
export interface NamedProperty {
  property: PropertyRef | null;
  reason: string;
}

/**
 * A what-if the analysis offered.
 *
 * Note the pointer here is stored under `recommendation`, not `propertyNumber` —
 * the one place in the record that names the field differently.
 */
export interface AlternativeScenario {
  scenario: string;
  reason: string;
  property: PropertyRef | null;
}

export interface Recommendations {
  bestOverall: NamedProperty | null;
  runners: readonly NamedProperty[];
  avoid: readonly NamedProperty[];
  alternativeScenarios: readonly AlternativeScenario[];
}

// ── Two sections only a salvaged record can carry ───────────────────────────

/**
 * `marketTiming` and `competitiveAdvantages` are written by the producer and
 * have **no column to live in**. On the 23 rows whose response parsed, the writer
 * destructured what it recognised into seven columns and dropped these two on the
 * floor. On the 27 rows whose response did not parse, the raw text was kept — so
 * the damaged rows carry more of the analysis than the intact ones do.
 *
 * Recovered on 23 and 10 of the 27 respectively. Rendered when present, absent
 * otherwise, and the contract document explains the inversion so nobody reads a
 * richer salvaged document as a mistake.
 */
export interface HoldingPeriod {
  property: PropertyRef | null;
  period: string;
  reason: string;
}

export interface MarketTiming {
  buyFirst: NamedProperty | null;
  holdingPeriods: readonly HoldingPeriod[];
}

export interface CompetitiveAdvantage {
  property: PropertyRef | null;
  advantages: readonly string[];
}

// ── The basis it was run on ─────────────────────────────────────────────────

/**
 * The settings the comparison was produced under.
 *
 * Read out of `analysis_summary`, which despite its name holds a settings blob —
 * `{"timeHorizon":"5-7 years","riskTolerance":"moderate","customWeights":null}` —
 * on 44 of the rows that have it. Nothing has ever rendered it, so no comparison
 * document has ever stated the assumptions behind its own ranking.
 */
export interface ComparisonBasis {
  timeHorizon: string;
  riskTolerance: string;
  /** `{growth: 30, location: 25, …}`. Null on all but one row. */
  weights: readonly LabelledWeight[];
  /** `comprehensive`, `deep`. */
  depth: string;
  /** `general`, `growth`. */
  investorProfile: string;
  /** The model that wrote it, so a reader can date the analysis's judgement. */
  model: string;
}

export interface LabelledWeight {
  label: string;
  weight: Measure;
}

// ── The document ────────────────────────────────────────────────────────────

export interface ComparisonMeta {
  /** `COMPARISON ANALYSIS - 3 PROPERTIES, QLD`, or one built from the count. */
  title: string;
  /** Read from `clients`, and only when exactly one client resolves. */
  clientName: string;
  /** ISO-8601. When the comparison was run. */
  analysedOn: string;
  /** ISO-8601. When this document was typeset. Supplied by the edge. */
  preparedOn: string;
  /** First eight characters of the row id, uppercased. On the cover and the file. */
  reference: string;
  /** `['QLD', 'VIC']`, as recorded. */
  states: readonly string[];
  /** True when the row is archived. Rendered anyway, and said out loud. */
  archived: boolean;
}

export interface PropertyComparison {
  meta: ComparisonMeta;
  provenance: Provenance;

  /** Every property, in `propertyNumber` order. Always at least two. */
  properties: readonly PropertyRef[];
  /** The ranking, best first. The one section every row has, in both shapes. */
  ranked: readonly RankedProperty[];
  /** The detected scale, or null when nothing was scored. */
  scale: ScaledScore | null;

  /** A built sentence, never the model's — see `describeComparison`. */
  narrative: string;
  /** The analysis's own executive summary. */
  summary: string;

  /** Money, location and risk superlatives, grouped. Empty groups dropped. */
  axes: readonly AxisGroup[];
  risks: readonly RiskVerdict[];
  redFlags: readonly RedFlag[];
  matches: readonly InvestorMatch[];
  recommendations: Recommendations | null;
  /** Salvaged records only — see `MarketTiming`. */
  timing: MarketTiming | null;
  /** Salvaged records only — see `CompetitiveAdvantage`. */
  advantages: readonly CompetitiveAdvantage[];
  basis: ComparisonBasis;

  /** Things worth saying out loud — a dangling report, an archived row. */
  notes: readonly string[];
}
