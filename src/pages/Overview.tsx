import { ReactNode, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCapabilityResolver } from '@/hooks/useCapability';
import { Building2, Calendar, AlertTriangle, DollarSign, TrendingUp, Image, FileText, Tag, Ruler, Download, MapPin, RefreshCw, ShieldCheck, Activity, Database, BarChart3, RadioTower, Newspaper, Zap } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { KPICard } from '@/components/dashboard/KPICard';
import { AuroraHero, KpiRow, MetricTile } from '@/components/aurixa';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FlattenPdfIconButton } from '@/components/common/FlattenPdfIconButton';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfidenceBadge } from '@/components/dashboard/ConfidenceBadge';
import { OverviewFilters } from '@/components/overview/OverviewFilters';
import {
  buildListingFacets,
  listingPostcode,
  listingPropertyType,
  listingState,
  listingSuburb,
} from '@/lib/listings/listingFacets.pure';
import { DataIntegrityPanel } from '@/components/debug/DataIntegrityPanel';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { UpcomingRemindersWidget } from '@/components/overview/UpcomingRemindersWidget';
import { OperationsSnapshot } from '@/components/overview/OperationsSnapshot';
import { QuickActionsRow } from '@/components/overview/QuickActionsRow';
import { MarketNewsWidget } from '@/components/overview/MarketNewsWidget';
import { CommercialPortfolioWidget } from '@/components/commercial/CommercialPortfolioWidget';
import { IndustrialPortfolioWidget } from '@/components/industrial/IndustrialPortfolioWidget';

import { PropertyListing } from '@/lib/airtable';
import { DashboardKPIs } from '@/types/airtable';
import { useAutoRefresh } from '@/hooks/use-auto-refresh';
import { propertyDataService } from '@/services/propertyDataService';
import { chartDataService } from '@/services/chartDataService';
import { toast } from 'sonner';
import { generateOverviewSnapshotPDF } from '@/components/overview/OverviewSnapshotPDF';
import { cn } from '@/lib/utils';
import { isClientFacingDeployment } from '@/lib/clientFacing';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  ResponsiveContainer,
} from 'recharts';

const COLORS = [
  'hsl(var(--dashboard-primary-strong))',
  'hsl(var(--success))',
  'hsl(173 80% 38%)',
  'hsl(215 16% 47%)',
  'hsl(43 74% 35%)',
  'hsl(160 64% 42%)',
  'hsl(220 13% 56%)',
  'hsl(35 92% 52%)',
  'hsl(188 72% 34%)',
  'hsl(30 10% 45%)'
];

const OVERVIEW_CHART_COLORS = {
  brand: 'hsl(var(--brand-primary, var(--dashboard-primary-strong)))',
  positive: 'hsl(var(--success))',
  teal: 'hsl(173 80% 38%)',
  neutral: 'hsl(215 16% 47%)',
  grid: 'hsl(var(--border) / 0.55)',
  axis: 'hsl(var(--muted-foreground))',
  tooltipBorder: 'hsl(var(--border))',
  tooltipShadow: '0 18px 45px hsl(var(--foreground) / 0.18)',
  dotStroke: 'hsl(var(--card))',
};

const premiumTooltipStyle = {
  backgroundColor: 'hsl(var(--popover))',
  border: `1px solid ${OVERVIEW_CHART_COLORS.tooltipBorder}`,
  borderRadius: '14px',
  boxShadow: OVERVIEW_CHART_COLORS.tooltipShadow,
  color: 'hsl(var(--popover-foreground))',
  padding: '10px 12px',
};

const chartAxisTick = (isMobile: boolean) => ({
  fill: OVERVIEW_CHART_COLORS.axis,
  fontSize: isMobile ? 10 : 12,
  fontWeight: 500,
});

const chartGridProps = {
  stroke: OVERVIEW_CHART_COLORS.grid,
  strokeDasharray: '4 6',
  opacity: 0.55,
};

const OVERVIEW_SHELL = 'overview-obsidian-shell mx-auto w-full max-w-[1600px] overflow-x-hidden px-3 pb-28 pt-2 sm:px-5 md:pb-10 lg:px-8';
const PREMIUM_CARD = 'overview-premium-card rounded-2xl transition-all duration-200';
const EXECUTIVE_KPI_CARD = 'overview-kpi-card group relative min-w-0 overflow-hidden rounded-[1.35rem] transition-all duration-300 [&_.dashboard-kpi-title]:min-w-0 [&_.dashboard-kpi-title]:break-words [&_.dashboard-kpi-title]:text-[0.68rem] [&_.dashboard-kpi-title]:font-semibold [&_.dashboard-kpi-title]:uppercase [&_.dashboard-kpi-title]:tracking-[0.15em] sm:[&_.dashboard-kpi-title]:tracking-[0.18em] [&_.dashboard-kpi-title]:text-muted-foreground [&_.dashboard-kpi-value]:break-words [&_.dashboard-kpi-value]:text-2xl [&_.dashboard-kpi-value]:font-semibold [&_.dashboard-kpi-value]:tracking-[-0.045em] [&_.dashboard-kpi-value]:text-foreground min-[420px]:[&_.dashboard-kpi-value]:text-3xl sm:[&_.dashboard-kpi-value]:text-[2.35rem] [&_.dashboard-kpi-title+div]:flex [&_.dashboard-kpi-title+div]:h-11 [&_.dashboard-kpi-title+div]:w-11 [&_.dashboard-kpi-title+div]:shrink-0 [&_.dashboard-kpi-title+div]:items-center [&_.dashboard-kpi-title+div]:justify-center [&_.dashboard-kpi-title+div]:rounded-2xl [&_.dashboard-kpi-title+div]:border [&_.dashboard-kpi-title+div]:border-[hsl(var(--brand-primary,var(--dashboard-primary-strong))/0.28)] [&_.dashboard-kpi-title+div]:bg-[hsl(var(--brand-primary,var(--dashboard-primary-strong))/0.12)] [&_.dashboard-kpi-title+div]:text-[hsl(var(--brand-primary,var(--dashboard-primary-strong)))] [&_.dashboard-kpi-title+div]:shadow-inner [&_p]:mt-2 [&_p]:max-w-[16rem] [&_p]:text-[0.78rem] [&_p]:leading-5 [&_p]:text-muted-foreground';
const EXECUTIVE_KPI_WARNING_CARD = 'overview-kpi-warning';
const EXECUTIVE_KPI_DATA_CARD = 'overview-kpi-data';
const CHART_CARD = `${PREMIUM_CARD} overview-chart-card group min-w-0 overflow-visible transition-all duration-300 hover:-translate-y-0.5`;
const CHART_HEADER = 'overview-chart-header border-b px-4 py-4 md:px-5';
const CHART_TITLE = 'flex items-center gap-2 text-sm font-semibold tracking-[-0.015em] text-foreground md:text-base before:h-2 before:w-2 before:rounded-full before:bg-[hsl(var(--brand-primary,var(--dashboard-primary-strong)))] before:shadow-[0_0_14px_hsl(var(--brand-primary,var(--dashboard-primary-strong))/0.34)]';
const CHART_CONTENT = 'px-3 pb-5 pt-5 md:px-5';
const OVERVIEW_SECONDARY_ACTION = 'overview-glass-button dashboard-luxury-action min-h-10 rounded-full px-4 font-semibold transition-all duration-200 active:translate-y-0 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60';

