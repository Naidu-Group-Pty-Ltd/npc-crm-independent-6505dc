import { describe, expect, it } from 'vitest';
import { marketPresence, MARKET_PRESENCE_TONE } from './marketPresence';

const l = (over: Record<string, unknown>) => over as never;

describe('marketPresence', () => {
  it('calls a linked, available listing on market', () => {
    expect(marketPresence(l({ listingStatus: 'Available', url: 'https://agency.com/p/1' })).presence)
      .toBe('on-market');
  });

  it('labels a rental campaign as for rent, still on market', () => {
    const badge = marketPresence(l({ listingStatus: 'Available', intent: 'Rent', url: 'https://x.com/1' }));
    expect(badge.presence).toBe('on-market');
    expect(badge.label).toBe('For rent');
  });

  it('calls an email-only listing off market — that is the industry meaning', () => {
    const badge = marketPresence(l({ listingStatus: 'Available', url: null }));
    expect(badge.presence).toBe('off-market');
    expect(badge.explanation).toMatch(/off market/i);
  });

  it('treats an unknown status with no link as off market, not as an error state', () => {
    expect(marketPresence(l({ listingStatus: 'Unknown', url: null })).presence).toBe('off-market');
  });

  it('accepts the secondary web-links field as evidence of a campaign', () => {
    expect(marketPresence(l({ listingStatus: 'Available', url: null, webLinks: 'https://x.com/2' })).presence)
      .toBe('on-market');
  });

  it.each([
    ['Sold', 'sold'],
    ['SOLD', 'sold'],
    ['Under Offer', 'under-offer'],
    ['Under Contract', 'under-offer'],
    ['Coming Soon', 'coming-soon'],
    ['Leased', 'leased'],
  ])('lets lifecycle status %s override the link derivation → %s', (status, presence) => {
    expect(marketPresence(l({ listingStatus: status, url: 'https://x.com/3' })).presence).toBe(presence);
  });

  it('does not read a non-URL string as a campaign link', () => {
    expect(marketPresence(l({ listingStatus: 'Available', url: 'see attached flyer' })).presence)
      .toBe('off-market');
  });

  it('has a tone entry for every presence it can return', () => {
    for (const status of ['Available', 'Sold', 'Under Offer', 'Coming Soon', 'Leased', 'Unknown']) {
      for (const url of ['https://x.com/4', null]) {
        const badge = marketPresence(l({ listingStatus: status, url }));
        expect(MARKET_PRESENCE_TONE[badge.presence]).toBeTruthy();
      }
    }
  });
});
