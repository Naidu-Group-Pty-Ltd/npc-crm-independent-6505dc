/**
 * W0 — the DOM evidence capture adapter.
 *
 * `domEvidence.ts` held correct, tested evaluators for clipping and overflow
 * that had no input: nothing produced the evidence they consume, so the V2 gate
 * sat unwired and the defect users reported was structurally invisible.
 * `generatedRenderCapture.ts` captures pixels, which cannot answer "did this
 * box clip its text" — clipped text still occupies its pixels, it is just not
 * drawn.
 *
 * jsdom does not lay text out, so these tests drive the measurements directly
 * rather than pretending to render. That is the honest boundary: the geometry
 * decisions are covered exhaustively in qualityGateV2.pure.spec.ts, and what is
 * covered here is that this adapter READS the right things off an element and
 * degrades safely when it cannot.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { captureTextEvidence } from '@/lib/reportTemplate/ingestion/visualQuality/v2/domEvidenceCapture';

const PAGE = { x: 0, y: 0, width: 595, height: 842 };

/** jsdom reports 0 for layout, so scroll/client sizes are stubbed per element. */
function overlay(id: string, dims: {
  client: [number, number];
  scroll: [number, number];
  overflow?: string;
}): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-overlay-id', id);
  el.textContent = 'Borrowing capacity summary';
  if (dims.overflow) {
    // Set the longhands: jsdom does not expand the `overflow` shorthand into
    // computed overflowX/overflowY, which is what the adapter reads.
    el.style.overflowX = dims.overflow;
    el.style.overflowY = dims.overflow;
  }
  Object.defineProperties(el, {
    clientWidth: { value: dims.client[0], configurable: true },
    clientHeight: { value: dims.client[1], configurable: true },
    scrollWidth: { value: dims.scroll[0], configurable: true },
    scrollHeight: { value: dims.scroll[1], configurable: true },
  });
  return el;
}

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.appendChild(root);
});

describe('captureTextEvidence', () => {
  it('measures a box whose text spills under visible overflow', () => {
    // The exact production shape: the export renderer sets `overflow` only
    // under maxLines, so a too-small box spills and used to measure as fine.
    root.appendChild(overlay('o1', { client: [100, 20], scroll: [100, 64] }));
    const [ev] = captureTextEvidence({ root, pageRectPx: PAGE });

    expect(ev.overlayId).toBe('o1');
    expect(ev.overflowing).toBe(true);
    expect(ev.overflowHeightPx).toBe(44);
    // It spills; it is not cut off. The two must stay distinguishable.
    expect(ev.clipped).toBe(false);
  });

  it('measures the same geometry under a clipping overflow as clipped', () => {
    root.appendChild(overlay('o1', { client: [100, 20], scroll: [100, 64], overflow: 'hidden' }));
    const [ev] = captureTextEvidence({ root, pageRectPx: PAGE });
    expect(ev.clipped).toBe(true);
    expect(ev.clippedHeightPx).toBe(44);
    expect(ev.overflowing).toBe(false);
  });

  it('reports a fitting box as neither', () => {
    root.appendChild(overlay('o1', { client: [100, 40], scroll: [100, 40] }));
    const [ev] = captureTextEvidence({ root, pageRectPx: PAGE });
    expect(ev.clipped).toBe(false);
    expect(ev.overflowing).toBe(false);
  });

  it('captures the text and its code points', () => {
    root.appendChild(overlay('o1', { client: [100, 40], scroll: [100, 40] }));
    const [ev] = captureTextEvidence({ root, pageRectPx: PAGE });
    expect(ev.rawVisibleText).toBe('Borrowing capacity summary');
    expect(ev.codePoints.length).toBe(ev.rawVisibleText.length);
  });

  it('walks every overlay under the root', () => {
    for (const id of ['a', 'b', 'c']) {
      root.appendChild(overlay(id, { client: [100, 40], scroll: [100, 40] }));
    }
    expect(captureTextEvidence({ root, pageRectPx: PAGE })).toHaveLength(3);
  });

  it('ignores elements that are not overlays', () => {
    const plain = document.createElement('div');
    plain.textContent = 'not an overlay';
    root.appendChild(plain);
    expect(captureTextEvidence({ root, pageRectPx: PAGE })).toHaveLength(0);
  });

  it('honours the element cap — getClientRects forces layout per element', () => {
    for (let i = 0; i < 10; i += 1) {
      root.appendChild(overlay(`o${i}`, { client: [100, 40], scroll: [100, 40] }));
    }
    expect(captureTextEvidence({ root, pageRectPx: PAGE, maxElements: 4 })).toHaveLength(4);
  });

  it('carries the hidden-semantic marker so E6 layers never count as visible', () => {
    const el = overlay('o1', { client: [100, 40], scroll: [100, 40] });
    el.setAttribute('data-hidden-semantic', 'true');
    root.appendChild(el);
    expect(captureTextEvidence({ root, pageRectPx: PAGE })[0].hiddenSemantic).toBe(true);
  });
});

describe('captureTextEvidence — degrades rather than failing an import', () => {
  it('returns nothing for an unusable root instead of throwing', () => {
    expect(() => captureTextEvidence({ root: null as never, pageRectPx: PAGE })).not.toThrow();
    expect(captureTextEvidence({ root: null as never, pageRectPx: PAGE })).toEqual([]);
  });

  it('omits an element it cannot measure rather than recording zeroes', () => {
    // A zero here would read as "measured and fine", which is worse than
    // an absent record — the gate would score a defect as a pass.
    const bad = overlay('bad', { client: [100, 40], scroll: [100, 40] });
    Object.defineProperty(bad, 'getBoundingClientRect', {
      value: () => { throw new Error('layout unavailable'); },
    });
    root.appendChild(bad);
    root.appendChild(overlay('good', { client: [100, 40], scroll: [100, 40] }));

    const out = captureTextEvidence({ root, pageRectPx: PAGE });
    expect(out).toHaveLength(1);
    expect(out[0].overlayId).toBe('good');
  });

  it('handles an empty page', () => {
    expect(captureTextEvidence({ root, pageRectPx: PAGE })).toEqual([]);
  });
});
