/**
 * The invariant this module was written to hold, finally asserted.
 *
 * `pdfImportPagePolicy.ts` opens by calling itself "the single source of truth
 * for 'does this page render its source raster or its native blocks in the
 * final output' — so a full raster and duplicate native content can never
 * render together". Nothing checked it, and it was false.
 *
 * ## What it cost
 *
 * A 61-page Investment Compass template, imported from a PDF, was the global
 * default for `tier: compass` for two months. Every page carried a full-page
 * raster from `template-import-assets` and a `free` block of absolutely
 * positioned text overlays reconstructed from the same PDF — and **no policy
 * metadata at all**, because the import that wrote it never called
 * `applyPagePolicyToPage`.
 *
 * So `resolvePageOutputPolicy` saw no `meta.pdfImport`, no `meta.sourceRasterRef`
 * and no `background.underlay`, and returned `nativePolicy('semantic')`:
 * render the blocks, show no raster. Then `shouldRenderPageBackgroundImage`
 * asked its own, *different* question — is this an import background? — got
 * "no" from the same three absent markers, and painted the raster anyway.
 *
 * Two functions, two answers, both layers on the page. Delivered PDFs carried
 * two misaligned copies of every word on all 61 pages. The raster underneath
 * was a correct, handsome render; the overprint was set in fallback Liberation
 * Sans because the reconstruction asks for `Helvetica, Arial, sans-serif`.
 *
 * The fix shares one predicate between the two functions and adds the asset
 * bucket as a fourth signal. These tests pin both halves.
 */
import { describe, expect, it } from 'vitest';
import type { Page } from '../templateSchema';
import { renderTemplateToHtml } from '../htmlRenderer';
import {
  PDF_IMPORT_ASSET_BUCKET,
  hybridFallbackPolicy,
  isPdfImportSourceRaster,
  nativePolicy,
  pixelFallbackPolicy,
  resolvePageOutputPolicy,
  resolvePageRenderPlan,
  shouldFallBackToNativeBlocks,
  shouldRenderPageBackgroundImage,
} from '../rendering/pdfImportPagePolicy';

const RASTER = `https://x.supabase.co/storage/v1/object/public/${PDF_IMPORT_ASSET_BUCKET}/69225031/page-1-0.jpg`;
const DECORATIVE = 'https://x.supabase.co/storage/v1/object/public/report-assets/hero-cover.jpg';

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

/**
 * The exact shape of a page from the template that shipped the defect, read
 * out of `report_templates.schema` rather than imagined: an import-bucket
 * raster, `meta: null`, no fit, no opacity, no underlay flag, and one `free`
 * block whose overlays are literal strings at absolute coordinates.
 */
const UNMARKED_IMPORT_PAGE = page({
  meta: null as never,
  background: { imageUrl: RASTER } as never,
  blocks: [{
    id: 'b1',
    type: 'free',
    props: {},
    overlays: [
      { id: 'o1', type: 'text', content: 'Lot 60941 Cloverton,', x: 51, y: 605, width: 323, height: 40, color: '#111111', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 34 },
    ],
  }] as never,
});

