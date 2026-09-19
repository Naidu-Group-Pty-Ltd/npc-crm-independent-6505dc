/**
 * goldenCorpusOrchestrator — Phase 9A.
 *
 * Single operational entry point for the post-import golden regression chain.
 * Pure core (`orchestrateGoldenCorpusRunFromSnapshot`) does no network I/O; the
 * async wrapper (`orchestrateGoldenCorpusRun`) loads the snapshot and optionally
 * persists the summary. Wires Phase 8B (run eval) → 8C (gates) → 8D (summary) →
 * 8F (triage) → 8D persistence.
 */
import { getGoldenCorpusItem } from './goldenCorpusRegistry';
import { evaluateGoldenCorpusRun } from './goldenCorpusRunEvaluator';
import { buildGoldenRegressionSummary } from './goldenRegressionSummary';
import { saveGoldenRegressionSummary } from './goldenRegressionPersistence';
import { loadGoldenCorpusImportQualitySnapshot } from './goldenCorpusImportSnapshot';
import { buildGoldenRunHistoryRecordInput } from './goldenRunHistorySummary';
import {
  getLatestGoldenRunBaselines,
  saveGoldenRunHistory,
} from './goldenRunHistoryPersistence';
import { compareGoldenRunToBaseline } from './goldenRunBaselineComparison';
import { runExportParityAutomation } from '../exportParity/exportParityRunner';
import {
  buildImportIntelligenceProfile,
  saveImportIntelligenceProfile,
} from '../importIntelligence';
import {
  buildRepairPatternAnalysis,
  saveRepairPatternAnalysis,
} from '../repairPatterns';
import {
  buildAdaptiveReconciliationPolicy,
  saveAdaptiveReconciliationPolicy,
} from '../reconciliation';
import {
  buildSelfHealingRetryPlan,
  executeSelfHealingRetryPlan,
  saveSelfHealingRetryAudit,
} from '../selfHealing';
import {
  buildPdfImportPerformanceCostAudit,
  savePdfImportPerformanceAudit,
} from '../performance';
import {
  buildProductionOperatorControlAudit,
  loadProductionOperatorControlAudit,
  saveProductionOperatorControlAudit,
} from '../operatorControls';
import { evaluatePdfImportQualityGates } from '../qualityGates/pdfImportQualityGateEvaluator';
import {
  evaluatePdfImportFailureTriage,
  extractFailureSignalsFromGoldenRegression,
} from '../failureTriage/pdfImportFailureTriageEvaluator';
import type {
  GoldenCorpusImportQualitySnapshot,
  GoldenCorpusRunEvaluation,
  GoldenCorpusRunReference,
} from './goldenCorpusRunTypes';
import type { PdfImportQualityGateReport } from '../qualityGates/pdfImportQualityGateTypes';
import type { PdfImportFailureTriageSummary } from '../failureTriage/pdfImportFailureTriageTypes';
import type { SaveGoldenRegressionSummaryResult } from './goldenRegressionTypes';
import type { GoldenRunHistoryRecord } from './goldenRunHistoryTypes';
import type { ExportParityRunnerResult } from '../exportParity/exportParityRunnerTypes';
import {
  GOLDEN_CORPUS_ORCHESTRATOR_VERSION,
  type GoldenCorpusOrchestratorMode,
  type GoldenCorpusOrchestratorOptions,
  type GoldenCorpusOrchestratorRequest,
  type GoldenCorpusOrchestratorResult,
  type GoldenCorpusOrchestratorStatus,
  type GoldenCorpusOrchestratorStep,
  type GoldenCorpusOrchestratorStepId,
  type GoldenCorpusOrchestratorStepStatus,
} from './goldenCorpusOrchestratorTypes';

const STEP_LABELS: Record<GoldenCorpusOrchestratorStepId, string> = {
  validate_input: 'Validate input',
  load_snapshot: 'Load import snapshot',
  run_export_parity: 'Run export parity automation',
  evaluate_run: 'Evaluate golden run',
  evaluate_quality_gates: 'Evaluate quality gates',
  build_summary: 'Build regression summary',
  evaluate_triage: 'Evaluate failure triage',
  load_baseline: 'Load baseline run',
  compare_baseline: 'Compare to baseline',
  persist_summary: 'Persist regression summary',
  save_history: 'Save run history',
  build_import_intelligence_profile: 'Build import intelligence profile',
  persist_import_intelligence_profile: 'Persist import intelligence profile',
  build_repair_pattern_analysis: 'Build repair pattern analysis',
  persist_repair_pattern_analysis: 'Persist repair pattern analysis',
  build_adaptive_reconciliation_policy: 'Build adaptive reconciliation policy',
  persist_adaptive_reconciliation_policy: 'Persist adaptive reconciliation policy',
  build_self_healing_plan: 'Build self-healing retry plan',
  execute_self_healing_plan: 'Execute self-healing retry plan',
  persist_self_healing_audit: 'Persist self-healing audit',
  build_performance_cost_audit: 'Build performance/cost audit',
  persist_performance_cost_audit: 'Persist performance/cost audit',
  build_operator_controls: 'Build production operator controls',
  persist_operator_control_audit: 'Persist operator control audit',
};

const PURE_STEP_ORDER: GoldenCorpusOrchestratorStepId[] = [
  'validate_input',
  'evaluate_run',
  'evaluate_quality_gates',
  'build_summary',
  'evaluate_triage',
  'persist_summary',
];

export function createGoldenCorpusOrchestratorStep(
  id: GoldenCorpusOrchestratorStepId,
  status: GoldenCorpusOrchestratorStepStatus,
  message: string,
  details?: Record<string, unknown>,
): GoldenCorpusOrchestratorStep {
  return { id, status, label: STEP_LABELS[id], message, details };
}

const skippedStep = (id: GoldenCorpusOrchestratorStepId, message = 'Skipped.') =>
  createGoldenCorpusOrchestratorStep(id, 'skipped', message);

function uniq(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) if (v && !out.includes(v)) out.push(v);
  return out;
}

/** Deterministic-with-`now` golden run id. Only the timestamp is sanitized. */
export function buildGoldenCorpusRunId(input: {
  corpusId: string;
  importId: string;
  now?: () => Date;
}): string {
  const ts = (input.now ?? (() => new Date()))().toISOString().replace(/[^a-zA-Z0-9_-]/g, '-');
  return `golden-run-${input.corpusId}-${input.importId}-${ts}`;
}

export function resolveGoldenCorpusOrchestratorStatus(input: {
  runEvaluation: GoldenCorpusRunEvaluation | null;
  qualityGateReport: PdfImportQualityGateReport | null;
  triageSummary: PdfImportFailureTriageSummary | null;
  persistenceResult: SaveGoldenRegressionSummaryResult | null;
  persistRequested: boolean;
  warnings: string[];
  failures: string[];
}): GoldenCorpusOrchestratorStatus {
  const { qualityGateReport, triageSummary, persistenceResult, persistRequested, warnings } = input;

  if (persistRequested && persistenceResult && persistenceResult.kind === 'error') return 'failed';

  if (qualityGateReport) {
    if (qualityGateReport.overallStatus === 'blocked') return 'blocked';
    if (qualityGateReport.overallStatus === 'fail') return 'failed';
  }
  if (triageSummary?.outcome === 'escalate') return 'failed';
  if (triageSummary?.outcome === 'blocked') return 'blocked';
  if (qualityGateReport?.overallStatus === 'warning') return 'completed_with_warnings';
  if (warnings.length > 0) return 'completed_with_warnings';
  return 'completed';
}

