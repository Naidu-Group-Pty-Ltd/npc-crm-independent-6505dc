import { describe, expect, it } from 'vitest';
import {
  containsWord,
  mergeExtractedData,
  parseVisionResponse,
  populatedFieldCount,
  processToStructuredPayload,
  type ExtractedPropertyData,
} from '../propertyExtraction';

const json = (value: Record<string, unknown>) => JSON.stringify(value);

describe('parseVisionResponse — value recovery', () => {
  it('recovers numbers the model returned as formatted strings', () => {
    // Every one of these was silently discarded by the old
    // `typeof x === 'number'` guards, losing correctly-read values.
    const result = parseVisionResponse(
      json({
        price: '$1,250,000',
        weeklyRent: '780',
        bedrooms: '4',
        bathrooms: '2.5',
        landSize: '1,200 sqm',
        passingCapRatePct: '6.25%',
        councilRates: '$2,100',
      }),
    )!;

    expect(result.price).toBe(1_250_000);
    expect(result.weeklyRent).toBe(780);
    expect(result.bedrooms).toBe(4);
    expect(result.bathrooms).toBe(2.5);
    expect(result.landSize).toBe(1200);
    expect(result.passingCapRatePct).toBe(6.25);
    expect(result.councilRates).toBe(2100);
  });

  it('drops null-ish strings instead of storing them as content', () => {
    const result = parseVisionResponse(
      json({ address: 'Not stated', suburb: 'N/A', zoning: '-', propertyName: 'null' }),
    )!;
    expect(result.address).toBeUndefined();
    expect(result.suburb).toBeUndefined();
    expect(result.zoning).toBeUndefined();
    expect(result.propertyName).toBeUndefined();
  });

  it('reads the JSON out of a fenced, prose-wrapped response', () => {
    const result = parseVisionResponse(
      'Here is the extraction:\n```json\n{"suburb": "Richmond", "state": "vic"}\n```\nLet me know if you need more.',
    )!;
    expect(result.suburb).toBe('Richmond');
    expect(result.state).toBe('VIC');
  });

  it('returns null — not an empty object — when the response is unreadable', () => {
    expect(parseVisionResponse('I was unable to read this document.')).toBeNull();
    expect(parseVisionResponse('')).toBeNull();
  });

  it('normalises states and postcodes', () => {
    const result = parseVisionResponse(json({ state: 'Queensland', postcode: 4000 }))!;
    expect(result.state).toBe('QLD');
    expect(result.postcode).toBe('4000');
  });

  it('rejects an invalid state or postcode rather than passing it through', () => {
    const result = parseVisionResponse(json({ state: 'Auckland', postcode: '99999' }))!;
    expect(result.state).toBeUndefined();
    expect(result.postcode).toBeUndefined();
  });

  it('scales a cap rate the model returned as a fraction', () => {
    expect(parseVisionResponse(json({ marketCapRatePct: 0.0575 }))!.marketCapRatePct).toBe(5.75);
  });

  it('drops implausible values instead of corrupting the record', () => {
    const result = parseVisionResponse(
      json({ bedrooms: 340, yearBuilt: 12, passingCapRatePct: 850, propertyManagementPercent: 400 }),
    )!;
    expect(result.bedrooms).toBeUndefined();
    expect(result.yearBuilt).toBeUndefined();
    expect(result.passingCapRatePct).toBeUndefined();
    expect(result.propertyManagementPercent).toBeUndefined();
  });

  it('normalises enum-valued fields and drops values outside the enum', () => {
    const result = parseVisionResponse(
      json({
        propertyType: 'House and Land',
        gstTreatment: 'Going Concern',
        leaseType: 'Triple-Net',
        tenure: 'Freehold',
        truckAccess: 'Excellent',
        conditionRating: 'b',
      }),
    )!;
    expect(result.propertyType).toBe('house_and_land');
    expect(result.gstTreatment).toBe('going_concern');
    expect(result.leaseType).toBe('triple_net');
    expect(result.tenure).toBe('freehold');
    expect(result.truckAccess).toBe('excellent');
    expect(result.conditionRating).toBe('B');

    expect(parseVisionResponse(json({ leaseType: 'percentage rent' }))!.leaseType).toBeUndefined();
  });

  it('parses an Australian day-first lease expiry date', () => {
    expect(parseVisionResponse(json({ leaseExpiryDate: '31/12/2029' }))!.leaseExpiryDate).toBe('2029-12-31');
  });

  it('accepts a tenant list given as a delimited string', () => {
    expect(parseVisionResponse(json({ tenantNames: 'Woolworths; Australia Post' }))!.tenantNames).toEqual([
      'Woolworths',
      'Australia Post',
    ]);
  });

  it('reads isNewBuild from a yes/no answer', () => {
    expect(parseVisionResponse(json({ isNewBuild: 'yes' }))!.isNewBuild).toBe(true);
    expect(parseVisionResponse(json({ isNewBuild: 'no' }))!.isNewBuild).toBeUndefined();
  });

  it('omits keys that did not survive coercion', () => {
    const result = parseVisionResponse(json({ price: 'unknown', suburb: 'Carlton' }))!;
    expect(Object.keys(result)).toEqual(['suburb']);
    expect(populatedFieldCount(result)).toBe(1);
  });
});

