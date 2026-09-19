/**
 * pdfImportClientReportBuilder — Phase 11G deterministic report builder.
 *
 * Builds a client-safe report payload from existing import state using fixed,
 * deterministic wording (NO AI). Always runs the sanitizer + unsafe detector
 * before returning, and downgrades the safety level when unsafe content or
 * blocked/critical states are present.
 */
import {
  getDefaultAudienceForReportType,
  resolveClientReportSafetyLevel,
} from './pdfImportClientReportPolicy';
import {
  detectUnsafeClientReportContent,
  sanitizeClientReportPayload,
} from './pdfImportClientReportSanitizer';
import {
  PDF_IMPORT_CLIENT_REPORT_VERSION,
  type BuildPdfImportClientReportOptions,
  type PdfImportClientReportPayload,
  type PdfImportClientReportSection,
} from './pdfImportClientReportTypes';

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function readPath(source: unknown, path: string[]): unknown {
  let cur: unknown = source;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}
function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

const REPORT_TYPE_LABELS: Record<string, string> = {
  import_status_summary: 'Template Import Status Summary',
  template_quality_summary: 'Template Quality Summary',
  manual_review_summary: 'Manual Review Summary',
  accepted_with_warnings_summary: 'Accepted With Warnings Summary',
  rejected_import_summary: 'Import Rejected Summary',
  production_audit_summary: 'Production Audit Summary',
  release_readiness_summary: 'Release Readiness Summary',
};

const DECISION_WORDING: Record<string, string> = {
  accepted: 'The template import passed quality review and is ready for use.',
  accepted_with_warnings: 'The template import has been accepted with minor layout warnings that do not block use.',
  rejected: 'The import did not meet quality requirements and requires rework.',
  needs_rerun: 'The import needs to be re-run before it can be approved.',
  manual_review_required: 'The template requires manual review before it can be approved.',
  blocked: 'The import is on hold pending internal review.',
  not_reviewed: 'The import has not yet been reviewed.',
};

const QUALITY_WORDING: Record<string, string> = {
  pass: 'Quality checks passed.',
  warning: 'Quality checks passed with minor warnings.',
  fail: 'Quality checks did not pass.',
  blocked: 'Quality checks are on hold.',
  not_evaluated: 'Quality checks have not been evaluated yet.',
};

const EXPORT_WORDING: Record<string, string> = {
  completed: 'Export validation completed successfully.',
  partial: 'Export validation partially completed.',
  manual_required: 'Export validation requires manual review.',
  failed: 'Export validation did not pass.',
  not_ready: 'Export validation is pending.',
  missing: 'Export validation is pending.',
};

function operatorDecision(o: BuildPdfImportClientReportOptions): string | null {
  return (
    str(readPath(o.productionOperatorControlAudit, ['operatorState', 'decision'])) ??
    str(readPath(o.snapshot, ['operatorState', 'decision']))
  );
}
function qualityGateStatus(o: BuildPdfImportClientReportOptions): string | null {
  return (
    str(readPath(o.goldenRegressionSummary, ['qualityGateStatus'])) ??
    str(readPath(o.snapshot, ['qualityGateStatus']))
  );
}
function exportParityStatus(o: BuildPdfImportClientReportOptions): string | null {
  return str(readPath(o.exportParitySummary, ['status']));
}
function manualReviewRequired(o: BuildPdfImportClientReportOptions): boolean {
  return (
    readPath(o.productionOperatorControlAudit, ['operatorState', 'manualReviewRequired']) === true ||
    readPath(o.visualQualitySummary, ['manualReviewRequired']) === true
  );
}
function isBlockedState(o: BuildPdfImportClientReportOptions): boolean {
  return (
    readPath(o.productionOperatorControlAudit, ['operatorState', 'blocked']) === true ||
    str(readPath(o.adaptiveReconciliationPolicy, ['decision'])) === 'blocked'
  );
}
function hasActiveCriticalMonitoring(o: BuildPdfImportClientReportOptions): boolean {
  const events = Array.isArray(o.monitoringEvents) ? o.monitoringEvents : [];
  return events.some((e) => {
    const r = asRecord(e);
    return String(r.severity ?? '') === 'critical' && ['open', 'acknowledged'].includes(String(r.status ?? ''));
  });
}

export function buildClientReportTitle(options: BuildPdfImportClientReportOptions): string {
  return REPORT_TYPE_LABELS[options.reportType] ?? 'PDF Import Report';
}

export function buildClientReportSummary(options: BuildPdfImportClientReportOptions): string {
  const decision = operatorDecision(options);
  if (options.reportType === 'manual_review_summary' || manualReviewRequired(options)) {
    return DECISION_WORDING.manual_review_required;
  }
  if (options.reportType === 'rejected_import_summary') return DECISION_WORDING.rejected;
  if (options.reportType === 'accepted_with_warnings_summary') return DECISION_WORDING.accepted_with_warnings;
  if (decision && DECISION_WORDING[decision]) return DECISION_WORDING[decision];
  return 'This summary describes the current status of the template import quality workflow.';
}

