import { useState, useCallback } from 'react';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DollarSign, Eye, MousePointerClick, Target, RefreshCw, TrendingUp, Megaphone, GitCompareArrows, Bot, Layers, FileDown, Sparkles } from 'lucide-react';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import { cn } from '@/lib/utils';
import { ManyChatPanel } from '@/components/marketing/ManyChatPanel';
import { LeadMagnetsPanel } from '@/components/marketing/LeadMagnetsPanel';
import { toast } from 'sonner';
import { AnomalyAlertsPanel } from '@/components/marketing/AnomalyAlertsPanel';
import { CampaignHealthPanel } from '@/components/marketing/CampaignHealthPanel';
import { AIDigestPanel } from '@/components/marketing/AIDigestPanel';
import { BudgetAdvisorPanel } from '@/components/marketing/BudgetAdvisorPanel';
import { AudienceIntelligencePanel } from '@/components/marketing/AudienceIntelligencePanel';
import { LeadQualityPanel } from '@/components/marketing/LeadQualityPanel';
import { ForecastPanel } from '@/components/marketing/ForecastPanel';
import { WeeklyBriefPanel } from '@/components/marketing/WeeklyBriefPanel';
import { BenchmarksPanel } from '@/components/marketing/BenchmarksPanel';
import { MarketCorrelationPanel } from '@/components/marketing/MarketCorrelationPanel';
import { ReportDistributionPanel } from '@/components/marketing/ReportDistributionPanel';
import { LeadAttributionPanel } from '@/components/marketing/LeadAttributionPanel';
import { DateRangePicker } from '@/components/marketing/DateRangePicker';
import { DrillDownExplorer } from '@/components/marketing/DrillDownExplorer';
import { ComparisonPanel } from '@/components/marketing/ComparisonPanel';
import { PeriodOverPeriodPanel } from '@/components/marketing/PeriodOverPeriodPanel';
import { CreativeGalleryPanel } from '@/components/marketing/CreativeGalleryPanel';
import { SpendPacingPanel } from '@/components/marketing/SpendPacingPanel';
import { FullFunnelPanel } from '@/components/marketing/FullFunnelPanel';
import { TrueROIPanel } from '@/components/marketing/TrueROIPanel';
import { LiveModelBadge, ModelUpgradeButton } from '@/components/agentModels';


const DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last_7d', label: 'Last 7 Days' },
  { value: 'last_14d', label: 'Last 14 Days' },
  { value: 'last_30d', label: 'Last 30 Days' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'last_90d', label: 'Last 90 Days' },
];

