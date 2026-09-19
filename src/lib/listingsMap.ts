/**
 * Pure model helpers for the listings map.
 *
 * Everything in here is deliberately free of Leaflet/React so the maths that
 * drives pin tiers, heat weighting and heat calibration can be unit tested.
 */
import type { PropertyListing } from '@/lib/airtable';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface HeatPoint {
  lat: number;
  lng: number;
  intensity: number;
}

export type MapMode = 'pins' | 'heat' | 'hybrid';
export type HeatMetric = 'density' | 'price' | 'recency';
/** Controls both the heat radius and how aggressively the colour ramp saturates. */
export type HeatFocus = 'tight' | 'balanced' | 'wide';
export type BasemapId = 'auto' | 'light' | 'dark' | 'satellite';

export const MAP_MODES: MapMode[] = ['pins', 'heat', 'hybrid'];
export const HEAT_METRICS: HeatMetric[] = ['density', 'price', 'recency'];
export const HEAT_FOCUSES: HeatFocus[] = ['tight', 'balanced', 'wide'];
export const BASEMAPS: BasemapId[] = ['auto', 'light', 'dark', 'satellite'];

/* -------------------------------------------------------------------------- */
/* Coordinates                                                                 */
/* -------------------------------------------------------------------------- */

export function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isPlottable(lat: number | null, lng: number | null): boolean {
  if (lat === null || lng === null) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  // 0/0 is the classic "geocoder gave up" sentinel — it drops pins in the ocean.
  if (lat === 0 && lng === 0) return false;
  return true;
}

/** Coordinates already present on the source record — no lookup involved. */
/**
 * Provider `location_type` translated into a claim the interface can stand
 * behind. ROOFTOP is the address itself; RANGE_INTERPOLATED is measured along
 * the street; GEOMETRIC_CENTER is a road or building centreline; APPROXIMATE
 * is a locality centroid — the pin is in the right suburb and nothing more.
 * Only 'area' warrants a caption: street-level precision is what a map pin
 * already implies, but a suburb centroid dressed as a rooftop pin is the map
 * quietly lying, and at 148 of 957 stored geocodes it is common enough to
 * matter.
 */
export type GeocodePrecisionTier = 'exact' | 'street' | 'area' | 'unknown';

export function describeGeocodePrecision(precision: string | null | undefined): {
  tier: GeocodePrecisionTier;
  note: string | null;
} {
  const word = (precision ?? '').toUpperCase();
  // The geocoding chain writes `<provider>:<precision>` for every provider
  // but Google (`nominatim:street`, `abs_locality:locality`); Google's own
  // words are kept for Google. The suffix is the tier.
  const chained = /^[A-Z_]+:(ADDRESS|STREET|LOCALITY|POSTCODE)$/.exec(word);
  if (chained) {
    switch (chained[1]) {
      case 'ADDRESS':
        return { tier: 'exact', note: null };
      case 'STREET':
        return { tier: 'street', note: null };
      default:
        return { tier: 'area', note: 'Approximate — placed at suburb level' };
    }
  }
  switch (word) {
    case 'ROOFTOP':
      return { tier: 'exact', note: null };
    case 'RANGE_INTERPOLATED':
    case 'GEOMETRIC_CENTER':
      return { tier: 'street', note: null };
    case 'APPROXIMATE':
      return { tier: 'area', note: 'Approximate — placed at suburb level' };
    default:
      return { tier: 'unknown', note: null };
  }
}

/**
 * Why a pin is imprecise, said in terms of the RECORD rather than the provider.
 *
 * `describeGeocodePrecision` reports how well the geocoder matched. That is the
 * right answer when the record held a full address and the provider could not
 * place it — but useless when the record never had a street number to offer,
 * which is the ordinary state of 30 live listings and 68 of 124 builder lots
 * (an estate lot has no number until its plan is registered).
 *
 * Saying "approximate" about both hides the difference between "we could not
 * find it" and "nobody has told us yet", and only the second is something an
 * operator can act on.
 */
