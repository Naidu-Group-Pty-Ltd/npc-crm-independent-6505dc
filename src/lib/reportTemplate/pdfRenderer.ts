/**
 * The Report Presentation Renderer — turns a `ReportTemplate` JSON and one
 * frozen presentation payload into a real PDF blob, in the browser, with
 * jsPDF.
 *
 * ## What this is, and what it is not
 *
 * A template here is a **presentation schema**: page sizes, blocks, overlays,
 * paint order, bindings, conditional pages. It is not a source of report
 * truth. Everything numeric or factual in the document has already been
 * generated, calculated, reconciled, validated and edited by the time
 * `options.data` is assembled — this renderer resolves bindings against that
 * payload and never reaches past it. It runs no calculation, resolves no
 * geography, calls no model and fetches nothing. One validated report,
 * several approved presentations.
 *
 * It is intentionally pure: same template + same data → byte-identical PDF.
 *
 * ## Why it is being restored rather than written
 *
 * This module was deleted in `9158dcf0` for having zero reachable callers —
 * the honest reason at the time, and not a judgement about the architecture.
 * Restoring it is cheaper and safer than writing a second template engine:
 * every module it composes (`parseTemplate`, `bindingResolver`, the block
 * registry, `paintOrder`, the PDF-import page policy, `renderVisibility`) is
 * still here, still shared with the HTML renderer beside it, and still the one
 * implementation of what it does.
 */
import { jsPDF } from 'jspdf';
import {
  type ReportTemplate,
  type Page,
  type Overlay,
  parseTemplate,
} from './templateSchema';
import {
  type ResolveContext,
  resolveBindable,
  resolveBindableNumber,
  resolveBindableColor,
  evalConditional,
} from './bindingResolver';
import { getBlockRenderer, type BlockRenderContext } from './blocks';
import { sortBlocksForPaint, sortOverlaysForPaint } from './paintOrder';
import { resolvePageOutputPolicy, resolvePageRenderPlan, shouldRenderPageBackgroundImage } from './rendering/pdfImportPagePolicy';
import { shouldRenderBlock, shouldRenderOverlay } from './renderVisibility';
import { applyNarrativePlan, planNarrative } from './narrativePlan';
import { layoutFlowColumn } from './flowLayout';
import { flowBlockContext, flowFactsFor } from './flowFacts';
import { pagesForDocument } from '../../../supabase/functions/_shared/reports/investment/tierPageSequence.pure';

export interface RenderOptions {
  /** The frozen presentation payload the template binds against. */
  data?: Record<string, any>;
  /** Override tokens on top of `template.tokens` (e.g. white-label brand). */
  tokenOverrides?: Partial<ReportTemplate['tokens']>;
}

/** Render a template to a Blob (PDF). */
export function renderTemplateToBlob(
  rawTemplate: ReportTemplate | unknown,
  options: RenderOptions = {},
): Blob {
  const template = parseTemplate(rawTemplate);
  const tokens = mergeTokens(template.tokens, options.tokenOverrides);
  // The same narrative pre-pass the HTML renderer makes, so both draw the
  // same buckets on the same pages. See `narrativePlan.ts`.
  const ctxSeed: ResolveContext = { data: options.data ?? {}, tokens };
  const ctxBase = applyNarrativePlan(ctxSeed, planNarrative(template, ctxSeed));

  // The same tier rule the HTML renderer applies, so the browser presentation
  // and the final document draw the same pages (`tierPageSequence.pure.ts`).
  const visiblePages = pagesForDocument(
    template.pages.filter((p) => evalConditional(p.conditional, ctxBase)),
    options.data as Parameters<typeof pagesForDocument>[1],
  );
  if (visiblePages.length === 0) {
    // Always produce a valid (blank) PDF
    const empty = new jsPDF({ unit: 'pt', format: 'a4' });
    return empty.output('blob');
  }

  const first = visiblePages[0];
  const doc = new jsPDF({
    unit: 'pt',
    format: [first.size.width, first.size.height],
    orientation: first.size.width > first.size.height ? 'landscape' : 'portrait',
  });

  /**
   * `tocContinues` travels with the page list because the contents block is
   * what reads it: a section that runs over two pages declares the second a
   * continuation, and `blocks/toc.ts` folds it into the first entry rather
   * than listing the same section twice. This renderer used to pass `id` and
   * `name` alone, so every continuation page arrived as `undefined` and the
   * filter kept it — a contents page listing 432 entries for the sections it
   * has. Six of the sixteen active templates declare the flag.
   */
  const allPages = visiblePages.map((p) => ({
    id: p.id,
    name: p.name,
    tocContinues: p.tocContinues === true,
  }));

  /**
   * Part numbers, counted over the pages that actually render — the same
   * arithmetic `htmlRenderer` does, for the same reason. A page opts in by
   * binding `{{partNumber}}` anywhere in its content; every such visible page
   * increments the counter, so a running head cannot keep counting pages a
   * conditional dropped. Eight of the sixteen active templates bind it, and
   * without this they resolved it to nothing at all.
   */
  let partCount = 0;
  const partNumbers = visiblePages.map((p) =>
    (JSON.stringify(p).includes('{{partNumber') ? ++partCount : partCount));

  visiblePages.forEach((page, idx) => {
    if (idx > 0) {
      doc.addPage([page.size.width, page.size.height]);
    }
    // Inject pageNumber/pageCount so blocks like page-number / footer can bind them.
    const pageCtx: ResolveContext & { _allPages?: typeof allPages; _slots?: Record<string, any> } = {
      ...ctxBase,
      data: {
        ...ctxBase.data,
        pageNumber: idx + 1,
        pageCount: visiblePages.length,
        partNumber: partNumbers[idx],
        partCount,
      },
    };
    (pageCtx as any)._allPages = allPages;
    (pageCtx as any)._slots = template.slots ?? {};
    drawPage(doc, page, pageCtx);
  });

  return doc.output('blob');
}

