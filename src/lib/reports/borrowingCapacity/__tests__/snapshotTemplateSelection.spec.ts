/**
 * A chosen template has to reach the document, and BC's never did.
 *
 * `report_template_selections` stored the choice correctly, the picker showed
 * it, and `resolveTemplateSelection` answered `selected` — and every Borrowing
 * Capacity download came out in the ranked default anyway, silently.
 *
 * The cause is one optional field. `deliverSnapshot` handed
 * `input.request.assessmentId` to `tryTemplateDocument`, which returns null the
 * moment it has no record id, and **no surface in the product fills that field
 * in**:
 *
 *     ResultsPanel.tsx:227           { clientId, clientName, scenarioPresets }
 *     BorrowingCapacityCard.tsx:144  { clientId, clientName }
 *     ClientReportsTab.tsx:869       { clientId, clientName }
 *
 * `assessmentId` is documented as optional — "omit for the most recent" — and
 * the render route does resolve it. The template adapter cannot: it renders a
 * record, and "the most recent" is not one. So the id is resolved here, the
 * same way the route resolves it.
 *
 * The second half is the silence. `tryTemplateDocument` returned null *before*
 * reading the selection, so the fall-through notice every other path gets could
 * not fire. That is what made this invisible rather than merely wrong: the
 * legacy composer produces a well-typeset document, so an ignored choice and an
 * honoured one look identical from the outside.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const tryTemplateDocument = vi.fn();
const requestSnapshot = vi.fn();
const maybeSingle = vi.fn();

vi.mock('@/lib/reportTemplate/templateDocument', () => ({
  tryTemplateDocument: (...args: unknown[]) => tryTemplateDocument(...args),
}));
vi.mock('./../requestSnapshot', () => ({
  requestBorrowingCapacitySnapshot: (...args: unknown[]) => requestSnapshot(...args),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({ maybeSingle: () => maybeSingle() }),
          }),
        }),
      }),
    }),
  },
}));

let deliverSnapshot: typeof import('../deliverSnapshot').deliverSnapshot;

beforeEach(async () => {
  vi.clearAllMocks();
  maybeSingle.mockResolvedValue({ data: { id: 'assessment-9' }, error: null });
  tryTemplateDocument.mockResolvedValue(null);
  requestSnapshot.mockResolvedValue({
    url: 'blob:x', fileName: 'snapshot.pdf', bytes: 1, brandGaps: [], source: 'server',
  });
  ({ deliverSnapshot } = await import('../deliverSnapshot'));
  // jsdom has no object-URL plumbing for the save step, and no fetch that can
  // read a blob: URL. Both are downstream of the assertions here.
  (globalThis.URL as any).createObjectURL = vi.fn(() => 'blob:x');
  (globalThis.URL as any).revokeObjectURL = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, blob: async () => new Blob(['pdf']),
  })));
});

afterEach(() => vi.resetModules());

const input = (assessmentId?: string) => ({
  variant: 'server' as const,
  request: { clientId: 'client-1', clientName: 'A Client', ...(assessmentId ? { assessmentId } : {}) },
  legacy: async () => null,
});

describe('the template path gets a record to render', () => {
  it('resolves the most recent assessment when the caller names none', async () => {
    await deliverSnapshot(input());
    // The bug: this used to be called with `undefined` and bail immediately.
    expect(tryTemplateDocument).toHaveBeenCalledWith('borrowing_capacity', 'assessment-9', { renderer: 'weasyprint' });
  });

  it('uses the assessment the caller named, when it named one', async () => {
    await deliverSnapshot(input('assessment-explicit'));
    expect(tryTemplateDocument).toHaveBeenCalledWith('borrowing_capacity', 'assessment-explicit', { renderer: 'weasyprint' });
    // No lookup when the caller already answered the question.
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('still delivers when the lookup is refused', async () => {
    // Best-effort by rule: this must never turn a working download into a
    // failed one. The server route resolves the assessment itself.
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'denied' } });
    const result = await deliverSnapshot(input());
    expect(tryTemplateDocument).toHaveBeenCalledWith('borrowing_capacity', null, { renderer: 'weasyprint' });
    expect(result.source).toBe('server');
  });

  it('does not touch the template path when the person asked for the legacy layout', async () => {
    await deliverSnapshot({ ...input(), variant: 'legacy', legacy: async () => ({ blob: new Blob(['x']), fileName: 'legacy.pdf' }) });
    expect(tryTemplateDocument).not.toHaveBeenCalled();
  });
});
