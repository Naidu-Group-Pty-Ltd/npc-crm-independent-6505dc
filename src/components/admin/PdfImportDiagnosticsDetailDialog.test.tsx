/* @vitest-environment jsdom */
/**
 * PdfImportDiagnosticsDetailDialog fetch → build → render (Path-to-100 v2 · C8).
 *
 * Proves the drill-down wires the edge `detail` response through the pure
 * `buildDiagnosticsDetail` builder and renders the correlated view: identifiers,
 * the quality rollup, and — critically — the failed-page categories kept as
 * DISTINCT sources with their compact page ranges.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeSecureFunction = vi.fn();
vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: (...args: unknown[]) => invokeSecureFunction(...args),
  describeAuthError: () => null,
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { PdfImportDiagnosticsDetailDialog } from './PdfImportDiagnosticsDetailDialog';

const DETAIL_RESPONSE = {
  job: {
    id: 'job-1',
    template_id: 'tpl-1',
    template_import_id: 'imp-1',
    source_file_name: 'report.pdf',
    source_file_hash: 'sha256:abcdef0123456789',
    mode: 'hybrid',
    service_class: 'default',
    status: 'succeeded',
    page_count: 10,
    duration_ms: 42000,
    ssim_score: 0.88,
    diagnostics_path: 'job-1/diagnostics.json',
    result_payload: { page_raster_paths: ['p1'], rasters_manifest_path: 'm' },
    plan_payload: { requested_mode: 'hybrid', dispatch_effective_mode: 'hybrid', selected_lane: 'text-native' },
  },
  importId: 'imp-1',
  gate: {
    finalScore: 0.82,
    coverage: 'partial',
    repairPassesApplied: 1,
    manualReviewRequired: true,
    pagesNative: 7,
    pagesHybridFallback: 2,
    pagesPixelFallback: 1,
    pagesScored: 8,
    pagesUnscored: [9, 10],
    perPage: [{ pageNumber: 2, score: 0.4, recommendedAction: 'manual_review' }],
    pageDecisions: { 'docling-page-3': { outputStrategy: 'raster-only', decision: { action: 'fallback_unavailable', score: 0.3 } } },
  },
  chunks: [
    { page_start: 1, page_end: 5, status: 'succeeded', attempts: 1 },
    { page_start: 6, page_end: 10, status: 'failed', attempts: 2 },
  ],
  missingArtifactPages: [10],
  signedUrls: { diagnostics: 'https://x/diag' },
};

describe('PdfImportDiagnosticsDetailDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches, builds, and renders the correlated detail with distinct failed-page categories', async () => {
    invokeSecureFunction.mockResolvedValue({ data: DETAIL_RESPONSE, error: null });
    render(<PdfImportDiagnosticsDetailDialog jobId="job-1" open onOpenChange={() => {}} />);

    // Fetched via the detail operation.
    expect(invokeSecureFunction).toHaveBeenCalledWith('pdf-import-diagnostics', { operation: 'detail', jobId: 'job-1' });

    // Quality rollup rendered (awaits the async effect).
    expect(await screen.findByText('82%')).toBeInTheDocument();

    // Failed-page categories are DISTINCT groups, each with its own page ranges.
    // The dialog renders in a portal, so query the document for the anchored cards.
    await screen.findByText('82%');
    const infra = document.querySelector('[data-category="infra_failure"]') as HTMLElement;
    expect(within(infra).getByText('6-10')).toBeInTheDocument();
    const unscored = document.querySelector('[data-category="unscored"]') as HTMLElement;
    expect(within(unscored).getByText('9-10')).toBeInTheDocument();
    const missing = document.querySelector('[data-category="missing_artifacts"]') as HTMLElement;
    expect(within(missing).getByText('10')).toBeInTheDocument();

    // A signed artifact link is surfaced.
    expect(screen.getByRole('link', { name: /diagnostics/i })).toHaveAttribute('href', 'https://x/diag');
  });

  it('does not fetch when closed', () => {
    invokeSecureFunction.mockResolvedValue({ data: DETAIL_RESPONSE, error: null });
    render(<PdfImportDiagnosticsDetailDialog jobId="job-1" open={false} onOpenChange={() => {}} />);
    expect(invokeSecureFunction).not.toHaveBeenCalled();
  });
});
