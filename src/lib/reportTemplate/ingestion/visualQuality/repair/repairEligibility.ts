import type {
  VisualPageQualityReport,
  VisualRecommendedAction,
} from '../schema';
import type {
  ClassifiedRepairIssues,
  RepairIssue,
  RepairIssueCategory,
  RepairIssueSeverity,
} from './issueClassifier';

export const REPAIR_ELIGIBILITY_VERSION = 'repair-eligibility-gate-v1';

export type RepairEligibilityDecision =
  | 'eligible'
  | 'no_issues'
  | 'blocked'
  | 'fallback'
  | 'manual_review';

export type RepairEligibilityBlockReason =
  | 'source_raster_missing'
  | 'generated_raster_missing'
  | 'fallback_pixel_required'
  | 'manual_review_required'
  | 'no_repairable_issues'
  | 'action_not_repairable'
  | 'unknown_blocker';

export type RepairFallbackMode = 'hybrid' | 'pixel-perfect';

export interface PageRepairEligibility {
  version: typeof REPAIR_ELIGIBILITY_VERSION;
  importId: string;
  templateId: string | null;
  pageId: string;
  pageNumber: number;
  score: number;
  recommendedAction: VisualRecommendedAction;
  decision: RepairEligibilityDecision;
  eligibleForRepairLoop: boolean;
  requiresFallback: boolean;
  fallbackMode: RepairFallbackMode | null;
  requiresManualReview: boolean;
  issueCount: number;
  highestSeverity: RepairIssueSeverity | null;
  repairIssueCategories: RepairIssueCategory[];
  blockingReasons: RepairEligibilityBlockReason[];
  message: string;
}

export interface VisualRepairEligibility {
  version: typeof REPAIR_ELIGIBILITY_VERSION;
  importId: string;
  templateId: string | null;
  canRunRepairLoop: boolean;
  requiresFallback: boolean;
  requiresManualReview: boolean;
  pageCount: number;
  eligiblePageCount: number;
  blockedPageCount: number;
  fallbackPageCount: number;
  manualReviewPageCount: number;
  noIssuePageCount: number;
  blockingReasons: Partial<Record<RepairEligibilityBlockReason, number>>;
  pages: PageRepairEligibility[];
}

const REPAIRABLE_CATEGORIES = new Set<RepairIssueCategory>([
  'pixel_mismatch',
  'layout_drift',
  'text_loss',
  'missing_element',
  'color_mismatch',
  'confidence_low',
]);

function severityRank(severity: RepairIssueSeverity): number {
  switch (severity) {
    case 'error':
      return 3;
    case 'warning':
      return 2;
    case 'info':
    default:
      return 1;
  }
}

function highestSeverity(issues: RepairIssue[]): RepairIssueSeverity | null {
  const sorted = [...issues].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  return sorted[0]?.severity ?? null;
}

function uniqueCategories(issues: RepairIssue[]): RepairIssueCategory[] {
  return [...new Set(issues.map((issue) => issue.category))];
}

function repairableCategories(issues: RepairIssue[]): RepairIssueCategory[] {
  return [...new Set(
    issues
      .filter((issue) => REPAIRABLE_CATEGORIES.has(issue.category))
      .map((issue) => issue.category),
  )];
}

function actionCanEnterRepairLoop(action: VisualRecommendedAction): boolean {
  return action === 'repair' || action === 'fallback_to_hybrid';
}

function actionIsNoIssue(action: VisualRecommendedAction): boolean {
  return action === 'accept' || action === 'accept_with_warnings';
}

function issueExists(issues: RepairIssue[], category: RepairIssueCategory): boolean {
  return issues.some((issue) => issue.category === category);
}

function pageIssues(
  classified: ClassifiedRepairIssues,
  page: VisualPageQualityReport,
): RepairIssue[] {
  return classified.issues.filter((issue) => issue.pageId === page.pageId);
}

function basePageDecision(
  classified: ClassifiedRepairIssues,
  page: VisualPageQualityReport,
  issues: RepairIssue[],
): Omit<PageRepairEligibility, 'decision' | 'eligibleForRepairLoop' | 'requiresFallback' | 'fallbackMode' | 'requiresManualReview' | 'blockingReasons' | 'message'> {
  return {
    version: REPAIR_ELIGIBILITY_VERSION,
    importId: classified.report.importId,
    templateId: classified.report.templateId ?? null,
    pageId: page.pageId,
    pageNumber: page.pageNumber,
    score: page.overallScore,
    recommendedAction: page.recommendedAction,
    issueCount: issues.length,
    highestSeverity: highestSeverity(issues),
    repairIssueCategories: uniqueCategories(issues),
  };
}

