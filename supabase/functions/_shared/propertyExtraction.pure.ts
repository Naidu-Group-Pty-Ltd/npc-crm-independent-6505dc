/**
 * property-extraction-v1 — canonical shared pure module for reading property
 * data out of an AI document extraction.
 *
 * Split out of `parse-property-pdf` so the coercion, merge and address-assembly
 * rules are unit-testable: they are the layer that decides whether a value the
 * model correctly READ actually survives into the property record, and they had
 * been silently dropping most of them.
 *
 * Pure + deterministic + JSON-safe: no DOM, network, secrets or clocks.
 */

import {
  coerceAuPostcode,
  coerceAuState,
  coerceBoolean,
  coerceEnum,
  coerceInteger,
  coerceIsoDate,
  coerceNumber,
  coercePercent,
  coerceStringArray,
  coerceText,
  parseLlmJson,
} from './llmJson.pure.ts';

export const PROPERTY_EXTRACTION_VERSION = 'property-extraction-v1';

export interface ExtractedPropertyData {
  address?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  price?: number;
  weeklyRent?: number;
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  landSize?: number;
  buildSize?: number;
  propertyType?: string;
  landPrice?: number;
  buildPrice?: number;
  isNewBuild?: boolean;
  councilRates?: number;
  waterRates?: number;
  strataFees?: number;
  insuranceEstimate?: number;
  propertyManagementPercent?: number;
  yearBuilt?: number;
  stampDuty?: number;
  agentFee?: number;
  assetClass?: string;
  assetSubType?: string;
  tenure?: string;
  zoning?: string;
  gfaSqm?: number;
  nlaSqm?: number;
  glaSqm?: number;
  siteAreaSqm?: number;
  parkingBays?: number;
  currentValuation?: number;
  propertyName?: string;
  siteCoverPct?: number;
  officePct?: number;
  hardstandSqm?: number;
  clearanceMetres?: number;
  powerKva?: number;
  dockDoors?: number;
  groundFloorLoadKpa?: number;
  conditionRating?: string;
  // Commercial / industrial enrichment
  detectedAssetClass?: 'residential' | 'commercial' | 'industrial';
  detectedAssetConfidence?: number;
  passingNoiPa?: number;
  marketNoiPa?: number;
  passingCapRatePct?: number;
  marketCapRatePct?: number;
  vendorAdvisedRentPa?: number;
  vendorAdvisedOutgoingsPa?: number;
  outgoingsTotalPa?: number;
  outgoingsRecoverablePa?: number;
  leaseType?: string;
  leaseExpiryDate?: string;
  leaseOptions?: string;
  waleYears?: number;
  tenantNames?: string[];
  gstTreatment?: string;
  truckAccess?: string;
  vendorAdvisedYieldPct?: number;
}

export interface StructuredPropertyPayload {
  /**
   * The composed address, or NULL where the extraction read none.
   *
   * It used to be the literal string "Address Not Found", which is a sentinel
   * sitting in a value slot: truthy, so it survived every `||` fallback
   * downstream and arrived at `PropertyImportPanel`, `documentExtract` and the
   * report's own `property_address` as though it were the property's recorded
   * address. The 19 Sep 2026 clone audit reported exactly that, as the address
   * shown on an import. Same rule `propertyTypeLabel` already answers to —
   * **an instruction must never occupy a value slot** — so the slot carries
   * the address or nothing, and each reader states the absence in its own
   * words.
   */
  propertyAddress: string | null;
  suburb?: string;
  state?: string;
  postcode?: string;
  purchasePrice?: number;
  weeklyRent?: number;
  bedrooms?: number;
  bathrooms?: number;
  carSpaces?: number;
  landSize?: number;
  buildSize?: number;
  propertyType?: string;
  landPrice?: number;
  buildPrice?: number;
  isNewBuild: boolean;
  councilRates?: number;
  waterRates?: number;
  strataFees?: number;
  insuranceEstimate?: number;
  propertyManagementPercent?: number;
  yearBuilt?: number;
  stampDuty?: number;
  agentFee?: number;
  assetClass?: string;
  assetSubType?: string;
  tenure?: string;
  zoning?: string;
  gfaSqm?: number;
  nlaSqm?: number;
  glaSqm?: number;
  siteAreaSqm?: number;
  parkingBays?: number;
  currentValuation?: number;
  propertyName?: string;
  siteCoverPct?: number;
  officePct?: number;
  hardstandSqm?: number;
  clearanceMetres?: number;
  powerKva?: number;
  dockDoors?: number;
  groundFloorLoadKpa?: number;
  conditionRating?: string;
  detectedAssetClass?: 'residential' | 'commercial' | 'industrial';
  detectedAssetConfidence?: number;
  passingNoiPa?: number;
  marketNoiPa?: number;
  passingCapRatePct?: number;
  marketCapRatePct?: number;
  vendorAdvisedRentPa?: number;
  vendorAdvisedOutgoingsPa?: number;
  outgoingsTotalPa?: number;
  outgoingsRecoverablePa?: number;
  vendorAdvisedYieldPct?: number;
  gstTreatment?: string;
  leaseType?: string;
  leaseExpiryDate?: string;
  leaseOptions?: string;
  waleYears?: number;
  tenantNames?: string[];
  truckAccess?: string;
}

