import { describe, expect, it } from 'vitest';
import {
  MONITORING_EVENT_SEVERITIES,
  MONITORING_EVENT_STATUSES,
  getMonitoringDomainLabel,
  getMonitoringHealthLabel,
  getMonitoringHealthTone,
  getMonitoringOwnerLabel,
  getMonitoringSeverityLabel,
  getMonitoringSeverityTone,
  getMonitoringStatusLabel,
  getMonitoringStatusTone,
} from '../ingestion/monitoring';

describe('monitoringEventDisplay', () => {
  it('labels every severity and status', () => {
    for (const s of MONITORING_EVENT_SEVERITIES) expect(getMonitoringSeverityLabel(s)).toBeTruthy();
    for (const s of MONITORING_EVENT_STATUSES) expect(getMonitoringStatusLabel(s)).toBeTruthy();
  });

  it('maps critical → destructive and healthy → outline tones', () => {
    expect(getMonitoringSeverityTone('critical')).toBe('destructive');
    expect(getMonitoringSeverityTone('info')).toBe('outline');
    expect(getMonitoringStatusTone('open')).toBe('destructive');
    expect(getMonitoringHealthTone('healthy')).toBe('outline');
    expect(getMonitoringHealthTone('critical_alerts_present')).toBe('destructive');
  });

  it('humanizes domain slugs and health labels', () => {
    expect(getMonitoringDomainLabel('import_pipeline')).toBe('Import pipeline');
    expect(getMonitoringDomainLabel('security_privacy')).toBe('Security privacy');
    expect(getMonitoringHealthLabel('warnings_present')).toBe('Warnings present');
    expect(getMonitoringOwnerLabel('developer_fullstack')).toBe('Full-stack dev');
  });
});
