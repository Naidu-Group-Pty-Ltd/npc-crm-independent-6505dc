import { describe, expect, it } from 'vitest';
import { loadImportReviewDraft, readImportReviewDecision, saveImportReviewDecision, type ImportArtifactsPayload } from '../ingestion/importArtifacts';
import type { CdirDocument } from '../ingestion/cdir';

const cdir: CdirDocument = {
  version: 1,
  source: { kind: 'pdf', checksum: 'sha256:abc', filename: 'source.pdf' },
  pages: [{
    id: 'p1',
    label: 'Page 1',
    width: 100,
    height: 100,
    layers: [{ id: 't1', kind: 'text', text: 'Loaded', bounds: { x: 0, y: 0, width: 100, height: 100 } }],
  }],
  assets: [],
  fonts: [],
  warnings: [],
};

function payload(overrides: Partial<ImportArtifactsPayload> = {}): ImportArtifactsPayload {
  return {
    record: {
      id: 'import_1',
      user_id: 'user_1',
      status: 'completed',
      created_template_id: 'template_1',
      page_count: 1,
      source_filename: 'source.pdf',
      meta: {},
    },
    cdir,
    cdirFidelity: {
      overallScore: 1,
      nativeCoverage: 1,
      rasterFallbackCoverage: 0,
      textAccuracy: 1,
      medianPositionDrift: 0,
      p95PositionDrift: 0,
      editableLayerCount: 1,
      fallbackRasterLayerCount: 0,
      pages: [],
      warnings: [],
    },
    artifactPaths: { cdir: 'import_1/cdir.json', cdirFidelity: 'import_1/cdir-fidelity.json' },
    ...overrides,
  };
}

describe('loadImportReviewDraft', () => {
  it('loads private CDIR/fidelity artifacts through the edge function and rebuilds a review draft', async () => {
    const calls: unknown[] = [];
    const result = await loadImportReviewDraft({
      importId: 'import_1',
      invoke: async (fn, args) => {
        calls.push([fn, args]);
        return { data: payload(), error: null };
      },
    });

    expect(calls).toEqual([['template-import-pdf', { body: { operation: 'get_artifacts', import_id: 'import_1' } }]]);
    expect(result.record.id).toBe('import_1');
    expect(result.artifactPaths.cdir).toBe('import_1/cdir.json');
    expect(result.draft.id).toBe('review_import_1');
    expect(result.draft.template.pages[0].blocks[0].overlays[0]).toMatchObject({ type: 'text', content: 'Loaded' });
    expect(result.draft.fidelity.overallScore).toBe(1);
  });

  it('attaches persisted PDF ImportAsset pages as source-raster review artifacts', async () => {
    const result = await loadImportReviewDraft({
      importId: 'import_1',
      invoke: async () => ({
        data: payload({
          importAsset: {
            fileId: 'pdf_asset_1',
            fileName: 'source.pdf',
            fileType: 'pdf',
            createdAt: '2026-01-01T00:00:00.000Z',
            pages: [{
              id: 'pdf_asset_1_page_1',
              pageIndex: 0,
              width: 100,
              height: 100,
              referenceImageUrl: 'data:image/png;base64,PAGE',
              dpiScale: 2,
              source: 'pdf-render',
            }],
          },
          importManifests: [{
            importId: 'pdf_asset_1',
            page: { id: 'pdf_asset_1_page_1', pageIndex: 0, width: 100, height: 100, referenceImageUrl: 'data:image/png;base64,PAGE', dpiScale: 2 },
            palette: [],
            rawBlocks: [],
            extractionSummary: { hasPdfTextLayer: false, hasOcrTextLayer: false, hasEmbeddedImages: false, blockCount: 0, textBlockCount: 0, imageBlockCount: 0 },
            warnings: [],
          }],
          artifactPaths: {
            cdir: 'import_1/cdir.json',
            cdirFidelity: 'import_1/cdir-fidelity.json',
            importAsset: 'import_1/import-asset.json',
            importManifests: 'import_1/import-manifests.json',
          },
        }),
        error: null,
      }),
    });

    expect(result.artifactPaths.importAsset).toBe('import_1/import-asset.json');
    expect(result.artifactPaths.importManifests).toBe('import_1/import-manifests.json');
    expect(result.importAsset?.fileId).toBe('pdf_asset_1');
    expect(result.importManifests?.[0].importId).toBe('pdf_asset_1');
    expect(result.draft.artifacts).toHaveLength(1);
    expect(result.draft.artifacts[0]).toMatchObject({ kind: 'source-raster', pageId: 'pdf_asset_1_page_1' });
  });

  it('fails clearly when an import has no CDIR artifact', async () => {
    await expect(loadImportReviewDraft({
      importId: 'import_1',
      invoke: async () => ({ data: payload({ cdir: null }), error: null }),
    })).rejects.toThrow('persisted CDIR artifact');
  });

  it('surfaces edge function errors', async () => {
    await expect(loadImportReviewDraft({
      importId: 'import_1',
      invoke: async () => ({ data: null, error: { message: 'forbidden' } }),
    })).rejects.toThrow('forbidden');
  });
});

describe('saveImportReviewDecision', () => {

  it('reads saved review decisions from import metadata', () => {
    expect(readImportReviewDecision({
      import_review_decision: {
        decision: 'manual_edit',
        note: 'Fix page 2.',
        decided_at: '2026-01-02T03:04:05.000Z',
        decided_by: 'user_1',
      },
    })).toMatchObject({ decision: 'manual_edit', note: 'Fix page 2.' });
    expect(readImportReviewDecision({ import_review_decision: { decision: 'bogus' } })).toBeNull();
  });

  it('records the selected review decision through the edge function', async () => {
    const calls: unknown[] = [];
    const result = await saveImportReviewDecision({
      importId: 'import_1',
      decision: 'accept_with_trace',
      note: 'Keep trace for cleanup.',
      invoke: async (fn, args) => {
        calls.push([fn, args]);
        return {
          data: {
            record: { id: 'import_1', meta: {} },
            decision: {
              decision: 'accept_with_trace',
              note: 'Keep trace for cleanup.',
              decided_at: '2026-01-02T03:04:05.000Z',
              decided_by: 'user_1',
            },
          },
          error: null,
        };
      },
    });

    expect(calls).toEqual([['template-import-pdf', {
      body: {
        operation: 'record_review_decision',
        import_id: 'import_1',
        decision: 'accept_with_trace',
        note: 'Keep trace for cleanup.',
      },
    }]]);
    expect(result.decision.decision).toBe('accept_with_trace');
  });

  it('surfaces decision save errors', async () => {
    await expect(saveImportReviewDecision({
      importId: 'import_1',
      decision: 'manual_edit',
      invoke: async () => ({ data: null, error: { message: 'forbidden' } }),
    })).rejects.toThrow('forbidden');
  });
});
