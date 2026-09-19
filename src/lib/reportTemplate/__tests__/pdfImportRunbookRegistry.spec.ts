import { describe, expect, it } from 'vitest';
import {
  PDF_IMPORT_REQUIRED_RUNBOOK_IDS,
  PDF_IMPORT_RUNBOOK_REGISTRY,
  PDF_IMPORT_RUNBOOK_REQUIRED_SECTIONS,
  assertPdfImportRunbookRegistryIntegrity,
  buildPdfImportRunbookRegistry,
  getPdfImportRunbookById,
  listPdfImportRunbooks,
} from '../ingestion/runbooks';

const NOW = () => new Date('2026-07-09T00:00:00.000Z');

describe('pdfImportRunbookRegistry', () => {
  it('includes every required runbook', () => {
    const ids = new Set(PDF_IMPORT_RUNBOOK_REGISTRY.map((r) => r.id));
    for (const id of PDF_IMPORT_REQUIRED_RUNBOOK_IDS) expect(ids.has(id)).toBe(true);
    expect(PDF_IMPORT_RUNBOOK_REGISTRY.length).toBeGreaterThanOrEqual(18);
  });

  it('has no duplicate IDs', () => {
    const ids = PDF_IMPORT_RUNBOOK_REGISTRY.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('places every runbook under docs/pdf-import/runbooks/', () => {
    for (const r of PDF_IMPORT_RUNBOOK_REGISTRY) {
      expect(r.path.startsWith('docs/pdf-import/runbooks/')).toBe(true);
      expect(r.path.endsWith('.md')).toBe(true);
    }
  });

  it('only references /admin routes', () => {
    for (const r of PDF_IMPORT_RUNBOOK_REGISTRY) {
      for (const route of r.relatedRoutes) expect(route.startsWith('/admin')).toBe(true);
    }
  });

  it('gives every critical runbook the safety sections', () => {
    for (const r of PDF_IMPORT_RUNBOOK_REGISTRY) {
      if (r.criticality !== 'critical') continue;
      for (const s of ['Stop Conditions', 'Escalation Path', 'Evidence To Capture', 'What Not To Do']) {
        expect(r.requiredSections).toContain(s);
      }
    }
  });

  it('has the 8 canonical critical runbooks', () => {
    const critical = PDF_IMPORT_RUNBOOK_REGISTRY.filter((r) => r.criticality === 'critical').map((r) => r.id);
    for (const id of [
      'operator_quick_start', 'evaluate_only_sop', 'evaluate_persist_sop', 'monitoring_alert_response_sop',
      'permission_denied_sop', 'incident_response_sop', 'rollback_escalation_sop', 'client_communication_boundaries',
    ]) {
      expect(critical).toContain(id);
    }
  });

  it('exposes the standard required-section list', () => {
    expect(PDF_IMPORT_RUNBOOK_REQUIRED_SECTIONS).toContain('Purpose');
    expect(PDF_IMPORT_RUNBOOK_REQUIRED_SECTIONS).toContain('Stop Conditions');
    expect(PDF_IMPORT_RUNBOOK_REQUIRED_SECTIONS).toContain('Related Pages / Routes');
  });

  it('looks up by id and builds a registry snapshot', () => {
    expect(getPdfImportRunbookById('evaluate_only_sop')?.domain).toBe('import_workflow');
    expect(getPdfImportRunbookById('nope')).toBeNull();
    const reg = buildPdfImportRunbookRegistry(NOW);
    expect(reg.generatedAt).toBe('2026-07-09T00:00:00.000Z');
    expect(reg.runbooks).toHaveLength(PDF_IMPORT_RUNBOOK_REGISTRY.length);
    // returned copies do not mutate source
    listPdfImportRunbooks()[0].relatedRoutes.push('/x');
    expect(PDF_IMPORT_RUNBOOK_REGISTRY[0].relatedRoutes).not.toContain('/x');
  });

  it('passes integrity', () => {
    const result = assertPdfImportRunbookRegistryIntegrity();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
