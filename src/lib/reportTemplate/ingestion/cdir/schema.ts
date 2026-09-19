/**
 * Canonical Design IR (CDIR) for high-fidelity template ingestion.
 *
 * CDIR is the format-neutral bridge between source extractors (PDF, image/OCR,
 * DOM/code, Figma) and the editable ReportTemplate schema. Coordinates are in
 * page points with a top-left origin, matching the template editor.
 */
import { z } from 'zod';

export const CdirSourceKindSchema = z.enum(['pdf', 'image', 'url', 'figma', 'html', 'jsx', 'zip', 'template']);
export type CdirSourceKind = z.infer<typeof CdirSourceKindSchema>;

export const CdirRectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().finite().optional(),
});
export type CdirRect = z.infer<typeof CdirRectSchema>;

export const CdirPaintSchema = z.object({
  color: z.string().optional(),
  opacity: z.number().min(0).max(1).optional(),
  gradient: z.object({
    type: z.enum(['linear', 'radial']).default('linear'),
    angle: z.number().finite().optional(),
    stops: z.array(z.object({ color: z.string(), position: z.number().min(0).max(100) })).default([]),
  }).optional(),
});
export type CdirPaint = z.infer<typeof CdirPaintSchema>;

export const CdirAssetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['image', 'font', 'svg', 'trace-raster', 'diff-raster']),
  url: z.string().optional(),
  dataUrl: z.string().optional(),
  mimeType: z.string().optional(),
  checksum: z.string().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  meta: z.record(z.unknown()).optional(),
}).refine((asset) => Boolean(asset.url || asset.dataUrl), {
  message: 'CDIR assets require either url or dataUrl',
});
export type CdirAsset = z.infer<typeof CdirAssetSchema>;

export const CdirFontSchema = z.object({
  family: z.string().min(1),
  weight: z.union([z.number(), z.string()]).optional(),
  style: z.enum(['normal', 'italic']).optional(),
  assetId: z.string().optional(),
  sourceName: z.string().optional(),
});
export type CdirFont = z.infer<typeof CdirFontSchema>;

export const CdirWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  pageId: z.string().optional(),
  layerId: z.string().optional(),
  severity: z.enum(['info', 'warning', 'error']).default('warning'),
});
export type CdirWarning = z.infer<typeof CdirWarningSchema>;

export const CdirTextRunSchema = z.object({
  text: z.string(),
  fontFamily: z.string().optional(),
  fontSize: z.number().positive().optional(),
  fontWeight: z.union([z.number(), z.enum(['normal', 'bold'])]).optional(),
  fontStyle: z.enum(['normal', 'italic']).optional(),
  color: z.string().optional(),
  letterSpacing: z.number().optional(),
});
export type CdirTextRun = z.infer<typeof CdirTextRunSchema>;

const CdirLayerBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  bounds: CdirRectSchema,
  opacity: z.number().min(0).max(1).optional(),
  zIndex: z.number().int().optional(),
  confidence: z.number().min(0).max(1).optional(),
  provenance: z.object({
    extractor: z.string().optional(),
    sourceId: z.string().optional(),
    sourcePage: z.number().int().min(0).optional(),
    sourceNodeId: z.string().optional(),
  }).optional(),
  meta: z.record(z.unknown()).optional(),
});

export const CdirTextLayerSchema = CdirLayerBaseSchema.extend({
  kind: z.literal('text'),
  text: z.string(),
  runs: z.array(CdirTextRunSchema).optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().positive().optional(),
  fontWeight: z.union([z.number(), z.enum(['normal', 'bold'])]).optional(),
  fontStyle: z.enum(['normal', 'italic']).optional(),
  color: z.string().optional(),
  align: z.enum(['left', 'center', 'right', 'justify']).optional(),
  lineHeight: z.number().positive().optional(),
  letterSpacing: z.number().optional(),
});

export const CdirShapeLayerSchema = CdirLayerBaseSchema.extend({
  kind: z.literal('shape'),
  shape: z.enum(['rect', 'line', 'ellipse']).default('rect'),
  /** Flat colour OR a raw CSS gradient string (renderer passes gradients through). */
  fill: z.string().optional(),
  stroke: z.string().optional(),
  strokeWidth: z.number().min(0).optional(),
  borderRadius: z.number().min(0).optional(),
  /** CSS blur radius in page points (glow orbs / soft accents). */
  blur: z.number().min(0).optional(),
  shadow: z.object({
    x: z.number().default(0),
    y: z.number().default(2),
    blur: z.number().min(0).default(8),
    spread: z.number().default(0),
    color: z.string().default('rgba(0,0,0,0.25)'),
  }).optional(),
});

