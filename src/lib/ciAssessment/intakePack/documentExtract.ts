/**
 * Supporting-document extraction for the C&I intake pack.
 *
 * The workbook is the authoritative return path, but a meeting rarely comes
 * back with only the workbook: there is a contract of sale, an information
 * memorandum, a valuation, a rates notice. Those carry exactly the figures the
 * assessment refuses to calculate without (address, price, valuation), so this
 * turns one of those files into the *same* staged `ParsedPack` shape the
 * workbook produces — so it flows through the identical review-then-apply gate
 * rather than a second, weaker path that writes straight into the payload.
 *
 * Nothing here is authoritative: every field is emitted with
 * `document_import` provenance and `requiresConfirmation: true`.
 */
import { convertPdfToImages, imageFileToBase64, isImageFile, isPdfFile } from '@/utils/pdfToImages';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  emptyAssessmentPayload,
  type AssessmentPayload,
  type AssetClass,
  type AustralianState,
  type FieldProvenance,
  type GstTreatmentKey,
} from '../types';
import type { ParsedFieldValue, ParsedPack } from './parseWorkbook';

export type ExtractSegment = 'commercial' | 'industrial';

const STATES: AustralianState[] = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'];

const ASSET_CLASSES: AssetClass[] = [
  'office', 'retail', 'warehouse', 'logistics', 'manufacturing', 'cold_storage',
  'medical', 'childcare', 'hospitality', 'showroom', 'transport_yard',
  'data_centre', 'mixed_use', 'other',
];

const GST_TREATMENTS: GstTreatmentKey[] = [
  'going_concern', 'margin_scheme', 'plus_gst', 'gst_inclusive', 'input_taxed', 'unknown',
];

/** A document extractor can return a number as a string, or as junk. */
function num(...candidates: unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate !== 0) return candidate;
    if (typeof candidate === 'string') {
      const cleaned = candidate.replace(/[^0-9.\-]/g, '');
      if (!cleaned) continue;
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed) && parsed !== 0) return parsed;
    }
  }
  return undefined;
}