export function describeAddressCompleteness(
  precision: string | null | undefined,
): string | null {
  switch (precision) {
    case 'street':
      return 'Street known, no street number on record';
    case 'locality':
      return 'Suburb only — no street on record';
    case 'none':
      return 'No address on record';
    default:
      return null;
  }
}


export function getStoredListingPoint(listing: PropertyListing): GeoPoint | null {
  const lat = toFiniteNumber(listing.latitude);
  const lng = toFiniteNumber(listing.longitude);
  if (!isPlottable(lat, lng)) return null;
  return { lat: lat as number, lng: lng as number };
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

const compactAud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 1,
  notation: 'compact',
});

const fullAud = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

export function formatCompactAud(price: number | null | undefined): string | null {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  return compactAud.format(price);
}

export function formatFullAud(price: number | null | undefined): string | null {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  return fullAud.format(price);
}

/** Minimal HTML escaping — marker labels are injected as `divIcon` HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDayCount(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`;
  const years = Math.round(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

/* -------------------------------------------------------------------------- */
/* Listing timestamps                                                          */
/* -------------------------------------------------------------------------- */

/** Best-effort "when did this listing appear" in epoch ms, newest signal wins. */
export function listingTimestamp(listing: PropertyListing): number | null {
  const candidates: Array<unknown> = [
    listing.listingDate,
    listing.receivedAt,
    listing.createdTime,
    listing.createdAt,
  ];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === '') continue;
    const date = candidate instanceof Date ? candidate : new Date(candidate as string);
    const time = date.getTime();
    if (Number.isFinite(time) && time > 0) return time;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Price tiers (pin colouring)                                                 */
/* -------------------------------------------------------------------------- */

export type PriceTier = 'unknown' | 'low' | 'mid' | 'high' | 'top';

export interface PriceTiers {
  q1: number;
  q2: number;
  q3: number;
}

export function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * Math.min(Math.max(q, 0), 1);
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return sortedAsc[lower];
  return sortedAsc[lower] + (sortedAsc[upper] - sortedAsc[lower]) * (pos - lower);
}

export function computePriceTiers(prices: number[]): PriceTiers | null {
  const usable = prices.filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (usable.length < 4) return null;
  return {
    q1: quantile(usable, 0.25),
    q2: quantile(usable, 0.5),
    q3: quantile(usable, 0.75),
  };
}

export function priceTier(price: number | null | undefined, tiers: PriceTiers | null): PriceTier {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return 'unknown';
  if (!tiers) return 'mid';
  if (price <= tiers.q1) return 'low';
  if (price <= tiers.q2) return 'mid';
  if (price <= tiers.q3) return 'high';
  return 'top';
}

/* -------------------------------------------------------------------------- */
/* Stack summaries                                                             */
/* -------------------------------------------------------------------------- */

/** Ramp order — cheapest band first, then the band for listings with no price. */
export const PRICE_TIER_ORDER: PriceTier[] = ['low', 'mid', 'high', 'top', 'unknown'];

export interface StackMember {
  price: number | null;
  tier: PriceTier;
}

export interface TierShare {
  tier: PriceTier;
  /** Fraction of the stack sitting in this band, 0–1. */
  share: number;
}

export interface StackSummary {
  count: number;
  /** Median of the priced members, or null when nothing in the stack has a price. */
  median: number | null;
  /** Band of the member at the median, so the colour and the number always agree. */
  medianTier: PriceTier;
  /** Bands present, in ramp order, each with its share of the stack. */
  mix: TierShare[];
  /** Members carrying no usable price. */
  unpriced: number;
}

/**
 * What the properties on one coordinate are worth, not just how many there are.
 *
 * A count alone answers "how much stock is here" and nothing else, which is the
 * less interesting half of the question on a property map. The median drives the
 * hover card's headline, so a stack reads as "twenty-six properties here ·
 * median $640K" before anyone opens it.
 *
 * Named for the proximity clusters it once served; those are gone, and this
 * now describes a set of properties sharing a POINT. See groupByCoordinate.
 */
