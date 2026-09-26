import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react';
import type { ElementType, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearch } from '@/contexts/SearchContext';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { Search, Download, Bed, Bath, Car, X, FileText, RefreshCw, Loader2, Building2, CalendarCheck, AlertTriangle, EyeOff, HardHat, LayoutGrid, FilterX, Inbox, Database, Map as MapIcon, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchInput } from '@/components/ui/search-input';
import { ConfidenceBadge } from '@/components/dashboard/ConfidenceBadge';
import { ListingFilters } from '@/components/listings/ListingFilters';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { lazyWithRetry } from '@/lib/lazyWithRetry';
import { reloadForFreshBuild } from '@/lib/chunkReload';
import { MobileFilterSheet } from '@/components/listings/MobileFilterSheet';
import { PropertyCard } from '@/components/listings/PropertyCard';
import { ListingGalleryGrid } from '@/components/listings/ListingGalleryGrid';
import { ListingThumbnail } from '@/components/listings/ListingThumbnail';
import { useListingImages } from '@/hooks/useListingImages';
import { useListingCoordinates } from '@/hooks/useListingCoordinates';
import { useBuilderStockMarketplaceFlag } from '@/hooks/useBuilderStockMarketplaceFlag';
import { useBuilderStockMapListings } from '@/hooks/useBuilderStockMapListings';
import { builderStockIdFromMapId } from '@/lib/builderStockMapPoint';

/**
 * Builder Stock is a separate chunk: the Property Marketplace must not carry
 * the weight of a tab most deployments have switched off.
 */
const BuilderStockTab = lazyWithRetry(
  () => import('@/components/listings/BuilderStockTab').then((m) => ({ default: m.BuilderStockTab })),
);

/**
 * Stable identity for "resolve nothing".
 *
 * `useListingCoordinates` keys its pass off the payload signature, and a fresh
 * `[]` on every render would restart it continuously while the reader is on any
 * view other than the gallery.
 */
const EMPTY_LISTINGS: PropertyListing[] = [];
import {
  DEFAULT_LISTING_FILTERS,
  activeListingFilterCount,
  listingHasPhotos,
  matchesListingFilters,
  type ListingFilterState,
} from '@/lib/listingFilters';
import { displayPrice, formatLocality, qualityCaveat } from '@/lib/listingDisplay';
import { listingContact } from '@/lib/listingContact';
import { propertyDataService } from '@/services/propertyDataService';
import { PropertyListing } from '@/lib/airtable';
import { BulkActionBar } from '@/components/aurixa';



import { buildFullAddress, extractAUState, extractAUPostcode } from '@/lib/addressUtils';
import { buildListingFacets } from '@/lib/listings/listingFacets.pure';
import { hasListingUrl, openListingUrl } from '@/lib/listings/listingLinks.pure';
import { getNearbySuburbs } from '@/lib/postcodeProximity';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { ReportActionMenu } from '@/components/reports/ReportActionMenu';
import { useReportPreferences, type ReportScope, type ReportTier } from '@/hooks/useReportPreferences';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { builderStockPropertyPath } from '@/lib/marketplaceBuilderStock';
import { ListingRowContextMenu } from '@/components/listings/ListingRowContextMenu';
import { cn } from '@/lib/utils';


const LISTINGS_SHELL = 'mx-auto w-full max-w-[1600px] overflow-x-hidden px-3 pb-28 pt-2 sm:px-5 md:pb-10 lg:px-8';
const LISTINGS_SECTION_SURFACE = 'min-w-0 rounded-[1.5rem] border border-border/60 bg-card/65 p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)] backdrop-blur supports-[backdrop-filter]:bg-card/55 sm:rounded-[1.85rem] sm:p-5 md:p-6 dark:border-white/10 dark:bg-background/35 dark:shadow-black/25';
const LISTINGS_STATE_CARD = 'relative overflow-hidden rounded-[1.75rem] border border-border/60 bg-gradient-to-br from-card/95 via-card/85 to-primary/[0.045] px-6 py-12 text-center shadow-[0_18px_50px_rgba(15,23,42,0.08)] dark:border-white/10 dark:from-background/85 dark:via-background/70 dark:to-primary/10 dark:shadow-black/35';
const LISTINGS_STATE_ICON = 'mx-auto inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-[0_14px_34px_rgba(245,158,11,0.14)]';
const LISTINGS_CARD_SURFACE = 'rounded-2xl border border-border/70 bg-card/90 shadow-[0_10px_30px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-background/80 dark:shadow-black/30';
const LISTINGS_SECONDARY_ACTION = 'min-h-10 rounded-full border-border/70 bg-card/85 px-4 font-semibold shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 hover:text-primary hover:shadow-[0_10px_28px_rgba(245,158,11,0.16)] focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 active:translate-y-0 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60';
const LISTINGS_CHIP_ACTION = 'h-9 rounded-full px-3.5 text-xs font-semibold shadow-sm transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-400/45 focus-visible:ring-offset-2 active:translate-y-0 disabled:translate-y-0 disabled:opacity-60';
const LISTINGS_CHIP_INACTIVE = 'border-border/70 bg-background/80 text-muted-foreground hover:-translate-y-0.5 hover:border-brand-400/45 hover:bg-brand-50/70 hover:text-brand-700 dark:border-white/10 dark:bg-background/45 dark:hover:bg-brand-400/10 dark:hover:text-brand-200';
const LISTINGS_CHIP_ACTIVE = 'border-brand-400/70 bg-gradient-to-r from-brand-500 to-brand-500 text-foreground dark:text-white shadow-[0_10px_24px_rgba(245,158,11,0.28)] hover:-translate-y-0.5 hover:from-brand-500 hover:to-brand-400 hover:text-white dark:border-brand-300/60';
/**
 * The marketplace's two sources are the first decision a reader makes, so they
 * are stated as labelled cards rather than as two more pills in a pill bar —
 * the previous treatment was visually identical to the view switcher below it.
 */
const LISTINGS_SECTION_SWITCHER = 'grid w-full grid-cols-1 gap-2 rounded-[1.5rem] border border-border/60 bg-card/70 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_12px_34px_rgba(15,23,42,0.07)] backdrop-blur sm:w-auto sm:grid-cols-2 dark:border-white/10 dark:bg-background/40 dark:shadow-black/25';
const LISTINGS_SECTION_TAB = 'group flex min-h-[3.75rem] min-w-0 items-center gap-3 rounded-[1.15rem] border px-4 py-2.5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 sm:min-w-[15rem]';
const LISTINGS_SECTION_TAB_ACTIVE = 'border-primary/45 bg-background shadow-[0_10px_26px_rgba(15,23,42,0.12)] ring-1 ring-primary/20 dark:bg-background dark:shadow-black/35';
const LISTINGS_SECTION_TAB_INACTIVE = 'border-transparent bg-transparent hover:-translate-y-0.5 hover:border-border/60 hover:bg-background/70 dark:hover:bg-white/[0.05]';
const LISTINGS_SECTION_TAB_ICON = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/50 text-muted-foreground transition-colors duration-200 dark:border-white/10 dark:bg-white/[0.04]';
const LISTINGS_SECTION_TAB_ICON_ACTIVE = 'border-primary/35 bg-primary/12 text-primary shadow-[0_8px_20px_rgba(245,158,11,0.18)]';
const LISTINGS_VIEW_SWITCHER = 'inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/45 p-1 shadow-inner dark:border-white/10 dark:bg-white/[0.04]';
const LISTINGS_VIEW_CONTROL = 'h-9 rounded-full px-3 text-xs font-bold tracking-[0.01em] transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 disabled:cursor-default';
const LISTINGS_VIEW_CONTROL_ACTIVE = 'border-primary/45 bg-background text-foreground shadow-[0_8px_22px_rgba(15,23,42,0.10)] ring-1 ring-primary/20 dark:bg-background dark:shadow-black/30';
const LISTINGS_VIEW_CONTROL_INACTIVE = 'border-transparent bg-transparent text-muted-foreground/75 hover:bg-background/70 hover:text-foreground dark:hover:bg-white/[0.06]';
const LISTINGS_REFRESH_ACTION = 'min-h-10 rounded-full border-border/70 bg-card/85 px-4 font-semibold shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 hover:text-primary hover:shadow-[0_10px_28px_rgba(245,158,11,0.16)] focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 active:translate-y-0 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 data-[refreshing=true]:border-primary/35 data-[refreshing=true]:bg-primary/10 data-[refreshing=true]:text-primary';
const LISTING_MISSING_VALUE = 'inline-flex min-h-6 items-center rounded-full border border-dashed border-border/70 bg-muted/30 px-2.5 text-sm font-medium text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]';
const LISTING_TABLE_HEAD = 'h-12 whitespace-nowrap px-4 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground/85';
const LISTINGS_TABLE_CARD = 'overflow-hidden';
const LISTINGS_TABLE_VIEWPORT = 'overflow-x-auto overscroll-x-contain';
const LISTINGS_TABLE_MIN_WIDTH = 'min-w-[1520px]';
const LISTINGS_RECEIVED_COLUMN = 'min-w-[230px] w-[230px] whitespace-nowrap';
const LISTINGS_ACTIONS_COLUMN = 'sticky right-0 z-20 w-20 min-w-20 pr-5 text-right bg-muted/95 backdrop-blur dark:bg-background/95 shadow-[-8px_0_16px_-8px_rgba(15,23,42,0.18)]';
const LISTING_SELECTION_CHECKBOX = 'h-5 w-5 rounded-md border-border/80 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2';
const LISTING_BADGE_BASE = 'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold leading-none tracking-[0.02em] shadow-sm';
const LISTING_PROPERTY_TYPE_BADGE = 'max-w-full border-brand-200/70 bg-brand-50/75 text-brand-800 dark:border-brand-300/20 dark:bg-brand-400/10 dark:text-brand-100';
const LISTING_CONFIDENCE_BADGE = 'rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none shadow-sm';
const getListingConfidenceBadgeTone = (confidence: number) =>
  confidence >= 0.7
    ? 'border-success/30 bg-success/10 text-success dark:border-success/30 dark:bg-success/10 dark:text-success'
    : confidence >= 0.45
      ? 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-400/30 dark:bg-brand-400/10 dark:text-brand-200'
      : 'border-destructive/30 bg-destructive/10 text-destructive dark:border-destructive/30 dark:bg-destructive/10 dark:text-destructive';


