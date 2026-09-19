import { describe, expect, it } from 'vitest';
import type { PropertyListing } from '@/lib/airtable';
import {
  BASEMAP_CATALOG,
  buildHeatModel,
  calibrateHeatMax,
  computePriceTiers,
  describeHeatLegend,
  escapeHtml,
  formatCompactAud,
  formatFullAud,
  getStoredListingPoint,
  groupByCoordinate,
  resolveStack,
  stepStackIndex,
  describeGeocodePrecision,
  heatGeometryForZoom,
  listingSetSignature,
  listingTimestamp,
  priceTier,
  propertyGlyph,
  PROPERTY_GLYPHS,
  quantile,
  summariseStack,
  type StackMember,
  type PriceTier,
  type WeightedListing,
} from '@/lib/listingsMap';

function makeListing(overrides: Partial<PropertyListing> = {}): PropertyListing {
  return {
    id: overrides.id ?? 'rec1',
    title: 'Listing',
    price: null,
    location: '',
    bedrooms: null,
    bathrooms: null,
    propertyType: 'House',
    listingDate: '',
    status: 'active',
    confidence: null,
    source: 'test',
    description: '',
    images: [],
    agent: '',
    features: [],
    ...overrides,
  } as PropertyListing;
}

function weighted(listings: PropertyListing[]): WeightedListing[] {
  return listings.map((listing, index) => ({
    listing,
    point: { lat: -33.86 + index * 0.01, lng: 151.2 + index * 0.01 },
  }));
}

describe('getStoredListingPoint', () => {
  it('accepts numeric and string coordinates', () => {
    expect(getStoredListingPoint(makeListing({ latitude: -33.87, longitude: 151.2 }))).toEqual({
      lat: -33.87,
      lng: 151.2,
    });
    expect(getStoredListingPoint(makeListing({ latitude: '-33.87', longitude: '151.2' }))).toEqual({
      lat: -33.87,
      lng: 151.2,
    });
  });

  it('rejects missing, non-numeric and out-of-range values', () => {
    expect(getStoredListingPoint(makeListing())).toBeNull();
    expect(getStoredListingPoint(makeListing({ latitude: '', longitude: '' }))).toBeNull();
    expect(getStoredListingPoint(makeListing({ latitude: 'abc', longitude: '151' }))).toBeNull();
    expect(getStoredListingPoint(makeListing({ latitude: 99, longitude: 151 }))).toBeNull();
    expect(getStoredListingPoint(makeListing({ latitude: -33, longitude: 999 }))).toBeNull();
  });

  it('rejects the 0/0 null-island sentinel', () => {
    expect(getStoredListingPoint(makeListing({ latitude: 0, longitude: 0 }))).toBeNull();
  });
});

describe('price tiers', () => {
  it('needs at least four priced listings before banding', () => {
    expect(computePriceTiers([100, 200, 300])).toBeNull();
    expect(computePriceTiers([])).toBeNull();
  });

  it('splits prices into quartile bands', () => {
    const tiers = computePriceTiers([100, 200, 300, 400, 500]);
    expect(tiers).not.toBeNull();
    expect(priceTier(100, tiers)).toBe('low');
    expect(priceTier(250, tiers)).toBe('mid');
    expect(priceTier(350, tiers)).toBe('high');
    expect(priceTier(500, tiers)).toBe('top');
  });

  it('marks unpriced listings as unknown regardless of banding', () => {
    const tiers = computePriceTiers([100, 200, 300, 400]);
    expect(priceTier(null, tiers)).toBe('unknown');
    expect(priceTier(0, tiers)).toBe('unknown');
    expect(priceTier(undefined, null)).toBe('unknown');
  });

  it('ignores zero and negative prices when banding', () => {
    const tiers = computePriceTiers([0, -5, 100, 200, 300, 400]);
    expect(tiers?.q1).toBeGreaterThan(0);
  });
});

