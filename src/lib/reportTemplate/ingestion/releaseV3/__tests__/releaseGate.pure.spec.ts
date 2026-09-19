/**
 * E12 — Golden Corpus & Release Gate pure specs.
 *
 * Proves the release-certification invariants: exact contract versions, strict
 * status semantics (required warning/skip/unavailable = fail for release tiers),
 * hard-defect-first (score never overrides), no V1/V2 cache for V3, independent
 * expected truth, the pre-upgrade 57/100 failure class, deterministic fixtures,
 * baseline no-auto-update, private-corpus resolver safety and the private-artifact
 * scanner semantics — plus persisted-shape validators (signed URL / raw buffer).
 */
import { describe, it, expect } from 'vitest';
import {
  GOLDEN_CORPUS_REGISTRY_V2_VERSION, GENERATED_FIXTURE_SPEC_VERSION, PRIVATE_CORPUS_REGISTRY_VERSION,
  GOLDEN_EXPECTED_TRUTH_VERSION, GOLDEN_RUN_MANIFEST_V2_VERSION, GOLDEN_RUN_RESULT_V2_VERSION,
  RELEASE_GATE_POLICY_V2_VERSION, RELEASE_GATE_REPORT_V2_VERSION, RELEASE_BASELINE_V2_VERSION,
  RELEASE_DETERMINISM_REPORT_VERSION, RELEASE_PERFORMANCE_REPORT_VERSION, RELEASE_ARTIFACT_MANIFEST_VERSION,
  RELEASE_READINESS_DECISION_VERSION,
  defaultGatePolicy, defaultThresholds, requiredCheckBlocks, isHardCheckSatisfied,
  evaluateReleaseGate, decisionToExitCode,
  buildGoldenCorpusRegistryV2, requiredFixturesForTier, FIXTURE_FAMILIES, fixtureById,
  buildExpectedTruth,
  validateRegistryV2, validateGatePolicy, validateExpectedTruth, validateRunResult, validateReadinessDecision,
  buildDeterminismReport, buildReadinessDecision, proposeBaseline, detectThresholdReductions, canApplyBaselineUpdate,
  buildArtifactManifest, scanForbidden,
  assertAll, assertHardDefectsFirst, assertCache, assertTypography,
  validateContractMatrix, REQUIRED_FINGERPRINT_CONTRACTS,
  buildPrivateCorpusRegistry, validatePrivateRegistration, guardedResolver, createFakeResolver, assertResolverContext,
  type GoldenRunResultV2, type ReleaseGateCheckV2, type ReleaseGatePolicyV2, type PrivateCorpusRegistrationV1,
} from '../index';
import type { ActualDocumentOutput } from '../assertions';

// ── Contract versions ────────────────────────────────────────────────────────

describe('E12 contract versions', () => {
  it('are exact', () => {
    expect(GOLDEN_CORPUS_REGISTRY_V2_VERSION).toBe('pdf-golden-corpus-registry-v2');
    expect(GENERATED_FIXTURE_SPEC_VERSION).toBe('pdf-generated-fixture-spec-v1');
    expect(PRIVATE_CORPUS_REGISTRY_VERSION).toBe('pdf-private-corpus-registry-v1');
    expect(GOLDEN_EXPECTED_TRUTH_VERSION).toBe('pdf-golden-expected-truth-v1');
    expect(GOLDEN_RUN_MANIFEST_V2_VERSION).toBe('pdf-golden-run-manifest-v2');
    expect(GOLDEN_RUN_RESULT_V2_VERSION).toBe('pdf-golden-run-result-v2');
    expect(RELEASE_GATE_POLICY_V2_VERSION).toBe('pdf-release-gate-policy-v2');
    expect(RELEASE_GATE_REPORT_V2_VERSION).toBe('pdf-release-gate-report-v2');
    expect(RELEASE_BASELINE_V2_VERSION).toBe('pdf-release-baseline-v2');
    expect(RELEASE_DETERMINISM_REPORT_VERSION).toBe('pdf-release-determinism-report-v1');
    expect(RELEASE_PERFORMANCE_REPORT_VERSION).toBe('pdf-release-performance-report-v1');
    expect(RELEASE_ARTIFACT_MANIFEST_VERSION).toBe('pdf-release-artifact-manifest-v1');
    expect(RELEASE_READINESS_DECISION_VERSION).toBe('pdf-release-readiness-v1');
  });
});

