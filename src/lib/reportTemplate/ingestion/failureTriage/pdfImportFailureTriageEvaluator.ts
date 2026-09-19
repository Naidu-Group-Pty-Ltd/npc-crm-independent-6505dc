/**
 * pdfImportFailureTriageEvaluator — Phase 8F.
 *
 * Converts raw failure/warning signals (Phase 8C gate ids, Phase 8D golden
 * regression `warnings`/`failures`, SQL-style `fail_`/`warning_` codes, or plain
 * codes) into a prioritized triage summary. Pure logic; no I/O, no persistence.
 */
import {
  PDF_IMPORT_FAILURE_TRIAGE_VERSION,
  type PdfImportFailureSignal,
  type PdfImportFailureTriageInput,
  type PdfImportFailureTriageOwner,
  type PdfImportFailureTriageRecommendation,
  type PdfImportFailureTriageSeverity,
  type PdfImportFailureTriageSummary,
  type PdfImportRecoveryAction,
  type PdfImportTriageOutcome,
} from './pdfImportFailureTriageTypes';
import {
  getPdfImportFailureTriageRule,
  getRecoveryActionLabel,
} from './pdfImportFailureTriageRules';

const CODE_PREFIXES = ['fail_', 'warning_', 'blocked_', 'not_locked_'];

/**
 * Map Phase 8C gate ids and common code variants to canonical triage rule codes.
 * Applied after trimming, colon-splitting, and prefix-stripping.
 */
const CODE_MAP: Record<string, string> = {
  // Phase 8C gate ids → failure codes
  visual_quality_score_threshold: 'visual_quality_below_threshold',
  visual_quality_artifact_present: 'visual_quality_artifact_missing',
  repair_audit_present: 'repair_audit_missing',
  repair_final_score_threshold: 'repair_below_threshold',
  repair_status_acceptable: 'repair_failed',
  export_parity_artifact_present: 'export_parity_artifact_missing',
  export_parity_score_threshold: 'export_parity_below_threshold',
  export_parity_status_acceptable: 'export_parity_failed',
  template_created: 'template_missing',
  template_page_count_match: 'template_page_count_mismatch',
  import_completed: 'import_failed',
  manual_review_policy: 'manual_review_not_allowed',
  fallback_policy: 'fallback_not_allowed',
  engine_version_present: 'engine_version_missing',
  // Phase 8B/8D run-level code variants → canonical codes
  visual_quality_missing: 'visual_quality_artifact_missing',
  visual_quality_below_registry_minimum: 'visual_quality_below_threshold',
  repair_final_below_registry_minimum: 'repair_below_threshold',
  repair_skipped: 'repair_skipped_no_eligible_pages',
  export_parity_below_registry_minimum: 'export_parity_below_threshold',
  export_parity_not_recorded: 'export_parity_artifact_missing',
  manual_review_required: 'visual_quality_manual_review_required',
  repair_manual_review_required: 'visual_quality_manual_review_required',
  repair_manual_review_not_allowed: 'manual_review_not_allowed',
  import_missing: 'import_failed',
  template_page_count_unavailable: 'template_page_count_mismatch',
  ai_reconciliation_manual_review_not_run: 'ai_reconciliation_recommended_not_run',
};

/** Normalize a raw signal code to a canonical triage rule code. */
export function normalizeFailureCode(raw: string): string {
  let code = String(raw ?? '').trim();
  const colon = code.indexOf(':');
  if (colon >= 0) code = code.slice(0, colon).trim();
  for (const prefix of CODE_PREFIXES) {
    if (code.startsWith(prefix)) {
      code = code.slice(prefix.length);
      break;
    }
  }
  return CODE_MAP[code] ?? code;
}

