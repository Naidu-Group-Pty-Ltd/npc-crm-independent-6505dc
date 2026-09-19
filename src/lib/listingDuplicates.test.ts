import { describe, expect, it } from 'vitest';
import {
  dedupeListings,
  listingDuplicateKey,
  type DedupableListing,
} from '../../supabase/functions/_shared/listingDuplicates.pure';

/**
 * Every record below was read out of `listings_cache` on 2026-08-19. The two
 * blocks are the two things this rule has to tell apart, and getting the second
 * one wrong deletes nine real listings.
 */

const listing = (over: Partial<DedupableListing> & { id: string }): DedupableListing => ({
  propertyType: 'House',
  ...over,
});

/** The same property, written four times by four passes over one email. */
const YILLOWRA: DedupableListing[] = [
  listing({ id: 'rec13OFeA8GW4Xal9', fullAddress: '14 Yillowra St, Auburn NSW 2144, Australia', priceDisplay: '1380000', createdTime: '2026-08-04T22:34:47Z', imageCandidates: [1, 2, 3, 4] }),
  listing({ id: 'recrC0C9oTXI2BqSa', fullAddress: '14 Yillowra St, Auburn NSW 2144, Australia', priceDisplay: '1380000', createdTime: '2026-08-04T22:37:34Z', imageCandidates: [1, 2, 3, 4] }),
  listing({ id: 'recO6W0tSn0NnFVdm', fullAddress: '14 Yillowra St, Auburn NSW 2144, Australia', priceDisplay: '1380000', createdTime: '2026-08-04T22:41:28Z', imageCandidates: [1, 2, 3, 4] }),
  listing({ id: 'rec1ZRVM0b3GNr4R0', fullAddress: '14 Yillowra St, Auburn NSW 2144, Australia', priceDisplay: '1380000', createdTime: '2026-08-04T22:44:53Z', imageCandidates: [1, 2, 3, 4] }),
];

/**
 * ELEVEN DIFFERENT PROPERTIES. The street number never got extracted, so they
 * all carry the suburb as their address — written one second apart from a
 * single pass over a single email, at wildly different prices.
 */
const CITY_BEACH: DedupableListing[] = [
  listing({ id: 'recSHpjztzdgkdxgD', fullAddress: 'City Beach WA 6015', priceDisplay: '$3.4-$4M', createdTime: '2026-07-24T05:43:54Z' }),
  listing({ id: 'recizkixZPQXEtr3Y', fullAddress: 'City Beach WA 6015', priceDisplay: '$4-$5Ms', createdTime: '2026-07-24T05:43:55Z' }),
  listing({ id: 'recO0Z9J7iClHCC3J', fullAddress: 'City Beach WA 6015', priceDisplay: 'Mid $3Ms', createdTime: '2026-07-24T05:43:56Z' }),
  listing({ id: 'recUhatYWjLWzcrP5', fullAddress: 'City Beach WA, Australia', priceDisplay: '$18-20M', createdTime: '2026-07-24T05:50:45Z' }),
  listing({ id: 'reculbjJYfnbl8Yc3', fullAddress: 'City Beach WA 6015', priceDisplay: '$1.65M', propertyType: 'Villa', createdTime: '2026-07-24T06:08:25Z' }),
  listing({ id: 'recabdGE1PC9sVtyA', fullAddress: 'City Beach WA 6015, Australia', priceDisplay: 'Pre-Register your interest', propertyType: 'Land', createdTime: '2026-07-24T06:13:47Z' }),
];

