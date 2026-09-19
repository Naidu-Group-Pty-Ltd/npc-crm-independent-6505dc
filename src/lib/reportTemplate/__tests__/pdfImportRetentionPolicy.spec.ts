import { describe, expect, it } from 'vitest';
import {
  PDF_IMPORT_RETENTION_POLICY_RULES,
  assertPdfImportRetentionPolicyIntegrity,
  getPdfImportRetentionPolicyRule,
  listPdfImportRetentionPolicyRules,
} from '../ingestion/retention';

describe('pdfImportRetentionPolicy', () => {
  it('includes all canonical rules', () => {
    expect(PDF_IMPORT_RETENTION_POLICY_RULES.length).toBeGreaterThanOrEqual(18);
    expect(listPdfImportRetentionPolicyRules()).toHaveLength(PDF_IMPORT_RETENTION_POLICY_RULES.length);
  });

  it('has no duplicate rule IDs', () => {
    const ids = PDF_IMPORT_RETENTION_POLICY_RULES.map((r) => r.retentionRuleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every rule a domain/decision/action/safety', () => {
    for (const r of PDF_IMPORT_RETENTION_POLICY_RULES) {
      expect(r.domain).toBeTruthy();
      expect(r.defaultDecision).toBeTruthy();
      expect(r.defaultCleanupAction).toBeTruthy();
      expect(r.defaultSafetyLevel).toBeTruthy();
      expect(r.recommendedAction.trim().length).toBeGreaterThan(0);
    }
  });

  it('source_pdf_retained is blocked/manual', () => {
    const r = getPdfImportRetentionPolicyRule('source_pdf_retained')!;
    expect(r.defaultDecision).toBe('blocked');
    expect(['manual_only', 'blocked']).toContain(r.defaultSafetyLevel);
  });

  it('operator_audit_retained retains', () => {
    expect(getPdfImportRetentionPolicyRule('operator_audit_retained')!.defaultDecision).toBe('retain');
  });

  it('golden_history_retained retains', () => {
    expect(getPdfImportRetentionPolicyRule('golden_history_retained')!.defaultDecision).toBe('retain');
  });

  it('storage_object_orphaned is delete_candidate + requires developer approval', () => {
    const r = getPdfImportRetentionPolicyRule('storage_object_orphaned')!;
    expect(r.defaultDecision).toBe('delete_candidate');
    expect(r.defaultSafetyLevel).toBe('requires_developer_approval');
  });

  it('metadata_reference_missing_object uses repair_reference', () => {
    expect(getPdfImportRetentionPolicyRule('metadata_reference_missing_object')!.defaultCleanupAction).toBe('repair_reference');
  });

  it('no delete candidate is safe_to_recommend without approval', () => {
    for (const r of PDF_IMPORT_RETENTION_POLICY_RULES) {
      if (r.defaultDecision === 'delete_candidate') {
        expect(r.defaultSafetyLevel).not.toBe('safe_to_recommend');
      }
    }
  });

  it('passes integrity', () => {
    const result = assertPdfImportRetentionPolicyIntegrity();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