/** Base result skeleton with sensible nulls. */
function baseResult(
  request: GoldenCorpusOrchestratorRequest,
  generatedAt: string,
): GoldenCorpusOrchestratorResult {
  return {
    version: GOLDEN_CORPUS_ORCHESTRATOR_VERSION,
    mode: 'evaluate_only',
    status: 'not_evaluated',
    corpusId: request.corpusId || null,
    importId: request.importId || null,
    templateId: request.templateId ?? null,
    runId: request.runId ?? null,
    runBatchId: request.runBatchId ?? null,
    steps: [],
    runEvaluation: null,
    qualityGateReport: null,
    goldenRegressionSummary: null,
    triageSummary: null,
    persistenceResult: null,
    persisted: false,
    exportParityRunnerResult: null,
    baselineComparison: null,
    historyPersistenceResult: null,
    historyRecord: null,
    historySaved: false,
    importIntelligenceProfile: null,
    importIntelligencePersistenceResult: null,
    repairPatternAnalysis: null,
    repairPatternPersistenceResult: null,
    adaptiveReconciliationPolicy: null,
    adaptiveReconciliationPolicyPersistenceResult: null,
    selfHealingRetryAudit: null,
    selfHealingRetryAuditPersistenceResult: null,
    performanceCostAudit: null,
    performanceCostAuditPersistenceResult: null,
    productionOperatorControlAudit: null,
    productionOperatorControlAuditPersistenceResult: null,
    warnings: [],
    failures: [],
    generatedAt,
  };
}

/** All pure steps skipped except the given anchor step (used for early returns). */
function skippedRest(except: GoldenCorpusOrchestratorStepId): GoldenCorpusOrchestratorStep[] {
  return PURE_STEP_ORDER.filter((id) => id !== except).map((id) => skippedStep(id));
}

function stepStatusFromDecision(decision: string): GoldenCorpusOrchestratorStepStatus {
  if (decision === 'pass') return 'pass';
  if (decision === 'fail') return 'fail';
  return 'warning'; // warning | not_evaluated
}

function stepStatusFromGate(overall: string): GoldenCorpusOrchestratorStepStatus {
  if (overall === 'pass') return 'pass';
  if (overall === 'fail') return 'fail';
  if (overall === 'blocked') return 'blocked';
  return 'warning'; // warning | not_evaluated
}

function stepStatusFromTriage(outcome: string): GoldenCorpusOrchestratorStepStatus {
  if (outcome === 'resolved') return 'pass';
  if (outcome === 'blocked') return 'blocked';
  if (outcome === 'escalate') return 'fail';
  return 'warning'; // monitor | action_required
}

/**
 * Pure orchestration from an already-loaded snapshot. No network; never persists
 * (persist_summary is always skipped here).
 */
export function orchestrateGoldenCorpusRunFromSnapshot(options: {
  request: GoldenCorpusOrchestratorRequest;
  snapshot: GoldenCorpusImportQualitySnapshot;
  now?: () => Date;
}): GoldenCorpusOrchestratorResult {
  const { request, snapshot } = options;
  const now = options.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const result = baseResult(request, generatedAt);

  // 1. validate_input
  const corpusId = typeof request.corpusId === 'string' ? request.corpusId.trim() : '';
  if (!corpusId) {
    result.status = 'failed';
    result.failures = ['input_missing_corpus_id'];
    result.steps = [
      createGoldenCorpusOrchestratorStep('validate_input', 'fail', 'corpusId is required.'),
      ...skippedRest('validate_input'),
    ];
    return result;
  }

  const effectiveImportId =
    (typeof request.importId === 'string' && request.importId.trim()) || snapshot.importId || '';
  if (!effectiveImportId) {
    result.status = 'not_evaluated';
    result.warnings = ['input_missing_import_id'];
    result.steps = [
      createGoldenCorpusOrchestratorStep('validate_input', 'warning', 'importId is required to evaluate.'),
      ...skippedRest('validate_input'),
    ];
    return result;
  }

  const corpus = getGoldenCorpusItem(corpusId);
  if (!corpus) {
    result.status = 'failed';
    result.corpusId = corpusId;
    result.failures = ['unknown_corpus_id'];
    result.steps = [
      createGoldenCorpusOrchestratorStep('validate_input', 'fail', `Unknown golden corpus ID: ${corpusId}`),
      ...skippedRest('validate_input'),
    ];
    return result;
  }

  const effectiveTemplateId = request.templateId ?? snapshot.templateId ?? null;
  const effectiveSourceFilename = request.sourceFilename ?? snapshot.sourceFilename ?? null;
  const runId = (typeof request.runId === 'string' && request.runId.trim())
    || buildGoldenCorpusRunId({ corpusId, importId: effectiveImportId, now });

  result.corpusId = corpusId;
  result.importId = effectiveImportId;
  result.templateId = effectiveTemplateId;
  result.runId = runId;
  result.runBatchId = request.runBatchId ?? null;

  const steps: GoldenCorpusOrchestratorStep[] = [
    createGoldenCorpusOrchestratorStep('validate_input', 'pass', 'Input validated.'),
  ];

  const effectiveSnapshot: GoldenCorpusImportQualitySnapshot = {
    ...snapshot,
    importId: effectiveImportId,
    templateId: effectiveTemplateId,
    sourceFilename: effectiveSourceFilename,
  };

  const run: GoldenCorpusRunReference = {
    runId,
    corpusId,
    sourceFilename: effectiveSourceFilename,
    importId: effectiveImportId,
    templateId: effectiveTemplateId,
    notes: request.notes && request.notes.length ? request.notes.join('; ') : null,
  };

  const finalize = (
    status: GoldenCorpusOrchestratorStatus,
    extraFailures: string[] = [],
    extraWarnings: string[] = [],
  ) => {
    result.steps = steps;
    result.warnings = uniq([
      ...(result.runEvaluation?.warnings ?? []),
      ...(result.goldenRegressionSummary?.warnings ?? []),
      ...extraWarnings,
    ]);
    result.failures = uniq([
      ...(result.runEvaluation?.failures ?? []),
      ...(result.goldenRegressionSummary?.failures ?? []),
      ...extraFailures,
    ]);
    result.status = status;
    return result;
  };

  // 5. evaluate_run
  let runEvaluation: GoldenCorpusRunEvaluation;
  try {
    runEvaluation = evaluateGoldenCorpusRun({ run, snapshot: effectiveSnapshot, now });
  } catch (err) {
    steps.push(createGoldenCorpusOrchestratorStep('evaluate_run', 'fail', (err as Error).message));
    steps.push(...skippedRest('validate_input').filter((s) => s.id !== 'evaluate_run'));
    return finalize('failed', ['run_evaluation_failed']);
  }
  result.runEvaluation = runEvaluation;
  steps.push(createGoldenCorpusOrchestratorStep('evaluate_run', stepStatusFromDecision(runEvaluation.decision),
    `Run decision: ${runEvaluation.decision}.`));

  // 6. evaluate_quality_gates
  let qualityGateReport: PdfImportQualityGateReport;
  try {
    qualityGateReport = evaluatePdfImportQualityGates({ evaluation: runEvaluation, now });
  } catch (err) {
    steps.push(createGoldenCorpusOrchestratorStep('evaluate_quality_gates', 'fail', (err as Error).message));
    steps.push(skippedStep('build_summary'), skippedStep('evaluate_triage'), skippedStep('persist_summary'));
    return finalize('failed', ['quality_gate_evaluation_failed']);
  }
  result.qualityGateReport = qualityGateReport;
  steps.push(createGoldenCorpusOrchestratorStep('evaluate_quality_gates', stepStatusFromGate(qualityGateReport.overallStatus),
    `Quality gate: ${qualityGateReport.overallStatus}.`));

  // 7. build_summary
  let summary;
  try {
    summary = buildGoldenRegressionSummary({
      runEvaluation,
      qualityGateReport,
      summaryOptions: {
        runBatchId: request.runBatchId ?? null,
        operatorDecision: request.operatorDecision,
        notes: request.notes ?? [],
        now,
      },
    });
  } catch (err) {
    steps.push(createGoldenCorpusOrchestratorStep('build_summary', 'fail', (err as Error).message));
    steps.push(skippedStep('evaluate_triage'), skippedStep('persist_summary'));
    return finalize('failed', ['summary_build_failed']);
  }
  result.goldenRegressionSummary = summary;
  steps.push(createGoldenCorpusOrchestratorStep('build_summary', 'pass', 'Golden regression summary built.'));

  // 8. evaluate_triage (never fails the whole run)
  const extraWarnings: string[] = [];
  try {
    const signals = extractFailureSignalsFromGoldenRegression({
      warnings: summary.warnings,
      failures: summary.failures,
      qualityGateStatus: summary.qualityGateStatus,
      operatorDecision: summary.operatorDecision,
    });
    const triageSummary = evaluatePdfImportFailureTriage({ signals, now });
    result.triageSummary = triageSummary;
    steps.push(createGoldenCorpusOrchestratorStep('evaluate_triage', stepStatusFromTriage(triageSummary.outcome),
      `Triage outcome: ${triageSummary.outcome}.`));
  } catch (err) {
    result.triageSummary = null;
    extraWarnings.push('triage_evaluation_failed');
    steps.push(createGoldenCorpusOrchestratorStep('evaluate_triage', 'warning', (err as Error).message));
  }

  // 9. persist_summary — always skipped in the pure function.
  steps.push(skippedStep('persist_summary', 'Persistence skipped in pure snapshot orchestration.'));

  // 11. status
  const status = resolveGoldenCorpusOrchestratorStatus({
    runEvaluation,
    qualityGateReport,
    triageSummary: result.triageSummary,
    persistenceResult: null,
    persistRequested: false,
    warnings: uniq([...(runEvaluation.warnings ?? []), ...(summary.warnings ?? []), ...extraWarnings]),
    failures: uniq([...(runEvaluation.failures ?? []), ...(summary.failures ?? [])]),
  });

  return finalize(status, [], extraWarnings);
}