// ============= RESPONSE COERCION =============

/**
 * Plausibility envelopes. A value outside its envelope is dropped rather than
 * written to the property record: a vision model that misreads a floor-plan
 * dimension as `bedrooms: 340` must not silently corrupt the row, and a
 * "$1,250,000" read as the weekly rent is worse than no rent at all.
 */
const MONEY = { min: 0, max: 5_000_000_000 } as const;
const AREA = { min: 0, max: 10_000_000 } as const;

const PROPERTY_TYPES = [
  'house', 'apartment', 'townhouse', 'land', 'house_and_land', 'villa', 'duplex',
  'unit', 'office', 'retail', 'warehouse', 'logistics', 'manufacturing',
  'mixed_use', 'medical', 'childcare', 'hospitality', 'other',
] as const;

const PROPERTY_TYPE_ALIASES: Record<string, (typeof PROPERTY_TYPES)[number]> = {
  'house and land': 'house_and_land', 'h&l': 'house_and_land',
  'house & land': 'house_and_land', 'mixed use': 'mixed_use',
  flat: 'apartment', 'vacant land': 'land', industrial: 'warehouse',
  'distribution warehouse': 'warehouse', 'child care': 'childcare',
};

const TENURES = ['freehold', 'leasehold', 'strata', 'community_title', 'crown_lease'] as const;
const GST_TREATMENTS = ['going_concern', 'margin_scheme', 'standard', 'input_taxed'] as const;
const LEASE_TYPES = ['gross', 'net', 'semi_gross', 'triple_net'] as const;
const TRUCK_ACCESS = ['poor', 'average', 'good', 'excellent'] as const;
const ASSET_CLASSES = ['residential', 'commercial', 'industrial'] as const;
const CONDITION_RATINGS = ['A', 'B', 'C', 'D'] as const;

/**
 * Turn a vision response into typed property data.
 *
 * Every field is recovered through the shared coercers, which is the fix for a
 * long-standing silent-data-loss defect: the previous `typeof x === 'number'`
 * guards discarded `"850000"`, `"$850,000"`, `"6.25%"` and `"1,200 sqm"` — the
 * shapes a vision model actually returns when reading a brochure — so correctly
 * *read* values were thrown away at the parse step. String fields likewise now
 * drop `"N/A"`/`"Not stated"` instead of storing them as an address.
 *
 * Returns null when the response could not be read at all, so the caller can
 * distinguish "model found nothing" from "we could not parse the model".
 */
