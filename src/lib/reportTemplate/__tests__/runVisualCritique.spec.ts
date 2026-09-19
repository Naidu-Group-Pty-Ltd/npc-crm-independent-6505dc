/**
 * The critique end to end, without a backend.
 *
 * What these lock is the ORDER: look, then drop what the page cannot contain,
 * then check the rest against measurement. Nothing on this path may reach a
 * template — the request the fetcher receives is images and ids, and the result
 * is findings and counts.
 */
import { describe, it, expect, vi } from 'vitest';
import { runVisualCritique } from '@/lib/reportTemplate/ingestion/reconciliation/runVisualCritique';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

const page = {
  size: { width: 595, height: 842 },
  blocks: [{
    overlays: [
      {
        id: 'title', type: 'text', x: 48, y: 96, width: 200, height: 30,
        content: 'Borrowing Capacity Snapshot', fontSize: 20, lineHeight: 1.3,
        fontFamily: 'Helvetica', whiteSpace: 'nowrap',
      },
      { id: 'logo', type: 'image', x: 48, y: 40, width: 120, height: 40 },
    ],
  }],
};

/** 10pt per character at 20pt type — legible arithmetic in an assertion. */
const measure = (text: string, size: number) => text.length * 10 * (size / 20);

const ok = (findings: unknown[], modelUsed = 'claude-opus-4-8') =>
  vi.fn().mockResolvedValue({ findings, modelUsed });