export function summariseStack(members: StackMember[]): StackSummary {
  const count = members.length;
  if (count === 0) {
    return { count: 0, median: null, medianTier: 'unknown', mix: [], unpriced: 0 };
  }

  const priced = members
    .filter(
      (m): m is StackMember & { price: number } =>
        typeof m.price === 'number' && Number.isFinite(m.price) && m.price > 0,
    )
    .sort((a, b) => a.price - b.price);

  const median = priced.length ? quantile(priced.map((m) => m.price), 0.5) : null;
  // Take the lower-middle member on an even split, matching how `priceTier`
  // resolves a price sitting exactly on a band boundary.
  const medianTier = priced.length ? priced[Math.floor((priced.length - 1) / 2)].tier : 'unknown';

  const counts = new Map<PriceTier, number>();
  for (const m of members) counts.set(m.tier, (counts.get(m.tier) ?? 0) + 1);

  const mix = PRICE_TIER_ORDER.map((tier) => ({
    tier,
    share: (counts.get(tier) ?? 0) / count,
  })).filter((entry) => entry.share > 0);

  return { count, median, medianTier, mix, unpriced: count - priced.length };
}

/* -------------------------------------------------------------------------- */
/* Property type glyphs (pin iconography)                                      */
/* -------------------------------------------------------------------------- */

export type PropertyGlyph =
  | 'house'
  | 'apartment'
  | 'land'
  | 'commercial'
  | 'property'
  | 'builder';

/**
 * The property-TYPE key, which is what the legend lists. `builder` is
 * deliberately absent: it is not a property type, it is where the record came
 * from, so it is chosen by source and explained on its own legend line.
 */
export const PROPERTY_GLYPHS: PropertyGlyph[] = [
  'house',
  'apartment',
  'land',
  'commercial',
  'property',
];

/**
 * `propertyType` is free text copied from whichever portal supplied the listing
 * ("Unit/Apartment", "Vacant Land", "Semi-Rural Acreage"), so this matches on
 * vocabulary rather than an enum.
 *
 * First match wins, and the order encodes the tie-breaks: a strata word beats a
 * structure word ("Apartment Block" is an apartment), a trade word beats both
 * ("Commercial Land" is commercial), and a structure beats a parcel so a
 * "House and Land" package reads as a house while "Residential Land" stays land.
 */
const GLYPH_MATCHERS: Array<[PropertyGlyph, RegExp]> = [
  ['apartment', /\b(apartment|apartments|unit|units|flat|flats|studio|penthouse|condo)\b/],
  [
    'commercial',
    /\b(commercial|office|offices|retail|industrial|warehouse|shop|showroom|medical|hotel|motel)\b/,
  ],
  [
    // "semi" only as the full phrase: "Semi-Rural Acreage" is a parcel, not a
    // semi-detached dwelling.
    'house',
    /\b(house|houses|home|homes|cottage|villa|villas|duplex|townhouse|townhouses|terrace|semi detached)\b/,
  ],
  ['land', /\b(land|block|blocks|vacant|acreage|rural|farm|lot|allotment)\b/],
];

export function propertyGlyph(propertyType: string | null | undefined): PropertyGlyph {
  if (typeof propertyType !== 'string') return 'property';
  // Portals join types with slashes, dashes and underscores; \b needs separators.
  const normalised = propertyType.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (!normalised || normalised === 'unknown') return 'property';
  for (const [glyph, pattern] of GLYPH_MATCHERS) {
    if (pattern.test(normalised)) return glyph;
  }
  return 'property';
}

/* -------------------------------------------------------------------------- */
/* Heat weighting                                                              */
/* -------------------------------------------------------------------------- */

export interface HeatScale {
  /** Lowest observed value for the active metric. */
  min: number;
  /** Median observed value. */
  median: number;
  /** Highest observed value. */
  max: number;
  /** Number of points that actually carried a value for the metric. */
  sampled: number;
}

export interface HeatModel {
  metric: HeatMetric;
  points: HeatPoint[];
  scale: HeatScale | null;
  /**
   * Lowest value the colour ceiling may take, whatever the viewport contains.
   *
   * For weighted metrics it is the heaviest weight in the dataset, so a mid-priced
   * listing keeps its mid-ramp colour when you zoom into a cheap pocket. For
   * density it is a small point count, so an isolated listing reads cool instead
   * of claiming to be a hotspot at max zoom.
   */
  minCeiling: number;
}

