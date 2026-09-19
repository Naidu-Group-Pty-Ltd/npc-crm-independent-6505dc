/**
 * pdf-page-output-policy-v1 shared resolver (Path-to-100 v2 · C5.1).
 *
 * The single source of truth every renderer (HTML/WeasyPrint, jsPDF, PPTX,
 * QA capture) delegates to. These tests pin the four separated concepts —
 * finalMode / outputStrategy / sourceRasterRole / nativeLayerPolicy — plus
 * the legacy-normalization and render-plan contracts, so all renderers agree
 * by construction: a raster-only page never renders native content, and a
 * native page never double-renders a source raster in final output.
 */
import { describe, it, expect } from 'vitest';
import type { Page } from '../templateSchema';
import {
  PDF_PAGE_OUTPUT_POLICY_VERSION,
  nativePolicy,
  hybridFallbackPolicy,
  pixelFallbackPolicy,
  resolvePageOutputPolicy,
  resolvePageRenderPlan,
  applyPagePolicyToPage,
} from '../rendering/pdfImportPagePolicy';

function page(partial: Partial<Page>): Page {
  return {
    id: 'p1',
    name: 'P1',
    size: { width: 595, height: 842 },
    background: {},
    blocks: [],
    ...partial,
  } as unknown as Page;
}

describe('canonical policies', () => {
  it('nativePolicy(semantic) has native output and no source raster', () => {
    const p = nativePolicy('semantic');
    expect(p.version).toBe(PDF_PAGE_OUTPUT_POLICY_VERSION);
    expect(p.outputStrategy).toBe('native');
    expect(p.sourceRasterRole).toBe('none');
    expect(p.nativeLayerPolicy).toBe('editable');
  });

  it('nativePolicy(hybrid) keeps native output but an editor-reference raster', () => {
    const p = nativePolicy('hybrid');
    expect(p.outputStrategy).toBe('native');
    expect(p.sourceRasterRole).toBe('editor-reference');
  });

  it('hybridFallbackPolicy is raster-only with editable recovery layers', () => {
    const p = hybridFallbackPolicy();
    expect(p.finalMode).toBe('hybrid');
    expect(p.outputStrategy).toBe('raster-only');
    expect(p.sourceRasterRole).toBe('final-output');
    expect(p.nativeLayerPolicy).toBe('editable');
  });

  it('pixelFallbackPolicy is raster-only with locked recovery layers', () => {
    const p = pixelFallbackPolicy();
    expect(p.finalMode).toBe('pixel-perfect');
    expect(p.outputStrategy).toBe('raster-only');
    expect(p.sourceRasterRole).toBe('final-output');
    expect(p.nativeLayerPolicy).toBe('locked');
  });
});

describe('resolvePageOutputPolicy — typed policy is authoritative', () => {
  it('returns the typed meta.pdfImport policy verbatim when present', () => {
    const typed = pixelFallbackPolicy();
    const resolved = resolvePageOutputPolicy(
      page({ meta: { pdfImport: typed } as any, background: { imageUrl: 'x', underlay: true } as any }),
    );
    // Typed policy wins even though the legacy background says underlay:true.
    expect(resolved).toBe(typed);
    expect(resolved.outputStrategy).toBe('raster-only');
  });

  it('ignores a malformed typed policy and falls back to legacy signals', () => {
    const resolved = resolvePageOutputPolicy(
      page({ meta: { pdfImport: { version: 'wrong', outputStrategy: 'native' } } as any }),
    );
    expect(resolved.version).toBe(PDF_PAGE_OUTPUT_POLICY_VERSION);
    expect(resolved.outputStrategy).toBe('native');
  });
});

