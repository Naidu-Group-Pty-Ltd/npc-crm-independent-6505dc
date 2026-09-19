import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  applyRepairedTemplateToRecord,
  type VisualRepairOrchestrationSummary,
} from '../ingestion/visualQuality';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { parseTemplate } from '../templateSchema';

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: vi.fn(),
}));

const template = {
  version: 1,
  tokens: { colors: {}, fonts: {}, spacing: {} },
  slots: {},
  pages: [
    {
      id: 'page-1',
      name: 'Page 1',
      size: { width: 612, height: 792 },
      blocks: [],
    },
  ],
};

const normalizedTemplate = parseTemplate(template);

const repairSummary: VisualRepairOrchestrationSummary = {
  version: 'visual-repair-orchestration-pipeline-v1',
  importId: 'import_123',
  templateId: 'template_123',
  visualQaScore: 0.7,
  finalScore: 0.86,
  scoreDelta: 0.16,
  visualQaPersisted: true,
  repairStatus: 'completed',
  canRunRepairLoop: true,
  eligiblePageCount: 1,
  totalApplied: 1,
  passesAttempted: 1,
  patchesAccepted: 1,
  patchesRejected: 0,
  requiresFallback: false,
  requiresManualReview: false,
  qualityCoverage: 'full',
  expectationStrategy: 'docling_source',
  problemCount: 0,
  problems: [],
};

describe('applyRepairedTemplateToRecord', () => {
  beforeEach(() => {
    vi.mocked(invokeSecureFunction).mockReset();
  });

  it('snapshots the current template and applies the repaired schema', async () => {
    vi.mocked(invokeSecureFunction)
      .mockResolvedValueOnce({
        data: {
          record: {
            id: 'template_123',
            version: 4,
            schema: template,
            locked_for_review: false,
          },
        },
        error: null,
      } as any)
      .mockResolvedValueOnce({
        data: { record: { id: 'version_1' } },
        error: null,
      } as any)
      .mockResolvedValueOnce({
        data: { record: { id: 'template_123', version: 5, schema: normalizedTemplate } },
        error: null,
      } as any);

    const result = await applyRepairedTemplateToRecord({
      templateId: 'template_123',
      repairedTemplate: template,
      repairSummary,
      repairAuditPath: 'import_123/repair/repair-loop.json',
      expectedVersion: 4,
    });

    expect(result).toMatchObject({
      version: 'repaired-template-application-v1',
      templateId: 'template_123',
      previousVersion: 4,
      nextVersion: 5,
      snapshotCreated: true,
      repairAuditPath: 'import_123/repair/repair-loop.json',
    });

    expect(invokeSecureFunction).toHaveBeenNthCalledWith(1, 'manage-templates', {
      operation: 'get',
      table: 'report_templates',
      recordId: 'template_123',
    });

    expect(invokeSecureFunction).toHaveBeenNthCalledWith(2, 'manage-templates', expect.objectContaining({
      operation: 'insert',
      table: 'report_template_versions',
      data: expect.objectContaining({
        template_id: 'template_123',
        version: 4,
        label: 'Before visual repair',
      }),
    }));

    expect(invokeSecureFunction).toHaveBeenNthCalledWith(3, 'manage-templates', expect.objectContaining({
      operation: 'update',
      table: 'report_templates',
      recordId: 'template_123',
      expectedVersion: 4,
      data: expect.objectContaining({
        schema: normalizedTemplate,
        version: 5,
      }),
    }));
  });

  it('throws a version conflict before snapshotting when expected version is stale', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: {
        record: {
          id: 'template_123',
          version: 8,
          schema: template,
          locked_for_review: false,
        },
      },
      error: null,
    } as any);

    await expect(applyRepairedTemplateToRecord({
      templateId: 'template_123',
      repairedTemplate: template,
      expectedVersion: 7,
    })).rejects.toMatchObject({
      code: 'version_conflict',
      expectedVersion: 7,
      currentVersion: 8,
    });

    expect(invokeSecureFunction).toHaveBeenCalledTimes(1);
  });

  it('blocks locked templates', async () => {
    vi.mocked(invokeSecureFunction).mockResolvedValueOnce({
      data: {
        record: {
          id: 'template_123',
          version: 1,
          schema: template,
          locked_for_review: true,
        },
      },
      error: null,
    } as any);

    await expect(applyRepairedTemplateToRecord({
      templateId: 'template_123',
      repairedTemplate: template,
    })).rejects.toMatchObject({
      code: 'template_locked_for_review',
    });
  });
});