function str(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function toState(value: unknown): AustralianState | undefined {
  const raw = str(value)?.toUpperCase().replace(/[^A-Z]/g, '');
  if (!raw) return undefined;
  const direct = STATES.find((state) => state === raw);
  if (direct) return direct;
  const long: Record<string, AustralianState> = {
    NEWSOUTHWALES: 'NSW', VICTORIA: 'VIC', QUEENSLAND: 'QLD',
    WESTERNAUSTRALIA: 'WA', SOUTHAUSTRALIA: 'SA', TASMANIA: 'TAS',
    AUSTRALIANCAPITALTERRITORY: 'ACT', NORTHERNTERRITORY: 'NT',
  };
  return long[raw];
}

function toEnum<T extends string>(value: unknown, allowed: T[]): T | undefined {
  const raw = str(value)?.toLowerCase().replace(/[\s-]+/g, '_');
  if (!raw) return undefined;
  return allowed.find((entry) => entry === raw);
}

/**
 * Map the extractor's loose payload onto the strict property/lease fields.
 *
 * Key aliases mirror `parse-property-pdf`'s two response shapes (`extracted*`
 * and bare names) so a change of prompt on either side degrades to "field not
 * found" rather than a silently wrong number.
 */
function mapDetails(raw: unknown, segment: ExtractSegment): {
  property: Partial<AssessmentPayload['property']>;
  lease: Partial<AssessmentPayload['lease']>;
} {
  const source = (raw ?? {}) as Record<string, unknown>;
  const details = (source.extractedDetails ?? source.extractedData ?? source.structuredPayload ?? source) as Record<string, unknown>;

  const property: Partial<AssessmentPayload['property']> = {};
  const lease: Partial<AssessmentPayload['lease']> = {};

  const address = str(details.extractedAddress, details.propertyAddress, details.address);
  if (address) property.address = address;
  const suburb = str(details.extractedSuburb, details.suburb);
  if (suburb) property.suburb = suburb;
  const state = toState(details.extractedState ?? details.state);
  if (state) property.state = state;
  const postcode = str(details.extractedPostcode, details.postcode);
  if (postcode) property.postcode = postcode;

  const price = num(details.extractedPrice, details.purchasePrice, details.price);
  if (price) property.purchasePrice = price;
  const valuation = num(details.extractedValuation, details.currentValuation, details.valuation);
  if (valuation) property.currentValuation = valuation;

  const assetClass = toEnum(
    details.extractedAssetClass ?? details.assetClass ?? details.extractedAssetSubType
      ?? details.assetSubType ?? details.propertyType,
    ASSET_CLASSES,
  );
  if (assetClass) property.assetClass = assetClass;
  const assetSubType = str(details.extractedAssetSubType, details.assetSubType, details.assetSubtype, details.propertyType);
  if (assetSubType) property.assetSubType = assetSubType;

  const gst = toEnum(details.extractedGstTreatment ?? details.gstTreatment, GST_TREATMENTS);
  if (gst) property.gstTreatment = gst;

  // Lettable area: NLA for commercial, GLA for industrial, with build size as
  // the last resort because that is what listing scrapes usually carry.
  const lettable = segment === 'industrial'
    ? num(details.extractedGlaSqm, details.glaSqm, details.extractedNlaSqm, details.nlaSqm, details.extractedBuildSize, details.buildSize)
    : num(details.extractedNlaSqm, details.nlaSqm, details.extractedGlaSqm, details.glaSqm, details.extractedBuildSize, details.buildSize);
  if (lettable) property.lettableAreaSqm = lettable;
  const site = num(details.extractedSiteAreaSqm, details.siteAreaSqm, details.extractedLandSize, details.landSize);
  if (site) property.siteAreaSqm = site;

  const recoverable = num(details.extractedOutgoingsRecoverablePa, details.outgoingsRecoverablePa);
  const totalOutgoings = num(
    details.extractedOutgoingsTotalPa, details.outgoingsTotalPa,
    details.extractedVendorOutgoingsPa, details.vendorAdvisedOutgoingsPa,
  );
  if (recoverable) lease.recoverableOutgoings = recoverable;
  if (totalOutgoings && recoverable && totalOutgoings > recoverable) {
    lease.nonRecoverableOutgoings = totalOutgoings - recoverable;
  } else if (totalOutgoings && !recoverable) {
    lease.nonRecoverableOutgoings = totalOutgoings;
  }

  return { property, lease };
}

/** Human labels for the review list, keyed by payload field path. */
const FIELD_LABELS: Record<string, string> = {
  address: 'Property address',
  suburb: 'Suburb',
  state: 'State',
  postcode: 'Postcode',
  purchasePrice: 'Purchase price',
  currentValuation: 'Current valuation',
  assetClass: 'Asset class',
  assetSubType: 'Asset sub-type',
  gstTreatment: 'GST treatment',
  lettableAreaSqm: 'Lettable area (m²)',
  siteAreaSqm: 'Site area (m²)',
  recoverableOutgoings: 'Recoverable outgoings p.a.',
  nonRecoverableOutgoings: 'Non-recoverable outgoings p.a.',
};

export interface DocumentExtractResult {
  pack: ParsedPack;
  fileName: string;
}

/** True when this file can be sent to the document extractor at all. */
export function isExtractableDocument(file: File): boolean {
  return isPdfFile(file) || isImageFile(file);
}

/**
 * Extract assessment fields from one supporting document.
 *
 * PDFs are rasterised in the browser first (the extractor is a vision model),
 * which is also why this is progress-reported: a 40-page IM takes a while.
 */
export async function extractFromDocument(
  file: File,
  segment: ExtractSegment,
  onProgress?: (stage: 'rendering' | 'analysing', current?: number, total?: number) => void,
): Promise<DocumentExtractResult> {
  if (!isExtractableDocument(file)) {
    throw new Error('Only PDF and image files can be read for property details.');
  }

  const body: Record<string, unknown> = { fileName: file.name, propertyCategory: segment };

  if (isPdfFile(file)) {
    onProgress?.('rendering');
    const converted = await convertPdfToImages(file, (current, total) => onProgress?.('rendering', current, total));
    if (!converted.success) throw new Error(converted.error || 'Could not render the PDF for analysis.');
    body.pageImages = converted.images.map((image) => ({
      pageNumber: image.pageNumber, base64: image.base64, width: image.width, height: image.height,
    }));
  } else {
    body.singleImage = await imageFileToBase64(file);
    body.imageMimeType = file.type || 'image/png';
  }

  onProgress?.('analysing');
  const { data, error } = await invokeSecureFunction('parse-property-pdf', body, { timeoutMs: 300000 });
  if (error) throw new Error(error.message || 'The document could not be analysed.');
  if (!data?.success) throw new Error(data?.error || 'The document could not be analysed.');

  const { property, lease } = mapDetails(data.extractedData ?? data.structuredPayload ?? data, segment);

  const payload = emptyAssessmentPayload(segment === 'industrial' ? 'industrial_investment' : 'commercial_investment');
  const capturedAt = new Date().toISOString();
  const values: ParsedFieldValue[] = [];
  const provenance: FieldProvenance[] = [];

  const record = (section: string, step: number, prefix: string, entries: Record<string, unknown>) => {
    Object.entries(entries).forEach(([key, value]) => {
      values.push({
        key: `${prefix}.${key}`,
        label: FIELD_LABELS[key] ?? key,
        section,
        step,
        path: `${prefix}.${key}`,
        value,
        raw: value,
      });
      provenance.push({
        field: `${prefix}.${key}`,
        source: 'document_import',
        sourceRef: file.name,
        requiresConfirmation: true,
        capturedAt,
      });
    });
  };

  record('Property & transaction', 2, 'property', property);
  record('Lease income', 6, 'lease', lease);

  const pack: ParsedPack = {
    recognised: true,
    formatVersion: null,
    assessmentReference: null,
    payload: {
      ...payload,
      property: { ...payload.property, ...property },
      lease: { ...payload.lease, ...lease },
      provenance,
    },
    values,
    provenance,
    issues: [],
    counts: {
      fields: values.length,
      entities: 0,
      incomePeriods: 0,
      addbacks: 0,
      portfolioAssets: 0,
      liabilities: 0,
      tenancies: 0,
    },
  };

  return { pack, fileName: file.name };
}
