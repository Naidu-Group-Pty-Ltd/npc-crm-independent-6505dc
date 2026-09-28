import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Building2, CheckCircle2, ExternalLink, FileText, HardHat,
  LayoutGrid, Map as MapIcon, Ruler, UserPlus,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { BuilderStockGallery } from '@/components/listings/BuilderStockGallery';
import { ActivateBuilderDialog } from '@/components/listings/BuilderStockTab';
import { BuilderStockConversations } from '@/components/listings/BuilderStockConversation';
import { useToast } from '@/hooks/use-toast';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import {
  homeSizeDisplay, primaryStockImage, SELECTABLE_AVAILABILITY, stockItemLocality,
  stockItemPrice, stockItemTitle, STOCK_AVAILABILITY_CLASSES, STOCK_AVAILABILITY_LABELS,
  STOCK_SELECTION_STATUS_LABELS,
  type StockAvailability, type StockSelectionStatus,
} from '@/lib/builderStock';
import {
  useMarketplaceStockItem, type MarketplaceStockDocument,
} from '@/lib/marketplaceBuilderStock';
import { cn } from '@/lib/utils';

/**
 * A BUILDER PROPERTY, AT ITS OWN ADDRESS.
 *
 * `/listings/builder-stock/:stockItemId` — reached from a Builder Stock card,
 * from a stock pin on the map, or from a link somebody pasted. It reads the
 * one existing single-property operation, `get_stock_item`, and states only
 * what the Builders Network and the Command Centre hold: the builder's
 * figures, the photographs and documents the builder published, and the
 * activation record. Nothing on it is composed by a model.
 *
 * The gate is the server's. The route sits behind the Listings module like
 * the marketplace, the operation re-checks that permission and the feature
 * flag, and a client is named in the activation record only where the Clients
 * module admits the reader — the page renders what it is given.
 */

const DOCUMENT_ICON: Record<MarketplaceStockDocument['kind'], typeof FileText> = {
  brochure: FileText,
  floor_plan: LayoutGrid,
  site_plan: Ruler,
  estate: MapIcon,
  other: FileText,
};

const DOCUMENT_KIND_LABEL: Record<MarketplaceStockDocument['kind'], string> = {
  brochure: 'Brochure',
  floor_plan: 'Floor plan',
  site_plan: 'Siting / plan',
  estate: 'Estate',
  other: 'Document',
};

const when = (iso: string | null | undefined) => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

