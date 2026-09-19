import { PropertyListing } from '@/lib/airtable';
import { Card, CardContent } from '@/components/ui/card';
import { badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfidenceBadge } from '@/components/dashboard/ConfidenceBadge';
import { 
  Bed, 
  Bath, 
  Car, 
  MoreVertical, 
  ExternalLink, 
  Copy, 
  BarChart3,
  Calendar,
  Mail,
  MapPin,
  Phone
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ListingThumbnail } from '@/components/listings/ListingThumbnail';
import type { StoredListingImage } from '@/lib/listingImages';
import { displayPrice, formatLocality, qualityCaveat } from '@/lib/listingDisplay';
import { listingContact } from '@/lib/listingContact';
import { hasListingUrl } from '@/lib/listings/listingLinks.pure';

const LISTING_CARD_BADGE_BASE = 'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none tracking-[0.02em] shadow-sm';
const LISTING_CARD_PROPERTY_TYPE_BADGE = 'border-border/80 bg-muted/90 text-foreground dark:border-white/10 dark:bg-white/[0.06] dark:text-foreground';
const LISTING_CARD_CONFIDENCE_BADGE = 'rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none shadow-sm';
const getListingCardConfidenceBadgeTone = (confidence: number) =>
  confidence >= 0.7
    ? 'border-success/30 bg-success/10 text-success dark:border-success/30 dark:bg-success/10 dark:text-success'
    : 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-400/30 dark:bg-brand-400/10 dark:text-brand-200';

interface PropertyCardProps {
  listing: PropertyListing;
  isSelected: boolean;
  onSelect: (checked: boolean) => void;
  onOpenDetails: () => void;
  onOpenInvestmentReport: () => void;
  onCopyAddress: () => void;
  onEmailAgent?: () => void;
  onOpenSource?: () => void;
  formatCurrency: (value: number) => string;
  formatDate: (date: Date | string | null | undefined) => string;
  /** Stored photos for this listing, resolved once for the page. */
  images?: StoredListingImage[];
  imagesResolving?: boolean;
}

export function PropertyCard({
  listing,
  isSelected,
  onSelect,
  onOpenDetails,
  onOpenInvestmentReport,
  onCopyAddress,
  onEmailAgent,
  onOpenSource,
  formatCurrency,
  formatDate,
  images,
  imagesResolving,
}: PropertyCardProps) {
  // One shared decision about what a price line says, so the card, the table and
  // the map popup cannot disagree about the same listing.
  const price = displayPrice(listing);
  const caveat = qualityCaveat(listing);
  const contact = listingContact(listing);
  return (
    <Card 
      className={cn(
        "transition-all duration-200 active:scale-[0.98] focus-within:ring-2 focus-within:ring-primary/35",
        isSelected && "ring-2 ring-primary"
      )}
    >
      <CardContent className="p-4">
        {/* Header: Checkbox + Address + Actions */}
        <div className="flex items-start gap-3">
          <Checkbox
            checked={isSelected}
            onCheckedChange={onSelect}
            className="mt-1 h-5 w-5 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
            aria-label={`Select ${listing.address || listing.location || 'listing'}`}
          />
          
          <ListingThumbnail
            images={images}
            isResolving={imagesResolving}
            label={listing.address || listing.suburb || undefined}
            className="h-14 w-20"
            onClick={onOpenDetails}
          />

          <button type="button" className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2" onClick={onOpenDetails}>
            <span role="heading" aria-level={3} className="block font-medium text-sm leading-tight truncate">
              {listing.address || 'Unknown Address'}
            </span>
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
              <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground truncate">
                {formatLocality(listing) || 'Location unknown'}
              </span>
              {caveat && (
                <span
                  title={caveat}
                  className={cn(badgeVariants({ variant: 'outline' }), LISTING_CARD_BADGE_BASE, 'shrink-0 border-warning/40 text-warning')}
                >
                  Check location
                </span>
              )}
              {listing.propertyType && (
                <span className={cn(badgeVariants({ variant: 'outline' }), LISTING_CARD_BADGE_BASE, LISTING_CARD_PROPERTY_TYPE_BADGE, "shrink-0")}>
                  {listing.propertyType}
                </span>
              )}
            </span>
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2"
                aria-label={`Open actions for ${listing.address || listing.location || 'listing'}`}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {contact.email && onEmailAgent && (
                <DropdownMenuItem onClick={onEmailAgent} className="min-h-10 focus:bg-accent focus:text-accent-foreground">
                  <Mail className="h-4 w-4 mr-2" />
                  Email the agent
                </DropdownMenuItem>
              )}
              {contact.phone && (
                <DropdownMenuItem asChild className="min-h-10 focus:bg-accent focus:text-accent-foreground">
                  <a href={`tel:${contact.phone.replace(/\s/g, '')}`}>
                    <Phone className="h-4 w-4 mr-2" />
                    Call {contact.phone}
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onOpenDetails} className="min-h-10 focus:bg-accent focus:text-accent-foreground">
                Open Details
              </DropdownMenuItem>
              {hasListingUrl(listing.url) && onOpenSource && (
                <DropdownMenuItem onClick={onOpenSource} className="min-h-10 focus:bg-accent focus:text-accent-foreground">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Source
                </DropdownMenuItem>
              )}
              {listing.address && (
                <DropdownMenuItem onClick={onCopyAddress} className="min-h-10 focus:bg-accent focus:text-accent-foreground">
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Address
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onOpenInvestmentReport} className="min-h-10 focus:bg-accent focus:text-accent-foreground">
                <BarChart3 className="h-4 w-4 mr-2" />
                Investment Report
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Price */}
        <div className="mt-3 flex flex-wrap items-baseline gap-2">
          <span className={cn('text-lg font-bold', price.known ? 'text-primary' : 'text-muted-foreground')}>
            {price.text}
          </span>
          {price.isRent && (
            <span className={cn(badgeVariants({ variant: 'outline' }), LISTING_CARD_BADGE_BASE, 'shrink-0')}>
              Rental
            </span>
          )}
          {listing.saleMethod && !price.isRent && (
            <span className="text-xs text-muted-foreground">{listing.saleMethod}</span>
          )}
        </div>

        {/* Property Details Row */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm sm:gap-4">
          <div className="flex items-center gap-1.5">
            <Bed className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{listing.beds || '-'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Bath className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{listing.baths || '-'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Car className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{listing.carSpaces || '-'}</span>
          </div>
          
          {/* Confidence Badge */}
          <div className="ml-auto">
            {listing.confidence !== undefined && listing.confidence !== null ? (
              <ConfidenceBadge confidence={listing.confidence} className={cn(LISTING_CARD_CONFIDENCE_BADGE, getListingCardConfidenceBadgeTone(listing.confidence))} />
            ) : null}
          </div>
        </div>

        {/* Footer: Agency + Inspection */}
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs text-muted-foreground max-w-full truncate sm:max-w-[50%]">
            {listing.agencyName || 'Unknown Agency'}
          </span>
          
          {listing.inspectionStart ? (
            <div className="flex items-center gap-1 text-xs text-primary">
              <Calendar className="h-3 w-3" />
              <span>{formatDate(listing.inspectionStart)}</span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">No inspection</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
