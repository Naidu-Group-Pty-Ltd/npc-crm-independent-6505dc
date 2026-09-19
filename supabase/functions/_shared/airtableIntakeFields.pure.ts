/**
 * The real column names of the Airtable **Property Intake Master** table.
 *
 * This module exists because getting them wrong is invisible. Airtable returns
 * `undefined` for a column that does not exist, exactly as it does for one that
 * is merely empty, so a mistyped name produces a listing that looks like a
 * record with missing data — and every fallback downstream dutifully renders
 * "Price on request" or "Low (0%)" as though that were the truth.
 *
 * That is what happened. The projection asked for `Price`, `Confidence Score`,
 * `Images`, `Status`, `Features`, `Land Size` and `Lot Number`. None of those
 * are columns on this table; they belong to `Properties`, the *other* table in
 * the same base. Meanwhile `Price Numeric` was populated on 773 of 1,441
 * records and `Extraction Confidence` on 1,440 — read by nothing.
 *
 * So the names live here, once, and are verified against the live schema rather
 * than guessed. `src/components/listings/PropertyIntakeDetails.tsx` was the only
 * place in the codebase that had them right; it now imports from here too, so
 * there is one copy to keep honest.
 *
 * Pure: no Deno, Supabase, network, DOM or clock.
 */

