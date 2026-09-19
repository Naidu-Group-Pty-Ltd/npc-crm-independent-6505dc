/**
 * pdf-page-artifact-contract-v2: OCR/vector propagation (Path-to-100 v2 · C2.2/C2.3).
 *
 * Verifies OCR + vector artifact paths flow through the frontend page-context
 * consumer contract and the visual-QA render manifest, that they are optional
 * (legacy pages without them remain usable), and that their absence never
 * creates a validation problem.
 */
import { describe, expect, it } from 'vitest';
import {
  normalizePdfPageContexts,
  buildPdfPageContextConsumerGuardrail,
  getPreferredPdfPageContextSource,
} from '../ingestion/pageContexts';
import { buildPageContextRenderArtifactManifest } from '../ingestion/visualQuality/pageContextArtifacts';

/** Build a get_artifacts-shaped page context (nested artifacts/flags). */
const ctx = (
  pageNo: number,
  artifactsExtra: Record<string, unknown> = {},
  flagsExtra: Record<string, unknown> = {},
) => {
  const p = String(pageNo).padStart(3, '0');
  return {
    version: 'pdf-page-context-v1',
    page_no: pageNo,
    page_index: pageNo - 1,
    width: 595,
    height: 842,
    artifacts: {
      docling_path: `job/pages/page-${p}/docling.json`,
      blocks_path: `job/pages/page-${p}/blocks.json`,
      tables_path: `job/pages/page-${p}/tables.json`,
      pictures_path: `job/pages/page-${p}/pictures.json`,
      summary_path: `job/pages/page-${p}/summary.json`,
      raster_path: `job/pages/page-${p}.png`,
      ...artifactsExtra,
    },
    flags: {
      has_docling: true,
      has_blocks: true,
      has_tables: true,
      has_pictures: true,
      has_summary: true,
      has_raster: true,
      has_parent_global_artifacts: true,
      ...flagsExtra,
    },
  };
};

const summaryFor = (pageCount: number) => ({
  ok: true,
  expected_page_count: pageCount,
  observed_page_count: pageCount,
  parent_global_context_count: pageCount,
  problems: [],
});

describe('C2 pdf-page-artifact-contract-v2 — OCR/vector propagation', () => {
  it('carries ocr_path/vectors_path into artifacts + flags when present', () => {
    const contexts = normalizePdfPageContexts([
      ctx(1, {
        ocr_path: 'job/pages/page-001/ocr.json',
        vectors_path: 'job/pages/page-001/vectors.json',
      }),
    ]);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].artifacts.ocr_path).toBe('job/pages/page-001/ocr.json');
    expect(contexts[0].artifacts.vectors_path).toBe('job/pages/page-001/vectors.json');
    expect(contexts[0].flags.has_ocr).toBe(true);
    expect(contexts[0].flags.has_vectors).toBe(true);
  });

  it('keeps legacy pages (no OCR/vectors) usable and valid', () => {
    const contexts = normalizePdfPageContexts([ctx(1), ctx(2)]);
    expect(contexts[0].artifacts.ocr_path ?? null).toBe(null);
    expect(contexts[0].flags.has_ocr ?? false).toBe(false);

    const selected = getPreferredPdfPageContextSource({
      pageContextEntrypoint: { available: true, page_count: 2, manifest_path: 'job/pages-manifest.json' },
      pageContexts: [ctx(2), ctx(1)],
      pageContextSummary: summaryFor(2),
    });
    // OCR/vectors are not required — the legacy manifest still validates.
    expect(selected.source).toBe('per_page_docling');
    expect(selected.pageContextValidation.ok).toBe(true);
  });

  it('render manifest surfaces OCR/vectors and never requires them', () => {
    const selected = getPreferredPdfPageContextSource({
      pageContextEntrypoint: { available: true, page_count: 1, manifest_path: 'job/pages-manifest.json' },
      // page 1 has OCR but no vectors — a valid mixed/legacy state.
      pageContexts: [ctx(1, { ocr_path: 'job/pages/page-001/ocr.json' })],
      pageContextSummary: summaryFor(1),
    });
    const guardrail = buildPdfPageContextConsumerGuardrail(selected);

    const manifest = buildPageContextRenderArtifactManifest({
      importId: 'imp-1',
      pageContexts: selected.pageContexts,
      guardrail,
      signedUrls: {
        '1:source': 'https://signed.example/1.png',
        '1:ocr': 'https://signed.example/1-ocr.json',
      },
    });

    expect(manifest.pages[0].ocrPath).toBe('job/pages/page-001/ocr.json');
    expect(manifest.pages[0].vectorsPath ?? null).toBe(null);
    expect(manifest.problems.some((p) => p.toLowerCase().includes('ocr'))).toBe(false);
    expect(manifest.problems.some((p) => p.toLowerCase().includes('vector'))).toBe(false);
  });
});
