import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { smartCapitalize } from '@/lib/nameUtils';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { secureStorageDownload } from '@/hooks/useSecureStorage';
import { FlattenPdfMenuItem } from '@/components/common/FlattenPdfMenuItem';
import { ReportTemplateSelector } from '@/components/reports/ReportTemplateSelector';
import { deliverPortfolioReview } from '@/lib/reports/portfolio/deliverPortfolioReview';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SearchInput } from '@/components/ui/search-input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  FileText,
  Search,
  Download,
  Trash2,
  MoreVertical,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  RefreshCw,
  Loader2,
  Building2,
  Eye,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { PORTFOLIO_REPORT_LABEL } from '@/lib/reports/portfolio/label';

interface PortfolioAnalysisReport {
  id: string;
  client_id: string;
  client_name: string;
  health_score: number | null;
  overall_health: string | null;
  portfolio_value: number | null;
  total_equity: number | null;
  net_monthly_cashflow: number | null;
  total_properties: number | null;
  average_lvr: number | null;
  average_yield: number | null;
  pdf_file_path: string | null;
  status: string;
  created_at: string;
}

interface PortfolioAnalysisReportsListProps {
  clientId?: string; // If provided, shows reports for specific client only
  showHeader?: boolean;
}

const formatCurrency = (value: number | null) => {
  if (value === null || value === undefined) return '-';
  return '$' + value.toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const getHealthBadgeVariant = (health: string | null): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (health?.toLowerCase()) {
    case 'excellent': return 'default';
    case 'good': return 'secondary';
    case 'fair': return 'outline';
    case 'poor': return 'destructive';
    default: return 'outline';
  }
};

const getHealthBadgeClassName = (health: string | null) => {
  switch (health?.toLowerCase()) {
    case 'excellent': return 'border-success/45 bg-success/12 text-success ring-1 ring-inset ring-success/15 hover:bg-success/18';
    case 'good': return 'border-success/45 bg-success/12 text-success ring-1 ring-inset ring-success/15 hover:bg-success/18';
    case 'fair': return 'border-brand-300/50 bg-brand-400/13 text-brand-100 ring-1 ring-inset ring-brand-200/15 hover:bg-brand-400/18';
    case 'poor': return 'border-destructive/45 bg-destructive/13 text-destructive ring-1 ring-inset ring-destructive/15 hover:bg-destructive/18';
    default: return 'border-border/30 bg-muted/40 text-foreground dark:text-foreground ring-1 ring-inset ring-border dark:ring-white/10 hover:bg-muted/60';
  }
};

const getHealthScoreMeterClassName = (health: string | null) => {
  switch (health?.toLowerCase()) {
    case 'excellent': return 'from-success to-success';
    case 'good': return 'from-success to-success';
    case 'fair': return 'from-brand-300 to-brand-300';
    case 'poor': return 'from-destructive to-destructive';
    default: return 'from-muted to-muted';
  }
};

const getCashflowIcon = (cashflow: number | null) => {
  if (cashflow === null) return <Minus className="h-4 w-4 text-muted-foreground" />;
  if (cashflow > 0) return <TrendingUp className="h-4 w-4 text-success" />;
  if (cashflow < 0) return <TrendingDown className="h-4 w-4 text-destructive" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
};

const getCashflowValueClassName = (cashflow: number | null) => {
  if (cashflow === null) return 'text-muted-foreground dark:text-foreground';
  if (cashflow > 0) return 'text-success';
  if (cashflow < 0) return 'text-destructive';
  return 'text-muted-foreground dark:text-foreground';
};

