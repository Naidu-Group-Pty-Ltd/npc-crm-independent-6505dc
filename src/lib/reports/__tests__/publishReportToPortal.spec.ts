/**
 * RS-5c.3 — publishing to the portal points at the render the route stored.
 *
 * `publishReportToPortal`'s own rule is that a generated report is pointed
 * at, never copied. Its two on-publish renders (a borrowing capacity
 * assessment, a stored portfolio analysis with no file) broke that rule from
 * the inside: the render route stored and ledgered the document, answered a
 * signed URL, and the publisher fetched the bytes back and uploaded them a
 * SECOND time to `client-files/portal-reports/…`, then wrote the row with the
 * copy's path. The ledger named one object, the portal another, and every
 * publish doubled the bytes.
 *
 * Now the blob helpers answer `storagePath` — the templated final's object or
 * the route's — and the row is written with that. The upload survives only
 * for a document nothing stored: the in-browser generator, reached when the
 * render route is not deployed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedReport } from '../clientReportInventory.pure';

const h = vi.hoisted(() => ({
  invoke: [] as Array<{ fn: string; body: Record<string, unknown> }>,
  uploads: [] as Array<{ bucket: string; path: string; opts: Record<string, unknown> }>,
  snapshotCalls: [] as unknown[],
  reviewCalls: [] as unknown[],
  snapshot: null as Record<string, unknown> | null,
  review: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/secureInvoke', () => ({
  invokeSecureFunction: async (fn: string, body: Record<string, unknown>) => {
    h.invoke.push({ fn, body });
    return { data: { success: true }, error: null };
  },
}));
vi.mock('@/hooks/useSecureStorage', () => ({
  secureStorageUpload: async (bucket: string, path: string, _blob: Blob, opts: Record<string, unknown>) => {
    h.uploads.push({ bucket, path, opts });
    return { success: true, path };
  },
}));
vi.mock('@/lib/fetchLatestBorrowingCapacity', () => ({
  fetchLatestBorrowingCapacity: async () => ({
    latestAssessment: { id: 'bc-1' }, incomeSources: [], liabilities: [], expenses: [], properties: [], client: {},
  }),
}));
vi.mock('@/components/borrowing-capacity/BorrowingCapacityPDFReport', () => ({
  generateBorrowingCapacityPDF: async () => ({ blob: new Blob(['legacy']), fileName: 'legacy.pdf' }),
}));
vi.mock('@/lib/reports/borrowingCapacity/deliverSnapshot', () => ({
  snapshotBlob: async (input: unknown) => { h.snapshotCalls.push(input); return h.snapshot; },
}));
vi.mock('@/lib/reports/portfolio/deliverPortfolioReview', () => ({
  portfolioReviewBlob: async (input: unknown) => { h.reviewCalls.push(input); return h.review; },
}));

import { publishReportToPortal } from '../publishReportToPortal';

const report = (over: Partial<UnifiedReport> = {}): UnifiedReport => ({
  id: 'r1', type: 'portfolio' as UnifiedReport['type'], name: 'Portfolio Analysis - 14 Sep 2026',
  generatedAt: '2026-09-14T09:00:00.000Z', status: 'completed', fileUrl: null,
  source: 'portfolio_report', ...over,
});

const pdf = () => new Blob(['%PDF-1.7 typeset'], { type: 'application/pdf' });

const portalRow = () => {
  const write = h.invoke.find((c) => c.fn === 'manage-client-data');
  expect(write, 'the portal row was written').toBeDefined();
  expect(write!.body.table).toBe('client_portal_reports');
  return write!.body.data as Record<string, unknown>;
};

beforeEach(() => {
  h.invoke = []; h.uploads = []; h.snapshotCalls = []; h.reviewCalls = [];
  h.snapshot = null; h.review = null;
});

describe('a borrowing capacity assessment, rendered on publish', () => {
  it('points the portal at the object the renderer stored, and uploads nothing', async () => {
    h.snapshot = {
      blob: pdf(), fileName: 'Borrowing_Capacity_Snapshot.pdf', source: 'server', brandGaps: [],
      storagePath: 'borrowing-capacity/c-1/2026-09-14/7d1e-Borrowing_Capacity_Snapshot.pdf',
    };
    const out = await publishReportToPortal({
      report: report({ id: 'bc-1', source: 'borrowing_assessment', type: 'borrowing_capacity' as UnifiedReport['type'] }),
      clientId: 'c-1', clientName: 'Ada Lovelace',
    });
    expect(out).toEqual({
      ok: true, generated: true, uploaded: false,
      storagePath: 'borrowing-capacity/c-1/2026-09-14/7d1e-Borrowing_Capacity_Snapshot.pdf',
    });
    expect(h.uploads).toEqual([]);
    expect(portalRow().storage_path).toBe('borrowing-capacity/c-1/2026-09-14/7d1e-Borrowing_Capacity_Snapshot.pdf');
    // The same request every other Snapshot surface makes: the helper resolves
    // the assessment itself, so the chosen template is honoured here too.
    expect(h.snapshotCalls[0]).toMatchObject({ variant: 'server', request: { clientId: 'c-1', clientName: 'Ada Lovelace' } });
  });

  it('uploads a copy only for the in-browser generator, which stores nothing', async () => {
    h.snapshot = { blob: pdf(), fileName: 'legacy.pdf', source: 'legacy', brandGaps: [] };
    const out = await publishReportToPortal({
      report: report({ id: 'bc-1', source: 'borrowing_assessment', type: 'borrowing_capacity' as UnifiedReport['type'] }),
      clientId: 'c-1', clientName: 'Ada Lovelace',
    });
    expect(out.ok).toBe(true);
    expect(out.uploaded).toBe(true);
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].bucket).toBe('client-files');
    expect(h.uploads[0].path).toMatch(/^portal-reports\/c-1\/Borrowing_Capacity_Ada_Lovelace_\d{4}-\d{2}-\d{2}_\d{6}\.pdf$/);
    expect(h.uploads[0].opts).toMatchObject({ upsert: true, resourceId: 'c-1', contentType: 'application/pdf' });
    expect(portalRow().storage_path).toBe(h.uploads[0].path);
  });
});

describe('a stored portfolio analysis with no file, rendered on publish', () => {
  it('points the portal at the templated final the renderer stored', async () => {
    h.review = {
      blob: pdf(), fileName: 'Portfolio_Analysis.pdf', source: 'server', brandGaps: [],
      storagePath: 'template-builder/2026-09-14/abc-Portfolio_Analysis.pdf',
    };
    const out = await publishReportToPortal({
      report: report({ id: 'pf-1' }), clientId: 'c-1', clientName: 'Ada Lovelace',
    });
    expect(out).toEqual({
      ok: true, generated: true, uploaded: false,
      storagePath: 'template-builder/2026-09-14/abc-Portfolio_Analysis.pdf',
    });
    expect(h.uploads).toEqual([]);
    expect(portalRow().storage_path).toBe('template-builder/2026-09-14/abc-Portfolio_Analysis.pdf');
    expect(h.reviewCalls).toEqual([{ variant: 'server', request: { reportId: 'pf-1' } }]);
  });

  it('still uploads when the review carries no stored path', async () => {
    h.review = { blob: pdf(), fileName: 'Portfolio_Analysis.pdf', source: 'server', brandGaps: [], storagePath: null };
    const out = await publishReportToPortal({
      report: report({ id: 'pf-1' }), clientId: 'c-1', clientName: 'Ada Lovelace',
    });
    expect(out.ok).toBe(true);
    expect(out.uploaded).toBe(true);
    expect(h.uploads[0].path).toMatch(/^portal-reports\/c-1\/Portfolio_Analysis_Ada_Lovelace_/);
    expect(portalRow().storage_path).toBe(h.uploads[0].path);
  });
});

describe('a report that already has a file', () => {
  it('is pointed at and never rendered or copied', async () => {
    const out = await publishReportToPortal({
      report: report({ source: 'investment_report', type: 'investment' as UnifiedReport['type'], fileUrl: 'reports/abc.pdf' }),
      clientId: 'c-1', clientName: 'Ada Lovelace',
    });
    expect(out.ok).toBe(true);
    expect(out.generated).toBe(false);
    expect(out.uploaded).toBe(false);
    expect(h.uploads).toEqual([]);
    expect(h.snapshotCalls).toEqual([]);
    expect(h.reviewCalls).toEqual([]);
    expect(portalRow().storage_path).toBe('reports/abc.pdf');
  });
});