describe('summariseStack', () => {
  const member = (price: number | null, tier: PriceTier): StackMember => ({ price, tier });

  it('reports the median price and the band the median sits in', () => {
    const summary = summariseStack([
      member(400_000, 'low'),
      member(800_000, 'mid'),
      member(1_200_000, 'high'),
    ]);
    expect(summary.count).toBe(3);
    expect(summary.median).toBe(800_000);
    expect(summary.medianTier).toBe('mid');
    expect(summary.unpriced).toBe(0);
  });

  it('takes the cheaper of the two middle members on an even split', () => {
    const summary = summariseStack([
      member(400_000, 'low'),
      member(600_000, 'low'),
      member(1_000_000, 'high'),
      member(1_400_000, 'top'),
    ]);
    expect(summary.median).toBe(800_000);
    expect(summary.medianTier).toBe('low');
  });

  it('ignores unpriced members in the median but still counts them', () => {
    const summary = summariseStack([
      member(500_000, 'low'),
      member(null, 'unknown'),
      member(900_000, 'mid'),
      member(0, 'unknown'),
    ]);
    expect(summary.count).toBe(4);
    expect(summary.unpriced).toBe(2);
    expect(summary.median).toBe(700_000);
  });

  it('has no median at all when nothing in the cluster carries a price', () => {
    const summary = summariseStack([member(null, 'unknown'), member(null, 'unknown')]);
    expect(summary.median).toBeNull();
    expect(summary.medianTier).toBe('unknown');
    expect(summary.unpriced).toBe(2);
  });

  it('returns the band mix in ramp order, omitting empty bands', () => {
    const summary = summariseStack([
      member(1_500_000, 'top'),
      member(400_000, 'low'),
      member(420_000, 'low'),
      member(1_600_000, 'top'),
    ]);
    expect(summary.mix.map((m) => m.tier)).toEqual(['low', 'top']);
    expect(summary.mix.map((m) => m.share)).toEqual([0.5, 0.5]);
  });

  it('survives an empty cluster', () => {
    expect(summariseStack([])).toEqual({
      count: 0,
      median: null,
      medianTier: 'unknown',
      mix: [],
      unpriced: 0,
    });
  });
});

describe('propertyGlyph', () => {
  it('maps the common portal vocabularies onto a glyph', () => {
    expect(propertyGlyph('House')).toBe('house');
    expect(propertyGlyph('Townhouse')).toBe('house');
    expect(propertyGlyph('Villa')).toBe('house');
    expect(propertyGlyph('Apartment')).toBe('apartment');
    expect(propertyGlyph('Unit/Apartment')).toBe('apartment');
    expect(propertyGlyph('Vacant Land')).toBe('land');
    expect(propertyGlyph('Semi-Rural Acreage')).toBe('land');
    expect(propertyGlyph('Retail')).toBe('commercial');
  });

  it('falls back to the generic glyph when the type says nothing', () => {
    expect(propertyGlyph('Unknown')).toBe('property');
    expect(propertyGlyph('')).toBe('property');
    expect(propertyGlyph(null)).toBe('property');
    expect(propertyGlyph(undefined)).toBe('property');
    expect(propertyGlyph('Retirement Living')).toBe('property');
  });

  it('resolves mixed types by specificity rather than word order', () => {
    // A strata word beats a structure word, a trade word beats both, and a
    // structure beats a bare parcel.
    expect(propertyGlyph('Apartment Block')).toBe('apartment');
    expect(propertyGlyph('Commercial Land')).toBe('commercial');
    expect(propertyGlyph('House and Land')).toBe('house');
    expect(propertyGlyph('Residential Land')).toBe('land');
  });

  it('does not match a vocabulary word buried inside another word', () => {
    expect(propertyGlyph('Landscaped Estate')).toBe('property');
  });

  it('only ever returns a glyph the pin renderer knows about', () => {
    for (const type of ['House', 'Unit', 'Land', 'Office', 'Gibberish', '']) {
      expect(PROPERTY_GLYPHS).toContain(propertyGlyph(type));
    }
  });
});

describe('quantile', () => {
  it('interpolates between samples', () => {
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
    expect(quantile([], 0.5)).toBe(0);
  });
});

