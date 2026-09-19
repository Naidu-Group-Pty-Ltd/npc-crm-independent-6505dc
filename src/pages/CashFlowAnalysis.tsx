import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { useToast } from '@/hooks/use-toast';
import { CashFlowEmptyState } from '@/components/cash-flow/CashFlowEmptyState';
import { CashFlowLoadingState } from '@/components/cash-flow/CashFlowLoadingState';
import { CashFlowPageHero } from '@/components/cash-flow/CashFlowPageHero';
import { CashFlowPaginationFooter } from '@/components/cash-flow/CashFlowPaginationFooter';
import { CashFlowReportGrid } from '@/components/cash-flow/CashFlowReportGrid';
import { CashFlowToolbar } from '@/components/cash-flow/CashFlowToolbar';
import {
  getCashFlowScrollTop,
  readCashFlowListState,
  saveCashFlowListState,
  setCashFlowScrollTop,
  type CashFlowListState,
} from '@/components/cash-flow/cashFlowListState';
import { CASH_FLOW_ANALYSIS_ORIGIN } from '@/lib/navigation/cashFlowOrigin';
import type { BuildTypeFilter, DateRangeFilter, InvestmentReport } from '@/components/cash-flow/types';

export default function CashFlowAnalysis() {
  useModulePermissions('cash_flow');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Read once, on the first render: both card actions leave this page, so the
  // return trip restores the filters, the pagination depth and the scroll
  // offset the adviser drilled down from.
  const restoreRef = useRef<CashFlowListState | null>(readCashFlowListState());
  const pendingScrollRef = useRef<number | null>(restoreRef.current?.scrollTop ?? null);

  const [reports, setReports] = useState<InvestmentReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadedPages, setLoadedPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState(restoreRef.current?.searchQuery ?? '');
  const [buildTypeFilter, setBuildTypeFilter] = useState<BuildTypeFilter>(restoreRef.current?.buildTypeFilter ?? 'all');
  const [dateRange, setDateRange] = useState<DateRangeFilter>(restoreRef.current?.dateRange ?? '30');

  const PAGE_SIZE = 50;
  const { toast } = useToast();

  const dateRangeCutoff = useMemo(() => {
    if (dateRange === 'all') return null;
    const date = new Date();
    date.setDate(date.getDate() - parseInt(dateRange, 10));
    return date;
  }, [dateRange]);

  const dateRangeLabel = useMemo(() => {
    switch (dateRange) {
      case '30': return 'last 30 days';
      case '90': return 'last 90 days';
      case '180': return 'last 6 months';
      case '365': return 'last 12 months';
      case 'all': return 'all time';
    }
  }, [dateRange]);

  // ---------------------------------------------------------------------
  // List state persistence
  // ---------------------------------------------------------------------

  const listStateRef = useRef<Omit<CashFlowListState, 'scrollTop'>>({
    searchQuery,
    buildTypeFilter,
    dateRange,
    loadedPages,
  });

  useEffect(() => {
    listStateRef.current = { searchQuery, buildTypeFilter, dateRange, loadedPages };
  }, [searchQuery, buildTypeFilter, dateRange, loadedPages]);

  /** Snapshot the list exactly as it looks right now, scroll offset included. */
  const persistListState = useCallback(() => {
    saveCashFlowListState({ ...listStateRef.current, scrollTop: getCashFlowScrollTop() });
  }, []);

  // Router unmounts this page on any navigation away from it — sidebar,
  // browser back, or a drill-down — so this is the one place guaranteed to run.
  useEffect(() => () => persistListState(), [persistListState]);

  // ---------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------

  const fetchPage = useCallback(async (pageNumber: number): Promise<InvestmentReport[]> => {
    const listOptions: Record<string, any> = {
      status: 'completed',
      isArchived: false,
      page: pageNumber,
      pageSize: PAGE_SIZE,
    };
    if (dateRangeCutoff) {
      listOptions.createdAfter = dateRangeCutoff.toISOString();
    }
    const { data, error } = await invokeSecureFunction('get-investment-reports', {
      listMode: true,
      projection: 'cashFlowLibrary',
      listOptions,
    });
    if (error) throw new Error(error.message);
    return (data?.reports || []) as InvestmentReport[];
  }, [dateRangeCutoff]);

  useEffect(() => {
    let cancelled = false;
    // Restoring a deeper list is done in parallel — one round trip per page,
    // all in flight at once, so coming back does not feel slower than leaving.
    const pagesToLoad = restoreRef.current?.loadedPages ?? 1;
    restoreRef.current = null;

    const load = async () => {
      setLoading(true);
      try {
        const pages = await Promise.all(
          Array.from({ length: pagesToLoad }, (_, index) => fetchPage(index + 1)),
        );
        if (cancelled) return;
        // The list response includes only pre-resolved financial summary scalars;
        // the full calculation payload remains detail-only and is fetched by the
        // detail route, which handles missing figures gracefully.
        setReports(pages.flat());
        setLoadedPages(pagesToLoad);
        setHasMore(pages[pages.length - 1].length === PAGE_SIZE);
      } catch (error: any) {
        if (cancelled) return;
        console.error('Error fetching reports:', error);
        toast({
          title: 'Error',
          description: 'Failed to load investment reports',
          variant: 'destructive',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
    // `fetchPage` is recreated by the same `dateRange` change that drives this
    // effect, so listing it would only double the fetch.
  }, [dateRange]);

  // Scroll is restored after the restored pages have painted, never before —
  // the document is short until then and the browser clamps the offset to it.
  useEffect(() => {
    if (loading) return;
    const target = pendingScrollRef.current;
    if (target == null) return;
    pendingScrollRef.current = null;
    if (target <= 0) return;
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => setCashFlowScrollTop(target));
    });
    return () => cancelAnimationFrame(outer);
  }, [loading]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    try {
      const nextPage = loadedPages + 1;
      const fetched = await fetchPage(nextPage);
      setReports(prev => [...prev, ...fetched]);
      setLoadedPages(nextPage);
      setHasMore(fetched.length === PAGE_SIZE);
    } catch (error: any) {
      console.error('Error fetching reports:', error);
      toast({
        title: 'Error',
        description: 'Failed to load investment reports',
        variant: 'destructive',
      });
    } finally {
      setLoadingMore(false);
    }
  };

  // ---------------------------------------------------------------------
  // Legacy deep links
  // ---------------------------------------------------------------------

  // `?reportId=…` used to open the workspace as an overlay on this page. Both
  // destinations are routes now, so the link forwards to one — with `replace`,
  // so the query-string URL never becomes a history entry the back button
  // would bounce off.
  useEffect(() => {
    const reportId = searchParams.get('reportId');
    if (!reportId) return;
    const action = searchParams.get('action');
    if (action === 'view') {
      navigate(`/generated-reports?reportId=${reportId}`, { replace: true });
      return;
    }
    navigate(`/cash-flow-analysis/${reportId}`, { replace: true });
  }, [searchParams, navigate]);

  // ---------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------

  const getBuildType = (report: InvestmentReport): 'new_build' | 'existing_property' | 'land_only' => {
    const buildType = report.manual_overrides?.buildType;
    if (buildType === 'new_build' || buildType === 'land_only') return buildType;
    return 'existing_property';
  };

  const filteredReports = reports.filter(report => {
    const matchesSearch = report.property_address.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesBuildType = buildTypeFilter === 'all' || getBuildType(report) === buildTypeFilter;
    return matchesSearch && matchesBuildType;
  });

  const getInvestmentGrade = (report: InvestmentReport) => {
    const score = report.investment_score?.overall_score;
    if (!score) return null;

    if (score >= 85) return { grade: 'A+', color: 'bg-success' };
    if (score >= 75) return { grade: 'A', color: 'bg-success' };
    if (score >= 65) return { grade: 'B+', color: 'bg-success' };
    if (score >= 55) return { grade: 'B', color: 'bg-brand-500' };
    if (score >= 50) return { grade: 'C+', color: 'bg-brand-500' };
    if (score >= 45) return { grade: 'C', color: 'bg-warning' };
    if (score >= 35) return { grade: 'D', color: 'bg-destructive/60' };
    return { grade: 'F', color: 'bg-destructive' };
  };

  // ---------------------------------------------------------------------
  // Drill-down
  // ---------------------------------------------------------------------

  // One journey for both actions: list → property → list. The origin travels
  // in router state so the destination can name the way back precisely rather
  // than guessing from history.
  const drillDown = (path: string) => {
    persistListState();
    navigate(path, { state: { from: CASH_FLOW_ANALYSIS_ORIGIN } });
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setDateRange('30');
    setBuildTypeFilter('all');
  };

  return (
    <div className="space-y-5 overflow-x-hidden p-4 md:p-6">
      <CashFlowPageHero
        reports={reports}
        filteredReports={filteredReports}
        dateRangeLabel={dateRangeLabel}
        buildTypeFilter={buildTypeFilter}
        getBuildType={getBuildType}
      />

      <CashFlowToolbar
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        buildTypeFilter={buildTypeFilter}
        onBuildTypeFilterChange={setBuildTypeFilter}
        filteredCount={filteredReports.length}
        loadedCount={reports.length}
      />

      {loading ? (
        <CashFlowLoadingState />
      ) : filteredReports.length === 0 ? (
        <CashFlowEmptyState
          variant={reports.length === 0 ? 'noReports' : 'noResults'}
          onConfigureReports={() => navigate('/generated-reports')}
          onClearFilters={handleClearFilters}
        />
      ) : (
        <CashFlowReportGrid
          reports={filteredReports}
          openingReportId={null}
          getBuildType={getBuildType}
          getInvestmentGrade={getInvestmentGrade}
          onViewReport={(report) => drillDown(`/investment-report/${report.id}`)}
          onOpenCashFlow={(report) => drillDown(`/cash-flow-analysis/${report.id}`)}
        />
      )}

      {!loading && (reports.length > 0 || hasMore) && (
        <CashFlowPaginationFooter
          filteredCount={filteredReports.length}
          loadedCount={reports.length}
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={handleLoadMore}
        />
      )}
    </div>
  );
}
