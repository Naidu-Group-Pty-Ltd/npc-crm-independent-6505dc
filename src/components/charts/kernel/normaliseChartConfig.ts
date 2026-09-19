// normaliseChartConfig — unifies the many chart_config shapes we persist
// (Chart.js style, QuickChart, ad-hoc {labels, values}, multi-series) into a
// single normalized model consumable by the LiveChart primitive.
//
// This is intentionally tolerant: any recognisable subset must produce a
// renderable model. When nothing usable is present, returns null so callers
// can fall back to the static image path.

import { colorAt, resolvePalette } from './palettes';

export const MAX_CHART_POINTS = 500;
export const MAX_CHART_SERIES = 20;
export const MAX_CHART_LABEL_LENGTH = 200;

export type NormalisedChartKind =
  | 'bar'
  | 'bar-horizontal'
  | 'bar-stacked'
  | 'line'
  | 'area'
  | 'area-stacked'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'radar'
  | 'combo';

export interface NormalisedSeries {
  key: string;            // stable identifier used as Recharts dataKey
  label: string;          // display name in legend + tooltip
  color: string;          // hex color from resolved palette
  type?: 'bar' | 'line' | 'area'; // combo-chart per-series hint
}

export interface NormalisedPoint {
  name: string;
  [seriesKey: string]: string | number | null;
}

export interface NormalisedChartModel {
  kind: NormalisedChartKind;
  title: string;
  subtitle?: string;
  data: NormalisedPoint[];
  series: NormalisedSeries[];
  palette: string[];
  xLabel?: string;
  yLabel?: string;
  stacked: boolean;
  horizontal: boolean;
  // Pie/donut single-slice model — mirrors data but with `fill` per row.
  pieSlices?: Array<{ name: string; value: number; fill: string }>;
}

interface RawChart {
  id?: string;
  chart_type?: string;
  title?: string;
  chart_config?: any;
  dataset?: any;
}

function coerceKind(cfg: any, chartType: string, seriesCount: number, stacked: boolean, horizontal: boolean): NormalisedChartKind {
  const t = String(cfg?.type || chartType || '').slice(0, MAX_CHART_LABEL_LENGTH).toLowerCase();
  const semantic = `${t} ${chartType || ''}`.toLowerCase();

  if (semantic.includes('donut') || semantic.includes('doughnut')) return 'donut';
  if (semantic.includes('pie')) return 'pie';
  if (semantic.includes('scatter') || semantic.includes('bubble')) return 'scatter';
  if (semantic.includes('radar')) return 'radar';
  if (semantic.includes('combo') || semantic.includes('mixed')) return 'combo';
  if (semantic.includes('area')) return stacked ? 'area-stacked' : 'area';
  if (semantic.includes('line') || semantic.includes('trend')) return 'line';
  if (horizontal) return 'bar-horizontal';
  if (stacked) return 'bar-stacked';
  return 'bar';
}

function toStringLabel(v: any, i: number): string {
  let label: string;
  if (v === null || v === undefined) return `#${i + 1}`;
  if (typeof v === 'object') {
    if ('x' in v) label = String(v.x);
    else if ('label' in v) label = String(v.label);
    else if ('name' in v) label = String(v.name);
    else label = `#${i + 1}`;
  } else {
    label = String(v);
  }
  return label.slice(0, MAX_CHART_LABEL_LENGTH);
}

function toDisplayText(v: unknown, fallback = ''): string {
  return String(v || fallback).slice(0, MAX_CHART_LABEL_LENGTH);
}

function toNumber(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'object') {
    if ('y' in v) return Number(v.y) || 0;
    if ('value' in v) return Number(v.value) || 0;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function slugKey(label: string, i: number): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return base ? `s_${base}_${i}` : `s_${i}`;
}

/**
 * Attempt to build a NormalisedChartModel from a raw chart record.
 * Returns null when the payload lacks the minimum labels/values shape.
 */
