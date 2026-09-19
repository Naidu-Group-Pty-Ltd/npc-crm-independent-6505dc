const APPEND_META_ALLOWED_KEYS = new Set([
  'provider_attempts',
  'production_operator_control_audit',
  'repair_pattern_analysis',
  'self_healing_retry_audit',
  'performance_cost_audit',
  'import_intelligence_profile',
  'ai_reconciliation_summary',
  'adaptive_reconciliation_policy',
  'golden_regression_summary',
]);

export function isAllowedTemplateImportMetaPatch(patch: unknown): patch is Record<string, unknown> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return false;
  const keys = Object.keys(patch);
  return keys.length > 0 && keys.every((key) => APPEND_META_ALLOWED_KEYS.has(key));
}

/** Private template-import artifacts must remain below their owning import prefix. */
export function isTemplateImportArtifactPathOwnedByImport(
  path: unknown,
  importId: unknown,
): path is string {
  if (typeof path !== 'string' || typeof importId !== 'string') return false;
  const trimmedPath = path.trim();
  const trimmedImportId = importId.trim();
  if (!trimmedPath || !trimmedImportId || trimmedImportId.includes('/') || trimmedImportId.includes('\\')) return false;

  const segments = trimmedPath.split('/');
  return segments[0] === trimmedImportId
    && segments.length > 1
    && segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    && !trimmedPath.includes('\\');
}
