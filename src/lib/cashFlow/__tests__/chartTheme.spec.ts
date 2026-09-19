/**
 * Two lines on one chart must not be the same colour.
 *
 * The Cash Flow trends chart drew Property Value from `--primary` and Rental
 * Income from `--warning`. In the light theme those differ. In the dark theme
 * — which is what this product ships — `--primary`, `--warning` and `--chart-1`
 * are all `43 74% 49%`, so the two series were one gold line and the legend
 * named a colour that appeared twice.
 *
 * That is not something reading the code shows you: both sides are semantic
 * tokens, both are correct in isolation, and the collision lives in a
 * stylesheet. So the assertion is made against the stylesheet, for every theme
 * it defines.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PROPERTY_LINE_STYLES,
  PROPERTY_TOKENS,
  SERIES_TOKENS,
  TREND_SERIES,
  YIELD_SERIES,
  propertySeriesStyle,
  resolveChartTheme,
  toCssColor,
} from '../chartTheme';
import { COMPARISON_TOTAL_REPORTS } from '../comparisonCandidates.pure';

const TOKENS = readFileSync(
  path.resolve(__dirname, '../../../styles/tokens.css'),
  'utf8',
);

/**
 * The custom properties in force for a theme.
 *
 * `.dark` overrides `:root`, and anything it does not redefine is inherited —
 * which is the whole reason the collision existed: the `--chart-*` scale is
 * defined once and `--primary` is redefined to one of its values.
 */
function themeTokens(theme: 'light' | 'dark'): Record<string, string> {
  const values: Record<string, string> = {};
  const blocks = [...TOKENS.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const [, selector, body] of blocks) {
    const isDark = /\.dark\b/.test(selector);
    const isRoot = /:root\b/.test(selector) && !isDark;
    if (!(isRoot || (theme === 'dark' && isDark))) continue;
    for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      values[name] = value.trim();
    }
  }
  return values;
}

describe('the stylesheet this is asserted against', () => {
  it('defines the tokens the charts use, in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const tokens = themeTokens(theme);
      for (const name of [...Object.values(SERIES_TOKENS), ...PROPERTY_TOKENS]) {
        expect(tokens[name], `${name} is not defined for the ${theme} theme`).toBeTruthy();
      }
    }
  });

  it('still has the collision the series assignment had to route around', () => {
    // If this ever stops being true the constraint has relaxed, not vanished —
    // and the test above is what proves the assignment is still safe.
    const dark = themeTokens('dark');
    expect(dark['--primary']).toBe(dark['--warning']);
  });
});

/** The series that share one chart, and therefore may not share a colour. */
function clashesWithin(theme: 'light' | 'dark', group: readonly (keyof typeof SERIES_TOKENS)[]) {
  const tokens = themeTokens(theme);
  const byColour = new Map<string, string[]>();
  for (const series of group) {
    const name = SERIES_TOKENS[series];
    const colour = tokens[name];
    byColour.set(colour, [...(byColour.get(colour) ?? []), `${series} (${name})`]);
  }
  return [...byColour.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([colour, names]) => `${colour}: ${names.join(' + ')}`);
}

describe('no two lines on one chart share a colour', () => {
  it.each(['light', 'dark'] as const)('on the trends chart, %s theme', (theme) => {
    expect(clashesWithin(theme, TREND_SERIES), 'two series would draw as one line').toEqual([]);
  });

  it.each(['light', 'dark'] as const)('on the yield chart, %s theme', (theme) => {
    expect(clashesWithin(theme, YIELD_SERIES), 'two series would draw as one line').toEqual([]);
  });
});

describe('no two compared properties share a colour', () => {
  it.each(['light', 'dark'] as const)('in the %s theme', (theme) => {
    const tokens = themeTokens(theme);
    const colours = PROPERTY_TOKENS.map((name) => tokens[name]);
    expect(new Set(colours).size, `${colours.join(', ')}`).toBe(PROPERTY_TOKENS.length);
  });

  it('never uses --chart-1, which is --primary by another name', () => {
    expect(PROPERTY_TOKENS).not.toContain('--chart-1');
    expect(themeTokens('dark')['--chart-1']).toBe(themeTokens('dark')['--primary']);
  });
});

describe('turning a token into a colour', () => {
  it('wraps a bare triple, which is how the tokens are stored', () => {
    // Recharts writes colours into SVG presentation attributes, where `var()`
    // is not resolved — so a bare `43 74% 49%` has to become `hsl(43 74% 49%)`
    // before it reaches an attribute.
    expect(toCssColor('43 74% 49%', '#000')).toBe('hsl(43 74% 49%)');
  });

  it('passes through anything that is already a colour', () => {
    expect(toCssColor('#ff0000', '#000')).toBe('#ff0000');
    expect(toCssColor('rgb(1, 2, 3)', '#000')).toBe('rgb(1, 2, 3)');
    expect(toCssColor('hsl(0 0% 0%)', '#000')).toBe('hsl(0 0% 0%)');
  });

  it('falls back on an empty token rather than emitting hsl()', () => {
    expect(toCssColor('', '#abcdef')).toBe('#abcdef');
    expect(toCssColor('   ', '#abcdef')).toBe('#abcdef');
  });
});