export function normaliseChartConfig(raw: RawChart): NormalisedChartModel | null {
  const cfg = raw?.chart_config || {};
  const dataset = raw?.dataset || {};

  // Producer shape used throughout the app:
  //   { type, title, data: [{ label, value, color? }, ...] }
  // Convert it into the Chart.js-ish {labels, datasets} shape the rest of the
  // pipeline understands, so downstream consumers stay uniform.
  const isInlinePoint = (point: any): boolean => point !== null && typeof point === 'object' && !Array.isArray(point);
  const inlinePoints: any[] | null = Array.isArray(cfg.data) && cfg.data.length > 0 && cfg.data.every(isInlinePoint) && ('label' in cfg.data[0] || 'name' in cfg.data[0])
    ? cfg.data
    : Array.isArray(cfg.points) && cfg.points.every(isInlinePoint) ? cfg.points
    : null;

  const source = inlinePoints
    ? {
        labels: inlinePoints.map((p) => p.label ?? p.name),
        datasets: [{
          label: cfg.datasetLabel || raw?.title || 'Value',
          data: inlinePoints.map((p) => p.value ?? p.y ?? 0),
          backgroundColor: inlinePoints.some((p) => p.color) ? inlinePoints.map((p) => p.color || null) : undefined,
        }],
      }
    : (cfg.data || (Array.isArray(dataset?.data) ? dataset : dataset?.chart_config) || dataset || cfg);

  const labels: any[] = (Array.isArray(source.labels)
    ? source.labels
    : Array.isArray(cfg.labels)
      ? cfg.labels
      : []).slice(0, MAX_CHART_POINTS);

  const rawDatasets: any[] = (Array.isArray(source.datasets)
    ? source.datasets
    : Array.isArray(cfg.datasets)
      ? cfg.datasets
      : Array.isArray(source.values) || Array.isArray(cfg.values)
        ? [{ data: source.values || cfg.values, label: cfg.datasetLabel || raw?.title || 'Value' }]
        : []).slice(0, MAX_CHART_SERIES);

  if (!labels.length || !rawDatasets.length) return null;

  const palette = resolvePalette(cfg.palette || cfg.options?.palette);
  const chartType = toDisplayText(raw?.chart_type).toLowerCase();

  const stacked = Boolean(
    cfg.stacked ||
    cfg.options?.scales?.x?.stacked ||
    cfg.options?.scales?.y?.stacked ||
    rawDatasets.some((d) => d?.stack),
  );
  const longLabelCount = labels.filter((label) => toStringLabel(label, 0).length > 14).length;
  const horizontal = String(cfg.indexAxis || cfg.options?.indexAxis || '').toLowerCase() === 'y'
    || chartType.includes('horizontal')
    || (rawDatasets.length === 1 && labels.length > 5 && longLabelCount / labels.length > 0.35);

  const series: NormalisedSeries[] = rawDatasets.map((ds, i) => {
    const label = toDisplayText(ds?.label, `Series ${i + 1}`);
    const inlineColor = Array.isArray(ds?.backgroundColor)
      ? undefined
      : (ds?.backgroundColor || ds?.borderColor);
    return {
      key: slugKey(label, i),
      label,
      color: (typeof inlineColor === 'string' && inlineColor) || colorAt(palette, i),
      type: ds?.type ? String(ds.type).toLowerCase() as NormalisedSeries['type'] : undefined,
    };
  });

  const data: NormalisedPoint[] = labels.map((lab, rowIdx) => {
    const row: NormalisedPoint = { name: toStringLabel(lab, rowIdx) };
    rawDatasets.forEach((ds, i) => {
      const values = Array.isArray(ds?.data) ? ds.data : [];
      row[series[i].key] = toNumber(values[rowIdx]);
    });
    return row;
  });

  const kind = coerceKind(cfg, chartType, series.length, stacked, horizontal);

  // Build pie slices when this is a single-series categorical chart. If the
  // dataset had per-slice colors, honour them; otherwise fall back to palette.
  let pieSlices: NormalisedChartModel['pieSlices'];
  if (kind === 'pie' || kind === 'donut') {
    const first = rawDatasets[0] || {};
    const perSliceColors: string[] = Array.isArray(first.backgroundColor) ? first.backgroundColor : [];
    pieSlices = data.map((row, i) => ({
      name: row.name,
      value: Number(row[series[0].key]) || 0,
      fill: perSliceColors[i] || colorAt(palette, i),
    }));
  }

  return {
    kind,
    title: toDisplayText(cfg.options?.plugins?.title?.text || cfg.title || raw?.title, 'Untitled chart'),
    subtitle: cfg.options?.plugins?.subtitle?.text || cfg.subtitle
      ? toDisplayText(cfg.options?.plugins?.subtitle?.text || cfg.subtitle)
      : undefined,
    data,
    series,
    palette,
    xLabel: cfg.options?.scales?.x?.title?.text || cfg.x_axis_label || cfg.xLabel
      ? toDisplayText(cfg.options?.scales?.x?.title?.text || cfg.x_axis_label || cfg.xLabel)
      : undefined,
    yLabel: cfg.options?.scales?.y?.title?.text || cfg.y_axis_label || cfg.yLabel
      ? toDisplayText(cfg.options?.scales?.y?.title?.text || cfg.y_axis_label || cfg.yLabel)
      : undefined,
    stacked,
    horizontal,
    pieSlices,
  };
}

export function canNormaliseChartConfig(raw: RawChart): boolean {
  return normaliseChartConfig(raw) !== null;
}
