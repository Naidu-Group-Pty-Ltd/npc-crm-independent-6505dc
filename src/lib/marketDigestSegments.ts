import type { MarketDigest24h } from '@/types/marketUpdates';

export interface NormalisedDigestSegment {
  seg: string;
  headline: string;
  highlights: string[];
  implications: string;
}

/** Strips the raw "(ID: <uuid>)" grounding markers the digest model appends to its prose. */
const clean = (text?: string | null) =>
  (text ?? '').replace(/\s*\(ID:\s*[^)]*\)/gi, '').replace(/\s+/g, ' ').trim();

/**
 * The digest tool schema declares `segment_breakdown` as one narrative string per
 * segment, while earlier rows stored `{ headline, highlights, implications }`.
 * Reading only the structured shape rendered every segment as a bare heading with
 * no body, so accept both and drop segments that carry no prose at all.
 */
export function normaliseSegmentBreakdown(
  breakdown: MarketDigest24h['segment_breakdown'] | undefined,
): NormalisedDigestSegment[] {
  return Object.entries(breakdown ?? {})
    .map(([seg, value]) => {
      const structured = typeof value === 'string' ? { headline: value } : (value ?? {});
      return {
        seg,
        headline: clean(structured.headline),
        highlights: (Array.isArray(structured.highlights) ? structured.highlights : []).map(clean).filter(Boolean),
        implications: clean(structured.implications),
      };
    })
    .filter(entry => entry.headline || entry.highlights.length || entry.implications);
}
