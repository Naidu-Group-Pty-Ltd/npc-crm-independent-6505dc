/**
 * The reported case is the first test: a 356px tooltip with 435px of campaign
 * name in it, printing out through its own right border.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  chartTooltipContentStyle,
  chartTooltipContentStyleWithin,
  chartTooltipWrapperStyle,
} from '../tooltipStyle';

describe('chartTooltipContentStyle', () => {
  it('lets a long label wrap', () => {
    // Recharts bakes `whiteSpace: 'nowrap'` into its own tooltip style and
    // merges contentStyle over the top. Without this property the label cannot
    // break, and a width then clamps the box while the text keeps going.
    expect(chartTooltipContentStyle.whiteSpace).toBe('normal');
  });

  it('breaks a token that has nowhere to wrap', () => {
    // A campaign slug with no spaces in it would otherwise overflow anyway.
    expect(chartTooltipContentStyle.overflowWrap).toBe('anywhere');
  });

  it('bounds the box', () => {
    // Wrapping alone does not stop the box growing to the label's width and
    // out of an ancestor's overflow — which is the other half of this defect.
    expect(typeof chartTooltipContentStyle.maxWidth).toBe('number');
  });

  it('draws on the semantic tokens, never a literal colour', () => {
    const values = Object.values(chartTooltipContentStyle).filter((v) => typeof v === 'string');
    for (const value of values) {
      expect(value).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
  });
});

describe('chartTooltipContentStyleWithin', () => {
  it('takes the width and keeps every other rule', () => {
    const narrow = chartTooltipContentStyleWithin(200);
    expect(narrow.maxWidth).toBe(200);
    expect(narrow.whiteSpace).toBe('normal');
    expect(narrow.overflowWrap).toBe('anywhere');
  });

  it('is why a caller cannot resize a tooltip into the old defect', () => {
    // The one `maxWidth: 320` this replaces was written inline, which is how
    // it came to carry a width and no wrapping rule. Widening now goes through
    // a function that cannot drop the rest.
    expect(chartTooltipContentStyleWithin(999).whiteSpace).toBe('normal');
  });
});

describe('chartTooltipWrapperStyle', () => {
  it('keeps the tooltip above the panel', () => {
    expect(chartTooltipWrapperStyle.zIndex).toBe(50);
  });
});

describe('the marketing panels use it', () => {
  const DIR = 'src/components/marketing';

  function tsxFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) tsxFiles(p, out);
      else if (p.endsWith('.tsx')) out.push(p);
    }
    return out;
  }

  it('declares no inline tooltip contentStyle anywhere on the surface', () => {
    // A style written at the call site is a style that is right in the one
    // place somebody looked. Every inline object here was missing the wrapping
    // rule, and two of the panels held a PRIVATE `chartTooltipStyle` const
    // that had already drifted from the other.
    const offenders: string[] = [];
    for (const file of tsxFiles(DIR)) {
      const src = readFileSync(file, 'utf8');
      if (/contentStyle=\{\{/.test(src)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
