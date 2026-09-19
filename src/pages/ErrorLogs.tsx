import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  AlertTriangle, 
  AlertCircle,
  XCircle,
  RefreshCw,
  Search,
  FileText,
  Phone,
  Zap,
  Mail,
  Bot,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Filter,
  TrendingDown,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useToast } from '@/hooks/use-toast';
import { format, formatDistanceToNow, subDays } from 'date-fns';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SearchInput } from '@/components/ui/search-input';
import { Link } from 'react-router-dom';
import { useSecureCallLogs } from '@/hooks/useSecureCallLogs';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

// Error source types
type ErrorSource = 'investment_report' | 'bulk_generation' | 'vapi_call' | 'api_service' | 'email_sync' | 'automation';
type ErrorSeverity = 'critical' | 'error' | 'warning';

interface UnifiedError {
  id: string;
  source: ErrorSource;
  severity: ErrorSeverity;
  errorCode: string;
  errorMessage: string;
  rawError?: string;
  entityId?: string;
  entityType?: string;
  entityLabel?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  resolved?: boolean;
}

interface ErrorStats {
  total: number;
  critical: number;
  error: number;
  warning: number;
  bySource: Record<ErrorSource, number>;
  trend: 'up' | 'down' | 'stable';
  last24h: number;
  last7d: number;
}

const SOURCE_CONFIG: Record<ErrorSource, { label: string; icon: React.ElementType; color: string }> = {
  investment_report: { label: 'Investment Reports', icon: FileText, color: 'text-info' },
  bulk_generation: { label: 'Bulk Generation', icon: Zap, color: 'text-accent' },
  vapi_call: { label: 'Voice AI (Vapi)', icon: Phone, color: 'text-success' },
  api_service: { label: 'API Services', icon: Bot, color: 'text-warning' },
  email_sync: { label: 'Email Sync', icon: Mail, color: 'text-info' },
  automation: { label: 'Automation', icon: RefreshCw, color: 'text-accent' },
};

const SEVERITY_CONFIG: Record<ErrorSeverity, { label: string; variant: 'destructive' | 'default' | 'outline'; icon: React.ElementType }> = {
  critical: { label: 'Critical', variant: 'destructive', icon: XCircle },
  error: { label: 'Error', variant: 'destructive', icon: AlertCircle },
  warning: { label: 'Warning', variant: 'outline', icon: AlertTriangle },
};

