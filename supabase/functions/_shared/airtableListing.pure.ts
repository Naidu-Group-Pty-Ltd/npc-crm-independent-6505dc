/**
 * The Airtable record -> listing projection.
 *
 * This is the layer that decides which of the 205 columns on Property Intake
 * Master reach the dashboard, and for a long time the answer was "the wrong
 * ones". It asked for `Price`, `Confidence Score`, `Images`, `Status`,
 * `Features`, `Land Size` and `Lot Number` — column names belonging to
 * `Properties`, the *other* table in the same base. Airtable returns `undefined`
 * for a column that does not exist exactly as it does for one that is empty, so
 * nothing failed. The page simply rendered "Price on request" over 773 real
 * prices and "Low (0%)" over 1,440 real confidence scores, and looked like a
 * data problem rather than a code one.
 *
 * The names now come from `airtableIntakeFields.pure.ts`, verified against the
 * live schema.
 *
 * Two behaviours here are load-bearing and easy to undo by accident:
 *
 *  - **No placeholder strings.** Absent values are `null`. Emitting
 *    `'Unknown Address'` made every address-less record compare equal to every
 *    other in the proxy's dedup pass, which silently deleted 268 of 1,441
 *    records from every response, and it defeated the table's own "this field is
 *    missing" dimming because the value was never falsy.
 *  - **`price` is a sale figure and never a rent.** `computePriceTiers`, the
 *    heat map's price metric and every average downstream assume that. A weekly
 *    rent of $650 in the same field poisons all three.
 *
 * Free of Deno, Supabase, React and the DOM so both runtimes can import it.
 */

import { INTAKE_FIELDS as F } from './airtableIntakeFields.pure.ts';
import { reconcileLocality, type LocalityTrust } from './auLocality.pure.ts';
import { composeListingAddress } from './listingAddress.pure.ts';
import {
  imageIdentity,
  normaliseImageCandidates,
  orderCandidatesForDisplay,
  parseImageUrlList,
  type ImageCandidate,
} from './listingImages.pure.ts';

export interface AirtableSourceRecord {
  id: string;
  createdTime?: string | null;
  fields?: Record<string, unknown> | null;
}

/** The projected listing. Deliberately loose — callers narrow it to `PropertyListing`. */
export type ProjectedListing = Record<string, unknown> & { id: string };

/** What the six per-domain quality scores came back as. */
export interface ListingConfidences {
  extraction: number | null;
  overall: number | null;
  address: number | null;
  price: number | null;
  specs: number | null;
  agent: number | null;
}

/** How a price should be read and compared. */
export type PriceBasis = 'numeric' | 'range' | 'total' | 'rent' | 'display' | null;

/* -------------------------------------------------------------------------- */
/* Coercion                                                                    */
/* -------------------------------------------------------------------------- */

function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') {
    // Airtable single-selects arrive as `{ id, name, color }`.
    if (value && typeof value === 'object' && 'name' in (value as Record<string, unknown>)) {
      return text((value as { name: unknown }).name);
    }
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  // The upstream extractor writes the literal word for "we could not tell",
  // which is not a value and must not become one.
  if (/^unknown$/i.test(trimmed)) return null;
  return trimmed;
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed =
    typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/** A price that could plausibly be a property price, or null. */
function money(value: unknown): number | null {
  const parsed = numeric(value);
  if (parsed === null) return null;
  return parsed > 0 && parsed < 50_000_000 ? parsed : null;
}

function count(value: unknown): number | null {
  const parsed = numeric(value);
  if (parsed === null) return null;
  const rounded = Math.round(parsed);
  return rounded > 0 && rounded <= 100 ? rounded : null;
}

/**
 * A 0–1 confidence.
 *
 * Note the deliberate difference from the old helper: a genuine `0` survives.
 * The previous `if (!confidence) return null` turned "we are certain this is
 * wrong" into "we did not measure", which are very different claims.
 */
function confidence(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed >= 0 && parsed <= 1) return parsed;
  if (parsed > 1 && parsed <= 100) return parsed / 100;
  return null;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => text(entry)).filter((entry): entry is string => Boolean(entry));
  }
  const single = text(value);
  return single ? [single] : [];
}

function isoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'number' ? value : Date.parse(String(value));
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

