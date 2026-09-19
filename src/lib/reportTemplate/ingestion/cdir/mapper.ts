import { parseTemplate, type Block, type Overlay, type ReportTemplate } from '../../templateSchema';
import { deriveTokensFromExtraction, type FillObservation, type TextObservation } from '../../pdfImport/tokenDerivation';
import { firstGradientStop, isCssGradient } from '../../cssColor';
import { ensureCatalogFontFaces } from '../../fontCatalog';
import { DEFAULT_IMPORT_FONT_STACK } from '../../rendering/fontNormalization';
import type { CdirDocument, CdirLayer, CdirPage } from './schema';
import { parseCdirDocument } from './validate';

export interface CdirToTemplateOptions {
  templateName?: string;
  /**
   * Keep the source screenshot available for review. It is attached as a
   * LOCKED, HIDDEN "Source reference" overlay (renderers skip hidden overlays)
   * — never as the page background, which double-painted every glyph behind
   * the live text in the final render.
   */
  includeTraceLayers?: boolean;
}

/** Below this confidence an imported element arrives LOCKED (advisor model:
 *  low-confidence extractions are kept visually but not freely editable). */
export const LOW_CONFIDENCE_LOCK_THRESHOLD = 0.5;

function layerBounds(layer: CdirLayer) {
  const confidence = layer.confidence;
  return {
    x: layer.bounds.x,
    y: layer.bounds.y,
    width: layer.bounds.width,
    height: layer.bounds.height,
    rotation: layer.bounds.rotation ?? 0,
    opacity: layer.opacity ?? 1,
    zIndex: layer.zIndex,
    name: layer.name,
    ...(confidence != null ? { confidence } : {}),
    ...(confidence != null && confidence < LOW_CONFIDENCE_LOCK_THRESHOLD ? { locked: true } : {}),
  };
}

function assetUrl(doc: CdirDocument, assetId?: string): string | undefined {
  if (!assetId) return undefined;
  const asset = doc.assets.find((item) => item.id === assetId);
  return asset?.url ?? asset?.dataUrl;
}

function layerToOverlay(layer: Exclude<CdirLayer, { kind: 'group' }>, doc: CdirDocument, groupId?: string): Overlay | null {
  const base = { id: layer.id, ...layerBounds(layer), ...(groupId ? { groupId } : {}) };
  if (layer.kind === 'text') {
    const firstRun = layer.runs?.[0];
    return {
      ...base,
      type: 'text',
      content: layer.text,
      fontFamily: layer.fontFamily ?? firstRun?.fontFamily ?? DEFAULT_IMPORT_FONT_STACK,
      fontSize: layer.fontSize ?? firstRun?.fontSize ?? Math.max(6, Math.round(layer.bounds.height * 0.72)),
      fontWeight: layer.fontWeight === 'bold' || Number(layer.fontWeight) >= 600 ? 'bold' : 'normal',
      fontWeightNumeric: typeof layer.fontWeight === 'number' ? layer.fontWeight : undefined,
      fontStyle: layer.fontStyle ?? firstRun?.fontStyle ?? 'normal',
      color: layer.color ?? firstRun?.color ?? '#000000',
      align: layer.align ?? 'left',
      lineHeight: layer.lineHeight ?? 1.2,
      letterSpacing: layer.letterSpacing ?? firstRun?.letterSpacing ?? 0,
      runs: layer.runs,
    };
  }
  if (layer.kind === 'shape') {
    const effects = layer.blur || layer.shadow
      ? {
          ...(layer.blur ? { blur: Math.min(48, layer.blur) } : {}),
          ...(layer.shadow ? { shadow: layer.shadow } : {}),
        }
      : undefined;
    return {
      ...base,
      type: 'shape',
      shape: layer.shape,
      fill: layer.fill,
      stroke: layer.stroke,
      strokeWidth: layer.strokeWidth ?? 0,
      borderRadius: layer.borderRadius ?? 0,
      ...(effects ? { effects } : {}),
    };
  }
  if (layer.kind === 'vector') {
    return {
      ...base,
      type: 'vector',
      viewBox: layer.viewBox,
      paths: layer.paths,
    };
  }
  if (layer.kind === 'image') {
    const src = layer.src ?? assetUrl(doc, layer.assetId);
    if (!src) return null;
    return {
      ...base,
      type: 'image',
      src,
      fit: layer.fit,
    };
  }
  if (layer.kind === 'table') {
    return {
      ...base,
      type: 'table',
      rows: layer.rows,
      columns: layer.columns.length
        ? layer.columns
        : (layer.rows[0] ?? []).map((_, i) => ({ key: `col_${i + 1}`, label: `Column ${i + 1}` })),
      showHeader: layer.showHeader,
      fontFamily: layer.fontFamily,
      fontSize: layer.fontSize ?? 10,
      borderColor: layer.borderColor,
      borderWidth: layer.borderWidth ?? 0.5,
    };
  }
  return null;
}