/** Insert `step` immediately after `validate_input` (i.e. the load_snapshot slot). */
function withLoadSnapshotStep(
  steps: GoldenCorpusOrchestratorStep[],
  step: GoldenCorpusOrchestratorStep,
): GoldenCorpusOrchestratorStep[] {
  if (steps.length === 0) return [step];
  return [steps[0], step, ...steps.slice(1)];
}

function replaceStep(
  steps: GoldenCorpusOrchestratorStep[],
  step: GoldenCorpusOrchestratorStep,
): GoldenCorpusOrchestratorStep[] {
  const idx = steps.findIndex((s) => s.id === step.id);
  if (idx < 0) return [...steps, step];
  const copy = [...steps];
  copy[idx] = step;
  return copy;
}

/** Insert `step` immediately before the step with `beforeId` (append if absent). */
function insertBeforeStep(
  steps: GoldenCorpusOrchestratorStep[],
  beforeId: GoldenCorpusOrchestratorStepId,
  step: GoldenCorpusOrchestratorStep,
): GoldenCorpusOrchestratorStep[] {
  const idx = steps.findIndex((s) => s.id === beforeId);
  if (idx < 0) return [...steps, step];
  return [...steps.slice(0, idx), step, ...steps.slice(idx)];
}

/** Insert `step` immediately after the step with `afterId` (append if absent). */
function insertAfterStep(
  steps: GoldenCorpusOrchestratorStep[],
  afterId: GoldenCorpusOrchestratorStepId,
  step: GoldenCorpusOrchestratorStep,
): GoldenCorpusOrchestratorStep[] {
  const idx = steps.findIndex((s) => s.id === afterId);
  if (idx < 0) return [...steps, step];
  return [...steps.slice(0, idx + 1), step, ...steps.slice(idx + 1)];
}

function baselineStepStatus(outcome: string): GoldenCorpusOrchestratorStepStatus {
  if (outcome === 'improved' || outcome === 'stable') return 'pass';
  return 'warning'; // degraded | no_baseline | unknown
}

/** Build a temporary "current" history record for baseline comparison. */
function buildCurrentHistoryRecord(
  result: GoldenCorpusOrchestratorResult,
): GoldenRunHistoryRecord {
  const input = buildGoldenRunHistoryRecordInput({
    goldenRegressionSummary: result.goldenRegressionSummary!,
    triageSummary: result.triageSummary,
    orchestratorVersion: result.version,
    baselineComparison: null,
  });
  return {
    ...input,
    id: 'current',
    createdBy: null,
    createdAt: result.generatedAt,
    updatedAt: result.generatedAt,
  };
}

/**
 * Phase 9C baseline phase (async-only): loads the latest baseline for the corpus
 * and compares the current run. Inserts `load_baseline` / `compare_baseline`
 * steps before `persist_summary`. Non-blocking — failures surface as warnings.
 */
async function applyBaselineComparePhase(
  result: GoldenCorpusOrchestratorResult,
  request: GoldenCorpusOrchestratorRequest,
): Promise<void> {
  const summary = result.goldenRegressionSummary;
  const corpusId = result.corpusId ?? (request.corpusId || null);
  const insert = (step: GoldenCorpusOrchestratorStep) => {
    result.steps = insertBeforeStep(result.steps, 'persist_summary', step);
  };
  const addWarning = (code: string) => { result.warnings = uniq([...result.warnings, code]); };

  let baseline: GoldenRunHistoryRecord | null = null;
  let baselineLoadFailed = false;
  if (!corpusId) {
    insert(skippedStep('load_baseline', 'No corpus ID to load a baseline.'));
  } else {
    const res = await getLatestGoldenRunBaselines(corpusId);
    if (res.kind === 'error') {
      baselineLoadFailed = true;
      addWarning('baseline_load_failed');
      insert(createGoldenCorpusOrchestratorStep('load_baseline', 'warning', res.message));
    } else {
      baseline = res.baselines.find((b) => b.corpusId === corpusId) ?? res.baselines[0] ?? null;
      insert(createGoldenCorpusOrchestratorStep(
        'load_baseline',
        baseline ? 'pass' : 'warning',
        baseline ? `Baseline run ${baseline.runId} loaded.` : 'No previous baseline run found.',
      ));
    }
  }

  if (!summary) {
    insert(skippedStep('compare_baseline', 'No summary to compare.'));
    return;
  }
  if (baselineLoadFailed) {
    // A load failure is distinct from "no baseline" — do not fabricate a comparison.
    insert(skippedStep('compare_baseline', 'Baseline unavailable (load failed).'));
    return;
  }

  const comparison = compareGoldenRunToBaseline({ previous: baseline, current: buildCurrentHistoryRecord(result) });
  result.baselineComparison = comparison;
  insert(createGoldenCorpusOrchestratorStep(
    'compare_baseline',
    baselineStepStatus(comparison.outcome),
    `Baseline outcome: ${comparison.outcome}.`,
    { outcome: comparison.outcome, messages: comparison.messages },
  ));
  if (comparison.outcome === 'no_baseline') addWarning('no_baseline_found');
  if (comparison.outcome === 'degraded') addWarning('baseline_regression_detected');
}

