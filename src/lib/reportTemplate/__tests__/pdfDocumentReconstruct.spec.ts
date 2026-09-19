import { describe, it, expect, vi } from 'vitest';
import { reconstructPdfWithClaude } from '../ingestion/pdfDocumentReconstruct';
import type { InvokeFn } from '../ingestion/codeIngest';
import { parseTemplate } from '../templateSchema';

const VALID = {
  version: 1,
  tokens: { colors: {}, fonts: {}, spacing: {} },
  pages: [{
    id: 'p', name: 'P', size: { width: 595, height: 842 }, background: {},
    blocks: [{ id: 'b', type: 'free', props: {}, overlays: [{ id: 't', type: 'text', x: 0, y: 0, width: 100, height: 20, content: 'Hi' }] }],
  }],
};

const schema = parseTemplate({
  version: 1, tokens: { colors: {}, fonts: {}, spacing: {} },
  pages: [{ id: 'p', name: 'P', size: { width: 595, height: 842 }, background: {}, blocks: [] }],
});

const ok = (data: any): InvokeFn => vi.fn().mockResolvedValue({ data, error: null });

describe('reconstructPdfWithClaude', () => {
  it('requires a pdf', async () => {
    await expect(reconstructPdfWithClaude({ pdfBase64: '', schema }, ok({}))).rejects.toThrow(/No PDF/);
  });

  it('invokes the design agent in pdf_document mode and returns the parsed schema', async () => {
    const invoke = ok({ schema: VALID, modelUsed: 'claude-opus-4-8', warnings: ['x'] });
    const res = await reconstructPdfWithClaude({ pdfBase64: 'JVBER', schema, activePageId: 'p' }, invoke);
    expect(invoke).toHaveBeenCalledWith('template-design-agent', expect.objectContaining({
      mode: 'pdf_document', pdfBase64: 'JVBER', activePageId: 'p',
    }));
    expect(res.pageCount).toBe(1);
    expect(res.modelUsed).toBe('claude-opus-4-8');
    expect(res.warnings).toEqual(['x']);
  });

  it('throws on an unusable reconstruction', async () => {
    await expect(reconstructPdfWithClaude({ pdfBase64: 'X', schema }, ok({ schema: { version: 1, pages: [] } })))
      .rejects.toThrow(/not usable|no pages/i);
  });

  it('propagates invoke errors', async () => {
    const invoke: InvokeFn = vi.fn().mockResolvedValue({ data: null, error: { message: 'requires Claude' } });
    await expect(reconstructPdfWithClaude({ pdfBase64: 'X', schema }, invoke)).rejects.toThrow(/requires Claude/);
  });
});

describe('sending the measurements', () => {
  const ref = (n: number) => ({
    pageWidth: 595.28, pageHeight: 841.89, imageWidth: 595.28, imageHeight: 841.89,
    elements: [{ id: `t${n}`, text: `page ${n}`, x: 10, y: 20, width: 100, height: 12, fontSize: 9 }],
  });
  const payload = (invoke: ReturnType<typeof ok>) => (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];

  it('sends every measured page, and page 1 under the key the agent already reads', async () => {
    const invoke = ok({ schema: VALID });
    await reconstructPdfWithClaude({
      pdfBase64: 'X', schema,
      grounding: {
        pages: [
          { pageNumber: 2, reference: ref(2), dropped: 0 },
          { pageNumber: 3, reference: ref(3), dropped: 4 },
        ],
        totalPages: 9, pagesOmitted: 6, elementsDropped: 4,
      },
    }, invoke);
    const body = payload(invoke);
    // The single-page key stays populated so a caller that knows nothing about
    // the multi-page shape still grounds the first measured page.
    expect(body.groundedReference).toEqual(ref(2));
    expect(body.groundedPages.map((p: { pageNumber: number }) => p.pageNumber)).toEqual([2, 3]);
    expect(body.groundingCoverage).toEqual({ totalPages: 9, pagesOmitted: 6, elementsDropped: 4 });
  });

  it('sends no grounding key at all when nothing was measured', async () => {
    // An empty element list satisfies the agent's guard and then asserts the
    // page has no text — on a scanned document that is a lie the model would
    // reproduce. Absent means "read the document yourself".
    for (const grounding of [
      undefined,
      null,
      { pages: [], totalPages: 3, pagesOmitted: 0, elementsDropped: 0 },
      { pages: [{ pageNumber: 1, reference: { ...ref(1), elements: [] }, dropped: 0 }], totalPages: 1, pagesOmitted: 0, elementsDropped: 0 },
    ]) {
      const invoke = ok({ schema: VALID });
      await reconstructPdfWithClaude({ pdfBase64: 'X', schema, grounding: grounding as never }, invoke);
      const body = payload(invoke);
      expect(body).not.toHaveProperty('groundedReference');
      expect(body).not.toHaveProperty('groundedPages');
      expect(body.pdfBase64).toBe('X'); // the document still goes
    }
  });

  it('skips an empty page but keeps the ones that measured', async () => {
    const invoke = ok({ schema: VALID });
    await reconstructPdfWithClaude({
      pdfBase64: 'X', schema,
      grounding: {
        pages: [
          { pageNumber: 1, reference: { ...ref(1), elements: [] }, dropped: 0 },
          { pageNumber: 2, reference: ref(2), dropped: 0 },
        ],
        totalPages: 2, pagesOmitted: 0, elementsDropped: 0,
      },
    }, invoke);
    expect(payload(invoke).groundedPages.map((p: { pageNumber: number }) => p.pageNumber)).toEqual([2]);
  });
});
