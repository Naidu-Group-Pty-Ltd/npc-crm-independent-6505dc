import { describe, expect, it } from 'vitest';

import { AURORA_GOLD_PALETTE, PALETTES, resolvePalette } from './palettes';

describe('resolvePalette', () => {
  it('resolves valid palette names case-insensitively', () => {
    expect(resolvePalette('OCEAN')).toEqual(PALETTES.ocean);
  });

  it.each([{}, [], true, 1])('falls back for a non-string palette hint: %j', (hint) => {
    expect(resolvePalette(hint)).toEqual(AURORA_GOLD_PALETTE);
  });
});