export function PortfolioAnalysisReportsList({ clientId, showHeader = true }: PortfolioAnalysisReportsListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [reportToDelete, setReportToDelete] = useState<PortfolioAnalysisReport | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Which row is being typeset. Per-row rather than a single boolean: the menu
  // is inside a table and two rows can be opened in sequence.
  const [typesetting, setTypesetting] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Fetch portfolio analysis reports via secure function
  const { data: reports = [], isLoading, isError, error, isRefetching, refetch } = useQuery({
    queryKey: ['portfolio-analysis-reports', clientId],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'portfolio_analysis_reports',
          select: '*',
          orderBy: 'created_at',
          order_asc: false,
          ...(clientId && { filters: { client_id: clientId } })
        }
      });
      if (error) throw new Error(error.message);
      return (data?.records || []) as PortfolioAnalysisReport[];
    },
  });

  // Delete mutation via secure function
  const deleteMutation = useMutation({
    mutationFn: async (reportId: string) => {
      const { data, error } = await invokeSecureFunction('manage-client-data', {
        operation: 'delete',
        table: 'portfolio_analysis_reports',
        reportId,
      });
      if (error || !data?.result?.deleted || data.result.id !== reportId) {
        throw new Error('Portfolio report deletion was not confirmed');
      }
      return reportId;
    },
    onSuccess: async (deletedReportId) => {
      queryClient.setQueriesData<PortfolioAnalysisReport[]>({ queryKey: ['portfolio-analysis-reports'] }, (current) =>
        current?.filter((report) => report.id !== deletedReportId),
      );
      queryClient.removeQueries({ queryKey: ['portfolio-analysis-report', deletedReportId] });
      await queryClient.invalidateQueries({ queryKey: ['portfolio-analysis-reports'] });
      setDeleteError(null);
      setReportToDelete(null);
      toast.success('Portfolio report deleted successfully.', {
        description: 'The client and their other records were not affected.',
      });
    },
    onError: () => {
      setDeleteError('Portfolio report could not be deleted. No data was removed. Please try again.');
    },
  });

  // Filter reports by search
  const filteredReports = reports.filter(report => {
    const searchLower = searchQuery.toLowerCase();
    return (
      report.client_name.toLowerCase().includes(searchLower) ||
      report.overall_health?.toLowerCase().includes(searchLower)
    );
  });

  // Summary stats. Combined figures count each CLIENT once, at their most
  // recent analysis — summing every report row counted the same portfolio
  // once per report generated (five runs for one client inflated the
  // combined value fivefold).
  const totalReports = reports.length;
  const latestReportPerClient = (() => {
    const byClient = new Map<string, PortfolioAnalysisReport>();
    for (const report of reports) {
      const existing = byClient.get(report.client_id);
      if (!existing || new Date(report.created_at) > new Date(existing.created_at)) {
        byClient.set(report.client_id, report);
      }
    }
    return [...byClient.values()];
  })();
  const avgHealthScore = latestReportPerClient.length > 0
    ? Math.round(latestReportPerClient.reduce((acc, r) => acc + (r.health_score || 0), 0) / latestReportPerClient.length)
    : 0;
  const totalPortfolioValue = latestReportPerClient.reduce((acc, r) => acc + (Number(r.portfolio_value) || 0), 0);
  // Visual-only cue using the existing scorecard ranges; does not alter the average score calculation.
  const avgHealthAccent = avgHealthScore >= 80
    ? 'from-success to-success shadow-success/20'
    : avgHealthScore >= 60
      ? 'from-brand-300 to-brand-300 shadow-brand-500/20'
      : avgHealthScore >= 40
        ? 'from-warning to-brand-300 shadow-warning/20'
        : 'from-destructive to-destructive shadow-destructive/20';
  const avgHealthIconClass = avgHealthScore >= 80
    ? 'text-success'
    : avgHealthScore >= 60
      ? 'text-brand-200'
      : avgHealthScore >= 40
        ? 'text-warning'
        : 'text-destructive';

  const handleViewPDF = async (report: PortfolioAnalysisReport) => {
    if (!report.pdf_file_path) {
      toast.error('No PDF available for this report');
      return;
    }

    try {
      // Use secure storage download (service_role required due to RLS)
      const result = await secureStorageDownload('client-files', report.pdf_file_path);

      if (!result.success || !result.blob) {
        throw new Error(result.error || 'Download failed');
      }

      // Open PDF in new tab for viewing
      const url = URL.createObjectURL(result.blob);
      window.open(url, '_blank');
      toast.success('Opening report...');
    } catch (error: any) {
      toast.error('Failed to open PDF: ' + error.message);
    }
  };

  /**
   * The typeset review, rendered server-side from `report_data`.
   *
   * Beside the two handlers below rather than instead of them. Those read
   * `pdf_file_path` — the file the legacy generator saved — and this reads the
   * stored analysis, so it works on the reports that have no file.
   */
  const handleTypesetDownload = async (report: PortfolioAnalysisReport) => {
    if (typesetting) return;
    setTypesetting(report.id);
    try {
      const result = await deliverPortfolioReview({
        variant: 'server',
        request: { reportId: report.id },
      });
      if (result.brandGaps.length) {
        toast.warning(`Review ready, with gaps: ${result.brandGaps.join('; ')}`);
      } else {
        toast.success(
          result.reviewIncluded
            ? `${PORTFOLIO_REPORT_LABEL} ready, including the latest review`
            : `${PORTFOLIO_REPORT_LABEL} ready`,
        );
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not produce the review');
    } finally {
      setTypesetting(null);
    }
  };

  const handleDownloadPDF = async (report: PortfolioAnalysisReport) => {
    if (!report.pdf_file_path) {
      toast.error('No PDF available for this report');
      return;
    }

    try {
      // Use secure storage download (service_role required due to RLS)
      const result = await secureStorageDownload('client-files', report.pdf_file_path);

      if (!result.success || !result.blob) {
        throw new Error(result.error || 'Download failed');
      }

      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Portfolio_Analysis_${smartCapitalize(report.client_name).replace(/\s+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('PDF downloaded successfully');
    } catch (error: any) {
      toast.error('Failed to download PDF: ' + error.message);
    }
  };

  if (isLoading) {
    return (
      <div className="relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-3xl border border-brand-400/15 bg-[linear-gradient(135deg,rgba(15,23,42,0.72),rgba(0,0,0,0.55))] p-8 shadow-xl shadow-sm dark:shadow-black/20">
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/45 to-transparent" />
        <div className="flex flex-col items-center gap-4 text-center text-muted-foreground dark:text-foreground">
          <div className="rounded-3xl border border-brand-300/20 bg-brand-300/10 p-4 shadow-lg shadow-brand-950/20">
            <Loader2 className="h-8 w-8 animate-spin text-brand-300" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground dark:text-foreground">Loading portfolio intelligence...</p>
            <p className="mt-1 text-xs text-muted-foreground">Retrieving generated portfolio analysis reports.</p>
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-destructive/20 bg-[linear-gradient(135deg,rgba(127,29,29,0.16),rgba(0,0,0,0.58))] p-6 shadow-xl shadow-sm dark:shadow-black/20">
        <div className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-destructive/35 to-transparent" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl border border-destructive/25 bg-destructive/10 p-3 text-destructive">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-destructive-foreground">Unable to load portfolio reports</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground dark:text-muted-foreground">
                {error instanceof Error ? error.message : 'An unexpected error occurred while loading portfolio analysis reports.'}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="rounded-2xl border-destructive/25 bg-destructive/10 text-destructive transition-all hover:border-destructive/45 hover:bg-destructive/15 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? 'animate-spin' : ''}`} />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {showHeader && (
        <>
          {/* Summary Cards */}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Card className="dashboard-theme-premium-card group relative overflow-hidden rounded-3xl border-border/70 bg-card/90 shadow-xl shadow-sm dark:shadow-black/10 backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card/95 hover:ring-1 hover:ring-primary/20 hover:shadow-[0_18px_45px_hsl(var(--primary)/0.13)] dark:border-white/10 dark:bg-background/80 dark:shadow-black/25 dark:hover:bg-background/85 sm:min-h-[156px]">
              <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/50 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <CardHeader className="flex flex-row items-start justify-between space-y-0 px-5 pb-3 pt-5">
                <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground dark:text-muted-foreground">Total Reports</CardTitle>
                <div className="rounded-2xl border border-brand-300/20 bg-brand-300/10 p-3 text-brand-200 shadow-lg shadow-brand-950/20 transition-colors group-hover:border-brand-200/40 group-hover:bg-brand-300/15">
                  <FileText className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-0">
                <div className="text-[clamp(2.25rem,3vw,2.75rem)] font-bold leading-none tracking-[-0.04em] text-foreground dark:text-white">{totalReports}</div>
                <div className="mt-4 h-px bg-gradient-to-r from-brand-300/70 via-brand-100/20 to-transparent" />
              </CardContent>
            </Card>

            <Card className="dashboard-theme-premium-card group relative overflow-hidden rounded-3xl border-border/70 bg-card/90 shadow-xl shadow-sm dark:shadow-black/10 backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card/95 hover:ring-1 hover:ring-primary/20 hover:shadow-[0_18px_45px_hsl(var(--primary)/0.13)] dark:border-white/10 dark:bg-background/80 dark:shadow-black/25 dark:hover:bg-background/85 sm:min-h-[156px]">
              <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/50 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <CardHeader className="flex flex-row items-start justify-between space-y-0 px-5 pb-3 pt-5">
                <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground dark:text-muted-foreground">Avg Health Score</CardTitle>
                <div className="rounded-2xl border border-border dark:border-white/10 bg-card/5 dark:bg-white/5 p-3 shadow-lg shadow-sm dark:shadow-black/20 transition-colors group-hover:border-brand-200/35 group-hover:bg-white/10">
                  <TrendingUp className={`h-5 w-5 ${avgHealthIconClass}`} />
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-0">
                <div className="flex items-end gap-1">
                  <span className="text-[clamp(2.25rem,3vw,2.75rem)] font-bold leading-none tracking-[-0.04em] text-foreground dark:text-white">{avgHealthScore}</span>
                  <span className="pb-1 text-[clamp(1rem,1.3vw,1.25rem)] font-semibold text-muted-foreground">/100</span>
                </div>
                <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-card/8 dark:bg-white/8">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${avgHealthAccent}`}
                    style={{ width: `${Math.min(Math.max(avgHealthScore, 0), 100)}%` }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="dashboard-theme-premium-card group relative overflow-hidden rounded-3xl border-primary/25 bg-gradient-to-br from-primary/15 via-card/90 to-card shadow-xl shadow-primary/10 backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/50 hover:from-primary/20 hover:ring-1 hover:ring-primary/25 hover:shadow-[0_20px_52px_hsl(var(--primary)/0.16)] sm:col-span-2 sm:min-h-[156px] xl:col-span-1">
              <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-brand-100/70 to-transparent opacity-80" />
              <CardHeader className="flex flex-row items-start justify-between space-y-0 px-5 pb-3 pt-5">
                <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-100/75">Combined Portfolio</CardTitle>
                <div className="rounded-2xl border border-brand-200/30 bg-brand-300/15 p-3 text-brand-100 shadow-lg shadow-brand-950/30 transition-colors group-hover:border-brand-100/50 group-hover:bg-brand-300/20">
                  <Building2 className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5 pt-0">
                <div className="min-w-0 whitespace-nowrap text-[clamp(1.875rem,2.6vw,2.625rem)] font-bold leading-none tracking-[-0.045em] text-brand-50">{formatCurrency(totalPortfolioValue)}</div>
                <p className="mt-2 text-[11px] leading-4 text-brand-100/70">
                  Latest analysis per client — earlier runs are not double-counted.
                </p>
                <div className="mt-4 h-px bg-gradient-to-r from-brand-200/80 via-brand-100/30 to-transparent" />
              </CardContent>
            </Card>
          </div>

          {/* Search and Actions */}
          <DashboardThemeFrame variant="toolbar" className="flex-col rounded-3xl p-3 transition-all duration-300 hover:border-primary/30 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="relative flex-1 sm:max-w-lg">
              <div className="pointer-events-none absolute left-3.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl border border-brand-300/15 bg-brand-300/10 text-brand-200/80">
                <Search className="h-4 w-4" />
              </div>
              <SearchInput
                value={searchQuery}
                onValueChange={setSearchQuery}
                aria-label="Search portfolio reports by client name"
                placeholder="Search by client name..."
                hideIcon
                className="h-12 rounded-2xl border-border dark:border-white/10 bg-background dark:bg-background/80 pl-14 pr-4 text-sm font-medium text-foreground dark:text-foreground shadow-inner shadow-sm dark:shadow-black/20 transition-all placeholder:text-muted-foreground hover:border-brand-300/25 focus-visible:border-brand-300/70 focus-visible:ring-2 focus-visible:ring-brand-300/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              aria-label="Refresh portfolio analysis reports"
              onClick={() => refetch()}
              className="h-12 justify-center rounded-2xl border-brand-300/25 bg-white/[0.03] px-5 font-semibold text-brand-100 shadow-sm shadow-sm dark:shadow-black/10 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300/55 hover:bg-brand-300/12 hover:text-brand-50 hover:shadow-[0_14px_34px_rgba(245,158,11,0.12)] focus-visible:ring-2 focus-visible:ring-brand-300/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 sm:min-w-[124px]"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${isRefetching ? 'animate-spin text-brand-200' : 'text-brand-200/85'}`} />
              Refresh
            </Button>
          </DashboardThemeFrame>
        </>
      )}

      {/* Reports Table */}
      <Card className="group/register overflow-hidden rounded-3xl border-border dark:border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.12),transparent_34%),linear-gradient(180deg,rgba(12,12,14,0.99),rgba(0,0,0,0.95))] shadow-2xl shadow-sm dark:shadow-black/30 transition-all duration-300 hover:border-brand-300/35 hover:ring-1 hover:ring-brand-300/15 hover:shadow-[0_24px_70px_rgba(0,0,0,0.42)]">
        <CardHeader className="relative border-b border-border dark:border-white/10 bg-white/[0.035] px-5 py-5 sm:px-6">
          <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-200/50 to-transparent opacity-60 transition-opacity duration-300 group-hover/register:opacity-100" />
          <CardTitle className="flex min-w-0 items-center gap-3 text-xl font-semibold tracking-tight text-foreground dark:text-white">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-brand-300/20 bg-brand-300/10 text-brand-200 shadow-lg shadow-brand-950/20">
              <FileText className="h-5 w-5" />
            </span>
            {clientId ? 'Client Reports' : 'All Portfolio Analysis Reports'}
          </CardTitle>
          <CardDescription className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground dark:text-muted-foreground">
            {clientId
              ? 'Previously generated portfolio performance reports for this client'
              : 'View all generated portfolio performance analysis reports across all clients'
            }
          </CardDescription>
          {/* The rows below can typeset the review server-side, and which
              template it comes out in was previously not answerable from this
              list at all. Once for the card — the choice is per format, and
              every row's typeset download reads it. */}
          <ReportTemplateSelector
            reportType="portfolio"
            formatLabel={PORTFOLIO_REPORT_LABEL}
            className="mt-3"
          />
        </CardHeader>
        <CardContent className="bg-background dark:bg-black/15 p-0">
          {filteredReports.length === 0 ? (
            <div className="m-5 flex flex-col items-center justify-center rounded-3xl border border-dashed border-brand-300/20 bg-brand-400/[0.03] py-14 text-center transition-all duration-300">
              <div className="mb-4 rounded-3xl border border-border dark:border-white/10 bg-card/5 dark:bg-white/5 p-4">
                <FileText className="h-12 w-12 text-brand-200/80" />
              </div>
              <h3 className="text-lg font-semibold text-foreground dark:text-white">{searchQuery ? 'No matching reports found' : 'No reports found'}</h3>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground dark:text-muted-foreground">
                {searchQuery
                  ? 'Try adjusting the client name search to reveal matching portfolio analysis reports.'
                  : clientId
                    ? 'Generate a portfolio analysis to see reports here'
                    : 'No portfolio analysis reports have been generated yet'
                }
              </p>
            </div>
          ) : (
            <div className="max-w-full overflow-hidden p-3 sm:p-5">
              <ScrollArea className="h-[440px] max-w-full rounded-2xl border border-border dark:border-white/10 bg-background dark:bg-background/55 shadow-inner shadow-sm dark:shadow-black/25">
              <Table aria-label="Portfolio analysis reports" className="min-w-[980px] text-sm">
                <TableHeader className="sticky top-0 z-20">
                  <TableRow className="border-b border-brand-300/20 bg-[linear-gradient(180deg,rgba(30,30,33,0.99),rgba(9,9,11,0.97))] shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur hover:bg-background/95">
                    {!clientId && <TableHead className="h-13 whitespace-nowrap px-4 text-xs font-semibold uppercase tracking-[0.2em] text-brand-100/85">Client</TableHead>}
                    <TableHead className="h-13 whitespace-nowrap px-4 text-xs font-semibold uppercase tracking-[0.2em] text-brand-100/85">Health</TableHead>
                    <TableHead className="h-13 whitespace-nowrap px-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-brand-100/85">Score</TableHead>
                    <TableHead className="h-13 whitespace-nowrap px-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-brand-100/85">Portfolio Value</TableHead>
                    <TableHead className="h-13 whitespace-nowrap px-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-brand-100/85">Equity</TableHead>
                    <TableHead className="h-13 whitespace-nowrap px-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-brand-100/85">Cashflow</TableHead>
                    <TableHead className="h-13 whitespace-nowrap px-4 text-center text-xs font-semibold uppercase tracking-[0.2em] text-brand-100/85">Properties</TableHead>
                    <TableHead className="h-13 whitespace-nowrap px-4 text-xs font-semibold uppercase tracking-[0.2em] text-brand-100/85">Generated</TableHead>
                    <TableHead className="h-13 whitespace-nowrap px-4 text-right text-xs font-semibold uppercase tracking-[0.2em] text-brand-100/85">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReports.map((report) => (
                    <TableRow key={report.id} className="group/row h-auto border-border dark:border-white/10 border-l-2 border-l-transparent transition-all duration-200 hover:border-l-amber-300/90 hover:bg-brand-400/[0.075] hover:shadow-[inset_0_1px_0_rgba(245,158,11,0.12),inset_0_-1px_0_rgba(245,158,11,0.10),0_10px_28px_rgba(0,0,0,0.22)] data-[state=selected]:border-l-amber-300 data-[state=selected]:bg-brand-400/10 sm:h-16">
                      {!clientId && (
                        <TableCell className="px-4 py-4 font-semibold text-foreground dark:text-foreground transition-colors group-hover/row:text-brand-50">
                          {smartCapitalize(report.client_name)}
                        </TableCell>
                      )}
                      <TableCell className="px-4 py-4">
                        <Badge variant={getHealthBadgeVariant(report.overall_health)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold leading-none tracking-wide shadow-sm transition-all duration-200 group-hover/row:shadow-[0_0_18px_rgba(245,158,11,0.10)] ${getHealthBadgeClassName(report.overall_health)}`}>
                          {report.overall_health || 'Unknown'}
                        </Badge>
                      </TableCell>
                      <TableCell className="px-4 py-4 text-right tabular-nums">
                        <div className="ml-auto flex w-24 flex-col items-end gap-1.5 rounded-xl border border-border dark:border-white/10 bg-white/[0.035] px-2.5 py-2 transition-colors group-hover/row:border-brand-300/20 group-hover/row:bg-brand-300/[0.055]">
                          <div>
                            <span className="font-semibold text-foreground dark:text-white">{report.health_score ?? '-'}</span>
                            <span className="text-muted-foreground text-xs">/100</span>
                          </div>
                          <div className="h-1 w-full overflow-hidden rounded-full bg-card/10 dark:bg-white/10">
                            <div
                              className={`h-full rounded-full bg-gradient-to-r ${getHealthScoreMeterClassName(report.overall_health)}`}
                              style={{ width: `${Math.min(Math.max(Number(report.health_score) || 0, 0), 100)}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-4 text-right font-semibold tabular-nums text-brand-50/95 transition-colors group-hover/row:text-brand-50">{formatCurrency(Number(report.portfolio_value))}</TableCell>
                      <TableCell className="px-4 py-4 text-right font-semibold tabular-nums text-foreground dark:text-foreground transition-colors group-hover/row:text-white">{formatCurrency(Number(report.total_equity))}</TableCell>
                      <TableCell className="px-4 py-4 text-right tabular-nums">
                        <div className="flex items-center justify-end gap-2.5 font-semibold">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border dark:border-white/10 bg-white/[0.04]">
                            {getCashflowIcon(Number(report.net_monthly_cashflow))}
                          </span>
                          <span className={`${getCashflowValueClassName(Number(report.net_monthly_cashflow))} transition-colors group-hover/row:brightness-110`}>
                            {formatCurrency(Number(report.net_monthly_cashflow))}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-4 text-center font-medium tabular-nums text-foreground dark:text-foreground">
                        <span className="inline-flex min-w-9 items-center justify-center rounded-full border border-border dark:border-white/10 bg-white/[0.04] px-2.5 py-1 transition-colors group-hover/row:border-brand-300/20 group-hover/row:bg-brand-300/[0.06]">
                          {report.total_properties || '-'}
                        </span>
                      </TableCell>
                      <TableCell className="px-4 py-4">
                        <div className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border dark:border-white/10 bg-white/[0.035] px-3 py-1.5 text-sm font-medium text-muted-foreground dark:text-foreground transition-colors group-hover/row:border-brand-300/20 group-hover/row:bg-brand-300/[0.06] group-hover/row:text-foreground">
                          <Calendar className="h-3.5 w-3.5 shrink-0 text-brand-200/80" />
                          {format(new Date(report.created_at), 'dd MMM yyyy')}
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-4 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Open actions for ${smartCapitalize(report.client_name)}`}
                              className="h-10 w-10 rounded-xl border border-transparent text-muted-foreground dark:text-foreground transition-all group-hover/row:border-brand-300/25 group-hover/row:bg-white/[0.05] group-hover/row:text-brand-100 hover:border-brand-300/45 hover:bg-brand-400/10 hover:text-brand-100 focus-visible:ring-2 focus-visible:ring-brand-300/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:border-brand-300/45 data-[state=open]:bg-brand-400/10 data-[state=open]:text-brand-100"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" sideOffset={8} collisionPadding={16} className="min-w-[210px] rounded-2xl border-border dark:border-white/10 bg-background dark:bg-background/95 p-1.5 text-foreground dark:text-foreground shadow-2xl shadow-sm dark:shadow-black/45 backdrop-blur-xl">
                            {/*
                              First, and never disabled. Every other item here
                              needs `pdf_file_path`, and 7 of the 21 stored
                              reports have none — this one reads `report_data`,
                              so those become downloadable for the first time.
                            */}
                            <DropdownMenuItem
                              className="rounded-xl transition-colors focus:bg-brand-400/10 focus:text-brand-100"
                              disabled={typesetting === report.id}
                              onSelect={(e) => { e.preventDefault(); handleTypesetDownload(report); }}
                            >
                              {typesetting === report.id
                                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                : <Sparkles className="h-4 w-4 mr-2" />}
                              Download review (typeset)
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="my-1 bg-border dark:bg-white/10" />
                            <DropdownMenuItem
                              className="rounded-xl transition-colors focus:bg-brand-400/10 focus:text-brand-100"
                              disabled={!report.pdf_file_path}
                              onClick={() => handleViewPDF(report)}
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              View Report
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="rounded-xl transition-colors focus:bg-brand-400/10 focus:text-brand-100"
                              disabled={!report.pdf_file_path}
                              onClick={() => handleDownloadPDF(report)}
                            >
                              <Download className="h-4 w-4 mr-2" />
                              Download PDF
                            </DropdownMenuItem>
                            <FlattenPdfMenuItem
                              disabled={!report.pdf_file_path}
                              getPdfBlob={async () => {
                                const r = await secureStorageDownload('client-files', report.pdf_file_path!);
                                if (!r.success || !r.blob) throw new Error(r.error || 'Download failed');
                                return r.blob;
                              }}
                              filename={`Portfolio_Analysis_${smartCapitalize(report.client_name).replace(/\s+/g, '_')}.pdf`}
                            />
                            <DropdownMenuItem
                              className="rounded-xl text-destructive transition-colors focus:bg-destructive/10 focus:text-destructive"
                              onClick={() => { setDeleteError(null); setReportToDelete(report); }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!reportToDelete}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setDeleteError(null);
            setReportToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete portfolio report?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to permanently delete the portfolio analysis report for{' '}
              {smartCapitalize(reportToDelete?.client_name || 'this client')} generated{' '}
              {reportToDelete ? format(new Date(reportToDelete.created_at), 'dd MMM yyyy') : 'on the selected date'}.
              This will not delete the client, their properties, or any other reports.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending || !reportToDelete}
              onClick={(event) => {
                event.preventDefault();
                if (reportToDelete && !deleteMutation.isPending) deleteMutation.mutate(reportToDelete.id);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {deleteMutation.isPending ? 'Deleting…' : 'Delete Report'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