describe('buildHeatModel', () => {
  it('weights every listing equally for density', () => {
    const model = buildHeatModel(weighted([makeListing({ id: 'a', price: 100 }), makeListing({ id: 'b', price: 10_000_000 })]), 'density');
    expect(model.points.map((p) => p.intensity)).toEqual([1, 1]);
    expect(model.scale).toBeNull();
  });

  it('uses a log scale for price so one trophy listing cannot flatten the ramp', () => {
    const rows = weighted([
      makeListing({ id: 'a', price: 500_000 }),
      makeListing({ id: 'b', price: 1_000_000 }),
      makeListing({ id: 'c', price: 50_000_000 }),
    ]);
    const model = buildHeatModel(rows, 'price');
    const [cheap, mid, trophy] = model.points.map((p) => p.intensity);

    expect(trophy).toBeCloseTo(1, 5);
    expect(cheap).toBeLessThan(mid);
    expect(mid).toBeLessThan(trophy);
    // Linear weighting would put the middle listing at ~0.02 of the top.
    expect(mid).toBeGreaterThan(0.3);
    expect(model.scale).toEqual({
      min: 500_000,
      max: 50_000_000,
      median: 1_000_000,
      sampled: 3,
    });
  });

  it('gives unpriced listings the floor weight rather than dropping them', () => {
    const rows = weighted([
      makeListing({ id: 'a', price: 500_000 }),
      makeListing({ id: 'b', price: 900_000 }),
      makeListing({ id: 'c', price: null }),
    ]);
    const model = buildHeatModel(rows, 'price');
    expect(model.points).toHaveLength(3);
    expect(model.points[2].intensity).toBeGreaterThan(0);
    expect(model.points[2].intensity).toBeLessThan(model.points[0].intensity);
  });

  it('falls back to uniform weighting when no listing carries the metric', () => {
    const rows = weighted([makeListing({ id: 'a' }), makeListing({ id: 'b' })]);
    expect(buildHeatModel(rows, 'price').points.every((p) => p.intensity === 1)).toBe(true);
    expect(buildHeatModel(rows, 'recency').points.every((p) => p.intensity === 1)).toBe(true);
  });

  it('scores the newest listing hottest for recency', () => {
    const rows = weighted([
      makeListing({ id: 'old', listingDate: '2024-01-01T00:00:00.000Z' }),
      makeListing({ id: 'new', listingDate: '2026-01-01T00:00:00.000Z' }),
    ]);
    const model = buildHeatModel(rows, 'recency');
    expect(model.points[1].intensity).toBeGreaterThan(model.points[0].intensity);
    expect(model.points[1].intensity).toBeCloseTo(1, 5);
  });

  it('returns an empty model for no rows', () => {
    expect(buildHeatModel([], 'price')).toEqual({
      metric: 'price',
      points: [],
      scale: null,
      minCeiling: 4,
    });
  });

  it('asks for a multi-point ceiling on density and a single-weight ceiling when weighted', () => {
    const rows = weighted([
      makeListing({ id: 'a', price: 500_000 }),
      makeListing({ id: 'b', price: 5_000_000 }),
    ]);
    expect(buildHeatModel(rows, 'density').minCeiling).toBeGreaterThan(1);
    expect(buildHeatModel(rows, 'price').minCeiling).toBeCloseTo(1, 5);
    // A metric with no usable data degrades to uniform weighting *and* its ceiling.
    expect(buildHeatModel(weighted([makeListing({ id: 'x' })]), 'price').minCeiling).toBe(
      buildHeatModel(weighted([makeListing({ id: 'x' })]), 'density').minCeiling,
    );
  });
});

