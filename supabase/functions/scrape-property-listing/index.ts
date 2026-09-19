import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyAuth, createCorsHeaders, createUnauthorizedResponse } from '../_shared/auth.ts';
import { enforceCsrf, csrfDenied } from "../_shared/csrfGuard.ts";
import { callLLM, LLMError } from '../_shared/llmRouter.ts';
import { normalizePropertyListingUrl } from './urlPolicy.ts';
import { describeScrapeFailure, shouldRetryWithoutSchema } from './scrapeFailure.pure.ts';
import {
  brokeredPageReadUrl, refusePageReadUrl, resolvePageReadRoute, type PageReadRoute,
} from '../_shared/pageRead/pageReadRoute.pure.ts';
import { contradictionMessage, corroborateAddress } from './addressCorroboration.pure.ts';

/**
 * The Model Hub agent whose binding drives this extraction
 * (`agent_model_assignments.agent_key`, labelled "Property Listing Scraper").
 */
const LISTING_SCRAPE_AGENT_KEY = 'listing_scrape';

/**
 * Budgets for the model phase. The scrape runs detached under
 * `EdgeRuntime.waitUntil`, so no request timeout bounds it — the direct fetch
 * this replaced passed no signal at all, which is why a hung provider could
 * leave a job 'processing' for ever. The chain-wide deadline is what stops the
 * fallback walk (and the schema-free retry) from compounding into one.
 */
const PER_MODEL_TIMEOUT_MS = 90_000;
const MODEL_PHASE_BUDGET_MS = 240_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-correlation-id, x-step-up-token",
  "Access-Control-Expose-Headers": "x-correlation-id, x-tokens-used, x-tokens-reserved, x-tokens-estimated, x-duration-ms",
};

type ListingExtraction = {
  title: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  price_aud: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  car_spaces: number | null;
  land_size_sqm: number | null;
  build_size_sqm: number | null;
  property_type: string | null;
  key_features: string[] | null;
  agent_name: string | null;
  agency: string | null;
  listing_text: string | null;
  confidence: number | null;
  // Extended fields for pre-generation overrides
  weekly_rent: number | null;
  is_new_build: boolean | null;
  land_price: number | null;
  build_price: number | null;
  council_rates: number | null;
  water_rates: number | null;
  strata_fees: number | null;
  insurance_estimate: number | null;
  property_management_percent: number | null;
  year_built: number | null;
  asset_class: string | null;
  asset_sub_type: string | null;
  tenure: string | null;
  zoning: string | null;
  gfa_sqm: number | null;
  nla_sqm: number | null;
  gla_sqm: number | null;
  site_area_sqm: number | null;
  parking_bays: number | null;
  current_valuation: number | null;
  property_name: string | null;
  site_cover_pct: number | null;
  office_pct: number | null;
  hardstand_sqm: number | null;
  clearance_metres: number | null;
  power_kva: number | null;
  dock_doors: number | null;
  ground_floor_load_kpa: number | null;
  condition_rating: string | null;
  // ---- Phase: commercial/industrial financial & lease enrichment ----
  detected_asset_class: 'residential' | 'commercial' | 'industrial' | null;
  detected_asset_confidence: number | null;
  passing_noi_pa: number | null;
  market_noi_pa: number | null;
  passing_cap_rate_pct: number | null;
  market_cap_rate_pct: number | null;
  vendor_advised_rent_pa: number | null;
  vendor_advised_outgoings_pa: number | null;
  outgoings_total_pa: number | null;
  outgoings_recoverable_pa: number | null;
  lease_type: string | null;
  lease_expiry_date: string | null;
  lease_options: string | null;
  wale_years: number | null;
  tenant_names: string[] | null;
  gst_treatment: string | null;
  truck_access: string | null;
  vendor_advised_yield_pct: number | null;
};

