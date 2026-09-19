import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listingContact } from '@/lib/listingContact';
import { EmailAgentDialog } from '@/components/listings/EmailAgentDialog';
import { ExternalLink, Copy, Bed, Bath, Car, Calendar, MapPin, Building, User, Eye, TrendingUp, Phone, Mail, Ruler, Tag, FileText, Sparkles, Hash, Loader2, Maximize2, Send } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ConfidenceBadge } from '@/components/dashboard/ConfidenceBadge';
import { InvestmentReportModal } from '@/components/listings/InvestmentReportModal';
import { PropertyIntakeDetails } from '@/components/listings/PropertyIntakeDetails';

import { getFullStateName } from '@/lib/states';
import { buildFullAddress } from '@/lib/addressUtils';
import { PropertyListing } from '@/lib/airtable';
import { useToast } from '@/hooks/use-toast';
import { useListingImages } from '@/hooks/useListingImages';
import { useAutoFindPhotos } from '@/hooks/useAutoFindPhotos';
import { useListingGallery } from '@/hooks/useListingGallery';
import { openListingUrl, resolveListingUrl } from '@/lib/listings/listingLinks.pure';

interface ListingDetailsModalProps {
  listing: PropertyListing | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ListingDetailsModal({ listing, isOpen, onClose }: ListingDetailsModalProps) {
  const { toast } = useToast();
  const [investmentModalOpen, setInvestmentModalOpen] = useState(false);
  const [emailAgentOpen, setEmailAgentOpen] = useState(false);
  // Resolved before the `!listing` bail-out for the same reason as the images
  // below: hooks and derived values here must not sit behind a conditional.
  const contact = listingContact(listing ?? ({} as never));

  // Resolved before the `!listing` bail-out because hooks cannot be conditional.
  //
  // The gallery deliberately does not render `listing.images` directly. An
  // Airtable attachment field holds objects, not strings, so `src={image}`
  // rendered `[object Object]` and the gallery silently showed nothing for
  // every base whose photos are attachments — which is most of them. These are
  // signed URLs for our own stored copies instead.
  const galleryInput = useMemo(() => (listing ? [listing] : []), [listing]);
  const { images: galleryByListing, isResolving: galleryResolving, refresh: refreshGallery } =
    useListingImages(galleryInput);
  // Unprompted, like everywhere else imagery appears: if the record has no
  // stored photographs and carries a source link, the page is read and the
  // grid below fills in — no button, no toast.
  const { searchingId } = useAutoFindPhotos(galleryInput, galleryByListing, galleryResolving, refreshGallery);
  const isSearching = listing !== null && searchingId === listing.id;
  // Photographs lead, floor plans trail — the same order the hero draws.
  const { images: galleryImages } = useListingGallery(
    listing ? galleryByListing[listing.id] : undefined,
  );

  if (!listing) return null;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (date: Date | string | null | undefined) => {
    if (!date) return 'Unknown';
    
    const dateObj = date instanceof Date ? date : new Date(date);
    
    if (isNaN(dateObj.getTime())) {
      return 'Invalid date';
    }
    
    return new Intl.DateTimeFormat('en-AU', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(dateObj);
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: `${label} copied to clipboard`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard",
        variant: "destructive"
      });
    }
  };

  /**
   * The links this listing actually carries.
   *
   * These used to be drawn on truthiness and opened raw, so a stored value
   * like `gattonrealestate.com.au/listings/…` — no scheme — was resolved
   * against this app's own origin and the reader got a tab with nothing in
   * it. A control is drawn only where a link resolves.
   */
  const webLinkUrl = resolveListingUrl(listing.webLinks);
  const sourceUrl = resolveListingUrl(listing.url);

  const openSourceUrl = () => { openListingUrl(listing.url); };
  const openWebLink = () => { openListingUrl(listing.webLinks); };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[min(90dvh,calc(100dvh-3rem))] sm:max-h-[calc(100dvh-3rem)] sm:w-[min(88vw,1480px)] sm:max-w-[calc(100vw-3rem)] sm:rounded-lg lg:h-[min(90dvh,calc(100dvh-4rem))] lg:max-h-[calc(100dvh-4rem)] lg:max-w-[min(1480px,calc(100vw-4rem))]">
        {/* Hero header */}
        <DialogHeader className="relative shrink-0 px-5 pt-5 pb-5 sm:px-6 lg:px-8 border-b border-border/60 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
          <div className="absolute inset-0 opacity-[0.04] pointer-events-none [background-image:radial-gradient(circle_at_1px_1px,hsl(var(--primary))_1px,transparent_0)] [background-size:14px_14px]" />
          <div className="relative flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              Property Intake
              {listing.category && <span className="opacity-60">· {listing.category}</span>}
            </div>
            <DialogTitle className="flex items-start gap-3 text-xl sm:text-2xl font-semibold leading-tight pr-10">
              <MapPin className="h-6 w-6 text-primary shrink-0 mt-1" />
              <span className="break-words">{buildFullAddress(listing)}</span>
            </DialogTitle>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {listing.propertyType && (
                <Badge variant="outline" className="border-primary/30 text-primary bg-primary/5">
                  <Building className="h-3 w-3 mr-1" />{listing.propertyType}
                </Badge>
              )}
              {listing.state && <Badge variant="outline">{getFullStateName(listing.state)}</Badge>}
              {listing.zipCode && <Badge variant="outline">{listing.zipCode}</Badge>}
              {listing.sourceHost && (
                <Badge variant="secondary" className="font-normal">
                  <ExternalLink className="h-3 w-3 mr-1" />{listing.sourceHost}
                </Badge>
              )}
            </div>
            {listing.price && (
              <div className="flex items-baseline gap-2 pt-2">
                <span className="text-3xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                  {formatCurrency(listing.price)}
                </span>
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Guide Price</span>
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5 sm:px-6 lg:px-8 lg:py-6">
          <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)] xl:gap-6">
            <aside className="min-w-0 space-y-5 lg:space-y-6 xl:order-2 xl:sticky xl:top-0 xl:self-start">
              {/* Sticky action bar */}
              <div className="flex flex-wrap gap-2 rounded-xl border border-border/60 bg-card/30 p-4">
                <Button
                  variant="default"
                  onClick={() => setInvestmentModalOpen(true)}
                  className="bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-md shadow-primary/20"
                >
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Investment Report
                </Button>
                {/*
                  First in the row, deliberately. Everything above it is there to
                  help someone decide; this is what they do once they have.
                */}
                {contact.email && (
                  <Button onClick={() => setEmailAgentOpen(true)}>
                    <Send className="h-4 w-4 mr-2" />
                    Email {contact.name?.split(' ')[0] ?? 'the agent'}
                  </Button>
                )}
                {/* The modal is the quick look; the page is the shareable one. */}
                <Button variant="outline" asChild>
                  <Link to={`/listings/${listing.id}`}>
                    <Maximize2 className="h-4 w-4 mr-2" /> Full page
                  </Link>
                </Button>
                {webLinkUrl && (
                  <Button variant="outline" onClick={openWebLink}>
                    <ExternalLink className="h-4 w-4 mr-2" /> View Listing
                  </Button>
                )}
                {sourceUrl && (
                  <Button variant="outline" onClick={openSourceUrl}>
                    <ExternalLink className="h-4 w-4 mr-2" /> View Source
                  </Button>
                )}
                {listing.address && (
                  <Button variant="ghost" size="sm" onClick={() => copyToClipboard(buildFullAddress(listing), "Full address")}>
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Address
                  </Button>
                )}
                {sourceUrl && (
                  <Button variant="ghost" size="sm" onClick={() => copyToClipboard(sourceUrl, "URL")}>
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy URL
                  </Button>
                )}
              </div>
            </aside>

            <div className="min-w-0 space-y-5 lg:space-y-6 xl:order-1">
          {/* Stat tiles */}
          {(listing.beds > 0 || listing.baths > 0 || listing.carSpaces > 0 || listing.landSize) && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { icon: Bed, label: 'Bedrooms', value: listing.beds },
                { icon: Bath, label: 'Bathrooms', value: listing.baths },
                { icon: Car, label: 'Car Spaces', value: listing.carSpaces },
                { icon: Ruler, label: 'Land Size', value: listing.landSize },
              ].filter(s => s.value).map((s, i) => (
                <div key={i} className="rounded-xl border border-border/60 bg-card/50 p-4 hover:border-primary/40 hover:bg-card transition-colors">
                  <s.icon className="h-4 w-4 text-primary mb-2" />
                  <div className="text-2xl font-semibold">{s.value}</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Two-column: Agent & Quality */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {/* Agent & Agency */}
            <div className="rounded-xl border border-border/60 bg-card/30 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                <User className="h-3.5 w-3.5" /> Agent & Agency
              </h3>
              <div className="space-y-2.5">
                {listing.agencyName && (
                  <div className="flex items-center gap-2 text-sm">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    <span className="min-w-0 break-words font-medium">{listing.agencyName}</span>
                  </div>
                )}
                {listing.agentName && (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="min-w-0 break-words">{listing.agentName}</span>
                  </div>
                )}
                {listing.agentPhone && (
                  <button
                    onClick={() => copyToClipboard(listing.agentPhone!, "Phone number")}
                    className="group flex items-center gap-2 text-sm w-full text-left rounded-md px-2 py-1.5 -mx-2 hover:bg-muted/50 transition-colors"
                  >
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span className="min-w-0 break-all font-mono">{listing.agentPhone}</span>
                    <Copy className="h-3 w-3 ml-auto opacity-0 group-hover:opacity-60 transition-opacity" />
                  </button>
                )}
              </div>
            </div>

            {/* Data Quality */}
            <div className="rounded-xl border border-border/60 bg-card/30 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5" /> Data Quality
              </h3>
              <div className="space-y-2.5">
                {listing.confidence !== undefined && listing.confidence !== null && (
                  <div className="flex items-center gap-2 text-sm">
                    <Eye className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Confidence:</span>
                    <ConfidenceBadge confidence={listing.confidence} />
                  </div>
                )}
                {listing.source && (
                  <div className="flex items-center gap-2 text-sm">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Source:</span>
                    <Badge variant="secondary">{listing.source}</Badge>
                  </div>
                )}
                {listing.hash && (
                  <div className="flex items-center gap-2 text-xs">
                    <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Hash:</span>
                    <span className="font-mono truncate">{listing.hash.slice(0, 16)}…</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Inspection Details */}
          {(listing.inspectionStart || listing.inspectionNotes) && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-primary mb-3 flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5" /> Inspection
              </h3>
              <div className="space-y-2">
                {listing.inspectionStart && (
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{formatDate(listing.inspectionStart)}</span>
                    {listing.inspectionEnd && (
                      <span className="text-muted-foreground">
                        — {new Intl.DateTimeFormat('en-AU', { hour: '2-digit', minute: '2-digit' }).format(listing.inspectionEnd instanceof Date ? listing.inspectionEnd : new Date(listing.inspectionEnd))}
                      </span>
                    )}
                  </div>
                )}
                {listing.inspectionNotes && (
                  <p className="text-sm text-muted-foreground italic">{listing.inspectionNotes}</p>
                )}
              </div>
            </div>
          )}

          {/* Description & Summary */}
          {(listing.description || listing.summary) && (
            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
              {listing.description && (
                <div className="rounded-xl border border-border/60 bg-card/30 p-5">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                    <FileText className="h-3.5 w-3.5" /> Property Description
                  </h3>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{listing.description}</p>
                </div>
              )}
              {listing.summary && listing.summary !== listing.description && (
                <div className="rounded-xl border border-border/60 bg-card/30 p-5">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5" /> AI Summary
                  </h3>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{listing.summary}</p>
                </div>
              )}
            </div>
          )}

          {/* Key Entities */}
          {listing.keyEntities && (
            <div className="rounded-xl border border-border/60 bg-card/30 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">Key Entities</h3>
              <p className="break-words text-sm text-muted-foreground">{listing.keyEntities}</p>
            </div>
          )}

          {/* Features */}
          {listing.features && listing.features.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Features</h3>
              <div className="flex flex-wrap gap-2">
                {listing.features.map((feature, index) => (
                  <Badge key={index} variant="secondary">{feature}</Badge>
                ))}
              </div>
            </div>
          )}

          {/*
            Images — rendered even when there are none.

            This section used to disappear entirely when the gallery came back
            empty, which is the state nearly every record is in. The result read
            as a property that simply had no photographs section, rather than one
            whose photographs have not been fetched yet, and left no way to ask
            for them.
          */}
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Images</h3>
                {galleryImages.some((image) => image.origin === 'scraped') && (
                  // Sourced photographs carry their provenance. A buyer's agent
                  // forwarding this listing should know the imagery came from
                  // the agency's public page, not from the email.
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Photographs sourced from the agency&rsquo;s public listing
                    {listing.url ? ' — the source link is under the actions menu.' : '.'}
                  </p>
                )}
              </div>
              {isSearching && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" aria-busy="true">
                  <Loader2 className="h-3 w-3 animate-spin motion-reduce:hidden" aria-hidden="true" />
                  Searching the source listing…
                </span>
              )}
            </div>
            {galleryImages.length === 0 && !galleryResolving && !isSearching ? (
              <p className="rounded-lg border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                No photographs stored for this listing yet.
                {listing.url
                  ? ' Its source page is checked automatically — anything found will appear here.'
                  : ' This record carries no source link to fetch them from.'}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {(galleryResolving || isSearching) && galleryImages.length === 0
                    ? Array.from({ length: 3 }, (_, index) => (
                        <div
                          key={`skeleton-${index}`}
                          className="aspect-video animate-pulse rounded-lg border border-border/60 bg-muted motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                      ))
                    : galleryImages.slice(0, 6).map((image, index) => (
                        <div key={image.url} className="group aspect-video bg-muted rounded-lg overflow-hidden border border-border/60 hover:border-primary/50 transition-colors">
                          <img
                            src={image.url}
                            alt={`Property image ${index + 1}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform cursor-pointer"
                            loading="lazy"
                            onClick={() => window.open(image.url, '_blank', 'noopener,noreferrer')}
                          />
                        </div>
                      ))}
                </div>
                {galleryImages.length > 6 && (
                  <p className="text-xs text-muted-foreground mt-2">+{galleryImages.length - 6} more images available on source</p>
                )}
              </>
            )}
          </div>

          {/* Floorplans */}
          {listing.floorplans && listing.floorplans.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Floorplans</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {listing.floorplans.map((floorplan, index) => (
                  <div key={index} className="aspect-video bg-muted rounded-lg overflow-hidden border border-border/60">
                    <img
                      src={floorplan}
                      alt={`Floorplan ${index + 1}`}
                      className="w-full h-full object-contain hover:scale-105 transition-transform cursor-pointer"
                      onClick={() => window.open(floorplan, '_blank')}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Property Intake Master — extended fields */}
          {listing.rawFields && <PropertyIntakeDetails fields={listing.rawFields} />}




          {/* Email Source Details */}
          {(listing.emailSubject || listing.from || listing.messageId) && (
            <div className="rounded-xl border border-border/60 bg-card/30 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                <Mail className="h-3.5 w-3.5" /> Email Source
              </h3>
              <div className="space-y-2 text-sm">
                {listing.emailSubject && (
                  <div>
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Subject</span>
                    <div className="font-medium mt-0.5">{listing.emailSubject}</div>
                  </div>
                )}
                {listing.from && (
                  <div>
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">From</span>
                    <div className="mt-0.5">{listing.from}</div>
                  </div>
                )}
                {listing.messageId && (
                  <div>
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Message ID</span>
                    <div className="font-mono text-xs mt-0.5 break-all">{listing.messageId}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="rounded-xl border border-border/60 bg-card/30 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Metadata</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              {listing.receivedAt && (
                <div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Received</span>
                  <div className="mt-0.5">{formatDate(listing.receivedAt)}</div>
                </div>
              )}
              {listing.createdTime && (
                <div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Created</span>
                  <div className="mt-0.5">{formatDate(listing.createdTime)}</div>
                </div>
              )}
              {listing.category && (
                <div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Category</span>
                  <div className="mt-0.5">{listing.category}</div>
                </div>
              )}
              {listing.hash && (
                <div>
                  <span className="text-xs text-muted-foreground uppercase tracking-wider">Hash</span>
                  <div className="font-mono text-xs mt-0.5 break-all">{listing.hash}</div>
                </div>
              )}
            </div>
          </div>
        </div>

          </div>
        </div>

        <EmailAgentDialog listing={listing} open={emailAgentOpen} onOpenChange={setEmailAgentOpen} />

        <InvestmentReportModal
          isOpen={investmentModalOpen}
          onClose={() => setInvestmentModalOpen(false)}
          propertyAddress={buildFullAddress(listing)}
          propertyDetails={{
            id: listing.id,
            price: listing.price,
            propertyType: listing.propertyType,
            beds: listing.beds,
            baths: listing.baths,
            carSpaces: listing.carSpaces,
            suburb: listing.suburb,
            state: listing.state,
            zipCode: listing.zipCode
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
