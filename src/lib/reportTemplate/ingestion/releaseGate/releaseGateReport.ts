/**
 * releaseGateReport — Phase 11D report builders + validator.
 *
 * Renders a release gate report as Markdown or pretty JSON, and validates a
 * report's shape. Pure — no I/O, no secrets.
 */
import {
  PDF_IMPORT_RELEASE_GATE_CHECK_STATUSES,
  PDF_IMPORT_RELEASE_GATE_VERSION,
  type PdfImportReleaseGateCheck,
  type PdfImportReleaseGateReport,
} from './releaseGateTypes';

const VALID_DECISIONS = ['pass', 'pass_with_warnings', 'fail', 'skipped'];
const VALID_MODES = ['static', 'live', 'full'];

function escapeCell(value: string): string {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function checksTable(checks: PdfImportReleaseGateCheck[]): string {
  const header = '| ID | Domain | Status | Severity | Message |\n|---|---|---|---|---|';
  const rows = checks.map(
    (c) => `| ${escapeCell(c.id)} | ${c.domain} | ${c.status} | ${c.severity} | ${escapeCell(c.message)} |`,
  );
  return [header, ...rows].join('\n');
}

export function buildPdfImportReleaseGateMarkdownReport(
  report: PdfImportReleaseGateReport,
): string {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const criticalFailures = checks.filter((c) => c.status === 'fail' && c.severity === 'critical');
  const warnings = checks.filter((c) => c.status === 'warning' || c.status === 'unknown');

  const lines: string[] = [];
  lines.push('# PDF Import Release Gate Report');
  lines.push('');
  lines.push(`- **Decision:** ${report.decision}`);
  lines.push(`- **Mode:** ${report.mode}`);
  lines.push(`- **Score:** ${report.score}/100`);
  lines.push(`- **Generated At:** ${report.generatedAt}`);
  lines.push(`- **Branch:** ${report.branch ?? '(unknown)'}`);
  lines.push(`- **Commit:** ${report.commit ?? '(unknown)'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(
    `total ${report.summary.total} · pass ${report.summary.pass} · warning ${report.summary.warning} · ` +
      `fail ${report.summary.fail} · skipped ${report.summary.skipped} · unknown ${report.summary.unknown} · ` +
      `critical failures ${report.summary.criticalFailures} · high failures ${report.summary.highFailures}`,
  );
  lines.push('');
  lines.push('## Critical Failures');
  lines.push('');
  if (criticalFailures.length === 0) {
    lines.push('_None._');
  } else {
    for (const c of criticalFailures) lines.push(`- **${c.id}** — ${c.message} (${c.remediation})`);
  }
  lines.push('');
  lines.push('## Warnings');
  lines.push('');
  if (warnings.length === 0) {
    lines.push('_None._');
  } else {
    for (const c of warnings) lines.push(`- **${c.id}** (${c.status}) — ${c.message}`);
  }
  lines.push('');
  lines.push('## Check Results');
  lines.push('');
  lines.push(checksTable(checks));
  lines.push('');
  return lines.join('\n');
}

export function buildPdfImportReleaseGateJsonReport(
  report: PdfImportReleaseGateReport,
): string {
  return JSON.stringify(report, null, 2);
}

export function validatePdfImportReleaseGateReport(
  report: PdfImportReleaseGateReport,
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!report || typeof report !== 'object') {
    return { ok: false, errors: ['report_not_object'], warnings };
  }
  if (report.version !== PDF_IMPORT_RELEASE_GATE_VERSION) errors.push('invalid_version');
  if (!VALID_MODES.includes(report.mode as string)) errors.push('invalid_mode');
  if (!VALID_DECISIONS.includes(report.decision as string)) errors.push('invalid_decision');
  if (typeof report.score !== 'number' || report.score < 0 || report.score > 100) errors.push('invalid_score');
  if (!Array.isArray(report.checks)) {
    errors.push('missing_checks');
  } else {
    report.checks.forEach((c, i) => {
      if (!c || typeof c !== 'object') { errors.push(`invalid_check:${i}`); return; }
      if (!c.id) errors.push(`check_missing_id:${i}`);
      if (!PDF_IMPORT_RELEASE_GATE_CHECK_STATUSES.includes(c.status)) errors.push(`check_invalid_status:${c.id ?? i}`);
    });
  }
  if (!report.summary || typeof report.summary !== 'object') errors.push('missing_summary');
  if (!report.generatedAt) errors.push('missing_generatedAt');

  if (Array.isArray(report.checks)) {
    if (report.checks.some((c) => c.status === 'unknown')) warnings.push('unresolved_unknown_checks');
  }

  return { ok: errors.length === 0, errors, warnings };
}
