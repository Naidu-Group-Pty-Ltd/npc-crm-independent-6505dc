import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Bed, Bath, Building2, Car, CheckCircle2, ChevronLeft, ChevronRight,
  ExternalLink, HardHat, Image as ImageIcon, Inbox, Link2Off, Loader2, Sparkles, UserPlus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { SearchInput } from '@/components/ui/search-input';
import { useDebounce } from '@/hooks/useDebounce';
import { useToast } from '@/hooks/use-toast';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { cn } from '@/lib/utils';
import { StockPicture } from '@/components/stock/StockPicture';
import { readStockEmptyState } from '../../../supabase/functions/_shared/builderStock/mirrorAvailability.pure';
import {
  marketplaceStockImageUrl, useMarketplaceBuilderStock, useMarketplaceBuilders,
  useMarketplaceClientSearch, useSelectBuilderStockForClient,
} from '@/lib/marketplaceBuilderStock';
import {
  homeSizeDisplay,
  primaryStockImage, stockImageProvenance, STOCK_PROVENANCE_LABEL,
  SELECTABLE_AVAILABILITY, stockItemConfiguration, stockItemLocality,
  stockItemPrice, stockItemTitle, stockPlacementLabel,
  STOCK_AVAILABILITY_CLASSES, STOCK_AVAILABILITY_LABELS,
  STOCK_IMAGE_STAGE_BADGES, STOCK_IMAGE_STAGE_LABELS, STOCK_SELECTION_STATUS_LABELS,
  type BuilderStockImage, type BuilderStockItem, type StockAvailability,
} from '@/lib/builderStock';

/**
 * Property Marketplace — Builder Stock.
 *
 * Properties builders supplied through the Builders Network — served from the
 * `builder_network_stock_*` mirror since the portal moved off this deployment
 * (network extraction Phase 7), kept current by the network's stock sync —
 * and the place a Command Centre user ACTIVATES a builder for a client.
 * Activating writes the Command Centre's own selection record, and the
 * producer announces it over the network connection: the builder's team sees
 * the activation on their dashboard, in their tasks and in their
 * notifications, with this agency's contact details attached.
 *
 * Every card names the builder it came from, because the whole point of this
 * tab is that the property has an owner on the other side of the link.
 *
 * THE CARD SHOWS THE BUILDER'S OWN PHOTOGRAPH, OR NOTHING. Street View, a
 * satellite still and a search result are not photographs of the property, and
 * a card that shows one tells a client something untrue about a house they are
 * being asked to buy — so a property whose builder supplied no image gets the
 * empty state instead. The other stages are still recorded and still reported
 * in the source panel; they are simply never what the card draws.
 */

const STATE_OPTIONS = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

const AVAILABILITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All availability' },
  { value: 'available', label: 'Available' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'reserved', label: 'Reserved' },
  { value: 'contracted', label: 'Under contract' },
  { value: 'sold', label: 'Sold' },
  { value: 'unknown', label: 'Not stated' },
];

const SURFACE = 'min-w-0 rounded-[1.5rem] border border-border/60 bg-card/65 p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)] backdrop-blur supports-[backdrop-filter]:bg-card/55 sm:rounded-[1.85rem] sm:p-5 md:p-6 dark:border-white/10 dark:bg-background/35 dark:shadow-black/25';

