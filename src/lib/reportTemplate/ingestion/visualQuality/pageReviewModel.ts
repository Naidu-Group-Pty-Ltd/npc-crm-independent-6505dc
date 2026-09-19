/**
 * Per-page review view-model (Path-to-100 v2 · C7.1).
 *
 * Assembles the data a real per-page review card needs — source / generated /
 * diff imagery, the full metric breakdown, coverage, warnings, the applied
 * output policy (C5/C6), a per-page repair diary, and artifact availability —
 * from the three things the review surface already has:
 *
 *   1. the persisted `VisualImportQualityReport` (per-page scores + actions),
 *   2. the signed-URL map keyed `${pageNumber}:source|generated|diff`, and
 *   3. the reviewed template (for page labels + the applied per-page policy).
 *
 * Pure and deterministic — no I/O, no React. The review dialog renders this
 * view-model; unit tests pin the assembly. Replaces the numbers-only "Pages"
 * card that surfaced only the first page's links.
 */
import type {
  VisualImportQualityReport,
  VisualPageQualityReport,
  VisualRecommendedAction,
  VisualWarning,
} from './schema';
import type { ReportTemplate, Page } from '../../templateSchema';
import {
  resolvePageOutputPolicy,
  type PdfImportPagePolicy,
  type PageOutputStrategy,
} from '../../rendering/pdfImportPagePolicy';

export const PAGE_REVIEW_MODEL_VERSION = 'visual-quality-page-review-v1';

/**
 * Pages beyond this index lazy-load their imagery (`loading="lazy"`); the first
 * few load eagerly so the top of the grid is instant.
 */
export const PAGE_REVIEW_EAGER_IMAGE_LIMIT = 6;

/**
 * The grid is designed to stay responsive up to this many pages; beyond it the
 * caller should page/virtualise. Surfaced so the UI + tests share one number.
 */
export const PAGE_REVIEW_RESPONSIVE_PAGE_LIMIT = 25;

export interface PageReviewImages {
  source: string | null;
  generated: string | null;
  diff: string | null;
}

export interface PageReviewArtifactAvailability {
  source: boolean;
  generated: boolean;
  diff: boolean;
}

export interface PageReviewMetric {
  key: string;
  label: string;
  /** 0..1, or null when the metric was not computed (unknown, not "bad"). */
  score: number | null;
}

export interface PageRepairDiaryEntry {
  pass: number;
  action: string;
  scoreBefore: number | null;
  scoreAfter: number | null;
  accepted: boolean;
  note?: string;
}

export interface PageReviewModel {
  pageId: string;
  pageNumber: number;
  label: string;
  /** True when this page carries a computed visual-quality score. */
  scored: boolean;
  overallScore: number | null;
  metrics: PageReviewMetric[];
  recommendedAction: VisualRecommendedAction | null;
  warnings: VisualWarning[];
  /** Applied per-page output policy (C5/C6); null when none is resolvable. */
  policy: PdfImportPagePolicy | null;
  outputStrategy: PageOutputStrategy | null;
  images: PageReviewImages;
  artifacts: PageReviewArtifactAvailability;
  /** Whether this page's imagery should eager-load (top of the grid). */
  eagerImages: boolean;
  repairDiary: PageRepairDiaryEntry[];
}

export interface PageReviewCollection {
  version: typeof PAGE_REVIEW_MODEL_VERSION;
  pages: PageReviewModel[];
  totalPages: number;
  scoredPages: number;
  unscoredPages: number;
  pagesNeedingReview: number;
  /** False when the page count exceeds the responsive limit. */
  responsive: boolean;
}

export interface BuildPageReviewModelsInput {
  report?: VisualImportQualityReport | null;
  /** Signed URLs keyed `${pageNumber}:source|generated|diff`. */
  signedUrls?: Record<string, string> | null;
  /** Reviewed template — supplies page labels + the applied per-page policy. */
  template?: ReportTemplate | null;
  /** Explicit per-page policies (gate `pageDecisions`), keyed by pageId. */
  policiesByPageId?: Record<string, PdfImportPagePolicy> | null;
  /** Per-page repair diary entries keyed by pageId. */
  repairDiaryByPageId?: Record<string, PageRepairDiaryEntry[]> | null;
}