/**
 * Phase 9C save phase (async-only): appends a history row to the ledger. Adds a
 * `save_history` step at the end. A save failure fails the run (the operator
 * explicitly requested a history write).
 */
async function applySaveHistoryPhase(
  result: GoldenCorpusOrchestratorResult,
): Promise<void> {
  const summary = result.goldenRegressionSummary;
  const append = (step: GoldenCorpusOrchestratorStep) => { result.steps = [...result.steps, step]; };

  if (!summary) {
    append(createGoldenCorpusOrchestratorStep('save_history', 'fail', 'No summary to save to history.'));
    result.failures = uniq([...result.failures, 'history_summary_missing']);
    result.status = 'failed';
    return;
  }

  const input = buildGoldenRunHistoryRecordInput({
    goldenRegressionSummary: summary,
    triageSummary: result.triageSummary,
    orchestratorVersion: result.version,
    baselineComparison: result.baselineComparison,
  });
  const res = await saveGoldenRunHistory(input);
  result.historyPersistenceResult = res;
  if (res.kind === 'ok') {
    result.historySaved = true;
    result.historyRecord = res.history;
    append(createGoldenCorpusOrchestratorStep('save_history', 'pass', 'Golden run history saved.'));
  } else {
    result.historySaved = false;
    append(createGoldenCorpusOrchestratorStep('save_history', 'fail', res.message));
    result.failures = uniq([...result.failures, 'history_persistence_failed']);
    result.status = 'failed';
  }
}

/**
 * Phase 10B phase (async-only): builds the deterministic import intelligence
 * profile from the snapshot and optionally persists it via `append_meta`. The
 * build step is inserted after `run_export_parity`; the persist step is appended
 * at the end. Non-gating: a build/persist problem only adds a warning — it never
 * invalidates the golden regression result.
 */
async function applyImportIntelligencePhase(
  result: GoldenCorpusOrchestratorResult,
  request: GoldenCorpusOrchestratorRequest,
  snapshot: GoldenCorpusImportQualitySnapshot,
  now: () => Date,
): Promise<void> {
  const insertBuild = (step: GoldenCorpusOrchestratorStep) => {
    result.steps = insertAfterStep(result.steps, 'run_export_parity', step);
  };
  const appendPersist = (step: GoldenCorpusOrchestratorStep) => {
    result.steps = [...result.steps, step];
  };
  const addWarning = (code: string) => { result.warnings = uniq([...result.warnings, code]); };

  if (request.buildImportIntelligenceProfile !== true) {
    insertBuild(skippedStep('build_import_intelligence_profile', 'Import intelligence profile not requested.'));
    appendPersist(skippedStep('persist_import_intelligence_profile', 'Import intelligence profile not requested.'));
    return;
  }

  let profile;
  try {
    profile = buildImportIntelligenceProfile({
      importId: result.importId ?? request.importId,
      templateId: result.templateId ?? request.templateId ?? snapshot.templateId,
      sourceFilename: request.sourceFilename ?? snapshot.sourceFilename,
      snapshot,
      goldenRegressionSummary: result.goldenRegressionSummary ?? undefined,
      now,
    });
  } catch (err) {
    result.importIntelligenceProfile = null;
    insertBuild(createGoldenCorpusOrchestratorStep('build_import_intelligence_profile', 'fail', (err as Error).message));
    appendPersist(skippedStep('persist_import_intelligence_profile', 'Profile unavailable (build failed).'));
    addWarning('import_intelligence_build_failed');
    return;
  }

  result.importIntelligenceProfile = profile;
  const buildStepStatus: GoldenCorpusOrchestratorStepStatus =
    profile.blockers.length > 0 || profile.warnings.length > 0 ? 'warning' : 'pass';
  insertBuild(createGoldenCorpusOrchestratorStep(
    'build_import_intelligence_profile',
    buildStepStatus,
    `Import profile: ${profile.profileCategory} (${profile.riskLevel}).`,
    { category: profile.profileCategory, riskLevel: profile.riskLevel, blockers: profile.blockers },
  ));

  if (request.persistImportIntelligenceProfile !== true) {
    appendPersist(skippedStep('persist_import_intelligence_profile', 'Persistence not requested.'));
    return;
  }

  const importId = (result.importId ?? '').trim();
  if (!importId) {
    appendPersist(createGoldenCorpusOrchestratorStep(
      'persist_import_intelligence_profile', 'warning', 'No importId to persist the profile.'));
    addWarning('import_intelligence_persist_skipped_no_import_id');
    return;
  }

  const saveRes = await saveImportIntelligenceProfile(importId, profile);
  result.importIntelligencePersistenceResult = saveRes;
  if (saveRes.kind === 'ok') {
    appendPersist(createGoldenCorpusOrchestratorStep(
      'persist_import_intelligence_profile', 'pass', 'Import intelligence profile persisted.'));
  } else {
    appendPersist(createGoldenCorpusOrchestratorStep(
      'persist_import_intelligence_profile', 'fail', saveRes.message));
    addWarning('import_intelligence_persistence_failed');
  }
}

/**
 * Phase 10C phase (async-only): builds the deterministic repair pattern analysis
 * from the snapshot, import intelligence profile, and quality-gate/triage output,
 * and optionally persists it via `append_meta`. The build step is inserted after
 * `build_import_intelligence_profile`; the persist step is appended at the end.
 * Advisory and non-gating: a problem only adds a warning, never applies repairs.
 */
