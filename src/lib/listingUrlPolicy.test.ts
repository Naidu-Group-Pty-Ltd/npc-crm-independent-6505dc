import { describe, expect, it } from 'vitest';
import {
  classifyListingUrl,
  mayFollow,
  rankListingUrls,
} from '../../supabase/functions/_shared/listingUrlPolicy.pure';
import {
  enrichmentGap,
  enrichmentPriority,
  mayApply,
  mergeEnrichment,
  mineSpecs,
  minePrice,
  parseAudAmount,
} from '../../supabase/functions/_shared/listingEnrichment.pure';

/** All taken verbatim from the live records. */
const REAL = {
  listing: 'https://shore-property.com.au/property/13-larundel-road-city-beach-wa-6015-65803/',
  sendgrid: 'https://u80386.ct.sendgrid.net/ls/click?upn=u001.XPFC4-2B2d-2FTrpxN3',
  vaultre: 'https://socketlabs.vaultre.com.au/?ref=VksAACoTONgv0GCBFkfB',
  apemail: 'https://t.apemail.net',
  hubspot: 'https://cMs0z04.na1.hubspotlinksstarter.com/Ctc/W1+113/cMs0z04/VVnXNg2xzpqD',
  homepage: 'https://shore-property.com.au',
  search: 'https://shore-property.com.au/buy/',
};

