/**
 * "Evidence Behind the Score" — what a document shows a reader about what the
 * grade rests on.
 *
 * ## Why a grade needs one
 *
 * A property grade is a claim Aurixa has to be able to defend to the client it
 * was given to, and to whoever they show it to. Today it cannot be: the number
 * arrives with a one-line `details` string, and on the corpus that string
 * contradicts the score it sits beside (§53.5) or is empty entirely (§53.1).
 * A reader who disagrees with a B+ has nothing to disagree *with*.
 *
 * This is the answer to that: per dimension, what was measured, where it came
 * from, how far it can be relied on, and — the part that is usually missing —
 * **what could not be measured and what that cost**.
 *
 * ## Four rules
 *
 * **It states; it never derives.** Every number here comes from a result object
 * computed elsewhere. Nothing in this module divides, weights or bands
 * anything, because a disclosure that recomputes its own subject can disagree
 * with it — and the disagreement would appear in the one place a reader is
 * being invited to check the working.
 *
 * **Absence is content, not omission.** A dimension that could not be measured
 * gets a row saying so, in the same shape as one that could. Silence about a
 * missing five-year series reads as "there was nothing to say", which is the
 * opposite of true.
 *
 * **Licensing decides what may be shown, per measure.** A figure whose
 * redistribution rights nobody has confirmed may inform a score and must not be
 * printed to a client (`mayReachClientReport`). So the statement takes an
 * AUDIENCE — the same shape `buildCasePassportView` uses — and a withheld
 * measure is named as withheld rather than dropped, because a source list with
 * a silent hole is a worse disclosure than one that says a source is not
 * quotable.
 *
 * **The cap is explained where the grade is stated.** If the evidence held the
 * grade below what the score would allow, that belongs in the headline, not in
 * a footnote — it is the single most likely thing a reader will ask about.
 */

import {
  type EvidencePoint,
  type MarketEvidence,
  describePoint,
  licensingOf,
  mayReachClientReport,
} from './marketEvidence.pure.ts';
import type { GrowthResult } from './growthScoring.pure.ts';
import type { DemandResult } from './demandScoring.pure.ts';
import type { YieldResult } from './yieldScoring.pure.ts';
import type { EligibilityResult } from './gradeEligibility.pure.ts';

/** Who is reading. A client sees only what may be redistributed to them. */
export type StatementAudience = 'client' | 'internal';

export interface StatementMeasure {
  /** The sentence the component produced. Printed verbatim. */
  detail: string;
  /** Nominal weight of this component within its dimension. */
  weight: number;
  /** 0-100 for this component alone. */
  score: number;
  /** Where it came from, or null when the audience may not be told. */
  provenance: ReadonlyArray<string>;
  /** True when a source exists but may not be quoted to this audience. */
  provenanceWithheld: boolean;
}

export interface StatementDimension {
  key: 'growth' | 'demand' | 'yield';
  label: string;
  /** 0-100, or null when the dimension could not be measured at all. */
  score: number | null;
  /** The one sentence to print when `score` is null. */
  absenceReason: string | null;
  /** Confidence in the measures behind the score, where the dimension has one. */
  confidence: { score: number; band: string } | null;
  /** Share of the dimension's methodology that ran, 0-1. */
  coverage: number;
  measures: ReadonlyArray<StatementMeasure>;
  /** Components with no evidence, in the reader's words. */
  notMeasured: ReadonlyArray<string>;
}

export interface EvidenceStatement {
  audience: StatementAudience;
  /** The grade actually awarded. */
  grade: string;
  /** The grade the composite score alone would have given. */
  scoreGrade: string;
  /** Present only when the evidence held the grade down. */
  capExplanation: ReadonlyArray<string>;
  dimensions: ReadonlyArray<StatementDimension>;
  /** Every source quoted, de-duplicated, in the order first used. */
  sources: ReadonlyArray<string>;
  /** Sources consulted that could not answer, and why. */
  unavailable: ReadonlyArray<string>;
  /** Plain statements a reader needs so as not to over-read the grade. */
  limitations: ReadonlyArray<string>;
}

/** How a component key reads to somebody who is not an engineer. */
const COMPONENT_LABELS: Readonly<Record<string, string>> = {
  longTerm: 'Five-year capital growth',
  mediumTerm: 'Three-year capital growth',
  momentum: 'Twelve-month movement',
  consistency: 'Consistency of growth',
  relative: 'Performance against the wider market',
  rentalTightness: 'Rental vacancy',
  saleUrgency: 'Competition for stock',
  absorption: 'Sales against stock advertised',
  populationDriver: 'Population growth',
};

const labelOf = (key: string): string => COMPONENT_LABELS[key] ?? key;

/**
 * Render one component's provenance, subject to the audience.
 *
 * A measure with no quotable source still produces a row — the measurement
 * stands, and the reader is told the source cannot be named to them rather
 * than left to infer there was none.
 */
function provenanceFor(
  points: ReadonlyArray<EvidencePoint<unknown>>,
  audience: StatementAudience,
): { provenance: string[]; withheld: boolean } {
  const provenance: string[] = [];
  let withheld = false;
  for (const p of points) {
    if (audience === 'client' && !mayReachClientReport(p)) { withheld = true; continue; }
    provenance.push(describePoint(p));
  }
  return { provenance, withheld };
}

