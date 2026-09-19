/**
 * pdfImportReleaseGateEvaluator — Phase 9E.
 *
 * Pure roll-up of release gates into a single release decision. The caller sets
 * each gate's real status (from tests/build/file checks/SQL/browser results); the
 * evaluator computes severity, a summary, and one of `release_ready`,
 * `release_ready_with_warnings`, or `release_blocked`. No I/O.
 */
import {
  PDF_IMPORT_RELEASE_AUTOMATED_CATEGORIES,
  PDF_IMPORT_RELEASE_GATE_VERSION,
  PDF_IMPORT_RELEASE_MANUAL_CATEGORIES,
  type PdfImportReleaseDecision,
  type PdfImportReleaseGate,
  type PdfImportReleaseGateInput,
  type PdfImportReleaseGateReport,
  type PdfImportReleaseGateSeverity,
  type PdfImportReleaseGateStatus,
  type PdfImportReleaseGateSummary,
} from './pdfImportReleaseGateTypes';

function isManualCategory(category: PdfImportReleaseGate['category']): boolean {
  return (PDF_IMPORT_RELEASE_MANUAL_CATEGORIES as readonly string[]).includes(category);
}

/** Intrinsic severity of a gate (ignores allowManualPending — that is a decision-time input). */
export function resolvePdfImportReleaseGateSeverity(
  status: PdfImportReleaseGateStatus,
  required: boolean,
): PdfImportReleaseGateSeverity {
  switch (status) {
    case 'pass':
    case 'not_applicable':
      return 'info';
    case 'warning':
      return 'warning';
    case 'fail':
      return required ? 'blocking' : 'warning';
    case 'not_run':
      return required ? 'blocking' : 'info';
    default:
      return 'info';
  }
}

export function createPdfImportReleaseGate(options: {
  id: string;
  category: PdfImportReleaseGate['category'];
  label: string;
  status: PdfImportReleaseGateStatus;
  required?: boolean;
  message: string;
  details?: Record<string, unknown>;
}): PdfImportReleaseGate {
  const required = options.required ?? true;
  return {
    id: options.id,
    category: options.category,
    label: options.label,
    status: options.status,
    severity: resolvePdfImportReleaseGateSeverity(options.status, required),
    required,
    message: options.message,
    details: options.details,
  };
}

/** A gate is blocking when its intrinsic severity is `blocking`. */
export function isBlockingReleaseGate(gate: PdfImportReleaseGate): boolean {
  return gate.severity === 'blocking';
}

/**
 * Effective classification of a gate for the release decision, applying the
 * manual-pending rule: a required not_run gate in a manual (sql/database/browser/
 * manual) category is downgraded from blocker to warning when `allowManualPending`.
 */
type EffectiveClass = 'blocker' | 'warning' | 'info';
function classifyGate(gate: PdfImportReleaseGate, allowManualPending: boolean): EffectiveClass {
  switch (gate.status) {
    case 'pass':
    case 'not_applicable':
      return 'info';
    case 'warning':
      return 'warning';
    case 'fail':
      return gate.required ? 'blocker' : 'warning';
    case 'not_run':
      if (!gate.required) return 'info';
      if (allowManualPending && isManualCategory(gate.category)) return 'warning';
      return 'blocker';
    default:
      return 'info';
  }
}

export function summarizePdfImportReleaseGates(
  gates: PdfImportReleaseGate[],
): PdfImportReleaseGateSummary {
  const list = Array.isArray(gates) ? gates : [];
  const summary: PdfImportReleaseGateSummary = {
    total: list.length,
    pass: 0,
    warning: 0,
    fail: 0,
    notRun: 0,
    notApplicable: 0,
    requiredFailures: 0,
    requiredNotRun: 0,
  };
  for (const gate of list) {
    switch (gate.status) {
      case 'pass': summary.pass += 1; break;
      case 'warning': summary.warning += 1; break;
      case 'fail': summary.fail += 1; break;
      case 'not_run': summary.notRun += 1; break;
      case 'not_applicable': summary.notApplicable += 1; break;
    }
    if (gate.required && gate.status === 'fail') summary.requiredFailures += 1;
    if (gate.required && gate.status === 'not_run') summary.requiredNotRun += 1;
  }
  return summary;
}