/** Points-per-cell that counts as a fully saturated density hotspot. */
const DENSITY_MIN_CEILING = 4;

/** Weight floor so the coldest real value still paints something. */
const MIN_WEIGHT = 0.18;
/**
 * Listings missing the active metric sit below the floor: they still register as
 * supply, but must never read as hot as a listing that genuinely scored low.
 */
const UNKNOWN_WEIGHT = 0.1;

export interface WeightedListing {
  listing: PropertyListing;
  point: GeoPoint;
}

function logNormalise(value: number, min: number, max: number): number {
  if (!(max > min)) return 1;
  const lo = Math.log(Math.max(min, 1));
  const hi = Math.log(Math.max(max, Math.max(min, 1) + 1));
  if (!(hi > lo)) return 1;
  const t = (Math.log(Math.max(value, 1)) - lo) / (hi - lo);
  return MIN_WEIGHT + (1 - MIN_WEIGHT) * Math.min(Math.max(t, 0), 1);
}

/**
 * Turns plotted listings into weighted heat points for the requested metric.
 *
 * - `density` weights every listing equally: the map shows where stock is.
 * - `price` uses a log scale so a single trophy listing cannot flatten the ramp.
 * - `recency` fades older stock so fresh supply reads hottest.
 */
export function buildHeatModel(rows: WeightedListing[], metric: HeatMetric): HeatModel {
  if (rows.length === 0) {
    return { metric, points: [], scale: null, minCeiling: DENSITY_MIN_CEILING };
  }

  const uniform = (): HeatModel => ({
    metric,
    points: rows.map(({ point }) => ({ lat: point.lat, lng: point.lng, intensity: 1 })),
    scale: null,
    // Every point weighs the same, so only genuine pile-ups should saturate.
    minCeiling: DENSITY_MIN_CEILING,
  });

  const weighted = (points: HeatPoint[], scale: HeatScale): HeatModel => ({
    metric,
    points,
    scale,
    minCeiling: points.reduce((acc, p) => Math.max(acc, p.intensity), 0) || 1,
  });

  if (metric === 'density') return uniform();

  if (metric === 'price') {
    const prices = rows
      .map(({ listing }) => toFiniteNumber(listing.price))
      .filter((p): p is number => p !== null && p > 0)
      .sort((a, b) => a - b);

    if (prices.length === 0) return uniform();

    const min = prices[0];
    const max = prices[prices.length - 1];
    return weighted(
      rows.map(({ listing, point }) => {
        const price = toFiniteNumber(listing.price);
        const intensity =
          price !== null && price > 0 ? logNormalise(price, min, max) : UNKNOWN_WEIGHT;
        return { lat: point.lat, lng: point.lng, intensity };
      }),
      { min, max, median: quantile(prices, 0.5), sampled: prices.length },
    );
  }

  // recency
  const stamps = rows
    .map(({ listing }) => listingTimestamp(listing))
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b);

  if (stamps.length === 0) return uniform();

  const oldest = stamps[0];
  const newest = stamps[stamps.length - 1];
  const span = newest - oldest;
  return weighted(
    rows.map(({ listing, point }) => {
      const stamp = listingTimestamp(listing);
      let intensity = UNKNOWN_WEIGHT;
      if (stamp !== null) {
        const t = span > 0 ? (stamp - oldest) / span : 1;
        intensity = MIN_WEIGHT + (1 - MIN_WEIGHT) * Math.min(Math.max(t, 0), 1);
      }
      return { lat: point.lat, lng: point.lng, intensity };
    }),
    { min: oldest, max: newest, median: quantile(stamps, 0.5), sampled: stamps.length },
  );
}

export interface HeatLegend {
  title: string;
  lowLabel: string;
  highLabel: string;
  midLabel: string | null;
  hint: string;
}

