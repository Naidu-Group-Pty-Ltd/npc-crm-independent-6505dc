/**
 * PDF Extraction V3 · E12 — Golden Corpus & Release Gate versioned contracts.
 *
 * The final release-certification layer. These contracts describe generated
 * fixtures, their INDEPENDENT expected truth, run manifests/results, the strict
 * release-gate policy and its report, deterministic + performance evidence,
 * baselines and the readiness decision.
 *
 * Non-negotiable rules encoded here and in the evaluator:
 *   - a required WARNING / SKIPPED / UNAVAILABLE / INFRASTRUCTURE-ERROR check is a
 *     release FAILURE for release tiers (no `pass_with_warnings` release
 *     eligibility for Tiers 3–6);
 *   - a hard defect can never be overridden by a score;
 *   - expected truth is emitted by the fixture builder, never derived from the
 *     extracted candidate;
 *   - no signed URL / raw buffer / private path / credential ever enters a
 *     contract or report;
 *   - baselines never self-update; readiness for unproven tiers is `null`, not
 *     `false`.
 */

// ── Version constants ────────────────────────────────────────────────────────

export const GOLDEN_CORPUS_REGISTRY_V2_VERSION = 'pdf-golden-corpus-registry-v2' as const;
export const GENERATED_FIXTURE_SPEC_VERSION = 'pdf-generated-fixture-spec-v1' as const;
export const PRIVATE_CORPUS_REGISTRY_VERSION = 'pdf-private-corpus-registry-v1' as const;
export const GOLDEN_EXPECTED_TRUTH_VERSION = 'pdf-golden-expected-truth-v1' as const;
export const GOLDEN_RUN_MANIFEST_V2_VERSION = 'pdf-golden-run-manifest-v2' as const;
export const GOLDEN_RUN_RESULT_V2_VERSION = 'pdf-golden-run-result-v2' as const;
export const GOLDEN_SUITE_RESULT_VERSION = 'pdf-golden-suite-result-v1' as const;
export const RELEASE_GATE_POLICY_V2_VERSION = 'pdf-release-gate-policy-v2' as const;
export const RELEASE_GATE_REPORT_V2_VERSION = 'pdf-release-gate-report-v2' as const;
export const RELEASE_BASELINE_V2_VERSION = 'pdf-release-baseline-v2' as const;
export const RELEASE_DETERMINISM_REPORT_VERSION = 'pdf-release-determinism-report-v1' as const;
export const RELEASE_PERFORMANCE_REPORT_VERSION = 'pdf-release-performance-report-v1' as const;
export const RELEASE_ARTIFACT_MANIFEST_VERSION = 'pdf-release-artifact-manifest-v1' as const;
export const RELEASE_READINESS_DECISION_VERSION = 'pdf-release-readiness-v1' as const;

/** The source-builder implementation version; a change repartitions fixture identity. */
export const SOURCE_BUILDER_VERSION = 'pdf-source-builder-v1' as const;
/** The threshold policy version; a change repartitions baselines and gate identity. */
export const RELEASE_THRESHOLDS_VERSION = 'pdf-release-thresholds-v2' as const;

// ── Release tiers ────────────────────────────────────────────────────────────

export type ReleaseGateTier =
  | 'static'            // Tier 1 — fast PR contract/scan gate (no PDF execution)
  | 'generated-fast'    // Tier 2 — mandatory PR end-to-end (small generated fixtures)
  | 'generated-full'    // Tier 3 — main/nightly full generated coverage
  | 'private-controlled' // Tier 4 — approved private corpus, manual/trusted only
  | 'zero-traffic-runtime' // Tier 5 — future operator-run Cloud Run revision gate
  | 'canary-promotion';    // Tier 6 — future controlled-traffic decision

export const RELEASE_GATE_TIERS: readonly ReleaseGateTier[] = [
  'static', 'generated-fast', 'generated-full', 'private-controlled', 'zero-traffic-runtime', 'canary-promotion',
];

