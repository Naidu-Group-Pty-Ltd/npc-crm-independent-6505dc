import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PropertyListing } from '@/lib/airtable';
import type { StoredListingImage } from '@/lib/listingImages';
import { ListingGalleryCard } from '@/components/listings/ListingGalleryCard';
import { useAutoFindPhotos } from '@/hooks/useAutoFindPhotos';

/**
 * Cards drawn before the reader has to ask for more.
 *
 * Every card holds an `<img>` pointing at a signed URL, so this is not a
 * cosmetic limit — rendering all 1,441 at once would issue over a thousand
 * concurrent image requests. It is also the number handed to `useListingImages`,
 * which resolves in batches of 60 and caps at six requests per pass: asking it
 * for the whole filtered set would exceed that cap and leave most of the page
 * permanently unresolved.
 */
const PAGE_SIZE = 48;

export interface ListingGalleryGridProps {
  listings: PropertyListing[];
  images: Record<string, StoredListingImage[]>;
  imagesResolving: boolean;
  points?: Record<string, { lat: number; lng: number } | undefined>;
  selectedIds: Set<string>;
  onToggleSelect: (listing: PropertyListing, checked: boolean) => void;
  onOpenDetails: (listing: PropertyListing) => void;
  onOpenSource?: (listing: PropertyListing) => void;
  onEmailAgent?: (listing: PropertyListing) => void;
  /**
   * Told when the automatic source-page search found photographs for a
   * listing, so the owner of the image state can re-resolve that one record.
   */
  onImagesFound: (listingId: string) => void;
  formatDate: (value: Date | string) => string;
  /** Told how many cards are on screen, so image resolution follows the reader. */
  onVisibleCountChange?: (count: number) => void;
}

export function ListingGalleryGrid({
  listings,
  images,
  imagesResolving,
  points,
  selectedIds,
  onToggleSelect,
  onOpenDetails,
  onOpenSource,
  onEmailAgent,
  onImagesFound,
  formatDate,
  onVisibleCountChange,
}: ListingGalleryGridProps) {
  const [visible, setVisible] = useState(PAGE_SIZE);

  // Any change to the filtered set starts the reader at the top again, so the
  // page does not silently keep rendering four hundred cards from a previous
  // search.
  const signature = listings.length;
  useEffect(() => setVisible(PAGE_SIZE), [signature]);

  const shown = useMemo(() => listings.slice(0, visible), [listings, visible]);

  // The cascade's middle stage runs over exactly the cards on screen — the
  // rendered slice, not the filtered corpus. The ten-minute sweep owns the
  // other thirteen hundred; the browser's job is what the reader can see.
  const { searchingId } = useAutoFindPhotos(shown, images, imagesResolving, onImagesFound);

  useEffect(() => {
    onVisibleCountChange?.(shown.length);
  }, [shown.length, onVisibleCountChange]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((listing) => (
          <ListingGalleryCard
            key={listing.id}
            listing={listing}
            images={images[listing.id]}
            imagesResolving={imagesResolving}
            point={points?.[listing.id] ?? null}
            isSelected={selectedIds.has(listing.id)}
            onSelect={(checked) => onToggleSelect(listing, checked)}
            onOpenDetails={() => onOpenDetails(listing)}
            onOpenSource={onOpenSource ? () => onOpenSource(listing) : undefined}
            onEmailAgent={onEmailAgent ? () => onEmailAgent(listing) : undefined}
            isAutoSearching={searchingId === listing.id}
            formatDate={formatDate}
          />
        ))}
      </div>

      {visible < listings.length && (
        <div className="flex flex-col items-center gap-2 pb-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setVisible((current) => current + PAGE_SIZE)}
            className="min-h-10 rounded-full px-6 font-semibold"
          >
            {imagesResolving && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:hidden" aria-hidden="true" />
            )}
            Load {Math.min(PAGE_SIZE, listings.length - visible)} more
          </Button>
          <p className="text-xs text-muted-foreground">
            Showing {shown.length.toLocaleString('en-AU')} of {listings.length.toLocaleString('en-AU')}
          </p>
        </div>
      )}
    </div>
  );
}

export default ListingGalleryGrid;
