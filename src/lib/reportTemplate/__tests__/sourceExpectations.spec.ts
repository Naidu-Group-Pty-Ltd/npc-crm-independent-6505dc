/**
 * visual-source-expectations-v1 bundle + subset loader (Path-to-100 v2 · C3.1/C3.3).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  buildVisualSourceExpectationBundle,
  isSourceFidelityUsable,
  resolveQualityCoverage,
  sourceExpectationBundleToExpectationsLike,
  loadPerPageSourceExpectations,
  pageNumberFromDoclingId,
} from '../ingestion/visualQuality';

const text = (pageNo: number, t: string) => ({ pageId: `docling-page-${pageNo}`, text: t });
const bound = (pageNo: number, layer: string) => ({
  pageId: `docling-page-${pageNo}`,
  layerId: `${layer}-ov`,
  bounds: { x: 1, y: 2, width: 3, height: 4 },
});

describe('buildVisualSourceExpectationBundle', () => {
  it('derives page numbers and marks complete when all expected pages are covered', () => {
    const bundle = buildVisualSourceExpectationBundle({
      source: 'docling-document',
      expectedText: [text(1, 'a'), text(2, 'b')],
      expectedBounds: [bound(1, 'x')],
      expectedPageNumbers: [1, 2],
    });
    expect(bundle.version).toBe('visual-source-expectations-v1');
    expect(bundle.pageNumbers).toEqual([1, 2]);
    expect(bundle.complete).toBe(true);
    expect(bundle.problems).toEqual([]);
    expect(resolveQualityCoverage(bundle)).toBe('full');
  });

  it('is partial (and records a problem) when an expected page has no expectations', () => {
    const bundle = buildVisualSourceExpectationBundle({
      source: 'docling-document',
      expectedText: [text(1, 'a')],
      expectedBounds: [],
      expectedPageNumbers: [1, 2, 3],
    });
    expect(bundle.complete).toBe(false);
    expect(bundle.problems).toContain('source_expectations_missing_page_2');
    expect(bundle.problems).toContain('source_expectations_missing_page_3');
    expect(resolveQualityCoverage(bundle)).toBe('partial');
  });

  it('is image-only when there are no expectations at all', () => {
    const bundle = buildVisualSourceExpectationBundle({
      source: 'docling-document',
      expectedText: [],
      expectedBounds: [],
    });
    expect(isSourceFidelityUsable(bundle)).toBe(false);
    expect(resolveQualityCoverage(bundle)).toBe('image-only');
    expect(sourceExpectationBundleToExpectationsLike(bundle)).toEqual({ expectedText: [], expectedBounds: [] });
  });

  it('pageNumberFromDoclingId parses the mapper convention', () => {
    expect(pageNumberFromDoclingId('docling-page-7')).toBe(7);
    expect(pageNumberFromDoclingId('nope')).toBe(null);
  });
});

describe('loadPerPageSourceExpectations (subset loader)', () => {
  it('fetches ONLY the requested pages, never the whole document', async () => {
    const fetchPageArtifact = vi.fn(async (pageNumber: number) => ({
      pageNumber,
      expectedText: [text(pageNumber, `page ${pageNumber}`)],
      expectedBounds: [bound(pageNumber, 'h')],
      confidence: 0.8,
    }));

    const bundle = await loadPerPageSourceExpectations({ pageNumbers: [3, 5], fetchPageArtifact });

    // Only pages 3 and 5 were fetched — not 1..5.
    expect(fetchPageArtifact).toHaveBeenCalledTimes(2);
    expect(fetchPageArtifact.mock.calls.map((c) => c[0]).sort()).toEqual([3, 5]);
    expect(bundle.pageNumbers).toEqual([3, 5]);
    expect(bundle.complete).toBe(true);
    expect(bundle.source).toBe('per-page-docling');
  });

  it('records missing/degraded pages explicitly and rejects id-convention violations', async () => {
    const fetchPageArtifact = vi.fn(async (pageNumber: number) => {
      if (pageNumber === 2) return null; // missing artifact
      if (pageNumber === 4) {
        return {
          pageNumber,
          // wrong pageId + non-overlay layerId → both flagged
          expectedText: [{ pageId: 'docling-page-99', text: 'mismatch' }],
          expectedBounds: [{ pageId: 'docling-page-4', layerId: 'raw-block', bounds: { x: 0, y: 0, width: 1, height: 1 } }],
        };
      }
      return { pageNumber, expectedText: [text(pageNumber, 'ok')], expectedBounds: [bound(pageNumber, 'h')] };
    });

    const bundle = await loadPerPageSourceExpectations({ pageNumbers: [1, 2, 4], fetchPageArtifact });

    expect(bundle.problems).toContain('page_2_artifact_missing');
    expect(bundle.problems).toContain('page_4_text_pageid_mismatch');
    expect(bundle.problems.some((p) => p.startsWith('page_4_layerid_convention'))).toBe(true);
    expect(bundle.complete).toBe(false);
    // page 1 still contributed usable expectations.
    expect(bundle.pageNumbers).toContain(1);
  });
});
