/**
 * PDF Extraction V3 · E12 — release-gate evaluator.
 *
 * Reduces a set of fixture results + checks into a strict ReleaseGateReportV2.
 * The release decision is hard-defect-first and never releases on a required
 * warning/skip/unavailable for release tiers. `releaseReady` is true ONLY when
 * the decision is `pass`, every required check passed, there is no private
 * artifact leak, and there are zero unresolved hard defects.
 */
import {
  RELEASE_GATE_REPORT_V2_VERSION,
  type GoldenRunResultV2,
  type ReleaseDecision,
  type ReleaseGateCheckV2,
  type ReleaseGatePolicyV2,
  type ReleaseGateReportV2,
} from './contracts';
import { requiredCheckBlocks } from './gatePolicy';
import { stableHash } from './redaction';

export interface EvaluateGateInput {
  tier: ReleaseGatePolicyV2['tier'];
  policy: ReleaseGatePolicyV2;
  commit: string;
  environmentProfileId: string;
  startedAt: string;
  completedAt: string;
  fixtureResults: GoldenRunResultV2[];
  /** Suite-level checks (contracts, security, packaging, ci …) beyond per-fixture checks. */
  suiteChecks: ReleaseGateCheckV2[];
  privateArtifactLeaks: string[];
  performanceRegressionCount: number;
}

export function evaluateReleaseGate(input: EvaluateGateInput): ReleaseGateReportV2 {
  const { policy } = input;
  const allChecks: ReleaseGateCheckV2[] = [
    ...input.suiteChecks,
    ...input.fixtureResults.flatMap((r) => r.checks),
  ];

  const requiredIds = new Set(policy.requiredChecks);
  const requiredChecks = allChecks.filter((c) => requiredIds.has(c.checkId));

  let passedRequired = 0;
  let failedRequired = 0;
  let skippedRequired = 0;
  let unavailableRequired = 0;
  const remediation: string[] = [];

  // A required check that never ran is a FAILURE (a missing required check can
  // never silently disappear). Track which required ids were produced.
  const producedRequiredIds = new Set(requiredChecks.map((c) => c.checkId));
  for (const id of requiredIds) {
    if (!producedRequiredIds.has(id)) {
      failedRequired += 1;
      remediation.push(`Required check '${id}' did not run (treated as failure).`);
    }
  }

  let anyInfra = false;
  for (const check of requiredChecks) {
    const block = requiredCheckBlocks(check, policy);
    if (block === null) {
      passedRequired += 1;
      continue;
    }
    if (check.status === 'skipped') skippedRequired += 1;
    else if (check.status === 'unavailable') unavailableRequired += 1;
    else if (check.status === 'infrastructure-error') anyInfra = true;
    failedRequired += 1;
    remediation.push(`${check.checkId}: ${block}${check.remediation ? ` — ${check.remediation}` : ''}`);
  }

  const hardDefectCount =
    input.fixtureResults.reduce((n, r) => n + r.hardDefectCount, 0);
  const anyFixtureInfra = input.fixtureResults.some((r) => r.status === 'infrastructure-failure');
  const anyFixtureBlocked = input.fixtureResults.some((r) => r.status === 'blocked');
  const privateLeakCount = input.privateArtifactLeaks.length;

  let decision: ReleaseDecision;
  if (anyInfra || anyFixtureInfra) decision = 'infrastructure-failure';
  else if (anyFixtureBlocked) decision = 'blocked';
  else if (failedRequired > 0 || hardDefectCount > 0 || privateLeakCount > 0) decision = 'fail';
  else decision = 'pass';

  const releaseReady =
    decision === 'pass' &&
    failedRequired === 0 &&
    privateLeakCount === 0 &&
    hardDefectCount === 0;

  const base = {
    version: RELEASE_GATE_REPORT_V2_VERSION,
    tier: input.tier,
    commit: input.commit,
    environmentProfileId: input.environmentProfileId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    decision,
    fixtureResults: input.fixtureResults,
    checks: allChecks,
    requiredCheckCount: requiredIds.size,
    passedRequiredCheckCount: passedRequired,
    failedRequiredCheckCount: failedRequired,
    skippedRequiredCheckCount: skippedRequired,
    unavailableRequiredCheckCount: unavailableRequired,
    hardDefectCount,
    privateArtifactLeakCount: privateLeakCount,
    performanceRegressionCount: input.performanceRegressionCount,
    releaseReady,
    remediationSummary: remediation,
    artifactManifestRef: null as string | null,
    problems: [] as string[],
  };
  // Report identity excludes wall-clock (startedAt/completedAt) so it is stable.
  const reportId = stableHash('rgr', {
    tier: base.tier, commit: base.commit, environmentProfileId: base.environmentProfileId,
    decision: base.decision, requiredCheckCount: base.requiredCheckCount,
    passedRequiredCheckCount: base.passedRequiredCheckCount, hardDefectCount: base.hardDefectCount,
  });
  return { ...base, reportId };
}

/** Map a required warning to a nonzero CLI exit code decision. exit 0 only on pass. */
export function decisionToExitCode(decision: ReleaseDecision, releaseReady: boolean): number {
  return decision === 'pass' && releaseReady ? 0 : 1;
}
