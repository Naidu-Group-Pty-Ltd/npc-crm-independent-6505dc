/**
 * Per-page fidelity decision policy (Path-to-100 v2 · C6.1).
 *
 * Maps a post-repair full-metric page score to a typed output policy and pins
 * the truthfulness invariants:
 *   - the score bands (>=0.80 native, 0.65-0.79 native+review, 0.50-0.64 hybrid
 *     fallback, <0.50 pixel fallback);
 *   - a page WITHOUT a usable source raster can NEVER claim a fallback — it is
 *     recorded `fallback_unavailable` + manual review (never a false fallback);
 *   - an explicit pixel-perfect request is honored only when a raster exists;
 *   - a null score is undecidable → native + review, never a silent pass.
 */
import { describe, it, expect } from 'vitest';
import type { ReportTemplate, Page } from '../templateSchema';
import {
  decidePageFidelity,
  applyPageDecisionsToTemplate,
  PAGE_FIDELITY_DECISION_VERSION,
} from '../pdfImport/pageFidelityDecision';
import type { PdfImportPagePolicy } from '../rendering/pdfImportPagePolicy';

const AT = '2026-07-16T00:00:00.000Z';

function decide(score: number | null, hasSourceRaster: boolean, requestedMode: 'semantic' | 'hybrid' | 'pixel-perfect' = 'hybrid') {
  return decidePageFidelity({ score, hasSourceRaster, requestedMode, decidedAt: AT });
}

describe('decidePageFidelity — version + score bands (with a source raster)', () => {
  it('exposes the contract version', () => {
    expect(PAGE_FIDELITY_DECISION_VERSION).toBe('page-fidelity-decision-v1');
  });

  it('>=0.80 keeps native output, no review', () => {
    const d = decide(0.9, true);
    expect(d.action).toBe('keep_native');
    expect(d.policy.outputStrategy).toBe('native');
    expect(d.manualReviewRequired).toBe(false);
  });

  it('0.80 boundary is healthy (inclusive)', () => {
    expect(decide(0.8, true).action).toBe('keep_native');
  });

  it('0.65-0.79 keeps native but requires review', () => {
    const d = decide(0.7, true);
    expect(d.action).toBe('native_review');
    expect(d.policy.outputStrategy).toBe('native');
    expect(d.manualReviewRequired).toBe(true);
  });

  it('0.50-0.64 falls back to hybrid (raster is final output, layers editable)', () => {
    const d = decide(0.55, true);
    expect(d.action).toBe('hybrid_fallback');
    expect(d.policy.outputStrategy).toBe('raster-only');
    expect(d.policy.nativeLayerPolicy).toBe('editable');
    expect(d.manualReviewRequired).toBe(true);
  });

  it('<0.50 falls back to pixel (raster is final output, layers locked)', () => {
    const d = decide(0.3, true);
    expect(d.action).toBe('pixel_fallback');
    expect(d.policy.outputStrategy).toBe('raster-only');
    expect(d.policy.nativeLayerPolicy).toBe('locked');
    expect(d.manualReviewRequired).toBe(true);
  });

  it('stamps the decision onto the policy (score/action/reason/decidedBy)', () => {
    const d = decide(0.3, true);
    expect(d.policy.decision).toMatchObject({
      score: 0.3,
      action: 'pixel_fallback',
      decidedAt: AT,
      decidedBy: 'quality-gate',
    });
  });
});

describe('decidePageFidelity — no source raster can never claim a fallback', () => {
  it('a weak score with no raster is fallback_unavailable + review (NOT a pixel fallback)', () => {
    const d = decide(0.2, false);
    expect(d.action).toBe('fallback_unavailable');
    expect(d.reason).toBe('fallback_unavailable_no_source_raster');
    expect(d.policy.outputStrategy).toBe('native');
    expect(d.manualReviewRequired).toBe(true);
  });

  it('a mid score (0.55) with no raster is also fallback_unavailable, not hybrid', () => {
    const d = decide(0.55, false);
    expect(d.action).toBe('fallback_unavailable');
  });

  it('a healthy score with no raster still keeps native', () => {
    expect(decide(0.9, false).action).toBe('keep_native');
  });
});