export function parseVisionResponse(content: string): ExtractedPropertyData | null {
  const parsed = parseLlmJson<Record<string, unknown>>(content);
  if (!parsed || typeof parsed !== 'object') {
    console.error('❌ Failed to parse vision response as JSON. Content:', String(content).substring(0, 500));
    return null;
  }

  const p = parsed;
  const data: ExtractedPropertyData = {
    address: coerceText(p.address, { maxLength: 300 }),
    suburb: coerceText(p.suburb, { maxLength: 120 }),
    state: coerceAuState(p.state),
    postcode: coerceAuPostcode(p.postcode),
    price: coerceNumber(p.price, MONEY),
    weeklyRent: coerceNumber(p.weeklyRent, { min: 0, max: 100_000 }),
    bedrooms: coerceInteger(p.bedrooms, { min: 0, max: 100 }),
    bathrooms: coerceNumber(p.bathrooms, { min: 0, max: 100, decimals: 1 }),
    carSpaces: coerceInteger(p.carSpaces, { min: 0, max: 1000 }),
    landSize: coerceNumber(p.landSize, { ...AREA, decimals: 2 }),
    buildSize: coerceNumber(p.buildSize, { ...AREA, decimals: 2 }),
    propertyType: coerceEnum(p.propertyType, PROPERTY_TYPES, PROPERTY_TYPE_ALIASES),
    landPrice: coerceNumber(p.landPrice, MONEY),
    buildPrice: coerceNumber(p.buildPrice, MONEY),
    isNewBuild: coerceBoolean(p.isNewBuild) === true,
    councilRates: coerceNumber(p.councilRates, MONEY),
    waterRates: coerceNumber(p.waterRates, MONEY),
    strataFees: coerceNumber(p.strataFees, MONEY),
    insuranceEstimate: coerceNumber(p.insuranceEstimate, MONEY),
    propertyManagementPercent: coercePercent(p.propertyManagementPercent, { min: 0, max: 100, decimals: 2 }),
    yearBuilt: coerceInteger(p.yearBuilt, { min: 1700, max: 2100 }),
    stampDuty: coerceNumber(p.stampDuty, MONEY),
    agentFee: coerceNumber(p.agentFee, MONEY),
    assetClass: coerceText(p.assetClass, { maxLength: 80 }),
    assetSubType: coerceText(p.assetSubType, { maxLength: 120 }),
    tenure: coerceEnum(p.tenure, TENURES, { 'community title': 'community_title', 'crown lease': 'crown_lease' }),
    zoning: coerceText(p.zoning, { maxLength: 80 }),
    gfaSqm: coerceNumber(p.gfaSqm, { ...AREA, decimals: 2 }),
    nlaSqm: coerceNumber(p.nlaSqm, { ...AREA, decimals: 2 }),
    glaSqm: coerceNumber(p.glaSqm, { ...AREA, decimals: 2 }),
    siteAreaSqm: coerceNumber(p.siteAreaSqm, { ...AREA, decimals: 2 }),
    parkingBays: coerceInteger(p.parkingBays, { min: 0, max: 100_000 }),
    currentValuation: coerceNumber(p.currentValuation, MONEY),
    propertyName: coerceText(p.propertyName, { maxLength: 160 }),
    siteCoverPct: coercePercent(p.siteCoverPct, { min: 0, max: 100, decimals: 2 }),
    officePct: coercePercent(p.officePct, { min: 0, max: 100, decimals: 2 }),
    hardstandSqm: coerceNumber(p.hardstandSqm, { ...AREA, decimals: 2 }),
    clearanceMetres: coerceNumber(p.clearanceMetres, { min: 0, max: 200, decimals: 2 }),
    powerKva: coerceNumber(p.powerKva, { min: 0, max: 1_000_000, decimals: 2 }),
    dockDoors: coerceInteger(p.dockDoors, { min: 0, max: 1000 }),
    groundFloorLoadKpa: coerceNumber(p.groundFloorLoadKpa, { min: 0, max: 1_000_000, decimals: 2 }),
    conditionRating: coerceEnum(String(coerceText(p.conditionRating) ?? '').toUpperCase().slice(0, 1), CONDITION_RATINGS),
    detectedAssetClass: coerceEnum(p.detectedAssetClass, ASSET_CLASSES),
    detectedAssetConfidence: coerceNumber(p.detectedAssetConfidence, { min: 0, max: 1, decimals: 3 }),
    passingNoiPa: coerceNumber(p.passingNoiPa, MONEY),
    marketNoiPa: coerceNumber(p.marketNoiPa, MONEY),
    // Cap rates and yields above 30% are a misread, not a bargain.
    passingCapRatePct: coercePercent(p.passingCapRatePct, { min: 0, max: 30, decimals: 3 }),
    marketCapRatePct: coercePercent(p.marketCapRatePct, { min: 0, max: 30, decimals: 3 }),
    vendorAdvisedRentPa: coerceNumber(p.vendorAdvisedRentPa, MONEY),
    vendorAdvisedOutgoingsPa: coerceNumber(p.vendorAdvisedOutgoingsPa, MONEY),
    outgoingsTotalPa: coerceNumber(p.outgoingsTotalPa, MONEY),
    outgoingsRecoverablePa: coerceNumber(p.outgoingsRecoverablePa, MONEY),
    vendorAdvisedYieldPct: coercePercent(p.vendorAdvisedYieldPct, { min: 0, max: 30, decimals: 3 }),
    gstTreatment: coerceEnum(p.gstTreatment, GST_TREATMENTS, {
      'going concern': 'going_concern', 'margin scheme': 'margin_scheme', 'input taxed': 'input_taxed',
    }),
    leaseType: coerceEnum(p.leaseType, LEASE_TYPES, {
      'semi gross': 'semi_gross', 'triple net': 'triple_net', nnn: 'triple_net',
    }),
    leaseExpiryDate: coerceIsoDate(p.leaseExpiryDate),
    leaseOptions: coerceText(p.leaseOptions, { maxLength: 120 }),
    waleYears: coerceNumber(p.waleYears, { min: 0, max: 99, decimals: 2 }),
    tenantNames: coerceStringArray(p.tenantNames, { maxItems: 5, maxItemLength: 120 }),
    truckAccess: coerceEnum(p.truckAccess, TRUCK_ACCESS),
  };

  // Drop keys whose value did not survive coercion so `mergeExtractedData` and
  // the field counters see a clean, sparse object.
  for (const key of Object.keys(data) as (keyof ExtractedPropertyData)[]) {
    if (data[key] === undefined) delete data[key];
  }
  if (data.isNewBuild === false) delete data.isNewBuild;

  return data;
}

