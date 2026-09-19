/**
 * repairPatternTypes — Phase 10C.
 *
 * Type model for the deterministic Repair Pattern Library. It classifies repeated
 * repair issues into known patterns and produces advisory recommendations. It
 * never applies repairs, never calls AI, and never stores raw PDF/OCR text.
 */

export const REPAIR_PATTERN_ANALYSIS_VERSION =
  'pdf-import-repair-pattern-analysis-v1';

export type RepairPatternId =
  | 'page_margin_drift'
  | 'background_block_shift'
  | 'font_scale_mismatch'
  | 'table_grid_drift'
  | 'image_crop_mismatch'
  | 'layer_order_conflict'
  | 'ocr_text_fragments'
  | 'header_footer_alignment'
  | 'multi_page_spacing_drift'
  | 'missing_major_visual_element'
  | 'export_renderer_mismatch'
  | 'manual_review_only'
  | 'unknown';

export type RepairPatternCategory =
  | 'geometry'
  | 'typography'
  | 'table'
  | 'image'
  | 'layering'
  | 'ocr'
  | 'multipage'
  | 'export'
  | 'missing_content'
  | 'manual_review'
  | 'unknown';

export type RepairPatternSeverity =
  | 'info'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

export type RepairPatternRecommendedAction =
  | 'no_action'
  | 'normalize_page_margins'
  | 'adjust_background_blocks'
  | 'normalize_font_scale'
  | 'preserve_table_as_raster_or_rebuild_grid'
  | 'adjust_image_fit'
  | 'repair_layer_order'
  | 'preserve_source_raster'
  | 'align_repeated_header_footer'
  | 'normalize_vertical_spacing'
  | 'restore_missing_visual_element'
  | 'inspect_export_renderer'
  | 'manual_review'
  | 'block_automation';

export type RepairPatternDeterministicRepairStrategy =
  | 'safe'
  | 'safe_with_review'
  | 'constrained'
  | 'manual_only'
  | 'blocked'
  | 'unknown';

export type RepairPatternAiReconciliationUsefulness =
  | 'not_needed'
  | 'low'
  | 'medium'
  | 'high'
  | 'manual_review_only'
  | 'blocked';

export type RepairPatternExportParityRequirement =
  | 'not_required'
  | 'recommended'
  | 'required'
  | 'rerun_required'
  | 'manual_required';

export type RepairPatternOperatorReviewRequirement =
  | 'not_required'
  | 'recommended'
  | 'required'
  | 'block_until_review';

export interface RepairPatternEvidence {
  code: string;
  label: string;
  value: string | number | boolean | null;
  weight: number;
  message: string;
}

export interface RepairPatternDefinition {
  patternId: RepairPatternId;
  category: RepairPatternCategory;
  title: string;
  description: string;
  defaultSeverity: RepairPatternSeverity;
  recommendedAction: RepairPatternRecommendedAction;
  manualFallback: RepairPatternRecommendedAction;
  aiReconciliationUsefulness: RepairPatternAiReconciliationUsefulness;
  exportParityRequirement: RepairPatternExportParityRequirement;
  operatorReviewRequirement: RepairPatternOperatorReviewRequirement;
  eligibleProfileCategories: string[];
  symptoms: string[];
  riskNotes: string[];
}

export interface RepairPatternSignals {
  importId: string | null;
  templateId: string | null;
  sourceFilename: string | null;

  profileCategory: string | null;
  importRiskLevel: string | null;
  importConfidence: number | null;

  pageCount: number | null;
  isMultiPage: boolean | null;

  visualQaScore: number | null;
  visualQaManualReviewRequired: boolean | null;

  repairStatus: string | null;
  repairFinalScore: number | null;
  repairRequiresFallback: boolean | null;
  repairRequiresManualReview: boolean | null;

  exportParityStatus: string | null;
  exportVsSourceScore: number | null;
  editorVsSourceScore: number | null;
  exportVsEditorScore: number | null;

  aiReconciliationStatus: string | null;
  aiReconciliationRecommendation: string | null;

  tableRiskScore: number | null;
  imageRiskScore: number | null;
  designRiskScore: number | null;
  ocrRiskScore: number | null;
  automationRiskScore: number | null;
  manualReviewLikelihood: number | null;

  goldenQualityGateStatus: string | null;
  goldenWarningCount: number | null;
  goldenFailureCount: number | null;
  baselineOutcome: string | null;

  failureCodes: string[];
  warningCodes: string[];
}

export interface RepairPatternMatch {
  patternId: RepairPatternId;
  category: RepairPatternCategory;
  severity: RepairPatternSeverity;
  confidence: number;
  score: number;
  matched: boolean;
  evidence: RepairPatternEvidence[];
  recommendedAction: RepairPatternRecommendedAction;
  manualFallback: RepairPatternRecommendedAction;
  aiReconciliationUsefulness: RepairPatternAiReconciliationUsefulness;
  exportParityRequirement: RepairPatternExportParityRequirement;
  operatorReviewRequirement: RepairPatternOperatorReviewRequirement;
  message: string;
}

export interface RepairPatternAnalysis {
  version: typeof REPAIR_PATTERN_ANALYSIS_VERSION;

  importId: string | null;
  templateId: string | null;
  sourceFilename: string | null;

  profileCategory: string | null;
  importRiskLevel: string | null;

  matchedPatterns: RepairPatternMatch[];
  primaryPatternId: RepairPatternId | null;

  overallSeverity: RepairPatternSeverity;
  overallConfidence: number;

  deterministicRepairStrategy: RepairPatternDeterministicRepairStrategy;
  aiReconciliationUsefulness: RepairPatternAiReconciliationUsefulness;
  exportParityRequirement: RepairPatternExportParityRequirement;
  operatorReviewRequirement: RepairPatternOperatorReviewRequirement;

  evidence: RepairPatternEvidence[];
  warnings: string[];
  blockers: string[];

  generatedAt: string;
}

export interface BuildRepairPatternAnalysisOptions {
  importId?: string | null;
  templateId?: string | null;
  sourceFilename?: string | null;
  snapshot?: unknown;
  importIntelligenceProfile?: unknown;
  visualQualitySummary?: unknown;
  repairSummary?: unknown;
  exportParitySummary?: unknown;
  goldenRegressionSummary?: unknown;
  qualityGateReport?: unknown;
  triageSummary?: unknown;
  templateSchema?: unknown;
  now?: () => Date;
}

export type SaveRepairPatternAnalysisResult =
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

export type LoadRepairPatternAnalysisResult =
  | { kind: 'ok'; analysis: RepairPatternAnalysis }
  | { kind: 'missing' }
  | { kind: 'error'; message: string };