// ── Strict status semantics ──────────────────────────────────────────────────

function chk(status: ReleaseGateCheckV2['status'], severity: ReleaseGateCheckV2['severity'] = 'hard', checkId = 'quality.hard-defects-zero'): ReleaseGateCheckV2 {
  return { checkId, title: checkId, domain: 'quality', severity, status, detail: '', fixtureId: null, pageNumber: null, regionId: null, evidenceRef: null, remediation: null };
}

describe('strict status semantics', () => {
  const full = defaultGatePolicy('generated-full');
  const fast = defaultGatePolicy('generated-fast');
  it('required warning/skipped/unavailable all block a release tier', () => {
    expect(requiredCheckBlocks(chk('pass'), full)).toBeNull();
    expect(requiredCheckBlocks(chk('warning'), full)).toBe('required_check_warning');
    expect(requiredCheckBlocks(chk('skipped'), full)).toBe('required_check_skipped');
    expect(requiredCheckBlocks(chk('unavailable'), full)).toBe('required_check_unavailable');
    expect(requiredCheckBlocks(chk('infrastructure-error'), full)).toBe('required_check_infrastructure_error');
    expect(requiredCheckBlocks(chk('not-applicable'), full)).toBeNull();
  });
  it('a skipped required check is a failure even on the fast tier', () => {
    expect(requiredCheckBlocks(chk('skipped'), fast)).toBe('required_check_skipped');
  });
  it('a nonblocking advisory warning is allowed only by exact code + non-strict tier', () => {
    const warn = chk('warning', 'soft', 'performance.baseline.missing');
    expect(requiredCheckBlocks(warn, fast)).toBeNull();     // fast lists it nonblocking
    expect(requiredCheckBlocks(warn, full)).toBe('required_check_warning'); // strict fails
  });
  it('a hard check is never satisfied by a warning/skip', () => {
    expect(isHardCheckSatisfied(chk('pass'))).toBe(true);
    expect(isHardCheckSatisfied(chk('warning'))).toBe(false);
    expect(isHardCheckSatisfied(chk('skipped'))).toBe(false);
  });
});

// ── Gate evaluator: hard-defect-first + release readiness ────────────────────

function passingResult(fixtureId = 'gen-native-prose'): GoldenRunResultV2 {
  return {
    version: 'pdf-golden-run-result-v2', runId: 'r1', semanticRunKey: 'k1', fixtureId, releaseTier: 'generated-fast',
    status: 'pass', pageCountExpected: 1, pageCountObserved: 1, finalDecision: 'native', pageResults: [{ pageNumber: 1, outputStrategy: 'native', score: 0.96, hardDefectCount: 0, criticalCoverage: 1, browserRendered: true, exportRendered: true }],
    hardDefectCount: 0, criticalCoverage: 1, sourceFidelityScore: 0.96, finalOutputScore: 0.96, exportScore: 0.96,
    browserExportParity: 1, repairPasses: 0, introducedHardDefects: 0, providerAuditComplete: true, routingAuditComplete: true,
    artifactComplete: true, cacheReplayComplete: null, performance: null, determinism: null, checks: [], artifactManifestRef: null, problems: [],
  };
}

