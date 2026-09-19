/**
 * PDF Extraction V3 · E12 — release-gate policy, thresholds and STRICT status semantics.
 *
 * The strict semantics are the heart of E12: for release tiers a required WARNING,
 * SKIPPED, UNAVAILABLE or INFRASTRUCTURE-ERROR check is a release FAILURE — there
 * is no `pass_with_warnings` release-eligible decision for Tiers 3–6. Tiers 1–2
 * may carry advisory warnings but every CRITICAL check must still pass. A hard
 * defect can never be downgraded by a score.
 */
import {
  RELEASE_GATE_POLICY_V2_VERSION,
  RELEASE_THRESHOLDS_VERSION,
  STRICT_RELEASE_TIERS,
  type ReleaseCheckStatus,
  type ReleaseGateCheckV2,
  type ReleaseGatePolicyV2,
  type ReleaseGateTier,
  type ReleaseThresholdsV2,
} from './contracts';
import { stableHash } from './redaction';

// ── Canonical thresholds (never loosened to pass tests) ──────────────────────

export function defaultThresholds(): ReleaseThresholdsV2 {
  return {
    version: RELEASE_THRESHOLDS_VERSION,
    criticalPageCoverage: 1,
    criticalRegionCoverage: 1,
    maxUnresolvedHardDefects: 0,
    maxUnscoredCriticalPages: 0,
    maxBlockedPages: 0,
    chartVisibility: 1,
    pictureVisibility: 1,
    maxBlankRequiredCrops: 0,
    maxDuplicateRepresentations: 0,
    maxWrongCellAssociations: 0,
    maxMissingRows: 0,
    maxMissingColumns: 0,
    maxGenericHeaders: 0,
    maxClippedRows: 0,
    criticalUnicodeRecall: 1,
    criticalNumericRecall: 1,
    criticalPunctuationRecall: 1,
    overallVisibleTextRecall: 0.99,
    criticalVisibleTextRecall: 1,
    minGeneratedOutputScore: 0.92,
    minComplexOutputScore: 0.95,
    browserExportParity: 1,
    maxRepairPasses: 2,
    maxIntroducedHardDefects: 0,
    maxRemoteProviderAttempts: 0,
    maxLegacyCacheHits: 0,
    maxPartialCacheHits: 0,
    artifactCompleteness: 1,
    maxPrivateArtifactLeaks: 0,
    maxSignedUrlsPersisted: 0,
  };
}

// ── Per-tier policy ──────────────────────────────────────────────────────────

const CORE_CHECKS = [
  'source-integrity.hash', 'contracts.matrix', 'quality.hard-defects-zero',
  'security.no-signed-urls', 'security.no-credentials', 'private-artifacts.scan',
];

const GENERATED_CHECKS = [
  ...CORE_CHECKS,
  'planning.plan-v3-coverage', 'charts.visibility', 'tables.native-or-crop',
  'typography.critical-recall', 'composition.single-owner', 'quality.browser-evidence',
  'repair.max-two-passes', 'providers.no-remote', 'cache.no-legacy-reuse',
  'export.parity', 'determinism.replay',
];

const FULL_CHECKS = [
  ...GENERATED_CHECKS,
  'performance.baseline', 'cache.replay-complete', 'recovery.reroute-new-plan',
  'runtime.container', 'review-ui.smoke', 'planning.large-document',
];

export function defaultGatePolicy(tier: ReleaseGateTier): ReleaseGatePolicyV2 {
  const strict = STRICT_RELEASE_TIERS.has(tier);
  const thresholds = defaultThresholds();
  const base: Omit<ReleaseGatePolicyV2, 'policyId'> = {
    version: RELEASE_GATE_POLICY_V2_VERSION,
    tier,
    requiredFixtures: [],
    requiredChecks: [],
    nonblockingWarningCodes: [],
    requireBuild: false,
    requireTypecheck: true,
    requireBrowser: false,
    requireExport: false,
    requirePrivateCorpus: false,
    requireDocker: false,
    requireCacheReplay: false,
    requireDeterminismReplay: false,
    requireLargeDocument: false,
    thresholds,
    performancePolicy: { defaultRelativeRegressionLimit: 0.2, requireBaseline: false, absoluteSuiteCeilingMs: 15 * 60_000 },
    artifactPolicy: { allowGeneratedDiffUpload: true, allowPrivateImageUpload: false, defaultRetentionDays: 14 },
    failOnWarning: strict,
    failOnSkipped: true,
    failOnUnavailable: strict,
    maximumSuiteDurationMs: 15 * 60_000,
    problems: [],
  };

  switch (tier) {
    case 'static':
      base.requiredChecks = CORE_CHECKS;
      base.failOnUnavailable = false; // Tier 1 may defer build/browser to owning jobs
      break;
    case 'generated-fast':
      base.requiredChecks = GENERATED_CHECKS;
      base.requireBrowser = true;
      base.requireExport = true;
      base.requireDeterminismReplay = true;
      base.nonblockingWarningCodes = ['performance.baseline.missing'];
      break;
    case 'generated-full':
      base.requiredChecks = FULL_CHECKS;
      base.requireBuild = true;
      base.requireBrowser = true;
      base.requireExport = true;
      base.requireCacheReplay = true;
      base.requireDeterminismReplay = true;
      base.requireLargeDocument = true;
      base.performancePolicy.requireBaseline = true;
      base.maximumSuiteDurationMs = 60 * 60_000;
      break;
    case 'private-controlled':
      base.requiredChecks = FULL_CHECKS;
      base.requirePrivateCorpus = true;
      base.requireBrowser = true;
      base.requireExport = true;
      base.artifactPolicy.allowGeneratedDiffUpload = false;
      break;
    case 'zero-traffic-runtime':
    case 'canary-promotion':
      base.requiredChecks = FULL_CHECKS;
      base.requireBrowser = true;
      base.requireExport = true;
      base.requireDocker = true;
      break;
  }

  const policyId = stableHash('rgp', {
    tier: base.tier, requiredChecks: base.requiredChecks, thresholds: base.thresholds,
    failOnWarning: base.failOnWarning, failOnSkipped: base.failOnSkipped, failOnUnavailable: base.failOnUnavailable,
  });
  return { ...base, policyId };
}

// ── Strict status semantics ──────────────────────────────────────────────────

/**
 * Decide whether a required check's status blocks the release for a policy.
 * Returns null when non-blocking, or a reason code when it blocks.
 */
export function requiredCheckBlocks(
  check: ReleaseGateCheckV2,
  policy: ReleaseGatePolicyV2,
): string | null {
  const s: ReleaseCheckStatus = check.status;
  if (s === 'pass') return null;
  if (s === 'not-applicable') return null; // only reached when policy marks it N/A
  if (s === 'fail') return 'required_check_failed';
  if (s === 'infrastructure-error') return 'required_check_infrastructure_error';
  if (s === 'warning') {
    if (!policy.failOnWarning && policy.nonblockingWarningCodes.includes(check.checkId)) return null;
    return 'required_check_warning';
  }
  if (s === 'skipped') return policy.failOnSkipped ? 'required_check_skipped' : null;
  if (s === 'unavailable') return policy.failOnUnavailable ? 'required_check_unavailable' : null;
  return 'required_check_unknown_status';
}

/** A hard-severity check never passes on a warning/skip regardless of policy leniency. */
export function isHardCheckSatisfied(check: ReleaseGateCheckV2): boolean {
  if (check.severity !== 'hard') return true;
  return check.status === 'pass' || check.status === 'not-applicable';
}
