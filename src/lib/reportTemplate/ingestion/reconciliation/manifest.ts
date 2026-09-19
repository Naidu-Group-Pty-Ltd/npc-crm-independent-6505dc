import type { GroundedReference } from '../../imageGrounding';
import type { ImportAsset, ImportPage, RawImportBlock, RawImportManifest } from './types';
import { stableImportId } from './ids';

function clamp01(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function blockTypeFromGrounded(type: unknown): RawImportBlock['type'] {
  if (type === 'image' || type === 'shape' || type === 'table') return type;
  if (type === 'text' || type === 'word' || type === undefined) return 'text';
  return 'unknown';
}

export interface BuildManifestOptions {
  importId?: string;
  page: ImportPage;
  palette?: string[];
  grounded?: GroundedReference | null;
  rawBlocks?: RawImportBlock[];
}

export function groundedReferenceToRawBlocks(grounded: GroundedReference | null | undefined): RawImportBlock[] {
  if (!grounded?.elements?.length) return [];
  return grounded.elements.map((element: any, index) => ({
    id: stableImportId('raw', element.id ?? index + 1),
    type: blockTypeFromGrounded(element.type),
    text: typeof element.text === 'string' ? element.text : undefined,
    bbox: {
      x: Number(element.x) || 0,
      y: Number(element.y) || 0,
      width: Math.max(1, Number(element.width) || 1),
      height: Math.max(1, Number(element.height) || 1),
    },
    style: {
      fontSize: Number.isFinite(Number(element.fontSize)) ? Number(element.fontSize) : undefined,
      color: typeof element.color === 'string' ? element.color : undefined,
    },
    confidence: clamp01(element.confidence, 0.75),
    source: 'ocr',
  }));
}

export function buildRawImportManifest(options: BuildManifestOptions): RawImportManifest {
  const rawBlocks = options.rawBlocks ?? groundedReferenceToRawBlocks(options.grounded);
  const textBlockCount = rawBlocks.filter((b) => b.type === 'text').length;
  const imageBlockCount = rawBlocks.filter((b) => b.type === 'image').length;
  return {
    importId: options.importId ?? stableImportId('import', options.page.id),
    page: {
      id: options.page.id,
      pageIndex: options.page.pageIndex,
      width: options.page.width,
      height: options.page.height,
      backgroundColor: options.page.backgroundColor,
      referenceImageUrl: options.page.referenceImageUrl,
      dpiScale: options.page.dpiScale,
    },
    palette: options.palette ?? [],
    rawBlocks,
    extractionSummary: {
      hasPdfTextLayer: rawBlocks.some((b) => b.source === 'pdf-text'),
      hasOcrTextLayer: rawBlocks.some((b) => b.source === 'ocr'),
      hasEmbeddedImages: imageBlockCount > 0,
      blockCount: rawBlocks.length,
      textBlockCount,
      imageBlockCount,
    },
    warnings: [],
  };
}

export function buildRawImportManifests(asset: ImportAsset, options: { palette?: string[]; grounded?: GroundedReference | null } = {}): RawImportManifest[] {
  return asset.pages.map((page) => buildRawImportManifest({
    importId: asset.fileId,
    page,
    palette: options.palette,
    grounded: page.pageIndex === 0 ? options.grounded : null,
  }));
}
