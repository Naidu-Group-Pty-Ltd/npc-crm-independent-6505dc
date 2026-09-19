/* @vitest-environment jsdom */
/**
 * VisualQualityPageReviewGrid / Card render + interaction (Path-to-100 v2 · C7).
 *
 * Proves the real per-page review surface: one card per page with source /
 * generated / diff imagery (lazy beyond the top of the grid), score + coverage,
 * and per-page actions whose availability follows the pure action policy —
 * raster fallbacks are disabled (with a reason) when a page has no source
 * raster, and a confirm-gated action only fires after confirmation.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VisualQualityPageReviewGrid } from './VisualQualityPageReviewGrid';
import { buildPageReviewModels } from '@/lib/reportTemplate/ingestion/visualQuality';
import type { VisualImportQualityReport, VisualPageQualityReport } from '@/lib/reportTemplate/ingestion/visualQuality';
import type { ReportTemplate } from '@/lib/reportTemplate/templateSchema';

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
    importId: 'imp-1', templateId: 't-1', overallScore: 0.9, pages,
    repairPassesApplied: 0, finalMode: 'hybrid', manualReviewRequired: false,
    generatedAt: '2026-07-16T00:00:00.000Z',
  };
}

function template(pageCount: number): ReportTemplate {
  return {
    version: 1, tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: Array.from({ length: pageCount }, (_, i) => ({
      id: `docling-page-${i + 1}`, name: `Cover ${i + 1}`,
      size: { width: 595, height: 842 }, background: {}, blocks: [],
    })),
  } as unknown as ReportTemplate;
}

// Page 1 has all three rasters; page 2 has none (no source raster to fall back to).
const SIGNED = {
  '1:source': 'https://x/1-source.png',
  '1:generated': 'https://x/1-generated.png',
  '1:diff': 'https://x/1-diff.png',
};

function collection() {
  return buildPageReviewModels({
    report: report([pageReport(1), pageReport(2, { recommendedAction: 'manual_review' })]),
    signedUrls: SIGNED,
    template: template(2),
  });
}

function cardFor(label: string): HTMLElement {
  return screen.getByText(label).closest('div.flex.flex-col') as HTMLElement;
}

describe('VisualQualityPageReviewGrid', () => {
  it('renders one card per page with the header counts', () => {
    render(<VisualQualityPageReviewGrid collection={collection()} />);
    expect(screen.getByText('Per-page review')).toBeInTheDocument();
    expect(screen.getByText('Cover 1')).toBeInTheDocument();
    expect(screen.getByText('Cover 2')).toBeInTheDocument();
    expect(screen.getByText('2 scored')).toBeInTheDocument();
    // page 2 recommended manual_review → needs review.
    expect(screen.getByText('1 need review')).toBeInTheDocument();
  });

  it('renders per-page source/generated/diff imagery with eager loading at the top', () => {
    render(<VisualQualityPageReviewGrid collection={collection()} />);
    const source = screen.getByAltText('Source raster') as HTMLImageElement;
    expect(source.getAttribute('src')).toBe('https://x/1-source.png');
    expect(source.getAttribute('loading')).toBe('eager');
    // Page 1 has three images; page 2 has none (three ImageOff placeholders).
    expect(screen.getAllByRole('img')).toHaveLength(3);
  });

  it('disables raster fallbacks (with a reason) on a page with no source raster', () => {
    render(<VisualQualityPageReviewGrid collection={collection()} onAction={vi.fn()} />);
    const card2 = cardFor('Cover 2');
    const forcePixel = within(card2).getByRole('button', { name: 'Force pixel' });
    expect(forcePixel).toBeDisabled();
    expect(forcePixel.getAttribute('title')).toMatch(/no source raster/i);
  });

  it('fires a non-confirm action immediately', () => {
    const onAction = vi.fn();
    render(<VisualQualityPageReviewGrid collection={collection()} onAction={onAction} />);
    const card1 = cardFor('Cover 1');
    fireEvent.click(within(card1).getByRole('button', { name: 'Accept page' }));
    expect(onAction).toHaveBeenCalledWith('docling-page-1', 'accept');
  });

  it('gates a confirm-required action behind a confirmation dialog', () => {
    const onAction = vi.fn();
    render(<VisualQualityPageReviewGrid collection={collection()} onAction={onAction} />);
    const card1 = cardFor('Cover 1');
    // Force pixel requires confirmation → does not fire immediately.
    fireEvent.click(within(card1).getByRole('button', { name: 'Force pixel' }));
    expect(onAction).not.toHaveBeenCalled();
    // Confirm in the dialog → the action fires.
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Force pixel' }));
    expect(onAction).toHaveBeenCalledWith('docling-page-1', 'force_pixel');
  });

  it('shows a friendly empty state when there are no pages', () => {
    render(<VisualQualityPageReviewGrid collection={buildPageReviewModels({})} />);
    expect(screen.getByText(/No per-page review data/i)).toBeInTheDocument();
  });
});

describe('the visual critique on a page card', () => {
  const critique = {
    'docling-page-1': {
      findings: [
        {
          kind: 'text_clipped' as const, severity: 'critical' as const, overlayId: 'title',
          note: 'The title is cut off on the right.', verdict: 'confirmed' as const,
          basis: 'set on one line, needs 270.0pt in a 200.0pt box',
        },
        {
          kind: 'wrong_colour' as const, severity: 'minor' as const, overlayId: 'rule',
          note: 'The divider looks lighter than the source.', verdict: 'unverifiable' as const,
          basis: 'only the source pixels can settle this',
        },
        {
          kind: 'occluded' as const, severity: 'major' as const, overlayId: 'logo',
          note: 'The logo looks buried.', verdict: 'refuted' as const,
          basis: 'logo and backdrop do not overlap at all',
        },
      ],
      summary: {
        version: 'visual-critique-v1' as const,
        total: 3, confirmed: 1, refuted: 1, unverifiable: 1, confirmedCritical: 1,
      },
    },
  };

  it('offers the critique action only when the operator enabled it', () => {
    const { unmount } = render(<VisualQualityPageReviewGrid collection={collection()} onAction={vi.fn()} />);
    expect(within(cardFor('Cover 1')).getByRole('button', { name: /Explain the difference/i }))
      .toBeDisabled();
    unmount();
    render(<VisualQualityPageReviewGrid collection={collection()} aiCritiqueEnabled onAction={vi.fn()} />);
    expect(within(cardFor('Cover 1')).getByRole('button', { name: /Explain the difference/i }))
      .not.toBeDisabled();
  });

  it('fires without a confirmation step, because it cannot change the document', () => {
    const onAction = vi.fn();
    render(<VisualQualityPageReviewGrid collection={collection()} aiCritiqueEnabled onAction={onAction} />);
    fireEvent.click(within(cardFor('Cover 1')).getByRole('button', { name: /Explain the difference/i }));
    expect(onAction).toHaveBeenCalledWith('docling-page-1', 'ai_critique');
  });

  it('stays disabled on a page with no rasters to compare', () => {
    render(<VisualQualityPageReviewGrid collection={collection()} aiCritiqueEnabled onAction={vi.fn()} />);
    expect(within(cardFor('Cover 2')).getByRole('button', { name: /Explain the difference/i }))
      .toBeDisabled();
  });

  it('shows each finding with what measurement made of it', () => {
    render(
      <VisualQualityPageReviewGrid
        collection={collection()} aiCritiqueEnabled pageCritiques={critique} onAction={vi.fn()}
      />,
    );
    const card = within(cardFor('Cover 1'));
    expect(card.getByText('The title is cut off on the right.')).toBeTruthy();
    expect(card.getByText('set on one line, needs 270.0pt in a 200.0pt box')).toBeTruthy();
    // A finding measurement contradicted is shown as contradicted, never
    // silently as a defect — that separation is the point of the stage.
    expect(card.getByText('measured')).toBeTruthy();
    expect(card.getByText('unchecked')).toBeTruthy();
    expect(card.getByText('contradicted')).toBeTruthy();
    expect(card.getByText('1 measured · 1 unchecked · 1 contradicted')).toBeTruthy();
  });

  it('says a clean page is clean rather than showing nothing', () => {
    render(
      <VisualQualityPageReviewGrid
        collection={collection()} aiCritiqueEnabled onAction={vi.fn()}
        pageCritiques={{ 'docling-page-1': { findings: [], summary: { ...critique['docling-page-1'].summary, total: 0, confirmed: 0, refuted: 0, unverifiable: 0, confirmedCritical: 0 } } }}
      />,
    );
    expect(within(cardFor('Cover 1')).getByText('No differences reported')).toBeTruthy();
  });
});