/** Tiers that must fail on any required warning/skip/unavailable (no advisory release pass). */
export const STRICT_RELEASE_TIERS: ReadonlySet<ReleaseGateTier> = new Set([
  'generated-full', 'private-controlled', 'zero-traffic-runtime', 'canary-promotion',
]);

// ── Check status semantics ───────────────────────────────────────────────────

export type ReleaseCheckStatus =
  | 'pass' | 'fail' | 'warning' | 'skipped' | 'unavailable' | 'infrastructure-error' | 'not-applicable';

export type ReleaseCheckSeverity = 'hard' | 'soft' | 'advisory';

export type ReleaseDecision = 'pass' | 'fail' | 'blocked' | 'infrastructure-failure';

export type FixtureRunStatus = 'pass' | 'fail' | 'blocked' | 'infrastructure-failure';

export type GoldenFixtureFamily =
  | 'native-prose' | 'multi-page-native' | 'adjacent-complex-tables' | 'multi-row-header-table'
  | 'chart-heavy' | 'mixed-chart-table-text' | 'branded-brochure' | 'unavailable-font'
  | 'typography-ranges' | 'image-only-scan' | 'rotated-page' | 'rtl-complex-script'
  | 'formula-and-code' | 'blank-near-blank' | 'twenty-five-page' | 'eighty-page'
  | 'pre-upgrade-failure-class' | 'safe-raster-only' | 'provider-conflict' | 'cache-replay';

export type PerformanceClass = 'tiny' | 'small' | 'medium' | 'large';

// ── Check ────────────────────────────────────────────────────────────────────

export type ReleaseCheckDomain =
  | 'source-integrity' | 'contracts' | 'planning' | 'runtime' | 'extraction' | 'charts'
  | 'tables' | 'typography' | 'composition' | 'quality' | 'repair' | 'providers' | 'routing'
  | 'cache' | 'recovery' | 'export' | 'determinism' | 'performance' | 'review-ui' | 'security'
  | 'private-artifacts' | 'packaging' | 'ci' | 'deployment-readiness';

export interface ReleaseGateCheckV2 {
  checkId: string;
  title: string;
  domain: ReleaseCheckDomain;
  severity: ReleaseCheckSeverity;
  status: ReleaseCheckStatus;
  /** Bounded, privacy-safe explanation — never raw private content. */
  detail: string;
  fixtureId: string | null;
  pageNumber: number | null;
  regionId: string | null;
  evidenceRef: string | null;
  remediation: string | null;
}

// ── Generated fixture spec ───────────────────────────────────────────────────

export interface GeneratedFixtureSpecV1 {
  version: typeof GENERATED_FIXTURE_SPEC_VERSION;
  fixtureId: string;
  family: GoldenFixtureFamily;
  title: string;
  sourceBuilderVersion: string;
  seed: number;
  pageCount: number;
  expectedTruthRef: string;
  requiredContracts: string[];
  requiredCapabilities: string[];
  expectedPageClasses: string[];
  expectedOutputStrategies: string[];
  requiredReleaseTiers: ReleaseGateTier[];
  performanceClass: PerformanceClass;
  problems: string[];
}

// ── Expected truth ───────────────────────────────────────────────────────────

export interface GoldenExpectedRegionTruthV1 {
  regionId: string;
  regionType: string;
  bbox: { x: number; y: number; width: number; height: number };
  parentRegionId: string | null;
  criticalUnicode: string[];
  criticalNumericTokens: string[];
  expectsSourceCrop: boolean;
  expectsNativeSafe: boolean;
}

export interface GoldenExpectedPageTruthV1 {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  rotation: number;
  regions: GoldenExpectedRegionTruthV1[];
  chartCount: number;
  pictureCount: number;
  tableCount: number;
  tableCells: number;
  numericAssociations: number;
  expectsRasterOnly: boolean;
  acceptableFallbackStrategies: string[];
}

