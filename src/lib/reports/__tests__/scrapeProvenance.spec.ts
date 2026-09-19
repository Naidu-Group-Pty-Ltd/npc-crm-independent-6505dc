import { describe, expect, it } from 'vitest';

import {
  provenanceNotice,
  readScrapeProvenance,
  scrapeSummaryTitle,
} from '../scrapeProvenance.pure';

describe('readScrapeProvenance', () => {
  it('reads the page flag the server already records', () => {
    expect(readScrapeProvenance({ scrapedFromPage: true }).source).toBe('page');
    expect(readScrapeProvenance({ scrapedFromPage: false }).source).toBe('search');
  });

  it('never reports a missing flag as "read from the page"', () => {
    // A response from an older deployment carries no flag, and the false
    // confidence is exactly what this module exists to remove.
    expect(readScrapeProvenance({}).source).toBe('unknown');
    expect(readScrapeProvenance(undefined).source).toBe('unknown');
    expect(readScrapeProvenance(null).readThePage).toBe(false);
    expect(readScrapeProvenance({ scrapedFromPage: 'yes' }).source).toBe('unknown');
  });

  it('reads a 0-1 confidence and refuses anything else', () => {
    expect(readScrapeProvenance({ confidence: 0.82 }).confidence).toBe(0.82);
    expect(readScrapeProvenance({ confidence: 0 }).confidence).toBe(0);
    expect(readScrapeProvenance({ confidence: 1 }).confidence).toBe(1);
    expect(readScrapeProvenance({ confidence: 42 }).confidence).toBeNull();
    expect(readScrapeProvenance({ confidence: '0.9' }).confidence).toBeNull();
    expect(readScrapeProvenance({ confidence: Number.NaN }).confidence).toBeNull();
  });
});

describe('provenanceNotice', () => {
  it('says nothing where the page was read', () => {
    expect(provenanceNotice(readScrapeProvenance({ scrapedFromPage: true }))).toBeNull();
  });

  it('warns, and names the act it wants, where the figures came from a search', () => {
    const notice = provenanceNotice(readScrapeProvenance({ scrapedFromPage: false }));
    expect(notice?.tone).toBe('caution');
    expect(notice?.body).toMatch(/check the address and the price/i);
  });

  it('warns on an unknown provenance too', () => {
    expect(provenanceNotice(readScrapeProvenance({}))?.tone).toBe('caution');
  });

  it('never claims the property is wrong, only that the source is not the page', () => {
    // It describes the SCRAPE. A sentence about the property would be a claim
    // nothing here is in a position to make.
    for (const meta of [{ scrapedFromPage: false }, {}]) {
      const notice = provenanceNotice(readScrapeProvenance(meta));
      expect(notice?.body).not.toMatch(/incorrect|wrong property|is not this property/i);
    }
  });
});

describe('scrapeSummaryTitle', () => {
  it('does not call a search-derived answer a successful scrape', () => {
    expect(scrapeSummaryTitle(readScrapeProvenance({ scrapedFromPage: true })))
      .toMatch(/listing page/i);
    expect(scrapeSummaryTitle(readScrapeProvenance({ scrapedFromPage: false })))
      .toMatch(/check the figures/i);
  });
});
