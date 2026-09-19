import { describe, expect, it } from 'vitest';
import { normaliseSegmentBreakdown } from './marketDigestSegments';

describe('normaliseSegmentBreakdown', () => {
  // Verbatim shape of market_digests.segment_breakdown as the digest tool emits it:
  // a plain narrative string per segment, with an "(ID: <uuid>)" grounding marker.
  const liveShape = {
    finance: "RBA flagged public 'fundamental' misperceptions about interest-rate and inflation dynamics as a barrier to effective monetary-policy communication (ID: 6d948df3-10e6-4e43-b48f-9e45bb417975).",
    property: 'A $10m Sydney sale by the Caddick estate fell short of $30m in creditor claims.',
  };

  it('renders the string form the digest actually returns', () => {
    const result = normaliseSegmentBreakdown(liveShape);
    expect(result).toHaveLength(2);
    expect(result[0].seg).toBe('finance');
    expect(result[0].headline).toContain('RBA flagged public');
    expect(result[0].highlights).toEqual([]);
  });

  it('strips the raw ID grounding markers from user-facing prose', () => {
    const [finance] = normaliseSegmentBreakdown(liveShape);
    expect(finance.headline).not.toContain('6d948df3');
    expect(finance.headline).not.toContain('(ID:');
    expect(finance.headline.endsWith('communication.')).toBe(true);
  });

  it('still reads the legacy structured shape', () => {
    const result = normaliseSegmentBreakdown({
      property: { headline: 'Values eased', highlights: ['Sydney -0.4%', 'Perth +0.2%'], implications: 'Watch serviceability.' },
    });
    expect(result).toEqual([
      { seg: 'property', headline: 'Values eased', highlights: ['Sydney -0.4%', 'Perth +0.2%'], implications: 'Watch serviceability.' },
    ]);
  });

  it('omits segments with no prose so the digest never shows a bare heading', () => {
    expect(normaliseSegmentBreakdown({ finance: '', property: '   ', political: {}, construction: { highlights: [] } })).toEqual([]);
  });

  it('tolerates a missing or empty breakdown', () => {
    expect(normaliseSegmentBreakdown(undefined)).toEqual([]);
    expect(normaliseSegmentBreakdown({})).toEqual([]);
  });
});