export function buildClientReportSections(options: BuildPdfImportClientReportOptions): PdfImportClientReportSection[] {
  const audience = options.audience ?? getDefaultAudienceForReportType(options.reportType);
  const decision = operatorDecision(options);
  const gate = qualityGateStatus(options);
  const parity = exportParityStatus(options);
  const manual = manualReviewRequired(options);
  const blocked = isBlockedState(options);
  const now = (options.now ?? (() => new Date()))();

  const sections: PdfImportClientReportSection[] = [];

  sections.push({
    id: 'overview',
    title: 'Overview',
    body: `This is a ${REPORT_TYPE_LABELS[options.reportType] ?? 'summary'} generated on ${now.toISOString().slice(0, 10)}.`,
    status: 'info',
    items: [],
  });

  sections.push({
    id: 'quality_review',
    title: 'Quality Review',
    body: gate ? (QUALITY_WORDING[gate] ?? 'Quality checks have been reviewed.') : 'Quality checks have been reviewed.',
    status: gate === 'fail' || gate === 'blocked' ? 'fail' : gate === 'warning' ? 'warning' : gate === 'pass' ? 'pass' : 'info',
    items: [],
  });

  sections.push({
    id: 'export_validation',
    title: 'Export Validation',
    body: parity ? (EXPORT_WORDING[parity] ?? 'Export validation is pending.') : 'Export validation is pending.',
    status: parity === 'failed' ? 'fail' : parity === 'manual_required' ? 'warning' : parity === 'completed' ? 'pass' : 'info',
    items: [],
  });

  sections.push({
    id: 'operator_decision',
    title: 'Operator Decision',
    body: decision ? (DECISION_WORDING[decision] ?? 'The import has been reviewed.') : 'The import has been reviewed.',
    status: decision === 'rejected' || decision === 'blocked' ? 'fail' : decision === 'accepted_with_warnings' || decision === 'manual_review_required' ? 'warning' : decision === 'accepted' ? 'pass' : 'info',
    items: [],
  });

  sections.push({
    id: 'manual_review',
    title: 'Manual Review',
    body: manual ? 'Manual review is required before this template can be approved.' : 'No manual review is required at this time.',
    status: manual ? 'warning' : 'pass',
    items: [],
  });

  const warnings: string[] = [];
  if (gate === 'warning') warnings.push('Minor quality warnings are present.');
  if (parity === 'manual_required') warnings.push('Export validation needs a manual check.');
  if (manual) warnings.push('A manual review step is pending.');
  sections.push({
    id: 'warnings_limitations',
    title: 'Warnings and Limitations',
    body: warnings.length ? 'The following client-safe warnings apply:' : 'No client-relevant warnings are present.',
    status: warnings.length ? 'warning' : 'pass',
    items: warnings,
  });

  let nextAction = 'The template is ready for use.';
  if (blocked) nextAction = 'The import is on hold pending internal review.';
  else if (decision === 'rejected' || decision === 'needs_rerun') nextAction = 'The import requires rework before it can be approved.';
  else if (manual || decision === 'manual_review_required') nextAction = 'A manual review is pending before approval.';
  else if (parity === 'manual_required' || parity === 'not_ready' || parity === 'missing') nextAction = 'Export validation is pending before final approval.';
  else if (decision === 'accepted_with_warnings') nextAction = 'The template is ready for use; minor warnings have been noted.';
  sections.push({ id: 'next_action', title: 'Next Action', body: nextAction, status: 'info', items: [] });

  // Approved operator note (client-safe).
  if (options.operatorNote && String(options.operatorNote).trim()) {
    sections.push({ id: 'operator_note', title: 'Operator Note', body: String(options.operatorNote), status: 'info', items: [] });
  }

  // Internal audiences may see limited high-level context (no raw evidence).
  if (audience !== 'external_client') {
    const perfRisk = str(readPath(options.performanceCostAudit, ['riskLevel'])) ?? str(readPath(options.performanceCostAudit, ['overallRisk']));
    if (perfRisk) {
      sections.push({ id: 'performance_context', title: 'Performance Context (internal)', body: `Performance/cost risk level: ${perfRisk}.`, status: 'info', items: [] });
    }
    const monitoringCount = Array.isArray(options.monitoringEvents) ? options.monitoringEvents.length : 0;
    const retentionCount = Array.isArray(options.retentionEvents) ? options.retentionEvents.length : 0;
    if (monitoringCount || retentionCount) {
      sections.push({
        id: 'operational_context',
        title: 'Operational Context (internal)',
        body: 'High-level operational counts (no evidence details).',
        status: 'info',
        items: [
          `Related monitoring signals: ${monitoringCount}`,
          `Related retention candidates: ${retentionCount}`,
        ],
      });
    }
  }

  sections.push({
    id: 'audit_statement',
    title: 'Audit Statement',
    body: 'This summary was generated from the internal PDF import quality workflow. It contains no raw PDF content, screenshots, signed URLs, storage paths, or logs.',
    status: 'info',
    items: [],
  });

  return sections;
}

