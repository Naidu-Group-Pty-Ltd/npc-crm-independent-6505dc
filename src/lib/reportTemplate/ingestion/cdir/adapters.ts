import type { DomBoxTree } from '../../codeGrounding';
import { groundDomBoxTree, harvestTokensFromBoxTree } from '../../codeGrounding';
import type { GroundedReference } from '../../imageGrounding';
import { toRendererHex } from '../../cssColor';
import type { Block, Overlay, Page, ReportTemplate } from '../../templateSchema';
import type { CdirDocument, CdirLayer, CdirPage, CdirSourceKind } from './schema';
import { parseCdirDocument } from './validate';
import { DEFAULT_IMPORT_FONT_STACK } from '../../rendering/fontNormalization';
import { resolveTokenLiteral } from '../../pdfImport/designSystemBinding.pure';

/** The slice of a template's tokens a CDIR conversion resolves against. */
type TemplateTokens = ReportTemplate['tokens'];

/** Parse a computed CSS box-shadow (colour-first form) into the CDIR shape shadow. */

export function parseBoxShadow(raw: string | undefined, scale = 1): { x: number; y: number; blur: number; spread: number; color: string } | undefined {
  const s = String(raw ?? '').trim();
  if (!s || s === 'none') return undefined;
  // Computed style emits: "rgba(10, 37, 64, 0.18) 0px 8px 32px 0px" (first shadow only).
  const m = /^(rgba?\([^)]*\)|#[0-9a-f]{3,8})\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?(?:\s+(-?[\d.]+)px)?/i.exec(s);
  if (!m) return undefined;
  const r2 = (n: number) => Math.round(n * scale * 100) / 100;
  return {
    color: m[1],
    x: r2(Number(m[2]) || 0),
    y: r2(Number(m[3]) || 0),
    blur: Math.max(0, r2(Number(m[4]) || 0)),
    spread: r2(Number(m[5]) || 0),
  };
}

interface AdapterSourceMeta {
  kind: CdirSourceKind;
  checksum: string;
  filename?: string;
  originalWidth?: number;
  originalHeight?: number;
}

export interface DomBoxTreePage {
  id?: string;
  label?: string;
  route?: string;
  tree: DomBoxTree;
}

const DEFAULT_CHECKSUM = 'unverified-local-source';
const round = (n: number) => Math.round(n * 100) / 100;

export function groundedReferenceToCdir(
  ref: GroundedReference,
  source: Partial<AdapterSourceMeta> = {},
): CdirDocument {
  const page: CdirPage = {
    id: 'page_1',
    label: 'Imported Page 1',
    width: ref.pageWidth,
    height: ref.pageHeight,
    layers: ref.elements.map((el, index) => ({
      id: el.id || `text_${index + 1}`,
      kind: 'text',
      name: `OCR text ${index + 1}`,
      text: el.text,
      bounds: { x: el.x, y: el.y, width: Math.max(1, el.width), height: Math.max(1, el.height) },
      fontSize: el.fontSize,
      // Measured style ground truth when grounding supplied it (DOM box trees,
      // raster ink sampling); near-black only as the last resort.
      color: el.color ?? '#000000',
      ...(el.fontFamily ? { fontFamily: el.fontFamily } : {}),
      ...(el.fontWeight != null ? { fontWeight: el.fontWeight } : {}),
      ...(el.italic ? { fontStyle: 'italic' as const } : {}),
      confidence: 0.75,
      provenance: { extractor: 'grounded-reference' },
    })),
  };
  return parseCdirDocument({
    version: 1,
    source: {
      kind: source.kind ?? 'image',
      checksum: source.checksum ?? DEFAULT_CHECKSUM,
      filename: source.filename,
      originalWidth: source.originalWidth ?? ref.imageWidth,
      originalHeight: source.originalHeight ?? ref.imageHeight,
    },
    pages: [page],
    assets: [],
    fonts: [],
    warnings: [],
  });
}

