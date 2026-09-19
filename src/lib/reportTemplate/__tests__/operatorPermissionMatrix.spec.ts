import { describe, expect, it } from 'vitest';
import {
  PDF_IMPORT_ROLES,
  PDF_IMPORT_CAPABILITIES,
  PDF_IMPORT_ROLE_CAPABILITY_MATRIX,
  getPdfImportCapabilitiesForRole,
  roleHasPdfImportCapability,
  buildPdfImportPermissionPolicy,
  assertPdfImportPermissionMatrixIntegrity,
} from '../ingestion/operatorPermissions';

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

describe('permission matrix', () => {
  it('includes all 7 canonical roles', () => {
    expect(PDF_IMPORT_ROLES).toEqual([
      'no_access', 'pdf_viewer', 'pdf_operator', 'pdf_qa_operator', 'pdf_admin', 'developer_admin', 'system_service',
    ]);
  });
  it('no_access has zero capabilities', () => {
    expect(getPdfImportCapabilitiesForRole('no_access')).toEqual([]);
  });
  it('pdf_viewer cannot evaluate', () => {
    expect(roleHasPdfImportCapability('pdf_viewer', 'pdf_import.evaluate_only')).toBe(false);
  });
  it('pdf_operator can evaluate but cannot append_meta/persist', () => {
    expect(roleHasPdfImportCapability('pdf_operator', 'pdf_import.evaluate_only')).toBe(true);
    expect(roleHasPdfImportCapability('pdf_operator', 'pdf_import.append_meta')).toBe(false);
    expect(roleHasPdfImportCapability('pdf_operator', 'pdf_import.persist_import_intelligence')).toBe(false);
  });
  it('pdf_qa_operator can mark manual review + add note but not accept', () => {
    expect(roleHasPdfImportCapability('pdf_qa_operator', 'pdf_import.operator.mark_manual_review_required')).toBe(true);
    expect(roleHasPdfImportCapability('pdf_qa_operator', 'pdf_import.operator.add_note')).toBe(true);
    expect(roleHasPdfImportCapability('pdf_qa_operator', 'pdf_import.operator.mark_accepted')).toBe(false);
  });
  it('pdf_admin can persist and mark accepted/rejected/blocked', () => {
    for (const c of [
      'pdf_import.persist_import_intelligence', 'pdf_import.persist_operator_control_audit', 'pdf_import.append_meta',
      'pdf_import.operator.mark_accepted', 'pdf_import.operator.mark_rejected', 'pdf_import.operator.mark_blocked',
      'pdf_import.run_self_healing_execute_safe', 'pdf_import.view_diagnostics',
    ] as const) {
      expect(roleHasPdfImportCapability('pdf_admin', c)).toBe(true);
    }
  });
  it('pdf_admin does not have developer or system capabilities', () => {
    expect(roleHasPdfImportCapability('pdf_admin', 'pdf_import.developer.inspect_logs')).toBe(false);
    expect(roleHasPdfImportCapability('pdf_admin', 'pdf_import.system.finalize_import')).toBe(false);
    expect(roleHasPdfImportCapability('pdf_admin', 'pdf_import.view_engine_admin')).toBe(false);
  });
  it('developer_admin has all admin caps plus developer diagnostics', () => {
    for (const c of getPdfImportCapabilitiesForRole('pdf_admin')) {
      expect(roleHasPdfImportCapability('developer_admin', c)).toBe(true);
    }
    expect(roleHasPdfImportCapability('developer_admin', 'pdf_import.developer.inspect_logs')).toBe(true);
    expect(roleHasPdfImportCapability('developer_admin', 'pdf_import.view_engine_admin')).toBe(true);
  });
  it('developer_admin has no system capabilities', () => {
    expect(roleHasPdfImportCapability('developer_admin', 'pdf_import.system.finalize_import')).toBe(false);
  });
  it('system_service has only system capabilities', () => {
    const caps = getPdfImportCapabilitiesForRole('system_service');
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.every((c) => c.startsWith('pdf_import.system.'))).toBe(true);
  });
  it('roles escalate cumulatively (viewer ⊂ operator ⊂ qa ⊂ admin ⊂ developer)', () => {
    const subset = (a: string[], b: string[]) => a.every((x) => b.includes(x));
    expect(subset(getPdfImportCapabilitiesForRole('pdf_viewer'), getPdfImportCapabilitiesForRole('pdf_operator'))).toBe(true);
    expect(subset(getPdfImportCapabilitiesForRole('pdf_operator'), getPdfImportCapabilitiesForRole('pdf_qa_operator'))).toBe(true);
    expect(subset(getPdfImportCapabilitiesForRole('pdf_qa_operator'), getPdfImportCapabilitiesForRole('pdf_admin'))).toBe(true);
    expect(subset(getPdfImportCapabilitiesForRole('pdf_admin'), getPdfImportCapabilitiesForRole('developer_admin'))).toBe(true);
  });
  it('capability list has no duplicates and covers matrix', () => {
    expect(new Set(PDF_IMPORT_CAPABILITIES).size).toBe(PDF_IMPORT_CAPABILITIES.length);
    for (const role of PDF_IMPORT_ROLES) {
      for (const c of PDF_IMPORT_ROLE_CAPABILITY_MATRIX[role]) {
        expect(PDF_IMPORT_CAPABILITIES).toContain(c);
      }
    }
  });
  it('buildPdfImportPermissionPolicy returns version + matrix', () => {
    const p = buildPdfImportPermissionPolicy(NOW);
    expect(p.version).toBe('pdf-import-permission-policy-v1');
    expect(p.roles).toEqual(PDF_IMPORT_ROLES);
    expect(p.generatedAt).toBe('2026-07-09T00:00:00.000Z');
  });
  it('integrity assertion passes', () => {
    const r = assertPdfImportPermissionMatrixIntegrity();
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
});
