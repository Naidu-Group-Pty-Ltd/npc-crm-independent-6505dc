import { Archive, CheckSquare, FileText, Filter, Layers3, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

interface ReportLibraryHeroProps {
  investmentCount: number | null;
  /** Null when the workspace does not hold the comparison capability — the
   * metric is omitted entirely rather than shown as a zero. */
  comparisonCount: number | null;
  visibleCount: number;
  activeFiltersCount: number;
  showArchived: boolean;
  selectedComparisonCount: number;
}

export function ReportLibraryHero({
  investmentCount,
  comparisonCount,
  visibleCount,
  activeFiltersCount,
  showArchived,
  selectedComparisonCount,
}: ReportLibraryHeroProps) {
  const totalReports = investmentCount === null ? null : investmentCount + (comparisonCount ?? 0);
  const metrics = [
    { label: 'Total reports', value: totalReports, icon: Layers3 },
    { label: 'Investment reports', value: investmentCount, icon: TrendingUp },
    ...(comparisonCount === null
      ? []
      : [{ label: 'Comparison analyses', value: comparisonCount, icon: FileText }]),
    { label: 'Currently visible', value: visibleCount, icon: Archive },
    { label: 'Active filters', value: activeFiltersCount, icon: Filter },
  ];

  if (selectedComparisonCount > 0) {
    metrics.push({ label: 'Selected for comparison', value: selectedComparisonCount, icon: CheckSquare });
  }

  return (
    <DashboardThemeFrame as="header" variant="hero" className="border-primary/20 shadow-lg shadow-primary/5">
      <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-brand-400/20 blur-3xl dark:bg-brand-300/10" />
      <div className="pointer-events-none absolute left-10 top-0 h-px w-2/3 bg-gradient-to-r from-transparent via-brand-400/60 to-transparent" />
      <div className="relative flex flex-col gap-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <Badge className="mb-3 border-brand-400/25 bg-brand-500/10 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-700 hover:bg-brand-500/10 dark:text-brand-300" variant="outline">
              Report Intelligence Library
            </Badge>
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-foreground md:text-5xl">
              Generated Reports
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
              Search, review, compare, archive, and export every generated property report from one governed workspace.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <Badge variant={showArchived ? 'secondary' : 'outline'} className="rounded-full px-3 py-1 text-xs">
              Archived {showArchived ? 'visible' : 'hidden'}
            </Badge>
            <Badge variant={activeFiltersCount > 0 ? 'secondary' : 'outline'} className="rounded-full px-3 py-1 text-xs">
              {activeFiltersCount} active filter{activeFiltersCount === 1 ? '' : 's'}
            </Badge>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {metrics.map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-2xl border border-border/60 bg-background/65 p-3 shadow-sm shadow-sm dark:shadow-black/5 backdrop-blur dark:border-white/10 dark:bg-background/45"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
                <Icon className="h-4 w-4 text-brand-600/80 dark:text-brand-300/80" />
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{value ?? 'Unavailable'}</div>
            </div>
          ))}
        </div>
      </div>
    </DashboardThemeFrame>
  );
}