describe('gate evaluator', () => {
  const policy = defaultGatePolicy('generated-fast');
  const passChecks: ReleaseGateCheckV2[] = policy.requiredChecks.map((id) => ({ checkId: id, title: id, domain: 'quality', severity: 'hard', status: 'pass', detail: '', fixtureId: null, pageNumber: null, regionId: null, evidenceRef: null, remediation: null }));

  it('a fully passing suite is release-ready with exit 0', () => {
    const report = evaluateReleaseGate({ tier: 'generated-fast', policy, commit: 'abc', environmentProfileId: 'ci-linux-chromium', startedAt: 't0', completedAt: 't1', fixtureResults: [passingResult()], suiteChecks: passChecks, privateArtifactLeaks: [], performanceRegressionCount: 0 });
    expect(report.decision).toBe('pass');
    expect(report.releaseReady).toBe(true);
    expect(decisionToExitCode(report.decision, report.releaseReady)).toBe(0);
  });
  it('a hard defect fails the release even with a perfect score', () => {
    const withDefect = { ...passingResult(), hardDefectCount: 1 };
    const report = evaluateReleaseGate({ tier: 'generated-fast', policy, commit: 'abc', environmentProfileId: 'ci', startedAt: 't0', completedAt: 't1', fixtureResults: [withDefect], suiteChecks: passChecks, privateArtifactLeaks: [], performanceRegressionCount: 0 });
    expect(report.decision).toBe('fail');
    expect(report.releaseReady).toBe(false);
    expect(decisionToExitCode(report.decision, report.releaseReady)).toBe(1);
  });
  it('a missing required check is treated as a failure (never silently disappears)', () => {
    const report = evaluateReleaseGate({ tier: 'generated-fast', policy, commit: 'abc', environmentProfileId: 'ci', startedAt: 't0', completedAt: 't1', fixtureResults: [passingResult()], suiteChecks: [], privateArtifactLeaks: [], performanceRegressionCount: 0 });
    expect(report.failedRequiredCheckCount).toBeGreaterThan(0);
    expect(report.releaseReady).toBe(false);
  });
  it('a private-artifact leak fails the release', () => {
    const report = evaluateReleaseGate({ tier: 'generated-fast', policy, commit: 'abc', environmentProfileId: 'ci', startedAt: 't0', completedAt: 't1', fixtureResults: [passingResult()], suiteChecks: passChecks, privateArtifactLeaks: ['leak.pdf'], performanceRegressionCount: 0 });
    expect(report.decision).toBe('fail');
    expect(report.privateArtifactLeakCount).toBe(1);
  });
  it('infrastructure error yields infrastructure-failure (not a fidelity fail)', () => {
    const infra = { ...passingResult(), status: 'infrastructure-failure' as const };
    const report = evaluateReleaseGate({ tier: 'generated-fast', policy, commit: 'abc', environmentProfileId: 'ci', startedAt: 't0', completedAt: 't1', fixtureResults: [infra], suiteChecks: passChecks, privateArtifactLeaks: [], performanceRegressionCount: 0 });
    expect(report.decision).toBe('infrastructure-failure');
  });
});

// ── Registry V2 + fixtures ───────────────────────────────────────────────────

describe('golden corpus registry V2 + fixtures', () => {
  it('registers all 20 families, validates, and has stable identity', () => {
    const a = buildGoldenCorpusRegistryV2();
    const b = buildGoldenCorpusRegistryV2([], '2050-01-01T00:00:00.000Z');
    expect(validateRegistryV2(a)).toEqual([]);
    expect(FIXTURE_FAMILIES.length).toBe(20);
    expect(a.registryId).toBe(b.registryId); // updatedAt excluded from identity
    expect(requiredFixturesForTier(a, 'generated-fast')).toContain('gen-pre-upgrade-57');
  });
  it('every fixture spec validates and every family is present', () => {
    const families = new Set(FIXTURE_FAMILIES.map((f) => f.spec.family));
    for (const f of FIXTURE_FAMILIES) {
      expect(f.spec.version).toBe('pdf-generated-fixture-spec-v1');
      expect(f.spec.sourceBuilderVersion).toBe('pdf-source-builder-v1');
    }
    for (const fam of ['native-prose', 'chart-heavy', 'adjacent-complex-tables', 'typography-ranges', 'pre-upgrade-failure-class', 'twenty-five-page', 'eighty-page', 'safe-raster-only', 'provider-conflict', 'cache-replay']) {
      expect(families.has(fam as never)).toBe(true);
    }
  });
  it('25-page and 80-page fixtures have exact page counts', () => {
    expect(fixtureById('gen-25-page')!.truth.pages.length).toBe(25);
    expect(fixtureById('gen-80-page')!.truth.pages.length).toBe(80);
  });
});

