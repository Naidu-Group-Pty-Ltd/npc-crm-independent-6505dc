/**
 * Phase 4 — Visual diff harness barrel.
 *
 * Public entry point for the pixel/text/layout metric pipeline. Consumers
 * (Docling import path, Phase 6 repair loop, review UI) should import from
 * here rather than the individual files.
 */
export {
  compareImages,
  buildDiffImage,
  downscaleImageData,
  emptyImageData,
  type ImageMetricsResult,
} from './imageMetrics';

export {
  measureTextCoverage,
  type TextCoverageResult,
} from './textMetrics';

export {
  measureLayoutMetrics,
  flattenCdirLayerBounds,
  type LayoutMetricsResult,
} from './layoutMetrics';

export {
  rasterizePdfPages,
  rasterizeFromHtmlImage,
  type RasterisedPage,
  type RasterizePdfOptions,
} from './rasterize';

export {
  runVisualDiff,
  type VisualDiffInput,
  type RenderedPageRaster,
  type DoclingExpectationsLike,
} from './runVisualDiff';