describe('describeHeatLegend', () => {
  it('reports real currency bounds for the price metric', () => {
    const rows = weighted([
      makeListing({ id: 'a', price: 450_000 }),
      makeListing({ id: 'b', price: 900_000 }),
      makeListing({ id: 'c', price: 2_100_000 }),
    ]);
    const legend = describeHeatLegend(buildHeatModel(rows, 'price'));
    expect(legend.title).toBe('Price intensity');
    expect(legend.lowLabel).toBe(formatCompactAud(450_000));
    expect(legend.highLabel).toBe(formatCompactAud(2_100_000));
  });

  it('reports relative ages for the recency metric', () => {
    const now = Date.parse('2026-07-31T00:00:00.000Z');
    const rows = weighted([
      makeListing({ id: 'a', listingDate: '2026-07-01T00:00:00.000Z' }),
      makeListing({ id: 'b', listingDate: '2026-07-30T00:00:00.000Z' }),
    ]);
    const legend = describeHeatLegend(buildHeatModel(rows, 'recency'), now);
    expect(legend.title).toBe('Listing freshness');
    expect(legend.lowLabel).toBe('1 month ago');
    expect(legend.highLabel).toBe('1 day ago');
  });

  it('falls back to a density description', () => {
    const legend = describeHeatLegend(buildHeatModel(weighted([makeListing()]), 'density'));
    expect(legend.title).toBe('Listing density');
    expect(legend.midLabel).toBeNull();
  });
});

describe('describeGeocodePrecision', () => {
  it('lets rooftop and street-level pins stand unqualified', () => {
    expect(describeGeocodePrecision('ROOFTOP')).toEqual({ tier: 'exact', note: null });
    expect(describeGeocodePrecision('RANGE_INTERPOLATED').tier).toBe('street');
    expect(describeGeocodePrecision('GEOMETRIC_CENTER').tier).toBe('street');
  });

  it('captions a suburb centroid as approximate — the map must not imply rooftop', () => {
    const described = describeGeocodePrecision('APPROXIMATE');
    expect(described.tier).toBe('area');
    expect(described.note).toMatch(/approximate/i);
  });

  it('treats missing or unrecognised precision as unknown, without a caption', () => {
    expect(describeGeocodePrecision(null)).toEqual({ tier: 'unknown', note: null });
    expect(describeGeocodePrecision('rooftop').tier).toBe('exact');
    expect(describeGeocodePrecision('SOMETHING_NEW').tier).toBe('unknown');
  });

  it("reads the geocoding chain's provider-qualified word by its suffix", () => {
    // The chain writes `<provider>:<precision>` for every provider but Google
    // (`precisionLabel`), and Google's own words stay Google's. A suburb
    // centroid from the ABS is approximate exactly as Google's was.
    expect(describeGeocodePrecision('nominatim:address')).toEqual({ tier: 'exact', note: null });
    expect(describeGeocodePrecision('nominatim:street')).toEqual({ tier: 'street', note: null });
    expect(describeGeocodePrecision('abs_locality:locality').tier).toBe('area');
    expect(describeGeocodePrecision('abs_locality:locality').note).toMatch(/approximate/i);
    expect(describeGeocodePrecision('nominatim:postcode').tier).toBe('area');
    expect(describeGeocodePrecision('nominatim:something').tier).toBe('unknown');
  });
});


describe('heatGeometryForZoom', () => {
  it('grows the radius with zoom so the surface stays legible', () => {
    const country = heatGeometryForZoom(4, 'balanced');
    const suburb = heatGeometryForZoom(15, 'balanced');
    expect(suburb.radius).toBeGreaterThan(country.radius);
    expect(suburb.blur).toBeGreaterThan(country.blur);
  });

  it('clamps to a sane pixel range at both extremes', () => {
    expect(heatGeometryForZoom(0, 'tight').radius).toBeGreaterThanOrEqual(5);
    expect(heatGeometryForZoom(22, 'wide').radius).toBeLessThanOrEqual(62);
  });

  it('keeps national-scale hotspots tight so a city cannot bleed into the sea', () => {
    // At zoom 4 all of Melbourne is a couple of pixels; a generous radius put
    // its blob in Bass Strait. Country zooms trade gradient for placement.
    const country = heatGeometryForZoom(4, 'balanced');
    const regional = heatGeometryForZoom(8, 'balanced');
    expect(country.radius).toBeLessThanOrEqual(10);
    expect(country.blur).toBeLessThan(country.radius);
    expect(regional.radius).toBeGreaterThan(country.radius);
  });

  it('scales with the focus setting', () => {
    const tight = heatGeometryForZoom(12, 'tight').radius;
    const balanced = heatGeometryForZoom(12, 'balanced').radius;
    const wide = heatGeometryForZoom(12, 'wide').radius;
    expect(tight).toBeLessThan(balanced);
    expect(balanced).toBeLessThan(wide);
  });

  it('tolerates a non-finite zoom', () => {
    expect(Number.isFinite(heatGeometryForZoom(Number.NaN, 'balanced').radius)).toBe(true);
  });
});

