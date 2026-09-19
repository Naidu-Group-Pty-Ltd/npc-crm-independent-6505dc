/**
 * importIntelligenceTypes — Phase 10B.
 *
 * Type model for the deterministic Import Intelligence Profile. The profile
 * classifies a PDF import (document type, complexity, risk, recommended
 * downstream strategy) from already-available metadata/summaries. It never calls
 * AI and never stores raw PDF text or private extracted content.
 */

export const IMPORT_INTELLIGENCE_PROFILE_VERSION =
  'pdf-import-intelligence-profile-v1';

export type ImportIntelligenceProfileCategory =
  | 'simple_document'
  | 'design_heavy'
  | 'multi_page_report'
  | 'table_heavy'
  | 'image_heavy'
  | 'scanned_ocr'
  | 'mixed_complex'
  | 'high_risk'
  | 'unknown';

export type ImportIntelligenceRiskLevel =
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'
  | 'unknown';

export type ImportIntelligenceVisualQaStrategy =
  | 'required'
  | 'recommended'
  | 'optional'
  | 'not_required';

export type ImportIntelligenceRepairStrategy =
  | 'allow'
  | 'allow_with_review'
  | 'skip'
  | 'manual_only'
  | 'blocked';

export type ImportIntelligenceAiReconciliationStrategy =
  | 'not_needed'
  | 'optional'
  | 'recommended'
  | 'manual_review'
  | 'blocked';

export type ImportIntelligenceExportParityStrategy =
  | 'required'
  | 'recommended'
  | 'manual_required'
  | 'optional'
  | 'not_required';

export type ImportIntelligenceOperatorStrategy =
  | 'proceed'
  | 'review_before_apply'
  | 'manual_review_required'
  | 'block_until_review'
  | 'rerun_import';

export interface ImportIntelligenceScores {
  complexityScore: number | null;
  ocrRiskScore: number | null;
  tableRiskScore: number | null;
  imageRiskScore: number | null;
  designRiskScore: number | null;
  automationRiskScore: number | null;
  manualReviewLikelihood: number | null;
  confidence: number | null;
}

export interface ImportIntelligenceSignals {
  pageCount: number | null;
  isMultiPage: boolean | null;
  hasVisualQuality: boolean;
  visualQaScore: number | null;
  visualQaManualReviewRequired: boolean | null;

  hasRepairAudit: boolean;
  repairStatus: string | null;
  repairFinalScore: number | null;
  repairRequiresFallback: boolean | null;
  repairRequiresManualReview: boolean | null;

  hasExportParity: boolean;
  exportParityStatus: string | null;
  exportVsSourceScore: number | null;
  editorVsSourceScore: number | null;
  exportVsEditorScore: number | null;

  aiReconciliationStatus: string | null;
  aiReconciliationRecommendation: string | null;

  engineVersion: string | null;

  tableCountEstimate: number | null;
  imageCountEstimate: number | null;
  textDensityEstimate: number | null;

  ocrLikelihood: number | null;
  designComplexityEstimate: number | null;
  layoutRiskEstimate: number | null;

  goldenQualityGateStatus: string | null;
  goldenFailureCount: number | null;
  goldenWarningCount: number | null;
  baselineOutcome: string | null;
}

export interface ImportIntelligenceEvidence {
  code: string;
  label: string;
  value: string | number | boolean | null;
  weight: number;
  message: string;
}

export interface ImportIntelligenceRecommendations {
  visualQaStrategy: ImportIntelligenceVisualQaStrategy;
  repairStrategy: ImportIntelligenceRepairStrategy;
  aiReconciliationStrategy: ImportIntelligenceAiReconciliationStrategy;
  exportParityStrategy: ImportIntelligenceExportParityStrategy;
  operatorStrategy: ImportIntelligenceOperatorStrategy;
}

export interface ImportIntelligenceProfile {
  version: typeof IMPORT_INTELLIGENCE_PROFILE_VERSION;

  importId: string | null;
  templateId: string | null;
  sourceFilename: string | null;

  profileCategory: ImportIntelligenceProfileCategory;
  riskLevel: ImportIntelligenceRiskLevel;
  confidence: number;

  scores: ImportIntelligenceScores;
  signals: ImportIntelligenceSignals;
  recommendations: ImportIntelligenceRecommendations;
  evidence: ImportIntelligenceEvidence[];

  warnings: string[];
  blockers: string[];

  generatedAt: string;
}

export interface BuildImportIntelligenceProfileOptions {
  importId?: string | null;
  templateId?: string | null;
  sourceFilename?: string | null;
  record?: unknown;
  snapshot?: unknown;
  templateSchema?: unknown;
  artifacts?: unknown;
  visualQuality?: unknown;
  repairSummary?: unknown;
  exportParitySummary?: unknown;
  goldenRegressionSummary?: unknown;
  goldenHistory?: unknown[];
  now?: () => Date;
}

export type SaveImportIntelligenceProfileResult =
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

export type LoadImportIntelligenceProfileResult =
  | { kind: 'ok'; profile: ImportIntelligenceProfile }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };
