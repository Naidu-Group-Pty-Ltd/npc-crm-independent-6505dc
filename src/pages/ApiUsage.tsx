import { useState, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react';
import { invokeSecureFunction } from '@/lib/secureInvoke';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { MultiSelectFilter } from '@/components/api-usage/MultiSelectFilter';
import { BillingRecoveryTab } from '@/components/api-usage/BillingRecoveryTab';
import { DashboardThemeFrame } from '@/components/layout/DashboardThemeFrame';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  RefreshCw,
  Loader2,
  TrendingUp,
  TrendingDown,
  Server,
  AlertTriangle,
  Coins,
  Brain,
  Hash,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  DollarSign,
  CalendarDays,
  Mail,
  Database,
  X,
  Filter,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from 'recharts';

// Service colors using HSL tokens that align with the theme
const SERVICE_COLORS: Record<string, string> = {
  'abs-census': 'hsl(217, 91%, 60%)',
  'crime-statistics': 'hsl(0, 84%, 60%)',
  'public-transport': 'hsl(142, 71%, 45%)',
  'climate-data': 'hsl(45, 93%, 47%)',
  'domain-data': 'hsl(280, 67%, 55%)',
  'openai': 'hsl(171, 77%, 44%)',
  'perplexity': 'hsl(199, 89%, 48%)',
  'gemini': 'hsl(31, 97%, 55%)',
  'vapi': 'hsl(328, 73%, 56%)',
  'twilio': 'hsl(262, 83%, 58%)',
  'microsoft-graph': 'hsl(207, 90%, 54%)',
  'airtable': 'hsl(154, 60%, 50%)',
  'cloudflare': 'hsl(25, 95%, 53%)',
};

const getServiceColor = (service: string) =>
  SERVICE_COLORS[service] || `hsl(${Math.abs(service.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % 360}, 70%, 55%)`;

const formatServiceName = (name: string) =>
  name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

interface VapiData {
  totalCalls: number;
  totalMinutes: number;
  totalCost: number;
  inbound: number;
  outbound: number;
  avgCostPerCall: number;
  dailyTrend: Array<{ date: string; calls: number; minutes: number; cost: number }>;
}

interface ProjectionsData {
  dailyAvgCost: number;
  projectedMonthlyCost: number;
  projectedMonthlyVapi: number;
  serviceProjections: Array<{ service: string; currentCost: number; dailyAvg: number; projectedMonthly: number }>;
  totalProjectedMonthly: number;
}

interface ConsumptionData {
  summary: {
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
    activeServices: number;
  };
  breakdown: Array<{
    service: string;
    requests: number;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    topModel: string;
    models: Record<string, number>;
  }>;
  dailyConsumption: Array<Record<string, any>>;
  consumptionServices: string[];
  modelDistribution: Array<{ model: string; count: number }>;
  recentUsageLogs: Array<{
    id: string;
    service: string;
    endpoint: string;
    model: string;
    tokens: number;
    promptTokens: number;
    completionTokens: number;
    cost: number;
    status: string;
    createdAt: string;
    metadata: any;
  }>;
}

interface ApiUsageData {
  summary: {
    totalCalls: number;
    successCalls: number;
    errorCalls: number;
    successRate: number;
    avgResponseTime: number;
    activeServices: number;
    period: string;
  };
  serviceBreakdown: Array<{
    service: string;
    total: number;
    success: number;
    errors: number;
    successRate: number;
    avgResponseTime: number;
  }>;
  dailyVolume: Array<Record<string, any>>;
  dataQuality: Record<string, number>;
  services: string[];
  recentLogs: Array<{
    id: string;
    service: string;
    endpoint: string;
    status: string;
    responseTime: number;
    dataQuality: string;
    error: string | null;
    createdAt: string;
  }>;
  consumption?: ConsumptionData;
  vapi?: VapiData;
  projections?: ProjectionsData;
}


// API Usage UI scope lock: presentation-only enhancements. Data fetching, filters,
// calculations, status mappings, tabs, and refresh/date behaviour are preserved.
const API_USAGE_PAGE_FRAME =
  'min-h-[calc(100dvh-5rem)] min-w-0 space-y-4 overflow-x-clip px-1 pb-6 sm:space-y-6 sm:px-0';

const API_USAGE_HERO_FRAME =
  'flex min-w-0 flex-col gap-4 border-primary/20 bg-[radial-gradient(circle_at_top_left,hsl(var(--primary)/0.16),transparent_32%),linear-gradient(135deg,hsl(var(--card)/0.96),hsl(var(--background)/0.88)_58%,hsl(var(--primary)/0.08))] p-5 shadow-[0_22px_70px_rgba(15,23,42,0.12)] ring-1 ring-white/35 dark:ring-white/10 dark:shadow-black/35 sm:flex-row sm:items-start sm:justify-between sm:p-6';

const API_USAGE_METRIC_CARD =
  'min-h-full border-primary/15 motion-reduce:transition-none motion-reduce:hover:translate-y-0';

const API_USAGE_TAB_TRIGGER =
  'shrink-0 rounded-xl border border-transparent px-3 py-2 text-xs font-medium text-muted-foreground transition-all hover:border-primary/20 hover:bg-primary/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=active]:border-primary/30 data-[state=active]:bg-primary/15 data-[state=active]:text-primary data-[state=active]:shadow-sm motion-reduce:transition-none sm:px-4 sm:text-sm';


const API_USAGE_PANEL_CARD =
  'min-w-0 overflow-hidden border-border/60 bg-card/80 shadow-sm shadow-black/5 backdrop-blur-sm dark:border-white/10 dark:bg-card/70 dark:shadow-black/20';

const API_USAGE_CHART_HEIGHT =
  'min-h-0 min-w-0 overflow-hidden h-[280px] sm:h-[320px]';

const API_USAGE_TABLE_SCROLL =
  'min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-width:thin] [scrollbar-color:hsl(var(--primary)/0.35)_transparent]';

const API_USAGE_TALL_CHART_HEIGHT =
  'min-h-0 min-w-0 overflow-hidden h-[320px] sm:h-[380px]';

const API_USAGE_CHART_TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '12px',
  boxShadow: '0 14px 40px hsl(var(--foreground) / 0.10)',
  color: 'hsl(var(--foreground))',
  fontSize: '12px',
};

const API_USAGE_CHART_LABEL_STYLE: CSSProperties = {
  color: 'hsl(var(--foreground))',
};

interface ApiUsageMetricCardProps {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  caption: ReactNode;
  className?: string;
}

function ApiUsageMetricCard({ icon, label, value, caption, className = '' }: ApiUsageMetricCardProps) {
  return (
    <DashboardThemeFrame variant="premiumCard" className={`${API_USAGE_METRIC_CARD} ${className}`}>
      <div className="flex h-full min-w-0 flex-col justify-between p-4">
        <div className="mb-3 flex min-w-0 items-center gap-2 text-muted-foreground">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 shadow-inner">
            {icon}
          </span>
          <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.16em]">{label}</span>
        </div>
        <p className="min-w-0 truncate text-xl font-bold tracking-tight text-foreground tabular-nums">{value}</p>
        <p className="mt-1 min-w-0 truncate text-[10px] text-muted-foreground">{caption}</p>
      </div>
    </DashboardThemeFrame>
  );
}