/**
 * Suburb, with the state/postcode tail removed so suburbs group.
 *
 * Returns null rather than "Unknown Suburb" — see the module note.
 */
function suburbOf(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const head = raw.split(',')[0].trim();
  return head || null;
}

function propertyTypeOf(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const normalized = raw.toLowerCase().trim();
  if (normalized.includes('apartment') || normalized.includes('unit')) return 'Apartment';
  if (normalized.includes('townhouse') || normalized.includes('town house')) return 'Townhouse';
  if (normalized.includes('house') || normalized.includes('home')) return 'House';
  if (normalized.includes('villa')) return 'Villa';
  if (normalized.includes('duplex')) return 'Duplex';
  if (normalized.includes('land')) return 'Land';
  return raw;
}

/* -------------------------------------------------------------------------- */
/* Price                                                                       */
/* -------------------------------------------------------------------------- */

export interface ResolvedPrice {
  /** What an agent wrote: "From $1,599,000", "$430,000 - $450,000", "Contact Agent". */
  display: string | null;
  /** A single sale figure suitable for sorting, tiering and averaging. Never a rent. */
  amount: number | null;
  min: number | null;
  max: number | null;
  rentAmount: number | null;
  rentPeriod: string | null;
  qualifier: string | null;
  saleMethod: string | null;
  basis: PriceBasis;
}

/**
 * Reads the price ladder.
 *
 * There is no `Price` column. What exists is a display string an agent typed
 * (`Display Price Text`, populated on 1,023 of 1,441 records — the most complete
 * price signal on the table), a clean number (`Price Numeric`, 773), a range
 * (`Price Min`/`Price Max`), a `Total Price`, and a separate `Rent Amount`.
 *
 * The display string leads the UI because it is both the most available and the
 * most faithful: "From $1,599,000" and "$430,000 - $450,000" are what the agent
 * said, and no numeric field can express either without lying about precision.
 * The scalar exists for arithmetic only.
 */
export function resolvePrice(fields: Record<string, unknown>): ResolvedPrice {
  const min = money(fields[F.priceMin]);
  const max = money(fields[F.priceMax]);
  const exact = money(fields[F.priceNumeric]);
  const total = money(fields[F.totalPrice]);
  const rentAmount = money(fields[F.rentAmount]);

  // Midpoint of a quoted range, so a range still sorts and tiers sensibly.
  const midpoint = min !== null && max !== null ? Math.round((min + max) / 2) : (min ?? max);

  let amount: number | null = null;
  let basis: PriceBasis = null;
  if (exact !== null) {
    amount = exact;
    basis = 'numeric';
  } else if (midpoint !== null) {
    amount = midpoint;
    basis = 'range';
  } else if (total !== null) {
    amount = total;
    basis = 'total';
  }

  const display = text(fields[F.priceDisplay]);
  if (amount === null && rentAmount !== null) {
    // A rental. `amount` stays null on purpose: every consumer of it treats the
    // value as a sale price, and $650 alongside $1,599,000 would drag the map's
    // colour tiers and every suburb median down with it.
    basis = 'rent';
  } else if (amount === null && display) {
    basis = 'display';
  }

  return {
    display,
    amount,
    min,
    max,
    rentAmount,
    rentPeriod: text(fields[F.rentPeriod]),
    qualifier: text(fields[F.priceQualifier]),
    saleMethod: text(fields[F.saleMethod]),
    basis,
  };
}

/** The six per-domain quality scores, all populated on 1,440 of 1,441 records. */
export function resolveConfidences(fields: Record<string, unknown>): ListingConfidences {
  return {
    extraction: confidence(fields[F.extractionConfidence]),
    overall: confidence(fields[F.overallQuality]),
    address: confidence(fields[F.addressConfidence]),
    price: confidence(fields[F.priceConfidence]),
    specs: confidence(fields[F.specsConfidence]),
    agent: confidence(fields[F.agentConfidence]),
  };
}

/**
 * The record's display date.
 *
 * `Created Time` is the only date column reliably present. The `now` fallback is
 * a display convenience so an undated record still sorts somewhere; callers are
 * told via `listedAtKnown` so they can say "date unknown" instead of "listed
 * today". It must never be written to `listings_cache.created_time`, which
 * drives a retention window shared with Airtable — see
 * `listingsCache.pure.ts#extractCreatedTime`.
 */