export function resolvePdfImportReleaseDecision(options: {
  gates: PdfImportReleaseGate[];
  allowManualPending?: boolean;
}): PdfImportReleaseDecision {
  const gates = Array.isArray(options.gates) ? options.gates : [];
  const allowManualPending = options.allowManualPending === true;

  let hasBlocker = false;
  let hasWarning = false;
  for (const gate of gates) {
    const cls = classifyGate(gate, allowManualPending);
    if (cls === 'blocker') hasBlocker = true;
    else if (cls === 'warning') hasWarning = true;
  }

  if (hasBlocker) return 'release_blocked';
  if (hasWarning) return 'release_ready_with_warnings';
  return 'release_ready';
}

function uniq(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) if (v && !out.includes(v)) out.push(v);
  return out;
}

export function buildPdfImportReleaseGateReport(
  input: PdfImportReleaseGateInput,
): PdfImportReleaseGateReport {
  const gates = Array.isArray(input?.gates) ? input.gates : [];
  const allowManualPending = input?.allowManualPending === true;
  const now = input?.now ?? (() => new Date());
  const generatedAt = now().toISOString();

  const blockers: string[] = [];
  const warnings: string[] = [];
  for (const gate of gates) {
    const cls = classifyGate(gate, allowManualPending);
    if (cls === 'blocker') blockers.push(`${gate.id}: ${gate.message}`);
    else if (cls === 'warning') warnings.push(`${gate.id}: ${gate.message}`);
  }

  const decision: PdfImportReleaseDecision =
    blockers.length > 0 ? 'release_blocked'
      : warnings.length > 0 ? 'release_ready_with_warnings'
      : 'release_ready';

  return {
    version: PDF_IMPORT_RELEASE_GATE_VERSION,
    decision,
    gates,
    summary: summarizePdfImportReleaseGates(gates),
    warnings: uniq(warnings),
    blockers: uniq(blockers),
    generatedAt,
  };
}

/**
 * The canonical set of release gates for a PDF import / golden regression release,
 * all initialized to `not_run`. A caller flips each to its real status.
 */
export function getDefaultPdfImportReleaseGateDefinitions(): PdfImportReleaseGate[] {
  const g = (
    id: string,
    category: PdfImportReleaseGate['category'],
    label: string,
    message: string,
    required = true,
  ): PdfImportReleaseGate =>
    createPdfImportReleaseGate({ id, category, label, status: 'not_run', required, message });

  return [
    g('required_phase_docs_present', 'documentation', 'Phase docs present',
      'Phase 8/9 PDF import docs must be present.'),
    g('required_phase_sql_present', 'sql', 'Phase SQL files present',
      'Phase 8/9 regression SQL files must be present.'),
    g('golden_registry_json_valid', 'json', 'Golden registry JSON valid',
      'Golden corpus registry/template JSON must parse.'),
    g('golden_corpus_registry_tests', 'tests', 'Golden corpus registry tests',
      'goldenCorpusRegistry.spec.ts must pass.'),
    g('golden_corpus_runner_tests', 'tests', 'Golden corpus runner tests',
      'goldenCorpusRunEvaluator.spec.ts must pass.'),
    g('quality_gate_tests', 'tests', 'Quality gate tests',
      'pdfImportQualityGateEvaluator.spec.ts must pass.'),
    g('golden_regression_tests', 'tests', 'Golden regression tests',
      'goldenRegressionSummary/Persistence specs must pass.'),
    g('failure_triage_tests', 'tests', 'Failure triage tests',
      'pdfImportFailureTriageEvaluator.spec.ts must pass.'),
    g('orchestrator_tests', 'tests', 'Orchestrator tests',
      'goldenCorpusOrchestrator.spec.ts must pass.'),
    g('operator_console_tests', 'tests', 'Operator console tests',
      'goldenCorpusConsoleState.spec.ts must pass.'),
    g('history_tests', 'tests', 'Golden run history tests',
      'goldenRunHistory* + baseline comparison specs must pass.'),
    g('export_parity_runner_tests', 'tests', 'Export parity runner tests',
      'exportParityScore/Evidence/Runner specs must pass.'),
    g('release_gate_tests', 'tests', 'Release gate tests',
      'pdfImportReleaseGateEvaluator.spec.ts must pass.'),
    g('npm_build', 'build', 'Application build',
      'npm run build must succeed.'),
    g('private_artifact_check', 'security', 'Private artifact check',
      'No private PDFs/screenshots/logs/env/dist/config backups staged.'),
    g('phase_9e_sql_check', 'database', 'Phase 9E database release gate SQL',
      'Run pdf-import-phase-9e-release-gate-check.sql in Supabase SQL Editor.'),
    g('browser_smoke_check', 'browser', 'Browser smoke check',
      'Verify /admin/pdf-golden-regression and /admin/template-import-quality load without console errors.'),
  ];
}
