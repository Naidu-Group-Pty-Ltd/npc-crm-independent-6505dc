/**
 * visual-quality-batch-v1 coordinator (Path-to-100 v2 · C4).
 */
import { describe, expect, it } from 'vitest';
import {
  planVisualQualityBatches,
  runBatchedVisualQuality,
  type VisualQualityBatchRunner,
} from '../ingestion/visualQuality';
import type { CdirDocument } from '../ingestion/cdir/schema';
import type { ReportTemplate } from '../templateSchema';

const cdir = (n: number): CdirDocument => ({
  version: 1,
  source: { kind: 'pdf', checksum: 'c', filename: 's.pdf' },
  pages: Array.from({ length: n }, (_, i) => ({
    id: `docling-page-${i + 1}`, label: `P${i + 1}`, width: 595, height: 842, layers: [],
  })),
  assets: [], fonts: [], warnings: [],
}) as unknown as CdirDocument;

const template = (n: number): ReportTemplate => ({
  version: 1,
  tokens: { colors: {}, fonts: {}, spacing: {} },
  pages: Array.from({ length: n }, (_, i) => ({
    id: `docling-page-${i + 1}`, name: `P${i + 1}`, size: { width: 595, height: 842 }, background: {}, blocks: [],
  })),
}) as unknown as ReportTemplate;

const pageReport = (n: number, score = 0.9): any => ({
  pageNumber: n, pageId: `docling-page-${n}`, overallScore: score, recommendedAction: 'accept', warnings: [],
});

const healthy: VisualQualityBatchRunner = async (input) => ({
  ok: true,
  template: input.template,
  pageReports: input.batchContext.pageNumbers.map((n) => pageReport(n)),
  initialScore: 0.85,
  finalScore: 0.9,
  repairPassesApplied: 1,
  patchesApplied: 2,
  manualReviewRequired: false,
});

describe('planVisualQualityBatches', () => {
  it('chunks pages into sequential batches with stable context', () => {
    const plan = planVisualQualityBatches([1, 2, 3, 4, 5], 2);
    expect(plan.ok).toBe(true);
    expect(plan.batches.map((b) => b.pageNumbers)).toEqual([[1, 2], [3, 4], [5]]);
    expect(plan.batches[0].batchCount).toBe(3);
    expect(plan.batches[0].documentPageCount).toBe(5);
    expect(plan.batches[2].expectedBatchPageCount).toBe(1);
  });

  it('rejects duplicate page numbers', () => {
    const plan = planVisualQualityBatches([1, 2, 2, 3]);
    expect(plan.ok).toBe(false);
    expect(plan.problems.some((p) => p.startsWith('duplicate_page_numbers'))).toBe(true);
  });

  it('rejects invalid page numbers', () => {
    const plan = planVisualQualityBatches([1, 0, -2]);
    expect(plan.ok).toBe(false);
    expect(plan.problems.some((p) => p.startsWith('invalid_page_numbers'))).toBe(true);
  });
});

describe('runBatchedVisualQuality', () => {
  it('gives a 25-page document complete coverage in bounded batches (no mismatch)', async () => {
    const res = await runBatchedVisualQuality({ template: template(25), cdir: cdir(25), batchSize: 10, runBatch: healthy });
    expect(res.batch.coverage).toBe('complete');
    expect(res.batch.pagesScored).toBe(25);
    expect(res.batch.pagesUnscored).toEqual([]);
    expect(res.batch.batchesCompleted).toBe(3);
    expect(res.pageReports).toHaveLength(25);
    // aggregation sums per batch without double-counting (3 batches × 1 pass / 2 patches)
    expect(res.repairPassesApplied).toBe(3);
    expect(res.patchesApplied).toBe(6);
    expect(res.manualReviewRequired).toBe(false);
  });

  it('gives an 80-page document complete coverage', async () => {
    const res = await runBatchedVisualQuality({ template: template(80), cdir: cdir(80), batchSize: 10, runBatch: healthy });
    expect(res.batch.coverage).toBe('complete');
    expect(res.batch.batchesCompleted).toBe(8);
    expect(res.pageReports).toHaveLength(80);
    expect(res.batch.pagesUnscored).toEqual([]);
  });

  it('a failed batch yields partial coverage + manual review (never a silent pass)', async () => {
    const runBatch: VisualQualityBatchRunner = async (input) =>
      input.batchContext.batchIndex === 1
        ? { ok: false, problems: ['capture_failed'] }
        : { ok: true, template: input.template, pageReports: input.batchContext.pageNumbers.map((n) => pageReport(n)), finalScore: 0.9 };

    const res = await runBatchedVisualQuality({ template: template(25), cdir: cdir(25), batchSize: 10, runBatch });
    expect(res.batch.coverage).toBe('partial');
    expect(res.batch.pagesUnscored).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(res.manualReviewRequired).toBe(true);
    expect(res.batch.batchProblems[0].message).toContain('capture_failed');
    expect(res.pageReports).toHaveLength(15);
  });

  it('applies batch-1 accepted repairs to the working template before batch-2 runs', async () => {
    const seenPage1Name: Record<number, string | undefined> = {};
    const runBatch: VisualQualityBatchRunner = async (input) => {
      const p1 = (input.template.pages as Array<{ id: string; name: string }>).find((p) => p.id === 'docling-page-1');
      seenPage1Name[input.batchContext.batchIndex] = p1?.name;
      const inBatch = new Set(input.batchContext.pageNumbers);
      const repaired = {
        ...input.template,
        pages: (input.template.pages as Array<{ id: string; name: string }>).map((p) =>
          inBatch.has(Number(/docling-page-(\d+)/.exec(p.id)?.[1])) ? { ...p, name: 'repaired' } : p,
        ),
      } as ReportTemplate;
      return { ok: true, template: repaired, pageReports: input.batchContext.pageNumbers.map((n) => pageReport(n)), finalScore: 0.9 };
    };

    const res = await runBatchedVisualQuality({ template: template(20), cdir: cdir(20), batchSize: 10, runBatch });
    expect(seenPage1Name[0]).toBe('P1'); // batch-1 saw the original
    expect(seenPage1Name[1]).toBe('repaired'); // batch-2 saw batch-1's applied change
    expect((res.template.pages as Array<{ name: string }>).every((p) => p.name === 'repaired')).toBe(true);
  });

  it('rejects a document whose derived page numbers duplicate (coverage none)', async () => {
    const bad = cdir(2);
    (bad.pages[1] as unknown as { id: string }).id = 'docling-page-1';
    const res = await runBatchedVisualQuality({ template: template(2), cdir: bad, batchSize: 10, runBatch: healthy });
    expect(res.batch.coverage).toBe('none');
    expect(res.manualReviewRequired).toBe(true);
    expect(res.batch.batchProblems[0].message).toContain('duplicate_page_numbers');
  });
});
