/**
 * pdfImportRetentionPolicy — Phase 11E retention policy rule catalog + windows.
 *
 * 18 canonical retention rules mapping each domain to a default decision,
 * cleanup action, safety level, and retention window. Pure data — no I/O, no
 * cleanup execution. Dry-run governance only.
 */
import {
  PDF_IMPORT_RETENTION_DOMAINS,
  type PdfImportRetentionPolicyRule,
  type PdfImportRetentionRuleId,
} from './pdfImportRetentionTypes';

export const PDF_IMPORT_RETENTION_WINDOWS_DAYS = {
  doclingArtifact: 180,
  pageManifest: 180,
  diagnosticsSuccess: 90,
  diagnosticsFailed: 180,
  visualQuality: 180,
  visualRepair: 180,
  exportParity: 180,
  goldenArtifact: 365,
  monitoringResolved: 180,
  orphanedStorageObject: 90,
} as const;

const W = PDF_IMPORT_RETENTION_WINDOWS_DAYS;

export const PDF_IMPORT_RETENTION_POLICY_RULES: PdfImportRetentionPolicyRule[] = [
  {
    retentionRuleId: 'source_pdf_retained',
    domain: 'source_pdf',
    title: 'Source PDF retained',
    description: 'Source PDFs are retained for the active lifetime of the associated import/template and are never auto-deleted.',
    defaultDecision: 'blocked',
    defaultCleanupAction: 'blocked_from_cleanup',
    defaultSafetyLevel: 'manual_only',
    retentionDays: null,
    requiresImportInactive: true,
    requiresNoOpenAlerts: true,
    requiresNoManualReview: true,
    recommendedAction: 'Never auto-delete. Handle manually only after explicit legal/operator sign-off.',
  },
  {
    retentionRuleId: 'docling_artifact_old',
    domain: 'docling_artifact',
    title: 'Docling artifact older than window',
    description: 'Staged Docling artifacts older than the retention window and not linked to golden/regression evidence.',
    defaultDecision: 'archive_candidate',
    defaultCleanupAction: 'archive_later',
    defaultSafetyLevel: 'requires_operator_approval',
    retentionDays: W.doclingArtifact,
    requiresImportInactive: false,
    requiresNoOpenAlerts: true,
    requiresNoManualReview: true,
    recommendedAction: 'Archive candidate after operator approval; retain if golden/regression linked.',
  },
  {
    retentionRuleId: 'page_manifest_old',
    domain: 'page_manifest',
    title: 'Page manifest older than window',
    description: 'Per-page manifests older than the retention window and not needed for audit/regression.',
    defaultDecision: 'archive_candidate',
    defaultCleanupAction: 'archive_later',
    defaultSafetyLevel: 'requires_operator_approval',
    retentionDays: W.pageManifest,
    requiresImportInactive: false,
    requiresNoOpenAlerts: false,
    requiresNoManualReview: true,
    recommendedAction: 'Archive candidate after operator approval.',
  },
  {
    retentionRuleId: 'diagnostics_old_success',
    domain: 'diagnostics',
    title: 'Old successful-import diagnostics',
    description: 'Diagnostics artifacts for old successful imports past the success retention window.',
    defaultDecision: 'archive_candidate',
    defaultCleanupAction: 'archive_later',
    defaultSafetyLevel: 'requires_operator_approval',
    retentionDays: W.diagnosticsSuccess,
    requiresImportInactive: false,
    requiresNoOpenAlerts: true,
    requiresNoManualReview: true,
    recommendedAction: 'Archive candidate after operator approval.',
  },
  {
    retentionRuleId: 'diagnostics_failed_import_retained',
    domain: 'diagnostics',
    title: 'Failed-import diagnostics retained',
    description: 'Diagnostics for failed imports are retained longer for triage evidence.',
    defaultDecision: 'retain',
    defaultCleanupAction: 'preserve_for_audit',
    defaultSafetyLevel: 'safe_to_recommend',
    retentionDays: W.diagnosticsFailed,
    requiresImportInactive: false,
    requiresNoOpenAlerts: false,
    requiresNoManualReview: false,
    recommendedAction: 'Retain for failure triage evidence.',
  },
  {
    retentionRuleId: 'visual_quality_old_accepted',
    domain: 'visual_quality',
    title: 'Old accepted Visual QA evidence',
    description: 'Visual QA evidence for accepted imports older than the window with no open alert / manual review.',
    defaultDecision: 'archive_candidate',
    defaultCleanupAction: 'archive_later',
    defaultSafetyLevel: 'requires_operator_approval',
    retentionDays: W.visualQuality,
    requiresImportInactive: false,
    requiresNoOpenAlerts: true,
    requiresNoManualReview: true,
    recommendedAction: 'Archive candidate after operator approval; retain if failed/manual review.',
  },
  {
    retentionRuleId: 'visual_quality_manual_review_retained',
    domain: 'visual_quality',
    title: 'Manual-review Visual QA retained',
    description: 'Visual QA evidence tied to a manual review decision is retained.',
    defaultDecision: 'retain',
    defaultCleanupAction: 'preserve_for_manual_review',
    defaultSafetyLevel: 'safe_to_recommend',
    retentionDays: null,
    requiresImportInactive: false,
    requiresNoOpenAlerts: false,
    requiresNoManualReview: false,
    recommendedAction: 'Retain — required for manual review / operator decision.',
  },
  {
    retentionRuleId: 'visual_repair_old',
    domain: 'visual_repair',
    title: 'Old visual repair artifact',
    description: 'Visual repair artifacts older than the window with no unresolved issue.',
    defaultDecision: 'review',
    defaultCleanupAction: 'mark_for_review',
    defaultSafetyLevel: 'requires_operator_approval',
    retentionDays: W.visualRepair,
    requiresImportInactive: false,
    requiresNoOpenAlerts: true,
    requiresNoManualReview: true,
    recommendedAction: 'Operator review; archive candidate if not needed.',
  },
  {
    retentionRuleId: 'visual_repair_applied_retained',
    domain: 'visual_repair',
    title: 'Applied/rejected repair retained',
    description: 'Repair artifacts tied to an applied or rejected repair decision are retained for audit.',
    defaultDecision: 'retain',
    defaultCleanupAction: 'preserve_for_audit',
    defaultSafetyLevel: 'safe_to_recommend',
    retentionDays: null,
    requiresImportInactive: false,
    requiresNoOpenAlerts: false,
    requiresNoManualReview: false,
    recommendedAction: 'Retain — repair audit evidence.',
  },
  {
    retentionRuleId: 'export_parity_old',
    domain: 'export_parity',
    title: 'Old export parity artifact',
    description: 'Export parity artifacts older than the window and not golden/release evidence.',
    defaultDecision: 'archive_candidate',
    defaultCleanupAction: 'archive_later',
    defaultSafetyLevel: 'requires_operator_approval',
    retentionDays: W.exportParity,
    requiresImportInactive: false,
    requiresNoOpenAlerts: true,
    requiresNoManualReview: true,
    recommendedAction: 'Archive candidate after operator approval.',
  },
  {
    retentionRuleId: 'export_parity_golden_retained',
    domain: 'export_parity',
    title: 'Golden/release export parity retained',
    description: 'Export parity artifacts that are golden baselines or release evidence are retained.',
    defaultDecision: 'retain',
    defaultCleanupAction: 'preserve_for_regression',
    defaultSafetyLevel: 'safe_to_recommend',
    retentionDays: null,
    requiresImportInactive: false,
    requiresNoOpenAlerts: false,
    requiresNoManualReview: false,
    recommendedAction: 'Retain — golden/regression evidence.',
  },
  {
    retentionRuleId: 'golden_history_retained',
    domain: 'golden_history',
    title: 'Golden run history retained',
    description: 'Golden run history summary rows are retained indefinitely; pruning is deferred to explicit policy review.',
    defaultDecision: 'retain',
    defaultCleanupAction: 'preserve_for_regression',
    defaultSafetyLevel: 'requires_developer_approval',
    retentionDays: null,
    requiresImportInactive: false,
    requiresNoOpenAlerts: false,
    requiresNoManualReview: false,
    recommendedAction: 'Retain summary rows; never auto-prune.',
  },
  {
    retentionRuleId: 'monitoring_event_old_resolved',
    domain: 'monitoring_events',
    title: 'Old resolved monitoring event',
    description: 'Resolved / suppressed / false-positive monitoring events older than the window.',
    defaultDecision: 'archive_candidate',
    defaultCleanupAction: 'archive_later',
    defaultSafetyLevel: 'requires_operator_approval',
    retentionDays: W.monitoringResolved,
    requiresImportInactive: false,
    requiresNoOpenAlerts: false,
    requiresNoManualReview: false,
    recommendedAction: 'Archive candidate after operator approval; active alerts retained.',
  },
  {
    retentionRuleId: 'phase10_metadata_large',
    domain: 'phase10_metadata',
    title: 'Oversized Phase 10 metadata',
    description: 'template_imports.meta larger than the compaction threshold.',
    defaultDecision: 'review',
    defaultCleanupAction: 'compact_metadata_later',
    defaultSafetyLevel: 'requires_operator_approval',
    retentionDays: null,
    requiresImportInactive: false,
    requiresNoOpenAlerts: false,
    requiresNoManualReview: false,
    recommendedAction: 'Compact metadata in a later phase after operator approval; never auto-compact.',
  },
  {
    retentionRuleId: 'operator_audit_retained',
    domain: 'operator_audit',
    title: 'Operator audit retained',
    description: 'Operator control / decision audit records are retained and never auto-deleted.',
    defaultDecision: 'retain',
    defaultCleanupAction: 'preserve_for_audit',
    defaultSafetyLevel: 'blocked',
    retentionDays: null,
    requiresImportInactive: false,
    requiresNoOpenAlerts: false,
    requiresNoManualReview: false,
    recommendedAction: 'Retain — never auto-delete operator audit records.',
  },
  {
    retentionRuleId: 'storage_object_orphaned',
    domain: 'storage_orphan',
    title: 'Orphaned storage object',
    description: 'Storage object in the artifact bucket older than the orphan window and referenced by no import/meta/golden run.',
    defaultDecision: 'delete_candidate',
    defaultCleanupAction: 'delete_later',
    defaultSafetyLevel: 'requires_developer_approval',
    retentionDays: W.orphanedStorageObject,
    requiresImportInactive: false,
    requiresNoOpenAlerts: false,
    requiresNoManualReview: false,
    recommendedAction: 'Delete candidate — requires developer approval. Dry-run only in Phase 11E.',
  },
  {
    retentionRuleId: 'metadata_reference_missing_object',
    domain: 'metadata_reference',
    title: 'Metadata reference to missing object',
    description: 'An import meta artifact path references a storage object that is missing or mismatched.',
    defaultDecision: 'review',
    defaultCleanupAction: 'repair_reference',
    defaultSafetyLevel: 'requires_operator_approval',
    retentionDays: null,
    requiresImportInactive: false,
    requiresNoOpenAlerts: false,
    requiresNoManualReview: false,
    recommendedAction: 'Investigate and repair the metadata reference; do not delete.',
  },
  {
    retentionRuleId: 'unknown_artifact_review',
    domain: 'unknown',
    title: 'Unknown artifact needs review',
    description: 'An artifact or object could not be classified and needs review.',
    defaultDecision: 'review',
    defaultCleanupAction: 'mark_for_review',
    defaultSafetyLevel: 'requires_operator_approval',
    retentionDays: null,
    requiresImportInactive: false,
    requiresNoOpenAlerts: false,
    requiresNoManualReview: false,
    recommendedAction: 'Operator review to classify before any action.',
  },
];