function flattenLayers(layers: CdirLayer[], doc: CdirDocument, groupId?: string): Overlay[] {
  const out: Overlay[] = [];
  for (const layer of layers) {
    if (layer.kind === 'group') {
      out.push(...flattenLayers(layer.children, doc, layer.id));
      continue;
    }
    const overlay = layerToOverlay(layer, doc, groupId);
    if (overlay) out.push(overlay);
  }
  return out.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
}

function traceOverlay(page: CdirPage, doc: CdirDocument, visible: boolean): Overlay | null {
  const traceUrl = assetUrl(doc, page.traceRasterAssetId);
  if (!traceUrl) return null;
  return {
    id: `${page.id}_trace_reference`,
    type: 'image',
    name: visible ? 'Source raster (fallback)' : 'Source reference (hidden)',
    x: 0,
    y: 0,
    width: page.width,
    height: page.height,
    rotation: 0,
    opacity: 1,
    src: traceUrl,
    fit: 'fill',
    // Pages with editable layers hide the trace (no double-painted source
    // behind live content); raster-only pages keep it visible — it IS the page.
    hidden: !visible,
    locked: true,
    zIndex: -1_000_000,
  } as Overlay;
}

function pageToBlock(page: CdirPage, doc: CdirDocument, includeTraceLayers: boolean): Block {
  const editable = flattenLayers(page.layers, doc);
  const trace = includeTraceLayers ? traceOverlay(page, doc, editable.length === 0) : null;
  return {
    id: `${page.id}_cdir_freeform`,
    type: 'free',
    name: 'Imported editable layers',
    props: {},
    overlays: [...(trace ? [trace] : []), ...editable],
  };
}

function pageBackground(page: CdirPage) {
  return {
    color: page.background?.color,
    opacity: page.background?.opacity,
    gradient: page.background?.gradient,
  };
}

function collectTokenObservations(
  layer: CdirLayer,
  texts: TextObservation[],
  fills: FillObservation[],
) {
  if (layer.kind === 'group') {
    layer.children.forEach((child) => collectTokenObservations(child, texts, fills));
    return;
  }
  if (layer.kind === 'text') {
    if (layer.runs?.length) {
      for (const run of layer.runs) {
        texts.push({
          color: run.color ?? layer.color,
          fontFamily: run.fontFamily ?? layer.fontFamily,
          fontSize: run.fontSize ?? layer.fontSize ?? Math.max(6, layer.bounds.height * 0.72),
          chars: String(run.text ?? '').length,
        });
      }
    } else {
      texts.push({
        color: layer.color,
        fontFamily: layer.fontFamily,
        fontSize: layer.fontSize ?? Math.max(6, layer.bounds.height * 0.72),
        chars: String(layer.text ?? '').length,
      });
    }
  }
  if (layer.kind === 'shape') {
    const area = layer.bounds.width * layer.bounds.height;
    if (layer.fill) {
      const flat = isCssGradient(layer.fill) ? firstGradientStop(layer.fill) : layer.fill;
      if (flat) fills.push({ color: flat, area });
    }
    if (layer.stroke) fills.push({ color: layer.stroke, area: Math.max(1, area * 0.05) });
  }
}

/**
 * Canonical document tokens derived from the measured layers (colours weighted
 * by glyph count / painted area, fonts by usage) — replaces the old per-layer
 * token spam (`text_<uuid>`, `fill_<uuid>` …) that buried the real palette.
 */
function tokensFromCdir(doc: CdirDocument): ReportTemplate['tokens'] {
  const texts: TextObservation[] = [];
  const fills: FillObservation[] = [];
  let pageArea: number | undefined;
  for (const page of doc.pages) {
    pageArea = pageArea ?? page.width * page.height;
    if (page.background?.color) fills.push({ color: page.background.color, area: page.width * page.height });
    for (const layer of page.layers) collectTokenObservations(layer, texts, fills);
  }
  const derived = deriveTokensFromExtraction(texts, fills, { pageArea });
  return {
    colors: derived.colors,
    fonts: derived.fonts,
    spacing: {},
    fontFaces: doc.fonts.map((font) => ({
      family: font.family,
      weight: font.weight,
      style: font.style,
      source: font.assetId ? 'embedded' : undefined,
      src: assetUrl(doc, font.assetId),
    })),
  };
}

export function cdirToReportTemplate(input: CdirDocument | unknown, opts: CdirToTemplateOptions = {}): ReportTemplate {
  const doc = parseCdirDocument(input);
  // ensureCatalogFontFaces attaches Google Fonts cssUrl faces for catalog-known
  // families so the imported typography loads in the preview AND the export.
  return parseTemplate(ensureCatalogFontFaces({
    version: 1,
    tokens: tokensFromCdir(doc),
    pages: doc.pages.map((page, index) => ({
      id: page.id,
      name: page.label || `Imported Page ${index + 1}`,
      size: { width: page.width, height: page.height },
      background: pageBackground(page),
      blocks: [pageToBlock(page, doc, opts.includeTraceLayers ?? false)],
    })),
    slots: {},
    meta: {
      title: opts.templateName ?? doc.source.filename ?? 'Imported template',
      creator: 'Template Builder CDIR importer',
      keywords: `source:${doc.source.kind}`,
    },
  }));
}