export function buildPdfImportClientReport(
  options: BuildPdfImportClientReportOptions,
): PdfImportClientReportPayload {
  const now = options.now ?? (() => new Date());
  const audience = options.audience ?? getDefaultAudienceForReportType(options.reportType);
  const decision = operatorDecision(options);
  const gate = qualityGateStatus(options);
  const parity = exportParityStatus(options);
  const manual = manualReviewRequired(options);
  const blocked = isBlockedState(options);
  const criticalMonitoring = hasActiveCriticalMonitoring(options);

  const generatedFrom: string[] = [];
  if (options.productionOperatorControlAudit) generatedFrom.push('operator_control_audit');
  if (options.goldenRegressionSummary) generatedFrom.push('golden_regression_summary');
  if (options.exportParitySummary) generatedFrom.push('export_parity_summary');
  if (options.visualQualitySummary) generatedFrom.push('visual_quality_summary');

  const rawPayload: PdfImportClientReportPayload = {
    version: PDF_IMPORT_CLIENT_REPORT_VERSION,
    reportType: options.reportType,
    audience,
    safetyLevel: 'safe',
    status: 'draft',
    importId: options.importId ?? null,
    templateId: options.templateId ?? null,
    title: buildClientReportTitle(options),
    summary: buildClientReportSummary(options),
    sections: buildClientReportSections({ ...options, audience }),
    redactions: [],
    sourceSummary: {
      operatorDecision: decision,
      qualityGateStatus: gate,
      exportParityStatus: parity,
      manualReviewRequired: manual,
      generatedFrom,
    },
    generatedAt: now().toISOString(),
  };

  // Sanitize, then detect any remaining unsafe content.
  const sanitized = sanitizeClientReportPayload(rawPayload);
  const detection = detectUnsafeClientReportContent({ payload: sanitized });

  let safetyLevel = resolveClientReportSafetyLevel({
    audience,
    reportType: options.reportType,
    hasBlockedState: blocked,
    hasUnsafeRedactions: !detection.safe,
    hasWarnings: gate === 'warning' || parity === 'manual_required',
    manualReviewRequired: manual,
  });

  // Active critical monitoring is never client-safe.
  if (criticalMonitoring && audience === 'external_client' && safetyLevel !== 'blocked') {
    safetyLevel = 'internal_only';
  }

  return { ...sanitized, safetyLevel };
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildPdfImportClientReportMarkdown(payload: PdfImportClientReportPayload): string {
  const lines: string[] = [];
  lines.push(`# ${payload.title}`, '');
  lines.push(`_Audience: ${payload.audience} · Safety: ${payload.safetyLevel} · Generated: ${payload.generatedAt}_`, '');
  lines.push(payload.summary, '');
  for (const s of payload.sections) {
    lines.push(`## ${s.title}`, '');
    if (s.body) lines.push(s.body, '');
    for (const item of s.items) lines.push(`- ${item}`);
    if (s.items.length) lines.push('');
  }
  if (payload.redactions.length) {
    lines.push('## Redactions', '', `${payload.redactions.length} field(s) were redacted for safety.`, '');
  }
  return lines.join('\n');
}

export function buildPdfImportClientReportHtml(payload: PdfImportClientReportPayload): string {
  const parts: string[] = [];
  parts.push(`<article class="pdf-import-client-report">`);
  parts.push(`<h1>${escapeHtml(payload.title)}</h1>`);
  parts.push(`<p class="meta">Audience: ${escapeHtml(payload.audience)} · Safety: ${escapeHtml(payload.safetyLevel)} · Generated: ${escapeHtml(payload.generatedAt)}</p>`);
  parts.push(`<p>${escapeHtml(payload.summary)}</p>`);
  for (const s of payload.sections) {
    parts.push(`<section><h2>${escapeHtml(s.title)}</h2>`);
    if (s.body) parts.push(`<p>${escapeHtml(s.body)}</p>`);
    if (s.items.length) {
      parts.push('<ul>');
      for (const item of s.items) parts.push(`<li>${escapeHtml(item)}</li>`);
      parts.push('</ul>');
    }
    parts.push('</section>');
  }
  parts.push('</article>');
  return parts.join('');
}
