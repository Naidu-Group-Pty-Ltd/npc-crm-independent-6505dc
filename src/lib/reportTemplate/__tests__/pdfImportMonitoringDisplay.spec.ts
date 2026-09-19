import { describe, expect, it } from 'vitest';
import {
  getPdfImportMonitoringSeverityLabel,
  getPdfImportMonitoringSeverityTone,
  getPdfImportMonitoringStatusLabel,
  getPdfImportMonitoringStatusTone,
} from '../ingestion/monitoring';

describe('monitoring display helpers', () => {
  it('maps severity labels for info/warning/error/critical', () => {
    expect(getPdfImportMonitoringSeverityLabel('info')).toBe('Info');
    expect(getPdfImportMonitoringSeverityLabel('warning')).toBe('Warning');
    expect(getPdfImportMonitoringSeverityLabel('error')).toBe('Error');
    expect(getPdfImportMonitoringSeverityLabel('critical')).toBe('Critical');
  });

  it('maps critical severity tone to destructive', () => {
    expect(getPdfImportMonitoringSeverityTone('critical')).toBe('destructive');
    expect(getPdfImportMonitoringSeverityTone('info')).toBe('outline');
  });

  it('maps the release_blocked status label', () => {
    expect(getPdfImportMonitoringStatusLabel('release_blocked')).toBe('Release blocked');
  });

  it('maps release_blocked status tone to destructive', () => {
    expect(getPdfImportMonitoringStatusTone('release_blocked')).toBe('destructive');
  });

  it('maps healthy status tone to default', () => {
    expect(getPdfImportMonitoringStatusTone('healthy')).toBe('default');
  });
});