describe('calibrateHeatMax', () => {
  it('returns a neutral ceiling with no points', () => {
    expect(calibrateHeatMax([], 24, 'balanced')).toBe(1);
  });

  it('never returns a ceiling below the heaviest single point', () => {
    const max = calibrateHeatMax([{ x: 10, y: 10, weight: 0.8 }], 24, 'balanced');
    expect(max).toBeGreaterThanOrEqual(0.8);
  });

  it('rises when points pile into the same screen cell', () => {
    const spread = Array.from({ length: 20 }, (_, i) => ({ x: i * 200, y: 0, weight: 1 }));
    const stacked = Array.from({ length: 20 }, () => ({ x: 5, y: 5, weight: 1 }));
    expect(calibrateHeatMax(stacked, 24, 'balanced')).toBeGreaterThan(
      calibrateHeatMax(spread, 24, 'balanced'),
    );
  });

  it('saturates more readily with a wider focus', () => {
    const points = Array.from({ length: 40 }, (_, i) => ({
      x: (i % 8) * 4,
      y: Math.floor(i / 8) * 4,
      weight: 1,
    }));
    const tight = calibrateHeatMax(points, 24, 'tight');
    const wide = calibrateHeatMax(points, 24, 'wide');
    expect(wide).toBeLessThanOrEqual(tight);
  });

  it('honours the dataset-wide ceiling so zooming into a cheap pocket stays cool', () => {
    // One lightweight point on screen; the dataset elsewhere reaches 1.0.
    const local = [{ x: 40, y: 40, weight: 0.3 }];
    expect(calibrateHeatMax(local, 24, 'balanced')).toBeCloseTo(0.3, 5);
    expect(calibrateHeatMax(local, 24, 'balanced', 1)).toBe(1);
  });

  it('keeps an isolated density point below the density ceiling', () => {
    const lone = [{ x: 40, y: 40, weight: 1 }];
    expect(calibrateHeatMax(lone, 24, 'balanced', 4)).toBe(4);
  });

  it('still lets a dense cluster exceed the dataset ceiling', () => {
    const stacked = Array.from({ length: 12 }, () => ({ x: 5, y: 5, weight: 1 }));
    expect(calibrateHeatMax(stacked, 24, 'balanced', 4)).toBeGreaterThan(4);
  });

  it('ignores non-finite projections', () => {
    const max = calibrateHeatMax(
      [
        { x: Number.NaN, y: 0, weight: 1 },
        { x: 4, y: 4, weight: 0.5 },
      ],
      24,
      'balanced',
    );
    expect(Number.isFinite(max)).toBe(true);
  });
});

describe('listingTimestamp', () => {
  it('prefers the listing date and falls back through the other stamps', () => {
    expect(listingTimestamp(makeListing({ listingDate: '2026-02-01T00:00:00.000Z' }))).toBe(
      Date.parse('2026-02-01T00:00:00.000Z'),
    );
    expect(
      listingTimestamp(makeListing({ listingDate: '', receivedAt: '2026-03-01T00:00:00.000Z' })),
    ).toBe(Date.parse('2026-03-01T00:00:00.000Z'));
    expect(listingTimestamp(makeListing({ listingDate: 'not-a-date' }))).toBeNull();
    expect(listingTimestamp(makeListing())).toBeNull();
  });

  it('accepts Date instances', () => {
    const when = new Date('2026-04-01T00:00:00.000Z');
    expect(listingTimestamp(makeListing({ receivedAt: when }))).toBe(when.getTime());
  });
});

