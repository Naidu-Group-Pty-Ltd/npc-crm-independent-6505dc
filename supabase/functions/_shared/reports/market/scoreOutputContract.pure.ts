/**
 * The canonical score output — one object every consumer reads, none recalculates.
 *
 * ## Why a contract and not "the result"
 *
 * `ShadowScoreResult` is the engine's own working record: every underlying
 * dimension result in full, for the harness and the audit trail. A renderer
 * handed that object has everything it needs to recompute the score — which is
 * exactly the invitation this module withdraws. History: V1's surfaces each
 * re-derived figures from raw blocks, and 21 stored reports contradicted
 * themselves because two readers disagreed (`DERIVED_FIGURES.md`). A score
 * must not repeat that: **the engine computes once, this contract carries the
 * result, and a consumer that wants a number reads a field.**
 *
 * ## Three rules
 *
 * **Contributions reconcile.** Each available dimension's `contributionPoints`
 * is its performance × its effective weight, and the sum reproduces the
 * composite within rounding — asserted by a spec, so the breakdown a client
 * sees is arithmetic, not illustration.
 *
 * **Finance Suitability rides beside the score, never in it.** The buyer's
 * position is on the object because every report needs it, and it is typed as
 * its own reading so no consumer can mistake a suitability band for a scoring
 * input.
 *
 * **`overallConfidence` is deliberately null until methodology lock.** The
 * per-dimension confidences exist (Growth, Demand); a single blended figure
 * does not, and inventing a blending formula here — before real-evidence
 * calibration — would be a methodology decision smuggled in as a field
 * default. The field carries where the definition will be made instead of a
 * number nobody has justified.
 */

import type { MarketEvidence } from './marketEvidence.pure.ts';
import { acquisitionOf, type EvidencePoint } from './marketEvidence.pure.ts';
import type { DimensionKey, ShadowScoreResult } from './shadowScorer.pure.ts';

/** Bumped whenever a field's meaning changes. Persisted with every stored score. */
export const SCORE_OUTPUT_CONTRACT_VERSION = '1.0.0';

export interface DimensionOutput {
  key: DimensionKey;
  /** False when the dimension could not be measured — absent, never zero. */
  available: boolean;
  /** 0-100, or null when unavailable. */
  performance: number | null;
  /** 0-100 where the dimension reports one (Growth, Demand); null elsewhere. */
  confidence: number | null;
  /** The weight it would carry if every dimension were measured. */
  nominalWeight: number;
  /** The weight it actually carried after renormalisation. 0 when unavailable. */
  effectiveWeight: number;
  /** performance × effectiveWeight — the points it put into the composite. */
  contributionPoints: number | null;
  /** Share of this dimension's own methodology that ran, 0-1. */
  coverage: number;
  /** What the reading rests on, or why there is none. Mechanical, not prose. */
  reason: string;
}

/** One evidence observation's origin, for the audit trail and the report. */
export interface EvidenceProvenanceRow {
  input: string;
  provider: string;
  level: string;
  areaName: string;
  asOf: string;
  method: string;
  sampleSize: number | null;
  periodsAvailable: number | null;
  dwellingTypeMatched: boolean;
  /** The acquisition footing — `licensing_unverified` when undeclared. */
  acquisition: string;
  /** The licensing status as declared; 'undeclared' when the point carries none. */
  licensing: string;
}

export interface ScoreOutput {
  contractVersion: string;
  methodologyVersion: string;
  componentVersions: Readonly<Record<string, string>>;

  /** The composite, 0-100, or null when too little was measured. */
  score: number | null;
  /** The grade the score alone gives. */
  scoreGrade: string | null;
  /** The grade after the evidence ceiling — what a report prints. */
  grade: string | null;
  gradeCapped: boolean;
  gradeCapReasons: ReadonlyArray<string>;
  /** True only when the evidence can carry the printed grade at A/A+ level. */
  gradeEligibility: { ceiling: string; version: string } | null;

  /** Share of the nominal composite weight actually measured, 0-1. */
  evidenceCoverage: number;
  /**
   * Deliberately null pre-lock: a blended overall confidence is a methodology
   * decision that belongs to calibration against real evidence, not a default.
   */
  overallConfidence: { value: null; definedAt: 'methodology lock, after real-evidence calibration' };

