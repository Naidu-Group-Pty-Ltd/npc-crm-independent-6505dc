/**
 * The colours the cash-flow charts draw in.
 *
 * ## Why this exists
 *
 * All three charts on the Cash Flow Analysis page were drawn on a hard white
 * card — `bg-white` plus an inline `backgroundColor: '#ffffff'`, which no class
 * can override — with light-theme greys for the grid (`#d1d5db`), the axes
 * (`#e5e7eb`) and the tick labels (`#6b7280`). On the dark theme that is the
 * product's default, three white slabs sat in the middle of a dark page.
 *
 * The white was not load-bearing. `exportChartAsPNG` passes html2canvas its own
 * `backgroundColor`, so the export never depended on the element being white —
 * it just was.
 *
 * ## Why the tokens are resolved in JS
 *
 * Recharts writes its colours into SVG *presentation attributes*, and `var()`
 * is not resolved there by specification. Some of the existing series happened
 * to work with `hsl(var(--primary))` and some did not, which is exactly the
 * sort of thing that is invisible until a theme changes. So the tokens are read
 * off the document once, turned into concrete `hsl(H S% L%)` strings, and
 * re-read when the theme attribute changes — which also gives the PNG export a
 * real colour to paint behind the chart.
 */
import { useEffect, useMemo, useState } from 'react';

/**
 * Wrap a raw token value in `hsl()`.
 *
 * The tokens are stored as bare triples (`43 74% 49%`) so Tailwind can compose
 * them with an alpha. A value that already looks like a colour is passed
 * through, so this is safe to point at any custom property.
 */
