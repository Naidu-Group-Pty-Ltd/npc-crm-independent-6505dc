import { invokeSecureFunction } from '@/lib/secureInvoke';
import { INTAKE_SORT_FIELD } from '@/lib/airtableIntakeFields';
import type { ImageCandidate } from '@/lib/listingImages';

/** The six per-domain quality scores the intake pipeline records. */
export interface ListingConfidences {
  extraction: number | null;
  overall: number | null;
  address: number | null;
  price: number | null;
  specs: number | null;
  agent: number | null;
}

/**
 * How `price` should be read.
 *
 * `'rent'` means the listing is a rental and `price` is deliberately null —
 * a weekly rent must never sit in the same field as a sale price, because every
 * consumer of `price` (map colour tiers, suburb medians, filter ranges) treats
 * it as one.
 */
export type PriceBasis = 'numeric' | 'range' | 'total' | 'rent' | 'display' | null;

/** Whether a listing's state/postcode survived reconciliation against each other. */
export type LocalityTrust = 'record' | 'derived' | 'conflict' | 'unknown';

export interface PropertyListing {
  id: string;
  title: string;
  price: number | null;
  /**
   * Nullable throughout, deliberately. These used to carry the literal strings
   * 'Unknown Address', 'Unknown Suburb', 'Unknown Agent' and 'Unknown Agency',
   * which were never falsy — so every "is this missing?" check downstream
   * silently answered no, and the proxy's dedup pass treated two records with no
   * address as the same property and deleted one of them.
   */
  location: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  propertyType: string | null;
  listingDate: string;
  status: string | null;
  confidence: number | null;
  source: string;
  description: string;
  images: string[];
  agent: string | null;
  features: string[];
  // Enhanced fields for better data handling
  recordId?: string;
  url?: string;
  sourceHost?: string;
  hash?: string;
  messageId?: string;
  emailSubject?: string;
  from?: string;
  receivedAt?: Date | string;
  address?: string;
  suburb?: string;
  category?: string;
  beds?: number | null;
  baths?: number | null;
  carSpaces?: number | null;
  landSize?: string | number | null;
  lotNumber?: string;
  inspectionStart?: Date | string | null;
  inspectionEnd?: Date | string | null;
  inspectionNotes?: string;
  agencyName?: string;
  agentName?: string;
  agentPhone?: string;
  floorplans?: string[];
  summary?: string;
  keyEntities?: string;
  rawExtract?: string;
  createdTime?: Date | string;
  createdAt?: Date | string;
  webLinks?: string;
  state?: string;
  zipCode?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  // Enhanced analytics fields
  dataQuality?: number;
  isValidPrice?: boolean;
  isValidLocation?: boolean;
  completenessScore?: number;
  /** Raw Airtable fields exactly as returned by the proxy — used for table-specific extended views. */
  rawFields?: Record<string, any>;

  /* -- Property Intake Master ------------------------------------------------
   * Everything below is an optional addition, so no existing call site had to
   * change. They exist because the columns were always there and the projection
   * simply never read them: `Price Numeric` is populated on 773 of 1,441
   * records and the six confidence scores on 1,440, while the page rendered
   * "Price on request" and "Low (0%)".
   */

  /** What the agent wrote: "From $1,599,000", "$430,000 - $450,000". */
  priceDisplay?: string | null;
  priceMin?: number | null;
  priceMax?: number | null;
  priceBasis?: PriceBasis;
  rentAmount?: number | null;
  rentPeriod?: string | null;
  priceQualifier?: string | null;
  saleMethod?: string | null;
  gstApplicable?: string | null;

  confidences?: ListingConfidences;
  needsHumanReview?: boolean;
  reviewReason?: string[];
  errorType?: string | null;
  errorMessage?: string | null;
  humanReviewNotes?: string | null;

  landSizeSqm?: number | null;
  buildingAreaSqm?: number | null;
  floorAreaSqm?: number | null;
  totalAreaSqm?: number | null;
  frontageM?: number | null;
  storeys?: number | null;
  parkingDetails?: string | null;

  sector?: string | null;
  intent?: string | null;
  zoning?: string | null;
  listingStatus?: string | null;
  recordStatus?: string | null;
  processingStatus?: string | null;
  processingStage?: string | null;
  contractType?: string | null;
  packageType?: string | null;
  projectName?: string | null;
  estateName?: string | null;
  stage?: string | null;
  builderDeveloper?: string | null;
  availabilityDate?: string | null;
  settlementDate?: string | null;

