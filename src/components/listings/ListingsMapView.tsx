import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AttributionControl,
  Circle,
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  ScaleControl,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertTriangle,
  Bath,
  BedDouble,
  Building2,
  CalendarClock,
  Car,
  ChevronDown,
  Crosshair,
  ExternalLink,
  Flame,
  HardHat,
  Layers,
  LayoutGrid,
  Loader2,
  LocateFixed,
  Mail,
  MapPin,
  Maximize2,
  Minimize2,
  Minus,
  PanelRightClose,
  Phone,
  PanelRightOpen,
  Plus,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { PropertyListing } from '@/lib/airtable';
import { useWhiteLabel } from '@/contexts/WhiteLabelContext';
import { useListingCoordinates } from '@/hooks/useListingCoordinates';
import { COORDINATE_FAILURE_COPY } from '@/lib/listings/coordinateFailure.pure';
import { HeatLayer } from './ListingsHeatLayer';
import { ListingStackPager, type StackPager } from './ListingStackPager';
import {
  BASEMAP_CATALOG,
  buildHeatModel,
  colocationKey,
  computePriceTiers,
  describeHeatLegend,
  escapeHtml,
  formatCompactAud,
  formatFullAud,
  getStoredListingPoint,
  groupByCoordinate,
  isBasemapId,
  isHeatFocus,
  isHeatMetric,
  isMapMode,
  listingSetSignature,
  priceTier,
  propertyGlyph,
  resolveStack,
  stepStackIndex,
  PROPERTY_GLYPHS,
  describeAddressCompleteness,
  describeGeocodePrecision,
  summariseStack,
  type BasemapDefinition,
  type BasemapId,
  type StackMember,
  type GeoPoint,
  type HeatFocus,
  type HeatMetric,
  type MapMode,
  type PriceTier,
  type PriceTiers,
  type PropertyGlyph,
  effectiveMaxNativeZoom,
} from '@/lib/listingsMap';
import { PIN_GLYPH_LABELS, PIN_GLYPH_PATHS, pinGlyphSvg } from './listingPinGlyphs';
import { isBuilderStockMapId } from '@/lib/builderStockMapPoint';
import { displayPrice, formatArea } from '@/lib/listingDisplay';
import { listingContact } from '@/lib/listingContact';
import { ListingHero } from './ListingHero';
import { useToast } from '@/hooks/use-toast';
import { useListingImages } from '@/hooks/useListingImages';
import { useAutoFindPhotos } from '@/hooks/useAutoFindPhotos';
import { assessAuPoint } from '../../../supabase/functions/_shared/auGeoSanity.pure';
import { assessAuPostcodePoint } from '../../../supabase/functions/_shared/auPostcodeGeo.pure';
import { BUILD_ID } from '@/lib/buildVersion';

import type { StoredListingImage } from '@/lib/listingImages';
import { hasListingUrl, openListingUrl } from '@/lib/listings/listingLinks.pure';

export type { GeoPoint } from '@/lib/listingsMap';


// Fix default marker icons for bundlers that don't handle Leaflet's asset URLs.
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const AUSTRALIA_CENTER: [number, number] = [-25.2744, 133.7751];
const AUSTRALIA_ZOOM = 4;
const MIN_ZOOM = 3;
const MAX_ZOOM = 19;
/** Below this zoom the price chips overlap into noise, so pins collapse to dots. */
const CHIP_ZOOM_THRESHOLD = 11;

const STORAGE_KEYS = {
  mode: 'npc.listings.map.mode',
  basemap: 'npc.listings.map.basemap',
  metric: 'npc.listings.map.heatMetric',
  focus: 'npc.listings.map.heatFocus',
  panel: 'npc.listings.map.resultsPanel',
} as const;

/**
 * Rows the results panel will hold. Past this the list stops being scannable
 * and the per-pan render stops being free; the overflow is always reported in
 * the panel footer rather than silently dropped.
 */
const IN_VIEW_LIMIT = 250;

type PanelState = 'open' | 'closed';
const isPanelState = (value: unknown): value is PanelState =>
  value === 'open' || value === 'closed';

interface ListingsMapViewProps {
  listings: PropertyListing[];
  onSelectListing: (listing: PropertyListing) => void;
  /** Opens the enquiry composer for a listing, straight from its pin. */
  onEmailAgent?: (listing: PropertyListing) => void;
  /**
   * Resolved imagery from the page, keyed by listing id. Purely additive: a
   * pin whose listing has a stored photograph shows it in the hover card, so
   * the map answers "is this worth a click" with the same photography as the
   * gallery.
   */
  images?: Record<string, StoredListingImage[]>;
  /**
   * The builder-stock layer's controls. Absent where the deployment has no
   * builder stock — the toggle is drawn only when there is something to toggle,
   * because a control that switches nothing on is worse than no control.
   */
  builderStock?: {
    available: boolean;
    shown: boolean;
    onToggle: (next: boolean) => void;
    count: number;
    /** The layer could not be read. The map still draws every listing. */
    failed: boolean;
  };
}

interface ListingMarker {
  listing: PropertyListing;
  point: GeoPoint;
  /**
   * The SAME tuple instance across rebuilds while the coordinates are
   * unchanged. react-leaflet compares `position` by reference and answers
   * every "new" reference with `marker.setLatLng()`, and Leaflet fires `move`
   * even for identical values — so an inline `[lat, lng]` moves every marker
   * on the map on every render, on every filter tick, image wave and hover.
   * A stable tuple makes all of that simply not happen.
   */
  position: [number, number];
  /** Geocoder location_type for the point, when the lookup reported one. */
  precision?: string | null;
}

type PinVariant = 'chip' | 'pin' | 'ghost';

/* -------------------------------------------------------------------------- */
/* Basemaps                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The catalogue lives in `@/lib/listingsMap` with the reasoning attached: it
 * is keyless Esri tile services throughout, because CARTO — where Street and
 * Midnight used to come from — started answering anonymous requests with an
 * "API KEY REQUIRED" watermark baked into every tile.
 */
/**
 * Leaflet's own credit, minus the Ukrainian flag SVG its default attribution
 * prefix carries in 1.9.x. The library is still credited, as its licence asks;
 * the flag is upstream editorial and reads, on a property marketplace, as a
 * statement about the listings rather than about the mapping library.
 */
const LEAFLET_CREDIT =
  '<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>';

const BASEMAP_DEFS = BASEMAP_CATALOG;

const BASEMAP_LABELS: Record<BasemapId, string> = {
  auto: 'Match theme',
  light: 'Street',
  dark: 'Midnight',
  satellite: 'Satellite',
};

function resolveBasemap(preference: BasemapId, isDark: boolean): BasemapDefinition {
  if (preference === 'auto') return isDark ? BASEMAP_DEFS.dark : BASEMAP_DEFS.light;
  return BASEMAP_DEFS[preference];
}

/* -------------------------------------------------------------------------- */
/* Marker icons                                                                */
/* -------------------------------------------------------------------------- */

const CHIP_HEIGHT = 26;
const STEM_HEIGHT = 8;
const PIN_WIDTH = 28;
const PIN_HEIGHT = 36;
const GHOST_SIZE = 22;

/**
 * Teardrop outline on a 28×36 grid: a 10.8r head centred at (14, 12.8) drawn
 * with a single half-circle arc, tapering to a point at (14, 34.6). The 1.4
 * units of slack under the tip leave room for the stroke.
 */
const TEARDROP_PATH =
  'M14 34.6c0 0 10.8-13.3 10.8-21.8a10.8 10.8 0 1 0-21.6 0C3.2 21.3 14 34.6 14 34.6Z';

/** Where the drawn tip sits, so the anchor lands on the coordinate, not the box. */
const PIN_TIP_Y = 34.6;

/** Glyph box inside the pin head, sized to sit inside the 7.6r face disc. */
const PIN_SYMBOL_SCALE = 10.5 / 24;
const PIN_SYMBOL_OFFSET = 14 - 10.5 / 2;

function teardropSvg(glyph: PropertyGlyph): string {
  return (
    `<svg class="listing-pin__marker" viewBox="0 0 ${PIN_WIDTH} ${PIN_HEIGHT}" aria-hidden="true" focusable="false">` +
    `<path class="listing-pin__body" d="${TEARDROP_PATH}"/>` +
    '<circle class="listing-pin__face" cx="14" cy="12.8" r="7.6"/>' +
    `<g class="listing-pin__symbol" transform="translate(${PIN_SYMBOL_OFFSET} ${12.8 - 10.5 / 2}) scale(${PIN_SYMBOL_SCALE})">` +
    `<path fill-rule="evenodd" d="${PIN_GLYPH_PATHS[glyph]}"/>` +
    '</g></svg>'
  );
}

const HALO_HTML = '<span class="listing-pin__halo" aria-hidden="true"></span>';

const iconCache = new Map<string, L.DivIcon>();

function cacheIcon(key: string, factory: () => L.DivIcon): L.DivIcon {
  const hit = iconCache.get(key);
  if (hit) return hit;
  // Labels are unbounded (one per distinct price), so keep the cache honest.
  if (iconCache.size > 600) iconCache.clear();
  const icon = factory();
  iconCache.set(key, icon);
  return icon;
}

