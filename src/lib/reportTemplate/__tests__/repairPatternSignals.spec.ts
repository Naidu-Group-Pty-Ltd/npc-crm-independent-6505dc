import { describe, expect, it } from 'vitest';
import {
  clampRepairPatternScore,
  coerceRepairPatternBoolean,
  readRepairPatternPath,
  extractRepairPatternSignals,
  extractFailureCodesFromQualityGateReport,
  extractWarningCodesFromQualityGateReport,
  extractFailureCodesFromTriage,
  estimateSchemaLayerComplexity,
  estimateRepeatedHeaderFooterRisk,
} from '../ingestion/repairPatterns';

const profile = {
  importId: 'import-1',
  templateId: 'template-1',
  sourceFilename: 'doc.pdf',
  profileCategory: 'table_heavy',
  riskLevel: 'high',
  confidence: 0.8,
  scores: { tableRiskScore: 0.9, imageRiskScore: 0.2, designRiskScore: 0.3, ocrRiskScore: 0.1, automationRiskScore: 0.5, manualReviewLikelihood: 0.6 },
  signals: { pageCount: 4 },
};

const snapshot = {
  importId: 'import-1',
  importPageCount: 4,
  visualQaScore: 0.8,
  visualQaManualReviewRequired: true,
  repairStatus: 'completed',
  repairFinalScore: 0.86,
  repairRequiresFallback: true,
  exportParityStatus: 'completed',
  exportVsSourceScore: 0.82,
};

describe('helpers', () => {
  it('clampRepairPatternScore accepts 0.5', () => {
    expect(clampRepairPatternScore(0.5)).toBe(0.5);
  });
  it('clamps below 0 to 0 and above 1 to 1', () => {
    expect(clampRepairPatternScore(-1)).toBe(0);
    expect(clampRepairPatternScore(2)).toBe(1);
  });
  it('returns null for invalid score', () => {
    expect(clampRepairPatternScore('x')).toBeNull();
  });
  it('boolean coercion handles true/false strings', () => {
    expect(coerceRepairPatternBoolean('true')).toBe(true);
    expect(coerceRepairPatternBoolean('false')).toBe(false);
  });
  it('path reader reads nested values', () => {
    expect(readRepairPatternPath({ a: { b: 5 } }, ['a', 'b'])).toBe(5);
  });
});

describe('extractRepairPatternSignals', () => {
  it('extracts profileCategory/risk from the import intelligence profile', () => {
    const { signals } = extractRepairPatternSignals({ importId: 'import-1', importIntelligenceProfile: profile });
    expect(signals.profileCategory).toBe('table_heavy');
    expect(signals.importRiskLevel).toBe('high');
    expect(signals.tableRiskScore).toBe(0.9);
  });
  it('extracts visual QA signals from the snapshot', () => {
    const { signals } = extractRepairPatternSignals({ importId: 'import-1', snapshot });
    expect(signals.visualQaScore).toBe(0.8);
    expect(signals.visualQaManualReviewRequired).toBe(true);
  });
  it('extracts repair signals from the snapshot', () => {
    const { signals } = extractRepairPatternSignals({ importId: 'import-1', snapshot });
    expect(signals.repairStatus).toBe('completed');
    expect(signals.repairRequiresFallback).toBe(true);
  });
  it('extracts export parity signals from the snapshot', () => {
    const { signals } = extractRepairPatternSignals({ importId: 'import-1', snapshot });
    expect(signals.exportParityStatus).toBe('completed');
    expect(signals.exportVsSourceScore).toBe(0.82);
  });
  it('extracts golden quality status and warning/failure counts', () => {
    const { signals } = extractRepairPatternSignals({
      importId: 'import-1',
      goldenRegressionSummary: { qualityGateStatus: 'fail', failures: ['a', 'b'], warnings: ['w'] },
    });
    expect(signals.goldenQualityGateStatus).toBe('fail');
    expect(signals.goldenFailureCount).toBe(2);
    expect(signals.goldenWarningCount).toBe(1);
  });
  it('adds missing_import_intelligence_profile warning when profile missing', () => {
    const { warnings } = extractRepairPatternSignals({ importId: 'import-1', snapshot });
    expect(warnings).toContain('missing_import_intelligence_profile');
  });
  it('adds missing_repair_summary warning when repair data missing', () => {
    const { warnings } = extractRepairPatternSignals({ importId: 'import-1', importIntelligenceProfile: profile });
    expect(warnings).toContain('missing_repair_summary');
  });
  it('adds blocker import_id_missing when no import ID', () => {
    const { blockers } = extractRepairPatternSignals({ importIntelligenceProfile: {} });
    expect(blockers).toContain('import_id_missing');
  });
  it('evidence includes low visual QA / manual review / fallback when present', () => {
    const { evidence } = extractRepairPatternSignals({ importId: 'import-1', snapshot });
    const codes = evidence.map((e) => e.code);
    expect(codes).toContain('low_visual_qa_score');
    expect(codes).toContain('visual_manual_review_required');
    expect(codes).toContain('repair_requires_fallback');
  });
});

describe('code + schema extractors', () => {
  const report = { gates: [{ id: 'visual_quality_score_threshold', status: 'fail' }, { id: 'ai_reconciliation_policy', status: 'warning' }] };
  it('extracts failure codes from a quality gate report', () => {
    expect(extractFailureCodesFromQualityGateReport(report)).toContain('visual_quality_score_threshold');
  });
  it('extracts warning codes from a quality gate report', () => {
    expect(extractWarningCodesFromQualityGateReport(report)).toContain('ai_reconciliation_policy');
  });
  it('extracts failure codes from a triage summary', () => {
    const triage = { signals: [{ code: 'export_parity_failed' }], failures: ['visual_quality_missing'] };
    const codes = extractFailureCodesFromTriage(triage);
    expect(codes).toContain('export_parity_failed');
    expect(codes).toContain('visual_quality_missing');
  });
  it('estimates schema layer complexity from positioned/layered elements', () => {
    const schema = { pages: [{ blocks: [{ type: 'background' }, { type: 'image' }, { type: 'text', zIndex: 3 }] }] };
    const c = estimateSchemaLayerComplexity(schema);
    expect(c).not.toBeNull();
    expect(c as number).toBeGreaterThan(0);
  });
  it('estimates repeated header/footer risk for a multi-page schema', () => {
    const schema = { pages: [{ blocks: [{ name: 'header' }, { name: 'footer' }] }, { blocks: [{ name: 'header' }] }] };
    const risk = estimateRepeatedHeaderFooterRisk(schema, 3);
    expect(risk).not.toBeNull();
    expect(risk as number).toBeGreaterThan(0);
  });
});
