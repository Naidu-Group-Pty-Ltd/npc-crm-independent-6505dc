import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { useCapability } from '@/hooks/useCapability';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { logActivityDirect } from '@/hooks/useActivityLogger';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ComparisonBasket } from '@/components/reports/ComparisonBasket';
import { useComparison } from '@/contexts/ComparisonContext';
import { format } from 'date-fns';
import { Archive, FileText, MapPin, Search, TrendingUp } from 'lucide-react';
import { useUserNames } from '@/hooks/useUserNames';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';
import { useNotifications } from '@/contexts/NotificationsContext';
import { ReportLibraryHero } from '@/components/reports/library/ReportLibraryHero';
import { ReportLibraryTabs } from '@/components/reports/library/ReportLibraryTabs';
import { ReportLibraryToolbar, type ReportLibraryViewMode } from '@/components/reports/library/ReportLibraryToolbar';
import { InvestmentReportCard } from '@/components/reports/library/InvestmentReportCard';
import { PropertyReportPackageCard } from '@/components/reports/library/PropertyReportPackageCard';
import { InvestmentReportTable } from '@/components/reports/library/InvestmentReportTable';
import { ComparisonReportCard } from '@/components/reports/library/ComparisonReportCard';
import { countComparisonTypes } from '@/components/reports/library/comparisonTypeDescriptor.pure';
import { ReportLibraryEmptyState } from '@/components/reports/library/ReportLibraryEmptyState';
import { ReportLibrarySkeleton } from '@/components/reports/library/ReportLibrarySkeleton';
import { ReportLibraryPagination } from '@/components/reports/library/ReportLibraryPagination';
import type { ComparisonAnalysis, InvestmentReport } from '@/components/reports/library/types';
import { buildGeneratedReportGroups, type GeneratedReportGroup } from '@/lib/reports/generatedReportGroups';
import { getCanonicalReportType, normalizeComparableReportType } from '@/lib/reports/reportVariants';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

// UI Refactor Safety Checklist (Phase 0):
// - Preserve Supabase table names, secure edge function names, route paths, and permission guards.
// - Preserve modal open/close flows, deep-link handling via reportId, and comparison context behavior.
// - Preserve archive/unarchive, regenerate, tier-generation, and download behaviors.
// - Preserve lightweight investment report list fetching: list queries must not select report_content.
// - Fetch full report_content only through detail/view/download flows that already require it.

// Lazy load heavy modal components
const InvestmentReportViewer = lazy(() => import('@/components/reports/InvestmentReportViewer').then(m => ({ default: m.InvestmentReportViewer })));
const PropertyComparisonModal = lazy(() => import('@/components/reports/PropertyComparisonModal').then(m => ({ default: m.PropertyComparisonModal })));
const ComparisonViewer = lazy(() => import('@/components/reports/ComparisonViewer').then(m => ({ default: m.ComparisonViewer })));
const ReportVersionHistory = lazy(() => import('@/components/reports/ReportVersionHistory').then(m => ({ default: m.ReportVersionHistory })));
const ManualDataOverrideModal = lazy(() => import('@/components/reports/ManualDataOverrideModal').then(m => ({ default: m.ManualDataOverrideModal })));

// Non-lazy imports for components used inline without Suspense
import type { ReportTier } from '@/components/reports/TierBadge';
import { resolveReportAddress } from '@/lib/reports/reportAddress';

// Loading fallback for modals
const GENERATED_REPORTS_COMPARE_OVERLAY_TOP = 'calc(72px + 1rem)';

const ModalLoader = () => (
  <div className="fixed inset-0 bg-background/80 flex items-center justify-center z-50">
    <div className="bg-card rounded-lg p-8 shadow-lg">
      <Skeleton className="h-8 w-48 mb-4" />
      <Skeleton className="h-4 w-64 mb-2" />
      <Skeleton className="h-4 w-56" />
    </div>
  </div>
);

const toViewerReportTier = (report: InvestmentReport): ReportTier => {
  const tier = getCanonicalReportType(report);
  return tier === 'other' ? 'compass' : tier;
};