const RULES_BY_ID: Record<string, PdfImportRetentionPolicyRule> = Object.fromEntries(
  PDF_IMPORT_RETENTION_POLICY_RULES.map((r) => [r.retentionRuleId, r]),
);

export function listPdfImportRetentionPolicyRules(): PdfImportRetentionPolicyRule[] {
  return PDF_IMPORT_RETENTION_POLICY_RULES.slice();
}

export function getPdfImportRetentionPolicyRule(
  retentionRuleId: PdfImportRetentionRuleId | string,
): PdfImportRetentionPolicyRule | null {
  return RULES_BY_ID[retentionRuleId] ?? null;
}

const VALID_DECISIONS = new Set(['retain', 'review', 'archive_candidate', 'delete_candidate', 'blocked', 'unknown']);
const VALID_ACTIONS = new Set([
  'no_action', 'mark_for_review', 'archive_later', 'delete_later', 'compact_metadata_later',
  'repair_reference', 'preserve_for_audit', 'preserve_for_regression', 'preserve_for_manual_review', 'blocked_from_cleanup',
]);
const VALID_SAFETY = new Set(['safe_to_recommend', 'requires_operator_approval', 'requires_developer_approval', 'manual_only', 'blocked']);

export function assertPdfImportRetentionPolicyIntegrity(): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const rule of PDF_IMPORT_RETENTION_POLICY_RULES) {
    if (seen.has(rule.retentionRuleId)) errors.push(`duplicate_rule_id:${rule.retentionRuleId}`);
    seen.add(rule.retentionRuleId);
    if (!rule.domain) errors.push(`missing_domain:${rule.retentionRuleId}`);
    if (!VALID_DECISIONS.has(rule.defaultDecision)) errors.push(`invalid_decision:${rule.retentionRuleId}`);
    if (!VALID_ACTIONS.has(rule.defaultCleanupAction)) errors.push(`invalid_action:${rule.retentionRuleId}`);
    if (!VALID_SAFETY.has(rule.defaultSafetyLevel)) errors.push(`invalid_safety:${rule.retentionRuleId}`);
    if (!rule.recommendedAction || !rule.recommendedAction.trim()) errors.push(`missing_recommended_action:${rule.retentionRuleId}`);

    // Destructive (delete) candidates must never be safe_to_recommend.
    if (rule.defaultDecision === 'delete_candidate' && rule.defaultSafetyLevel === 'safe_to_recommend') {
      errors.push(`delete_candidate_safe_to_recommend:${rule.retentionRuleId}`);
    }
  }

  // Specific expectations.
  const src = RULES_BY_ID['source_pdf_retained'];
  if (!src || (src.defaultDecision !== 'blocked') || !['manual_only', 'blocked'].includes(src.defaultSafetyLevel)) {
    errors.push('source_pdf_retained_not_blocked_or_manual');
  }
  const audit = RULES_BY_ID['operator_audit_retained'];
  if (!audit || audit.defaultDecision !== 'retain') errors.push('operator_audit_retained_not_retain');
  const gh = RULES_BY_ID['golden_history_retained'];
  if (!gh || gh.defaultDecision !== 'retain') errors.push('golden_history_retained_not_retain');
  const orphan = RULES_BY_ID['storage_object_orphaned'];
  if (!orphan || orphan.defaultDecision !== 'delete_candidate' || orphan.defaultSafetyLevel !== 'requires_developer_approval') {
    errors.push('storage_object_orphaned_not_delete_candidate_developer');
  }
  const ref = RULES_BY_ID['metadata_reference_missing_object'];
  if (!ref || ref.defaultCleanupAction !== 'repair_reference') errors.push('metadata_reference_not_repair_reference');

  // Domain coverage — golden_regression is covered by golden_history + export_parity
  // evidence rules, so an uncovered domain is a warning, not a hard error.
  const covered = new Set(PDF_IMPORT_RETENTION_POLICY_RULES.map((r) => r.domain));
  for (const d of PDF_IMPORT_RETENTION_DOMAINS) {
    if (!covered.has(d)) warnings.push(`domain_not_directly_covered:${d}`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