export function describeHeatLegend(
  model: HeatModel,
  now: number = Date.now(),
): HeatLegend {
  if (model.metric === 'price' && model.scale) {
    return {
      title: 'Price intensity',
      lowLabel: formatCompactAud(model.scale.min) ?? 'Low',
      midLabel: formatCompactAud(model.scale.median),
      highLabel: formatCompactAud(model.scale.max) ?? 'High',
      hint: `${model.scale.sampled} priced listings · log scale`,
    };
  }

  if (model.metric === 'recency' && model.scale) {
    const days = (stamp: number) =>
      formatDayCount(Math.max(0, Math.round((now - stamp) / 86_400_000)));
    return {
      title: 'Listing freshness',
      lowLabel: days(model.scale.min),
      midLabel: days(model.scale.median),
      highLabel: days(model.scale.max),
      hint: `${model.scale.sampled} dated listings`,
    };
  }

  return {
    title: 'Listing density',
    lowLabel: 'Sparse',
    midLabel: null,
    highLabel: 'Concentrated',
    hint: `${model.points.length} plotted listings`,
  };
}

/* -------------------------------------------------------------------------- */
/* Heat rendering geometry                                                     */
/* -------------------------------------------------------------------------- */

const FOCUS_RADIUS_SCALE: Record<HeatFocus, number> = {
  tight: 0.7,
  balanced: 1,
  wide: 1.45,
};

/**
 * Percentile of per-cell weight used as the "fully saturated" value.
 * Tight → only genuine outliers go red. Wide → broad areas glow.
 */
const FOCUS_PERCENTILE: Record<HeatFocus, number> = {
  tight: 0.99,
  balanced: 0.94,
  wide: 0.82,
};

/**
 * Heat radius has to grow with zoom, otherwise the layer reads as disconnected
 * dots when zoomed in and as a single blob when zoomed out.
 */
export function heatGeometryForZoom(
  zoom: number,
  focus: HeatFocus,
): { radius: number; blur: number } {
  const safeZoom = Number.isFinite(zoom) ? zoom : 5;
  // Country-to-state zooms get a deliberately tight, sharp core. At zoom 4 a
  // capital city's entire stock projects into a couple of pixels, and the old
  // radius smeared that mass across the coastline into open water — Melbourne
  // read as a blob in Bass Strait. Nobody is judging density gradients at
  // national scale; they are locating hotspots, and a hotspot should sit on
  // the city that produced it.
  const lowZoom = safeZoom <= 5;
  const base = lowZoom
    ? 10.4 - (5 - Math.max(safeZoom, 3)) * 2.2
    : 13 + (safeZoom - 4) * 2.6;
  const radius = Math.min(Math.max(base * FOCUS_RADIUS_SCALE[focus], lowZoom ? 5 : 10), 62);
  return { radius: Math.round(radius), blur: Math.round(radius * (lowZoom ? 0.55 : 0.72)) };
}

export interface ProjectedWeight {
  x: number;
  y: number;
  weight: number;
}

/**
 * Leaflet.heat clamps each aggregation cell against `options.max` and maps
 * `cellWeight / max` onto the gradient. A fixed `max` means the ramp is either
 * blown out (everything red) or unused (everything green) at most zoom levels.
 *
 * We mirror the plugin's own screen-space bucketing (cell size = r/2) and take a
 * high percentile of the resulting cell weights, so the gradient spans the data
 * that is actually on screen at the current zoom.
 */
export function calibrateHeatMax(
  projected: ProjectedWeight[],
  radius: number,
  focus: HeatFocus,
  /**
   * Dataset-wide floor for the ceiling (see `HeatModel.minCeiling`). Without it
   * the ceiling would collapse to whatever happens to be on screen, so a lone
   * mid-priced listing would glow red and the colours would stop agreeing with
   * the legend. Defaults to the heaviest visible point.
   */
  minCeiling?: number,
): number {
  if (projected.length === 0) return 1;
  const cell = Math.max(1, radius / 2);
  const buckets = new Map<string, number>();
  for (const p of projected) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const key = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
    buckets.set(key, (buckets.get(key) ?? 0) + p.weight);
  }
  if (buckets.size === 0) return 1;
  const sums = Array.from(buckets.values()).sort((a, b) => a - b);
  const target = quantile(sums, FOCUS_PERCENTILE[focus]);
  const floor = Math.max(
    minCeiling && Number.isFinite(minCeiling)
      ? minCeiling
      : Math.max(...projected.map((p) => p.weight)),
    0.001,
  );
  return Math.max(target, floor);
}