interface ApiUsageStatusBadgeProps {
  status: string;
}

function ApiUsageStatusBadge({ status }: ApiUsageStatusBadgeProps) {
  const isSuccess = status === 'success';

  return isSuccess ? (
    <Badge variant="outline" className="border-success/30 bg-success/10 text-[10px] text-success">
      <CheckCircle2 className="h-3 w-3 mr-1" /> OK
    </Badge>
  ) : (
    <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-[10px] text-destructive">
      <XCircle className="h-3 w-3 mr-1" /> Error
    </Badge>
  );
}

interface ApiUsageEmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
}

function ApiUsageEmptyState({ icon, title, description }: ApiUsageEmptyStateProps) {
  return (
    <DashboardThemeFrame variant="section" className="flex min-h-[18rem] min-w-0 items-center justify-center p-6 text-center sm:p-8">
      <div className="mx-auto max-w-md min-w-0 text-muted-foreground">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary shadow-inner motion-safe:transition-transform motion-safe:duration-200 group-hover:scale-[1.02]">
          {icon}
        </div>
        <p className="text-lg font-semibold text-foreground">{title}</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </DashboardThemeFrame>
  );
}


interface ApiUsageTabHeaderProps {
  icon: ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}

function ApiUsageTabHeader({ icon, eyebrow, title, description, children }: ApiUsageTabHeaderProps) {
  return (
    <DashboardThemeFrame variant="sectionAccent" className="flex min-w-0 flex-col gap-4 border-primary/20 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-inner">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">{eyebrow}</p>
          <h2 className="mt-1 break-words text-lg font-semibold tracking-tight text-foreground sm:text-xl">{title}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
      {children && <div className="flex min-w-0 flex-wrap gap-2 sm:justify-end">{children}</div>}
    </DashboardThemeFrame>
  );
}

interface ApiUsageInsightTileProps {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  icon: ReactNode;
}

function ApiUsageInsightTile({ label, value, detail, icon }: ApiUsageInsightTileProps) {
  return (
    <DashboardThemeFrame variant="card" className="min-w-0 p-4 transition-colors hover:border-primary/20 motion-reduce:transition-none">
      <div className="mb-3 flex min-w-0 items-center gap-2 text-muted-foreground">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{icon}</span>
        <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.16em]">{label}</span>
      </div>
      <p className="min-w-0 truncate text-2xl font-bold tracking-tight text-foreground tabular-nums">{value}</p>
      <p className="mt-1 min-w-0 truncate text-xs text-muted-foreground">{detail}</p>
    </DashboardThemeFrame>
  );
}

const BUDGET_LIMITS: Record<string, number> = {
  openai: 50,
  perplexity: 30,
  gemini: 20,
  vapi: 100,
  'microsoft-graph': 0,
  airtable: 0,
};