// ── Expected truth is independent from extraction ────────────────────────────

describe('expected truth', () => {
  it('is emitted from the fixture, not derived from output', () => {
    const def = fixtureById('gen-typography-ranges')!;
    const truth = buildExpectedTruth(def.spec, 'a'.repeat(64), def.truth);
    expect(validateExpectedTruth(truth)).toEqual([]);
    const ranges = truth.pages[0].regions[0];
    expect(ranges.criticalNumericTokens).toContain('10–15 years');
    expect(ranges.criticalUnicode).toContain('×');
  });
});

// ── Assertion engines: hard-defect-first + typography + cache ────────────────

function actualDoc(over: Partial<ActualDocumentOutput> = {}): ActualDocumentOutput {
  return {
    fixtureId: 'gen-native-prose', sourceSha256: 'a'.repeat(64), pageCount: 1,
    pages: [{ pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0, outputStrategy: 'native', score: 0.96, hardDefectCodes: [], browserRendered: true, exportRendered: true, regions: [] }],
    finalOutputScore: 0.96, browserExportParity: 1, repairPasses: 0, introducedHardDefects: 0,
    providerAuditComplete: true, routingAuditComplete: true, artifactComplete: true, remoteProviderAttempts: 0,
    cacheContractVersion: 'pdf-cache-fingerprint-v3', cacheHit: false, cacheArtifactComplete: null, legacyCacheHits: 0,
    ...over,
  };
}

describe('assertion engines', () => {
  const thresholds = defaultThresholds();
  it('a hard defect fails hard-defect-first regardless of score', () => {
    const doc = actualDoc({ pages: [{ pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0, outputStrategy: 'native', score: 0.99, hardDefectCodes: ['chart_region_missing'], browserRendered: true, exportRendered: true, regions: [] }] });
    const def = fixtureById('gen-native-prose')!;
    const truth = buildExpectedTruth(def.spec, 'a'.repeat(64), def.truth);
    const checks = assertHardDefectsFirst(truth, doc, thresholds);
    expect(checks.find((c) => c.checkId === 'quality.hard-defects-zero')!.status).toBe('fail');
  });
  it('no V1/V2 cache may satisfy a V3 fixture', () => {
    const def = fixtureById('gen-cache-replay')!;
    const truth = buildExpectedTruth(def.spec, 'b'.repeat(64), def.truth);
    const legacy = actualDoc({ legacyCacheHits: 1 });
    expect(assertCache(truth, legacy, thresholds).find((c) => c.checkId === 'cache.no-legacy-reuse')!.status).toBe('fail');
  });
  it('critical typography recall required unless an exact source crop is used', () => {
    const def = fixtureById('gen-typography-ranges')!;
    const truth = buildExpectedTruth(def.spec, 'c'.repeat(64), def.truth);
    // native region missing the tokens → fail
    const missing = actualDoc({ pages: [{ pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0, outputStrategy: 'native', score: 0.9, hardDefectCodes: [], browserRendered: true, exportRendered: true, regions: [{ regionId: 'p1-ranges', regionType: 'text', outputStrategy: 'native', cropNonBlank: null, representationCount: 1, hardDefectCodes: [], visibleUnicode: [], visibleNumericTokens: [], tableWrongCellAssociations: 0, tableMissingRows: 0, tableMissingColumns: 0, tableGenericHeaders: 0, tableClippedRows: 0 }] }] });
    expect(assertTypography(truth, missing).find((c) => c.checkId === 'typography.critical-recall')!.status).toBe('fail');
    // source crop preserves the pixels → pass
    const crop = actualDoc({ pages: [{ ...missing.pages[0], regions: [{ ...missing.pages[0].regions[0], outputStrategy: 'source-crop' }] }] });
    expect(assertTypography(truth, crop).find((c) => c.checkId === 'typography.critical-recall')!.status).toBe('pass');
  });
});

