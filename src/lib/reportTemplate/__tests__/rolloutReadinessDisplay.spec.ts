import { describe, expect, it } from 'vitest';
import {
  getPdfImportRolloutDecisionLabel,
  getPdfImportRolloutDecisionTone,
  getPdfImportRolloutModeLabel,
  getPdfImportRolloutModeTone,
  getPdfImportRolloutReadinessStatusLabel,
  getPdfImportRolloutReadinessStatusTone,
  getPdfImportRolloutReadinessSeverityLabel,
  getPdfImportRolloutReadinessDomainLabel,
  formatPdfImportRolloutReadinessScore,
  getPdfImportRolloutReadinessHeadline,
  evaluatePdfImportRolloutReadiness,
  type PdfImportRolloutReadinessCheck,
} from '../ingestion/rolloutReadiness';

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

function passCheck(id: string): PdfImportRolloutReadinessCheck {
  return { id, domain: 'phase10_lock', title: 't', description: 'd', severity: 'high', status: 'pass', evidence: [], requiredFor: ['admin_limited'], remediation: 'r', targetPhase: '11A' };
}

describe('rollout readiness display', () => {
  it('maps decision labels', () => {
    expect(getPdfImportRolloutDecisionLabel('rollout_ready')).toBe('Rollout ready');
    expect(getPdfImportRolloutDecisionLabel('rollout_ready_with_conditions')).toBe('Rollout ready with conditions');
    expect(getPdfImportRolloutDecisionLabel('rollout_not_ready')).toBe('Rollout not ready');
  });
  it('rollout_not_ready tone destructive', () => {
    expect(getPdfImportRolloutDecisionTone('rollout_not_ready')).toBe('destructive');
  });
  it('rollout_ready tone default', () => {
    expect(getPdfImportRolloutDecisionTone('rollout_ready')).toBe('default');
  });
  it('rollout_ready_with_conditions tone secondary', () => {
    expect(getPdfImportRolloutDecisionTone('rollout_ready_with_conditions')).toBe('secondary');
  });
  it('maps mode labels', () => {
    expect(getPdfImportRolloutModeLabel('admin_limited')).toBe('Admin limited');
    expect(getPdfImportRolloutModeLabel('controlled_team_rollout')).toBe('Controlled team rollout');
    expect(getPdfImportRolloutModeLabel('broad_production')).toBe('Broad production');
  });
  it('blocked mode tone destructive', () => {
    expect(getPdfImportRolloutModeTone('blocked')).toBe('destructive');
  });
  it('broad_production mode tone default', () => {
    expect(getPdfImportRolloutModeTone('broad_production')).toBe('default');
  });
  it('admin_limited mode tone secondary', () => {
    expect(getPdfImportRolloutModeTone('admin_limited')).toBe('secondary');
  });
  it('maps status labels', () => {
    expect(getPdfImportRolloutReadinessStatusLabel('not_applicable')).toBe('Not applicable');
    expect(getPdfImportRolloutReadinessStatusLabel('pass')).toBe('Pass');
  });
  it('fail status tone destructive', () => {
    expect(getPdfImportRolloutReadinessStatusTone('fail')).toBe('destructive');
  });
  it('warning status tone secondary', () => {
    expect(getPdfImportRolloutReadinessStatusTone('warning')).toBe('secondary');
    expect(getPdfImportRolloutReadinessStatusTone('unknown')).toBe('secondary');
  });
  it('maps severity labels', () => {
    expect(getPdfImportRolloutReadinessSeverityLabel('critical')).toBe('Critical');
    expect(getPdfImportRolloutReadinessSeverityLabel('info')).toBe('Info');
  });
  it('maps domain labels', () => {
    expect(getPdfImportRolloutReadinessDomainLabel('monitoring_alerting')).toBe('Monitoring / alerting');
    expect(getPdfImportRolloutReadinessDomainLabel('rollout_scope')).toBe('Rollout scope');
  });
  it('formats score', () => {
    expect(formatPdfImportRolloutReadinessScore(91)).toBe('91/100');
    expect(formatPdfImportRolloutReadinessScore(null)).toBe('—');
  });
  it('headline returns no report for null', () => {
    expect(getPdfImportRolloutReadinessHeadline(null)).toBe('No rollout readiness report');
  });
  it('headline includes decision, mode, and score', () => {
    const report = evaluatePdfImportRolloutReadiness({ checks: [passCheck('P-1'), passCheck('P-2')], now: NOW });
    const h = getPdfImportRolloutReadinessHeadline(report);
    expect(h).toContain('Rollout ready');
    expect(h).toContain('/100');
  });
});
