import { describe, expect, it } from 'vitest';
import {
  REPAIR_PATTERN_ANALYSIS_VERSION,
  buildRepairPatternAnalysis,
  validateRepairPatternAnalysis,
  mergeRepairPatternWarnings,
  mergeRepairPatternBlockers,
} from '../ingestion/repairPatterns';

const NOW = () => new Date('2026-07-08T00:00:00.000Z');

const tableProfile = {
  importId: 'import-1', templateId: 'template-1', sourceFilename: 'report.pdf',
  profileCategory: 'table_heavy', riskLevel: 'high',
  scores: { tableRiskScore: 0.9, automationRiskScore: 0.5 },
};

function tableAnalysis() {
  return buildRepairPatternAnalysis({
    importId: 'import-1',
    importIntelligenceProfile: tableProfile,
    snapshot: { importId: 'import-1', visualQaScore: 0.8, exportVsSourceScore: 0.8 },
    now: NOW,
  });
}

describe('buildRepairPatternAnalysis', () => {
  it('builds an analysis with the version', () => {
    expect(tableAnalysis().version).toBe(REPAIR_PATTERN_ANALYSIS_VERSION);
  });
  it('includes identity fields', () => {
    const a = tableAnalysis();
    expect(a.importId).toBe('import-1');
    expect(a.templateId).toBe('template-1');
    expect(a.sourceFilename).toBe('report.pdf');
  });
  it('includes profileCategory/importRiskLevel', () => {
    const a = tableAnalysis();
    expect(a.profileCategory).toBe('table_heavy');
    expect(a.importRiskLevel).toBe('high');
  });
  it('includes matchedPatterns and a primaryPatternId', () => {
    const a = tableAnalysis();
    expect(Array.isArray(a.matchedPatterns)).toBe(true);
    expect(a.primaryPatternId).toBe('table_grid_drift');
  });
  it('includes overall severity/confidence and strategy outputs', () => {
    const a = tableAnalysis();
    expect(a.overallSeverity).toBeTruthy();
    expect(a.overallConfidence).toBeGreaterThanOrEqual(0);
    expect(a.deterministicRepairStrategy).toBeTruthy();
    expect(a.aiReconciliationUsefulness).toBeTruthy();
    expect(a.exportParityRequirement).toBeTruthy();
    expect(a.operatorReviewRequirement).toBeTruthy();
  });
  it('uses the provided now() for generatedAt', () => {
    expect(tableAnalysis().generatedAt).toBe('2026-07-08T00:00:00.000Z');
  });
  it('adds no_repair_patterns_matched warning when nothing matches', () => {
    const a = buildRepairPatternAnalysis({
      importId: 'import-1',
      importIntelligenceProfile: { profileCategory: 'simple_document', riskLevel: 'low', scores: {} },
      snapshot: { importId: 'import-1', visualQaScore: 0.98, exportVsSourceScore: 0.97, repairStatus: 'completed', repairFinalScore: 0.97 },
      now: NOW,
    });
    expect(a.matchedPatterns.length).toBe(0);
    expect(a.warnings).toContain('no_repair_patterns_matched');
    expect(a.deterministicRepairStrategy).toBe('unknown');
  });
  it('creates a blocker when import ID is missing', () => {
    const a = buildRepairPatternAnalysis({ importIntelligenceProfile: { profileCategory: 'unknown' }, now: NOW });
    expect(a.blockers).toContain('import_id_missing');
  });
  it('builds manual_review_only for high-risk input', () => {
    const a = buildRepairPatternAnalysis({
      importId: 'import-1',
      importIntelligenceProfile: { profileCategory: 'high_risk', riskLevel: 'critical', scores: { automationRiskScore: 0.9, manualReviewLikelihood: 0.9 } },
      snapshot: { importId: 'import-1', repairRequiresManualReview: true, repairRequiresFallback: true },
      goldenRegressionSummary: { qualityGateStatus: 'fail', failures: ['x'] },
      now: NOW,
    });
    expect(a.matchedPatterns.map((m) => m.patternId)).toContain('manual_review_only');
    expect(a.deterministicRepairStrategy).toBe('blocked');
  });
  it('builds table_grid_drift for table-heavy input', () => {
    expect(tableAnalysis().matchedPatterns.map((m) => m.patternId)).toContain('table_grid_drift');
  });
  it('builds export_renderer_mismatch for export mismatch input', () => {
    const a = buildRepairPatternAnalysis({
      importId: 'import-1',
      importIntelligenceProfile: { profileCategory: 'simple_document', riskLevel: 'medium', scores: {} },
      snapshot: { importId: 'import-1', exportParityStatus: 'failed', editorVsSourceScore: 0.9, exportVsSourceScore: 0.7 },
      now: NOW,
    });
    expect(a.matchedPatterns.map((m) => m.patternId)).toContain('export_renderer_mismatch');
  });
});

describe('validateRepairPatternAnalysis', () => {
  it('returns ok for a valid analysis', () => {
    expect(validateRepairPatternAnalysis(tableAnalysis()).ok).toBe(true);
  });
  it('returns error for an invalid version', () => {
    const res = validateRepairPatternAnalysis({ ...tableAnalysis(), version: 'nope' as any });
    expect(res.ok).toBe(false);
    expect(res.errors).toContain('invalid_version');
  });
  it('returns error for an invalid severity', () => {
    const res = validateRepairPatternAnalysis({ ...tableAnalysis(), overallSeverity: 'nope' as any });
    expect(res.errors).toContain('invalid_severity');
  });
  it('returns error for an invalid strategy', () => {
    const res = validateRepairPatternAnalysis({ ...tableAnalysis(), deterministicRepairStrategy: 'nope' as any });
    expect(res.errors).toContain('invalid_repair_strategy');
  });
});

describe('merge helpers', () => {
  it('mergeRepairPatternWarnings deduplicates', () => {
    expect(mergeRepairPatternWarnings(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });
  it('mergeRepairPatternBlockers deduplicates', () => {
    expect(mergeRepairPatternBlockers(['x'], ['x', 'y'])).toEqual(['x', 'y']);
  });
});