/** How many fields an extraction actually populated — used for logging + merge. */
export function populatedFieldCount(data: ExtractedPropertyData): number {
  return Object.values(data).filter((value) => value != null && value !== '').length;
}

/**
 * Merge two extraction results.
 * - Numeric/text fields: the first non-null value wins (earlier pages — cover,
 *   key details, financial summary — are the authoritative ones).
 * - `isNewBuild`: true is sticky (any page asserting it is enough).
 * - `detectedAssetClass`: the *highest-confidence* answer wins rather than the
 *   first one seen, so a cover page that guessed "residential" at 0.4 no longer
 *   outranks a financial-summary page that identified "industrial" at 0.95.
 * - `tenantNames`: unioned across batches — a rent roll spanning two batches
 *   used to contribute only the tenants on its first page.
 */
export function mergeExtractedData(existing: ExtractedPropertyData, incoming: ExtractedPropertyData): ExtractedPropertyData {
  const result: Record<string, unknown> = { ...existing };

  for (const [key, value] of Object.entries(incoming)) {
    if (value == null) continue;

    if (key === 'isNewBuild') {
      if (value === true) result[key] = true;
      continue;
    }

    if (key === 'detectedAssetClass' || key === 'detectedAssetConfidence') continue; // handled below

    if (key === 'tenantNames' && Array.isArray(value)) {
      const merged = Array.isArray(result[key]) ? [...(result[key] as string[])] : [];
      for (const name of value as string[]) {
        if (!merged.some((existingName) => existingName.toLowerCase() === name.toLowerCase())) {
          merged.push(name);
        }
      }
      result[key] = merged.slice(0, 5);
      continue;
    }

    if (result[key] == null) result[key] = value;
  }

  if (incoming.detectedAssetClass) {
    const incomingConfidence = incoming.detectedAssetConfidence ?? 0;
    const existingConfidence = existing.detectedAssetClass ? existing.detectedAssetConfidence ?? 0 : -1;
    if (incomingConfidence > existingConfidence) {
      result.detectedAssetClass = incoming.detectedAssetClass;
      result.detectedAssetConfidence = incoming.detectedAssetConfidence;
    }
  }

  return result as ExtractedPropertyData;
}

// ============= STRUCTURED PAYLOAD =============