export interface GoldenExpectedOutputConstraintsV1 {
  minOutputScore: number;
  maxRepairPasses: number;
  maxHardDefects: number;
  requireBrowserExportParity: boolean;
  forbidRemoteProviders: boolean;
}

export interface GoldenExpectedTruthV1 {
  version: typeof GOLDEN_EXPECTED_TRUTH_VERSION;
  fixtureId: string;
  sourceSha256: string;
  pageCount: number;
  pages: GoldenExpectedPageTruthV1[];
  expectedDocumentClass: string;
  expectedPlanProperties: Record<string, unknown>;
  expectedOutputConstraints: GoldenExpectedOutputConstraintsV1;
  problems: string[];
}

// ── Run manifest / result ────────────────────────────────────────────────────

export interface GoldenRunManifestV2 {
  version: typeof GOLDEN_RUN_MANIFEST_V2_VERSION;
  runId: string;
  suiteId: string;
  releaseTier: ReleaseGateTier;
  fixtureId: string;
  sourceHash: string;
  environmentProfileId: string;
  applicationCommit: string;
  applicationBuildIdentity: string | null;
  sidecarBuildIdentity: string | null;
  imageDigest: string | null;
  contractVersions: Record<string, string>;
  browserIdentity: { name: string; version: string } | null;
  nodeVersion: string;
  pythonVersion: string | null;
  operatingSystem: string;
  fontCatalogVersion: string | null;
  plannerIdentity: { planId: string | null; planHash: string | null; fingerprint: string | null };
  providerPolicyHash: string | null;
  thresholdPolicyVersion: string;
  baselineVersion: string | null;
  seed: number | null;
  /** Deterministic semantic key (NO timestamp) used for baseline matching. */
  semanticRunKey: string;
  startedAt: string;
  problems: string[];
}

export interface GoldenPageResultV2 {
  pageNumber: number;
  outputStrategy: string;
  score: number | null;
  hardDefectCount: number;
  criticalCoverage: number | null;
  browserRendered: boolean;
  exportRendered: boolean;
}

export interface GoldenRunResultV2 {
  version: typeof GOLDEN_RUN_RESULT_V2_VERSION;
  runId: string;
  semanticRunKey: string;
  fixtureId: string;
  releaseTier: ReleaseGateTier;
  status: FixtureRunStatus;
  pageCountExpected: number;
  pageCountObserved: number;
  finalDecision: string | null;
  pageResults: GoldenPageResultV2[];
  hardDefectCount: number;
  criticalCoverage: number | null;
  sourceFidelityScore: number | null;
  finalOutputScore: number | null;
  exportScore: number | null;
  browserExportParity: number | null;
  repairPasses: number;
  introducedHardDefects: number;
  providerAuditComplete: boolean;
  routingAuditComplete: boolean;
  artifactComplete: boolean;
  cacheReplayComplete: boolean | null;
  performance: ReleasePerformanceReportV1 | null;
  determinism: ReleaseDeterminismReportV1 | null;
  checks: ReleaseGateCheckV2[];
  artifactManifestRef: string | null;
  problems: string[];
}

export interface GoldenSuiteResultV1 {
  version: typeof GOLDEN_SUITE_RESULT_VERSION;
  suiteId: string;
  releaseTier: ReleaseGateTier;
  fixtureResults: GoldenRunResultV2[];
  problems: string[];
}

// ── Determinism / performance ────────────────────────────────────────────────

export interface DeterminismMismatchV1 {
  field: string;
  first: string | number | boolean | null;
  second: string | number | boolean | null;
}

export interface ReleaseDeterminismReportV1 {
  version: typeof RELEASE_DETERMINISM_REPORT_VERSION;
  firstRunKey: string;
  secondRunKey: string;
  exactFieldsMatched: boolean;
  metricFieldsWithinTolerance: boolean;
  mismatches: DeterminismMismatchV1[];
  passed: boolean;
  problems: string[];
}

