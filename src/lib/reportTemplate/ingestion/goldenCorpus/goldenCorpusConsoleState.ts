/**
 * goldenCorpusConsoleState — Phase 9B.
 *
 * Pure state/validation/request-building helpers for the operator Golden
 * Regression console. Keeping this logic out of the React component makes the
 * console form testable and keeps the UI thin. No I/O here.
 */
import { getGoldenCorpusItem } from './goldenCorpusRegistry';
import type { GoldenRegressionOperatorDecision } from './goldenRegressionTypes';
import type {
  GoldenCorpusOrchestratorRequest,
  GoldenCorpusOrchestratorResult,
  GoldenCorpusOrchestratorStatus,
} from './goldenCorpusOrchestratorTypes';

export type GoldenCorpusConsoleMode = 'evaluate_only' | 'evaluate_and_persist';

export interface GoldenCorpusConsoleFormState {
  corpusId: string;
  importId: string;
  templateId: string;
  runId: string;
  runBatchId: string;
  operatorDecision: GoldenRegressionOperatorDecision;
  notesText: string;
  /** Phase 9C — append a history row when persisting. */
  saveHistory: boolean;
  /** Phase 9C — compare this run against the latest baseline for the corpus. */
  compareBaseline: boolean;
  /** Phase 9D — run export parity automation before evaluation. */
  runExportParity: boolean;
  /** Phase 9D — persist the export parity summary the runner produces. */
  persistExportParity: boolean;
  /** Phase 10B — build the deterministic import intelligence profile. */
  buildImportIntelligenceProfile: boolean;
  /** Phase 10B — persist the import intelligence profile (only when persisting). */
  persistImportIntelligenceProfile: boolean;
  /** Phase 10C — build the deterministic repair pattern analysis. */
  buildRepairPatternAnalysis: boolean;
  /** Phase 10C — persist the repair pattern analysis (only when persisting). */
  persistRepairPatternAnalysis: boolean;
  /** Phase 10D — build the deterministic adaptive reconciliation policy. */
  buildAdaptiveReconciliationPolicy: boolean;
  /** Phase 10D — persist the adaptive reconciliation policy (only when persisting). */
  persistAdaptiveReconciliationPolicy: boolean;
  /** Phase 10E — build the controlled self-healing retry plan. */
  buildSelfHealingPlan: boolean;
  /** Phase 10E — persist the self-healing retry audit (only when persisting). */
  persistSelfHealingAudit: boolean;
  /** Phase 10E — self-healing execution mode. */
  selfHealingMode: 'dry_run' | 'audit_only' | 'execute_safe' | 'execute_confirmed';
  /** Phase 10E — explicit operator confirmation for execute_confirmed. */
  selfHealingOperatorConfirmed: boolean;
  /** Phase 10F — build the advisory performance/cost audit. */
  buildPerformanceCostAudit: boolean;
  /** Phase 10F — persist the performance/cost audit (only when persisting). */
  persistPerformanceCostAudit: boolean;
  /** Phase 10G — build the production operator control audit. */
  buildOperatorControls: boolean;
  /** Phase 10G — persist the operator control audit (only when persisting). */
  persistOperatorControlAudit: boolean;
}

export interface GoldenCorpusConsoleValidationIssue {
  field: keyof GoldenCorpusConsoleFormState | 'form';
  code: string;
  message: string;
  severity: 'warning' | 'error';
}

export interface GoldenCorpusConsoleValidationResult {
  ok: boolean;
  issues: GoldenCorpusConsoleValidationIssue[];
}

export const GOLDEN_CORPUS_CONSOLE_OPERATOR_DECISIONS: readonly GoldenRegressionOperatorDecision[] = [
  'not_reviewed',
  'accepted',
  'accepted_with_warnings',
  'rejected',
  'needs_rerun',
];

export function createDefaultGoldenCorpusConsoleFormState(
  overrides?: Partial<GoldenCorpusConsoleFormState>,
): GoldenCorpusConsoleFormState {
  return {
    corpusId: 'golden-simple-001',
    importId: '',
    templateId: '',
    runId: '',
    runBatchId: '',
    operatorDecision: 'not_reviewed',
    notesText: '',
    saveHistory: true,
    compareBaseline: true,
    runExportParity: false,
    persistExportParity: true,
    buildImportIntelligenceProfile: true,
    persistImportIntelligenceProfile: true,
    buildRepairPatternAnalysis: true,
    persistRepairPatternAnalysis: true,
    buildAdaptiveReconciliationPolicy: true,
    persistAdaptiveReconciliationPolicy: true,
    buildSelfHealingPlan: false,
    persistSelfHealingAudit: true,
    selfHealingMode: 'dry_run',
    selfHealingOperatorConfirmed: false,
    buildPerformanceCostAudit: true,
    persistPerformanceCostAudit: true,
    buildOperatorControls: true,
    persistOperatorControlAudit: true,
    ...overrides,
  };
}