export function evaluatePageRepairEligibility(
  classified: ClassifiedRepairIssues,
  page: VisualPageQualityReport,
): PageRepairEligibility {
  const issues = pageIssues(classified, page);
  const base = basePageDecision(classified, page, issues);
  const blockers: RepairEligibilityBlockReason[] = [];

  if (issueExists(issues, 'source_raster_missing')) {
    blockers.push('source_raster_missing');
  }

  if (issueExists(issues, 'generated_raster_missing')) {
    blockers.push('generated_raster_missing');
  }

  if (page.recommendedAction === 'fallback_to_pixel') {
    blockers.push('fallback_pixel_required');
    return {
      ...base,
      decision: 'fallback',
      eligibleForRepairLoop: false,
      requiresFallback: true,
      fallbackMode: 'pixel-perfect',
      requiresManualReview: false,
      blockingReasons: blockers,
      message: 'Page is below the safe repair band and should fall back to pixel-perfect rendering.',
    };
  }

  if (page.recommendedAction === 'manual_review') {
    blockers.push('manual_review_required');
    return {
      ...base,
      decision: 'manual_review',
      eligibleForRepairLoop: false,
      requiresFallback: false,
      fallbackMode: null,
      requiresManualReview: true,
      blockingReasons: blockers,
      message: 'Page requires manual review and is not eligible for automatic repair.',
    };
  }

  if (blockers.length > 0) {
    return {
      ...base,
      decision: 'blocked',
      eligibleForRepairLoop: false,
      requiresFallback: false,
      fallbackMode: page.recommendedAction === 'fallback_to_hybrid' ? 'hybrid' : null,
      requiresManualReview: false,
      blockingReasons: blockers,
      message: 'Page is blocked from repair because required visual QA artifacts are missing.',
    };
  }

  const repairable = repairableCategories(issues);

  if (actionCanEnterRepairLoop(page.recommendedAction) && repairable.length > 0) {
    return {
      ...base,
      decision: 'eligible',
      eligibleForRepairLoop: true,
      requiresFallback: false,
      fallbackMode: page.recommendedAction === 'fallback_to_hybrid' ? 'hybrid' : null,
      requiresManualReview: false,
      blockingReasons: [],
      message: page.recommendedAction === 'fallback_to_hybrid'
        ? 'Page is eligible for one bounded repair attempt before hybrid fallback.'
        : 'Page is eligible for bounded automatic repair.',
    };
  }

  if (actionCanEnterRepairLoop(page.recommendedAction) && repairable.length === 0) {
    blockers.push('no_repairable_issues');
    return {
      ...base,
      decision: 'blocked',
      eligibleForRepairLoop: false,
      requiresFallback: false,
      fallbackMode: page.recommendedAction === 'fallback_to_hybrid' ? 'hybrid' : null,
      requiresManualReview: false,
      blockingReasons: blockers,
      message: 'Page action suggests repair, but no repairable issue category was found.',
    };
  }

  if (actionIsNoIssue(page.recommendedAction)) {
    return {
      ...base,
      decision: 'no_issues',
      eligibleForRepairLoop: false,
      requiresFallback: false,
      fallbackMode: null,
      requiresManualReview: false,
      blockingReasons: [],
      message: issues.length > 0
        ? 'Page has non-blocking warnings but does not need automatic repair.'
        : 'Page passed visual QA and does not need repair.',
    };
  }

  blockers.push('action_not_repairable');
  return {
    ...base,
    decision: 'blocked',
    eligibleForRepairLoop: false,
    requiresFallback: false,
    fallbackMode: null,
    requiresManualReview: false,
    blockingReasons: blockers,
    message: `Page action ${page.recommendedAction} is not eligible for automatic repair.`,
  };
}

export function evaluateVisualRepairEligibility(
  classified: ClassifiedRepairIssues,
): VisualRepairEligibility {
  const pages = classified.report.pages.map((page) => evaluatePageRepairEligibility(classified, page));
  const blockingReasons: VisualRepairEligibility['blockingReasons'] = {};

  for (const page of pages) {
    for (const reason of page.blockingReasons) {
      blockingReasons[reason] = (blockingReasons[reason] ?? 0) + 1;
    }
  }

  return {
    version: REPAIR_ELIGIBILITY_VERSION,
    importId: classified.report.importId,
    templateId: classified.report.templateId ?? null,
    canRunRepairLoop: pages.some((page) => page.eligibleForRepairLoop),
    requiresFallback: pages.some((page) => page.requiresFallback),
    requiresManualReview: pages.some((page) => page.requiresManualReview),
    pageCount: pages.length,
    eligiblePageCount: pages.filter((page) => page.decision === 'eligible').length,
    blockedPageCount: pages.filter((page) => page.decision === 'blocked').length,
    fallbackPageCount: pages.filter((page) => page.decision === 'fallback').length,
    manualReviewPageCount: pages.filter((page) => page.decision === 'manual_review').length,
    noIssuePageCount: pages.filter((page) => page.decision === 'no_issues').length,
    blockingReasons,
    pages,
  };
}