const METRIC_LABELS: Array<{ key: keyof VisualPageQualityReport; label: string }> = [
  { key: 'pixelDifferenceScore', label: 'Pixel match' },
  { key: 'textCoverageScore', label: 'Text coverage' },
  { key: 'layoutDriftScore', label: 'Layout' },
  { key: 'missingElementScore', label: 'Completeness' },
  { key: 'colorSimilarityScore', label: 'Colour' },
];

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function signedUrl(map: Record<string, string>, pageNumber: number, kind: 'source' | 'generated' | 'diff'): string | null {
  const url = map[`${pageNumber}:${kind}`];
  return typeof url === 'string' && url.length > 0 ? url : null;
}

function pageMetrics(report: VisualPageQualityReport | undefined): PageReviewMetric[] {
  if (!report) return [];
  return METRIC_LABELS.map(({ key, label }) => ({
    key: String(key),
    label,
    score: finiteOrNull(report[key]),
  }));
}

function policyForPage(
  pageId: string,
  policiesByPageId: Record<string, PdfImportPagePolicy> | null | undefined,
  page: Page | undefined,
): PdfImportPagePolicy | null {
  const explicit = policiesByPageId?.[pageId];
  if (explicit) return explicit;
  // Fall back to resolving the page's own applied/legacy policy (C5).
  return page ? resolvePageOutputPolicy(page) : null;
}

/**
 * Build the ordered per-page review view-models. Pages are driven by the
 * persisted report when present (they carry scores + page numbers) and by the
 * template otherwise; template pages missing from the report are included as
 * unscored entries so the reviewer sees the whole document, never a false pass.
 */
export function buildPageReviewModels(input: BuildPageReviewModelsInput): PageReviewCollection {
  const signed = input.signedUrls ?? {};
  const policies = input.policiesByPageId ?? null;
  const diaries = input.repairDiaryByPageId ?? null;
  const templatePages = input.template?.pages ?? [];
  const pageById = new Map<string, Page>(templatePages.map((p) => [p.id, p as Page]));

  const reportPages = [...(input.report?.pages ?? [])].sort((a, b) => a.pageNumber - b.pageNumber);
  const reportPageIds = new Set(reportPages.map((p) => p.pageId));

  type Seed = { pageId: string; pageNumber: number; report?: VisualPageQualityReport; scored: boolean };
  const seeds: Seed[] = reportPages.map((p) => ({ pageId: p.pageId, pageNumber: p.pageNumber, report: p, scored: true }));

  // Include template pages that were never scored (e.g. > coverage) so they
  // are visibly "unscored + needs review" rather than silently dropped.
  templatePages.forEach((page, index) => {
    if (reportPageIds.has(page.id)) return;
    seeds.push({ pageId: page.id, pageNumber: index + 1, scored: false });
  });

  seeds.sort((a, b) => a.pageNumber - b.pageNumber);

  const pages: PageReviewModel[] = seeds.map((seed, index) => {
    const page = pageById.get(seed.pageId);
    const policy = policyForPage(seed.pageId, policies, page);
    const images: PageReviewImages = {
      source: signedUrl(signed, seed.pageNumber, 'source'),
      generated: signedUrl(signed, seed.pageNumber, 'generated'),
      diff: signedUrl(signed, seed.pageNumber, 'diff'),
    };
    return {
      pageId: seed.pageId,
      pageNumber: seed.pageNumber,
      label: (page?.name && String(page.name)) || `Page ${seed.pageNumber}`,
      scored: seed.scored,
      overallScore: seed.report ? finiteOrNull(seed.report.overallScore) : null,
      metrics: pageMetrics(seed.report),
      recommendedAction: seed.report?.recommendedAction ?? null,
      warnings: seed.report?.warnings ?? [],
      policy,
      outputStrategy: policy?.outputStrategy ?? null,
      images,
      artifacts: {
        source: Boolean(images.source),
        generated: Boolean(images.generated),
        diff: Boolean(images.diff),
      },
      eagerImages: index < PAGE_REVIEW_EAGER_IMAGE_LIMIT,
      repairDiary: diaries?.[seed.pageId] ?? [],
    };
  });

  const scoredPages = pages.filter((p) => p.scored).length;
  const pagesNeedingReview = pages.filter(
    (p) => !p.scored || p.recommendedAction === 'manual_review' || p.recommendedAction === 'repair',
  ).length;

  return {
    version: PAGE_REVIEW_MODEL_VERSION,
    pages,
    totalPages: pages.length,
    scoredPages,
    unscoredPages: pages.length - scoredPages,
    pagesNeedingReview,
    responsive: pages.length <= PAGE_REVIEW_RESPONSIVE_PAGE_LIMIT,
  };
}
