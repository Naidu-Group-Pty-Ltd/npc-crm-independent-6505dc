import { describe, expect, it } from 'vitest';
import {
  buildPageContextRenderArtifactManifest,
  pageContextRenderManifestToReviewArtifacts,
} from '../ingestion/visualQuality';
import type { PdfPageContext, PdfPageContextConsumerGuardrail } from '../ingestion/pageContexts';

const guardrail: PdfPageContextConsumerGuardrail = {
  version: 'pdf-page-context-consumer-guardrail-v1',
  selected_source: 'per_page_docling',
  page_context_source_used: true,
  legacy_fallback_used: false,
  fallback_allowed: false,
  should_block_import: false,
  reason: 'parent per-page Docling manifest validated',
  manifest_path: 'job/pages-manifest.json',
  expected_page_count: 2,
  observed_page_count: 2,
  validation_ok: true,
  validation_problem_count: 0,
  validation_problems: [],
  entrypoint_available: true,
  parent_global_context_count: 2,
  generated_at: '2026-01-01T00:00:00.000Z',
};

const makeContext = (pageNo: number): PdfPageContext => (({
  version: 'pdf-page-context-v1',
  page_no: pageNo,
  page_index: pageNo - 1,
  width: 595,
  height: 842,
  global_artifact_prefix: `job/pages/page-${String(pageNo).padStart(3, '0')}`,
  global_artifact_copy_version: 'parent-global-page-artifact-copy-v1',
  source: 'per_page_docling',
  artifacts: {
    docling_path: `job/pages/page-${String(pageNo).padStart(3, '0')}/docling.json`,
    blocks_path: `job/pages/page-${String(pageNo).padStart(3, '0')}/blocks.json`,
    tables_path: `job/pages/page-${String(pageNo).padStart(3, '0')}/tables.json`,
    pictures_path: `job/pages/page-${String(pageNo).padStart(3, '0')}/pictures.json`,
    summary_path: `job/pages/page-${String(pageNo).padStart(3, '0')}/summary.json`,
    raster_path: `job/rasters/page-${String(pageNo).padStart(3, '0')}.png`,
  },
  flags: {
    has_docling: true,
    has_blocks: true,
    has_tables: true,
    has_pictures: true,
    has_summary: true,
    has_raster: true,
    has_parent_global_artifacts: true,
  },
}) as unknown as PdfPageContext);

describe('PageContext render artifact manifest', () => {
  it('builds source render artifact refs from per-page contexts', () => {
    const manifest = buildPageContextRenderArtifactManifest({
      importId: 'import_123',
      pageContexts: [makeContext(2), makeContext(1)],
      guardrail,
      signedUrls: {
        '1:source': 'https://signed.example/page-001.png',
        '2:source': 'https://signed.example/page-002.png',
      },
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(manifest.version).toBe('page-context-render-artifact-manifest-v1');
    expect(manifest.importId).toBe('import_123');
    expect(manifest.observedPageCount).toBe(2);
    expect(manifest.expectedPageCount).toBe(2);
    expect(manifest.sourceRasterCount).toBe(2);
    expect(manifest.doclingPageArtifactCount).toBe(2);
    expect(manifest.problems).toEqual([]);
    expect(manifest.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(manifest.pages[0].pageId).toBe('docling-page-1');
    expect(manifest.pages[0].sourceRasterPath).toContain('page-001.png');
    expect(manifest.pages[0].sourceRasterSignedUrl).toBe('https://signed.example/page-001.png');
  });

  it('turns source raster refs into import review artifacts', () => {
    const manifest = buildPageContextRenderArtifactManifest({
      importId: 'import_123',
      pageContexts: [makeContext(1)],
      guardrail: { ...guardrail, expected_page_count: 1, observed_page_count: 1, parent_global_context_count: 1 },
      signedUrls: {
        '1:source': 'https://signed.example/page-001.png',
      },
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const artifacts = pageContextRenderManifestToReviewArtifacts(manifest);

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].kind).toBe('source-raster');
    expect(artifacts[0].pageId).toBe('docling-page-1');
    expect(artifacts[0].url).toBe('https://signed.example/page-001.png');
    expect(artifacts[0].meta?.storagePath).toBe('job/rasters/page-001.png');
    expect(artifacts[0].meta?.signedUrlAvailable).toBe(true);
    expect(artifacts[0].meta?.doclingPath).toContain('/docling.json');
  });

  it('records problems when source rasters are missing', () => {
    const bad = makeContext(1);
    bad.artifacts.raster_path = null;
    bad.flags.has_raster = false;

    const manifest = buildPageContextRenderArtifactManifest({
      importId: 'import_123',
      pageContexts: [bad],
      guardrail: { ...guardrail, expected_page_count: 1, observed_page_count: 1 },
    });

    expect(manifest.sourceRasterCount).toBe(0);
    expect(manifest.problems).toContain('page_1_source_raster_missing');
    expect(pageContextRenderManifestToReviewArtifacts(manifest)).toEqual([]);
  });
});
