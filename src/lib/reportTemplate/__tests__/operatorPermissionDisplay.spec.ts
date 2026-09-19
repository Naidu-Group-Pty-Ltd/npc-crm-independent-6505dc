import { describe, expect, it } from 'vitest';
import {
  getPdfImportRoleLabel,
  getPdfImportRoleTone,
  getPdfImportCapabilityLabel,
  getPdfImportPermissionDecisionLabel,
  getPdfImportPermissionDecisionTone,
  summarizePdfImportPermissionCheck,
} from '../ingestion/operatorPermissions';

describe('permission display', () => {
  it('maps role labels', () => {
    expect(getPdfImportRoleLabel('pdf_admin')).toBe('PDF Admin');
    expect(getPdfImportRoleLabel('developer_admin')).toBe('Developer Admin');
    expect(getPdfImportRoleLabel('no_access')).toBe('No access');
    expect(getPdfImportRoleLabel(null)).toBe('No access');
  });
  it('maps role tones', () => {
    expect(getPdfImportRoleTone('pdf_admin')).toBe('default');
    expect(getPdfImportRoleTone('no_access')).toBe('destructive');
    expect(getPdfImportRoleTone('pdf_viewer')).toBe('outline');
  });
  it('humanizes capability labels', () => {
    expect(getPdfImportCapabilityLabel('pdf_import.operator.mark_accepted')).toBe('Operator · Mark accepted');
    expect(getPdfImportCapabilityLabel('pdf_import.evaluate_only')).toBe('Evaluate only');
    expect(getPdfImportCapabilityLabel(null)).toBe('Unknown capability');
  });
  it('maps decision labels', () => {
    expect(getPdfImportPermissionDecisionLabel('requires_confirmation')).toBe('Requires confirmation');
    expect(getPdfImportPermissionDecisionLabel('manual_only')).toBe('Manual only');
    expect(getPdfImportPermissionDecisionLabel('denied')).toBe('Denied');
  });
  it('maps decision tones', () => {
    expect(getPdfImportPermissionDecisionTone('allowed')).toBe('default');
    expect(getPdfImportPermissionDecisionTone('denied')).toBe('destructive');
    expect(getPdfImportPermissionDecisionTone('blocked')).toBe('destructive');
    expect(getPdfImportPermissionDecisionTone('requires_confirmation')).toBe('secondary');
    expect(getPdfImportPermissionDecisionTone('manual_only')).toBe('outline');
  });
  it('summarizes a check', () => {
    const s = summarizePdfImportPermissionCheck({ capability: 'pdf_import.evaluate_only', decision: 'allowed', allowed: true, role: 'pdf_admin', reason: 'ok', requiresConfirmation: false, manualOnly: false });
    expect(s.label).toBe('Allowed');
    expect(s.tone).toBe('default');
    expect(s.reason).toBe('ok');
  });
  it('summarizes null check as denied', () => {
    const s = summarizePdfImportPermissionCheck(null);
    expect(s.label).toBe('Denied');
    expect(s.tone).toBe('destructive');
  });
});