  fullAddress?: string | null;
  normalizedAddress?: string | null;
  /**
   * How far down the address the record reaches — `address` (a street number),
   * `street` (a named street, no number), `locality` (a suburb) or `none`.
   * Measured from the parts below by `listingAddress.pure.ts`, so a surface can
   * plot a pin without implying a precision the data does not carry.
   */
  addressPrecision?: 'address' | 'street' | 'locality' | 'none' | null;
  unitNumber?: string | null;
  streetNumber?: string | null;
  streetName?: string | null;
  streetType?: string | null;
  propertyUniqueKey?: string | null;
  /** Whether state/postcode agreed with each other; `'conflict'` means both were dropped. */
  localityTrust?: LocalityTrust;
  localityConflicts?: string[];

  agentMobile?: string | null;
  agentEmail?: string | null;
  agentRole?: string | null;
  agencyPhone?: string | null;
  agencyEmail?: string | null;
  agencyWebsite?: string | null;

  inspectionRawText?: string | null;
  nextInspectionDate?: string | null;
  openHomeAvailable?: boolean;

  sourceWebLink?: string | null;
  alternateWebLinks?: string[];
  sourceType?: string | null;

  /* -- Photographs ---------------------------------------------------------
   * `images` is the raw `Listing Images` attachment array and stays exactly as
   * it was. `imageCandidates` is the resolved set the image library should
   * harvest: attachments plus the scraped `Listing Image URLs` column, ordered
   * best-source-first with plans pushed to the back.
   *
   * `imagesCapturedAt` is the freshness signal. It answers "how recent are
   * these photos", which `createdTime` cannot — a record filed in January can
   * have its photos re-scraped in August.
   */
  imageCandidates?: ImageCandidate[];
  imagesCapturedAt?: string | null;
  /** How many candidates the projection resolved — not how many photos render. */
  imageCandidateCount?: number;
  /** What intake counted, which can exceed the resolved count if some URLs were malformed. */
  reportedImageCount?: number | null;
  imageSource?: string | null;
  primaryImageUrl?: string | null;
  senderEmail?: string | null;
  senderName?: string | null;
  senderDomain?: string | null;
  lastModifiedTime?: string | null;
  tags?: string[];

  /** False when the date shown is "now" because the record carried none. */
  listedAtKnown?: boolean;
  /** Set by the proxy when this record was judged a duplicate of another. */
  duplicateOf?: string;
  /** Set on the best record of a duplicate group. */
  duplicateCount?: number;
}


export interface AirtableGetRecordsOptions {
  pageSize?: number;
  offset?: string;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  tableName?: string;
}

export interface AirtableTableInfo {
  id: string;
  name: string;
  primaryFieldId?: string;
}


export interface AirtableResponse {
  records: PropertyListing[];
  offset?: string;
  total: number;
}

class AirtableService {
  async getRecords(options: AirtableGetRecordsOptions = {}): Promise<AirtableResponse> {
    try {
      const { pageSize = 100, offset, sortField = INTAKE_SORT_FIELD, sortDirection = 'desc', tableName } = options;

      // Call the Supabase edge function instead of direct Airtable API
      const { data, error } = await invokeSecureFunction('airtable-proxy', {
        pageSize,
        offset,
        sortField,
        sortDirection,
        ...(tableName ? { tableName } : {}),
      });

      if (error) {
        console.error('Error calling airtable-proxy function:', error);
        throw new Error(`Failed to fetch Airtable records: ${error.message}`);
      }

      if (!data) {
        throw new Error('No data returned from airtable-proxy function');
      }

      if (data.error) {
        throw new Error(`Airtable API error: ${data.error}`);
      }

      // The airtable-proxy function already returns transformed data.
      // Attach the raw Airtable `fields` object as `rawFields` so UI can render table-specific
      // extended details (e.g. Property Intake Master rich fields).
      const records: PropertyListing[] = (data.records || []).map((r: any) => ({
        ...r,
        rawFields: r?.fields ?? undefined,
      }));
      return {
        records,
        offset: data.offset,
        total: data.total || 0,
      };

    } catch (error) {
      console.error('Failed to fetch Airtable records:', error);
      throw error;
    }
  }

  async listTables(): Promise<{ tables: AirtableTableInfo[]; defaultTableName: string | null }> {
    const { data, error } = await invokeSecureFunction('airtable-proxy', { op: 'list_tables' });
    if (error) throw new Error(`Failed to list Airtable tables: ${error.message}`);
    if (!data) throw new Error('No data returned from airtable-proxy list_tables');
    if (data.error) throw new Error(`Airtable API error: ${data.error}`);
    return {
      tables: (data.tables || []) as AirtableTableInfo[],
      defaultTableName: data.defaultTableName ?? null,
    };
  }


  async testConnection(): Promise<boolean> {
    try {
      const response = await this.getRecords({ pageSize: 1 });
      return response.records !== undefined;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }
}

export const airtableService = new AirtableService();
