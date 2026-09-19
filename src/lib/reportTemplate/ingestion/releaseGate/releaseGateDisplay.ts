/**
 * releaseGateDisplay — Phase 11D presentational labels + tones. Pure, no I/O.
 */
import type {
  PdfImportReleaseGateCheckStatus,
  PdfImportReleaseGateDecision,
  PdfImportReleaseGateDomain,
  PdfImportReleaseGateReport,
  PdfImportReleaseGateSeverity,
} from './releaseGateTypes';

export type PdfImportReleaseGateDisplayTone =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'outline';

const DECISION_LABELS: Record<string, string> = {
  pass: 'Pass',
  pass_with_warnings: 'Pass with warnings',
  fail: 'Fail',
  skipped: 'Skipped',
};

const DECISION_TONES: Record<string, PdfImportReleaseGateDisplayTone> = {
  pass: 'default',
  pass_with_warnings: 'secondary',
  fail: 'destructive',
  skipped: 'outline',
};

const STATUS_LABELS: Record<string, string> = {
  pass: 'Pass',
  warning: 'Warning',
  fail: 'Fail',
  skipped: 'Skipped',
  unknown: 'Unknown',
};

const STATUS_TONES: Record<string, PdfImportReleaseGateDisplayTone> = {
  pass: 'default',
  warning: 'secondary',
  fail: 'destructive',
  skipped: 'outline',
  unknown: 'outline',
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

export function getPdfImportReleaseGateDecisionLabel(
  decision: PdfImportReleaseGateDecision | string | null | undefined,
): string {
  return DECISION_LABELS[String(decision ?? '')] ?? 'Unknown';
}

export function getPdfImportReleaseGateDecisionTone(
  decision: PdfImportReleaseGateDecision | string | null | undefined,
): PdfImportReleaseGateDisplayTone {
  return DECISION_TONES[String(decision ?? '')] ?? 'outline';
}

export function getPdfImportReleaseGateStatusLabel(
  status: PdfImportReleaseGateCheckStatus | string | null | undefined,
): string {
  return STATUS_LABELS[String(status ?? '')] ?? 'Unknown';
}

export function getPdfImportReleaseGateStatusTone(
  status: PdfImportReleaseGateCheckStatus | string | null | undefined,
): PdfImportReleaseGateDisplayTone {
  return STATUS_TONES[String(status ?? '')] ?? 'outline';
}

export function getPdfImportReleaseGateSeverityLabel(
  severity: PdfImportReleaseGateSeverity | string | null | undefined,
): string {
  return SEVERITY_LABELS[String(severity ?? '')] ?? 'Unknown';
}

export function getPdfImportReleaseGateDomainLabel(
  domain: PdfImportReleaseGateDomain | string | null | undefined,
): string {
  const s = String(domain ?? '').replace(/_/g, ' ');
  if (!s) return 'Unknown';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function formatPdfImportReleaseGateScore(score: number | null | undefined): string {
  if (typeof score !== 'number' || Number.isNaN(score)) return '—/100';
  return `${Math.max(0, Math.min(100, Math.round(score)))}/100`;
}

export function getPdfImportReleaseGateHeadline(
  report: PdfImportReleaseGateReport | null | undefined,
): string {
  if (!report) return 'No release gate report available';
  return `Release gate ${getPdfImportReleaseGateDecisionLabel(report.decision)} — ${formatPdfImportReleaseGateScore(report.score)} (${report.mode})`;
}
