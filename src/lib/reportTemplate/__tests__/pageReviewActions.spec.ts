/**
 * Per-page review actions (Path-to-100 v2 · C7).
 *
 * Pins the operator action policy (availability / confirm / disabled reasons)
 * and the single-page mutation guarantee: applying a per-page decision changes
 * ONLY the target page (every other page keeps its identity) and writes a C5/C6
 * policy the renderer honours — so a per-page change is auditable and scoped.
 */
import { describe, it, expect } from 'vitest';
import {
  describePageActions,
  applyPageReviewAction,
  isPolicyAction,
  PAGE_REVIEW_ACTION_VERSION,
  type PageReviewAction,
} from '../ingestion/visualQuality/pageReviewActions';
import type { ReportTemplate } from '../templateSchema';

function template(): ReportTemplate {
  return {
    version: 1,
    tokens: { colors: {}, fonts: {}, spacing: {} },
    pages: [
      { id: 'p1', name: 'P1', size: { width: 595, height: 842 }, background: { imageUrl: 'r1' }, blocks: [] },
      { id: 'p2', name: 'P2', size: { width: 595, height: 842 }, background: { imageUrl: 'r2' }, blocks: [] },
    ],
  } as unknown as ReportTemplate;
}

function actionMap(descriptors: ReturnType<typeof describePageActions>) {
  return new Map(descriptors.map((d) => [d.action, d]));
}

describe('describePageActions', () => {
  it('exposes the contract version', () => {
    expect(PAGE_REVIEW_ACTION_VERSION).toBe('visual-quality-page-action-v1');
  });

  it('offers accept / open-editor unconditionally', () => {
    const m = actionMap(describePageActions({ hasSourceRaster: false, outputStrategy: 'native', score: 0.9 }));
    expect(m.get('accept')?.available).toBe(true);
    expect(m.get('open_editor')?.available).toBe(true);
  });

  it('disables raster fallbacks with a reason when there is no source raster', () => {
    const m = actionMap(describePageActions({ hasSourceRaster: false, outputStrategy: 'native', score: 0.4 }));
    expect(m.get('force_hybrid')?.available).toBe(false);
    expect(m.get('force_pixel')?.available).toBe(false);
    expect(m.get('repair')?.available).toBe(false);
    expect(m.get('force_pixel')?.disabledReason).toMatch(/no source raster/i);
  });

  it('enables raster fallbacks when a source raster exists; force-pixel needs confirmation', () => {
    const m = actionMap(describePageActions({ hasSourceRaster: true, outputStrategy: 'native', score: 0.4 }));
    expect(m.get('force_hybrid')?.available).toBe(true);
    expect(m.get('force_pixel')?.available).toBe(true);
    expect(m.get('force_pixel')?.requiresConfirm).toBe(true);
    expect(m.get('force_hybrid')?.requiresConfirm).toBe(false);
  });

  it('offers promote-to-native only for a raster-only page', () => {
    const raster = actionMap(describePageActions({ hasSourceRaster: true, outputStrategy: 'raster-only', score: 0.4 }));
    expect(raster.get('promote_native')?.available).toBe(true);
    expect(raster.get('promote_native')?.requiresConfirm).toBe(true);
    const native = actionMap(describePageActions({ hasSourceRaster: true, outputStrategy: 'native', score: 0.9 }));
    expect(native.get('promote_native')?.available).toBe(false);
  });

  it('keeps AI repair unavailable until it is explicitly enabled (post-C9)', () => {
    const off = actionMap(describePageActions({ hasSourceRaster: true, outputStrategy: 'native', score: 0.4 }));
    expect(off.get('ai_repair')?.available).toBe(false);
    expect(off.get('ai_repair')?.disabledReason).toMatch(/C9/);
    const on = actionMap(describePageActions({ hasSourceRaster: true, outputStrategy: 'native', score: 0.4, aiRepairEnabled: true }));
    expect(on.get('ai_repair')?.available).toBe(true);
    expect(on.get('ai_repair')?.requiresConfirm).toBe(true);
  });
});

describe('isPolicyAction', () => {
  it('classifies only force/promote as policy-writing actions', () => {
    (['force_hybrid', 'force_pixel', 'promote_native'] as PageReviewAction[]).forEach((a) =>
      expect(isPolicyAction(a)).toBe(true),
    );
    (['accept', 'repair', 'ai_repair', 'open_editor'] as PageReviewAction[]).forEach((a) =>
      expect(isPolicyAction(a)).toBe(false),
    );
  });
});