async function applyRepairPatternPhase(
  result: GoldenCorpusOrchestratorResult,
  request: GoldenCorpusOrchestratorRequest,
  snapshot: GoldenCorpusImportQualitySnapshot,
  now: () => Date,
): Promise<void> {
  const insertBuild = (step: GoldenCorpusOrchestratorStep) => {
    result.steps = insertAfterStep(result.steps, 'build_import_intelligence_profile', step);
  };
  const appendPersist = (step: GoldenCorpusOrchestratorStep) => {
    result.steps = [...result.steps, step];
  };
  const addWarning = (code: string) => { result.warnings = uniq([...result.warnings, code]); };

  if (request.buildRepairPatternAnalysis !== true) {
    insertBuild(skippedStep('build_repair_pattern_analysis', 'Repair pattern analysis not requested.'));
    appendPersist(skippedStep('persist_repair_pattern_analysis', 'Repair pattern analysis not requested.'));
    return;
  }

  let analysis;
  try {
    analysis = buildRepairPatternAnalysis({
      importId: result.importId ?? request.importId,
      templateId: result.templateId ?? request.templateId ?? snapshot.templateId,
      sourceFilename: request.sourceFilename ?? snapshot.sourceFilename,
      snapshot,
      importIntelligenceProfile: result.importIntelligenceProfile,
      goldenRegressionSummary: result.goldenRegressionSummary ?? undefined,
      qualityGateReport: result.qualityGateReport ?? undefined,
      triageSummary: result.triageSummary ?? undefined,
      now,
    });
  } catch (err) {
    result.repairPatternAnalysis = null;
    insertBuild(createGoldenCorpusOrchestratorStep('build_repair_pattern_analysis', 'fail', (err as Error).message));
    appendPersist(skippedStep('persist_repair_pattern_analysis', 'Analysis unavailable (build failed).'));
    addWarning('repair_pattern_build_failed');
    return;
  }

  result.repairPatternAnalysis = analysis;
  const buildStepStatus: GoldenCorpusOrchestratorStepStatus =
    analysis.blockers.length > 0 || analysis.matchedPatterns.length === 0 || analysis.warnings.length > 0
      ? 'warning'
      : 'pass';
  insertBuild(createGoldenCorpusOrchestratorStep(
    'build_repair_pattern_analysis',
    buildStepStatus,
    `Repair patterns: ${analysis.primaryPatternId ?? 'none'} (${analysis.overallSeverity}).`,
    {
      primaryPatternId: analysis.primaryPatternId,
      overallSeverity: analysis.overallSeverity,
      deterministicRepairStrategy: analysis.deterministicRepairStrategy,
      matchedCount: analysis.matchedPatterns.length,
    },
  ));

  if (request.persistRepairPatternAnalysis !== true) {
    appendPersist(skippedStep('persist_repair_pattern_analysis', 'Persistence not requested.'));
    return;
  }

  const importId = (result.importId ?? '').trim();
  if (!importId) {
    appendPersist(createGoldenCorpusOrchestratorStep(
      'persist_repair_pattern_analysis', 'warning', 'No importId to persist the analysis.'));
    addWarning('repair_pattern_persist_skipped_no_import_id');
    return;
  }

  const saveRes = await saveRepairPatternAnalysis(importId, analysis);
  result.repairPatternPersistenceResult = saveRes;
  if (saveRes.kind === 'ok') {
    appendPersist(createGoldenCorpusOrchestratorStep(
      'persist_repair_pattern_analysis', 'pass', 'Repair pattern analysis persisted.'));
  } else {
    appendPersist(createGoldenCorpusOrchestratorStep(
      'persist_repair_pattern_analysis', 'fail', saveRes.message));
    addWarning('repair_pattern_persistence_failed');
  }
}

/**
 * Phase 10D phase (async-only): builds the deterministic adaptive reconciliation
 * policy from the snapshot, import intelligence profile, repair pattern analysis,
 * quality-gate report, triage, and golden summary, and optionally persists it via
 * `append_meta`. The build step is inserted after `build_repair_pattern_analysis`;
 * the persist step is appended at the end. Governance only — it never calls AI or
 * applies reconciliation. Non-gating: a problem only adds a warning.
 */
async function applyAdaptiveReconciliationPhase(
  result: GoldenCorpusOrchestratorResult,
  request: GoldenCorpusOrchestratorRequest,
  snapshot: GoldenCorpusImportQualitySnapshot,
  now: () => Date,
): Promise<void> {
  const insertBuild = (step: GoldenCorpusOrchestratorStep) => {
    result.steps = insertAfterStep(result.steps, 'build_repair_pattern_analysis', step);
  };
  const appendPersist = (step: GoldenCorpusOrchestratorStep) => {
    result.steps = [...result.steps, step];
  };
  const addWarning = (code: string) => { result.warnings = uniq([...result.warnings, code]); };

  if (request.buildAdaptiveReconciliationPolicy !== true) {
    insertBuild(skippedStep('build_adaptive_reconciliation_policy', 'Adaptive reconciliation policy not requested.'));
    appendPersist(skippedStep('persist_adaptive_reconciliation_policy', 'Adaptive reconciliation policy not requested.'));
    return;
  }

  let policy;
  try {
    policy = buildAdaptiveReconciliationPolicy({
      importId: result.importId ?? request.importId,
      templateId: result.templateId ?? request.templateId ?? snapshot.templateId,
      sourceFilename: request.sourceFilename ?? snapshot.sourceFilename,
      snapshot,
      importIntelligenceProfile: result.importIntelligenceProfile,
      repairPatternAnalysis: result.repairPatternAnalysis,
      goldenRegressionSummary: result.goldenRegressionSummary ?? undefined,
      qualityGateReport: result.qualityGateReport ?? undefined,
      triageSummary: result.triageSummary ?? undefined,
      now,
    });
  } catch (err) {
    result.adaptiveReconciliationPolicy = null;
    insertBuild(createGoldenCorpusOrchestratorStep('build_adaptive_reconciliation_policy', 'fail', (err as Error).message));
    appendPersist(skippedStep('persist_adaptive_reconciliation_policy', 'Policy unavailable (build failed).'));
    addWarning('adaptive_reconciliation_policy_build_failed');
    return;
  }

  result.adaptiveReconciliationPolicy = policy;
  const buildStepStatus: GoldenCorpusOrchestratorStepStatus =
    policy.decision === 'blocked'
      ? 'blocked'
      : policy.decision === 'recommended' || policy.decision === 'manual_review' || policy.blockers.length > 0
        ? 'warning'
        : 'pass';
  insertBuild(createGoldenCorpusOrchestratorStep(
    'build_adaptive_reconciliation_policy',
    buildStepStatus,
    `Adaptive reconciliation: ${policy.decision} (${policy.severity}).`,
    {
      decision: policy.decision,
      severity: policy.severity,
      recommendedAction: policy.recommendedAction,
      aiBlocked: policy.flags.aiBlocked,
    },
  ));

  if (request.persistAdaptiveReconciliationPolicy !== true) {
    appendPersist(skippedStep('persist_adaptive_reconciliation_policy', 'Persistence not requested.'));
    return;
  }

  const importId = (result.importId ?? '').trim();
  if (!importId) {
    appendPersist(createGoldenCorpusOrchestratorStep(
      'persist_adaptive_reconciliation_policy', 'warning', 'No importId to persist the policy.'));
    addWarning('adaptive_reconciliation_policy_persist_skipped_no_import_id');
    return;
  }

  const saveRes = await saveAdaptiveReconciliationPolicy(importId, policy);
  result.adaptiveReconciliationPolicyPersistenceResult = saveRes;
  if (saveRes.kind === 'ok') {
    appendPersist(createGoldenCorpusOrchestratorStep(
      'persist_adaptive_reconciliation_policy', 'pass', 'Adaptive reconciliation policy persisted.'));
  } else {
    appendPersist(createGoldenCorpusOrchestratorStep(
      'persist_adaptive_reconciliation_policy', 'fail', saveRes.message));
    addWarning('adaptive_reconciliation_policy_persistence_failed');
  }
}

/**
 * Phase 10E phase (async-only): builds the controlled self-healing retry plan
 * from all Phase 8/9/10 signals, optionally executes only safe/confirmed
 * supported actions via the conservative executor, and optionally persists the
 * audit via `append_meta`. It NEVER calls AI, mutates templates, reruns imports,
 * or performs browser-dependent actions. Non-gating.
 */
