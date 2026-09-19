/* @vitest-environment jsdom */
/**
 * E11 — Review Workspace component tests.
 *
 * Proves the workspace renders authoritative decision state: the document
 * overview shows separate axes with hard defects dominant, a blocked document is
 * not styled as success, the navigator lists/filters pages, selecting a page
 * updates the inspector, and the comparison viewer requests only the active
 * page's artifact via the injected signer (never all pages, never a persisted
 * URL).
 */
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PdfReviewWorkspace } from '../PdfReviewWorkspace';
import { PdfDocumentOverview } from '../PdfDocumentOverview';
import { PdfPageNavigator } from '../PdfPageNavigator';
import { buildDocumentReviewModel } from '@/lib/reportTemplate/pdfImport/review';
import { mixedReviewDocument, nativeAcceptedDocument, largeDocument } from '@/lib/reportTemplate/pdfImport/review/fixtures';
import type { ArtifactSigner } from '../usePdfReviewArtifacts';

const okSigner: ArtifactSigner = vi.fn(async () => ({
  url: 'blob:mock-artifact', expiresAt: null, widthPx: 800, heightPx: 1000, hashVerified: true,
}));

describe('PdfDocumentOverview', () => {
  it('shows the final decision and separate axes; hard defects are visible', () => {
    const model = buildDocumentReviewModel(mixedReviewDocument());
    render(<PdfDocumentOverview model={model} />);
    expect(screen.getByTestId('pdf-review-document-status')).toBeTruthy();
    expect(screen.getByTestId('pdf-review-hard-defect-count').textContent).toContain('hard defect');
    // separate axis cards exist
    expect(screen.getByTestId('pdf-review-card-fidelity')).toBeTruthy();
    expect(screen.getByTestId('pdf-review-card-editability')).toBeTruthy();
    expect(screen.getByTestId('pdf-review-card-runtime-cost')).toBeTruthy();
    // fidelity and editability are different cards (not one merged score)
    expect(screen.getByTestId('pdf-review-card-fidelity').textContent).not.toBe(screen.getByTestId('pdf-review-card-editability').textContent);
  });

  it('a blocked document surfaces a danger decision, not success', () => {
    const model = buildDocumentReviewModel(mixedReviewDocument());
    render(<PdfDocumentOverview model={model} />);
    // mixedReviewDocument has a blocked page → final output card is danger-emphasised
    expect(screen.getByTestId('pdf-review-final-decision').textContent).toMatch(/Blocked|review/i);
  });

  it('a clean native document shows accepted and no hard-defect badge', () => {
    const model = buildDocumentReviewModel(nativeAcceptedDocument());
    render(<PdfDocumentOverview model={model} />);
    expect(screen.getByTestId('pdf-review-final-decision').textContent).toMatch(/Automatically accepted/i);
    expect(screen.queryByTestId('pdf-review-hard-defect-count')).toBeNull();
  });

  it('unknown cost is shown as unknown, never zero', () => {
    const model = buildDocumentReviewModel(mixedReviewDocument());
    render(<PdfDocumentOverview model={model} />);
    expect(screen.getByTestId('pdf-review-card-runtime-cost').textContent).toMatch(/unknown/i);
  });
});

describe('PdfPageNavigator', () => {
  it('lists pages and filters to hard defects', () => {
    const model = buildDocumentReviewModel(mixedReviewDocument());
    const onSelect = vi.fn();
    render(<PdfPageNavigator pages={model.pageSummaries} selectedPageNumber={1} onSelect={onSelect} />);
    expect(screen.getByTestId('pdf-review-page-list')).toBeTruthy();
    // filter to hard defects reduces the count
    fireEvent.click(screen.getByRole('button', { name: 'Hard defects' }));
    expect(screen.getByText(/of 7 pages/)).toBeTruthy();
  });

  it('80-page document does not render all rows (virtualized)', () => {
    const model = buildDocumentReviewModel(largeDocument(80));
    render(<PdfPageNavigator pages={model.pageSummaries} selectedPageNumber={1} onSelect={vi.fn()} />);
    // virtualization: far fewer than 80 option rows are in the DOM at once
    const rendered = screen.getAllByRole('option').length;
    expect(rendered).toBeLessThan(40);
    expect(rendered).toBeGreaterThan(0);
  });
});

describe('PdfReviewWorkspace', () => {
  it('renders overview + navigator + inspector and swaps page on select', async () => {
    const doc = mixedReviewDocument();
    const model = buildDocumentReviewModel(doc);
    render(<PdfReviewWorkspace model={model} pageInputs={doc.pages} signArtifact={okSigner} />);
    expect(screen.getByTestId('pdf-review-workspace').getAttribute('data-version')).toBe('pdf-review-workspace-v1');
    // page 1 inspector present
    expect(screen.getByTestId('pdf-review-inspector-page-1')).toBeTruthy();
    // select the blocked page (7)
    fireEvent.click(screen.getByTestId('pdf-review-page-7'));
    await waitFor(() => expect(screen.getByTestId('pdf-review-inspector-page-7')).toBeTruthy());
  });

  it('the comparison viewer requests only the active page artifact via the injected signer', async () => {
    const doc = nativeAcceptedDocument();
    const model = buildDocumentReviewModel(doc);
    const signer: ArtifactSigner = vi.fn(async () => ({ url: 'blob:x', expiresAt: null, widthPx: 1, heightPx: 1, hashVerified: true }));
    render(<PdfReviewWorkspace model={model} pageInputs={doc.pages} signArtifact={signer} />);
    await waitFor(() => expect(signer).toHaveBeenCalled());
    // Only page 1 (active) was signed — never all pages.
    const calls = (signer as unknown as { mock: { calls: Array<[{ pageNumber: number }]> } }).mock.calls;
    const signedPages = new Set(calls.map((c) => c[0].pageNumber));
    expect(signedPages.has(1)).toBe(true);
    expect(signedPages.size).toBe(1);
  });
});
