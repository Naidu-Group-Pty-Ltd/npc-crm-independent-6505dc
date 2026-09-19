/**
 * pdfImportRunbookDisplay — Phase 11F presentational labels + tones. Pure.
 */
import type {
  PdfImportRunbookCriticality,
  PdfImportRunbookDomain,
  PdfImportRunbookReadinessReport,
  PdfImportRunbookReadinessStatus,
} from './pdfImportRunbookTypes';

export type PdfImportRunbookDisplayTone = 'default' | 'secondary' | 'destructive' | 'outline';

const CRITICALITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

const CRITICALITY_TONES: Record<string, PdfImportRunbookDisplayTone> = {
  critical: 'destructive',
  high: 'secondary',
  medium: 'outline',
  low: 'outline',
  info: 'outline',
};

const STATUS_LABELS: Record<string, string> = {
  ready: 'Ready',
  missing: 'Missing',
  incomplete: 'Incomplete',
  needs_review: 'Needs review',
  unknown: 'Unknown',
};

const STATUS_TONES: Record<string, PdfImportRunbookDisplayTone> = {
  ready: 'default',
  missing: 'destructive',
  incomplete: 'secondary',
  needs_review: 'secondary',
  unknown: 'outline',
};

export function getPdfImportRunbookDomainLabel(domain: PdfImportRunbookDomain | string | null | undefined): string {
  const s = String(domain ?? '').replace(/_/g, ' ');
  if (!s) return 'Unknown';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function getPdfImportRunbookCriticalityLabel(criticality: PdfImportRunbookCriticality | string | null | undefined): string {
  return CRITICALITY_LABELS[String(criticality ?? '')] ?? 'Unknown';
}

export function getPdfImportRunbookCriticalityTone(criticality: PdfImportRunbookCriticality | string | null | undefined): PdfImportRunbookDisplayTone {
  return CRITICALITY_TONES[String(criticality ?? '')] ?? 'outline';
}

export function getPdfImportRunbookReadinessStatusLabel(status: PdfImportRunbookReadinessStatus | string | null | undefined): string {
  return STATUS_LABELS[String(status ?? '')] ?? 'Unknown';
}

export function getPdfImportRunbookReadinessStatusTone(status: PdfImportRunbookReadinessStatus | string | null | undefined): PdfImportRunbookDisplayTone {
  return STATUS_TONES[String(status ?? '')] ?? 'outline';
}

export function formatPdfImportRunbookReadinessScore(score: number | null | undefined): string {
  if (typeof score !== 'number' || Number.isNaN(score)) return '—/100';
  return `${Math.max(0, Math.min(100, Math.round(score)))}/100`;
}

export function getPdfImportRunbookReadinessHeadline(report: PdfImportRunbookReadinessReport | null | undefined): string {
  if (!report) return 'No runbook readiness report available';
  return `Runbook readiness ${formatPdfImportRunbookReadinessScore(report.score)} — ${report.ready}/${report.total} ready, ${report.criticalMissing} critical missing`;
}
