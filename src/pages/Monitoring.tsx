import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Activity, 
  Database, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle,
  Clock,
  BarChart3,
  RefreshCw,
  Zap
} from 'lucide-react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

interface APIHealthStat {
  service_name: string;
  total_calls: number;
  success_calls: number;
  error_calls: number;
  success_rate: number;
  avg_response_time: number;
  live_data_count: number;
  estimated_data_count: number;
  data_quality_score: number;
}

interface CacheStat {
  cache_type: string;
  total_entries: number;
  live_data: number;
  estimated_data: number;
  expired_entries: number;
  cache_hit_potential: number;
  avg_age_days: number;
  retention_days: number;
}

export default function Monitoring() {
  const { canEdit: canEditMonitoring } = useModulePermissions('monitoring');
  const [apiStats, setApiStats] = useState<APIHealthStat[]>([]);
  const [cacheStats, setCacheStats] = useState<CacheStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const { toast } = useToast();

  const fetchStats = async () => {
    setIsLoading(true);
    try {
      // Fetch API health stats via secure Edge Function
      const { data: healthResult, error: healthError } = await invokeSecureFunction('get-system-logs', {
        operation: 'rpc',
        rpcName: 'get_api_health_stats',
        rpcParams: { days_back: 7 }
      });

      if (healthError) {
        console.error('Error fetching API health stats:', healthError);
      } else {
        setApiStats(healthResult?.data || []);
      }

      // Fetch cache stats via secure Edge Function
      const { data: cacheResult, error: cacheError } = await invokeSecureFunction('get-system-logs', {
        operation: 'rpc',
        rpcName: 'get_all_cache_stats',
        rpcParams: {}
      });

      if (cacheError) {
        console.error('Error fetching cache stats:', cacheError);
      } else {
        setCacheStats(cacheResult?.data || []);
      }

      setLastRefresh(new Date());
    } catch (error) {
      console.error('Error loading monitoring data:', error);
      toast({
        title: "Error",
        description: "Failed to load monitoring data",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const getServiceIcon = (serviceName: string) => {
    const icons: Record<string, any> = {
      'crime-statistics': AlertTriangle,
      'school-data': Database,
      'abs-data': BarChart3,
      'rba-data': TrendingUp,
      'transport': Activity,
      'risk-assessment': AlertTriangle,
      'climate-data': Activity
    };
    const Icon = icons[serviceName] || Activity;
    return <Icon className="h-4 w-4" />;
  };

  const getStatusColor = (successRate: number) => {
    if (successRate >= 95) return 'success';
    if (successRate >= 80) return 'default';
    return 'destructive';
  };

  const getStatusProgressClass = (successRate: number) => {
    if (successRate >= 95) return 'h-2.5 bg-muted/70 [&>div]:bg-success';
    if (successRate >= 80) return 'h-2.5 bg-muted/70 [&>div]:bg-warning';
    return 'h-2.5 bg-muted/70 [&>div]:bg-destructive';
  };

  const formatServiceName = (name: string) => {
    return name
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const totalCalls = apiStats.reduce((sum, stat) => sum + stat.total_calls, 0);
  const totalLiveData = apiStats.reduce((sum, stat) => sum + stat.live_data_count, 0);
  const totalEstimatedData = apiStats.reduce((sum, stat) => sum + stat.estimated_data_count, 0);
  const overallDataQuality = totalCalls > 0 
    ? ((totalLiveData / (totalLiveData + totalEstimatedData)) * 100).toFixed(1)
    : 0;

  const totalCacheEntries = cacheStats.reduce((sum, stat) => sum + stat.total_entries, 0);
  const totalLiveCached = cacheStats.reduce((sum, stat) => sum + stat.live_data, 0);

  return (
    <DashboardThemeFrame variant="page" className="space-y-6 pb-6" aria-busy={isLoading}>
      {/* Header */}
      <DashboardThemeFrame
        as="header"
        variant="hero"
        className="flex min-w-0 flex-col gap-4 border-primary/20 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.16),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.98),hsl(var(--dashboard-surface-elevated)/0.92)_55%,hsl(var(--primary)/0.08))] sm:flex-row sm:items-center sm:justify-between dark:bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.18),transparent_34%),linear-gradient(135deg,hsl(var(--card)/0.92),hsl(var(--background)/0.88)_55%,hsl(var(--primary)/0.10))]"
      >
        <div className="min-w-0 space-y-2">
          <h1 className="break-words text-3xl font-bold tracking-tight text-foreground sm:text-4xl">System Monitoring</h1>
          <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
            Real-time API health and cache performance
          </p>
        </div>
        <Button aria-label="Refresh monitoring data" onClick={fetchStats} disabled={isLoading} variant="outline" className="min-w-0 w-full shrink-0 rounded-full border-primary/30 bg-primary/10 px-5 font-semibold text-primary shadow-sm transition-all hover:-translate-y-0.5 hover:bg-primary/15 hover:text-primary hover:shadow-[0_12px_28px_hsl(var(--primary)/0.16)] focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-60 sm:w-auto">
          {isLoading ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Refresh
        </Button>
      </DashboardThemeFrame>

      {/* Overview Cards */}
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="group min-w-0 overflow-hidden border-border/70 bg-[linear-gradient(145deg,hsl(var(--card)/0.98),hsl(var(--dashboard-surface-muted)/0.55))] shadow-[0_14px_36px_hsl(var(--foreground)/0.06)] ring-1 ring-primary/5 transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:ring-primary/15 dark:border-border/70 dark:bg-card/80">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
            <CardTitle className="min-w-0 truncate text-sm font-medium text-muted-foreground">Total API Calls</CardTitle>
            <span className="rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary transition-colors group-hover:bg-primary/15">
              <Activity className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24 rounded-lg" />
            ) : (
              <div className="text-2xl font-bold tabular-nums text-foreground">{totalCalls.toLocaleString('en-AU')}</div>
            )}
            <p className="text-xs text-muted-foreground">Last 7 days</p>
          </CardContent>
        </Card>

        <Card className="group min-w-0 overflow-hidden border-border/70 bg-[linear-gradient(145deg,hsl(var(--card)/0.98),hsl(var(--dashboard-surface-muted)/0.55))] shadow-[0_14px_36px_hsl(var(--foreground)/0.06)] ring-1 ring-primary/5 transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:ring-primary/15 dark:border-border/70 dark:bg-card/80">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
            <CardTitle className="min-w-0 truncate text-sm font-medium text-muted-foreground">Data Quality</CardTitle>
            <span className="rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary transition-colors group-hover:bg-primary/15">
              <TrendingUp className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-20 rounded-lg" />
            ) : (
              <div className="text-2xl font-bold tabular-nums text-foreground">{overallDataQuality}%</div>
            )}
            <p className="text-xs text-muted-foreground">Live data ratio</p>
          </CardContent>
        </Card>

        <Card className="group min-w-0 overflow-hidden border-border/70 bg-[linear-gradient(145deg,hsl(var(--card)/0.98),hsl(var(--dashboard-surface-muted)/0.55))] shadow-[0_14px_36px_hsl(var(--foreground)/0.06)] ring-1 ring-primary/5 transition-all hover:-translate-y-0.5 hover:border-primary/35 hover:ring-primary/15 dark:border-border/70 dark:bg-card/80">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
            <CardTitle className="min-w-0 truncate text-sm font-medium text-muted-foreground">Cache Entries</CardTitle>
            <span className="rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary transition-colors group-hover:bg-primary/15">
              <Database className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24 rounded-lg" />
            ) : (
              <div className="text-2xl font-bold tabular-nums text-foreground">{totalCacheEntries.toLocaleString('en-AU')}</div>
            )}
            {isLoading ? (
              <Skeleton className="mt-1 h-3 w-20 rounded" />
            ) : (
              <p className="text-xs text-muted-foreground">{totalLiveCached} live records</p>
            )}
          </CardContent>
        </Card>

        <Card className="group min-w-0 overflow-hidden border-success/25 bg-[linear-gradient(145deg,hsl(var(--card)/0.98),hsl(var(--success)/0.08))] shadow-[0_14px_36px_hsl(var(--foreground)/0.06)] ring-1 ring-success/10 transition-all hover:-translate-y-0.5 hover:border-success/40 hover:ring-success/20 dark:border-success/25 dark:bg-card/80">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-2">
            <CardTitle className="min-w-0 truncate text-sm font-medium text-muted-foreground">System Status</CardTitle>
            <span className="rounded-xl border border-success/25 bg-success/10 p-2 text-success transition-colors group-hover:bg-success/15">
              <CheckCircle2 className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-28 rounded-lg" />
            ) : (
              <div className="text-2xl font-bold text-success">Healthy</div>
            )}
            <p className="text-xs text-muted-foreground">All services operational</p>
          </CardContent>
        </Card>
      </div>

      {/* API Health Status */}
      <Card className="min-w-0 overflow-hidden border-border/70 bg-[linear-gradient(145deg,hsl(var(--card)/0.98),hsl(var(--dashboard-surface-elevated)/0.72))] shadow-[0_16px_44px_hsl(var(--foreground)/0.07)] ring-1 ring-primary/5 dark:border-border/70 dark:bg-card/80 dark:ring-primary/10">
        <CardHeader className="border-b border-border/60 bg-[linear-gradient(135deg,hsl(var(--muted)/0.30),hsl(var(--card)/0))] px-5 py-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="rounded-2xl border border-primary/20 bg-primary/10 p-2.5 text-primary shadow-sm">
              <Activity className="h-5 w-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <CardTitle className="min-w-0 break-words text-lg font-semibold tracking-tight">
                API Health Status
              </CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6">
                Service-level performance metrics from the last 7 days
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5">
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 2 }).map((_, index) => (
                <div key={index} className="min-w-0 space-y-4 rounded-2xl border border-border/60 bg-muted/20 p-4">
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-xl" />
                      <Skeleton className="h-5 w-40 rounded-lg" />
                    </div>
                    <Skeleton className="h-7 w-24 rounded-full" />
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {Array.from({ length: 4 }).map((__, metricIndex) => (
                      <Skeleton key={metricIndex} className="h-16 rounded-xl" />
                    ))}
                  </div>
                  <Skeleton className="h-2.5 rounded-full" />
                </div>
              ))}
            </div>
          ) : apiStats.length === 0 ? (
            <div className="flex min-h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-10 text-center text-muted-foreground">
              <span className="mb-4 rounded-full border border-border/70 bg-background/70 p-3 text-muted-foreground shadow-sm">
                <Activity className="h-6 w-6" />
              </span>
              <p className="font-medium text-foreground">No API calls recorded in the last 7 days</p>
              <p className="mt-2 max-w-md text-sm leading-6">Stats will appear once services are used</p>
            </div>
          ) : (
            <div className="space-y-4">
              {apiStats.map((stat) => (
                <div key={stat.service_name} className="min-w-0 space-y-4 rounded-2xl border border-border/70 bg-background/55 p-4 shadow-sm transition-all hover:border-primary/30 hover:bg-background/70 dark:border-border/70 dark:bg-background/25">
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="shrink-0 rounded-xl border border-border/70 bg-card/80 p-2 text-muted-foreground">
                        {getServiceIcon(stat.service_name)}
                      </span>
                      <span className="min-w-0 break-words font-medium">{formatServiceName(stat.service_name)}</span>
                    </div>
                    <Badge variant={getStatusColor(stat.success_rate)} className="w-fit shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm">
                      {stat.success_rate}% Success
                    </Badge>
                  </div>

                  <div className="grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div className="min-w-0 rounded-xl border border-border/60 bg-card/55 p-3">
                      <p className="truncate text-muted-foreground">Total Calls</p>
                      <p className="break-words font-semibold tabular-nums">{stat.total_calls.toLocaleString('en-AU')}</p>
                    </div>
                    <div className="min-w-0 rounded-xl border border-border/60 bg-card/55 p-3">
                      <p className="truncate text-muted-foreground">Avg Response</p>
                      <p className="break-words font-semibold tabular-nums">{stat.avg_response_time}ms</p>
                    </div>
                    <div className="min-w-0 rounded-xl border border-border/60 bg-card/55 p-3">
                      <p className="truncate text-muted-foreground">Live Data</p>
                      <p className="break-words font-semibold tabular-nums">{stat.live_data_count}</p>
                    </div>
                    <div className="min-w-0 rounded-xl border border-border/60 bg-card/55 p-3">
                      <p className="truncate text-muted-foreground">Quality Score</p>
                      <p className="break-words font-semibold tabular-nums">{stat.data_quality_score}%</p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex min-w-0 justify-between gap-3 text-xs text-muted-foreground">
                      <span className="min-w-0 truncate">Success Rate</span>
                      <span className="shrink-0 tabular-nums">{stat.success_rate}%</span>
                    </div>
                    <Progress aria-label={`${formatServiceName(stat.service_name)} success rate ${stat.success_rate}%`} value={stat.success_rate} className={getStatusProgressClass(stat.success_rate)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cache Performance */}
      <Card className="min-w-0 overflow-hidden border-border/70 bg-[linear-gradient(145deg,hsl(var(--card)/0.98),hsl(var(--dashboard-surface-elevated)/0.74))] shadow-[0_16px_44px_hsl(var(--foreground)/0.07)] ring-1 ring-primary/5 dark:border-border/70 dark:bg-card/80 dark:ring-primary/10">
        <CardHeader className="border-b border-border/60 bg-[linear-gradient(135deg,hsl(var(--primary)/0.08),hsl(var(--muted)/0.22)_42%,hsl(var(--card)/0))] px-5 py-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="rounded-2xl border border-primary/20 bg-primary/10 p-2.5 text-primary shadow-sm">
              <Database className="h-5 w-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <CardTitle className="min-w-0 break-words text-lg font-semibold tracking-tight">
                Cache Performance
              </CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6">
                Real-time cache statistics and hit rates
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5">
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="min-w-0 space-y-4 rounded-2xl border border-border/60 bg-muted/20 p-4">
                  <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-xl" />
                      <Skeleton className="h-5 w-44 rounded-lg" />
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-2">
                      <Skeleton className="h-7 w-24 rounded-full" />
                      <Skeleton className="h-7 w-20 rounded-full" />
                    </div>
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {Array.from({ length: 4 }).map((__, metricIndex) => (
                      <Skeleton key={metricIndex} className="h-16 rounded-xl" />
                    ))}
                  </div>
                  <Skeleton className="h-12 rounded-xl" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {cacheStats.map((stat) => (
                <div key={stat.cache_type} className="min-w-0 space-y-4 rounded-2xl border border-border/70 bg-background/55 p-4 shadow-sm ring-1 ring-transparent transition-all hover:border-primary/30 hover:bg-background/70 hover:ring-primary/10 dark:border-border/70 dark:bg-background/25">
                  <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="shrink-0 rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary">
                        <Database className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 break-words font-medium capitalize leading-6">
                        {stat.cache_type.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {stat.retention_days > 0 && (
                        <Badge variant="outline" className="min-w-0 max-w-full rounded-full border-warning/35 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning shadow-sm">
                          <Clock className="mr-1 h-3 w-3 shrink-0" />
                          <span className="truncate">{stat.retention_days}d retention</span>
                        </Badge>
                      )}
                      {stat.total_entries > 0 && (
                        <Badge variant="default" className="min-w-0 max-w-full rounded-full border border-primary/30 bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-sm shadow-primary/10">
                          <span className="truncate tabular-nums">{stat.total_entries.toLocaleString('en-AU')} entries</span>
                        </Badge>
                      )}
                    </div>
                  </div>

                  {stat.total_entries > 0 ? (
                    <>
                      <div className="grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                        <div className="min-w-0 rounded-xl border border-border/60 bg-card/55 p-3">
                          <p className="truncate text-muted-foreground">Live Data</p>
                          <p className="break-words font-semibold tabular-nums text-foreground">{stat.live_data.toLocaleString('en-AU')}</p>
                        </div>
                        <div className="min-w-0 rounded-xl border border-border/60 bg-card/55 p-3">
                          <p className="truncate text-muted-foreground">Estimated</p>
                          <p className="break-words font-semibold tabular-nums text-foreground">{stat.estimated_data.toLocaleString('en-AU')}</p>
                        </div>
                        <div className="min-w-0 rounded-xl border border-border/60 bg-card/55 p-3">
                          <p className="truncate text-muted-foreground">Avg Age</p>
                          <p className="break-words font-semibold tabular-nums text-foreground">{stat.avg_age_days?.toFixed(1) || 0}d</p>
                        </div>
                        <div className="min-w-0 rounded-xl border border-primary/20 bg-primary/10 p-3">
                          <p className="truncate text-muted-foreground">Hit Potential</p>
                          <p className="break-words font-semibold tabular-nums text-primary">{stat.cache_hit_potential || 0}%</p>
                        </div>
                      </div>

                      <div className="rounded-xl border border-border/60 bg-card/45 p-3">
                        <div className="mb-2 flex min-w-0 justify-between gap-3 text-xs text-muted-foreground">
                          <span className="min-w-0 truncate">Cache Hit Potential</span>
                          <span className="shrink-0 tabular-nums">{stat.cache_hit_potential || 0}%</span>
                        </div>
                        <Progress aria-label={`${stat.cache_type.replace('_', ' ')} cache hit potential ${stat.cache_hit_potential || 0}%`} value={stat.cache_hit_potential || 0} className="h-2.5 bg-muted/70 [&>div]:bg-primary" />
                      </div>

                      {stat.expired_entries > 0 && (
                        <div className="flex min-w-0 items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning shadow-sm">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span className="min-w-0 break-words leading-6">{stat.expired_entries} expired entries need cleanup</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="rounded-xl border border-dashed border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">No data cached yet</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data Quality Breakdown */}
      <Card className="min-w-0 overflow-hidden border-border/70 bg-[linear-gradient(145deg,hsl(var(--card)/0.98),hsl(var(--dashboard-surface-elevated)/0.74))] shadow-[0_16px_44px_hsl(var(--foreground)/0.07)] ring-1 ring-primary/5 dark:border-border/70 dark:bg-card/80 dark:ring-primary/10">
        <CardHeader className="border-b border-border/60 bg-[linear-gradient(135deg,hsl(var(--success)/0.08),hsl(var(--warning)/0.06)_44%,hsl(var(--card)/0))] px-5 py-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="rounded-2xl border border-primary/20 bg-primary/10 p-2.5 text-primary shadow-sm">
              <BarChart3 className="h-5 w-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <CardTitle className="min-w-0 break-words text-lg font-semibold tracking-tight">
                Data Quality Breakdown
              </CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6">
                Live vs estimated data across all services
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5">
          <div className="space-y-5">
            {isLoading ? (
              <>
                <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                  <Skeleton className="h-32 rounded-2xl" />
                  <Skeleton className="h-32 rounded-2xl" />
                </div>
                <Skeleton className="h-24 rounded-2xl" />
              </>
            ) : (
              <>
            <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="min-w-0 overflow-hidden rounded-2xl border border-success/25 bg-[linear-gradient(145deg,hsl(var(--success)/0.12),hsl(var(--card)/0.72))] p-4 shadow-sm ring-1 ring-success/10">
                <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-success">Live Data</span>
                  <span className="shrink-0 rounded-xl border border-success/25 bg-success/10 p-2 text-success">
                    <CheckCircle2 className="h-4 w-4" />
                  </span>
                </div>
                <p className="break-words text-3xl font-bold tabular-nums text-foreground">{totalLiveData.toLocaleString('en-AU')}</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  From official sources
                </p>
              </div>

              <div className="min-w-0 overflow-hidden rounded-2xl border border-warning/25 bg-[linear-gradient(145deg,hsl(var(--warning)/0.12),hsl(var(--card)/0.72))] p-4 shadow-sm ring-1 ring-warning/10">
                <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-warning">Estimated Data</span>
                  <span className="shrink-0 rounded-xl border border-warning/25 bg-warning/10 p-2 text-warning">
                    <Zap className="h-4 w-4" />
                  </span>
                </div>
                <p className="break-words text-3xl font-bold tabular-nums text-foreground">{totalEstimatedData.toLocaleString('en-AU')}</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  Statistical estimates
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-card/55 p-4 shadow-sm">
              <div className="mb-3 flex min-w-0 flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0 break-words font-medium">Overall Data Quality</span>
                <span className="shrink-0 font-semibold tabular-nums text-primary">{overallDataQuality}% Live</span>
              </div>
              <Progress aria-label={`Overall data quality ${overallDataQuality}% live`} value={Number(overallDataQuality)} className="h-3 bg-muted/70 [&>div]:bg-primary" />
            </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <div aria-live="polite" className="mx-auto flex min-w-0 max-w-xl flex-col items-center rounded-2xl border border-border/60 bg-card/55 px-4 py-3 text-center text-sm text-muted-foreground shadow-sm">
        <p className="min-w-0 break-words tabular-nums">Last refreshed: {lastRefresh.toLocaleTimeString('en-AU')}</p>
        <p className="mt-1 min-w-0 break-words leading-5">Data updates in real-time as services are used</p>
      </div>
    </DashboardThemeFrame>
  );
}