function growthDimension(g: GrowthResult, audience: StatementAudience): StatementDimension {
  const measures: StatementMeasure[] = g.components.map((c) => {
    const { provenance, withheld } = provenanceFor(c.evidence ? [c.evidence] : [], audience);
    return {
      detail: `${labelOf(c.key)}: ${c.detail}`,
      weight: c.weight,
      score: Math.round(c.score),
      provenance,
      provenanceWithheld: withheld,
    };
  });
  return {
    key: 'growth',
    label: 'Capital growth',
    score: g.score,
    absenceReason: g.score === null
      ? 'No capital-growth evidence was available for this market, so no growth score is stated.'
      : null,
    confidence: { score: g.confidence.score, band: g.confidence.band },
    coverage: g.weightCovered,
    measures,
    notMeasured: g.missing.map(labelOf),
  };
}

function demandDimension(d: DemandResult, audience: StatementAudience): StatementDimension {
  const measures: StatementMeasure[] = d.components.map((c) => {
    const { provenance, withheld } = provenanceFor(c.evidence, audience);
    return {
      detail: `${labelOf(c.key)}: ${c.detail}`,
      weight: c.weight,
      score: Math.round(c.score),
      provenance,
      provenanceWithheld: withheld,
    };
  });
  return {
    key: 'demand',
    label: 'Market demand',
    score: d.score,
    absenceReason: d.score === null
      ? 'No demand evidence was available for this market, so no demand score is stated.'
      : null,
    confidence: { score: d.confidence.score, band: d.confidence.band },
    coverage: d.weightCovered,
    measures,
    notMeasured: d.missing.map(labelOf),
  };
}

/**
 * Yield's row.
 *
 * It has no confidence reading of its own, because it is not measured from
 * market evidence at all — it is computed from this property's own rent and
 * price. Reporting a fabricated confidence beside it to make the table
 * symmetrical would be inventing a number for the sake of a layout.
 */
function yieldDimension(y: YieldResult): StatementDimension {
  const measures: StatementMeasure[] = y.score === null ? [] : [{
    detail: `${y.label}: ${y.detail}`,
    weight: 1,
    score: y.score,
    provenance: ['This property’s own recorded rent and price'],
    provenanceWithheld: false,
  }];
  return {
    key: 'yield',
    label: 'Rental return',
    score: y.score,
    absenceReason: y.score === null ? y.detail : null,
    confidence: null,
    coverage: y.score === null ? 0 : 1,
    measures,
    notMeasured: [],
  };
}

export interface StatementInput {
  growth: GrowthResult;
  demand: DemandResult;
  yieldResult: YieldResult;
  eligibility: EligibilityResult;
  evidence: MarketEvidence;
  audience: StatementAudience;
}

/**
 * Compose the statement.
 *
 * Every field is read from an input. If this function ever needs to compute a
 * score, a weight or a percentage, something has been put in the wrong module.
 */
export function buildEvidenceStatement(input: StatementInput): EvidenceStatement {
  const { growth, demand, yieldResult, eligibility, evidence, audience } = input;

  const dimensions = [
    growthDimension(growth, audience),
    demandDimension(demand, audience),
    yieldDimension(yieldResult),
  ];

  const sources: string[] = [];
  for (const d of dimensions) {
    for (const m of d.measures) {
      for (const s of m.provenance) if (!sources.includes(s)) sources.push(s);
    }
  }

  const unavailable = evidence.providersUnavailable.map(
    (u) => `${u.provider}: ${u.reason}`,
  );

  const limitations: string[] = [];
  if (eligibility.capped) {
    limitations.push(
      `The evidence supports a grade of ${eligibility.ceiling} at most, so the grade shown is `
      + `${eligibility.grade} rather than the ${eligibility.scoreGrade} the score alone would give.`,
    );
  }
  for (const d of dimensions) {
    if (d.score === null && d.absenceReason) limitations.push(d.absenceReason);
    else if (d.coverage < 1 && d.notMeasured.length > 0) {
      limitations.push(
        `${d.label} was scored on ${Math.round(d.coverage * 100)}% of its methodology; `
        + `${d.notMeasured.join(', ').toLowerCase()} could not be measured.`,
      );
    }
  }
  if (dimensions.some((d) => d.measures.some((m) => m.provenanceWithheld))) {
    limitations.push(
      'One or more sources behind these figures cannot be named in this document '
      + 'under the terms they are licensed to us.',
    );
  }

  return {
    audience,
    grade: eligibility.grade,
    scoreGrade: eligibility.scoreGrade,
    capExplanation: eligibility.reasons,
    dimensions,
    sources,
    unavailable,
    limitations,
  };
}

/**
 * The measures a client may not be shown, for an internal reader.
 *
 * Answers "why is this document thinner than the one I am looking at?" without
 * anyone having to reason about licensing at the call site.
 */
export function withheldFromClient(ev: MarketEvidence): ReadonlyArray<string> {
  const out: string[] = [];
  for (const key of Object.keys(ev) as Array<keyof MarketEvidence>) {
    const point = ev[key] as unknown as EvidencePoint<unknown> | undefined;
    if (!point || typeof point !== 'object' || !('value' in point)) continue;
    if (!mayReachClientReport(point)) {
      out.push(`${String(key)} (${point.provider}, licensing: ${licensingOf(point)})`);
    }
  }
  return out;
}