describe('classifyListingUrl', () => {
  it('recognises a real listing page', () => {
    expect(classifyListingUrl(REAL.listing).kind).toBe('listing');
    expect(classifyListingUrl('https://www.greatoceanproperties.com.au/8300588').kind).toBe('listing');
  });

  it('recognises every tracking redirector in the corpus', () => {
    // A quarter of the links are these. They are worth following — one resolved
    // in a single hop to a real listing — but not worth scraping directly.
    for (const url of [REAL.sendgrid, REAL.vaultre, REAL.apemail, REAL.hubspot]) {
      expect(classifyListingUrl(url).kind, url).toBe('tracking');
    }
  });

  it('separates a homepage and a search page from a listing', () => {
    // Scraping either would attach the agency's hero banner to a property as
    // though it were the house.
    expect(classifyListingUrl(REAL.homepage).kind).toBe('homepage');
    expect(classifyListingUrl(REAL.search).kind).toBe('search');
  });

  it('refuses anything that is not a fetchable public page', () => {
    for (const url of [
      'https://user:pass@example.com/p',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://example.com/brochure.pdf',
      'https://example.com/photo.jpg',
      '',
      null,
    ]) {
      expect(classifyListingUrl(url).kind, String(url)).toBe('unusable');
    }
  });

  /**
   * Every private range gets its own assertion because a single one silently
   * failing is the entire risk. An earlier version of the host check anchored
   * the whole alternation with `$`, so the prefixes could only match a hostname
   * that was *exactly* `127.` — every address they existed to stop went
   * through, including the cloud metadata endpoint.
   */
  it.each([
    ['loopback name', 'http://localhost:3000/admin'],
    ['loopback v4', 'http://127.0.0.1/'],
    ['loopback v6', 'http://[::1]/'],
    ['this-network', 'http://0.0.0.0/'],
    ['private 10/8', 'http://10.1.2.3/'],
    ['private 172.16/12', 'http://172.16.0.1/'],
    ['private 172.31/12', 'http://172.31.255.254/'],
    ['private 192.168/16', 'http://192.168.1.1/'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/iam/security-credentials/'],
    ['unique local v6', 'http://[fd00::1]/'],
    ['mdns suffix', 'http://printer.local/'],
    ['internal suffix', 'http://db.internal/'],
  ])('refuses %s', (_label, url) => {
    expect(classifyListingUrl(url).kind).toBe('unusable');
    expect(classifyListingUrl(url).reason).toBe('non-public host');
  });

  it('still admits an ordinary public address', () => {
    expect(classifyListingUrl('https://172.15.0.1/property/1').kind).not.toBe('unusable');
    expect(classifyListingUrl('https://locally-grown.com.au/property/1').kind).toBe('listing');
  });
});

describe('rankListingUrls', () => {
  it('tries a real listing before a tracker, and a tracker before a homepage', () => {
    const ranked = rankListingUrls([REAL.homepage, REAL.sendgrid, REAL.listing]);
    expect(ranked.map((r) => r.kind)).toEqual(['listing', 'tracking', 'homepage']);
  });

  it('drops unusable candidates and duplicates', () => {
    expect(rankListingUrls([REAL.listing, REAL.listing, 'not a url', null])).toHaveLength(1);
  });
});

describe('mayFollow', () => {
  it('re-validates every hop, not just the first', () => {
    // A tracking service is an open redirector by definition, so the only URL
    // ever checked is the one we started with. Following blind would let a
    // crafted link walk a server-side fetch into the private network.
    expect(mayFollow('https://example.com/p/1', REAL.sendgrid)).toMatchObject({ ok: true });
    expect(mayFollow('http://169.254.169.254/latest/meta-data/', REAL.sendgrid).ok).toBe(false);
    expect(mayFollow('http://localhost/admin', REAL.sendgrid).ok).toBe(false);
    expect(mayFollow('file:///etc/passwd', REAL.sendgrid).ok).toBe(false);
  });

  it('resolves a relative redirect', () => {
    expect(mayFollow('/property/9', 'https://example.com/go?x=1')).toMatchObject({
      ok: true,
      url: 'https://example.com/property/9',
    });
  });
});

describe('mineSpecs / minePrice', () => {
  it('reads a labelled count', () => {
    expect(mineSpecs('4 bedrooms, 2 bathrooms, 2 car spaces')).toMatchObject({
      beds: 4,
      baths: 2,
      carSpaces: 2,
    });
  });

  it('reads the bare triple agents paste from their CRM', () => {
    // Real snippet: "30 Callistemon Approach, Atwell WA\n\n4 2 2 \n\nPrivate."
    const specs = mineSpecs('30 Callistemon Approach, Atwell WA\n\n4 2 2 \n\nPrivate. Spacious.');
    expect(specs).toMatchObject({ beds: 4, baths: 2, carSpaces: 2 });
    // Trusted less than an explicit label, because it is a convention rather
    // than a statement.
    expect(specs.confidence).toBeLessThan(0.85);
  });

  it('does not read loose digits out of prose as a bedroom count', () => {
    expect(mineSpecs('Unit 3 of 12 in a 1970s block').beds).toBeUndefined();
  });

  it('keeps the qualifier the agent wrote', () => {
    expect(minePrice('Selling fast from $566K in a booming location')).toMatchObject({
      display: 'from $566K',
      amount: 566_000,
    });
    expect(minePrice('From $1,599,000 ')).toMatchObject({ amount: 1_599_000 });
    expect(minePrice('$430,000 - $450,000').display).toBe('$430,000 - $450,000');
  });

  it('has nothing to say about text with no price', () => {
    expect(minePrice('Please reach out to your BDM for more information.').confidence).toBe(0);
  });
});

describe('parseAudAmount', () => {
  it('reads the shorthands', () => {
    expect(parseAudAmount('$566K')).toBe(566_000);
    expect(parseAudAmount('$1.59m')).toBe(1_590_000);
    expect(parseAudAmount('$1,599,000')).toBe(1_599_000);
    expect(parseAudAmount('$9,000,000,000')).toBeUndefined();
  });
});

describe('enrichmentGap / enrichmentPriority', () => {
  const complete = {
    hasImages: true,
    hasPrice: true,
    hasAddress: true,
    hasCoordinates: true,
    hasAgentContact: true,
    hasSpecs: true,
  };

  it('scores a complete record at zero', () => {
    expect(enrichmentGap(complete)).toBe(0);
  });

  it('weights images highest, because that is the largest gap', () => {
    expect(enrichmentGap({ ...complete, hasImages: false })).toBeGreaterThan(
      enrichmentGap({ ...complete, hasPrice: false }),
    );
  });

  it('discounts a record about to be pruned upstream', () => {
    // Airtable removes these at 30 days and the cache mirrors it, so enriching a
    // 29-day-old listing buys a day of benefit.
    const gap = enrichmentGap({ ...complete, hasImages: false });
    expect(enrichmentPriority(gap, 1)).toBeGreaterThan(enrichmentPriority(gap, 29));
    expect(enrichmentPriority(gap, 60)).toBeGreaterThan(0);
  });
});

describe('mayApply', () => {
  const airtableHas = (field: string) => field === 'beds' || field === 'postcode';

  it('fills a hole', () => {
    expect(mayApply('baths', 2, { airtableHas })).toBe(true);
  });

  it('never overwrites a value Airtable already has', () => {
    expect(mayApply('beds', 5, { airtableHas })).toBe(false);
  });

  it('replaces a locality only when the record contradicted itself', () => {
    // The one case where the record is known to be wrong: state and postcode
    // that cannot both be true. 193 of 1,293 records are in this state.
    expect(mayApply('postcode', '3451', { airtableHas })).toBe(false);
    expect(mayApply('postcode', '3451', { airtableHas, localityDisputed: true })).toBe(true);
  });

  it('never replaces an address, disputed or not', () => {
    // A wrong address propagates into dedup, geocoding and generated PDFs.
    const hasAddress = () => true;
    expect(mayApply('address', '1 New St', { airtableHas: hasAddress, localityDisputed: true })).toBe(false);
  });

  it('treats an empty value as nothing to apply', () => {
    for (const value of [null, undefined, '']) {
      expect(mayApply('baths', value, { airtableHas })).toBe(false);
    }
  });
});

describe('mergeEnrichment', () => {
  const at = '2026-08-03T00:00:00.000Z';

  it('keeps a field a later stage did not mention', () => {
    // A scrape that failed must not erase what mining found.
    const merged = mergeEnrichment(
      { beds: 3 },
      { beds: { src: 'mined', conf: 0.6, at } },
      {},
      {},
    );
    expect(merged.values).toEqual({ beds: 3 });
  });

  it('lets a more confident claim win', () => {
    const merged = mergeEnrichment(
      { beds: 3 },
      { beds: { src: 'mined', conf: 0.6, at } },
      { beds: 6 },
      { beds: { src: 'scraped', conf: 0.9, at } },
    );
    expect(merged.values.beds).toBe(6);
    expect(merged.provenance.beds.src).toBe('scraped');
  });

  it('refuses a less confident claim', () => {
    const merged = mergeEnrichment(
      { beds: 6 },
      { beds: { src: 'scraped', conf: 0.9, at } },
      { beds: 3 },
      { beds: { src: 'mined', conf: 0.6, at } },
    );
    expect(merged.values.beds).toBe(6);
  });

  it('ignores an empty incoming value', () => {
    const merged = mergeEnrichment({ beds: 6 }, {}, { beds: null, baths: '' }, {});
    expect(merged.values).toEqual({ beds: 6 });
  });
});