/** Split notes text by newline; trim, drop blanks, dedupe (order-preserving). */
export function parseGoldenCorpusConsoleNotes(notesText: string): string[] {
  const out: string[] = [];
  for (const raw of String(notesText ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line && !out.includes(line)) out.push(line);
  }
  return out;
}

export function validateGoldenCorpusConsoleForm(
  form: GoldenCorpusConsoleFormState,
  mode: GoldenCorpusConsoleMode,
): GoldenCorpusConsoleValidationResult {
  const issues: GoldenCorpusConsoleValidationIssue[] = [];
  const err = (field: GoldenCorpusConsoleValidationIssue['field'], code: string, message: string) =>
    issues.push({ field, code, message, severity: 'error' });
  const warn = (field: GoldenCorpusConsoleValidationIssue['field'], code: string, message: string) =>
    issues.push({ field, code, message, severity: 'warning' });

  const corpusId = form.corpusId?.trim();
  const importId = form.importId?.trim();

  if (!corpusId) err('corpusId', 'corpus_id_required', 'Corpus ID is required.');
  else if (!getGoldenCorpusItem(corpusId)) err('corpusId', 'corpus_id_unknown', `Unknown corpus ID: ${corpusId}.`);

  if (!importId) err('importId', 'import_id_required', 'Import ID is required.');

  if (!form.operatorDecision) err('operatorDecision', 'operator_decision_required', 'Operator decision is required.');

  if (!form.templateId?.trim()) {
    warn('templateId', 'template_id_missing', 'Template ID not provided; page-count checks may be limited.');
  }

  if (form.persistExportParity && !form.runExportParity) {
    warn('persistExportParity', 'export_parity_persist_without_run', 'Persist export parity has no effect unless export parity automation is enabled.');
  }

  if (form.persistImportIntelligenceProfile && !form.buildImportIntelligenceProfile) {
    warn('persistImportIntelligenceProfile', 'import_intelligence_persist_without_build', 'Persist import intelligence profile has no effect unless profile building is enabled.');
  }

  if (form.persistRepairPatternAnalysis && !form.buildRepairPatternAnalysis) {
    warn('persistRepairPatternAnalysis', 'repair_pattern_persist_without_build', 'Persist repair pattern analysis has no effect unless analysis building is enabled.');
  }

  if (form.persistAdaptiveReconciliationPolicy && !form.buildAdaptiveReconciliationPolicy) {
    warn('persistAdaptiveReconciliationPolicy', 'adaptive_reconciliation_persist_without_build', 'Persist adaptive reconciliation policy has no effect unless policy building is enabled.');
  }

  if (form.persistSelfHealingAudit && !form.buildSelfHealingPlan) {
    warn('persistSelfHealingAudit', 'self_healing_persist_without_build', 'Persist self-healing audit has no effect unless self-healing plan building is enabled.');
  }

  if (form.selfHealingMode === 'execute_confirmed' && form.buildSelfHealingPlan && !form.selfHealingOperatorConfirmed) {
    warn('selfHealingOperatorConfirmed', 'self_healing_confirmation_missing', 'Execute-confirmed self-healing needs explicit operator confirmation; operator-confirmed actions will be held for manual action.');
  }

  if (form.persistPerformanceCostAudit && !form.buildPerformanceCostAudit) {
    warn('persistPerformanceCostAudit', 'performance_cost_persist_without_build', 'Persist performance/cost audit has no effect unless audit building is enabled.');
  }

  if (form.persistOperatorControlAudit && !form.buildOperatorControls) {
    warn('persistOperatorControlAudit', 'operator_controls_persist_without_build', 'Persist operator control audit has no effect unless operator controls building is enabled.');
  }

  if (mode === 'evaluate_and_persist') {
    if (form.operatorDecision === 'not_reviewed') {
      warn('operatorDecision', 'operator_not_reviewed', 'Operator decision is still "not reviewed" before persisting.');
    }
    const notes = parseGoldenCorpusConsoleNotes(form.notesText);
    if (notes.length === 0 && (form.operatorDecision === 'rejected' || form.operatorDecision === 'needs_rerun')) {
      warn('notesText', 'notes_recommended', 'Notes are recommended when rejecting or flagging a run for rerun.');
    }
  }

  return { ok: issues.every((i) => i.severity !== 'error'), issues };
}