/** Derive triage signals from a persisted golden regression summary's fields. */
export function extractFailureSignalsFromGoldenRegression(input: {
  warnings?: string[] | null;
  failures?: string[] | null;
  qualityGateStatus?: string | null;
  operatorDecision?: string | null;
}): PdfImportFailureSignal[] {
  const signals: PdfImportFailureSignal[] = [];
  const seen = new Set<string>();
  const push = (code: string, message?: string | null) => {
    if (!code || seen.has(code)) return;
    seen.add(code);
    signals.push({ code, message: message ?? code, source: 'golden_regression' });
  };

  for (const failure of Array.isArray(input.failures) ? input.failures : []) {
    const raw = String(failure ?? '').trim();
    if (raw) push(raw, raw);
  }
  for (const warning of Array.isArray(input.warnings) ? input.warnings : []) {
    const raw = String(warning ?? '').trim();
    if (raw) push(raw, raw);
  }

  if (input.qualityGateStatus === 'fail') push('quality_gate_failed');
  if (input.qualityGateStatus === 'blocked') push('quality_gate_blocked');
  if (input.operatorDecision === 'rejected') push('operator_rejected');
  if (input.operatorDecision === 'needs_rerun') push('operator_needs_rerun');

  return signals;
}

const SEVERITY_RANK: Record<PdfImportFailureTriageSeverity, number> = {
  critical: 4,
  error: 3,
  warning: 2,
  info: 1,
};

export function resolveHighestTriageSeverity(
  recommendations: PdfImportFailureTriageRecommendation[],
): PdfImportFailureTriageSeverity {
  let best: PdfImportFailureTriageSeverity = 'info';
  for (const rec of recommendations) {
    if (SEVERITY_RANK[rec.rule.severity] > SEVERITY_RANK[best]) best = rec.rule.severity;
  }
  return best;
}

export function resolveTriageOutcome(
  recommendations: PdfImportFailureTriageRecommendation[],
): PdfImportTriageOutcome {
  const outcomes = new Set(recommendations.map((r) => r.rule.outcome));
  if (outcomes.has('escalate')) return 'escalate';
  if (outcomes.has('blocked')) return 'blocked';
  if (outcomes.has('action_required')) return 'action_required';
  if (outcomes.has('monitor')) return 'monitor';
  return 'resolved';
}

export function resolvePrimaryOwner(
  recommendations: PdfImportFailureTriageRecommendation[],
): PdfImportFailureTriageOwner {
  return recommendations[0]?.rule.owner ?? 'unknown';
}

export function resolvePrimaryAction(
  recommendations: PdfImportFailureTriageRecommendation[],
): PdfImportRecoveryAction {
  return recommendations[0]?.rule.primaryAction ?? 'no_action';
}

export function evaluatePdfImportFailureTriage(
  input: PdfImportFailureTriageInput,
): PdfImportFailureTriageSummary {
  const now = (input.now ?? (() => new Date()))();
  const generatedAt = now.toISOString();
  const signals = Array.isArray(input.signals) ? input.signals : [];

  if (signals.length === 0) {
    return {
      version: PDF_IMPORT_FAILURE_TRIAGE_VERSION,
      recommendations: [],
      severity: 'info',
      outcome: 'resolved',
      primaryOwner: 'operator',
      primaryAction: 'no_action',
      actionLabels: ['No action'],
      generatedAt,
    };
  }

  // Build recommendations, deduplicated by normalized rule code (first wins).
  const byCode = new Map<string, PdfImportFailureTriageRecommendation>();
  for (const signal of signals) {
    const code = normalizeFailureCode(signal.code);
    const rule = getPdfImportFailureTriageRule(code);
    if (!byCode.has(rule.code)) {
      byCode.set(rule.code, { version: PDF_IMPORT_FAILURE_TRIAGE_VERSION, signal, rule });
    }
  }

  // Sort by descending severity (stable — preserves insertion order within a tier).
  const recommendations = [...byCode.values()].sort(
    (a, b) => SEVERITY_RANK[b.rule.severity] - SEVERITY_RANK[a.rule.severity],
  );

  // Dedupe action labels across primary + secondary actions, in priority order.
  const actionLabels: string[] = [];
  for (const rec of recommendations) {
    for (const action of [rec.rule.primaryAction, ...rec.rule.secondaryActions]) {
      const label = getRecoveryActionLabel(action);
      if (!actionLabels.includes(label)) actionLabels.push(label);
    }
  }

  return {
    version: PDF_IMPORT_FAILURE_TRIAGE_VERSION,
    recommendations,
    severity: resolveHighestTriageSeverity(recommendations),
    outcome: resolveTriageOutcome(recommendations),
    primaryOwner: resolvePrimaryOwner(recommendations),
    primaryAction: resolvePrimaryAction(recommendations),
    actionLabels,
    generatedAt,
  };
}
