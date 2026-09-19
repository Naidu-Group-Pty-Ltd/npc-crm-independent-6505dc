/**
 * pdfImportPerformanceSignals — Phase 10F.
 *
 * Deterministic extraction of performance/cost signals from existing import
 * metadata, summaries, jobs, and Phase 10B–10E audits. Never reads or stores raw
 * PDF/OCR text or rasters. All timestamps are read where safely available and
 * left null otherwise (staleness is resolved conservatively downstream).
 */
import type {
  PdfImportPerformanceEvidence,
  PdfImportPerformanceSignals,
} from './pdfImportPerformanceTypes';

export function coercePdfImportPerformanceBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    if (t === 'true') return true;
    if (t === 'false') return false;
  }
  return null;
}

export function coercePdfImportPerformanceNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function readPdfImportPerformancePath(source: unknown, path: string[]): unknown {
  let cur: any = source;
  for (const key of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

function coerceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function pickString(cands: unknown[]): string | null {
  for (const c of cands) {
    const r = coerceString(c);
    if (r !== null) return r;
  }
  return null;
}

function pickNumber(cands: unknown[]): number | null {
  for (const c of cands) {
    const r = coercePdfImportPerformanceNumber(c);
    if (r !== null) return r;
  }
  return null;
}

const read = readPdfImportPerformancePath;

/** Count known expected artifact paths on the snapshot/record and how many are
 * missing for a completed import. */
export function countKnownArtifactPaths(input: {
  snapshot?: unknown;
  record?: unknown;
}): { artifactPathCount: number; missingArtifactPathCount: number } {
  const snapshot = input.snapshot;
  const record = input.record;
  const meta = read(record, ['meta']);

  // High-value expected artifact paths for a fully processed import.
  const candidates: Array<string | null> = [
    pickString([read(snapshot, ['visualQaArtifactPath']), read(meta, ['visual_quality_artifact_path'])]),
    pickString([read(snapshot, ['repairArtifactPath']), read(meta, ['visual_repair_artifact_path'])]),
    pickString([read(snapshot, ['exportParityArtifactPath']), read(meta, ['export_parity_artifact_path'])]),
    pickString([read(meta, ['per_page_docling_manifest_path']), read(snapshot, ['perPageDoclingManifestPath'])]),
  ];

  const artifactPathCount = candidates.filter((c) => c !== null).length;
  const missingArtifactPathCount = candidates.filter((c) => c === null).length;
  return { artifactPathCount, missingArtifactPathCount };
}

export function countGoldenHistoryRuns(history: unknown[] | undefined): number | null {
  if (!Array.isArray(history)) return null;
  return history.length;
}

function arrayLen(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

export function countWarningsAndFailures(input: {
  goldenRegressionSummary?: unknown;
  selfHealingRetryAudit?: unknown;
  repairPatternAnalysis?: unknown;
  adaptiveReconciliationPolicy?: unknown;
  importIntelligenceProfile?: unknown;
}): { warningCount: number; failureCount: number } {
  let warningCount = 0;
  let failureCount = 0;

  warningCount += arrayLen(read(input.goldenRegressionSummary, ['warnings']));
  failureCount += arrayLen(read(input.goldenRegressionSummary, ['failures']));

  warningCount += arrayLen(read(input.selfHealingRetryAudit, ['warnings']));
  failureCount += arrayLen(read(input.selfHealingRetryAudit, ['blockers']));

  warningCount += arrayLen(read(input.repairPatternAnalysis, ['warnings']));
  failureCount += arrayLen(read(input.repairPatternAnalysis, ['blockers']));

  warningCount += arrayLen(read(input.adaptiveReconciliationPolicy, ['warnings']));
  failureCount += arrayLen(read(input.adaptiveReconciliationPolicy, ['blockers']));

  warningCount += arrayLen(read(input.importIntelligenceProfile, ['warnings']));
  failureCount += arrayLen(read(input.importIntelligenceProfile, ['blockers']));

  return { warningCount, failureCount };
}

const LONG_RUNNING_JOB_MS = 60000;

export function extractPdfImportPerformanceSignals(input: {
  importId?: string | null;
  templateId?: string | null;
  sourceFilename?: string | null;
  snapshot?: unknown;
  importIntelligenceProfile?: unknown;
  repairPatternAnalysis?: unknown;
  adaptiveReconciliationPolicy?: unknown;
  selfHealingRetryAudit?: unknown;
  visualQualitySummary?: unknown;
  repairSummary?: unknown;
  exportParitySummary?: unknown;
  goldenRegressionSummary?: unknown;
  goldenHistory?: unknown[];
  pdfImportJob?: unknown;
  record?: unknown;
}): {
  signals: PdfImportPerformanceSignals;
  evidence: PdfImportPerformanceEvidence[];
  warnings: string[];
  blockers: string[];
} {
  const evidence: PdfImportPerformanceEvidence[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];
  const addWarning = (w: string) => { if (!warnings.includes(w)) warnings.push(w); };
  const addBlocker = (b: string) => { if (!blockers.includes(b)) blockers.push(b); };
  const addEvidence = (e: PdfImportPerformanceEvidence) => evidence.push(e);

  const snapshot = input.snapshot;
  const profile = input.importIntelligenceProfile;
  const pattern = input.repairPatternAnalysis;
  const policy = input.adaptiveReconciliationPolicy;
  const selfHealing = input.selfHealingRetryAudit;
  const golden = input.goldenRegressionSummary;

  // Identity
  const importId = pickString([
    input.importId, read(snapshot, ['importId']), read(profile, ['importId']),
  ]);
  const templateId = pickString([
    input.templateId, read(snapshot, ['templateId']), read(profile, ['templateId']),
  ]);
  const sourceFilename = pickString([
    input.sourceFilename, read(snapshot, ['sourceFilename']), read(profile, ['sourceFilename']),
  ]);

  // Import
  const importStatus = pickString([read(snapshot, ['importStatus']), read(input.pdfImportJob, ['status'])]);
  const pageCount = pickNumber([read(snapshot, ['importPageCount']), read(snapshot, ['templatePageCount'])]);
  const engineVersion = pickString([read(snapshot, ['engineVersion']), read(input.pdfImportJob, ['engine_version'])]);

  // Visual QA
  const visualQaScore = pickNumber([
    read(snapshot, ['visualQaScore']), read(input.visualQualitySummary, ['overallScore']),
  ]);
  const hasVisualQuality = read(snapshot, ['visualQaArtifactPath']) != null
    || visualQaScore !== null
    || input.visualQualitySummary != null;
  const visualQaGeneratedAt = pickString([read(input.visualQualitySummary, ['generatedAt'])]);

  // Repair
  const repairStatus = pickString([read(snapshot, ['repairStatus']), read(input.repairSummary, ['repairStatus'])]);
  const repairFinalScore = pickNumber([read(snapshot, ['repairFinalScore']), read(input.repairSummary, ['finalScore'])]);
  const hasRepairAudit = read(snapshot, ['repairArtifactPath']) != null
    || repairStatus !== null
    || input.repairSummary != null;
  const repairGeneratedAt = pickString([read(input.repairSummary, ['generatedAt'])]);

  // Export parity
  const exportParityStatus = pickString([read(snapshot, ['exportParityStatus']), read(input.exportParitySummary, ['status'])]);
  const exportVsSourceScore = pickNumber([read(snapshot, ['exportVsSourceScore']), read(input.exportParitySummary, ['exportVsSourceScore'])]);
  const hasExportParity = read(snapshot, ['exportParityArtifactPath']) != null
    || exportParityStatus !== null
    || input.exportParitySummary != null;
  const exportParityGeneratedAt = pickString([read(input.exportParitySummary, ['generatedAt'])]);

  // Golden regression
  const goldenQualityGateStatus = pickString([read(golden, ['qualityGateStatus'])]);
  const hasGoldenRegression = golden != null || goldenQualityGateStatus !== null;
  const goldenGeneratedAt = pickString([read(golden, ['generatedAt'])]);
  const goldenPersistedAt = pickString([read(golden, ['persistedAt'])]);

  // Golden history
  const goldenHistoryRunCount = countGoldenHistoryRuns(input.goldenHistory);
  const hasGoldenHistory = goldenHistoryRunCount !== null && goldenHistoryRunCount > 0;

  // Import intelligence profile
  const hasImportProfile = profile != null;
  const importProfileCategory = pickString([read(profile, ['profileCategory'])]);
  const importRiskLevel = pickString([read(profile, ['riskLevel'])]);
  const importProfileGeneratedAt = pickString([read(profile, ['generatedAt'])]);

  // Repair pattern analysis
  const hasRepairPatternAnalysis = pattern != null;
  const primaryRepairPatternId = pickString([read(pattern, ['primaryPatternId'])]);
  const repairPatternSeverity = pickString([read(pattern, ['overallSeverity'])]);
  const repairPatternGeneratedAt = pickString([read(pattern, ['generatedAt'])]);

  // Adaptive reconciliation policy
  const hasAdaptiveReconciliationPolicy = policy != null;
  const adaptiveDecision = pickString([read(policy, ['decision'])]);
  const adaptiveAiBlocked = coercePdfImportPerformanceBoolean(read(policy, ['flags', 'aiBlocked']));
  const adaptiveGeneratedAt = pickString([read(policy, ['generatedAt'])]);

  // Self-healing audit
  const hasSelfHealingAudit = selfHealing != null;
  const selfHealingStatus = pickString([read(selfHealing, ['status'])]);
  const selfHealingGeneratedAt = pickString([read(selfHealing, ['generatedAt'])]);
  const selfHealingExecutedAt = pickString([read(selfHealing, ['executedAt'])]);

  // PDF import job
  const pdfJobDurationMs = pickNumber([read(input.pdfImportJob, ['duration_ms']), read(input.pdfImportJob, ['durationMs'])]);
  const pdfJobStatus = pickString([read(input.pdfImportJob, ['status'])]);
  const pdfJobFailedRaw = coercePdfImportPerformanceBoolean(read(input.pdfImportJob, ['failed']));
  const pdfJobFailed = pdfJobFailedRaw !== null
    ? pdfJobFailedRaw
    : (pdfJobStatus !== null ? pdfJobStatus === 'failed' : null);

  // Artifact paths
  const { artifactPathCount, missingArtifactPathCount } = countKnownArtifactPaths({
    snapshot, record: input.record,
  });

  // Warnings / failures
  const { warningCount, failureCount } = countWarningsAndFailures({
    goldenRegressionSummary: golden,
    selfHealingRetryAudit: selfHealing,
    repairPatternAnalysis: pattern,
    adaptiveReconciliationPolicy: policy,
    importIntelligenceProfile: profile,
  });

  const signals: PdfImportPerformanceSignals = {
    importId,
    templateId,
    sourceFilename,
    importStatus,
    pageCount,
    engineVersion,
    hasVisualQuality,
    visualQaScore,
    visualQaGeneratedAt,
    hasRepairAudit,
    repairStatus,
    repairFinalScore,
    repairGeneratedAt,
    hasExportParity,
    exportParityStatus,
    exportVsSourceScore,
    exportParityGeneratedAt,
    hasGoldenRegression,
    goldenQualityGateStatus,
    goldenGeneratedAt,
    goldenPersistedAt,
    hasGoldenHistory,
    goldenHistoryRunCount,
    hasImportProfile,
    importProfileCategory,
    importRiskLevel,
    importProfileGeneratedAt,
    hasRepairPatternAnalysis,
    primaryRepairPatternId,
    repairPatternSeverity,
    repairPatternGeneratedAt,
    hasAdaptiveReconciliationPolicy,
    adaptiveDecision,
    adaptiveAiBlocked,
    adaptiveGeneratedAt,
    hasSelfHealingAudit,
    selfHealingStatus,
    selfHealingGeneratedAt,
    selfHealingExecutedAt,
    pdfJobDurationMs,
    pdfJobStatus,
    pdfJobFailed,
    artifactPathCount,
    missingArtifactPathCount,
    warningCount,
    failureCount,
  };

  // Evidence + warnings
  if (!hasVisualQuality) addWarning('missing_visual_quality');
  if (!hasRepairAudit) addWarning('missing_repair_audit');
  if (!hasExportParity) addWarning('missing_export_parity');
  if (!hasImportProfile) addWarning('missing_profile');
  if (!hasRepairPatternAnalysis) addWarning('missing_repair_pattern');
  if (!hasAdaptiveReconciliationPolicy) addWarning('missing_adaptive_policy');
  if (!hasSelfHealingAudit) addWarning('missing_self_healing_audit');

  if (importStatus === 'completed' && !engineVersion) {
    addWarning('missing_engine_version');
    addEvidence({ code: 'missing_engine_version', label: 'Engine version', value: null, weight: 0.2,
      message: 'Completed import has no engine version recorded.' });
  }

  if (pdfJobDurationMs !== null && pdfJobDurationMs > LONG_RUNNING_JOB_MS) {
    addWarning('long_running_pdf_job');
    addEvidence({ code: 'long_running_pdf_job', label: 'PDF job duration', value: pdfJobDurationMs, weight: 0.5,
      message: `PDF import job ran for ${pdfJobDurationMs} ms (> ${LONG_RUNNING_JOB_MS} ms).` });
  }

  if (goldenHistoryRunCount !== null && goldenHistoryRunCount > 20) {
    addWarning('repeated_golden_history_runs');
    addEvidence({ code: 'repeated_golden_history_runs', label: 'Golden history runs', value: goldenHistoryRunCount, weight: 0.5,
      message: `Golden history has ${goldenHistoryRunCount} recorded runs.` });
  }

  if (missingArtifactPathCount > 0 && importStatus === 'completed') {
    addEvidence({ code: 'missing_artifact_paths', label: 'Missing artifact paths', value: missingArtifactPathCount, weight: 0.3,
      message: `${missingArtifactPathCount} expected artifact path(s) are missing for a completed import.` });
  }

  // Blockers
  if (!importId) addBlocker('import_id_missing');
  if (importStatus === 'failed' || pdfJobFailed === true) addBlocker('import_failed');
  if (importStatus === 'completed' && !templateId) addBlocker('missing_template_for_completed_import');

  return { signals, evidence, warnings, blockers };
}
