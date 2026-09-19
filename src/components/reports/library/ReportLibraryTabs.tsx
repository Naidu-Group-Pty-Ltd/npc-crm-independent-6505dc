import { ChevronRight, MapPin, TrendingUp, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

interface ReportLibraryTabsProps {
  isMobile: boolean;
  investmentCount: number | null;
  comparisonCount: number;
  /** Whether the workspace holds the Report Comparisons capability. When
   * false the Comparisons tab is removed — not disabled, not badged. */
  showComparisons?: boolean;
}

const workspaceTabs: Array<{
  value: 'investment' | 'comparisons';
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
];

export function ReportLibraryTabs({ isMobile, investmentCount, comparisonCount, showComparisons = true }: ReportLibraryTabsProps) {
  const counts = {
    investment: investmentCount,
    comparisons: comparisonCount,
  };

  const visibleTabs = workspaceTabs.filter((tab) => tab.value !== 'comparisons' || showComparisons);

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 pt-1 md:mx-0 md:overflow-visible md:px-0">
      {/* The toolbar frame already supplies a themed, brand-aware surface —
          previously it was overridden with fixed dark gradients and a purple
          glow, which fought the light theme and ignored white-label branding. */}
      <DashboardThemeFrame
        variant="toolbar"
        className="min-w-max rounded-[1.6rem] p-3 md:min-w-0 md:p-4"
      >
        <TabsList className={isMobile ? 'inline-flex h-auto w-auto min-w-full gap-3 bg-transparent p-0' : `grid h-auto w-full ${visibleTabs.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-4 bg-transparent p-0 lg:gap-5`}>
          {visibleTabs.map(({ value, label, mobileLabel, description, icon: Icon }) => (
            <TabsTrigger
              key={value}
              value={value}
              className="group relative h-auto min-h-[96px] min-w-[18rem] overflow-hidden rounded-[1.25rem] border border-border bg-card/60 px-5 py-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:hover:translate-y-0 data-[state=active]:border-primary/60 data-[state=active]:bg-gradient-to-br data-[state=active]:from-primary/15 data-[state=active]:via-card data-[state=active]:to-card data-[state=active]:text-foreground data-[state=active]:shadow-md data-[state=active]:ring-1 data-[state=active]:ring-primary/25 md:min-w-0 lg:min-h-[104px]"
            >
              <span className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 transition-opacity duration-200 group-data-[state=active]:opacity-100" />
              <span className="flex w-full items-start justify-between gap-4">
                <span className="flex min-w-0 items-start gap-3.5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted text-muted-foreground transition-all duration-200 group-hover:border-primary/30 group-hover:bg-primary/10 group-hover:text-primary group-data-[state=active]:border-primary/45 group-data-[state=active]:bg-primary/15 group-data-[state=active]:text-primary motion-reduce:transition-none">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 space-y-2 pt-0.5">
                    <span className="block text-[15px] font-bold leading-none tracking-tight text-foreground md:text-base">
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