/* -------------------------------------------------------------------------- */
/* Co-location grouping                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The only honest way to put more than one property behind a single mark.
 *
 * Proximity clustering — a bubble drawn wherever a group of nearby pins
 * averages out — was removed because its position means nothing. The bubble is
 * placed at ONE member's coordinate (or, before the anchoring patch, at the
 * arithmetic mean of them all) while standing for properties spread across
 * hundreds of kilometres, so a reader has no way to tell a legitimate bubble
 * from a misplaced pin. It was read as a misplaced pin every single time it was
 * looked at: over Bass Strait, over the Southern Ocean, and finally over the
 * centre of the continent — where, that time, the pins really were wrong.
 *
 * Co-location is different, and it is the case that actually needs solving: the
 * corpus stacks properties on IDENTICAL coordinates. Twenty-six listings share
 * `104 Grubb Avenue, Traralgon`; fourteen share a Cobblebank suburb centroid;
 * every builder estate puts its whole release on one suburb point. Those pins
 * are exactly on top of each other, so only the top one is clickable and the
 * other twenty-five are invisible.
 *
 * A mark that says "26" at that coordinate is TRUE — all twenty-six really are
 * there — and it stays true at every zoom, because the grouping is by
 * coordinate rather than by screen distance. Nothing is ever drawn where no
 * property stands.
 *
 * Rounding is to 5 decimal places, about a metre. Two geocodes of the same
 * address agree far more precisely than that, and two genuinely different
 * addresses are never that close.
 */
const COLOCATION_DP = 5;

export function colocationKey(lat: number, lng: number): string {
  return `${lat.toFixed(COLOCATION_DP)},${lng.toFixed(COLOCATION_DP)}`;
}

export interface ColocatedGroup<T> {
  key: string;
  lat: number;
  lng: number;
  /** Every record at this exact coordinate, input order preserved. */
  members: T[];
}

/**
 * Groups records that share a coordinate. Order is the input's own, so the
 * caller's sort (dearest first, most recent first) survives into the groups and
 * into the member that represents each one.
 */
export function groupByCoordinate<T>(
  rows: T[],
  at: (row: T) => { lat: number; lng: number },
): ColocatedGroup<T>[] {
  const groups = new Map<string, ColocatedGroup<T>>();
  for (const row of rows) {
    const point = at(row);
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    const key = colocationKey(point.lat, point.lng);
    const existing = groups.get(key);
    if (existing) existing.members.push(row);
    else groups.set(key, { key, lat: point.lat, lng: point.lng, members: [row] });
  }
  return [...groups.values()];
}

/**
 * Step through a stack, wrapping at both ends.
 *
 * Extracted for one reason: a stack of twenty-six is only reachable through
 * this arithmetic, and an off-by-one at either end silently strips a property
 * off a mark that promises twenty-six. JavaScript's `%` keeps the sign of its
 * left operand, so `(0 - 1) % 26` is `-1` rather than `25`; adding `total`
 * before the modulo is what makes the backwards arrow reach the last member
 * instead of nothing.
 *
 * Neither arrow is ever a dead end, deliberately: a disabled control at the
 * end of a list reads as a broken one, and there is no ordering here a reader
 * would think of as having a start.
 */
export function stepStackIndex(index: number, delta: number, total: number): number {
  if (!Number.isFinite(total) || total < 1) return 0;
  if (!Number.isInteger(index) || index < 0 || index >= total) return 0;
  const step = Number.isFinite(delta) ? Math.trunc(delta) : 0;
  return ((index + step) % total + total) % total;
}

/** Everything at one coordinate, and where a given record sits inside it. */
export interface ResolvedStack<T> {
  /** Every record on the open record's exact point, input order preserved. */
  members: T[];
  /** Zero-based position of the open record, or -1 when it is not present. */
  index: number;
}