export interface PerformanceRegressionV1 {
  metric: string;
  observed: number;
  baselineMax: number;
  relativeRegression: number | null;
}

export interface ReleasePerformanceReportV1 {
  version: typeof RELEASE_PERFORMANCE_REPORT_VERSION;
  environmentProfileId: string;
  fixtureId: string;
  timings: Record<string, number | null>;
  peakMemoryBytes: number | null;
  pageThroughput: number | null;
  artifactBytes: number | null;
  baselineComparison: { available: boolean; regressions: PerformanceRegressionV1[] };
  passed: boolean | null;
  problems: string[];
}

// ── Baseline / artifact manifest / readiness ─────────────────────────────────

export interface ReleaseBaselineV2 {
  version: typeof RELEASE_BASELINE_V2_VERSION;
  baselineId: string;
  environmentProfileId: string;
  fixtureId: string;
  sourceBuilderVersion: string;
  approvedCommit: string;
  approvedContractVersions: Record<string, string>;
  expectedMetricRanges: Record<string, { minimum: number | null; maximum: number | null }>;
  performanceRanges: Record<string, { maximum: number | null; relativeRegressionLimit: number | null }>;
  approvedBy: string | null;
  approvedAt: string | null;
  problems: string[];
}

export interface ReleaseArtifactEntryV1 {
  kind: string;
  fixtureId: string;
  relativePath: string;
  sha256: string | null;
  byteSize: number | null;
  private: boolean;
  uploadPermitted: boolean;
  retentionDays: number;
}

export interface ReleaseArtifactManifestV1 {
  version: typeof RELEASE_ARTIFACT_MANIFEST_VERSION;
  runId: string;
  generatedArtifacts: ReleaseArtifactEntryV1[];
  forbiddenArtifactsDetected: string[];
  problems: string[];
}

export interface ReleaseReadinessDecisionV1 {
  version: typeof RELEASE_READINESS_DECISION_VERSION;
  codeReady: boolean;
  generatedCorpusReady: boolean;
  privateCorpusReady: boolean | null;
  localContainerReady: boolean;
  zeroTrafficRuntimeReady: boolean | null;
  canaryReady: boolean | null;
  productionPromotionReady: boolean | null;
  blockingReasons: string[];
  evidenceReportIds: string[];
  problems: string[];
}

// ── Gate policy ──────────────────────────────────────────────────────────────

export interface ReleaseThresholdsV2 {
  version: typeof RELEASE_THRESHOLDS_VERSION;
  criticalPageCoverage: number;      // = 1
  criticalRegionCoverage: number;    // = 1
  maxUnresolvedHardDefects: number;  // = 0
  maxUnscoredCriticalPages: number;  // = 0
  maxBlockedPages: number;           // = 0
  chartVisibility: number;           // = 1
  pictureVisibility: number;         // = 1
  maxBlankRequiredCrops: number;     // = 0
  maxDuplicateRepresentations: number; // = 0
  maxWrongCellAssociations: number;  // = 0
  maxMissingRows: number;            // = 0
  maxMissingColumns: number;         // = 0
  maxGenericHeaders: number;         // = 0
  maxClippedRows: number;            // = 0
  criticalUnicodeRecall: number;     // = 1
  criticalNumericRecall: number;     // = 1
  criticalPunctuationRecall: number; // = 1
  overallVisibleTextRecall: number;  // >= 0.99
  criticalVisibleTextRecall: number; // = 1
  minGeneratedOutputScore: number;   // >= 0.92
  minComplexOutputScore: number;     // >= 0.95
  browserExportParity: number;       // = 1
  maxRepairPasses: number;           // <= 2
  maxIntroducedHardDefects: number;  // = 0
  maxRemoteProviderAttempts: number; // = 0 (generated tiers)
  maxLegacyCacheHits: number;        // = 0
  maxPartialCacheHits: number;       // = 0
  artifactCompleteness: number;      // = 1
  maxPrivateArtifactLeaks: number;   // = 0
  maxSignedUrlsPersisted: number;    // = 0
}

