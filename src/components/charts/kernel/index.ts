// Shared Live Chart Kernel — public entry point.
export { LiveChart } from './LiveChart';
export type { LiveChartVariant } from './LiveChart';
export {
  normaliseChartConfig,
  canNormaliseChartConfig,
  type NormalisedChartModel,
  type NormalisedChartKind,
  type NormalisedSeries,
  type NormalisedPoint,
} from './normaliseChartConfig';
export {
  PALETTES,
  AURORA_GOLD_PALETTE,
  resolvePalette,
  colorAt,
  type PaletteKey,
} from './palettes';
