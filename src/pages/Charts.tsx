import { useEffect, useState, useMemo, useCallback } from 'react';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { AlertCircle, BarChart3, Download, RefreshCw, ChevronDown, FileText, CheckCircle2, SearchX, SlidersHorizontal, X } from 'lucide-react';
import { toast } from 'sonner';
import { subDays, subMonths, subYears } from 'date-fns';
import { ChartCard, type ChartData } from '@/components/charts/ChartCard';
import { ChartListRow } from '@/components/charts/ChartListRow';
import { ChartLightbox } from '@/components/charts/ChartLightbox';
import { ChartFilters } from '@/components/charts/ChartFilters';
import { ChartStats } from '@/components/charts/ChartStats';
import { useChartExport } from '@/components/charts/useChartExport';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { buildChartReportOptions, type ChartSourceReport } from '@/lib/chartReportLabels';
import { buildChartInsight, isUsefulAnalysis } from '@/components/charts/chartAnalysis';

const CHARTS_PER_PAGE = 24;

export default function Charts() {
  const { canEdit: canEditCharts } = useModulePermissions('charts');
  const [charts, setCharts] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters & view state
  const [searchQuery, setSearchQuery] = useState('');
  const [chartTypeFilter, setChartTypeFilter] = useState('all');
  const [reportFilter, setReportFilter] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [dateRange, setDateRange] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'grouped'>('grid');
  const [visibleCount, setVisibleCount] = useState(CHARTS_PER_PAGE);

  // Selection
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Lightbox
  const [expandedChart, setExpandedChart] = useState<ChartData | null>(null);

  // Delete confirmation
  const [chartToDelete, setChartToDelete] = useState<ChartData | null>(null);

  const { exportSingle, exportBulk, exporting } = useChartExport();

  const fetchCharts = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const { data: chartsResult, error: chartsError } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'charts',
        listOptions: {
          select: 'id, chart_type, title, image_data, created_at, report_id, chart_config, dataset, analysis_text, summary_text, chart_key, sort_order, report_date, generated_at',
          orderBy: 'created_at',
          orderAsc: false,
          limit: 100,
        },
      });

      if (chartsError) {
        console.error('Error fetching charts:', chartsError);
        toast.error('Failed to load charts');
        setLoadError('Charts could not be loaded. Please retry when your connection is stable.');
        return;
      }

      const chartsData = chartsResult?.records || [];

      // Fetch linked reports
      const reportIds = [...new Set(chartsData.map((c: any) => c.report_id).filter(Boolean))];
      let reportsMap = new Map();

      if (reportIds.length > 0) {
        const { data: reportsResult, error: reportsError } = await invokeSecureFunction('get-investment-reports', {
          table: 'generated_reports',
          reportIds,
          listOptions: { select: 'id, title, created_at, generated_at, period_end, report_type, status' }
        });
        if (!reportsError && reportsResult?.reports) {
          reportsResult.reports
            .filter((r: any) => (r.status ?? 'completed') === 'completed' && (r.report_type ?? 'quantitative') === 'quantitative')
            .forEach((r: any) => reportsMap.set(r.id, r));
        }
      }

      // Fetch chart analysis (Enhancement #1)
      const chartIds = chartsData.map((c: any) => c.id);
      let analysisMap = new Map<string, string>();

      if (chartIds.length > 0) {
        try {
          const { data: analysisResult } = await invokeSecureFunction('manage-templates', {
            operation: 'list',
            table: 'chart_analysis',
            listOptions: {
              select: 'chart_id, analysis_text, created_at',
              orderBy: 'created_at',
              orderAsc: false,
              limit: 100,
            },
          });
          if (analysisResult?.records) {
            analysisResult.records.forEach((a: any) => {
              if (a.chart_id && a.analysis_text) {
                analysisMap.set(a.chart_id, a.analysis_text);
              }
            });
          }
        } catch (e) {
          console.log('No chart analysis available');
        }
      }

      const reportDisplayLabels = new Map(
        buildChartReportOptions(Array.from(reportsMap.values()))
          .map(report => [report.id, report.label]),
      );

      const transformed: ChartData[] = chartsData
        .filter((chart: any) => chart.report_id && reportsMap.has(chart.report_id))
        .map((chart: any) => {
          const next = {
            ...chart,
            generated_reports: chart.report_id && reportsMap.has(chart.report_id)
              ? {
                  ...reportsMap.get(chart.report_id),
                  display_title: reportDisplayLabels.get(chart.report_id),
                }
              : null,
            analysis_text: chart.analysis_text || analysisMap.get(chart.id) || null,
          } as ChartData;
          if (!isUsefulAnalysis(next.analysis_text)) {
            const insight = buildChartInsight(next);
            if (insight) next.analysis_text = insight.fullAnalysis;
          }
          return next;
        });

      setCharts(transformed);

      const backfills = transformed
        .filter((chart) => chart.analysis_text && !isUsefulAnalysis(chartsData.find((raw: any) => raw.id === chart.id)?.analysis_text || analysisMap.get(chart.id)))
        .slice(0, 12);
      if (canEditCharts && backfills.length > 0) {
        void Promise.allSettled(backfills.map((chart) => invokeSecureFunction('manage-templates', {
          operation: 'update',
          table: 'charts',
          recordId: chart.id,
          data: { analysis_text: chart.analysis_text, summary_text: chart.analysis_text?.split('\n')[0]?.replace(/^Key finding:\s*/i, '') ?? null },
        }))).catch((error) => console.warn('Chart analysis backfill failed', error));
      }
    } catch (error) {
      console.error('Error:', error);
      toast.error('Failed to load charts');
      setLoadError('Charts could not be loaded. Please retry when your connection is stable.');
    } finally {
      setLoading(false);
    }
  }, [canEditCharts]);

  useEffect(() => { fetchCharts(); }, [fetchCharts]);
  useEffect(() => {
    const refresh = () => fetchCharts();
    window.addEventListener('quantitative-report-generated', refresh);
    return () => window.removeEventListener('quantitative-report-generated', refresh);
  }, [fetchCharts]);

  // Derived data
  const chartTypes = useMemo(() => [...new Set(charts.map(c => c.chart_type))].sort(), [charts]);
  const uniqueReports = useMemo(() => {
    return buildChartReportOptions(
      charts.flatMap(c => c.generated_reports ? [c.generated_reports as ChartSourceReport] : []),
    ).map(({ id, label }) => ({ id, title: label }));
  }, [charts]);
  const reportLabels = useMemo(
    () => new Map(uniqueReports.map(report => [report.id, report.title])),
    [uniqueReports],
  );

  // Date range cutoff
  const dateCutoff = useMemo(() => {
    const now = new Date();
    switch (dateRange) {
      case '7d': return subDays(now, 7);
      case '30d': return subDays(now, 30);
      case '90d': return subDays(now, 90);
      case '6m': return subMonths(now, 6);
      case '1y': return subYears(now, 1);
      default: return null;
    }
  }, [dateRange]);

  // Filtering + sorting
  const filteredCharts = useMemo(() => {
    let result = [...charts];

    // Search — also searches analysis text
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.chart_type.toLowerCase().includes(q) ||
        reportLabels.get(c.report_id)?.toLowerCase().includes(q) ||
        c.analysis_text?.toLowerCase().includes(q)
      );
    }

    if (chartTypeFilter !== 'all') {
      result = result.filter(c => c.chart_type === chartTypeFilter);
    }

    if (reportFilter !== 'all') {
      result = result.filter(c => c.report_id === reportFilter);
    }

    // Date range filter (Enhancement #5)
    if (dateCutoff) {
      result = result.filter(c => new Date(c.created_at) >= dateCutoff);
    }

    // Sort
    switch (sortBy) {
      case 'newest':
        result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
      case 'oldest':
        result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        break;
      case 'title_asc':
        result.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'title_desc':
        result.sort((a, b) => b.title.localeCompare(a.title));
        break;
      case 'type':
        result.sort((a, b) => a.chart_type.localeCompare(b.chart_type) || a.title.localeCompare(b.title));
        break;
    }

    return result;
  }, [charts, searchQuery, chartTypeFilter, reportFilter, sortBy, dateCutoff, reportLabels]);

  // Pagination (Enhancement #9)
  const paginatedCharts = useMemo(() => filteredCharts.slice(0, visibleCount), [filteredCharts, visibleCount]);
  const hasMore = visibleCount < filteredCharts.length;

  // Reset pagination when filters change
  useEffect(() => { setVisibleCount(CHARTS_PER_PAGE); }, [searchQuery, chartTypeFilter, reportFilter, sortBy, dateRange]);

  // Grouped view data (Enhancement #2)
  const groupedByReport = useMemo(() => {
    if (viewMode !== 'grouped') return [];
    const groups = new Map<string, { reportTitle: string; reportId: string; charts: ChartData[] }>();
    const ungrouped: ChartData[] = [];

    paginatedCharts.forEach(c => {
      if (c.generated_reports) {
        const key = c.report_id;
        if (!groups.has(key)) {
          groups.set(key, { reportTitle: reportLabels.get(key) ?? c.generated_reports.title, reportId: c.report_id, charts: [] });
        }
        groups.get(key)!.charts.push(c);
      } else {
        ungrouped.push(c);
      }
    });

    const result = Array.from(groups.values());
    if (ungrouped.length > 0) {
      result.push({ reportTitle: 'Unlinked Charts', reportId: 'none', charts: ungrouped });
    }
    return result;
  }, [viewMode, paginatedCharts, reportLabels]);

  // Selection handlers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode(prev => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filteredCharts.map(c => c.id)));
  }, [filteredCharts]);

  // Lightbox navigation
  const expandedIndex = expandedChart ? filteredCharts.findIndex(c => c.id === expandedChart.id) : -1;
  const handleLightboxPrev = useCallback(() => {
    if (expandedIndex > 0) setExpandedChart(filteredCharts[expandedIndex - 1]);
  }, [expandedIndex, filteredCharts]);
  const handleLightboxNext = useCallback(() => {
    if (expandedIndex < filteredCharts.length - 1) setExpandedChart(filteredCharts[expandedIndex + 1]);
  }, [expandedIndex, filteredCharts]);

  const handleBulkExport = useCallback((options?: { format?: 'png' | 'svg'; includeAnalysis?: boolean }) => {
    const selectedCharts = charts.filter(c => selectedIds.has(c.id));
    exportBulk(selectedCharts, options);
  }, [charts, selectedIds, exportBulk]);

  // Delete handler (Enhancement #4)
  const handleDeleteConfirm = useCallback(async () => {
    if (!chartToDelete) return;
    try {
      await invokeSecureFunction('manage-templates', {
        operation: 'delete',
        table: 'charts',
        recordId: chartToDelete.id,
      });
      setCharts(prev => prev.filter(c => c.id !== chartToDelete.id));
      toast.success(`Deleted "${chartToDelete.title}"`);
    } catch (error) {
      toast.error('Failed to delete chart');
    } finally {
      setChartToDelete(null);
    }
  }, [chartToDelete]);

  // Shared card/row props
  const cardProps = useCallback((chart: ChartData) => ({
    chart,
    isSelected: selectedIds.has(chart.id),
    onToggleSelect: toggleSelect,
    onExpand: setExpandedChart,
    onExport: exportSingle,
    onDelete: canEditCharts ? setChartToDelete : undefined,
    selectionMode,
  }), [selectedIds, toggleSelect, exportSingle, canEditCharts, selectionMode]);

  const isRefreshing = loading && charts.length > 0;

  // Loading skeleton
  if (loading && charts.length === 0) {
    return (
      <main className="min-h-screen animate-fade-in overflow-hidden bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_32%),radial-gradient(circle_at_85%_0%,hsl(43_96%_56%/0.12),transparent_30%)] p-4 sm:p-6">
        <DashboardThemeFrame variant="page" className="max-w-[1700px] space-y-6">
          <DashboardThemeFrame as="header" variant="hero" className="border-primary/20 p-6 shadow-2xl shadow-sm dark:shadow-black/15">
            <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-300/85 to-transparent" />
            <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-brand-300/15 blur-3xl" />
            <div className="flex items-center gap-4">
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary via-brand-400 to-primary/75 shadow-[0_18px_36px_hsl(var(--primary)/0.22)] ring-1 ring-brand-200/45">
                <RefreshCw className="h-6 w-6 animate-spin text-primary-foreground" />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-[-0.035em] text-foreground sm:text-4xl">Preparing charts</h1>
                <p className="text-sm leading-6 text-muted-foreground">Loading saved visual analytics, report links and chart insights.</p>
              </div>
            </div>
          </DashboardThemeFrame>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="overflow-hidden border-border/60 bg-card/80 shadow-lg">
                <CardContent className="space-y-3 p-4">
                  <div className="h-3 w-16 animate-pulse rounded-full bg-muted" />
                  <div className="h-8 w-24 animate-pulse rounded-lg bg-muted/80" />
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="overflow-hidden rounded-[1.35rem] border-border/60 bg-card/80 shadow-xl">
                <CardContent className="space-y-4 p-4">
                  <div className="space-y-2">
                    <div className="h-4 w-3/4 animate-pulse rounded-full bg-muted" />
                    <div className="h-3 w-1/2 animate-pulse rounded-full bg-muted/80" />
                  </div>
                  <div className="relative h-52 overflow-hidden rounded-xl border bg-muted/40">
                    <div className="absolute inset-y-0 -left-1/2 w-1/2 animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-white/35 to-transparent" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </DashboardThemeFrame>
      </main>
    );
  }

  return (
    <main className="min-h-screen animate-fade-in bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.12),transparent_32%),radial-gradient(circle_at_85%_10%,hsl(43_96%_56%/0.09),transparent_28%)] p-4 sm:p-6">
      <DashboardThemeFrame variant="page" className="max-w-[1700px] space-y-7">
        {/* Header */}
        <DashboardThemeFrame as="header" variant="hero" className="border-primary/20 p-5 shadow-2xl shadow-sm dark:shadow-black/15 sm:p-6">
          <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-300/85 to-transparent" />
          <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-brand-300/10 blur-3xl" />
          <div className="pointer-events-none absolute -left-20 bottom-0 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 flex-col gap-4 min-[420px]:flex-row min-[420px]:items-start">
              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-brand-400 to-primary/75 shadow-[0_18px_36px_hsl(var(--primary)/0.22)] ring-1 ring-brand-200/45">
                <div className="absolute inset-x-3 top-0 h-px bg-brand-100/90" />
                <div className="absolute -right-3 -top-3 h-8 w-8 rounded-full bg-card/20 dark:bg-white/20 blur-md" />
                <BarChart3 className="relative h-6 w-6 text-primary-foreground drop-shadow-sm" />
              </div>
              <div className="min-w-0 space-y-1.5">
                <h1 className="text-3xl font-bold tracking-[-0.035em] text-foreground sm:text-4xl">Charts</h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">Visual analytics generated from reports</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center md:justify-end">
              <Badge variant="secondary" className="h-9 justify-center rounded-full border border-brand-300/35 bg-gradient-to-r from-brand-500/15 via-primary/10 to-brand-500/10 px-4 text-xs font-semibold tracking-wide text-primary shadow-sm shadow-brand-950/5">
                {charts.length} charts
              </Badge>
              <Button
                variant="outline"
                size="sm"
                className="group h-9 gap-1.5 rounded-full border-primary/25 bg-background/70 px-4 font-semibold shadow-sm shadow-sm dark:shadow-black/5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300/60 hover:bg-brand-500/10 hover:text-primary hover:shadow-[0_12px_28px_hsl(43_74%_49%/0.16)] active:translate-y-0 focus-visible:ring-2 focus-visible:ring-brand-300/45"
                onClick={fetchCharts}
                aria-label="Refresh chart gallery"
              >
                <RefreshCw className="h-3.5 w-3.5 transition-transform duration-300 group-hover:rotate-45" /> Refresh
              </Button>
            </div>
          </div>
        </DashboardThemeFrame>

        {isRefreshing && (
          <DashboardThemeFrame variant="toolbar" className="items-center border-brand-300/35 bg-brand-500/10 px-4 py-3 text-sm text-brand-800 dark:text-brand-200">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span className="font-medium">Refreshing chart gallery…</span>
            <span className="text-muted-foreground">Your current results remain visible while the latest charts load.</span>
          </DashboardThemeFrame>
        )}

        {loadError && !loading && (
          <DashboardThemeFrame variant="toolbar" className="flex-col gap-3 border-destructive/25 bg-destructive/8 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
              <div>
                <p className="text-sm font-semibold text-foreground">Unable to load charts</p>
                <p className="text-sm text-muted-foreground">{loadError}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-2 rounded-full" onClick={fetchCharts}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </DashboardThemeFrame>
        )}

        {/* Stats */}
      {charts.length > 0 && <div className="pt-1"><ChartStats charts={charts} /></div>}

        {/* Filters */}
      {charts.length > 0 && (
        <ChartFilters
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          chartTypeFilter={chartTypeFilter}
          onChartTypeChange={setChartTypeFilter}
          reportFilter={reportFilter}
          onReportChange={setReportFilter}
          sortBy={sortBy}
          onSortChange={setSortBy}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          selectionMode={selectionMode}
          onToggleSelectionMode={toggleSelectionMode}
          selectedCount={selectedIds.size}
          chartTypes={chartTypes}
          reports={uniqueReports}
        />
      )}

        {/* Bulk actions bar */}
      {selectionMode && selectedIds.size > 0 && (
        <div className="sticky top-3 z-20 flex flex-col gap-3 overflow-hidden rounded-2xl border border-brand-300/55 bg-[radial-gradient(circle_at_top_left,hsl(43_96%_56%/0.22),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.90))] p-3 shadow-[0_18px_48px_hsl(43_74%_49%/0.18),0_0_0_1px_hsl(43_96%_56%/0.18)] backdrop-blur-xl sm:flex-row sm:items-center">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/90 to-transparent" />
          <Badge variant="default" className="h-8 w-fit gap-1.5 rounded-full border border-brand-100/45 bg-gradient-to-r from-primary via-brand-500 to-brand-400 px-3 text-xs font-black shadow-lg shadow-brand-950/10">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {selectedIds.size} selected
          </Badge>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-10 rounded-full border-brand-300/45 bg-background/75 px-3 text-xs font-semibold hover:border-brand-300/80 hover:bg-brand-500/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-brand-300/45" onClick={selectAll} aria-label={`Select all ${filteredCharts.length} filtered charts`}>
              Select all ({filteredCharts.length})
            </Button>
            <Button variant="outline" size="sm" className="h-10 gap-1 rounded-full border-brand-300/35 bg-background/75 px-3 text-xs font-semibold hover:border-brand-300/70 hover:bg-brand-500/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-brand-300/45" onClick={() => setSelectedIds(new Set())} aria-label="Clear selected charts">
              <X className="h-3 w-3" /> Clear
            </Button>
          </div>
          <div className="flex-1" />
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Button size="sm" className="h-11 flex-1 gap-1.5 rounded-full bg-gradient-to-r sm:flex-none from-primary via-brand-500 to-brand-400 px-4 text-xs font-bold shadow-[0_12px_28px_hsl(43_74%_49%/0.24)] transition-all hover:-translate-y-0.5 hover:brightness-105 hover:shadow-[0_16px_36px_hsl(43_74%_49%/0.30)] active:translate-y-0 focus-visible:ring-2 focus-visible:ring-brand-300/55" onClick={() => handleBulkExport({ format: 'png', includeAnalysis: true })} aria-label={`Export ${selectedIds.size} selected charts as PNG`}>
              <Download className="h-3.5 w-3.5" /> PNG
            </Button>
            <Button size="sm" variant="outline" className="h-11 flex-1 gap-1.5 rounded-full border-success/50 bg-success/8 px-4 text-xs font-bold text-success shadow-sm transition-all hover:-translate-y-0.5 hover:border-success hover:bg-success/15 hover:text-success focus-visible:ring-2 focus-visible:ring-success/55 dark:text-success dark:hover:text-success sm:flex-none" onClick={() => handleBulkExport({ format: 'svg' })} aria-label={`Export ${selectedIds.size} selected charts as SVG`}>
              <Download className="h-3.5 w-3.5" /> SVG
            </Button>
          </div>
        </div>
      )}

        {/* Content */}
      {charts.length === 0 ? (
        <DashboardThemeFrame variant="section" className="border-dashed border-primary/20 bg-card/80 shadow-xl shadow-sm dark:shadow-black/10">
          <CardContent className="flex flex-col items-center justify-center h-80 space-y-4">
            <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/12 via-brand-500/10 to-background shadow-inner">
              <BarChart3 className="h-9 w-9 text-primary" />
            </div>
            <div className="text-center space-y-1">
              <h3 className="text-lg font-semibold">No charts generated yet</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                Charts appear here automatically after investment reports generate visual analytics. Create a report to start building your chart gallery.
              </p>
            </div>
          </CardContent>
        </DashboardThemeFrame>
      ) : filteredCharts.length === 0 ? (
        <DashboardThemeFrame variant="section" className="border-dashed border-primary/20 bg-card/80 shadow-xl shadow-sm dark:shadow-black/10">
          <CardContent className="flex flex-col items-center justify-center h-64 space-y-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border/70 bg-muted/45"><SearchX className="h-7 w-7 text-muted-foreground" /></div>
            <div className="space-y-1"><h3 className="text-lg font-semibold">No matching charts</h3><p className="max-w-sm text-sm text-muted-foreground">Your search, report, chart type or date filters do not match any saved charts.</p></div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setSearchQuery(''); setChartTypeFilter('all'); setReportFilter('all'); setDateRange('all'); }}
            >
              <SlidersHorizontal className="mr-2 h-3.5 w-3.5" />Clear filters
            </Button>
          </CardContent>
        </DashboardThemeFrame>
      ) : viewMode === 'grouped' ? (
        /* Grouped by Report view (Enhancement #2) */
        <div className="space-y-4">
          {groupedByReport.map(group => (
            <Collapsible key={group.reportId} defaultOpen>
              <CollapsibleTrigger asChild>
                <button className="group/trigger flex w-full items-center gap-2 rounded-xl border border-border/60 bg-card/80 p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-brand-300/55 hover:bg-brand-500/10 hover:shadow-lg hover:shadow-brand-950/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300/45">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium text-sm flex-1 truncate">{group.reportTitle}</span>
                  <Badge variant="secondary" className="text-[10px] shrink-0">{group.charts.length}</Badge>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]/trigger:rotate-180" />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,390px),1fr))] gap-5 lg:gap-6">
                  {group.charts.map(chart => (
                    <ChartCard key={chart.id} {...cardProps(chart)} />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,390px),1fr))] gap-5 lg:gap-6 2xl:gap-6">
          {paginatedCharts.map(chart => (
            <ChartCard key={chart.id} {...cardProps(chart)} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {paginatedCharts.map(chart => (
            <ChartListRow key={chart.id} {...cardProps(chart)} />
          ))}
        </div>
      )}

        {/* Load more (Enhancement #9) */}
      {hasMore && viewMode !== 'grouped' && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-primary/25 bg-card/80 hover:-translate-y-0.5 hover:border-brand-300/65 hover:bg-brand-500/10 hover:text-primary hover:shadow-[0_10px_26px_hsl(43_74%_49%/0.14)] focus-visible:ring-2 focus-visible:ring-brand-300/45"
            onClick={() => setVisibleCount(prev => prev + CHARTS_PER_PAGE)}
          >
            Load more ({filteredCharts.length - visibleCount} remaining)
          </Button>
        </div>
      )}

        {/* Results count */}
      {filteredCharts.length > 0 && filteredCharts.length !== charts.length && (
        <p className="text-xs text-muted-foreground text-center">
          Showing {Math.min(visibleCount, filteredCharts.length)} of {filteredCharts.length} charts
          {filteredCharts.length !== charts.length && ` (${charts.length} total)`}
        </p>
      )}

        {/* Lightbox (includes keyboard navigation — Enhancement #3) */}
      <ChartLightbox
        chart={expandedChart}
        exporting={exporting}
        onClose={() => setExpandedChart(null)}
        onExport={exportSingle}
        onPrev={handleLightboxPrev}
        onNext={handleLightboxNext}
        hasPrev={expandedIndex > 0}
        hasNext={expandedIndex < filteredCharts.length - 1}
      />

        {/* Delete confirmation dialog (Enhancement #4) */}
      <AlertDialog open={!!chartToDelete} onOpenChange={(open) => !open && setChartToDelete(null)}>
        <AlertDialogContent className="border-brand-300/25 shadow-[0_24px_70px_rgba(0,0,0,0.35),0_0_0_1px_rgba(245,158,11,0.10)]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chart?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{chartToDelete?.title}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full transition-all hover:border-brand-300/60 hover:bg-brand-500/10 focus-visible:ring-2 focus-visible:ring-brand-300/45">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm} className="rounded-full bg-destructive text-destructive-foreground transition-all hover:bg-destructive/90 focus-visible:ring-2 focus-visible:ring-destructive/40">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardThemeFrame>
    </main>
  );
}