describe('decidePageFidelity — explicit modes and undecidable scores', () => {
  it('pixel-perfect request WITH a raster is honored (pixel_requested, no review)', () => {
    const d = decide(0.95, true, 'pixel-perfect');
    expect(d.action).toBe('pixel_requested');
    expect(d.policy.outputStrategy).toBe('raster-only');
    expect(d.manualReviewRequired).toBe(false);
  });

  it('pixel-perfect request WITHOUT a raster degrades to fallback_unavailable + review', () => {
    const d = decide(0.95, false, 'pixel-perfect');
    expect(d.action).toBe('fallback_unavailable');
    expect(d.policy.outputStrategy).toBe('native');
    expect(d.manualReviewRequired).toBe(true);
  });

  it('a null score is undecidable → native + review (never a silent pass)', () => {
    const d = decide(null, true);
    expect(d.action).toBe('native_review');
    expect(d.policy.outputStrategy).toBe('native');
    expect(d.policy.decision?.score).toBeNull();
    expect(d.manualReviewRequired).toBe(true);
  });

  it('semantic request keeps the semantic native mode when healthy', () => {
    expect(decide(0.9, true, 'semantic').policy.finalMode).toBe('semantic');
  });
});

describe('applyPageDecisionsToTemplate', () => {
  function template(): ReportTemplate {
    return {
      version: 1,
      tokens: { colors: {}, fonts: {}, spacing: {} },
      pages: [
        { id: 'docling-page-1', name: 'P1', size: { width: 595, height: 842 }, background: { imageUrl: 'r1' }, blocks: [] },
        { id: 'docling-page-2', name: 'P2', size: { width: 595, height: 842 }, background: {}, blocks: [] },
      ],
    } as unknown as ReportTemplate;
  }

  it('returns the original template unchanged when there are no decisions', () => {
    const t = template();
    const res = applyPageDecisionsToTemplate(t, new Map());
    expect(res.changed).toBe(false);
    expect(res.template).toBe(t);
  });

  it('applies a policy only to the decided page and stamps meta.pdfImport', () => {
    const t = template();
    const decisions = new Map<string, PdfImportPagePolicy>([
      ['docling-page-1', decide(0.3, true).policy],
    ]);
    const res = applyPageDecisionsToTemplate(t, decisions);
    expect(res.changed).toBe(true);
    expect(res.template).not.toBe(t);
    expect((res.template.pages[0].meta as any).pdfImport.outputStrategy).toBe('raster-only');
    // Undecided page is untouched.
    expect((res.template.pages[1].meta as any)?.pdfImport).toBeUndefined();
    // Raster-only page reconciles its background to opaque final output.
    expect((res.template.pages[0].background as any).underlay).toBe(false);
  });

  it('does not mutate the input template', () => {
    const t = template();
    applyPageDecisionsToTemplate(t, new Map([['docling-page-1', decide(0.3, true).policy]]));
    expect((t.pages[0].meta as any)?.pdfImport).toBeUndefined();
  });

  it('attaches the available source raster before applying a raster-only policy', () => {
    const t = template();
    t.pages[1].background = { imageUrl: '' };
    const res = applyPageDecisionsToTemplate(
      t,
      new Map([['docling-page-2', decide(0.3, true).policy]]),
      new Map([['docling-page-2', 'data:image/png;base64,SOURCE']]),
    );

    expect(res.template.pages[1].background).toMatchObject({
      imageUrl: 'data:image/png;base64,SOURCE',
      opacity: 1,
      imageFit: 'fill',
      underlay: false,
    });
  });

  it('never persists a signed raster URL and stores its durable reference instead', () => {
    const t = template();
    t.pages[1].background = {};
    const sourceRasterRef = {
      kind: 'pdf_import_raster_ref' as const,
      jobId: 'job-1',
      manifestPath: 'job-1/manifest.json',
      pageNo: 2,
      path: 'job-1/pages/page-2.png',
      width: 1190,
      height: 1684,
      mime: 'image/png',
      dpi: 144,
    };
    const res = applyPageDecisionsToTemplate(
      t,
      new Map([['docling-page-2', decide(0.3, true).policy]]),
      new Map([['docling-page-2', 'https://example.test/storage/sign/page-2.png?token=secret']]),
      new Map([['docling-page-2', sourceRasterRef]]),
    );

    expect(res.template.pages[1].background?.imageUrl).toBeUndefined();
    expect((res.template.pages[1].meta as any).sourceRasterRef).toEqual(sourceRasterRef);
  });
});
