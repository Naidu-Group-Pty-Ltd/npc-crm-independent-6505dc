/**
 * Per-page review view-model builder (Path-to-100 v2 · C7.1).
 *
 * Pins the assembly the real per-page review grid depends on: correct signed-URL
 * selection per page, metric breakdown, applied policy resolution, coverage
 * (scored vs unscored), artifact availability, eager/lazy imagery, and the
 * responsive-limit flag — so the numbers-only "first page only" surface is
 * replaced by trustworthy per-page data.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPageReviewModels,
  PAGE_REVIEW_MODEL_VERSION,
  PAGE_REVIEW_EAGER_IMAGE_LIMIT,
  PAGE_REVIEW_RESPONSIVE_PAGE_LIMIT,
} from '../ingestion/visualQuality/pageReviewModel';
import type {
  VisualImportQualityReport,
  VisualPageQualityReport,
} from '../ingestion/visualQuality/schema';
import type { ReportTemplate } from '../templateSchema';
import { pixelFallbackPolicy, nativePolicy } from '../rendering/pdfImportPagePolicy';

function pageReport(n: number, overrides: Partial<VisualPageQualityReport> = {}): VisualPageQualityReport {
  return {
    pageId: `docling-page-${n}`,
    pageNumber: n,
    overallScore: 0.9,
    pixelDifferenceScore: 0.9,
    textCoverageScore: 0.85,
    layoutDriftScore: 0.8,
    missingElementScore: 0.95,
    colorSimilarityScore: 0.92,
    recommendedAction: 'accept',
    warnings: [],
    ...overrides,
  };
}

function report(pages: VisualPageQualityReport[]): VisualImportQualityReport {
  return {
    importId: 'imp-1',
    templateId: 't-1',
    overallScore: 0.9,
    pages,
    repairPassesApplied: 0,
    finalMode: 'hybrid',
    manualReviewRequired: false,
    generatedAt: '2026-07-16T00:00:00.000Z',
  };
}

function template(pageCount: number): ReportTemplate {
  return {
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: Array.from({ length: pageCount }, (_, i) => ({
      id: `docling-page-${i + 1}`,
      name: `Cover ${i + 1}`,
      size: { width: 595, height: 842 },
      background: {},
      blocks: [],
    })),
  } as unknown as ReportTemplate;
}

const SIGNED = {
  '1:source': 'https://x/1-source.png',
  '1:generated': 'https://x/1-generated.png',
  '1:diff': 'https://x/1-diff.png',
  '2:source': 'https://x/2-source.png',
};

describe('buildPageReviewModels', () => {
  it('carries the contract version and orders pages by page number', () => {
    const res = buildPageReviewModels({ report: report([pageReport(2), pageReport(1)]) });
    expect(res.version).toBe(PAGE_REVIEW_MODEL_VERSION);
    expect(res.pages.map((p) => p.pageNumber)).toEqual([1, 2]);
  });

  it('selects the per-page signed URLs (not just the first page)', () => {
    const res = buildPageReviewModels({ report: report([pageReport(1), pageReport(2)]), signedUrls: SIGNED });
    const [p1, p2] = res.pages;
    expect(p1.images).toEqual({
      source: 'https://x/1-source.png',
      generated: 'https://x/1-generated.png',
      diff: 'https://x/1-diff.png',
    });
    expect(p1.artifacts).toEqual({ source: true, generated: true, diff: true });
    // Page 2 only has a source raster persisted.
    expect(p2.images).toEqual({ source: 'https://x/2-source.png', generated: null, diff: null });
    expect(p2.artifacts).toEqual({ source: true, generated: false, diff: false });
  });

  it('builds the full metric breakdown from the report', () => {
    const res = buildPageReviewModels({ report: report([pageReport(1, { textCoverageScore: 0.5 })]) });
    const metrics = res.pages[0].metrics;
    expect(metrics.map((m) => m.label)).toEqual(['Pixel match', 'Text coverage', 'Layout', 'Completeness', 'Colour']);
    expect(metrics.find((m) => m.label === 'Text coverage')?.score).toBe(0.5);
    expect(res.pages[0].overallScore).toBe(0.9);
    expect(res.pages[0].recommendedAction).toBe('accept');
  });

  it('resolves the applied per-page policy from explicit gate decisions', () => {
    const res = buildPageReviewModels({
      report: report([pageReport(1), pageReport(2)]),
      policiesByPageId: { 'docling-page-1': pixelFallbackPolicy() },
      template: template(2),
    });
    expect(res.pages[0].outputStrategy).toBe('raster-only');
    // Page 2 with no explicit decision resolves its own (native) policy from the template.
    expect(res.pages[1].outputStrategy).toBe('native');
  });

  it('falls back to resolving policy from the template page when no explicit decision exists', () => {
    const t = template(1);
    (t.pages[0].meta as any) = { pdfImport: nativePolicy('hybrid') };
    const res = buildPageReviewModels({ report: report([pageReport(1)]), template: t });
    expect(res.pages[0].policy?.finalMode).toBe('hybrid');
  });

  it('includes template pages missing from the report as unscored + needs review', () => {
    const res = buildPageReviewModels({ report: report([pageReport(1)]), template: template(3) });
    expect(res.totalPages).toBe(3);
    expect(res.scoredPages).toBe(1);
    expect(res.unscoredPages).toBe(2);
    const p3 = res.pages.find((p) => p.pageNumber === 3)!;
    expect(p3.scored).toBe(false);
    expect(p3.overallScore).toBeNull();
    expect(p3.metrics).toEqual([]);
    // unscored pages count toward "needs review" (never a silent pass).
    expect(res.pagesNeedingReview).toBe(2);
  });

  it('uses the template page name as the label, else a page-number fallback', () => {
    const withTpl = buildPageReviewModels({ report: report([pageReport(1)]), template: template(1) });
    expect(withTpl.pages[0].label).toBe('Cover 1');
    const noTpl = buildPageReviewModels({ report: report([pageReport(1)]) });
    expect(noTpl.pages[0].label).toBe('Page 1');
  });

  it('eager-loads imagery only for the first pages and lazy-loads the rest', () => {
    const many = Array.from({ length: PAGE_REVIEW_EAGER_IMAGE_LIMIT + 2 }, (_, i) => pageReport(i + 1));
    const res = buildPageReviewModels({ report: report(many) });
    expect(res.pages[0].eagerImages).toBe(true);
    expect(res.pages[PAGE_REVIEW_EAGER_IMAGE_LIMIT - 1].eagerImages).toBe(true);
    expect(res.pages[PAGE_REVIEW_EAGER_IMAGE_LIMIT].eagerImages).toBe(false);
  });

  it('flags responsiveness beyond the page limit', () => {
    const under = buildPageReviewModels({ report: report(Array.from({ length: PAGE_REVIEW_RESPONSIVE_PAGE_LIMIT }, (_, i) => pageReport(i + 1))) });
    expect(under.responsive).toBe(true);
    const over = buildPageReviewModels({ report: report(Array.from({ length: PAGE_REVIEW_RESPONSIVE_PAGE_LIMIT + 1 }, (_, i) => pageReport(i + 1))) });
    expect(over.responsive).toBe(false);
  });

  it('counts manual_review / repair pages as needing review', () => {
    const res = buildPageReviewModels({
      report: report([
        pageReport(1, { recommendedAction: 'accept' }),
        pageReport(2, { recommendedAction: 'manual_review' }),
        pageReport(3, { recommendedAction: 'repair' }),
      ]),
    });
    expect(res.pagesNeedingReview).toBe(2);
  });

  it('returns an empty collection when there is no report and no template', () => {
    const res = buildPageReviewModels({});
    expect(res.pages).toEqual([]);
    expect(res.totalPages).toBe(0);
    expect(res.responsive).toBe(true);
  });
});
