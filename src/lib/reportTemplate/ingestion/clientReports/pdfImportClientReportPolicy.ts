/**
 * pdfImportClientReportPolicy — Phase 11G client-safe report policy.
 *
 * Defines the allowed report fields, the disallowed content patterns the
 * sanitizer redacts, the default audience per report type, safety-level
 * resolution, and export gating. Pure data + pure functions.
 */
import {
  type PdfImportClientReportAudience,
  type PdfImportClientReportSafetyLevel,
  type PdfImportClientReportType,
} from './pdfImportClientReportTypes';

/** Fields that MAY appear in a client-safe report payload (allow-list intent). */
export const PDF_IMPORT_CLIENT_REPORT_ALLOWED_FIELDS = [
  'importStatus',
  'templateReadiness',
  'qualityStatusLabel',
  'exportValidationStatus',
  'manualReviewRequired',
  'operatorDecision',
  'approvedOperatorNote',
  'nextAction',
  'generatedAt',
  'reviewerRoleLabel',
  'reportVersion',
  'reportName',
];

/**
 * Patterns that must never appear in a client-safe report. Each entry redacts
 * the matched substring. Ordered from most to least specific.
 */
export const PDF_IMPORT_CLIENT_REPORT_DISALLOWED_PATTERNS: Array<{
  code: string;
  pattern: RegExp;
  reason: string;
}> = [
  { code: 'service_role_key', pattern: /SUPABASE_SERVICE_ROLE_KEY/gi, reason: 'service-role secret reference' },
  { code: 'service_role', pattern: /service_role/gi, reason: 'service-role reference' },
  { code: 'signed_url_marker', pattern: /signed[-_]?url/gi, reason: 'signed URL marker' },
  { code: 'storage_objects', pattern: /storage\.objects/gi, reason: 'storage table reference' },
  { code: 'artifact_bucket', pattern: /template-import-artifacts[^\s]*/gi, reason: 'storage bucket/object path' },
  { code: 'diagnostics_bucket', pattern: /pdf-import-diagnostics[^\s]*/gi, reason: 'diagnostics bucket/object path' },
  { code: 'signed_or_token_url', pattern: /https?:\/\/[^\s]*(?:token=|signature=|x-goog-signature|\?)[^\s]*/gi, reason: 'signed/tokenized URL' },
  { code: 'http_url', pattern: /https?:\/\/[^\s)]+/gi, reason: 'external URL' },
  { code: 'stack_trace', pattern: /(?:stack trace|traceback|at\s+\w+\s*\([^)]*:\d+:\d+\))/gi, reason: 'stack trace' },
  { code: 'sql_snippet', pattern: /\b(?:select\s+.+\s+from|insert\s+into|update\s+\w+\s+set|delete\s+from)\b/gi, reason: 'SQL snippet' },
  { code: 'raw_json_dump', pattern: /\{["'][^}]{60,}\}/g, reason: 'raw JSON-like payload' },
  { code: 'env_var', pattern: /\b[A-Z][A-Z0-9_]{6,}=(?:[^\s]+)/g, reason: 'environment variable assignment' },
  { code: 'artifact_path_key', pattern: /\b\w*_artifact_path\b/gi, reason: 'artifact path reference' },
];

/** UUID pattern used to strip internal IDs from external_client reports. */
export const PDF_IMPORT_CLIENT_REPORT_UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const CLIENT_FACING_TYPES = new Set<PdfImportClientReportType>([
  'import_status_summary',
  'template_quality_summary',
  'manual_review_summary',
  'accepted_with_warnings_summary',
  'rejected_import_summary',
]);

export function getDefaultAudienceForReportType(
  reportType: PdfImportClientReportType,
): PdfImportClientReportAudience {
  if (reportType === 'production_audit_summary') return 'internal_business';
  if (reportType === 'release_readiness_summary') return 'internal_business';
  if (CLIENT_FACING_TYPES.has(reportType)) return 'external_client';
  return 'internal_operator';
}

export function resolveClientReportSafetyLevel(input: {
  audience: PdfImportClientReportAudience;
  reportType: PdfImportClientReportType;
  hasBlockedState?: boolean;
  hasUnsafeRedactions?: boolean;
  hasWarnings?: boolean;
  manualReviewRequired?: boolean;
}): PdfImportClientReportSafetyLevel {
  // Unsafe content that survived sanitization is always blocked.
  if (input.hasUnsafeRedactions) return 'blocked';

  // A blocked operator/pipeline state cannot go to a client as a clean report.
  if (input.hasBlockedState) {
    return input.audience === 'external_client' ? 'internal_only' : 'safe_with_warnings';
  }

  if (input.manualReviewRequired || input.hasWarnings) return 'safe_with_warnings';

  return 'safe';
}

export function isClientReportExportAllowed(input: {
  audience: PdfImportClientReportAudience;
  safetyLevel: PdfImportClientReportSafetyLevel;
  approved: boolean;
}): boolean {
  if (!input.approved) return false;
  if (input.safetyLevel === 'blocked' || input.safetyLevel === 'internal_only') return false;
  return input.safetyLevel === 'safe' || input.safetyLevel === 'safe_with_warnings';
}

export function assertPdfImportClientReportPolicyIntegrity(): {
  ok: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (PDF_IMPORT_CLIENT_REPORT_ALLOWED_FIELDS.length === 0) errors.push('no_allowed_fields');
  if (PDF_IMPORT_CLIENT_REPORT_DISALLOWED_PATTERNS.length === 0) errors.push('no_disallowed_patterns');

  const requiredCodes = ['signed_or_token_url', 'artifact_bucket', 'service_role', 'stack_trace', 'raw_json_dump'];
  const codes = new Set(PDF_IMPORT_CLIENT_REPORT_DISALLOWED_PATTERNS.map((p) => p.code));
  for (const c of requiredCodes) {
    if (!codes.has(c)) errors.push(`missing_disallowed_pattern:${c}`);
  }

  // Every disallowed pattern must have a reason.
  for (const p of PDF_IMPORT_CLIENT_REPORT_DISALLOWED_PATTERNS) {
    if (!p.reason || !p.reason.trim()) errors.push(`missing_reason:${p.code}`);
  }

  // Sanity: client-facing types default to external_client.
  for (const t of CLIENT_FACING_TYPES) {
    if (getDefaultAudienceForReportType(t) !== 'external_client') {
      warnings.push(`client_facing_type_not_external:${t}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