export default function ApiUsage() {
  const [data, setData] = useState<ApiUsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [timeRange, setTimeRange] = useState('30');
  const [activeTab, setActiveTab] = useState('overview');
  
  // Multi-select filter state (empty array = all selected)
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);

  const fetchData = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const { data: result, error } = await invokeSecureFunction('get-api-usage-stats', {
        mode: 'overview',
        days: parseInt(timeRange),
      });
      if (error) throw new Error(error.message);
      if (result?.success) setData(result);
    } catch (err) {
      console.error('Failed to load API usage stats:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, [timeRange]);

  // ========== Filter Options ==========
  const serviceFilterOptions = useMemo(() => {
    if (!data) return [];
    const allServices = new Set<string>();
    data.services.forEach(s => allServices.add(s));
    data.consumption?.consumptionServices.forEach(s => allServices.add(s));
    data.consumption?.breakdown.forEach(b => allServices.add(b.service));
    return [...allServices].sort().map(s => ({
      value: s,
      label: formatServiceName(s),
      color: getServiceColor(s),
      count: data.serviceBreakdown.find(b => b.service === s)?.total || 
             data.consumption?.breakdown.find(b => b.service === s)?.requests || 0,
    }));
  }, [data]);

  const modelFilterOptions = useMemo(() => {
    if (!data?.consumption) return [];
    return data.consumption.modelDistribution.map(m => ({
      value: m.model,
      label: m.model,
      count: m.count,
    }));
  }, [data]);

  const statusFilterOptions = useMemo(() => [
    { value: 'success', label: 'Success', color: 'hsl(142, 71%, 45%)' },
    { value: 'error', label: 'Error', color: 'hsl(0, 84%, 60%)' },
  ], []);

  // ========== Filtered data helpers ==========
  const filteredHealthServices = useMemo(() => {
    if (!data) return [];
    if (selectedServices.length === 0) return data.services;
    return data.services.filter(s => selectedServices.includes(s));
  }, [data, selectedServices]);

  const filteredConsumptionServices = useMemo(() => {
    if (!data?.consumption) return [];
    if (selectedServices.length === 0) return data.consumption.consumptionServices;
    return data.consumption.consumptionServices.filter(s => selectedServices.includes(s));
  }, [data, selectedServices]);

  // ========== Health chart data (filtered) ==========
  const volumeChartData = useMemo(() => {
    if (!data) return [];
    return data.dailyVolume.map(entry => {
      const row: Record<string, any> = { date: entry.date };
      for (const svc of filteredHealthServices) {
        row[svc] = entry[svc] || 0;
      }
      return row;
    });
  }, [data, filteredHealthServices]);

  const responseTimeData = useMemo(() => {
    if (!data) return [];
    return data.dailyVolume.map(entry => {
      const row: Record<string, any> = { date: entry.date };
      for (const svc of filteredHealthServices) {
        row[svc] = entry[`${svc}_avgTime`] || 0;
      }
      return row;
    });
  }, [data, filteredHealthServices]);

  const successErrorData = useMemo(() => {
    if (!data) return [];
    return data.dailyVolume.map(entry => {
      let totalSuccess = 0;
      let totalErrors = 0;
      for (const svc of filteredHealthServices) {
        totalSuccess += entry[`${svc}_success`] || 0;
        totalErrors += entry[`${svc}_errors`] || 0;
      }
      return { date: entry.date, success: totalSuccess, errors: totalErrors };
    });
  }, [data, filteredHealthServices]);

  const donutData = useMemo(() => {
    if (!data) return [];
    return data.serviceBreakdown
      .filter(s => selectedServices.length === 0 || selectedServices.includes(s.service))
      .sort((a, b) => b.total - a.total)
      .map(s => ({ name: formatServiceName(s.service), value: s.total, service: s.service }));
  }, [data, selectedServices]);

  const qualityData = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.dataQuality).map(([key, value]) => ({
      name: key.charAt(0).toUpperCase() + key.slice(1),
      value,
    }));
  }, [data]);

  // ========== Consumption chart data (filtered) ==========
  const tokenChartData = useMemo(() => {
    if (!data?.consumption) return [];
    return data.consumption.dailyConsumption.map(entry => {
      const row: Record<string, any> = { date: entry.date };
      for (const svc of filteredConsumptionServices) {
        row[svc] = entry[`${svc}_tokens`] || 0;
      }
      return row;
    });
  }, [data, filteredConsumptionServices]);

  const costChartData = useMemo(() => {
    if (!data?.consumption) return [];
    return data.consumption.dailyConsumption.map(entry => {
      let dayCost = 0;
      if (selectedServices.length === 0) {
        dayCost = entry.totalCost || 0;
      } else {
        for (const svc of filteredConsumptionServices) {
          dayCost += entry[`${svc}_cost`] || 0;
        }
      }
      return { date: entry.date, cost: Math.round(dayCost * 10000) / 10000 };
    });
  }, [data, filteredConsumptionServices, selectedServices]);

  const modelDonutData = useMemo(() => {
    if (!data?.consumption) return [];
    return data.consumption.modelDistribution
      .filter(m => selectedModels.length === 0 || selectedModels.includes(m.model))
      .map(m => ({
        name: m.model,
        value: m.count,
      }));
  }, [data, selectedModels]);

  const filteredConsumptionBreakdown = useMemo(() => {
    if (!data?.consumption) return [];
    return data.consumption.breakdown
      .filter(b => selectedServices.length === 0 || selectedServices.includes(b.service))
      .sort((a, b) => b.tokens - a.tokens);
  }, [data, selectedServices]);

  const filteredUsageLogs = useMemo(() => {
    if (!data?.consumption) return [];
    return data.consumption.recentUsageLogs.filter(log => {
      const serviceMatch = selectedServices.length === 0 || selectedServices.includes(log.service);
      const modelMatch = selectedModels.length === 0 || (log.model && selectedModels.includes(log.model));
      const statusMatch = selectedStatuses.length === 0 || selectedStatuses.includes(log.status);
      return serviceMatch && modelMatch && statusMatch;
    });
  }, [data, selectedServices, selectedModels, selectedStatuses]);

  const filteredHealthLogs = useMemo(() => {
    if (!data) return [];
    return data.recentLogs.filter(log => {
      const serviceMatch = selectedServices.length === 0 || selectedServices.includes(log.service);
      const statusMatch = selectedStatuses.length === 0 || selectedStatuses.includes(log.status);
      return serviceMatch && statusMatch;
    });
  }, [data, selectedServices, selectedStatuses]);

  const filteredServiceBreakdown = useMemo(() => {
    if (!data) return [];
    return data.serviceBreakdown
      .filter(s => selectedServices.length === 0 || selectedServices.includes(s.service))
      .sort((a, b) => b.total - a.total);
  }, [data, selectedServices]);

  // Compute combined total cost for header
  const totalCombinedCost = useMemo(() => {
    if (!data) return 0;
    const apiCost = data.consumption?.summary.totalCost || 0;
    const vapiCost = data.vapi?.totalCost || 0;
    return Math.round((apiCost + vapiCost) * 100) / 100;
  }, [data]);

  const MODEL_COLORS = [
    'hsl(171, 77%, 44%)', 'hsl(199, 89%, 48%)', 'hsl(31, 97%, 55%)',
    'hsl(328, 73%, 56%)', 'hsl(262, 83%, 58%)', 'hsl(142, 71%, 45%)',
    'hsl(45, 93%, 47%)', 'hsl(0, 84%, 60%)',
  ];
  const QUALITY_COLORS = ['hsl(142, 71%, 45%)', 'hsl(45, 93%, 47%)', 'hsl(0, 84%, 60%)', 'hsl(217, 91%, 60%)'];


  if (loading) {
    return (
      <DashboardThemeFrame variant="page" className={API_USAGE_PAGE_FRAME}>
        <DashboardThemeFrame as="header" variant="hero" className={API_USAGE_HERO_FRAME}>
          <div className="min-w-0 space-y-3">
            <Skeleton className="h-8 w-56 rounded-xl" />
            <Skeleton className="h-4 w-full max-w-xl rounded-xl" />
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            <Skeleton className="h-10 w-[130px] rounded-xl" />
            <Skeleton className="h-10 w-28 rounded-xl" />
          </div>
        </DashboardThemeFrame>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <Card key={i} className={API_USAGE_METRIC_CARD}>
              <CardContent className="p-4"><Skeleton className="h-20 rounded-xl" /></CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <DashboardThemeFrame key={i} variant="chartCard" className="p-4 sm:p-6"><Skeleton className="h-64 rounded-xl" /></DashboardThemeFrame>
          ))}
        </div>
      </DashboardThemeFrame>
    );
  }

  return (
    <DashboardThemeFrame variant="page" className={API_USAGE_PAGE_FRAME}>
      {/* Header */}
      <DashboardThemeFrame as="header" variant="hero" className={API_USAGE_HERO_FRAME}>
        <div className="min-w-0">
          <h1 className="break-words text-2xl sm:text-3xl font-bold text-foreground tracking-tight">API Usage & Costs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor health, tokens, VAPI calls, and projected costs across all integrations
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 self-start sm:justify-end">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger aria-label="Select API usage date range" className="min-h-[40px] w-[130px] border-primary/20 bg-background/80 shadow-sm transition-colors hover:bg-primary/5 focus:ring-primary/40 motion-reduce:transition-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-[min(22rem,var(--radix-select-content-available-height))] border-border/80 bg-popover/95 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-popover/85">
              <SelectItem value="1">Last 24h</SelectItem>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => fetchData(true)} disabled={refreshing} aria-label="Refresh API usage data" className="min-h-[40px] gap-2 border-primary/25 bg-primary/10 text-primary shadow-sm transition-colors hover:bg-primary/15 hover:text-primary focus-visible:ring-primary/50 motion-reduce:transition-none">
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </DashboardThemeFrame>

      {/* Multi-Select Filters */}
      {data && (
        <DashboardThemeFrame variant="toolbar" className="min-w-0 flex-wrap border-primary/10 bg-card/70 shadow-[0_12px_36px_rgba(15,23,42,0.06)] dark:bg-background/35">
          <span className="mr-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"><Filter className="h-3.5 w-3.5" />Filters:</span>
          <MultiSelectFilter
            label="Services"
            options={serviceFilterOptions}
            selected={selectedServices}
            onChange={setSelectedServices}
            icon={<Server className="h-3.5 w-3.5" />}
          />
          {modelFilterOptions.length > 0 && (
            <MultiSelectFilter
              label="Models"
              options={modelFilterOptions}
              selected={selectedModels}
              onChange={setSelectedModels}
              icon={<Brain className="h-3.5 w-3.5" />}
            />
          )}
          <MultiSelectFilter
            label="Status"
            options={statusFilterOptions}
            selected={selectedStatuses}
            onChange={setSelectedStatuses}
            icon={<Activity className="h-3.5 w-3.5" />}
          />
          {(selectedServices.length > 0 || selectedModels.length > 0 || selectedStatuses.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSelectedServices([]); setSelectedModels([]); setSelectedStatuses([]); }}
              className="h-9 gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-primary/40"
            >
              <X className="h-3 w-3" /> Clear all
            </Button>
          )}
        </DashboardThemeFrame>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
          <ApiUsageMetricCard
            icon={<Zap className="h-4 w-4 text-primary" />}
            label="API Calls"
            value={data.summary.totalCalls.toLocaleString('en-AU')}
            caption={`${data.summary.successRate}% success`}
          />
          <ApiUsageMetricCard
            icon={<Phone className="h-4 w-4 text-accent" />}
            label="VAPI Calls"
            value={data.vapi?.totalCalls || 0}
            caption={`${data.vapi?.totalMinutes || 0} min`}
          />
          <ApiUsageMetricCard
            icon={<Hash className="h-4 w-4 text-primary" />}
            label="LLM Tokens"
            value={data.consumption ? (data.consumption.summary.totalTokens / 1000).toFixed(1) + 'k' : '—'}
            caption={data.consumption ? `${data.consumption.summary.totalRequests} calls` : 'No data'}
          />
          <ApiUsageMetricCard
            icon={<DollarSign className="h-4 w-4 text-success" />}
            label="Total Spend"
            value={`$${totalCombinedCost.toFixed(2)}`}
            caption={data.summary.period}
          />
          <ApiUsageMetricCard
            icon={<CalendarDays className="h-4 w-4 text-warning" />}
            label="Projected /mo"
            value={`$${data.projections?.totalProjectedMonthly?.toFixed(2) || '0.00'}`}
            caption={`Based on ${data.summary.period} avg`}
            className="col-span-2 sm:col-span-1"
          />
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0">
        <DashboardThemeFrame variant="toolbar" className={`${API_USAGE_TABLE_SCROLL} border-primary/15 bg-card/75 p-1.5 shadow-[0_14px_40px_rgba(15,23,42,0.08)] dark:bg-background/45 dark:shadow-black/25`}>
          <TabsList aria-label="API usage sections" className="inline-flex h-auto w-auto min-w-max gap-1 bg-transparent p-0">
            <TabsTrigger value="overview" className={API_USAGE_TAB_TRIGGER}>Overview</TabsTrigger>
            <TabsTrigger value="consumption" className={API_USAGE_TAB_TRIGGER}>LLM Costs</TabsTrigger>
            <TabsTrigger value="vapi" className={API_USAGE_TAB_TRIGGER}>VAPI & Voice</TabsTrigger>
            <TabsTrigger value="budget" className={API_USAGE_TAB_TRIGGER}>Budget</TabsTrigger>
            <TabsTrigger value="performance" className={API_USAGE_TAB_TRIGGER}>Performance</TabsTrigger>
            <TabsTrigger value="services" className={API_USAGE_TAB_TRIGGER}>Services</TabsTrigger>
            <TabsTrigger value="billing" className={API_USAGE_TAB_TRIGGER}>Key Billing</TabsTrigger>
            <TabsTrigger value="logs" className={API_USAGE_TAB_TRIGGER}>Logs</TabsTrigger>
          </TabsList>
        </DashboardThemeFrame>

        {/* ==================== Overview Tab ==================== */}
        <TabsContent value="overview" className="mt-4 min-w-0 space-y-4">
          {data && (
            <>
              <ApiUsageTabHeader
                icon={<Activity className="h-5 w-5" />}
                eyebrow="Executive snapshot"
                title="API operations overview"
                description="A consolidated operational view of live API calls, service health, LLM usage, VAPI activity, projected spend, and recent telemetry for the selected date range."
              >
                <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">{data.summary.period}</Badge>
                <Badge variant="outline" className="border-border/60 bg-background/60 text-muted-foreground">{filteredHealthServices.length} services in view</Badge>
              </ApiUsageTabHeader>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <ApiUsageInsightTile
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  label="Reliability"
                  value={`${data.summary.successRate}%`}
                  detail={`${data.summary.successCalls.toLocaleString('en-AU')} successful / ${data.summary.errorCalls.toLocaleString('en-AU')} errors`}
                />
                <ApiUsageInsightTile
                  icon={<Clock className="h-4 w-4" />}
                  label="Response time"
                  value={`${data.summary.avgResponseTime}ms`}
                  detail="Average response across tracked calls"
                />
                <ApiUsageInsightTile
                  icon={<Brain className="h-4 w-4" />}
                  label="LLM usage"
                  value={data.consumption ? (data.consumption.summary.totalTokens / 1000).toFixed(1) + 'k' : '—'}
                  detail={data.consumption ? `${data.consumption.summary.totalRequests} calls tracked` : 'No consumption data'}
                />
                <ApiUsageInsightTile
                  icon={<DollarSign className="h-4 w-4" />}
                  label="Projected monthly"
                  value={`$${data.projections?.totalProjectedMonthly?.toFixed(2) || '0.00'}`}
                  detail={`Based on ${data.summary.period} average`}
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Call Volume Area Chart */}
              <Card className={API_USAGE_PANEL_CARD}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    Call Volume Over Time
                  </CardTitle>
                  <CardDescription className="text-xs">Daily API calls per service</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className={API_USAGE_CHART_HEIGHT}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={volumeChartData}>
                        <defs>
                          {filteredHealthServices.map(svc => (
                            <linearGradient key={svc} id={`gradient-${svc}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={getServiceColor(svc)} stopOpacity={0.3} />
                              <stop offset="95%" stopColor={getServiceColor(svc)} stopOpacity={0} />
                            </linearGradient>
                          ))}
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => v.slice(5)} />
                        <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                        <Tooltip contentStyle={API_USAGE_CHART_TOOLTIP_STYLE} labelStyle={API_USAGE_CHART_LABEL_STYLE} />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        {filteredHealthServices.map(svc => (
                          <Area key={svc} type="monotone" dataKey={svc} name={formatServiceName(svc)} stackId="1" stroke={getServiceColor(svc)} fill={`url(#gradient-${svc})`} strokeWidth={2} />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Success vs Errors */}
              <Card className={API_USAGE_PANEL_CARD}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    Success vs Errors
                  </CardTitle>
                  <CardDescription className="text-xs">Daily success and failure breakdown</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className={API_USAGE_CHART_HEIGHT}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={successErrorData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => v.slice(5)} />
                        <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                        <Tooltip contentStyle={API_USAGE_CHART_TOOLTIP_STYLE} labelStyle={API_USAGE_CHART_LABEL_STYLE} />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        <Bar dataKey="success" name="Success" fill="hsl(142, 71%, 45%)" radius={[4, 4, 0, 0]} stackId="a" />
                        <Bar dataKey="errors" name="Errors" fill="hsl(0, 84%, 60%)" radius={[4, 4, 0, 0]} stackId="a" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Usage Distribution Donut */}
              <Card className={API_USAGE_PANEL_CARD}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Server className="h-4 w-4 text-primary" />
                    Usage Distribution
                  </CardTitle>
                  <CardDescription className="text-xs">Proportional usage by service</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className={API_USAGE_CHART_HEIGHT}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={donutData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3} dataKey="value" label={({ name, percent }: any) => `${name} ${((percent || 0) * 100).toFixed(0)}%`} labelLine={{ stroke: 'hsl(var(--muted-foreground))' }}>
                          {donutData.map((entry) => (<Cell key={entry.service} fill={getServiceColor(entry.service)} />))}
                        </Pie>
                        <Tooltip contentStyle={API_USAGE_CHART_TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Data Quality */}
              <Card className={API_USAGE_PANEL_CARD}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    Data Quality Breakdown
                  </CardTitle>
                  <CardDescription className="text-xs">Live vs estimated data across calls</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className={API_USAGE_CHART_HEIGHT}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={qualityData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3} dataKey="value" label={({ name, percent }: any) => `${name} ${((percent || 0) * 100).toFixed(0)}%`} labelLine={{ stroke: 'hsl(var(--muted-foreground))' }}>
                          {qualityData.map((_, idx) => (<Cell key={idx} fill={QUALITY_COLORS[idx % QUALITY_COLORS.length]} />))}
                        </Pie>
                        <Tooltip contentStyle={API_USAGE_CHART_TOOLTIP_STYLE} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              </div>
            </>
          )}
        </TabsContent>

        {/* ==================== LLM Costs Tab ==================== */}
        <TabsContent value="consumption" className="mt-4 min-w-0 space-y-4">
          {data?.consumption && (
            <>
              <ApiUsageTabHeader
                icon={<Brain className="h-5 w-5" />}
                eyebrow="LLM consumption"
                title="Token and provider cost workspace"
                description="Track existing LLM request volume, token consumption, model distribution, and estimated spend without changing token accounting or cost calculations."
              >
                <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">{data.summary.period}</Badge>
                <Badge variant="outline" className="border-border/60 bg-background/60 text-muted-foreground">{filteredConsumptionServices.length} LLM services</Badge>
              </ApiUsageTabHeader>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <ApiUsageMetricCard
                  icon={<Activity className="h-4 w-4 text-primary" />}
                  label="LLM Requests"
                  value={data.consumption.summary.totalRequests.toLocaleString('en-AU')}
                  caption="Tracked API calls"
                />
                <ApiUsageMetricCard
                  icon={<Hash className="h-4 w-4 text-primary" />}
                  label="Total Tokens"
                  value={(data.consumption.summary.totalTokens / 1000).toFixed(1) + 'k'}
                  caption="Prompt + completion"
                />
                <ApiUsageMetricCard
                  icon={<Coins className="h-4 w-4 text-primary" />}
                  label="LLM Cost"
                  value={`$${data.consumption.summary.totalCost.toFixed(4)}`}
                  caption="Existing estimate"
                />
                <ApiUsageMetricCard
                  icon={<Server className="h-4 w-4 text-primary" />}
                  label="Active Services"
                  value={data.consumption.summary.activeServices}
                  caption="Consumption sources"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Token Usage Stacked Area */}
              <Card className={`${API_USAGE_PANEL_CARD} lg:col-span-2`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Brain className="h-4 w-4 text-primary" />
                    Token Consumption Over Time
                  </CardTitle>
                  <CardDescription className="text-xs">Daily token usage per service (stacked)</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className={API_USAGE_TALL_CHART_HEIGHT}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={tokenChartData}>
                        <defs>
                          {filteredConsumptionServices.map(svc => (
                            <linearGradient key={svc} id={`tok-gradient-${svc}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={getServiceColor(svc)} stopOpacity={0.4} />
                              <stop offset="95%" stopColor={getServiceColor(svc)} stopOpacity={0} />
                            </linearGradient>
                          ))}
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => v.slice(5)} />
                        <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                        <Tooltip contentStyle={API_USAGE_CHART_TOOLTIP_STYLE} labelStyle={API_USAGE_CHART_LABEL_STYLE} />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        {filteredConsumptionServices.map(svc => (
                          <Area key={svc} type="monotone" dataKey={svc} name={formatServiceName(svc)} stackId="1" stroke={getServiceColor(svc)} fill={`url(#tok-gradient-${svc})`} strokeWidth={2} />
                        ))}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Cost Trend */}
              <Card className={API_USAGE_PANEL_CARD}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Coins className="h-4 w-4 text-primary" />
                    Estimated Cost Trend
                  </CardTitle>
                  <CardDescription className="text-xs">Daily estimated LLM spend (USD)</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className={API_USAGE_CHART_HEIGHT}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={costChartData}>
                        <defs>
                          <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => v.slice(5)} />
                        <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => `$${v}`} />
                        <Tooltip contentStyle={API_USAGE_CHART_TOOLTIP_STYLE} formatter={(v: any) => [`$${Number(v).toFixed(4)}`, 'Cost']} />
                        <Area type="monotone" dataKey="cost" stroke="hsl(142, 71%, 45%)" fill="url(#costGradient)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* Model Distribution Donut */}
              <Card className={API_USAGE_PANEL_CARD}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Brain className="h-4 w-4 text-primary" />
                    Model Distribution
                  </CardTitle>
                  <CardDescription className="text-xs">Which AI models are used most</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className={API_USAGE_CHART_HEIGHT}>
                    {modelDonutData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={modelDonutData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3} dataKey="value" label={({ name, percent }: any) => `${name} ${((percent || 0) * 100).toFixed(0)}%`} labelLine={{ stroke: 'hsl(var(--muted-foreground))' }}>
                            {modelDonutData.map((_, idx) => (<Cell key={idx} fill={MODEL_COLORS[idx % MODEL_COLORS.length]} />))}
                          </Pie>
                          <Tooltip contentStyle={API_USAGE_CHART_TOOLTIP_STYLE} />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">No model data yet</div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Service Consumption Cards */}
              <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredConsumptionBreakdown
                  .map(svc => (
                    <Card key={svc.service} className={API_USAGE_PANEL_CARD}>
                      <CardContent className="p-4">
                        <div className="flex min-w-0 items-center justify-between gap-3 mb-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="w-3 h-3 shrink-0 rounded-full" style={{ backgroundColor: getServiceColor(svc.service) }} />
                            <span className="min-w-0 truncate text-sm font-medium text-foreground" title={formatServiceName(svc.service)}>{formatServiceName(svc.service)}</span>
                          </div>
                          <Badge variant="secondary" className="text-[10px]">{svc.topModel}</Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <p className="text-lg font-bold text-foreground">{svc.requests}</p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Requests</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-foreground">{(svc.tokens / 1000).toFixed(1)}k</p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Tokens</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-foreground">${svc.cost.toFixed(3)}</p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Cost</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                {filteredConsumptionBreakdown.length === 0 && (
                  <div className="lg:col-span-3 p-8 text-center text-muted-foreground text-sm">
                    No consumption data logged yet.
                  </div>
                )}
              </div>

              {/* Recent Usage Logs */}
              <Card className={`${API_USAGE_PANEL_CARD} lg:col-span-2`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" />
                    Recent LLM Calls
                  </CardTitle>
                  <CardDescription className="text-xs">Last 50 external API consumption entries</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className={API_USAGE_TABLE_SCROLL}>
                    <table className="w-full min-w-[720px] table-fixed text-sm">
                      <thead>
                        <tr className="border-b border-border/50">
                          <th className="w-[24%] p-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Service</th>
                          <th className="hidden w-[24%] p-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground sm:table-cell">Model</th>
                          <th className="w-[13%] p-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Tokens</th>
                          <th className="hidden w-[13%] p-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground md:table-cell">Cost</th>
                          <th className="w-[12%] p-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                          <th className="w-[14%] p-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsageLogs.map(log => (
                          <tr key={log.id} className="border-b border-border/30 transition-colors hover:bg-muted/30 motion-reduce:transition-none">
                            <td className="min-w-0 p-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <div className="w-2 h-2 flex-shrink-0 rounded-full" style={{ backgroundColor: getServiceColor(log.service) }} />
                                <span className="min-w-0 truncate text-xs text-foreground sm:text-sm" title={formatServiceName(log.service)}>{formatServiceName(log.service)}</span>
                              </div>
                            </td>
                            <td className="hidden min-w-0 truncate p-3 font-mono text-xs text-muted-foreground sm:table-cell" title={log.model || '—'}>{log.model || '—'}</td>
                            <td className="p-3 text-xs font-medium text-foreground tabular-nums">{(log.tokens || 0).toLocaleString('en-AU')}</td>
                            <td className="hidden p-3 text-xs text-muted-foreground tabular-nums md:table-cell">{log.cost ? `$${log.cost.toFixed(4)}` : '—'}</td>
                            <td className="p-3">
                              <ApiUsageStatusBadge status={log.status} />
                            </td>
                            <td className="p-3 text-muted-foreground text-xs whitespace-nowrap">
                              {new Date(log.createdAt).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })}{' '}
                              <span className="hidden sm:inline">{new Date(log.createdAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filteredUsageLogs.length === 0 && (
                    <div className="p-8 text-center text-muted-foreground text-sm">
                      No LLM usage logged yet.
                    </div>
                  )}
                </CardContent>
              </Card>
              </div>
            </>
          )}
          {!data?.consumption && (
            <ApiUsageEmptyState
              icon={<Brain className="h-7 w-7" />}
              title="No consumption data available"
              description="Token and cost tracking will populate as API calls are made."
            />
          )}
        </TabsContent>

        {/* ==================== VAPI & Voice Tab (NEW) ==================== */}
        <TabsContent value="vapi" className="mt-4 min-w-0 space-y-4">
          {data?.vapi && data.vapi.totalCalls > 0 ? (
            <>
              <ApiUsageTabHeader
                icon={<Phone className="h-5 w-5" />}
                eyebrow="Voice operations"
                title="VAPI & Voice activity"
                description="Monitor existing voice call volume, minutes, telephony cost, and projected monthly VAPI spend for the selected date range."
              >
                <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">{data.summary.period}</Badge>
                <Badge variant="outline" className="border-accent/25 bg-accent/10 text-accent">{data.vapi.totalCalls} calls</Badge>
              </ApiUsageTabHeader>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <ApiUsageMetricCard
                  icon={<Phone className="h-4 w-4 text-accent" />}
                  label="Total Calls"
                  value={data.vapi.totalCalls}
                  caption={`${data.vapi.inbound} inbound / ${data.vapi.outbound} outbound`}
                />
                <ApiUsageMetricCard
                  icon={<Clock className="h-4 w-4 text-info" />}
                  label="Total Minutes"
                  value={data.vapi.totalMinutes}
                  caption={`~${data.vapi.totalCalls > 0 ? Math.round(data.vapi.totalMinutes / data.vapi.totalCalls) : 0} min/call avg`}
                />
                <ApiUsageMetricCard
                  icon={<DollarSign className="h-4 w-4 text-success" />}
                  label="Voice Cost"
                  value={`$${data.vapi.totalCost.toFixed(2)}`}
                  caption={`$${data.vapi.avgCostPerCall.toFixed(2)}/call`}
                />
                <ApiUsageMetricCard
                  icon={<CalendarDays className="h-4 w-4 text-warning" />}
                  label="Projected /mo"
                  value={`$${data.projections?.projectedMonthlyVapi?.toFixed(2) || '0'}`}
                  caption="incl. Twilio telephony"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* VAPI Call Volume + Cost Trend (Composed Chart) */}
              <Card className={`${API_USAGE_PANEL_CARD} lg:col-span-2`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Phone className="h-4 w-4 text-accent" />
                    Daily VAPI Call Volume & Cost
                  </CardTitle>
                  <CardDescription className="text-xs">Calls (bars) and cost (line) over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className={API_USAGE_TALL_CHART_HEIGHT}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={data.vapi.dailyTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => v.slice(5)} />
                        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => `$${v}`} />
                        <Tooltip contentStyle={API_USAGE_CHART_TOOLTIP_STYLE} />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        <Bar yAxisId="left" dataKey="calls" name="Calls" fill="hsl(328, 73%, 56%)" radius={[4, 4, 0, 0]} opacity={0.7} />
                        <Line yAxisId="right" type="monotone" dataKey="cost" name="Cost ($)" stroke="hsl(142, 71%, 45%)" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* VAPI Minutes Trend */}
              <Card className={`${API_USAGE_PANEL_CARD} lg:col-span-2`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Clock className="h-4 w-4 text-info" />
                    Daily Call Minutes
                  </CardTitle>
                  <CardDescription className="text-xs">Minutes consumed per day (Twilio telephony)</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className={API_USAGE_CHART_HEIGHT}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.vapi.dailyTrend}>
                        <defs>
                          <linearGradient id="minutesGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(262, 83%, 58%)" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="hsl(262, 83%, 58%)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => v.slice(5)} />
                        <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} unit=" min" />
                        <Tooltip contentStyle={API_USAGE_CHART_TOOLTIP_STYLE} formatter={(v: any) => [`${v} min`, 'Minutes']} />
                        <Area type="monotone" dataKey="minutes" stroke="hsl(262, 83%, 58%)" fill="url(#minutesGradient)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              </div>
            </>
          ) : (
            <ApiUsageEmptyState
              icon={<Phone className="h-7 w-7" />}
              title="No VAPI call data yet"
              description="Call logs will appear here as voice calls are made through VAPI."
            />
          )}
        </TabsContent>

        {/* ==================== Budget Tab (NEW) ==================== */}
        <TabsContent value="budget" className="mt-4 min-w-0 space-y-4">
          {data?.projections ? (
            <>
              <ApiUsageTabHeader
                icon={<DollarSign className="h-5 w-5" />}
                eyebrow="Cost control"
                title="Budget and projected spend"
                description="Review existing spend projections, daily averages, voice cost exposure, and configured service budget thresholds without changing alert logic."
              >
                <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">{data.summary.period}</Badge>
                <Badge variant="outline" className="border-brand-500/25 bg-brand-500/10 text-brand-500">Projected monthly</Badge>
              </ApiUsageTabHeader>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <ApiUsageMetricCard
                  icon={<Brain className="h-4 w-4 text-primary" />}
                  label="LLM APIs"
                  value={`$${data.projections.projectedMonthlyCost.toFixed(2)}`}
                  caption={`$${data.projections.dailyAvgCost.toFixed(4)}/day avg`}
                />
                <ApiUsageMetricCard
                  icon={<Phone className="h-4 w-4 text-accent" />}
                  label="VAPI + Twilio"
                  value={`$${data.projections.projectedMonthlyVapi.toFixed(2)}`}
                  caption="Voice & telephony"
                />
                <ApiUsageMetricCard
                  icon={<CalendarDays className="h-4 w-4 text-warning" />}
                  label="Total Projected"
                  value={`$${data.projections.totalProjectedMonthly.toFixed(2)}`}
                  caption="per month"
                />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

              {/* Per-Service Budget Bars */}
              <Card className={`${API_USAGE_PANEL_CARD} lg:col-span-2`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-success" />
                    Service Budget Tracking
                  </CardTitle>
                  <CardDescription className="text-xs">Current spend vs projected monthly by service</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* VAPI budget */}
                    {data.vapi && data.vapi.totalCost > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getServiceColor('vapi') }} />
                            <span className="text-sm font-medium text-foreground">VAPI + Twilio</span>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-bold text-foreground">${data.projections.projectedMonthlyVapi.toFixed(2)}</span>
                            {BUDGET_LIMITS.vapi > 0 && (
                              <span className="text-xs text-muted-foreground ml-1">/ ${BUDGET_LIMITS.vapi}</span>
                            )}
                          </div>
                        </div>
                        {BUDGET_LIMITS.vapi > 0 && (
                          <Progress
                            value={Math.min(100, (data.projections.projectedMonthlyVapi / BUDGET_LIMITS.vapi) * 100)}
                            className="h-2"
                          />
                        )}
                        {BUDGET_LIMITS.vapi > 0 && data.projections.projectedMonthlyVapi > BUDGET_LIMITS.vapi * 0.8 && (
                          <p className="text-[10px] text-destructive mt-1 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            {data.projections.projectedMonthlyVapi > BUDGET_LIMITS.vapi ? 'Over budget!' : 'Approaching budget limit'}
                          </p>
                        )}
                      </div>
                    )}

                    {/* LLM service budgets */}
                    {data.projections.serviceProjections
                      .sort((a, b) => b.projectedMonthly - a.projectedMonthly)
                      .map(svc => {
                        const limit = BUDGET_LIMITS[svc.service] || 0;
                        const pct = limit > 0 ? Math.min(100, (svc.projectedMonthly / limit) * 100) : 0;
                        const isWarning = limit > 0 && svc.projectedMonthly > limit * 0.8;
                        const isOver = limit > 0 && svc.projectedMonthly > limit;
                        return (
                          <div key={svc.service}>
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getServiceColor(svc.service) }} />
                                <span className="text-sm font-medium text-foreground">{formatServiceName(svc.service)}</span>
                              </div>
                              <div className="text-right">
                                <span className="text-sm font-bold text-foreground">${svc.projectedMonthly.toFixed(2)}</span>
                                {limit > 0 && (
                                  <span className="text-xs text-muted-foreground ml-1">/ ${limit}</span>
                                )}
                              </div>
                            </div>
                            {limit > 0 && <Progress value={pct} className="h-2" />}
                            {isWarning && (
                              <p className="text-[10px] text-destructive mt-1 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3" />
                                {isOver ? 'Over budget!' : 'Approaching budget limit'}
                              </p>
                            )}
                            <div className="flex justify-between mt-1">
                              <span className="text-[10px] text-muted-foreground">Current: ${svc.currentCost.toFixed(4)}</span>
                              <span className="text-[10px] text-muted-foreground">${svc.dailyAvg.toFixed(4)}/day</span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </CardContent>
              </Card>
              </div>
            </>
          ) : (
            <ApiUsageEmptyState
              icon={<DollarSign className="h-7 w-7" />}
              title="No budget data available"
              description="Cost projections will appear as usage data accumulates."
            />
          )}
        </TabsContent>

        {/* ==================== Performance Tab ==================== */}
        <TabsContent value="performance" className="mt-4 min-w-0 space-y-4">
          {data && (
            <>
              <ApiUsageTabHeader
                icon={<Clock className="h-5 w-5" />}
                eyebrow="API monitoring"
                title="Performance and latency"
                description="Review existing response-time telemetry, success rates, error volume, and per-service performance without changing thresholds or chart datasets."
              >
                <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">{data.summary.period}</Badge>
                <Badge variant="outline" className="border-border/60 bg-background/60 text-muted-foreground">{filteredHealthServices.length} services in view</Badge>
              </ApiUsageTabHeader>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <ApiUsageMetricCard
                  icon={<Clock className="h-4 w-4 text-primary" />}
                  label="Avg Response"
                  value={`${data.summary.avgResponseTime}ms`}
                  caption="Across tracked calls"
                />
                <ApiUsageMetricCard
                  icon={<CheckCircle2 className="h-4 w-4 text-success" />}
                  label="Success Rate"
                  value={`${data.summary.successRate}%`}
                  caption={`${data.summary.successCalls.toLocaleString('en-AU')} successful`}
                />
                <ApiUsageMetricCard
                  icon={<XCircle className="h-4 w-4 text-destructive" />}
                  label="Errors"
                  value={data.summary.errorCalls.toLocaleString('en-AU')}
                  caption="Failed health interactions"
                />
                <ApiUsageMetricCard
                  icon={<Activity className="h-4 w-4 text-primary" />}
                  label="Throughput"
                  value={data.summary.totalCalls.toLocaleString('en-AU')}
                  caption="Total API calls"
                />
              </div>

              <div className="grid grid-cols-1 gap-4">
              <Card className={API_USAGE_PANEL_CARD}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" />
                    Response Time Trends
                  </CardTitle>
                  <CardDescription className="text-xs">Average response time (ms) per service over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[320px] sm:h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={responseTimeData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => v.slice(5)} />
                        <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} unit="ms" />
                        <Tooltip contentStyle={API_USAGE_CHART_TOOLTIP_STYLE} labelStyle={API_USAGE_CHART_LABEL_STYLE} />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        {filteredHealthServices.map(svc => (
                          <Line key={svc} type="monotone" dataKey={svc} name={formatServiceName(svc)} stroke={getServiceColor(svc)} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredServiceBreakdown
                  .sort((a, b) => b.avgResponseTime - a.avgResponseTime)
                  .map(svc => (
                    <Card key={svc.service} className={API_USAGE_PANEL_CARD}>
                      <CardContent className="p-4">
                        <div className="flex min-w-0 items-center justify-between gap-3 mb-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="w-3 h-3 shrink-0 rounded-full" style={{ backgroundColor: getServiceColor(svc.service) }} />
                            <span className="min-w-0 truncate text-sm font-medium text-foreground" title={formatServiceName(svc.service)}>{formatServiceName(svc.service)}</span>
                          </div>
                          <Badge variant="outline" className={svc.successRate >= 95 ? 'border-success/30 text-success bg-success/10' : svc.successRate >= 80 ? 'border-brand-500/30 text-brand-400 bg-brand-500/10' : 'border-destructive/30 text-destructive bg-destructive/10'}>
                            {svc.successRate}%
                          </Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <p className="text-lg font-bold text-foreground">{svc.total}</p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Calls</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-foreground">{svc.avgResponseTime}ms</p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Time</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-destructive">{svc.errors}</p>
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Errors</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* ==================== Services Tab ==================== */}
        <TabsContent value="services" className="mt-4 min-w-0 space-y-4">
          {data && (
            <>
              <ApiUsageTabHeader
                icon={<Server className="h-5 w-5" />}
                eyebrow="Integration inventory"
                title="Services and health status"
                description="Inspect existing service names, call volume, success/error split, average response time, and health indicators from the current API usage dataset."
              >
                <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">{filteredServiceBreakdown.length} services</Badge>
                <Badge variant="outline" className="border-border/60 bg-background/60 text-muted-foreground">{data.summary.period}</Badge>
              </ApiUsageTabHeader>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filteredServiceBreakdown.map(svc => (
                  <Card key={svc.service} className={API_USAGE_PANEL_CARD}>
                    <CardContent className="p-4">
                      <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: getServiceColor(svc.service) }} />
                          <span className="min-w-0 truncate text-sm font-semibold text-foreground" title={formatServiceName(svc.service)}>{formatServiceName(svc.service)}</span>
                        </div>
                        <Badge variant="outline" className={svc.successRate >= 95 ? 'shrink-0 border-success/30 bg-success/10 text-success' : svc.successRate >= 80 ? 'shrink-0 border-brand-500/30 bg-brand-500/10 text-brand-400' : 'shrink-0 border-destructive/30 bg-destructive/10 text-destructive'}>
                          {svc.successRate}%
                        </Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="min-w-0 rounded-xl bg-muted/25 p-2">
                          <p className="truncate text-lg font-bold text-foreground">{svc.total}</p>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Calls</p>
                        </div>
                        <div className="min-w-0 rounded-xl bg-muted/25 p-2">
                          <p className="truncate text-lg font-bold text-foreground">{svc.avgResponseTime}ms</p>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg</p>
                        </div>
                        <div className="min-w-0 rounded-xl bg-muted/25 p-2">
                          <p className="truncate text-lg font-bold text-destructive">{svc.errors}</p>
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Errors</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card className={API_USAGE_PANEL_CARD}>
                <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  Service Breakdown
                </CardTitle>
                <CardDescription className="text-xs">Total calls, successes, and errors per service</CardDescription>
                </CardHeader>
                <CardContent>
                <div className="h-[400px] sm:h-[500px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={filteredServiceBreakdown.map(s => ({ ...s, name: formatServiceName(s.service) }))} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} width={120} />
                      <Tooltip contentStyle={API_USAGE_CHART_TOOLTIP_STYLE} labelStyle={API_USAGE_CHART_LABEL_STYLE} />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Bar dataKey="success" name="Success" fill="hsl(142, 71%, 45%)" radius={[0, 4, 4, 0]} stackId="a" />
                      <Bar dataKey="errors" name="Errors" fill="hsl(0, 84%, 60%)" radius={[0, 4, 4, 0]} stackId="a" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ==================== Logs Tab ==================== */}
        {/* ==================== Key Billing Tab ==================== */}
        {/* Whose key paid for each call, and what is escaping the meter. See
            docs/integrations/API_USAGE_METERING.md. */}
        <TabsContent value="billing" className="mt-4 min-w-0 space-y-4">
          <BillingRecoveryTab />
        </TabsContent>

        <TabsContent value="logs" className="mt-4 min-w-0 space-y-4">
          {data && (
            <>
              <ApiUsageTabHeader
                icon={<AlertTriangle className="h-5 w-5" />}
                eyebrow="Operational logs"
                title="Recent API call timeline"
                description="Review the existing health-check log stream with preserved ordering, severity, timestamps, service names, endpoints, response times, and quality labels."
              >
                <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">Last 50 events</Badge>
                <Badge variant="outline" className="border-border/60 bg-background/60 text-muted-foreground">{filteredHealthLogs.length} matching</Badge>
              </ApiUsageTabHeader>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <ApiUsageMetricCard
                  icon={<Activity className="h-4 w-4 text-primary" />}
                  label="Log Entries"
                  value={filteredHealthLogs.length.toLocaleString('en-AU')}
                  caption="Matching current filters"
                />
                <ApiUsageMetricCard
                  icon={<CheckCircle2 className="h-4 w-4 text-success" />}
                  label="Successful"
                  value={filteredHealthLogs.filter(log => log.status === 'success').length.toLocaleString('en-AU')}
                  caption="Existing success severity"
                />
                <ApiUsageMetricCard
                  icon={<XCircle className="h-4 w-4 text-destructive" />}
                  label="Errors"
                  value={filteredHealthLogs.filter(log => log.status !== 'success').length.toLocaleString('en-AU')}
                  caption="Existing error severity"
                />
              </div>

              <Card className={API_USAGE_PANEL_CARD}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-primary" />
                    Recent API Calls
                  </CardTitle>
                  <CardDescription className="text-xs">Last 50 logged health check interactions</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className={API_USAGE_TABLE_SCROLL}>
                    <table className="w-full min-w-[820px] table-fixed text-sm">
                      <thead>
                        <tr className="border-b border-border/50 bg-muted/20">
                          <th className="w-[20%] p-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Service</th>
                          <th className="hidden w-[26%] p-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground sm:table-cell">Endpoint</th>
                          <th className="w-[12%] p-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
                          <th className="hidden w-[12%] p-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground md:table-cell">Response</th>
                          <th className="hidden w-[14%] p-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground lg:table-cell">Quality</th>
                          <th className="w-[16%] p-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHealthLogs.map(log => (
                          <tr key={log.id} className="border-b border-border/30 transition-colors hover:bg-muted/30 motion-reduce:transition-none">
                            <td className="min-w-0 p-3">
                              <div className="flex min-w-0 items-center gap-2">
                                <div className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: getServiceColor(log.service) }} />
                                <span className="min-w-0 truncate text-xs text-foreground sm:text-sm" title={formatServiceName(log.service)}>{formatServiceName(log.service)}</span>
                              </div>
                            </td>
                            <td className="hidden min-w-0 truncate p-3 font-mono text-xs text-muted-foreground sm:table-cell" title={log.endpoint || '—'}>{log.endpoint || '—'}</td>
                            <td className="p-3">
                              <ApiUsageStatusBadge status={log.status} />
                            </td>
                            <td className="hidden p-3 text-xs text-muted-foreground tabular-nums md:table-cell">{log.responseTime ? `${log.responseTime}ms` : '—'}</td>
                            <td className="hidden min-w-0 p-3 lg:table-cell">
                              <Badge variant="secondary" className="max-w-full truncate text-[10px]" title={log.dataQuality || '—'}>{log.dataQuality || '—'}</Badge>
                            </td>
                            <td className="whitespace-nowrap p-3 text-xs text-muted-foreground">
                              {new Date(log.createdAt).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' })}{' '}
                              <span className="hidden sm:inline">{new Date(log.createdAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {filteredHealthLogs.length === 0 && (
                    <ApiUsageEmptyState
                      icon={<AlertTriangle className="h-7 w-7" />}
                      title="No API calls logged in this period"
                      description="Health check interactions matching the current filters will appear here."
                    />
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </DashboardThemeFrame>
  );
}