export default function GeneratedReports() {
  const { canEdit: canEditReports } = useModulePermissions('generated_reports');
  // Report Comparisons are commercialised independently of the Investment
  // library: Growth and Scale include them, Launch needs the add-on. When
  // the capability is off, the tab, its counts, its queries, the basket and
  // the ?tab=comparisons deep link are all withheld together.
  const comparisonsEnabled = useCapability('report.comparisons').enabled;
  const [investmentReports, setInvestmentReports] = useState<InvestmentReport[]>([]);
  const [investmentLoading, setInvestmentLoading] = useState(true);
  const [investmentRefreshing, setInvestmentRefreshing] = useState(false);
  const [investmentError, setInvestmentError] = useState<{ message: string; correlationId?: string } | null>(null);
  const [investmentPagination, setInvestmentPagination] = useState<{ totalRows: number; totalPages: number } | null>(null);
  const [investmentLastSuccessfulLoad, setInvestmentLastSuccessfulLoad] = useState<Date | null>(null);
  const [archivedInvestmentLoading, setArchivedInvestmentLoading] = useState(false);
  const [archivedInvestmentError, setArchivedInvestmentError] = useState<{ message: string; correlationId?: string } | null>(null);
  const investmentRequestSequence = useRef(0);
  const lastAutomaticInvestmentRequest = useRef<string | null>(null);
  const [comparisons, setComparisons] = useState<ComparisonAnalysis[]>([]);
  const [selectedInvestmentReport, setSelectedInvestmentReport] = useState<InvestmentReport | null>(null);
  const [selectedComparison, setSelectedComparison] = useState<ComparisonAnalysis | null>(null);
  const [investmentViewerOpen, setInvestmentViewerOpen] = useState(false);
  const [comparisonViewerOpen, setComparisonViewerOpen] = useState(false);
  const [comparisonModalOpen, setComparisonModalOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [selectedReportForHistory, setSelectedReportForHistory] = useState<InvestmentReport | null>(null);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [selectedReportForOverride, setSelectedReportForOverride] = useState<InvestmentReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoGeneratedReportIds, setAutoGeneratedReportIds] = useState<Set<string>>(new Set());
  
  // Pagination & Search states
  const [investmentPage, setInvestmentPage] = useState(1);
  const [investmentViewMode, setInvestmentViewMode] = useState<ReportLibraryViewMode>('cards');
  const [investmentSearchQuery, setInvestmentSearchQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<string>('all'); // Filter by scope
  const [gradeFilter, setGradeFilter] = useState<string>('all'); // Filter by investment grade
  const [scoreRange, setScoreRange] = useState<[number, number]>([0, 100]); // Filter by score range
  const [tierFilter, setTierFilter] = useState<string>('all'); // Filter by report tier
  const [sourceFilter, setSourceFilter] = useState<string>('all'); // Filter by generation source (manual/auto)
  const [showArchived, setShowArchived] = useState(false); // Show archived reports
  const [showArchivedComparisons, setShowArchivedComparisons] = useState(false); // Show archived comparisons
  const [packagePendingArchive, setPackagePendingArchive] = useState<GeneratedReportGroup | null>(null);
  const [generatingTier, setGeneratingTier] = useState<{ reportId: string; tier: ReportTier } | null>(null);
  const reportsPerPage = 50;
  
  // Date range filter for active reports (days back, or 'all', or 'custom')
  const [dateRange, setDateRange] = useState<string>('30');
  const [customFrom, setCustomFrom] = useState<string>(''); // yyyy-mm-dd
  const [customTo, setCustomTo] = useState<string>('');

  const dateRangeCutoff = useMemo(() => {
    if (dateRange === 'all' || dateRange === 'custom') return undefined;
    const days = parseInt(dateRange, 10);
    if (!Number.isFinite(days) || days <= 0) return undefined;
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString();
  }, [dateRange]);

  const customFromIso = useMemo(
    () => (dateRange === 'custom' && customFrom ? new Date(customFrom + 'T00:00:00').toISOString() : undefined),
    [dateRange, customFrom]
  );
  const customToIso = useMemo(
    () => (dateRange === 'custom' && customTo ? new Date(customTo + 'T23:59:59').toISOString() : undefined),
    [dateRange, customTo]
  );

  const dateRangeLabel = useMemo(() => {
    if (dateRange === 'all') return 'Showing all time';
    if (dateRange === 'custom') {
      if (customFrom && customTo) return `Showing ${customFrom} → ${customTo}`;
      if (customFrom) return `Showing from ${customFrom}`;
      if (customTo) return `Showing up to ${customTo}`;
      return 'Pick a custom range';
    }
    return `Showing last ${dateRange} days`;
  }, [dateRange, customFrom, customTo]);
  
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { selectedReports, addReport, removeReport, isSelected, canAddMore, activeComparisonType, canSelectReport } = useComparison();
  const { addNotification } = useNotifications();
  const isMobile = useIsMobile(); // Must be called before any early returns

  useEffect(() => {
    if (isMobile && investmentViewMode === 'table') {
      setInvestmentViewMode('cards');
    }
  }, [isMobile, investmentViewMode]);

  // Resolve generator user IDs across all three lists to display "Generated by X"
  const allGeneratorIds = useMemo(() => {
    const ids: (string | null | undefined)[] = [];
    investmentReports.forEach((r) => ids.push(r.generated_by));
    comparisons.forEach((c) => ids.push(c.created_by));
    return ids.filter((v): v is string => typeof v === 'string' && v.length > 0);
  }, [investmentReports, comparisons]);
  const { labelFor: generatorLabel } = useUserNames(allGeneratorIds);

  const [activeTab, setActiveTab] = useState<'investment' | 'comparisons'>(() => searchParams.get('tab') === 'comparisons' ? 'comparisons' : 'investment');
  const [lastHandledReportId, setLastHandledReportId] = useState<string | null>(null);

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'quantitative' || searchParams.get('type') === 'quantitative') {
      const params = new URLSearchParams(searchParams);
      params.delete('tab'); params.delete('type');
      navigate(`/quantitative-reports${params.toString() ? `?${params}` : ''}`, { replace: true });
      return;
    }
    // A ?tab=comparisons deep link on a workspace without the capability
    // lands on the Investment library, same as the quantitative redirect.
    if (tabParam === 'comparisons' && !comparisonsEnabled) {
      const params = new URLSearchParams(searchParams);
      params.delete('tab');
      navigate(`/generated-reports${params.toString() ? `?${params}` : ''}`, { replace: true });
      return;
    }
    if ((tabParam === 'investment' || tabParam === 'comparisons') && tabParam !== activeTab) setActiveTab(tabParam);
  }, [searchParams, activeTab, navigate, comparisonsEnabled]);

  // If entitlement resolves (or expires) while the page is open, never leave
  // the user stranded on a tab that no longer exists.
  useEffect(() => {
    if (!comparisonsEnabled && activeTab === 'comparisons') setActiveTab('investment');
  }, [comparisonsEnabled, activeTab]);

  // Helper function to get grade color classes
  const getGradeColor = (grade: string): string => {
    switch (grade?.toUpperCase()) {
      case 'A+': return 'bg-success text-foreground dark:text-white';
      case 'A': return 'bg-success text-foreground dark:text-white';
      case 'B+': return 'bg-success text-foreground dark:text-white';
      case 'B': return 'bg-brand-500 text-black';
      case 'C+': return 'bg-brand-500 text-black';
      case 'C': return 'bg-warning text-foreground dark:text-white';
      case 'D': return 'bg-destructive/60 text-foreground dark:text-white';
      case 'F': return 'bg-destructive text-foreground dark:text-white';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  // Helper function to get score color
  const getScoreColor = (score: number): string => {
    if (score >= 85) return 'text-success dark:text-success';
    if (score >= 75) return 'text-success dark:text-success';
    if (score >= 65) return 'text-success dark:text-success';
    if (score >= 55) return 'text-brand-600 dark:text-brand-400';
    if (score >= 45) return 'text-brand-600 dark:text-brand-400';
    if (score >= 35) return 'text-warning dark:text-warning';
    if (score >= 25) return 'text-destructive dark:text-destructive';
    return 'text-destructive dark:text-destructive';
  };

  const fetchInvestmentReportDetails = async (reportId: string): Promise<InvestmentReport | null> => {
    const { data, error } = await invokeSecureFunction('get-investment-reports', {
      reportId,
      listOptions: {
        select: 'id, property_address, property_listing_id, report_content, sources_content, created_at, current_version, report_scope, report_tier, parent_report_id, status, manual_overrides, report_variant, derived_from_report_id, financial_calculations, demographics_data, economic_data, investment_score, location_intelligence'
      }
    });

    if (error || !data?.success) throw new Error(data?.error || error?.message);
    return (data.report || null) as any;
  };

  const downloadInvestmentReportText = async (report: Pick<InvestmentReport, 'id' | 'property_address' | 'created_at'>) => {
    try {
      const full = await fetchInvestmentReportDetails(report.id);
      if (!full?.report_content) {
        throw new Error('Report content is missing');
      }

      const blob = new Blob([full.report_content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `investment-report-${report.property_address.replace(/[^a-zA-Z0-9]/g, '-')}-${format(new Date(report.created_at), 'yyyy-MM-dd')}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('Download failed:', error);
      toast({
        title: 'Download failed',
        description: error?.message || 'Could not download this report.',
        variant: 'destructive',
      });
    }
  };

  // Filter and paginate investment reports
  const filteredInvestmentReports = investmentReports.filter(report => {
    const matchesSearch = resolveReportAddress(report).toLowerCase().includes(investmentSearchQuery.toLowerCase());
    const matchesScope = scopeFilter === 'all' || report.report_scope === scopeFilter;
    
    // Grade filter
    const reportGrade = report.investment_score?.grade?.toUpperCase() || '';
    const matchesGrade = gradeFilter === 'all' || reportGrade === gradeFilter;
    
    // Score range filter
    const reportScore = report.investment_score?.totalScore || 0;
    const matchesScore = reportScore >= scoreRange[0] && reportScore <= scoreRange[1];
    
    // Tier filter
    const reportType = getCanonicalReportType(report);
    const matchesTier = tierFilter === 'all' || reportType === tierFilter;
    
    // Source filter (manual vs auto-generated)
    const isAutoGenerated = autoGeneratedReportIds.has(report.id);
    const matchesSource = sourceFilter === 'all' || 
      (sourceFilter === 'auto' && isAutoGenerated) || 
      (sourceFilter === 'manual' && !isAutoGenerated);
    
    // Archive filter - show archived only when toggle is on
    const matchesArchive = showArchived ? report.is_archived === true : report.is_archived !== true;
    
    return matchesSearch && matchesScope && matchesGrade && matchesScore && matchesTier && matchesSource && matchesArchive;
  });
  
  const propertyPackages = useMemo(() => buildGeneratedReportGroups(filteredInvestmentReports), [filteredInvestmentReports]);
  const totalInvestmentPages = Math.ceil(propertyPackages.length / reportsPerPage);
  const paginatedPropertyPackages = propertyPackages.slice((investmentPage - 1) * reportsPerPage, investmentPage * reportsPerPage);

  useEffect(() => {
    // Comparison records are only retrieved when the capability is held —
    // an excluded module must not consume queries, counts or bandwidth.
    const tasks = [fetchAutoGeneratedReportIds()];
    if (comparisonsEnabled) tasks.push(fetchComparisons());
    void Promise.all(tasks).finally(() => setLoading(false));

    if (!comparisonsEnabled) return;

    // Listen for custom event to refresh comparisons
    const handleRefreshComparisons = () => {
      console.log('📊 Refreshing comparisons from event');
      fetchComparisons();
    };

    window.addEventListener('refreshComparisons', handleRefreshComparisons);
    return () => {
      window.removeEventListener('refreshComparisons', handleRefreshComparisons);
    };
     
  }, [comparisonsEnabled]);

  // One authoritative active-library lifecycle: mount and each server filter change issue one request.
  useEffect(() => {
    const signature = JSON.stringify([dateRange, customFromIso, customToIso]);
    if (lastAutomaticInvestmentRequest.current === signature) return;
    lastAutomaticInvestmentRequest.current = signature;
    void fetchInvestmentReports();
    setInvestmentPage(1);
  }, [dateRange, customFromIso, customToIso]);

  // Handle deep-linking: auto-open report from URL params (e.g., /generated-reports?reportId=...)
  useEffect(() => {
    if (investmentReports.length === 0) return;

    const reportId = (searchParams.get('reportId') || '').trim();

    if (reportId && reportId !== lastHandledReportId) {
      setActiveTab('investment');

      let cancelled = false;

      const openFromDeepLink = async () => {
        console.log('🔗 Deep-link open requested', { reportId });

        // First try from the already-loaded list
        let report = investmentReports.find(r => r.id === reportId) as any;
        console.log('🔗 Deep-link report found in list?', { found: !!report, listCount: investmentReports.length });

        // If not found in-memory (pagination / fetch limits), fetch directly by id via edge function
        if (!report) {
          const { data, error } = await invokeSecureFunction('get-investment-reports', {
            reportId,
            listOptions: { select: 'id' }
          });

          if (error) {
            console.error('Deep-link fetch error:', error);
          }

          report = data?.report as any;
          console.log('🔗 Deep-link report fetched?', { fetched: !!report });
        }

        if (cancelled) return;

        if (report?.id) {
          try {
            const full = await fetchInvestmentReportDetails(report.id);
            if (cancelled) return;

            if (full) {
              setSelectedInvestmentReport(full);
              setInvestmentViewerOpen(true);
            } else {
              toast({
                title: 'Report not found',
                description: 'The requested investment report could not be found.',
                variant: 'destructive',
              });
            }
          } catch (error: any) {
            console.error('Deep-link details fetch error:', error);
            toast({
              title: 'Could not open report',
              description: error?.message || 'Failed to load report details.',
              variant: 'destructive',
            });
          }
        } else {
          toast({
            title: 'Report not found',
            description: 'The requested investment report could not be found.',
            variant: 'destructive',
          });
        }

        setLastHandledReportId(reportId);
      };

      openFromDeepLink();

      return () => {
        cancelled = true;
      };
    }

    // Backwards compatibility: legacy localStorage deep-link
    if (!reportId && lastHandledReportId === null) {
      const openReportId = localStorage.getItem('openReportId');
      if (openReportId) {
        localStorage.removeItem('openReportId');
        setActiveTab('investment');

        const report = investmentReports.find(r => r.id === openReportId);
        if (report) {
          handleViewInvestmentReport(report);
          setLastHandledReportId(openReportId);
        }
      }
    }
  }, [investmentReports, searchParams, lastHandledReportId, toast]);

  useEffect(() => {
    // Listen for custom event to open a specific report
    const handleOpenReport = (event: CustomEvent) => {
      const { reportId } = event.detail;
      const report = investmentReports.find(r => r.id === reportId);
      if (report) {
        handleViewInvestmentReport(report);
      }
    };

    window.addEventListener('openReport', handleOpenReport as EventListener);
    return () => {
      window.removeEventListener('openReport', handleOpenReport as EventListener);
    };
  }, [investmentReports]); // Keep this separate for event handling

  const fetchInvestmentReports = async () => {
    const requestId = ++investmentRequestSequence.current;
    const hadSuccessfulData = investmentLastSuccessfulLoad !== null;
    if (hadSuccessfulData) setInvestmentRefreshing(true);
    else setInvestmentLoading(true);
    try {
      const listOptions: Record<string, unknown> = {
        isArchived: false,
        isClientReport: false,
        page: 1,
        pageSize: 200,
      };
      if (dateRange === 'custom') {
        if (customFromIso) listOptions.createdAfter = customFromIso;
        if (customToIso) listOptions.createdBefore = customToIso;
      } else if (dateRangeCutoff) {
        listOptions.createdAfter = dateRangeCutoff;
      }

      const { data, error } = await invokeSecureFunction('get-investment-reports', {
        projection: 'library',
        listMode: true,
        listOptions,
      });

      if (requestId !== investmentRequestSequence.current) {
        if (import.meta.env.DEV) console.info('[GeneratedReports] stale investment response ignored', { requestId });
        return;
      }

      if (error || !data?.success) {
        const correlationId = data?.correlationId || error?.correlationId;
        const message = data?.details || data?.error || error?.message || 'Please try again.';
        setInvestmentError({ message, correlationId });
        toast({
          title: 'Investment reports could not be loaded',
          description: `${message}${correlationId ? ` Reference: ${correlationId}` : ''}`,
          variant: 'destructive',
        });
        return;
      }

      setInvestmentReports((data.reports || []) as InvestmentReport[]);
      setInvestmentPagination(data.pagination || { totalRows: data.count || 0, totalPages: 1 });
      setInvestmentError(null);
      setInvestmentLastSuccessfulLoad(new Date());
    } catch (error) {
      if (requestId !== investmentRequestSequence.current) return;
      const message = error instanceof Error ? error.message : 'Please try again.';
      setInvestmentError({ message });
      toast({ title: 'Investment reports could not be loaded', description: message, variant: 'destructive' });
    } finally {
      if (requestId === investmentRequestSequence.current) {
        setInvestmentLoading(false);
        setInvestmentRefreshing(false);
      }
    }
  };
  
  // Fetch archived reports separately when needed
  const fetchArchivedReports = async () => {
    setArchivedInvestmentLoading(true);
    setArchivedInvestmentError(null);
    try {
      const { data, error } = await invokeSecureFunction('get-investment-reports', {
        projection: 'archivedLibrary',
        listMode: true,
        listOptions: {
          isArchived: true,
          isClientReport: false,
          page: 1,
          pageSize: 200,
        }
      });

      if (error || !data?.success) {
        setArchivedInvestmentError({ message: data?.details || data?.error || error?.message || 'Archived reports could not be loaded.', correlationId: data?.correlationId || error?.correlationId });
        return;
      }

      // Merge with existing reports
      setInvestmentReports(prev => {
        const existingIds = new Set(prev.map(r => r.id));
        const newArchived = (data.reports || []).filter((r: InvestmentReport) => !existingIds.has(r.id));
        return [...prev, ...(newArchived as InvestmentReport[])];
      });
    } catch (error) {
      setArchivedInvestmentError({ message: error instanceof Error ? error.message : 'Archived reports could not be loaded.' });
    } finally {
      setArchivedInvestmentLoading(false);
    }
  };
  
  // Archive a report
  const archiveReport = async (reportId: string) => {
    try {
      // Get report address for notification
      const report = investmentReports.find(r => r.id === reportId);
      
      const { data, error } = await invokeSecureFunction('manage-investment-reports', {
        action: 'archive',
        reportId,
      });
      
      if (error || !data?.success) throw new Error(data?.error || error?.message);
      
      // Update local state
      setInvestmentReports(prev => 
        prev.map(r => r.id === reportId ? { ...r, is_archived: true } : r)
      );
      
      // Log activity
      logActivityDirect({
        actionType: 'report_archived',
        entityType: 'investment_report',
        entityId: reportId,
        entityName: report?.property_address,
        metadata: { action: 'archived' }
      });
      
      // Add notification
      addNotification({
        type: 'report_archived',
        title: 'Report Archived',
        message: `${report?.property_address || 'Report'} has been archived`,
        entityId: reportId
      });
      
      toast({
        title: 'Report archived',
        description: 'The report has been archived and hidden from the main view.',
      });
    } catch (error: any) {
      console.error('Archive error:', error);
      toast({
        title: 'Failed to archive',
        description: error?.message || 'Could not archive the report.',
        variant: 'destructive',
      });
    }
  };
  
  // Unarchive a report
  const unarchiveReport = async (reportId: string) => {
    try {
      // Get report address for notification
      const report = investmentReports.find(r => r.id === reportId);
      
      const { data, error } = await invokeSecureFunction('manage-investment-reports', {
        action: 'unarchive',
        reportId,
      });
      
      if (error || !data?.success) throw new Error(data?.error || error?.message);
      
      // Update local state
      setInvestmentReports(prev => 
        prev.map(r => r.id === reportId ? { ...r, is_archived: false } : r)
      );
      
      // Log activity
      logActivityDirect({
        actionType: 'report_archived',
        entityType: 'investment_report',
        entityId: reportId,
        entityName: report?.property_address,
        metadata: { action: 'restored' }
      });
      
      // Add notification
      addNotification({
        type: 'report_restored',
        title: 'Report Restored',
        message: `${report?.property_address || 'Report'} has been restored`,
        entityId: reportId
      });
      
      toast({
        title: 'Report restored',
        description: 'The report has been restored to the main view.',
      });
    } catch (error: any) {
      console.error('Unarchive error:', error);
      toast({
        title: 'Failed to restore',
        description: error?.message || 'Could not restore the report.',
        variant: 'destructive',
      });
    }
  };

  const togglePackageArchive = async (group: GeneratedReportGroup) => {
    const archive = !group.isArchived;
    const reportIds = group.reports.map(report => report.id);
    try {
      const { data, error } = await invokeSecureFunction('manage-investment-reports', {
        action: archive ? 'archivePackage' : 'unarchivePackage',
        reportIds,
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'Package update failed');
      const affected = new Set(reportIds);
      setInvestmentReports(previous => previous.map(report => affected.has(report.id) ? { ...report, is_archived: archive } : report));
      await fetchInvestmentReports();
      if (showArchived) await fetchArchivedReports();
      logActivityDirect({ actionType: 'report_archived', entityType: 'investment_report', entityId: group.groupId, entityName: group.propertyAddress, metadata: { action: archive ? 'package_archived' : 'package_restored', reportCount: reportIds.length } });
      toast({ title: archive ? 'Property package archived' : 'Property package restored', description: archive ? `All reports for ${group.propertyAddress} are now available under Show Archived.` : `All reports for ${group.propertyAddress} are visible in Generated Reports again.` });
    } catch (error) {
      const reference = crypto.randomUUID?.().slice(0, 8) || Date.now().toString(36);
      console.error(`Generated report package update failed [${reference}]`, error);
      toast({ title: archive ? 'Unable to archive property package' : 'Unable to restore property package', description: `Your reports were not changed. Please try again. Reference: ${reference}`, variant: 'destructive' });
    }
  };
  
  // Toggle showing archived reports
  useEffect(() => {
    if (showArchived) {
      fetchArchivedReports();
    }
  }, [showArchived]);

  // Filtered comparisons based on archive state
  const filteredComparisons = useMemo(() => {
    return comparisons.filter(c => showArchivedComparisons ? (c as any).is_archived === true : (c as any).is_archived !== true);
  }, [comparisons, showArchivedComparisons]);

  // How many of each comparison family the current view holds.
  const comparisonTypeCounts = useMemo(
    () => countComparisonTypes(filteredComparisons as Array<{ comparison_type?: unknown }>),
    [filteredComparisons],
  );

  // Archive/unarchive a comparison
  const archiveComparison = async (comparisonId: string, archive: boolean) => {
    try {
      const { error } = await invokeSecureFunction('manage-templates', {
        operation: 'update',
        table: 'property_comparisons',
        recordId: comparisonId,
        data: { is_archived: archive },
      });

      if (error) throw new Error(error.message);

      // Update local state
      setComparisons(prev =>
        prev.map(c => c.id === comparisonId ? { ...c, is_archived: archive } as any : c)
      );

      toast({
        title: archive ? 'Comparison archived' : 'Comparison restored',
        description: archive ? 'The comparison has been archived.' : 'The comparison has been restored.',
      });
    } catch (error: any) {
      console.error('Archive comparison error:', error);
      toast({
        title: 'Action failed',
        description: error?.message || 'Could not update comparison.',
        variant: 'destructive',
      });
    }
  };

  const fetchComparisons = async () => {
    try {
      const { data, error } = await invokeSecureFunction('manage-templates', {
        operation: 'list',
        table: 'property_comparisons',
        listOptions: { orderBy: 'created_at', orderAsc: false },
      });

      if (error) {
        console.error('Error fetching comparisons:', error);
        toast({
          title: "Error fetching comparisons",
          description: error.message,
          variant: "destructive",
        });
        return;
      }

      setComparisons((data?.records || []) as ComparisonAnalysis[]);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const fetchAutoGeneratedReportIds = async () => {
    try {
      // Use property_listing_id as the indicator for auto-generated reports
      // This is more reliable than checking the log table status. Read
      // through the server: the table's SELECT policy is author-scoped, so a
      // browser read badged only the current user's own reports.
      const ids = new Set<string>();
      for (let page = 1; page <= 50; page++) {
        const { data, error } = await invokeSecureFunction('get-investment-reports', {
          projection: 'idLookup',
          listMode: true,
          listOptions: { hasPropertyListingId: true, page, pageSize: 200 },
        });
        if (error) {
          console.error('Error fetching auto-generated report IDs:', error);
          return;
        }
        for (const row of (data?.reports ?? []) as Array<{ id: string }>) ids.add(row.id);
        if (!data?.pagination?.hasNextPage) break;
      }
      setAutoGeneratedReportIds(ids);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const handleViewInvestmentReport = async (report: InvestmentReport) => {
    try {
      const full = await fetchInvestmentReportDetails(report.id);
      if (!full) {
        toast({
          title: 'Report not found',
          description: 'This report could not be loaded.',
          variant: 'destructive',
        });
        return;
      }

      setSelectedInvestmentReport(full);
      setInvestmentViewerOpen(true);
    } catch (error: any) {
      console.error('Error opening report:', error);
      toast({
        title: 'Could not open report',
        description: error?.message || 'Failed to load report details.',
        variant: 'destructive',
      });
    }
  };

  const handleInvestmentReportUpdate = () => {
    // Refresh the investment reports list
    fetchInvestmentReports();
  };

  const handleComparisonUpdate = () => {
    // Refresh the comparisons list
    fetchComparisons();
  };

  const handleViewVersionHistory = (report: InvestmentReport) => {
    setSelectedReportForHistory(report);
    setVersionHistoryOpen(true);
  };

  const handleOpenOverrideModal = (report: InvestmentReport) => {
    setSelectedReportForOverride(report);
    setOverrideModalOpen(true);
  };

  const handleOverrideSave = async () => {
    // Refresh reports list after override
    await fetchInvestmentReports();
    
    // Refetch the currently viewed report via secure edge function (direct supabase blocked by RLS)
    if (selectedInvestmentReport) {
      try {
        const refreshed = await fetchInvestmentReportDetails(selectedInvestmentReport.id);
        if (refreshed) {
          console.log('✅ Refetched report with updated overrides via secure function');
          setSelectedInvestmentReport(refreshed as any);
        }
      } catch (err) {
        console.error('Failed to refetch selected report:', err);
      }
    }
    
    // Also refetch the override report if different
    if (selectedReportForOverride && selectedReportForOverride.id !== selectedInvestmentReport?.id) {
      try {
        const refreshed = await fetchInvestmentReportDetails(selectedReportForOverride.id);
        if (refreshed) {
          setSelectedReportForOverride(refreshed as any);
        }
      } catch (err) {
        console.error('Failed to refetch override report:', err);
      }
    }
  };

  // Generate condensed tier from a Compass report
  const handleGenerateTier = async (report: InvestmentReport, targetTier: ReportTier) => {
    if (report.report_tier !== 'compass') {
      toast({
        title: "Cannot Generate",
        description: "Condensed reports can only be generated from Compass reports.",
        variant: "destructive",
      });
      return;
    }

    setGeneratingTier({ reportId: report.id, tier: targetTier });

    try {
      const { data, error } = await invokeSecureFunction('condense-investment-report', {
        parentReportId: report.id,
        targetTier,
      });

      if (error) throw error;

      if (data?.success && data?.reportId) {
        toast({
          title: "Report Generated",
          description: `${targetTier === 'briefing' ? 'Executive Briefing' : 'Snapshot'} is ready`,
        });
        
        // Refresh the reports list
        fetchInvestmentReports();
      } else {
        throw new Error(data?.error || 'Failed to generate report');
      }
    } catch (error) {
      console.error('Error generating tier:', error);
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : 'Failed to generate report tier',
        variant: "destructive",
      });
    } finally {
      setGeneratingTier(null);
    }
  };

  const handleToggleSelection = (report: InvestmentReport, checked: boolean) => {
    if (checked) {
      addReport({
        id: report.id,
        property_address: report.property_address,
        created_at: report.created_at,
        report_tier: report.report_tier,
      });
    } else {
      removeReport(report.id);
    }
  };

  const handleCompare = () => {
    if (selectedReports.length < 2) {
      toast({
        title: "Select More Properties",
        description: "Please select at least 2 properties to compare.",
        variant: "destructive",
      });
      return;
    }
    const selectedTypes = new Set(selectedReports.map(normalizeComparableReportType));
    if (selectedTypes.size !== 1 || selectedTypes.has(undefined)) {
      toast({ title: 'Unable to compare reports', description: 'Selected reports must all be the same report type.', variant: 'destructive' });
      return;
    }
    setComparisonModalOpen(true);
  };


  const activeInvestmentFiltersCount = useMemo(() => {
    return [
      investmentSearchQuery.trim().length > 0,
      scopeFilter !== 'all',
      gradeFilter !== 'all',
      tierFilter !== 'all',
      sourceFilter !== 'all',
      scoreRange[0] > 0 || scoreRange[1] < 100,
      showArchived,
      dateRange !== '30',
    ].filter(Boolean).length;
  }, [investmentSearchQuery, scopeFilter, gradeFilter, tierFilter, sourceFilter, scoreRange, showArchived, dateRange, customFrom, customTo]);

  const visibleLibraryReportsCount = filteredInvestmentReports.length + filteredComparisons.length;


  const clearInvestmentFilters = () => {
    setInvestmentSearchQuery('');
    setScopeFilter('all');
    setGradeFilter('all');
    setScoreRange([0, 100]);
    setTierFilter('all');
    setSourceFilter('all');
    setShowArchived(false);
    setDateRange('30');
    setCustomFrom('');
    setCustomTo('');
    setInvestmentPage(1);
  };

  if (loading) {
    return <ReportLibrarySkeleton />;
  }

  // The comparison basket is the creation path — without the capability it
  // must not mount, so comparisons cannot be started from the library.
  const comparisonOverlay = comparisonsEnabled && selectedReports.length > 0 && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
          style={{ top: GENERATED_REPORTS_COMPARE_OVERLAY_TOP }}
        >
          <ComparisonBasket onCompare={handleCompare} />
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="flex-1 space-y-4 overflow-visible p-4 pb-20 pt-4 md:p-8 md:pb-6 md:pt-6">
      {comparisonOverlay}

      <ReportLibraryHero
        investmentCount={investmentPagination?.totalRows ?? (investmentLastSuccessfulLoad ? investmentReports.length : null)}
        comparisonCount={comparisonsEnabled ? comparisons.length : null}
        visibleCount={investmentLastSuccessfulLoad ? visibleLibraryReportsCount : comparisons.length}
        activeFiltersCount={activeInvestmentFiltersCount}
        showArchived={showArchived}
        selectedComparisonCount={comparisonsEnabled ? selectedReports.length : 0}
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'investment' | 'comparisons')} className="w-full">
        <ReportLibraryTabs
          isMobile={isMobile}
          investmentCount={investmentLastSuccessfulLoad ? filteredInvestmentReports.length : null}
          comparisonCount={filteredComparisons.length}
          showComparisons={comparisonsEnabled}
        />

        <TabsContent value="investment" className="space-y-4">
          <ReportLibraryToolbar
            isMobile={isMobile}
            investmentSearchQuery={investmentSearchQuery}
            setInvestmentSearchQuery={setInvestmentSearchQuery}
            setInvestmentPage={setInvestmentPage}
            scopeFilter={scopeFilter}
            setScopeFilter={setScopeFilter}
            gradeFilter={gradeFilter}
            setGradeFilter={setGradeFilter}
            tierFilter={tierFilter}
            setTierFilter={setTierFilter}
            sourceFilter={sourceFilter}
            setSourceFilter={setSourceFilter}
            scoreRange={scoreRange}
            setScoreRange={setScoreRange}
            showArchived={showArchived}
            setShowArchived={setShowArchived}
            dateRange={dateRange}
            setDateRange={setDateRange}
            customFrom={customFrom}
            setCustomFrom={setCustomFrom}
            customTo={customTo}
            setCustomTo={setCustomTo}
            dateRangeLabel={dateRangeLabel}
            filteredCount={filteredInvestmentReports.length}
            investmentReports={investmentReports}
            getGradeColor={getGradeColor}
            viewMode={investmentViewMode}
            setViewMode={setInvestmentViewMode}
          />

          {investmentRefreshing && (
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground" role="status">
              Refreshing investment reports…
            </div>
          )}
          {investmentError && investmentLastSuccessfulLoad && (
            <div className="flex flex-col gap-3 rounded-lg border border-warning/50 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
              <div>
                <p className="font-medium text-foreground">The latest investment reports could not be loaded.</p>
                <p className="text-sm text-muted-foreground">Showing data from {investmentLastSuccessfulLoad.toLocaleString('en-AU')}. {investmentError.message}{investmentError.correlationId ? ` Reference: ${investmentError.correlationId}` : ''}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void fetchInvestmentReports()}>Retry</Button>
            </div>
          )}
          {showArchived && archivedInvestmentLoading && (
            <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground" role="status">Loading archived investment reports…</div>
          )}
          {showArchived && archivedInvestmentError && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/50 bg-warning/10 p-4" role="alert">
              <p className="text-sm text-foreground">Archived reports could not be loaded. {archivedInvestmentError.message}{archivedInvestmentError.correlationId ? ` Reference: ${archivedInvestmentError.correlationId}` : ''}</p>
              <Button variant="outline" size="sm" onClick={() => void fetchArchivedReports()}>Retry</Button>
            </div>
          )}

          {investmentLoading ? (
            <div aria-label="Loading investment reports"><ReportLibrarySkeleton /></div>
          ) : investmentError && !investmentLastSuccessfulLoad ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-2xl border border-destructive/40 bg-card p-8 text-center" role="alert">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Investment reports could not be loaded.</h2>
                <p className="mt-2 text-sm text-muted-foreground">{investmentError.message}</p>
                {investmentError.correlationId && <p className="mt-1 text-xs text-muted-foreground">Reference: {investmentError.correlationId}</p>}
              </div>
              <Button onClick={() => void fetchInvestmentReports()}>Retry</Button>
            </div>
          ) : filteredInvestmentReports.length === 0 ? (
            <ReportLibraryEmptyState
              icon={showArchived ? Archive : activeInvestmentFiltersCount > 0 ? Search : TrendingUp}
              title={showArchived ? 'No archived reports' : activeInvestmentFiltersCount > 0 ? 'No reports match these filters' : 'No investment reports yet'}
              description={showArchived ? 'Archived investment reports will appear here when available.' : activeInvestmentFiltersCount > 0 ? 'Try clearing filters or broadening your search to see more reports.' : 'Generate your first investment report from a property listing.'}
              actionLabel={!showArchived && activeInvestmentFiltersCount === 0 ? 'Go to Property Marketplace' : undefined}
              actionIcon={!showArchived && activeInvestmentFiltersCount === 0 ? <TrendingUp className="h-4 w-4" /> : undefined}
              onAction={!showArchived && activeInvestmentFiltersCount === 0 ? () => navigate('/listings') : undefined}
              secondaryActionLabel={activeInvestmentFiltersCount > 0 ? 'Clear Filters' : undefined}
              onSecondaryAction={activeInvestmentFiltersCount > 0 ? clearInvestmentFilters : undefined}
            />
          ) : (
            <>
              {investmentViewMode === 'table' && !isMobile ? (
                <InvestmentReportTable
                  groups={paginatedPropertyPackages}
                  canEditReports={canEditReports}
                  generatorLabel={generatorLabel}
                  onView={(selected) => navigate(`/investment-report/${selected.id}`)}
                  onDownload={downloadInvestmentReportText}
                  onTogglePackageArchive={(group) => group.isArchived ? void togglePackageArchive(group) : setPackagePendingArchive(group)}
                />
              ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {paginatedPropertyPackages.map((group) => (
                    <PropertyReportPackageCard
                      key={group.groupId}
                      reports={group.reports}
                      isSelected={isSelected}
                      canAddMore={canAddMore}
                      activeComparisonType={activeComparisonType}
                      canSelectReport={canSelectReport}
                      isAutoGenerated={false}
                      generatingTier={generatingTier}
                      canEditReports={canEditReports}
                      generatorLabel={generatorLabel}
                      getGradeColor={getGradeColor}
                      getScoreColor={getScoreColor}
                      onToggleSelection={handleToggleSelection}
                      onView={(selected) => navigate(`/investment-report/${selected.id}`)}
                      onDownload={downloadInvestmentReportText}
                      onRegenerated={handleInvestmentReportUpdate}
                      onViewHistory={handleViewVersionHistory}
                      onToggleArchive={(selected) => selected.is_archived ? unarchiveReport(selected.id) : archiveReport(selected.id)}
                      onGenerateTier={handleGenerateTier}
                      onTogglePackageArchive={(reports) => {
                        const packageGroup = buildGeneratedReportGroups(reports)[0];
                        if (!packageGroup) return;
                        if (packageGroup.isArchived) void togglePackageArchive(packageGroup);
                        else setPackagePendingArchive(packageGroup);
                      }}
                    />
                  ))}
                </div>
              )}
              <ReportLibraryPagination
                page={investmentPage}
                totalPages={totalInvestmentPages}
                onPrevious={() => setInvestmentPage(p => Math.max(1, p - 1))}
                onNext={() => setInvestmentPage(p => Math.min(totalInvestmentPages, p + 1))}
              />
            </>
          )}
        </TabsContent>

        {comparisonsEnabled && (
        <TabsContent value="comparisons" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-xs">{comparisons.length} comparison{comparisons.length !== 1 ? 's' : ''}</Badge>
              {/* What KINDS of comparison this view holds — Compass, Briefing,
                  Snapshot… — so the mix is visible before any card is read.
                  A family with no rows shows no chip. */}
              {comparisonTypeCounts.map(([type, count]) => (
                <Badge
                  key={type.key ?? 'untyped'}
                  variant="secondary"
                  title={type.blurb}
                  className={`text-xs font-normal ${type.badgeClassName}`}
                >
                  {count} {type.key ? type.label.replace(' Comparison', '') : 'Untyped'}
                </Badge>
              ))}
            </div>
            <Button
              variant={showArchivedComparisons ? "secondary" : "outline"}
              size="sm"
              onClick={() => setShowArchivedComparisons(!showArchivedComparisons)}
              className="gap-2"
            >
              <Archive className="h-4 w-4" />
              {showArchivedComparisons ? 'Viewing Archived' : 'Show Archived'}
            </Button>
          </div>

          {filteredComparisons.length === 0 ? (
            <ReportLibraryEmptyState
              icon={showArchivedComparisons ? Archive : filteredComparisons.length === 0 && comparisons.length > 0 ? Search : MapPin}
              title={showArchivedComparisons ? 'No archived comparisons' : comparisons.length > 0 ? 'No comparisons match this view' : 'No comparison analyses yet'}
              description={showArchivedComparisons ? 'Archived comparison analyses will appear here when available.' : comparisons.length > 0 ? 'Switch archive visibility or refresh your filters to find comparison analyses.' : 'Select 2-5 investment reports and click "Compare Properties" to create your first comparison analysis.'}
              secondaryActionLabel={showArchivedComparisons ? 'Show Active Comparisons' : undefined}
              onSecondaryAction={showArchivedComparisons ? () => setShowArchivedComparisons(false) : undefined}
            />
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filteredComparisons.map((comparison: any) => (
                <ComparisonReportCard
                  key={comparison.id}
                  comparison={comparison}
                  generatorLabel={generatorLabel}
                  onView={(selected) => {
                    setSelectedComparison(selected);
                    setComparisonViewerOpen(true);
                  }}
                  onToggleArchive={archiveComparison}
                />
              ))}
            </div>
          )}
        </TabsContent>
        )}
      </Tabs>

      <AlertDialog open={!!packagePendingArchive} onOpenChange={(open) => !open && setPackagePendingArchive(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Archive property package?</AlertDialogTitle><AlertDialogDescription>This will archive all generated reports for {packagePendingArchive?.propertyAddress || 'this property'}. The reports will remain available under Show Archived.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { if (packagePendingArchive) void togglePackageArchive(packagePendingArchive); setPackagePendingArchive(null); }}>Archive package</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Lazy loaded modals - only render when open */}
      {comparisonModalOpen && (
        <Suspense fallback={<ModalLoader />}>
          <PropertyComparisonModal
            isOpen={comparisonModalOpen}
            onClose={() => {
              setComparisonModalOpen(false);
              handleComparisonUpdate(); // Refresh comparisons when modal closes
            }}
            reportIds={selectedReports.map(r => r.id)}
            propertyAddresses={selectedReports.map(r => r.property_address)}
          />
        </Suspense>
      )}

      {investmentViewerOpen && selectedInvestmentReport && selectedInvestmentReport.report_content && (
        <Suspense fallback={<ModalLoader />}>
          <InvestmentReportViewer
            report={{
              ...selectedInvestmentReport,
              report_content: selectedInvestmentReport.report_content,
              report_tier: toViewerReportTier(selectedInvestmentReport),
            }}
            isOpen={investmentViewerOpen}
            onClose={() => {
              setInvestmentViewerOpen(false);
              setSelectedInvestmentReport(null);
            }}
            onReportUpdate={handleInvestmentReportUpdate}
            onOpenOverride={() => {
              if (selectedInvestmentReport) {
                handleOpenOverrideModal(selectedInvestmentReport);
              }
            }}
            onTierSwitch={async (newReportId, newTier) => {
              // Fetch the new report via secure edge function (direct supabase blocked by RLS)
              try {
                const refreshed = await fetchInvestmentReportDetails(newReportId);
                if (refreshed) {
                  setSelectedInvestmentReport(refreshed as any);
                }
              } catch (err) {
                console.error('Failed to fetch tier-switched report:', err);
              }
            }}
          />
        </Suspense>
      )}

      {comparisonViewerOpen && selectedComparison && (
        <Suspense fallback={<ModalLoader />}>
          <ComparisonViewer
            comparison={selectedComparison}
            isOpen={comparisonViewerOpen}
            onClose={() => {
              setComparisonViewerOpen(false);
              setSelectedComparison(null);
            }}
          />
        </Suspense>
      )}

      {versionHistoryOpen && selectedReportForHistory && (
        <Suspense fallback={<ModalLoader />}>
          <ReportVersionHistory
            reportId={selectedReportForHistory.id}
            currentVersion={selectedReportForHistory.current_version || 1}
            open={versionHistoryOpen}
            onOpenChange={setVersionHistoryOpen}
          />
        </Suspense>
      )}

      {overrideModalOpen && selectedReportForOverride && (
        <Suspense fallback={<ModalLoader />}>
          <ManualDataOverrideModal
            report={selectedReportForOverride}
            isOpen={overrideModalOpen}
            onClose={() => setOverrideModalOpen(false)}
            onSave={handleOverrideSave}
          />
        </Suspense>
      )}
    </div>
  );
}