function safeJsonParse<T>(s: string): T | null {
  try {
    let cleaned = s
      .replace(/^```json\s*/im, "")
      .replace(/^```\s*/im, "")
      .replace(/```\s*$/im, "")
      .trim();

    if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
      const objStart = cleaned.indexOf("{");
      const arrStart = cleaned.indexOf("[");
      const isArray = arrStart !== -1 && (objStart === -1 || arrStart < objStart);
      const start = isArray ? arrStart : objStart;
      const end = isArray ? cleaned.lastIndexOf("]") : cleaned.lastIndexOf("}");
      if (start !== -1 && end > start) cleaned = cleaned.slice(start, end + 1);
    }

    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

function numberFromText(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/\$|AUD|approx\.?|about|,/gi, '').trim();
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function areaToSqm(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = numberFromText(value);
  if (n === null || !Number.isFinite(n)) return null;
  const lower = value.toLowerCase();
  if (/ha|hectare/.test(lower)) return Math.round(n * 10000);
  if (/acre/.test(lower)) return Math.round(n * 4046.86);
  if (/sq\s*ft|sqft|ft²|ft2/.test(lower)) return Math.round(n * 0.092903);
  return n;
}

function auDateToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function isBadScrapeContent(markdown: string): boolean {
  const sample = markdown.slice(0, 1200).toLowerCase();
  return /access denied|akamai|powered and protected by|captcha|forbidden|scrape_timeout/.test(sample);
}

function deriveListingHints(url: string): { propertyId?: string; addressHint?: string; hostname?: string } {
  try {
    const u = new URL(url);
    const slug = u.pathname.split('/').filter(Boolean).pop() || '';
    const propertyId = slug.match(/(\d{7,})$/)?.[1];
    const withoutId = slug.replace(/-\d{7,}$/, '');
    const addressHint = withoutId
      .split('-')
      .filter(Boolean)
      .map((part) => part.toUpperCase() === part ? part : part.replace(/\b\w/g, (c) => c.toUpperCase()))
      .join(' ');
    return { propertyId, addressHint, hostname: u.hostname.replace(/^www\./, '') };
  } catch {
    return {};
  }
}

function fill<T extends keyof ListingExtraction>(target: ListingExtraction, key: T, value: ListingExtraction[T] | null | undefined) {
  const current = target[key];
  if ((current === null || current === undefined || current === '' || (Array.isArray(current) && current.length === 0)) && value !== null && value !== undefined && value !== '') {
    (target as any)[key] = value;
  }
}

function enrichExtractionFromSource(extracted: ListingExtraction, sourceText: string | null, url: string, propertyCategory: string): ListingExtraction {
  const enriched = { ...extracted };
  const hints = deriveListingHints(url);
  const text = sourceText || '';
  const compact = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ');

  if (!sourceText || isBadScrapeContent(sourceText)) return enriched;

  const addressLine = firstMatch(compact, [
    /^#\s+([^\n]+?\b(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s+\d{4})/im,
    /›\s*([^\n]+?\b(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s+\d{4})/im,
    /Map for\s+([^\n]+?\b(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s+\d{4})/im,
  ]);
  if (addressLine) {
    const m = addressLine.match(/^(.*?)\s+([^,\n]+?)\s+(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s+(\d{4})$/i);
    if (m) {
      fill(enriched, 'address', m[1].trim());
      fill(enriched, 'suburb', m[2].trim());
      fill(enriched, 'state', m[3].toUpperCase());
      fill(enriched, 'postcode', m[4]);
      fill(enriched, 'title', addressLine.trim());
    }
  }

  fill(enriched, 'price_aud', numberFromText(firstMatch(compact, [
    /Price\s*For Sale,?\s*\$?([\d,]+(?:\.\d+)?)/i,
    /For Sale,?\s*\$?([\d,]+(?:\.\d+)?)/i,
    /Price\s*\$?([\d,]+(?:\.\d+)?)/i,
  ])) as any);

  const floorArea = areaToSqm(firstMatch(compact, [
    /Floor Size\s*([\d,.]+\s*(?:m²|sqm|sq\s*m|sqft|sq\s*ft))/i,
    /\|\s*Floor Area\s*\|\s*([\d,.]+\s*(?:m²|sqm|sq\s*m|sqft|sq\s*ft))/i,
    /floor area of\s*([\d,.]+\s*(?:m²|sqm|sq\s*m|sqft|sq\s*ft))/i,
    /Building Area\s*\|\s*([\d,.]+\s*(?:m²|sqm|sq\s*m|sqft|sq\s*ft))/i,
  ]));
  if (floorArea !== null) {
    fill(enriched, propertyCategory === 'industrial' ? 'gla_sqm' : 'nla_sqm', floorArea as any);
    fill(enriched, 'gfa_sqm', floorArea as any);
    fill(enriched, 'build_size_sqm', floorArea as any);
  }

  fill(enriched, 'site_area_sqm', areaToSqm(firstMatch(compact, [
    /\|\s*Land Area\s*\|\s*([\d,.]+\s*(?:m²|sqm|sq\s*m|ha|acres?))/i,
    /Site Area\s*\|\s*([\d,.]+\s*(?:m²|sqm|sq\s*m|ha|acres?))/i,
    /Land(?: Size| Area)?\s*([\d,.]+\s*(?:m²|sqm|sq\s*m|ha|acres?))/i,
  ])) as any);

  fill(enriched, 'parking_bays', numberFromText(firstMatch(compact, [
    /\|\s*Parking\s*\|\s*(\d+)\s*x?/i,
    /Parking\s*(\d+)\s*x?/i,
    /(\d+)\s*x\s*Onsite parkings?/i,
  ])) as any);

  const category = firstMatch(compact, [/\|\s*Category\s*\|\s*\[?([^\]|\n]+)/i, /^-\s*(Offices|Retail|Industrial|Medical|Childcare|Hospitality|Showrooms?|Warehouses?)/im]);
  if (category) {
    const lower = category.toLowerCase();
    const cls = lower.includes('office') ? 'office' : lower.includes('retail') ? 'retail' : lower.includes('warehouse') || lower.includes('industrial') ? 'industrial' : lower.includes('medical') ? 'medical' : lower.includes('child') ? 'childcare' : lower.includes('hospital') ? 'hospitality' : null;
    if (cls) {
      fill(enriched, 'asset_class', cls as any);
      fill(enriched, 'property_type', cls as any);
      fill(enriched, 'detected_asset_class', cls === 'industrial' ? 'industrial' as any : 'commercial' as any);
      fill(enriched, 'detected_asset_confidence', 0.9 as any);
    }
  }

  const rentLine = firstMatch(compact, [/(\$[\d,]+(?:\.\d+)?\s*(?:pa|p\.a\.|per annum)[^\n]*)/i, /(\$[\d,]+(?:\.\d+)?\s*pw[^\n]*)/i]);
  if (rentLine) {
    const rent = numberFromText(rentLine);
    if (rent !== null) fill(enriched, 'vendor_advised_rent_pa', /pw|per week/i.test(rentLine) ? rent * 52 as any : rent as any);
    if (/\bnet\b/i.test(rentLine)) fill(enriched, 'lease_type', 'net' as any);
    if (/gross/i.test(rentLine)) fill(enriched, 'lease_type', 'gross' as any);
  }

  const leaseLine = firstMatch(compact, [/(Lease ends?\s+\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}[^\n]*)/i, /(Lease expir(?:y|es)\s+\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}[^\n]*)/i]);
  if (leaseLine) {
    fill(enriched, 'lease_expiry_date', auDateToIso(leaseLine) as any);
    const option = leaseLine.match(/\+\s*([^\n]+option[^\n]*)/i)?.[1]?.trim();
    if (option) fill(enriched, 'lease_options', option as any);
  }

  const gstText = compact.slice(0, 20000);
  if (/no\s*gst/i.test(gstText)) fill(enriched, 'gst_treatment', 'input_taxed' as any);
  else if (/going concern/i.test(gstText)) fill(enriched, 'gst_treatment', 'going_concern' as any);
  else if (/margin scheme/i.test(gstText)) fill(enriched, 'gst_treatment', 'margin_scheme' as any);
  else if (/\+\s*gst|gst\s*inclusive|inc\.?\s*gst/i.test(gstText)) fill(enriched, 'gst_treatment', 'standard' as any);

  fill(enriched, 'agency', firstMatch(compact, [/\[([^\]]+?)\]\([^\)]*real-estate-agents/i, /!\[([^\]]+?)\]\([^\)]*Agencys/i]) as any);
  fill(enriched, 'agent_name', firstMatch(compact, [/\n\[([^\]\n]+?)\]\([^\)]*agent-profile/i, /###\s*Co-Agents[\s\S]{0,300}?\n\[?([A-Z][a-z]+\s+[A-Z][a-z]+)/]) as any);
  fill(enriched, 'property_name', firstMatch(compact, [/##\s+([^\n]+)\n\n-\s+/i, /##\s+([^\n]*(?:Investment|Office|Warehouse|Retail|Showroom|Medical)[^\n]*)/i]) as any);
  fill(enriched, 'listing_text', firstMatch(compact, [/##\s+[^\n]+\n\n(?:-\s*[^\n]+\n){1,5}\n([^\n]{80,500})/i]) as any);
  if (!enriched.confidence || enriched.confidence < 0.82) enriched.confidence = 0.82;

  if (hints.propertyId && !enriched.key_features?.some((f) => f.includes(hints.propertyId!))) {
    const existing = Array.isArray(enriched.key_features) ? enriched.key_features : [];
    enriched.key_features = [...existing, `Property ID ${hints.propertyId}`].slice(0, 10);
  }

  return enriched;
}

function toExtractedDetails(extracted: ListingExtraction, fallbackTitle?: string | null) {
  const details: any = {};

  const title = extracted.title ?? fallbackTitle ?? null;
  if (title) details.title = title;

  if (extracted.address) details.extractedAddress = extracted.address;
  if (extracted.suburb) details.extractedSuburb = extracted.suburb;
  if (extracted.state) details.extractedState = extracted.state.toUpperCase();
  if (extracted.postcode) details.extractedPostcode = extracted.postcode;

  if (typeof extracted.price_aud === "number") details.extractedPrice = extracted.price_aud;
  if (typeof extracted.bedrooms === "number") details.extractedBedrooms = extracted.bedrooms;
  if (typeof extracted.bathrooms === "number") details.extractedBathrooms = extracted.bathrooms;
  if (typeof extracted.car_spaces === "number") details.extractedCarSpaces = extracted.car_spaces;
  if (typeof extracted.land_size_sqm === "number") details.extractedLandSize = extracted.land_size_sqm;
  if (typeof extracted.build_size_sqm === "number") details.extractedBuildSize = extracted.build_size_sqm;
  if (extracted.property_type) details.extractedPropertyType = extracted.property_type;

  // Extended pre-generation override fields
  if (typeof extracted.weekly_rent === "number") details.extractedWeeklyRent = extracted.weekly_rent;
  if (extracted.is_new_build !== null) details.extractedIsNewBuild = extracted.is_new_build;
  if (typeof extracted.land_price === "number") details.extractedLandPrice = extracted.land_price;
  if (typeof extracted.build_price === "number") details.extractedBuildPrice = extracted.build_price;
  if (typeof extracted.council_rates === "number") details.extractedCouncilRates = extracted.council_rates;
  if (typeof extracted.water_rates === "number") details.extractedWaterRates = extracted.water_rates;
  if (typeof extracted.strata_fees === "number") details.extractedStrataFees = extracted.strata_fees;
  if (typeof extracted.insurance_estimate === "number") details.extractedInsurance = extracted.insurance_estimate;
  if (typeof extracted.property_management_percent === "number") details.extractedPropertyManagementPercent = extracted.property_management_percent;
  if (typeof extracted.year_built === "number") details.extractedYearBuilt = extracted.year_built;

  if (extracted.asset_class) details.extractedAssetClass = extracted.asset_class;
  if (extracted.asset_sub_type) details.extractedAssetSubType = extracted.asset_sub_type;
  if (extracted.tenure) details.extractedTenure = extracted.tenure;
  if (extracted.zoning) details.extractedZoning = extracted.zoning;
  if (typeof extracted.gfa_sqm === "number") details.extractedGfaSqm = extracted.gfa_sqm;
  if (typeof extracted.nla_sqm === "number") details.extractedNlaSqm = extracted.nla_sqm;
  if (typeof extracted.gla_sqm === "number") details.extractedGlaSqm = extracted.gla_sqm;
  if (typeof extracted.site_area_sqm === "number") details.extractedSiteAreaSqm = extracted.site_area_sqm;
  if (typeof extracted.parking_bays === "number") details.extractedParkingBays = extracted.parking_bays;
  if (typeof extracted.current_valuation === "number") details.extractedValuation = extracted.current_valuation;
  if (extracted.property_name) details.extractedPropertyName = extracted.property_name;
  if (typeof extracted.site_cover_pct === "number") details.extractedSiteCoverPct = extracted.site_cover_pct;
  if (typeof extracted.office_pct === "number") details.extractedOfficePct = extracted.office_pct;
  if (typeof extracted.hardstand_sqm === "number") details.extractedHardstandSqm = extracted.hardstand_sqm;
  if (typeof extracted.clearance_metres === "number") details.extractedClearanceMetres = extracted.clearance_metres;
  if (typeof extracted.power_kva === "number") details.extractedPowerKva = extracted.power_kva;
  if (typeof extracted.dock_doors === "number") details.extractedDockDoors = extracted.dock_doors;
  if (typeof extracted.ground_floor_load_kpa === "number") details.extractedGroundFloorLoadKpa = extracted.ground_floor_load_kpa;
  if (extracted.condition_rating) details.extractedConditionRating = extracted.condition_rating;
  // Commercial/industrial enrichment passthrough
  if (extracted.detected_asset_class) details.detectedAssetClass = extracted.detected_asset_class;
  if (typeof extracted.detected_asset_confidence === 'number') details.detectedAssetConfidence = extracted.detected_asset_confidence;
  if (typeof extracted.passing_noi_pa === 'number') details.extractedPassingNoiPa = extracted.passing_noi_pa;
  if (typeof extracted.market_noi_pa === 'number') details.extractedMarketNoiPa = extracted.market_noi_pa;
  if (typeof extracted.passing_cap_rate_pct === 'number') details.extractedPassingCapRatePct = extracted.passing_cap_rate_pct;
  if (typeof extracted.market_cap_rate_pct === 'number') details.extractedMarketCapRatePct = extracted.market_cap_rate_pct;
  if (typeof extracted.vendor_advised_rent_pa === 'number') details.extractedVendorRentPa = extracted.vendor_advised_rent_pa;
  if (typeof extracted.vendor_advised_outgoings_pa === 'number') details.extractedVendorOutgoingsPa = extracted.vendor_advised_outgoings_pa;
  if (typeof extracted.outgoings_total_pa === 'number') details.extractedOutgoingsTotalPa = extracted.outgoings_total_pa;
  if (typeof extracted.outgoings_recoverable_pa === 'number') details.extractedOutgoingsRecoverablePa = extracted.outgoings_recoverable_pa;
  if (extracted.lease_type) details.extractedLeaseType = extracted.lease_type;
  if (extracted.lease_expiry_date) details.extractedLeaseExpiryDate = extracted.lease_expiry_date;
  if (extracted.lease_options) details.extractedLeaseOptions = extracted.lease_options;
  if (typeof extracted.wale_years === 'number') details.extractedWaleYears = extracted.wale_years;
  if (Array.isArray(extracted.tenant_names) && extracted.tenant_names.length) details.extractedTenantNames = extracted.tenant_names;
  if (extracted.gst_treatment) details.extractedGstTreatment = extracted.gst_treatment;
  if (extracted.truck_access) details.extractedTruckAccess = extracted.truck_access;
  if (typeof extracted.vendor_advised_yield_pct === 'number') details.extractedVendorYieldPct = extracted.vendor_advised_yield_pct;

  // If we have suburb/state/postcode but no address, build a partial address.
  if (!details.extractedAddress && details.extractedSuburb && details.extractedState) {
    details.extractedAddress = `${details.extractedSuburb}, ${details.extractedState}${details.extractedPostcode ? " " + details.extractedPostcode : ""}`;
  }

  return details;
}

function buildListingMarkdown(inputUrl: string, extracted: ListingExtraction, citations: string[] | undefined) {
  const lines: string[] = [];
  lines.push(`# Property Listing (AI extracted)`);
  lines.push(`Source URL: ${inputUrl}`);
  if (citations?.length) {
    lines.push(``);
    lines.push(`## Citations`);
    for (const c of citations) lines.push(`- ${c}`);
  }

  lines.push(``);
  lines.push(`## Extracted Details`);
  const add = (label: string, value: any) => {
    if (value === null || value === undefined || value === "") return;
    lines.push(`- **${label}:** ${value}`);
  };

  add("Title", extracted.title);
  add("Address", extracted.address);
  add("Suburb", extracted.suburb);
  add("State", extracted.state);
  add("Postcode", extracted.postcode);
  add("Price (AUD)", extracted.price_aud ? `$${Math.round(extracted.price_aud).toLocaleString("en-AU")}` : null);
  add("Bedrooms", extracted.bedrooms);
  add("Bathrooms", extracted.bathrooms);
  add("Car spaces", extracted.car_spaces);
  add("Land size (sqm)", extracted.land_size_sqm);
  add("Build size (sqm)", extracted.build_size_sqm);
  add("Property type", extracted.property_type);
  add("Agent", extracted.agent_name);
  add("Agency", extracted.agency);
  add("Confidence", extracted.confidence);

  if (extracted.key_features?.length) {
    lines.push(``);
    lines.push(`## Key Features`);
    for (const f of extracted.key_features) lines.push(`- ${f}`);
  }

  if (extracted.listing_text) {
    lines.push(``);
    lines.push(`## Listing Text (summary / relevant excerpt)`);
    lines.push(extracted.listing_text);
  }

  return lines.join("\n");
}

/**
 * Ask Mission Control to read the page.
 *
 * It answers the same shape Firecrawl's own reader produces, so the caller
 * cannot tell the two apart and `scrapedFromPage` means the same thing on
 * every deployment. A refusal is logged and answered as null — which is what
 * "the page could not be read" already means here — rather than failing the
 * job, because the search fallback and its warning are still a better outcome
 * than no scrape at all.
 *
 * NOT metered here. Mission Control made the vendor call and writes the usage
 * row; both ends billing is worse than neither.
 */
async function readPageThroughBroker(
  url: string,
  route: Extract<PageReadRoute, { via: 'broker' }>,
): Promise<{ markdown: string; title?: string; description?: string } | null> {
  // The broker enforces this too — it must not trust a caller — but refusing
  // here saves a round trip and keeps the refusal in this function's own log.
  const refusal = refusePageReadUrl(url);
  if (refusal) {
    console.warn(`[scrape-property-listing] brokered read refused before sending: ${refusal}`);
    return null;
  }
  try {
    const resp = await fetch(brokeredPageReadUrl(route), {
      method: 'POST',
      headers: route.headers,
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!resp.ok) {
      const body = await resp.text();
      // Who refused is read from Mission Control's own header rather than
      // guessed from a body: both ends answer similar JSON and send an
      // operator to opposite remedies.
      const refusedBy = resp.headers.get('x-mission-control-refusal')
        ? 'Mission Control'
        : 'the page reader';
      console.error(
        `[scrape-property-listing] brokered read failed (${refusedBy}, ${resp.status}):`,
        body.slice(0, 300).replaceAll(route.secret, '[redacted]'),
      );
      return null;
    }
    const j = await resp.json();
    const markdown: string = String(j?.markdown ?? j?.data?.markdown ?? '');
    if (!markdown || markdown.length < 80 || isBadScrapeContent(markdown)) {
      console.warn('[scrape-property-listing] brokered read returned unusable markdown:', markdown.length);
      return null;
    }
    return {
      markdown,
      title: j?.title ?? j?.data?.metadata?.title,
      description: j?.description ?? j?.data?.metadata?.description,
    };
  } catch (e) {
    console.error('[scrape-property-listing] brokered read exception', e);
    return null;
  }
}

/**
 * Read the listing page, through whichever route this deployment has.
 *
 * A clone holds no `FIRECRAWL_API_KEY` and cannot be given one sensibly — see
 * `pageReadRoute.pure.ts`. Where it can reach Mission Control, the CALL
 * travels instead of the credential and Mission Control performs the read and
 * meters it. Where it can do neither, this returns null exactly as it did
 * before and the caller falls through to the reader mode and then the model,
 * under the provenance warning the surface already draws.
 */
async function scrapeWithFirecrawl(url: string): Promise<{ markdown: string; title?: string; description?: string } | null> {
  const route = resolvePageReadRoute({
    firecrawlKey: Deno.env.get("FIRECRAWL_API_KEY"),
    missionControlUrl: Deno.env.get("MISSION_CONTROL_URL"),
    cloneApiKey: Deno.env.get("MISSION_CONTROL_CLONE_API_KEY"),
  });

  if (route.via === 'none') {
    console.warn(`[scrape-property-listing] no page-read route: ${route.why}`);
    return null;
  }

  if (route.via === 'broker') {
    if (route.trimmedPath) {
      console.warn(`[scrape-property-listing] MISSION_CONTROL_URL carried the path ${route.trimmedPath}; reading from its origin instead`);
    }
    return await readPageThroughBroker(url, route);
  }

  const attempt = { formats: ["markdown"], onlyMainContent: false, waitFor: 1000, timeout: 25000 };
  try {
    const resp = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: route.headers,
      body: JSON.stringify({
        url,
        ...attempt,
        mobile: false,
        location: { country: "AU", languages: ["en-AU", "en"] },
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      console.error("[scrape-property-listing] Firecrawl failed", resp.status, t.slice(0, 300));
      return null;
    }
    const j = await resp.json();
    const root = j?.data ?? j;
    const markdownParts = [root?.markdown, root?.html ? `\n\n## Raw HTML text fallback\n${String(root.html).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}` : ''].filter(Boolean);
    const markdown: string = markdownParts.join('\n\n');
    const title: string | undefined = root?.metadata?.title;
    const description: string | undefined = root?.metadata?.description;
    if (!markdown || markdown.length < 80 || isBadScrapeContent(markdown)) {
      console.warn("[scrape-property-listing] Firecrawl returned empty/short markdown:", markdown.length);
      return null;
    }
    return { markdown, title, description };
  } catch (e) {
    console.error("[scrape-property-listing] Firecrawl exception", e);
    return null;
  }
}

async function scrapeWithReaderMode(url: string): Promise<{ markdown: string; title?: string; description?: string } | null> {
  try {
    const target = `https://r.jina.ai/${url}`;
    const resp = await fetch(target, {
      method: 'GET',
      headers: { Accept: 'text/markdown,text/plain,*/*' },
      signal: AbortSignal.timeout(45000),
    });
    if (!resp.ok) {
      console.warn('[scrape-property-listing] reader fallback failed', resp.status);
      return null;
    }
    const markdown = await resp.text();
    if (!markdown || markdown.length < 120 || isBadScrapeContent(markdown)) {
      console.warn('[scrape-property-listing] reader fallback returned unusable markdown:', markdown?.length ?? 0);
      return null;
    }
    const title = markdown.match(/^Title:\s*(.+)$/im)?.[1]?.trim();
    return { markdown, title };
  } catch (e) {
    console.error('[scrape-property-listing] reader fallback exception', e);
    return null;
  }
}

async function searchExactListing(url: string, apiKey: string): Promise<{ markdown: string; title?: string; description?: string } | null> {
  const hints = deriveListingHints(url);
  if (!hints.propertyId && !hints.addressHint) return null;
  const query = [
    hints.propertyId ? `"${hints.propertyId}"` : '',
    hints.addressHint ? `"${hints.addressHint}"` : '',
    hints.hostname ? `site:${hints.hostname}` : '',
  ].filter(Boolean).join(' ');

  try {
    const resp = await fetch('https://api.perplexity.ai/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, max_results: 10 }),
      signal: AbortSignal.timeout(30000),
    });
    const raw = await resp.text();
    const parsed = safeJsonParse<any>(raw) ?? {};
    if (!resp.ok) {
      console.warn('[scrape-property-listing] exact search fallback failed', resp.status, raw.slice(0, 300));
      return null;
    }
    const results: any[] = Array.isArray(parsed?.results)
      ? parsed.results
      : Array.isArray(parsed?.data)
        ? parsed.data
        : Array.isArray(parsed?.web)
          ? parsed.web
          : [];
    const exact = results.filter((r) => {
      const hay = `${r.title ?? ''} ${r.url ?? ''} ${r.snippet ?? ''} ${r.description ?? ''}`.toLowerCase();
      const hasId = hints.propertyId ? hay.includes(hints.propertyId) : true;
      const hasAddress = hints.addressHint ? hints.addressHint.toLowerCase().split(' ').filter((p) => p.length > 2).slice(0, 5).every((p) => hay.includes(p)) : true;
      return hasId || hasAddress;
    });
    if (!exact.length) return null;
    const markdown = [
      `# Search fallback for exact listing`,
      `URL: ${url}`,
      `Property ID hint: ${hints.propertyId ?? 'unknown'}`,
      `Address hint: ${hints.addressHint ?? 'unknown'}`,
      '',
      ...exact.slice(0, 8).map((r, i) => [`## Result ${i + 1}: ${r.title ?? 'Untitled'}`, `Source: ${r.url ?? ''}`, r.snippet ?? r.description ?? r.text ?? ''].join('\n')),
    ].join('\n\n');
    return { markdown, title: exact[0]?.title, description: exact[0]?.snippet ?? exact[0]?.description };
  } catch (e) {
    console.error('[scrape-property-listing] exact search fallback exception', e);
    return null;
  }
}

async function extractListingWithModel(url: string, propertyCategory = 'auto', userId: string | null = null) {
  // The Perplexity key buys the LAST of three source fetchers (their Search
  // API), not the extraction — that is whatever model `listing_scrape` is bound
  // to. Missing, it costs one fallback; it must not fail the whole scrape, or
  // moving this agent onto OpenRouter would break on a key it no longer spends.
  const perplexitySearchKey = Deno.env.get("PERPLEXITY_API_KEY");

  // Step 1: scrape the actual page so the model extracts from real content
  // instead of hallucinating from a URL slug.
  const scraped = await scrapeWithFirecrawl(url)
    ?? await scrapeWithReaderMode(url)
    ?? (perplexitySearchKey ? await searchExactListing(url, perplexitySearchKey) : null);
  const pageContent = scraped?.markdown ?? null;
  if (pageContent) {
    console.log(`[scrape-property-listing] source markdown length: ${pageContent.length}`);
  }

  const system = [
    "You are a senior Australian real estate data analyst. Your job is to EXTRACT every available structured field from a property listing (residential, commercial OR industrial) and return it as JSON matching the provided schema exactly.",
    "",
    "PRIME DIRECTIVES:",
    "1. EXTRACT MAXIMALLY — examine the ENTIRE source (title, meta, hero, headlines, body copy, bullet lists, captions, tables, agent block, schema.org JSON-LD, alt text, footer). Many listings bury key data (rates, strata, rent, NLA, cap rate, outgoings) inside feature lists, captions, image overlays, fine print, or the agent contact card. Read every line before deciding a field is null.",
    "2. NEVER FABRICATE — if a value is not explicitly present, return null. Do NOT infer from URL slugs, suburb medians, or 'typical' values. No guesses.",
    "3. NEVER CARRY-OVER EXAMPLES — sample values in this prompt are illustrative only.",
    "4. ASSET-CLASS DETECTION (run first):",
    "   - residential: house, apartment, townhouse, villa, unit, duplex, granny flat, land lot, H&L package, off-the-plan.",
    "   - commercial: office, retail, shop, showroom, medical, childcare, hospitality, mixed-use, NLA, WALE, outgoings, cap rate, going concern.",
    "   - industrial: warehouse, factory, manufacturing, logistics, distribution, IN1/IN2/IN3 zoning, GLA, clearance, dock doors, kVA, hardstand, truck access.",
    "   Set detected_asset_class + detected_asset_confidence (0–1). If hint != 'auto' AND evidence agrees, use the hint; if evidence clearly contradicts, override.",
    "5. NUMBER NORMALISATION (strict):",
    "   - Strip $, commas, %, 'AUD', 'per', 'pa', 'p.a.', 'p/w', '+GST', 'approx', '~'. Return raw numerics only.",
    "   - Areas: sqft→sqm (×0.0929), ha→sqm (×10000), acres→sqm (×4046.86). Always sqm.",
    "   - Residential rent (weekly_rent): weekly stays weekly; monthly→weekly (×12/52); annual→weekly (÷52).",
    "   - Commercial rent (vendor_advised_rent_pa): weekly→pa (×52), monthly→pa (×12); if quoted as $/sqm pa multiply by NLA/GLA when both are given.",
    "   - Power: amps×voltage÷1000 = kVA (assume 415V 3-phase if unspecified).",
    "   - Cap rate / yield: percent number (return 6.25 not 0.0625).",
    "   - Price ranges → midpoint. 'Offers over $X'/'Buyers above $X' → X. 'Contact agent'/'POA'/'Auction' with no figure → null.",
    "   - Strata quarterly → annual (×4). Council rates quarterly → annual (×4).",
    "6. ADDRESS RULES: Use the EXACT street address as written. Split into address (street line), suburb, state (NSW/VIC/QLD/SA/WA/TAS/NT/ACT — always uppercase), postcode (4-digit). For suburb-only/portfolio/landing pages set address=null but still fill suburb/state/postcode if known.",
    "7. CROSS-CHECK PASS: Before returning, re-scan the source for every field you set to null — if a synonym or alternative phrasing exists (see SYNONYM HINTS below), fill it. Listings frequently use synonyms.",
    "8. OUTPUT: Return JSON only. Match the schema exactly. Every required key must appear (use null when absent).",
  ].join('\n');

  const listingHints = deriveListingHints(url);
  const sourceBlock = pageContent
    ? `SOURCE CONTENT (scraped from the listing page — extract ONLY from this text):\n\n---\n${pageContent.slice(0, 60000)}\n---\n\n`
    : `NOTE: The listing page could not be scraped directly. Use web search restricted to the listing domain. Locate the exact property listing by URL, property ID, and address hint. If the exact listing is not found, return nulls rather than using generic commercial real estate pages.\nProperty ID hint: ${listingHints.propertyId ?? 'unknown'}\nAddress hint: ${listingHints.addressHint ?? 'unknown'}\n\n`;

  const user = `${sourceBlock}URL: ${url}
Property category hint: ${propertyCategory} ${propertyCategory === 'auto' ? '(auto-detect from content)' : ''}

============= SYNONYM HINTS (look for ANY of these labels) =============
- price_aud: "Price", "Asking", "Guide", "Offers Above/Over", "For Sale $", "Buyers Guide", "Expressions of Interest closing $".
- weekly_rent: "$X p/w", "Rent", "Rental", "Currently leased at", "Rental return", "Estimated rent", "Rental appraisal".
- council_rates: "Council rates", "Rates pa", "Rates: $".
- water_rates: "Water", "Water rates", "Sydney Water", "Water service".
- strata_fees: "Strata", "Body Corp", "Owners Corporation", "Quarterly levies" (convert quarterly → annual ×4).
- land_size_sqm: "Land", "Land area", "Block size", "Allotment", "Lot size".
- build_size_sqm: "Building", "House size", "Internal", "Floor area", "Living".
- year_built: "Built", "Year built", "Constructed", "Circa".
- bedrooms/bathrooms/car_spaces: bed/bath/car icons, "4 Beds 2 Baths 2 Cars", schema.org BedroomCount/BathroomCount.
- nla_sqm / gla_sqm / gfa_sqm: "NLA", "Net Lettable Area", "GLA", "Gross Lettable Area", "GFA", "Building Area", "Total area".
- site_area_sqm: "Site area", "Land area" (commercial/industrial).
- hardstand_sqm: "Hardstand", "Concrete hardstand", "Sealed yard".
- clearance_metres: "Eaves", "Clearance", "Internal height", "Ridge height", "Min/Max clearance".
- power_kva: "kVA", "amps", "3-phase power", "Heavy power".
- dock_doors: "Recessed docks", "Loading docks", "Roller doors", "On-grade doors".
- ground_floor_load_kpa: "Floor load", "Slab loading", "kPa".
- passing_noi_pa / market_noi_pa: "Net Income", "NOI", "Net rental", "Net Operating Income".
- passing_cap_rate_pct / market_cap_rate_pct: "Cap rate", "Yield (net)", "Initial yield", "Capitalisation rate".
- vendor_advised_rent_pa: "Gross income", "Total rent pa", "Rental income".
- outgoings_total_pa: "Outgoings", "Operating costs", "Recoverable outgoings".
- lease_type: "Net Lease", "Gross Lease", "Triple Net", "NNN", "Semi-gross".
- lease_expiry_date / lease_options: "Expires", "Term remaining", "Options 5+5".
- wale_years: "WALE", "Weighted Average Lease Expiry".
- tenant_names: tenant logos, "Leased to", "Occupied by", anchor tenant.
- gst_treatment: "Going concern", "Plus GST", "GST inclusive", "Margin scheme".
- zoning: "Zoning", "Zone", LEP codes (R1/R2/R3/R4, B1-B7, IN1/IN2/IN3, E1-E4, MU1, SP1/SP2).
- tenure: "Freehold", "Strata title", "Leasehold", "Crown lease".

============= UNIVERSAL FIELDS =============
- title, address, suburb, state, postcode.
- price_aud (integer AUD; midpoint for ranges).
- property_type — residential: house/apartment/townhouse/villa/unit/land/duplex; commercial/industrial: office/retail/warehouse/logistics/manufacturing/mixed_use/medical/childcare/hospitality/other.
- detected_asset_class & detected_asset_confidence.
- agent_name (single primary agent), agency, key_features (max 10 short bullets), listing_text (2–4 sentence neutral summary), confidence (0–1 overall).

============= RESIDENTIAL ONLY =============
- bedrooms / bathrooms / car_spaces (integers).
- weekly_rent (AUD/week).
- is_new_build: true ONLY if "brand new", "new build", "house & land", "off the plan", or a builder is explicitly named.
- land_price / build_price: only for explicit H&L packages with split pricing.
- council_rates / water_rates / strata_fees / insurance_estimate (annual AUD).
- property_management_percent (typically 5–12).
- year_built (4-digit year).

============= COMMERCIAL & INDUSTRIAL =============
- asset_class (office|retail|industrial|mixed_use|medical|childcare|hospitality|other), asset_sub_type (free text e.g. "Distribution Warehouse", "A-Grade Office").
- tenure (freehold|leasehold|strata), zoning, property_name, parking_bays, current_valuation.
- Areas: gfa_sqm, nla_sqm (office/retail), gla_sqm (industrial), site_area_sqm, hardstand_sqm.
- site_cover_pct, office_pct (0–100).
- Industrial specs: clearance_metres, power_kva, dock_doors, ground_floor_load_kpa, truck_access (poor|average|good|excellent), condition_rating (A|B|C|D).
- Lease & income (ONLY when explicitly stated):
  * passing_noi_pa, market_noi_pa.
  * passing_cap_rate_pct, market_cap_rate_pct (percent numbers).
  * vendor_advised_rent_pa, vendor_advised_outgoings_pa.
  * outgoings_total_pa, outgoings_recoverable_pa.
  * lease_type (gross|net|semi_gross|triple_net|NNN as printed).
  * lease_expiry_date (yyyy-mm-dd), lease_options (e.g. "3+3+3").
  * wale_years (numeric).
  * tenant_names (array, max 5).
  * vendor_advised_yield_pct (percent number).
  * gst_treatment (going_concern|margin_scheme|standard|input_taxed).

FINAL SELF-CHECK BEFORE RESPONDING:
- Did you scan every section of the source for each field?
- Did you normalise units (sqm, AUD, percent numbers, ISO dates)?
- Are you returning null (not 0, not "") for any value not explicitly in the source?
- Does detected_asset_class match the dominant evidence?
- Does every required key appear in the output?

Return JSON only.`;

  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];

  // Perplexity-only body fields, scoped to Perplexity so they are dropped rather
  // than sent when the chain falls back. `search_domain_filter` is a search
  // control no other provider knows: sent to the gateway or to OpenRouter it is
  // an unknown field, which would turn the fallback step into a 400 — a fallback
  // that fails on the way to rescuing the call is worse than none.
  const providerExtras = {
    perplexity: {
      top_p: 0.9,
      // Only pin the search to the listing's own domain when we have no scraped
      // page and the model must find the listing itself.
      ...(pageContent || !listingHints.hostname ? {} : { search_domain_filter: [listingHints.hostname] }),
    },
  };

  const responseFormat = {
      type: "json_schema",
      json_schema: {
        name: "property_listing_extraction",
        schema: {
          type: "object",
          properties: {
            title: { type: ["string", "null"] },
            address: { type: ["string", "null"] },
            suburb: { type: ["string", "null"] },
            state: { type: ["string", "null"] },
            postcode: { type: ["string", "null"] },
            price_aud: { type: ["number", "null"] },
            bedrooms: { type: ["number", "null"] },
            bathrooms: { type: ["number", "null"] },
            car_spaces: { type: ["number", "null"] },
            land_size_sqm: { type: ["number", "null"] },
            build_size_sqm: { type: ["number", "null"] },
            property_type: { type: ["string", "null"] },
            key_features: { type: ["array", "null"], items: { type: "string" } },
            agent_name: { type: ["string", "null"] },
            agency: { type: ["string", "null"] },
            listing_text: { type: ["string", "null"] },
            confidence: { type: ["number", "null"] },
            // Extended fields
            weekly_rent: { type: ["number", "null"] },
            is_new_build: { type: ["boolean", "null"] },
            land_price: { type: ["number", "null"] },
            build_price: { type: ["number", "null"] },
            council_rates: { type: ["number", "null"] },
            water_rates: { type: ["number", "null"] },
            strata_fees: { type: ["number", "null"] },
            insurance_estimate: { type: ["number", "null"] },
            property_management_percent: { type: ["number", "null"] },
            year_built: { type: ["number", "null"] },
            asset_class: { type: ["string", "null"] },
            asset_sub_type: { type: ["string", "null"] },
            tenure: { type: ["string", "null"] },
            zoning: { type: ["string", "null"] },
            gfa_sqm: { type: ["number", "null"] },
            nla_sqm: { type: ["number", "null"] },
            gla_sqm: { type: ["number", "null"] },
            site_area_sqm: { type: ["number", "null"] },
            parking_bays: { type: ["number", "null"] },
            current_valuation: { type: ["number", "null"] },
            property_name: { type: ["string", "null"] },
            site_cover_pct: { type: ["number", "null"] },
            office_pct: { type: ["number", "null"] },
            hardstand_sqm: { type: ["number", "null"] },
            clearance_metres: { type: ["number", "null"] },
            power_kva: { type: ["number", "null"] },
            dock_doors: { type: ["number", "null"] },
            ground_floor_load_kpa: { type: ["number", "null"] },
            condition_rating: { type: ["string", "null"] },
            detected_asset_class: { type: ["string", "null"] },
            detected_asset_confidence: { type: ["number", "null"] },
            passing_noi_pa: { type: ["number", "null"] },
            market_noi_pa: { type: ["number", "null"] },
            passing_cap_rate_pct: { type: ["number", "null"] },
            market_cap_rate_pct: { type: ["number", "null"] },
            vendor_advised_rent_pa: { type: ["number", "null"] },
            vendor_advised_outgoings_pa: { type: ["number", "null"] },
            outgoings_total_pa: { type: ["number", "null"] },
            outgoings_recoverable_pa: { type: ["number", "null"] },
            lease_type: { type: ["string", "null"] },
            lease_expiry_date: { type: ["string", "null"] },
            lease_options: { type: ["string", "null"] },
            wale_years: { type: ["number", "null"] },
            tenant_names: { type: ["array", "null"], items: { type: "string" } },
            gst_treatment: { type: ["string", "null"] },
            truck_access: { type: ["string", "null"] },
            vendor_advised_yield_pct: { type: ["number", "null"] },
          },
          required: [
            "title",
            "address",
            "suburb",
            "state",
            "postcode",
            "price_aud",
            "bedrooms",
            "bathrooms",
            "car_spaces",
            "land_size_sqm",
            "build_size_sqm",
            "property_type",
            "key_features",
            "agent_name",
            "agency",
            "listing_text",
            "confidence",
            "weekly_rent",
            "is_new_build",
            "land_price",
            "build_price",
            "council_rates",
            "water_rates",
            "strata_fees",
            "insurance_estimate",
            "property_management_percent",
            "year_built",
            "asset_class",
            "asset_sub_type",
            "tenure",
            "zoning",
            "gfa_sqm",
            "nla_sqm",
            "gla_sqm",
            "site_area_sqm",
            "parking_bays",
            "current_valuation",
            "property_name",
            "site_cover_pct",
            "office_pct",
            "hardstand_sqm",
            "clearance_metres",
            "power_kva",
            "dock_doors",
            "ground_floor_load_kpa",
            "condition_rating",
            "detected_asset_class",
            "detected_asset_confidence",
            "passing_noi_pa",
            "market_noi_pa",
            "passing_cap_rate_pct",
            "market_cap_rate_pct",
            "vendor_advised_rent_pa",
            "vendor_advised_outgoings_pa",
            "outgoings_total_pa",
            "outgoings_recoverable_pa",
            "lease_type",
            "lease_expiry_date",
            "lease_options",
            "wale_years",
            "tenant_names",
            "gst_treatment",
            "truck_access",
            "vendor_advised_yield_pct",
          ],
          additionalProperties: false,
        },
      },
  };

  // Which model runs this is `listing_scrape`'s Model Hub binding, not a
  // constant. It WAS a constant — a hardcoded `sonar-pro` behind a direct fetch
  // to api.perplexity.ai — because this router used to drop `response_format`
  // and with it the DB-schema-aligned JSON enforcement. It no longer does, so
  // the bypass is gone and with it the two things the bypass cost: the Model
  // Hub selection for this agent did nothing at all, and a Perplexity 5xx ended
  // the job outright even though the agent has a fallback chain configured and
  // the UI promises "the fallback chain auto-engages on 404/410/5xx errors".
  const deadlineAt = Date.now() + MODEL_PHASE_BUDGET_MS;
  const callModel = (withSchema: boolean) => callLLM({
    agentKey: LISTING_SCRAPE_AGENT_KEY,
    messages,
    temperature: 0,
    maxTokens: 6000,
    ...(withSchema ? { responseFormat } : {}),
    providerExtras,
    timeoutMs: PER_MODEL_TIMEOUT_MS,
    deadlineAt,
    // Keeps the person on the ledger row: the manual `logApiUsage` this
    // replaced passed `user_id`, and the router's metering would otherwise
    // coarsen it to the deployment.
    ...(userId ? { meterUserId: userId } : {}),
  });

  let result: Awaited<ReturnType<typeof callLLM>>;
  let schemaEnforced = true;
  try {
    result = await callModel(true);
  } catch (e) {
    const err = e as LLMError;
    if (!shouldRetryWithoutSchema(err?.attempts)) {
      return {
        ok: false as const,
        status: err?.status ?? 500,
        error: describeScrapeFailure({ status: err?.status, attempts: err?.attempts, message: err?.message }),
        raw: '',
      };
    }
    // Every model failed for a reason a different request shape could change.
    // The schema is the part we can drop and still get an answer — the prompt
    // already ends with "Return JSON only" and `safeJsonParse` lifts an object
    // out of prose — so spend what is left of the budget on one schema-free
    // pass rather than failing a job the operator is watching.
    console.warn('[scrape-property-listing] all models failed with a schema; retrying without response_format');
    schemaEnforced = false;
    try {
      result = await callModel(false);
    } catch (e2) {
      const err2 = e2 as LLMError;
      return {
        ok: false as const,
        status: err2?.status ?? 500,
        error: describeScrapeFailure({ status: err2?.status, attempts: err2?.attempts, message: err2?.message }),
        raw: '',
      };
    }
  }

  const finishReason = result.rawResponse?.choices?.[0]?.finish_reason;
  if (finishReason && finishReason !== "stop") {
    console.warn(`[scrape-property-listing] LLM finish_reason=${finishReason} (possible truncation)`);
  }
  let extracted = result.content ? safeJsonParse<ListingExtraction>(result.content) : null;

  if (!extracted) {
    return {
      ok: false as const,
      status: 502,
      error: `${result.routeUsed}/${result.modelUsed} answered, but not with structured property data. `
        + 'Pick a model that supports JSON output in Model Hub → Agent Bindings → Property Listing Scraper.',
      raw: result.content ?? '',
    };
  }

  extracted = enrichExtractionFromSource(extracted, pageContent, url, propertyCategory);

  const citations = (result.rawResponse?.citations as string[] | undefined) ?? [];

  return {
    ok: true as const,
    extracted,
    citations,
    raw: result.rawResponse,
    scrapedFromPage: !!pageContent,
    modelUsed: result.modelUsed,
    routeUsed: result.routeUsed,
    schemaEnforced,
  };
}

async function runScrapeJob(
  supabase: any,
  jobId: string,
  formattedUrl: string,
  propertyCategory: string,
  userId: string | null,
) {
  try {
    await supabase.from('property_scrape_jobs').update({
      status: 'processing',
      started_at: new Date().toISOString(),
    }).eq('id', jobId);

    const result = await extractListingWithModel(formattedUrl, propertyCategory, userId);

    if (!result.ok) {
      // `describeScrapeFailure` has already turned the router's attempt list
      // into a sentence naming the models that ran. The 429/402 special-casing
      // that stood here named Perplexity unconditionally, which was wrong the
      // moment the model became a choice.
      await supabase.from('property_scrape_jobs').update({
        status: 'failed',
        error: result.error,
        completed_at: new Date().toISOString(),
      }).eq('id', jobId);
      return;
    }

    // Did the model answer about the property this URL names?
    //
    // Only where the page was NOT read: the search fallback's own prompt asks
    // for nulls when it cannot find the listing, and what comes back instead
    // is a plausible property — the audit's 13 Silky Oak Court URL answered
    // with 10 Railway Avenue. `corroborateAddress` is deliberately reluctant
    // (two distinctive URL tokens to refuse, any one to accept), because a
    // false refusal breaks a scrape that works while a missed one leaves the
    // operator exactly where the provenance warning already puts them.
    const corroboration = corroborateAddress({
      addressHint: deriveListingHints(formattedUrl).addressHint,
      scrapedFromPage: result.scrapedFromPage,
      extractedParts: [
        result.extracted.address,
        result.extracted.suburb,
        result.extracted.postcode,
        result.extracted.title,
      ],
    });
    if (corroboration.verdict === 'contradicted') {
      console.warn('[scrape-property-listing] extraction contradicts the URL', {
        jobId, hintTokens: corroboration.hintTokens,
      });
      await supabase.from('property_scrape_jobs').update({
        status: 'failed',
        error: contradictionMessage(
          deriveListingHints(formattedUrl).addressHint,
          result.extracted.address || result.extracted.title,
        ),
        completed_at: new Date().toISOString(),
      }).eq('id', jobId);
      return;
    }

    const extractedDetails = toExtractedDetails(result.extracted, result.extracted.title);
    const markdown = buildListingMarkdown(formattedUrl, result.extracted, result.citations);
    const metadata = {
      title: result.extracted.title,
      description: result.extracted.listing_text,
      // Name what actually ran. This read "firecrawl+perplexity" for every
      // scrape, including the ones a different model would now serve.
      provider: [result.scrapedFromPage ? 'firecrawl' : null, `${result.routeUsed}/${result.modelUsed}`]
        .filter(Boolean).join('+'),
      model: { route: result.routeUsed, modelId: result.modelUsed, schemaEnforced: result.schemaEnforced },
      scrapedFromPage: result.scrapedFromPage,
      addressCorroboration: corroboration.verdict,
      citations: result.citations,
      confidence: result.extracted.confidence,
    };

    // NO `logApiUsage` HERE. `llmRouter` meters its own successful call
    // (`meterUsage` defaults true) against the credential the route actually
    // spent. The hardcoded `service_name: 'perplexity' / model_used: 'sonar-pro'`
    // row that stood here would have billed Perplexity for an OpenRouter call
    // the moment the binding changed — and logging in both places bills the
    // tenant twice, which API_USAGE_METERING.md rates worse than not billing.

    await supabase.from('property_scrape_jobs').update({
      status: 'succeeded',
      result: { markdown, metadata, extractedDetails, sourceUrl: formattedUrl },
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scrape job failed unexpectedly';
    console.error('[scrape-property-listing] background job error:', message);
    await supabase.from('property_scrape_jobs').update({
      status: 'failed',
      error: message,
      completed_at: new Date().toISOString(),
    }).eq('id', jobId);
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const corsHeaders = createCorsHeaders(origin);

  console.log("scrape-property-listing invoked", { method: req.method });

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // SEC5-CSRF: reject cross-site cookie-authenticated mutations (exact-origin).
  // No-op for GET/HEAD/OPTIONS and any request without the session cookie.
  const __csrf = enforceCsrf(req);
  if (!__csrf.ok) return csrfDenied(corsHeaders, __csrf);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { url, propertyCategory = 'auto', jobId } = body ?? {};

    const { error: authError, userId } = await verifyAuth(supabase, req.headers, body);
    if (authError) {
      console.log('[scrape-property-listing] Auth failed:', authError);
      return createUnauthorizedResponse(authError, corsHeaders);
    }

    // ── STATUS POLL ──────────────────────────────────────────────
    if (jobId && typeof jobId === 'string') {
      const { data: job, error: jobErr } = await supabase
        .from('property_scrape_jobs')
        .select('id, status, error, result, url, property_category, created_at, started_at, completed_at, user_id')
        .eq('id', jobId)
        .maybeSingle();

      if (jobErr || !job) {
        return new Response(JSON.stringify({ success: false, error: 'Job not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (job.user_id && userId && job.user_id !== userId) {
        return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const payload: any = {
        success: true,
        jobId: job.id,
        status: job.status,
        createdAt: job.created_at,
        startedAt: job.started_at,
        completedAt: job.completed_at,
      };
      if (job.status === 'succeeded') payload.data = job.result;
      if (job.status === 'failed') payload.error = job.error || 'Scrape failed';
      return new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── START NEW JOB ───────────────────────────────────────────
    if (!url || typeof url !== "string") {
      return new Response(JSON.stringify({ success: false, error: "URL is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let formattedUrl: string;
    try {
      formattedUrl = normalizePropertyListingUrl(url);
    } catch {
      return new Response(JSON.stringify({ success: false, error: "Invalid URL" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: job, error: insertErr } = await supabase
      .from('property_scrape_jobs')
      .insert({
        user_id: userId,
        url: formattedUrl,
        property_category: propertyCategory,
        status: 'queued',
      })
      .select('id')
      .single();

    if (insertErr || !job) {
      console.error('[scrape-property-listing] failed to enqueue job:', insertErr);
      return new Response(JSON.stringify({ success: false, error: insertErr?.message || 'Failed to enqueue scrape job' }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fire-and-forget background processing — survives past the HTTP response.
    const bg = runScrapeJob(supabase, job.id, formattedUrl, propertyCategory, userId ?? null);
    // @ts-ignore EdgeRuntime is available in Supabase Edge Functions
    if (typeof EdgeRuntime !== 'undefined' && (EdgeRuntime as any)?.waitUntil) {
      // @ts-ignore
      (EdgeRuntime as any).waitUntil(bg);
    } else {
      bg.catch((e) => console.error('[scrape-property-listing] detached bg error:', e));
    }

    return new Response(JSON.stringify({
      success: true,
      jobId: job.id,
      status: 'queued',
      message: 'Scrape job accepted. Poll with { jobId } for status.',
    }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in scrape-property-listing:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to scrape property listing";
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