// Lazy load heavy modal components. lazyWithRetry (rather than React.lazy) so a
// cached index.html pointing at chunk hashes the host no longer serves recovers
// instead of leaving the feature stuck on its loading fallback.
const ListingDetailsModal = lazyWithRetry(() => import('@/components/listings/ListingDetailsModal').then(m => ({ default: m.ListingDetailsModal })));
const InvestmentReportModal = lazyWithRetry(() => import('@/components/listings/InvestmentReportModal').then(m => ({ default: m.InvestmentReportModal })));
const EmailAgentDialog = lazyWithRetry(() => import('@/components/listings/EmailAgentDialog').then(m => ({ default: m.EmailAgentDialog })));
const BulkGenerationModal = lazyWithRetry(() => import('@/components/listings/BulkGenerationModal').then(m => ({ default: m.BulkGenerationModal })));
const ListingsMapView = lazyWithRetry(() => import('@/components/listings/ListingsMapView').then(m => ({ default: m.ListingsMapView })));

// Default empty filter state — keyword always starts blank.
// Both the shape and the defaults come from `@/lib/listingFilters`, so the
// predicate and the panels can never disagree about what a filter is called or
// what "unset" means for it.
const DEFAULT_FILTERS = DEFAULT_LISTING_FILTERS;

type ListingFilters = ListingFilterState;

// URL <-> filter serialisation. Only non-default values are written to the URL so
// links stay clean. Boolean flags are serialised as "1" and view/search live under
// short keys (`view`, `q`).
const URL_KEYS_STRING = [
  'propertyType', 'suburb', 'state', 'zipCode', 'sourceHost', 'agencyName',
  'priceMin', 'priceMax', 'bedsMin', 'bedsMax', 'bathsMin', 'bathsMax',
  'carsMin', 'carsMax', 'keywordSearch',
] as const;
const URL_KEYS_BOOL = ['hasInspection', 'lowConfidence', 'offMarket', 'includeNearbySuburbs'] as const;

/**
 * The four ways the same filtered set can be read.
 *
 * `gallery` leads with the photograph and is what a buyer wants; `table` leads
 * with the numbers and is what an analyst wants. Both draw from one predicate so
 * they can never disagree about which listings match.
 */
export type ListingsViewMode = 'list' | 'table' | 'map' | 'gallery';

function parseListingsUrlState(params: URLSearchParams): {
  filters: Partial<ListingFilters>;
  search: string | null;
  view: ListingsViewMode | null;
  hasAny: boolean;
} {
  let hasAny = false;
  const filters: Partial<ListingFilters> = {};
  for (const key of URL_KEYS_STRING) {
    const v = params.get(key);
    if (v !== null && v !== '') {
      (filters as Record<string, unknown>)[key] = v;
      hasAny = true;
    }
  }
  for (const key of URL_KEYS_BOOL) {
    if (params.get(key) === '1') {
      (filters as Record<string, unknown>)[key] = true;
      hasAny = true;
    }
  }
  const search = params.get('q');
  // Only the two views the marketplace offers are honoured. A link pinning the
  // retired `list`/`table` views resolves to the default rather than to a view
  // with no control to leave it by.
  const viewRaw = params.get('view');
  const view = viewRaw === 'map' || viewRaw === 'gallery' ? viewRaw : null;

  if (search !== null) hasAny = true;
  if (view !== null) hasAny = true;
  return { filters, search, view, hasAny };
}

function buildListingsUrlParams(
  filters: ListingFilters,
  search: string,
  view: ListingsViewMode,
  defaultView: ListingsViewMode,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of URL_KEYS_STRING) {
    const value = filters[key];
    const defaultValue = DEFAULT_FILTERS[key];
    if (typeof value === 'string' && value && value !== defaultValue) {
      params.set(key, value);
    }
  }
  for (const key of URL_KEYS_BOOL) {
    if (filters[key]) params.set(key, '1');
  }
  if (search) params.set('q', search);
  if (view !== defaultView) params.set('view', view);
  return params;
}

type ListingsStatePanelProps = {
  icon: ElementType;
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
  tone?: 'default' | 'error';
};

const ListingsStatePanel = ({ icon: Icon, eyebrow, title, description, children, tone = 'default' }: ListingsStatePanelProps) => (
  <div className={cn(LISTINGS_STATE_CARD, tone === 'error' && 'to-destructive/[0.05] dark:to-destructive/10')}>
    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
    <div className="pointer-events-none absolute -right-20 -top-24 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
    <div className="relative">
      <div className={cn(LISTINGS_STATE_ICON, tone === 'error' && 'border-destructive/20 bg-destructive/10 text-destructive shadow-[0_14px_34px_rgba(239,68,68,0.12)]')}>
        <Icon className="h-7 w-7" />
      </div>
      <div className="mt-5 text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground/75">{eyebrow}</div>
      <h2 className="mt-2 text-2xl font-bold tracking-[-0.035em] text-foreground">{title}</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
      {children && <div className="mt-6 flex flex-wrap items-center justify-center gap-3">{children}</div>}
    </div>
  </div>
);