function formatCurrency(val: string | number | undefined) {
  if (!val) return '$0.00';
  return `$${Number(val).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatNumber(val: string | number | undefined) {
  if (!val) return '0';
  return Number(val).toLocaleString('en-AU');
}

function formatPercent(val: string | number | undefined) {
  if (!val) return '0.00%';
  return `${Number(val).toFixed(2)}%`;
}

function extractAction(actions: any[] | undefined, type: string): number {
  if (!actions) return 0;
  const action = actions.find((a: any) => a.action_type === type);
  return action ? Number(action.value) : 0;
}

interface DrillDownBreadcrumb {
  level: 'account' | 'campaign' | 'adset' | 'ad';
  label: string;
  id?: string;
}

export default function MarketingAnalytics() {
  const { canEdit: canEditMarketing } = useModulePermissions('marketing_analytics');
  const [activeChannel, setActiveChannel] = useState('meta');
  const [datePreset, setDatePreset] = useState('last_30d');
  const [customRange, setCustomRange] = useState<{ since: string; until: string } | null>(null);
  const [level, setLevel] = useState<'account' | 'campaign' | 'adset' | 'ad'>('campaign');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedAdsetId, setSelectedAdsetId] = useState<string | null>(null);
  const [regeneratingDigest, setRegeneratingDigest] = useState(false);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [currentBrief, setCurrentBrief] = useState('');
  const [currentBriefError, setCurrentBriefError] = useState('');
  const [forecastHorizon, setForecastHorizon] = useState(14);
  const queryClient = useQueryClient();

  // Drill-down breadcrumb state
  const [breadcrumbs, setBreadcrumbs] = useState<DrillDownBreadcrumb[]>([
    { level: 'campaign', label: 'Campaigns' },
  ]);

  // Comparison mode
  const [comparisonMode, setComparisonMode] = useState(false);
  const [selectedForComparison, setSelectedForComparison] = useState<string[]>([]);

  // Build time range payload
  const timePayload = customRange
    ? { timeRange: customRange }
    : { datePreset };

  // Date label for display
  const dateLabel = customRange
    ? `${customRange.since} → ${customRange.until}`
    : DATE_PRESETS.find(p => p.value === datePreset)?.label || datePreset;

  // Fetch raw Meta Ads data
  const { data: adsData, isLoading: adsLoading, error: adsError, refetch: refetchAds, isFetching: adsFetching } = useQuery({
    queryKey: ['meta-ads', level, datePreset, customRange, selectedCampaignId, selectedAdsetId],
    queryFn: async () => {
      const payload: any = {
        level,
        ...timePayload,
        limit: 50,
      };
      if (selectedCampaignId && (level === 'adset' || level === 'ad')) {
        payload.campaignId = selectedCampaignId;
      }
      if (selectedAdsetId && level === 'ad') {
        payload.adsetId = selectedAdsetId;
      }
      const { data, error } = await invokeSecureFunction('fetch-meta-ads', payload);
      if (error) throw new Error(error.message);
      return data;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Analyze data when ads data is available
  const { data: analysisData, isLoading: analysisLoading, refetch: refetchAnalysis } = useQuery({
    queryKey: ['meta-ads-analysis', datePreset, customRange, adsData?.insights?.length],
    queryFn: async () => {
      if (!adsData?.insights || adsData.insights.length === 0) return null;
      const { data, error } = await invokeSecureFunction('analyze-meta-ads', {
        insights: adsData.insights,
        campaigns: adsData.campaigns,
        datePreset,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!adsData?.insights && adsData.insights.length > 0,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  // Phase 2: Budget Advisor + Audience Intelligence
  const { data: phase2Data, isLoading: phase2Loading } = useQuery({
    queryKey: ['meta-ads-phase2-budget', datePreset, customRange, adsData?.insights?.length],
    queryFn: async () => {
      if (!adsData?.insights || adsData.insights.length === 0) return null;
      const { data, error } = await invokeSecureFunction('analyze-meta-ads-phase2', {
        action: 'budget_advisor',
        insights: adsData.insights,
        campaigns: adsData.campaigns,
        datePreset,
        healthScores: analysisData?.healthScores,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!adsData?.insights && adsData.insights.length > 0,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  // Phase 2: Lead Quality Correlation
  const { data: leadQualityData, isLoading: leadQualityLoading } = useQuery({
    queryKey: ['meta-ads-phase2-leads', datePreset, customRange, adsData?.insights?.length],
    queryFn: async () => {
      if (!adsData?.insights) return null;
      const { data, error } = await invokeSecureFunction('analyze-meta-ads-phase2', {
        action: 'lead_quality',
        insights: adsData.insights,
        datePreset,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!adsData?.insights && adsData.insights.length > 0,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  // Phase 3: Forecasting
  const { data: forecastData, isLoading: forecastLoading } = useQuery({
    queryKey: ['meta-ads-phase3-forecast', datePreset, customRange, forecastHorizon, adsData?.insights?.length],
    queryFn: async () => {
      if (!adsData?.insights || adsData.insights.length === 0) return null;
      const { data, error } = await invokeSecureFunction('analyze-meta-ads-phase3', {
        action: 'forecast',
        insights: adsData.insights,
        horizonDays: forecastHorizon,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!adsData?.insights && adsData.insights.length > 0,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  // Phase 3: Past briefs list
  const { data: pastBriefsData, isLoading: pastBriefsLoading } = useQuery({
    queryKey: ['meta-ads-phase3-briefs'],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('analyze-meta-ads-phase3', {
        action: 'list_briefs',
        insights: [],
        limit: 10,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Phase 4: Industry Benchmarks
  const { data: benchmarkData, isLoading: benchmarkLoading } = useQuery({
    queryKey: ['meta-ads-phase4-benchmarks', datePreset, customRange, adsData?.insights?.length],
    queryFn: async () => {
      if (!adsData?.insights || adsData.insights.length === 0) return null;
      const t = { spend: 0, leads: 0, cpl: 0, ctr: 0, cpc: 0, impressions: 0, clicks: 0 };
      for (const row of adsData.insights) {
        t.spend += Number(row.spend || 0);
        t.impressions += Number(row.impressions || 0);
        t.clicks += Number(row.clicks || 0);
        if (row.actions) {
          const lead = row.actions.find((a: any) => a.action_type === 'lead');
          t.leads += lead ? Number(lead.value) : 0;
        }
      }
      t.ctr = t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0;
      t.cpc = t.clicks > 0 ? t.spend / t.clicks : 0;
      t.cpl = t.leads > 0 ? t.spend / t.leads : 0;

      const { data, error } = await invokeSecureFunction('analyze-meta-ads-phase4', {
        action: 'benchmarks',
        totals: t,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!adsData?.insights && adsData.insights.length > 0,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  // Phase 4: Market Correlation
  const { data: marketData, isLoading: marketLoading } = useQuery({
    queryKey: ['meta-ads-phase4-market', datePreset, customRange, adsData?.insights?.length],
    queryFn: async () => {
      const { data, error } = await invokeSecureFunction('analyze-meta-ads-phase4', {
        action: 'market_correlation',
        insights: adsData?.insights || [],
        datePreset,
      });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: !!adsData?.insights && adsData.insights.length > 0,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: 1,
  });

  const insights = adsData?.insights || [];
  const campaigns = adsData?.campaigns || [];
  const anomalies = analysisData?.anomalies || [];
  const healthScores = analysisData?.healthScores || [];
  const aiDigest = analysisData?.aiDigest || '';
  const aiDigestError = analysisData?.aiDigestError || '';
  const summary = analysisData?.summary || {};

  // Drill-down handler
  const handleDrillDown = useCallback((nextLevel: 'adset' | 'ad', id: string, label: string) => {
    if (nextLevel === 'adset') {
      setSelectedCampaignId(id);
      setSelectedAdsetId(null);
      setLevel('adset');
      setBreadcrumbs(prev => [
        ...prev,
        { level: 'adset', label, id },
      ]);
    } else if (nextLevel === 'ad') {
      setSelectedAdsetId(id);
      setLevel('ad');
      setBreadcrumbs(prev => [
        ...prev,
        { level: 'ad', label, id },
      ]);
    }
    // Clear comparison on drill
    setSelectedForComparison([]);
    setComparisonMode(false);
  }, []);

  // Breadcrumb click handler
  const handleBreadcrumbClick = useCallback((index: number) => {
    const crumb = breadcrumbs[index];
    setBreadcrumbs(breadcrumbs.slice(0, index + 1));
    setLevel(crumb.level);
    setSelectedForComparison([]);
    setComparisonMode(false);

    if (crumb.level === 'campaign') {
      setSelectedCampaignId(null);
      setSelectedAdsetId(null);
    } else if (crumb.level === 'adset') {
      setSelectedAdsetId(null);
    }
  }, [breadcrumbs]);

  // Level tab change
  const handleLevelChange = (newLevel: string) => {
    const l = newLevel as 'account' | 'campaign' | 'adset' | 'ad';
    if (l === 'account' || l === 'campaign') {
      setSelectedCampaignId(null);
      setSelectedAdsetId(null);
      setBreadcrumbs([{ level: l, label: l === 'account' ? 'Account' : 'Campaigns' }]);
    } else if (l === 'adset') {
      setSelectedAdsetId(null);
      setBreadcrumbs([{ level: 'campaign', label: 'Campaigns' }, { level: 'adset', label: 'All Ad Sets' }]);
    } else if (l === 'ad') {
      setBreadcrumbs([{ level: 'campaign', label: 'Campaigns' }, { level: 'ad', label: 'All Ads' }]);
    }
    setLevel(l);
    setSelectedForComparison([]);
    setComparisonMode(false);
  };

  // Comparison toggle
  const handleToggleComparison = useCallback((id: string) => {
    setSelectedForComparison(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 4) {
        toast.error('Maximum 4 items for comparison');
        return prev;
      }
      return [...prev, id];
    });
  }, []);

  // Totals
  const totals = insights.reduce((acc: any, row: any) => {
    acc.spend += Number(row.spend || 0);
    acc.impressions += Number(row.impressions || 0);
    acc.clicks += Number(row.clicks || 0);
    acc.reach += Number(row.reach || 0);
    acc.leads += extractAction(row.actions, 'lead');
    return acc;
  }, { spend: 0, impressions: 0, clicks: 0, reach: 0, leads: 0 });

  totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0;
  totals.cpl = totals.leads > 0 ? totals.spend / totals.leads : 0;

  const handleRefresh = useCallback(() => {
    refetchAds();
  }, [refetchAds]);

  const handleRegenerateDigest = useCallback(async () => {
    setRegeneratingDigest(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['meta-ads-analysis'] });
      await refetchAnalysis();
      toast.success('AI digest regenerated');
    } catch {
      toast.error('Failed to regenerate digest');
    } finally {
      setRegeneratingDigest(false);
    }
  }, [queryClient, refetchAnalysis]);

  const handleGenerateBrief = useCallback(async () => {
    if (!adsData?.insights || adsData.insights.length === 0) {
      toast.error('No data available to generate brief');
      return;
    }
    setGeneratingBrief(true);
    setCurrentBriefError('');
    try {
      const { data, error } = await invokeSecureFunction('analyze-meta-ads-phase3', {
        action: 'weekly_brief',
        insights: adsData.insights,
        campaigns: adsData.campaigns,
        datePreset,
        healthScores: analysisData?.healthScores,
        anomalies: analysisData?.anomalies,
        budgetRecommendations: phase2Data?.recommendations,
      });
      if (error) {
        setCurrentBriefError(error.message);
      } else {
        setCurrentBrief(data?.brief || '');
        if (data?.aiError) setCurrentBriefError(data.aiError);
        queryClient.invalidateQueries({ queryKey: ['meta-ads-phase3-briefs'] });
        toast.success('Weekly brief generated');
      }
    } catch (err: any) {
      setCurrentBriefError(err.message || 'Failed to generate brief');
      toast.error('Failed to generate brief');
    } finally {
      setGeneratingBrief(false);
    }
  }, [adsData, datePreset, analysisData, phase2Data, queryClient]);

  const isLoading = adsLoading;
  const isAnalyzing = analysisLoading;

  // Items selected for comparison
  const comparisonItems = insights.filter((row: any) => {
    const id = level === 'campaign' ? row.campaign_id : level === 'adset' ? row.adset_id : row.ad_id;
    return selectedForComparison.includes(id);
  });

  return (
    <DashboardThemeFrame
      as="main"
      variant="page"
      className="marketing-analytics-page space-y-5 pb-8 sm:space-y-6"
    >
      {/* Channel Tabs */}
      <DashboardThemeFrame
        as="header"
        variant="hero"
        className="relative isolate border-primary/20 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_32%),linear-gradient(135deg,hsl(var(--card)/0.94),hsl(var(--background)/0.84)_52%,hsl(var(--primary)/0.10))] p-4 shadow-2xl shadow-sm dark:shadow-black/10 dark:shadow-black/35 sm:p-5 lg:p-6"
      >
        <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative z-10 flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 shadow-inner shadow-primary/10 sm:h-14 sm:w-14">
              <Megaphone className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-full border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                  <Sparkles className="mr-1 h-3 w-3" />
                  Marketing Intelligence
                </Badge>
                <Badge variant="secondary" className="max-w-full rounded-full bg-background/60 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {dateLabel}
                </Badge>
              </div>
              <h1 className="truncate text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Marketing Analytics</h1>
              <p className="mt-1 text-sm text-muted-foreground">AI-powered marketing performance insights</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <LiveModelBadge agentKey="meta_ads_analysis" size="sm" showSlot />
                <LiveModelBadge agentKey="meta_ads_digest" size="sm" showSlot />
                <LiveModelBadge agentKey="meta_ads_forecast" size="sm" showSlot />
                <LiveModelBadge agentKey="meta_ads_lead_quality" size="sm" showSlot />
                <ModelUpgradeButton agentKey="meta_ads_analysis" />
              </div>

            </div>

          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
            <div className="rounded-2xl border border-border/60 bg-background/55 px-3 py-2 text-xs shadow-sm backdrop-blur dark:border-white/10">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Channels</p>
              <p className="mt-0.5 font-semibold text-foreground">Meta, ManyChat, Lead Magnets</p>
            </div>
            <div className="rounded-2xl border border-primary/20 bg-primary/10 px-3 py-2 text-xs shadow-sm backdrop-blur">
              <p className="text-[10px] font-medium uppercase tracking-wider text-primary">Focus</p>
              <p className="mt-0.5 font-semibold text-foreground">Spend → Leads → ROI</p>
            </div>
          </div>
        </div>
      </DashboardThemeFrame>

      {/* Cross-Channel Summary (visible before selecting a tab) */}
      {!isLoading && insights.length > 0 && (
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-card to-card shadow-lg shadow-sm dark:shadow-black/5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 dark:shadow-black/25">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Layers className="h-3.5 w-3.5" />
                <span className="text-[10px] font-medium uppercase tracking-wider">Active Channels</span>
              </div>
              <p className="text-xl font-bold text-foreground">2</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Meta Ads + ManyChat</p>
            </CardContent>
          </Card>
          <Card className="overflow-hidden border-border/70 bg-card/85 shadow-lg shadow-sm dark:shadow-black/5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 dark:border-white/10 dark:shadow-black/25">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <DollarSign className="h-3.5 w-3.5" />
                <span className="text-[10px] font-medium uppercase tracking-wider">Ad Spend</span>
              </div>
              <p className="text-xl font-bold text-foreground">{formatCurrency(totals.spend)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{dateLabel}</p>
            </CardContent>
          </Card>
          <Card className="overflow-hidden border-border/70 bg-card/85 shadow-lg shadow-sm dark:shadow-black/5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 dark:border-white/10 dark:shadow-black/25">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Target className="h-3.5 w-3.5" />
                <span className="text-[10px] font-medium uppercase tracking-wider">Total Leads</span>
              </div>
              <p className="text-xl font-bold text-primary">{formatNumber(totals.leads)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">From Meta Ads</p>
            </CardContent>
          </Card>
          <Card className="overflow-hidden border-border/70 bg-card/85 shadow-lg shadow-sm dark:shadow-black/5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/25 dark:border-white/10 dark:shadow-black/25">
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <TrendingUp className="h-3.5 w-3.5" />
                <span className="text-[10px] font-medium uppercase tracking-wider">Cost / Lead</span>
              </div>
              <p className="text-xl font-bold text-foreground">{totals.cpl > 0 ? formatCurrency(totals.cpl) : '—'}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Meta Ads avg</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs value={activeChannel} onValueChange={setActiveChannel} className="min-w-0">
        <DashboardThemeFrame variant="toolbar" className="overflow-x-auto overscroll-x-contain rounded-3xl border-primary/15 bg-[linear-gradient(135deg,hsl(var(--card)/0.92),hsl(var(--background)/0.72))] p-1.5 shadow-xl shadow-sm dark:shadow-black/5 [scrollbar-color:hsl(var(--primary)/0.35)_transparent] dark:shadow-black/25">
        <TabsList className="h-auto min-w-max flex-1 justify-start gap-1 bg-transparent p-0 sm:min-w-0 sm:flex-wrap">
          <TabsTrigger value="meta" className="min-h-10 gap-1.5 rounded-2xl px-3 text-muted-foreground transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-primary/15 sm:px-4">
            <Target className="h-4 w-4" />
            Meta Ads
            {!isLoading && insights.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 rounded-full px-1.5 py-0 text-[9px]">{insights.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="manychat" className="min-h-10 gap-1.5 rounded-2xl px-3 text-muted-foreground transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-primary/15 sm:px-4">
            <Bot className="h-4 w-4" />
            ManyChat
          </TabsTrigger>
          <TabsTrigger value="lead-magnets" className="min-h-10 gap-1.5 rounded-2xl px-3 text-muted-foreground transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg data-[state=active]:shadow-primary/15 sm:px-4">
            <FileDown className="h-4 w-4" />
            Lead Magnets
          </TabsTrigger>
        </TabsList>
        </DashboardThemeFrame>

        <TabsContent value="meta">
          <div className="space-y-6 mt-4">
      {/* Header */}
      <DashboardThemeFrame variant="toolbar" className="items-start justify-between gap-3 rounded-3xl border-primary/15 bg-card/70 p-3 shadow-xl shadow-sm dark:shadow-black/5 dark:shadow-black/20">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Analytics Range</p>
          <p className="mt-1 text-sm text-muted-foreground">Filter Meta Ads performance without changing metric calculations.</p>
        </div>
        <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row lg:items-center lg:justify-end">
          <DateRangePicker
            datePreset={datePreset}
            onDatePresetChange={setDatePreset}
            customRange={customRange}
            onCustomRangeChange={setCustomRange}
          />
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={adsFetching} className="min-h-10 gap-2 rounded-2xl border-primary/20 bg-background/60 px-4 font-semibold hover:border-primary/40 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background" aria-label="Refresh marketing analytics data">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${adsFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </DashboardThemeFrame>

      {/* Summary Badges */}
      {!isLoading && insights.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="rounded-full border-border/70 bg-background/60 px-2.5 py-1 text-xs">
            {insights.length} {level === 'campaign' ? 'Campaign' : level === 'adset' ? 'Ad Set' : 'Ad'}{insights.length !== 1 ? 's' : ''}
          </Badge>
          {summary.criticalAnomalies > 0 && (
            <Badge variant="destructive" className="rounded-full px-2.5 py-1 text-xs">
              {summary.criticalAnomalies} Critical Alert{summary.criticalAnomalies !== 1 ? 's' : ''}
            </Badge>
          )}
          {summary.warningAnomalies > 0 && (
            <Badge className="rounded-full border border-brand-500/30 bg-brand-500/15 px-2.5 py-1 text-xs text-brand-600 dark:text-brand-400">
              {summary.warningAnomalies} Warning{summary.warningAnomalies !== 1 ? 's' : ''}
            </Badge>
          )}
          {summary.avgHealthScore > 0 && (
            <Badge variant="outline" className={`rounded-full px-2.5 py-1 text-xs font-mono ${
              summary.avgHealthScore >= 60 ? 'border-success/30 bg-success/5 text-success dark:text-success' :
              summary.avgHealthScore >= 35 ? 'border-brand-500/30 bg-brand-500/5 text-brand-600 dark:text-brand-400' :
              'border-destructive/30 bg-destructive/5 text-destructive dark:text-destructive'
            }`}>
              Avg Health: {summary.avgHealthScore}/100
            </Badge>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <KPICard icon={<DollarSign className="h-4 w-4" />} label="Total Spend" value={formatCurrency(totals.spend)} loading={isLoading} />
        <KPICard icon={<Eye className="h-4 w-4" />} label="Impressions" value={formatNumber(totals.impressions)} loading={isLoading} />
        <KPICard icon={<MousePointerClick className="h-4 w-4" />} label="Clicks" value={formatNumber(totals.clicks)} loading={isLoading} />
        <KPICard icon={<TrendingUp className="h-4 w-4" />} label="CTR" value={formatPercent(totals.ctr)} loading={isLoading} />
        <KPICard icon={<Target className="h-4 w-4" />} label="Leads" value={formatNumber(totals.leads)} loading={isLoading} accent />
        <KPICard icon={<DollarSign className="h-4 w-4" />} label="Cost / Lead" value={totals.cpl > 0 ? formatCurrency(totals.cpl) : '—'} loading={isLoading} accent />
      </div>

      {/* AI Digest */}
      <AIDigestPanel
        digest={aiDigest}
        loading={isAnalyzing}
        error={aiDigestError}
        onRegenerate={handleRegenerateDigest}
        regenerating={regeneratingDigest}
      />

      {/* Anomalies + Health Side by Side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnomalyAlertsPanel anomalies={anomalies} loading={isAnalyzing} />
        <CampaignHealthPanel healthScores={healthScores} loading={isAnalyzing} />
      </div>

      {/* Budget Advisor */}
      <BudgetAdvisorPanel
        recommendations={phase2Data?.recommendations || []}
        aiAnalysis={phase2Data?.aiAnalysis || ''}
        aiError={phase2Data?.aiError}
        loading={phase2Loading}
        summary={phase2Data?.summary}
      />

      {/* Spend Pacing */}
      <SpendPacingPanel
        campaigns={campaigns}
        insights={insights}
        datePreset={datePreset}
        loading={isLoading}
      />

      {/* Lead Source Attribution */}
      <LeadAttributionPanel />

      {/* Creative Performance Gallery */}
      <CreativeGalleryPanel datePreset={datePreset} timeRange={customRange || undefined} />

      {/* Full-Funnel Visualization */}
      <FullFunnelPanel />

      {/* True ROI */}
      <TrueROIPanel insights={insights} datePreset={datePreset} />

      {/* Audience Intelligence + Lead Quality */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AudienceIntelligencePanel
          audienceInsights={phase2Data?.audienceInsights || []}
          loading={phase2Loading}
        />
        <LeadQualityPanel
          leadQuality={leadQualityData?.leadQuality || []}
          aiAnalysis={leadQualityData?.aiAnalysis || ''}
          loading={leadQualityLoading}
        />
      </div>

      {/* Performance Forecast */}
      <ForecastPanel
        forecast={forecastData?.forecast || []}
        trends={forecastData?.trends || null}
        projections={forecastData?.projections || null}
        aiAnalysis={forecastData?.aiAnalysis || ''}
        aiError={forecastData?.aiError}
        loading={forecastLoading}
        horizonDays={forecastHorizon}
        onHorizonChange={setForecastHorizon}
      />

      {/* Weekly AI Brief */}
      <WeeklyBriefPanel
        currentBrief={currentBrief}
        currentBriefError={currentBriefError}
        pastBriefs={pastBriefsData?.reports || []}
        loading={false}
        generating={generatingBrief}
        onGenerate={handleGenerateBrief}
        pastBriefsLoading={pastBriefsLoading}
      />

      {/* Period-over-Period Comparison */}
      <PeriodOverPeriodPanel />

      {/* Performance Explorer with Drill-Down */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <Tabs value={level} onValueChange={handleLevelChange}>
            <TabsList>
              <TabsTrigger value="account">Account</TabsTrigger>
              <TabsTrigger value="campaign">Campaigns</TabsTrigger>
              <TabsTrigger value="adset">Ad Sets</TabsTrigger>
              <TabsTrigger value="ad">Ads</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button
            variant={comparisonMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setComparisonMode(!comparisonMode);
              if (comparisonMode) setSelectedForComparison([]);
            }}
            className="gap-1.5"
          >
            <GitCompareArrows className="h-4 w-4" />
            {comparisonMode ? `Comparing (${selectedForComparison.length})` : 'Compare'}
          </Button>
        </div>

        <DrillDownExplorer
          level={level}
          insights={insights}
          campaigns={campaigns}
          healthScores={healthScores}
          loading={isLoading}
          error={adsError as Error | null}
          breadcrumbs={breadcrumbs}
          dateLabel={dateLabel}
          comparisonMode={comparisonMode}
          selectedForComparison={selectedForComparison}
          onDrillDown={handleDrillDown}
          onBreadcrumbClick={handleBreadcrumbClick}
          onRefetch={() => refetchAds()}
          onToggleComparison={handleToggleComparison}
          formatCurrency={formatCurrency}
          formatNumber={formatNumber}
          formatPercent={formatPercent}
          extractAction={extractAction}
        />

        {/* Comparison Panel */}
        {comparisonMode && selectedForComparison.length >= 2 && (
          <ComparisonPanel
            items={comparisonItems}
            level={level as 'campaign' | 'adset' | 'ad'}
            onRemoveItem={(id) => setSelectedForComparison(prev => prev.filter(x => x !== id))}
            onClear={() => {
              setSelectedForComparison([]);
              setComparisonMode(false);
            }}
            formatCurrency={formatCurrency}
            formatNumber={formatNumber}
            formatPercent={formatPercent}
            extractAction={extractAction}
          />
        )}
      </div>

      {/* Industry Benchmarks */}
      <BenchmarksPanel
        benchmarks={benchmarkData?.benchmarks || []}
        perplexityResearch={benchmarkData?.perplexityResearch || ''}
        citations={benchmarkData?.citations || []}
        aiAnalysis={benchmarkData?.aiAnalysis || ''}
        aiError={benchmarkData?.aiError}
        rawBenchmarks={benchmarkData?.rawBenchmarks}
        loading={benchmarkLoading}
      />

      {/* Market Correlation */}
      <MarketCorrelationPanel
        marketEvents={marketData?.marketEvents || []}
        perplexityResearch={marketData?.perplexityResearch || ''}
        citations={marketData?.citations || []}
        aiAnalysis={marketData?.aiAnalysis || ''}
        aiError={marketData?.aiError}
        loading={marketLoading}
      />

      {/* Report Distribution */}
      <ReportDistributionPanel />
          </div>
        </TabsContent>

        <TabsContent value="manychat">
          <div className="mt-4">
            <ManyChatPanel />
          </div>
        </TabsContent>

        <TabsContent value="lead-magnets">
          <div className="mt-4">
            <LeadMagnetsPanel />
          </div>
        </TabsContent>
      </Tabs>
    </DashboardThemeFrame>
  );
}

function KPICard({ icon, label, value, loading, accent }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading: boolean;
  accent?: boolean;
}) {
  return (
    <Card tabIndex={0} className={cn(
      'group min-w-0 overflow-hidden border-border/70 bg-card/90 shadow-lg shadow-sm dark:shadow-black/5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-xl hover:shadow-black/10 dark:border-white/10 dark:shadow-black/25',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      accent && 'border-primary/25 bg-primary/[0.04] ring-1 ring-primary/10'
    )}>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="mb-2 flex min-w-0 items-center gap-2 text-muted-foreground">
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/65 transition-colors group-hover:border-primary/30 group-hover:text-primary', accent && 'border-primary/20 bg-primary/10 text-primary')}>
            {icon}
          </span>
          <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wider">{label}</span>
        </div>
        {loading ? (
          <div className="mt-0.5 h-7 w-20 animate-pulse rounded-xl bg-muted" />
        ) : (
          <p className={`min-w-0 truncate text-2xl font-bold tracking-tight ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</p>
        )}
      </CardContent>
    </Card>
  );
}
