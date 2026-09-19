/**
 * monitoringEventDisplay — Phase 11C presentational labels + tones.
 *
 * Pure display helpers for the admin monitoring dashboard. No secrets, no raw
 * content, no I/O.
 */
import {
  type MonitoringEventDomain,
  type MonitoringEventOwner,
  type MonitoringEventSeverity,
  type MonitoringEventStatus,
  type MonitoringHealthStatus,
} from './monitoringEventTypes';

/** shadcn Badge tones. */
export type MonitoringBadgeTone = 'default' | 'secondary' | 'destructive' | 'outline';

const SEVERITY_LABELS: Record<MonitoringEventSeverity, string> = {
  info: 'Info',
  warning: 'Warning',
  high: 'High',
  critical: 'Critical',
};

const SEVERITY_TONES: Record<MonitoringEventSeverity, MonitoringBadgeTone> = {
  info: 'outline',
  warning: 'secondary',
  high: 'default',
  critical: 'destructive',
};

const STATUS_LABELS: Record<MonitoringEventStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
  suppressed: 'Suppressed',
  false_positive: 'False positive',
};

const STATUS_TONES: Record<MonitoringEventStatus, MonitoringBadgeTone> = {
  open: 'destructive',
  acknowledged: 'default',
  resolved: 'outline',
  suppressed: 'secondary',
  false_positive: 'secondary',
};

const HEALTH_LABELS: Record<MonitoringHealthStatus, string> = {
  healthy: 'Healthy',
  info_present: 'Info present',
  warnings_present: 'Warnings present',
  high_alerts_present: 'High alerts present',
  critical_alerts_present: 'Critical alerts present',
};

const HEALTH_TONES: Record<MonitoringHealthStatus, MonitoringBadgeTone> = {
  healthy: 'outline',
  info_present: 'outline',
  warnings_present: 'secondary',
  high_alerts_present: 'default',
  critical_alerts_present: 'destructive',
};

const OWNER_LABELS: Record<MonitoringEventOwner, string> = {
  operator: 'Operator',
  qa: 'QA',
  manual_review: 'Manual review',
  developer_frontend: 'Frontend dev',
  developer_backend: 'Backend dev',
  developer_sidecar: 'Sidecar dev',
  developer_fullstack: 'Full-stack dev',
  security: 'Security',
  unknown: 'Unknown',
};

export function getMonitoringSeverityLabel(severity: MonitoringEventSeverity): string {
  return SEVERITY_LABELS[severity] ?? String(severity);
}

export function getMonitoringSeverityTone(severity: MonitoringEventSeverity): MonitoringBadgeTone {
  return SEVERITY_TONES[severity] ?? 'outline';
}

export function getMonitoringStatusLabel(status: MonitoringEventStatus): string {
  return STATUS_LABELS[status] ?? String(status);
}

export function getMonitoringStatusTone(status: MonitoringEventStatus): MonitoringBadgeTone {
  return STATUS_TONES[status] ?? 'outline';
}

export function getMonitoringHealthLabel(status: MonitoringHealthStatus): string {
  return HEALTH_LABELS[status] ?? String(status);
}

export function getMonitoringHealthTone(status: MonitoringHealthStatus): MonitoringBadgeTone {
  return HEALTH_TONES[status] ?? 'outline';
}

export function getMonitoringOwnerLabel(owner: MonitoringEventOwner): string {
  return OWNER_LABELS[owner] ?? String(owner);
}

/** Humanize a domain slug, e.g. `import_pipeline` → "Import pipeline". */
export function getMonitoringDomainLabel(domain: MonitoringEventDomain): string {
  const s = String(domain).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
