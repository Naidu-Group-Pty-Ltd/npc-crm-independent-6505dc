import { Bath, Bed, Car, CalendarClock, Mail, Maximize2, MoreVertical, Phone } from 'lucide-react';
import { badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { PropertyListing } from '@/lib/airtable';
import type { StoredListingImage } from '@/lib/listingImages';
import { ListingHero } from '@/components/listings/ListingHero';
import {
  displayPrice,
  formatArea,
  formatLocality,
  listingFreshness,
  photoFreshness,
  qualityCaveat,
} from '@/lib/listingDisplay';
import { listingContact } from '@/lib/listingContact';
import { marketPresence, MARKET_PRESENCE_TONE } from '@/lib/marketPresence';
import { hasListingUrl } from '@/lib/listings/listingLinks.pure';

const PILL = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold leading-none tracking-[0.02em] shadow-sm';

export interface ListingGalleryCardProps {
  listing: PropertyListing;
  images: StoredListingImage[] | undefined;
  imagesResolving: boolean;
  point?: { lat: number; lng: number } | null;
  isSelected: boolean;
  onSelect: (checked: boolean) => void;
  onOpenDetails: () => void;
  onOpenSource?: () => void;
  onEmailAgent?: () => void;
  /** The automatic cascade is reading this listing's source page right now. */
  isAutoSearching?: boolean;
  formatDate: (value: Date | string) => string;
}

/**
 * A listing as a photo-first card, laid out the way the national portals do it.
 *
 * The reference is realestate.com.au, and the reason to follow it is not
 * fashion: every agent who sends us a listing reads that site daily, and so
 * does every buyer they deal with. Matching the reading order — agency band
 * over the photograph, freshness on the image, **price as the headline**,
 * address beneath it, then a row of specification icons — means nobody has to
 * learn our card. Deviating would cost recognition and buy nothing.
 *
 * Where this goes further than the portals, it does so because the portals are
 * publishing polished listings and we are publishing a mailbox:
 *
 * - **It says what it does not know.** A portal never shows a listing without a
 *   price or a photograph; roughly half of ours have no price and most have no
 *   photograph yet. "Price on request" and a drawn cover are honest where a
 *   blank would read as broken.
 * - **It carries a quality signal.** A portal's data is entered by the agent;
 *   ours is parsed out of an email, so a card that has been geocoded into the
 *   wrong state has to be able to admit it.
 * - **It offers the next action inline.** The portals make you open the listing
 *   to reach the agent. If we already hold an address, the enquiry is one click
 *   from the grid.
 */
export function ListingGalleryCard({
  listing,
  images,
  imagesResolving,
  point,
  isSelected,
  onSelect,
  onOpenDetails,
  onOpenSource,
  onEmailAgent,
  isAutoSearching = false,
  formatDate,
}: ListingGalleryCardProps) {
  const price = displayPrice(listing);
  const locality = formatLocality(listing);
  const caveat = qualityCaveat(listing);
  const land = formatArea(listing.landSizeSqm);
  const photoCount = images?.length ?? 0;
  const contact = listingContact(listing);
  const freshness = listingFreshness(listing);
  const photos = photoFreshness(listing);
  const inspection = listing.inspectionStart ?? listing.nextInspectionDate;
  const presence = marketPresence(listing);

  return (
    <article
      className={cn(
        'group/card relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition-all duration-200',
        'hover:-translate-y-0.5 hover:shadow-[0_16px_40px_rgba(15,23,42,0.12)] focus-within:ring-2 focus-within:ring-primary/35',
        'dark:bg-background/80 dark:shadow-black/30',
        isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-border/70 dark:border-white/10',
      )}
    >
      <div className="relative">
        <ListingHero
          images={images}
          isResolving={imagesResolving}
          label={listing.address ?? listing.suburb ?? undefined}
          point={point}
          aspect="aspect-[4/3]"
          rounded={false}
          onExpand={onOpenDetails}
          isFindingPhotos={isAutoSearching}
          listing={listing}
          streetViewMode="auto"
        />

        {/*
          The agency band. On realestate.com.au this carries the agency's
          uploaded logo and the agent's headshot; we hold neither — every image
          column on all 1,441 records is empty — so it sets the agency name in
          its place rather than reserving a gap for a logo that never arrives.
        */}
        {(listing.agencyName || contact.name) && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-foreground/70 to-transparent px-2.5 pb-6 pt-2">
            <span className="min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.06em] text-background">
              {listing.agencyName ?? 'Private listing'}
            </span>
            {contact.name && (
              <span className="shrink-0 truncate text-[11px] font-medium text-background/90">
                {contact.name}
              </span>
            )}
          </div>
        )}

        {/*
          Market presence, where the raw status string used to sit. "Available"
          told a buyer's agent nothing they act on; on-market versus off-market
          is the first question they ask, and off market — a listing the agent
          sent us with no public campaign — is this marketplace's whole edge,
          so it gets a first-class pill rather than an absence of one. The
          derivation and the wording live in `marketPresence`, shared with the
          detail surfaces, with a title carrying how we know.
        */}
        <div className="pointer-events-none absolute left-2 top-9 flex flex-wrap gap-1.5">
          <span
            title={presence.explanation}
            className={cn(
              'pointer-events-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wider shadow-md backdrop-blur-[1px]',
              MARKET_PRESENCE_TONE[presence.presence],
            )}
          >
            <span
              className="h-2 w-2 rounded-full bg-current opacity-90 ring-1 ring-background/20"
              aria-hidden="true"
            />
            {presence.label}
          </span>
          {price.isRent && presence.presence !== 'on-market' && (
            <span className={cn(PILL, 'bg-info/90 text-background shadow-md')}>Rental</span>
          )}
        </div>

        {/*
          The photo count, and — when intake recorded one — when the set was
          captured. Those are different questions from the "Added N days ago"
          pill below: a listing added last month can have been re-scraped
          yesterday, and a reader deciding whether to trust a photograph is
          asking about the photograph, not the record. The date rides in the
          title rather than the label because the pill is 10px and already
          competing with the agency band above it; the dot is the at-a-glance
          version, and it only appears when we actually know.
        */}
        {photoCount > 1 && (
          <span
            title={photos ? [photos.label, photos.source].filter(Boolean).join(' — ') : undefined}
            className={cn(
              PILL,
              'pointer-events-none absolute right-2 top-9 bg-foreground/70 text-background',
            )}
          >
            {photos?.isRecent && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-success"
                aria-hidden="true"
              />
            )}
            {photoCount} photos
            {/* `title` is not reachable by a screen reader; this is. */}
            {photos && <span className="sr-only">, {photos.label}</span>}
          </span>
        )}

        {/*
          Freshness over the image, as the portals do — mirrored to the right.

          realestate.com.au puts this bottom-left, and matching it was the first
          attempt. Both bottom-left slots inside the frame are already taken:
          `ListingHero` draws its slide counter there when a listing has more
          than one photograph, and its "No photo on record" caption there when
          it has none. Screenshotting showed the pill sitting on top of both.
          The right-hand side is free in each case — the photo-count badge only
          occupies the top-right when photos exist, which is exactly when this
          pill is at the bottom.
        */}
        {freshness && (
          <span
            className={cn(
              PILL,
              'pointer-events-none absolute transition-opacity',
              photoCount > 0 ? 'bottom-2 right-2' : 'right-2 top-9',
              // The bulk-select checkbox is revealed in this same corner on
              // hover. Informational text yields to an actual control.
              photoCount > 0 && 'group-hover/card:opacity-0',
              freshness.isNew ? 'bg-success text-background' : 'bg-background/90 text-foreground',
            )}
          >
            {freshness.isNew && (
              <span className="h-1.5 w-1.5 rounded-full bg-background/90" aria-hidden="true" />
            )}
            {freshness.label}
          </span>
        )}

        <div className="absolute right-2 bottom-2 opacity-0 transition-opacity group-hover/card:opacity-100 focus-within:opacity-100">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onSelect(checked === true)}
            className="h-5 w-5 border-border/80 bg-background/90 shadow-sm"
            aria-label={`Select ${listing.address ?? 'listing'}`}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        {/*
          Price first, address second — the portals' order, and the right one.
          Someone scanning a grid is filtering on affordability before they care
          which street it is on.
        */}
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={onOpenDetails}
            className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span
              className={cn(
                'block truncate text-[17px] font-bold leading-tight',
                price.known ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {price.text}
            </span>
            <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
              {listing.address ?? listing.fullAddress ?? 'Address not extracted'}
              {locality ? `, ${locality}` : ''}
            </span>
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-mr-1 h-8 w-8 shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-primary/40"
                aria-label="Listing actions"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpenDetails}>Open details</DropdownMenuItem>
              {contact.email && onEmailAgent && (
                <DropdownMenuItem onClick={onEmailAgent}>Email the agent</DropdownMenuItem>
              )}
              {contact.phone && (
                <DropdownMenuItem asChild>
                  <a href={`tel:${contact.phone.replace(/\s/g, '')}`}>Call {contact.phone}</a>
                </DropdownMenuItem>
              )}
              {hasListingUrl(listing.url) && onOpenSource && (
                <DropdownMenuItem onClick={onOpenSource}>Open source listing</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/*
          The specification row, in the portals' fixed order: beds, baths, cars,
          land, then type. Fixed order matters more than compactness — the eye
          learns the positions and stops reading the icons.
        */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-semibold text-foreground">
          <Spec icon={Bed} value={listing.beds} unit="bedrooms" />
          <Spec icon={Bath} value={listing.baths} unit="bathrooms" />
          <Spec icon={Car} value={listing.carSpaces} unit="car spaces" />
          {land && (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Maximize2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              {land}
            </span>
          )}
          {listing.propertyType && (
            <span className="text-muted-foreground">
              <span aria-hidden="true">· </span>
              {listing.propertyType}
            </span>
          )}
        </div>

        {(inspection || caveat) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {inspection && (
              <span className={cn(badgeVariants({ variant: 'outline' }), PILL, 'border-primary/40 text-primary')}>
                <CalendarClock className="h-3 w-3" aria-hidden="true" />
                {formatDate(inspection)}
              </span>
            )}
            {caveat && (
              <span
                title={caveat}
                className={cn(badgeVariants({ variant: 'outline' }), PILL, 'border-warning/40 text-warning')}
              >
                Check location
              </span>
            )}
          </div>
        )}

        {/*
          The action the portals make you open a page for. Only rendered when
          there is somewhere to send it — two thirds of these records carry no
          contact address, and a disabled button on most of the page is noise.
        */}
        {(contact.email || contact.phone) && (
          <div className="mt-auto flex gap-1.5 pt-1">
            {contact.email && onEmailAgent && (
              <Button
                type="button"
                size="sm"
                className="h-9 flex-1 rounded-full text-xs font-bold"
                onClick={onEmailAgent}
              >
                <Mail className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Email agent
              </Button>
            )}
            {contact.phone && (
              <Button
                asChild
                size="sm"
                variant="outline"
                className={cn('h-9 rounded-full text-xs font-bold', !contact.email && 'flex-1')}
              >
                <a href={`tel:${contact.phone.replace(/\s/g, '')}`} aria-label={`Call ${contact.phone}`}>
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  {!contact.email && <span className="ml-1.5">{contact.phone}</span>}
                </a>
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * One specification.
 *
 * Rendered only when the number is known. The portals always show all three
 * because their listings always have all three; ours often do not, and a `–`
 * where a bedroom count should be tells the reader nothing they cannot infer
 * from its absence.
 */
function Spec({
  icon: Icon,
  value,
  unit,
}: {
  icon: typeof Bed;
  value: number | null | undefined;
  unit: string;
}) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      {value}
      <span className="sr-only"> {unit}</span>
    </span>
  );
}

export default ListingGalleryCard;
