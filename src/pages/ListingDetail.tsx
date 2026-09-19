import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ExternalLink, Loader2, Mail, MapPin, Phone, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ListingHero } from '@/components/listings/ListingHero';
import {
  ListingDetailPanel,
  type MarketContext,
} from '@/components/listings/detail/ListingDetailPanel';
import { useListingImages } from '@/hooks/useListingImages';
import { useListingRecord } from '@/hooks/useListingRecord';
import { useEnrichListing } from '@/hooks/useEnrichListing';
import { useAutoFindPhotos } from '@/hooks/useAutoFindPhotos';
import { useListingGallery } from '@/hooks/useListingGallery';
import { useListingCoordinates } from '@/hooks/useListingCoordinates';
import { propertyDataService } from '@/services/propertyDataService';
import { displayPrice, formatLocality } from '@/lib/listingDisplay';
import { listingContact } from '@/lib/listingContact';
import { marketPresence, MARKET_PRESENCE_TONE } from '@/lib/marketPresence';
import { EmailAgentDialog } from '@/components/listings/EmailAgentDialog';
import { ListingLightbox } from '@/components/listings/ListingLightbox';
import type { PropertyListing } from '@/lib/airtable';

const PROPERTY_INTAKE_TABLE = 'Property Intake Master';

const SHELL = 'mx-auto w-full max-w-[1200px] px-3 pb-24 pt-4 sm:px-5 md:pb-10 lg:px-8';
const SURFACE =
  'rounded-[1.5rem] border border-border/60 bg-card/70 p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)] backdrop-blur sm:p-6 dark:border-white/10 dark:bg-background/40 dark:shadow-black/25';

/**
 * One property, at its own address.
 *
 * The modal it complements is fine for a glance from the grid, but a listing is
 * the thing people send each other — "have a look at this one" — and a modal has
 * no URL. This page does, so it survives a paste into Slack, a bookmark, and a
 * browser refresh.
 *
 * Which means it has to load from nothing. `useListingRecord` handles that: it
 * reads the in-memory set when the reader arrived from the grid, and otherwise
 * fetches exactly one row through `listings-cache op:'record'` rather than
 * pulling all 1,441.
 */
