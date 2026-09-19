/**
 * Icon pack: the curated vector vocabulary the design agent places by NAME
 * (the edge function expands names into these paths — the model never emits
 * raw path data it could hallucinate).
 */
import { describe, it, expect } from 'vitest';
import { ICON_PACK, ICON_NAMES, ICON_VIEWBOX, iconToVectorProps } from '../iconPack';

describe('ICON_PACK', () => {
  it('has a usable, deduplicated vocabulary', () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
    for (const name of ICON_NAMES) {
      expect(name).toMatch(/^[a-z0-9-]+$/);
      const paths = ICON_PACK[name];
      expect(paths.length).toBeGreaterThan(0);
      for (const d of paths) expect(d.length).toBeGreaterThan(4);
    }
  });

  it('covers the pictograms common in property reports', () => {
    for (const expected of ['building', 'map-pin', 'calendar', 'file-text', 'trend-up', 'check', 'bed', 'bath', 'car', 'dollar', 'phone', 'mail']) {
      expect(ICON_NAMES).toContain(expected);
    }
  });
});

describe('iconToVectorProps', () => {
  it('expands a name into stroke-glyph vector props', () => {
    const props = iconToVectorProps('map-pin', '#F5A623');
    expect(props?.viewBox).toBe(ICON_VIEWBOX);
    expect(props?.paths.every((p) => p.fill === 'none' && p.stroke === '#F5A623' && p.strokeWidth === 2)).toBe(true);
  });

  it('returns null for unknown names', () => {
    expect(iconToVectorProps('not-an-icon')).toBeNull();
  });
});
