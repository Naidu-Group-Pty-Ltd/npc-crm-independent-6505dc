import { describe, expect, it, vi } from 'vitest';
import {
  buildVisualRepairAuditPayload,
  loadVisualRepairAudit,
  saveVisualRepairAudit,
  visualRepairAuditPaths,
  type VisualRepairOrchestrationPipelineResult,
} from '../ingestion/visualQuality';
import { invokeSecureFunction } from '@/lib/secureInvoke';

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: vi.fn(),
}));

function report(score: number) {
  return {
    importId: 'import_123',
    templateId: 'template_123',
    overallScore: score,
    pages: [],
    repairPassesApplied: score > 0.8 ? 1 : 0,
    finalMode: 'hybrid',
    manualReviewRequired: false,
    generatedAt: '2026-01-01T00:00:00.000Z',
  } as any;
}

function orchestrationResult(): VisualRepairOrchestrationPipelineResult {
  return {
    version: 'visual-repair-orchestration-pipeline-v1',
    importId: 'import_123',
    templateId: 'template_123',
    loaded: {} as any,
    generatedRasters: [
      {
        pageId: 'docling-page-1',
        pageNumber: 1,
        width: 10,
        height: 10,
        imageData: { width: 10, height: 10, data: new Uint8ClampedArray(400), colorSpace: 'srgb' } as ImageData,
        dataUrl: 'data:image/png;base64,generated',
      },
    ],
    sourceRasters: [
      {
        pageId: 'docling-page-1',
        pageNumber: 1,
        imageData: { width: 10, height: 10, data: new Uint8ClampedArray(400), colorSpace: 'srgb' } as ImageData,
        signedUrl: 'https://signed.example/source.png',
        storagePath: 'job/rasters/page-001.png',
      },
    ],
    visualQa: {
      version: 'import-review-visual-qa-pipeline-v1',
      importId: 'import_123',
      draft: {} as any,
      generatedRenderManifest: {
        version: 'generated-render-artifact-manifest-v1',
        importId: 'import_123',
        pageCount: 1,
        generatedRasterCount: 1,
        pages: [{ pageId: 'docling-page-1', pageNumber: 1, width: 10, height: 10, dataUrlAvailable: true }],
        problems: [],
        generatedAt: '2026-01-01T00:00:00.000Z',
      },
      visualQa: {
        version: 'import-review-visual-qa-v1',
        draft: {} as any,
        report: report(0.7),
        summary: {
          version: 'import-review-visual-qa-v1',
          importId: 'import_123',
          templateId: 'template_123',
          overallScore: 0.7,
          pageCount: 1,
          manualReviewRequired: false,
          finalMode: 'hybrid',
          repairPassesApplied: 0,
          warningCount: 1,
          recommendedActionCounts: { repair: 1 },
          persisted: false,
          summaryPath: null,
          uploadedCount: 0,
          problemCount: 0,
          problems: [],
          generatedAt: '2026-01-01T00:00:00.000Z',
        },
        persistResult: { kind: 'ok', summaryPath: '', uploadedCount: 0 },
        generatedArtifacts: [],
        diffArtifacts: [],
        problems: [],
      },
    },
    bridge: {
      canRunRepairLoop: true,
      eligiblePageNumbers: [1],
      problems: [],
      classified: {
        summary: {
          version: 'repair-issue-classifier-v1',
          importId: 'import_123',
          templateId: 'template_123',
          issueCount: 1,
          pagesWithIssues: 1,
          repairablePageCount: 1,
          fallbackPageCount: 0,
          manualReviewPageCount: 0,
          byCategory: { pixel_mismatch: 1 },
          bySeverity: { warning: 1 },
          suggestedRepairCounts: { run_repair_loop: 1 },
          worstPage: { pageId: 'docling-page-1', pageNumber: 1, score: 0.7, recommendedAction: 'repair' },
        },
      },
      eligibility: {
        version: 'repair-eligibility-gate-v1',
        importId: 'import_123',
        templateId: 'template_123',
        canRunRepairLoop: true,
        requiresFallback: false,
        requiresManualReview: false,
        pageCount: 1,
        eligiblePageCount: 1,
        blockedPageCount: 0,
        fallbackPageCount: 0,
        manualReviewPageCount: 0,
        noIssuePageCount: 0,
        blockingReasons: {},
        pages: [],
      },
    } as any,
    repair: {
      version: 'deterministic-repair-runner-v1',
      importId: 'import_123',
      templateId: 'template_123',
      status: 'completed',
      initialReport: report(0.7),
      finalReport: report(0.86),
      repairedCdir: {} as any,
      repairedTemplate: {} as any,
      draft: {} as any,
      passes: [
        {
          passIndex: 0,
          patchesProposed: 1,
          patchesAccepted: 1,
          patchesRejected: 0,
          perPage: [],
        },
      ],
      totalApplied: 1,
      summary: {
        version: 'deterministic-repair-runner-v1',
        status: 'completed',
        importId: 'import_123',
        templateId: 'template_123',
        initialScore: 0.7,
        finalScore: 0.86,
        scoreDelta: 0.16,
        initialManualReviewRequired: false,
        finalManualReviewRequired: false,
        eligiblePageCount: 1,
        passesAttempted: 1,
        passesAccepted: 1,
        patchesProposed: 1,
        patchesAccepted: 1,
        patchesRejected: 0,
        totalApplied: 1,
      },
    },
    draft: {} as any,
    summary: {
      version: 'visual-repair-orchestration-pipeline-v1',
      importId: 'import_123',
      templateId: 'template_123',
      visualQaScore: 0.7,
      finalScore: 0.86,
      scoreDelta: 0.16,
      visualQaPersisted: false,
      repairStatus: 'completed',
      canRunRepairLoop: true,
      eligiblePageCount: 1,
      totalApplied: 1,
      passesAttempted: 1,
      patchesAccepted: 1,
      patchesRejected: 0,
      requiresFallback: false,
      requiresManualReview: false,
      problemCount: 0,
      problems: [],
    },
  } as any;
}