function displayDate(
  record: AirtableSourceRecord,
  now: () => number,
): { stamp: string; known: boolean } {
  const fields = record.fields ?? {};
  const known =
    isoDate(fields[F.createdTime]) ??
    isoDate(fields[F.availabilityDate]) ??
    isoDate(record.createdTime);
  return known ? { stamp: known, known: true } : { stamp: new Date(now()).toISOString(), known: false };
}

/* -------------------------------------------------------------------------- */
/* Images                                                                      */
/* -------------------------------------------------------------------------- */

/** Everything the page needs to know about a listing's photographs. */
export interface ResolvedListingImages {
  /** Ordered, de-duplicated source candidates. The first is the intended hero. */
  candidates: ImageCandidate[];
  /** When intake last captured this set, or null if it never recorded one. */
  capturedAt: string | null;
  /** What intake counted, which can exceed `candidates.length` if URLs were malformed. */
  reportedCount: number | null;
  source: string | null;
  primaryUrl: string | null;
}

/**
 * Collects a record's image candidates from every column that can hold one.
 *
 * Reading `Listing Images` alone — which is all the projection used to do —
 * answers "did an agent email us a photo", and the answer was no on all 1,441
 * records. Photographs mostly arrive as *links* on a scraped listing page, and
 * intake now records those in `Listing Image URLs` newest-first. Both are read,
 * attachments first because bytes we hold beat a hotlink we do not, and the
 * combined set is then ordered by source quality with plans pushed to the back.
 *
 * `Primary Image URL` is folded in last rather than first: it is a convenience
 * copy of the head of the URL list, so it is normally already present, and the
 * de-duplication drops it. It only contributes when the list column is empty.
 */