export function BuilderStockTab() {
  const { toast } = useToast();
  const { canEdit: canEditClients } = useModulePermissions('clients');

  const [search, setSearch] = useState('');
  const [organisationId, setOrganisationId] = useState('all');
  const [availability, setAvailability] = useState('all');
  const [state, setState] = useState('all');
  const [page, setPage] = useState(1);
  const [selecting, setSelecting] = useState<BuilderStockItem | null>(null);
  const debounced = useDebounce(search, 300);

  useEffect(() => { setPage(1); }, [debounced, organisationId, availability, state]);

  const filters = useMemo(() => ({
    search: debounced.trim(),
    organisationId: organisationId === 'all' ? '' : organisationId,
    availability: availability === 'all' ? '' : availability,
    state: state === 'all' ? '' : state,
    page,
    pageSize: 24,
  }), [debounced, organisationId, availability, state, page]);

  const stockQuery = useMarketplaceBuilderStock(filters, true);
  const buildersQuery = useMarketplaceBuilders(true);

  const records = stockQuery.data?.records ?? [];
  const pagination = stockQuery.data?.pagination;
  const builders = buildersQuery.data?.records ?? [];
  const filtersApplied = Boolean(debounced)
    || organisationId !== 'all' || availability !== 'all' || state !== 'all';
  const emptyState = readStockEmptyState({
    filtersApplied,
    source: stockQuery.data?.source ?? null,
  });

  const disabled = (stockQuery.error as (Error & { code?: string }) | null)?.code
    === 'builder_stock_disabled';

  if (disabled) {
    return (
      <div className={SURFACE}>
        <div className="py-12 text-center">
          <HardHat className="mx-auto h-10 w-10 text-muted-foreground/50" aria-hidden />
          <p className="mt-3 text-sm font-semibold">Builder Stock is switched off</p>
          <p className="mt-1 text-xs text-muted-foreground">
            An administrator can enable it in Settings under
            “Show Builder Stock in Property Marketplace”.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className={cn(SURFACE, 'flex flex-col gap-3 lg:flex-row lg:items-center')}>
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search address, suburb, development or builder reference"
          aria-label="Search builder stock"
          containerClassName="flex-1"
        />
        <Select value={organisationId} onValueChange={setOrganisationId}>
          <SelectTrigger className="lg:w-56" aria-label="Filter by builder">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All builders</SelectItem>
            {builders.map((builder) => (
              <SelectItem key={builder.id} value={builder.id}>
                {builder.trading_name || builder.legal_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={availability} onValueChange={setAvailability}>
          <SelectTrigger className="lg:w-48" aria-label="Filter by availability">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AVAILABILITY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={state} onValueChange={setState}>
          <SelectTrigger className="lg:w-36" aria-label="Filter by state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            {STATE_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>{option}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {stockQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-72 rounded-2xl" />
          ))}
        </div>
      ) : stockQuery.isError ? (
        <div className={SURFACE}>
          <div className="py-12 text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-destructive/70" aria-hidden />
            <p className="mt-3 text-sm font-semibold">Builder stock could not be loaded</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {(stockQuery.error as Error).message}
            </p>
            <Button
              variant="outline" size="sm" className="mt-4"
              onClick={() => void stockQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        </div>
      ) : !records.length ? (
        /*
          WHICH absence this is. It used to read "No builder stock has been
          uploaded yet · Properties appear here when a builder uploads a stock
          list in their portal" for every empty result — a statement about
          BUILDERS made out of a fact about the LINK, pointing the reader at a
          deployment they cannot reach. See `mirrorAvailability.pure.ts`.
        */
        <div className={SURFACE}>
          <div className="py-12 text-center">
            {emptyState.actionable ? (
              <Link2Off className="mx-auto h-10 w-10 text-warning/70" aria-hidden />
            ) : (
              <Inbox className="mx-auto h-10 w-10 text-muted-foreground/50" aria-hidden />
            )}
            <p className="mt-3 text-sm font-semibold">{emptyState.title}</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
              {emptyState.detail}
            </p>
          </div>
        </div>
      ) : (
        <>
          {stockQuery.data?.ranked === false && (
            /*
              The ranking migration has not reached this deployment, so the
              order is `created_at DESC` and means nothing. Said plainly rather
              than letting an arbitrary order read as a considered one — and
              only when the server actually said so, never inferred.
            */
            <p className="text-xs text-muted-foreground">
              Listed newest first. Builder ranking is not enabled on this
              workspace, so the order does not reflect builder merit.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {records.map((item) => (
              <StockCard
                key={item.id}
                item={item}
                canSelect={canEditClients}
                onSelect={() => setSelecting(item)}
              />
            ))}
          </div>

          {pagination && pagination.total_pages > 1 ? (
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Page {pagination.page} of {pagination.total_pages} · {pagination.total} properties
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline" size="sm" disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                  Previous
                </Button>
                <Button
                  variant="outline" size="sm"
                  disabled={page >= pagination.total_pages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <ActivateBuilderDialog
        item={selecting}
        onClose={() => setSelecting(null)}
        onSelected={(alreadySelected) => {
          toast({
            title: alreadySelected
              ? 'Already activated for this client'
              : 'Builder activated',
            description: alreadySelected
              ? 'This property was already activated for that client.'
              : 'The activation is recorded against the client and the builder is being notified in their portal.',
          });
          setSelecting(null);
          void stockQuery.refetch();
        }}
      />
    </div>
  );
}

function StockCard({
  item, canSelect, onSelect,
}: {
  item: BuilderStockItem;
  canSelect: boolean;
  onSelect: () => void;
}) {
  const image = primaryStockImage(item);
  const price = stockItemPrice(item);
  const configuration = stockItemConfiguration(item);
  // Whole square metres on the card; the column keeps every digit it was given.
  const homeSize = homeSizeDisplay(item.building_size_sqm);
  const locality = stockItemLocality(item);
  const builder = item.builder_organisation;
  const availabilityStatus = item.availability_status as StockAvailability;
  const selection = item.selections?.[0] ?? null;
  const selectable = SELECTABLE_AVAILABILITY.has(availabilityStatus);
  const placement = stockPlacementLabel(item);

  return (
    <Card className="flex flex-col overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-[0_10px_30px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-background/80">
      <StockCardImage image={image} />
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{stockItemTitle(item)}</p>
          {locality ? <p className="truncate text-xs text-muted-foreground">{locality}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={cn('font-medium', STOCK_AVAILABILITY_CLASSES[availabilityStatus])}
          >
            {STOCK_AVAILABILITY_LABELS[availabilityStatus]}
          </Badge>
          {selection ? (
            <Badge variant="outline" className="border-primary/30 bg-primary/10 font-medium text-primary">
              <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
              {STOCK_SELECTION_STATUS_LABELS[selection.status]}
            </Badge>
          ) : null}
          {/*
            * WHERE A POSITION WAS NOT DECIDED BY MERIT, THE CARD SAYS SO.
            *
            * An adviser reads this list and then recommends what is on it to a
            * client, so a property a builder paid to place — or that an
            * operator pinned — carries a label where that decision is read.
            * `rank_disclose` is set on the network, once, so the prime and
            * every clone cannot disagree about whether a position was bought;
            * the card cannot suppress it and there is no prop to turn it off.
            *
            * A chip with nothing to state is not drawn, rather than drawn
            * empty — an ordinary listing gets no badge at all.
            */}
          {placement ? (
            <Badge
              variant="outline"
              className="border-warning/40 bg-warning/10 font-medium text-warning"
              title="This builder's placement in the marketplace was arranged rather than earned by ranking."
            >
              <Sparkles className="mr-1 h-3 w-3" aria-hidden />
              {placement}
            </Badge>
          ) : null}
        </div>

        <div className="text-sm">
          {price ? <p className="font-semibold">{price}</p> : (
            <p className="text-muted-foreground">Price not stated</p>
          )}
          {configuration ? (
            <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {item.bedrooms !== null && item.bedrooms !== undefined ? (
                <span className="inline-flex items-center gap-1"><Bed className="h-3.5 w-3.5" aria-hidden />{item.bedrooms}</span>
              ) : null}
              {item.bathrooms !== null && item.bathrooms !== undefined ? (
                <span className="inline-flex items-center gap-1"><Bath className="h-3.5 w-3.5" aria-hidden />{item.bathrooms}</span>
              ) : null}
              {item.car_spaces !== null && item.car_spaces !== undefined ? (
                <span className="inline-flex items-center gap-1"><Car className="h-3.5 w-3.5" aria-hidden />{item.car_spaces}</span>
              ) : null}
              {/*
                The house and the land are both square metres and they are not
                the same number: two packages on one lot differ by the house
                and share the land, which is why the title used to carry an
                unlabelled `140 m²` while this row read `286 m² land`. Both
                are labelled now, and the title carries neither.
              */}
              {homeSize !== null ? <span>{homeSize} m² home</span> : null}
              {item.land_size_sqm ? <span>{item.land_size_sqm} m² land</span> : null}
            </p>
          ) : null}
        </div>

        {/* The builder is not decoration: it is the other end of the link. */}
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2 text-xs">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium">
            {builder ? (builder.trading_name || builder.legal_name) : 'Builder not resolved'}
          </span>
          {item.external_reference ? (
            <span className="shrink-0 text-muted-foreground">Ref {item.external_reference}</span>
          ) : null}
        </div>

        <div className="mt-auto pt-1">
          <Button
            size="sm"
            className="w-full"
            disabled={!canSelect || !selectable}
            onClick={onSelect}
          >
            <UserPlus className="mr-2 h-4 w-4" aria-hidden />
            {selectable ? 'Activate builder' : 'Not available'}
          </Button>
          {!canSelect ? (
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
              Client edit permission is required to activate a builder.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The marketplace card's picture.
 *
 * THE TREATMENT MOVED, THE BADGE STAYED. Everything about how a picture sits
 * in its frame — the 16:9 shape, `cardPictureFit`'s cover-vs-contain rule,
 * the blurred own-ground for a contained picture, measure-on-mount-as-well-
 * as-load — is now `StockPicture`, because the Builder portal needed to draw
 * the same photograph and a second copy of this logic is how one of them
 * comes to show a grey band again.
 *
 * What stays here is what is particular to THIS card: the provenance badge,
 * and the link out to a web source. The transport stays here too —
 * `marketplaceStockImageUrl` signs on the Command Centre's authorisation,
 * where the portal signs on the builder's.
 *
 * THE BADGE IS DERIVED FROM THE SAME DECISION THAT PICKED THE IMAGE.
 * `stockImageProvenance` is the client mirror of the server's ranking, so a
 * card cannot say "Builder supplied" over a picture the ranking took from a
 * web search or from Street View. That is the whole reason a fallback is
 * allowed to reach a card at all: it is shown as what it is.
 */
function StockCardImage({ image }: {
  image: BuilderStockImage | null;
}) {
  const provenance = image ? stockImageProvenance(image) : null;
  const fallback = provenance === 'web_sourced' || provenance === 'street_view';

  return (
    <StockPicture
      image={image}
      resolveUrl={marketplaceStockImageUrl}
      className="border-b border-border/60"
      alt={image ? STOCK_IMAGE_STAGE_LABELS[image.source_stage] : ''}
      emptyLabel="No image found"
      emptyAction={(
        /*
          "Add a picture" used to sit here — staff supplying imagery on the
          builder's behalf. That act wrote the portal's image pipeline, which
          retired with the portal (network extraction Phase 7): imagery is the
          builder's own to manage on the Builders Network, and the marketplace
          serves what the network delivers. A disclosure replaces the control,
          because a button that can only fail is worse than none.
        */
        <span className="mt-2 block text-[11px] text-muted-foreground">
          The builder manages photographs on the Builders Network.
        </span>
      )}
      overlay={image ? (
        <>
          <span
            className={cn(
              'absolute left-2 top-2 z-20 rounded-full border px-2 py-0.5 text-[10px] font-semibold backdrop-blur',
              fallback
                ? 'border-warning/40 bg-warning/15 text-warning'
                : 'border-border/60 bg-background/80 text-foreground',
            )}
          >
            {provenance
              ? STOCK_PROVENANCE_LABEL[provenance]
              : STOCK_IMAGE_STAGE_BADGES[image.source_stage]}
          </span>
          {fallback && image.source_page_url ? (
            <a
              href={image.source_page_url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="absolute bottom-2 right-2 z-20 inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/80 px-2 py-0.5 text-[10px] font-medium backdrop-blur hover:bg-background"
            >
              Source
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : null}
        </>
      ) : undefined}
    />
  );
}

function ActivateBuilderDialog({
  item, onClose, onSelected,
}: {
  item: BuilderStockItem | null;
  onClose: () => void;
  onSelected: (alreadySelected: boolean) => void;
}) {
  const { toast } = useToast();
  const [clientSearch, setClientSearch] = useState('');
  const [clientId, setClientId] = useState('');
  const [notes, setNotes] = useState('');
  const debounced = useDebounce(clientSearch, 300);

  const clientsQuery = useMarketplaceClientSearch(debounced.trim(), !!item);
  const selectMutation = useSelectBuilderStockForClient();

  useEffect(() => {
    if (!item) { setClientSearch(''); setClientId(''); setNotes(''); }
  }, [item]);

  const clients = clientsQuery.data?.records ?? [];

  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Activate builder</DialogTitle>
          <DialogDescription>
            {item ? stockItemTitle(item) : ''}
            {item?.builder_organisation ? (
              <>
                {' — supplied by '}
                {item.builder_organisation.trading_name || item.builder_organisation.legal_name}.
              </>
            ) : null}
            {' '}The activation is recorded for your client and the builder is
            notified in their portal — their team sees it on their dashboard,
            in their tasks and in their notifications, with your contact
            details so they can respond.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="builder-stock-client-search">Find a client</Label>
            <Input
              id="builder-stock-client-search"
              value={clientSearch}
              onChange={(event) => setClientSearch(event.target.value)}
              placeholder="Search by name or email"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="builder-stock-client">Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="builder-stock-client">
                <SelectValue placeholder={clientsQuery.isLoading ? 'Loading…' : 'Choose a client'} />
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.primary_first_name} {client.primary_surname}
                    {client.primary_email ? ` · ${client.primary_email}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!clientsQuery.isLoading && !clients.length ? (
              <p className="text-xs text-muted-foreground">
                No clients matched. Try a different search.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="builder-stock-notes">Internal note (optional)</Label>
            <Textarea
              id="builder-stock-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Why this property suits the client"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Kept in the Command Centre. The builder never sees it.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!clientId || selectMutation.isPending}
            onClick={() => {
              if (!item || !clientId) return;
              selectMutation.mutate(
                { stockItemId: item.id, clientId, notes: notes.trim() || undefined },
                {
                  onSuccess: (result) => onSelected(!!result.already_selected),
                  onError: (error) => toast({
                    title: 'The property could not be selected',
                    description: (error as Error).message,
                    variant: 'destructive',
                  }),
                },
              );
            }}
          >
            {selectMutation.isPending
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              : <UserPlus className="mr-2 h-4 w-4" aria-hidden />}
            Activate builder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BuilderStockTab;
