/**
 * goldenCorpusOrchestratorTypes — Phase 9A orchestration data model.
 *
 * The orchestrator is the single operational entry point that, given a corpusId +
 * importId, runs the full post-import golden regression chain (Phase 8B run eval →
 * 8C quality gates → 8D summary → 8F triage → optional persistence) and returns one
 * structured result. It starts after a PDF is already imported; it never uploads
 * PDFs or automates the browser.
 */
import type {
  GoldenRegressionOperatorDecision,
  GoldenRegressionSummary,
  SaveGoldenRegressionSummaryResult,
} from './goldenRegressionTypes';
import type {
  GoldenCorpusImportQualitySnapshot,
  GoldenCorpusRunEvaluation,
} from './goldenCorpusRunTypes';
import type { PdfImportQualityGateReport } from '../qualityGates/pdfImportQualityGateTypes';
import type { PdfImportFailureTriageSummary } from '../failureTriage/pdfImportFailureTriageTypes';
import type {
  GoldenRunBaselineComparison,
  GoldenRunHistoryRecord,
  SaveGoldenRunHistoryResult,
} from './goldenRunHistoryTypes';
import type { ExportParityRunnerResult } from '../exportParity/exportParityRunnerTypes';
import type {
  ImportIntelligenceProfile,
  SaveImportIntelligenceProfileResult,
} from '../importIntelligence/importIntelligenceTypes';
import type {
  RepairPatternAnalysis,
  SaveRepairPatternAnalysisResult,
} from '../repairPatterns/repairPatternTypes';
import type {
  AdaptiveReconciliationPolicy,
  SaveAdaptiveReconciliationPolicyResult,
} from '../reconciliation/adaptiveReconciliationTypes';
import type {
  SaveSelfHealingRetryAuditResult,
  SelfHealingMode,
  SelfHealingRetryAudit,
} from '../selfHealing/selfHealingTypes';
import type {
  PdfImportPerformanceCostAudit,
  SavePdfImportPerformanceAuditResult,
} from '../performance/pdfImportPerformanceTypes';
import type {
  ProductionOperatorControlAudit,
  SaveOperatorControlAuditResult,
} from '../operatorControls/operatorControlTypes';

export const GOLDEN_CORPUS_ORCHESTRATOR_VERSION = 'pdf-import-golden-corpus-orchestrator-v1';

export type GoldenCorpusOrchestratorMode = 'evaluate_only' | 'evaluate_and_persist';

export type GoldenCorpusOrchestratorStatus =
  | 'completed'
  | 'completed_with_warnings'
  | 'failed'
  | 'blocked'
  | 'not_evaluated';

export type GoldenCorpusOrchestratorStepId =
  | 'validate_input'
  | 'load_snapshot'
  | 'run_export_parity'
  | 'evaluate_run'
  | 'evaluate_quality_gates'
  | 'build_summary'
  | 'evaluate_triage'
  | 'load_baseline'
  | 'compare_baseline'
  | 'persist_summary'
  | 'save_history'
  | 'build_import_intelligence_profile'
  | 'persist_import_intelligence_profile'
  | 'build_repair_pattern_analysis'
  | 'persist_repair_pattern_analysis'
  | 'build_adaptive_reconciliation_policy'
  | 'persist_adaptive_reconciliation_policy'
  | 'build_self_healing_plan'
  | 'execute_self_healing_plan'
  | 'persist_self_healing_audit'
  | 'build_performance_cost_audit'
  | 'persist_performance_cost_audit'
  | 'build_operator_controls'
  | 'persist_operator_control_audit';

export type GoldenCorpusOrchestratorStepStatus =
  | 'pending'
  | 'skipped'
  | 'pass'
  | 'warning'
  | 'fail'
  | 'blocked';

