import type {
  VisualImportQualityReport,
  VisualPageQualityReport,
  VisualRecommendedAction,
  VisualWarning,
  VisualWarningSeverity,
} from '../schema';
import {
  METRIC_WARNING_THRESHOLDS,
  QUALITY_THRESHOLDS,
  type MetricKey,
} from '../thresholds';

export const REPAIR_ISSUE_CLASSIFIER_VERSION = 'repair-issue-classifier-v1';

export type RepairIssueCategory =
  | 'pixel_mismatch'
  | 'layout_drift'
  | 'text_loss'
  | 'missing_element'
  | 'color_mismatch'
  | 'confidence_low'
  | 'source_raster_missing'
  | 'generated_raster_missing'
  | 'diff_raster_missing'
  | 'fallback_required'
  | 'manual_review_required'
  | 'unknown';

export type RepairIssueSeverity = VisualWarningSeverity;

export type RepairSuggestion =
  | 'none'
  | 'run_repair_loop'
  | 'fallback_to_hybrid'
  | 'fallback_to_pixel'
  | 'manual_review';

export interface RepairIssue {
  version: typeof REPAIR_ISSUE_CLASSIFIER_VERSION;
  importId: string;
  templateId: string | null;
  pageId: string;
  pageNumber: number;
  category: RepairIssueCategory;
  severity: RepairIssueSeverity;
  score: number;
  metric: MetricKey | 'overall' | 'asset' | 'warning' | 'confidence';
  threshold: number | null;
  recommendedAction: VisualRecommendedAction;
  suggestedRepair: RepairSuggestion;
  message: string;
  warningCode?: string | null;
  region?: VisualWarning['region'];
}

export interface RepairIssueSummary {
  version: typeof REPAIR_ISSUE_CLASSIFIER_VERSION;
  importId: string;
  templateId: string | null;
  issueCount: number;
  pagesWithIssues: number;
  repairablePageCount: number;
  fallbackPageCount: number;
  manualReviewPageCount: number;
  byCategory: Partial<Record<RepairIssueCategory, number>>;
  bySeverity: Partial<Record<RepairIssueSeverity, number>>;
  suggestedRepairCounts: Partial<Record<RepairSuggestion, number>>;
  worstPage: {
    pageId: string;
    pageNumber: number;
    score: number;
    recommendedAction: VisualRecommendedAction;
  } | null;
}