export function resolveListingImages(fields: Record<string, unknown>): ResolvedListingImages {
  const attachments = normaliseImageCandidates(fields[F.listingImages], 'airtable');
  // `listing_url`, not `scraped`. These URLs were read off the agency's own
  // listing page by intake, so they outrank a generic scrape — and, more
  // importantly, they must not share an origin with the photographs
  // `listing-enrichment` harvests, which are stored as `scraped`. Two sources
  // under one label cannot be told apart when the library merges them.
  const fromListing = normaliseImageCandidates(
    parseImageUrlList(fields[F.listingImageUrls]),
    'listing_url',
  );
  const primary = normaliseImageCandidates(
    parseImageUrlList(fields[F.primaryImageUrl]),
    'listing_url',
  );

  // Keyed on the library's own identity rather than on the raw URL string.
  // `Primary Image URL` is a convenience copy of the head of the list column
  // and the comment above claims de-duplication drops it — which it only did
  // when the two columns held byte-identical strings. A different query
  // signature, or the same photograph at another size, and the "convenience
  // copy" became a second candidate: the hero shot, twice, at the front of the
  // carousel. `orderCandidatesForDisplay` below then collapses renditions on
  // top of this, which is what catches the size case.
  const byIdentity = new Map<string, ImageCandidate>();
  for (const candidate of [...attachments, ...fromListing, ...primary]) {
    const key = imageIdentity(candidate);
    if (!byIdentity.has(key)) byIdentity.set(key, candidate);
  }

  return {
    candidates: orderCandidatesForDisplay(Array.from(byIdentity.values())),
    capturedAt: isoDate(fields[F.imagesCapturedAt]),
    reportedCount: numeric(fields[F.imageCount]),
    source: text(fields[F.imageSource]),
    primaryUrl: text(fields[F.primaryImageUrl]),
  };
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Projects one Airtable record onto the listing shape the dashboard renders.
 *
 * `fields` is carried through untouched alongside the projection: the intake
 * table has 205 columns and only a fraction are mapped here, so the extended
 * detail panels read the original.
 */
export function projectAirtableRecord(
  record: AirtableSourceRecord,
  now: () => number = Date.now,
): ProjectedListing {
  const fields = (record.fields ?? {}) as Record<string, unknown>;
  const { stamp, known: listedAtKnown } = displayDate(record, now);

  const suburb = suburbOf(fields[F.suburb]);
  // State and postcode are reconciled rather than trusted: they are contaminated
  // by batch carry-over often enough to send the geocoder to another state.
  const locality = reconcileLocality({
    state: fields[F.state],
    postcode: fields[F.postcode],
  });

  /**
   * The address is COMPOSED, never inherited.
   *
   * It used to be `Address ?? Full Address`, which discards the street the
   * intake extracted whenever the geocoded branch wrote its own answer back:
   * `Address` is not written on that branch at all, and `Full Address` is a
   * re-parse of Google's `formatted_address`. A record whose email said
   * `Mortlock Street, Cobblebank` therefore reached the map as the bare suburb,
   * and fourteen of them piled onto one pin. See listingAddress.pure.ts.
   */
  const composed = composeListingAddress({
    unitNumber: fields[F.unitNumber],
    streetNumber: fields[F.streetNumber],
    streetName: fields[F.streetName],
    streetType: fields[F.streetType],
    suburb,
    state: locality.state,
    postcode: locality.postcode,
    address: fields[F.address],
    formatted: fields[F.fullAddress],
  });
  // What a person reads and what the geocoder is asked are the same string, so
  // a pin can never stand somewhere the card does not name.
  const address = composed.street ?? text(fields[F.address]) ?? text(fields[F.fullAddress]);

  const price = resolvePrice(fields);
  const confidences = resolveConfidences(fields);
  const media = resolveListingImages(fields);
  const beds = count(fields[F.beds]);
  const baths = count(fields[F.baths]);
  const landSizeSqm = numeric(fields[F.landSizeSqm]);

  const agentName = text(fields[F.agentName]);
  const agencyName = text(fields[F.agencyName]);
  const location = composed.full ?? ([address, suburb].filter(Boolean).join(', ') || null);

  return {
    id: record.id,
    fields,
    createdTime: stamp,
    listedAtKnown,

    // Core identity. `title` stays non-null because callers render it as a
    // heading; everything else is null when absent.
    title:
      address ??
      text(fields[F.fullAddress]) ??
      text(fields[F.recordName]) ??
      'Untitled Property',
    address,
    /**
     * How far down the address this record actually reaches, measured from the
     * parts rather than guessed from the string. A surface can then plot a pin
     * and still say "this is the street, not the letterbox" — 30 live listings
     * carry a suburb and nothing else, and an estate lot has no street number
     * until its plan is registered.
     */
    addressPrecision: composed.precision,
    fullAddress: text(fields[F.fullAddress]),
    normalizedAddress: text(fields[F.normalizedAddress]),
    unitNumber: text(fields[F.unitNumber]),
    streetNumber: text(fields[F.streetNumber]),
    streetName: text(fields[F.streetName]),
    streetType: text(fields[F.streetType]),
    suburb,
    location,
    state: locality.state,
    zipCode: locality.postcode,
    localityTrust: locality.trust as LocalityTrust,
    localityConflicts: locality.conflicts,
    latitude: numeric(fields[F.latitude]),
    longitude: numeric(fields[F.longitude]),
    propertyUniqueKey: text(fields[F.uniqueKey]),

    // Price
    price: price.amount,
    priceDisplay: price.display,
    priceMin: price.min,
    priceMax: price.max,
    priceBasis: price.basis,
    rentAmount: price.rentAmount,
    rentPeriod: price.rentPeriod,
    priceQualifier: price.qualifier,
    saleMethod: price.saleMethod,
    gstApplicable: text(fields[F.gstApplicable]),

    // Specs
    beds,
    baths,
    bedrooms: beds,
    bathrooms: baths,
    carSpaces: count(fields[F.carSpaces]),
    landSize: landSizeSqm,
    landSizeSqm,
    buildingAreaSqm: numeric(fields[F.buildingAreaSqm]),
    floorAreaSqm: numeric(fields[F.floorAreaSqm]),
    totalAreaSqm: numeric(fields[F.totalAreaSqm]),
    frontageM: numeric(fields[F.frontageM]),
    storeys: numeric(fields[F.storeys]),
    features: stringList(fields[F.features]),
    parkingDetails: text(fields[F.parkingDetails]),

    // Classification
    propertyType: propertyTypeOf(fields[F.propertyType]),
    sector: text(fields[F.sector]),
    intent: text(fields[F.intent]),
    category: text(fields[F.category]),
    zoning: text(fields[F.zoning]),
    status: text(fields[F.listingStatus]),
    listingStatus: text(fields[F.listingStatus]),
    recordStatus: text(fields[F.recordStatus]),
    processingStatus: text(fields[F.processingStatus]),
    processingStage: text(fields[F.processingStage]),
    contractType: text(fields[F.contractType]),
    packageType: text(fields[F.packageType]),
    lotNumber: text(fields[F.lot]),
    projectName: text(fields[F.projectName]),
    estateName: text(fields[F.estateName]),
    stage: text(fields[F.stage]),
    builderDeveloper: text(fields[F.builderDeveloper]),
    availabilityDate: isoDate(fields[F.availabilityDate]),
    settlementDate: isoDate(fields[F.settlementDate]),

    // Quality
    confidence: confidences.extraction,
    confidences,
    needsHumanReview: fields[F.needsHumanReview] === true,
    reviewReason: stringList(fields[F.reviewReason]),
    errorType: text(fields[F.errorType]),
    errorMessage: text(fields[F.errorMessage]),
    humanReviewNotes: text(fields[F.humanReviewNotes]),

    // Agent and agency. `Agent Phone` is nearly always empty; the number lands
    // in `Agent Mobile`.
    agent: agentName,
    agentName,
    agentPhone: text(fields[F.agentPhone]) ?? text(fields[F.agentMobile]),
    agentMobile: text(fields[F.agentMobile]),
    agentEmail: text(fields[F.agentEmail]),
    agentRole: text(fields[F.agentRole]),
    agencyName,
    agencyPhone: text(fields[F.agencyPhone]),
    agencyEmail: text(fields[F.agencyEmail]),
    agencyWebsite: text(fields[F.agencyWebsite]),

    // Inspection
    inspectionStart: isoDate(fields[F.inspectionStart]),
    inspectionEnd: isoDate(fields[F.inspectionEnd]),
    inspectionNotes: text(fields[F.inspectionNotes]),
    inspectionRawText: text(fields[F.inspectionRawText]),
    nextInspectionDate: isoDate(fields[F.nextInspection]),
    openHomeAvailable: fields[F.openHomeAvailable] === true,

    // Content
    description: text(fields[F.description]) ?? text(fields[F.summary]) ?? '',
    summary: text(fields[F.summary]),
    rawExtract: text(fields[F.rawSnippet]) ?? text(fields[F.originalRowText]),

    // Links and media.
    //
    // `images` stays the raw attachment array every existing caller expects.
    // `imageCandidates` is the resolved set — attachments plus the scraped URL
    // column, ordered best-source-first — and is what the image library should
    // be asked to harvest.
    images: Array.isArray(fields[F.listingImages]) ? (fields[F.listingImages] as unknown[]) : [],
    imageCandidates: media.candidates,
    // The freshness signal. `createdTime` says when the record arrived, which is
    // a different question: a record filed in January can have its photos
    // re-scraped in August, and it is the August date that decides whether the
    // page is showing the most recent images and how soon to re-verify them.
    imagesCapturedAt: media.capturedAt,
    // Named for what it is: how many candidates intake gave us, which is a
    // different number from how many photographs the page renders. The
    // rendered count comes from the image library, keyed by listing id.
    imageCandidateCount: media.candidates.length,
    reportedImageCount: media.reportedCount,
    imageSource: media.source,
    primaryImageUrl: media.primaryUrl,
    floorplans: Array.isArray(fields[F.floorplan]) ? (fields[F.floorplan] as unknown[]) : [],
    url: text(fields[F.webLink]) ?? text(fields[F.sourceWebLink]),
    webLinks: text(fields[F.webLink]),
    sourceWebLink: text(fields[F.sourceWebLink]),
    alternateWebLinks: stringList(fields[F.alternateWebLinks]),

    // Provenance
    source: text(fields[F.sourceType]) ?? 'Airtable',
    sourceType: text(fields[F.sourceType]),
    senderEmail: text(fields[F.senderEmail]),
    senderName: text(fields[F.senderName]),
    senderDomain: text(fields[F.senderDomain]),
    listingDate: stamp,
    createdAt: stamp,
    receivedAt: stamp,
    lastModifiedTime: isoDate(fields[F.lastModified]),
    tags: stringList(fields[F.tags]),
  };
}