async function applySelfHealingPhase(
  result: GoldenCorpusOrchestratorResult,
  request: GoldenCorpusOrchestratorRequest,
  snapshot: GoldenCorpusImportQualitySnapshot,
  now: () => Date,
): Promise<void> {
  const insertBuild = (step: GoldenCorpusOrchestratorStep) => {
    result.steps = insertAfterStep(result.steps, 'build_adaptive_reconciliation_policy', step);
  };
  const appendStep = (step: GoldenCorpusOrchestratorStep) => {
    result.steps = [...result.steps, step];
  };
  const addWarning = (code: string) => { result.warnings = uniq([...result.warnings, code]); };

  if (request.buildSelfHealingPlan !== true) {
    insertBuild(skippedStep('build_self_healing_plan', 'Self-healing plan not requested.'));
    appendStep(skippedStep('execute_self_healing_plan', 'Self-healing plan not requested.'));
    appendStep(skippedStep('persist_self_healing_audit', 'Self-healing plan not requested.'));
    return;
  }

  const mode = request.executeSelfHealingMode ?? 'dry_run';

  let audit;
  try {
    audit = buildSelfHealingRetryPlan({
      importId: result.importId ?? request.importId,
      templateId: result.templateId ?? request.templateId ?? snapshot.templateId,
      sourceFilename: request.sourceFilename ?? snapshot.sourceFilename,
      mode,
      snapshot,
      importIntelligenceProfile: result.importIntelligenceProfile,
      repairPatternAnalysis: result.repairPatternAnalysis,
      adaptiveReconciliationPolicy: result.adaptiveReconciliationPolicy,
      goldenRegressionSummary: result.goldenRegressionSummary ?? undefined,
      qualityGateReport: result.qualityGateReport ?? undefined,
      triageSummary: result.triageSummary ?? undefined,
      now,
    });
  } catch (err) {
    result.selfHealingRetryAudit = null;
    insertBuild(createGoldenCorpusOrchestratorStep('build_self_healing_plan', 'fail', (err as Error).message));
    appendStep(skippedStep('execute_self_healing_plan', 'Plan unavailable (build failed).'));
    appendStep(skippedStep('persist_self_healing_audit', 'Plan unavailable (build failed).'));
    addWarning('self_healing_plan_build_failed');
    return;
  }

  const buildStepStatus: GoldenCorpusOrchestratorStepStatus =
    audit.status === 'blocked'
      ? 'blocked'
      : audit.summary.manualActions > 0 || audit.summary.blockedActions > 0 || audit.blockers.length > 0
        ? 'warning'
        : 'pass';
  insertBuild(createGoldenCorpusOrchestratorStep(
    'build_self_healing_plan', buildStepStatus,
    `Self-healing plan: ${audit.status} (${audit.summary.totalActions} actions, mode ${audit.mode}).`,
    { status: audit.status, mode: audit.mode, manual: audit.summary.manualActions, blocked: audit.summary.blockedActions },
  ));

  // Execution — only when a non-preview mode is requested. execute_confirmed
  // additionally requires explicit operator confirmation. The executor never
  // runs AI, reruns imports, or mutates templates.
  if (mode === 'dry_run') {
    result.selfHealingRetryAudit = audit;
    appendStep(skippedStep('execute_self_healing_plan', 'Dry run — no actions executed.'));
  } else if (mode === 'execute_confirmed' && request.selfHealingOperatorConfirmed !== true) {
    result.selfHealingRetryAudit = audit;
    appendStep(createGoldenCorpusOrchestratorStep('execute_self_healing_plan', 'warning', 'Operator confirmation required for execute_confirmed.'));
    addWarning('self_healing_operator_confirmation_required');
  } else {
    const executed = await executeSelfHealingRetryPlan({
      audit, mode, operatorConfirmed: request.selfHealingOperatorConfirmed === true, now,
    });
    result.selfHealingRetryAudit = executed;
    const execStatus: GoldenCorpusOrchestratorStepStatus =
      executed.status === 'failed' ? 'fail'
        : executed.status === 'blocked' ? 'blocked'
          : executed.status === 'completed' ? 'pass' : 'warning';
    appendStep(createGoldenCorpusOrchestratorStep('execute_self_healing_plan', execStatus,
      `Self-healing execution: ${executed.status}.`, { status: executed.status }));
    audit = executed;
  }

  if (request.persistSelfHealingAudit !== true) {
    appendStep(skippedStep('persist_self_healing_audit', 'Persistence not requested.'));
    return;
  }

  const importId = (result.importId ?? '').trim();
  if (!importId) {
    appendStep(createGoldenCorpusOrchestratorStep('persist_self_healing_audit', 'warning', 'No importId to persist the audit.'));
    addWarning('self_healing_audit_persist_skipped_no_import_id');
    return;
  }

  const saveRes = await saveSelfHealingRetryAudit(importId, result.selfHealingRetryAudit ?? audit);
  result.selfHealingRetryAuditPersistenceResult = saveRes;
  if (saveRes.kind === 'ok') {
    appendStep(createGoldenCorpusOrchestratorStep('persist_self_healing_audit', 'pass', 'Self-healing audit persisted.'));
  } else {
    appendStep(createGoldenCorpusOrchestratorStep('persist_self_healing_audit', 'fail', saveRes.message));
    addWarning('self_healing_audit_persistence_failed');
  }
}

/**
 * Phase 10F phase (async-only): builds the advisory Performance + Cost audit from
 * the snapshot and all Phase 10B–10E result modules, and optionally persists it
 * via `append_meta`. It is advisory only — it never skips required quality gates,
 * calls AI, mutates templates, or changes orchestration decisions. Non-gating: a
 * problem only adds a warning.
 */