/**
 * What is standing underneath the open pin.
 *
 * Read by filtering rather than by re-grouping the whole corpus: the marker
 * layer already builds the full index for drawing, and building a second one
 * for the one group a popup needs walks every marker twice for no gain.
 *
 * A record whose own point is not finite resolves to an empty stack rather
 * than to a stack of itself — `colocationKey` cannot key `NaN`, and a pager
 * over a member nothing can draw is a control with nowhere to go.
 */
export function resolveStack<T>(
  rows: T[],
  selected: T | null | undefined,
  at: (row: T) => { lat: number; lng: number },
): ResolvedStack<T> {
  if (!selected) return { members: [], index: -1 };
  const point = at(selected);
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return { members: [], index: -1 };
  }
  const key = colocationKey(point.lat, point.lng);
  const members = rows.filter((row) => {
    const p = at(row);
    return (
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lng) &&
      colocationKey(p.lat, p.lng) === key
    );
  });
  return { members, index: members.indexOf(selected) };
}

/* -------------------------------------------------------------------------- */
/* Basemap catalogue                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Where the map's ground comes from, and why it is exactly these providers.
 *
 * The Street and Midnight basemaps used to be CARTO's raster tiles
 * (`basemaps.cartocdn.com`), which stopped serving anonymous traffic: every
 * tile now comes back stamped "API KEY REQUIRED", so the marketplace map drew
 * its pins and heat surface over a wall of watermarks. A key cannot fix that
 * here — this dashboard is cloned per tenant, and a provisioned clone has
 * nowhere to inherit a CARTO account from.
 *
 * Every basemap therefore has to work with NO credential at all, which rules
 * more out than it sounds like:
 *
 * - openstreetmap.org's own tile servers are run by volunteers and actively
 *   block apps — probing from this project's egress returned their literal
 *   "403 Access blocked · App is not following the tile usage policy" tile.
 *   Defaulting a commercial product onto them plants the next watermark.
 * - Esri's classic tile services (`server.arcgisonline.com`) serve anonymous
 *   traffic without fuss and are ALREADY this map's satellite provider — the
 *   one basemap that kept working. Street and Midnight now ride the same
 *   host: World_Street_Map for daylight, and the Dark Gray Canvas pair for
 *   Midnight, which is drawn by Esri specifically as a ground for thematic
 *   overlays — exactly what a heat surface needs. Its one cost is a native
 *   ceiling of z16; past that Leaflet upscales, and parcel-level scrutiny is
 *   what the Satellite basemap (native z18) is for.
 *
 * A keyed provider (Mapbox, MapTiler, CARTO with an account) is deliberately
 * NOT offered as a build-time upgrade. Their browser tokens are billable and
 * `VITE_`-prefixed values are inlined into the bundle, so a token published
 * that way is lifted from the page source and spent by anyone — and per
 * `docs/integrations/API_USAGE_METERING.md` a provisioned clone runs on the
 * PRIME's vendor keys, so it would be the prime's money. That is the rule
 * `scripts/security/check-client-bundle-secrets.mjs` enforces, and it refused
 * exactly this. Deeper-zoom cartography needs a server-side proxy that keeps
 * the credential in a Supabase function secret, not an env var in `src/`.
 */
export interface BasemapDefinition {
  id: Exclude<BasemapId, 'auto'>;
  url: string;
  attribution: string;
  /** A second tile layer of place labels drawn over an unlabelled base. */
  labelsUrl?: string;
  maxNativeZoom: number;
  /** Tiles are dark, so overlays need the inverted treatment. */
  dark: boolean;
}

export type BasemapCatalog = Record<Exclude<BasemapId, 'auto'>, BasemapDefinition>;

const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services';

const OSM_CREDIT =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ESRI_ATTRIBUTION = `Tiles &copy; Esri &mdash; Esri, HERE, Garmin, ${OSM_CREDIT}`;

