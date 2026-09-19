// Map view build marker: 2026-07-31 (forces a fresh production bundle)
import { useCallback, useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import {
  calibrateHeatMax,
  heatGeometryForZoom,
  type HeatFocus,
  type HeatPoint,
} from '@/lib/listingsMap';

export type { HeatPoint } from '@/lib/listingsMap';

interface HeatLayerProps {
  points: HeatPoint[];
  visible: boolean;
  /** Radius / saturation profile. */
  focus?: HeatFocus;
  /** Dataset-wide floor for the colour ceiling — see `HeatModel.minCeiling`. */
  minCeiling?: number;
  /**
   * Changes whenever the resolved brand or light/dark theme changes so the
   * gradient is re-read from the CSS custom properties.
   */
  themeKey?: string;
  /** Lifted so the surrounding UI can explain the current colour ceiling. */
  onCalibrate?: (max: number) => void;
}

type HeatLayerInstance = {
  addTo: (map: L.Map) => unknown;
  setLatLngs: (points: Array<[number, number, number]>) => unknown;
  setOptions: (options: Record<string, unknown>) => unknown;
  redraw: () => unknown;
};

type HeatLayerFactory = (
  points: Array<[number, number, number]>,
  options: Record<string, unknown>,
) => HeatLayerInstance;

function createHeatLayer(options: Record<string, unknown>): HeatLayerInstance | null {
  const factory = (L as unknown as { heatLayer?: HeatLayerFactory }).heatLayer;
  if (typeof factory !== 'function') return null;
  return factory([], options);
}

/**
 * leaflet.heat schedules its redraw through requestAnimationFrame but never
 * cancels the pending frame on removal, so a frame that lands after the layer
 * has been detached dereferences a null `_map` and throws. Cancel it ourselves.
 */
function detachHeatLayer(map: L.Map, layer: HeatLayerInstance): void {
  const internals = layer as unknown as { _frame?: number | null };
  if (internals._frame) {
    L.Util.cancelAnimFrame(internals._frame);
    internals._frame = null;
  }
  map.removeLayer(layer as unknown as L.Layer);
}

function readToken(name: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value ? `hsl(${value})` : fallback;
}

/**
 * Monotonic cool → hot ramp built entirely from semantic tokens, so it re-themes
 * with the white-label palette. Brand `--primary` is deliberately excluded: a
 * tenant hue in the middle of a sequential scale breaks its ordering.
 */
function buildGradient(): Record<number, string> {
  return {
    0.25: readToken('--info', 'hsl(200 98% 39%)'),
    0.5: readToken('--success', 'hsl(142 71% 45%)'),
    0.72: readToken('--warning', 'hsl(43 74% 49%)'),
    1.0: readToken('--destructive', 'hsl(0 72% 51%)'),
  };
}

/**
 * Heat overlay for the listings map.
 *
 * The layer instance is created once and mutated in place — recreating it on
 * every data change made the canvas flash and reset its zoom transform. Radius
 * and the saturation ceiling are recomputed on every zoom/pan so the ramp always
 * describes what is actually on screen instead of a fixed, zoom-blind constant.
 */
export function HeatLayer({
  points,
  visible,
  focus = 'balanced',
  minCeiling,
  themeKey = 'default',
  onCalibrate,
}: HeatLayerProps) {
  const map = useMap();
  const layerRef = useRef<HeatLayerInstance | null>(null);
  const attachedRef = useRef(false);
  const pointsRef = useRef<HeatPoint[]>(points);
  const focusRef = useRef<HeatFocus>(focus);
  const gradientRef = useRef<Record<number, string>>(buildGradient());
  const calibrateRef = useRef(onCalibrate);
  const minCeilingRef = useRef(minCeiling);

  pointsRef.current = points;
  focusRef.current = focus;
  calibrateRef.current = onCalibrate;
  minCeilingRef.current = minCeiling;

  /** Push the current point set into the layer. Only safe while attached. */
  const applyData = useCallback(() => {
    const layer = layerRef.current;
    if (!layer || !attachedRef.current) return;
    layer.setLatLngs(
      pointsRef.current.map((p) => [p.lat, p.lng, p.intensity] as [number, number, number]),
    );
  }, []);

  /** Recompute radius + saturation ceiling for the current viewport. */
  const recalibrate = useCallback(() => {
    const layer = layerRef.current;
    if (!layer || !attachedRef.current) return;

    const zoom = map.getZoom();
    const { radius, blur } = heatGeometryForZoom(zoom, focusRef.current);

    // Mirror leaflet.heat: only points inside the padded viewport contribute.
    const size = map.getSize();
    const pad = radius;
    const projected = pointsRef.current
      .map((p) => {
        const pt = map.latLngToContainerPoint([p.lat, p.lng]);
        return { x: pt.x, y: pt.y, weight: p.intensity };
      })
      .filter(
        (p) => p.x >= -pad && p.y >= -pad && p.x <= size.x + pad && p.y <= size.y + pad,
      );

    const max = calibrateHeatMax(projected, radius, focusRef.current, minCeilingRef.current);

    layer.setOptions({
      radius,
      blur,
      max,
      // Pinning the plugin's `maxZoom` to the live zoom neutralises its internal
      // 1/2^(maxZoom-zoom) damping, so our own calibration is the single source
      // of truth for how the ramp is scaled.
      maxZoom: zoom,
      minOpacity: 0.22,
      gradient: gradientRef.current,
    });

    calibrateRef.current?.(max);
  }, [map]);

  // Create the layer once per map instance.
  useEffect(() => {
    const layer = createHeatLayer({
      radius: 24,
      blur: 18,
      minOpacity: 0.22,
      gradient: gradientRef.current,
    });
    if (!layer) {
      if (typeof console !== 'undefined') {
        console.warn('[ListingsMap] leaflet.heat is unavailable — heat overlay disabled.');
      }
      return;
    }
    layerRef.current = layer;

    return () => {
      if (attachedRef.current) {
        detachHeatLayer(map, layer);
        attachedRef.current = false;
      }
      layerRef.current = null;
    };
  }, [map]);

  // Attach / detach without destroying the instance.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const shouldAttach = visible && points.length > 0;

    if (shouldAttach && !attachedRef.current) {
      layer.addTo(map);
      attachedRef.current = true;
      applyData();
      recalibrate();
    } else if (!shouldAttach && attachedRef.current) {
      detachHeatLayer(map, layer);
      attachedRef.current = false;
    }
  }, [map, visible, points.length, applyData, recalibrate]);

  // Push new data in place, then rescale. While detached the layer holds a null
  // map reference, so the data is applied on the next attach instead.
  useEffect(() => {
    applyData();
    recalibrate();
  }, [points, applyData, recalibrate]);

  // Re-read the gradient when the brand or light/dark theme flips.
  useEffect(() => {
    gradientRef.current = buildGradient();
    recalibrate();
  }, [themeKey, recalibrate]);

  // Focus (radius / saturation profile) and ceiling changes.
  useEffect(() => {
    recalibrate();
  }, [focus, minCeiling, recalibrate]);

  // Keep the ramp honest while the user navigates.
  useEffect(() => {
    const handler = () => recalibrate();
    map.on('zoomend', handler);
    map.on('moveend', handler);
    map.on('resize', handler);
    return () => {
      map.off('zoomend', handler);
      map.off('moveend', handler);
      map.off('resize', handler);
    };
  }, [map, recalibrate]);

  return null;
}

export default HeatLayer;