export default function BuilderStockProperty() {
  const { stockItemId = '' } = useParams<{ stockItemId: string }>();
  const { toast } = useToast();
  const { canEdit: canEditClients } = useModulePermissions('clients');
  const [activating, setActivating] = useState(false);
  const query = useMarketplaceStockItem(stockItemId);
  const detail = query.data ?? null;
  const item = detail?.record ?? null;
  /*
   * A FRONTEND CAN BE PUBLISHED AHEAD OF ITS FUNCTION. Until the deployment's
   * `get_stock_item` returns them, these are absent rather than empty — so the
   * page reads them as "nothing yet": the gallery falls back to the card's own
   * picture, and no document or activation is listed.
   */
  const photos = detail?.photos ?? [];
  const documents = detail?.documents ?? [];
  const activations = detail?.activations ?? [];

  const back = (
    <Button asChild variant="ghost" size="sm" className="-ml-2 rounded-full">
      <Link to="/listings?section=builder-stock">
        <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden />Builder Stock
      </Link>
    </Button>
  );

  if (query.isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="aspect-[16/9] w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    );
  }

  if (!item) {
    const code = (query.error as (Error & { code?: string }) | null)?.code;
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
        {back}
        <Card>
          <CardContent className="py-10 text-center">
            {code === 'builder_stock_disabled'
              ? <HardHat className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
              : <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-warning" aria-hidden />}
            <h1 className="text-lg font-semibold text-foreground">
              {code === 'builder_stock_disabled'
                ? 'Builder Stock is switched off for this workspace'
                : 'This property is not available'}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {code === 'builder_stock_disabled'
                ? 'An administrator can turn it on.'
                : 'It may have been withdrawn by the builder, or the link may be wrong.'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const title = stockItemTitle(item);
  const locality = stockItemLocality(item);
  const price = stockItemPrice(item);
  const homeSize = homeSizeDisplay(item.building_size_sqm);
  const landSize = homeSizeDisplay(item.land_size_sqm);
  const builder = item.builder_organisation;
  const builderName = builder ? (builder.trading_name || builder.legal_name) : null;
  const availability = item.availability_status as StockAvailability;
  // A property the builder stopped listing is kept readable for its history;
  // it cannot be activated again.
  const delisted = (item.lifecycle_status ?? 'active') !== 'active';
  const selectable = !delisted && SELECTABLE_AVAILABILITY.has(availability);
  const estate = item.development_name || item.project_name;
  const synced = when(item.last_seen_at);
  const figure = (value: number | null | undefined) =>
    value === null || value === undefined ? null : String(value);

  const facts: Array<[string, ReactNode | null]> = [
    ['Price', price],
    ['Lot', item.lot_number ? String(item.lot_number) : null],
    ['Address', item.address_line || null],
    ['Suburb', locality || null],
    ['Estate', estate || null],
    ['Design', item.house_design || null],
    ['Bedrooms', figure(item.bedrooms)],
    ['Bathrooms', figure(item.bathrooms)],
    ['Car spaces', figure(item.car_spaces)],
    ['Home size', homeSize !== null ? `${homeSize} m²` : null],
    ['Land size', landSize !== null ? `${landSize} m²` : null],
    ['Completion / titles', item.expected_completion || null],
    ['Builder reference', item.external_reference || null],
  ];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      {back}

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn('font-medium', STOCK_AVAILABILITY_CLASSES[availability])}>
            {STOCK_AVAILABILITY_LABELS[availability] ?? 'Not stated'}
          </Badge>
          {delisted ? (
            <Badge variant="outline" className="font-medium text-muted-foreground">No longer listed by the builder</Badge>
          ) : null}
          {activations.some((a) => a.status !== 'withdrawn') ? (
            <Badge variant="outline" className="border-primary/30 bg-primary/10 font-medium text-primary">
              <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />Activated
            </Badge>
          ) : null}
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        {locality ? <p className="text-sm text-muted-foreground">{locality}</p> : null}
      </header>

      {/*
        Three blocks, not two columns: on a phone the price and the Activate
        action follow the gallery directly rather than sitting below the
        documents; from `lg` the facts take the right-hand column beside both.
      */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:items-start">
        <div className="order-1 min-w-0 lg:order-none lg:col-start-1 lg:row-start-1">
          <BuilderStockGallery
            photos={photos}
            fallback={primaryStockImage(item)}
            alt={title}
          />
        </div>

        <div className="order-3 min-w-0 space-y-5 lg:order-none lg:col-start-1 lg:row-start-2">
          <BuilderStockConversations stockItemId={item.id} builderName={builderName} />

          {item.description ? (
            <Card>
              <CardHeader><CardTitle className="text-base">About this property</CardTitle></CardHeader>
              <CardContent>
                <p className="whitespace-pre-line text-sm leading-6 text-foreground">{item.description}</p>
              </CardContent>
            </Card>
          ) : null}

          {documents.length ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Builder documents</CardTitle></CardHeader>
              <CardContent>
                <ul aria-label="Documents" className="grid gap-2 sm:grid-cols-2">
                  {documents.map((document) => {
                    const Icon = DOCUMENT_ICON[document.kind] ?? FileText;
                    return (
                      <li key={document.key}>
                        <a
                          href={document.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{document.label}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {DOCUMENT_KIND_LABEL[document.kind]}
                          </span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="sr-only">(opens in a new tab)</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  The builder&apos;s own links, as filed on their stock list.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="order-2 min-w-0 space-y-5 lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Card>
            <CardHeader className="space-y-1">
              {price ? <p className="text-2xl font-semibold text-foreground">{price}</p> : (
                <p className="text-sm text-muted-foreground">Price not stated</p>
              )}
              {builderName ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Building2 className="h-4 w-4 text-primary" aria-hidden />
                  <span className="font-medium text-foreground">{builderName}</span>
                </p>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                {facts.filter(([label, value]) => value !== null && label !== 'Price').map(([label, value]) => (
                  <Fact key={label} label={label}>{value}</Fact>
                ))}
              </dl>
              <div>
                <Button
                  className="w-full"
                  disabled={!canEditClients || !selectable}
                  onClick={() => setActivating(true)}
                >
                  <UserPlus className="mr-2 h-4 w-4" aria-hidden />
                  {selectable ? 'Activate builder' : 'Not available'}
                </Button>
                {!canEditClients ? (
                  <p className="mt-1.5 text-center text-xs text-muted-foreground">
                    Client edit permission is required to activate a builder.
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <section aria-labelledby="activation-heading">
              <CardHeader>
                <CardTitle id="activation-heading" className="text-base">Activation</CardTitle>
              </CardHeader>
              <CardContent>
                {activations.length ? (
                  <ol className="space-y-3">
                    {activations.map((activation) => (
                      <li key={activation.id} className="rounded-lg border border-border/60 p-3 text-sm">
                        <p className="font-medium text-foreground">
                          {STOCK_SELECTION_STATUS_LABELS[activation.status as StockSelectionStatus] ?? activation.status}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {[
                            activation.activated_by ? `Activated by ${activation.activated_by}` : 'Activated',
                            when(activation.selected_at),
                          ].filter(Boolean).join(' · ')}
                        </p>
                        {activation.client ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            For <span className="font-medium text-foreground">{activation.client.name}</span>
                          </p>
                        ) : null}
                        {activation.acknowledged_at ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Acknowledged by the builder · {when(activation.acknowledged_at)}
                          </p>
                        ) : null}
                        {activation.withdrawn_at ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Withdrawn · {when(activation.withdrawn_at)}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">Not activated for any client yet.</p>
                )}
              </CardContent>
            </section>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Where this comes from</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-xs text-muted-foreground">
              <p>
                Supplied by {builderName ?? 'the builder'} through the Builders Network. The figures,
                photographs and documents are the builder&apos;s own.
              </p>
              {synced ? <p>Last synced {synced}.</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <ActivateBuilderDialog
        item={activating ? item : null}
        onClose={() => setActivating(false)}
        onSelected={(alreadySelected) => {
          toast({
            title: alreadySelected ? 'Already activated for this client' : 'Builder activated',
            description: alreadySelected
              ? 'This property was already activated for that client.'
              : 'The activation is recorded against the client and the builder is being notified in their portal.',
          });
          setActivating(false);
          void query.refetch();
        }}
      />
    </div>
  );
}