describe('runVisualCritique', () => {
  it('sends the two images and the element ids, and nothing else', async () => {
    const fetchFindings = ok([]);
    await runVisualCritique({
      context: { pageId: 'p1', page, sourceImageDataUrl: PNG, renderedImageDataUrl: `${PNG}x`, measure },
      fetchFindings,
    });
    const request = fetchFindings.mock.calls[0][0];
    expect(request.pageId).toBe('p1');
    expect(request.pageWidth).toBe(595);
    expect(request.pageHeight).toBe(842);
    expect(request.sourceImageDataUrl).toBe(PNG);
    expect(request.elements.map((e: { id: string }) => e.id)).toEqual(['title', 'logo']);
    // The inventory withholds style: telling the model what colour something is
    // SUPPOSED to be invites it to report the declaration back as an observation.
    expect(request.elements[0]).not.toHaveProperty('fontFamily');
    expect(request.elements[0]).not.toHaveProperty('color');
  });

  it('confirms a claim the geometry bears out', async () => {
    // 27 characters at 10pt each is 270pt of text in a 200pt box.
    const result = await runVisualCritique({
      context: { pageId: 'p1', page, sourceImageDataUrl: PNG, renderedImageDataUrl: PNG, measure },
      fetchFindings: ok([
        { kind: 'text_clipped', severity: 'critical', overlayId: 'title', note: 'The title is cut off.' },
      ]),
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].verdict).toBe('confirmed');
    expect(result.summary).toMatchObject({ confirmed: 1, confirmedCritical: 1, refuted: 0 });
    expect(result.modelUsed).toBe('claude-opus-4-8');
  });

  it('keeps a claim the geometry contradicts, marked as contradicted', async () => {
    const roomy = { ...page, blocks: [{ overlays: [{ ...page.blocks[0].overlays[0], width: 600 }] }] };
    const result = await runVisualCritique({
      context: { pageId: 'p1', page: roomy, sourceImageDataUrl: PNG, renderedImageDataUrl: PNG, measure },
      fetchFindings: ok([
        { kind: 'text_clipped', severity: 'critical', overlayId: 'title', note: 'The title is cut off.' },
      ]),
    });
    // A reviewer is better served knowing the model claimed something and
    // measurement disagreed than by a list that quietly lost it.
    expect(result.findings[0].verdict).toBe('refuted');
    expect(result.summary.confirmedCritical).toBe(0);
  });

  it('drops a finding naming an element the page does not contain', async () => {
    const result = await runVisualCritique({
      context: { pageId: 'p1', page, sourceImageDataUrl: PNG, renderedImageDataUrl: PNG, measure },
      fetchFindings: ok([
        { kind: 'occluded', severity: 'critical', overlayId: 'watermark', note: 'Hidden.' },
        { kind: 'text_clipped', severity: 'critical', overlayId: 'title', note: 'Cut off.' },
      ]),
    });
    expect(result.findings.map((f) => f.overlayId)).toEqual(['title']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('not on this page');
  });

  it('treats an empty findings list as a clean page, not a failure', async () => {
    const result = await runVisualCritique({
      context: { pageId: 'p1', page, sourceImageDataUrl: PNG, renderedImageDataUrl: PNG, measure },
      fetchFindings: ok([]),
    });
    expect(result.findings).toEqual([]);
    expect(result.error).toBeUndefined();
    expect(result.summary.total).toBe(0);
  });

  it('refuses to critique one image', async () => {
    // Judging a reconstruction with nothing to compare it against produces a
    // critique of the page rather than of the difference.
    const fetchFindings = ok([]);
    for (const context of [
      { sourceImageDataUrl: '', renderedImageDataUrl: PNG },
      { sourceImageDataUrl: PNG, renderedImageDataUrl: '' },
    ]) {
      const result = await runVisualCritique({
        context: { pageId: 'p1', page, measure, ...context },
        fetchFindings,
      });
      expect(result.error).toContain('both the source page and the rendered page');
    }
    expect(fetchFindings).not.toHaveBeenCalled();
  });

  it('says so when the page has nothing on it', async () => {
    const fetchFindings = ok([]);
    const result = await runVisualCritique({
      context: {
        pageId: 'p1', page: { size: { width: 595, height: 842 }, blocks: [] },
        sourceImageDataUrl: PNG, renderedImageDataUrl: PNG,
      },
      fetchFindings,
    });
    expect(result.error).toContain('no elements');
    expect(fetchFindings).not.toHaveBeenCalled();
  });

  it('reports a transport failure instead of throwing into the review', async () => {
    const result = await runVisualCritique({
      context: { pageId: 'p1', page, sourceImageDataUrl: PNG, renderedImageDataUrl: PNG, measure },
      fetchFindings: vi.fn().mockRejectedValue(new Error('Edge Function returned 502')),
    });
    expect(result.error).toContain('502');
    expect(result.findings).toEqual([]);
  });

  it('surfaces an error the endpoint reported', async () => {
    const result = await runVisualCritique({
      context: { pageId: 'p1', page, sourceImageDataUrl: PNG, renderedImageDataUrl: PNG, measure },
      fetchFindings: vi.fn().mockResolvedValue({ error: 'Visual critique requires Claude.' }),
    });
    expect(result.error).toBe('Visual critique requires Claude.');
  });

  it('derives paint order from the renderer\'s own ranking', async () => {
    // "The logo is buried" is a question about what paints on top, and only
    // paintOrder.ts knows the answer — deriving it a second time here is how the
    // editor and the export used to disagree about stacking.
    const withBackdrop = {
      size: { width: 595, height: 842 },
      blocks: [{
        overlays: [
          { id: 'logo', type: 'image', x: 48, y: 40, width: 120, height: 40 },
          { id: 'backdrop', type: 'vector', x: 0, y: 0, width: 595, height: 842 },
        ],
      }],
    };
    const result = await runVisualCritique({
      context: { pageId: 'p1', page: withBackdrop, sourceImageDataUrl: PNG, renderedImageDataUrl: PNG },
      fetchFindings: ok([
        { kind: 'occluded', severity: 'critical', overlayId: 'logo', relatedOverlayId: 'backdrop', note: 'Buried.' },
      ]),
    });
    // A page-covering fill-only vector is ranked as a BACKDROP and paints below
    // images, so the claim is contradicted — which is the fix from earlier in
    // this programme holding.
    expect(result.findings[0].verdict).toBe('refuted');
    expect(result.findings[0].basis).toContain('paints above');
  });
});