describe('resolvePageOutputPolicy — legacy normalization (in memory, non-mutating)', () => {
  it('underlay:true + image → hybrid native output with editor-reference raster', () => {
    const p = resolvePageOutputPolicy(
      page({ background: { imageUrl: 'https://x/p.png', underlay: true } as any }),
    );
    expect(p.finalMode).toBe('hybrid');
    expect(p.outputStrategy).toBe('native');
    expect(p.sourceRasterRole).toBe('editor-reference');
  });

  it('full opaque raster (not underlay) WITH a pdf-import sourceRasterRef → pixel raster-only', () => {
    const p = resolvePageOutputPolicy(
      page({
        background: { imageUrl: 'https://x/p.png' } as any,
        meta: { sourceRasterRef: { kind: 'pdf_import_raster_ref', jobId: 'j1' } } as any,
      }),
    );
    expect(p.outputStrategy).toBe('raster-only');
    expect(p.nativeLayerPolicy).toBe('locked');
  });

  it('a decorative background image (no sourceRasterRef, no underlay) is NOT raster-only', () => {
    const p = resolvePageOutputPolicy(
      page({ background: { imageUrl: 'https://x/logo.png' } as any }),
    );
    expect(p.outputStrategy).toBe('native');
    expect(p.sourceRasterRole).toBe('none');
  });

  it('a plain page with no background is semantic native output', () => {
    const p = resolvePageOutputPolicy(page({}));
    expect(p.finalMode).toBe('semantic');
    expect(p.outputStrategy).toBe('native');
  });

  it('tolerates null/undefined pages', () => {
    expect(resolvePageOutputPolicy(null).outputStrategy).toBe('native');
    expect(resolvePageOutputPolicy(undefined).outputStrategy).toBe('native');
  });
});

describe('resolvePageRenderPlan — final output shows exactly one visual copy', () => {
  it('raster-only: no native blocks, raster shown (final output)', () => {
    const plan = resolvePageRenderPlan(pixelFallbackPolicy());
    expect(plan.renderNativeBlocks).toBe(false);
    expect(plan.showSourceRaster).toBe(true);
  });

  it('raster-only + editor opt-in shows the reconstructed layers on top of the raster', () => {
    const plan = resolvePageRenderPlan(hybridFallbackPolicy(), { showReconstructedLayers: true });
    expect(plan.renderNativeBlocks).toBe(true);
    expect(plan.showSourceRaster).toBe(true);
  });

  it('native semantic: blocks render, no source raster', () => {
    const plan = resolvePageRenderPlan(nativePolicy('semantic'));
    expect(plan.renderNativeBlocks).toBe(true);
    expect(plan.showSourceRaster).toBe(false);
  });

  it('native hybrid: blocks render; editor-reference raster only with the editor opt-in', () => {
    expect(resolvePageRenderPlan(nativePolicy('hybrid')).showSourceRaster).toBe(false);
    const plan = resolvePageRenderPlan(nativePolicy('hybrid'), { showReferenceRaster: true });
    expect(plan.renderNativeBlocks).toBe(true);
    expect(plan.showSourceRaster).toBe(true);
  });
});

describe('applyPagePolicyToPage — writes typed policy + reconciles legacy flags', () => {
  it('is non-mutating and stamps meta.pdfImport', () => {
    const original = page({ background: { imageUrl: 'https://x/p.png', underlay: true } as any });
    const out = applyPagePolicyToPage(original, pixelFallbackPolicy());
    expect(out).not.toBe(original);
    expect((original.meta as any)?.pdfImport).toBeUndefined();
    expect((out.meta as any).pdfImport.outputStrategy).toBe('raster-only');
  });

  it('raster-only forces the raster to opaque final output (underlay off, opacity 1)', () => {
    const out = applyPagePolicyToPage(
      page({ background: { imageUrl: 'https://x/p.png', underlay: true, opacity: 0.5 } as any }),
      pixelFallbackPolicy(),
    );
    const bg = out.background as any;
    expect(bg.underlay).toBe(false);
    expect(bg.opacity).toBe(1);
    expect(bg.imageFit).toBe('fill');
  });

  it('hybrid editor-reference dims the raster to a 0.5 underlay behind native content', () => {
    const out = applyPagePolicyToPage(
      page({ background: { imageUrl: 'https://x/p.png' } as any }),
      nativePolicy('hybrid'),
    );
    const bg = out.background as any;
    expect(bg.underlay).toBe(true);
    expect(bg.opacity).toBe(0.5);
  });

  it('applied policy round-trips through resolvePageOutputPolicy to the same strategy', () => {
    const applied = applyPagePolicyToPage(page({ background: { imageUrl: 'https://x/p.png' } as any }), hybridFallbackPolicy());
    expect(resolvePageOutputPolicy(applied).outputStrategy).toBe('raster-only');
  });
});
