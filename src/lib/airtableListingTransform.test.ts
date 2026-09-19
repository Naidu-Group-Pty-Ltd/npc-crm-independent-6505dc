import { describe, expect, it } from 'vitest';
import { projectAirtableRecord } from './airtableListingTransform';
import { INTAKE_FIELDS as F } from './airtableIntakeFields';
import {
  resolveConfidences,
  resolveListingImages,
  resolvePrice,
} from '../../supabase/functions/_shared/airtableListing.pure';

/**
 * This projection decides which of Property Intake Master's 205 columns reach
 * the dashboard, and it used to read names belonging to a different table.
 * Airtable answers `undefined` for a column that does not exist exactly as it
 * does for one that is empty, so nothing ever failed — the page just rendered
 * "Price on request" over 773 real prices. These tests pin the real names.
 */
describe('projectAirtableRecord', () => {
  const at = () => Date.parse('2026-08-02T00:00:00.000Z');
  const project = (fields: Record<string, unknown>, id = 'rec1') =>
    projectAirtableRecord({ id, fields }, at);

  it('maps the fields the dashboard actually renders', () => {
    const listing = project({
      [F.address]: '30 Callistemon Approach',
      [F.suburb]: 'Atwell',
      [F.state]: 'WA',
      [F.postcode]: '6164',
      [F.priceNumeric]: 1_599_000,
      [F.beds]: 4,
      [F.baths]: 2,
      [F.carSpaces]: 2,
      [F.propertyType]: 'residential home',
      [F.agentName]: 'Michelle',
      [F.agencyName]: 'Peak Central Property Group',
      [F.landSizeSqm]: 801,
    });

    expect(listing).toMatchObject({
      id: 'rec1',
      address: '30 Callistemon Approach',
      suburb: 'Atwell',
      state: 'WA',
      zipCode: '6164',
      // Carries the state and postcode now: `location` is composed from the
      // address parts rather than glued from `address` + `suburb`, so the one
      // string a card, a report and the geocoder all read is the complete one.
      location: '30 Callistemon Approach, Atwell WA 6164',
      addressPrecision: 'address',
      price: 1_599_000,
      beds: 4,
      bedrooms: 4,
      baths: 2,
      carSpaces: 2,
      propertyType: 'House',
      agentName: 'Michelle',
      agencyName: 'Peak Central Property Group',
      landSizeSqm: 801,
    });
  });

  it('reads the price from Price Numeric, not from a column called Price', () => {
    // `Price` does not exist on this table. Reading it returned undefined on
    // 100% of records while `Price Numeric` was populated on 773 of 1,441.
    expect(project({ Price: 900_000 }).price).toBeNull();
    expect(project({ [F.priceNumeric]: 900_000 }).price).toBe(900_000);
  });

  it('reads confidence from the six real score columns', () => {
    // `Confidence Score` does not exist; `Extraction Confidence` is populated on
    // 1,440 of 1,441 records, and the page showed "Low (0%)" for all of them.
    expect(project({ 'Confidence Score': 0.9 }).confidence).toBeNull();
    const listing = project({
      [F.extractionConfidence]: 0.91,
      [F.overallQuality]: 0.75,
      [F.addressConfidence]: 0.9,
      [F.priceConfidence]: 0.98,
      [F.specsConfidence]: 0.96,
      [F.agentConfidence]: 0.95,
    });
    expect(listing.confidence).toBe(0.91);
    expect(listing.confidences).toEqual({
      extraction: 0.91,
      overall: 0.75,
      address: 0.9,
      price: 0.98,
      specs: 0.96,
      agent: 0.95,
    });
  });

  it('keeps a confidence of exactly zero distinct from an unmeasured one', () => {
    // The old helper's `if (!confidence) return null` collapsed "certainly
    // wrong" into "not measured", which are different claims.
    expect(project({ [F.extractionConfidence]: 0 }).confidence).toBe(0);
    expect(project({}).confidence).toBeNull();
  });

  it('emits null, never a placeholder string', () => {
    // The literal 'Unknown Address' was never falsy, so every "is this missing?"
    // check downstream answered no — including the proxy's dedup pass, which
    // then treated two address-less records as the same property and deleted
    // one of them.
    const empty = project({});
    expect(empty.address).toBeNull();
    expect(empty.suburb).toBeNull();
    expect(empty.agent).toBeNull();
    expect(empty.agencyName).toBeNull();
    expect(empty.location).toBeNull();
    expect(empty.propertyType).toBeNull();
    // `title` stays a string because callers render it as a heading.
    expect(empty.title).toBe('Untitled Property');
  });

  it('treats the extractor’s literal "Unknown" as absent', () => {
    expect(project({ [F.suburb]: 'Unknown', [F.propertyType]: 'Unknown' })).toMatchObject({
      suburb: null,
      propertyType: null,
    });
  });

  it('unwraps an Airtable single-select object', () => {
    expect(
      project({ [F.propertyType]: { id: 'sel1', name: 'Duplex', color: 'orangeLight2' } })
        .propertyType,
    ).toBe('Duplex');
  });

  it('carries the untouched record through as `fields`', () => {
    const fields = { [F.address]: '1 St', Some_Unmapped_Column: 'kept' };
    expect(project(fields).fields).toEqual(fields);
  });

  it('prefers Created Time for the display date', () => {
    const listing = projectAirtableRecord(
      {
        id: 'r',
        createdTime: '2020-01-01T00:00:00.000Z',
        fields: { [F.createdTime]: '2026-06-11T07:18:31.000Z' },
      },
      at,
    );
    expect(listing.createdTime).toBe('2026-06-11T07:18:31.000Z');
    expect(listing.listedAtKnown).toBe(true);
  });

  it('flags a date it had to invent', () => {
    // The `now` fallback keeps an undated record sortable, but the UI has to be
    // able to say "date unknown" rather than "listed today".
    const listing = project({});
    expect(listing.createdTime).toBe('2026-08-02T00:00:00.000Z');
    expect(listing.listedAtKnown).toBe(false);
  });
});