export function domBoxTreeToCdir(
  tree: DomBoxTree,
  source: Partial<AdapterSourceMeta> = {},
): CdirDocument {
  const grounded = groundDomBoxTree(tree);
  const tokens = harvestTokensFromBoxTree(tree);
  const textBoxesInGroundedOrder = (tree.textBoxes ?? [])
    .filter((box) => box && typeof box.text === 'string' && box.text.trim().length > 0 && box.width > 0 && box.height > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const doc = groundedReferenceToCdir(grounded, {
    kind: source.kind ?? 'html',
    checksum: source.checksum ?? DEFAULT_CHECKSUM,
    filename: source.filename,
    originalWidth: source.originalWidth ?? tree.pageWidthPx,
    originalHeight: source.originalHeight ?? tree.pageHeightPx,
  });
  const scaleX = doc.pages[0].width / Math.max(1, tree.pageWidthPx);
  const scaleY = doc.pages[0].height / Math.max(1, tree.pageHeightPx);
  const imageLayers: CdirLayer[] = (tree.imageBoxes ?? []).map((img, index) => ({
    id: `dom_image_${index + 1}`,
    kind: 'image',
    name: `DOM image ${index + 1}`,
    src: img.src,
    bounds: {
      x: round(img.x * scaleX),
      y: round(img.y * scaleY),
      width: Math.max(1, round(img.width * scaleX)),
      height: Math.max(1, round(img.height * scaleY)),
    },
    fit: 'cover',
    confidence: 0.9,
    provenance: { extractor: 'dom-box-tree' },
  }));
  // Painted element boxes → editable shape layers BENEATH text/images. These
  // carry the source's section fills, cards, buttons, and borders — without
  // them the editable result is text-on-white and the reference colours only
  // survive inside the (non-exporting) trace raster.
  const pageArea = doc.pages[0].width * doc.pages[0].height;
  const shapeLayers: CdirLayer[] = (tree.shapeBoxes ?? [])
    .filter((s) => s && s.width > 0 && s.height > 0 && (s.backgroundColor || s.borderColor || s.gradient))
    .slice(0, 400)
    .map((s, index) => {
      const bounds = {
        x: round(s.x * scaleX),
        y: round(s.y * scaleY),
        width: Math.max(1, round(s.width * scaleX)),
        height: Math.max(1, round(s.height * scaleY)),
      };
      const isFullBleed = bounds.width * bounds.height >= pageArea * 0.92;
      // Gradient backgrounds pass through as raw CSS (the renderer emits them
      // verbatim); flat colours normalise to 8-digit hex so rgba() ALPHA
      // survives the renderer's colour normaliser (glass panels stayed opaque).
      const fill = s.gradient ?? (s.backgroundColor ? toRendererHex(s.backgroundColor) : undefined);
      return {
        id: `dom_shape_${index + 1}`,
        kind: 'shape' as const,
        name: isFullBleed ? 'Page background fill' : `Section fill ${index + 1}`,
        shape: 'rect' as const,
        fill,
        stroke: s.borderColor ? toRendererHex(s.borderColor) : undefined,
        strokeWidth: s.borderWidthPx != null ? round(s.borderWidthPx * scaleX) : undefined,
        borderRadius: s.borderRadiusPx ? round(s.borderRadiusPx * scaleX) : undefined,
        ...(s.blurPx ? { blur: Math.max(0, Math.min(48, round(s.blurPx * scaleX))) } : {}),
        ...(s.boxShadow ? (() => { const shadow = parseBoxShadow(s.boxShadow, scaleX); return shadow ? { shadow } : {}; })() : {}),
        ...(s.opacity != null && s.opacity < 1 ? { opacity: s.opacity } : {}),
        bounds,
        zIndex: -100_000 + (s.domOrder ?? index),
        confidence: 0.9,
        provenance: { extractor: 'dom-box-tree' },
      };
    });
  return parseCdirDocument({
    ...doc,
    pages: [{
      ...doc.pages[0],
      // toRendererHex drops fully-transparent body backgrounds (the renderer's
      // normaliser would have collapsed `rgba(0,0,0,0)` to opaque BLACK).
      background: (() => { const bg = toRendererHex(tree.background); return bg ? { color: bg } : undefined; })(),
      layers: [...shapeLayers, ...doc.pages[0].layers.map((layer, index) => {
        if (layer.kind !== 'text') return layer;
        const sourceBox = textBoxesInGroundedOrder[index];
        const lineHeight = sourceBox?.lineHeightPx && sourceBox.fontSizePx
          ? Math.max(0.9, Math.min(3, Math.round((sourceBox.lineHeightPx / sourceBox.fontSizePx) * 100) / 100))
          : undefined;
        return {
          ...layer,
          fontFamily: sourceBox?.fontFamily,
          fontWeight: sourceBox?.fontWeight,
          fontStyle: sourceBox?.italic ? 'italic' : 'normal',
          color: (sourceBox?.color ? toRendererHex(sourceBox.color) : undefined) ?? layer.color,
          ...(sourceBox?.textAlign ? { align: sourceBox.textAlign } : {}),
          ...(sourceBox?.letterSpacingPx != null ? { letterSpacing: round(sourceBox.letterSpacingPx * scaleX) } : {}),
          ...(lineHeight ? { lineHeight } : {}),
          ...(sourceBox?.opacity != null && sourceBox.opacity < 1 ? { opacity: sourceBox.opacity } : {}),
          confidence: 0.95,
          provenance: { extractor: 'dom-box-tree' },
        };
      }), ...imageLayers],
    }],
    fonts: tokens.fonts.map((family) => ({ family })),
    meta: { palette: tokens.colors },
  });
}


function safeCdirId(value: string | undefined, fallback: string): string {
  const safe = String(value || fallback).trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return safe || fallback;
}

function prefixLayerIds(layer: CdirLayer, prefix: string, sourcePage: number): CdirLayer {
  const next = {
    ...layer,
    id: `${prefix}_${layer.id}`,
    provenance: { ...(layer.provenance ?? {}), sourcePage },
  } as CdirLayer;
  if (next.kind === 'group') {
    return { ...next, children: next.children.map((child) => prefixLayerIds(child, prefix, sourcePage)) };
  }
  return next;
}

/**
 * Multi-page DOM/code render → CDIR.
 *
 * `render-source` can return a full project archive as multiple rendered routes
 * or pages. This adapter preserves each rendered page as its own editable CDIR
 * page instead of forcing callers to paste/reconstruct one screen at a time.
 */
export function domBoxTreesToCdir(
  pages: DomBoxTreePage[],
  source: Partial<AdapterSourceMeta> = {},
): CdirDocument {
  const validPages = pages.filter((page) => page?.tree);
  if (!validPages.length) {
    throw new Error('At least one DOM box tree page is required to build CDIR.');
  }

  const pageDocs = validPages.map((page, index) => domBoxTreeToCdir(page.tree, {
    ...source,
    kind: source.kind ?? 'html',
    originalWidth: index === 0 ? source.originalWidth ?? page.tree.pageWidthPx : page.tree.pageWidthPx,
    originalHeight: index === 0 ? source.originalHeight ?? page.tree.pageHeightPx : page.tree.pageHeightPx,
  }));
  const cdirPages = pageDocs.map((doc, index) => {
    const sourcePage = doc.pages[0];
    const id = safeCdirId(validPages[index].id ?? validPages[index].route, `page_${index + 1}`);
    return {
      ...sourcePage,
      id,
      label: validPages[index].label ?? validPages[index].route ?? `Imported Page ${index + 1}`,
      layers: sourcePage.layers.map((layer) => prefixLayerIds(layer, id, index)),
      meta: { ...(sourcePage.meta ?? {}), route: validPages[index].route },
    };
  });

  const fonts = Array.from(new Map(pageDocs.flatMap((doc) => doc.fonts).map((font) => [font.family, font])).values());
  const palettes = pageDocs.flatMap((doc) => Array.isArray((doc.meta as any)?.palette) ? (doc.meta as any).palette : []);

  return parseCdirDocument({
    version: 1,
    source: {
      kind: source.kind ?? 'html',
      checksum: source.checksum ?? DEFAULT_CHECKSUM,
      filename: source.filename,
      originalWidth: source.originalWidth ?? validPages[0].tree.pageWidthPx,
      originalHeight: source.originalHeight ?? validPages[0].tree.pageHeightPx,
    },
    pages: cdirPages,
    assets: pageDocs.flatMap((doc) => doc.assets),
    fonts,
    warnings: pageDocs.flatMap((doc) => doc.warnings),
    meta: { palette: Array.from(new Set(palettes)).slice(0, 12) },
  });
}

function overlayToLayer(overlay: Overlay, tokens?: TemplateTokens): CdirLayer {
  const bounds = {
    x: overlay.x,
    y: overlay.y,
    width: Math.max(1, overlay.width),
    height: Math.max(1, overlay.height),
    rotation: overlay.rotation,
  };
  const common = {
    id: overlay.id,
    name: overlay.name,
    bounds,
    opacity: overlay.opacity,
    zIndex: overlay.zIndex,
    confidence: 1,
    provenance: { extractor: 'report-template' },
  };
  if (overlay.type === 'text') {
    return {
      ...common,
      kind: 'text',
      text: overlay.content,
      runs: overlay.runs,
      fontFamily: String(resolveTokenLiteral(overlay.fontFamily, tokens) ?? DEFAULT_IMPORT_FONT_STACK),
      fontSize: Number(overlay.fontSize ?? 12),
      fontWeight: overlay.fontWeightNumeric ?? overlay.fontWeight,
      fontStyle: overlay.fontStyle,
      // Resolved, not symbolic. An imported overlay now carries `token:text`
      // where it used to carry a hex, and CDIR exists to be DIFFED against a
      // source — a token name in a colour field measures nothing.
      color: String(resolveTokenLiteral(overlay.color, tokens) ?? '#000000'),
      align: overlay.align,
      lineHeight: overlay.lineHeight,
      letterSpacing: overlay.letterSpacing,
    };
  }
  if (overlay.type === 'image') return { ...common, kind: 'image', src: overlay.src, fit: overlay.fit };
  if (overlay.type === 'shape') {
    return {
      ...common,
      kind: 'shape',
      shape: overlay.shape,
      fill: overlay.fill,
      stroke: overlay.stroke,
      strokeWidth: overlay.strokeWidth,
      borderRadius: overlay.borderRadius,
    };
  }
  if (overlay.type === 'vector') return { ...common, kind: 'vector', viewBox: overlay.viewBox, paths: overlay.paths };
  if (overlay.type === 'table') {
    return {
      ...common,
      kind: 'table',
      rows: overlay.rows ?? [],
      columns: overlay.columns,
      showHeader: overlay.showHeader,
      fontFamily: overlay.fontFamily,
      fontSize: overlay.fontSize,
      borderColor: overlay.borderColor,
      borderWidth: overlay.borderWidth,
    };
  }
  const fallback = overlay as unknown as Record<string, unknown>;
  return {
    ...common,
    kind: 'text',
    text: typeof fallback.content === 'string' ? fallback.content : '',
    fontFamily: String(fallback.fontFamily ?? DEFAULT_IMPORT_FONT_STACK),
    fontSize: Number(fallback.fontSize ?? 12),
    color: String(fallback.color ?? '#000000'),
  };

}

function blockToLayers(block: Block, tokens?: TemplateTokens): CdirLayer[] {
  const layers = block.overlays.map((overlay) => overlayToLayer(overlay, tokens));
  if (layers.length <= 1) return layers;
  const minX = Math.min(...layers.map((layer) => layer.bounds.x));
  const minY = Math.min(...layers.map((layer) => layer.bounds.y));
  const maxX = Math.max(...layers.map((layer) => layer.bounds.x + layer.bounds.width));
  const maxY = Math.max(...layers.map((layer) => layer.bounds.y + layer.bounds.height));
  return [{
    id: `${block.id}_group`,
    kind: 'group',
    name: block.name ?? block.type,
    role: block.type === 'free' ? 'unknown' : 'card',
    bounds: { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) },
    children: layers,
    confidence: 1,
    provenance: { extractor: 'report-template' },
  }];
}