/** Escape a value so it can be used literally inside a RegExp. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `needle` appears in `haystack` as a whole word (case-insensitive). */
export function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(needle)}([^A-Za-z0-9]|$)`, 'i').test(haystack);
}

export function processToStructuredPayload(extractedData: ExtractedPropertyData): StructuredPropertyPayload {
  let propertyAddress = '';

  if (extractedData.address) {
    propertyAddress = extractedData.address;
  }

  const addressParts: string[] = [];

  // Whole-word checks: a substring test made "NSW" look present inside
  // "TRANSWAY" and "SA" inside "Sandy Bay", so the state was dropped from the
  // composed address.
  if (extractedData.suburb && !containsWord(propertyAddress, extractedData.suburb)) {
    addressParts.push(extractedData.suburb);
  }

  if (extractedData.state && !containsWord(propertyAddress, extractedData.state)) {
    addressParts.push(extractedData.state);
  }

  if (extractedData.postcode && !containsWord(propertyAddress, extractedData.postcode)) {
    addressParts.push(extractedData.postcode);
  }

  if (addressParts.length > 0) {
    propertyAddress = propertyAddress 
      ? `${propertyAddress}, ${addressParts.join(' ')}` 
      : addressParts.join(', ');
  }
  
  return {
    propertyAddress: propertyAddress || null,
    suburb: extractedData.suburb,
    state: extractedData.state,
    postcode: extractedData.postcode,
    purchasePrice: extractedData.price,
    weeklyRent: extractedData.weeklyRent,
    bedrooms: extractedData.bedrooms,
    bathrooms: extractedData.bathrooms,
    carSpaces: extractedData.carSpaces,
    landSize: extractedData.landSize,
    buildSize: extractedData.buildSize,
    propertyType: extractedData.propertyType,
    landPrice: extractedData.landPrice,
    buildPrice: extractedData.buildPrice,
    isNewBuild: extractedData.isNewBuild || false,
    councilRates: extractedData.councilRates,
    waterRates: extractedData.waterRates,
    strataFees: extractedData.strataFees,
    insuranceEstimate: extractedData.insuranceEstimate,
    propertyManagementPercent: extractedData.propertyManagementPercent,
    yearBuilt: extractedData.yearBuilt,
    stampDuty: extractedData.stampDuty,
    agentFee: extractedData.agentFee,
    assetClass: extractedData.assetClass,
    assetSubType: extractedData.assetSubType,
    tenure: extractedData.tenure,
    zoning: extractedData.zoning,
    gfaSqm: extractedData.gfaSqm,
    nlaSqm: extractedData.nlaSqm,
    glaSqm: extractedData.glaSqm,
    siteAreaSqm: extractedData.siteAreaSqm,
    parkingBays: extractedData.parkingBays,
    currentValuation: extractedData.currentValuation,
    propertyName: extractedData.propertyName,
    siteCoverPct: extractedData.siteCoverPct,
    officePct: extractedData.officePct,
    hardstandSqm: extractedData.hardstandSqm,
    clearanceMetres: extractedData.clearanceMetres,
    powerKva: extractedData.powerKva,
    dockDoors: extractedData.dockDoors,
    groundFloorLoadKpa: extractedData.groundFloorLoadKpa,
    conditionRating: extractedData.conditionRating,
    detectedAssetClass: extractedData.detectedAssetClass,
    detectedAssetConfidence: extractedData.detectedAssetConfidence,
    passingNoiPa: extractedData.passingNoiPa,
    marketNoiPa: extractedData.marketNoiPa,
    passingCapRatePct: extractedData.passingCapRatePct,
    marketCapRatePct: extractedData.marketCapRatePct,
    vendorAdvisedRentPa: extractedData.vendorAdvisedRentPa,
    vendorAdvisedOutgoingsPa: extractedData.vendorAdvisedOutgoingsPa,
    outgoingsTotalPa: extractedData.outgoingsTotalPa,
    outgoingsRecoverablePa: extractedData.outgoingsRecoverablePa,
    vendorAdvisedYieldPct: extractedData.vendorAdvisedYieldPct,
    gstTreatment: extractedData.gstTreatment,
    leaseType: extractedData.leaseType,
    leaseExpiryDate: extractedData.leaseExpiryDate,
    leaseOptions: extractedData.leaseOptions,
    waleYears: extractedData.waleYears,
    tenantNames: extractedData.tenantNames,
    truckAccess: extractedData.truckAccess,
  };
}
