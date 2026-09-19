/**
 * Source-fidelity scoring (Path-to-100 v2 · C3.2/C3.4).
 *
 * Proves the headline metrics degrade when the reconstruction diverges from the
 * IMMUTABLE SOURCE expectations, and that a self-consistent but source-wrong
 * CDIR cannot pass when scored against the source (closing the
 * `cdir_self_baseline` loophole).
 */
import { describe, expect, it } from 'vitest';
import { runVisualDiff } from '../ingestion/visualQuality';
import type { CdirDocument } from '../ingestion/cdir/schema';

type Layer = { id: string; text?: string; bounds: { x: number; y: number; width: number; height: number } };

function doc(layers: Layer[]): CdirDocument {
  return {
    version: 1,
    source: { kind: 'pdf', checksum: 'c', filename: 's.pdf' },
    pages: [
      {
        id: 'docling-page-1',
        label: 'Page 1',
        width: 612,
        height: 792,
        layers: layers.map((l) => ({
          id: l.id,
          kind: 'text',
          bounds: l.bounds,
          text: l.text ?? 'x',
          runs: [{ text: l.text ?? 'x', fontSize: 12 }],
          fontSize: 12,
          confidence: 0.9,
        })),
      },
    ],
    assets: [],
    fonts: [],
    warnings: [],
  } as unknown as CdirDocument;
}

const B = { x: 40, y: 60, width: 260, height: 32 };
const run = (cdir: CdirDocument, expectations: { expectedText: any[]; expectedBounds: any[] }) =>
  runVisualDiff({ importId: 'imp', templateId: null, cdir, expectations, renderedRasters: [], finalMode: 'hybrid' });

const SOURCE_TEXT = 'alpha beta gamma delta epsilon zeta';

describe('source-fidelity scoring', () => {
  it('removed text lowers text coverage against source', async () => {
    const expectations = { expectedText: [{ pageId: 'docling-page-1', text: SOURCE_TEXT }], expectedBounds: [] };
    const healthy = await run(doc([{ id: 'body', text: SOURCE_TEXT, bounds: B }]), expectations);
    const damaged = await run(doc([{ id: 'body', text: 'alpha', bounds: B }]), expectations);
    expect(damaged.pages[0].textCoverageScore).toBeLessThan(healthy.pages[0].textCoverageScore);
    expect(healthy.pages[0].textCoverageScore).toBeGreaterThan(0.9);
  });

  it('shifted bounds lower the layout-drift score against source', async () => {
    const expectations = {
      expectedText: [],
      expectedBounds: [{ pageId: 'docling-page-1', layerId: 'headline', bounds: B }],
    };
    const healthy = await run(doc([{ id: 'headline', bounds: B }]), expectations);
    const shifted = await run(doc([{ id: 'headline', bounds: { x: 400, y: 700, width: 260, height: 32 } }]), expectations);
    expect(shifted.pages[0].layoutDriftScore).toBeLessThan(healthy.pages[0].layoutDriftScore);
  });

  it('a missing expected layer lowers the missing-element score', async () => {
    const expectations = {
      expectedText: [],
      expectedBounds: [
        { pageId: 'docling-page-1', layerId: 'a', bounds: B },
        { pageId: 'docling-page-1', layerId: 'b', bounds: { x: 40, y: 200, width: 260, height: 32 } },
      ],
    };
    const both = await run(doc([{ id: 'a', bounds: B }, { id: 'b', bounds: { x: 40, y: 200, width: 260, height: 32 } }]), expectations);
    const missing = await run(doc([{ id: 'a', bounds: B }]), expectations);
    expect(missing.pages[0].missingElementScore).toBeLessThan(both.pages[0].missingElementScore);
  });

  it('a source-wrong but self-consistent CDIR cannot pass when scored against source', async () => {
    const wrong = doc([{ id: 'body', text: 'totally wrong reconstructed text', bounds: B }]);

    const sourceExpectations = {
      expectedText: [{ pageId: 'docling-page-1', text: 'the correct source words here now' }],
      expectedBounds: [],
    };
    // buildCdirSelfExpectations equivalent: expected == rendered.
    const selfExpectations = {
      expectedText: [{ pageId: 'docling-page-1', text: 'totally wrong reconstructed text' }],
      expectedBounds: [],
    };

    const againstSource = await run(wrong, sourceExpectations);
    const againstSelf = await run(wrong, selfExpectations);

    // Self-scoring inflates to ~perfect; source-scoring exposes the divergence.
    expect(againstSelf.pages[0].textCoverageScore).toBeGreaterThan(0.9);
    expect(againstSource.pages[0].textCoverageScore).toBeLessThan(0.5);
    expect(againstSource.pages[0].textCoverageScore).toBeLessThan(againstSelf.pages[0].textCoverageScore);
  });
});
