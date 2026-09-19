import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pickHeroImage, type StoredListingImage } from '@/lib/listingImages';

interface ListingThumbnailProps {
  /** Stored images for this listing, from `useListingImages`. */
  images: StoredListingImage[] | undefined;
  /** True while the page-level pass is still resolving. */
  isResolving?: boolean;
  /** Used for the alt text; the address if you have it. */
  label?: string;
  className?: string;
  onClick?: () => void;
}

/**
 * One listing's hero photo, at whatever size the caller frames it.
 *
 * Shared by the list, table and detail surfaces so a listing looks the same
 * everywhere and there is a single place that knows what to do when a photo is
 * missing, still resolving, or dead.
 *
 * It renders `StoredListingImage`s — signed URLs for copies we hold — and never
 * the raw `listing.images` field. That field holds Airtable attachment objects
 * whose signed `url` has usually expired, which is why rendering it directly
 * produced broken images (or `[object Object]`) everywhere it was tried.
 */
export function ListingThumbnail({
  images,
  isResolving = false,
  label,
  className,
  onClick,
}: ListingThumbnailProps) {
  const [failed, setFailed] = useState(false);
  const hero = pickHeroImage(images ?? []);
  const url = failed ? null : hero?.url;

  // A newly-resolved URL deserves a fresh attempt, even if the previous one
  // for this slot failed.
  useEffect(() => setFailed(false), [hero?.url]);

  const frame = cn(
    'relative shrink-0 overflow-hidden rounded-md border border-border/60 bg-muted',
    className,
  );

  if (url) {
    const image = (
      <img
        src={url}
        alt={label ? `${label} — listing photo` : 'Listing photo'}
        className="h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
    return onClick ? (
      <button
        type="button"
        onClick={onClick}
        className={cn(frame, 'transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40')}
        aria-label={label ? `Open ${label}` : 'Open listing'}
      >
        {image}
      </button>
    ) : (
      <div className={frame}>{image}</div>
    );
  }

  if (isResolving) {
    return (
      <div
        className={cn(frame, 'animate-pulse bg-muted motion-reduce:animate-none')}
        aria-hidden="true"
      />
    );
  }

  // Deliberately an explicit "no photo" rather than an empty box: on a dense
  // list, a blank slot reads as "still loading" forever.
  return (
    <div className={cn(frame, 'flex items-center justify-center')} title="No photo on record">
      <ImageOff className="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
      <span className="sr-only">No photo on record</span>
    </div>
  );
}

export default ListingThumbnail;