describe('with no document to read', () => {
  it('returns a complete palette rather than nothing', () => {
    // A chart drawn during a test render or before hydration still needs every
    // colour; an undefined stroke is an invisible line.
    const theme = resolveChartTheme(null);
    expect(theme.surface).toBeTruthy();
    expect(theme.grid).toBeTruthy();
    expect(theme.tick).toBeTruthy();
    expect(theme.property).toHaveLength(PROPERTY_TOKENS.length);
    for (const colour of Object.values(theme.series)) expect(colour).toBeTruthy();
  });

  it('gives the fallbacks distinct series colours too', () => {
    const { series } = resolveChartTheme(null);
    const distinct = new Set([
      series.propertyValue, series.equity, series.loanBalance,
      series.rentalIncome, series.cashFlow,
    ]);
    expect(distinct.size).toBe(5);
  });
});

/**
 * A comparison's five properties must be tellable apart WITHOUT the colour.
 *
 * The chart drew one solid line and four identical `5 5` dashes, so hue was
 * the only thing separating four of the five series — and the audit's
 * screenshot is what that looks like when the hues are close: five properties,
 * three readable indicators. Colour is the first thing a chart loses (a
 * projector, a greyscale print, the PNG pasted into a report, a reader with a
 * colour vision deficiency), so the pattern has to carry the identity on its
 * own.
 */
describe('property comparison line styles', () => {
  it('has one style per property a comparison can hold', () => {
    expect(PROPERTY_LINE_STYLES).toHaveLength(COMPARISON_TOTAL_REPORTS);
    expect(PROPERTY_TOKENS).toHaveLength(COMPARISON_TOTAL_REPORTS);
  });

  it('gives every property a different pattern', () => {
    // `undefined` is the solid line and is a pattern like any other, so it is
    // counted rather than filtered — two solid lines would be the same defect.
    const patterns = PROPERTY_LINE_STYLES.map((style) => `${style.dash ?? 'solid'}|${style.linecap ?? 'butt'}`);
    expect(new Set(patterns).size).toBe(PROPERTY_LINE_STYLES.length);
  });

  it('leaves exactly one solid line, for the report the adviser opened', () => {
    const solid = PROPERTY_LINE_STYLES.filter((style) => !style.dash);
    expect(solid).toHaveLength(1);
    expect(PROPERTY_LINE_STYLES[0].dash).toBeUndefined();
  });

  it('names every pattern, because a marker has to be readable without colour', () => {
    for (const style of PROPERTY_LINE_STYLES) {
      expect(style.name.trim()).not.toBe('');
    }
    expect(new Set(PROPERTY_LINE_STYLES.map((s) => s.name)).size).toBe(PROPERTY_LINE_STYLES.length);
  });

  it('keeps every period short enough to repeat inside a legend swatch', () => {
    // Recharts draws the `plainline` icon in a 32-unit viewBox and scales it
    // down. A dash array is in those units, so a pattern whose period exceeds
    // 32 draws as one unbroken segment in the key — the swatch would then say
    // "solid" for a line the chart draws dashed, which is worse than no key.
    for (const style of PROPERTY_LINE_STYLES) {
      if (!style.dash) continue;
      const period = style.dash.split(/\s+/).map(Number).reduce((sum, n) => sum + n, 0);
      expect(Number.isFinite(period)).toBe(true);
      expect(period).toBeGreaterThan(0);
      expect(period).toBeLessThanOrEqual(32);
    }
  });

  it('pairs each pattern with its own colour', () => {
    const theme = resolveChartTheme(null);
    const styles = Array.from({ length: COMPARISON_TOTAL_REPORTS }, (_, i) => propertySeriesStyle(theme, i));
    expect(new Set(styles.map((s) => s.colour)).size).toBe(COMPARISON_TOTAL_REPORTS);
    expect(styles.every((s) => Boolean(s.colour))).toBe(true);
  });

  it('wraps rather than running out', () => {
    // The chart used to fall back to the muted tick colour past the fifth
    // slot, which draws a line the reader cannot attribute to anything. The
    // cap is five, so this is defence rather than a live path — but a
    // silently unattributable line is exactly the defect being fixed.
    const theme = resolveChartTheme(null);
    const sixth = propertySeriesStyle(theme, COMPARISON_TOTAL_REPORTS);
    expect(sixth.colour).toBe(propertySeriesStyle(theme, 0).colour);
    expect(sixth.name).toBe(propertySeriesStyle(theme, 0).name);
    expect(propertySeriesStyle(theme, -1).colour).toBeTruthy();
  });
});