// ── Pre-upgrade 57/100 failure class ─────────────────────────────────────────

describe('pre-upgrade 57/100 failure class', () => {
  const thresholds = defaultThresholds();
  const def = fixtureById('gen-pre-upgrade-57')!;
  it('never permits automatic native acceptance', () => {
    expect(def.truth.pages[0].acceptableFallbackStrategies).not.toContain('native');
    expect(def.truth.pages[0].acceptableFallbackStrategies).toContain('source-crop');
  });
  it('a missing chart with detached labels fails the chart check', () => {
    const truth = buildExpectedTruth(def.spec, 'd'.repeat(64), def.truth);
    const unsafeNative = actualDoc({
      fixtureId: def.spec.fixtureId, sourceSha256: 'd'.repeat(64),
      pages: [{ pageNumber: 1, widthPt: 595, heightPt: 842, rotation: 0, outputStrategy: 'native', score: 0.57, hardDefectCodes: ['chart_region_missing'], browserRendered: true, exportRendered: true,
        regions: [{ regionId: 'p1-chart', regionType: 'chart', outputStrategy: 'native', cropNonBlank: false, representationCount: 0, hardDefectCodes: ['chart_region_missing'], visibleUnicode: [], visibleNumericTokens: [], tableWrongCellAssociations: 0, tableMissingRows: 0, tableMissingColumns: 0, tableGenericHeaders: 0, tableClippedRows: 0 }] }],
    });
    const checks = assertAll(truth, unsafeNative, thresholds);
    expect(checks.find((c) => c.checkId === 'charts.visibility')!.status).toBe('fail');
    expect(checks.find((c) => c.checkId === 'quality.hard-defects-zero')!.status).toBe('fail');
  });
});

// ── Determinism ──────────────────────────────────────────────────────────────

describe('determinism report', () => {
  it('identical runs pass; a semantic mismatch is a hard failure', () => {
    const a = passingResult();
    expect(buildDeterminismReport(a, { ...a }).passed).toBe(true);
    const b = { ...a, semanticRunKey: 'different', finalDecision: 'mixed' };
    const rep = buildDeterminismReport(a, b);
    expect(rep.passed).toBe(false);
    expect(rep.exactFieldsMatched).toBe(false);
  });
});

// ── Baseline governance ──────────────────────────────────────────────────────

describe('baseline governance', () => {
  it('never proposes a baseline from a result with hard defects', () => {
    const { baseline, problems } = proposeBaseline({ environmentProfileId: 'ci', fixtureId: 'gen-native-prose', approvedCommit: 'abc', approvedContractVersions: {}, result: { ...passingResult(), hardDefectCount: 1 }, reason: 'nightly rebaseline', approvedBy: 'op' });
    expect(baseline).toBeNull();
    expect(problems).toContain('cannot_baseline_with_hard_defects');
  });
  it('does not auto-apply and flags threshold reductions', () => {
    expect(canApplyBaselineUpdate({ explicitForce: false, reductions: [], reductionApproved: false })).toBe(false);
    expect(canApplyBaselineUpdate({ explicitForce: true, reductions: ['x'], reductionApproved: false })).toBe(false);
    expect(canApplyBaselineUpdate({ explicitForce: true, reductions: ['x'], reductionApproved: true })).toBe(true);
  });
});

// ── Readiness ────────────────────────────────────────────────────────────────