type OverviewPieDatum = Record<string, unknown>;

const asFiniteNumber = (value: unknown): number | null => {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(numeric) ? numeric : null;
};

const firstDisplayValue = (datum: OverviewPieDatum | undefined, keys: string[]): string | null => {
  if (!datum) return null;
  for (const key of keys) {
    const value = datum[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
};

const getPieDatumValue = (datum: OverviewPieDatum | undefined): number | null => {
  if (!datum) return null;
  for (const key of ['value', 'count', 'total']) {
    const value = asFiniteNumber(datum[key]);
    if (value !== null) return value;
  }
  return null;
};

const formatOverviewPercent = (value: number | null): string | null => (
  value !== null && Number.isFinite(value) ? `${value.toFixed(1)}%` : null
);

function PremiumPieTooltip({ active, payload, unit = 'properties' }: any) {
  if (!active || !payload?.length) return null;

  const entry = payload[0] || {};
  const datum = (entry.payload || {}) as OverviewPieDatum;
  const label = firstDisplayValue(datum, ['name', 'label', 'type', 'status', 'category']) || (typeof entry.name === 'string' ? entry.name : null);
  const value = getPieDatumValue(datum) ?? asFiniteNumber(entry.value);
  const explicitPercent = asFiniteNumber(datum.percentage) ?? asFiniteNumber(datum.percent);
  const computedPercent = typeof entry.percent === 'number' ? entry.percent * 100 : null;
  const percent = formatOverviewPercent(explicitPercent ?? computedPercent);
  const colour = typeof entry.color === 'string' ? entry.color : typeof datum.fill === 'string' ? datum.fill : OVERVIEW_CHART_COLORS.brand;

  if (!label && value === null && !percent) return null;

  return (
    <div className="premium-chart-tooltip min-w-[150px] rounded-xl border border-primary/30 bg-white/95 px-3.5 py-3 text-foreground shadow-[0_16px_38px_rgba(15,23,42,0.18)] backdrop-blur-md dark:border-brand-300/35 dark:bg-[rgba(15,15,20,0.96)] dark:text-white dark:shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
      {label && (
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground dark:text-white">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_12px_rgba(245,158,11,0.45)]" style={{ backgroundColor: colour }} />
          <span className="text-primary dark:text-brand-200">{label}</span>
        </div>
      )}
      {value !== null && (
        <div className="text-sm font-semibold tabular-nums text-foreground dark:text-white">
          {value.toLocaleString('en-AU')}{unit ? ` ${unit}` : ''}
        </div>
      )}
      {percent && <div className="mt-1 text-xs font-medium text-muted-foreground dark:text-foreground">{percent} of visible total</div>}
    </div>
  );
}

function renderOverviewPieLabel(labelKey: 'type' | 'status', data: { count: number }[], isMobile: boolean) {
  return (props: any) => {
    const total = data.reduce((sum, item) => sum + item.count, 0);
    const percentageValue = total > 0 ? (props.count / total) * 100 : 0;
    if (percentageValue < 5) return null;
    const RADIAN = Math.PI / 180;
    const radius = (props.outerRadius || 90) + (isMobile ? 16 : 24);
    const x = props.cx + radius * Math.cos(-props.midAngle * RADIAN);
    const y = props.cy + radius * Math.sin(-props.midAngle * RADIAN);
    return (
      <text
        x={x}
        y={y}
        fill="hsl(var(--foreground))"
        textAnchor={x > props.cx ? 'start' : 'end'}
        dominantBaseline="central"
        fontSize={isMobile ? 9 : 11}
        fontWeight="600"
        style={{ paintOrder: 'stroke', stroke: 'hsl(var(--card))', strokeWidth: 3 }}
      >
        {props[labelKey]} ({percentageValue.toFixed(1)}%)
      </text>
    );
  };
}

function OverviewPieLegend({ data, labelKey }: { data: Array<Record<string, any> & { count: number }>; labelKey: 'type' | 'status' }) {
  const total = data.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="overview-pie-legend mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-2xl px-3 py-3">
      {data.map((entry, index) => {
        const pct = total > 0 ? ((entry.count / total) * 100).toFixed(1) : '0.0';
        const label = entry[labelKey];
        return (
          <div key={label} className="flex min-w-0 items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1.5 text-[10px] shadow-sm md:text-xs dark:border-white/10 dark:bg-white/[0.045]">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full md:h-3 md:w-3" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
            <span className="max-w-[9rem] truncate font-medium text-foreground">{label}</span>
            <span className="shrink-0 text-muted-foreground">({entry.count.toLocaleString('en-AU')} · {pct}%)</span>
          </div>
        );
      })}
    </div>
  );
}

function OverviewSection({
  eyebrow,
  title,
  description,
  icon,
  accent = false,
  children,
  className = '',
}: {
  eyebrow: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  accent?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DashboardThemeFrame as="section" variant={accent ? 'sectionAccent' : 'section'} className={cn('overview-section-frame', accent && 'overview-section-accent', className)}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between md:mb-5">
        <div className="max-w-3xl">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground/90">
            <span className={`h-1.5 w-1.5 rounded-full ${accent ? 'bg-[hsl(var(--brand-highlight,45_90%_56%))] shadow-[0_0_14px_hsl(var(--brand-highlight,45_90%_56%)/0.34)]' : 'bg-[hsl(var(--brand-primary,var(--dashboard-primary-strong)))]'}`} />
            {eyebrow}
          </div>
          <div className="flex min-w-0 items-start gap-3 sm:items-center">
            {icon && (
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${accent ? 'border-[hsl(var(--brand-highlight,45_90%_56%)/0.30)] bg-[hsl(var(--brand-highlight,45_90%_56%)/0.10)] text-[hsl(var(--brand-highlight,45_90%_56%))]' : 'dashboard-luxury-icon-tile'}`}>
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-foreground md:text-xl">{title}</h2>
              {description && <p className="mt-1 text-sm leading-6 text-muted-foreground/90">{description}</p>}
            </div>
          </div>
        </div>
      </div>
      {children}
    </DashboardThemeFrame>
  );
}

export default function Overview() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  // The Overview is assembled from capability-gated sections. A section that
  // is not entitled does not render AND does not fetch: the listings intake
  // set is only loaded for Property Marketplace workspaces, the commercial
  // widgets only mount for Commercial & Industrial ones, and the market news
  // digest only for Market News Feed ones. Every tier keeps the universal
  // operational core (quick actions, ops snapshot, reminders).
  const { resolve: resolveOverviewCapability } = useCapabilityResolver();
  const marketplaceEnabled = resolveOverviewCapability('module.property_marketplace').enabled;
  // The integrity panel is a validation/debug widget — internal console only.
  const showDataIntegrityPanel = marketplaceEnabled && !isClientFacingDeployment();
  const commercialEnabled = resolveOverviewCapability('module.commercial_industrial').enabled;
  const marketNewsEnabled = resolveOverviewCapability('module.market_news_feed').enabled;
  const generatedReportsEnabled = resolveOverviewCapability('module.generated_reports').enabled;

  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allListings, setAllListings] = useState<PropertyListing[]>([]);
  const [kpis, setKpis] = useState<DashboardKPIs>({
    newThisWeek: 0,
    withInspections: 0,
    needsReview: 0,
    averagePrice: 0,
  });
  const [recentListings, setRecentListings] = useState<PropertyListing[]>([]);
  const [suburbData, setSuburbData] = useState<{ suburb: string; count: number }[]>([]);
  const [propertyTypeData, setPropertyTypeData] = useState<{ type: string; count: number }[]>([]);
  const [dailyData, setDailyData] = useState<{ date: string; count: number }[]>([]);
  const [categoryData, setCategoryData] = useState<{ status: string; count: number }[]>([]);
  const [sourceData, setSourceData] = useState<{ source: string; count: number }[]>([]);
  const [agencyData, setAgencyData] = useState<{ agency: string; count: number }[]>([]);
  const [contentStats, setContentStats] = useState({
    withPrices: 0,
    withImages: 0,
    withFloorplans: 0,
    withKeyEntities: 0,
    emailSources: 0,
  });

  // Filters state — renamed zipCode → postcode for AU localization
  const [filters, setFilters] = useState({
    state: 'all',
    postcode: 'all',
    suburb: 'all',
    propertyType: 'all',
  });

  const [uniqueValues, setUniqueValues] = useState({
    states: [] as string[],
    postcodes: [] as string[],
    suburbs: [] as string[],
    propertyTypes: [] as string[],
  });

  // Stable helpers
  const safeParseDate = useCallback((date: Date | string | null | undefined): Date | null => {
    if (!date) return null;
    try {
      const validDate = date instanceof Date ? date : new Date(date);
      return isNaN(validDate.getTime()) ? null : validDate;
    } catch {
      return null;
    }
  }, []);

  const formatCurrency = useCallback((value: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }, []);

  const formatDate = useCallback((date: Date | string | null | undefined) => {
    if (!date) return 'Unknown Date';
    try {
      const validDate = date instanceof Date ? date : new Date(date);
      if (isNaN(validDate.getTime())) return 'Invalid Date';
      return new Intl.DateTimeFormat('en-AU', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(validDate);
    } catch {
      return 'Invalid Date';
    }
  }, []);

  // The state and postcode a listing is in come from `lib/listings/listingFacets`.
  //
  // This page used to keep private copies of both extractors — and both read
  // the ADDRESS alone, never the record's own `state` / `zipCode` columns. The
  // address is the street line, so almost every listing resolved to no state
  // at all: the filter offered three states where the marketplace offered
  // four, off the same data, and filtering by one of them dropped every
  // listing whose state lives in the column. Two copies of "where is this
  // property" is how the two pages came to disagree.

  // ─── STEP 1: Fetch raw data (cached, only re-fetches when cache expires) ───
  // Listings are Property Marketplace data. A workspace without that
  // capability never issues this request — the universal Overview renders
  // from the operational core instead.
  const fetchData = useCallback(async () => {
    if (!marketplaceEnabled) {
      setAllListings([]);
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      setError(null);

      const result = await propertyDataService.fetchAllListings({
        includeDebugInfo: true
      });

      console.log('Fetched data:', result.debugInfo.totalFetched, 'records, fromCache:', result.debugInfo.fromCache, 'in', result.debugInfo.fetchTime, 'ms');
      setAllListings(result.listings);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      setError(error instanceof Error ? error.message : 'Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  }, [marketplaceEnabled]);

  // ─── STEP 2: Compute filtered data + KPIs client-side (instant on filter change) ───
  useEffect(() => {
    if (allListings.length === 0 && !isLoading) return;
    if (allListings.length === 0) return;

    const listings = allListings;

    // Filter options, from ALL data rather than the filtered set — and read
    // the same way the predicates below read them, so an option can never
    // select nothing.
    setUniqueValues(buildListingFacets(listings));

    // Apply filters
    let filtered = listings;
    if (filters.state !== 'all') {
      filtered = filtered.filter(l => listingState(l) === filters.state);
    }
    if (filters.postcode !== 'all') {
      filtered = filtered.filter(l => listingPostcode(l) === filters.postcode);
    }
    if (filters.suburb !== 'all') {
      filtered = filtered.filter(l => listingSuburb(l) === filters.suburb);
    }
    if (filters.propertyType !== 'all') {
      filtered = filtered.filter(l => listingPropertyType(l) === filters.propertyType);
    }

    // Calculate KPIs
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const newThisWeek = filtered.filter(l => {
      const parsedDate = safeParseDate(l.createdAt || l.createdTime || l.receivedAt);
      return parsedDate && parsedDate >= oneWeekAgo;
    }).length;

    const withInspections = filtered.filter(l => l.inspectionStart).length;
    const needsReview = filtered.filter(l => l.confidence !== undefined && l.confidence !== null && l.confidence < 0.7).length;

    const recentWithPrice = filtered.filter(l => {
      const parsedDate = safeParseDate(l.createdAt || l.createdTime || l.receivedAt);
      return l.price && parsedDate && parsedDate >= thirtyDaysAgo;
    });
    const averagePrice = recentWithPrice.length > 0
      ? recentWithPrice.reduce((sum, l) => sum + (l.price || 0), 0) / recentWithPrice.length
      : 0;

    setKpis({ newThisWeek, withInspections, needsReview, averagePrice });
    setRecentListings(filtered.slice(0, 20));

    // Chart data
    const suburbChartData = chartDataService.generateSuburbData(filtered, 10);
    setSuburbData(suburbChartData.data.map(item => ({ suburb: item.label, count: item.value })));

    const propertyTypeChartData = chartDataService.generatePropertyTypeData(filtered);
    setPropertyTypeData(propertyTypeChartData.data.map(item => ({ type: item.label, count: item.value })));

    const dailyActivityData = chartDataService.generateDailyActivityData(filtered, 30);
    setDailyData(dailyActivityData.data.map(item => ({ date: item.metadata?.fullDate || item.label, count: item.value })));

    const statusCounts = filtered.reduce((acc, listing) => {
      const status = listing.status || 'Available';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    setCategoryData(Object.entries(statusCounts).map(([status, count]) => ({ status, count })));

    const agencyChartData = chartDataService.generateAgencyData(filtered, 10);
    setAgencyData(agencyChartData.data.map(item => ({ agency: item.metadata?.fullName || item.label, count: item.value })));

    // Content statistics — properly check for images/floorplans including attachment objects and alternate field names
    const withPrices = filtered.filter(l => l.price && l.price > 0).length;
    const withImages = filtered.filter(l => {
      const raw = l as any;
      const imgs = l.images || raw.Images || raw.Property_Images || raw.Attachments || raw.Photos;
      if (!imgs) return false;
      if (Array.isArray(imgs) && imgs.length > 0) return true;
      if (typeof imgs === 'string' && imgs.trim().length > 0) return true;
      return false;
    }).length;
    const withFloorplans = filtered.filter(l => {
      const raw = l as any;
      const fps = l.floorplans || raw.Floorplans || raw.Floor_Plans || raw.FloorPlan;
      if (!fps) return false;
      if (Array.isArray(fps) && fps.length > 0) return true;
      if (typeof fps === 'string' && fps.trim().length > 0) return true;
      return false;
    }).length;
    const withKeyEntities = filtered.filter(l => l.keyEntities && l.keyEntities.trim() !== '').length;
    const emailSources = filtered.filter(l => l.source && l.source.includes('@')).length;

    setContentStats({ withPrices, withImages, withFloorplans, withKeyEntities, emailSources });

    const sourceChartData = chartDataService.generateSourceData(filtered, 10);
    setSourceData(sourceChartData.data.map(item => ({ source: item.label, count: item.value })));

  }, [allListings, filters, safeParseDate]);

  // Adopt background revalidations.
  //
  // `fetchAllListings` now answers from the persistent cache the moment there is
  // something usable to draw and revalidates behind the render, so the first
  // paint on a repeat visit costs no network at all. This is how the fresh set
  // reaches the page once it lands.
  useEffect(() => {
    if (!marketplaceEnabled) return;
    return propertyDataService.subscribe(undefined, (result) => {
      setAllListings(result.listings);
    });
  }, [marketplaceEnabled]);

  // ─── STEP 3: Initial data fetch (only once) ───
  const { startAutoRefresh, stopAutoRefresh } = useAutoRefresh(fetchData);

  useEffect(() => {
    fetchData();
    return () => { stopAutoRefresh(); };
  }, [fetchData]);

  // ─── Export snapshot PDF ───
  const buildSnapshotData = useCallback(() => ({
    kpis,
    contentStats,
    totalListings: allListings.length,
    filters,
    suburbData: suburbData.slice(0, 15),
    propertyTypeData,
    agencyData: agencyData.slice(0, 10),
    recentListings: recentListings.map(l => ({
      address: l.address,
      suburb: l.suburb,
      postcode: listingPostcode(l) || undefined,
      price: l.price,
      propertyType: l.propertyType,
      beds: l.beds,
      baths: l.baths,
      source: l.source,
    })),
  }), [allListings, kpis, contentStats, filters, suburbData, propertyTypeData, agencyData, recentListings]);

  const propertyTypeTotal = useMemo(() => propertyTypeData.reduce((sum, item) => sum + item.count, 0), [propertyTypeData]);

  const handleExportSnapshot = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    const toastId = toast.loading('Generating Overview Snapshot PDF...');
    try {
      const pdfBlob = await generateOverviewSnapshotPDF(buildSnapshotData());
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Overview_Snapshot_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Overview Snapshot PDF exported!', { id: toastId });
    } catch (err) {
      console.error('Snapshot PDF export failed:', err);
      toast.error('Failed to export snapshot PDF', { id: toastId, description: err instanceof Error ? err.message : 'An unexpected error occurred' });
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, buildSnapshotData]);

  // ─── Error state ───
  if (error) {
    return (
      <div className={`${OVERVIEW_SHELL} space-y-6`}>
        <DashboardThemeFrame variant="hero" className="p-5 md:p-7">
          <div className="overview-command-badge mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">
            <RadioTower className="h-3.5 w-3.5" />
            Command Centre
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground md:text-5xl">Overview</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground/90 md:text-base">Property intake dashboard overview and key metrics</p>
        </DashboardThemeFrame>
        <Card className="overflow-hidden rounded-[1.5rem] border-brand-400/40 bg-gradient-to-br from-brand-500/10 via-card to-card shadow-[0_14px_40px_rgba(15,23,42,0.08)] dark:border-brand-400/25 dark:from-brand-400/10 dark:via-background/80 dark:to-background">
          <CardContent className="p-5 md:p-6">
            <div className="mb-3 flex items-center gap-3 text-brand-700 dark:text-brand-300">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-brand-400/30 bg-brand-500/10">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <h3 className="font-semibold tracking-tight">Configuration Required</h3>
            </div>
            <p className="mb-4 text-sm leading-6 text-muted-foreground/90">
              Unable to load dashboard data. This usually means the Airtable integration needs to be configured.
            </p>
            <div className="rounded-2xl border border-border/60 bg-background/70 p-4 text-xs text-muted-foreground/90 shadow-inner">
              <strong>Error:</strong> {error}
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className={OVERVIEW_SECONDARY_ACTION} onClick={() => window.location.href = '/settings'}>Go to Settings</Button>
              <Button variant="outline" className={OVERVIEW_SECONDARY_ACTION} onClick={() => window.location.reload()}>Retry</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Loading state ───
  if (isLoading) {
    return (
      <div className={`${OVERVIEW_SHELL} space-y-7 md:space-y-9`}>
        <DashboardThemeFrame variant="hero" className="p-5 md:p-7">
          <div className="mb-3 h-7 w-40 rounded-full bg-brand-500/10" />
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground md:text-5xl">Overview</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground/90 md:text-base">Property intake dashboard overview and key metrics</p>
        </DashboardThemeFrame>
        <div className="grid gap-3 min-[520px]:grid-cols-2 md:gap-5 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className={EXECUTIVE_KPI_CARD}>
              <CardHeader className="relative z-10 flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-11 w-11 rounded-2xl" />
              </CardHeader>
              <CardContent className="relative z-10">
                <Skeleton className="mb-2 h-9 w-20" />
                <Skeleton className="h-3 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className={CHART_CARD}>
              <CardHeader className={CHART_HEADER}><Skeleton className="h-5 w-40" /></CardHeader>
              <CardContent className={CHART_CONTENT}><Skeleton className="h-64 w-full rounded-2xl" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`${OVERVIEW_SHELL} space-y-7 md:space-y-9`}>
      <AuroraHero
        eyebrow="Command Centre"
        icon={<RadioTower className="h-3.5 w-3.5" />}
        title="Overview"
        description={marketplaceEnabled
          ? "Property intake dashboard overview and key metrics"
          : "Your operational command centre — clients, tasks, reports and deadlines"}
        actions={marketplaceEnabled ? (
          <>
            <Button variant="outline" size="sm" onClick={handleExportSnapshot} disabled={isExporting || isLoading} className={OVERVIEW_SECONDARY_ACTION}>
              {isExporting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Export Snapshot
                </>
              )}
            </Button>
            <FlattenPdfIconButton
              getPdfBlob={async () => generateOverviewSnapshotPDF(buildSnapshotData())}
              filename={`Overview_Snapshot_${new Date().toISOString().split('T')[0]}.pdf`}
              disabled={isExporting || isLoading}
              className={OVERVIEW_SECONDARY_ACTION}
            />
            <OverviewFilters
              filters={filters}
              setFilters={setFilters}
              uniqueValues={uniqueValues}
            />
          </>
        ) : undefined}
      />

      <OverviewSection eyebrow="Operations" title="Today's position" description="Actionable operational metrics and shortcuts, available on every plan." icon={<Zap className="h-4 w-4" />} accent>
        <div className="space-y-4">
          <QuickActionsRow />
          <OperationsSnapshot showReports={generatedReportsEnabled} />
        </div>
      </OverviewSection>

      {marketplaceEnabled && (
      <OverviewSection eyebrow="Executive snapshot" title="Intake performance" description="Headline operating metrics for the filtered property pipeline." icon={<Activity className="h-4 w-4" />}>
        {/* KPI Cards — Phase 2 MetricTile row */}
        <KpiRow columns={4}>
          <MetricTile
            title="New This Week"
            value={kpis.newThisWeek}
            icon={<TrendingUp className="h-4 w-4" />}
            description="Properties received in last 7 days"
            tone="info"
          />
          <MetricTile
            title="With Inspections"
            value={kpis.withInspections}
            icon={<Calendar className="h-4 w-4" />}
            description="Properties with scheduled inspections"
          />
          <MetricTile
            title="Needs Review"
            value={kpis.needsReview}
            icon={<AlertTriangle className="h-4 w-4" />}
            description="Low confidence (<0.7) properties"
            tone="warning"
          />
          <MetricTile
            title="Average Price"
            value={formatCurrency(kpis.averagePrice)}
            icon={<DollarSign className="h-4 w-4" />}
            description="Last 30 days"
            tone="success"
          />
        </KpiRow>

        {/* Content Statistics */}
        <div className="mt-4 grid min-w-0 grid-cols-1 gap-3 border-t border-border/60 dark:border-white/[0.06] pt-4 min-[520px]:grid-cols-2 md:mt-5 md:grid-cols-3 md:gap-5 md:pt-5 xl:grid-cols-5">
          <KPICard title="With Prices" value={contentStats.withPrices} icon={<DollarSign className="h-4 w-4" />} description="Properties with price information" className={`${EXECUTIVE_KPI_CARD} ${EXECUTIVE_KPI_DATA_CARD}`} />
          <KPICard title="With Images" value={contentStats.withImages} icon={<Image className="h-4 w-4" />} description="Properties with image attachments" className={`${EXECUTIVE_KPI_CARD} ${EXECUTIVE_KPI_DATA_CARD}`} />
          <KPICard title="With Floorplans" value={contentStats.withFloorplans} icon={<FileText className="h-4 w-4" />} description="Properties with floorplan documents" className={`${EXECUTIVE_KPI_CARD} ${EXECUTIVE_KPI_DATA_CARD}`} />
          <KPICard title="With Key Entities" value={contentStats.withKeyEntities} icon={<Tag className="h-4 w-4" />} description="Properties with extracted entities" className={`${EXECUTIVE_KPI_CARD} ${EXECUTIVE_KPI_DATA_CARD}`} />
          <KPICard title="Email Sources" value={contentStats.emailSources} icon={<Ruler className="h-4 w-4" />} description="Properties from email sources" className={`${EXECUTIVE_KPI_CARD} ${EXECUTIVE_KPI_DATA_CARD}`} />
        </div>
      </OverviewSection>
      )}

      <OverviewSection eyebrow="Operational reminders and validation" title="Workflow control" description="Current follow-ups and data consistency checks remain close to the executive metrics." icon={<ShieldCheck className="h-4 w-4" />}>
        {/* Upcoming Reminders & (marketplace-only) Data Integrity Panel */}
        <div className={cn('grid min-w-0 gap-4 animate-fade-in [&_.rounded-lg]:rounded-xl [&_.border]:border-border/70 [&_.bg-muted\/50]:bg-muted/35', showDataIntegrityPanel && 'lg:grid-cols-2')}>
          <UpcomingRemindersWidget />
          {showDataIntegrityPanel && <DataIntegrityPanel dashboardData={recentListings} className={PREMIUM_CARD} />}
        </div>
      </OverviewSection>

      {marketNewsEnabled && (
      <OverviewSection eyebrow="Market intelligence" title="Market News Feed" description="A concise digest of the developments that matter — the full feed is one click away." icon={<Newspaper className="h-4 w-4" />}>
        <MarketNewsWidget />
      </OverviewSection>
      )}

      {commercialEnabled && (
      <OverviewSection eyebrow="Portfolio position" title="Commercial and industrial exposure" description="Portfolio modules retain their existing actions while sitting in a clearer asset-position layer." icon={<Building2 className="h-4 w-4" />}>
        {/* Commercial Portfolio KPIs — mounted only when the Commercial &
            Industrial capability is held; their data hooks never fire
            otherwise. */}
        <div className="overview-portfolio-zone grid min-w-0 gap-4 animate-fade-in [&_.rounded-md]:rounded-xl [&_.rounded-md]:border-border/70 [&_.rounded-md]:bg-muted/25 [&>div]:min-w-0 [&>div]:rounded-2xl [&>div]:border-border/70 [&>div]:bg-card/90 [&>div]:shadow-sm dark:[&>div]:border-white/10 dark:[&>div]:bg-background/80">
          <CommercialPortfolioWidget />
          <IndustrialPortfolioWidget />
        </div>
      </OverviewSection>
      )}

      {/* Charts Section — Property Marketplace intelligence */}
      {marketplaceEnabled && (
      <OverviewSection eyebrow="Listings intelligence" title="Market intake and classification" description="Distribution charts are grouped into a calmer analytics surface for faster scanning." icon={<BarChart3 className="h-4 w-4" />}>
      <div className="min-w-0 space-y-4 md:space-y-6">
        {/* Row 1: Suburbs and Property Types */}
        <div className="grid min-w-0 gap-4 md:gap-6 lg:grid-cols-2 animate-fade-in">
          <Card className={CHART_CARD}>
            <CardHeader className={CHART_HEADER}>
              <CardTitle className={CHART_TITLE}>Listings by Suburb (Top 10)</CardTitle>
            </CardHeader>
            <CardContent className={CHART_CONTENT}>
              <ResponsiveContainer width="100%" height={isMobile ? 250 : 350}>
                <BarChart data={suburbData} margin={isMobile ? { top: 10, right: 8, left: -8, bottom: 80 } : { top: 20, right: 30, left: 20, bottom: 100 }}>
                  <CartesianGrid {...chartGridProps} />
                  <XAxis
                    dataKey="suburb"
                    angle={-45}
                    textAnchor="end"
                    height={isMobile ? 80 : 100}
                    fontSize={isMobile ? 10 : 12}
                    interval={0}
                    tick={chartAxisTick(isMobile)}
                    tickLine={false}
                    axisLine={{ stroke: OVERVIEW_CHART_COLORS.grid }}
                  />
                  <YAxis tick={chartAxisTick(isMobile)} tickLine={false} axisLine={false} width={isMobile ? 30 : 60} />
                  <Tooltip
                    contentStyle={premiumTooltipStyle}
                  />
                  <Bar dataKey="count" fill={OVERVIEW_CHART_COLORS.brand} radius={[8, 8, 0, 0]} activeBar={{ fill: OVERVIEW_CHART_COLORS.positive, radius: [8, 8, 0, 0] } as any} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className={CHART_CARD}>
            <CardHeader className={CHART_HEADER}>
              <CardTitle className={CHART_TITLE}>Property Types</CardTitle>
            </CardHeader>
            <CardContent className={`${CHART_CONTENT} flex h-full flex-col overflow-visible`}>
              <div className="overview-chart-container relative min-h-[300px] overflow-visible md:min-h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <Pie
                    data={propertyTypeData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={false}
                    outerRadius={isMobile ? 78 : 108}
                    fill="#8884d8"
                    dataKey="count"
                    nameKey="type"
                    stroke="hsl(var(--card))"
                    strokeWidth={2}
                    activeShape={{ outerRadius: isMobile ? 86 : 118 } as any}
                  >
                    {propertyTypeData.map((entry, index) => {
                      const pct = propertyTypeTotal > 0 ? ((entry.count / propertyTypeTotal) * 100).toFixed(1) : '0.0';
                      return (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                          aria-label={`${entry.type}: ${entry.count.toLocaleString('en-AU')} properties, ${pct} percent`}
                        />
                      );
                    })}
                  </Pie>
                  <Tooltip content={<PremiumPieTooltip unit="properties" />} wrapperStyle={{ zIndex: 50, pointerEvents: 'none' }} />
                </PieChart>
                </ResponsiveContainer>
              </div>
              <OverviewPieLegend data={propertyTypeData} labelKey="type" />
            </CardContent>
          </Card>
        </div>

        {/* Row 2: Daily Listings and Property Status */}
        <div className="grid min-w-0 gap-4 md:gap-6 lg:grid-cols-2 animate-fade-in">
          <Card className={CHART_CARD}>
            <CardHeader className={CHART_HEADER}>
              <CardTitle className={CHART_TITLE}>Daily Listings (Last 30 Days)</CardTitle>
            </CardHeader>
            <CardContent className={CHART_CONTENT}>
              <ResponsiveContainer width="100%" height={isMobile ? 220 : 300}>
                <LineChart data={dailyData} margin={isMobile ? { top: 10, right: 10, left: 0, bottom: 30 } : { top: 20, right: 30, left: 20, bottom: 40 }}>
                  <CartesianGrid {...chartGridProps} />
                  <XAxis
                    dataKey="date"
                    fontSize={isMobile ? 9 : 12}
                    tick={{ ...chartAxisTick(isMobile), textAnchor: 'middle' }}
                    tickLine={false}
                    axisLine={{ stroke: OVERVIEW_CHART_COLORS.grid }}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return `${date.getDate()}/${date.getMonth() + 1}`;
                    }}
                    interval={isMobile ? 'preserveStartEnd' : undefined}
                  />
                  <YAxis tick={chartAxisTick(isMobile)} tickLine={false} axisLine={false} width={isMobile ? 25 : 60} />
                  <Tooltip
                    labelFormatter={(value) => {
                      const date = new Date(value as string | number);
                      return date.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' });
                    }}
                    contentStyle={premiumTooltipStyle}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke={OVERVIEW_CHART_COLORS.brand}
                    strokeWidth={isMobile ? 2 : 3}
                    dot={isMobile ? false : { fill: OVERVIEW_CHART_COLORS.brand, stroke: OVERVIEW_CHART_COLORS.dotStroke, strokeWidth: 2, r: 4 }}
                    activeDot={{ r: isMobile ? 5 : 7, fill: OVERVIEW_CHART_COLORS.positive, stroke: OVERVIEW_CHART_COLORS.dotStroke, strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className={CHART_CARD}>
            <CardHeader className={CHART_HEADER}>
              <CardTitle className={CHART_TITLE}>Property Status</CardTitle>
            </CardHeader>
            <CardContent className={`${CHART_CONTENT} flex h-full flex-col overflow-visible`}>
              <div className="overview-chart-container relative min-h-[280px] overflow-visible md:min-h-[330px]">
                <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={isMobile ? { top: 24, right: 18, bottom: 24, left: 18 } : { top: 36, right: 42, bottom: 36, left: 42 }}>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    labelLine={!isMobile}
                    label={renderOverviewPieLabel('status', categoryData, isMobile)}
                    outerRadius={isMobile ? 74 : 100}
                    fill="#8884d8"
                    dataKey="count"
                    stroke="hsl(var(--card))"
                    strokeWidth={2}
                    activeShape={{ outerRadius: isMobile ? 82 : 110 } as any}
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<PremiumPieTooltip unit="properties" />} wrapperStyle={{ zIndex: 50, pointerEvents: 'none' }} />
                </PieChart>
                </ResponsiveContainer>
              </div>
              <OverviewPieLegend data={categoryData} labelKey="status" />
            </CardContent>
          </Card>
        </div>

        <div className="pt-1 md:pt-2">
          <div className="mb-4 flex items-center gap-2 border-t border-border/60 dark:border-white/[0.06] pt-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground/90">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl dashboard-luxury-icon-tile">
              <Database className="h-4 w-4" />
            </span>
            Source intelligence
          </div>
        </div>

        {/* Row 3: Source and Agency Distribution */}
        <div className="grid min-w-0 gap-4 md:gap-6 lg:grid-cols-2 animate-fade-in">
          <Card className={CHART_CARD}>
            <CardHeader className={CHART_HEADER}>
              <CardTitle className={CHART_TITLE}>Top Sender Emails</CardTitle>
            </CardHeader>
            <CardContent className={CHART_CONTENT}>
              <ResponsiveContainer width="100%" height={isMobile ? 260 : 350}>
                <BarChart data={sourceData} margin={isMobile ? { top: 10, right: 10, left: 0, bottom: 90 } : { top: 20, right: 30, left: 20, bottom: 120 }}>
                  <CartesianGrid {...chartGridProps} />
                  <XAxis
                    dataKey="source"
                    angle={-45}
                    textAnchor="end"
                    height={isMobile ? 90 : 120}
                    fontSize={isMobile ? 9 : 11}
                    interval={0}
                    tick={chartAxisTick(isMobile)}
                    tickLine={false}
                    axisLine={{ stroke: OVERVIEW_CHART_COLORS.grid }}
                  />
                  <YAxis tick={chartAxisTick(isMobile)} tickLine={false} axisLine={false} width={isMobile ? 25 : 60} />
                  <Tooltip
                    formatter={(value) => [value, 'Count']}
                    labelFormatter={(value) => `Source: ${value}`}
                    contentStyle={premiumTooltipStyle}
                  />
                  <Bar dataKey="count" fill={OVERVIEW_CHART_COLORS.teal} radius={[8, 8, 0, 0]} activeBar={{ fill: OVERVIEW_CHART_COLORS.brand, radius: [8, 8, 0, 0] } as any} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className={CHART_CARD}>
            <CardHeader className={CHART_HEADER}>
              <CardTitle className={CHART_TITLE}>Top Agencies</CardTitle>
            </CardHeader>
            <CardContent className={CHART_CONTENT}>
              <ResponsiveContainer width="100%" height={isMobile ? 260 : 350}>
                <BarChart data={agencyData} margin={isMobile ? { top: 10, right: 10, left: 0, bottom: 90 } : { top: 20, right: 30, left: 20, bottom: 120 }}>
                  <CartesianGrid {...chartGridProps} />
                  <XAxis
                    dataKey="agency"
                    angle={-45}
                    textAnchor="end"
                    height={isMobile ? 90 : 120}
                    fontSize={isMobile ? 9 : 11}
                    interval={0}
                    tick={chartAxisTick(isMobile)}
                    tickLine={false}
                    axisLine={{ stroke: OVERVIEW_CHART_COLORS.grid }}
                  />
                  <YAxis tick={chartAxisTick(isMobile)} tickLine={false} axisLine={false} width={isMobile ? 25 : 60} />
                  <Tooltip
                    formatter={(value) => [value, 'Count']}
                    labelFormatter={(value) => `Agency: ${value}`}
                    contentStyle={premiumTooltipStyle}
                  />
                  <Bar dataKey="count" fill={OVERVIEW_CHART_COLORS.neutral} radius={[8, 8, 0, 0]} activeBar={{ fill: OVERVIEW_CHART_COLORS.brand, radius: [8, 8, 0, 0] } as any} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
      </OverviewSection>
      )}

      {/* Recent Activity — listing records, part of the Property Marketplace */}
      {marketplaceEnabled && (
      <OverviewSection eyebrow="Recent activity" title="Latest property records" description="Newest listing records stay visible without competing with the analytics sections." icon={<FileText className="h-4 w-4" />} className="mb-4">
      <Card className={CHART_CARD}>
        <CardHeader className={`${CHART_HEADER} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
          <CardTitle className={CHART_TITLE}>Recent Activity</CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="overview-glass-button dashboard-luxury-action min-h-11 w-full rounded-full px-4 font-semibold transition-all duration-200 active:translate-y-0 sm:w-auto"
            onClick={() => navigate('/listings')}
          >
            View All Listings
          </Button>
        </CardHeader>
        <CardContent className="p-4 md:p-5">
          <div className="space-y-3 md:space-y-4">
            {recentListings.length === 0 && (
              <div className="overview-empty-state rounded-2xl border border-dashed p-8 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl dashboard-luxury-icon-tile">
                  <FileText className="h-5 w-5" />
                </div>
                <h4 className="text-sm font-semibold text-foreground">No recent listing activity</h4>
                <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground/90">
                  New property records will appear here once listings match the current overview filters.
                </p>
              </div>
            )}
            {recentListings.map((listing, index) => {
              const confidence = listing.confidence;
              const isHighConfidence = confidence !== undefined && confidence !== null && confidence >= 0.7;
              const isLowConfidence = confidence !== undefined && confidence !== null && confidence < 0.5;

              return (
                <div
                  key={listing.id}
                  className={cn(
                    "overview-activity-row group relative overflow-hidden rounded-2xl border p-4 transition-all duration-200 hover:-translate-y-0.5 md:p-5",
                    isHighConfidence && "border-success/25 bg-gradient-to-br from-success/8 via-card to-card",
                    isLowConfidence && "border-brand-500/35 bg-gradient-to-br from-brand-500/10 via-card to-card"
                  )}
                  style={{ animationDelay: `${index * 100}ms` }}
                >
                  <div
                    className={cn(
                      "absolute inset-y-0 left-0 w-1 bg-border transition-colors duration-200 group-hover:bg-primary/70",
                      isHighConfidence && "bg-success/70",
                      isLowConfidence && "bg-brand-500/80"
                    )}
                  />
                  <div className="flex flex-col gap-4 pl-1 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="min-w-0 flex-1 basis-full md:basis-auto">
                          <h4 className="truncate text-base font-semibold leading-tight tracking-tight text-foreground md:text-lg">
                            {listing.address || 'Unknown Address'}
                          </h4>
                        </div>
                        <Badge variant="outline" className="shrink-0 rounded-full border-[hsl(var(--brand-primary,var(--dashboard-primary-strong))/0.30)] bg-[hsl(var(--brand-primary,var(--dashboard-primary-strong))/0.11)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--brand-primary,var(--dashboard-primary-strong)))] md:text-xs">
                          {listing.propertyType || 'Unknown'}
                        </Badge>
                        {listing.status && listing.status !== 'Available' && (
                          <Badge variant="secondary" className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold md:text-xs">{listing.status}</Badge>
                        )}
                        {confidence !== undefined && confidence !== null && (
                          <ConfidenceBadge
                            confidence={confidence}
                            className={cn(
                              "shrink-0 rounded-full px-2.5 py-1 shadow-sm",
                              isHighConfidence && "ring-1 ring-success/30",
                              isLowConfidence && "ring-1 ring-brand-500/40"
                            )}
                          />
                        )}
                      </div>

                      <div className="grid gap-3 text-xs text-muted-foreground md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:text-sm">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          <span className="inline-flex items-center gap-1.5 font-medium text-foreground/80">
                            <MapPin className="h-3.5 w-3.5 text-primary/70" />
                            {listing.suburb || 'Unknown Suburb'}
                            {listingPostcode(listing) && (
                              <span className="text-muted-foreground/70">
                                {listingPostcode(listing)}
                              </span>
                            )}
                          </span>
                          {listing.beds && listing.beds > 0 && <span>{listing.beds} bed{listing.beds !== 1 ? 's' : ''}</span>}
                          {listing.baths && listing.baths > 0 && <span>{listing.baths} bath{listing.baths !== 1 ? 's' : ''}</span>}
                          {listing.carSpaces && listing.carSpaces > 0 && <span>{listing.carSpaces} car</span>}
                          {listing.images && listing.images.length > 0 && (
                            <div className="flex items-center gap-1">
                              <Image className="h-3 w-3" />
                              <span>{listing.images.length} image{listing.images.length !== 1 ? 's' : ''}</span>
                            </div>
                          )}
                          {listing.floorplans && listing.floorplans.length > 0 && (
                            <div className="flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              <span>{listing.floorplans.length} floorplan{listing.floorplans.length !== 1 ? 's' : ''}</span>
                            </div>
                          )}
                        </div>
                        {listing.price && listing.price > 0 && (
                          <span className="justify-self-start rounded-full border border-[hsl(var(--brand-primary,var(--dashboard-primary-strong))/0.24)] bg-[hsl(var(--brand-primary,var(--dashboard-primary-strong))/0.08)] px-3 py-1 text-sm font-bold text-[hsl(var(--brand-primary,var(--dashboard-primary-strong)))] md:justify-self-end">
                            {formatCurrency(listing.price)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3 text-left md:min-w-[220px] md:flex-col md:items-end md:justify-center md:border-t-0 md:border-l md:py-1 md:pl-5 md:text-right">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground md:text-[11px]">
                        {formatDate(listing.createdAt || listing.createdTime || listing.receivedAt)}
                      </div>
                      <div className="max-w-[220px] truncate text-xs font-medium text-foreground/80 md:text-sm">
                        From: {listing.source || listing.sourceHost || 'Unknown Sender'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
      </OverviewSection>
      )}
    </div>
  );
}
