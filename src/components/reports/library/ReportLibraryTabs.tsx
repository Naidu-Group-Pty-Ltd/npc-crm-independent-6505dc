import { useEffect, useRef } from 'react';
import { ChevronRight, Factory, MapPin, TrendingUp, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

export type ReportLibraryTab = 'investment' | 'comparisons' | 'commercial';

interface ReportLibraryTabsProps {
  isMobile: boolean;
  investmentCount: number | null;
  comparisonCount: number;
  /** Whether the workspace holds the Report Comparisons capability. When
   * false the Comparisons tab is removed — not disabled, not badged. */
  showComparisons?: boolean;
  /** Commercial & Industrial Capacity Reports; null while they are being read. */
  commercialCount?: number | null;
  /** Whether the workspace holds the Commercial & Industrial module. Removed, like Comparisons, when not. */
  showCommercial?: boolean;
  /**
   * The open tab. On a phone the tabs are a strip that scrolls sideways, and a
   * tab opened by a link can start out of view — Commercial & Industrial is the
   * third — so the strip brings the open one in.
   */
  activeTab?: ReportLibraryTab;
}

/** The strip's side padding (`px-4`), so a card brought into view is not flush against the edge. */
const STRIP_INSET_PX = 16;

const workspaceTabs: Array<{
  value: ReportLibraryTab;
  label: string;
  mobileLabel: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: 'investment',
    label: 'Investment',
    mobileLabel: 'Invest',
    description: 'Property, suburb, postcode, and state intelligence',
    icon: TrendingUp,
  },
  {
    value: 'comparisons',
    label: 'Comparisons',
    mobileLabel: 'Compare',
    description: 'Multi-property decision analysis',
    icon: MapPin,
  },
  {
    value: 'commercial',
    label: 'Commercial & Industrial',
    mobileLabel: 'C&I',
    description: 'Capacity reports from your assessments',
    icon: Factory,
  },
];

export function ReportLibraryTabs({
  isMobile, investmentCount, comparisonCount, showComparisons = true,
  commercialCount = null, showCommercial = false, activeTab,
}: ReportLibraryTabsProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const counts: Record<ReportLibraryTab, number | null> = {
    investment: investmentCount,
    comparisons: comparisonCount,
    commercial: commercialCount,
  };

  const visibleTabs = workspaceTabs.filter((tab) => (
    (tab.value !== 'comparisons' || showComparisons) && (tab.value !== 'commercial' || showCommercial)
  ));

  // Three cards do not fit three to a row at every width the page gets — the
  // sidebar takes 16rem from 768px up, so a 1280px screen leaves about 1000px.
  // So three wrap as many to a row as fit, one alone on a row takes the row,
  // and their text wraps inside the card: the shadcn trigger is
  // `whitespace-nowrap` and this card clips its overflow, so without it a
  // narrow card cut its own title off. One or two tabs render as they always did.
  const wraps = visibleTabs.length > 2;
  const listLayout = wraps
    ? 'flex flex-wrap items-stretch'
    : `grid ${visibleTabs.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`;
  const cardFlow = wraps ? `whitespace-normal ${isMobile ? '' : 'flex-[1_1_17rem] '}` : '';

  useEffect(() => {
    if (!isMobile || !activeTab) return;
    const strip = stripRef.current;
    const active = strip?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!strip || !active) return;
    const view = strip.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    if (box.left >= view.left && box.right <= view.right) return;
    // Scroll the strip, never the page (`scrollIntoView` would move the window
    // too), and align the card's start with the strip's own inset: a card can
    // be wider than a phone, and its title is at its start.
    strip.scrollLeft += box.left - view.left - STRIP_INSET_PX;
  }, [isMobile, activeTab]);

  return (
    <div ref={stripRef} className="-mx-4 overflow-x-auto px-4 pb-1 pt-1 md:mx-0 md:overflow-visible md:px-0">
      {/* The toolbar frame already supplies a themed, brand-aware surface —
          previously it was overridden with fixed dark gradients and a purple
          glow, which fought the light theme and ignored white-label branding. */}
      <DashboardThemeFrame
        variant="toolbar"
        className="min-w-max rounded-[1.6rem] p-3 md:min-w-0 md:p-4"
      >
        <TabsList className={isMobile ? 'inline-flex h-auto w-auto min-w-full gap-3 bg-transparent p-0' : `${listLayout} h-auto w-full gap-4 bg-transparent p-0 lg:gap-5`}>
          {visibleTabs.map(({ value, label, mobileLabel, description, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className={`${cardFlow}group relative h-auto min-h-[96px] min-w-[18rem] overflow-hidden rounded-[1.25rem] border border-border bg-card/60 px-5 py-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0 data-[state=active]:border-primary/60 data-[state=active]:bg-gradient-to-br data-[state=active]:from-primary/15 data-[state=active]:via-card data-[state=active]:to-card data-[state=active]:text-foreground data-[state=active]:shadow-md data-[state=active]:ring-1 data-[state=active]:ring-primary/25 md:min-w-0 lg:min-h-[104px]`}
            >
              <span className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 transition-opacity duration-200 group-data-[state=active]:opacity-100" />
              <span className="flex w-full items-start justify-between gap-4">
                <span className="flex min-w-0 items-start gap-3.5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground transition-all duration-200 group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary group-data-[state=active]:border-primary/45 group-data-[state=active]:bg-primary/15 group-data-[state=active]:text-primary motion-reduce:transition-none">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 space-y-2 pt-0.5">
                    <span className={`block text-[15px] font-bold ${wraps ? 'leading-tight' : 'leading-none'} tracking-tight text-foreground md:text-base`}>
                      <span className="hidden sm:inline">{label}</span>
                      <span className="sm:hidden">{mobileLabel}</span>
                    </span>
                    <span className="block max-w-[14rem] text-[12.5px] font-normal leading-5 text-muted-foreground transition-colors group-data-[state=active]:text-foreground/75 sm:max-w-none">
                      {description}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-3">
                  <Badge variant="secondary" className="flex h-7 min-w-7 items-center justify-center rounded-full border border-border px-2 text-xs font-bold text-foreground transition-colors group-data-[state=active]:border-primary/40 group-data-[state=active]:bg-primary/15 group-data-[state=active]:text-foreground">
                    {counts[value] ?? '—'}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/55 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-primary group-data-[state=active]:text-primary motion-reduce:transition-none" aria-hidden="true" />
                </span>
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </DashboardThemeFrame>
    </div>
  );
}