export const INTAKE_FIELDS = {
  /* -- Identity and provenance ------------------------------------------- */
  recordName: 'Property Record Name',
  recordType: 'Record Type',
  sourceType: 'Source Type',
  uniqueKey: 'Property Unique Key',
  createdTime: 'Created Time',
  lastModified: 'Last Modified Time',
  senderEmail: 'Sender Email',
  senderName: 'Sender Name',
  senderDomain: 'Sender Domain',
  rawSnippet: 'Raw Source Snippet',
  originalRowText: 'Original Row Text',

  /* -- Address ------------------------------------------------------------ */
  address: 'Address',
  fullAddress: 'Full Address',
  normalizedAddress: 'Normalized Address',
  unitNumber: 'Unit Number',
  streetNumber: 'Street Number',
  streetName: 'Street Name',
  streetType: 'Street Type',
  suburb: 'Suburb',
  postcode: 'Postcode',
  state: 'State',
  country: 'Country',
  latitude: 'Latitude',
  longitude: 'Longitude',
  googleMapsLink: 'Google Maps Link',
  geocodingStatus: 'Geocoding Status',

  /* -- Price --------------------------------------------------------------
   * `Price` does not exist. `Display Price Text` is the string an agent wrote
   * ("From $1,599,000", "$430,000 - $450,000") and is the most populated of the
   * lot; `Price Numeric` is the only clean number.
   */
  priceDisplay: 'Display Price Text',
  priceNumeric: 'Price Numeric',
  priceMin: 'Price Min',
  priceMax: 'Price Max',
  totalPrice: 'Total Price',
  landPrice: 'Land Price',
  buildPrice: 'Build Price',
  rentAmount: 'Rent Amount',
  rentPeriod: 'Rent Period',
  priceQualifier: 'Price Qualifier',
  saleMethod: 'Sale Method',
  gstApplicable: 'GST Applicable',
  priceNotes: 'Price Notes',

  /* -- Specs -------------------------------------------------------------- */
  beds: 'Beds',
  baths: 'Baths',
  carSpaces: 'Car Spaces',
  landSizeSqm: 'Land Size SQM',
  buildingAreaSqm: 'Building Area SQM',
  floorAreaSqm: 'Floor Area SQM',
  totalAreaSqm: 'Total Area SQM',
  frontageM: 'Frontage M',
  storeys: 'Storeys',
  features: 'Property Features',
  parkingDetails: 'Parking Details',

  /* -- Classification ----------------------------------------------------- */
  propertyType: 'Property Type',
  sector: 'Sector',
  intent: 'Intent',
  category: 'Category',
  zoning: 'Zoning',
  listingStatus: 'Listing Status',
  recordStatus: 'Record Status',
  contractType: 'Contract Type',
  packageType: 'Package Type',
  lot: 'Lot',
  projectName: 'Project Name',
  estateName: 'Estate Name',
  stage: 'Stage',
  builderDeveloper: 'Builder / Developer',
  availabilityDate: 'Availability Date',
  settlementDate: 'Settlement Date',

  /* -- Agent and agency ---------------------------------------------------
   * `Agent Phone` is nearly always empty; the number lands in `Agent Mobile`.
   */
  agentName: 'Agent Name',
  agentPhone: 'Agent Phone',
  agentMobile: 'Agent Mobile',
  agentEmail: 'Agent Email',
  agentRole: 'Agent Role',
  agencyName: 'Agency Name',
  agencyPhone: 'Agency Office Phone',
  agencyEmail: 'Agency Email',
  agencyWebsite: 'Agency Website',
  agentNotes: 'Agent / Agency Notes',

  /* -- Inspection --------------------------------------------------------- */
  inspectionStart: 'Inspection Start',
  inspectionEnd: 'Inspection End',
  inspectionNotes: 'Inspection Notes',
  inspectionRawText: 'Inspection Raw Text',
  nextInspection: 'Next Inspection Date',
  openHomeAvailable: 'Open Home Available',
  privateInspection: 'Private Inspection Required',

  /* -- Content ------------------------------------------------------------ */
  description: 'Property Description',
  summary: 'Summary',

  /* -- Links and media ----------------------------------------------------
   * The four attachment columns were empty on every one of the 1,441 records,
   * because the intake scenario never wrote to them: its image branch dropped
   * every `image/jpeg` attachment on a case-sensitive filter, and its web-scrape
   * branch asked the model for HTML while reading markdown, so it extracted
   * nothing at all. Both are fixed upstream; see
   * `docs/integrations/NPC_EMAIL_1_AUDIT.md`.
   *
   * `listingImageUrls` is the column that matters most here. Airtable attachment
   * URLs expire within hours and portal hotlinks rot, so intake records the
   * *source* URLs newest-first and the image library copies the bytes into our
   * own bucket. `imagesCapturedAt` is what makes "most recent photos" answerable
   * at all: `Created Time` says when the record arrived, which is a different
   * question from when its photos were last taken or re-scraped.
   */
  webLink: 'Web Link',
  sourceWebLink: 'Source Web Link',
  alternateWebLinks: 'Alternate Web Links',
  listingImages: 'Listing Images',
  listingImageUrls: 'Listing Image URLs',
  primaryImageUrl: 'Primary Image URL',
  imagesCapturedAt: 'Images Captured At',
  imageCount: 'Image Count',
  imageSource: 'Image Source',
  floorplan: 'Floorplan',
  brochure: 'Brochure',
  additionalAttachments: 'Additional Attachments',
  scrapedText: 'Scraped Website Text',
  scrapedHtml: 'Scraped Website HTML',
  webScrapeStatus: 'Web Scrape Status',
  enrichmentStatus: 'Enrichment Status',
  enrichedFields: 'Enriched Fields',

  /* -- Quality ------------------------------------------------------------ */
  extractionConfidence: 'Extraction Confidence',
  overallQuality: 'Overall Data Quality Score',
  addressConfidence: 'Address Confidence',
  priceConfidence: 'Price Confidence',
  specsConfidence: 'Specs Confidence',
  agentConfidence: 'Agent Details Confidence',

  /* -- Processing and review ---------------------------------------------- */
  processingStage: 'Processing Stage',
  processingStatus: 'Processing Status',
  needsHumanReview: 'Needs Human Review',
  reviewReason: 'Review Reason',
  humanReviewStatus: 'Human Review Status',
  humanReviewNotes: 'Human Review Notes',
  errorType: 'Error Type',
  errorMessage: 'Error Message',
  tags: 'Tags',
} as const;

export type IntakeFieldKey = keyof typeof INTAKE_FIELDS;

/**
 * The field Airtable is asked to sort by.
 *
 * It is `Created Time`, not `Created`. The wrong name did not fail loudly:
 * Airtable answers 422, and both `airtable-proxy` and the cache sync catch that
 * and silently retry without any sort at all. The walk still returned every
 * record, so nothing looked broken — but the client's incremental revalidation
 * assumes newest-first and quietly stopped being correct, and the cache's own
 * `orderLooksSorted` check had been reporting "walk did not come back
 * newest-first" into `last_error` on every run since it shipped.
 */
export const INTAKE_SORT_FIELD = INTAKE_FIELDS.createdTime;