export interface ClassifiedRepairIssues {
  version: typeof REPAIR_ISSUE_CLASSIFIER_VERSION;
  report: VisualImportQualityReport;
  issues: RepairIssue[];
  summary: RepairIssueSummary;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function severityForScore(score: number, threshold: number): RepairIssueSeverity {
  const gap = threshold - score;
  if (gap >= 0.30) return 'error';
  if (gap >= 0.15) return 'warning';
  return 'info';
}

function suggestionForAction(action: VisualRecommendedAction): RepairSuggestion {
  switch (action) {
    case 'repair':
      return 'run_repair_loop';
    case 'fallback_to_hybrid':
      return 'fallback_to_hybrid';
    case 'fallback_to_pixel':
      return 'fallback_to_pixel';
    case 'manual_review':
      return 'manual_review';
    case 'accept_with_warnings':
      return 'run_repair_loop';
    case 'accept':
    default:
      return 'none';
  }
}

function actionSeverity(action: VisualRecommendedAction): RepairIssueSeverity {
  switch (action) {
    case 'fallback_to_pixel':
    case 'manual_review':
      return 'error';
    case 'fallback_to_hybrid':
    case 'repair':
      return 'warning';
    case 'accept_with_warnings':
      return 'info';
    case 'accept':
    default:
      return 'info';
  }
}

function warningCategory(warning: VisualWarning): RepairIssueCategory {
  switch (warning.code) {
    case 'pixel_diff_high':
      return 'pixel_mismatch';
    case 'layout_drift_high':
      return 'layout_drift';
    case 'text_coverage_low':
      return 'text_loss';
    case 'missing_elements':
    case 'layers_missing':
      return 'missing_element';
    case 'color_drift_high':
      return 'color_mismatch';
    case 'source_raster_missing':
      return 'source_raster_missing';
    case 'rendered_raster_missing':
    case 'generated_raster_missing':
      return 'generated_raster_missing';
    case 'diff_raster_missing':
      return 'diff_raster_missing';
    default:
      return 'unknown';
  }
}

function metricCategory(metric: MetricKey): RepairIssueCategory {
  switch (metric) {
    case 'pixelDifference':
      return 'pixel_mismatch';
    case 'layoutDrift':
      return 'layout_drift';
    case 'textCoverage':
      return 'text_loss';
    case 'missingElement':
      return 'missing_element';
    case 'colorSimilarity':
      return 'color_mismatch';
    default:
      return 'unknown';
  }
}

function metricLabel(metric: MetricKey): string {
  switch (metric) {
    case 'pixelDifference':
      return 'Pixel similarity';
    case 'layoutDrift':
      return 'Layout drift';
    case 'textCoverage':
      return 'Text coverage';
    case 'missingElement':
      return 'Missing element';
    case 'colorSimilarity':
      return 'Colour similarity';
    default:
      return metric;
  }
}

function shouldAddActionIssue(action: VisualRecommendedAction): boolean {
  return action === 'repair'
    || action === 'fallback_to_hybrid'
    || action === 'fallback_to_pixel'
    || action === 'manual_review';
}

function buildIssueBase(
  report: VisualImportQualityReport,
  page: VisualPageQualityReport,
): Pick<RepairIssue, 'version' | 'importId' | 'templateId' | 'pageId' | 'pageNumber' | 'recommendedAction'> {
  return {
    version: REPAIR_ISSUE_CLASSIFIER_VERSION,
    importId: report.importId,
    templateId: report.templateId ?? null,
    pageId: page.pageId,
    pageNumber: page.pageNumber,
    recommendedAction: page.recommendedAction,
  };
}

export function classifyPageRepairIssues(
  report: VisualImportQualityReport,
  page: VisualPageQualityReport,
): RepairIssue[] {
  const issues: RepairIssue[] = [];
  const seen = new Set<string>();

  const addIssue = (issue: Omit<RepairIssue, 'version' | 'importId' | 'templateId' | 'pageId' | 'pageNumber' | 'recommendedAction'>) => {
    const key = [
      page.pageId,
      issue.category,
      issue.metric,
      issue.warningCode ?? '',
      issue.message,
    ].join(':');

    if (seen.has(key)) return;
    seen.add(key);

    issues.push({
      ...buildIssueBase(report, page),
      ...issue,
    });
  };

  const metricChecks: Array<[MetricKey, number]> = [
    ['pixelDifference', page.pixelDifferenceScore],
    ['textCoverage', page.textCoverageScore],
    ['layoutDrift', page.layoutDriftScore],
    ['missingElement', page.missingElementScore],
    ['colorSimilarity', page.colorSimilarityScore],
  ];

  for (const [metric, rawScore] of metricChecks) {
    const score = clamp01(rawScore);
    const threshold = METRIC_WARNING_THRESHOLDS[metric];

    if (score < threshold) {
      addIssue({
        category: metricCategory(metric),
        severity: severityForScore(score, threshold),
        score,
        metric,
        threshold,
        suggestedRepair: suggestionForAction(page.recommendedAction),
        message: `${metricLabel(metric)} is below threshold (${score.toFixed(2)} < ${threshold.toFixed(2)}).`,
        warningCode: null,
        region: null,
      });
    }
  }

  if (page.confidenceScore !== null && page.confidenceScore !== undefined) {
    const confidence = clamp01(page.confidenceScore);
    if (confidence < QUALITY_THRESHOLDS.repair) {
      addIssue({
        category: 'confidence_low',
        severity: severityForScore(confidence, QUALITY_THRESHOLDS.repair),
        score: confidence,
        metric: 'confidence',
        threshold: QUALITY_THRESHOLDS.repair,
        suggestedRepair: suggestionForAction(page.recommendedAction),
        message: `Extractor confidence is low (${confidence.toFixed(2)} < ${QUALITY_THRESHOLDS.repair.toFixed(2)}).`,
        warningCode: null,
        region: null,
      });
    }
  }

  if (!page.sourceRasterAssetId) {
    addIssue({
      category: 'source_raster_missing',
      severity: 'warning',
      score: 0,
      metric: 'asset',
      threshold: null,
      suggestedRepair: 'manual_review',
      message: 'Source raster artifact reference is missing for this page.',
      warningCode: 'source_raster_missing',
      region: null,
    });
  }

  if (!page.renderedRasterAssetId) {
    addIssue({
      category: 'generated_raster_missing',
      severity: 'warning',
      score: 0,
      metric: 'asset',
      threshold: null,
      suggestedRepair: 'run_repair_loop',
      message: 'Generated render artifact reference is missing for this page.',
      warningCode: 'generated_raster_missing',
      region: null,
    });
  }

  if (!page.diffRasterAssetId) {
    addIssue({
      category: 'diff_raster_missing',
      severity: 'info',
      score: 0,
      metric: 'asset',
      threshold: null,
      suggestedRepair: 'none',
      message: 'Diff raster artifact reference is missing for this page.',
      warningCode: 'diff_raster_missing',
      region: null,
    });
  }

  for (const warning of page.warnings ?? []) {
    addIssue({
      category: warningCategory(warning),
      severity: warning.severity,
      score: page.overallScore,
      metric: 'warning',
      threshold: null,
      suggestedRepair: suggestionForAction(page.recommendedAction),
      message: warning.message,
      warningCode: warning.code,
      region: warning.region ?? null,
    });
  }

  if (shouldAddActionIssue(page.recommendedAction)) {
    const category: RepairIssueCategory = page.recommendedAction === 'manual_review'
      ? 'manual_review_required'
      : page.recommendedAction.startsWith('fallback_to_')
        ? 'fallback_required'
        : 'unknown';

    addIssue({
      category,
      severity: actionSeverity(page.recommendedAction),
      score: page.overallScore,
      metric: 'overall',
      threshold: null,
      suggestedRepair: suggestionForAction(page.recommendedAction),
      message: `Page action is ${page.recommendedAction}; repair control flow should handle this page.`,
      warningCode: `action_${page.recommendedAction}`,
      region: null,
    });
  }

  return issues;
}

export function isRepairAction(action: VisualRecommendedAction): boolean {
  return action === 'repair'
    || action === 'fallback_to_hybrid'
    || action === 'manual_review';
}

export function isFallbackAction(action: VisualRecommendedAction): boolean {
  return action === 'fallback_to_hybrid'
    || action === 'fallback_to_pixel';
}

export function summarizeRepairIssues(
  report: VisualImportQualityReport,
  issues: RepairIssue[],
): RepairIssueSummary {
  const pagesWithIssues = new Set(issues.map((issue) => issue.pageId));

  const byCategory: Partial<Record<RepairIssueCategory, number>> = {};
  const bySeverity: Partial<Record<RepairIssueSeverity, number>> = {};
  const suggestedRepairCounts: Partial<Record<RepairSuggestion, number>> = {};

  for (const issue of issues) {
    byCategory[issue.category] = (byCategory[issue.category] ?? 0) + 1;
    bySeverity[issue.severity] = (bySeverity[issue.severity] ?? 0) + 1;
    suggestedRepairCounts[issue.suggestedRepair] = (suggestedRepairCounts[issue.suggestedRepair] ?? 0) + 1;
  }

  const worstPage = [...report.pages]
    .sort((a, b) => a.overallScore - b.overallScore)[0];

  return {
    version: REPAIR_ISSUE_CLASSIFIER_VERSION,
    importId: report.importId,
    templateId: report.templateId ?? null,
    issueCount: issues.length,
    pagesWithIssues: pagesWithIssues.size,
    repairablePageCount: report.pages.filter((page) => isRepairAction(page.recommendedAction)).length,
    fallbackPageCount: report.pages.filter((page) => isFallbackAction(page.recommendedAction)).length,
    manualReviewPageCount: report.pages.filter((page) => page.recommendedAction === 'manual_review').length,
    byCategory,
    bySeverity,
    suggestedRepairCounts,
    worstPage: worstPage
      ? {
          pageId: worstPage.pageId,
          pageNumber: worstPage.pageNumber,
          score: worstPage.overallScore,
          recommendedAction: worstPage.recommendedAction,
        }
      : null,
  };
}

export function classifyVisualQualityRepairIssues(
  report: VisualImportQualityReport,
): ClassifiedRepairIssues {
  const issues = report.pages.flatMap((page) => classifyPageRepairIssues(report, page));

  return {
    version: REPAIR_ISSUE_CLASSIFIER_VERSION,
    report,
    issues,
    summary: summarizeRepairIssues(report, issues),
  };
}