/**
 * `idle` | the listing whose popup is open | the listing under the pointer in
 * the results panel. Peek is carried by the icon rather than by adding a class
 * to the marker's element: react-leaflet tears marker elements down and rebuilds
 * them on later commits, so a hand-applied class survives only until the next
 * render — which is how the highlight silently stopped appearing at all.
 */
type PinState = 'idle' | 'active' | 'peek';

function pinIcon(
  variant: PinVariant,
  tier: PriceTier,
  glyph: PropertyGlyph,
  label: string | null,
  pinState: PinState,
  approx = false,
): L.DivIcon {
  const active = pinState === 'active';
  const state =
    (pinState === 'active' ? ' listing-pin--active' : pinState === 'peek' ? ' listing-pin--peek' : '') +
    // Suburb-centroid pins are dressed differently so precision is visible at
    // a glance, not only in the hover card.
    (approx ? ' listing-pin--approx' : '');

  if (variant === 'ghost') {
    return cacheIcon(`ghost|${pinState}|${approx}`, () =>
      L.divIcon({
        className: `listing-pin listing-pin--ghost${state}`,
        html: '<span class="listing-pin__dot"></span>',
        iconSize: [GHOST_SIZE, GHOST_SIZE],
        iconAnchor: [GHOST_SIZE / 2, GHOST_SIZE / 2],
        popupAnchor: [0, -GHOST_SIZE / 2],
      }),
    );
  }

  if (variant === 'pin' || !label) {
    return cacheIcon(`pin|${tier}|${glyph}|${pinState}|${approx}`, () =>
      L.divIcon({
        className: `listing-pin listing-pin--pin listing-pin--${tier}${state}`,
        html: (active ? HALO_HTML : '') + teardropSvg(glyph),
        iconSize: [PIN_WIDTH, PIN_HEIGHT],
        // The teardrop points at the coordinate, so the anchor is the drawn tip.
        iconAnchor: [PIN_WIDTH / 2, PIN_TIP_Y],
        // Clear the head, which reaches y≈2 — i.e. 32.6 above the anchor.
        popupAnchor: [0, -(PIN_TIP_Y - 2)],
      }),
    );
  }

  return cacheIcon(`chip|${tier}|${glyph}|${label}|${pinState}|${approx}`, () => {
    // Estimated so the icon box matches the rendered chip: Leaflet needs real
    // dimensions for hit-testing, anchoring, and cluster spiderfy geometry.
    // 40 covers the glyph disc, gutters and border; 7 is a generous per-character
    // width for 11px bold tabular digits, so the box never crops the label.
    const width = Math.max(58, Math.round(40 + label.length * 7));
    const height = CHIP_HEIGHT + STEM_HEIGHT;
    return L.divIcon({
      className: `listing-pin listing-pin--chip listing-pin--${tier}${state}`,
      html:
        (active ? HALO_HTML : '') +
        '<span class="listing-pin__chip">' +
        `<span class="listing-pin__glyph">${pinGlyphSvg(glyph, 'listing-pin__glyph-svg')}</span>` +
        `<span class="listing-pin__label">${escapeHtml(label)}</span>` +
        '</span>' +
        '<span class="listing-pin__stem" aria-hidden="true"></span>',
      iconSize: [width, height],
      iconAnchor: [width / 2, height],
      popupAnchor: [0, -height],
    });
  });
}

/**
 * The mark for several properties standing on ONE coordinate.
 *
 * It is a pin, not a bubble: it points at the coordinate the way every other
 * pin does, because that coordinate is exactly where these properties are. The
 * count rides as a badge rather than replacing the pin, so the mark still reads
 * as "a property here" first and "and there are more of them" second — which is
 * the truth, and is what the old cluster bubble could never say.
 */
function stackIcon(
  variant: PinVariant,
  tier: PriceTier,
  glyph: PropertyGlyph,
  count: number,
  pinState: PinState,
  approx = false,
): L.DivIcon {
  const active = pinState === 'active';
  const state =
    (pinState === 'active'
      ? ' listing-pin--active'
      : pinState === 'peek'
        ? ' listing-pin--peek'
        : '') + (approx ? ' listing-pin--approx' : '');
  const compact = count > 99 ? '99+' : String(count);
  const badge = `<span class="listing-pin__count">${escapeHtml(compact)}</span>`;

  if (variant === 'ghost') {
    return cacheIcon(`stack-ghost|${compact}|${pinState}|${approx}`, () =>
      L.divIcon({
        className: `listing-pin listing-pin--ghost listing-pin--stack${state}`,
        html: '<span class="listing-pin__dot"></span>' + badge,
        iconSize: [GHOST_SIZE, GHOST_SIZE],
        iconAnchor: [GHOST_SIZE / 2, GHOST_SIZE / 2],
        popupAnchor: [0, -GHOST_SIZE / 2],
      }),
    );
  }

  return cacheIcon(`stack|${tier}|${glyph}|${compact}|${pinState}|${approx}`, () =>
    L.divIcon({
      className: `listing-pin listing-pin--pin listing-pin--stack listing-pin--${tier}${state}`,
      html: (active ? HALO_HTML : '') + teardropSvg(glyph) + badge,
      iconSize: [PIN_WIDTH, PIN_HEIGHT],
      iconAnchor: [PIN_WIDTH / 2, PIN_TIP_Y],
      popupAnchor: [0, -(PIN_TIP_Y - 2)],
    }),
  );
}


/**
 * "You are here". Deliberately nothing like a listing pin — it is a fact about
 * the viewer, not a record on the map, so it stays a dot and never a teardrop.
 */
const USER_LOCATION_ICON = L.divIcon({
  className: 'listings-locator',
  html:
    '<span class="listings-locator__pulse" aria-hidden="true"></span>' +
    '<span class="listings-locator__dot" aria-hidden="true"></span>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

/* -------------------------------------------------------------------------- */
/* Persisted preference hook                                                   */
/* -------------------------------------------------------------------------- */

function usePersistedChoice<T extends string>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return fallback;
    try {
      const stored = window.localStorage.getItem(key);
      return isValid(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* storage can be unavailable (private mode, quota) — preference is optional */
      }
    },
    [key],
  );

  return [value, update];
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* -------------------------------------------------------------------------- */
/* Presentational pieces                                                       */
/* -------------------------------------------------------------------------- */

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: typeof MapPin;
  title?: string;
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (next: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 rounded-full border border-border/60 bg-background/85 shadow-md backdrop-blur',
        size === 'md' ? 'p-1' : 'p-0.5',
      )}
      role="group"
      aria-label={label}
    >
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon, title }) => {
        const active = value === optionValue;
        return (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            aria-pressed={active}
            title={title ?? optionLabel}
            className={cn(
              'flex items-center gap-1.5 rounded-full font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              size === 'md' ? 'px-3 py-1.5 text-xs' : 'px-2.5 py-1 text-[11px]',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
            {optionLabel}
          </button>
        );
      })}
    </div>
  );
}