describe('listingSetSignature', () => {
  it('is stable for the same set and changes when the set changes', () => {
    const a = listingSetSignature([{ id: 'x' }, { id: 'y' }]);
    expect(listingSetSignature([{ id: 'x' }, { id: 'y' }])).toBe(a);
    expect(listingSetSignature([{ id: 'x' }])).not.toBe(a);
    expect(listingSetSignature([{ id: 'x' }, { id: 'z' }])).not.toBe(a);
  });
});

describe('formatting', () => {
  it('rejects missing and non-positive prices', () => {
    expect(formatCompactAud(null)).toBeNull();
    expect(formatCompactAud(0)).toBeNull();
    expect(formatFullAud(undefined)).toBeNull();
    expect(formatFullAud(Number.NaN)).toBeNull();
  });

  it('produces compact and full currency labels', () => {
    expect(formatCompactAud(1_250_000)).toMatch(/1\.3M|1\.2M/);
    expect(formatFullAud(1_250_000)).toContain('1,250,000');
  });

  it('escapes marker label HTML', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
    );
  });
});

describe('basemap catalogue', () => {
  const definitions = Object.values(BASEMAP_CATALOG);
  const allUrls = definitions.flatMap((def) => [def.url, def.labelsUrl ?? '']).filter(Boolean);

  it('never serves a CARTO basemap — anonymous CARTO tiles are "API KEY REQUIRED" watermarks', () => {
    for (const url of allUrls) {
      expect(url).not.toContain('cartocdn');
      expect(url).not.toContain('carto.com');
    }
  });

  it('never points at openstreetmap.org tile servers, which block apps by policy', () => {
    for (const url of allUrls) {
      expect(url).not.toContain('tile.openstreetmap.org');
    }
  });

  it('carries no credential of any kind — every basemap is keyless', () => {
    // A browser tile token is billable and a VITE_ value is inlined into the
    // bundle, so a keyed provider here would spend the prime's vendor account
    // for anyone who reads the page source. The security gate refuses it and
    // this is the assertion that keeps one from creeping back in.
    for (const url of allUrls) {
      expect(url).not.toMatch(/access_token|api_?key|\bkey=|apikey/i);
    }
  });

  it('serves every basemap from keyless Esri services over https', () => {
    for (const def of definitions) {
      expect(def.url.startsWith('https://server.arcgisonline.com/')).toBe(true);
      // Esri's scheme is row-before-column; {x}/{y} here fetches the
      // transpose, which draws the wrong part of the world rather than erroring.
      expect(def.url).toContain('/tile/{z}/{y}/{x}');
      // No {s} subdomain shards — Esri serves from the one host.
      expect(def.url).not.toContain('{s}');
    }
  });

  it('pairs the unlabelled dark canvas with its reference layer', () => {
    expect(BASEMAP_CATALOG.dark.labelsUrl).toContain('World_Dark_Gray_Reference');
    expect(BASEMAP_CATALOG.dark.dark).toBe(true);
    expect(BASEMAP_CATALOG.light.dark).toBe(false);
  });

  it('declares each basemap\u2019s real native ceiling so Leaflet upscales instead of 404ing', () => {
    expect(BASEMAP_CATALOG.light.maxNativeZoom).toBe(19);
    expect(BASEMAP_CATALOG.dark.maxNativeZoom).toBe(16);
    expect(BASEMAP_CATALOG.satellite.maxNativeZoom).toBe(18);
  });

  it('attributes every provider, which the licences require', () => {
    for (const def of definitions) {
      expect(def.attribution).toContain('Esri');
      expect(def.attribution.length).toBeGreaterThan(10);
    }
  });
});

