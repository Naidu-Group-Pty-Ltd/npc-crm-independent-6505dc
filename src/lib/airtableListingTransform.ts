/**
 * Browser-side entry point for the Airtable → listing projection.
 *
 * The implementation lives in `supabase/functions/_shared/airtableListing.pure.ts`
 * so the edge runtime and the browser share one copy. `airtable-proxy` projects
 * server-side and returns finished listings; `listings-cache` stores Airtable's
 * `fields` verbatim and hands them back unprojected, so the same mapping has to
 * run here. Re-exporting rather than reimplementing is what stops the two paths
 * disagreeing about, say, which column holds the agent's name.
 */
export {
  projectAirtableRecord,
  resolveConfidences,
  resolveListingImages,
  resolvePrice,
  type AirtableSourceRecord,
  type ListingConfidences,
  type PriceBasis,
  type ProjectedListing,
  type ResolvedListingImages,
  type ResolvedPrice,
} from '../../supabase/functions/_shared/airtableListing.pure';