async function applyPerformanceCostPhase(
  result: GoldenCorpusOrchestratorResult,
  request: GoldenCorpusOrchestratorRequest,
  snapshot: GoldenCorpusImportQualitySnapshot,
  now: () => Date,
): Promise<void> {
  const appendStep = (step: GoldenCorpusOrchestratorStep) => { result.steps = [...result.steps, step]; };
  const addWarning = (code: string) => { result.warnings = uniq([...result.warnings, code]); };

  if (request.buildPerformanceCostAudit !== true) {
    appendStep(skippedStep('build_performance_cost_audit', 'Performance/cost audit not requested.'));
    appendStep(skippedStep('persist_performance_cost_audit', 'Performance/cost audit not requested.'));
    return;
  }

  let audit;
  try {
    audit = buildPdfImportPerformanceCostAudit({
      importId: result.importId ?? request.importId,
      templateId: result.templateId ?? request.templateId ?? snapshot.templateId,
      sourceFilename: request.sourceFilename ?? snapshot.sourceFilename,
      snapshot,
      importIntelligenceProfile: result.importIntelligenceProfile,
      repairPatternAnalysis: result.repairPatternAnalysis,
      adaptiveReconciliationPolicy: result.adaptiveReconciliationPolicy,
      selfHealingRetryAudit: result.selfHealingRetryAudit,
      goldenRegressionSummary: result.goldenRegressionSummary ?? undefined,
      goldenHistory: result.historyRecord ? [result.historyRecord] : undefined,
      now,
    });
  } catch (err) {
    result.performanceCostAudit = null;
    appendStep(createGoldenCorpusOrchestratorStep('build_performance_cost_audit', 'fail', (err as Error).message));
    appendStep(skippedStep('persist_performance_cost_audit', 'Audit unavailable (build failed).'));
    addWarning('performance_cost_audit_build_failed');
    return;
  }

  result.performanceCostAudit = audit;
  const buildStepStatus: GoldenCorpusOrchestratorStepStatus =
    audit.overallRiskLevel === 'high' || audit.overallRiskLevel === 'critical' || audit.blockers.length > 0
      ? 'warning'
      : audit.recommendations.some((r) => r.action !== 'no_action')
        ? 'warning'
        : 'pass';
  appendStep(createGoldenCorpusOrchestratorStep(
    'build_performance_cost_audit', buildStepStatus,
    `Performance/cost: risk ${audit.overallRiskLevel}, cost ${audit.overallCostLevel} (${audit.recommendations.length} recommendation(s)).`,
    { cost: audit.overallCostLevel, risk: audit.overallRiskLevel, waste: audit.estimatedWasteScore, recommendations: audit.recommendations.length },
  ));

  if (request.persistPerformanceCostAudit !== true) {
    appendStep(skippedStep('persist_performance_cost_audit', 'Persistence not requested.'));
    return;
  }

  const importId = (result.importId ?? '').trim();
  if (!importId) {
    appendStep(createGoldenCorpusOrchestratorStep('persist_performance_cost_audit', 'warning', 'No importId to persist the audit.'));
    addWarning('performance_cost_audit_persist_skipped_no_import_id');
    return;
  }

  const saveRes = await savePdfImportPerformanceAudit(importId, audit);
  result.performanceCostAuditPersistenceResult = saveRes;
  if (saveRes.kind === 'ok') {
    appendStep(createGoldenCorpusOrchestratorStep('persist_performance_cost_audit', 'pass', 'Performance/cost audit persisted.'));
  } else {
    appendStep(createGoldenCorpusOrchestratorStep('persist_performance_cost_audit', 'fail', saveRes.message));
    addWarning('performance_cost_audit_persistence_failed');
  }
}

/**
 * Phase 10G phase (async-only): builds the production operator control audit from
 * the snapshot and all Phase 10B–10F result modules, and optionally persists it
 * via `append_meta`. It only builds/displays/persists controls — it never
 * executes operator actions, calls AI, or mutates templates. Non-gating.
 */
async function applyOperatorControlsPhase(
  result: GoldenCorpusOrchestratorResult,
  request: GoldenCorpusOrchestratorRequest,
  snapshot: GoldenCorpusImportQualitySnapshot,
  now: () => Date,
): Promise<void> {
  const appendStep = (step: GoldenCorpusOrchestratorStep) => { result.steps = [...result.steps, step]; };
  const addWarning = (code: string) => { result.warnings = uniq([...result.warnings, code]); };

  if (request.buildOperatorControls !== true) {
    appendStep(skippedStep('build_operator_controls', 'Operator controls not requested.'));
    appendStep(skippedStep('persist_operator_control_audit', 'Operator controls not requested.'));
    return;
  }

  const importId = (result.importId ?? request.importId ?? '').trim();
  const previousAuditResult = importId
    ? await loadProductionOperatorControlAudit(importId)
    : { kind: 'missing' as const };

  let audit;
  try {
    audit = buildProductionOperatorControlAudit({
      importId: result.importId ?? request.importId,
      templateId: result.templateId ?? request.templateId ?? snapshot.templateId,
      sourceFilename: request.sourceFilename ?? snapshot.sourceFilename,
      snapshot,
      goldenRegressionSummary: result.goldenRegressionSummary ?? undefined,
      importIntelligenceProfile: result.importIntelligenceProfile,
      repairPatternAnalysis: result.repairPatternAnalysis,
      adaptiveReconciliationPolicy: result.adaptiveReconciliationPolicy,
      selfHealingRetryAudit: result.selfHealingRetryAudit,
      performanceCostAudit: result.performanceCostAudit,
      qualityGateReport: result.qualityGateReport ?? undefined,
      triageSummary: result.triageSummary ?? undefined,
      previousOperatorControlAudit: previousAuditResult.kind === 'ok' ? previousAuditResult.audit : undefined,
      now,
    });
  } catch (err) {
    result.productionOperatorControlAudit = null;
    appendStep(createGoldenCorpusOrchestratorStep('build_operator_controls', 'fail', (err as Error).message));
    appendStep(skippedStep('persist_operator_control_audit', 'Audit unavailable (build failed).'));
    addWarning('operator_controls_build_failed');
    return;
  }

  result.productionOperatorControlAudit = audit;
  const recommended = audit.controls.filter((c) => c.recommended).length;
  const blockedOrManual = audit.controls.filter((c) => c.state === 'blocked' || c.state === 'manual_only').length;
  const buildStepStatus: GoldenCorpusOrchestratorStepStatus =
    audit.operatorState.blocked || recommended > 0 || blockedOrManual > 0 ? 'warning' : 'pass';
  appendStep(createGoldenCorpusOrchestratorStep(
    'build_operator_controls', buildStepStatus,
    `Operator controls: decision ${audit.operatorState.decision} (${recommended} recommended).`,
    { decision: audit.operatorState.decision, recommended, manualReviewRequired: audit.operatorState.manualReviewRequired, blocked: audit.operatorState.blocked },
  ));

  if (request.persistOperatorControlAudit !== true) {
    appendStep(skippedStep('persist_operator_control_audit', 'Persistence not requested.'));
    return;
  }

  if (!importId) {
    appendStep(createGoldenCorpusOrchestratorStep('persist_operator_control_audit', 'warning', 'No importId to persist the audit.'));
    addWarning('operator_control_audit_persist_skipped_no_import_id');
    return;
  }

  if (previousAuditResult.kind === 'error') {
    result.productionOperatorControlAuditPersistenceResult = previousAuditResult;
    appendStep(createGoldenCorpusOrchestratorStep(
      'persist_operator_control_audit',
      'fail',
      `Existing operator control audit could not be loaded: ${previousAuditResult.message}`,
    ));
    addWarning('operator_control_audit_persistence_failed');
    return;
  }

  const saveRes = await saveProductionOperatorControlAudit(importId, audit);
  result.productionOperatorControlAuditPersistenceResult = saveRes;
  if (saveRes.kind === 'ok') {
    appendStep(createGoldenCorpusOrchestratorStep('persist_operator_control_audit', 'pass', 'Operator control audit persisted.'));
  } else {
    appendStep(createGoldenCorpusOrchestratorStep('persist_operator_control_audit', 'fail', saveRes.message));
    addWarning('operator_control_audit_persistence_failed');
  }
}

/**
 * Async orchestration: loads the snapshot via the secure `get_status` operation,
 * runs the pure chain, and optionally persists the summary when `request.persist`.
 */