export function buildGoldenCorpusOrchestratorRequestFromForm(
  form: GoldenCorpusConsoleFormState,
  mode: GoldenCorpusConsoleMode,
): GoldenCorpusOrchestratorRequest {
  const trimOrNull = (v: string) => {
    const t = (v ?? '').trim();
    return t === '' ? null : t;
  };
  return {
    corpusId: (form.corpusId ?? '').trim(),
    importId: (form.importId ?? '').trim(),
    templateId: trimOrNull(form.templateId),
    runId: trimOrNull(form.runId),
    runBatchId: trimOrNull(form.runBatchId),
    operatorDecision: form.operatorDecision,
    notes: parseGoldenCorpusConsoleNotes(form.notesText),
    persist: mode === 'evaluate_and_persist',
    // History rows are only written when persisting; baseline comparison is
    // read-only and can preview in evaluate-only mode.
    saveHistory: mode === 'evaluate_and_persist' && form.saveHistory,
    compareBaseline: form.compareBaseline,
    // Export parity automation runs in either mode; persistence only when the
    // runner is enabled (and, being a write, respects the runner toggle only).
    runExportParity: form.runExportParity,
    persistExportParity: form.runExportParity && form.persistExportParity,
    // Phase 10B — building the profile is read-only and can run in either mode;
    // persistence only when explicitly persisting the run.
    buildImportIntelligenceProfile: form.buildImportIntelligenceProfile,
    persistImportIntelligenceProfile:
      mode === 'evaluate_and_persist' && form.buildImportIntelligenceProfile && form.persistImportIntelligenceProfile,
    // Phase 10C — advisory analysis; read-only build, persist only when persisting.
    buildRepairPatternAnalysis: form.buildRepairPatternAnalysis,
    persistRepairPatternAnalysis:
      mode === 'evaluate_and_persist' && form.buildRepairPatternAnalysis && form.persistRepairPatternAnalysis,
    // Phase 10D — governance policy; read-only build, persist only when persisting.
    buildAdaptiveReconciliationPolicy: form.buildAdaptiveReconciliationPolicy,
    persistAdaptiveReconciliationPolicy:
      mode === 'evaluate_and_persist' && form.buildAdaptiveReconciliationPolicy && form.persistAdaptiveReconciliationPolicy,
    // Phase 10E — controlled self-healing. Plan build is read-only; execution
    // honours the selected mode; persistence only when persisting the run.
    buildSelfHealingPlan: form.buildSelfHealingPlan,
    persistSelfHealingAudit:
      mode === 'evaluate_and_persist' && form.buildSelfHealingPlan && form.persistSelfHealingAudit,
    executeSelfHealingMode: form.selfHealingMode,
    selfHealingOperatorConfirmed: form.selfHealingOperatorConfirmed,
    // Phase 10F — advisory audit; read-only build in either mode, persist only
    // when explicitly persisting the run.
    buildPerformanceCostAudit: form.buildPerformanceCostAudit,
    persistPerformanceCostAudit:
      mode === 'evaluate_and_persist' && form.buildPerformanceCostAudit && form.persistPerformanceCostAudit,
    // Phase 10G — operator control audit; read-only build in either mode, persist
    // only when explicitly persisting the run.
    buildOperatorControls: form.buildOperatorControls,
    persistOperatorControlAudit:
      mode === 'evaluate_and_persist' && form.buildOperatorControls && form.persistOperatorControlAudit,
  };
}

export function getGoldenCorpusConsoleStatusLabel(
  status: GoldenCorpusOrchestratorStatus | string | null | undefined,
): string {
  switch (status) {
    case 'completed': return 'Completed';
    case 'completed_with_warnings': return 'Completed with warnings';
    case 'failed': return 'Failed';
    case 'blocked': return 'Blocked';
    case 'not_evaluated': return 'Not evaluated';
    default: return 'Not run';
  }
}

export function getGoldenCorpusConsoleStatusTone(
  status: GoldenCorpusOrchestratorStatus | string | null | undefined,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed': return 'default';
    case 'completed_with_warnings': return 'secondary';
    case 'failed': return 'destructive';
    case 'blocked': return 'destructive';
    case 'not_evaluated': return 'outline';
    default: return 'outline';
  }
}

export function getGoldenCorpusConsoleResultHeadline(
  result: GoldenCorpusOrchestratorResult | null,
): string {
  if (!result) return 'No run yet.';
  switch (result.status) {
    case 'completed': return 'Golden regression completed.';
    case 'completed_with_warnings': return 'Golden regression completed with warnings.';
    case 'failed': return 'Golden regression failed.';
    case 'blocked': return 'Golden regression blocked.';
    case 'not_evaluated': return 'Golden regression not evaluated.';
    default: return 'No run yet.';
  }
}