function pageToCdir(page: Page, index: number, tokens?: TemplateTokens): CdirPage {
  const traceAssetId = page.background?.imageUrl ? `page_${index + 1}_background` : undefined;
  const fallbackLayer: CdirLayer[] = traceAssetId ? [{
    id: `${traceAssetId}_fallback`,
    kind: 'image',
    name: 'Fallback raster trace',
    assetId: traceAssetId,
    fit: 'fill',
    fallbackRaster: true,
    bounds: { x: 0, y: 0, width: page.size.width, height: page.size.height },
    zIndex: -10_000,
    confidence: 1,
    provenance: { extractor: 'report-template-background' },
  }] : [];
  return {
    id: page.id,
    label: page.name || `Page ${index + 1}`,
    width: page.size.width,
    height: page.size.height,
    background: page.background?.color || page.background?.opacity || page.background?.gradient
      ? { color: page.background.color, opacity: page.background.opacity, gradient: page.background.gradient }
      : undefined,
    traceRasterAssetId: traceAssetId,
    layers: [...fallbackLayer, ...page.blocks.flatMap((block) => blockToLayers(block, tokens))],
  };
}

export function reportTemplateToCdir(template: ReportTemplate, source: Partial<AdapterSourceMeta> = {}): CdirDocument {
  return parseCdirDocument({
    version: 1,
    source: {
      kind: source.kind ?? 'template',
      checksum: source.checksum ?? DEFAULT_CHECKSUM,
      filename: source.filename,
    },
    pages: template.pages.map((page, index) => pageToCdir(page, index, template.tokens)),
    assets: template.pages.flatMap((page, index) => page.background?.imageUrl ? [{
      id: `page_${index + 1}_background`,
      kind: 'trace-raster' as const,
      url: page.background.imageUrl,
    }] : []),
    fonts: Object.values(template.tokens.fonts ?? {}).map((family) => ({ family })),
    warnings: [],
  });
}