export interface GoldenCorpusOrchestratorStep {
  id: GoldenCorpusOrchestratorStepId;
  status: GoldenCorpusOrchestratorStepStatus;
  label: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface GoldenCorpusOrchestratorRequest {
  corpusId: string;
  importId: string;
  templateId?: string | null;
  sourceFilename?: string | null;
  runId?: string | null;
  runBatchId?: string | null;
  operatorDecision?: GoldenRegressionOperatorDecision;
  notes?: string[];
  /** Persist the latest summary onto template_imports.meta (Phase 8D/9A). */
  persist?: boolean;
  /** Run the Phase 9D export parity automation before evaluating the run. */
  runExportParity?: boolean;
  /** Persist the export parity summary produced by the runner (Phase 9D). */
  persistExportParity?: boolean;
  /** Append a history row to public.pdf_import_golden_runs (Phase 9C). */
  saveHistory?: boolean;
  /**
   * Compare this run against the latest previous baseline for the corpus.
   * Defaults to `saveHistory` when omitted (a saved run is compared before it
   * becomes the next baseline).
   */
  compareBaseline?: boolean;
  /** Phase 10B — build the deterministic import intelligence profile. Off by default. */
  buildImportIntelligenceProfile?: boolean;
  /**
   * Phase 10B — persist the import intelligence profile to
   * template_imports.meta.import_intelligence_profile. Off by default; requires
   * buildImportIntelligenceProfile and an importId. Read-only otherwise.
   */
  persistImportIntelligenceProfile?: boolean;
  /** Phase 10C — build the deterministic repair pattern analysis. Off by default. */
  buildRepairPatternAnalysis?: boolean;
  /**
   * Phase 10C — persist the repair pattern analysis to
   * template_imports.meta.repair_pattern_analysis. Off by default; requires
   * buildRepairPatternAnalysis and an importId. Advisory; never applies repairs.
   */
  persistRepairPatternAnalysis?: boolean;
  /** Phase 10D — build the deterministic adaptive reconciliation policy. Off by default. */
  buildAdaptiveReconciliationPolicy?: boolean;
  /**
   * Phase 10D — persist the adaptive reconciliation policy to
   * template_imports.meta.adaptive_reconciliation_policy. Off by default; requires
   * buildAdaptiveReconciliationPolicy and an importId. Governance only; never
   * calls AI or applies reconciliation.
   */
  persistAdaptiveReconciliationPolicy?: boolean;
  /** Phase 10E — build the controlled self-healing retry plan. Off by default. */
  buildSelfHealingPlan?: boolean;
  /** Phase 10E — persist the self-healing retry audit. Off by default; requires an importId. */
  persistSelfHealingAudit?: boolean;
  /** Phase 10E — self-healing execution mode. Defaults to dry_run (no execution). */
  executeSelfHealingMode?: SelfHealingMode;
  /** Phase 10E — explicit operator confirmation for execute_confirmed mode. */
  selfHealingOperatorConfirmed?: boolean;
  /** Phase 10F — build the advisory performance/cost optimization audit. Off by default. */
  buildPerformanceCostAudit?: boolean;
  /**
   * Phase 10F — persist the performance/cost audit to
   * template_imports.meta.performance_cost_audit. Off by default; requires
   * buildPerformanceCostAudit and an importId. Advisory only; never changes
   * pipeline behaviour, calls AI, or mutates templates.
   */
  persistPerformanceCostAudit?: boolean;
  /** Phase 10G — build the production operator control audit. Off by default. */
  buildOperatorControls?: boolean;
  /**
   * Phase 10G — persist the operator control audit to
   * template_imports.meta.production_operator_control_audit. Off by default;
   * requires buildOperatorControls and an importId. Records control availability
   * and operator decisions; never calls AI or mutates templates automatically.
   */
  persistOperatorControlAudit?: boolean;
}

export interface GoldenCorpusOrchestratorOptions {
  request: GoldenCorpusOrchestratorRequest;
  now?: () => Date;
}

export interface GoldenCorpusOrchestratorResult {
  version: typeof GOLDEN_CORPUS_ORCHESTRATOR_VERSION;
  mode: GoldenCorpusOrchestratorMode;
  status: GoldenCorpusOrchestratorStatus;

  corpusId: string | null;
  importId: string | null;
  templateId: string | null;
  runId: string | null;
  runBatchId: string | null;

  steps: GoldenCorpusOrchestratorStep[];

  runEvaluation: GoldenCorpusRunEvaluation | null;
  qualityGateReport: PdfImportQualityGateReport | null;
  goldenRegressionSummary: GoldenRegressionSummary | null;
  triageSummary: PdfImportFailureTriageSummary | null;

  persistenceResult: SaveGoldenRegressionSummaryResult | null;
  persisted: boolean;

  // Phase 9D — automated export parity runner.
  exportParityRunnerResult: ExportParityRunnerResult | null;

  // Phase 9C — regression history + baseline comparison.
  baselineComparison: GoldenRunBaselineComparison | null;
  historyPersistenceResult: SaveGoldenRunHistoryResult | null;
  historyRecord: GoldenRunHistoryRecord | null;
  historySaved: boolean;

  // Phase 10B — import intelligence profile.
  importIntelligenceProfile: ImportIntelligenceProfile | null;
  importIntelligencePersistenceResult: SaveImportIntelligenceProfileResult | null;

  // Phase 10C — repair pattern analysis.
  repairPatternAnalysis: RepairPatternAnalysis | null;
  repairPatternPersistenceResult: SaveRepairPatternAnalysisResult | null;

  // Phase 10D — adaptive reconciliation policy.
  adaptiveReconciliationPolicy: AdaptiveReconciliationPolicy | null;
  adaptiveReconciliationPolicyPersistenceResult: SaveAdaptiveReconciliationPolicyResult | null;

  // Phase 10E — self-healing retry orchestration.
  selfHealingRetryAudit: SelfHealingRetryAudit | null;
  selfHealingRetryAuditPersistenceResult: SaveSelfHealingRetryAuditResult | null;

  // Phase 10F — performance + cost optimization audit.
  performanceCostAudit: PdfImportPerformanceCostAudit | null;
  performanceCostAuditPersistenceResult: SavePdfImportPerformanceAuditResult | null;

  // Phase 10G — production operator control audit.
  productionOperatorControlAudit: ProductionOperatorControlAudit | null;
  productionOperatorControlAuditPersistenceResult: SaveOperatorControlAuditResult | null;

  warnings: string[];
  failures: string[];

  generatedAt: string;
}

export interface GoldenCorpusSnapshotLoadResult {
  kind: 'ok' | 'missing' | 'error';
  snapshot?: GoldenCorpusImportQualitySnapshot;
  message?: string;
  raw?: unknown;
}
