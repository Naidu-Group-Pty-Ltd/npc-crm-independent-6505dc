import { describe, expect, it } from 'vitest';
import {
  PDF_IMPORT_RELEASE_GATE_CHECKLIST,
  PDF_IMPORT_RELEASE_GATE_DOMAINS,
  assertPdfImportReleaseGateChecklistIntegrity,
  getPdfImportReleaseGateCheckById,
  listPdfImportReleaseGateChecks,
} from '../ingestion/releaseGate';

describe('releaseGateChecklist', () => {
  it('includes at least 63 checks', () => {
    expect(PDF_IMPORT_RELEASE_GATE_CHECKLIST.length).toBeGreaterThanOrEqual(63);
  });

  it('has no duplicate IDs', () => {
    const ids = PDF_IMPORT_RELEASE_GATE_CHECKLIST.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('represents all required domains', () => {
    const present = new Set(PDF_IMPORT_RELEASE_GATE_CHECKLIST.map((c) => c.domain));
    for (const d of PDF_IMPORT_RELEASE_GATE_DOMAINS) expect(present.has(d)).toBe(true);
  });

  it('contains the critical safety checks', () => {
    const ids = new Set(PDF_IMPORT_RELEASE_GATE_CHECKLIST.map((c) => c.id));
    for (const id of [
      'no_automatic_ai_execution_pattern',
      'no_automatic_template_mutation_pattern',
      'no_manual_only_action_auto_completion_pattern',
      'no_quality_gate_bypass_pattern',
      'no_service_role_secret_frontend_pattern',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('contains the private artifact checks', () => {
    const ids = new Set(PDF_IMPORT_RELEASE_GATE_CHECKLIST.map((c) => c.id));
    for (const id of [
      'no_private_pdfs_staged',
      'no_generated_images_staged',
      'no_logs_or_env_staged',
      'no_signed_url_dumps_staged',
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('contains permission checks', () => {
    expect(PDF_IMPORT_RELEASE_GATE_CHECKLIST.some((c) => c.id === 'permission_matrix_exists')).toBe(true);
    expect(PDF_IMPORT_RELEASE_GATE_CHECKLIST.some((c) => c.id === 'unknown_role_denied')).toBe(true);
  });

  it('contains monitoring checks', () => {
    expect(PDF_IMPORT_RELEASE_GATE_CHECKLIST.some((c) => c.domain === 'monitoring')).toBe(true);
    expect(PDF_IMPORT_RELEASE_GATE_CHECKLIST.some((c) => c.id === 'monitoring_rules_exist')).toBe(true);
  });

  it('contains golden regression checks', () => {
    expect(PDF_IMPORT_RELEASE_GATE_CHECKLIST.some((c) => c.domain === 'golden_regression')).toBe(true);
  });

  it('gives every check a remediation', () => {
    for (const c of PDF_IMPORT_RELEASE_GATE_CHECKLIST) {
      expect(c.remediation.trim().length).toBeGreaterThan(0);
    }
  });

  it('passes checklist integrity', () => {
    const result = assertPdfImportReleaseGateChecklistIntegrity();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('looks up a check by id and returns a copy', () => {
    const c = getPdfImportReleaseGateCheckById('npm_build_passes');
    expect(c?.domain).toBe('build');
    expect(getPdfImportReleaseGateCheckById('nope')).toBeNull();
    // listing returns copies (mutating one does not affect the source)
    const list = listPdfImportReleaseGateChecks();
    list[0].evidence.push('x');
    expect(PDF_IMPORT_RELEASE_GATE_CHECKLIST[0].evidence).toEqual([]);
  });
});