export async function orchestrateGoldenCorpusRun(
  options: GoldenCorpusOrchestratorOptions,
): Promise<GoldenCorpusOrchestratorResult> {
  const { request } = options;
  const now = options.now ?? (() => new Date());
  const generatedAt = now().toISOString();

  const importId = typeof request.importId === 'string' ? request.importId.trim() : '';
  if (!importId) {
    const result = baseResult(request, generatedAt);
    result.status = 'not_evaluated';
    result.warnings = ['input_missing_import_id'];
    result.steps = [
      createGoldenCorpusOrchestratorStep('validate_input', 'warning', 'importId is required to evaluate.'),
      skippedStep('load_snapshot'),
      ...skippedRest('validate_input'),
    ];
    return result;
  }

  const load = await loadGoldenCorpusImportQualitySnapshot(importId);
  if (load.kind === 'error' || load.kind === 'missing' || !load.snapshot) {
    const result = baseResult(request, generatedAt);
    result.corpusId = request.corpusId || null;
    result.status = 'blocked';
    const failureCode = load.kind === 'missing' ? 'snapshot_missing' : 'snapshot_load_failed';
    result.failures = [failureCode];
    result.steps = [
      createGoldenCorpusOrchestratorStep('validate_input', 'pass', 'Input validated.'),
      createGoldenCorpusOrchestratorStep('load_snapshot', 'blocked', load.message ?? 'Snapshot unavailable.'),
      ...skippedRest('validate_input'),
    ];
    return result;
  }

  // Phase 9D — optional export parity automation before evaluation. When it
  // persists a summary we reload the snapshot so quality gates see the fresh
  // export_parity metadata.
  let snapshot = load.snapshot;
  let exportParityRunnerResult: ExportParityRunnerResult | null = null;
  if (request.runExportParity === true) {
    exportParityRunnerResult = await runExportParityAutomation({
      input: {
        importId,
        templateId: request.templateId ?? null,
        mode: 'auto',
        persist: request.persistExportParity === true,
        sourceFilename: request.sourceFilename ?? null,
        notes: request.notes,
      },
      now,
    });
    if (exportParityRunnerResult.persisted) {
      const reload = await loadGoldenCorpusImportQualitySnapshot(importId);
      if (reload.kind === 'ok' && reload.snapshot) snapshot = reload.snapshot;
    }
  }

  const pure = orchestrateGoldenCorpusRunFromSnapshot({ request, snapshot, now });
  pure.exportParityRunnerResult = exportParityRunnerResult;
  pure.steps = withLoadSnapshotStep(
    pure.steps,
    createGoldenCorpusOrchestratorStep('load_snapshot', 'pass', 'Import snapshot loaded.'),
  );

  // Insert the run_export_parity step right after load_snapshot.
  if (request.runExportParity === true && exportParityRunnerResult) {
    const r = exportParityRunnerResult;
    const stepStatus: GoldenCorpusOrchestratorStepStatus =
      r.status === 'completed' ? 'pass' : r.status === 'failed' ? 'fail' : 'warning';
    pure.steps = insertAfterStep(pure.steps, 'load_snapshot', createGoldenCorpusOrchestratorStep(
      'run_export_parity', stepStatus,
      `Export parity automation: ${r.status} (${r.automationLevel}${r.persisted ? ', persisted' : ''}).`,
      { status: r.status, automationLevel: r.automationLevel, blockers: r.blockers },
    ));
    if (r.persistenceError && request.persistExportParity === true) {
      pure.failures = uniq([...pure.failures, 'export_parity_persistence_failed']);
      pure.status = 'failed';
    } else if (r.status === 'partial') {
      pure.warnings = uniq([...pure.warnings, 'export_parity_automation_incomplete']);
    } else if (r.status === 'manual_required' || r.status === 'not_ready' || r.status === 'failed') {
      pure.warnings = uniq([...pure.warnings, 'export_parity_automation_manual_required']);
    }
  } else {
    pure.steps = insertAfterStep(pure.steps, 'load_snapshot',
      skippedStep('run_export_parity', 'Export parity automation not requested.'));
  }

  // Phase 9C flags. compareBaseline defaults to saveHistory when omitted.
  const wantSaveHistory = request.saveHistory === true;
  const wantCompareBaseline = request.compareBaseline ?? wantSaveHistory;

  // Baseline compare runs before persistence (load_baseline / compare_baseline
  // are inserted before persist_summary).
  if (wantCompareBaseline) {
    await applyBaselineComparePhase(pure, request);
  }

  // persist_summary (Phase 8D/9A). evaluate_only leaves the summary read-only.
  if (request.persist !== true) {
    pure.mode = 'evaluate_only';
    pure.persisted = false;
    pure.persistenceResult = null;
    pure.steps = replaceStep(pure.steps, skippedStep('persist_summary', 'Persistence not requested (evaluate_only).'));
  } else {
    pure.mode = 'evaluate_and_persist';
    if (!pure.goldenRegressionSummary) {
      pure.persisted = false;
      pure.persistenceResult = null;
      pure.steps = replaceStep(pure.steps, createGoldenCorpusOrchestratorStep('persist_summary', 'fail', 'No summary to persist.'));
      pure.failures = uniq([...pure.failures, 'persistence_summary_missing']);
      pure.status = 'failed';
    } else {
      const saveResult = await saveGoldenRegressionSummary(importId, pure.goldenRegressionSummary);
      pure.persistenceResult = saveResult;
      if (saveResult.kind === 'ok') {
        pure.persisted = true;
        pure.steps = replaceStep(pure.steps, createGoldenCorpusOrchestratorStep('persist_summary', 'pass', 'Golden regression summary persisted.'));
      } else {
        pure.persisted = false;
        pure.steps = replaceStep(pure.steps, createGoldenCorpusOrchestratorStep('persist_summary', 'fail', saveResult.message));
        pure.failures = uniq([...pure.failures, 'persistence_failed']);
        pure.status = 'failed';
      }
    }
  }

  // save_history (Phase 9C) runs after persistence — records the run (with its
  // baseline comparison) in the ledger. Independent of `persist`.
  if (wantSaveHistory) {
    await applySaveHistoryPhase(pure);
  }

  // Phase 10B — optional import intelligence profile build/persist. Non-gating.
  await applyImportIntelligencePhase(pure, request, snapshot, now);

  // Phase 10C — optional repair pattern analysis build/persist. Advisory, non-gating.
  await applyRepairPatternPhase(pure, request, snapshot, now);

  // Phase 10D — optional adaptive reconciliation policy build/persist. Governance
  // only; never calls AI or applies reconciliation. Non-gating.
  await applyAdaptiveReconciliationPhase(pure, request, snapshot, now);

  // Phase 10E — optional controlled self-healing retry plan/execute/persist.
  // Never calls AI, mutates templates, or reruns imports. Non-gating.
  await applySelfHealingPhase(pure, request, snapshot, now);

  // Phase 10F — optional advisory performance/cost audit build/persist. Advisory
  // only; never skips gates, calls AI, or mutates templates. Non-gating.
  await applyPerformanceCostPhase(pure, request, snapshot, now);

  // Phase 10G — optional production operator control audit build/persist. Records
  // control availability/decisions; never executes actions, calls AI, or mutates
  // templates. Non-gating.
  await applyOperatorControlsPhase(pure, request, snapshot, now);

  // A clean run that only accrued baseline warnings drops to completed_with_warnings.
  if (pure.status === 'completed' && pure.warnings.length > 0) {
    pure.status = 'completed_with_warnings';
  }

  return pure;
}

export type { GoldenCorpusOrchestratorMode };
