import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { PropertyListing } from '@/lib/airtable';
import { PIN_GLYPH_PATHS } from '@/components/listings/listingPinGlyphs';
import { propertyGlyph } from '@/lib/listingsMap';

/**
 * What a listing looks like when there is no photograph of it.
 *
 * The honest answer to "we have no photo" used to be a flat grey rectangle with
 * a small crossed-out-image icon. Truthful, and — at four cards across, with a
 * 4:3 frame — it turned most of the marketplace into dead grey space. A reader
 * scanning that page sees a broken product, not a candid one.
 *
 * So this draws something instead. It is not a fake photograph: nothing here
 * suggests it is the building. It is a *cover* — the same relationship a book
 * without a jacket photo has to its title page — carrying the three things the
 * record does know:
 *
 * - **Property type**, as the map's own glyph. Deliberately the identical
 *   silhouettes the pins use, so a house reads as a house whether you met it on
 *   the map or in the grid.
 * - **Where it is**, set in the middle where a photograph's subject would be.
 * - **Roughly what it costs**, as the wash behind it. The hue is picked from the
 *   price band, so a wall of covers still has visible structure — the expensive
 *   ones do not look identical to the cheap ones.
 *
 * Every colour is a semantic token. Nothing is keyed to a raw palette class, so
 * the covers re-theme with the brand and survive a white-label swap.
 */

export interface ListingCoverProps {
  listing: Pick<PropertyListing, 'propertyType' | 'suburb' | 'state' | 'address' | 'price'>;
  className?: string;
  /** Smaller frames drop the text and keep only the glyph. */
  compact?: boolean;
}

/**
 * Bands, not quantiles.
 *
 * The map's `priceTier` needs the whole corpus to compute quantiles, which a
 * single card does not have and should not have to load. Fixed AUD bands give a
 * stable answer per listing — the same property looks the same wherever it is
 * drawn, and on a filtered page the covers do not all re-tint because the
 * distribution moved.
 */
function band(price: number | null | undefined): 'unknown' | 'low' | 'mid' | 'high' | 'top' {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return 'unknown';
  if (price < 600_000) return 'low';
  if (price < 1_100_000) return 'mid';
  if (price < 2_500_000) return 'high';
  return 'top';
}

/**
 * Token-driven washes. Each is two stops of one hue plus the card surface.
 *
 * Four *distinguishable* hues, not four tokens that happen to exist. The brand
 * ramp and `warning` are both amber in this palette, so using them for adjacent
 * bands produced covers a reader could not tell apart — which defeats the point
 * of banding at all. `success` carries the middle band instead.
 */
const WASH: Record<ReturnType<typeof band>, string> = {
  unknown: 'from-muted/70 via-muted/40 to-card',
  low: 'from-info/25 via-info/10 to-card',
  mid: 'from-success/25 via-success/10 to-card',
  high: 'from-primary/45 via-primary/18 to-card',
  top: 'from-warning/30 via-warning/12 to-card',
};

export function ListingCover({ listing, className, compact = false }: ListingCoverProps) {
  const glyph = useMemo(() => propertyGlyph(listing.propertyType), [listing.propertyType]);
  const tone = band(listing.price);

  const where = [listing.suburb, listing.state].filter(Boolean).join(' ');
  const line = where || listing.address || null;

  return (
    <div
      className={cn(
        'relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br',
        WASH[tone],
        className,
      )}
      // The photograph is absent, not the property. Announcing "no photo" here
      // as well as in the caption below would say it twice to a screen reader.
      aria-hidden="true"
    >
      {/*
        A faint grid, the same device the dialog headers use. It gives the wash
        something to sit on so a large empty frame does not read as an unloaded
        image.
      */}
      <div className="absolute inset-0 opacity-[0.05] [background-image:radial-gradient(circle_at_1px_1px,hsl(var(--foreground))_1px,transparent_0)] [background-size:16px_16px]" />

      <svg
        viewBox="0 0 24 24"
        className={cn(
          'absolute text-foreground/[0.07]',
          compact ? 'h-16 w-16' : 'h-[62%] w-[62%]',
        )}
        fill="currentColor"
      >
        <path fillRule="evenodd" d={PIN_GLYPH_PATHS[glyph]} />
      </svg>

      {!compact && line && (
        <p className="relative max-w-[85%] truncate text-center text-sm font-semibold tracking-tight text-foreground/60">
          {line}
        </p>
      )}
    </div>
  );
}

export default ListingCover;