export interface ReleasePerformancePolicyV1 {
  defaultRelativeRegressionLimit: number; // 0.20
  requireBaseline: boolean;
  absoluteSuiteCeilingMs: number;
}

export interface ReleaseArtifactPolicyV1 {
  allowGeneratedDiffUpload: boolean;
  allowPrivateImageUpload: boolean;
  defaultRetentionDays: number;
}

export interface ReleaseGatePolicyV2 {
  version: typeof RELEASE_GATE_POLICY_V2_VERSION;
  policyId: string;
  tier: ReleaseGateTier;
  requiredFixtures: string[];
  requiredChecks: string[];
  nonblockingWarningCodes: string[];
  requireBuild: boolean;
  requireTypecheck: boolean;
  requireBrowser: boolean;
  requireExport: boolean;
  requirePrivateCorpus: boolean;
  requireDocker: boolean;
  requireCacheReplay: boolean;
  requireDeterminismReplay: boolean;
  requireLargeDocument: boolean;
  thresholds: ReleaseThresholdsV2;
  performancePolicy: ReleasePerformancePolicyV1;
  artifactPolicy: ReleaseArtifactPolicyV1;
  failOnWarning: boolean;
  failOnSkipped: boolean;
  failOnUnavailable: boolean;
  maximumSuiteDurationMs: number;
  problems: string[];
}

// ── Gate report ──────────────────────────────────────────────────────────────

export interface ReleaseGateReportV2 {
  version: typeof RELEASE_GATE_REPORT_V2_VERSION;
  reportId: string;
  tier: ReleaseGateTier;
  commit: string;
  environmentProfileId: string;
  startedAt: string;
  completedAt: string;
  decision: ReleaseDecision;
  fixtureResults: GoldenRunResultV2[];
  checks: ReleaseGateCheckV2[];
  requiredCheckCount: number;
  passedRequiredCheckCount: number;
  failedRequiredCheckCount: number;
  skippedRequiredCheckCount: number;
  unavailableRequiredCheckCount: number;
  hardDefectCount: number;
  privateArtifactLeakCount: number;
  performanceRegressionCount: number;
  releaseReady: boolean;
  remediationSummary: string[];
  artifactManifestRef: string | null;
  problems: string[];
}

// ── Registry V2 ──────────────────────────────────────────────────────────────

export interface GeneratedFixtureRegistrationV1 {
  fixtureId: string;
  family: GoldenFixtureFamily;
  sourceBuilderVersion: string;
  seed: number;
  requiredReleaseTiers: ReleaseGateTier[];
  performanceClass: PerformanceClass;
}

export interface PrivateCorpusRegistrationV1 {
  corpusId: string;
  approvedCategory: string;
  sourceSha256: string;
  expectedPageCount: number | null;
  expectedPageRange: [number, number] | null;
  approvedLayoutFamilyTags: string[];
  approvalState: 'pending' | 'approved' | 'revoked';
  retentionClassification: string;
  requiredGateTier: ReleaseGateTier;
  expectedCriticalRegionCounts: Record<string, number> | null;
  expectedThresholdProfile: string | null;
  privateSourceResolverKey: string;
  notes: string;
}

export interface GoldenCorpusRegistryV2 {
  version: typeof GOLDEN_CORPUS_REGISTRY_V2_VERSION;
  registryId: string;
  generatedFixtures: GeneratedFixtureRegistrationV1[];
  privateFixtures: PrivateCorpusRegistrationV1[];
  requiredFixtureIdsByTier: Record<ReleaseGateTier, string[]>;
  thresholdPolicyVersion: string;
  updatedAt: string;
  problems: string[];
}

export interface PrivateCorpusRegistryV1 {
  version: typeof PRIVATE_CORPUS_REGISTRY_VERSION;
  registryId: string;
  items: PrivateCorpusRegistrationV1[];
  problems: string[];
}