/**
 * The locality columns are contaminated by batch carry-over, and the geocoder
 * downstream will confidently place a Victorian house in Queensland if handed
 * them raw.
 */
describe('projectAirtableRecord — locality reconciliation', () => {
  const at = () => Date.parse('2026-08-02T00:00:00.000Z');
  const project = (fields: Record<string, unknown>) => projectAirtableRecord({ id: 'r', fields }, at);

  it('drops a postcode that belongs to another state', () => {
    // The real record: Campbells Creek, VIC carrying 4171 — Balmoral, QLD.
    const listing = project({
      [F.address]: '5 Banya Street',
      [F.suburb]: 'Campbells Creek',
      [F.state]: 'VIC',
      [F.postcode]: '4171',
    });
    expect(listing.state).toBeNull();
    expect(listing.zipCode).toBeNull();
    expect(listing.localityTrust).toBe('conflict');
    expect(listing.suburb).toBe('Campbells Creek');
  });

  it('keeps a locality that agrees with itself', () => {
    expect(project({ [F.state]: 'VIC', [F.postcode]: '3451' })).toMatchObject({
      state: 'VIC',
      zipCode: '3451',
      localityTrust: 'record',
    });
  });
});

describe('resolvePrice', () => {
  it('leads with what the agent wrote', () => {
    // `Display Price Text` is the most populated price signal on the table
    // (1,023 of 1,441) and the only one that can express "From $1,599,000"
    // without inventing a precision the agent did not claim.
    const price = resolvePrice({ [F.priceDisplay]: 'From $1,599,000', [F.priceNumeric]: 1_599_000 });
    expect(price.display).toBe('From $1,599,000');
    expect(price.amount).toBe(1_599_000);
    expect(price.basis).toBe('numeric');
  });

  it('takes the midpoint of a quoted range so it still sorts', () => {
    const price = resolvePrice({ [F.priceMin]: 430_000, [F.priceMax]: 450_000 });
    expect(price).toMatchObject({ amount: 440_000, min: 430_000, max: 450_000, basis: 'range' });
  });

  it('falls back to Total Price', () => {
    expect(resolvePrice({ [F.totalPrice]: 849_990 })).toMatchObject({
      amount: 849_990,
      basis: 'total',
    });
  });

  it('never puts a rent in the sale price field', () => {
    // `price` feeds the map's colour tiers, suburb medians and the price-range
    // filter, all of which read it as a sale figure. $650 a week alongside
    // $1,599,000 drags every one of them.
    const price = resolvePrice({ [F.rentAmount]: 650, [F.rentPeriod]: 'Weekly' });
    expect(price.amount).toBeNull();
    expect(price.rentAmount).toBe(650);
    expect(price.rentPeriod).toBe('Weekly');
    expect(price.basis).toBe('rent');
  });

  it('rejects a figure that could not be a property price', () => {
    expect(resolvePrice({ [F.priceNumeric]: 0 }).amount).toBeNull();
    expect(resolvePrice({ [F.priceNumeric]: 9_000_000_000 }).amount).toBeNull();
  });

  it('records that only a display string was available', () => {
    expect(resolvePrice({ [F.priceDisplay]: 'Contact Agent' })).toMatchObject({
      display: 'Contact Agent',
      amount: null,
      basis: 'display',
    });
  });

  it('has nothing to say about an empty record', () => {
    expect(resolvePrice({})).toMatchObject({ display: null, amount: null, basis: null });
  });
});

