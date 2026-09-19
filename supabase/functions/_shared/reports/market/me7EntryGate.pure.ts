/**
 * ME-6 closure — the evidence precedence, and the gate ME-7 must pass.
 *
 * Two rules that were prose in a brief and are code here, because a rule
 * nothing executes is a rule somebody reinterprets under deadline.
 *
 * ## 1. Precedence — what may serve Growth, and in what order
 *
 * The ordering is not about quality. It is about **what the number is about**.
 * A suburb median describes the subject's own market; a state or capital-city
 * index describes a market the subject sits inside. Substituting the second
 * for the first is how an "evidence-backed" score comes to rest on a figure
 * that is identical for six hundred properties.
 *
 * So `ABS regional/state data is not subject Growth` is enforced rather than
 * remembered: `SUBJECT_GROWTH_PRECEDENCE` does not contain a benchmark tier,
 * and `benchmarkOnly` names the sources that may only ever be a benchmark.
 *
 * ## 2. The gate — when ME-7 may begin
 *
 * The load-bearing clause is representativeness, and it is a statement about
 * THIS corpus rather than a general principle: QLD (338) and WA (137) are 475
 * of the 665 Growth-ready reports, so a backtest covering only VIC and NSW
 * would validate the methodology against 26% of the portfolio and report a
 * number about the other 74% that it never tested.
 *
 * The gate therefore refuses a sample that omits either, **and does not
 * require 100% coverage** — those two together are the point. A gate that
 * demanded everything would never open, and one that ignored geography would
 * open on the wrong quarter of the corpus.
 */

import type { EvidenceAcquisition } from './marketEvidence.pure.ts';
import type { GrowthDwellingClass } from './growthPopulation.pure.ts';

export const ME7_GATE_VERSION = 'me7.gate.1';

/**
 * Sources that may supply the SUBJECT's own Growth, best first.
 *
 * `unavailable` is the last tier and is a real answer: a Growth figure with no
 * source is absent, never 0 and never 50.
 */
export const SUBJECT_GROWTH_PRECEDENCE = [
  'domain_existing_licensed',   // an entitlement already held, at no new cost
  'proptrack_trial_shadow',     // trial access, internal validation only
  'open_state_suburb_series',   // an authoritative open suburb × dwelling series
  'unavailable',
] as const;
export type SubjectGrowthSource = (typeof SUBJECT_GROWTH_PRECEDENCE)[number];

/** Demand, same shape and the same last tier. */
export const DEMAND_PRECEDENCE = [
  'provider_or_open_demand',    // genuine provider or open demand evidence
  'government_context',         // authoritative government/context data
  'unavailable',
] as const;
export type DemandSource = (typeof DEMAND_PRECEDENCE)[number];

/**
 * Sources that are a BENCHMARK and can never be subject Growth.
 *
 * Named explicitly so the refusal is a lookup rather than a judgement call at
 * the call site.
 */
const BENCHMARK_ONLY = new Set([
  'abs_res_dwell', 'abs_res_dwell_st', 'abs_rppi', 'abs_erp', 'abs_census',
]);

/** May this provider's series stand as the SUBJECT's Growth? */
export function mayServeSubjectGrowth(provider: string): boolean {
  return !BENCHMARK_ONLY.has(provider.toLowerCase());
}

/** The sources that may only ever appear as a benchmark. */
export function benchmarkOnly(): readonly string[] {
  return [...BENCHMARK_ONLY].sort();
}

/**
 * One state's measured Growth coverage within the sealed population.
 */
export interface StateCoverage {
  state: string;
  /** Growth-ready reports in the population for this state. */
  population: number;
  /** Of those, how many have genuine subject Growth evidence. */
  covered: number;
  /** Dwelling classes actually represented in the covered set. */
  classes: readonly GrowthDwellingClass[];
}

export interface Me7GateInput {
  populationVersion: string | null;
  /** True only once the manifest is sealed and immutable. */
  populationSealed: boolean;
  /** Coverage per state, measured against the population. */
  coverage: readonly StateCoverage[];
  /** Acquisition footings present in the evidence snapshot. */
  acquisitions: readonly EvidenceAcquisition[];
  /** True once the evidence snapshot is sealed and reproducible. */
  snapshotSealed: boolean;
}

export interface Me7GateVerdict {
  mayBegin: boolean;
  /** Every unmet condition, named. Empty when the gate opens. */
  blockers: readonly string[];
  /** Conditions deliberately NOT required, so nobody adds them later. */
  notRequired: readonly string[];
}

/** States whose absence makes a sample unrepresentative of THIS corpus. */
const REQUIRED_STATES = ['QLD', 'WA'] as const;

/**
 * Evaluate the entry gate.
 *
 * Every blocker is a sentence an operator can act on. `mayBegin` is true only
 * when there are none — there is no partial pass, because "mostly ready" is
 * how a backtest starts on evidence nobody checked.
 */
export function evaluateMe7Gate(input: Me7GateInput): Me7GateVerdict {
  const blockers: string[] = [];

  if (!input.populationSealed || !input.populationVersion) {
    blockers.push('The Growth-ready population manifest is not sealed.');
  }

  const byState = new Map(input.coverage.map((c) => [c.state.toUpperCase(), c]));
  for (const s of REQUIRED_STATES) {
    const c = byState.get(s);
    if (!c || c.covered === 0) {
      blockers.push(
        `${s} has no subject Growth evidence. ${s} is part of the ~74% of the `
        + 'Growth-ready population held by QLD and WA together, so a sample '
        + 'without it is not representative of this corpus.',
      );
    }
  }

  const anyCovered = input.coverage.some((c) => c.covered > 0);
  if (!anyCovered) {
    blockers.push('No state has subject Growth evidence.');
  } else {
    const classes = new Set(input.coverage.flatMap((c) => c.classes));
    if (classes.size === 0) {
      blockers.push('No dwelling class is represented in the covered evidence.');
    }
  }

  // A footing must be present and must be one that permits at least shadow use.
  if (input.acquisitions.length === 0) {
    blockers.push('No acquisition footing is recorded on the evidence.');
  } else if (input.acquisitions.every((a) => a === 'commercial_upgrade_required')) {
    blockers.push(
      'Every source is behind an unpurchased upgrade, so no evidence was obtained.',
    );
  }

  if (!input.snapshotSealed) {
    blockers.push('The evidence snapshot is not sealed, so the run is not reproducible.');
  }

  return {
    mayBegin: blockers.length === 0,
    blockers,
    notRequired: [
      '100% corpus coverage — the gate asks for a representative sample, not a complete one.',
      'A complete Demand dataset — missing Demand is recorded as absent, never delayed for.',
      'Victoria specifically — VIC is 131 of 665 and is not on the required list.',
      'Postcode-level evidence — suburb and state are the provider grain.',
    ],
  };
}
