import { describe, expect, it } from 'vitest';
import {
  PDF_IMPORT_FAILURE_TRIAGE_DEFAULT_RULE,
  PDF_IMPORT_FAILURE_TRIAGE_RULES,
  getPdfImportFailureTriageRule,
  getRecoveryActionLabel,
} from '../ingestion/failureTriage';

describe('pdfImportFailureTriageRules', () => {
  it('every rule has the required non-empty fields', () => {
    for (const rule of PDF_IMPORT_FAILURE_TRIAGE_RULES) {
      expect(rule.code).toBeTruthy();
      expect(rule.category).toBeTruthy();
      expect(rule.severity).toBeTruthy();
      expect(rule.owner).toBeTruthy();
      expect(rule.primaryAction).toBeTruthy();
      expect(Array.isArray(rule.secondaryActions)).toBe(true);
      expect(rule.outcome).toBeTruthy();
      expect(rule.title).toBeTruthy();
      expect(rule.operatorSummary).toBeTruthy();
      expect(rule.developerSummary).toBeTruthy();
      expect(rule.playbookAnchor).toBeTruthy();
    }
  });

  it('every primary and secondary action has a human label', () => {
    for (const rule of PDF_IMPORT_FAILURE_TRIAGE_RULES) {
      expect(getRecoveryActionLabel(rule.primaryAction)).not.toBe(rule.primaryAction);
      for (const action of rule.secondaryActions) {
        expect(getRecoveryActionLabel(action)).not.toBe(action);
      }
    }
  });

  it('has no duplicate rule codes', () => {
    const codes = PDF_IMPORT_FAILURE_TRIAGE_RULES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('covers every required triage category', () => {
    const categories = new Set(PDF_IMPORT_FAILURE_TRIAGE_RULES.map((r) => r.category));
    for (const required of [
      'import', 'sidecar', 'artifact', 'template', 'visual_quality', 'repair',
      'ai_reconciliation', 'export_parity', 'golden_regression', 'auth_security', 'backend_contract',
    ]) {
      expect(categories.has(required as never)).toBe(true);
    }
  });

  it('exposes a default unknown rule', () => {
    expect(PDF_IMPORT_FAILURE_TRIAGE_DEFAULT_RULE.code).toBe('unknown');
    expect(getPdfImportFailureTriageRule('nope-not-real').code).toBe('unknown');
  });
});
