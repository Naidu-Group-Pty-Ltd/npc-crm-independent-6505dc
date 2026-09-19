import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Megaphone, Target, Users, DollarSign, TrendingUp, ChevronDown, ChevronUp,
  RefreshCw, Globe, Loader2, DatabaseBackup, Sparkles, ExternalLink,
  MousePointerClick, Layers, Image as ImageIcon, MapPin, Monitor, Link2,
  Smartphone, TabletSmartphone, Calendar,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface AttributionRow {
  id: string;
  client_id: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  meta_campaign_id: string | null;
  meta_adset_id: string | null;
  meta_ad_id: string | null;
  meta_campaign_name: string | null;
  meta_adset_name: string | null;
  meta_ad_name: string | null;
  meta_ad_creative_url: string | null;
  meta_campaign_objective: string | null;
  fbclid: string | null;
  gclid: string | null;
  ghl_attribution_source: string | null;
  ghl_last_attribution_source: string | null;
  landing_page_url: string | null;
  conversion_page_url: string | null;
  device_type: string | null;
  geo_location: string | null;
  source_type: string;
  enrichment_status: string | null;
  attributed_at: string;
}

interface CampaignGroup {
  campaignName: string;
  campaignId: string | null;
  objective: string | null;
  source: string;
  leads: number;
  percentage: number;
  adsets: Map<string, {
    name: string;
    id: string | null;
    leads: number;
    ads: Map<string, { name: string; id: string | null; creativeUrl: string | null; leads: number }>;
  }>;
}