describe('mergeExtractedData', () => {
  it('keeps the first non-null value for ordinary fields', () => {
    const merged = mergeExtractedData({ price: 100 }, { price: 200, suburb: 'Carlton' });
    expect(merged.price).toBe(100);
    expect(merged.suburb).toBe('Carlton');
  });

  it('makes isNewBuild sticky once any page asserts it', () => {
    expect(mergeExtractedData({}, { isNewBuild: true }).isNewBuild).toBe(true);
    expect(mergeExtractedData({ isNewBuild: true }, { isNewBuild: false }).isNewBuild).toBe(true);
  });

  it('lets the highest-confidence asset class win, not the first one seen', () => {
    const merged = mergeExtractedData(
      { detectedAssetClass: 'residential', detectedAssetConfidence: 0.4 },
      { detectedAssetClass: 'industrial', detectedAssetConfidence: 0.95 },
    );
    expect(merged.detectedAssetClass).toBe('industrial');
    expect(merged.detectedAssetConfidence).toBe(0.95);
  });

  it('does not let a lower-confidence batch overwrite a confident answer', () => {
    const merged = mergeExtractedData(
      { detectedAssetClass: 'industrial', detectedAssetConfidence: 0.9 },
      { detectedAssetClass: 'commercial', detectedAssetConfidence: 0.5 },
    );
    expect(merged.detectedAssetClass).toBe('industrial');
  });

  it('unions tenant names across batches instead of keeping only the first page', () => {
    const merged = mergeExtractedData(
      { tenantNames: ['Woolworths'] },
      { tenantNames: ['woolworths', 'Chemist Warehouse'] },
    );
    expect(merged.tenantNames).toEqual(['Woolworths', 'Chemist Warehouse']);
  });

  it('caps the tenant union at five names', () => {
    const merged = mergeExtractedData(
      { tenantNames: ['A', 'B', 'C'] },
      { tenantNames: ['D', 'E', 'F', 'G'] },
    );
    expect(merged.tenantNames).toHaveLength(5);
  });
});

describe('containsWord', () => {
  it('matches whole words only', () => {
    expect(containsWord('12 Transway Road', 'NSW')).toBe(false);
    expect(containsWord('12 Example St, Sydney NSW', 'NSW')).toBe(true);
    expect(containsWord('Sandy Bay', 'SA')).toBe(false);
  });
});

describe('processToStructuredPayload', () => {
  it('composes a full address without duplicating parts already present', () => {
    const payload = processToStructuredPayload({
      address: '12 Example Street, Richmond VIC 3121',
      suburb: 'Richmond',
      state: 'VIC',
      postcode: '3121',
    } as ExtractedPropertyData);
    expect(payload.propertyAddress).toBe('12 Example Street, Richmond VIC 3121');
  });

  it('appends missing components to a bare street address', () => {
    const payload = processToStructuredPayload({
      address: '12 Example Street',
      suburb: 'Richmond',
      state: 'VIC',
      postcode: '3121',
    } as ExtractedPropertyData);
    expect(payload.propertyAddress).toBe('12 Example Street, Richmond VIC 3121');
  });

  it('does not drop a state that only appears as a substring of another word', () => {
    const payload = processToStructuredPayload({
      address: '5 Transway Road',
      suburb: 'Rouse Hill',
      state: 'NSW',
      postcode: '2155',
    } as ExtractedPropertyData);
    expect(payload.propertyAddress).toContain('NSW 2155');
  });

  it('answers null for a missing address, never a sentence', () => {
    // A worded absence in a value slot is truthy, so it survives every `||`
    // fallback downstream and arrives as the property's recorded address.
    expect(processToStructuredPayload({}).propertyAddress).toBeNull();
  });

  it('composes a locality-only address where no street line was read', () => {
    // 30 listings genuinely carry only a suburb. That is an address, and it is
    // not the same thing as nothing.
    const payload = processToStructuredPayload({
      suburb: 'Pokolbin', state: 'NSW', postcode: '2320',
    } as ExtractedPropertyData);
    expect(payload.propertyAddress).toBe('Pokolbin, NSW, 2320');
  });

  it('defaults isNewBuild to false', () => {
    expect(processToStructuredPayload({}).isNewBuild).toBe(false);
  });
});