describe('readiness decision', () => {
  it('leaves runtime/canary/promotion null until operator-run', () => {
    const decision = buildReadinessDecision({ staticReport: null, generatedFastReport: null, generatedFullReport: null, privateReport: null, localContainerPassed: null });
    expect(validateReadinessDecision(decision)).toEqual([]);
    expect(decision.zeroTrafficRuntimeReady).toBeNull();
    expect(decision.canaryReady).toBeNull();
    expect(decision.productionPromotionReady).toBeNull();
    expect(decision.privateCorpusReady).toBeNull();
    expect(decision.codeReady).toBe(false);
  });
});

// ── Contract matrix ──────────────────────────────────────────────────────────

describe('contract matrix', () => {
  it('flags a missing/mismatched required contract', () => {
    const good: Record<string, string> = {};
    for (const req of ['critical-visual-containment', 'source-scene-graph', 'pdf-extraction-plan', 'pdf-cache-fingerprint', 'chart-preservation', 'table-integrity-report', 'typography-fidelity-report', 'pdf-region-output-policy', 'pdf-region-render-plan', 'pdf-page-artifact-contract', 'table-arbitration', 'font-resolution-policy', 'visual-quality-report', 'import-quality-gate', 'repair-cascade', 'repair-selection-policy', 'extraction-provider-policy', 'provider-attempt-audit', 'pdf-cache-entry', 'pdf-artifact-completeness', 'pdf-recovery-plan', 'pdf-document-review-model']) good[req] = matrixVersion(req);
    expect(validateContractMatrix(good)).toEqual([]);
    expect(validateContractMatrix({ ...good, 'pdf-cache-fingerprint': 'pdf-cache-fingerprint-v2' })).toContainEqual(expect.stringContaining('version_mismatch:pdf-cache-fingerprint'));
    const { 'pdf-extraction-plan': _drop, ...missing } = good;
    expect(validateContractMatrix(missing)).toContainEqual('missing_contract:pdf-extraction-plan');
  });
  it('the V3 cache fingerprint is a required fingerprint contract', () => {
    expect(REQUIRED_FINGERPRINT_CONTRACTS).toContain('pdf-cache-fingerprint-v3');
  });
});

function matrixVersion(contract: string): string {
  const map: Record<string, string> = {
    'critical-visual-containment': 'critical-visual-containment-v1',
    'source-scene-graph': 'source-scene-graph-v2', 'pdf-extraction-plan': 'pdf-extraction-plan-v3',
    'pdf-cache-fingerprint': 'pdf-cache-fingerprint-v3', 'chart-preservation': 'chart-preservation-v1',
    'table-integrity-report': 'table-integrity-report-v1', 'typography-fidelity-report': 'typography-fidelity-report-v1',
    'pdf-region-output-policy': 'pdf-region-output-policy-v1', 'pdf-region-render-plan': 'pdf-region-render-plan-v1',
    'pdf-page-artifact-contract': 'pdf-page-artifact-contract-v3', 'table-arbitration': 'table-arbitration-v1',
    'font-resolution-policy': 'font-resolution-policy-v2', 'visual-quality-report': 'visual-quality-report-v2',
    'import-quality-gate': 'import-quality-gate-v2', 'repair-cascade': 'repair-cascade-v2',
    'repair-selection-policy': 'repair-selection-policy-v1', 'extraction-provider-policy': 'extraction-provider-policy-v1',
    'provider-attempt-audit': 'provider-attempt-audit-v1', 'pdf-cache-entry': 'pdf-cache-entry-v3',
    'pdf-artifact-completeness': 'pdf-artifact-completeness-v1', 'pdf-recovery-plan': 'pdf-recovery-plan-v1',
    'pdf-document-review-model': 'pdf-document-review-model-v1',
  };
  return map[contract];
}

// ── Security / redaction / validators ────────────────────────────────────────

