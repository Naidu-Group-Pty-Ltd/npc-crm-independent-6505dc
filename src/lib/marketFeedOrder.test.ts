import { describe, expect, it } from 'vitest';
import { interleaveBySource } from './marketFeedOrder';

// Generic so T is inferred from the items rather than pinned by the selector.
const src = <T extends { source: string }>(i: T) => i.source;
const feed = (...sources: string[]) => sources.map((source, n) => ({ source, id: `${source}-${n}` }));

describe('interleaveBySource', () => {
  it('stops one publisher owning the top of the feed', () => {
    // Recency order alone would put six Guardian items before anything else.
    const input = feed('guardian', 'guardian', 'guardian', 'guardian', 'guardian', 'guardian', 'abc', 'apra');
    const out = interleaveBySource(input, src).map(i => i.source);
    expect(out.slice(0, 3)).toEqual(['guardian', 'abc', 'apra']);
  });

  it('keeps every item exactly once', () => {
    const input = feed('a', 'b', 'a', 'c', 'a', 'b');
    const out = interleaveBySource(input, src);
    expect(out).toHaveLength(input.length);
    expect(new Set(out.map(i => i.id))).toEqual(new Set(input.map(i => i.id)));
  });

  it('preserves recency order within a source', () => {
    const input = feed('a', 'b', 'a', 'b', 'a');
    const out = interleaveBySource(input, src).filter(i => i.source === 'a').map(i => i.id);
    expect(out).toEqual(['a-0', 'a-2', 'a-4']);
  });

  it('leads with the most recent item overall', () => {
    const input = feed('abc', 'guardian', 'guardian');
    expect(interleaveBySource(input, src)[0].id).toBe('abc-0');
  });

  it('passes through a single-source or trivial feed unchanged', () => {
    const single = feed('a', 'a', 'a');
    expect(interleaveBySource(single, src)).toEqual(single);
    expect(interleaveBySource([], src)).toEqual([]);
    expect(interleaveBySource(feed('a'), src)).toEqual(feed('a'));
  });

  it('treats a missing source name as its own bucket rather than dropping the item', () => {
    const input = [{ source: '' }, { source: '' }, { source: 'abc' }];
    expect(interleaveBySource(input, src)).toHaveLength(3);
  });
});