/**
 * The deepest zoom a tile may be REQUESTED at, given Leaflet's retina handling.
 *
 * ## The defect this exists for
 *
 * The marketplace map drew Esri's grey "Map data not yet available" tile past a
 * zoom level — the 19 Sep 2026 clone audit's report, and nothing to do with the
 * clone: it depends on the screen.
 *
 * `detectRetina` is set on the base layer. On a HiDPI display Leaflet's
 * `TileLayer.initialize` does this (leaflet 1.9, `leaflet-src.js`):
 *
 * ```js
 * options.tileSize = Math.floor(options.tileSize / 2);
 * options.zoomOffset++;
 * options.maxZoom = Math.max(options.minZoom, options.maxZoom - 1);
 * ```
 *
 * It decrements `maxZoom` and **leaves `maxNativeZoom` alone**. The tile zoom
 * is clamped by `maxNativeZoom` (`_clampZoom`) and the URL zoom is
 * `_tileZoom + zoomOffset` (`_getZoomForUrl`) — so every request at the cap
 * asks for `maxNativeZoom + 1`, one level past the cache the number was chosen
 * to describe.
 *
 * Measured from the production egress on 18 Sep 2026, over Sydney CBD,
 * Traralgon and Kirwan: the "no data" tile is ONE fixed 2,521-byte image
 * (sha256 `9eafd300d6…`) served with **HTTP 200**, and it appears at exactly
 * one level past each configured cap — z20 for World_Street_Map (19), z17 for
 * Dark_Gray_Base (16), z19 for World_Imagery (18) at Traralgon. Because it is
 * a 200 carrying a valid image, Leaflet's `tileerror` never fires and nothing
 * in the product can detect it.
 *
 * So the cap is a statement about the CACHE and the request has to respect the
 * offset the retina option adds to it.
 */
export function effectiveMaxNativeZoom(maxNativeZoom: number, retina: boolean): number {
  // Leaflet's own guard is `maxZoom > 0`; below that the retina branch never
  // runs and no offset is added.
  if (!retina) return maxNativeZoom;
  return Math.max(0, maxNativeZoom - 1);
}

export const BASEMAP_CATALOG: BasemapCatalog = {
  light: {
    id: 'light',
    // Esri's tile scheme is {z}/{y}/{x} — row before column. Written {x}/{y}
    // it fetches the transpose of the tile it meant to, which reads on screen
    // as a map of the wrong part of the world rather than as an error.
    url: `${ESRI_TILES}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_ATTRIBUTION,
    maxNativeZoom: 19,
    dark: false,
  },
  dark: {
    id: 'dark',
    // The canvas base carries no place names by design; the reference layer
    // supplies them, so the two always travel together.
    url: `${ESRI_TILES}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labelsUrl: `${ESRI_TILES}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
    attribution: ESRI_ATTRIBUTION,
    maxNativeZoom: 16,
    dark: true,
  },
  satellite: {
    id: 'satellite',
    url: `${ESRI_TILES}/World_Imagery/MapServer/tile/{z}/{y}/{x}`,
    labelsUrl: `${ESRI_TILES}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    maxNativeZoom: 18,
    dark: true,
  },
};

/* -------------------------------------------------------------------------- */
/* Misc                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Cheap order-independent signature for a listing set. Used to decide when the
 * map should re-fit: filter changes should re-frame, marker trickle-in should not.
 */
export function listingSetSignature(listings: Array<{ id: string }>): string {
  let hash = 0;
  for (const { id } of listings) {
    for (let i = 0; i < id.length; i += 1) {
      hash = (hash * 31 + id.charCodeAt(i)) | 0;
    }
  }
  return `${listings.length}:${hash}`;
}

export function isMapMode(value: unknown): value is MapMode {
  return typeof value === 'string' && (MAP_MODES as string[]).includes(value);
}

export function isHeatMetric(value: unknown): value is HeatMetric {
  return typeof value === 'string' && (HEAT_METRICS as string[]).includes(value);
}

export function isHeatFocus(value: unknown): value is HeatFocus {
  return typeof value === 'string' && (HEAT_FOCUSES as string[]).includes(value);
}

export function isBasemapId(value: unknown): value is BasemapId {
  return typeof value === 'string' && (BASEMAPS as string[]).includes(value);
}