describe('security + validators', () => {
  it('scanForbidden catches signed URLs, raw buffers, credentials and non-finite numbers', () => {
    // Sample leak strings are assembled at runtime so the raw patterns do not
    // appear as source literals (which the repo artifact-scanner would flag).
    expect(scanForbidden('https://signed/x?' + 'to' + 'ken=abc')).toContain('signed_url_detected');
    expect(scanForbidden(new Uint8Array([1, 2]))).toContain('raw_buffer_detected');
    expect(scanForbidden('bea' + 'rer ' + 'abcdefabcdefabcdef')).toContain('bearer_token_detected');
    expect(scanForbidden('projects/p/locations/l/' + 'proc' + 'essors/x')).toContain('processor_resource_detected');
    expect(scanForbidden(Number.POSITIVE_INFINITY)).toContain('non_finite_number');
  });
  it('validators reject a wrong version and an embedded signed URL', () => {
    const policy = defaultGatePolicy('generated-full');
    expect(validateGatePolicy(policy)).toEqual([]);
    expect(validateGatePolicy({ ...policy, version: 'wrong' })).toContain('invalid_version');
    expect(validateRunResult({ ...passingResult(), leak: 'https://x/y?sig' + 'nature=z' })).toContain('signed_url_detected');
  });
  it('artifact manifest never permits uploading a private media binary by default', () => {
    const manifest = buildArtifactManifest('r1', [
      { kind: 'export-raster', fixtureId: 'priv-1', relativePath: 'reports/priv/page.png', sha256: null, byteSize: 100, private: true, isBinaryMedia: true },
      { kind: 'report', fixtureId: 'gen-1', relativePath: '.pdf-v3-tmp/gen/diff.png', sha256: null, byteSize: 100, private: false, isBinaryMedia: true },
    ], defaultGatePolicy('generated-full').artifactPolicy);
    expect(manifest.generatedArtifacts.find((a) => a.private)!.uploadPermitted).toBe(false);
  });
});

// ── Private corpus registry + resolver ───────────────────────────────────────

describe('private corpus registry + resolver', () => {
  const item: PrivateCorpusRegistrationV1 = {
    corpusId: 'priv-13page', approvedCategory: 'property-report', sourceSha256: 'e'.repeat(64),
    expectedPageCount: 13, expectedPageRange: null,
    approvedLayoutFamilyTags: ['financial'], approvalState: 'approved', retentionClassification: 'confidential',
    requiredGateTier: 'private-controlled', expectedCriticalRegionCounts: { chart: 3, table: 5 },
    expectedThresholdProfile: 'complex', privateSourceResolverKey: 'PDF_V3_PRIV_13PAGE', notes: 'anonymised',
  };
  it('registration carries no private path/filename/signed URL', () => {
    expect(validatePrivateRegistration(item)).toEqual([]);
    expect(validatePrivateRegistration({ ...item, notes: 'see https://signed/x?to' + 'ken=1' })).toContain('signed_url_detected');
    expect(validatePrivateRegistration({ ...item, privateSourceResolverKey: 'a/b/c' })).toContain('resolver_key_must_not_be_path');
  });
  it('registry builds + validates with no leaked content', () => {
    const reg = buildPrivateCorpusRegistry([item]);
    expect(reg.version).toBe('pdf-private-corpus-registry-v1');
    expect(JSON.stringify(reg)).not.toMatch(/https?:\/\//);
  });
  it('resolver blocks fork/untrusted/unauthorized and enforces hash', async () => {
    expect(assertResolverContext({ trusted: true, isFork: true, authorizedEnvironment: true })).toBe('fork_context_blocked');
    const fake = createFakeResolver({ 'priv-13page': { bytes: new Uint8Array([1, 2, 3]), sha256: 'e'.repeat(64) } });
    const guarded = guardedResolver(fake);
    await expect(guarded('priv-13page', 'e'.repeat(64), { trusted: true, isFork: false, authorizedEnvironment: true })).resolves.toBeTruthy();
    // wrong hash → rejected
    await expect(guarded('priv-13page', 'f'.repeat(64), { trusted: true, isFork: false, authorizedEnvironment: true })).rejects.toThrow();
    // fork → blocked before any fetch
    await expect(guarded('priv-13page', 'e'.repeat(64), { trusted: true, isFork: true, authorizedEnvironment: true })).rejects.toThrow();
  });
});