export function toCssColor(raw: string, fallback: string): string {
  const value = (raw || '').trim();
  if (!value) return fallback;
  if (/^(#|rgb|hsl|oklch|var\()/i.test(value)) return value;
  return `hsl(${value})`;
}

/** Read one custom property off an element, resolved to a usable colour. */
export function readTokenColor(
  element: Element | null,
  token: string,
  fallback: string,
): string {
  if (!element || typeof window === 'undefined') return fallback;
  try {
    return toCssColor(getComputedStyle(element).getPropertyValue(token), fallback);
  } catch {
    return fallback;
  }
}

export interface CashFlowChartTheme {
  /** The chart card's own background — also what the PNG export paints. */
  surface: string;
  grid: string;
  axisLine: string;
  tick: string;
  /** Named series, so a line means the same thing on every chart. */
  series: {
    propertyValue: string;
    equity: string;
    loanBalance: string;
    rentalIncome: string;
    cashFlow: string;
    breakEven: string;
    crossover: string;
    grossYield: string;
    netYield: string;
  };
  /** One colour per compared property, in selection order. */
  property: string[];
}

/**
 * The fallbacks are the light-theme values the charts used before this module.
 *
 * They are only reached with no document (a test renderer, an SSR pass), so a
 * chart never draws with nothing — but on a real page every one of them is
 * replaced by the token.
 */
const FALLBACK: CashFlowChartTheme = {
  surface: '#ffffff',
  grid: '#d1d5db',
  axisLine: '#e5e7eb',
  tick: '#6b7280',
  series: {
    propertyValue: '#2563eb',
    equity: '#22c55e',
    loanBalance: '#ef4444',
    rentalIncome: '#f59e0b',
    cashFlow: '#8b5cf6',
    breakEven: '#22c55e',
    crossover: '#06b6d4',
    grossYield: '#06b6d4',
    netYield: '#ec4899',
  },
  property: ['#c9a227', '#ef4444', '#22c55e', '#0ea5e9', '#8b5cf6'],
};

/**
 * The tokens a line on the trends chart draws in, by series.
 *
 * Exported so a test can resolve them against `tokens.css` for both themes and
 * fail when two of them land on the same colour — which is exactly what
 * happened when `rentalIncome` pointed at `--warning`.
 */
export const SERIES_TOKENS = {
  propertyValue: '--primary',
  equity: '--success',
  loanBalance: '--destructive',
  rentalIncome: '--chart-6',
  cashFlow: '--chart-5',
  // Reference markers and the yield chart's own pair. They are resolved from
  // the same map so the map is the single description of what draws in what —
  // a map the resolver did not read would be a constant a test asserts about
  // itself.
  breakEven: '--success',
  crossover: '--info',
  grossYield: '--info',
  netYield: '--chart-8',
} as const;

/** The five lines that share the trends chart, which must be tellable apart. */
export const TREND_SERIES = [
  'propertyValue', 'equity', 'loanBalance', 'rentalIncome', 'cashFlow',
] as const;

/** The two lines that share the yield chart. */
export const YIELD_SERIES = ['grossYield', 'netYield'] as const;

/**
 * One colour per compared property.
 *
 * Chosen for hue separation rather than by position in the chart scale: gold,
 * red, green, cyan and purple are each at least 40 degrees apart, so five lines
 * on one axis stay tellable apart. `--chart-1` is deliberately absent — it is
 * the same value as `--primary`.
 */
export const PROPERTY_TOKENS = [
  '--primary',
  '--chart-4',
  '--chart-3',
  '--info',
  '--chart-5',
] as const;

/**
 * How a compared property's line is DRAWN, not just what colour it is.
 *
 * The comparison chart gave the open report a solid line and every peer the
 * same `strokeDasharray="5 5"`, so four of the five properties were told apart
 * by hue alone — and the audit's screenshot is what that looks like when it
 * fails: five series, three readable line indicators, two pairs an adviser
 * cannot separate. Colour is the first thing a chart loses. It is lost to a
 * projector, to a greyscale print, to the PNG export pasted into a report, and
 * to the ~8% of men with a colour vision deficiency — and this chart's palette
 * puts red and green on adjacent slots, which is the pair that goes first.
 *
 * So the pattern carries the identity and the colour reinforces it. Five
 * patterns for five properties, and a spec asserts they stay distinct.
 *
 * ## Why the numbers are what they are
 *
 * A dash array is in the drawing surface's own units. On the chart that is
 * pixels; in a Recharts legend swatch it is a 32-unit viewBox scaled down, so
 * a pattern whose period is longer than 32 renders in the legend as a solid
 * line — the swatch would then say the opposite of the chart. Every period
 * here is at most 20, so each one repeats at least once in the swatch.
 *
 * `round` is not decoration either: it is what turns `1 5` into a row of dots
 * rather than a row of hairlines, which is the difference between the dotted
 * series and the fine-dashed one.
 */
export interface PropertyLineStyle {
  /** SVG `stroke-dasharray`. Absent for the solid line. */
  dash?: string;
  /** SVG `stroke-linecap`. `round` is what makes a 1-unit dash read as a dot. */
  linecap?: 'butt' | 'round';
  /**
   * What the pattern is called.
   *
   * Rendered into a marker's accessible name, so a screen reader and a
   * greyscale print carry the same distinction the colour does.
   */
  name: string;
}

export const PROPERTY_LINE_STYLES: readonly PropertyLineStyle[] = [
  { name: 'solid' },
  { dash: '10 5', name: 'dashed' },
  { dash: '1 5', linecap: 'round', name: 'dotted' },
  { dash: '12 4 1 4', linecap: 'round', name: 'dash-dot' },
  { dash: '4 4', name: 'fine dash' },
] as const;

/** A compared property's colour and line pattern together. */
export interface PropertySeriesStyle extends PropertyLineStyle {
  colour: string;
}

/**
 * The style for the property in comparison slot `index`.
 *
 * Slot 0 is the report the adviser opened. Beyond the fifth slot the palette
 * and the patterns both wrap rather than running out — a sixth line drawn in
 * the muted tick colour, which is what the chart used to fall back to, is a
 * line the reader cannot attribute to anything.
 */
export function propertySeriesStyle(
  theme: CashFlowChartTheme,
  index: number,
): PropertySeriesStyle {
  const slot = ((index % PROPERTY_LINE_STYLES.length) + PROPERTY_LINE_STYLES.length)
    % PROPERTY_LINE_STYLES.length;
  const palette = theme.property.length ? theme.property : FALLBACK.property;
  return {
    ...PROPERTY_LINE_STYLES[slot],
    colour: palette[slot % palette.length] ?? FALLBACK.property[slot],
  };
}

/** Resolve the whole palette against an element's computed styles. */
export function resolveChartTheme(element: Element | null): CashFlowChartTheme {
  if (!element) return FALLBACK;
  const token = (name: string, fallback: string) => readTokenColor(element, name, fallback);
  return {
    // `--card` rather than `--background`: the chart sits on a card, and on the
    // dark theme the two differ enough that the wrong one reads as a hole.
    surface: token('--card', FALLBACK.surface),
    grid: token('--border', FALLBACK.grid),
    axisLine: token('--border', FALLBACK.axisLine),
    tick: token('--muted-foreground', FALLBACK.tick),
    // Resolved FROM `SERIES_TOKENS`, so the map a test checks for collisions is
    // the same map the chart draws from. `rentalIncome` is deliberately not
    // `--warning`: in dark mode `--primary`, `--warning` and `--chart-1` are
    // all `43 74% 49%`, so Property Value and Rental Income drew as one gold
    // line and the legend named a colour that appeared twice.
    series: Object.fromEntries(
      (Object.keys(SERIES_TOKENS) as (keyof typeof SERIES_TOKENS)[]).map((series) => [
        series,
        token(SERIES_TOKENS[series], FALLBACK.series[series]),
      ]),
    ) as CashFlowChartTheme['series'],
    property: PROPERTY_TOKENS.map((name, index) => token(name, FALLBACK.property[index])),
  };
}

/**
 * The palette for the document's current theme.
 *
 * Re-resolved when the root element's `class` or `data-theme` changes, because
 * that is how this product switches theme and a chart that keeps yesterday's
 * greys after the switch is the same defect in a subtler form.
 */
export function useCashFlowChartTheme(): CashFlowChartTheme {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => setVersion((n) => n + 1));
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    return () => observer.disconnect();
  }, []);

  // `version` is the dependency: the tokens are not React state, so the only
  // signal that they may have changed is the observer above ticking it.
  return useMemo(
    () => resolveChartTheme(typeof document === 'undefined' ? null : document.documentElement),
    [version],
  );
}

/**
 * The colour to paint behind an exported chart.
 *
 * Read off the element rather than hard-coded, so the PNG matches the screen in
 * whichever theme the adviser is looking at. Falls back to the token surface
 * when the element reports a transparent background, because html2canvas paints
 * transparent as black.
 */
export function exportBackgroundFor(element: HTMLElement | null, theme: CashFlowChartTheme): string {
  if (!element || typeof window === 'undefined') return theme.surface;
  try {
    const resolved = getComputedStyle(element).backgroundColor;
    if (!resolved || resolved === 'transparent' || /rgba\(0,\s*0,\s*0,\s*0\)/.test(resolved)) {
      return theme.surface;
    }
    return resolved;
  } catch {
    return theme.surface;
  }
}