export const CdirVectorLayerSchema = CdirLayerBaseSchema.extend({
  kind: z.literal('vector'),
  viewBox: z.string().default('0 0 100 100'),
  paths: z.array(z.object({
    d: z.string().min(1),
    fill: z.string().optional(),
    stroke: z.string().optional(),
    strokeWidth: z.number().min(0).optional(),
    fillRule: z.enum(['nonzero', 'evenodd']).optional(),
    opacity: z.number().min(0).max(1).optional(),
  })).default([]),
});

export const CdirImageLayerSchema = CdirLayerBaseSchema.extend({
  kind: z.literal('image'),
  assetId: z.string().optional(),
  src: z.string().optional(),
  fit: z.enum(['cover', 'contain', 'fill']).default('cover'),
  fallbackRaster: z.boolean().optional(),
});

export const CdirTableLayerSchema = CdirLayerBaseSchema.extend({
  kind: z.literal('table'),
  rows: z.array(z.array(z.string())).default([]),
  columns: z.array(z.object({ key: z.string(), label: z.string().optional(), width: z.number().positive().optional() })).default([]),
  showHeader: z.boolean().default(true),
  fontFamily: z.string().optional(),
  fontSize: z.number().positive().optional(),
  borderColor: z.string().optional(),
  borderWidth: z.number().min(0).optional(),
});

export type CdirTextLayer = z.infer<typeof CdirTextLayerSchema>;
export type CdirShapeLayer = z.infer<typeof CdirShapeLayerSchema>;
export type CdirVectorLayer = z.infer<typeof CdirVectorLayerSchema>;
export type CdirImageLayer = z.infer<typeof CdirImageLayerSchema>;
export type CdirTableLayer = z.infer<typeof CdirTableLayerSchema>;

export type CdirGroupLayer = z.infer<typeof CdirLayerBaseSchema> & {
  kind: 'group';
  children: CdirLayer[];
  role?: 'header' | 'footer' | 'card' | 'hero' | 'kpi' | 'table' | 'unknown';
};

export type CdirLayer =
  | CdirTextLayer
  | CdirShapeLayer
  | CdirVectorLayer
  | CdirImageLayer
  | CdirTableLayer
  | CdirGroupLayer;

export const CdirLayerSchema: z.ZodType<CdirLayer> = z.lazy(() => z.discriminatedUnion('kind', [
  CdirTextLayerSchema,
  CdirShapeLayerSchema,
  CdirVectorLayerSchema,
  CdirImageLayerSchema,
  CdirTableLayerSchema,
  CdirLayerBaseSchema.extend({
    kind: z.literal('group'),
    children: z.array(CdirLayerSchema).default([]),
    role: z.enum(['header', 'footer', 'card', 'hero', 'kpi', 'table', 'unknown']).optional(),
  }),
])) as unknown as z.ZodType<CdirLayer>;

export const CdirPageSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  width: z.number().positive(),
  height: z.number().positive(),
  background: CdirPaintSchema.optional(),
  layers: z.array(CdirLayerSchema).default([]),
  traceRasterAssetId: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});
export type CdirPage = z.infer<typeof CdirPageSchema>;

export const CdirDocumentSchema = z.object({
  version: z.literal(1).default(1),
  source: z.object({
    kind: CdirSourceKindSchema,
    filename: z.string().optional(),
    checksum: z.string().min(1),
    originalWidth: z.number().positive().optional(),
    originalHeight: z.number().positive().optional(),
    meta: z.record(z.unknown()).optional(),
  }),
  pages: z.array(CdirPageSchema).min(1),
  assets: z.array(CdirAssetSchema).default([]),
  fonts: z.array(CdirFontSchema).default([]),
  warnings: z.array(CdirWarningSchema).default([]),
  meta: z.record(z.unknown()).optional(),
});
export type CdirDocument = z.infer<typeof CdirDocumentSchema>;