describe('the invariant: a raster and native blocks never both paint', () => {
  /**
   * The sweep: every page shape this system can produce. In final output a
   * source raster and native blocks must never both paint.
   *
   * Two scoping decisions that matter.
   *
   * `sourceRaster` is a fact about the *fixture* — whether the background is a
   * picture of this page's own content — not something read back out of the
   * code under test. Scoping the invariant by `isPdfImportSourceRaster()`
   * would make it vacuous: that predicate is exactly what the fix changed, so
   * on the broken code it would have excluded the one page that was broken.
   *
   * And the editor is exempt on purpose. `showReconstructedLayers` exists so a
   * person can see the overlays *over* the raster they were reconstructed
   * from; that is the alignment aid, and it is not what a client receives.
   */
  const SHAPES: Array<{ name: string; page: Page; sourceRaster: boolean }> = [
    { name: 'unmarked import raster (the shipped defect)', page: UNMARKED_IMPORT_PAGE, sourceRaster: true },
    { name: 'import raster marked raster-only', page: page({ meta: { pdfImport: pixelFallbackPolicy() } as never, background: { imageUrl: RASTER } as never }), sourceRaster: true },
    { name: 'import raster marked hybrid fallback', page: page({ meta: { pdfImport: hybridFallbackPolicy() } as never, background: { imageUrl: RASTER } as never }), sourceRaster: true },
    { name: 'import raster as editor underlay', page: page({ background: { imageUrl: RASTER, underlay: true, opacity: 0.5 } as never }), sourceRaster: true },
    { name: 'import raster via sourceRasterRef', page: page({ meta: { sourceRasterRef: 'ref-1' } as never, background: { imageUrl: RASTER } as never }), sourceRaster: true },
    { name: 'native page, marked', page: page({ meta: { pdfImport: nativePolicy('semantic') } as never, background: {} as never }), sourceRaster: false },
    // A hero cover legitimately paints an image *and* sets type over it. The
    // invariant is about a raster of the page's own content, not about any
    // background image, and widening it would forbid a normal cover.
    { name: 'decorative background, no blocks', page: page({ background: { imageUrl: DECORATIVE } as never }), sourceRaster: false },
    { name: 'decorative background under blocks', page: page({ background: { imageUrl: DECORATIVE } as never, blocks: [{ id: 'b', type: 'text', props: {} }] as never }), sourceRaster: false },
    { name: 'no background at all', page: page({}), sourceRaster: false },
  ];

  for (const { name, page: subject, sourceRaster } of SHAPES.filter((s) => s.sourceRaster)) {
    it(`holds in final output — ${name}`, () => {
      expect(sourceRaster).toBe(true);
      const policy = resolvePageOutputPolicy(subject);
      const plan = resolvePageRenderPlan(policy); // final: no editor opt-ins
      // Modelled on the real call site, `htmlRenderer.ts:483`:
      //
      //   if (page.background?.imageUrl && shouldRenderPageBackgroundImage(page, plan))
      //
      // The renderer does NOT consult `plan.showSourceRaster` itself — it
      // delegates the whole question to the guard. Writing this assertion as
      // `plan.showSourceRaster && shouldRender…` instead would have made it
      // pass against the broken code, because the plan said "no raster" while
      // the guard painted one anyway. That disagreement *is* the bug, and a
      // test that consults both cannot see it.
      const rasterPaints = Boolean((subject.background as { imageUrl?: string } | undefined)?.imageUrl)
        && shouldRenderPageBackgroundImage(subject, plan);
      expect(
        rasterPaints && plan.renderNativeBlocks,
        `${name}: raster and native blocks both paint`,
      ).toBe(false);
    });
  }

  it('leaves a decorative background painting under its blocks, as a cover must', () => {
    const cover = page({
      background: { imageUrl: DECORATIVE } as never,
      blocks: [{ id: 'b', type: 'text', props: {} }] as never,
    });
    const plan = resolvePageRenderPlan(resolvePageOutputPolicy(cover));
    expect(shouldRenderPageBackgroundImage(cover, plan)).toBe(true);
    expect(plan.renderNativeBlocks).toBe(true);
  });
});

describe('the page that shipped the defect', () => {
  it('is recognised as a source raster despite carrying no policy metadata', () => {
    expect(isPdfImportSourceRaster(UNMARKED_IMPORT_PAGE)).toBe(true);
  });

  it('classifies raster-only, so the reconstruction no longer overprints it', () => {
    const policy = resolvePageOutputPolicy(UNMARKED_IMPORT_PAGE);
    expect(policy.outputStrategy).toBe('raster-only');
    expect(policy.sourceRasterRole).toBe('final-output');

    const plan = resolvePageRenderPlan(policy);
    expect(plan.showSourceRaster).toBe(true);
    expect(plan.renderNativeBlocks).toBe(false);
    expect(shouldRenderPageBackgroundImage(UNMARKED_IMPORT_PAGE, plan)).toBe(true);
  });

  it('still shows both layers when the editor asks, which is what the opt-in is for', () => {
    const policy = resolvePageOutputPolicy(UNMARKED_IMPORT_PAGE);
    const plan = resolvePageRenderPlan(policy, { showReconstructedLayers: true });
    expect(plan.renderNativeBlocks).toBe(true);
    expect(plan.showSourceRaster).toBe(true);
  });
});

describe('the renderer, at the seam where it actually went wrong', () => {
  /**
   * The policy tests above pin the decision. This pins the *consequence*, at
   * `htmlRenderer.ts:483` — the one call site — because that is where the two
   * layers were emitted into the same page box.
   */
  const template = {
    version: 1,
    tokens: {},
    pages: [{
      id: 'p1',
      name: 'Contents',
      size: { width: 595, height: 842 },
      background: { imageUrl: RASTER },
      blocks: [{
        id: 'b1',
        type: 'free',
        props: {},
        overlays: [{
          id: 'o1', type: 'text', content: 'Lot 60941 Cloverton,',
          x: 51, y: 605, width: 323, height: 40,
          color: '#111111', fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 34,
        }],
      }],
    }],
  };

  it('emits the raster and NOT the reconstructed text', () => {
    const { html } = renderTemplateToHtml(template, {});
    expect(html, 'the source raster should still be the page').toContain(PDF_IMPORT_ASSET_BUCKET);
    expect(html, 'the reconstruction must not overprint it').not.toContain('Lot 60941 Cloverton,');
  });
});

