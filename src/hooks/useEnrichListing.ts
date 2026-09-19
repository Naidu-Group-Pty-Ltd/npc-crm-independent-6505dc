import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { invokeSecureFunction } from '@/lib/secureInvoke';

interface EnrichResponse {
  success?: boolean;
  error?: string;
  status?: string;
  fieldsFilled?: string[];
  images?: number;
  resolvedUrl?: string | null;
}

/**
 * Fetch one listing's photos and details from its source page, now.
 *
 * The sweep that normally does this runs on a ten-minute cron and works through
 * the backlog worst-first, so a particular listing may be hours away from its
 * turn. That is the right default for 1,441 records and the wrong answer for
 * someone looking at one of them and wondering where the photographs are.
 *
 * Failure is reported rather than swallowed. The enrichment can genuinely come
 * back with nothing — a listing with no source link, a page that 404s, an agency
 * that blocks us — and the person who pressed the button is owed the difference
 * between "there is nothing to find" and "we could not reach it".
 */
export function useEnrichListing(onDone?: (listingId: string) => void) {
  const [pending, setPending] = useState<string | null>(null);

  const enrich = useCallback(
    async (listingId: string) => {
      if (pending) return;
      setPending(listingId);
      try {
        const { data, error } = await invokeSecureFunction<EnrichResponse>('listing-enrichment', {
          op: 'enrich',
          listingId,
        });

        if (error || !data || data.success === false) {
          const reason = data?.error ?? error?.message ?? '';
          // The most likely reason on a fresh deployment, and the least
          // guessable from a generic failure toast.
          if (/not found|404|failed to fetch/i.test(reason)) {
            toast.error('The enrichment service is not reachable yet', {
              description: 'It is deployed with the edge functions; try again once the next deploy lands.',
            });
          } else {
            toast.error('Could not fetch details for this listing', { description: reason });
          }
          return;
        }

        const found = data.images ?? 0;
        const filled = data.fieldsFilled?.filter((field) => field !== 'imageUrls' && field !== 'resolvedUrl') ?? [];

        if (found === 0 && filled.length === 0) {
          toast.info('Nothing new found for this listing', {
            description: data.resolvedUrl
              ? 'The source page did not carry photos or specs we could read.'
              : 'This listing has no source link to follow.',
          });
        } else {
          toast.success(
            found > 0
              ? `Found ${found} photo${found === 1 ? '' : 's'}`
              : 'Details updated',
            {
              description: filled.length > 0 ? `Filled in ${filled.join(', ')}.` : undefined,
            },
          );
          onDone?.(listingId);
        }
      } catch (error) {
        toast.error('Could not fetch details for this listing', {
          description: error instanceof Error ? error.message : undefined,
        });
      } finally {
        setPending(null);
      }
    },
    [pending, onDone],
  );

  return { enrich, pendingListingId: pending, isEnriching: pending !== null };
}