export default function ErrorLogs() {
  const [errors, setErrors] = useState<UnifiedError[]>([]);
  const [stats, setStats] = useState<ErrorStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchErrorMessage, setFetchErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState<ErrorSource | 'all'>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<ErrorSeverity | 'all'>('all');
  const [dateRange, setDateRange] = useState<'24h' | '7d' | '30d'>('7d');
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const { fetchErrorCalls } = useSecureCallLogs();

  const fetchErrors = useCallback(async () => {
    setIsLoading(true);
    setFetchErrorMessage(null);
    try {
      const cutoffDate = subDays(new Date(), dateRange === '24h' ? 1 : dateRange === '7d' ? 7 : 30);
      const unifiedErrors: UnifiedError[] = [];

      // 1. Fetch investment report generation errors via secure edge function
      const { data: systemLogs } = await invokeSecureFunction('get-system-logs', {
        mode: 'all',
        cutoffDate: cutoffDate.toISOString(),
        limit: 100
      });

      const reportGenErrors = systemLogs?.generationErrors;

      if (reportGenErrors) {
        reportGenErrors.forEach(err => {
          const severity = determineSeverity(err.error_message);
          unifiedErrors.push({
            id: `report-gen-${err.id}`,
            source: 'investment_report',
            severity,
            errorCode: extractErrorCode(err.error_message),
            errorMessage: cleanErrorMessage(err.error_message),
            rawError: err.error_message,
            entityId: err.report_id,
            entityType: 'investment_report',
            entityLabel: err.listing_address,
            metadata: { switchName: err.switch_name, listingId: err.listing_id },
            createdAt: new Date(err.created_at),
          });
        });
      }

      // 2. Fetch bulk generation item errors
      const { data: bulkErrors } = await supabase
        .from('bulk_generation_items')
        .select('*')
        .eq('status', 'failed')
        .gte('created_at', cutoffDate.toISOString())
        .order('created_at', { ascending: false })
        .limit(100);

      if (bulkErrors) {
        bulkErrors.forEach(err => {
          const severity = determineSeverity(err.error_message);
          unifiedErrors.push({
            id: `bulk-${err.id}`,
            source: 'bulk_generation',
            severity,
            errorCode: extractErrorCode(err.error_message),
            errorMessage: cleanErrorMessage(err.error_message),
            rawError: err.error_message,
            entityId: err.report_id,
            entityType: 'investment_report',
            entityLabel: err.property_address,
            metadata: { jobId: err.job_id, processingTime: err.processing_time_seconds },
            createdAt: new Date(err.created_at),
          });
        });
      }

      // 3. Fetch API health errors (already fetched via get-system-logs above)
      const apiErrors = systemLogs?.apiErrors;

      if (apiErrors) {
        apiErrors.forEach(err => {
          unifiedErrors.push({
            id: `api-${err.id}`,
            source: 'api_service',
            severity: 'error',
            errorCode: `${err.service_name?.toUpperCase()}_ERROR`,
            errorMessage: err.error_message || `${err.service_name} service failed`,
            rawError: err.error_message,
            entityLabel: err.service_name,
            metadata: { endpoint: err.endpoint, responseTime: err.response_time_ms },
            createdAt: new Date(err.created_at),
          });
        });
      }

      // 4. Fetch Vapi call errors via secure hook
      const { data: vapiErrors } = await fetchErrorCalls(cutoffDate.toISOString(), 100);

      if (vapiErrors) {
        vapiErrors.forEach(err => {
          const severity = err.call_outcome === 'failed' || err.call_outcome === 'error' ? 'error' : 'warning';
          unifiedErrors.push({
            id: `vapi-${err.id}`,
            source: 'vapi_call',
            severity,
            errorCode: `VAPI_${err.call_outcome?.toUpperCase() || 'UNKNOWN'}`,
            errorMessage: `Call ${err.call_outcome}: ${err.customer_name || err.phone_number || 'Unknown caller'}`,
            entityId: err.id,
            entityType: 'vapi_call',
            entityLabel: err.phone_number,
            metadata: { 
              agentName: err.agent_name, 
              duration: err.duration_seconds,
              direction: err.call_direction,
              squadName: err.squad_name
            },
            createdAt: new Date(err.created_at),
          });
        });
      }

      // 5. Fetch stuck investment reports (already fetched via get-system-logs above)
      const stuckReports = systemLogs?.stuckReports;

      if (stuckReports) {
        stuckReports.forEach(report => {
          unifiedErrors.push({
            id: `stuck-${report.id}`,
            source: 'investment_report',
            severity: 'warning',
            errorCode: 'REPORT_STUCK_PROCESSING',
            errorMessage: `Report stuck in processing for ${formatDistanceToNow(new Date(report.created_at))}`,
            entityId: report.id,
            entityType: 'investment_report',
            entityLabel: report.property_address,
            metadata: { status: report.status },
            createdAt: new Date(report.created_at),
          });
        });
      }

      // 6. Fetch failed investment reports (already fetched via get-system-logs above)
      const failedReports = systemLogs?.failedReports;

      if (failedReports) {
        failedReports.forEach(report => {
          unifiedErrors.push({
            id: `failed-report-${report.id}`,
            source: 'investment_report',
            severity: 'error',
            errorCode: extractErrorCode(report.error_message),
            errorMessage: report.error_message || 'Report generation failed',
            rawError: report.error_message,
            entityId: report.id,
            entityType: 'investment_report',
            entityLabel: report.property_address,
            createdAt: new Date(report.created_at),
          });
        });
      }

      // Sort all errors by date
      unifiedErrors.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      // Calculate stats
      const now = new Date();
      const last24h = unifiedErrors.filter(e => e.createdAt > subDays(now, 1)).length;
      const last7d = unifiedErrors.filter(e => e.createdAt > subDays(now, 7)).length;

      const bySource = Object.keys(SOURCE_CONFIG).reduce((acc, source) => {
        acc[source as ErrorSource] = unifiedErrors.filter(e => e.source === source).length;
        return acc;
      }, {} as Record<ErrorSource, number>);

      setStats({
        total: unifiedErrors.length,
        critical: unifiedErrors.filter(e => e.severity === 'critical').length,
        error: unifiedErrors.filter(e => e.severity === 'error').length,
        warning: unifiedErrors.filter(e => e.severity === 'warning').length,
        bySource,
        trend: last24h > (last7d / 7) ? 'up' : last24h < (last7d / 7) ? 'down' : 'stable',
        last24h,
        last7d,
      });

      setErrors(unifiedErrors);
    } catch (error) {
      console.error('Error fetching error logs:', error);
      setFetchErrorMessage(error instanceof Error ? error.message : 'Failed to load error logs');
      toast({
        title: "Error",
        description: "Failed to load error logs",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  }, [dateRange, toast]);

  useEffect(() => {
    fetchErrors();
  }, [fetchErrors]);

  const toggleExpanded = (id: string) => {
    setExpandedErrors(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleRetryReport = async (reportId: string, address: string) => {
    try {
      // First, reset the report status to pending — through the broker every
      // client write uses. A browser UPDATE is author-scoped by RLS, so for a
      // colleague's report it matched zero rows and reported nothing.
      const reset = await invokeSecureFunction('manage-investment-reports', {
        action: 'update',
        reportId,
        data: { status: 'pending', error_message: null },
      });
      if (reset.error) throw reset.error;

      // Call the edge function to regenerate
      const { error } = await invokeSecureFunction('generate-investment-report', {
        reportId
      });

      if (error) throw error;

      toast({
        title: "Report generation started",
        description: `Retrying generation for ${address}`,
      });

      // Refresh errors list after a short delay
      setTimeout(fetchErrors, 2000);
    } catch (error) {
      console.error('Retry failed:', error);
      toast({
        title: "Retry failed",
        description: error instanceof Error ? error.message : "Failed to retry report generation",
        variant: "destructive"
      });
    }
  };

  // Filter errors
  const filteredErrors = errors.filter(err => {
    if (selectedSource !== 'all' && err.source !== selectedSource) return false;
    if (selectedSeverity !== 'all' && err.severity !== selectedSeverity) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        err.errorMessage.toLowerCase().includes(query) ||
        err.errorCode.toLowerCase().includes(query) ||
        err.entityLabel?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  return (
    <DashboardThemeFrame
      as="main"
      variant="page"
      className="min-w-0 overflow-x-hidden space-y-6 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.10),transparent_32%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background))_46%,hsl(var(--muted)/0.18))] pb-8 text-foreground"
    >
      {/* Header */}
      <DashboardThemeFrame
        as="header"
        variant="hero"
        className="flex min-w-0 flex-col gap-4 overflow-hidden border-primary/20 bg-[radial-gradient(circle_at_top_left,hsl(var(--warning)/0.15),transparent_30%),linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--background)/0.92)_56%,hsl(var(--primary)/0.10))] shadow-[0_22px_70px_rgba(15,23,42,0.10)] ring-1 ring-border/40 dark:ring-white/10 dark:shadow-black/35 sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="flex min-w-0 items-start gap-3 sm:gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-warning/30 bg-warning/10 text-warning shadow-[0_12px_30px_hsl(var(--warning)/0.16)]">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h1 className="break-words text-3xl font-bold tracking-tight text-foreground md:text-4xl">Error Logs</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
              Unified error monitoring across all integrations
            </p>
          </div>
        </div>
        <Button
          onClick={fetchErrors}
          disabled={isLoading}
          variant="outline"
          aria-label={isLoading ? 'Refreshing error logs' : 'Refresh error logs'}
          aria-busy={isLoading}
          className="w-full shrink-0 rounded-full border-primary/25 bg-background/70 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/45 hover:bg-primary/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:translate-y-0 disabled:opacity-60 sm:w-auto"
        >
          {isLoading ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Refresh
        </Button>
      </DashboardThemeFrame>

      {/* Stats Overview */}
      {isLoading && !stats && <ErrorStatsSkeleton />}
      {stats && (
        <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,13.5rem),1fr))] gap-4">
          <Card className="group min-w-0 overflow-hidden rounded-2xl border-border/70 bg-[linear-gradient(145deg,hsl(var(--card)/0.98),hsl(var(--muted)/0.18))] shadow-[0_14px_40px_rgba(15,23,42,0.07)] ring-1 ring-border/40 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_18px_48px_rgba(15,23,42,0.12)] dark:border-white/10 dark:bg-background/80 dark:ring-white/10 dark:shadow-black/25">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="min-w-0 truncate text-sm font-medium text-muted-foreground">Total Errors</CardTitle>
              <span className="rounded-xl border border-border/70 bg-background/70 p-2 text-muted-foreground">
                <AlertTriangle className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tracking-tight text-foreground">{stats.total}</div>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                Last {dateRange === '24h' ? '24 hours' : dateRange === '7d' ? '7 days' : '30 days'}
              </p>
            </CardContent>
          </Card>

          <Card className="group min-w-0 overflow-hidden rounded-2xl border-destructive/25 bg-[linear-gradient(145deg,hsl(var(--card)/0.98),hsl(var(--destructive)/0.06))] shadow-[0_14px_40px_rgba(15,23,42,0.07)] ring-1 ring-border/40 transition-all duration-300 hover:-translate-y-0.5 hover:border-destructive/35 dark:border-destructive/25 dark:bg-background/80 dark:ring-white/10 dark:shadow-black/25">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="min-w-0 truncate text-sm font-medium text-muted-foreground">Critical</CardTitle>
              <span className="rounded-xl border border-destructive/25 bg-destructive/10 p-2 text-destructive">
                <XCircle className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tracking-tight text-destructive">{stats.critical}</div>
              <p className="mt-1 truncate text-xs text-muted-foreground">Require immediate attention</p>
            </CardContent>
          </Card>

          <Card className="group min-w-0 overflow-hidden rounded-2xl border-destructive/25 bg-[linear-gradient(145deg,hsl(var(--card)/0.98),hsl(var(--destructive)/0.06))] shadow-[0_14px_40px_rgba(15,23,42,0.07)] ring-1 ring-border/40 transition-all duration-300 hover:-translate-y-0.5 hover:border-destructive/35 dark:border-destructive/25 dark:bg-background/80 dark:ring-white/10 dark:shadow-black/25">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="min-w-0 truncate text-sm font-medium text-muted-foreground">Errors</CardTitle>
              <span className="rounded-xl border border-destructive/25 bg-destructive/10 p-2 text-destructive">
                <AlertCircle className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tracking-tight text-destructive">{stats.error}</div>
              <p className="mt-1 truncate text-xs text-muted-foreground">Failed operations</p>
            </CardContent>
          </Card>

          <Card className="group min-w-0 overflow-hidden rounded-2xl border-warning/30 bg-[linear-gradient(145deg,hsl(var(--card)/0.98),hsl(var(--warning)/0.08))] shadow-[0_14px_40px_rgba(15,23,42,0.07)] ring-1 ring-border/40 transition-all duration-300 hover:-translate-y-0.5 hover:border-warning/45 dark:border-warning/25 dark:bg-background/80 dark:ring-white/10 dark:shadow-black/25">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="min-w-0 truncate text-sm font-medium text-muted-foreground">Warnings</CardTitle>
              <span className="rounded-xl border border-warning/30 bg-warning/10 p-2 text-warning">
                <AlertTriangle className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tracking-tight text-warning">{stats.warning}</div>
              <p className="mt-1 truncate text-xs text-muted-foreground">Potential issues</p>
            </CardContent>
          </Card>

          <Card className="group min-w-0 overflow-hidden rounded-2xl border-success/20 bg-[linear-gradient(145deg,hsl(var(--card)/0.98),hsl(160_84%_39%/0.06))] shadow-[0_14px_40px_rgba(15,23,42,0.07)] ring-1 ring-border/40 transition-all duration-300 hover:-translate-y-0.5 hover:border-success/30 dark:border-success/20 dark:bg-background/80 dark:ring-white/10 dark:shadow-black/25">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="min-w-0 truncate text-sm font-medium text-muted-foreground">Trend</CardTitle>
              {stats.trend === 'down' ? (
                <span className="rounded-xl border border-success/25 bg-success/10 p-2 text-success">
                  <TrendingDown className="h-4 w-4" />
                </span>
              ) : stats.trend === 'up' ? (
                <span className="rounded-xl border border-destructive/25 bg-destructive/10 p-2 text-destructive">
                  <TrendingDown className="h-4 w-4 rotate-180" />
                </span>
              ) : (
                <span className="rounded-xl border border-border/70 bg-background/70 p-2 text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
              )}
            </CardHeader>
            <CardContent>
              <div className="truncate text-3xl font-bold tracking-tight text-foreground">
                {stats.trend === 'down' ? '↓ Improving' : stats.trend === 'up' ? '↑ Increasing' : '→ Stable'}
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground">{stats.last24h} in last 24h</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="min-w-0 overflow-hidden rounded-[1.5rem] border-primary/15 bg-[linear-gradient(135deg,hsl(var(--card)/0.97),hsl(var(--background)/0.90)_54%,hsl(var(--primary)/0.07))] shadow-[0_16px_48px_rgba(15,23,42,0.08)] ring-1 ring-border/40 dark:border-white/10 dark:bg-background/70 dark:ring-white/10 dark:shadow-black/25">
        <CardHeader className="pb-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-lg">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
              <Filter className="h-5 w-5" />
            </span>
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(10rem,12rem)_minmax(9rem,10rem)_minmax(8.5rem,9rem)] lg:items-center">
            <div className="min-w-0">
              <SearchInput
                value={searchQuery}
                onValueChange={setSearchQuery}
                aria-label="Search errors"
                placeholder="Search errors..."
                containerClassName="min-w-0"
                className="min-w-0 rounded-2xl border-border/70 bg-background/70 pr-3 shadow-inner shadow-black/5 transition-all duration-200 placeholder:text-muted-foreground/70 hover:border-primary/30 focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/35 dark:border-white/10 dark:bg-background/55"
              />
            </div>

            <Select value={selectedSource} onValueChange={(v) => setSelectedSource(v as ErrorSource | 'all')}>
              <SelectTrigger aria-label="Filter error logs by source" className="w-full min-w-0 rounded-2xl border-border/70 bg-background/80 shadow-sm transition-all duration-200 hover:border-primary/30 focus:ring-2 focus:ring-primary/35 dark:border-white/10 dark:bg-background/55">
                <SelectValue placeholder="All Sources" />
              </SelectTrigger>
              <SelectContent className="max-h-72 min-w-[190px] rounded-2xl border-border/70 bg-popover/95 shadow-2xl backdrop-blur-xl dark:border-white/10">
                <SelectItem value="all">All Sources</SelectItem>
                {Object.entries(SOURCE_CONFIG).map(([key, config]) => (
                  <SelectItem key={key} value={key}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedSeverity} onValueChange={(v) => setSelectedSeverity(v as ErrorSeverity | 'all')}>
              <SelectTrigger aria-label="Filter error logs by severity" className="w-full min-w-0 rounded-2xl border-border/70 bg-background/80 shadow-sm transition-all duration-200 hover:border-primary/30 focus:ring-2 focus:ring-primary/35 dark:border-white/10 dark:bg-background/55">
                <SelectValue placeholder="All Severities" />
              </SelectTrigger>
              <SelectContent className="max-h-72 min-w-[160px] rounded-2xl border-border/70 bg-popover/95 shadow-2xl backdrop-blur-xl dark:border-white/10">
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
              </SelectContent>
            </Select>

            <Select value={dateRange} onValueChange={(v) => setDateRange(v as '24h' | '7d' | '30d')}>
              <SelectTrigger aria-label="Filter error logs by date range" className="w-full min-w-0 rounded-2xl border-border/70 bg-background/80 shadow-sm transition-all duration-200 hover:border-primary/30 focus:ring-2 focus:ring-primary/35 dark:border-white/10 dark:bg-background/55">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72 min-w-[145px] rounded-2xl border-border/70 bg-popover/95 shadow-2xl backdrop-blur-xl dark:border-white/10">
                <SelectItem value="24h">Last 24h</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {fetchErrorMessage && (
        <ErrorStatePanel
          title="Failed to load error logs"
          description={fetchErrorMessage}
          onRefresh={fetchErrors}
          isRefreshing={isLoading}
        />
      )}

      {/* Error Tabs by Source */}
      <Tabs defaultValue="all" className="min-w-0">
        <TabsList aria-label="Filter error logs by source category" className="h-auto w-full min-w-0 max-w-full justify-start gap-2 overflow-x-auto rounded-[1.35rem] border border-primary/15 bg-card/80 p-2 shadow-[0_14px_42px_rgba(15,23,42,0.07)] [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] dark:border-white/10 dark:bg-background/45 dark:shadow-black/20">
          <TabsTrigger value="all" aria-label={`Show all error logs (${filteredErrors.length})`} className="min-w-max gap-2 rounded-2xl border border-transparent px-4 py-2 text-muted-foreground transition-all duration-200 data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_12px_30px_hsl(var(--primary)/0.22)]">
            All
            <Badge variant="secondary" className="ml-1 rounded-full bg-background/80 px-2 text-foreground data-[state=active]:bg-primary-foreground/20">{filteredErrors.length}</Badge>
          </TabsTrigger>
          {Object.entries(SOURCE_CONFIG).map(([key, config]) => {
            const count = filteredErrors.filter(e => e.source === key).length;
            if (count === 0) return null;
            const Icon = config.icon;
            return (
              <TabsTrigger key={key} value={key} aria-label={`Show ${config.label} error logs (${count})`} className="min-w-max gap-2 rounded-2xl border border-transparent px-4 py-2 text-muted-foreground transition-all duration-200 data-[state=active]:border-primary/30 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-[0_12px_30px_hsl(var(--primary)/0.22)]">
                <Icon className={`h-4 w-4 ${config.color}`} />
                {config.label}
                <Badge variant="secondary" className="ml-1 rounded-full bg-background/80 px-2 text-foreground">{count}</Badge>
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <ErrorList 
            errors={filteredErrors} 
            expandedErrors={expandedErrors}
            toggleExpanded={toggleExpanded}
            isLoading={isLoading}
            onRetryReport={handleRetryReport}
            hasActiveFilters={Boolean(searchQuery || selectedSource !== 'all' || selectedSeverity !== 'all')}
          />
        </TabsContent>

        {Object.keys(SOURCE_CONFIG).map(key => (
          <TabsContent key={key} value={key} className="mt-4">
            <ErrorList 
              errors={filteredErrors.filter(e => e.source === key)} 
              expandedErrors={expandedErrors}
              toggleExpanded={toggleExpanded}
              isLoading={isLoading}
              onRetryReport={handleRetryReport}
              hasActiveFilters={Boolean(searchQuery || selectedSource !== 'all' || selectedSeverity !== 'all')}
            />
          </TabsContent>
        ))}
      </Tabs>
    </DashboardThemeFrame>
  );
}


function ErrorStatsSkeleton() {
  return (
    <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,13.5rem),1fr))] gap-4" role="status" aria-busy="true" aria-label="Loading error summary">
      <span className="sr-only">Loading error summary</span>
      {Array.from({ length: 5 }).map((_, index) => (
        <Card key={index} className="min-w-0 overflow-hidden rounded-2xl border-border/70 bg-card/90 ring-1 ring-border/40 dark:border-white/10 dark:bg-background/80 dark:ring-white/10">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="h-4 w-24 animate-pulse rounded-full bg-muted" />
              <div className="h-9 w-9 animate-pulse rounded-xl bg-muted" />
            </div>
            <div className="h-9 w-16 animate-pulse rounded-lg bg-muted" />
            <div className="h-3 w-28 animate-pulse rounded-full bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ErrorStatePanel({ title, description, onRefresh, isRefreshing }: { title: string; description: string; onRefresh: () => void; isRefreshing: boolean }) {
  return (
    <Card role="alert" aria-live="assertive" className="min-w-0 overflow-hidden rounded-[1.5rem] border-destructive/30 bg-[linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--destructive)/0.08))] shadow-[0_16px_48px_rgba(239,68,68,0.08)] ring-1 ring-border/40 dark:ring-white/10">
      <CardContent className="flex min-w-0 flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10 text-destructive">
            <AlertCircle className="h-5 w-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h3 className="font-semibold text-foreground">{title}</h3>
            <p className="break-words text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label={isRefreshing ? 'Refreshing error logs after fetch failure' : 'Refresh error logs after fetch failure'}
          aria-busy={isRefreshing}
          className="w-full shrink-0 rounded-full border-destructive/25 bg-background/80 hover:bg-destructive/10 hover:text-foreground sm:w-auto"
        >
          {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </CardContent>
    </Card>
  );
}

function ErrorListSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading error records">
      <span className="sr-only">Loading error records</span>
      {Array.from({ length: 3 }).map((_, index) => (
        <Card key={index} className="min-w-0 overflow-hidden rounded-[1.35rem] border-border/70 bg-card/90 ring-1 ring-border/40 dark:border-white/10 dark:bg-background/80 dark:ring-white/10">
          <CardContent className="p-5">
            <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 flex-1 gap-3">
                <div className="h-10 w-10 shrink-0 animate-pulse rounded-2xl bg-muted" />
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
                    <div className="h-6 w-32 animate-pulse rounded-full bg-muted" />
                    <div className="h-6 w-40 animate-pulse rounded-full bg-muted" />
                  </div>
                  <div className="h-5 w-full max-w-xl animate-pulse rounded-full bg-muted" />
                  <div className="h-4 w-full max-w-md animate-pulse rounded-full bg-muted" />
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap gap-2">
                <div className="h-9 w-20 min-w-0 animate-pulse rounded-full bg-muted" />
                <div className="h-9 w-20 min-w-0 animate-pulse rounded-full bg-muted" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// Error List Component
function ErrorList({ 
  errors, 
  expandedErrors, 
  toggleExpanded,
  isLoading,
  onRetryReport,
  hasActiveFilters
}: { 
  errors: UnifiedError[]; 
  expandedErrors: Set<string>;
  toggleExpanded: (id: string) => void;
  isLoading: boolean;
  onRetryReport: (reportId: string, address: string) => Promise<void>;
  hasActiveFilters: boolean;
}) {
  if (isLoading) {
    return <ErrorListSkeleton />;
  }

  if (errors.length === 0) {
    return (
      <Card className={`min-w-0 overflow-hidden rounded-[1.5rem] border ${hasActiveFilters ? 'border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--primary)/0.06))]' : 'border-success/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.98),hsl(160_84%_39%/0.06))]'} shadow-[0_16px_48px_rgba(15,23,42,0.08)] ring-1 ring-border/40 dark:border-white/10 dark:ring-white/10 dark:shadow-black/25`}>
        <CardContent className="flex min-w-0 flex-col items-center justify-center px-6 py-12 text-center">
          <span className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border ${hasActiveFilters ? 'border-primary/25 bg-primary/10 text-primary' : 'border-success/25 bg-success/10 text-success'} shadow-sm`}>
            {hasActiveFilters ? <Search className="h-7 w-7" /> : <CheckCircle2 className="h-7 w-7" />}
          </span>
          <h3 className="text-lg font-semibold text-foreground">No errors found</h3>
          <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
            {hasActiveFilters
              ? 'No error records match the current search and filter combination.'
              : 'All systems operating normally'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {errors.map(error => (
        <ErrorCard 
          key={error.id} 
          error={error} 
          isExpanded={expandedErrors.has(error.id)}
          onToggle={() => toggleExpanded(error.id)}
          onRetryReport={onRetryReport}
        />
      ))}
    </div>
  );
}

// Error Card Component
function ErrorCard({ 
  error, 
  isExpanded, 
  onToggle,
  onRetryReport
}: { 
  error: UnifiedError; 
  isExpanded: boolean;
  onToggle: () => void;
  onRetryReport: (reportId: string, address: string) => Promise<void>;
}) {
  const [isRetrying, setIsRetrying] = useState(false);
  const sourceConfig = SOURCE_CONFIG[error.source];
  const severityConfig = SEVERITY_CONFIG[error.severity];
  const SourceIcon = sourceConfig.icon;
  const SeverityIcon = severityConfig.icon;

  const getEntityLink = () => {
    if (error.entityType === 'investment_report' && error.entityId) {
      return `/investment-report/${error.entityId}`;
    }
    if (error.entityType === 'vapi_call') {
      return '/call-logs';
    }
    return null;
  };

  const entityLink = getEntityLink();
  const canRetry = error.entityType === 'investment_report' && error.entityId;
  const rowLabel = `${severityConfig.label} ${sourceConfig.label} error ${error.errorCode}: ${error.errorMessage}`;
  const contextLabel = error.entityLabel ? ` for ${error.entityLabel}` : '';
  const severityRowClass =
    error.severity === 'critical'
      ? 'border-destructive/40 bg-[linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--destructive)/0.10))] shadow-[0_18px_52px_hsl(var(--destructive)/0.10)]'
      : error.severity === 'error'
        ? 'border-destructive/35 bg-[linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--destructive)/0.08))] shadow-[0_18px_52px_hsl(var(--destructive)/0.08)]'
        : 'border-warning/35 bg-[linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--warning)/0.09))] shadow-[0_18px_52px_hsl(var(--warning)/0.08)]';

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!error.entityId) return;
    setIsRetrying(true);
    try {
      await onRetryReport(error.entityId, error.entityLabel || 'Unknown address');
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle} className="min-w-0">
      <Card className={`group min-w-0 overflow-hidden rounded-[1.35rem] border ring-1 ring-border/40 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[0_22px_64px_rgba(15,23,42,0.12)] dark:ring-white/10 dark:shadow-black/25 ${severityRowClass}`}>
        <CollapsibleTrigger asChild>
          <CardHeader aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for ${rowLabel}`} className="cursor-pointer px-4 py-4 transition-colors hover:bg-background/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-5">
            <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border/70 bg-background/70 shadow-sm dark:border-white/10 dark:bg-background/55 ${sourceConfig.color}`}>
                  <SourceIcon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge variant={severityConfig.variant} className="max-w-full gap-1 rounded-full px-2.5 py-1">
                      <SeverityIcon className="h-3 w-3" />
                      {severityConfig.label}
                    </Badge>
                    <Badge variant="secondary" className="max-w-full gap-1 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-xs font-medium text-foreground dark:border-white/10 dark:bg-background/55">
                      <SourceIcon className="h-3 w-3 shrink-0" />
                      <span className="truncate">{sourceConfig.label}</span>
                    </Badge>
                    <Badge variant="outline" className="min-w-0 max-w-full rounded-full bg-background/70 px-2.5 py-1 font-mono text-xs" title={error.errorCode}>
                      <span className="truncate">{error.errorCode}</span>
                    </Badge>
                    <span className="flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-xs text-muted-foreground dark:border-white/10 dark:bg-background/45">
                      <Clock className="h-3 w-3 shrink-0" />
                      <span className="truncate">{formatDistanceToNow(error.createdAt, { addSuffix: true })}</span>
                    </span>
                  </div>
                  <p className="min-w-0 truncate text-base font-semibold leading-6 text-foreground" title={error.errorMessage}>
                    {error.errorMessage}
                  </p>
                  {error.entityLabel && (
                    <p className="min-w-0 truncate text-sm leading-5 text-muted-foreground" title={error.entityLabel}>
                      {error.entityLabel}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                {canRetry && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="min-w-0 flex-1 gap-1 rounded-full border-warning/40 bg-warning/10 px-3 font-semibold text-warning shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-warning/55 hover:bg-warning/15 hover:text-warning focus-visible:ring-2 focus-visible:ring-warning/40 disabled:translate-y-0 disabled:opacity-60 sm:flex-none"
                    onClick={handleRetry}
                    disabled={isRetrying}
                    aria-label={`${isRetrying ? 'Retrying' : 'Retry'} report generation${contextLabel}`}
                    aria-busy={isRetrying}
                  >
                    <RefreshCw className={`h-4 w-4 shrink-0 ${isRetrying ? 'animate-spin' : ''}`} />
                    <span className="truncate">{isRetrying ? 'Retrying...' : 'Retry'}</span>
                  </Button>
                )}
                {entityLink && (
                  <Link to={entityLink} onClick={(e) => e.stopPropagation()} className="min-w-0 flex-1 sm:flex-none">
                    <Button variant="ghost" size="sm" aria-label={`View diagnostics${contextLabel || ` for ${error.errorCode}`}`} className="w-full min-w-0 gap-1 rounded-full px-3 text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/35">
                      <ExternalLink className="h-4 w-4 shrink-0" />
                      <span className="truncate">View</span>
                    </Button>
                  </Link>
                )}
                <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/70 text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:text-foreground dark:border-white/10 dark:bg-background/45">
                  {isExpanded ? (
                    <ChevronUp className="h-5 w-5" />
                  ) : (
                    <ChevronDown className="h-5 w-5" />
                  )}
                </span>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-4 px-4 pb-5 pt-0 sm:px-5">
            <div className="min-w-0 border-t border-border/60 pt-4 dark:border-white/10">
              <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <div className="min-w-0 rounded-2xl border border-border/60 bg-background/65 p-4 shadow-inner shadow-black/5 dark:border-white/10 dark:bg-background/40">
                  <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
                    <h4 className="min-w-0 truncate text-sm font-semibold text-foreground">Error Summary</h4>
                    <Badge variant={severityConfig.variant} className="shrink-0 rounded-full px-2.5 py-1">
                      {severityConfig.label}
                    </Badge>
                  </div>
                  <dl className="space-y-2 text-sm">
                    <div className="grid min-w-0 gap-1 sm:grid-cols-[8rem_1fr] sm:items-start">
                      <dt className="text-muted-foreground">Code:</dt>
                      <dd className="min-w-0 font-mono text-xs text-foreground" title={error.errorCode}>
                        <span className="block truncate">{error.errorCode}</span>
                      </dd>
                    </div>
                    <div className="grid min-w-0 gap-1 sm:grid-cols-[8rem_1fr] sm:items-start">
                      <dt className="text-muted-foreground">Message:</dt>
                      <dd className="min-w-0 break-words text-foreground">{error.errorMessage}</dd>
                    </div>
                    {error.entityLabel && (
                      <div className="grid min-w-0 gap-1 sm:grid-cols-[8rem_1fr] sm:items-start">
                        <dt className="text-muted-foreground">Context:</dt>
                        <dd className="min-w-0 break-words text-muted-foreground">{error.entityLabel}</dd>
                      </div>
                    )}
                  </dl>
                </div>

                <div className="min-w-0 rounded-2xl border border-border/60 bg-background/65 p-4 shadow-inner shadow-black/5 dark:border-white/10 dark:bg-background/40">
                  <h4 className="mb-3 text-sm font-semibold text-foreground">Source & Context</h4>
                  <dl className="space-y-2 text-sm">
                    <div className="grid min-w-0 gap-1 sm:grid-cols-[7rem_1fr] sm:items-start">
                      <dt className="text-muted-foreground">Source:</dt>
                      <dd className="min-w-0 truncate text-foreground">{sourceConfig.label}</dd>
                    </div>
                    <div className="grid min-w-0 gap-1 sm:grid-cols-[7rem_1fr] sm:items-start">
                      <dt className="text-muted-foreground">Time:</dt>
                      <dd className="min-w-0 break-words text-foreground">{format(error.createdAt, 'PPpp')}</dd>
                    </div>
                    {error.entityId && (
                      <div className="grid min-w-0 gap-1 sm:grid-cols-[7rem_1fr] sm:items-start">
                        <dt className="text-muted-foreground">Entity ID:</dt>
                        <dd className="min-w-0 font-mono text-xs text-foreground" title={error.entityId}>
                          <span className="block truncate">{error.entityId.slice(0, 8)}...</span>
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              </div>

              {error.metadata && Object.keys(error.metadata).length > 0 && (
                <div className="mt-4 min-w-0 rounded-2xl border border-border/60 bg-background/65 p-4 shadow-inner shadow-black/5 dark:border-white/10 dark:bg-background/40">
                  <h4 className="mb-3 text-sm font-semibold text-foreground">Technical Metadata</h4>
                  <dl className="grid min-w-0 gap-2 text-sm md:grid-cols-2">
                    {Object.entries(error.metadata).map(([key, value]) => (
                      value && (
                        <div key={key} className="grid min-w-0 gap-1 rounded-xl border border-border/50 bg-card/75 p-3 dark:border-white/10 dark:bg-background/35">
                          <dt className="text-xs capitalize text-muted-foreground">{key.replace(/([A-Z])/g, ' $1').trim()}:</dt>
                          <dd className="min-w-0 break-words font-mono text-xs text-foreground" title={String(value)}>{String(value)}</dd>
                        </div>
                      )
                    ))}
                  </dl>
                </div>
              )}

              {error.rawError && (
                <div className="mt-4 min-w-0 rounded-2xl border border-border/60 bg-background/65 p-4 shadow-inner shadow-black/5 dark:border-white/10 dark:bg-background/40">
                  <h4 className="mb-3 text-sm font-semibold text-foreground">Diagnostic Details</h4>
                  <pre className="max-h-48 max-w-full min-w-0 overflow-auto rounded-xl border border-border/60 bg-muted/70 p-3 text-xs leading-5 text-foreground [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] dark:border-white/10 whitespace-pre-wrap break-all">
                    {error.rawError}
                  </pre>
                </div>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// Helper functions
function determineSeverity(errorMessage: string | null): ErrorSeverity {
  if (!errorMessage) return 'error';
  const msg = errorMessage.toLowerCase();
  if (msg.includes('critical') || msg.includes('fatal') || msg.includes('crash')) return 'critical';
  if (msg.includes('timeout') || msg.includes('deprecated') || msg.includes('stuck')) return 'warning';
  return 'error';
}

function extractErrorCode(errorMessage: string | null): string {
  if (!errorMessage) return 'UNKNOWN_ERROR';
  
  // Try to extract specific error codes
  if (errorMessage.includes('invalid_model')) return 'PERPLEXITY_INVALID_MODEL';
  if (errorMessage.includes('rate_limit')) return 'API_RATE_LIMIT';
  if (errorMessage.includes('timeout')) return 'REQUEST_TIMEOUT';
  if (errorMessage.includes('401') || errorMessage.includes('unauthorized')) return 'AUTH_ERROR';
  if (errorMessage.includes('403') || errorMessage.includes('forbidden')) return 'PERMISSION_DENIED';
  if (errorMessage.includes('404')) return 'NOT_FOUND';
  if (errorMessage.includes('500')) return 'SERVER_ERROR';
  if (errorMessage.includes('Perplexity')) return 'PERPLEXITY_API_ERROR';
  if (errorMessage.includes('OpenAI')) return 'OPENAI_API_ERROR';
  
  return 'GENERATION_FAILED';
}

function cleanErrorMessage(errorMessage: string | null): string {
  if (!errorMessage) return 'Unknown error occurred';
  
  // Try to extract the most relevant part of the error
  try {
    // Check if it's a JSON error
    if (errorMessage.includes('{')) {
      const jsonMatch = errorMessage.match(/\{.*\}/s);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.error?.message) return parsed.error.message;
        if (parsed.message) return parsed.message;
      }
    }
  } catch {
    // Not JSON, continue
  }
  
  // Remove "Report generation failed:" prefix
  let cleaned = errorMessage.replace(/^Report generation failed:\s*/i, '');
  
  // Truncate if too long
  if (cleaned.length > 200) {
    cleaned = cleaned.slice(0, 200) + '...';
  }
  
  return cleaned;
}