const ListingsLoadingSkeleton = ({ isMobile }: { isMobile: boolean }) => (
  <div className={`${LISTINGS_SHELL} space-y-5 md:space-y-7`} aria-busy="true" aria-live="polite">
    <section className={`${LISTINGS_SECTION_SURFACE} relative overflow-hidden bg-gradient-to-br from-card/95 via-card/80 to-primary/5 dark:from-background/80 dark:via-background/55 dark:to-primary/10`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent" />
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/90">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary shadow-[0_0_14px_rgba(245,158,11,0.55)]" />
            Property Intelligence
          </div>
          <Skeleton className="h-11 w-44 rounded-xl" />
          <Skeleton className="mt-3 h-5 w-72 rounded-full" />
        </div>
        <div className="flex items-center gap-3 rounded-[1.35rem] border border-border/60 bg-background/65 p-2">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="pr-2 text-sm font-semibold text-muted-foreground">Preparing listings</span>
        </div>
      </div>
    </section>

    {isMobile ? (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className={LISTINGS_CARD_SURFACE}>
            <CardContent className="space-y-4 p-4">
              <Skeleton className="h-5 w-4/5 rounded-full" />
              <Skeleton className="h-4 w-1/2 rounded-full" />
              <div className="flex gap-2">
                <Skeleton className="h-8 w-16 rounded-full" />
                <Skeleton className="h-8 w-16 rounded-full" />
                <Skeleton className="h-8 w-16 rounded-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    ) : (
      <Card className={cn(LISTINGS_CARD_SURFACE, 'overflow-hidden')}>
        <CardHeader className="border-b border-border/60 bg-muted/25">
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 flex-1 rounded-full" />
            <Skeleton className="h-12 w-32 rounded-full" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 p-5">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </CardContent>
      </Card>
    )}
  </div>
);

// buildFullAddress, extractAUState, extractPostcode now imported from @/lib/addressUtils

/**
 * The Property Marketplace's two tabs.
 *
 * `listings` is everything this page has always been — the Airtable-sourced
 * intake, unchanged. `builder_stock` is the properties builders uploaded
 * through their own portal, and it appears only when an administrator has
 * enabled `feature_flags.builder_stock_marketplace`. The tab strip is not
 * rendered at all when the flag is off, so a deployment that has never used
 * the feature sees the page exactly as before.
 */
type MarketplaceTab = 'listings' | 'builder_stock';

const MARKETPLACE_SECTIONS: ReadonlyArray<{
  id: MarketplaceTab;
  label: string;
  description: string;
  icon: ElementType;
}> = [
  { id: 'listings', label: 'Listings', description: 'Off-market and on-market intake', icon: Building2 },
  { id: 'builder_stock', label: 'Builder Stock', description: 'Builder and developer opportunities', icon: HardHat },
];

/**
 * The section switcher, rendered *inside* the Property Marketplace header so
 * the two sections read as parts of one page rather than as a strip floating
 * above it.
 */
function MarketplaceSectionTabs({
  tab,
  onChange,
}: {
  tab: MarketplaceTab;
  onChange: (next: MarketplaceTab) => void;
}) {
  return (
    <div className="mt-5 border-t border-border/50 pt-4 dark:border-white/10">
      <div className="mb-2.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70">
        <Layers className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        Marketplace sections
      </div>
      <div
        className={LISTINGS_SECTION_SWITCHER}
        role="tablist"
        aria-label="Property Marketplace sections"
      >
        {MARKETPLACE_SECTIONS.map((section) => {
          const isActive = tab === section.id;
          return (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(section.id)}
              className={cn(
                LISTINGS_SECTION_TAB,
                'relative overflow-hidden',
                isActive ? LISTINGS_SECTION_TAB_ACTIVE : LISTINGS_SECTION_TAB_INACTIVE,
              )}
            >
              {isActive && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent"
                />
              )}
              <span className={cn(LISTINGS_SECTION_TAB_ICON, isActive && LISTINGS_SECTION_TAB_ICON_ACTIVE)}>
                <section.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 text-left">
                <span className="block truncate text-sm font-bold tracking-[-0.01em] text-foreground">
                  {section.label}
                </span>
                <span className="block truncate text-xs font-medium text-muted-foreground">
                  {section.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function Listings() {
  const { enabled: builderStockEnabled } = useBuilderStockMarketplaceFlag();
  const navigate = useNavigate();
  // `?section=builder-stock` is where a builder property's page sends "back".
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<MarketplaceTab>(
    () => (searchParams.get('section') === 'builder-stock' ? 'builder_stock' : 'listings'));

  // A tab that disappears must not leave the page showing nothing. If an
  // administrator switches the feature off while somebody is looking at it,
  // the marketplace falls back to its listings.
  useEffect(() => {
    if (!builderStockEnabled && tab === 'builder_stock') setTab('listings');
  }, [builderStockEnabled, tab]);

  if (!builderStockEnabled) return <ListingsMarketplace />;

  const sectionTabs = <MarketplaceSectionTabs tab={tab} onChange={setTab} />;

  if (tab === 'listings') {
    return (
      <ListingsMarketplace
        sectionTabs={sectionTabs}
        onOpenBuilderStock={(stockItemId) => navigate(builderStockPropertyPath(stockItemId))}
      />
    );
  }

  return (
    <div className={cn(LISTINGS_SHELL, 'space-y-5 md:space-y-7')}>
      <section
        className={`${LISTINGS_SECTION_SURFACE} relative overflow-hidden bg-gradient-to-br from-card/95 via-card/80 to-primary/5 dark:from-background/80 dark:via-background/55 dark:to-primary/10`}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent" />
        <div className="min-w-0 max-w-3xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/90 shadow-sm dark:border-primary/20 dark:bg-primary/10">
            <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_14px_rgba(245,158,11,0.55)]" />
            Property Intelligence
          </div>
          <h1 className="text-4xl font-bold tracking-[-0.06em] text-foreground md:text-5xl">Property Marketplace</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground/90 md:text-base">
            Off-Market · On Market · Builder Opportunities
          </p>
        </div>
        {sectionTabs}
      </section>

      <ErrorBoundary>
        <Suspense fallback={<Skeleton className="h-72 rounded-2xl" />}>
          <BuilderStockTab />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}


function ListingsMarketplace({
  sectionTabs,
  onOpenBuilderStock,
}: {
  sectionTabs?: ReactNode;
  /** Opens a builder property's own page for a stock pin. */
  onOpenBuilderStock?: (stockItemId: string) => void;
} = {}) {
  const { canEdit: canEditListings, canDelete: canDeleteListings } = useModulePermissions('listings');
  const { globalSearchQuery, setGlobalSearchQuery } = useSearch();
  const [selectedListings, setSelectedListings] = useState<Set<string>>(new Set());
  const isMobile = useIsMobile();
  // Gallery on every breakpoint: the marketplace offers Gallery and Map only.
  const defaultViewMode: ListingsViewMode = 'gallery';

  // Snapshot URL state once at mount so we can hydrate filters/search/view before
  // React writes anything back to the address bar.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialUrlState = useMemo(
    () => parseListingsUrlState(new URLSearchParams(window.location.search)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [searchQuery, setSearchQuery] = useState(() => initialUrlState.search ?? '');
  const [viewMode, setViewMode] = useState<ListingsViewMode>(
    () => initialUrlState.view ?? defaultViewMode,
  );

  // Listings are locked to the Property Intake Master Airtable base — no other datasets should be exposed here.
  const PROPERTY_INTAKE_TABLE = 'Property Intake Master';
  useEffect(() => {
    try { localStorage.removeItem('airtableSelectedTable'); } catch { /* ignore */ }
  }, []);
  const selectedTable = PROPERTY_INTAKE_TABLE;

  const queryClient = useQueryClient();

  // Use React Query for caching and efficient data fetching
  // Set by the Refresh button so the next fetch goes all the way to Airtable
  // rather than being answered by the server cache, which is at most one sync
  // interval behind. A ref rather than state: it must not re-trigger the query
  // by changing, only alter the fetch already on its way.
  const forceUpstream = useRef(false);

  const { data: listings = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['listings', selectedTable],
    queryFn: async () => {
      const bypassCache = forceUpstream.current;
      forceUpstream.current = false;
      const result = await propertyDataService.fetchAllListings({
        includeDebugInfo: true,
        tableName: selectedTable,
        bypassCache,
      });
      return result.listings;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    // The service answers from its persistent cache first and revalidates behind
    // the render, so what lands here may already be a cached set. `placeholderData`
    // keeps the previous table's rows on screen while a new one resolves rather
    // than flashing the empty state.
    placeholderData: (previous) => previous,
  });

  // Adopt the background revalidation. Without this the page would sit on the
  // cached set until something else invalidated the query — the whole point of
  // serving stale data first is that the fresh set replaces it a moment later.
  useEffect(() => {
    return propertyDataService.subscribe(selectedTable, (result) => {
      queryClient.setQueryData(['listings', selectedTable], result.listings);
    });
  }, [queryClient, selectedTable]);


  
  // Hydrate filters: URL params win, then localStorage, then defaults. Keyword
  // still resets on load unless the URL explicitly carries one.
  const [filters, setFilters] = useState<ListingFilters>(() => {
    let base: ListingFilters = { ...DEFAULT_FILTERS };
    const savedFilters = localStorage.getItem('listingFilters');
    if (savedFilters) {
      try {
        const parsed = JSON.parse(savedFilters);
        base = { ...DEFAULT_FILTERS, ...parsed, keywordSearch: '' };
      } catch (e) {
        console.error('Failed to parse saved filters:', e);
      }
    }
    return { ...base, ...initialUrlState.filters };
  });

  const [selectedListing, setSelectedListing] = useState<PropertyListing | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [investmentReportListing, setInvestmentReportListing] = useState<PropertyListing | null>(null);
  const [isInvestmentReportModalOpen, setIsInvestmentReportModalOpen] = useState(false);
  const [isBulkGenerationModalOpen, setIsBulkGenerationModalOpen] = useState(false);
  const [emailAgentListing, setEmailAgentListing] = useState<PropertyListing | null>(null);
  
  const { toast } = useToast();
  const navigate = useNavigate();
  const { prefs, update: updatePrefs, recordLastUsed, effectiveScope, effectiveTier } = useReportPreferences();
  // Per-row pending scope/tier choice in the picker (controlled)


  // Sync global search with local search when component mounts or global search changes
  useEffect(() => {
    if (globalSearchQuery) setSearchQuery(globalSearchQuery);
  }, [globalSearchQuery]);

  // Persist filters + mirror filter/search/view state into the URL so links are
  // shareable and the map view stays in lockstep with the active filter set.
  useEffect(() => {
    localStorage.setItem('listingFilters', JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    const next = buildListingsUrlParams(filters, searchQuery, viewMode, defaultViewMode);
    // Preserve unrelated query keys already on the URL.
    const merged = new URLSearchParams(searchParams);
    const managed = new Set<string>([...URL_KEYS_STRING, ...URL_KEYS_BOOL, 'q', 'view']);
    managed.forEach((k) => merged.delete(k));
    next.forEach((value, key) => merged.set(key, value));
    if (merged.toString() !== searchParams.toString()) {
      setSearchParams(merged, { replace: true });
    }
    // We intentionally omit searchParams/setSearchParams to avoid write loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, searchQuery, viewMode, defaultViewMode]);

  // Refresh function — bypass cache for explicit user refresh
  const loadListings = useCallback(() => {
    // Scoped to this table. Clearing everything also reset Overview to cold,
    // which then paid for a full walk nobody had asked for.
    propertyDataService.clearCache(PROPERTY_INTAKE_TABLE);
    forceUpstream.current = true;
    refetch();
  }, [refetch]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedListings(new Set(listings.map(l => l.id)));
    } else {
      setSelectedListings(new Set());
    }
  };

  const handleSelectListing = (listingId: string, checked: boolean) => {
    const newSelected = new Set(selectedListings);
    if (checked) {
      newSelected.add(listingId);
    } else {
      newSelected.delete(listingId);
    }
    setSelectedListings(newSelected);
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

  // A stored link with no scheme resolves against this app's own origin, so
  // "Open source listing" used to open a tab on a path we do not serve.
  const openSourceUrl = (url: string) => { openListingUrl(url); };

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
    if (isNaN(dateObj.getTime())) return 'Invalid Date';
    
    return new Intl.DateTimeFormat('en-AU', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(dateObj);
  };

  const formatDateTimeAttribute = (date: Date | string | null | undefined) => {
    if (!date) return undefined;
    const dateObj = date instanceof Date ? date : new Date(date);
    return isNaN(dateObj.getTime()) ? undefined : dateObj.toISOString();
  };

  // Get unique values for filter options — extract state from address if field is empty
  const uniqueValues = useMemo(() => {
    const propertyTypes = [...new Set(listings.map(l => l.propertyType).filter(Boolean))].sort();
    const suburbs = [...new Set(listings.map(l => l.suburb).filter(Boolean))].sort();
    const sourceHosts = [...new Set(listings.map(l => l.sourceHost).filter(Boolean))].sort();
    const agencies = [...new Set(listings.map(l => l.agencyName).filter(Boolean))].sort();
    // Newly available: the projection reads `Intent` and `Sector` now, so a
    // rental can be told from a sale for the first time.
    const intents = [...new Set(listings.map(l => l.intent).filter(Boolean))].sort() as string[];
    const sectors = [...new Set(listings.map(l => l.sector).filter(Boolean))].sort() as string[];
    
    // State and postcode come from `lib/listings/listingFacets`, which the
    // Overview reads too — the two pages offered different state lists off the
    // same data until they did.
    const { states, postcodes: zipCodes } = buildListingFacets(listings);

    return { propertyTypes, suburbs, states, zipCodes, sourceHosts, agencies, intents, sectors };
  }, [listings]);

  // Compute nearby suburbs when the filter is active
  const nearbySuburbsList = useMemo(() => {
    if (filters.includeNearbySuburbs && filters.suburb && filters.suburb !== 'all') {
      return getNearbySuburbs(filters.suburb, listings);
    }
    return null;
  }, [filters.includeNearbySuburbs, filters.suburb, listings]);

  // Filtering happens in two stages, because "has photos" depends on an answer
  // that only arrives after a network round trip: whether the image library
  // holds stored bytes for a listing. Resolving images needs a list, and the
  // list needs the resolution — so everything except the photo filter is
  // applied first, images are resolved against *that* set, and the photo filter
  // is applied last.
  //
  // The predicate itself lives in `@/lib/listingFilters` so list, table and map
  // are guaranteed to agree, and so its edge cases (unknown bedroom counts,
  // undisclosed prices, undated listings) can be asserted directly.
  const byRecency = useCallback((a: PropertyListing, b: PropertyListing) => {
    const getTs = (l: PropertyListing) => {
      const d = (l as any).receivedAt || l.createdAt || l.createdTime;
      if (!d) return 0;
      const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
      return isNaN(t) ? 0 : t;
    };
    return getTs(b) - getTs(a);
  }, []);

  const preFilteredListings = useMemo(() => {
    const withoutPhotoFilter = { ...filters, hasPhotos: false };
    return listings
      .filter((listing) =>
        matchesListingFilters(listing, withoutPhotoFilter, {
          searchQuery,
          nearbySuburbs: nearbySuburbsList,
          // The predicate must read a listing exactly as the option list did,
          // or a filter selects nothing. Both go through `listingFacets`.
          extractState: (address) => extractAUState(address),
          extractPostcode: (address) => extractAUPostcode(address) ?? undefined,
        }),
      )
      .sort(byRecency);
  }, [listings, searchQuery, filters, nearbySuburbsList, byRecency]);


  const openDetailsModal = (listing: PropertyListing) => {
    setSelectedListing(listing);
    setIsDetailsModalOpen(true);
  };

  /** Straight from a card to a drafted enquiry, without a detour through the modal. */
  const openEmailAgent = (listing: PropertyListing) => setEmailAgentListing(listing);

  const openInvestmentReportModal = (listing: PropertyListing) => {
    setInvestmentReportListing(listing);
    setIsInvestmentReportModalOpen(true);
  };

  /**
   * Phase B: launch report generation with explicit scope+tier.
   * - address+compass uses the existing per-listing modal (zero-regression path).
   * - everything else routes to /reports with prefilled URL params.
   */
  const launchScopedGeneration = useCallback(
    (listing: PropertyListing, scope: ReportScope, tier: ReportTier) => {
      void recordLastUsed(scope, tier);

      if (scope === 'address' && tier === 'compass') {
        openInvestmentReportModal(listing);
        return;
      }

      const queryByScope: Record<ReportScope, string> = {
        address: buildFullAddress(listing),
        suburb: listing.suburb || listing.location || '',
        zipcode: extractAUPostcode(buildFullAddress(listing)) || '',
        state: extractAUState(buildFullAddress(listing)) || '',
      };
      const q = queryByScope[scope];
      if (!q) {
        toast({
          title: 'Missing data',
          description: `Could not determine ${scope} from this listing.`,
          variant: 'destructive',
        });
        return;
      }
      const params = new URLSearchParams({ scope, q, tier });
      navigate(`/reports?${params.toString()}`);
    },
    [navigate, recordLastUsed, toast]
  );

  const closeDetailsModal = () => {
    setSelectedListing(null);
    setIsDetailsModalOpen(false);
  };

  const toggleSelectAll = () => {
    if (selectedListings.size === filteredListings.length) {
      setSelectedListings(new Set());
    } else {
      setSelectedListings(new Set(filteredListings.map(l => l.id)));
    }
  };

  const clearAllFilters = () => {
    setFilters({ ...DEFAULT_FILTERS });
  };

  // Same authority the filter panels count with, so the page and the badge can
  // never disagree about whether anything is narrowing the set.
  const activeFilterCount = activeListingFilterCount(filters);
  const hasActiveFilters = activeFilterCount > 0;
  const hasSearchQuery = searchQuery.trim().length > 0;
  // Photos are resolved once for the filtered set and shared by every view, so
  // switching list ↔ table ↔ map re-uses the same signed URLs instead of asking
  // again. The map's popup resolves its own single listing on top of this.
  const { images: listingImages, isResolving: listingImagesResolving, refresh: refreshListingImages } =
    useListingImages(preFilteredListings);


  /** Ids the image library actually holds stored photos for. */
  const listingsWithPhotos = useMemo(() => {
    const ids = new Set<string>();
    for (const [listingId, photos] of Object.entries(listingImages)) {
      if (photos && photos.length > 0) ids.add(listingId);
    }
    return ids;
  }, [listingImages]);

  const filteredListings = useMemo(() => {
    if (!filters.hasPhotos) return preFilteredListings;
    // Applied only once the pass has settled — filtering mid-resolution would
    // empty the page and then repopulate it, which reads as a bug.
    if (listingImagesResolving && listingsWithPhotos.size === 0) return preFilteredListings;
    return preFilteredListings.filter((listing) => listingHasPhotos(listing, listingsWithPhotos));
  }, [preFilteredListings, filters.hasPhotos, listingImagesResolving, listingsWithPhotos]);

  /**
   * Builder stock as a map layer. Defaults ON where the deployment has the
   * feature: a builder's stock is marketplace supply like any other, and the
   * whole point of the map is seeing what is available WHERE. The toggle
   * exists because a reader comparing agent listings does not always want
   * house-and-land estates in the same picture.
   */
  const [showBuilderStockOnMap, setShowBuilderStockOnMap] = useState(true);
  /**
   * Fetched whenever the MAP is open, never gated on the toggle.
   *
   * It was gated on the toggle, and that made the control delete itself:
   * switching the layer off emptied `listings`, which made `available` false,
   * which unmounted the chip — so the only way back was reloading the page.
   * Whether this deployment HAS builder stock and whether the reader wants to
   * SEE it are different questions, and only the first one may decide whether
   * a control is drawn.
   */
  const builderStockLayer = useBuilderStockMapListings(viewMode === 'map');

  const builderStockAvailable = builderStockLayer.listings.length > 0 || builderStockLayer.isLoading;

  /**
   * What the map plots: the filtered listings, plus builder stock when the
   * layer is on. Only the MAP gets the combined set — the list, table and
   * gallery are the listings register and must not silently gain rows from
   * another table.
   */
  const mapListings = useMemo(
    () =>
      showBuilderStockOnMap && builderStockLayer.listings.length > 0
        ? [...filteredListings, ...builderStockLayer.listings]
        : filteredListings,
    [filteredListings, showBuilderStockOnMap, builderStockLayer.listings],
  );

  /**
   * A pin can now belong to either table, so the click has to be routed. A
   * builder stock id is prefixed and reversible (`builderStockMapPoint.ts`),
   * which is what keeps the two id namespaces from colliding in the marker
   * index; anything else is an ordinary listing.
   */
  const openMapRecord = useCallback(
    (listing: PropertyListing) => {
      const stockId = builderStockIdFromMapId(listing.id);
      if (stockId) {
        // Builder stock has no listing-detail modal — a builder property has
        // its own page, which carries the builder's figures, photographs,
        // documents and the Activate action. The map opens that page rather
        // than an empty modal over a property it cannot describe.
        onOpenBuilderStock?.(stockId);
        return;
      }
      openDetailsModal(listing);
    },
    [openDetailsModal, onOpenBuilderStock],
  );

  const showListView = viewMode === 'list';
  const showTableView = viewMode === 'table';
  const showMapView = viewMode === 'map';
  const showGalleryView = viewMode === 'gallery';

  /**
   * Coordinates for the gallery, so a photo-less listing can still show the
   * building.
   *
   * The grid used to render with no `points` at all, which meant every card got
   * `point={null}`, `ListingHero` never added its Street View slide, and all
   * 1,441 tiles fell through to "No photo on record" — including the 811 that
   * are already geocoded and could have shown the actual street frontage. That
   * is the single largest source of empty tiles on this page, and it costs
   * nothing to fix: the geocodes are stored.
   *
   * Scoped to the rendered slice rather than the filtered set. Resolving 1,441
   * would exceed the geocoder's ten-calls-per-minute budget and spend it on
   * cards nobody has scrolled to; the grid reports how many it is showing.
   */
  const [galleryVisibleCount, setGalleryVisibleCount] = useState(0);
  const galleryCoordinateInput = useMemo(
    () => (showGalleryView ? filteredListings.slice(0, galleryVisibleCount) : EMPTY_LISTINGS),
    [showGalleryView, filteredListings, galleryVisibleCount],
  );
  const { points: galleryPoints } = useListingCoordinates(galleryCoordinateInput);
  const emptyStateCopy = hasSearchQuery
    ? {
        icon: Search,
        eyebrow: 'No search results',
        title: 'No listings match that search',
        description: 'Try a different address, suburb, agency, or agent name. Your existing filters are still being respected.',
      }
    : hasActiveFilters
      ? {
          icon: FilterX,
          eyebrow: 'Filtered empty',
          title: 'No listings match the active filters',
          description: 'The current dataset does not contain listings for this filter combination. Clear filters to review the full dataset.',
        }
      : {
          icon: Inbox,
          eyebrow: 'Empty dataset',
          title: 'No listings are available yet',
          description: 'There are no listings in the selected dataset. Refresh to check whether new records are available.',
        };

  if (isLoading) {
    return <ListingsLoadingSkeleton isMobile={isMobile} />;
  }

  if (isError) {
    const errorMessage = error instanceof Error ? error.message : 'The listings service returned an error.';

    return (
      <div className={`${LISTINGS_SHELL} space-y-5 md:space-y-7`}>
        <div className={LISTINGS_SECTION_SURFACE}>
          <div className="flex items-center justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/90">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_14px_rgba(245,158,11,0.55)]" />
              Property Intelligence
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.045em] text-foreground md:text-4xl">Property Marketplace</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground/90 md:text-base">Off-Market · On Market · Builder Opportunities</p>
          </div>
          <Button onClick={loadListings} variant="outline" className={`${LISTINGS_REFRESH_ACTION} gap-2`}>
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
          </div>
          {sectionTabs}
        </div>

        <ListingsStatePanel
          icon={AlertTriangle}
          eyebrow="Listings unavailable"
          title="Unable to load listings"
          description={errorMessage}
          tone="error"
        />
      </div>
    );
  }

  return (
    <div className={`${LISTINGS_SHELL} space-y-5 md:space-y-7`}>
      {/* Header */}
      <section className={`${LISTINGS_SECTION_SURFACE} relative overflow-hidden bg-gradient-to-br from-card/95 via-card/80 to-primary/5 dark:from-background/80 dark:via-background/55 dark:to-primary/10`}>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent" />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/90 shadow-sm dark:border-primary/20 dark:bg-primary/10">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_14px_rgba(245,158,11,0.55)]" />
              Property Intelligence
            </div>
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
              <h1 className="text-4xl font-bold tracking-[-0.06em] text-foreground md:text-5xl">Property Marketplace</h1>
              <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-sm font-semibold text-foreground shadow-sm backdrop-blur dark:border-white/10 dark:bg-background/45">
                <Building2 className="h-4 w-4 text-primary" />
                <span className="tabular-nums">{filteredListings.length} of {listings.length}</span>
                <span className="font-medium text-muted-foreground">properties</span>
              </div>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground/90 md:text-base">Off-Market · On Market · Builder Opportunities</p>
          </div>
          
          <div className="flex w-full flex-wrap items-stretch justify-start gap-3 rounded-[1.35rem] sm:items-center lg:w-auto border border-border/60 bg-background/65 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_10px_30px_rgba(15,23,42,0.06)] backdrop-blur dark:border-white/10 dark:bg-background/40 dark:shadow-black/20 lg:justify-end">
            <div className="flex min-w-[min(100%,18rem)] flex-1 items-center gap-2 rounded-full sm:flex-none border border-border/50 bg-card/70 px-3 py-1.5 shadow-sm dark:border-white/10 dark:bg-background/35">
              <Database className="h-4 w-4 text-primary shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">Dataset</span>
              <span className="truncate text-sm font-semibold text-foreground">Property Intake Master</span>
            </div>


            {/* Gallery and Map only. The list and table views are retired: the
                gallery is the browsing surface and the map is the spatial one. */}
            <div className={LISTINGS_VIEW_SWITCHER} role="group" aria-label="Listing view mode">
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={showGalleryView}
                onClick={() => setViewMode('gallery')}
                className={cn(LISTINGS_VIEW_CONTROL, 'min-h-10 gap-1.5', showGalleryView ? LISTINGS_VIEW_CONTROL_ACTIVE : LISTINGS_VIEW_CONTROL_INACTIVE)}
              >
                <LayoutGrid className="h-4 w-4" />
                Gallery
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-pressed={showMapView}
                onClick={() => setViewMode('map')}
                className={cn(LISTINGS_VIEW_CONTROL, 'min-h-10 gap-1.5', showMapView ? LISTINGS_VIEW_CONTROL_ACTIVE : LISTINGS_VIEW_CONTROL_INACTIVE)}
              >
                <MapIcon className="h-4 w-4" />
                Map
              </Button>
            </div>

            {isFetching && (
              <div className="hidden items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary shadow-sm md:inline-flex" role="status">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                Refreshing data
              </div>
            )}

            {selectedListings.size > 0 && !isMobile && (
              <Button variant="outline" size="sm" className={`${LISTINGS_SECONDARY_ACTION} gap-2`}>
                <Download className="h-4 w-4" />
                Export ({selectedListings.size})
              </Button>
            )}
            <Button onClick={loadListings} size="sm" variant="outline" disabled={isFetching} data-refreshing={isFetching} className={`${LISTINGS_REFRESH_ACTION} gap-2`}>
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="hidden md:inline">{isFetching ? 'Refreshing...' : 'Refresh'}</span>
            </Button>
          </div>
        </div>
        {sectionTabs}
      </section>

      {/* Search and Filters */}
      <section className={`${LISTINGS_SECTION_SURFACE} space-y-6 bg-gradient-to-br from-card/95 via-card/80 to-brand-50/40 ring-1 ring-brand-400/10 dark:from-background/70 dark:via-background/50 dark:to-brand-950/10`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <div className="group relative min-w-0 flex-1">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex w-14 items-center justify-center">
              <Search className="h-5 w-5 text-muted-foreground transition-colors duration-200 group-focus-within:text-brand-600 dark:group-focus-within:text-brand-300" />
            </div>
            <SearchInput
              value={searchQuery}
              onValueChange={setSearchQuery}
              placeholder="Search properties..."
              id="listings-search"
              aria-label="Search listings by address, suburb, agency, or agent"
              autoComplete="off"
              hideIcon
              className="h-14 rounded-full border-border/70 bg-background/95 pl-14 pr-5 text-[15px] font-medium shadow-[0_14px_36px_rgba(15,23,42,0.10)] transition-all duration-200 placeholder:text-muted-foreground/65 hover:border-brand-300/70 hover:bg-background focus-visible:border-brand-400 focus-visible:ring-4 focus-visible:ring-brand-400/20 dark:border-white/10 dark:bg-background/70 dark:hover:border-brand-300/35 sm:h-16 sm:text-base"
            />
          </div>
          
          <div className="flex flex-wrap items-center gap-2.5 lg:flex-nowrap">
          {/* Mobile uses sheet, desktop uses popover */}
          {isMobile ? (
            <MobileFilterSheet 
              filters={filters} 
              setFilters={setFilters}
              uniqueValues={uniqueValues}
            />
          ) : (
            <ListingFilters 
              filters={filters} 
              setFilters={setFilters}
              uniqueValues={uniqueValues}
            />
          )}
          
          {hasActiveFilters && !isMobile && (
            <Button variant="ghost" size="sm" onClick={clearAllFilters} className="h-10 rounded-full px-3 text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/25">
              <X className="h-4 w-4 mr-1" />
              Clear
            </Button>
          )}
          </div>
        </div>

        {/* Quick Filters */}
        <div className="flex flex-wrap gap-2.5 border-t border-border/50 pt-4 sm:gap-3 dark:border-white/10">
          <Button
            variant={filters.hasInspection ? "default" : "outline"}
            size="sm"
            onClick={() => setFilters(prev => ({ ...prev, hasInspection: !prev.hasInspection }))}
            aria-pressed={filters.hasInspection}
            aria-label="Toggle listings with inspection times"
            className={cn(LISTINGS_CHIP_ACTION, "gap-1.5", filters.hasInspection ? LISTINGS_CHIP_ACTIVE : LISTINGS_CHIP_INACTIVE, filters.hasInspection && "ring-1 ring-brand-300/70 ring-offset-1 ring-offset-background")}
          >
            <CalendarCheck className="h-4 w-4" />
            Has Inspection
          </Button>
          <Button
            variant={filters.lowConfidence ? "default" : "outline"}
            size="sm"
            onClick={() => setFilters(prev => ({ ...prev, lowConfidence: !prev.lowConfidence }))}
            aria-pressed={filters.lowConfidence}
            aria-label="Toggle low confidence listings"
            className={cn(LISTINGS_CHIP_ACTION, "gap-1.5", filters.lowConfidence ? LISTINGS_CHIP_ACTIVE : LISTINGS_CHIP_INACTIVE, filters.lowConfidence && "ring-1 ring-brand-300/70 ring-offset-1 ring-offset-background")}
          >
            <AlertTriangle className={cn("h-4 w-4", filters.lowConfidence ? "text-foreground dark:text-white" : "text-brand-600 dark:text-brand-300")} />
            Low Confidence
          </Button>
          <Button
            variant={filters.offMarket ? "default" : "outline"}
            size="sm"
            onClick={() => setFilters(prev => ({ ...prev, offMarket: !prev.offMarket }))}
            aria-pressed={filters.offMarket}
            aria-label="Toggle off-market listings"
            className={cn(LISTINGS_CHIP_ACTION, "gap-1.5", filters.offMarket ? LISTINGS_CHIP_ACTIVE : LISTINGS_CHIP_INACTIVE, filters.offMarket && "ring-1 ring-brand-300/70 ring-offset-1 ring-offset-background")}
          >
            <EyeOff className="h-4 w-4" />
            Off-Market
          </Button>
          {hasActiveFilters && isMobile && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={clearAllFilters}
              className="min-h-10 rounded-full px-3 text-xs text-destructive focus-visible:ring-2 focus-visible:ring-destructive/25"
            >
              <X className="h-3 w-3 mr-1" />
              Clear filters
            </Button>
          )}
        </div>
      </section>

      {/* Content: Cards on Mobile, Table on Desktop, Map view geocodes on demand */}
      {showMapView ? (
        <ErrorBoundary
          fallback={
            <ListingsStatePanel
              icon={AlertTriangle}
              eyebrow="Map unavailable"
              title="The map view could not be loaded"
              description="This usually means the browser is holding an older copy of the app. Reloading fetches the current version."
              tone="error"
            >
              <Button variant="outline" onClick={() => reloadForFreshBuild()} className={`${LISTINGS_REFRESH_ACTION} gap-2`}>
                <RefreshCw className="h-4 w-4" />
                Reload the app
              </Button>
            </ListingsStatePanel>
          }
        >
          <Suspense fallback={<div className="rounded-2xl border border-border/60 bg-card/60 p-10 text-center text-sm text-muted-foreground">Loading map…</div>}>
            <ListingsMapView
              listings={mapListings}
              onSelectListing={openMapRecord}
              onEmailAgent={openEmailAgent}
              images={listingImages}
              builderStock={{
                available: builderStockAvailable,
                shown: showBuilderStockOnMap,
                onToggle: setShowBuilderStockOnMap,
                count: builderStockLayer.listings.length,
                failed: builderStockLayer.failed,
              }}
            />
          </Suspense>
        </ErrorBoundary>
      ) : showGalleryView ? (
        filteredListings.length === 0 ? (
          <ListingsStatePanel
            icon={emptyStateCopy.icon}
            eyebrow={emptyStateCopy.eyebrow}
            title={emptyStateCopy.title}
            description={emptyStateCopy.description}
          >
            {hasActiveFilters && (
              <Button variant="outline" onClick={clearAllFilters} className={`${LISTINGS_SECONDARY_ACTION} gap-2`}>
                <X className="h-4 w-4" />
                Clear filters
              </Button>
            )}
          </ListingsStatePanel>
        ) : (
          <ListingGalleryGrid
            listings={filteredListings}
            images={listingImages}
            imagesResolving={listingImagesResolving}
            selectedIds={selectedListings}
            onToggleSelect={(listing, checked) => handleSelectListing(listing.id, checked)}
            onOpenDetails={openDetailsModal}
            onOpenSource={(listing) => openSourceUrl(listing.url ?? '')}
            onEmailAgent={openEmailAgent}
            onImagesFound={refreshListingImages}
            points={galleryPoints}
            onVisibleCountChange={setGalleryVisibleCount}
            formatDate={formatDate}
          />
        )
      ) : showListView ? (
        <div className="space-y-3">
          {filteredListings.length === 0 ? (
            <ListingsStatePanel
              icon={emptyStateCopy.icon}
              eyebrow={emptyStateCopy.eyebrow}
              title={emptyStateCopy.title}
              description={emptyStateCopy.description}
            >
              {hasActiveFilters && (
                <Button variant="outline" onClick={clearAllFilters} className={`${LISTINGS_SECONDARY_ACTION} gap-2`}>
                  <X className="h-4 w-4" />
                  Clear filters
                </Button>
              )}
              <Button variant="outline" onClick={loadListings} className={`${LISTINGS_REFRESH_ACTION} gap-2`}>
                <RefreshCw className="h-4 w-4" />
                  Refresh
              </Button>
            </ListingsStatePanel>
          ) : (
            filteredListings.map((listing) => (
              <PropertyCard
                key={listing.id}
                listing={listing}
                isSelected={selectedListings.has(listing.id)}
                onSelect={(checked) => handleSelectListing(listing.id, checked)}
                onOpenDetails={() => openDetailsModal(listing)}
                onOpenInvestmentReport={() => openInvestmentReportModal(listing)}
                onCopyAddress={() => copyToClipboard(buildFullAddress(listing), 'Full address')}
                onEmailAgent={() => openEmailAgent(listing)}
                onOpenSource={hasListingUrl(listing.url) ? () => openSourceUrl(listing.url!) : undefined}
                formatCurrency={formatCurrency}
                formatDate={formatDate}
                images={listingImages[listing.id]}
                imagesResolving={listingImagesResolving}
              />
            ))
          )}
        </div>
      ) : (
        <Card className={cn(LISTINGS_CARD_SURFACE, LISTINGS_TABLE_CARD)}>
          <CardContent className="p-0">
            <div className={LISTINGS_TABLE_VIEWPORT} role="region" aria-label="Listings table" tabIndex={0}>
            <Table className={cn(LISTINGS_TABLE_MIN_WIDTH, "border-separate border-spacing-0")}>
            <TableHeader className="sticky top-0 z-10 bg-muted/55 backdrop-blur dark:bg-background/80">
              <TableRow className="border-border/70 hover:bg-transparent">
                <TableHead className={cn(LISTING_TABLE_HEAD, "w-14 pl-5")}>
                  <Checkbox
                    checked={selectedListings.size === filteredListings.length && filteredListings.length > 0}
                    onCheckedChange={handleSelectAll}
                    className={LISTING_SELECTION_CHECKBOX}
                    aria-label="Select all listings"
                  />
                </TableHead>
                <TableHead className={cn(LISTING_TABLE_HEAD, "min-w-[320px]")}>Property</TableHead>
                <TableHead className={cn(LISTING_TABLE_HEAD, "min-w-[140px] text-right")}>Price</TableHead>
                <TableHead className={cn(LISTING_TABLE_HEAD, "min-w-[170px]")}>Beds/Baths/Cars</TableHead>
                <TableHead className={cn(LISTING_TABLE_HEAD, "min-w-[180px]")}>Inspection</TableHead>
                <TableHead className={cn(LISTING_TABLE_HEAD, "min-w-[170px]")}>Source</TableHead>
                <TableHead className={cn(LISTING_TABLE_HEAD, "min-w-[130px]")}>Confidence</TableHead>
                <TableHead className={cn(LISTING_TABLE_HEAD, LISTINGS_RECEIVED_COLUMN, "text-right")} title="Received At">Received At</TableHead>
                <TableHead className={cn(LISTING_TABLE_HEAD, LISTINGS_ACTIONS_COLUMN)}><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredListings.map((listing) => (
                <ListingRowContextMenu
                  key={listing.id}
                  label={listing.address || listing.location}
                  isSelected={selectedListings.has(listing.id)}
                  canGenerate={canEditListings}
                  onQuickGenerate={() => launchScopedGeneration(listing, effectiveScope, effectiveTier)}
                  onToggleSelect={() => handleSelectListing(listing.id, !selectedListings.has(listing.id))}
                  onOpenDetails={() => openDetailsModal(listing)}
                  onCopyAddress={() => copyToClipboard(buildFullAddress(listing), 'Full address')}
                  onOpenSource={hasListingUrl(listing.url) ? () => openSourceUrl(listing.url!) : undefined}
                  onEmailAgent={listingContact(listing).email ? () => openEmailAgent(listing) : undefined}
                >
                  <TableRow
                    className={cn(
                      "group relative border-b border-border/50 bg-card/80 transition-all duration-200 odd:bg-card/92 even:bg-muted/[0.22] hover:bg-gradient-to-r hover:from-primary/[0.095] hover:via-primary/[0.045] hover:to-transparent hover:shadow-[inset_0_1px_0_hsl(var(--primary)/0.12),inset_0_-1px_0_hsl(var(--primary)/0.10)] focus-within:bg-primary/[0.06] dark:border-white/10 dark:odd:bg-background/62 dark:even:bg-white/[0.025] dark:hover:from-primary/10 dark:hover:via-white/[0.04]",
                      selectedListings.has(listing.id) && "bg-gradient-to-r from-primary/[0.13] via-primary/[0.075] to-card shadow-[inset_5px_0_0_hsl(var(--primary)),inset_0_1px_0_hsl(var(--primary)/0.18),0_10px_28px_rgba(245,158,11,0.10)] hover:from-primary/[0.16] hover:via-primary/[0.09] dark:from-primary/15 dark:via-primary/10 dark:to-background/55"
                    )}
                  >
                    {/* preserve original cells */}
                  <TableCell className="py-4 pl-5 align-middle first:rounded-l-xl">
                    <Checkbox
                      checked={selectedListings.has(listing.id)}
                      onCheckedChange={(checked) => handleSelectListing(listing.id, !!checked)}
                      className={LISTING_SELECTION_CHECKBOX}
                      aria-label={`Select ${listing.address || listing.location || 'listing'}`}
                    />
                  </TableCell>
                  
                  <TableCell className="py-4 align-middle">
                    <div className="flex min-w-0 items-center gap-3">
                    <ListingThumbnail
                      images={listingImages[listing.id]}
                      isResolving={listingImagesResolving}
                      label={listing.address || listing.suburb || undefined}
                      className="h-11 w-16"
                      onClick={() => openDetailsModal(listing)}
                    />
                    <div className="min-w-0 space-y-1.5">
                      <div className={cn(
                        "max-w-[360px] truncate text-[15px] font-semibold leading-5 tracking-[-0.01em] text-foreground",
                        !listing.address && "text-muted-foreground"
                      )}>
                        {listing.address || listing.fullAddress || 'Address not extracted'}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                        <span className={cn('min-w-0 truncate leading-5', !listing.suburb && LISTING_MISSING_VALUE)}>
                          {formatLocality(listing) || 'Location unknown'}
                        </span>
                        {qualityCaveat(listing) && (
                          <Badge
                            variant="outline"
                            title={qualityCaveat(listing) ?? undefined}
                            className={cn(LISTING_BADGE_BASE, 'border-warning/40 text-warning')}
                          >
                            Check location
                          </Badge>
                        )}
                        {listing.propertyType && (
                          <Badge variant="outline" className={cn(LISTING_BADGE_BASE, LISTING_PROPERTY_TYPE_BADGE)}>
                            {listing.propertyType}
                          </Badge>
                        )}
                      </div>
                    </div>
                    </div>
                  </TableCell>

                  <TableCell className="py-4 text-right align-middle">
                    {(() => {
                      // `Display Price Text` is what the agent wrote and is
                      // populated on more records than the numeric column, so it
                      // leads here too — a table showing "-" beside a listing
                      // whose email said "From $1,599,000" is simply wrong.
                      const price = displayPrice(listing);
                      if (!price.known) return <span className={LISTING_MISSING_VALUE}>-</span>;
                      return (
                        <span className="font-semibold tabular-nums text-foreground">
                          {price.text}
                          {price.isRent && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">rent</span>
                          )}
                        </span>
                      );
                    })()}
                  </TableCell>
                  
                  <TableCell className="py-4 align-middle">
                    <div className="flex items-center gap-2 text-sm text-foreground">
                      <div className="inline-flex min-w-10 items-center justify-center gap-1.5 rounded-full border border-border/45 bg-background/70 px-2.5 py-1.5 shadow-sm">
                        <Bed className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className={cn("font-semibold tabular-nums", !(listing.beds && listing.beds > 0) && "text-muted-foreground")}>{listing.beds && listing.beds > 0 ? listing.beds : '-'}</span>
                      </div>
                      <div className="inline-flex min-w-10 items-center justify-center gap-1.5 rounded-full border border-border/45 bg-background/70 px-2.5 py-1.5 shadow-sm">
                        <Bath className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className={cn("font-semibold tabular-nums", !(listing.baths && listing.baths > 0) && "text-muted-foreground")}>{listing.baths && listing.baths > 0 ? listing.baths : '-'}</span>
                      </div>
                      <div className="inline-flex min-w-10 items-center justify-center gap-1.5 rounded-full border border-border/45 bg-background/70 px-2.5 py-1.5 shadow-sm">
                        <Car className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className={cn("font-semibold tabular-nums", !(listing.carSpaces && listing.carSpaces > 0) && "text-muted-foreground")}>{listing.carSpaces && listing.carSpaces > 0 ? listing.carSpaces : '-'}</span>
                      </div>
                    </div>
                  </TableCell>
                  
                  <TableCell className="py-4 align-middle">
                    {listing.inspectionStart ? (
                      <div className="inline-flex rounded-xl border border-border/60 bg-background/65 px-3 py-1.5 text-sm font-medium tabular-nums shadow-sm">{formatDate(listing.inspectionStart)}</div>
                    ) : (
                      <span className={LISTING_MISSING_VALUE}>-</span>
                    )}
                  </TableCell>
                  
                  <TableCell className="py-4 align-middle">
                    <div className={cn("max-w-[180px] truncate text-sm font-medium leading-5", !listing.agencyName && LISTING_MISSING_VALUE)}>{listing.agencyName || '-'}</div>
                  </TableCell>
                  
                  <TableCell className="py-4 align-middle">
                    {listing.confidence !== undefined && listing.confidence !== null ? (
                      <div className="inline-flex rounded-full bg-background/70 p-0.5 shadow-sm ring-1 ring-border/55">
                        <ConfidenceBadge confidence={listing.confidence} className={cn(LISTING_CONFIDENCE_BADGE, getListingConfidenceBadgeTone(listing.confidence))} />
                      </div>
                    ) : (
                      <span className={LISTING_MISSING_VALUE}>-</span>
                    )}
                  </TableCell>
                  
                  <TableCell className={cn("py-4 text-right align-middle", LISTINGS_RECEIVED_COLUMN)}>
                    {listing.receivedAt ? (
                      <time className="block text-sm font-medium tabular-nums text-muted-foreground/90" dateTime={formatDateTimeAttribute(listing.receivedAt)} title={formatDate(listing.receivedAt)}>{formatDate(listing.receivedAt)}</time>
                    ) : (
                      <span className={LISTING_MISSING_VALUE}>-</span>
                    )}
                  </TableCell>
                  
                  <TableCell className="sticky right-0 z-10 w-20 min-w-20 py-4 pr-5 text-right align-middle last:rounded-r-xl bg-card/95 backdrop-blur group-hover:bg-transparent shadow-[-8px_0_16px_-8px_rgba(15,23,42,0.18)] dark:bg-background/92">
                    {(() => {
                      return (
                        <ReportActionMenu
                          surface="listing-row"
                          label={listing.address || listing.location}
                          callbacks={{
                            onOpenDetails: () => openDetailsModal(listing),
                            onOpenSource: hasListingUrl(listing.url) ? () => openSourceUrl(listing.url!) : undefined,
                            onCopyAddress: () => copyToClipboard(buildFullAddress(listing), 'Full address'),
                            onOpenGenerateModal: canEditListings ? () => openInvestmentReportModal(listing) : undefined,
                          }}
                          permissions={{ canGenerate: canEditListings }}
                          triggerClassName="h-9 w-9 rounded-full border border-border bg-background text-foreground opacity-100 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-primary/10 hover:text-primary hover:shadow-[0_10px_24px_rgba(245,158,11,0.18)] focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 data-[state=open]:border-primary/60 data-[state=open]:bg-primary/12 data-[state=open]:text-primary"
                        />
                      );
                    })()}
                  </TableCell>
                </TableRow>
                </ListingRowContextMenu>
              ))}
            </TableBody>
          </Table>
            </div>
          
          {filteredListings.length === 0 && (
            <div className="p-5">
              <ListingsStatePanel
                icon={emptyStateCopy.icon}
                eyebrow={emptyStateCopy.eyebrow}
                title={emptyStateCopy.title}
                description={emptyStateCopy.description}
              >
              {hasActiveFilters && (
                <Button variant="outline" onClick={clearAllFilters} className={`${LISTINGS_SECONDARY_ACTION} gap-2`}>
                  <X className="h-4 w-4" />
                  Clear filters
                </Button>
              )}
              <Button variant="outline" onClick={loadListings} className={`${LISTINGS_REFRESH_ACTION} gap-2`}>
                <RefreshCw className="h-4 w-4" />
                Refresh data
              </Button>
              </ListingsStatePanel>
            </div>
          )}
          </CardContent>
        </Card>
      )}
      {/* Lazy loaded modals - only load when needed */}
      {isDetailsModalOpen && (
        <Suspense fallback={null}>
          <ListingDetailsModal 
            listing={selectedListing}
            isOpen={isDetailsModalOpen}
            onClose={closeDetailsModal}
          />
        </Suspense>
      )}

      {emailAgentListing && (
        <Suspense fallback={null}>
          <EmailAgentDialog
            listing={emailAgentListing}
            open={Boolean(emailAgentListing)}
            onOpenChange={(open) => !open && setEmailAgentListing(null)}
          />
        </Suspense>
      )}

      {isInvestmentReportModalOpen && (
        <Suspense fallback={null}>
          <InvestmentReportModal
            isOpen={isInvestmentReportModalOpen}
            onClose={() => setIsInvestmentReportModalOpen(false)}
            propertyAddress={investmentReportListing ? buildFullAddress(investmentReportListing) : ''}
            propertyDetails={investmentReportListing}
          />
        </Suspense>
      )}

      {isBulkGenerationModalOpen && (
        <Suspense fallback={null}>
          <BulkGenerationModal
            open={isBulkGenerationModalOpen}
            onOpenChange={setIsBulkGenerationModalOpen}
            selectedProperties={listings.filter(l => selectedListings.has(l.id))}
            onComplete={() => {
              setSelectedListings(new Set());
              loadListings();
            }}
          />
        </Suspense>
      )}

      {/* Floating Action Bar */}
      <BulkActionBar
        count={selectedListings.size}
        label={selectedListings.size === 1 ? 'listing selected' : 'listings selected'}
        onClear={() => setSelectedListings(new Set())}
        helper={
          !isMobile && (selectedListings.size < 2 || selectedListings.size > 10)
            ? selectedListings.size < 2
              ? 'Select at least 2 properties to generate bulk reports'
              : 'Maximum 10 properties allowed per bulk generation'
            : undefined
        }
      >
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={selectedListings.size === filteredListings.length && filteredListings.length > 0}
            onCheckedChange={toggleSelectAll}
          />
          <span className="hidden sm:inline">Select all</span>
        </label>
        {canEditListings && (
          <Button
            onClick={() => setIsBulkGenerationModalOpen(true)}
            disabled={selectedListings.size < 2 || selectedListings.size > 10}
            size="sm"
          >
            <FileText className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Generate Reports</span>
          </Button>
        )}
      </BulkActionBar>
    </div>
  );
}

