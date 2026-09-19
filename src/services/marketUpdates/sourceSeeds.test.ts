import { describe, expect, it } from 'vitest';
import { marketSourceSeeds } from './sourceSeeds';

describe('Market Updates source registry', () => {
  it('contains exactly 20 stable unique source keys', () => {
    const keys = marketSourceSeeds.map(source => source.source_key);
    expect(keys).toHaveLength(20);
    expect(new Set(keys).size).toBe(20);
    expect(keys.every(Boolean)).toBe(true);
  });

  it('contains usable configuration or a truthful disabled state', () => {
    for (const source of marketSourceSeeds) {
      expect(source.display_name).not.toBe('');
      expect(source.primary_url).toMatch(/^https:\/\//);
      expect(source.enabled || Boolean(source.extraction_policy['disabled_reason'])).toBeTruthy();
    }
  });
});