describe('applyPageReviewAction — single-page mutation', () => {
  it('force_pixel makes only the target page raster-only and keeps other pages identical', () => {
    const t = template();
    const res = applyPageReviewAction(t, 'p1', 'force_pixel', { score: 0.3, decidedAt: 'T' });
    expect(res.changed).toBe(true);
    expect(res.template).not.toBe(t);
    // Target page changed to raster-only with a locked native layer.
    expect((res.template.pages[0].meta as any).pdfImport.outputStrategy).toBe('raster-only');
    expect((res.template.pages[0].meta as any).pdfImport.nativeLayerPolicy).toBe('locked');
    // Decision is stamped as an operator action.
    expect((res.template.pages[0].meta as any).pdfImport.decision).toMatchObject({
      action: 'operator_force_pixel',
      decidedBy: 'operator',
      score: 0.3,
      decidedAt: 'T',
    });
    // Every OTHER page keeps object identity — the change stays per-page.
    expect(res.template.pages[1]).toBe(t.pages[1]);
  });

  it('force_hybrid writes a raster-only editable hybrid policy to the target page', () => {
    const res = applyPageReviewAction(template(), 'p2', 'force_hybrid');
    const policy = (res.template.pages[1].meta as any).pdfImport;
    expect(policy.finalMode).toBe('hybrid');
    expect(policy.outputStrategy).toBe('raster-only');
    expect(policy.nativeLayerPolicy).toBe('editable');
  });

  it('promote_native writes a native policy in the requested native mode', () => {
    const res = applyPageReviewAction(template(), 'p1', 'promote_native', { nativeMode: 'hybrid' });
    const policy = (res.template.pages[0].meta as any).pdfImport;
    expect(policy.outputStrategy).toBe('native');
    expect(policy.finalMode).toBe('hybrid');
  });

  it('non-policy actions never mutate the template', () => {
    const t = template();
    for (const action of ['accept', 'repair', 'ai_repair', 'ai_critique', 'open_editor'] as PageReviewAction[]) {
      const res = applyPageReviewAction(t, 'p1', action);
      expect(res.changed).toBe(false);
      expect(res.template).toBe(t);
    }
  });

  it('reports page_not_found for an unknown page id without mutating', () => {
    const t = template();
    const res = applyPageReviewAction(t, 'missing', 'force_pixel');
    expect(res.changed).toBe(false);
    expect(res.template).toBe(t);
    expect(res.skippedReason).toBe('page_not_found');
  });

  it('does not mutate the input template', () => {
    const t = template();
    applyPageReviewAction(t, 'p1', 'force_pixel');
    expect((t.pages[0].meta as any)?.pdfImport).toBeUndefined();
  });
});

describe('the visual critique action', () => {
  const base = { hasSourceRaster: true, outputStrategy: null, score: 0.6 } as const;
  const critique = (ctx: Record<string, unknown> = {}) =>
    describePageActions({ ...base, ...ctx } as never).find((d) => d.action === 'ai_critique')!;

  it('is offered only when the operator has enabled it', () => {
    expect(critique({ aiCritiqueEnabled: true }).available).toBe(true);
    expect(critique().available).toBe(false);
    expect(critique().disabledReason).toContain('operator-only');
  });

  it('needs both rasters, because it compares two images', () => {
    expect(critique({ aiCritiqueEnabled: true, hasSourceRaster: false }).available).toBe(false);
    expect(critique({ aiCritiqueEnabled: true, hasRenderedRaster: false }).available).toBe(false);
    expect(critique({ aiCritiqueEnabled: true, hasRenderedRaster: false }).disabledReason)
      .toContain('rendered page');
  });

  it('needs no confirmation, because nothing on its path can write', () => {
    // The repair action confirms because it changes the document. A critique
    // returns findings and cannot, so a confirmation step would be theatre.
    expect(critique({ aiCritiqueEnabled: true }).requiresConfirm).toBe(false);
  });

  it('is independent of the AI-repair gate', () => {
    expect(critique({ aiCritiqueEnabled: true, aiRepairEnabled: false }).available).toBe(true);
    const repair = describePageActions({ ...base, aiCritiqueEnabled: true } as never)
      .find((d) => d.action === 'ai_repair')!;
    expect(repair.available).toBe(false);
  });
});
