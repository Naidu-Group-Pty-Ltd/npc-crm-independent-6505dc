import { describe, expect, it } from 'vitest';

import { hasListingUrl, resolveListingUrl } from '../listingLinks.pure';

describe('resolveListingUrl', () => {
  it('passes an absolute link through', () => {
    expect(resolveListingUrl('https://gattonrealestate.com.au/listings/residential_sale-R2-5248091-gatton'))
      .toBe('https://gattonrealestate.com.au/listings/residential_sale-R2-5248091-gatton');
  });

  it('completes a bare host, which is what made the buttons do nothing', () => {
    // `window.open('gattonrealestate.com.au/…')` resolves against the command
    // centre's own origin and opens a path this app does not serve.
    expect(resolveListingUrl('gattonrealestate.com.au/listings/x')).toBe(
      'https://gattonrealestate.com.au/listings/x',
    );
    expect(resolveListingUrl('www.realestate.com.au/property-house-nsw-pokolbin-152226780')).toBe(
      'https://www.realestate.com.au/property-house-nsw-pokolbin-152226780',
    );
  });

  it('keeps http where a source wrote it', () => {
    expect(resolveListingUrl('http://example.com/a')).toBe('http://example.com/a');
  });

  it('refuses a scheme a listing link may not use', () => {
    // These arrive from a mailbox by way of an extraction model, and
    // `window.open` treats some of them as navigation.
    expect(resolveListingUrl('javascript:alert(1)')).toBeNull();
    expect(resolveListingUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(resolveListingUrl('file:///etc/passwd')).toBeNull();
  });

  it('refuses something that is not a link', () => {
    expect(resolveListingUrl('Contact the agent for details')).toBeNull();
    expect(resolveListingUrl('listings')).toBeNull();
    expect(resolveListingUrl('')).toBeNull();
    expect(resolveListingUrl('   ')).toBeNull();
    expect(resolveListingUrl(null)).toBeNull();
    expect(resolveListingUrl(undefined)).toBeNull();
    expect(resolveListingUrl(42)).toBeNull();
  });

  it('agrees with hasListingUrl, which is what decides whether a control is drawn', () => {
    // A control drawn on truthiness is a control that cannot work.
    for (const value of ['https://a.com', 'a.com/x', 'not a link', '', 'javascript:1']) {
      expect(hasListingUrl(value)).toBe(resolveListingUrl(value) !== null);
    }
  });
});