/** Render to a data URL (handy for <iframe src=...> previews). */
export function renderTemplateToDataUrl(
  rawTemplate: ReportTemplate | unknown,
  options: RenderOptions = {},
): string {
  const blob = renderTemplateToBlob(rawTemplate, options);
  return URL.createObjectURL(blob);
}

// ─── internals ────────────────────────────────────────────────────────────────

function mergeTokens(
  base: ReportTemplate['tokens'],
  overrides?: Partial<ReportTemplate['tokens']>,
): ReportTemplate['tokens'] {
  if (!overrides) return base;
  return {
    colors: { ...base.colors, ...(overrides.colors ?? {}) },
    fonts: { ...base.fonts, ...(overrides.fonts ?? {}) },
    spacing: { ...base.spacing, ...(overrides.spacing ?? {}) },
  };
}

function drawPage(doc: jsPDF, page: Page, ctxBase: ResolveContext) {
  const pdfPagePolicy = resolvePageOutputPolicy(page as unknown as Page);
  const pdfPageRenderPlan = resolvePageRenderPlan(pdfPagePolicy);

  // Background colour
  if (page.background?.color) {
    const hex = resolveBindableColor(page.background.color, ctxBase, '#FFFFFF');
    const { r, g, b } = hexToRgb(hex);
    doc.setFillColor(r, g, b);
    doc.rect(0, 0, page.size.width, page.size.height, 'F');
  }
  // Background image (preloaded to data URL by imagePreloader).
  // PDF-import reference underlays are editor-only alignment aids — printing
  // them would duplicate every element behind the reconstructed overlays.
  if (page.background?.imageUrl && shouldRenderPageBackgroundImage(page, pdfPageRenderPlan)) {
    const url = String(page.background.imageUrl);
    if (url.startsWith('data:') || url.startsWith('http')) {
      try {
        const fmt = url.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        doc.addImage(url, fmt, 0, 0, page.size.width, page.size.height);
      } catch (e) { console.warn('[pdfRenderer] page bg image failed', e); }
    }
  }

  const blockCtx: BlockRenderContext = {
    ...ctxBase,
    doc,
    page: { width: page.size.width, height: page.size.height },
    pages: (ctxBase as any)._allPages,
    slots: (ctxBase as any)._slots,
    _drawOverlay: (overlay, c) => drawOverlay(c.doc, overlay, c),
  };

  // C5: raster-only pages export the source raster as their final output and
  // must NOT also draw native blocks/overlays (no double render).
  const pdfRenderNativeBlocks = pdfPageRenderPlan.renderNativeBlocks;
  // Blocks
  if (pdfRenderNativeBlocks) {
    // A flowing page lands its column exactly where the HTML renderer lands it
    // — the narrative pre-pass sized the report body's first box from the same
    // placement, so drawing the declared positions here would set that box
    // lower than the room it was packed for. See `flowLayout.ts`.
    const laid = (page as { flow?: boolean }).flow === true
      ? layoutFlowColumn(page.blocks, flowFactsFor(
        ctxBase,
        flowBlockContext(ctxBase, page, (ctxBase as any)._allPages ?? [], (ctxBase as any)._slots ?? {}),
      ))
      : page.blocks;
    for (const block of sortBlocksForPaint(laid)) {
      // `hidden`, `conditional` and `visibility` all decide this, and the rule
      // is `renderVisibility`'s so the HTML document and the PDF of the same
      // template cannot contain different blocks.
      if (!shouldRenderBlock(block, ctxBase)) continue;
      const renderer = getBlockRenderer(block.type);
      if (renderer) {
        renderer(block, blockCtx);
      } else if (block.type !== 'free') {
        console.warn(`[pdfRenderer] No renderer for block type "${block.type}"`);
      }
      // Overlays sit on top of the block
      for (const overlay of sortOverlaysForPaint(block.overlays)) {
        if (!shouldRenderOverlay(overlay, ctxBase)) continue;
        drawOverlay(doc, overlay, ctxBase);
      }
    }
  }
}

