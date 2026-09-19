/**
 * A clone reads a listing page through Mission Control, not through a key of
 * its own.
 *
 * `FIRECRAWL_API_KEY` is an Integrations credential no clone is provisioned
 * with, and the keyless fallback cannot stand in: measured from the production
 * egress on 19 Sep 2026, `r.jina.ai` answers **HTTP 200 with an "Access
 * Denied" body** for both realestate.com.au and domain.com.au. So the
 * credential stops travelling and the call travels — the same answer
 * `AIRTABLE_TOKEN` and the Didit application key already reached.
 *
 * The host cases here are the ones `scrape-property-listing/urlPolicy.test.ts`
 * asserts. That file is a Deno test and vitest's `include` is `src/**`, so it
 * has never run in CI — which is why they are restated somewhere that does.
 */
import { describe, expect, it } from 'vitest';

import { normalizePropertyListingUrl } from '../../../../supabase/functions/scrape-property-listing/urlPolicy';
import {
  BROKERED_PAGE_READ_PATH,
  PROPERTY_LISTING_HOSTS,
  brokeredPageReadUrl,
  isPropertyListingHost,
  pageReadOrigin,
  refusePageReadUrl,
  resolvePageReadRoute,
} from '../../../../supabase/functions/_shared/pageRead/pageReadRoute.pure';

describe('resolvePageReadRoute', () => {
  it('reads directly where this deployment holds the key', () => {
    const route = resolvePageReadRoute({
      firecrawlKey: 'fc-live', missionControlUrl: 'https://mc.example', cloneApiKey: 'k',
    });
    expect(route.via).toBe('direct');
    // A direct read spends the vendor key here, so it is metered here.
    expect(route.via === 'direct' && route.meter).toBe(true);
  });

  it('brokers where it holds no key but can reach Mission Control', () => {
    const route = resolvePageReadRoute({
      firecrawlKey: '', missionControlUrl: 'https://mc.example', cloneApiKey: 'clone-key',
    });
    expect(route.via).toBe('broker');
    // Mission Control meters the vendor call it makes. Never both ends.
    expect(route.via === 'broker' && route.meter).toBe(false);
    expect(route.via === 'broker' && route.headers['x-clone-api-key']).toBe('clone-key');
  });

  it('prefers the key it holds over the broker', () => {
    // A deployment holding the credential is one entitled to spend it, and
    // brokering there would bill the prime for the prime's own reads.
    expect(resolvePageReadRoute({
      firecrawlKey: 'fc-live', missionControlUrl: 'https://mc.example', cloneApiKey: 'k',
    }).via).toBe('direct');
  });

  it('answers `none` rather than pretending, where it has neither', () => {
    for (const input of [
      { firecrawlKey: '', missionControlUrl: '', cloneApiKey: '' },
      { firecrawlKey: null, missionControlUrl: 'https://mc.example', cloneApiKey: '' },
      { firecrawlKey: undefined, missionControlUrl: '', cloneApiKey: 'k' },
    ]) {
      const route = resolvePageReadRoute(input);
      expect(route.via).toBe('none');
      expect(route.via === 'none' && route.why).toMatch(/FIRECRAWL_API_KEY/);
    }
  });

  it('trims a path off the Mission Control base and says it did', () => {
    // `…/api` composed `…/api/api/public/listings/tables` on the Airtable
    // broker and produced a 404 that read as the vendor's.
    const route = resolvePageReadRoute({
      firecrawlKey: '', missionControlUrl: 'https://mc.example/api/', cloneApiKey: 'k',
    });
    expect(route.via === 'broker' && route.missionControlUrl).toBe('https://mc.example');
    expect(route.via === 'broker' && route.trimmedPath).toBe('/api');
  });

  it('composes the brokered URL only from a resolved origin', () => {
    const route = resolvePageReadRoute({
      firecrawlKey: '', missionControlUrl: 'https://mc.example/api', cloneApiKey: 'k',
    });
    expect(brokeredPageReadUrl(route as never))
      .toBe(`https://mc.example${BROKERED_PAGE_READ_PATH}`);
  });
});

describe('pageReadOrigin', () => {
  it('hands back an unparseable setting rather than blanking it', () => {
    // An empty string reads as "not configured" and sends an operator to the
    // wrong remedy.
    expect(pageReadOrigin('not a url').origin).toBe('not a url');
    expect(pageReadOrigin('').origin).toBe('');
  });
});

describe('refusePageReadUrl', () => {
  it('admits the portals the allow-list names', () => {
    for (const host of PROPERTY_LISTING_HOSTS) {
      expect(refusePageReadUrl(`https://www.${host}/property/1`), host).toBeNull();
    }
  });

  it('refuses private, metadata and unrelated targets', () => {
    for (const target of [
      'http://127.0.0.1/admin',
      'https://localhost/admin',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.12/internal',
      'https://example.com/property',
      'https://domain.com.au.evil.example/property',
    ]) {
      expect(refusePageReadUrl(target), target).not.toBeNull();
    }
  });

  it('refuses non-HTTPS and authority-confusion URLs', () => {
    for (const target of [
      'http://www.domain.com.au/property',
      'https://domain.com.au:8443/property',
      'https://domain.com.au@evil.example/property',
    ]) {
      expect(refusePageReadUrl(target), target).not.toBeNull();
    }
  });

  it('says nothing was given rather than refusing a host', () => {
    expect(refusePageReadUrl('')).toMatch(/no URL/i);
    expect(refusePageReadUrl('   ')).toMatch(/no URL/i);
  });
});

describe('one host list, two enforcers', () => {
  it('agrees with the normaliser the scraper already used', () => {
    // The broker cannot be allowed to accept a host the caller's own
    // normaliser would refuse, so both read `PROPERTY_LISTING_HOSTS`.
    const cases = [
      'www.domain.com.au/listing/123',
      'https://agent.realestate.com.au/property?id=123',
      'https://example.com/property',
      'https://domain.com.au.evil.example/property',
      'http://www.domain.com.au/property',
      'https://domain.com.au:8443/property',
    ];
    for (const raw of cases) {
      let normaliserAccepts = true;
      try { normalizePropertyListingUrl(raw); } catch { normaliserAccepts = false; }
      expect(refusePageReadUrl(raw) === null, raw).toBe(normaliserAccepts);
    }
  });

  it('keeps the normaliser producing what it always produced', () => {
    expect(normalizePropertyListingUrl('www.domain.com.au/listing/123'))
      .toBe('https://www.domain.com.au/listing/123');
    expect(normalizePropertyListingUrl('https://agent.realestate.com.au/property?id=123'))
      .toBe('https://agent.realestate.com.au/property?id=123');
  });

  it('is the NARROW list, not the permissive one', () => {
    // `listingUrlPolicy.pure.ts` is deliberately permissive about hosts; its
    // own header says widening these widens what can be billed. A brokered
    // read spends the prime's credits, so it uses this list.
    expect(PROPERTY_LISTING_HOSTS.length).toBe(8);
    expect(isPropertyListingHost('greatoceanproperties.com.au')).toBe(false);
  });
});