export function LeadAttributionPanel() {
  const [expanded, setExpanded] = useState(true);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [isReBackfilling, setIsReBackfilling] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState('');
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const { data: attributionsData, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['lead-attributions-summary'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('get-client-data', {
        listMode: true,
        listOptions: {
          table: 'lead_source_attributions',
          select: '*',
          orderBy: 'attributed_at',
          orderAsc: false,
          limit: 500,
        },
      });
      if (error) throw new Error(error.message);
      return data?.records || [];
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });

  const attributions: AttributionRow[] = attributionsData || [];

  // Build hierarchical campaign → adset → ad structure
  const campaignGroups = new Map<string, CampaignGroup>();
  for (const attr of attributions) {
    const campaignKey = attr.meta_campaign_name || attr.utm_campaign || attr.utm_source || 'Direct / Unknown';
    
    if (!campaignGroups.has(campaignKey)) {
      campaignGroups.set(campaignKey, {
        campaignName: campaignKey,
        campaignId: attr.meta_campaign_id,
        objective: attr.meta_campaign_objective,
        source: attr.utm_source || 'unknown',
        leads: 0,
        percentage: 0,
        adsets: new Map(),
      });
    }

    const group = campaignGroups.get(campaignKey)!;
    group.leads++;

    const adsetKey = attr.meta_adset_name || attr.utm_content || 'Default Ad Set';
    if (!group.adsets.has(adsetKey)) {
      group.adsets.set(adsetKey, {
        name: adsetKey,
        id: attr.meta_adset_id,
        leads: 0,
        ads: new Map(),
      });
    }
    const adset = group.adsets.get(adsetKey)!;
    adset.leads++;

    const adKey = attr.meta_ad_name || attr.utm_term || 'Default Ad';
    if (!adset.ads.has(adKey)) {
      adset.ads.set(adKey, {
        name: adKey,
        id: attr.meta_ad_id,
        creativeUrl: attr.meta_ad_creative_url,
        leads: 0,
      });
    }
    adset.ads.get(adKey)!.leads++;
  }

  const campaignList = Array.from(campaignGroups.values()).sort((a, b) => b.leads - a.leads);
  const totalLeads = campaignList.reduce((sum, c) => sum + c.leads, 0);
  campaignList.forEach(c => { c.percentage = totalLeads > 0 ? (c.leads / totalLeads) * 100 : 0; });

  // Source breakdown
  const sourceMap = new Map<string, number>();
  for (const attr of attributions) {
    const src = attr.utm_source || 'unknown';
    sourceMap.set(src, (sourceMap.get(src) || 0) + 1);
  }
  const sourceList = Array.from(sourceMap.entries()).sort((a, b) => b[1] - a[1]);

  // Enrichment stats
  const pendingEnrichment = attributions.filter(a => a.enrichment_status === 'pending').length;
  const enrichedCount = attributions.filter(a => a.enrichment_status === 'enriched').length;
  const hasClickIds = attributions.filter(a => a.fbclid || a.gclid).length;

  // Source type breakdown
  const autoCount = attributions.filter(a => a.source_type === 'webhook_auto' || a.source_type === 'backfill').length;
  const manualCount = attributions.filter(a => a.source_type === 'manual').length;
  const csvCount = attributions.filter(a => a.source_type === 'csv_import').length;
  const incompleteCount = attributions.filter(a => !a.meta_campaign_name && !a.utm_campaign).length;

  // Time-series lead trend (last 30 days)
  const leadTrend = (() => {
    const dayMap = new Map<string, number>();
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dayMap.set(d.toISOString().slice(0, 10), 0);
    }
    for (const attr of attributions) {
      const day = attr.attributed_at?.slice(0, 10);
      if (day && dayMap.has(day)) {
        dayMap.set(day, (dayMap.get(day) || 0) + 1);
      }
    }
    return Array.from(dayMap.entries()).map(([date, count]) => ({ date, count }));
  })();
  const maxLeadsInDay = Math.max(1, ...leadTrend.map(d => d.count));

  // Device breakdown
  const deviceMap = new Map<string, number>();
  for (const attr of attributions) {
    const device = attr.device_type || 'Unknown';
    deviceMap.set(device, (deviceMap.get(device) || 0) + 1);
  }
  const deviceList = Array.from(deviceMap.entries()).sort((a, b) => b[1] - a[1]);

  // Geo breakdown. The intake pipeline stores GHL's raw IP address in
  // geo_location when no place name exists, and an IP is neither a location
  // nor something to showcase on a client-facing screen — those rows fold
  // into the same neutral bucket as empty values. Only real place names
  // are listed by name.
  const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
  const IPV6_RE = /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,7}(%.+)?$/i;
  const geoLabelFor = (raw: string | null): string => {
    const value = (raw || '').trim();
    if (!value || IPV4_RE.test(value) || IPV6_RE.test(value)) return 'Location not captured';
    return value;
  };
  const geoMap = new Map<string, number>();
  for (const attr of attributions) {
    const geo = geoLabelFor(attr.geo_location);
    geoMap.set(geo, (geoMap.get(geo) || 0) + 1);
  }
  const geoList = Array.from(geoMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const handleBackfill = async () => {
    setIsBackfilling(true);
    setBackfillProgress('Starting backfill...');
    let offset = 0;
    let totalAttributed = 0;
    let totalProcessed = 0;

    try {
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await invokeSecureFunction('backfill-lead-attributions', { batchSize: 50, offset });
        if (error) throw new Error(error.message || 'Backfill failed');
        totalAttributed += data.stats?.attributed || 0;
        totalProcessed += data.stats?.processed || 0;
        hasMore = data.hasMore;
        offset = data.nextOffset || offset + 50;
        setBackfillProgress(`Processed ${totalProcessed} clients, ${totalAttributed} attributed...`);
      }
      toast({ title: 'Backfill Complete', description: `${totalAttributed} attributions created from ${totalProcessed} clients.` });
      refetch();
    } catch (err: any) {
      toast({ title: 'Backfill Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsBackfilling(false);
      setBackfillProgress('');
    }
  };

  const handleReBackfill = async () => {
    setIsReBackfilling(true);
    setBackfillProgress('Re-fetching incomplete attributions...');
    let offset = 0;
    let totalUpdated = 0;
    let totalProcessed = 0;

    try {
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await invokeSecureFunction('backfill-lead-attributions', { batchSize: 50, offset, mode: 'update' });
        if (error) throw new Error(error.message || 'Re-backfill failed');
        totalUpdated += data.stats?.updated || 0;
        totalProcessed += data.stats?.processed || 0;
        hasMore = data.hasMore;
        offset = data.nextOffset || offset + 50;
        setBackfillProgress(`Re-fetched ${totalProcessed} records, ${totalUpdated} updated...`);
      }
      toast({ title: 'Re-Backfill Complete', description: `${totalUpdated} attributions updated with full campaign data from ${totalProcessed} records.` });
      refetch();
    } catch (err: any) {
      toast({ title: 'Re-Backfill Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsReBackfilling(false);
      setBackfillProgress('');
    }
  };

  const handleEnrich = async () => {
    setIsEnriching(true);
    try {
      let totalEnriched = 0;
      let hasMore = true;
      while (hasMore) {
        const { data, error } = await invokeSecureFunction('enrich-lead-attributions', { batchSize: 20 });
        if (error) throw new Error(error.message);
        totalEnriched += data.enriched || 0;
        hasMore = data.hasMore || false;
      }
      toast({ title: 'Enrichment Complete', description: `${totalEnriched} attributions enriched with Meta campaign/ad names.` });
      refetch();
    } catch (err: any) {
      toast({ title: 'Enrichment Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsEnriching(false);
    }
  };

  const toggleCampaign = (key: string) => {
    setExpandedCampaigns(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const sourceColors: Record<string, string> = {
    meta: 'bg-info',
    facebook: 'bg-info',
    google: 'bg-destructive',
    referral: 'bg-success',
    organic: 'bg-success',
    email: 'bg-accent',
    unknown: 'bg-muted-foreground',
  };

  const getSourceIcon = (source: string) => {
    const s = source.toLowerCase();
    if (s.includes('facebook') || s.includes('meta') || s.includes('fb')) return '📘';
    if (s.includes('google')) return '🔍';
    if (s.includes('email')) return '📧';
    if (s.includes('referral')) return '🤝';
    return '🌐';
  };

  return (
    <Card className="overflow-hidden border-primary/25 bg-[linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.80)_58%,hsl(var(--primary)/0.08))] shadow-xl shadow-sm dark:shadow-black/5 dark:shadow-black/25">
      <CardHeader className="pb-2">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-base">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                <Megaphone className="h-4 w-4 text-primary" />
              </span>
              <span className="truncate">Lead Source Attribution</span>
              <Badge variant="secondary" className="rounded-full border-success/20 bg-success/10 text-[10px] text-success dark:text-success">CRM Linked</Badge>
              {enrichedCount > 0 && (
                <Badge variant="outline" className="rounded-full border-primary/20 bg-primary/5 text-[10px] text-primary">
                  <Sparkles className="h-2.5 w-2.5 mr-0.5" />
                  {enrichedCount} Enriched
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1">
              Full-funnel attribution: Campaign → Ad Set → Ad → Conversion
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {pendingEnrichment > 0 && (
              <Button variant="outline" size="sm" className="h-8 rounded-xl border-primary/20 px-2 text-xs hover:bg-primary/10 hover:text-primary" onClick={handleEnrich} disabled={isEnriching}>
                {isEnriching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                Enrich ({pendingEnrichment})
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-8 rounded-xl px-2 text-xs hover:bg-primary/10 hover:text-primary" onClick={() => refetch()} disabled={isRefetching}>
              {isRefetching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
              Refresh
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 rounded-xl p-0 hover:bg-primary/10 hover:text-primary" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)}
            </div>
          ) : attributions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-primary/25 bg-background/45 py-8 text-center text-muted-foreground">
              <Globe className="h-8 w-8 mx-auto mb-2 text-primary/35" />
              <p className="text-sm font-medium">No attribution data yet</p>
              <p className="text-xs mt-1">Run a backfill to pull attribution data from GHL for existing contacts</p>
              <Button variant="outline" size="sm" className="mt-3 rounded-xl border-primary/20 hover:bg-primary/10 hover:text-primary" onClick={handleBackfill} disabled={isBackfilling}>
                {isBackfilling ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : <DatabaseBackup className="h-3 w-3 mr-1.5" />}
                {isBackfilling ? 'Backfilling...' : 'Backfill from GHL'}
              </Button>
              {backfillProgress && <p className="text-[10px] mt-2 text-muted-foreground">{backfillProgress}</p>}
            </div>
          ) : (
            <>
              {/* Summary KPIs */}
              <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-2xl border border-border/60 bg-background/45 p-3 text-center shadow-sm">
                  <p className="text-2xl font-bold text-foreground">{totalLeads}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">Attributed Leads</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/45 p-3 text-center shadow-sm">
                  <p className="text-2xl font-bold text-foreground">{campaignList.length}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">Campaigns</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/45 p-3 text-center shadow-sm">
                  <p className="text-2xl font-bold text-foreground">{sourceList.length}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">Sources</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-background/45 p-3 text-center shadow-sm">
                  <p className="text-2xl font-bold text-foreground">{hasClickIds}</p>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">Click IDs</p>
                </div>
              </div>

              {/* Source Breakdown Bar */}
              <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
                <p className="text-xs font-semibold text-foreground mb-2">Source Breakdown</p>
                <div className="flex h-3 overflow-hidden rounded-full bg-muted/70 gap-0.5">
                  {sourceList.map(([source, count]) => {
                    const pct = (count / totalLeads) * 100;
                    return (
                      <TooltipProvider key={source}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className={`${sourceColors[source.toLowerCase()] || 'bg-chart-4'} rounded-sm transition-all hover:brightness-110`}
                              style={{ width: `${Math.max(pct, 3)}%` }}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs font-medium">{source}: {count} leads ({pct.toFixed(1)}%)</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    );
                  })}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {sourceList.map(([source, count]) => (
                    <div key={source} className="flex min-w-0 items-center gap-1.5 rounded-full border border-border/50 bg-background/55 px-2 py-1 text-[10px]">
                      <div className={`h-2 w-2 rounded-full ${sourceColors[source.toLowerCase()] || 'bg-chart-4'}`} />
                      <span className="max-w-[8rem] truncate text-muted-foreground capitalize" title={source}>{source}</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Lead Trend (30-day sparkline) */}
              <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
                <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  Lead Trend (Last 30 Days)
                </p>
                <div className="flex h-14 items-end gap-[2px] rounded-2xl border border-border/40 bg-background/45 p-2">
                  {leadTrend.map(({ date, count }) => (
                    <TooltipProvider key={date}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className="min-w-[3px] flex-1 cursor-default rounded-t-sm bg-primary/60 transition-all hover:bg-primary"
                            style={{ height: `${Math.max((count / maxLeadsInDay) * 100, count > 0 ? 8 : 2)}%` }}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">{new Date(date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}: {count} lead{count !== 1 ? 's' : ''}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ))}
                </div>
                <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
                  <span>{new Date(leadTrend[0]?.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
                  <span>Today</span>
                </div>
              </div>

              {/* Device & Geo Breakdown */}
              {(deviceList.length > 1 || geoList.length > 1) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Device Breakdown */}
                  {deviceList.length > 1 && (
                    <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
                      <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                        <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
                        Device Breakdown
                      </p>
                      <div className="space-y-1.5">
                        {deviceList.map(([device, count]) => {
                          const pct = totalLeads > 0 ? (count / totalLeads) * 100 : 0;
                          return (
                            <div key={device} className="flex min-w-0 items-center gap-2">
                              <div className="flex w-20 min-w-0 items-center gap-1 truncate text-[10px] capitalize text-muted-foreground" title={device}>
                                {device.toLowerCase().includes('mobile') ? <Smartphone className="h-3 w-3 shrink-0" /> :
                                 device.toLowerCase().includes('tablet') ? <TabletSmartphone className="h-3 w-3 shrink-0" /> :
                                 <Monitor className="h-3 w-3 shrink-0" />}
                                {device}
                              </div>
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                <div className="h-full bg-primary/50 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[10px] font-medium w-8 text-right">{count}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Geo Breakdown */}
                  {geoList.length > 1 && (
                    <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
                      <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        Top Locations
                      </p>
                      <div className="space-y-1.5">
                        {geoList.map(([geo, count]) => {
                          const pct = totalLeads > 0 ? (count / totalLeads) * 100 : 0;
                          return (
                            <div key={geo} className="flex min-w-0 items-center gap-2">
                              <span className="w-24 truncate text-[10px] text-muted-foreground" title={geo}>{geo}</span>
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[10px] font-medium w-8 text-right">{count}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Hierarchical Campaign → Ad Set → Ad Breakdown */}
              <div className="rounded-2xl border border-border/60 bg-background/40 p-3">
                <p className="text-xs font-semibold text-foreground mb-2">Campaign Funnel Breakdown</p>
                <ScrollArea className="h-[400px]">
                  <div className="space-y-2 pr-3">
                    {campaignList.map((campaign, i) => {
                      const isOpen = expandedCampaigns.has(campaign.campaignName);
                      const adsetList = Array.from(campaign.adsets.values()).sort((a, b) => b.leads - a.leads);
                      const hasSubData = adsetList.some(as => as.name !== 'Default Ad Set');

                      return (
                        <div key={campaign.campaignName + i} className="overflow-hidden rounded-2xl border border-border/50 bg-background/55 shadow-sm">
                          {/* Campaign Level */}
                          <button
                            className="w-full p-3 text-left transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                            onClick={() => toggleCampaign(campaign.campaignName)}
                          >
                            <div className="mb-1.5 flex min-w-0 items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="text-sm">{getSourceIcon(campaign.source)}</span>
                                <Target className="h-3.5 w-3.5 text-primary shrink-0" />
                                <span className="truncate text-xs font-semibold" title={campaign.campaignName}>{campaign.campaignName}</span>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                {campaign.objective && (
                                  <Badge variant="outline" className="max-w-[8rem] truncate rounded-full text-[8px] uppercase" title={campaign.objective}>{campaign.objective}</Badge>
                                )}
                                <Badge variant="outline" className="max-w-[6rem] truncate rounded-full text-[9px] capitalize" title={campaign.source}>{campaign.source}</Badge>
                                <span className="text-xs font-bold">{campaign.leads}</span>
                                {hasSubData && (
                                  isOpen ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                )}
                              </div>
                            </div>
                            <Progress value={campaign.percentage} className="h-1.5" />
                            <p className="text-[9px] text-muted-foreground mt-1">{campaign.percentage.toFixed(1)}% of attributed leads</p>
                          </button>

                          {/* Ad Set Level */}
                          {isOpen && hasSubData && (
                            <div className="border-t border-border/30 bg-background/35">
                              {adsetList.map((adset, j) => {
                                const adList = Array.from(adset.ads.values()).sort((a, b) => b.leads - a.leads);
                                const adsetPct = campaign.leads > 0 ? (adset.leads / campaign.leads) * 100 : 0;

                                return (
                                  <div key={adset.name + j} className="border-b border-border/20 last:border-b-0">
                                    <div className="pl-8 pr-3 py-2">
                                      <div className="flex min-w-0 items-center justify-between gap-2">
                                        <div className="flex min-w-0 items-center gap-1.5">
                                          <Layers className="h-3 w-3 text-muted-foreground shrink-0" />
                                          <span className="truncate text-[11px] font-medium text-muted-foreground" title={adset.name}>{adset.name}</span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                          <span className="text-[10px] text-muted-foreground">{adsetPct.toFixed(0)}%</span>
                                          <span className="text-[11px] font-semibold">{adset.leads}</span>
                                        </div>
                                      </div>

                                      {/* Ad Level */}
                                      {adList.some(ad => ad.name !== 'Default Ad') && (
                                        <div className="mt-1.5 ml-4 space-y-1">
                                          {adList.map((ad, k) => (
                                            <div key={ad.name + k} className="flex min-w-0 items-center justify-between text-[10px]">
                                              <div className="flex min-w-0 items-center gap-1.5">
                                                {ad.creativeUrl ? (
                                                  <img src={ad.creativeUrl} alt="" className="h-5 w-5 rounded object-cover shrink-0" />
                                                ) : (
                                                  <ImageIcon className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                                                )}
                                                <span className="truncate text-muted-foreground" title={ad.name}>{ad.name}</span>
                                              </div>
                                              <span className="font-medium shrink-0 ml-2">{ad.leads}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>

              {/* Attribution Method + Actions Footer */}
              <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t border-border/50 flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span>Capture:</span>
                  {autoCount > 0 && <Badge variant="outline" className="text-[9px] bg-success/5">Auto: {autoCount}</Badge>}
                  {manualCount > 0 && <Badge variant="outline" className="text-[9px] bg-info/5">Manual: {manualCount}</Badge>}
                  {csvCount > 0 && <Badge variant="outline" className="text-[9px] bg-brand-500/5">CSV: {csvCount}</Badge>}
                  {enrichedCount > 0 && <Badge variant="outline" className="text-[9px] bg-primary/5">Enriched: {enrichedCount}</Badge>}
                </div>
                <div className="flex items-center gap-1.5">
                  {pendingEnrichment > 0 && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={handleEnrich} disabled={isEnriching}>
                      {isEnriching ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Sparkles className="h-3 w-3 mr-1" />}
                      Enrich Meta Data
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={handleBackfill} disabled={isBackfilling}>
                    {isBackfilling ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <DatabaseBackup className="h-3 w-3 mr-1" />}
                    {isBackfilling ? backfillProgress : 'Backfill New'}
                  </Button>
                  {incompleteCount > 0 && (
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={handleReBackfill} disabled={isReBackfilling}>
                      {isReBackfilling ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                      {isReBackfilling ? backfillProgress : `Re-fetch (${incompleteCount})`}
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