describe('groupByCoordinate — the only honest aggregation', () => {
  const at = (r: { lat: number; lng: number }) => r;

  it('puts properties that share a coordinate behind one mark', () => {
    // 104 Grubb Avenue, Traralgon: twenty-six listings, one point. Before
    // grouping, twenty-five of them were under the top pin and unclickable.
    const rows = Array.from({ length: 26 }, () => ({ lat: -38.1837981, lng: 146.5164362 }));
    const groups = groupByCoordinate(rows, at);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(26);
    expect(groups[0].lat).toBe(-38.1837981);
  });

  it('never merges properties that are merely NEAR each other', () => {
    // This is the whole point. Proximity clustering drew one mark for these
    // two and put it somewhere neither of them is.
    const groups = groupByCoordinate(
      [
        { lat: -37.8136, lng: 144.9631 }, // Melbourne
        { lat: -42.8821, lng: 147.3272 }, // Hobart
      ],
      at,
    );
    expect(groups).toHaveLength(2);
    // Every mark stands on one of the inputs — the property they represent.
    for (const g of groups) {
      expect([-37.8136, -42.8821]).toContain(g.lat);
    }
  });

  it('groups to about a metre, so one address never splits in two', () => {
    // Two geocodes of the same address agree far more closely than 1e-5.
    const groups = groupByCoordinate(
      [
        { lat: -37.81360, lng: 144.96310 },
        { lat: -37.813601, lng: 144.963101 },
      ],
      at,
    );
    expect(groups).toHaveLength(1);
  });

  it('keeps genuinely different addresses apart', () => {
    const groups = groupByCoordinate(
      [
        { lat: -37.8136, lng: 144.9631 },
        { lat: -37.8146, lng: 144.9631 }, // ~110m away
      ],
      at,
    );
    expect(groups).toHaveLength(2);
  });

  it('preserves input order inside each group, so the caller sort survives', () => {
    const rows: Array<{ lat: number; lng: number; id: string }> = [
      { lat: -37.81, lng: 144.96, id: 'dearest' },
      { lat: -37.81, lng: 144.96, id: 'cheapest' },
    ];
    const groups = groupByCoordinate(rows, (r) => r);
    expect(groups[0].members.map((m) => m.id)).toEqual(['dearest', 'cheapest']);
  });

  it('drops non-finite coordinates rather than grouping them together', () => {
    const groups = groupByCoordinate(
      [
        { lat: Number.NaN, lng: 144.96 },
        { lat: -37.81, lng: Number.POSITIVE_INFINITY },
        { lat: -37.81, lng: 144.96 },
      ],
      at,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(1);
  });

  it('survives an empty set', () => {
    expect(groupByCoordinate([], at)).toEqual([]);
  });

  it('every group sits exactly on one of its own members', () => {
    // The property the old cluster bubble could never guarantee.
    const rows = [
      { lat: -31.9523, lng: 115.8613 },
      { lat: -27.4698, lng: 153.0251 },
      { lat: -27.4698, lng: 153.0251 },
      { lat: -37.8136, lng: 144.9631 },
    ];
    for (const g of groupByCoordinate(rows, at)) {
      expect(rows.some((r) => r.lat === g.lat && r.lng === g.lng)).toBe(true);
    }
  });
});

/**
 * Twenty-six properties share `104 Grubb Avenue, Traralgon`, and this
 * arithmetic is the only route to twenty-five of them. An off-by-one at either
 * end strips a property off a mark that promises twenty-six, silently.
 */
describe('stepStackIndex — reaching every property under one mark', () => {
  it('steps forward', () => {
    expect(stepStackIndex(0, 1, 26)).toBe(1);
    expect(stepStackIndex(24, 1, 26)).toBe(25);
  });

  it('wraps forward off the end', () => {
    expect(stepStackIndex(25, 1, 26)).toBe(0);
  });

  it('wraps backward off the start — the sign trap', () => {
    // `(0 - 1) % 26` is -1 in JavaScript, which indexes nothing. The backwards
    // arrow at the first member must reach the last one, not an empty slot.
    expect(stepStackIndex(0, -1, 26)).toBe(25);
  });

  it('steps backward', () => {
    expect(stepStackIndex(3, -1, 26)).toBe(2);
  });

  it('reaches every member exactly once going each way', () => {
    for (const delta of [1, -1]) {
      const seen = new Set<number>();
      let at = 0;
      for (let i = 0; i < 26; i += 1) {
        seen.add(at);
        at = stepStackIndex(at, delta, 26);
      }
      expect(seen.size).toBe(26);
      expect(at).toBe(0);
    }
  });

  it('is a no-op on a stack of one', () => {
    expect(stepStackIndex(0, 1, 1)).toBe(0);
    expect(stepStackIndex(0, -1, 1)).toBe(0);
  });

  it('never returns an index that would read past the stack', () => {
    for (const [index, delta, total] of [
      [-1, 1, 5],
      [9, 1, 5],
      [0, 1, 0],
      [0, 1, -3],
      [1.5, 1, 5],
      [0, Number.NaN, 5],
    ] as Array<[number, number, number]>) {
      const next = stepStackIndex(index, delta, total);
      expect(Number.isInteger(next)).toBe(true);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThan(Math.max(1, total));
    }
  });
});

/**
 * The reported corpus, reduced to the shape that matters: twenty-six listings
 * on `104 Grubb Avenue, Traralgon`, a builder release of sixteen on the Armstrong
 * Creek suburb centroid, and singles elsewhere.
 */
describe('resolveStack — what is standing under the open pin', () => {
  const at = (r: { id: string; lat: number; lng: number }) => ({ lat: r.lat, lng: r.lng });
  const traralgon = Array.from({ length: 26 }, (_, i) => ({
    id: `t${i}`,
    lat: -38.1838,
    lng: 146.5164,
  }));
  const rows = [
    ...traralgon,
    { id: 'armstrong-a', lat: -38.2373, lng: 144.374 },
    { id: 'armstrong-b', lat: -38.2373, lng: 144.374 },
    { id: 'solo', lat: -33.9091, lng: 151.2221 },
  ];

  it('returns every property sharing the point, in input order', () => {
    const stack = resolveStack(rows, traralgon[7], at);
    expect(stack.members).toHaveLength(26);
    expect(stack.index).toBe(7);
    expect(stack.members.map((m) => m.id)).toEqual(traralgon.map((m) => m.id));
  });

  it('never reaches across to a different coordinate', () => {
    const stack = resolveStack(rows, rows[26], at);
    expect(stack.members.map((m) => m.id)).toEqual(['armstrong-a', 'armstrong-b']);
  });

  it('returns a stack of one for a property standing alone', () => {
    const stack = resolveStack(rows, rows[28], at);
    expect(stack.members).toHaveLength(1);
    expect(stack.index).toBe(0);
  });

  it('is empty when nothing is open', () => {
    expect(resolveStack(rows, null, at)).toEqual({ members: [], index: -1 });
    expect(resolveStack(rows, undefined, at)).toEqual({ members: [], index: -1 });
  });

  it('refuses a stack around a point nothing can draw', () => {
    // NaN cannot be keyed, so a pager built on it would offer steps to
    // nowhere. An empty stack draws no pager at all, which is correct.
    const stack = resolveStack(rows, { id: 'x', lat: Number.NaN, lng: 151 }, at);
    expect(stack.members).toHaveLength(0);
    expect(stack.index).toBe(-1);
  });

  it('reports -1 for a record that is not in the list', () => {
    const stack = resolveStack(rows, { id: 'ghost', lat: -38.1838, lng: 146.5164 }, at);
    expect(stack.members).toHaveLength(26);
    expect(stack.index).toBe(-1);
  });

  it('walks every one of the twenty-six and comes back', () => {
    // The two functions together are the only route to the twenty-five
    // properties that are not on top. Exercised as the reader exercises them.
    const stack = resolveStack(rows, traralgon[0], at);
    const visited = new Set<string>();
    let index = stack.index;
    for (let i = 0; i < stack.members.length; i += 1) {
      visited.add(stack.members[index].id);
      index = stepStackIndex(index, 1, stack.members.length);
    }
    expect(visited.size).toBe(26);
    expect(index).toBe(stack.index);
  });

  it('agrees with the marker layer about which mark holds what', () => {
    // The pager must offer exactly the members the pin counted, or the badge
    // says 26 and the pager walks a different set.
    for (const group of groupByCoordinate(rows, at)) {
      for (const member of group.members) {
        expect(resolveStack(rows, member, at).members).toEqual(group.members);
      }
    }
  });
});