  dimensions: ReadonlyArray<DimensionOutput>;
  unavailable: ReadonlyArray<DimensionKey>;
  /** Set when no composite could be formed at all. */
  unavailableReason: string | null;

  /** The reader-facing account of what the grade rests on. */
  evidenceStatement: ShadowScoreResult['evidenceStatement'];
  /** Every market observation's origin. Empty when no evidence was supplied. */
  provenance: ReadonlyArray<EvidenceProvenanceRow>;

  /**
   * The buyer's stated position for THIS purchase scenario — beside the score,
   * structurally outside it.
   */
  financeSuitability: ShadowScoreResult['financeSuitability'];
  /** The holding-position signal, likewise disclosure-only. */
  holdingCashFlow: ShadowScoreResult['holdingCashFlow'];
}

const isPoint = (v: unknown): v is EvidencePoint<unknown> =>
  typeof v === 'object' && v !== null
  && 'provider' in v && 'asOf' in v && 'level' in v && 'value' in v;

function provenanceRows(evidence: MarketEvidence): EvidenceProvenanceRow[] {
  const rows: EvidenceProvenanceRow[] = [];
  for (const [input, v] of Object.entries(evidence)) {
    if (!isPoint(v)) continue;
    rows.push({
      input,
      provider: v.provider,
      level: v.level,
      areaName: v.areaName,
      asOf: v.asOf,
      method: v.method,
      sampleSize: v.sampleSize ?? null,
      periodsAvailable: v.periodsAvailable ?? null,
      dwellingTypeMatched: v.dwellingTypeMatched,
      acquisition: acquisitionOf(v),
      licensing: v.licensingStatus ?? 'undeclared',
    });
  }
  return rows.sort((a, b) => a.input.localeCompare(b.input));
}

function dimensionReason(key: DimensionKey, r: ShadowScoreResult): string {
  const reading = r.dimensions.find((d) => d.key === key)!;
  if (reading.score === null) {
    switch (key) {
      case 'growth': return 'No suburb capital-growth evidence could be measured.';
      case 'demand': return 'No suburb demand evidence could be measured.';
      case 'yield': return 'The rent or the basis amount required for a yield is not in the record.';
      case 'location': return 'No location inputs could be measured for this property.';
      // Model D states its own reason precisely — one sentence a report can print.
      case 'risk': return r.risk.eligibility.reason;
    }
  }
  const pct = Math.round(reading.coverage * 100);
  const conf = reading.confidence !== null ? `; evidence confidence ${reading.confidence}` : '';
  return `Measured on ${pct}% of this dimension's methodology${conf}.`;
}

/**
 * Project the engine's result into the canonical consumer object.
 *
 * Pure projection: nothing is recomputed, re-weighted or re-graded here, and a
 * spec asserts the contributions reconcile to the composite the engine
 * produced.
 */
export function buildScoreOutput(
  result: ShadowScoreResult,
  evidence: MarketEvidence,
): ScoreOutput {
  const dimensions: DimensionOutput[] = result.dimensions.map((d) => ({
    key: d.key,
    available: d.score !== null,
    performance: d.score,
    confidence: d.confidence,
    nominalWeight: d.nominalWeight,
    effectiveWeight: d.effectiveWeight,
    contributionPoints: d.score === null
      ? null
      : Number((d.score * d.effectiveWeight).toFixed(2)),
    coverage: d.coverage,
    reason: dimensionReason(d.key, result),
  }));

  return {
    contractVersion: SCORE_OUTPUT_CONTRACT_VERSION,
    methodologyVersion: result.methodologyVersion,
    componentVersions: result.componentVersions,

    score: result.compositeScore,
    scoreGrade: result.uncappedGrade,
    grade: result.grade,
    gradeCapped: result.eligibility?.capped ?? false,
    gradeCapReasons: result.gradeCapReason,
    gradeEligibility: result.eligibility
      ? { ceiling: result.eligibility.ceiling, version: result.eligibility.version }
      : null,

    evidenceCoverage: result.evidenceCoverage,
    overallConfidence: { value: null, definedAt: 'methodology lock, after real-evidence calibration' },

    dimensions,
    unavailable: result.unavailable,
    unavailableReason: result.unavailableReason,

    evidenceStatement: result.evidenceStatement,
    provenance: provenanceRows(evidence),

    financeSuitability: result.financeSuitability,
    holdingCashFlow: result.holdingCashFlow,
  };
}
