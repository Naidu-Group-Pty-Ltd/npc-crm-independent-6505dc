import { describe, expect, it } from 'vitest';
import { compileAnchorPatterns, MAX_ANCHOR_MATCH_LENGTH } from '../adapters/anchorPatterns.ts';

describe('anchor pattern safety', () => {
  it('preserves bounded and simple path matching', () => {
    const patterns = compileAnchorPatterns(['^/news/[a-z-]{1,80}$', '/articles/.+$']);

    expect(patterns).toHaveLength(2);
    expect(patterns.some((pattern) => pattern.test('/NEWS/market-update'))).toBe(true);
    expect(patterns.some((pattern) => pattern.test('/articles/rates-rise'))).toBe(true);
  });

  it('rejects catastrophic and otherwise complex patterns', () => {
    expect(compileAnchorPatterns(['(a+)+$', '(a|aa)+$', '(?=news).*', '(a)\\1'])).toEqual([]);
  });

  it('limits the number and length of configured patterns', () => {
    expect(compileAnchorPatterns(Array.from({ length: 20 }, (_, i) => `news-${i}`))).toHaveLength(8);
    expect(compileAnchorPatterns(['a'.repeat(129)])).toEqual([]);
    expect(MAX_ANCHOR_MATCH_LENGTH).toBe(2_048);
  });
});
