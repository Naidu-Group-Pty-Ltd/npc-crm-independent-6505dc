import { useQuery } from '@tanstack/react-query';
import type { PropertyListing } from '@/lib/airtable';
import { projectAirtableRecord } from '@/lib/airtableListingTransform';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { propertyDataService } from '@/services/propertyDataService';

export interface ListingEnrichment {
  values: Record<string, unknown>;
  provenance: Record<string, { src: string; conf: number; at: string; ev?: string }>;
  status: string | null;
  last_enriched_at: string | null;
}

export interface ListingRecordResult {
  listing: PropertyListing;
  enrichment: ListingEnrichment | null;
}

interface RecordResponse {
  success?: boolean;
  error?: string;
  record?: { id?: string; createdTime?: string | null; fields?: Record<string, unknown> };
  enrichment?: ListingEnrichment | null;
}

/**
 * One listing, by id.
 *
 * The page it serves can be reached three ways, and only one of them has
 * anything warm to read: from the grid (the whole set is in memory), from a
 * bookmark (nothing is), or from a link someone pasted into Slack (nothing is,
 * and possibly on a device that has never opened the app).
 *
 * So it tries what is free before what is not. `peek` is synchronous and
 * usually hits when the reader came from the grid, which is the common case and
 * makes the page paint instantly. Otherwise `listings-cache` `op:'record'`
 * fetches exactly one row — the point of adding that op, since without it a deep
 * link would have to pull all 1,441 records, or worse fall back to walking
 * Airtable, to render a single property.
 */
export function useListingRecord(listingId: string | undefined, tableName?: string) {
  return useQuery<ListingRecordResult | null>({
    queryKey: ['listing', listingId],
    enabled: Boolean(listingId),
    staleTime: 5 * 60 * 1000,
    // A listing already on screen is the right thing to draw while the
    // authoritative copy is fetched, rather than a spinner over known data.
    placeholderData: () => {
      if (!listingId) return null;
      const cached = propertyDataService.peek(tableName)?.find((l) => l.id === listingId);
      return cached ? { listing: cached, enrichment: null } : null;
    },
    queryFn: async () => {
      if (!listingId) return null;

      const { data, error } = await invokeSecureFunction<RecordResponse>('listings-cache', {
        op: 'record',
        listingId,
        ...(tableName ? { tableName } : {}),
      });

      if (error || !data || data.success === false || !data.record?.id) {
        // Fall back to whatever the page already holds rather than failing
        // outright — a stale listing beats an error state.
        const cached = propertyDataService.peek(tableName)?.find((l) => l.id === listingId);
        if (cached) return { listing: cached, enrichment: null };
        throw new Error(data?.error || error?.message || 'Listing not found');
      }

      const listing = projectAirtableRecord({
        id: data.record.id,
        createdTime: data.record.createdTime ?? null,
        fields: data.record.fields ?? {},
      }) as unknown as PropertyListing;

      return {
        listing: { ...listing, rawFields: data.record.fields ?? undefined },
        enrichment: data.enrichment ?? null,
      };
    },
  });
}