describe('the other way to ship a broken page: rendering nothing at all', () => {
  /**
   * The invariant above says a raster-only page must not ALSO paint its native
   * blocks. Its shadow is that such a page paints nothing when the raster is
   * missing — and the raster is not stored on the template. `page.background
   * .imageUrl` is stripped at save; the URL is signed at render time from
   * `meta.sourceRasterRef`. So any export whose signing step fails, or which
   * never ran it, hands the client a blank sheet where the content was.
   *
   * The reconstruction is still sitting in the page's blocks. Rendering it is
   * strictly better than rendering nothing, and it cannot double-render:
   * this only fires when the raster did not paint.
   */
  const RASTER_ONLY_UNSIGNED = {
    version: 1,
    tokens: {},
    pages: [{
      id: 'p2',
      name: 'Capacity at a glance',
      size: { width: 595, height: 842 },
      // Exactly what a stored raster-only page looks like: policy + ref, and
      // NO imageUrl (stripTransientRasterUrls removed it at save). The ref is
      // copied verbatim from `report_templates.schema` for the import that
      // reproduced the outage, so the fixture cannot drift from the shape the
      // schema actually accepts.
      meta: {
        pdfImport: pixelFallbackPolicy(),
        sourceRasterRef: {
          kind: 'pdf_import_raster_ref',
          jobId: '60341c12-0db2-41fd-9106-9d1eea1ea5cb',
          manifestPath: '60341c12-0db2-41fd-9106-9d1eea1ea5cb/rasters-manifest.json',
          pageNo: 2,
          path: '60341c12-0db2-41fd-9106-9d1eea1ea5cb/pages/page-002.png',
          width: 2479,
          height: 3508,
          mime: 'image/png',
          dpi: 300,
        },
      },
      background: { color: '#FFFFFF' },
      blocks: [{
        id: 'b1',
        type: 'free',
        props: {},
        overlays: [{
          id: 'o1', type: 'text', content: 'Borrowing capacity $856,932',
          x: 51, y: 120, width: 400, height: 40, color: '#111111', fontSize: 18,
        }],
      }],
    }],
  };

  it('renders the reconstruction when the source raster never resolved', () => {
    const { html } = renderTemplateToHtml(RASTER_ONLY_UNSIGNED as never, {});
    expect(html, 'a page with no raster must not come out empty')
      .toContain('Borrowing capacity $856,932');
  });

  it('still suppresses the reconstruction once the raster IS resolved', () => {
    const signed = JSON.parse(JSON.stringify(RASTER_ONLY_UNSIGNED));
    signed.pages[0].background.imageUrl = RASTER;
    const { html } = renderTemplateToHtml(signed, {});
    expect(html, 'the raster is the page').toContain(PDF_IMPORT_ASSET_BUCKET);
    expect(html, 'and must not be overprinted').not.toContain('Borrowing capacity $856,932');
  });

  it('the rule itself: fall back only when blocks are suppressed AND no raster painted', () => {
    expect(shouldFallBackToNativeBlocks({ renderNativeBlocks: false }, false)).toBe(true);
    expect(shouldFallBackToNativeBlocks({ renderNativeBlocks: false }, true)).toBe(false);
    // A native page never needs the fallback — it already renders its blocks.
    expect(shouldFallBackToNativeBlocks({ renderNativeBlocks: true }, false)).toBe(false);
    expect(shouldFallBackToNativeBlocks({ renderNativeBlocks: true }, true)).toBe(false);
  });
});

describe('decorative backgrounds are untouched', () => {
  it('a hero image is not a source raster', () => {
    const hero = page({ background: { imageUrl: DECORATIVE } as never });
    expect(isPdfImportSourceRaster(hero)).toBe(false);
    expect(resolvePageOutputPolicy(hero).outputStrategy).toBe('native');
  });

  it('paints regardless of the plan, exactly as it always did', () => {
    // The historical contract: a decorative background is not the plan's
    // business. Widening the source-raster predicate must not quietly turn a
    // cover photograph into something a render plan can suppress.
    const hero = page({ background: { imageUrl: DECORATIVE } as never });
    expect(shouldRenderPageBackgroundImage(hero, { showSourceRaster: false })).toBe(true);
  });

  it('is decided by the bucket, not by the presence of an image', () => {
    // The bucket is the whole signal: `template-import-pdf` writes page
    // rasters there and nothing else does.
    const sameFileElsewhere = page({
      background: { imageUrl: DECORATIVE.replace('report-assets', 'brand-assets') } as never,
    });
    expect(isPdfImportSourceRaster(sameFileElsewhere)).toBe(false);
  });
});
