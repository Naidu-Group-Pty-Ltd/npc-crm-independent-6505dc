import { describe, expect, it } from 'vitest';
import {
  getPdfImportProductionRolloutLockDecisionLabel,
  getPdfImportProductionRolloutLockDecisionTone,
  getPdfImportProductionRolloutModeLabel,
  getPdfImportProductionRolloutModeTone,
  getPdfImportProductionRolloutLockStatusLabel,
  getPdfImportProductionRolloutLockStatusTone,
  getPdfImportProductionRolloutLockSeverityLabel,
  getPdfImportProductionRolloutLockDomainLabel,
  formatPdfImportProductionRolloutLockScore,
  getPdfImportProductionRolloutLockHeadline,
  evaluatePdfImportProductionRolloutLock,
  type PdfImportProductionRolloutLockCheck,
} from '../ingestion/productionRolloutLock';

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

function passCheck(id: string): PdfImportProductionRolloutLockCheck {
  return {
    id, domain: 'permissions', severity: 'high', status: 'pass',
    title: 't', message: 'm', evidence: [], remediation: 'r', requiredFor: ['broad_production'],
  };
}

describe('production rollout lock display', () => {
  it('maps decision labels', () => {
    expect(getPdfImportProductionRolloutLockDecisionLabel('production_rollout_locked')).toBe('Production rollout locked');
    expect(getPdfImportProductionRolloutLockDecisionLabel('production_rollout_locked_with_conditions')).toBe('Locked with conditions');
    expect(getPdfImportProductionRolloutLockDecisionLabel('production_rollout_not_locked')).toBe('Not locked');
  });
  it('not_locked tone destructive', () => {
    expect(getPdfImportProductionRolloutLockDecisionTone('production_rollout_not_locked')).toBe('destructive');
  });
  it('locked tone default', () => {
    expect(getPdfImportProductionRolloutLockDecisionTone('production_rollout_locked')).toBe('default');
  });
  it('locked_with_conditions tone secondary', () => {
    expect(getPdfImportProductionRolloutLockDecisionTone('production_rollout_locked_with_conditions')).toBe('secondary');
  });
  it('maps rollout mode labels', () => {
    expect(getPdfImportProductionRolloutModeLabel('controlled_team_rollout')).toBe('Controlled team rollout');
    expect(getPdfImportProductionRolloutModeLabel('admin_limited')).toBe('Admin limited');
    expect(getPdfImportProductionRolloutModeLabel('internal_dev_only')).toBe('Internal dev only');
  });
  it('blocked mode tone destructive', () => {
    expect(getPdfImportProductionRolloutModeTone('blocked')).toBe('destructive');
  });
  it('broad production mode tone default', () => {
    expect(getPdfImportProductionRolloutModeTone('broad_production')).toBe('default');
  });
  it('maps status labels', () => {
    expect(getPdfImportProductionRolloutLockStatusLabel('not_applicable')).toBe('Not applicable');
    expect(getPdfImportProductionRolloutLockStatusLabel('pass')).toBe('Pass');
  });
  it('fail status tone destructive', () => {
    expect(getPdfImportProductionRolloutLockStatusTone('fail')).toBe('destructive');
    expect(getPdfImportProductionRolloutLockStatusTone('warning')).toBe('secondary');
  });
  it('maps severity labels', () => {
    expect(getPdfImportProductionRolloutLockSeverityLabel('critical')).toBe('Critical');
    expect(getPdfImportProductionRolloutLockSeverityLabel('info')).toBe('Info');
  });
  it('maps domain labels', () => {
    expect(getPdfImportProductionRolloutLockDomainLabel('client_reporting')).toBe('Client reporting');
    expect(getPdfImportProductionRolloutLockDomainLabel('rollout_scope')).toBe('Rollout scope');
  });
  it('formats score', () => {
    expect(formatPdfImportProductionRolloutLockScore(91)).toBe('91/100');
    expect(formatPdfImportProductionRolloutLockScore(null)).toBe('—');
  });
  it('headline returns no report for null', () => {
    expect(getPdfImportProductionRolloutLockHeadline(null)).toBe('No production rollout lock report');
  });
  it('headline includes decision, mode, and score', () => {
    const report = evaluatePdfImportProductionRolloutLock({ checks: [passCheck('P-1'), passCheck('P-2')], now: NOW });
    const h = getPdfImportProductionRolloutLockHeadline(report);
    expect(h).toContain('Production rollout locked');
    expect(h).toContain('Broad production');
    expect(h).toContain('/100');
  });
});