function isTransparentColor(color: string | null | undefined): boolean {
  return !color || color.toLowerCase() === 'transparent';
}

function drawOverlay(doc: jsPDF, overlay: Overlay, ctx: ResolveContext) {
  switch (overlay.type) {
    case 'text': {
      const text = resolveBindable(overlay.content, ctx);
      if (!text) return;
      const size = resolveBindableNumber(overlay.fontSize, ctx, 12);
      const color = resolveBindableColor(overlay.color, ctx, '#000000');
      const family = resolveBindable(overlay.fontFamily, ctx) || 'helvetica';
      const { r, g, b } = hexToRgb(color);
      doc.setTextColor(r, g, b);
      doc.setFontSize(size);
      doc.setFont(mapFontFamily(family), overlay.fontWeight === 'bold' ? 'bold' : 'normal');
      const wrapped = doc.splitTextToSize(text, overlay.width);
      const align = overlay.align;
      const x =
        align === 'center' ? overlay.x + overlay.width / 2 :
        align === 'right'  ? overlay.x + overlay.width :
                             overlay.x;
      // Baseline-correct y
      doc.text(wrapped, x, overlay.y + size, {
        align,
        lineHeightFactor: overlay.lineHeight,
        maxWidth: overlay.width,
      });
      break;
    }
    case 'shape': {
      // jsPDF cannot paint CSS gradients — approximate with the first stop.
      const rawFill = typeof overlay.fill === 'string' && /(?:linear|radial|conic)-gradient\(/i.test(overlay.fill)
        ? (/(?:rgba?\([^)]*\)|#[0-9a-f]{3,8})/i.exec(overlay.fill)?.[0] ?? overlay.fill)
        : overlay.fill;
      const fill = rawFill ? resolveBindableColor(rawFill, ctx, 'transparent') : null;
      const stroke = overlay.stroke ? resolveBindableColor(overlay.stroke, ctx, 'transparent') : null;
      const hasFill = !isTransparentColor(fill);
      const hasStroke = !isTransparentColor(stroke) && (overlay.strokeWidth ?? 0) > 0;
      if (hasFill) {
        const { r, g, b } = hexToRgb(fill!);
        doc.setFillColor(r, g, b);
      }
      if (hasStroke) {
        const { r, g, b } = hexToRgb(stroke!);
        doc.setDrawColor(r, g, b);
        doc.setLineWidth(overlay.strokeWidth || 1);
      }
      const style = hasFill && hasStroke ? 'FD' : hasFill ? 'F' : hasStroke ? 'S' : null;
      if (!style) return;
      if (overlay.shape === 'ellipse') {
        doc.ellipse(
          overlay.x + overlay.width / 2,
          overlay.y + overlay.height / 2,
          overlay.width / 2,
          overlay.height / 2,
          style,
        );
      } else if (overlay.shape === 'line') {
        doc.line(overlay.x, overlay.y, overlay.x + overlay.width, overlay.y + overlay.height);
      } else {
        if (overlay.borderRadius && overlay.borderRadius > 0) {
          doc.roundedRect(overlay.x, overlay.y, overlay.width, overlay.height, overlay.borderRadius, overlay.borderRadius, style);
        } else {
          doc.rect(overlay.x, overlay.y, overlay.width, overlay.height, style);
        }
      }
      break;
    }
    case 'image': {
      const src = resolveBindable(overlay.src, ctx);
      if (!src) return;
      try {
        // jsPDF auto-detects format from data URL; for http URLs the caller must pre-load.
        // Best-effort: skip silently on failure.
        const fmt = src.startsWith('data:image/png') ? 'PNG' : 'JPEG';
        doc.addImage(src, fmt, overlay.x, overlay.y, overlay.width, overlay.height);
      } catch (e) {
        console.warn('[pdfRenderer] image overlay failed:', e);
      }
      break;
    }
  }
}

function mapFontFamily(family: string): string {
  const f = family.toLowerCase();
  if (f.includes('times')) return 'times';
  if (f.includes('courier') || f.includes('mono')) return 'courier';
  return 'helvetica';
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return { r: 0, g: 0, b: 0 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
