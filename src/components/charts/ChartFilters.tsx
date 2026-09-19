import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Search, LayoutGrid, List, CheckSquare, X, FolderOpen, CalendarDays, Sparkles, CheckCircle2 } from 'lucide-react';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

interface ChartFiltersProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  chartTypeFilter: string;
  onChartTypeChange: (type: string) => void;
  reportFilter: string;
  onReportChange: (id: string) => void;
  sortBy: string;
  onSortChange: (sort: string) => void;
  dateRange: string;
  onDateRangeChange: (range: string) => void;
  viewMode: 'grid' | 'list' | 'grouped';
  onViewModeChange: (mode: 'grid' | 'list' | 'grouped') => void;
  selectionMode: boolean;
  onToggleSelectionMode: () => void;
  selectedCount: number;
  chartTypes: string[];
  reports: { id: string; title: string }[];
}

export function ChartFilters({
  searchQuery, onSearchChange,
  chartTypeFilter, onChartTypeChange,
  reportFilter, onReportChange,
  sortBy, onSortChange,
  dateRange, onDateRangeChange,
  viewMode, onViewModeChange,
  selectionMode, onToggleSelectionMode,
  selectedCount,
  chartTypes,
  reports,
}: ChartFiltersProps) {
  const filterTriggerClass = (isActive = false) => cn(
    'h-11 min-w-0 w-full justify-between rounded-xl sm:min-w-[9.25rem] sm:w-auto border bg-background/80 px-3 text-sm font-semibold text-foreground shadow-sm shadow-sm dark:shadow-black/5 transition-all duration-200',
    'hover:-translate-y-0.5 hover:border-brand-300/60 hover:bg-brand-500/10 hover:shadow-[0_12px_28px_hsl(43_74%_49%/0.13)]',
    'focus:ring-2 focus:ring-brand-300/45 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-brand-300/55 data-[state=open]:border-brand-300/70 data-[state=open]:bg-brand-500/10 data-[state=open]:shadow-[0_14px_32px_hsl(43_74%_49%/0.16)]',
    isActive
      ? 'border-brand-300/70 bg-gradient-to-r from-brand-500/18 to-primary/10 text-primary shadow-[0_10px_26px_hsl(43_74%_49%/0.14)]'
      : 'border-border/60'
  );

  return (
    <DashboardThemeFrame variant="toolbar" className="block border-brand-200/18 bg-[radial-gradient(circle_at_top_left,hsl(43_96%_56%/0.08),transparent_34%),linear-gradient(145deg,hsl(var(--card)/0.94),hsl(var(--background)/0.88))] p-3 shadow-2xl shadow-sm dark:shadow-black/10 sm:p-4">
      <div className="pointer-events-none -mx-1 -mt-1 mb-3 h-px bg-gradient-to-r from-transparent via-brand-300/60 to-transparent" />
      {/* Search + filters */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="relative min-w-0 flex-1" role="search" aria-label="Search charts">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-500/85" />
          <Input
            id="charts-search"
            type="search"
            aria-label="Search charts by title, report, or analysis"
            placeholder="Search charts by title, report, or analysis..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-12 rounded-2xl border-primary/15 bg-background/85 pl-12 pr-11 text-base font-medium shadow-inner shadow-sm dark:shadow-black/5 transition-all placeholder:text-foreground/45 hover:border-brand-300/45 hover:bg-brand-500/5 focus-visible:border-brand-300/85 focus-visible:bg-background focus-visible:ring-4 focus-visible:ring-brand-300/24 focus-visible:shadow-[inset_0_1px_0_hsl(var(--background)),0_0_0_1px_hsl(43_96%_56%/0.18),0_14px_34px_hsl(43_74%_49%/0.12)]"
          />
          {searchQuery && (
            <Button variant="ghost" size="icon" className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full hover:bg-brand-500/12 hover:text-primary focus-visible:ring-2 focus-visible:ring-brand-300/45" onClick={() => onSearchChange('')} aria-label="Clear chart search">
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:flex sm:flex-wrap xl:justify-end [&_[role=combobox]]:min-h-11">
          <Select value={chartTypeFilter} onValueChange={onChartTypeChange}>
            <SelectTrigger aria-label="Filter charts by chart type" className={filterTriggerClass(chartTypeFilter !== 'all')}>
              <SelectValue placeholder="Chart type" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-primary/15 bg-popover/95 shadow-xl backdrop-blur">
              <SelectItem value="all">All types</SelectItem>
              {chartTypes.map(t => (
                <SelectItem key={t} value={t} className="capitalize focus:bg-brand-500/10 focus:text-primary">{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={reportFilter} onValueChange={onReportChange}>
            <SelectTrigger aria-label="Filter charts by report" className={cn(filterTriggerClass(reportFilter !== 'all'), 'sm:min-w-[10.75rem]')}>
              <SelectValue placeholder="All reports" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-primary/15 bg-popover/95 shadow-xl backdrop-blur">
              <SelectItem value="all">All reports</SelectItem>
              {reports.map(r => (
                <SelectItem key={r.id} value={r.id} className="focus:bg-brand-500/10 focus:text-primary">
                  <span className="block max-w-[13rem] truncate">{r.title}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date range filter (Enhancement #5) */}
          <Select value={dateRange} onValueChange={onDateRangeChange}>
            <SelectTrigger aria-label="Filter charts by date range" className={filterTriggerClass(dateRange !== 'all')}>
              <CalendarDays className="mr-1.5 h-3.5 w-3.5 shrink-0 text-brand-500/85" />
              <SelectValue placeholder="Date range" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-primary/15 bg-popover/95 shadow-xl backdrop-blur">
              <SelectItem value="all">All time</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="6m">Last 6 months</SelectItem>
              <SelectItem value="1y">Last year</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={onSortChange}>
            <SelectTrigger aria-label="Sort charts" className={filterTriggerClass(sortBy !== 'newest')}>
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-primary/15 bg-popover/95 shadow-xl backdrop-blur">
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="title_asc">Title A–Z</SelectItem>
              <SelectItem value="title_desc">Title Z–A</SelectItem>
              <SelectItem value="type">By type</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Action row */}
      <div className="mt-3 flex flex-col gap-2 border-t border-border/50 pt-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex min-h-11 w-full items-center overflow-hidden sm:w-auto rounded-2xl border border-brand-300/25 bg-gradient-to-b from-background/95 to-muted/35 p-1 shadow-[inset_0_1px_0_hsl(var(--background)),0_14px_34px_hsl(43_74%_49%/0.09)]" role="group" aria-label="Chart view mode">
          {[
            { mode: 'grid' as const, title: 'Grid view', icon: LayoutGrid },
            { mode: 'list' as const, title: 'List view', icon: List },
            { mode: 'grouped' as const, title: 'Group by report', icon: FolderOpen },
          ].map(({ mode, title, icon: Icon }) => {
            const active = viewMode === mode;
            return (
              <Button
                key={mode}
                variant="ghost"
                size="sm"
                className={cn(
                  'relative h-10 min-w-11 flex-1 rounded-xl px-3 sm:flex-none text-muted-foreground transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-300/45 focus-visible:ring-offset-0',
                  'hover:-translate-y-0.5 hover:bg-brand-500/12 hover:text-foreground hover:shadow-[0_8px_20px_hsl(43_74%_49%/0.12)] active:translate-y-0',
                  active && 'bg-gradient-to-br from-brand-300 via-brand-400 to-primary text-primary-foreground shadow-[0_10px_24px_hsl(43_74%_49%/0.28)] hover:bg-brand-400 hover:text-primary-foreground active:scale-[0.98]'
                )}
                onClick={() => onViewModeChange(mode)}
                title={title}
                aria-label={title}
                aria-pressed={active}
              >
                {active && <span className="absolute inset-x-2 top-0 h-px rounded-full bg-brand-50/90" />}
                <Icon className="h-3.5 w-3.5 shrink-0" />
              </Button>
            );
          })}
        </div>

        <Button
          variant={selectionMode ? 'default' : 'outline'}
          size="sm"
          className={cn(
            'group h-11 w-full gap-1.5 sm:w-auto rounded-2xl border-brand-300/35 bg-background/80 px-3 text-xs font-semibold shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300/70 hover:bg-brand-500/10 hover:text-primary hover:shadow-[0_12px_28px_hsl(43_74%_49%/0.16)] active:translate-y-0 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-brand-300/45 focus-visible:ring-offset-0',
            selectionMode && 'border-brand-200/80 bg-gradient-to-r from-primary via-brand-500 to-brand-400 text-primary-foreground shadow-[0_16px_36px_hsl(43_74%_49%/0.30),0_0_0_1px_hsl(43_96%_56%/0.30)] hover:text-primary-foreground'
          )}
          onClick={onToggleSelectionMode}
          aria-pressed={selectionMode}
          aria-label={selectionMode ? `Exit chart selection mode with ${selectedCount} selected` : 'Enter chart selection mode'}
        >
          {selectionMode ? <Sparkles className="h-3.5 w-3.5 drop-shadow-sm" /> : <CheckSquare className="h-3.5 w-3.5 transition-transform group-hover:scale-110" />}
          <span>{selectionMode ? 'Selecting' : 'Select'}</span>
          {selectionMode && (
            <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-brand-100/45 bg-card/20 dark:bg-white/20 px-1.5 text-[10px] font-black tabular-nums shadow-inner">
              <CheckCircle2 className="mr-1 h-3 w-3" />
              {selectedCount}
            </span>
          )}
        </Button>
      </div>
    </DashboardThemeFrame>
  );
}