describe('visual repair audit persistence', () => {
  it('builds a compact audit payload without embedding raw rasters', () => {
    const payload = buildVisualRepairAuditPayload(orchestrationResult(), {
      now: () => new Date('2026-01-02T00:00:00.000Z'),
    });

    expect(payload.version).toBe('visual-repair-audit-persistence-v1');
    expect(payload.importId).toBe('import_123');
    expect(payload.summary.finalScore).toBe(0.86);
    expect(payload.repair.totalApplied).toBe(1);
    expect(payload.bridge.eligiblePageNumbers).toEqual([1]);
    expect(JSON.stringify(payload)).not.toContain('Uint8ClampedArray');
    expect(payload.generatedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('saves a repair audit through template-import-pdf', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { ok: true, audit_path: 'import_123/repair/repair-loop.json' },
      error: null,
    } as any);

    const payload = buildVisualRepairAuditPayload(orchestrationResult());
    const result = await saveVisualRepairAudit('import_123', payload);

    expect(result).toEqual({ kind: 'ok', auditPath: 'import_123/repair/repair-loop.json' });
    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({
        body: expect.objectContaining({
          operation: 'save_visual_repair_audit',
          import_id: 'import_123',
          payload,
        }),
      }),
    );
  });

  it('returns kind error when the backend rejects the save', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { error: 'forbidden' },
      error: { message: 'forbidden' },
    } as any);

    const payload = buildVisualRepairAuditPayload(orchestrationResult());
    const result = await saveVisualRepairAudit('import_123', payload);

    expect(result.kind).toBe('error');
    if (result.kind === 'error') expect(result.message).toContain('forbidden');
  });

  it('loads a persisted repair audit through template-import-pdf', async () => {
    const payload = buildVisualRepairAuditPayload(orchestrationResult());

    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: {
        importId: 'import_123',
        payload,
        artifactPaths: {
          summary: visualRepairAuditPaths.summary('import_123'),
          repairFolder: visualRepairAuditPaths.repairFolder('import_123'),
        },
      },
      error: null,
    } as any);

    const result = await loadVisualRepairAudit('import_123');

    expect(invokeSecureFunction).toHaveBeenCalledWith(
      'template-import-pdf',
      expect.objectContaining({
        body: expect.objectContaining({
          operation: 'get_visual_repair_audit',
          import_id: 'import_123',
        }),
      }),
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.payload.artifactPaths.summary).toBe('import_123/repair/repair-loop.json');
      expect(result.payload.payload.summary.finalScore).toBe(0.86);
    }
  });

  it('returns kind missing when no repair audit exists (backend returns null)', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({ data: null, error: null } as any);

    const result = await loadVisualRepairAudit('import_123');

    expect(result.kind).toBe('missing');
  });

  it('treats an unknown-operation backend error as missing (backward compatibility)', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: { error: 'unknown operation: get_visual_repair_audit' },
      error: { message: 'unknown operation: get_visual_repair_audit' },
    } as any);

    const result = await loadVisualRepairAudit('import_123');

    expect(result.kind).toBe('missing');
  });
});