function MapIconButton({
  label,
  onClick,
  children,
  disabled,
  active,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  /** Sticky on/off controls report their state, not just their action. */
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      title={label}
      className={cn(
        'flex h-9 w-9 items-center justify-center border-b border-border/50 transition-colors',
        'first:rounded-t-xl last:rounded-b-xl last:border-b-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50',
        'disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
          : 'bg-background/90 text-foreground hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

/**
 * One set of words, shared with the hook that decides which of them applies.
 *
 * It used to be declared here with four readings, and three different server
 * conditions collapsed onto one of them — see `coordinateFailure.pure.ts`.
 */
const FAILURE_COPY = COORDINATE_FAILURE_COPY;

const PIN_TIER_LEGEND: Array<{ tier: PriceTier; label: string }> = [
  { tier: 'low', label: 'Lower quartile' },
  { tier: 'mid', label: 'Below median' },
  { tier: 'high', label: 'Upper mid' },
  { tier: 'top', label: 'Top quartile' },
];

const LEGEND_HEADING = 'text-[10px] font-semibold uppercase tracking-wide text-muted-foreground';

/** The same glyph the pins carry, so the key is read as the map is read. */
function PinGlyphSwatch({ glyph }: { glyph: PropertyGlyph }) {
  return (
    <span className="listings-glyph-swatch" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path fillRule="evenodd" d={PIN_GLYPH_PATHS[glyph]} />
      </svg>
    </span>
  );
}

function PinLegend({
  tiers,
  hasBuilderStock,
}: {
  tiers: PriceTiers | null;
  /**
   * The builder line is drawn only when builder stock is actually on the map.
   * A key to a mark nobody can see is noise, and this legend is already dense.
   */
  hasBuilderStock: boolean;
}) {
  return (
    <div className="space-y-2.5">
      {tiers && (
        <div className="space-y-1.5">
          <p className={LEGEND_HEADING}>Pin colour · price band</p>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
            {PIN_TIER_LEGEND.map(({ tier, label }) => (
              <li key={tier} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span
                  className={`listings-tier-swatch listings-tier-swatch--${tier}`}
                  aria-hidden="true"
                />
                {label}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1.5">
        <p className={LEGEND_HEADING}>Pin icon · property type</p>
        <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
          {PROPERTY_GLYPHS.map((glyph) => (
            <li key={glyph} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <PinGlyphSwatch glyph={glyph} />
              {PIN_GLYPH_LABELS[glyph]}
            </li>
          ))}
        </ul>
      </div>

      {hasBuilderStock && (
        <div className="space-y-1.5">
          <p className={LEGEND_HEADING}>Pin icon · source</p>
          <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
            <li className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <PinGlyphSwatch glyph="builder" />
              {PIN_GLYPH_LABELS.builder}
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* In-view results panel                                                       */
/* -------------------------------------------------------------------------- */

/** The pin's own mark, at list scale, so a row and its pin are the same object. */
function RowMark({ tier, glyph }: { tier: PriceTier; glyph: PropertyGlyph }) {
  return (
    <span className={`listings-row-mark listings-row-mark--${tier}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path fillRule="evenodd" d={PIN_GLYPH_PATHS[glyph]} />
      </svg>
    </span>
  );
}

interface ResultsPanelProps {
  rows: ListingMarker[];
  total: number;
  tiers: PriceTiers | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onClose: () => void;
}

/**
 * The listings currently inside the viewport, as a real list.
 *
 * Two things it fixes. Pins are only reachable with a pointer — a marker in a
 * collapsed cluster has no DOM node at all — so this is the only keyboard route
 * to the map's contents. And a map answers "where" far better than "which";
 * sorted by price, the panel answers the second question without leaving it.
 */
function ResultsPanel({
  rows,
  total,
  tiers,
  selectedId,
  onSelect,
  onHover,
  onClose,
}: ResultsPanelProps) {
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const pa = typeof a.listing.price === 'number' && a.listing.price > 0 ? a.listing.price : -1;
        const pb = typeof b.listing.price === 'number' && b.listing.price > 0 ? b.listing.price : -1;
        // Priced listings first, dearest at the top; undisclosed sink to the end.
        if (pa !== pb) return pb - pa;
        return (a.listing.address || '').localeCompare(b.listing.address || '');
      }),
    [rows],
  );

  return (
    <div
      id="listings-map-results"
      className="flex h-72 min-h-0 shrink-0 flex-col border-t border-border/60 bg-background/95 backdrop-blur lg:h-auto lg:w-80 lg:border-l lg:border-t-0"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            In this view
          </p>
          <p className="truncate text-xs text-foreground">
            <span className="font-semibold tabular-nums">{total}</span>
            {total === 1 ? ' listing' : ' listings'}
            <span className="text-muted-foreground"> · dearest first</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the results panel"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          No listings in view. Pan the map, or zoom out to bring stock back.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border/40 overflow-y-auto">
          {sorted.map(({ listing }) => {
            const tier = priceTier(listing.price, tiers);
            const glyph = isBuilderStockMapId(listing.id)
              ? 'builder'
              : propertyGlyph(listing.propertyType);
            const active = listing.id === selectedId;
            const locality = [listing.suburb, listing.state].filter(Boolean).join(' ');
            const beds = listing.beds ?? listing.bedrooms;
            const baths = listing.baths ?? listing.bathrooms;
            const meta = [
              beds ? `${beds} bed` : null,
              baths ? `${baths} bath` : null,
              listing.propertyType || null,
            ]
              .filter(Boolean)
              .join(' · ');

            return (
              <li key={listing.id}>
                <button
                  type="button"
                  onClick={() => onSelect(listing.id)}
                  onMouseEnter={() => onHover(listing.id)}
                  onMouseLeave={() => onHover(null)}
                  onFocus={() => onHover(listing.id)}
                  onBlur={() => onHover(null)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50',
                    active ? 'bg-primary/10' : 'hover:bg-muted/60',
                  )}
                >
                  <RowMark tier={tier} glyph={glyph} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-foreground">
                      {listing.address || listing.title || 'Untitled listing'}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {locality || 'No locality on record'}
                    </span>
                    {meta ? (
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                        {meta}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
                    {formatCompactAud(listing.price) ?? (
                      <span className="font-normal text-muted-foreground">—</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {total > sorted.length && (
        <p className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
          Showing the first <span className="tabular-nums">{sorted.length}</span> of{' '}
          <span className="tabular-nums">{total}</span> in view — zoom in to narrow the list.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Markers layer                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The hover card a pin shows before anyone commits to a click.
 *
 * The pins already carry a price chip; this adds the two facts that decide
 * whether a click is worth it — the address and the spec line — in the same
 * reading order as the gallery card, so the map and the grid describe a
 * listing identically. Bound lazily on first hover: fourteen hundred prebuilt
 * tooltips would be DOM ballast for the handful anyone touches.
 */
function pinTooltipHtml(
  listing: PropertyListing,
  photoUrl?: string | null,
  precision?: string | null,
): string {
  const beds = listing.beds ?? listing.bedrooms;
  const baths = listing.baths ?? listing.bathrooms;
  const specs = [
    beds ? `${beds} bed` : null,
    baths ? `${baths} bath` : null,
    listing.carSpaces ? `${listing.carSpaces} car` : null,
    listing.propertyType ?? null,
  ]
    .filter(Boolean)
    .join(' · ');
  const address = listing.address || listing.suburb || 'Listing';
  return (
    // The photograph, when the page has already resolved one — the same
    // signed URL the gallery card is rendering, so hovering a pin shows the
    // property itself, not just its numbers.
    (photoUrl
      ? `<img class="listings-pin-tip__photo" src="${escapeHtml(photoUrl)}" alt="" loading="lazy" />`
      : '') +
    `<span class="listings-pin-tip__price">${escapeHtml(formatFullAud(listing.price) ?? 'Price on request')}</span>` +
    `<span class="listings-pin-tip__address">${escapeHtml(address)}</span>` +
    (specs ? `<span class="listings-pin-tip__specs">${escapeHtml(specs)}</span>` : '') +
    (() => {
      const note = describeGeocodePrecision(precision).note;
      return note
        ? `<span class="listings-pin-tip__specs listings-pin-tip__note">${escapeHtml(note)}</span>`
        : '';
    })()
  );
}


/**
 * What a stack says on hover: how many, what they are worth, and — because
 * they share a coordinate — what they actually are. Unlike the cluster tooltip
 * this replaces, it never has to explain WHERE, since every member is at the
 * pin.
 */
function stackTooltipHtml(members: ListingMarker[], tiers: PriceTiers | null): string {
  const summary = summariseStack(
    members.map((m) => ({
      price: typeof m.listing.price === 'number' ? m.listing.price : null,
      tier: priceTier(m.listing.price, tiers),
    })),
  );
  const median = formatCompactAud(summary.median);
  const where =
    members[0].listing.address ||
    [members[0].listing.suburb, members[0].listing.state].filter(Boolean).join(' ') ||
    null;

  const lines = members.slice(0, 4).map((m) => {
    const price = formatCompactAud(m.listing.price) ?? 'Price on request';
    const what =
      m.listing.address || m.listing.title || m.listing.propertyType || 'Listing';
    return `<span class="listings-pin-tip__row">${escapeHtml(price)} · ${escapeHtml(what)}</span>`;
  });
  const rest = members.length - lines.length;

  return (
    `<span class="listings-pin-tip__price">${escapeHtml(
      `${summary.count} propert${summary.count === 1 ? 'y' : 'ies'} here${median ? ` · median ${median}` : ''}`,
    )}</span>` +
    (where ? `<span class="listings-pin-tip__address">${escapeHtml(where)}</span>` : '') +
    lines.join('') +
    // Say what the click DOES. Without this the reader has no way of knowing
    // the properties under the top one are reachable at all — which is the
    // whole job the spiderfy used to do.
    `<span class="listings-pin-tip__specs">${escapeHtml(
      rest > 0
        ? `+${rest} more — click to step through all ${summary.count}`
        : `Click to step through all ${summary.count}`,
    )}</span>`
  );
}

interface ListingMarkersProps {
  markers: ListingMarker[];
  tiers: PriceTiers | null;
  /**
   * Read through a ref, deliberately. Image resolution delivers in waves, and
   * passing the record itself re-rendered fourteen hundred markers — and
   * rebound every one of their event listeners — on each wave. The ref's
   * identity never changes, so the memo holds; the hover handler reads
   * whatever imagery has arrived by the time someone actually hovers.
   */
  imagesRef: React.MutableRefObject<Record<string, StoredListingImage[]> | undefined>;
  variant: PinVariant;
  selectedId: string | null;
  /** The listing under the pointer in the results panel, if any. */
  hoveredId: string | null;
  onSelect: (id: string) => void;
  /** Keeps a live id → marker index so the results panel can reach a pin. */
  registerMarker: (id: string, marker: L.Marker | null) => void;
}

const ListingMarkers = memo(function ListingMarkers({
  markers,
  tiers,
  imagesRef,
  variant,
  selectedId,
  hoveredId,
  onSelect,
  registerMarker,
}: ListingMarkersProps) {
  /**
   * One mark per COORDINATE, never per neighbourhood.
   *
   * Proximity clustering used to sit here. Its bubble is drawn at one member's
   * position while standing for properties spread over hundreds of kilometres,
   * so its location carries no meaning — and a mark on a map that carries no
   * location is indistinguishable from a pin in the wrong place. It was read as
   * a wrong pin every time it was looked at.
   *
   * Grouping by exact coordinate keeps the one case that genuinely needs a
   * count — the corpus stacks properties on identical points, twenty-six on one
   * Traralgon address and a whole builder release on one suburb centroid, where
   * only the top pin was clickable and the rest were invisible — while
   * guaranteeing that every mark stands exactly where its properties are.
   */
  const groups = useMemo(
    () => groupByCoordinate(markers, (m) => m.point),
    [markers],
  );

  if (markers.length === 0) return null;

  return (
    <>
      {groups.map((group) => {
        // The representative: the selected or hovered member if this stack
        // holds one, so a stack lights up when its listing is chosen, and
        // otherwise the first — which is the caller's own ordering.
        const active = group.members.find((m) => m.listing.id === selectedId);
        const peeked = group.members.find((m) => m.listing.id === hoveredId);
        const lead = active ?? peeked ?? group.members[0];
        const { listing, position, precision } = lead;
        const count = group.members.length;

        const label = formatCompactAud(listing.price);
        const tier = priceTier(listing.price, tiers);
        // Builder stock is marked by WHERE IT CAME FROM, not by its type: a
        // builder's house and an agent's house are the same property type and
        // a reader needs to tell the two offers apart.
        const glyph = isBuilderStockMapId(listing.id)
          ? 'builder'
          : propertyGlyph(listing.propertyType);
        const approx = describeGeocodePrecision(precision).tier === 'area';
        const pinState: PinState = active ? 'active' : peeked ? 'peek' : 'idle';
        const title =
          count > 1
            ? `${count} properties at ${listing.address || listing.suburb || 'this location'}`
            : [
                listing.address || listing.suburb || 'Listing',
                listing.propertyType,
                formatFullAud(listing.price),
              ]
                .filter(Boolean)
                .join(' · ');

        return (
          <Marker
            key={group.key}
            ref={(instance) => {
              // Every member resolves to this stack's marker, so the results
              // panel can reach a listing that is underneath another one.
              for (const member of group.members) {
                registerMarker(member.listing.id, instance);
              }
            }}
            position={position}
            icon={
              count > 1
                ? stackIcon(variant, tier, glyph, count, pinState, approx)
                : pinIcon(variant, tier, glyph, label, pinState, approx)
            }
            // Lift the open (or peeked) listing clear of its neighbours so the
            // highlighted pin is never buried under the ones around it.
            zIndexOffset={pinState === 'active' ? 1200 : pinState === 'peek' ? 900 : 0}
            alt={title}
            riseOnHover
            keyboard
            eventHandlers={{
              click: () => onSelect(lead.listing.id),
              mouseover: (event) => {
                // Rebuilt on every hover rather than bound once: the page's
                // image resolution may have delivered this listing's
                // photograph since the last look, and the card should show it.
                const marker = event.target as L.Marker;
                const html =
                  count > 1
                    ? stackTooltipHtml(group.members, tiers)
                    : pinTooltipHtml(
                        listing,
                        imagesRef.current?.[listing.id]?.[0]?.url ?? null,
                        precision,
                      );
                if (marker.getTooltip()) marker.setTooltipContent(html);
                else {
                  marker.bindTooltip(html, {
                    direction: 'top',
                    offset: L.point(0, -14),
                    opacity: 1,
                    className: 'listings-pin-tip',
                  });
                }
                marker.openTooltip();
              },
            }}
          />
        );
      })}
    </>
  );
});


/* -------------------------------------------------------------------------- */
/* Popup card                                                                  */
/* -------------------------------------------------------------------------- */

function MetaChip({ icon: Icon, value }: { icon: typeof BedDouble; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground">
      <Icon className="h-3 w-3 text-muted-foreground" />
      {value}
    </span>
  );
}

/** A small outline tag. The popup uses several and they must not drift apart. */
function PopupTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

function ListingPopupCard({
  listing,
  point,
  precision,
  pager,
  onOpenDetails,
  onEmailAgent,
}: {
  listing: PropertyListing;
  point: GeoPoint;
  precision?: string | null;
  /** Present only where more than one property shares this exact point. */
  pager?: StackPager | null;
  onOpenDetails: () => void;
  onEmailAgent?: () => void;
}) {
  const locality = [listing.suburb, listing.state, listing.zipCode].filter(Boolean).join(' ');
  // What the provider managed, else what the record could offer. The second
  // reading is the actionable one — "nobody has told us the street number" is
  // a different problem from "we could not find the address we were given".
  const precisionNote =
    describeGeocodePrecision(precision).note
    ?? describeAddressCompleteness(listing.addressPrecision);
  // The same decision the card and the table make, so one listing cannot read
  // "$1,599,000" in the grid and "Price undisclosed" in the popup.
  const price = displayPrice(listing);
  const beds = listing.beds ?? listing.bedrooms;
  const baths = listing.baths ?? listing.bathrooms;

  // Never the raw field: an Airtable attachment is an object whose signed `url`
  // has usually expired by the time anyone clicks, so rendering it straight
  // produces a broken image. `useListingImages` returns signed URLs into our
  // own bucket instead — see src/lib/listingImages.ts.
  const forImages = useMemo(() => [listing], [listing]);
  const { images, isResolving: imagesResolving, refresh: refreshImages } = useListingImages(forImages);
  // The popup is where someone lands after zooming into a suburb, so it is a
  // likely place to open a listing that has no photographs — and the cascade
  // treats it like every other surface: the source page is searched without
  // being asked, and anything found appears in the carousel.
  const { searchingId } = useAutoFindPhotos(forImages, images, imagesResolving, refreshImages);

  /**
   * Keep clicks inside the card away from the map.
   *
   * Leaflet treats a click anywhere in its container as a map click, and with
   * `closePopupOnClick` on by default that tears the popup down — so pressing a
   * control in the popup closed the popup instead of operating the control.
   * Leaflet's own `disableClickPropagation` covers mousedown, which is what the
   * map's drag/click detection keys off. `click` itself must NOT be stopped
   * here: React 18 listens at the app root, so swallowing the click below that
   * point means no handler inside the popup ever runs.
   */
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    L.DomEvent.disableClickPropagation(node);
    L.DomEvent.disableScrollPropagation(node);

    // Inside a Leaflet popup the browser delivers `mousedown` and `mouseup` to a
    // control but never synthesises the `click` between them, so every button in
    // this card was dead to the mouse while still working from the keyboard —
    // including "Open details", which predates this change. Re-issue the
    // activation ourselves, and only when the browser genuinely did not.
    let pressed: HTMLElement | null = null;
    let sawClick = false;
    const control = (event: Event) =>
      (event.target as HTMLElement | null)?.closest<HTMLElement>('button, [role="button"]') ?? null;

    const onDown = (event: Event) => {
      pressed = control(event);
      sawClick = false;
    };
    const onClick = () => {
      sawClick = true;
    };
    const onUp = (event: Event) => {
      const target = pressed;
      pressed = null;
      if (!target || target !== control(event)) return;
      window.setTimeout(() => {
        if (!sawClick && target.isConnected) target.click();
      }, 0);
    };

    node.addEventListener('mousedown', onDown, true);
    node.addEventListener('click', onClick, true);
    node.addEventListener('mouseup', onUp, true);
    return () => {
      node.removeEventListener('mousedown', onDown, true);
      node.removeEventListener('click', onClick, true);
      node.removeEventListener('mouseup', onUp, true);
    };
  }, []);

  const contact = listingContact(listing);
  const land = formatArea(listing.landSizeSqm);
  const photoCount = images[listing.id]?.length ?? 0;
  const inspection = listing.inspectionStart ?? listing.nextInspectionDate;

  return (
    <div ref={cardRef} className="min-w-[268px] max-w-[300px] space-y-2.5">
      {pager ? (
        <ListingStackPager pager={pager} where={listing.suburb || listing.address} />
      ) : null}
      {/*
        The whole gallery, with Street View as its last slide.

        This used to be a single 112px frame showing EITHER one photograph OR
        Street View, behind a toggle that only rendered when a photograph
        existed. Since no listing had one, every popup silently showed Street
        View and gave no hint a photograph was ever expected — which is why the
        map appeared to know nothing about the property beyond where it was.
      */}
      <ListingHero
        images={images[listing.id]}
        isResolving={imagesResolving}
        label={listing.address || listing.suburb || undefined}
        point={point}
        aspect="aspect-[16/10]"
        onExpand={onOpenDetails}
        isFindingPhotos={searchingId === listing.id}
        listing={listing}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-snug text-foreground">
            {listing.address || listing.title || 'Address not extracted'}
          </h3>
          {locality ? <p className="text-xs text-muted-foreground">{locality}</p> : null}
          {precisionNote ? (
            // The pin's honesty, repeated where the decision is made: someone
            // about to drive to this property should know the pin marks the
            // suburb, not the letterbox.
            <p className="text-[11px] font-medium text-warning">{precisionNote}</p>
          ) : null}
        </div>
        {photoCount > 1 ? (
          <span className="shrink-0 rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
            {photoCount}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {price.known ? (
          <span className="text-sm font-semibold tabular-nums text-primary">{price.text}</span>
        ) : (
          <span className="text-xs font-medium text-muted-foreground">{price.text}</span>
        )}
        {price.isRent ? <PopupTag>Rental</PopupTag> : null}
        {listing.propertyType ? <PopupTag>{listing.propertyType}</PopupTag> : null}
        {listing.listingStatus ? <PopupTag>{listing.listingStatus}</PopupTag> : null}
      </div>

      {(beds || baths || listing.carSpaces || land) && (
        <div className="flex flex-wrap gap-1.5">
          {beds ? <MetaChip icon={BedDouble} value={`${beds} bed`} /> : null}
          {baths ? <MetaChip icon={Bath} value={`${baths} bath`} /> : null}
          {listing.carSpaces ? <MetaChip icon={Car} value={`${listing.carSpaces} car`} /> : null}
          {land ? <MetaChip icon={Building2} value={land} /> : null}
        </div>
      )}

      {(listing.agencyName || listing.agentName) && (
        <p className="truncate text-xs text-muted-foreground">
          {[listing.agentName, listing.agencyName].filter(Boolean).join(' · ')}
        </p>
      )}

      {/*
        Contact from the pin itself. Someone scanning the map for a suburb wants
        to ask about what they found without first opening a page — the whole
        reason the popup exists is to answer "what is this and who do I ask".
      */}
      {(contact.email || contact.phone) && (
        <div className="flex gap-1.5">
          {contact.email ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 flex-1 text-[11px]"
              onClick={() => onEmailAgent?.()}
            >
              <Mail className="mr-1 h-3 w-3" aria-hidden="true" />
              Email agent
            </Button>
          ) : null}
          {contact.phone ? (
            <Button
              size="sm"
              variant="outline"
              className={cn('h-7 text-[11px]', !contact.email && 'flex-1')}
              onClick={() => window.open(`tel:${contact.phone!.replace(/\s/g, '')}`, '_self')}
            >
              <Phone className="h-3 w-3" aria-hidden="true" />
              {!contact.email && <span className="ml-1">{contact.phone}</span>}
            </Button>
          ) : null}
        </div>
      )}

      {inspection ? (
        <p className="flex items-center gap-1 text-xs font-medium text-primary">
          <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
          {new Date(inspection).toLocaleString('en-AU', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </p>
      ) : null}

      <div className="flex gap-1.5 pt-0.5">
        <Button size="sm" className="flex-1" onClick={onOpenDetails}>
          Open details
        </Button>
        {hasListingUrl(listing.url) ? (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            aria-label="Open the source listing"
            onClick={() => openListingUrl(listing.url)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main view                                                                   */
/* -------------------------------------------------------------------------- */

export function ListingsMapView({
  listings,
  onSelectListing,
  onEmailAgent,
  images,
  builderStock,
}: ListingsMapViewProps) {
  // Stable identity for the marker layer; see ListingMarkersProps.imagesRef.
  const imagesRef = useRef<Record<string, StoredListingImage[]> | undefined>(images);
  imagesRef.current = images;

  const { isDark } = useWhiteLabel();
  const [mode, setMode] = usePersistedChoice<MapMode>(STORAGE_KEYS.mode, 'hybrid', isMapMode);
  const [basemapPref, setBasemapPref] = usePersistedChoice<BasemapId>(
    STORAGE_KEYS.basemap,
    'auto',
    isBasemapId,
  );
  const [heatMetric, setHeatMetric] = usePersistedChoice<HeatMetric>(
    STORAGE_KEYS.metric,
    'density',
    isHeatMetric,
  );
  const [heatFocus, setHeatFocus] = usePersistedChoice<HeatFocus>(
    STORAGE_KEYS.focus,
    'balanced',
    isHeatFocus,
  );

  const [panelState, setPanelState] = usePersistedChoice<PanelState>(
    STORAGE_KEYS.panel,
    'closed',
    isPanelState,
  );

  const [map, setMap] = useState<L.Map | null>(null);
  const [zoom, setZoom] = useState(AUSTRALIA_ZOOM);
  const [inViewCount, setInViewCount] = useState<number | null>(null);
  const [inViewRows, setInViewRows] = useState<ListingMarker[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  const [locating, setLocating] = useState(false);
  const [userLocation, setUserLocation] = useState<
    { lat: number; lng: number; accuracy: number } | null
  >(null);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const mapFrameRef = useRef<HTMLDivElement | null>(null);
  const [frameHeight, setFrameHeight] = useState(0);
  const popupRef = useRef<L.Popup | null>(null);
  const markersRef = useRef<ListingMarker[]>([]);
  const markerIndexRef = useRef(new Map<string, L.Marker>());
  const userMovedRef = useRef(false);
  const programmaticUntilRef = useRef(0);
  const reducedMotion = useMemo(prefersReducedMotion, []);
  const { toast } = useToast();

  const { points, isResolving, failure, retry } = useListingCoordinates(listings);

  // The accuracy gate. Every plotted point must survive the Australian
  // geography check — country bounds, and the record's own state where it
  // names one. A coordinate that fails is not plotted *anywhere*: not as a
  // pin, not into a cluster centroid, not into the heat surface. It joins the
  // unmapped list with its reason, which is the honest outcome — a pin in the
  // Southern Ocean is not "mapped", it is wrong with confidence.
  const positionCache = useRef(new Map<string, [number, number]>());
  const { markers, unmapped } = useMemo(() => {
    const rows: ListingMarker[] = [];
    const held: Array<{ listing: PropertyListing; reason: 'no_coordinates' | 'failed_check' }> =
      [];
    for (const listing of listings) {
      const resolved = points[listing.id];
      const point = resolved
        ? { lat: resolved.lat, lng: resolved.lng }
        : getStoredListingPoint(listing);
      if (!point) {
        held.push({ listing, reason: 'no_coordinates' });
        continue;
      }
      if (
        !assessAuPoint(point.lat, point.lng, listing.state).ok ||
        !assessAuPostcodePoint(point.lat, point.lng, listing.zipCode).ok
      ) {
        held.push({ listing, reason: 'failed_check' });
        continue;
      }
      const cache = positionCache.current;
      const prior = cache.get(listing.id);
      const position: [number, number] =
        prior && prior[0] === point.lat && prior[1] === point.lng
          ? prior
          : [point.lat, point.lng];
      cache.set(listing.id, position);
      rows.push({ listing, point, position, precision: resolved?.precision ?? null });
    }
    return { markers: rows, unmapped: held };
  }, [listings, points]);

  markersRef.current = markers;

  const tiers = useMemo(
    () =>
      computePriceTiers(
        markers.map((m) => (typeof m.listing.price === 'number' ? m.listing.price : 0)),
      ),
    [markers],
  );

  const heatModel = useMemo(() => buildHeatModel(markers, heatMetric), [markers, heatMetric]);
  const heatLegend = useMemo(() => describeHeatLegend(heatModel), [heatModel]);

  const showPins = mode === 'pins' || mode === 'hybrid';
  const showHeat = mode === 'heat' || mode === 'hybrid';
  const pinVariant: PinVariant = !showPins
    ? 'ghost'
    : zoom >= CHIP_ZOOM_THRESHOLD
      ? 'chip'
      : 'pin';

  const heatLegendVisible = showHeat && heatModel.points.length > 0;

  const basemap = resolveBasemap(basemapPref, isDark);
  /*
    Whether Leaflet's retina branch is the one that will run for this layer.
    Read from Leaflet itself rather than from `devicePixelRatio` directly, so
    the cap below can only ever disagree with the offset Leaflet actually adds
    if Leaflet changes its own mind.
  */
  const retinaTiles = Boolean(L.Browser?.retina);
  const selected = useMemo(
    () => markers.find((m) => m.listing.id === selectedId) ?? null,
    [markers, selectedId],
  );

  /**
   * Everything standing on the open listing's exact point, in the caller's
   * order, and where the reader is inside it. This is the whole of what makes
   * the properties under the top pin reachable, so it lives in a tested pure
   * function rather than inline here.
   */
  const stack = useMemo(
    () => resolveStack(markers, selected, (m) => m.point),
    [markers, selected],
  );

  const stepStack = useCallback(
    (delta: number) => {
      if (stack.members.length < 2 || stack.index < 0) return;
      const next = stepStackIndex(stack.index, delta, stack.members.length);
      setSelectedId(stack.members[next].listing.id);
    },
    [stack],
  );

  const stackPager = useMemo(
    () =>
      stack.members.length > 1 && stack.index >= 0
        ? { index: stack.index, total: stack.members.length, onStep: stepStack }
        : null,
    [stack, stepStack],
  );

  // By value, not by render: `position={[lat, lng]}` inline hands react-leaflet
  // a new array every render, and it responds to every "new" position with
  // popup.setLatLng — which re-runs Leaflet's auto-pan every time. A popup
  // that pans on every unrelated re-render is the spasm a screenshot caught.
  const selectedLat = selected?.point.lat;
  const selectedLng = selected?.point.lng;
  const popupPosition = useMemo<[number, number] | null>(
    () => (selectedLat !== undefined && selectedLng !== undefined ? [selectedLat, selectedLng] : null),
    [selectedLat, selectedLng],
  );

  const markerSignature = useMemo(
    () => listingSetSignature(markers.map((m) => ({ id: m.listing.id }))),
    [markers],
  );
  const listingSignature = useMemo(() => listingSetSignature(listings), [listings]);

  /* ---------------------------------------------------------------------- */
  /* Map wiring                                                              */
  /* ---------------------------------------------------------------------- */

  const markProgrammatic = useCallback(() => {
    programmaticUntilRef.current =
      (typeof performance !== 'undefined' ? performance.now() : 0) + 600;
  }, []);

  const fitToMarkers = useCallback(
    (animate: boolean) => {
      const instance = map;
      const rows = markersRef.current;
      if (!instance || rows.length === 0) return;
      markProgrammatic();
      if (rows.length === 1) {
        instance.setView([rows[0].point.lat, rows[0].point.lng], 15, { animate });
        return;
      }
      const bounds = L.latLngBounds(
        rows.map((m) => [m.point.lat, m.point.lng] as [number, number]),
      );
      instance.fitBounds(bounds, { padding: [56, 56], maxZoom: 15, animate });
    },
    [map, markProgrammatic],
  );

  const recount = useCallback(() => {
    const instance = map;
    if (!instance) return;
    const bounds = instance.getBounds();
    const rows: ListingMarker[] = [];
    let count = 0;
    for (const m of markersRef.current) {
      if (!bounds.contains([m.point.lat, m.point.lng])) continue;
      count += 1;
      if (rows.length < IN_VIEW_LIMIT) rows.push(m);
    }
    setInViewCount(count);
    // Same rows → same state object, so a settle pan that changes nothing
    // causes no re-render. This matters more than it looks: recount runs on
    // every moveend, and a re-render while the popup is open used to hand the
    // popup a fresh position array, which re-ran Leaflet's auto-pan, which
    // fired another moveend — the popup visibly spasming in a loop of its own
    // making. Each leg of that loop is now cut independently.
    setInViewRows((prior) => {
      if (
        prior.length === rows.length &&
        prior.every((row, i) => row.listing.id === rows[i].listing.id)
      ) {
        return prior;
      }
      return rows;
    });
    setZoom(instance.getZoom());
  }, [map]);

  const registerMarker = useCallback((id: string, marker: L.Marker | null) => {
    if (marker) markerIndexRef.current.set(id, marker);
    else markerIndexRef.current.delete(id);
  }, []);

  // Track user navigation so automatic re-framing never fights the user.
  useEffect(() => {
    if (!map) return;
    const onMoveStart = () => {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      if (now > programmaticUntilRef.current) userMovedRef.current = true;
    };
    const onMoveEnd = () => recount();
    map.on('movestart', onMoveStart);
    map.on('moveend', onMoveEnd);
    map.on('zoomend', onMoveEnd);
    recount();
    return () => {
      map.off('movestart', onMoveStart);
      map.off('moveend', onMoveEnd);
      map.off('zoomend', onMoveEnd);
    };
  }, [map, recount]);

  // Coordinates trickle in as they resolve, and each one may land in view — the
  // panel has to follow the data, not just the navigation.
  useEffect(() => {
    recount();
  }, [markerSignature, recount]);

  // A new filter result set is a new question — always re-frame it.
  useEffect(() => {
    userMovedRef.current = false;
  }, [listingSignature]);

  // Re-frame as coordinates resolve, unless the user has taken over.
  useEffect(() => {
    if (!map || markers.length === 0) return;
    if (userMovedRef.current) return;
    fitToMarkers(false);
  }, [map, markerSignature, markers.length, fitToMarkers]);

  // Leaflet renders grey tiles when its container resizes underneath it. Watch
  // the map frame rather than the shell: opening the results panel narrows the
  // frame while leaving the shell exactly the same size.
  useEffect(() => {
    if (!map || !mapFrameRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      map.invalidateSize({ animate: false });
      const height = entries[0]?.contentRect?.height;
      if (typeof height === 'number' && height > 0) setFrameHeight(Math.round(height));
    });
    observer.observe(mapFrameRef.current);
    return () => observer.disconnect();
  }, [map]);

  // Single shared popup: clear the selection only when *our* popup closes, not
  // when it is torn down to make way for the next one.
  //
  // `popupclose` is not the same event as "the user dismissed this". Leaflet
  // also fires it whenever it detaches a popup it is about to re-attach, which
  // is exactly what a zoom does — so opening a listing from the results panel
  // (which zooms to break its cluster apart) used to close its own popup a
  // beat later. Only a popup that is *still* closed on the next tick was
  // closed by the user.
  useEffect(() => {
    if (!map) return;
    let settle = 0;
    const onPopupClose = (event: L.PopupEvent) => {
      if (!popupRef.current || event.popup !== popupRef.current) return;
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        if (!popupRef.current?.isOpen()) setSelectedId(null);
      }, 0);
    };
    map.on('popupclose', onPopupClose);
    return () => {
      window.clearTimeout(settle);
      map.off('popupclose', onPopupClose);
    };
  }, [map]);

  // Drop a selection that has been filtered off the map.
  useEffect(() => {
    if (selectedId && !markers.some((m) => m.listing.id === selectedId)) setSelectedId(null);
  }, [markers, selectedId]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => {
      const active = document.fullscreenElement === shellRef.current;
      setIsFullscreen(active);
      window.setTimeout(() => map?.invalidateSize({ animate: false }), 60);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [map]);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell || typeof document === 'undefined') return;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void shell.requestFullscreen?.();
    }
  }, []);

  // Geolocation ----------------------------------------------------------
  useEffect(() => {
    if (!map) return;
    const onFound = (event: L.LocationEvent) => {
      setLocating(false);
      setUserLocation({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
        accuracy: event.accuracy,
      });
    };
    const onError = (event: L.ErrorEvent) => {
      setLocating(false);
      toast({
        variant: 'destructive',
        title: 'Could not find your location',
        description:
          event.message ||
          'The browser refused the request. Check that location access is allowed for this site.',
      });
    };
    map.on('locationfound', onFound);
    map.on('locationerror', onError);
    return () => {
      map.off('locationfound', onFound);
      map.off('locationerror', onError);
    };
  }, [map, toast]);

  const toggleLocate = useCallback(() => {
    if (userLocation) {
      setUserLocation(null);
      return;
    }
    if (!map) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast({
        variant: 'destructive',
        title: 'Location unavailable',
        description: 'This browser cannot share a location.',
      });
      return;
    }
    setLocating(true);
    // Jumping to the user is a navigation they asked for, so it must switch off
    // the automatic re-framing exactly as a drag would.
    userMovedRef.current = true;
    map.locate({ setView: true, maxZoom: 15, enableHighAccuracy: true, timeout: 10_000 });
  }, [map, toast, userLocation]);

  const handleSelect = useCallback((id: string) => setSelectedId(id), []);

  /**
   * Open a listing chosen from the results panel.
   *
   * Every pin stands at its own coordinate, so this is a pan and a select.
   * Where several properties share a coordinate they share one marker, and
   * selecting any member lights up that marker.
   */
  const revealListing = useCallback(
    (id: string) => {
      const row = markersRef.current.find((m) => m.listing.id === id);
      if (!row || !map) return;
      userMovedRef.current = true;
      markProgrammatic();

      // No cluster to break open any more: every pin is drawn at its own
      // coordinate, so reaching one is simply a pan to it. A stack shares a
      // coordinate, so panning reaches all of its members at once.
      map.setView([row.point.lat, row.point.lng], Math.max(map.getZoom(), 15), {
        animate: !reducedMotion,
      });
      setSelectedId(id);
    },
    [map, markProgrammatic, reducedMotion],
  );

  const openSelectedDetails = useCallback(() => {
    if (!selected) return;
    // Deliberately does NOT close the popup. Closing it here made Leaflet
    // reverse its auto-pan and re-settle the map at the exact moment the
    // details modal was opening over it — a lurch the reader experienced as
    // the map glitching. The modal covers the popup; when it closes, the
    // reader is back exactly where they were, popup and all.
    onSelectListing(selected.listing);
  }, [onSelectListing, selected]);

  /* ---------------------------------------------------------------------- */
  /* Render                                                                  */
  /* ---------------------------------------------------------------------- */

  const modeOptions: SegmentedOption<MapMode>[] = [
    { value: 'pins', label: 'Pins', icon: MapPin, title: 'Show individual listing pins' },
    { value: 'heat', label: 'Heat', icon: Flame, title: 'Show the density surface only' },
    { value: 'hybrid', label: 'Both', icon: LayoutGrid, title: 'Overlay pins on the heat surface' },
  ];

  const metricOptions: SegmentedOption<HeatMetric>[] = [
    { value: 'density', label: 'Density', title: 'Every listing weighted equally' },
    { value: 'price', label: 'Price', title: 'Weighted by price on a log scale' },
    { value: 'recency', label: 'Fresh', title: 'Weighted by how recently it was listed' },
  ];

  const focusOptions: SegmentedOption<HeatFocus>[] = [
    { value: 'tight', label: 'Tight', title: 'Small radius, only true hotspots saturate' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'wide', label: 'Wide', title: 'Broad radius, regional patterns' },
  ];

  // Does the plotted set actually contain builder stock? Asked of the
  // markers rather than of a prop, so the legend cannot claim a mark the
  // map is not drawing.
  const hasBuilderStock = useMemo(
    () => markers.some((m) => isBuilderStockMapId(m.listing.id)),
    [markers],
  );

  const plottedSummary = `${markers.length} of ${listings.length} plotted`;
  const panelOpen = panelState === 'open' && markers.length > 0;

  return (
    <div
      ref={shellRef}
      role="region"
      aria-label="Listings map"
      className={cn(
        'listings-map',
        'relative overflow-hidden border border-border/60 bg-card/60 shadow-[0_14px_40px_hsl(var(--foreground)/0.08)] dark:border-white/10 dark:bg-background/40',
        isFullscreen ? 'rounded-none' : 'rounded-2xl',
        basemap.dark && 'listings-map--dark-tiles',
      )}
      data-basemap={basemap.id}
    >
      {/* The panel is a sibling of the map, not an overlay on it: the map gives
          up width instead of hiding behind a drawer, and no control has to move
          out of the way.

          Side by side, the row owns the height and both children stretch into
          it. Sizing the map instead would let the panel's own content — one row
          per listing in view — drive the row and leave the map floating in a
          column thousands of pixels tall. */}
      <div
        className={cn(
          'flex flex-col lg:flex-row',
          isFullscreen ? 'h-screen' : 'lg:h-[70vh] lg:min-h-[480px] lg:max-h-[860px]',
        )}
      >
      <div
        ref={mapFrameRef}
        className={cn(
          'relative w-full min-w-0 flex-1',
          isFullscreen
            ? 'min-h-0'
            : 'h-[70vh] min-h-[480px] max-h-[860px] lg:h-auto lg:min-h-0 lg:max-h-none',
        )}
      >
        <MapContainer
          ref={setMap}
          center={AUSTRALIA_CENTER}
          zoom={AUSTRALIA_ZOOM}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          scrollWheelZoom
          zoomControl={false}
          worldCopyJump
          zoomAnimation={!reducedMotion}
          fadeAnimation={!reducedMotion}
          markerZoomAnimation={!reducedMotion}
          style={{ height: '100%', width: '100%' }}
          /*
            Leaflet 1.9 injects a Ukrainian flag SVG of its own into the
            attribution control, beside the word "Leaflet". It is an upstream
            solidarity emblem rather than anything about this map's data, and on
            a property marketplace a national flag in the corner reads as a
            statement about the listings — it was reported as one. `prefix`
            replaces the whole built-in string, so the library is still credited
            (its licence asks for that) and the flag is simply not drawn. The
            tile providers' own attributions are untouched; they come from each
            TileLayer.
          */
          attributionControl={false}
        >
          <AttributionControl position="bottomright" prefix={LEAFLET_CREDIT} />
          {/*
            `detectRetina` adds a zoom offset to every request and leaves
            `maxNativeZoom` alone, so the cap has to absorb it — otherwise a
            HiDPI screen asks Esri for one level past the cache and gets the
            grey "Map data not yet available" tile back, with HTTP 200. See
            `effectiveMaxNativeZoom`.
          */}
          <TileLayer
            key={`${basemap.id}:${retinaTiles ? 'hidpi' : 'std'}`}
            attribution={basemap.attribution}
            url={basemap.url}
            maxNativeZoom={effectiveMaxNativeZoom(basemap.maxNativeZoom, retinaTiles)}
            maxZoom={MAX_ZOOM}
            detectRetina
          />
          {basemap.labelsUrl ? (
            <TileLayer
              key={`${basemap.id}-labels`}
              url={basemap.labelsUrl}
              maxNativeZoom={basemap.maxNativeZoom}
              maxZoom={MAX_ZOOM}
              opacity={0.9}
            />
          ) : null}

          <ScaleControl position="bottomleft" imperial={false} />

          <HeatLayer
            points={heatModel.points}
            visible={showHeat}
            focus={heatFocus}
            minCeiling={heatModel.minCeiling}
            themeKey={`${isDark ? 'dark' : 'light'}:${basemap.id}`}
          />

          <ListingMarkers
            markers={markers}
            tiers={tiers}
            imagesRef={imagesRef}
            variant={pinVariant}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onSelect={handleSelect}
            registerMarker={registerMarker}
          />

          {userLocation ? (
            <>
              {/* The reported accuracy is part of the answer: a 2km circle and a
                  20m circle mean very different things about "you are here". */}
              <Circle
                center={[userLocation.lat, userLocation.lng]}
                radius={userLocation.accuracy}
                pathOptions={{ className: 'listings-accuracy' }}
                interactive={false}
              />
              <Marker
                position={[userLocation.lat, userLocation.lng]}
                icon={USER_LOCATION_ICON}
                zIndexOffset={2000}
                keyboard={false}
                title="Your location"
                alt="Your location"
              />
            </>
          ) : null}

          {selected && popupPosition ? (
            <Popup
              // Keyed by the POINT, not the listing. Stepping through a stack
              // never moves the popup, and remounting it there would tear the
              // card down and re-run Leaflet's auto-pan for the same
              // coordinate on every step.
              key={colocationKey(selected.point.lat, selected.point.lng)}
              ref={popupRef}
              position={popupPosition}
              maxWidth={320}
              minWidth={268}
              // Bounded so the card can never outgrow the frame it sits in:
              // an over-tall popup makes Leaflet auto-pan its own marker out
              // of view. Leaflet scrolls the content past this height.
              //
              // Raised from 300 to fit the photo carousel. It is a ceiling, not
              // a target — the card is still deliberately compact, and anything
              // richer belongs on the property page rather than in a popup that
              // has to sit inside the viewport with its own marker visible.
              // Never taller than the frame can actually show: a popup that
              // cannot fully fit gives Leaflet's auto-pan an unsatisfiable
              // goal, and an unsatisfiable auto-pan is a pan on every update.
              maxHeight={frameHeight > 0 ? Math.max(240, Math.min(440, frameHeight - 140)) : 440}
              autoPanPadding={L.point(32, 44)}
              className="listings-map__popup"
            >
              <ListingPopupCard
                // The card IS per listing, so its carousel, photo lookup and
                // auto-find all start again when the reader steps on.
                key={selected.listing.id}
                listing={selected.listing}
                point={selected.point}
                precision={selected.precision}
                pager={stackPager}
                onOpenDetails={openSelectedDetails}
                onEmailAgent={onEmailAgent ? () => onEmailAgent(selected.listing) : undefined}
              />
            </Popup>
          ) : null}
        </MapContainer>

      {/* Top bar --------------------------------------------------------- */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-[500] flex flex-wrap items-start justify-between gap-2">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
          <div
            className="flex items-center gap-2 rounded-full border border-border/60 bg-background/85 px-3 py-1.5 text-xs font-semibold text-foreground shadow-md backdrop-blur"
            role="status"
            aria-live="polite"
          >
            <MapPin className="h-3.5 w-3.5 text-primary" />
            {/*
              The chip's tooltip carries the running build id. Three rounds of
              map debugging were spent against screenshots of a build that
              predated every fix — undetectably, because nothing on screen said
              which build produced it. Now any screenshot of this map
              self-identifies: hover the chip, read the build.
            */}
            <span className="tabular-nums" title={`Build ${BUILD_ID}`}>{plottedSummary}</span>
            {isResolving && (
              <Loader2
                className="h-3 w-3 animate-spin text-muted-foreground motion-reduce:animate-none"
                aria-label="Resolving addresses"
              />
            )}
          </div>

          {markers.length > 0 && inViewCount !== null && (
            <button
              type="button"
              onClick={() => setPanelState(panelOpen ? 'closed' : 'open')}
              aria-expanded={panelOpen}
              aria-controls="listings-map-results"
              title={panelOpen ? 'Hide the results panel' : 'List the listings in this view'}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-md backdrop-blur transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                panelOpen
                  ? 'border-primary/50 bg-primary text-primary-foreground'
                  : 'border-border/60 bg-background/85 text-foreground hover:bg-muted/60',
              )}
            >
              {panelOpen ? (
                <PanelRightClose className="h-3.5 w-3.5" />
              ) : (
                <PanelRightOpen className="h-3.5 w-3.5" />
              )}
              <span className="tabular-nums">{inViewCount}</span> in view
            </button>
          )}

          {builderStock?.available && (
            <button
              type="button"
              onClick={() => builderStock.onToggle(!builderStock.shown)}
              aria-pressed={builderStock.shown}
              title={
                builderStock.shown
                  ? `Hide the ${builderStock.count} builder and developer listings from the map`
                  : `Show ${builderStock.count} builder and developer listings on the map`
              }
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-md backdrop-blur transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                builderStock.shown
                  ? 'border-primary/50 bg-primary text-primary-foreground'
                  : 'border-border/60 bg-background/85 text-foreground hover:bg-muted/60',
              )}
            >
              <HardHat className="h-3.5 w-3.5" aria-hidden="true" />
              {/*
                Says what it DOES, not just how many there are. As a bare
                "91 builder" it read as one of the counters beside it — a
                statistic, not a switch — so nobody could tell what pressing it
                would do, and pressing it appeared to delete listings.
              */}
              <span className="tabular-nums">{builderStock.count}</span> builder stock
              <span
                aria-hidden="true"
                className={cn(
                  'ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                  builderStock.shown
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {builderStock.shown ? 'on' : 'off'}
              </span>
            </button>
          )}

          {builderStock?.failed && (
            <span
              className="flex items-center gap-1.5 rounded-full border border-warning/40 bg-background/85 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-md backdrop-blur"
              role="status"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
              Builder stock unavailable
            </span>
          )}

          {unmapped.length > 0 && !isResolving && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-full border border-warning/40 bg-background/85 px-3 py-1.5 text-xs font-semibold text-foreground shadow-md backdrop-blur transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                  <span className="tabular-nums">{unmapped.length}</span> unmapped
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-0">
                <div className="border-b border-border/60 px-3 py-2">
                  <p className="text-xs font-semibold text-foreground">
                    Listings held off the map
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Records with no resolvable address, plus any whose coordinates failed the
                    location accuracy check — held back rather than plotted wrongly.
                  </p>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <ul className="divide-y divide-border/50">
                    {unmapped.slice(0, 50).map(({ listing, reason }) => (
                      <li key={listing.id}>
                        <button
                          type="button"
                          onClick={() => onSelectListing(listing)}
                          className="w-full px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
                        >
                          <span className="block truncate text-xs font-medium text-foreground">
                            {listing.address || listing.title || 'Untitled listing'}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {reason === 'failed_check'
                              ? 'Coordinates failed the location accuracy check'
                              : [listing.suburb, listing.state].filter(Boolean).join(' ') ||
                                'No locality on record'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                {unmapped.length > 50 && (
                  <p className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
                    +{unmapped.length - 50} more
                  </p>
                )}
              </PopoverContent>
            </Popover>
          )}
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
          <Segmented
            value={mode}
            options={modeOptions}
            onChange={setMode}
            label="Map display mode"
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Basemap: ${BASEMAP_LABELS[basemapPref]}`}
                className="flex items-center gap-1.5 rounded-full border border-border/60 bg-background/85 px-3 py-2 text-xs font-medium text-foreground shadow-md backdrop-blur transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <Layers className="h-3.5 w-3.5 text-primary" />
                <span className="hidden sm:inline">{BASEMAP_LABELS[basemapPref]}</span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs">Basemap</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={basemapPref}
                onValueChange={(next) => {
                  if (isBasemapId(next)) setBasemapPref(next);
                }}
              >
                {(['auto', 'light', 'dark', 'satellite'] as BasemapId[]).map((id) => (
                  <DropdownMenuRadioItem key={id} value={id} className="text-xs">
                    {BASEMAP_LABELS[id]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs"
                onSelect={(event) => {
                  event.preventDefault();
                  userMovedRef.current = false;
                  fitToMarkers(!reducedMotion);
                }}
              >
                <Crosshair className="mr-2 h-3.5 w-3.5" />
                Fit to results
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Heat legend ------------------------------------------------------ */}
      {heatLegendVisible && (
        <div className="pointer-events-auto absolute left-3 top-16 z-[500] w-[min(19rem,calc(100%-1.5rem))] rounded-xl border border-border/60 bg-background/90 shadow-md backdrop-blur">
          <button
            type="button"
            onClick={() => setLegendOpen((open) => !open)}
            aria-expanded={legendOpen}
            className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
          >
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Flame className="h-3.5 w-3.5 text-primary" />
              {heatLegend.title}
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform motion-reduce:transition-none',
                legendOpen && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>

          {legendOpen && (
            <div className="space-y-2.5 px-3 pb-3">
              <div>
                <div className="listings-heat-ramp" aria-hidden="true" />
                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span className="truncate">{heatLegend.lowLabel}</span>
                  {heatLegend.midLabel ? (
                    <span className="truncate font-medium">{heatLegend.midLabel}</span>
                  ) : null}
                  <span className="truncate">{heatLegend.highLabel}</span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{heatLegend.hint}</p>
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Weight by
                </p>
                <Segmented
                  value={heatMetric}
                  options={metricOptions}
                  onChange={setHeatMetric}
                  label="Heat weighting metric"
                  size="sm"
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Focus
                </p>
                <Segmented
                  value={heatFocus}
                  options={focusOptions}
                  onChange={setHeatFocus}
                  label="Heat focus"
                  size="sm"
                />
              </div>

              {showPins && (
                <div className="border-t border-border/50 pt-2">
                  <PinLegend tiers={tiers} hasBuilderStock={hasBuilderStock} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Pin legend (pins-only mode, where the heat card is absent) --------- */}
      {showPins && !heatLegendVisible && markers.length > 0 && (
        <div className="pointer-events-auto absolute left-3 top-16 z-[500] w-[min(19rem,calc(100%-1.5rem))] rounded-xl border border-border/60 bg-background/90 shadow-md backdrop-blur">
          <button
            type="button"
            onClick={() => setLegendOpen((open) => !open)}
            aria-expanded={legendOpen}
            className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50"
          >
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 text-primary" />
              Pin legend
            </span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground transition-transform motion-reduce:transition-none',
                legendOpen && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>

          {legendOpen && (
            <div className="px-3 pb-3">
              <PinLegend tiers={tiers} hasBuilderStock={hasBuilderStock} />
            </div>
          )}
        </div>
      )}

      {/* Right-hand control stack ---------------------------------------- */}
      <div className="pointer-events-auto absolute right-3 bottom-10 z-[500] flex flex-col overflow-hidden rounded-xl border border-border/60 shadow-md backdrop-blur">
        <MapIconButton
          label="Zoom in"
          onClick={() => map?.zoomIn()}
          disabled={!map || zoom >= MAX_ZOOM}
        >
          <Plus className="h-4 w-4" />
        </MapIconButton>
        <MapIconButton
          label="Zoom out"
          onClick={() => map?.zoomOut()}
          disabled={!map || zoom <= MIN_ZOOM}
        >
          <Minus className="h-4 w-4" />
        </MapIconButton>
        <MapIconButton
          label="Fit map to results"
          onClick={() => {
            userMovedRef.current = false;
            fitToMarkers(!reducedMotion);
          }}
          disabled={markers.length === 0}
        >
          <Crosshair className="h-4 w-4" />
        </MapIconButton>
        <MapIconButton
          label={userLocation ? 'Clear your location' : 'Show my location'}
          onClick={toggleLocate}
          disabled={locating}
          active={Boolean(userLocation)}
        >
          {locating ? (
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <LocateFixed className="h-4 w-4" />
          )}
        </MapIconButton>
        <MapIconButton
          label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen map'}
          onClick={toggleFullscreen}
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </MapIconButton>
      </div>

      {/* Lookup failure --------------------------------------------------- */}
      {failure && !isResolving && (
        <div className="absolute inset-x-4 bottom-16 z-[500] rounded-xl border border-warning/40 bg-background/95 p-4 text-sm shadow-md backdrop-blur sm:max-w-md">
          <p className="flex items-center gap-2 font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-warning" />
            {FAILURE_COPY[failure].title}
          </p>
          <p className="mt-1 text-muted-foreground">{FAILURE_COPY[failure].detail}</p>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={retry}>
              Try again
            </Button>
            {markers.length > 0 && (
              <span className="text-xs text-muted-foreground">
                <span className="tabular-nums">{markers.length}</span> already placed
              </span>
            )}
          </div>
        </div>
      )}

      {/* Empty state ------------------------------------------------------ */}
      {listings.length > 0 && markers.length === 0 && !isResolving && !failure && (
        <div className="pointer-events-none absolute inset-x-4 bottom-16 z-[500] rounded-xl border border-border/60 bg-background/90 p-4 text-sm shadow-md backdrop-blur">
          <p className="flex items-center gap-2 font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-warning" />
            No listings could be placed on the map
          </p>
          <p className="mt-1 text-muted-foreground">
            Addresses are resolved securely on the server. Add a street address and suburb to the
            listing records so they can be located.
          </p>
        </div>
      )}

      {listings.length === 0 && (
        <div className="pointer-events-none absolute inset-x-4 bottom-16 z-[500] rounded-xl border border-border/60 bg-background/90 p-4 text-sm shadow-md backdrop-blur">
          <p className="flex items-center gap-2 font-semibold text-foreground">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            Nothing to map
          </p>
          <p className="mt-1 text-muted-foreground">
            No listings match the active filters. Clear a filter to bring stock back onto the map.
          </p>
        </div>
      )}
      </div>

        {panelOpen && (
          <ResultsPanel
            rows={inViewRows}
            total={inViewCount ?? inViewRows.length}
            tiers={tiers}
            selectedId={selectedId}
            onSelect={revealListing}
            onHover={setHoveredId}
            onClose={() => setPanelState('closed')}
          />
        )}
      </div>
    </div>
  );
}

export default ListingsMapView;
