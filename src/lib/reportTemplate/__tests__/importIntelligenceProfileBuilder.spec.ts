import { describe, expect, it } from 'vitest';
import {
  IMPORT_INTELLIGENCE_PROFILE_VERSION,
  buildImportIntelligenceProfile,
  validateImportIntelligenceProfile,
  mergeImportIntelligenceWarnings,
  mergeImportIntelligenceBlockers,
} from '../ingestion/importIntelligence';

const NOW = () => new Date('2026-07-08T00:00:00.000Z');

const simpleSnapshot = {
  importId: 'import-1',
  templateId: 'template-1',
  sourceFilename: 'doc.pdf',
  importPageCount: 1,
  visualQaScore: 0.97,
  repairStatus: 'completed',
  repairFinalScore: 0.96,
  exportParityStatus: 'completed',
  exportVsSourceScore: 0.95,
};

describe('buildImportIntelligenceProfile', () => {
  it('builds a profile with the version', () => {
    const p = buildImportIntelligenceProfile({ importId: 'import-1', snapshot: simpleSnapshot, now: NOW });
    expect(p.version).toBe(IMPORT_INTELLIGENCE_PROFILE_VERSION);
  });

  it('uses importId/templateId/sourceFilename from explicit options', () => {
    const p = buildImportIntelligenceProfile({
      importId: 'explicit-import', templateId: 'explicit-template', sourceFilename: 'explicit.pdf',
      snapshot: simpleSnapshot, now: NOW,
    });
    expect(p.importId).toBe('explicit-import');
    expect(p.templateId).toBe('explicit-template');
    expect(p.sourceFilename).toBe('explicit.pdf');
  });

  it('falls back to snapshot identity', () => {
    const p = buildImportIntelligenceProfile({ snapshot: simpleSnapshot, now: NOW });
    expect(p.importId).toBe('import-1');
    expect(p.templateId).toBe('template-1');
    expect(p.sourceFilename).toBe('doc.pdf');
  });

  it('includes signals, evidence, scores, recommendations', () => {
    const p = buildImportIntelligenceProfile({ snapshot: simpleSnapshot, now: NOW });
    expect(p.signals).toBeTruthy();
    expect(Array.isArray(p.evidence)).toBe(true);
    expect(p.scores).toBeTruthy();
    expect(p.recommendations).toBeTruthy();
    expect(p.recommendations.operatorStrategy).toBeTruthy();
  });

  it('uses the provided now() for generatedAt', () => {
    const p = buildImportIntelligenceProfile({ snapshot: simpleSnapshot, now: NOW });
    expect(p.generatedAt).toBe('2026-07-08T00:00:00.000Z');
  });

  it('does not throw when importId is missing but adds a blocker', () => {
    const p = buildImportIntelligenceProfile({ snapshot: { importPageCount: 2 }, now: NOW });
    expect(p.importId).toBeNull();
    expect(p.blockers).toContain('import_id_missing');
  });

  it('builds a scanned_ocr profile from OCR-heavy input', () => {
    const p = buildImportIntelligenceProfile({
      importId: 'import-ocr',
      snapshot: {
        importId: 'import-ocr', importPageCount: 2, visualQaScore: 0.7,
        repairStatus: 'completed', exportParityStatus: 'manual_required',
      },
      artifacts: { pages: [{ ocr: true }] },
      templateSchema: { pages: [{ blocks: [{ type: 'text' }] }] },
      now: NOW,
    });
    expect(p.profileCategory).toBe('scanned_ocr');
  });

  it('builds a table_heavy profile from table-heavy input', () => {
    const p = buildImportIntelligenceProfile({
      importId: 'import-table',
      snapshot: {
        importId: 'import-table', importPageCount: 2, visualQaScore: 0.9,
        repairStatus: 'completed', repairFinalScore: 0.9, exportParityStatus: 'completed', exportVsSourceScore: 0.9,
      },
      templateSchema: { pages: [{ blocks: Array.from({ length: 7 }, () => ({ type: 'table' })) }] },
      now: NOW,
    });
    expect(p.profileCategory).toBe('table_heavy');
  });

  it('builds a high_risk profile from high-risk input', () => {
    const p = buildImportIntelligenceProfile({
      importId: 'import-risk',
      snapshot: {
        importId: 'import-risk', importPageCount: 4, visualQaScore: 0.5, visualQaManualReviewRequired: true,
        repairStatus: 'failed', repairRequiresFallback: true, exportParityStatus: 'failed',
      },
      goldenRegressionSummary: { qualityGateStatus: 'fail', failures: ['a', 'b'] },
      now: NOW,
    });
    expect(p.profileCategory).toBe('high_risk');
    expect(p.riskLevel).toBe('critical');
  });
});

describe('validateImportIntelligenceProfile', () => {
  it('returns ok for a valid profile', () => {
    const p = buildImportIntelligenceProfile({ snapshot: simpleSnapshot, now: NOW });
    expect(validateImportIntelligenceProfile(p).ok).toBe(true);
  });
  it('returns an error for an invalid version', () => {
    const p = buildImportIntelligenceProfile({ snapshot: simpleSnapshot, now: NOW });
    const bad = { ...p, version: 'nope' as any };
    const res = validateImportIntelligenceProfile(bad);
    expect(res.ok).toBe(false);
    expect(res.errors).toContain('invalid_version');
  });
  it('returns an error for an invalid category', () => {
    const p = buildImportIntelligenceProfile({ snapshot: simpleSnapshot, now: NOW });
    const res = validateImportIntelligenceProfile({ ...p, profileCategory: 'nope' as any });
    expect(res.ok).toBe(false);
    expect(res.errors).toContain('invalid_category');
  });
  it('returns an error for an invalid score', () => {
    const p = buildImportIntelligenceProfile({ snapshot: simpleSnapshot, now: NOW });
    const res = validateImportIntelligenceProfile({ ...p, scores: { ...p.scores, complexityScore: 5 } });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.startsWith('invalid_score_'))).toBe(true);
  });
});

describe('merge helpers', () => {
  it('mergeImportIntelligenceWarnings deduplicates', () => {
    expect(mergeImportIntelligenceWarnings(['a', 'b'], ['b', 'c'], null)).toEqual(['a', 'b', 'c']);
  });
  it('mergeImportIntelligenceBlockers deduplicates', () => {
    expect(mergeImportIntelligenceBlockers(['x'], undefined, ['x', 'y'])).toEqual(['x', 'y']);
  });
});