describe('resolveConfidences', () => {
  it('normalises a percentage to a fraction', () => {
    expect(resolveConfidences({ [F.extractionConfidence]: 91 }).extraction).toBe(0.91);
  });

  it('returns null for every score on a record that carries none', () => {
    expect(resolveConfidences({})).toEqual({
      extraction: null,
      overall: null,
      address: null,
      price: null,
      specs: null,
      agent: null,
    });
  });
});

describe('resolveListingImages', () => {
  const attachment = (id: string, url: string) => ({ id, url, filename: `${id}.jpg` });

  it('reads the scraped URL column, not just the attachment column', () => {
    // The projection used to read `Listing Images` alone, and that column is
    // empty on every record — photographs arrive as links on a scraped page.
    const out = resolveListingImages({
      [F.listingImageUrls]: 'https://cdn.test/1.jpg\nhttps://cdn.test/2.jpg',
    });
    expect(out.candidates.map((c) => c.url)).toEqual([
      'https://cdn.test/1.jpg',
      'https://cdn.test/2.jpg',
    ]);
    expect(out.candidates.every((c) => c.origin === 'listing_url')).toBe(true);
  });

  it('puts bytes we hold ahead of a hotlink we do not', () => {
    const out = resolveListingImages({
      [F.listingImages]: [attachment('attA', 'https://airtable.test/a.jpg')],
      [F.listingImageUrls]: 'https://cdn.test/1.jpg',
    });
    expect(out.candidates.map((c) => c.origin)).toEqual(['airtable', 'listing_url']);
  });

  it('drops the primary URL when the list already carries it', () => {
    const out = resolveListingImages({
      [F.listingImageUrls]: 'https://cdn.test/1.jpg\nhttps://cdn.test/2.jpg',
      [F.primaryImageUrl]: 'https://cdn.test/1.jpg',
    });
    expect(out.candidates).toHaveLength(2);
  });

  it('still uses the primary URL when the list column is empty', () => {
    const out = resolveListingImages({ [F.primaryImageUrl]: 'https://cdn.test/hero.jpg' });
    expect(out.candidates.map((c) => c.url)).toEqual(['https://cdn.test/hero.jpg']);
  });

  it('reports the capture stamp and source verbatim', () => {
    const out = resolveListingImages({
      [F.imagesCapturedAt]: '2026-08-01T03:00:00.000Z',
      [F.imageSource]: 'Web Scrape',
      [F.imageCount]: 7,
    });
    expect(out.capturedAt).toBe('2026-08-01T03:00:00.000Z');
    expect(out.source).toBe('Web Scrape');
    expect(out.reportedCount).toBe(7);
  });

  it('says nothing rather than guessing on a record with no image data', () => {
    const out = resolveListingImages({});
    expect(out).toEqual({
      candidates: [],
      capturedAt: null,
      reportedCount: null,
      source: null,
      primaryUrl: null,
    });
  });
});

describe('projectAirtableRecord images', () => {
  it('exposes the resolved candidates and the freshness stamp', () => {
    const listing = projectAirtableRecord({
      id: 'recIMG',
      fields: {
        [F.address]: '12 Smith Street',
        [F.listingImageUrls]: 'https://cdn.test/1.jpg\nhttps://cdn.test/2.jpg',
        [F.imagesCapturedAt]: '2026-08-03T00:00:00.000Z',
        [F.imageSource]: 'Web Scrape',
      },
    });
    expect((listing.imageCandidates as unknown[]).length).toBe(2);
    expect(listing.imagesCapturedAt).toBe('2026-08-03T00:00:00.000Z');
    expect(listing.imageCandidateCount).toBe(2);
    expect(listing.imageSource).toBe('Web Scrape');
  });

  it('leaves `images` as the raw attachment array every existing caller reads', () => {
    const raw = [{ id: 'attA', url: 'https://airtable.test/a.jpg' }];
    const listing = projectAirtableRecord({ id: 'recA', fields: { [F.listingImages]: raw } });
    expect(listing.images).toBe(raw);
  });
});
