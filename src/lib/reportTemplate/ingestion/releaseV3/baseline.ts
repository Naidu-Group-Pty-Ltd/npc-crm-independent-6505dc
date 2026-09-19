/**
 * PDF Extraction V3 · E12 — baseline model + update governance (no auto-update).
 *
 * Baselines never self-update. An update requires an explicit command, a human
 * reason, a source-builder/version check and produces a diff — it never auto-merges
 * and a threshold REDUCTION is flagged separately (never a routine update).
 */
import {
  RELEASE_BASELINE_V2_VERSION,
  SOURCE_BUILDER_VERSION,
  type ReleaseBaselineV2,
  type GoldenRunResultV2,
} from './contracts';
import { stableHash } from './redaction';

export interface ProposeBaselineInput {
  environmentProfileId: string;
  fixtureId: string;
  approvedCommit: string;
  approvedContractVersions: Record<string, string>;
  result: GoldenRunResultV2;
  reason: string;
  approvedBy: string | null;
}

/**
 * Propose (never auto-apply) a baseline from a run result. Rejects any proposal
 * built on a result that still carries hard defects.
 */
export function proposeBaseline(input: ProposeBaselineInput): { baseline: ReleaseBaselineV2 | null; problems: string[] } {
  const problems: string[] = [];
  if (!input.reason || input.reason.trim().length < 8) problems.push('reason_required');
  if (input.result.hardDefectCount > 0) problems.push('cannot_baseline_with_hard_defects');
  if (input.result.status !== 'pass') problems.push('cannot_baseline_non_passing_result');
  if (problems.length > 0) return { baseline: null, problems };

  const perf = input.result.performance;
  const performanceRanges: ReleaseBaselineV2['performanceRanges'] = {};
  if (perf) {
    for (const [metric, ms] of Object.entries(perf.timings)) {
      if (typeof ms === 'number') performanceRanges[metric] = { maximum: ms, relativeRegressionLimit: 0.2 };
    }
  }
  const expectedMetricRanges: ReleaseBaselineV2['expectedMetricRanges'] = {
    finalOutputScore: { minimum: input.result.finalOutputScore, maximum: null },
    exportScore: { minimum: input.result.exportScore, maximum: null },
  };

  const base = {
    version: RELEASE_BASELINE_V2_VERSION,
    environmentProfileId: input.environmentProfileId,
    fixtureId: input.fixtureId,
    sourceBuilderVersion: SOURCE_BUILDER_VERSION,
    approvedCommit: input.approvedCommit,
    approvedContractVersions: input.approvedContractVersions,
    expectedMetricRanges,
    performanceRanges,
    approvedBy: input.approvedBy,
    approvedAt: null as string | null,
    problems: [] as string[],
  };
  const baselineId = stableHash('rbl', {
    environmentProfileId: base.environmentProfileId, fixtureId: base.fixtureId,
    sourceBuilderVersion: base.sourceBuilderVersion, approvedCommit: base.approvedCommit,
  });
  return { baseline: { ...base, baselineId }, problems: [] };
}

/** Detect whether a proposed baseline LOWERS a threshold vs the existing one. */
export function detectThresholdReductions(existing: ReleaseBaselineV2 | null, proposed: ReleaseBaselineV2): string[] {
  if (!existing) return [];
  const reductions: string[] = [];
  for (const [metric, range] of Object.entries(proposed.expectedMetricRanges)) {
    const prev = existing.expectedMetricRanges[metric];
    if (prev && typeof prev.minimum === 'number' && typeof range.minimum === 'number' && range.minimum < prev.minimum) {
      reductions.push(`${metric}: minimum ${prev.minimum} → ${range.minimum} (REDUCTION — requires separate approval)`);
    }
  }
  return reductions;
}

/** An update is only valid with an explicit force flag; a reduction always needs review. */
export function canApplyBaselineUpdate(opts: { explicitForce: boolean; reductions: string[]; reductionApproved: boolean }): boolean {
  if (!opts.explicitForce) return false;
  if (opts.reductions.length > 0 && !opts.reductionApproved) return false;
  return true;
}