describe('listingDuplicateKey', () => {
  it('identifies a street-numbered listing', () => {
    expect(listingDuplicateKey(YILLOWRA[0])).not.toBeNull();
  });

  it('refuses an address with no street number — the City Beach guard', () => {
    for (const record of CITY_BEACH) {
      expect(listingDuplicateKey(record)).toBeNull();
    }
  });

  it('handles the address forms this corpus actually contains', () => {
    for (const address of [
      '35-37 Harrow Rd, Auburn NSW 2144, Australia',
      'unit 4206/59 Queen St, Auburn NSW 2144, Australia',
      '351E Hume Hwy, Bankstown NSW 2200, Australia',
      '12 Nancarrow Ave, Ryde NSW 2112, Australia',
    ]) {
      expect(listingDuplicateKey(listing({ id: 'x', fullAddress: address, priceDisplay: 'Contact Agent' }))).not.toBeNull();
    }
  });

  it('refuses a record with no price text', () => {
    // Two records for one address that disagree on price are two different
    // things; one with no price at all cannot be matched on price either.
    expect(listingDuplicateKey(listing({ id: 'x', fullAddress: '12 Nancarrow Ave, Ryde NSW 2112', priceDisplay: null }))).toBeNull();
  });

  it('separates two records that agree on address but not on price', () => {
    const a = listing({ id: 'a', fullAddress: '9 Marion St, Auburn NSW 2144', priceDisplay: '$620,000' });
    const b = listing({ id: 'b', fullAddress: '9 Marion St, Auburn NSW 2144', priceDisplay: '$650,000' });
    expect(listingDuplicateKey(a)).not.toBe(listingDuplicateKey(b));
  });

  it('separates two records that agree on address and price but not on specification', () => {
    const a = listing({ id: 'a', fullAddress: '59 Queen St, Auburn NSW 2144', priceDisplay: 'Contact Agent', beds: 2 });
    const b = listing({ id: 'b', fullAddress: '59 Queen St, Auburn NSW 2144', priceDisplay: 'Contact Agent', beds: 3 });
    expect(listingDuplicateKey(a)).not.toBe(listingDuplicateKey(b));
  });
});

describe('dedupeListings', () => {
  it('collapses one property written four times', () => {
    const result = dedupeListings(YILLOWRA);
    expect(result.listings).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(3);
    expect(result.listings[0].duplicateCount).toBe(3);
  });

  it('leaves eleven different City Beach properties alone', () => {
    const result = dedupeListings(CITY_BEACH);
    expect(result.listings).toHaveLength(CITY_BEACH.length);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it('keeps the copy with the most photographs', () => {
    // The four `7 New St` records hold 12, 12, 9 and 12 images. A reader should
    // get the twelve-photograph gallery, not whichever was written last.
    const newSt = [
      listing({ id: 'a', fullAddress: '7 New St, Auburn NSW 2144, Australia', priceDisplay: '1798000', createdTime: '2026-08-04T22:34:46Z', imageCandidates: Array(12).fill(0) }),
      listing({ id: 'b', fullAddress: '7 New St, Auburn NSW 2144, Australia', priceDisplay: '1798000', createdTime: '2026-08-04T22:44:51Z', imageCandidates: Array(9).fill(0) }),
    ];
    expect(dedupeListings(newSt).listings[0].id).toBe('a');
  });

  it('falls back to the most recently filed when the galleries match', () => {
    expect(dedupeListings(YILLOWRA).listings[0].id).toBe('rec1ZRVM0b3GNr4R0');
  });

  it('keeps the survivor in the place the first copy held', () => {
    const mixed = [
      listing({ id: 'other-1', fullAddress: '1 First St, Auburn NSW 2144', priceDisplay: 'A' }),
      ...YILLOWRA,
      listing({ id: 'other-2', fullAddress: '2 Second St, Auburn NSW 2144', priceDisplay: 'B' }),
    ];
    expect(dedupeListings(mixed).listings.map((l) => l.id)).toEqual([
      'other-1',
      'rec1ZRVM0b3GNr4R0',
      'other-2',
    ]);
  });

  it('is a no-op on a set with nothing to merge', () => {
    const unique = [
      listing({ id: 'a', fullAddress: '1 First St, Auburn NSW 2144', priceDisplay: 'A' }),
      listing({ id: 'b', fullAddress: '2 Second St, Auburn NSW 2144', priceDisplay: 'B' }),
    ];
    const result = dedupeListings(unique);
    expect(result.listings).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
    expect(result.listings[0].duplicateCount).toBeUndefined();
  });

  it('survives empty and absent input', () => {
    expect(dedupeListings([]).listings).toEqual([]);
    expect(dedupeListings(undefined).listings).toEqual([]);
    expect(dedupeListings(null).listings).toEqual([]);
  });

  it('never merges a record it cannot identify', () => {
    const unidentifiable = [
      listing({ id: 'a', fullAddress: null, priceDisplay: 'Contact Agent' }),
      listing({ id: 'b', fullAddress: null, priceDisplay: 'Contact Agent' }),
      listing({ id: 'c' }),
    ];
    expect(dedupeListings(unidentifiable).listings).toHaveLength(3);
  });
});
