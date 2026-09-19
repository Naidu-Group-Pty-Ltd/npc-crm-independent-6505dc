import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import {
  Loader2, RefreshCw, Trash2, Shield, Globe, Activity,
  BarChart3, Zap, FileCode, AlertTriangle, CheckCircle2, Cloud,
  Eye, TrendingUp, HardDrive, ShieldAlert, Plus
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';

// ==================== TYPES ====================
interface CloudflareState {
  loading: boolean;
  error: string | null;
}

// ==================== HOOK ====================
function useCloudflareAction<T = any>() {
  const [state, setState] = useState<CloudflareState & { data: T | null }>({
    loading: false,
    error: null,
    data: null,
  });

  const execute = useCallback(async (action: string, params?: any) => {
    setState(s => ({ ...s, loading: true, error: null }));
    try {
      const { data, error } = await invokeSecureFunction<{ success: boolean; data: any }>('cloudflare-proxy', {
        action,
        params,
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.data?.errors?.[0]?.message || 'Cloudflare API error');
      setState({ loading: false, error: null, data: data.data });
      return data.data;
    } catch (err: any) {
      setState(s => ({ ...s, loading: false, error: err.message }));
      return null;
    }
  }, []);

  return { ...state, execute };
}

// ==================== ANALYTICS TAB ====================
function AnalyticsTab() {
  const analytics = useCloudflareAction();
  const [period, setPeriod] = useState('24h');

  const fetchAnalytics = useCallback(() => {
    const now = new Date();
    let since: Date;
    switch (period) {
      case '7d': since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
      case '30d': since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      default: since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
    analytics.execute('analytics_dashboard', {
      since: since.toISOString(),
      until: now.toISOString(),
    });
  }, [period]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const totals = analytics.data?.result?.totals;
  const timeseries = analytics.data?.result?.timeseries;

  const stats = totals ? [
    { label: 'Total Requests', value: totals.requests?.all?.toLocaleString('en-AU') || '0', icon: <Globe className="h-5 w-5" />, color: 'text-info' },
    { label: 'Cached Requests', value: totals.requests?.cached?.toLocaleString('en-AU') || '0', icon: <HardDrive className="h-5 w-5" />, color: 'text-success' },
    { label: 'Total Bandwidth', value: formatBytes(totals.bandwidth?.all || 0), icon: <TrendingUp className="h-5 w-5" />, color: 'text-accent' },
    { label: 'Threats Blocked', value: totals.threats?.all?.toLocaleString('en-AU') || '0', icon: <ShieldAlert className="h-5 w-5" />, color: 'text-destructive' },
    { label: 'Page Views', value: totals.pageviews?.all?.toLocaleString('en-AU') || '0', icon: <Eye className="h-5 w-5" />, color: 'text-brand-400' },
    { label: 'Unique Visitors', value: totals.uniques?.all?.toLocaleString('en-AU') || '0', icon: <Activity className="h-5 w-5" />, color: 'text-info' },
  ] : [];

  return (
    <div className="min-h-0 min-w-0 space-y-4 sm:space-y-6">
      <DashboardThemeFrame variant="section" className="min-h-0 space-y-4 border-primary/15 bg-[linear-gradient(135deg,hsl(var(--card)/0.88),hsl(var(--background)/0.72)_58%,hsl(var(--primary)/0.08))] p-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] dark:shadow-black/25 sm:p-5">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">Traffic Analytics</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground sm:text-sm">Cloudflare request, cache, bandwidth, and threat telemetry.</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-background/55 p-1.5 shadow-sm dark:border-white/10 dark:bg-background/40">
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger aria-label="Analytics time range" className="h-9 w-[132px] border-border/70 bg-card/90 text-xs font-medium shadow-sm focus:ring-primary/35 dark:border-white/10 dark:bg-background/70 sm:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">Last 24h</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={fetchAnalytics}
              disabled={analytics.loading}
              className="h-9 w-9 border-primary/20 bg-primary/5 text-primary shadow-sm transition-all hover:border-primary/35 hover:bg-primary/10 focus-visible:ring-primary/40 disabled:opacity-70"
              aria-label="Refresh analytics"
            >
              <RefreshCw className={`h-4 w-4 ${analytics.loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {analytics.error && (
          <Alert role="alert" variant="destructive" className="min-w-0 overflow-hidden border-destructive/30 bg-destructive/10 text-destructive shadow-sm dark:text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="break-words text-sm leading-6">{analytics.error}</AlertDescription>
          </Alert>
        )}

        {analytics.loading && !analytics.data ? (
          <div className="flex min-h-[14rem] items-center justify-center rounded-2xl border border-dashed border-primary/20 bg-muted/20 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : stats.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {stats.map(stat => (
              <Card key={stat.label} className="min-w-0 overflow-hidden border-border/70 bg-card/90 shadow-[0_12px_35px_rgba(15,23,42,0.07)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-[0_16px_44px_rgba(15,23,42,0.10)] dark:border-white/10 dark:bg-background/60 dark:shadow-black/25">
                <CardContent className="p-4 sm:px-6 sm:pt-6">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                    <div className={`${stat.color} mb-1 sm:mb-0`}>{stat.icon}</div>
                    <div className="min-w-0">
                      <p className="text-xl sm:text-2xl font-bold truncate">{stat.value}</p>
                      <p className="text-[11px] sm:text-xs text-muted-foreground">{stat.label}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !analytics.loading && (
          <div className="flex min-h-[14rem] flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/45 px-4 py-10 text-center shadow-inner dark:border-white/10 dark:bg-background/30">
            <BarChart3 className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No analytics data available.</p>
            <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">Refresh or choose another time range when Cloudflare telemetry is available.</p>
          </div>
        )}
      </DashboardThemeFrame>

      {/* HTTP Status breakdown */}
      {totals?.requests?.http_status && (
        <Card className="min-w-0 overflow-hidden border-border/70 bg-card/85 shadow-sm dark:border-white/10 dark:bg-background/55">
          <CardHeader className="min-w-0 pb-3 sm:pb-6">
            <CardTitle className="text-base">HTTP Status Codes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 sm:gap-3">
              {Object.entries(totals.requests.http_status).map(([code, count]) => (
                <Badge key={code} variant="outline" className={
                  code.startsWith('2') ? 'border-success/30 text-success' :
                  code.startsWith('3') ? 'border-info/30 text-info' :
                  code.startsWith('4') ? 'border-brand-500/30 text-brand-400' :
                  'border-destructive/30 text-destructive'
                }>
                  {code}: {(count as number).toLocaleString('en-AU')}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ==================== CDN TAB ====================
function CdnTab() {
  const { toast } = useToast();
  const cacheSettings = useCloudflareAction();
  const purgeAll = useCloudflareAction();
  const purgeUrls = useCloudflareAction();
  const [urls, setUrls] = useState('');

  useEffect(() => {
    cacheSettings.execute('cache_settings');
  }, []);

  const handlePurgeAll = async () => {
    const result = await purgeAll.execute('purge_cache_all');
    if (result?.success) {
      toast({ title: 'Cache Purged', description: 'Entire cache has been purged successfully.' });
    }
  };

  const handlePurgeUrls = async () => {
    const urlList = urls.split('\n').map(u => u.trim()).filter(Boolean);
    if (urlList.length === 0) {
      toast({ title: 'No URLs', description: 'Enter at least one URL to purge.', variant: 'destructive' });
      return;
    }
    const result = await purgeUrls.execute('purge_cache_urls', { urls: urlList });
    if (result?.success) {
      toast({ title: 'URLs Purged', description: `${urlList.length} URL(s) purged from cache.` });
      setUrls('');
    }
  };

  const settings = cacheSettings.data?.result || [];

  return (
    <div className="min-h-0 min-w-0 space-y-4 sm:space-y-6">
      <DashboardThemeFrame variant="section" className="min-h-0 space-y-5 border-primary/15 bg-[linear-gradient(135deg,hsl(var(--card)/0.88),hsl(var(--background)/0.72)_58%,hsl(var(--primary)/0.07))] p-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] dark:shadow-black/25 sm:p-5">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">CDN & Caching</h3>
          <p className="max-w-3xl text-xs leading-5 text-muted-foreground sm:text-sm">Operate cache settings and purge actions with clear separation between zone-wide and URL-specific invalidation.</p>
        </div>

        {cacheSettings.error && (
          <Alert role="alert" variant="destructive" className="min-w-0 overflow-hidden border-destructive/30 bg-destructive/10 text-destructive shadow-sm dark:text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="break-words text-sm leading-6">{cacheSettings.error}</AlertDescription>
          </Alert>
        )}

        {/* Cache Settings */}
        {settings.length > 0 && (
          <Card className="min-w-0 overflow-hidden border-border/70 bg-card/90 shadow-[0_12px_35px_rgba(15,23,42,0.06)] transition-all duration-200 hover:border-primary/20 hover:shadow-[0_16px_44px_rgba(15,23,42,0.10)] dark:border-white/10 dark:bg-background/60 dark:shadow-black/25">
            <CardHeader className="min-w-0 pb-3 sm:pb-5">
              <CardTitle className="text-base">Current Cache Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:gap-3 sm:grid-cols-2">
                {settings.map((s: any) => (
                  <div key={s.id} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/30 p-2.5 shadow-sm sm:p-3 dark:border-white/10">
                    <span className="min-w-0 truncate text-xs font-medium capitalize sm:text-sm">{s.id.replace(/_/g, ' ')}</span>
                    <Badge variant="outline" className="max-w-[120px] flex-shrink-0 truncate text-[11px] sm:max-w-none sm:text-xs">
                      {typeof s.value === 'object' ? JSON.stringify(s.value) : String(s.value)}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Purge Controls */}
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <Card className="min-w-0 overflow-hidden border-destructive/25 bg-[linear-gradient(135deg,hsl(var(--card)/0.94),hsl(var(--destructive)/0.06))] shadow-[0_14px_42px_rgba(127,29,29,0.08)] transition-all duration-200 hover:border-destructive/35 hover:shadow-[0_18px_48px_rgba(127,29,29,0.12)] dark:border-destructive/20 dark:bg-background/60 dark:shadow-black/25">
            <CardHeader className="min-w-0 pb-3 sm:pb-5">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-destructive/25 bg-destructive/10 text-destructive dark:text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base">Purge Everything</CardTitle>
                  <CardDescription className="mt-1 leading-5">Clear the entire CDN cache for your zone</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border border-destructive/15 bg-destructive/5 px-3 py-2 text-xs leading-5 text-muted-foreground">
                Zone-wide cache invalidation can temporarily reduce cache hit rates. Existing safeguards and permissions remain enforced.
              </div>
              {purgeAll.error && (
                <Alert role="alert" variant="destructive" className="min-w-0 overflow-hidden border-destructive/30 bg-destructive/10 text-destructive shadow-sm dark:text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="break-words text-sm leading-6">{purgeAll.error}</AlertDescription>
                </Alert>
              )}
              <Button
                variant="destructive"
                onClick={handlePurgeAll}
                disabled={purgeAll.loading}
                className="min-h-10 w-full bg-destructive text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-destructive focus-visible:ring-2 focus-visible:ring-destructive/50 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-70 dark:bg-destructive dark:hover:bg-destructive"
              >
                {purgeAll.loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                Purge All Cache
              </Button>
            </CardContent>
          </Card>

          <Card className="min-w-0 overflow-hidden border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.94),hsl(var(--primary)/0.07))] shadow-[0_14px_42px_rgba(15,23,42,0.08)] transition-all duration-200 hover:border-primary/30 hover:shadow-[0_18px_48px_rgba(15,23,42,0.12)] dark:border-primary/20 dark:bg-background/60 dark:shadow-black/25">
            <CardHeader className="min-w-0 pb-3 sm:pb-5">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
                  <HardDrive className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <CardTitle className="text-base">Purge by URL</CardTitle>
                  <CardDescription className="mt-1 leading-5">Enter URLs to purge (one per line)</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                aria-label="URLs to purge"
                className="w-full min-w-0 min-h-[132px] max-h-[42dvh] overflow-auto break-all rounded-xl border border-border/70 bg-background/90 p-3 text-sm leading-6 shadow-inner outline-none resize-y placeholder:text-muted-foreground/70 focus-visible:border-primary/45 focus-visible:ring-2 focus-visible:ring-primary/30 dark:border-white/10 dark:bg-background/55 [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin]"
                placeholder="https://example.com/page1&#10;https://example.com/page2"
                value={urls}
                onChange={e => setUrls(e.target.value)}
              />
              {purgeUrls.error && (
                <Alert role="alert" variant="destructive" className="min-w-0 overflow-hidden border-destructive/30 bg-destructive/10 text-destructive shadow-sm dark:text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="break-words text-sm leading-6">{purgeUrls.error}</AlertDescription>
                </Alert>
              )}
              <Button
                onClick={handlePurgeUrls}
                disabled={purgeUrls.loading || !urls.trim()}
                className="min-h-10 w-full border border-brand-500/25 bg-brand-500/10 text-brand-700 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-500/20 focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-70 dark:text-brand-200"
              >
                {purgeUrls.loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                Purge URLs
              </Button>
            </CardContent>
          </Card>
        </div>
      </DashboardThemeFrame>
    </div>
  );
}

// ==================== WORKERS & PAGES TAB ====================
function WorkersTab() {
  const workers = useCloudflareAction();
  const pages = useCloudflareAction();

  useEffect(() => {
    workers.execute('list_workers');
    pages.execute('list_pages');
  }, []);

  const workersList = workers.data?.result || [];
  const pagesList = pages.data?.result || [];
  const isLoading = workers.loading || pages.loading;

  return (
    <div className="min-h-0 min-w-0 space-y-4 sm:space-y-6">
      <DashboardThemeFrame variant="section" className="min-h-0 space-y-5 border-primary/15 bg-[linear-gradient(135deg,hsl(var(--card)/0.88),hsl(var(--background)/0.72)_58%,hsl(var(--primary)/0.07))] p-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] dark:shadow-black/25 sm:p-5">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">Workers & Pages</h3>
          <p className="max-w-3xl text-xs leading-5 text-muted-foreground sm:text-sm">Deployment visibility for edge compute scripts and Pages projects connected to Cloudflare.</p>
        </div>

        {(workers.error || pages.error) && (
          <Alert role="alert" variant="destructive" className="min-w-0 overflow-hidden border-destructive/30 bg-destructive/10 text-destructive shadow-sm dark:text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="break-words text-sm leading-6">{workers.error || pages.error}</AlertDescription>
          </Alert>
        )}

        {isLoading && !workers.data && !pages.data ? (
          <div className="flex min-h-[16rem] items-center justify-center rounded-2xl border border-dashed border-primary/20 bg-muted/20 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            {/* Workers */}
            <Card className="min-w-0 overflow-hidden border-brand-500/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.94),hsl(38_92%_50%/0.07))] shadow-[0_14px_42px_rgba(15,23,42,0.08)] dark:border-brand-400/20 dark:bg-background/60 dark:shadow-black/25">
              <CardHeader className="min-w-0 pb-3 sm:pb-5">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-brand-500/25 bg-brand-500/10 text-brand-500 dark:text-brand-300">
                      <Zap className="h-5 w-5" />
                    </div>
                    <CardTitle className="min-w-0 truncate text-base">Workers ({workersList.length})</CardTitle>
                  </div>
                  <Badge variant="outline" className="flex-shrink-0 border-brand-500/25 bg-brand-500/10 text-[11px] text-brand-700 dark:text-brand-200 sm:text-xs">
                    {workersList.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {workersList.length === 0 ? (
                  <div className="flex min-h-[10rem] flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/45 px-4 py-8 text-center shadow-inner dark:border-white/10 dark:bg-background/30">
                    <FileCode className="mb-3 h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">No Workers deployed.</p>
                    <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Worker deployments will appear here when Cloudflare returns scripts for this account.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {workersList.map((w: any) => (
                      <div key={w.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/55 p-3 shadow-sm transition-colors hover:border-brand-500/25 hover:bg-brand-500/5 dark:border-white/10 dark:bg-background/35">
                        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                          <FileCode className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium sm:text-sm" title={w.id}>{w.id}</p>
                            <p className="text-[11px] text-muted-foreground sm:text-xs">
                              Modified: {w.modified_on ? new Date(w.modified_on).toLocaleDateString('en-AU') : 'N/A'}
                            </p>
                          </div>
                        </div>
                        <Badge variant="outline" className="flex-shrink-0 border-success/30 bg-success/10 text-[11px] text-success sm:text-xs">
                          Active
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pages */}
            <Card className="min-w-0 overflow-hidden border-info/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.94),hsl(217_91%_60%/0.07))] shadow-[0_14px_42px_rgba(15,23,42,0.08)] dark:border-info/20 dark:bg-background/60 dark:shadow-black/25">
              <CardHeader className="min-w-0 pb-3 sm:pb-5">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-info/25 bg-info/10 text-info dark:text-info">
                      <Globe className="h-5 w-5" />
                    </div>
                    <CardTitle className="min-w-0 truncate text-base">Pages Projects ({pagesList.length})</CardTitle>
                  </div>
                  <Badge variant="outline" className="flex-shrink-0 border-info/25 bg-info/10 text-[11px] text-info dark:text-info sm:text-xs">
                    {pagesList.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {pagesList.length === 0 ? (
                  <div className="flex min-h-[10rem] flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/45 px-4 py-8 text-center shadow-inner dark:border-white/10 dark:bg-background/30">
                    <Globe className="mb-3 h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">No Pages projects found.</p>
                    <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Pages deployments will appear here when Cloudflare returns projects for this account.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pagesList.map((p: any) => (
                      <div key={p.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/55 p-3 shadow-sm transition-colors hover:border-info/25 hover:bg-info/5 dark:border-white/10 dark:bg-background/35">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium sm:text-sm" title={p.name}>{p.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground sm:text-xs" title={`${p.subdomain}.pages.dev`}>
                            {p.subdomain}.pages.dev
                          </p>
                        </div>
                        <Badge variant="outline" className="flex-shrink-0 border-info/30 bg-info/10 text-[11px] text-info sm:text-xs">
                          {p.latest_deployment?.environment || 'production'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </DashboardThemeFrame>
    </div>
  );
}

// ==================== FIREWALL TAB ====================
function FirewallTab() {
  const { toast } = useToast();
  const rules = useCloudflareAction();
  const createRule = useCloudflareAction();
  const deleteRule = useCloudflareAction();

  const [showForm, setShowForm] = useState(false);
  const [newRule, setNewRule] = useState({
    description: '',
    expression: '',
    action: 'block',
  });

  const fetchRules = useCallback(() => {
    rules.execute('list_firewall_rules');
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  const handleCreate = async () => {
    if (!newRule.expression.trim()) {
      toast({ title: 'Expression Required', description: 'Enter a valid firewall expression.', variant: 'destructive' });
      return;
    }
    const result = await createRule.execute('create_firewall_rule', {
      expression: newRule.expression,
      action: newRule.action,
      description: newRule.description,
    });
    if (result?.success) {
      toast({ title: 'Rule Created', description: 'Firewall rule has been created.' });
      setNewRule({ description: '', expression: '', action: 'block' });
      setShowForm(false);
      fetchRules();
    } else {
      toast({ title: 'Failed', description: createRule.error || 'Could not create rule.', variant: 'destructive' });
    }
  };

  const handleDelete = async (ruleId: string) => {
    const result = await deleteRule.execute('delete_firewall_rule', { ruleId });
    if (result) {
      toast({ title: 'Rule Deleted', description: 'Firewall rule has been removed.' });
      fetchRules();
    }
  };

  const rulesList = rules.data?.result || [];

  // Preset expressions
  const presets = [
    { label: 'Block /auth page from non-AU', expression: '(http.request.uri.path eq "/auth" and ip.geoip.country ne "AU")', action: 'block' as const },
    { label: 'Challenge /auth page visitors', expression: '(http.request.uri.path eq "/auth")', action: 'challenge' as const },
    { label: 'Block known bots on /auth', expression: '(http.request.uri.path eq "/auth" and cf.client.bot)', action: 'block' as const },
  ];

  return (
    <div className="min-h-0 min-w-0 space-y-4 sm:space-y-6">
      <DashboardThemeFrame variant="section" className="min-h-0 space-y-5 border-primary/15 bg-[linear-gradient(135deg,hsl(var(--card)/0.88),hsl(var(--background)/0.72)_58%,hsl(var(--primary)/0.07))] p-4 shadow-[0_18px_55px_rgba(15,23,42,0.08)] dark:shadow-black/25 sm:p-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">Firewall Rules</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground sm:text-sm">Security rule operations for auth protection, WAF expressions, and active Cloudflare firewall rules.</p>
          </div>
          <Button
            onClick={() => setShowForm(!showForm)}
            size="sm"
            className="min-h-9 border border-primary/25 bg-primary/15 text-primary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-primary/40 dark:text-primary"
          >
            <Plus className="h-4 w-4 mr-1" />
            New Rule
          </Button>
        </div>

        {(rules.error || createRule.error || deleteRule.error) && (
          <Alert role="alert" variant="destructive" className="min-w-0 overflow-hidden border-destructive/30 bg-destructive/10 text-destructive shadow-sm dark:text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="break-words text-sm leading-6">{rules.error || createRule.error || deleteRule.error}</AlertDescription>
          </Alert>
        )}

        {/* Quick presets */}
        <Card className="min-w-0 overflow-hidden border-primary/20 bg-[linear-gradient(135deg,hsl(var(--card)/0.94),hsl(var(--primary)/0.07))] shadow-[0_14px_42px_rgba(15,23,42,0.08)] transition-all duration-200 hover:border-primary/30 hover:shadow-[0_18px_48px_rgba(15,23,42,0.12)] dark:border-primary/20 dark:bg-background/60 dark:shadow-black/25">
          <CardHeader className="min-w-0 pb-3 sm:pb-5">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-sm sm:text-base">Quick Presets (Auth Page Protection)</CardTitle>
                <CardDescription className="mt-1 text-xs leading-5 sm:text-sm">One-click firewall rules for your auth page</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {presets.map((preset, i) => (
                <div key={i} className="group flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-background/55 p-3 shadow-sm transition-colors hover:border-primary/25 hover:bg-primary/5 sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:bg-background/35">
                  <div className="flex min-w-0 gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                      <Shield className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground sm:text-sm">{preset.label}</p>
                      <p className="mt-1 max-w-full break-words rounded-lg border border-border/50 bg-muted/35 px-2 py-1.5 font-mono text-[11px] leading-5 text-muted-foreground select-text sm:line-clamp-2 sm:text-xs dark:border-white/10" title={preset.expression}>{preset.expression}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9 flex-shrink-0 self-end border-primary/20 bg-primary/5 text-primary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-70 sm:self-auto"
                    onClick={async () => {
                      const result = await createRule.execute('create_firewall_rule', {
                        expression: preset.expression,
                        action: preset.action,
                        description: preset.label,
                      });
                      if (result?.success) {
                        toast({ title: 'Preset Applied', description: preset.label });
                        fetchRules();
                      }
                    }}
                    disabled={createRule.loading}
                  >
                    {createRule.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Apply'}
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Create form */}
        {showForm && (
          <Card className="min-w-0 overflow-hidden border-primary/20 bg-card/90 shadow-[0_14px_42px_rgba(15,23,42,0.08)] dark:border-primary/20 dark:bg-background/60 dark:shadow-black/25">
            <CardHeader className="min-w-0 pb-3 sm:pb-5">
              <CardTitle className="text-base">Create Firewall Rule</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input
                    aria-label="Description"
                    placeholder="e.g. Block auth page from bots"
                    value={newRule.description}
                    onChange={e => setNewRule(r => ({ ...r, description: e.target.value }))}
                    className="min-w-0 border-border/70 bg-background/90 shadow-sm focus-visible:ring-primary/35 dark:border-white/10 dark:bg-background/55"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Action</Label>
                  <Select value={newRule.action} onValueChange={v => setNewRule(r => ({ ...r, action: v }))}>
                    <SelectTrigger aria-label="Action" className="border-border/70 bg-background/90 shadow-sm focus:ring-primary/35 dark:border-white/10 dark:bg-background/55">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="block">Block</SelectItem>
                      <SelectItem value="challenge">Challenge (CAPTCHA)</SelectItem>
                      <SelectItem value="js_challenge">JS Challenge</SelectItem>
                      <SelectItem value="managed_challenge">Managed Challenge</SelectItem>
                      <SelectItem value="allow">Allow</SelectItem>
                      <SelectItem value="log">Log Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Expression (Cloudflare filter syntax)</Label>
                <Input
                  aria-label="Expression (Cloudflare filter syntax)"
                  placeholder='(http.request.uri.path eq "/auth")'
                  value={newRule.expression}
                  onChange={e => setNewRule(r => ({ ...r, expression: e.target.value }))}
                  className="min-w-0 border-border/70 bg-background/90 font-mono text-sm shadow-sm focus-visible:ring-primary/35 dark:border-white/10 dark:bg-background/55"
                />
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setShowForm(false)} className="min-h-10 w-full border-border/70 bg-background/70 sm:w-auto">Cancel</Button>
                <Button onClick={handleCreate} disabled={createRule.loading} className="min-h-10 w-full border border-primary/25 bg-primary/15 text-primary shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/20 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-70 sm:w-auto">
                  {createRule.loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
                  Create Rule
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Existing Rules */}
        {rules.loading && !rules.data ? (
          <div className="flex min-h-[14rem] items-center justify-center rounded-2xl border border-dashed border-primary/20 bg-muted/20 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Card className="min-w-0 overflow-hidden border-border/70 bg-card/90 shadow-[0_14px_42px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-background/60 dark:shadow-black/25">
            <CardHeader className="min-w-0 pb-3 sm:pb-5">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <CardTitle className="text-base">Active Rules ({rulesList.length})</CardTitle>
                <Badge variant="outline" className="flex-shrink-0 border-primary/25 bg-primary/10 text-[11px] text-primary sm:text-xs">
                  {rulesList.length}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {rulesList.length === 0 ? (
                <div className="flex min-h-[10rem] flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/45 px-4 py-8 text-center shadow-inner dark:border-white/10 dark:bg-background/30">
                  <Shield className="mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">No firewall rules configured.</p>
                  <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Created firewall rules and applied presets will appear in this ledger.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {rulesList.map((rule: any) => (
                    <div key={rule.id} className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-background/55 p-3 shadow-sm transition-colors hover:border-primary/25 hover:bg-primary/5 sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:bg-background/35">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-foreground sm:text-sm" title={rule.description || 'Untitled Rule'}>{rule.description || 'Untitled Rule'}</p>
                        <p className="mt-1 max-w-full break-words rounded-lg border border-border/50 bg-muted/35 px-2 py-1.5 font-mono text-[11px] leading-5 text-muted-foreground select-text sm:line-clamp-2 sm:text-xs dark:border-white/10" title={rule.filter?.expression || 'N/A'}>
                          {rule.filter?.expression || 'N/A'}
                        </p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2 self-end sm:self-auto">
                        <Badge variant="outline" className={`text-[11px] sm:text-xs ${
                          rule.action === 'block' ? 'border-destructive/30 bg-destructive/10 text-destructive' :
                          rule.action === 'challenge' ? 'border-brand-500/30 bg-brand-500/10 text-brand-600 dark:text-brand-300' :
                          rule.action === 'allow' ? 'border-success/30 bg-success/10 text-success' :
                          'border-info/30 bg-info/10 text-info'
                        }`}>
                          {rule.action}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:ring-destructive/40"
                          onClick={() => handleDelete(rule.id)}
                          disabled={deleteRule.loading}
                          aria-label="Delete firewall rule"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </DashboardThemeFrame>
    </div>
  );
}

// ==================== HELPERS ====================
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

// ==================== MAIN PAGE ====================
export default function CloudflareManagement() {
  const zone = useCloudflareAction();

  useEffect(() => {
    zone.execute('zone_details');
  }, []);

  const zoneData = zone.data?.result;

  return (
    <DashboardThemeFrame variant="page" className="min-h-[calc(100dvh-5rem)] min-w-0 space-y-5 px-1 pb-6 sm:space-y-7 sm:px-0">
      <DashboardThemeFrame as="header" variant="hero" className="flex min-w-0 flex-col gap-5 border-primary/25 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.18),transparent_34%),radial-gradient(circle_at_top_right,hsl(var(--primary)/0.12),transparent_30%),linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.88)_52%,hsl(var(--primary)/0.10))] p-5 shadow-[0_24px_80px_rgba(15,23,42,0.14)] ring-1 ring-white/35 dark:ring-white/10 dark:shadow-black/40 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary shadow-inner dark:bg-primary/15 sm:h-14 sm:w-14">
            <Cloud className="h-6 w-6 sm:h-7 sm:w-7" />
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Cloudflare</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Manage CDN, analytics, Workers, and firewall rules.
            </p>
          </div>
        </div>
        {zone.loading && !zoneData && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Checking zone
            </Badge>
          </div>
        )}
        {zoneData && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="outline" className="bg-success/10 text-success border-success/30">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {zoneData.name}
            </Badge>
            <Badge variant="outline" className="text-muted-foreground">
              {zoneData.plan?.name || 'Free'}
            </Badge>
          </div>
        )}
      </DashboardThemeFrame>

      <Tabs defaultValue="analytics" className="min-w-0 w-full">
        <DashboardThemeFrame variant="toolbar" className="min-w-0 overflow-x-auto border-primary/15 bg-card/75 p-1.5 shadow-[0_14px_40px_rgba(15,23,42,0.08)] [scrollbar-color:hsl(var(--primary)/0.35)_transparent] [scrollbar-width:thin] dark:bg-background/45 dark:shadow-black/25">
          <TabsList aria-label="Cloudflare sections" className="inline-flex h-auto w-auto min-w-max gap-1 bg-transparent p-0">
            <TabsTrigger value="analytics" className="gap-1.5 min-h-10 rounded-xl border border-transparent px-3 py-2 text-xs font-medium text-muted-foreground transition-all hover:border-primary/20 hover:bg-primary/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 data-[state=active]:border-primary/30 data-[state=active]:bg-primary/15 data-[state=active]:text-primary data-[state=active]:shadow-sm sm:px-4 sm:text-sm">
              <BarChart3 className="h-3.5 w-3.5" />
              <span>Analytics</span>
            </TabsTrigger>
            <TabsTrigger value="cdn" className="gap-1.5 min-h-10 rounded-xl border border-transparent px-3 py-2 text-xs font-medium text-muted-foreground transition-all hover:border-primary/20 hover:bg-primary/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 data-[state=active]:border-primary/30 data-[state=active]:bg-primary/15 data-[state=active]:text-primary data-[state=active]:shadow-sm sm:px-4 sm:text-sm">
              <HardDrive className="h-3.5 w-3.5" />
              CDN
            </TabsTrigger>
            <TabsTrigger value="workers" className="gap-1.5 min-h-10 rounded-xl border border-transparent px-3 py-2 text-xs font-medium text-muted-foreground transition-all hover:border-primary/20 hover:bg-primary/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 data-[state=active]:border-primary/30 data-[state=active]:bg-primary/15 data-[state=active]:text-primary data-[state=active]:shadow-sm sm:px-4 sm:text-sm">
              <Zap className="h-3.5 w-3.5" />
              Workers
            </TabsTrigger>
            <TabsTrigger value="firewall" className="gap-1.5 min-h-10 rounded-xl border border-transparent px-3 py-2 text-xs font-medium text-muted-foreground transition-all hover:border-primary/20 hover:bg-primary/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40 data-[state=active]:border-primary/30 data-[state=active]:bg-primary/15 data-[state=active]:text-primary data-[state=active]:shadow-sm sm:px-4 sm:text-sm">
              <Shield className="h-3.5 w-3.5" />
              Firewall
            </TabsTrigger>
          </TabsList>
        </DashboardThemeFrame>

        <TabsContent value="analytics" className="mt-4 min-w-0 sm:mt-6">
          <AnalyticsTab />
        </TabsContent>
        <TabsContent value="cdn" className="mt-4 min-w-0 sm:mt-6">
          <CdnTab />
        </TabsContent>
        <TabsContent value="workers" className="mt-4 min-w-0 sm:mt-6">
          <WorkersTab />
        </TabsContent>
        <TabsContent value="firewall" className="mt-4 min-w-0 sm:mt-6">
          <FirewallTab />
        </TabsContent>
      </Tabs>
    </DashboardThemeFrame>
  );
}
