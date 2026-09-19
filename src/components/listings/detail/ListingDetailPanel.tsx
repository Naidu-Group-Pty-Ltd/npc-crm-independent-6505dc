import { useMemo } from 'react';
import {
  AlertTriangle,
  Bath,
  Bed,
  Building2,
  Calendar,
  Car,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Maximize2,
  Phone,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { PropertyListing } from '@/lib/airtable';
import { formatArea, formatLocality } from '@/lib/listingDisplay';
import { StreetViewPanel } from '@/components/listings/StreetViewPanel';
import type { ListingEnrichment } from '@/hooks/useListingRecord';

const SPEC_TILE =
  'rounded-xl border border-border/60 bg-background/60 p-3 text-center dark:border-white/10';

export interface ListingDetailPanelProps {
  listing: PropertyListing;
  enrichment?: ListingEnrichment | null;
  point?: { lat: number; lng: number } | null;
  /** Suburb comparison, computed from this corpus. Hidden when too thin to mean anything. */
  market?: MarketContext | null;
  className?: string;
}

export interface MarketContext {
  suburb: string;
  propertyType: string | null;
  sampleSize: number;
  median: number | null;
  low: number | null;
  high: number | null;
}

/**
 * Everything known about one listing, in tabs.
 *
 * Extracted from the page so the same body can be docked beside the map later
 * without the two drifting apart.
 *
 * The governing rule is that a section which has nothing to say does not
 * appear. Most records here are genuinely incomplete — 45% have no agency, a
 * third no bedroom count, 19% an inspection time — and a page of empty labelled
 * boxes reads as broken software rather than as incomplete data. What it does
 * show, it explains: the Provenance tab exists so a reader can see where a value
 * came from and how confident anything was about it.
 */
export function ListingDetailPanel({
  listing,
  enrichment,
  point,
  market,
  className,
}: ListingDetailPanelProps) {
  const specs = useMemo(
    () =>
      [
        { label: 'Bedrooms', value: listing.beds ?? listing.bedrooms, icon: Bed },
        { label: 'Bathrooms', value: listing.baths ?? listing.bathrooms, icon: Bath },
        { label: 'Car spaces', value: listing.carSpaces, icon: Car },
        { label: 'Land', value: formatArea(listing.landSizeSqm), icon: Maximize2 },
        { label: 'Building', value: formatArea(listing.buildingAreaSqm), icon: Building2 },
        { label: 'Floor', value: formatArea(listing.floorAreaSqm), icon: Building2 },
      ].filter((spec) => spec.value !== null && spec.value !== undefined && spec.value !== ''),
    [listing],
  );

  const hasAgent = Boolean(
    listing.agentName || listing.agencyName || listing.agentMobile || listing.agentEmail,
  );
  const hasInspection = Boolean(
    listing.inspectionStart || listing.nextInspectionDate || listing.inspectionRawText,
  );
  const showMarket = Boolean(market && market.sampleSize >= 5);

  return (
    <Tabs defaultValue="overview" className={cn('w-full', className)}>
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="location">Location</TabsTrigger>
        {showMarket && <TabsTrigger value="market">Market</TabsTrigger>}
        <TabsTrigger value="provenance">Provenance</TabsTrigger>
      </TabsList>

      {/* ---------------------------------------------------------------- */}
      <TabsContent value="overview" className="space-y-5 pt-4">
        {specs.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {specs.map(({ label, value, icon: Icon }) => (
              <div key={label} className={SPEC_TILE}>
                <Icon className="mx-auto mb-1 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <p className="text-base font-semibold tabular-nums text-foreground">{value}</p>
                <p className="text-[11px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        )}

        <ChipRow
          items={[
            ['Type', listing.propertyType],
            ['Sector', listing.sector],
            ['Intent', listing.intent],
            ['Category', listing.category],
            ['Package', listing.packageType],
            ['Contract', listing.contractType],
            ['Status', listing.listingStatus],
            ['Sale method', listing.saleMethod],
            ['GST', listing.gstApplicable],
            ['Estate', listing.estateName],
            ['Builder', listing.builderDeveloper],
            ['Zoning', listing.zoning],
          ]}
        />

        {listing.description && (
          <Section title="Description">
            <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {listing.description}
            </p>
          </Section>
        )}

        {hasAgent && (
          <Section title="Agent">
            <div className="space-y-1.5 text-sm">
              {listing.agentName && <p className="font-medium text-foreground">{listing.agentName}</p>}
              {listing.agencyName && <p className="text-muted-foreground">{listing.agencyName}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                {(listing.agentMobile || listing.agentPhone) && (
                  <Button asChild size="sm" variant="outline">
                    <a href={`tel:${(listing.agentMobile ?? listing.agentPhone)!.replace(/\s/g, '')}`}>
                      <Phone className="mr-1.5 h-3.5 w-3.5" />
                      {listing.agentMobile ?? listing.agentPhone}
                    </a>
                  </Button>
                )}
                {listing.agentEmail && (
                  <Button asChild size="sm" variant="outline">
                    <a href={`mailto:${listing.agentEmail}`}>
                      <Mail className="mr-1.5 h-3.5 w-3.5" />
                      Email
                    </a>
                  </Button>
                )}
                {listing.agencyWebsite && (
                  <Button asChild size="sm" variant="outline">
                    <a href={listing.agencyWebsite} target="_blank" rel="noopener noreferrer">
                      <Globe className="mr-1.5 h-3.5 w-3.5" />
                      Agency site
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </Section>
        )}

        {hasInspection && (
          <Section title="Inspection">
            <div className="space-y-1 text-sm text-muted-foreground">
              {listing.inspectionStart && (
                <p className="flex items-center gap-1.5 font-medium text-foreground">
                  <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                  {new Date(listing.inspectionStart).toLocaleString('en-AU', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              )}
              {listing.inspectionRawText && <p>{listing.inspectionRawText}</p>}
              {listing.inspectionNotes && <p>{listing.inspectionNotes}</p>}
            </div>
          </Section>
        )}

        {listing.features && listing.features.length > 0 && (
          <Section title="Features">
            <div className="flex flex-wrap gap-1.5">
              {listing.features.map((feature) => (
                <Badge key={feature} variant="outline" className="rounded-full">
                  {feature}
                </Badge>
              ))}
            </div>
          </Section>
        )}
      </TabsContent>

      {/* ---------------------------------------------------------------- */}
      <TabsContent value="location" className="space-y-4 pt-4">
        <div className="space-y-1">
          <p className="flex items-start gap-1.5 text-sm font-medium text-foreground">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {listing.fullAddress ?? listing.address ?? 'Address not extracted'}
          </p>
          <p className="pl-6 text-sm text-muted-foreground">
            {formatLocality(listing) ?? 'Locality unknown'}
          </p>
        </div>

        {listing.localityTrust === 'conflict' && (
          <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <div>
              <p className="font-medium text-foreground">State and postcode disagree</p>
              <p className="text-xs text-muted-foreground">
                {listing.localityConflicts?.[0] ??
                  'Both were dropped rather than guessing which is right.'}{' '}
                The suburb is still used for mapping.
              </p>
            </div>
          </div>
        )}

        {point ? (
          <StreetViewPanel lat={point.lat} lng={point.lng} label={listing.address ?? undefined} />
        ) : (
          <p className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
            No coordinate resolved for this listing yet.
          </p>
        )}
      </TabsContent>

      {/* ---------------------------------------------------------------- */}
      {showMarket && market && (
        <TabsContent value="market" className="space-y-4 pt-4">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Median" value={money(market.median)} />
            <Stat label="Lowest" value={money(market.low)} />
            <Stat label="Highest" value={money(market.high)} />
          </div>
          {/*
            Deliberately not called a valuation. There are no comparable sales in
            this dataset — only other listings that arrived by email — so the
            honest claim is "here is what else we have seen in this suburb", and
            it is labelled with the sample it is drawn from.
          */}
          <p className="text-xs text-muted-foreground">
            Based on {market.sampleSize} other {market.propertyType?.toLowerCase() ?? 'propert'}
            {market.propertyType ? ' listings' : 'ies'} in {market.suburb} currently in this
            dataset. Not a valuation — these are asking prices from listings we received, not
            recorded sales.
          </p>
        </TabsContent>
      )}

      {/* ---------------------------------------------------------------- */}
      <TabsContent value="provenance" className="space-y-5 pt-4">
        <Section title="Extraction confidence">
          <div className="space-y-2">
            {(
              [
                ['Overall quality', listing.confidences?.overall],
                ['Extraction', listing.confidences?.extraction],
                ['Address', listing.confidences?.address],
                ['Price', listing.confidences?.price],
                ['Specs', listing.confidences?.specs],
                ['Agent details', listing.confidences?.agent],
              ] as Array<[string, number | null | undefined]>
            )
              .filter(([, value]) => value !== null && value !== undefined)
              .map(([label, value]) => (
                <div key={label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-semibold tabular-nums text-foreground">
                      {Math.round((value as number) * 100)}%
                    </span>
                  </div>
                  <Progress value={(value as number) * 100} className="h-1.5" />
                </div>
              ))}
          </div>
        </Section>

        {(listing.needsHumanReview || listing.errorType || listing.humanReviewNotes) && (
          <Section title="Flagged by the pipeline">
            <div className="space-y-1.5 text-sm">
              {listing.errorType && (
                <Badge variant="outline" className="border-warning/40 text-warning">
                  {listing.errorType}
                </Badge>
              )}
              {listing.errorMessage && (
                <p className="text-muted-foreground">{listing.errorMessage}</p>
              )}
              {listing.humanReviewNotes && (
                <p className="text-muted-foreground">{listing.humanReviewNotes}</p>
              )}
            </div>
          </Section>
        )}

        {enrichment && Object.keys(enrichment.values ?? {}).length > 0 && (
          <Section title="Filled in by enrichment">
            {/*
              What the intake pipeline missed and where the replacement came
              from. Worth surfacing rather than blending silently into the record:
              a scraped bedroom count and one an agent typed are not the same
              claim, and anyone acting on the number deserves to know which it is.
            */}
            <div className="space-y-1.5 text-xs">
              {Object.entries(enrichment.values)
                .filter(([field]) => field !== 'imageUrls')
                .map(([field, value]) => {
                  const source = enrichment.provenance?.[field];
                  return (
                    <div key={field} className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground">{humanise(field)}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-medium tabular-nums text-foreground">
                          {String(value).slice(0, 60)}
                        </span>
                        {source && (
                          <Badge variant="outline" className="rounded-full text-[10px]">
                            {source.src} · {Math.round(source.conf * 100)}%
                          </Badge>
                        )}
                      </span>
                    </div>
                  );
                })}
            </div>
          </Section>
        )}

        <Section title="Source">
          <div className="space-y-2 text-sm">
            <Row label="Arrived as" value={listing.sourceType} />
            <Row label="From" value={listing.senderName ?? listing.senderEmail} />
            <Row label="Processing stage" value={listing.processingStage} />
            <Row label="Record status" value={listing.recordStatus} />
            <Row
              label="First seen"
              value={
                listing.listedAtKnown === false
                  ? 'Date unknown'
                  : listing.createdTime
                    ? new Date(listing.createdTime).toLocaleString('en-AU')
                    : null
              }
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {listing.url && (
                <Button asChild size="sm" variant="outline">
                  <a href={listing.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                    Source listing
                  </a>
                </Button>
              )}
              {typeof enrichment?.values?.resolvedUrl === 'string' &&
                enrichment.values.resolvedUrl !== listing.url && (
                  <Button asChild size="sm" variant="outline">
                    <a
                      href={enrichment.values.resolvedUrl as string}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                      Resolved link
                    </a>
                  </Button>
                )}
            </div>
          </div>
        </Section>

        {listing.rawExtract && (
          <Section title="Raw source text">
            <ScrollArea className="h-40 rounded-lg border border-border/60 bg-muted/30 p-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                {listing.rawExtract}
              </pre>
            </ScrollArea>
          </Section>
        )}
      </TabsContent>
    </Tabs>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground/85">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-sm text-foreground">{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={SPEC_TILE}>
      <p className="text-base font-semibold tabular-nums text-foreground">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function ChipRow({ items }: { items: Array<[string, string | null | undefined]> }) {
  const present = items.filter(([, value]) => Boolean(value));
  if (present.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {present.map(([label, value]) => (
        <Badge key={label} variant="outline" className="rounded-full font-normal">
          <span className="text-muted-foreground">{label}:</span>
          <span className="ml-1 font-medium text-foreground">{value}</span>
        </Badge>
      ))}
    </div>
  );
}

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
});

function money(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '—' : AUD.format(value);
}

/** `landSizeSqm` → `Land size sqm`. */
function humanise(field: string): string {
  const spaced = field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export default ListingDetailPanel;
