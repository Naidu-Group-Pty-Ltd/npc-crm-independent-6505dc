/**
 * pdfImportMonitoringDisplay — Phase 9F display helpers.
 *
 * Pure severity/status → label + shadcn Badge tone mappings for any future
 * dashboard surface. No I/O.
 */
import type {
  PdfImportMonitoringSeverity,
  PdfImportMonitoringSummary,
} from './pdfImportMonitoringTypes';

type BadgeTone = 'default' | 'secondary' | 'destructive' | 'outline';

export function getPdfImportMonitoringSeverityLabel(
  severity: PdfImportMonitoringSeverity,
): string {
  switch (severity) {
    case 'info': return 'Info';
    case 'warning': return 'Warning';
    case 'error': return 'Error';
    case 'critical': return 'Critical';
    default: return 'Unknown';
  }
}

export function getPdfImportMonitoringSeverityTone(
  severity: PdfImportMonitoringSeverity,
): BadgeTone {
  switch (severity) {
    case 'info': return 'outline';
    case 'warning': return 'secondary';
    case 'error': return 'destructive';
    case 'critical': return 'destructive';
    default: return 'outline';
  }
}

export function getPdfImportMonitoringStatusLabel(
  status: PdfImportMonitoringSummary['status'],
): string {
  switch (status) {
    case 'healthy': return 'Healthy';
    case 'warnings_present': return 'Warnings present';
    case 'errors_present': return 'Errors present';
    case 'critical_alerts_present': return 'Critical alerts present';
    case 'release_blocked': return 'Release blocked';
    default: return 'Unknown';
  }
}

export function getPdfImportMonitoringStatusTone(
  status: PdfImportMonitoringSummary['status'],
): BadgeTone {
  switch (status) {
    case 'healthy': return 'default';
    case 'warnings_present': return 'secondary';
    case 'errors_present': return 'destructive';
    case 'critical_alerts_present': return 'destructive';
    case 'release_blocked': return 'destructive';
    default: return 'outline';
  }
}