export default function ListingDetail() {
  const { listingId } = useParams<{ listingId: string }>();
  const navigate = useNavigate();
  const [emailOpen, setEmailOpen] = useState(false);
  const [lightboxAt, setLightboxAt] = useState<number | null>(null);
  const { data, isLoading, isError, error, refetch } = useListingRecord(listingId, PROPERTY_INTAKE_TABLE);
  const listing = data?.listing ?? null;

  const forResolution = useMemo(() => (listing ? [listing] : []), [listing]);
  const { images, isResolving, refresh: refreshImages } = useListingImages(forResolution);

  const onEnriched = useCallback(
    (id: string) => {
      refreshImages(id);
      void refetch();
    },
    [refreshImages, refetch],
  );

  // On this page the enrichment can fill in more than photographs — price,
  // specs, a contact address — so the record is re-read alongside the imagery.
  const { enrich: findPhotos, isEnriching } = useEnrichListing(onEnriched);
  // And it also runs unprompted: someone deep-linked to an unphotographed
  // listing should watch the photographs arrive, not hunt for a button.
  const { searchingId } = useAutoFindPhotos(forResolution, images, isResolving, onEnriched);
  const { points } = useListingCoordinates(forResolution);
  const point = listing ? (points[listing.id] ?? null) : null;

  // Ordered once here and handed to both the hero and the lightbox, so the
  // index the hero reports on expand opens the same slide in the lightbox.
  const { images: orderedImages } = useListingGallery(listing ? images[listing.id] : undefined);

  // Comparison drawn from the corpus already in memory. It is only offered when
  // the reader came from the grid — computing it would otherwise mean loading
  // the whole table to annotate one listing, which is the opposite of the point
  // of the single-record read.
  const market = useMemo<MarketContext | null>(() => {
    if (!listing?.suburb) return null;
    const all = propertyDataService.peek(PROPERTY_INTAKE_TABLE);
    if (!all) return null;
    return buildMarketContext(listing, all);
  }, [listing]);

  if (isLoading && !listing) {
    return (
      <div className={SHELL}>
        <Skeleton className="mb-4 h-8 w-40" />
        <Skeleton className="aspect-[16/9] w-full rounded-2xl" />
        <Skeleton className="mt-4 h-32 w-full rounded-2xl" />
      </div>
    );
  }

  if (isError || !listing) {
    return (
      <div className={SHELL}>
        <div className={cn(SURFACE, 'text-center')}>
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-warning" aria-hidden="true" />
          <h1 className="text-lg font-semibold text-foreground">This listing could not be loaded</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : 'It may have been removed from the source.'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Listings are pruned 30 days after they arrive, so an older link may simply have expired.
          </p>
          <Button asChild variant="outline" className="mt-4 rounded-full">
            <Link to="/listings">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Back to the marketplace
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const price = displayPrice(listing);
  const locality = formatLocality(listing);
  const contact = listingContact(listing);

  return (
    <div className={SHELL}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate(-1)}
        className="mb-3 -ml-2 rounded-full text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="mr-1.5 h-4 w-4" />
        Back
      </Button>

      <div className="space-y-4">
        <ListingHero
          images={orderedImages}
          isResolving={isResolving}
          label={listing.address ?? listing.suburb ?? undefined}
          point={point}
          aspect="aspect-[16/9]"
          showThumbnails
          onExpand={setLightboxAt}
          isFindingPhotos={isEnriching || searchingId === listing.id}
          listing={listing}
        />

        <header className={cn(SURFACE, 'space-y-3')}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-tight text-foreground sm:text-2xl">
                {listing.address ?? listing.fullAddress ?? 'Address not extracted'}
              </h1>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {locality ?? 'Location unknown'}
              </p>
            </div>
            <div className="text-right">
              <p
                className={cn(
                  'text-2xl font-bold leading-none',
                  price.known ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {price.text}
              </p>
              {price.isRent && <p className="mt-1 text-xs text-muted-foreground">Rental</p>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(() => {
              const presence = marketPresence(listing);
              return (
                <Badge
                  variant="outline"
                  title={presence.explanation}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold uppercase tracking-wider shadow-sm',
                    MARKET_PRESENCE_TONE[presence.presence],
                  )}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-90" aria-hidden="true" />
                  {presence.label}
                </Badge>
              );
            })()}
            {listing.propertyType && <Badge variant="secondary">{listing.propertyType}</Badge>}
            {listing.intent && <Badge variant="outline">{listing.intent}</Badge>}
            {listing.needsHumanReview && (
              <Badge variant="outline" className="border-warning/40 text-warning">
                Flagged for review
              </Badge>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              {/*
                The action the page exists to enable. Someone reads the specs,
                the inspection time and the confidence scores, decides they are
                interested, and the next thing they want is to ask about it —
                without going back to the grid to find a menu.
              */}
              {contact.email && (
                <Button size="sm" className="rounded-full" onClick={() => setEmailOpen(true)}>
                  <Mail className="mr-1.5 h-3.5 w-3.5" />
                  Email {contact.name?.split(' ')[0] ?? 'the agent'}
                </Button>
              )}
              {contact.phone && (
                <Button asChild size="sm" variant="outline" className="rounded-full">
                  <a href={`tel:${contact.phone.replace(/\s/g, '')}`}>
                    <Phone className="mr-1.5 h-3.5 w-3.5" />
                    {contact.phone}
                  </a>
                </Button>
              )}
              {listing.url && (
                <Button asChild size="sm" variant="outline" className="rounded-full">
                  <a href={listing.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    Source listing
                  </a>
                </Button>
              )}
              {/*
                Offered whenever the record has a source to read, not only when
                it has no photographs — a listing can have one image and still be
                missing its price, its land size and a contact address.
              */}
              {listing.url && (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => findPhotos(listing.id)}
                  disabled={isEnriching}
                >
                  {isEnriching ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin motion-reduce:hidden" aria-hidden="true" />
                  ) : (
                    <Search className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {isEnriching ? 'Fetching…' : 'Fetch details'}
                </Button>
              )}
            </div>
          </div>
        </header>

        <div className={SURFACE}>
          <ListingDetailPanel
            listing={listing}
            enrichment={data?.enrichment ?? null}
            point={point}
            market={market}
          />
        </div>
      </div>

      <ListingLightbox
        images={orderedImages}
        openAt={lightboxAt}
        onClose={() => setLightboxAt(null)}
        label={listing.address ?? listing.suburb ?? undefined}
      />

      <EmailAgentDialog listing={listing} open={emailOpen} onOpenChange={setEmailOpen} />

      {isLoading && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin motion-reduce:hidden" aria-hidden="true" />
          Refreshing
        </p>
      )}
    </div>
  );
}

/**
 * What else is on the market in this suburb.
 *
 * Asking prices from listings that arrived by email, not recorded sales — so it
 * is presented as context and never as a valuation. Only sale prices count:
 * `price` is null for rentals by construction, and mixing a weekly rent into a
 * median would be nonsense.
 */
function buildMarketContext(listing: PropertyListing, corpus: PropertyListing[]): MarketContext | null {
  const suburb = listing.suburb;
  if (!suburb) return null;

  const prices = corpus
    .filter(
      (other) =>
        other.id !== listing.id &&
        other.suburb === suburb &&
        (!listing.propertyType || other.propertyType === listing.propertyType) &&
        typeof other.price === 'number' &&
        other.price > 0,
    )
    .map((other) => other.price as number)
    .sort((a, b) => a - b);

  if (prices.length === 0) return null;
  const middle = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 0 ? Math.round((prices[middle - 1] + prices[middle]) / 2) : prices[middle];

  return {
    suburb,
    propertyType: listing.propertyType ?? null,
    sampleSize: prices.length,
    median,
    low: prices[0],
    high: prices[prices.length - 1],
  };
}
